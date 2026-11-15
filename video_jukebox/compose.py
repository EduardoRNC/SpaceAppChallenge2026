"""
Paso 2 del jukebox: features.npz -> MIDI de 4 pistas (+ eventos para el preview y la web).

Idea general
------------
1. DIRECTOR (conductor): fija tempo, compás y la progresión de acordes. La progresión sale
   de los DATOS (la medida 'harmony' de la música del video): valores bajos -> acordes
   oscuros, altos -> brillantes.
2. VOCES: cada pista SOLO toca notas del acorde vigente, así la armonía queda garantizada
   aunque los datos sean caóticos.

Las 4 pistas tienen un PAPEL fijo por canal; lo que cambia en cada video es qué medida
controla cada papel (la "música" de su ficha, videos/<id>.json, o la del analizador):

   canal 1  pad      (STRINGS)   acorde por compás; volumen = 'metric' (media de franjas)
   canal 2  voices   (FLUTE)     una voz por franja (norte = agudo); suena cuando 'activity'
                                  sube; 'pitch' mueve la nota; 'timbre' cambia el sonido (CC1)
   canal 3  accents  (BELLS)     una campanada en cada pico de 'metric' en una franja
   canal 4  bass     (BASS)      raíz del acorde; más notas cuanto mayor es 'metric' en
                                  'region' (con 'direction': -1 cuenta los valores negativos)

   harmony  {"metric": m, "mode": "contrast", "regions": [a, b]}  -> m[a] - m[b]
            {"metric": m, "mode": "mean"}                         -> media de las franjas

Uso:
    python compose.py features.npz salida.mid [--music musica.json] [--bpm 90] [--events eventos.json]
"""
import argparse
import json
import struct
import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d

import analyzers

# ----------------------------------------------------------------------------
# CONFIGURACIÓN (tocad aquí para cambiar el carácter musical)
# ----------------------------------------------------------------------------
BPM = 90
BEATS_PER_BAR = 4
TPQ = 480                      # ticks por negra en el MIDI

# Escalera de acordes de "bajo" a "alto" (frío a cálido en ECCO2). Cada nivel tiene un par de
# acordes (pregunta / respuesta) que se alternan compás a compás. Notas MIDI absolutas en
# registro medio; las voces las trasladan a su octava.
CHORD_LADDER = [
    (("Dm9",    [50, 53, 57, 60, 64]), ("Bbmaj7", [46, 50, 53, 57])),   # muy frío
    (("Gm7",    [43, 50, 53, 58]),     ("Dm7",    [50, 53, 57, 60])),
    (("Bbmaj7", [46, 50, 53, 57]),     ("Fmaj7",  [41, 48, 52, 57])),
    (("Fmaj7",  [41, 48, 52, 57]),     ("Cadd9",  [48, 50, 55, 64])),
    (("Cmaj7",  [48, 52, 55, 59]),     ("Gadd9",  [43, 50, 55, 57])),   # muy cálido
]

# Papel de cada canal MIDI (0-based). render_preview.py usa un sonido FM por papel.
ROLES = ["pad", "voices", "accents", "bass"]
ROLE_SLOTS = {"pad": ["metric"], "voices": ["activity", "pitch", "timbre"],
              "accents": ["metric"], "bass": ["metric"]}

# Música por defecto: la de ECCO2 (analizador ocean_flow).
DEFAULT_MUSIC = analyzers.get("ocean_flow").DEFAULT_MUSIC

# Registro (nota MIDI central) de cada franja para las voces:
# geografía -> altura (arriba del mapa = agudo).
BAND_REGISTER = {"artico": 84, "norte_medio": 76, "tropicos": 69, "sur_medio": 62, "antartico": 55}


def tracks_table(music=DEFAULT_MUSIC):
    """{id: {ch, program, name, role, patch}} en el orden de los canales."""
    out = {}
    for t in music["tracks"]:
        ch = ROLES.index(t["role"])
        out[t["id"]] = dict(ch=ch, program=int(t["program"]), role=t["role"], patch=t["patch"],
                            name=f"{t.get('name', t['id'])} - {t['patch']}")
    return out


TRACKS = tracks_table()


class MusicError(ValueError):
    """La música de un video no cuadra con las medidas de su analizador."""


def check_music(music, metrics):
    """Comprueba que cada papel aparece una vez y que todas las medidas existen."""
    roles = [t.get("role") for t in music.get("tracks", [])]
    if sorted(roles) != sorted(ROLES):
        raise MusicError(f"hacen falta exactamente los papeles {ROLES}, hay {roles}")
    ids = [t.get("id") for t in music["tracks"]]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
        raise MusicError(f"ids de pista repetidos o vacíos: {ids}")
    h = music.get("harmony", {})
    used = [h.get("metric")]
    if h.get("mode") not in ("contrast", "mean"):
        raise MusicError(f"harmony.mode debe ser 'contrast' o 'mean', no {h.get('mode')!r}")
    bands = [b[0] for b in analyzers.BANDS]
    if h["mode"] == "contrast" and (len(h.get("regions", [])) != 2 or
                                    any(r not in bands for r in h["regions"])):
        raise MusicError(f"harmony.regions debe tener 2 franjas de {bands}")
    for t in music["tracks"]:
        for slot in ROLE_SLOTS[t["role"]]:
            used.append(t.get(slot))
        if t["role"] == "bass" and t.get("region") not in bands:
            raise MusicError(f"bass.region debe ser una de {bands}")
    missing = [m for m in used if m not in metrics]
    if missing:
        raise MusicError(f"medidas que el analizador no da: {missing} (tiene {list(metrics)})")


def mapping_of(music):
    """Qué medida (y de qué franjas) usa cada parte de la música: para la web y los textos."""
    ALL = "all"
    h = music["harmony"]
    harmony = [dict(metric=h["metric"], regions=h["regions"] if h["mode"] == "contrast" else ALL,
                    slot="harmony", mode=h["mode"])]
    tracks = {}
    for t in music["tracks"]:
        regions = [t["region"]] if t["role"] == "bass" else ALL
        uses = []
        for slot in ROLE_SLOTS[t["role"]]:
            if all(u["metric"] != t[slot] for u in uses) or t["role"] != "voices":
                uses.append(dict(metric=t[slot], regions=regions, slot=slot))
            else:  # voces con la misma medida en dos papeles: un solo uso con los dos
                next(u for u in uses if u["metric"] == t[slot])["slot"] += f"+{slot}"
        if t["role"] == "bass":
            uses[0]["direction"] = int(t.get("direction", 1))
        tracks[t["id"]] = dict(role=t["role"], uses=uses)
    return dict(harmony=harmony, tracks=tracks)


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
def compose(feat, bpm=BPM, music=None):
    music = music or analyzers.analyzer_of(feat).DEFAULT_MUSIC
    check_music(music, analyzers.analyzer_of(feat).METRICS)
    tracks = tracks_table(music)
    role = {t["role"]: t for t in music["tracks"]}
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

    def smoothed(metric, w):
        return np.stack([smooth(feat[metric][:, i], w) for i in range(len(bands))], 1)

    def beats(metric, w=win):
        return per_beat(smoothed(metric, w), fpb)   # (beats, bandas)

    H = beats(music["harmony"]["metric"])
    nbeats = H.shape[0]
    nbars = int(np.ceil(nbeats / BEATS_PER_BAR))

    events = []   # (beat_inicio, duración_beats, canal, nota, velocity)
    cc = []       # (beat, canal, controlador, valor)

    # ---------------- DIRECTOR: datos -> acordes ----------------
    h = music["harmony"]
    if h["mode"] == "contrast":
        a, b = h["regions"]
        drive = H[:, bi[a]] - H[:, bi[b]]            # ECCO2: norte - sur = estaciones
    else:
        drive = H.mean(1)
    drive_n = norm01(drive, 0, 100)
    chords = []
    for bar in range(nbars):
        b0, b1 = bar * BEATS_PER_BAR, min(nbeats, (bar + 1) * BEATS_PER_BAR)
        level = int(round(drive_n[b0:b1].mean() * (len(CHORD_LADDER) - 1)))
        name, notes = CHORD_LADDER[level][bar % 2]
        chords.append((name, notes, level))
    chord_at = lambda beat: chords[min(beat // BEATS_PER_BAR, nbars - 1)][1]

    # ---------------- 1. PAD: acordes; volumen = media de las franjas ----------------
    ch = ROLES.index("pad")
    level_pad = norm01(beats(role["pad"]["metric"]).mean(1), 0, 100)
    for bar, (name, notes, level) in enumerate(chords):
        b0 = bar * BEATS_PER_BAR
        dur = min(BEATS_PER_BAR, nbeats - b0)
        vel = int(45 + 40 * level_pad[b0:b0 + dur].mean())
        shift = 12 if level >= 3 else 0          # acordes brillantes -> voicing más arriba
        for n in notes[1:]:
            events.append((b0, dur, ch, n + shift, vel))
        cc.append((b0, ch, 11, int(70 + 50 * level_pad[b0:b0 + dur].mean())))

    # ---------------- 2. VOCES: una por franja ----------------
    ch = ROLES.index("voices")
    v = role["voices"]
    S = beats(v["activity"])
    P = beats(v["pitch"])
    for b, name in enumerate(bands):
        act = norm01(S[:, b])                         # actividad relativa de la franja
        tb = norm01(P[:, b], 0, 100)                  # 'pitch' relativo de la franja
        reg = BAND_REGISTER.get(name, 69)
        cur_note, start = None, 0
        for beat in range(nbeats + 1):
            playing = beat < nbeats and act[beat] > 0.45
            note = None
            if playing:
                # 'pitch' sube/baja la nota dentro del registro de la franja (±5 st)
                note = nearest_chord_tone(reg - 5 + 10 * tb[beat], chord_at(beat))
            # cerrar nota si cambia o se calla (o lleva 2 beats: re-articular)
            if cur_note is not None and (note != cur_note or beat - start >= 2):
                events.append((start, beat - start, ch, cur_note, cur_vel))
                cur_note = None
            if note is not None and cur_note is None:
                cur_note, start = note, beat
                cur_vel = int(50 + 60 * act[beat])
    # modulación (timbre) = media de las franjas de 'timbre', cada beat
    vg = norm01(beats(v["timbre"], win // 3).mean(1))
    for beat in range(nbeats):
        cc.append((beat, ch, 1, int(10 + 90 * vg[beat])))

    # ---------------- 3. ACENTOS: campanas en los picos ----------------
    ch = ROLES.index("accents")
    acc = smoothed(role["accents"]["metric"], win // 3)
    sub = 2                                            # resolución de corchea
    fps_sub = fpb // sub
    for b, name in enumerate(bands):
        vb = per_beat(acc[:, b], fps_sub)              # (corcheas,)
        z = (vb - np.median(vb)) / (vb.std() + 1e-9)
        for k in range(1, len(vb) - 1):
            if z[k] > 1.6 and vb[k] >= vb[k - 1] and vb[k] > vb[k + 1]:
                beat = k / sub
                note = nearest_chord_tone(BAND_REGISTER.get(name, 69) + 12, chord_at(int(beat)))
                events.append((beat, 1.5, ch, note, int(min(110, 55 + 15 * z[k]))))

    # ---------------- 4. BAJO: densidad según una franja ----------------
    ch = ROLES.index("bass")
    bass = role["bass"]
    strength_n = norm01(int(bass.get("direction", 1)) * beats(bass["metric"])[:, bi[bass["region"]]])
    patterns = [[0], [0, 2], [0, 1.5, 2, 3], [0, 0.5, 1.5, 2, 2.5, 3, 3.5]]
    for bar, (name, notes, level) in enumerate(chords):
        b0 = bar * BEATS_PER_BAR
        if b0 >= nbeats:
            break
        strength = strength_n[b0:b0 + BEATS_PER_BAR].mean()
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
                chords=[c[0] for c in chords], seconds=nbeats * sec_per_beat,
                analyzer=analyzers.analyzer_of(feat).NAME, tracks=tracks, mapping=mapping_of(music))
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


def write_midi(path, events, cc, bpm, tracks=None):
    tracks = tracks or TRACKS
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
    ap.add_argument("--music", default=None, help="JSON con la música (o una ficha de video con 'music')")
    ap.add_argument("--events", default=None, help="guardar eventos en JSON (para el preview)")
    a = ap.parse_args()
    feat = np.load(a.features)
    music = None
    if a.music:
        with open(a.music) as f:
            music = json.load(f)
        # una ficha de video (videos/<id>.json) o solo su bloque "music"
        if "music" in music:
            music = music["music"]
        elif "analyzer" in music:
            music = analyzers.get(music["analyzer"]).DEFAULT_MUSIC
    events, cc, meta = compose(feat, a.bpm, music)
    write_midi(a.out_mid, events, cc, meta["bpm"], meta["tracks"])
    print(f"OK: {len(events)} notas, {meta['nbars']} compases, {meta['seconds']:.1f} s, "
          f"{meta['bpm']:.2f} BPM ({meta['fpb']} frames/beat) -> {a.out_mid}")
    print("Acordes:", " | ".join(meta["chords"]))
    if a.events:
        with open(a.events, "w") as f:
            json.dump(dict(events=[list(map(float, e)) for e in events],
                           cc=[list(map(float, c)) for c in cc], meta=meta), f)
