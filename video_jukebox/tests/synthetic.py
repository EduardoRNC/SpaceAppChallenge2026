"""
Datos sintéticos para probar el jukebox sin descargar videos de NASA.

  synthetic_features()     dict con el mismo formato que analyze.analyze()
  write_synthetic_video()  mapa equirectangular falso: tierra gris y líneas de color
                           que se mueven hacia el oeste (azul en los polos, rojo en el ecuador)

Uso (video para probar run.sh):
    python tests/synthetic.py sintetico.avi [--seconds 8]
"""
import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyze import BANDS, band_rows  # noqa: E402


def synthetic_features(seconds=24.0, fps=30.0, seed=0, width=512):
    rng = np.random.default_rng(seed)
    n = int(round(seconds * fps))
    nb = len(BANDS)
    t = np.arange(n) / fps
    season = np.sin(2 * np.pi * t / seconds)[:, None]
    hemi = np.array([1.0, 1.0, 0.0, -1.0, -1.0])
    temp = np.array([0.15, 0.4, 0.8, 0.45, 0.1]) + 0.15 * season * hemi
    speed = 1.0 + 0.5 * np.sin(2 * np.pi * t[:, None] / 3.0 + np.arange(nb))
    u = -0.5 - 0.4 * np.sin(2 * np.pi * t / 8.0)[:, None] * np.ones(nb)
    v = 0.1 * rng.standard_normal((n, nb))
    vort = 0.05 + 0.005 * rng.standard_normal((n, nb))
    for b in range(nb):
        for c in rng.uniform(1.0, seconds - 1.0, size=4):
            vort[:, b] += 0.3 * np.exp(-0.5 * ((t - c) / 0.25) ** 2)
    noise = lambda: 0.01 * rng.standard_normal((n, nb))
    height = width // 2
    feat = dict(temp=temp + noise(), speed=speed + noise(), u=u + noise(), v=v, vort=vort,
                cover=np.full((n, nb), 0.3))
    feat = {k: x.astype(np.float32) for k, x in feat.items()}
    feat["fps"] = np.float32(fps)
    feat["bands"] = np.array([b[0] for b in BANDS])
    feat["band_pixels"] = np.array([(r1 - r0) * width for r0, r1 in band_rows(height)], np.int32)
    return feat


def write_synthetic_video(path, seconds=4.0, fps=30.0, size=(256, 128), overlay=False):
    """overlay=True incrusta una 'barra de color' fija abajo a la izquierda, como algunas versiones del SVS."""
    import cv2
    w, h = size
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
    if not vw.isOpened():
        raise RuntimeError("OpenCV no puede escribir video MJPG")
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    lat = 90 - (yy + 0.5) / h * 180
    hue = (120 * np.abs(lat) / 90).astype(np.uint8)          # ecuador rojo, polos azul
    land = (xx > 0.45 * w) & (xx < 0.55 * w)
    for i in range(int(round(seconds * fps))):
        lines = np.sin(2 * np.pi * (xx / w * 8 + yy / h * 3 + i * 0.05)) > 0.5
        hsv = np.zeros((h, w, 3), np.uint8)
        hsv[..., 0] = hue
        hsv[..., 1] = np.where(lines, 220, 0)
        hsv[..., 2] = np.where(lines, 230, 20)
        hsv[land] = (0, 0, 128)
        if overlay:
            y0, x0, bw = int(0.92 * h), int(0.02 * w), int(0.15 * w)
            hsv[y0:y0 + max(3, h // 25), x0:x0 + bw] = np.stack(
                [np.linspace(120, 0, bw).astype(np.uint8), np.full(bw, 230, np.uint8),
                 np.full(bw, 230, np.uint8)], -1)
        vw.write(cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR))
    vw.release()
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--seconds", type=float, default=8.0)
    a = ap.parse_args()
    write_synthetic_video(a.out, a.seconds, size=(512, 256))
    print(f"OK: video sintético de {a.seconds:.0f} s -> {a.out}")
