"""
Preview rápido en FM (estilo DX7, 2 operadores) para escuchar el resultado SIN Dexed.
No suena como un DX7 real; sirve para comprobar el mapeo. El sonido final: MIDI -> Dexed.

Uso:
    python render_preview.py events.json preview.wav
"""
import argparse
import json
import wave
import numpy as np
from scipy.signal import fftconvolve

SR = 44100

# Patches FM simples por canal: ratio moduladora, índice, envolvente (A, D, S, R en s / nivel S)
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


def render(data):
    meta = data["meta"]
    bpm = meta["bpm"]
    spb = 60.0 / bpm
    total = int((meta["seconds"] + 4) * SR)
    out = np.zeros((total, 2))
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
        out[start:start + n, 0] += sig * np.cos(pan * np.pi / 2)
        out[start:start + n, 1] += sig * np.sin(pan * np.pi / 2)

    # reverb simple: convolución con ruido de caída exponencial
    rng = np.random.default_rng(0)
    L = int(2.2 * SR)
    ir = rng.standard_normal((L, 2)) * np.exp(-np.arange(L) / (0.45 * SR))[:, None]
    ir /= np.abs(ir).sum(0) / 6
    wet = np.stack([fftconvolve(out[:, c], ir[:, c])[:total] for c in range(2)], 1)
    mix = 0.75 * out + 0.25 * wet
    mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * 1.2) * 0.9
    return mix[: int(meta["seconds"] * SR) + SR]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("events")
    ap.add_argument("out_wav")
    a = ap.parse_args()
    audio = render(json.load(open(a.events)))
    pcm = (audio * 32767).astype(np.int16)
    with wave.open(a.out_wav, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"OK: {len(audio)/SR:.1f} s -> {a.out_wav}")
