"""
Revisa qué píxeles entran en la máscara de un analizador y si hay superposiciones estáticas
(textos, fecha, barra de color, logos) que contaminen las medidas. Úsalo con cada video nuevo
antes de añadirlo al jukebox.

Toma N frames repartidos por el video y, por píxel, mira cuántas veces pasa la máscara y
cuánto cambia. Una superposición es un píxel coloreado que está SIEMPRE en la máscara y
casi no cambia; las líneas de corriente se mueven y cambian de brillo.

  <out>_mask.png   frame de muestra | máscara (verde) con píxeles estáticos (magenta) y franjas
  stdout           por región: cobertura, % de la máscara que es estático e índice de color
                   de esos píxeles; y las cajas de los grupos estáticos más grandes

Uso:
    python mask_check.py video.mp4 out/prefijo [--analyzer ocean_flow] [--samples 40] [--width 512]
"""
import argparse

import cv2
import numpy as np

import analyzers
from analyzers import BANDS, band_rows
from analyzers.common import Frame, hue_index as temperature_index

MIN_PERSIST = 0.95      # fracción de muestras en la máscara
MAX_STD_V = 8.0         # variación de brillo (0-255) por debajo de la cual el píxel es "quieto"
MIN_BLOB = 20           # px; grupos estáticos más pequeños se ignoran en el listado


def sample_frames(path, n, width):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames = []
    for i in np.linspace(0, total - 1, n).astype(int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, f = cap.read()
        if not ok:
            continue
        h = int(round(width * f.shape[0] / f.shape[1]))
        frames.append(cv2.resize(f, (width, h), interpolation=cv2.INTER_AREA))
    cap.release()
    return frames


def check(frames, analyzer=analyzers.get("ocean_flow")):
    hsv = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2HSV) for f in frames])
    mask = np.stack([analyzer.mask(Frame(f, cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), x))
                     for f, x in zip(frames, hsv)])
    temp = np.stack([temperature_index(x) for x in hsv])
    persist = mask.mean(0)
    static = (persist >= MIN_PERSIST) & (hsv[..., 2].astype(np.float32).std(0) < MAX_STD_V)
    return mask, temp, persist, static


def report(mask, temp, static):
    h = mask.shape[1]
    print(f"{'región':<12}{'cobertura':>10}{'estático/máscara':>18}{'índice estáticos':>18}{'índice resto':>14}")
    for (name, _, _), (r0, r1) in zip(BANDS, band_rows(h)):
        m, s, t = mask[:, r0:r1], static[r0:r1], temp[:, r0:r1]
        ms = m & s[None]
        frac = ms.sum() / max(m.sum(), 1)
        ts = f"{t[ms].mean():.3f}" if ms.any() else "-"
        tr = f"{t[m & ~s[None]].mean():.3f}" if (m & ~s[None]).any() else "-"
        print(f"{name:<12}{m.mean():>10.3f}{frac:>17.2%}{ts:>18}{tr:>14}")
    n, _, stats, _ = cv2.connectedComponentsWithStats(static.astype(np.uint8), connectivity=8)
    blobs = sorted((st for st in stats[1:] if st[4] >= MIN_BLOB), key=lambda st: -st[4])
    print(f"grupos estáticos >= {MIN_BLOB} px: {len(blobs)}")
    for x, y, w, hh, area in blobs[:8]:
        lat0, lat1 = 90 - y / h * 180, 90 - (y + hh) / h * 180
        print(f"  x={x}..{x + w} y={y}..{y + hh} ({area} px)  lat {lat0:+.0f}..{lat1:+.0f}")


def overlay(frame, persist, static):
    h, w = persist.shape
    vis = np.zeros((h, w, 3), np.uint8)
    vis[..., 1] = (persist * 200).astype(np.uint8)
    vis[static] = (255, 0, 255)
    for r0, _ in band_rows(h)[1:]:
        cv2.line(vis, (0, r0), (w, r0), (255, 255, 255), 1)
        cv2.line(frame, (0, r0), (w, r0), (255, 255, 255), 1)
    for (name, _, _), (r0, r1) in zip(BANDS, band_rows(h)):
        cv2.putText(vis, name, (4, (r0 + r1) // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)
    return np.hstack([frame, vis])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out", help="prefijo de salida (sin extensión)")
    ap.add_argument("--analyzer", default="ocean_flow", choices=sorted(analyzers.ANALYZERS))
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--width", type=int, default=512)
    a = ap.parse_args()
    frames = sample_frames(a.video, a.samples, a.width)
    mask, temp, persist, static = check(frames, analyzers.get(a.analyzer))
    print(f"{len(frames)} frames de muestra a {frames[0].shape[1]}x{frames[0].shape[0]}")
    report(mask, temp, static)
    cv2.imwrite(a.out + "_mask.png", overlay(frames[len(frames) // 2].copy(), persist, static))
    print(f"OK: {a.out}_mask.png")


if __name__ == "__main__":
    main()
