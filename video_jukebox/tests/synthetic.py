"""
Datos sintéticos para probar el jukebox sin descargar videos de NASA.

  synthetic_features()     dict con el mismo formato que analyze.analyze()
  write_synthetic_video()  mapa equirectangular falso: tierra gris y líneas de color
                           que se mueven hacia el oeste (azul en los polos, rojo en el ecuador)
  write_heatmap_video()    mapa de anomalías azul-blanco-rojo que se calienta, más en el Ártico
                           (para el analizador color_map)
  write_lights_video()     la Tierra de noche con luces que se encienden (night_lights)

NO son datos de NASA: solo sirven para probar el pipeline sin descargar nada.

Uso:
    python tests/synthetic.py sintetico.avi [--seconds 8] [--kind lines|heatmap|lights]
"""
import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers import BANDS, band_rows  # noqa: E402


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


def _writer(path, fps, w, h):
    import cv2
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
    if not vw.isOpened():
        raise RuntimeError("OpenCV no puede escribir video MJPG")
    return vw


def _blobs(w, h, n, seed):
    """Manchas suaves fijas (continentes / ciudades) para dar textura al mapa."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    out = np.zeros((h, w), np.float32)
    for _ in range(n):
        cx, cy = rng.uniform(0, w), rng.uniform(0.1 * h, 0.9 * h)
        r = rng.uniform(0.02, 0.08) * w
        out += np.exp(-(((xx - cx) ** 2) + (yy - cy) ** 2) / (2 * r * r))
    return out / out.max()


def write_heatmap_video(path, seconds=8.0, fps=30.0, size=(512, 256), seed=1):
    """Anomalía de temperatura falsa: sube con los "años", más rápido en el Ártico, con
    variabilidad por manchas. Paleta divergente azul (−) – blanco (0) – rojo (+)."""
    import cv2
    w, h = size
    vw = _writer(path, fps, w, h)
    yy, _ = np.mgrid[0:h, 0:w].astype(np.float32)
    lat = 90 - (yy + 0.5) / h * 180
    amplify = 1 + 1.5 * np.clip(lat / 90, 0, 1) ** 2           # el Ártico se calienta más
    texture = _blobs(w, h, 30, seed) - 0.5
    rng = np.random.default_rng(seed)
    n = int(round(seconds * fps))
    for i in range(n):
        year = i / max(n - 1, 1)                                # 0 -> 1
        wobble = 0.25 * np.sin(2 * np.pi * (year * 6 + texture))
        anom = (-0.4 + 1.6 * year ** 1.6) * amplify + wobble + 0.05 * rng.standard_normal((h, w))
        x = np.clip(anom / 2.0, -1, 1)                          # −2..+2 °C -> −1..1
        r = np.where(x > 0, 1.0, 1 + x)
        b = np.where(x < 0, 1.0, 1 - x)
        g = 1 - np.abs(x)
        bgr = (np.stack([b, g, r], -1) * 235 + 10).astype(np.uint8)
        vw.write(bgr)
    vw.release()
    return path


def write_lights_video(path, seconds=8.0, fps=30.0, size=(512, 256), seed=2):
    """Luces nocturnas falsas: ciudades (sobre todo en latitudes medias del norte) que se van
    encendiendo, con un parpadeo leve."""
    w, h = size
    vw = _writer(path, fps, w, h)
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    k = 160
    cy = np.concatenate([rng.uniform(0.15 * h, 0.35 * h, k * 3 // 4), rng.uniform(0.35 * h, 0.75 * h, k // 4)])
    cx = rng.uniform(0, w, k)
    on = rng.uniform(0, 1, k) ** 0.7                            # cuándo se enciende cada ciudad
    size_px = rng.uniform(1.0, 3.5, k)
    n = int(round(seconds * fps))
    for i in range(n):
        t = i / max(n - 1, 1)
        img = np.zeros((h, w), np.float32)
        for j in np.where(on <= t)[0]:
            grow = min(1.0, (t - on[j]) * 6)
            img += grow * np.exp(-(((xx - cx[j]) ** 2) + (yy - cy[j]) ** 2) / (2 * size_px[j] ** 2))
        img = np.clip(img * (0.95 + 0.05 * rng.standard_normal()), 0, 1)
        bgr = np.stack([img * 120, img * 210, img * 255], -1) + 6
        vw.write(np.clip(bgr, 0, 255).astype(np.uint8))
    vw.release()
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--kind", choices=["lines", "heatmap", "lights"], default="lines")
    a = ap.parse_args()
    write = dict(lines=write_synthetic_video, heatmap=write_heatmap_video, lights=write_lights_video)[a.kind]
    write(a.out, a.seconds, size=(512, 256))
    print(f"OK: video sintético ({a.kind}) de {a.seconds:.0f} s -> {a.out}")
