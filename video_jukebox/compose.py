"""
Earth Information Jukebox - Compositor: features.npz -> MIDI multipista (+ eventos para el preview).

Idea general
------------
1. DIRECTOR (conductor): fija tempo, compás y la progresión de acordes. La progresión
   sale de los DATOS: el contraste térmico norte-sur (las estaciones) elige acordes
   oscuros (invierno boreal) o brillantes (verano boreal).
2. VOCES: cada fenómeno es un instrumento que SOLO toca notas del acorde vigente,
   así la armonía queda garantizada aunque los datos sean caóticos.

   canal 1  Temperatura   (pad / STRINGS)   acorde por compás; volumen = calor global
   canal 2  Corrientes    (FLUTE)           una voz por franja de latitud; norte = agudo,
                                             sur = grave; suena cuando la corriente acelera
   canal 3  Remolinos     (TUB BELLS)       campanas cuando aparece un pico de vorticidad
   canal 4  Ecuatorial    (BASS)            raíz del acorde; más notas cuanto más fuerte
                                             la corriente ecuatorial hacia el oeste

Uso:
    python compose.py features.npz salida.mid [--bpm 90] [--events eventos.json]
"""
import argparse
import json
import struct
import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d

# ----------------------------------------------------------------------------
# CONFIGURACIÓN (tocad aquí para cambiar el carácter musical)
# ----------------------------------------------------------------------------
BPM = 90
BEATS_PER_BAR = 4
TPQ = 480                      # ticks por negra en el MIDI

# Escalera de acordes de "frío" a "cálido". Cada nivel tiene un par de acordes
# (pregunta / respuesta) que se alternan compás a compás. Notas MIDI absolutas
# en registro medio; las voces las trasladan a su octava.
CHORD_LADDER = [
    (("Dm9",    [50, 53, 57, 60, 64]), ("Bbmaj7", [46, 50, 53, 57])),   # muy frío
    (("Gm7",    [43, 50, 53, 58]),     ("Dm7",    [50, 53, 57, 60])),
    (("Bbmaj7", [46, 50, 53, 57]),     ("Fmaj7",  [41, 48, 52, 57])),
    (("Fmaj7",  [41, 48, 52, 57]),     ("Cadd9",  [48, 50, 55, 64])),
    (("Cmaj7",  [48, 52, 55, 59]),     ("Gadd9",  [43, 50, 55, 57])),   # muy cálido
]

# Canales MIDI (0-based) y programa sugerido del cartucho ROM1A del DX7 (0-based).
# Dexed cambia de preset con Program Change dentro del cartucho cargado.
TRACKS = {
    "temperatura": dict(ch=0, program=3,  name="Temperatura - STRINGS 1"),
    "corrientes":  dict(ch=1, program=23, name="Corrientes - FLUTE 1"),
    "remolinos":   dict(ch=2, program=25, name="Remolinos - TUB BELLS"),
    "ecuatorial":  dict(ch=3, program=14, name="Corriente ecuatorial - BASS 1"),
}

# Registro (nota MIDI central) de cada franja para la voz de corrientes:
# geografía -> altura (arriba del mapa = agudo).
BAND_REGISTER = {"artico": 84, "norte_medio": 76, "tropicos": 69, "sur_medio": 62, "antartico": 55}


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def smooth(x, frames):
    """Mediana (quita picos de compresión del video) + media móvil."""
    return uniform_filter1d(median_filter(x, size=frames, mode="nearest"), frames, mode="nearest")


def norm01(x, lo=5, hi=95):
    a, b = np.percentile(x, [lo, hi])
    return np.clip((x - a) / (b - a + 1e-9), 0, 1)


def nearest_chord_tone(target, chord):
    """Nota del acorde (en cualquier octava) más cercana a 'target'."""
    pcs = sorted({n % 12 for n in chord})
    best = None
    for octv in range(-1, 11):
        for pc in pcs:
            n = octv * 12 + pc
            if best is None or abs(n - target) < abs(best - target):
                best = n
    return best


def per_beat(x, fpb):
    """Promedia una serie por frame en bloques de 'fpb' frames (1 beat)."""
    nbeats = len(x) // fpb
    return x[: nbeats * fpb].reshape(nbeats, fpb, *x.shape[1:]).mean(1)


# ----------------------------------------------------------------------------
# Composición
# ----------------------------------------------------------------------------
def compose(feat, bpm=BPM):
    fps = float(feat["fps"])
    bands = [str(b) for b in feat["bands"]]
    bi = {b: i for i, b in enumerate(bands)}
    bpm_requested = bpm
    fpb = int(round(fps * 60.0 / bpm))            # frames por beat
    # Tempo ajustado a un número entero de frames por beat: así la música no se desfasa del
    # video (a 30 fps, 90 BPM ya es exacto; a 25 fps, 90 -> 88.24 BPM).
    bpm = 60.0 * fps / fpb
    sec_per_beat = 60.0 / bpm
    win = int(fps)                                  # suavizado de 1 s

    temp = np.stack([smooth(feat["temp"][:, i], win) for i in range(len(bands))], 1)
    speed = np.stack([smooth(feat["speed"][:, i], win) for i in range(len(bands))], 1)
    vort = np.stack([smooth(feat["vort"][:, i], win // 3) for i in range(len(bands))], 1)
    u = np.stack([smooth(feat["u"][:, i], win) for i in range(len(bands))], 1)

    T = per_beat(temp, fpb)        # (beats, bandas)
    S = per_beat(speed, fpb)
    V = per_beat(vort, fpb)
    U = per_beat(u, fpb)
    nbeats = T.shape[0]
    nbars = int(np.ceil(nbeats / BEATS_PER_BAR))

    events = []   # (beat_inicio, duración_beats, canal, nota, velocity)
    cc = []       # (beat, canal, controlador, valor)

    # ---------------- DIRECTOR: estaciones -> acordes ----------------
    season = T[:, bi["norte_medio"]] - T[:, bi["sur_medio"]]       # >0 verano boreal
    season_n = norm01(season, 0, 100)
    glob_temp = norm01(T.mean(1), 0, 100)
    chords = []
    for bar in range(nbars):
        b0, b1 = bar * BEATS_PER_BAR, min(nbeats, (bar + 1) * BEATS_PER_BAR)
        level = int(round(season_n[b0:b1].mean() * (len(CHORD_LADDER) - 1)))
        name, notes = CHORD_LADDER[level][bar % 2]
        chords.append((name, notes, level))
    chord_at = lambda beat: chords[min(beat // BEATS_PER_BAR, nbars - 1)][1]

    # ---------------- 1. TEMPERATURA: pad ----------------
    ch = TRACKS["temperatura"]["ch"]
    for bar, (name, notes, level) in enumerate(chords):
        b0 = bar * BEATS_PER_BAR
        dur = min(BEATS_PER_BAR, nbeats - b0)
        vel = int(45 + 40 * glob_temp[b0:b0 + dur].mean())
        shift = 12 if level >= 3 else 0          # más calor -> voicing más arriba
        for n in notes[1:]:
            events.append((b0, dur, ch, n + shift, vel))
        cc.append((b0, ch, 11, int(70 + 50 * glob_temp[b0:b0 + dur].mean())))

    # ---------------- 2. CORRIENTES: una voz por franja ----------------
    ch = TRACKS["corrientes"]["ch"]
    for b, name in enumerate(bands):
        act = norm01(S[:, b])                         # actividad relativa de la franja
        tb = norm01(T[:, b], 0, 100)                  # temperatura relativa de la franja
        reg = BAND_REGISTER.get(name, 69)
        cur_note, start = None, 0
        for beat in range(nbeats + 1):
            playing = beat < nbeats and act[beat] > 0.45
            note = None
            if playing:
                # la temperatura de la franja sube/baja la nota dentro de su registro (±5 st)
                note = nearest_chord_tone(reg - 5 + 10 * tb[beat], chord_at(beat))
            # cerrar nota si cambia o se calla (o lleva 2 beats: re-articular)
            if cur_note is not None and (note != cur_note or beat - start >= 2):
                events.append((start, beat - start, ch, cur_note, cur_vel))
                cur_note = None
            if note is not None and cur_note is None:
                cur_note, start = note, beat
                cur_vel = int(50 + 60 * act[beat])
    # modulación (timbre) = turbulencia global, cada medio beat
    vg = norm01(V.mean(1))
    for beat in range(nbeats):
        cc.append((beat, ch, 1, int(10 + 90 * vg[beat])))

    # ---------------- 3. REMOLINOS: campanas en picos de vorticidad ----------------
    ch = TRACKS["remolinos"]["ch"]
    sub = 2                                            # resolución de corchea
    fps_sub = fpb // sub
    for b, name in enumerate(bands):
        vb = per_beat(vort[:, b], fps_sub)             # (corcheas,)
        z = (vb - np.median(vb)) / (vb.std() + 1e-9)
        for k in range(1, len(vb) - 1):
            if z[k] > 1.6 and vb[k] >= vb[k - 1] and vb[k] > vb[k + 1]:
                beat = k / sub
                note = nearest_chord_tone(BAND_REGISTER.get(name, 69) + 12, chord_at(int(beat)))
                events.append((beat, 1.5, ch, note, int(min(110, 55 + 15 * z[k]))))

    # ---------------- 4. CORRIENTE ECUATORIAL: bajo ----------------
    ch = TRACKS["ecuatorial"]["ch"]
    west = norm01(-U[:, bi["tropicos"]])               # fuerza hacia el oeste
    patterns = [[0], [0, 2], [0, 1.5, 2, 3], [0, 0.5, 1.5, 2, 2.5, 3, 3.5]]
    for bar, (name, notes, level) in enumerate(chords):
        b0 = bar * BEATS_PER_BAR
        if b0 >= nbeats:
            break
        strength = west[b0:b0 + BEATS_PER_BAR].mean()
        pat = patterns[min(len(patterns) - 1, int(strength * len(patterns)))]
        root = notes[0]
        while root > 40:
            root -= 12
        for i, off in enumerate(pat):
            if b0 + off >= nbeats:                     # último compás incompleto
                break
            nxt = min(pat[i + 1] if i + 1 < len(pat) else BEATS_PER_BAR, nbeats - b0)
            note = root + (7 if (i % 4 == 3) else 0)   # quinta de paso ocasional
            events.append((b0 + off, (nxt - off) * 0.9, ch, note, int(70 + 30 * strength)))

    meta = dict(bpm=bpm, bpm_requested=bpm_requested, nbeats=nbeats, nbars=nbars, fpb=fpb,
                chords=[c[0] for c in chords], seconds=nbeats * sec_per_beat)
    return events, cc, meta


# ----------------------------------------------------------------------------
# Escritor MIDI mínimo (sin dependencias)
# ----------------------------------------------------------------------------
def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def track_chunk(msgs):
    """msgs: lista de (tick, bytes)."""
    msgs = sorted(msgs, key=lambda m: (m[0], 0 if m[1][0] & 0xF0 == 0x80 else 1))
    data, last = b"", 0
    for tick, m in msgs:
        data += vlq(tick - last) + m
        last = tick
    data += vlq(0) + b"\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def write_midi(path, events, cc, bpm, tracks=TRACKS):
    t = lambda beat: int(round(beat * TPQ))
    tempo = int(60_000_000 / bpm)
    chunks = [track_chunk([(0, b"\xff\x51\x03" + tempo.to_bytes(3, "big")),
                           (0, b"\xff\x58\x04\x04\x02\x18\x08")])]
    for key, info in tracks.items():
        c = info["ch"]
        name = info["name"].encode("utf-8")
        msgs = [(0, b"\xff\x03" + vlq(len(name)) + name),
                (0, bytes([0xC0 | c, info["program"]]))]
        for (beat, dur, ch, note, vel) in events:
            if ch != c:
                continue
            note = int(np.clip(note, 0, 127)); vel = int(np.clip(vel, 1, 127))
            msgs.append((t(beat), bytes([0x90 | c, note, vel])))
            msgs.append((t(beat + dur), bytes([0x80 | c, note, 0])))
        for (beat, ch, ctl, val) in cc:
            if ch == c:
                msgs.append((t(beat), bytes([0xB0 | c, ctl, int(np.clip(val, 0, 127))])))
        chunks.append(track_chunk(msgs))
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ)
    with open(path, "wb") as f:
        f.write(header + b"".join(chunks))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("features")
    ap.add_argument("out_mid")
    ap.add_argument("--bpm", type=float, default=BPM)
    ap.add_argument("--events", default=None, help="guardar eventos en JSON (para el preview)")
    a = ap.parse_args()
    feat = np.load(a.features)
    events, cc, meta = compose(feat, a.bpm)
    write_midi(a.out_mid, events, cc, meta["bpm"])
    print(f"OK: {len(events)} notas, {meta['nbars']} compases, {meta['seconds']:.1f} s, "
          f"{meta['bpm']:.2f} BPM ({meta['fpb']} frames/beat) -> {a.out_mid}")
    print("Acordes:", " | ".join(meta["chords"]))
    if a.events:
        with open(a.events, "w") as f:
            json.dump(dict(events=[list(map(float, e)) for e in events],
                           cc=[list(map(float, c)) for c in cc], meta=meta), f)
