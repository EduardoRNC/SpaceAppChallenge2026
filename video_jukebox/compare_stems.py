"""
Compara cada stem WAV del preview FM con su versión AAC publicada, a igual volumen.

Renderiza los stems WAV desde out/<nombre>_events.json (los mismos que codificó build_web.py),
decodifica los .m4a de web/public/media/jukebox/, iguala el nivel (ganancia de mínimos
cuadrados) y mide dónde está la diferencia:

  - nivel y SNR global (error / señal);
  - energía por bandas de frecuencia y frecuencia de corte del codificador;
  - campanadas: pre-eco antes del golpe, pico del ataque y SNR en ataque y en la caída.

Con --excerpt escribe en out/compare/ fragmentos igualados (WAV original, AAC decodificado y
la diferencia) para escucharlos en A/B. No modifica los stems ni el patch FM.

Uso (desde video_jukebox/):
    python compare_stems.py --name ecco2_full [--stem remolinos] [--also 192 256] [--excerpt 8]
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.signal import welch

import build_web as bw
import render_preview as rp

HERE = Path(__file__).resolve().parent
BANDS = [(0, 1000), (1000, 4000), (4000, 8000), (8000, 12000), (12000, 16000), (16000, 22050)]
PRE = (-0.020, -0.002)       # ventana de pre-eco antes de cada golpe (s)
ATTACK_S = 0.05
DECAY = (0.3, 1.5)


def db(x):
    return 10 * np.log10(np.maximum(x, 1e-20))


def ratio_db(a, b):
    return db(np.asarray(a, float) / np.maximum(b, 1e-30))


def onsets(events, ch):
    spb = 60.0 / events["meta"]["bpm"]
    return sorted(int(b * spb * rp.SR) for b, _, c, _, _ in events["events"] if int(c) == ch)


def windows(starts, a, b, n):
    """Índices de las ventanas [s+a, s+b) que caben en la señal."""
    a, b = int(a * rp.SR), int(b * rp.SR)
    return [slice(s + a, s + b) for s in starts if s + a >= 0 and s + b <= n]


def energy(x, sls):
    return np.array([np.sum(x[s] ** 2) for s in sls])


def compare(ref, x, starts=()):
    n = min(len(ref), len(x))
    ref, x = ref[:n].astype(float), x[:n].astype(float)
    g = float(np.sum(ref * x) / np.sum(x * x))           # ganancia que mejor iguala el nivel
    err = g * x - ref
    r = dict(level_db=20 * np.log10(np.sqrt(np.mean(x ** 2)) / np.sqrt(np.mean(ref ** 2))),
             match_gain_db=20 * np.log10(g),
             snr_db=ratio_db(np.sum(ref ** 2), np.sum(err ** 2)),
             peak_ref_dbfs=20 * np.log10(np.abs(ref).max()),
             peak_aac_dbfs=20 * np.log10(np.abs(x).max()))

    mono = lambda y: y.mean(1)
    f, p_ref = welch(mono(ref), rp.SR, nperseg=8192)
    _, p_x = welch(mono(g * x), rp.SR, nperseg=8192)
    _, p_err = welch(mono(err), rp.SR, nperseg=8192)
    total = p_ref.sum()
    r["bands"] = []
    for lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        r["bands"].append(dict(hz=[lo, hi], share_pct=100 * p_ref[m].sum() / total,
                               aac_vs_wav_db=ratio_db(p_x[m].sum(), p_ref[m].sum()),
                               snr_db=ratio_db(p_ref[m].sum(), p_err[m].sum())))
    # Corte: primera frecuencia > 8 kHz a partir de la cual el AAC queda 30 dB por debajo.
    ratio = ratio_db(p_x, p_ref)
    above = (f > 8000) & (p_ref > p_ref.max() * 1e-9)
    low = np.where(above & (ratio < -30))[0]
    cut = next((i for i in low if np.all(ratio[i:][above[i:]] < -10)), None)
    r["cutoff_hz"] = float(f[cut]) if cut is not None else None
    r["energy_above_cutoff_pct"] = (100 * p_ref[f >= f[cut]].sum() / total) if cut is not None else 0.0

    if len(starts):
        e_ref = mono(ref)
        e_err = mono(err)
        att = windows(starts, 0, ATTACK_S, n)
        pre = windows(starts, *PRE, n)
        dec = windows(starts, *DECAY, n)
        peak = lambda y, sls: np.array([np.abs(y[s]).max() for s in sls])
        r["hits"] = dict(
            count=len(att),
            # error añadido justo antes del golpe, relativo a la energía del golpe
            pre_echo_db=float(np.median(ratio_db(energy(e_err, pre[:len(att)]), energy(e_ref, att[:len(pre)])))),
            attack_peak_db=float(np.median(2 * ratio_db(peak(mono(g * x), att), peak(e_ref, att)))),
            attack_snr_db=float(ratio_db(energy(e_ref, att).sum(), energy(e_err, att).sum())),
            decay_snr_db=float(ratio_db(energy(e_ref, dec).sum(), energy(e_err, dec).sum())),
        )
    return r, g, err


def encode(wav, kbps, tmp):
    out = Path(tmp) / f"x_{kbps}.m4a"
    bw.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", f"{kbps}k", out])
    return bw.decode(out)


def busiest(starts, n, seconds):
    """Inicio del tramo de `seconds` con más golpes."""
    w = int(seconds * rp.SR)
    if not starts:
        return 0
    best = max(starts, key=lambda s: sum(s <= t < s + w for t in starts))
    return max(0, min(best - int(0.25 * rp.SR), n - w))


def print_report(name, r):
    print(f"\n{name}: nivel AAC − WAV {r['level_db']:+.2f} dB (ganancia de igualación "
          f"{r['match_gain_db']:+.2f} dB), SNR {r['snr_db']:.1f} dB, "
          f"picos {r['peak_ref_dbfs']:.1f} / {r['peak_aac_dbfs']:.1f} dBFS")
    cut = f"{r['cutoff_hz'] / 1000:.1f} kHz" if r["cutoff_hz"] else "no detectado"
    print(f"  corte del codificador: {cut}; energía del WAV por encima: {r['energy_above_cutoff_pct']:.2f} %")
    print("  banda (kHz)    % energía   AAC − WAV   SNR")
    for b in r["bands"]:
        lo, hi = b["hz"]
        print(f"  {lo / 1000:4.0f}–{hi / 1000:<4.0f}      {b['share_pct']:6.2f} %   "
              f"{b['aac_vs_wav_db']:+6.1f} dB  {b['snr_db']:5.1f} dB")
    if "hits" in r:
        h = r["hits"]
        print(f"  campanadas: {h['count']}; pre-eco {h['pre_echo_db']:.1f} dB respecto al golpe; "
              f"pico del ataque {h['attack_peak_db']:+.2f} dB; SNR en el ataque "
              f"{h['attack_snr_db']:.1f} dB, en la caída {h['decay_snr_db']:.1f} dB")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True, help="prefijo de out/<nombre>_events.json")
    ap.add_argument("--slug", default="ecco2")
    ap.add_argument("--web", type=Path, default=bw.WEB / "public")
    ap.add_argument("--stem", action="append", help="pistas a comparar (por defecto, todas)")
    ap.add_argument("--also", type=int, nargs="*", default=[], help="recodificar también a estos kb/s")
    ap.add_argument("--excerpt", type=float, default=0, help="segundos de fragmento A/B (0 = no)")
    ap.add_argument("--out", type=Path, default=HERE / "out" / "compare")
    a = ap.parse_args(argv)

    events = json.loads((HERE / "out" / f"{a.name}_events.json").read_text())
    report = {}
    with tempfile.TemporaryDirectory() as tmp:
        info = rp.write_stems(events, tmp)
        for s in info["stems"]:
            if a.stem and s["id"] not in a.stem:
                continue
            wav = Path(tmp) / s["file"]
            ref = bw.decode(wav)
            aac = bw.decode(a.web / bw.MEDIA_DIR / f"{a.slug}_{s['id']}.m4a")
            starts = onsets(events, s["channel"]) if s["id"] == "remolinos" else []
            r, g, err = compare(ref, aac, starts)
            print_report(f"{s['id']} (AAC publicado)", r)
            report[s["id"]] = dict(published=r)
            for kbps in a.also:
                rk, _, _ = compare(ref, encode(wav, kbps, tmp), starts)
                print_report(f"{s['id']} (AAC {kbps} kb/s)", rk)
                report[s["id"]][f"aac_{kbps}k"] = rk
            if a.excerpt:
                a.out.mkdir(parents=True, exist_ok=True)
                i0 = busiest(starts, len(ref), a.excerpt) if starts else 0
                cut = slice(i0, i0 + int(a.excerpt * rp.SR))
                n = min(len(ref), len(aac))
                rp.write_wav(a.out / f"{s['id']}_wav.wav", ref[:n][cut])
                rp.write_wav(a.out / f"{s['id']}_aac.wav", (g * aac[:n])[cut])
                rp.write_wav(a.out / f"{s['id']}_diferencia.wav", err[cut])
                report[s["id"]]["excerpt_s"] = [i0 / rp.SR, (i0 + int(a.excerpt * rp.SR)) / rp.SR]
    if a.excerpt:
        (a.out / "report.json").write_text(json.dumps(report, indent=2))
        print(f"\nFragmentos y report.json en {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
