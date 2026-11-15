"""
Preview rápido en FM (estilo DX7, 2 operadores) para escuchar el resultado SIN Dexed.
No suena como un DX7 real; sirve para comprobar el mapeo. El sonido final: MIDI -> Dexed.

Uso:
    python render_preview.py events.json preview.wav
    python render_preview.py events.json preview.wav --stems out/stems

Con --stems, además de la mezcla (idéntica a la de siempre) escribe una pista por canal
(<pista>.wav) y stems.json. Las pistas empiezan en t=0, tienen la misma longitud y una
ganancia común sin saturación: sumadas dan la mezcla lineal, y ninguna combinación de
pistas (mute/solo) pasa de -1 dBFS.
"""
import argparse
import itertools
import json
import wave
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

from compose import TRACKS

SR = 44100
HEADROOM_DB = 1.0

# Patches FM simples por canal (= papel: 0 pad, 1 voces, 2 acentos, 3 bajo): ratio moduladora, índice, envolvente (A, D, S, R en s / nivel S)
PATCHES = {
    0: dict(ratio=1.0, index=0.8, A=0.6, D=1.0, S=0.8, R=1.2, detune=0.15, gain=0.10),  # pad cuerdas
    1: dict(ratio=1.0, index=1.2, A=0.08, D=0.3, S=0.7, R=0.25, vibrato=5.0, gain=0.16), # flauta
    2: dict(ratio=3.5, index=4.0, A=0.002, D=2.5, S=0.0, R=1.5, gain=0.13),             # campana
    3: dict(ratio=0.5, index=2.5, A=0.005, D=0.4, S=0.4, R=0.15, gain=0.30),            # bajo
}


def mtof(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def adsr(n, p, dur_s):
    A, D, S, R = p["A"], p["D"], p["S"], p["R"]
    t = np.arange(n) / SR
    env = np.where(t < A, t / max(A, 1e-4),
                   np.where(t < A + D, 1 - (1 - S) * (t - A) / D, S))
    if S == 0:  # percusivo: caída exponencial
        env = np.where(t < A, t / max(A, 1e-4), np.exp(-(t - A) / (D / 4)))
    rel = t > dur_s
    env = np.where(rel, env * np.exp(-(t - dur_s) / (R / 4)), env)
    return env


def buffer_len(meta):
    return int((meta["seconds"] + 4) * SR)


def output_len(meta):
    return int(meta["seconds"] * SR) + SR


def voices(data, total):
    """Cada nota sintetizada: (canal, muestra de inicio, señal mono, paneo)."""
    spb = 60.0 / data["meta"]["bpm"]
    # CC: mod (1) por canal y expresión (11)
    mod = {}
    for beat, ch, ctl, val in data["cc"]:
        if int(ctl) == 1:
            mod.setdefault(int(ch), []).append((beat * spb, val / 127))
    pans = {0: 0.5, 1: 0.5, 2: 0.5, 3: 0.5}
    for beat, dur, ch, note, vel in data["events"]:
        ch = int(ch); p = PATCHES[ch]
        start = int(beat * spb * SR)
        dur_s = dur * spb
        n = int((dur_s + p["R"]) * SR) if p["S"] > 0 else int((dur_s + p["D"]) * SR)
        n = min(n, total - start)
        if n <= 0:
            continue
        t = np.arange(n) / SR
        f = mtof(note)
        idx = p["index"]
        if ch in mod:  # turbulencia -> más índice FM -> sonido más brillante/áspero
            times = [m[0] for m in mod[ch]]
            k = np.searchsorted(times, beat * spb, side="right") - 1
            idx *= 0.6 + 1.2 * mod[ch][max(k, 0)][1]
        if p.get("vibrato"):
            f = f * (1 + 0.004 * np.sin(2 * np.pi * p["vibrato"] * t) * np.clip(t / 0.4, 0, 1))
            phase = 2 * np.pi * np.cumsum(f) / SR
        else:
            phase = 2 * np.pi * f * t
        env = adsr(n, p, dur_s)
        modenv = env if ch != 2 else np.exp(-t / 0.6)
        sig = np.sin(phase + idx * modenv * np.sin(p["ratio"] * phase))
        if p.get("detune"):
            sig = 0.5 * sig + 0.5 * np.sin(phase * (1 + p["detune"] / 100) + idx * modenv * np.sin(p["ratio"] * phase))
        sig *= env * (vel / 127) * p["gain"]
        # paneo: notas agudas a la derecha, graves a la izquierda (leve)
        pan = np.clip(0.5 + (note - 64) / 80, 0.15, 0.85) if ch in (1, 2) else pans[ch]
        yield ch, start, sig, pan


def add_voice(out, start, sig, pan):
    out[start:start + len(sig), 0] += sig * np.cos(pan * np.pi / 2)
    out[start:start + len(sig), 1] += sig * np.sin(pan * np.pi / 2)


def reverb(out, total):
    """Reverb simple: convolución con ruido de caída exponencial (lineal: se puede repartir por pistas)."""
    rng = np.random.default_rng(0)
    L = int(2.2 * SR)
    ir = rng.standard_normal((L, 2)) * np.exp(-np.arange(L) / (0.45 * SR))[:, None]
    ir /= np.abs(ir).sum(0) / 6
    wet = np.stack([fftconvolve(out[:, c], ir[:, c])[:total] for c in range(2)], 1)
    return 0.75 * out + 0.25 * wet


def render(data):
    """Mezcla estéreo del preview, con la saturación suave de siempre."""
    meta = data["meta"]
    total = buffer_len(meta)
    out = np.zeros((total, 2))
    for _, start, sig, pan in voices(data, total):
        add_voice(out, start, sig, pan)
    mix = reverb(out, total)
    mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * 1.2) * 0.9
    return mix[: output_len(meta)]


def render_stems(data, headroom_db=HEADROOM_DB):
    """Una pista estéreo por canal, sin saturación y con una ganancia común.

    La ganancia hace que ninguna suma de pistas (las 15 combinaciones de mute/solo) pase de
    -headroom_db dBFS. Como |sum a_i x_i| es convexa en a, también vale para ganancias
    intermedias entre 0 y 1 (rampas de mute)."""
    meta = data["meta"]
    total = buffer_len(meta)
    dry = {ch: np.zeros((total, 2)) for ch in PATCHES}
    for ch, start, sig, pan in voices(data, total):
        add_voice(dry[ch], start, sig, pan)
    stems = {ch: reverb(x, total)[: output_len(meta)] for ch, x in dry.items()}
    peak = max(np.abs(sum(stems[c] for c in combo)).max()
               for r in range(1, len(stems) + 1) for combo in itertools.combinations(stems, r))
    gain = 10 ** (-headroom_db / 20) / max(peak, 1e-9)
    return {ch: x * gain for ch, x in stems.items()}, gain


def stem_names(data=None):
    """Canal -> id de pista (de events.json; los antiguos no lo guardaban: ECCO2)."""
    tracks = (data or {}).get("meta", {}).get("tracks") or TRACKS
    return {t["ch"]: name for name, t in tracks.items()}


def write_wav(path, audio):
    pcm = (audio * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def write_stems(data, out_dir, headroom_db=HEADROOM_DB):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stems, gain = render_stems(data, headroom_db)
    names = stem_names(data)
    spb = 60.0 / data["meta"]["bpm"]
    info = dict(sample_rate=SR, samples=len(stems[0]), duration_s=len(stems[0]) / SR,
                gain=gain, headroom_db=headroom_db, stems=[])
    for ch, x in stems.items():
        write_wav(out_dir / f"{names[ch]}.wav", x)
        onsets = [b * spb for b, _, c, _, _ in data["events"] if int(c) == ch]
        info["stems"].append(dict(id=names[ch], channel=ch, file=f"{names[ch]}.wav",
                                  peak=float(np.abs(x).max()),
                                  first_note_s=min(onsets) if onsets else None))
    (out_dir / "stems.json").write_text(json.dumps(info, indent=2))
    return info


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("events")
    ap.add_argument("out_wav")
    ap.add_argument("--stems", metavar="DIR", help="escribe además una pista por canal en DIR")
    a = ap.parse_args()
    data = json.load(open(a.events))
    audio = render(data)
    write_wav(a.out_wav, audio)
    print(f"OK: {len(audio)/SR:.1f} s -> {a.out_wav}")
    if a.stems:
        info = write_stems(data, a.stems)
        print(f"OK: {len(info['stems'])} pistas de {info['duration_s']:.1f} s "
              f"(ganancia común {info['gain']:.3f}) -> {a.stems}")
