"""
Paso 1 del jukebox: video -> features.npz (qué pasa en cada franja de latitud, frame a frame).

El cálculo lo hace el analizador del tipo de video (ver analyzers/):
  ocean_flow    líneas que se mueven coloreadas (ECCO2)        -> temp, speed, u, v, vort
  color_map     mapas de calor que cambian de color            -> warm, hue, hot, change
  night_lights  la Tierra de noche                             -> bright, lit, new

Uso:
    python analyze.py video.mp4 features.npz [--analyzer ocean_flow] [--width 512]
"""
import argparse

import numpy as np

import analyzers
from analyzers import BANDS, MIN_PIXELS, band_rows  # noqa: F401  (los usan otros módulos)


def analyze(path, width=512, analyzer="ocean_flow", progress=True):
    return analyzers.analyze_video(path, analyzers.get(analyzer), width, progress)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--analyzer", default="ocean_flow", choices=sorted(analyzers.ANALYZERS))
    ap.add_argument("--width", type=int, default=512)
    a = ap.parse_args()
    r = analyze(a.video, a.width, a.analyzer)
    np.savez(a.out, **r)
    first = next(k for k in analyzers.get(a.analyzer).METRICS)
    print(f"OK [{a.analyzer}]: {r[first].shape[0]} frames x {r[first].shape[1]} franjas -> {a.out}")
