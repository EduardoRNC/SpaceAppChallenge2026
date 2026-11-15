"""
Lo que comparten todos los analizadores: las franjas de latitud y el bucle sobre los frames.

Un analizador solo tiene que decir QUÉ medir en cada frame (una función `measure`) y
describir sus medidas (METRICS). Este módulo lee el video, lo reduce a `width` píxeles de
ancho, llama a `measure` con cada frame y promedia cada medida dentro de cada franja,
solo sobre los píxeles válidos de la máscara.

Contrato de `measure(cur, prev) -> (mapas, máscara)`:
  cur, prev  Frame con .bgr, .gray y .hsv (prev es el frame anterior; el primero solo se
             usa como 'prev', igual que necesita el flujo óptico).
  mapas      dict nombre -> matriz (alto, ancho) con el valor por píxel.
  máscara    matriz bool (alto, ancho): qué píxeles cuentan.

Salida (features.npz): cada medida es (frames, 5 franjas); además 'cover' (fracción de
píxeles válidos por franja), 'fps', 'bands', 'band_pixels' y 'analyzer'.
"""
from dataclasses import dataclass

import cv2
import numpy as np

# Franjas de latitud (grados, de norte a sur). Mapa equirectangular: fila 0 = 90N.
BANDS = [
    ("artico",       90,  60),
    ("norte_medio",  60,  23),
    ("tropicos",     23, -23),
    ("sur_medio",   -23, -60),
    ("antartico",   -60, -90),
]

# Por debajo de este número de píxeles válidos la franja se deja a 0 (sin dato).
MIN_PIXELS = 50


@dataclass
class Frame:
    bgr: np.ndarray
    gray: np.ndarray
    hsv: np.ndarray


def band_rows(h):
    rows = []
    for _, top, bot in BANDS:
        r0 = int(round((90 - top) / 180 * h))
        r1 = int(round((90 - bot) / 180 * h))
        rows.append((r0, r1))
    return rows


def hue_index(hsv):
    """Hue de OpenCV (0-180): rojo≈0, amarillo≈30, verde≈60, azul≈120.
    Lo convertimos a 0 (frío/azul) .. 1 (cálido/rojo)."""
    h = hsv[..., 0].astype(np.float32)
    h = np.where(h > 150, 0, h)          # rojos que dan la vuelta (≈170-180) -> 0
    return np.clip(1.0 - h / 120.0, 0, 1)


def analyze_video(path, analyzer, width=512, progress=True):
    """Recorre el video y devuelve el dict que se guarda en features.npz."""
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ok, frame = cap.read()
    if not ok:
        raise SystemExit(f"No se pudo leer el video: {path}")
    h0, w0 = frame.shape[:2]
    height = int(round(width * h0 / w0))
    rows = band_rows(height)

    def prep(f):
        f = cv2.resize(f, (width, height), interpolation=cv2.INTER_AREA)
        return Frame(f, cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), cv2.cvtColor(f, cv2.COLOR_BGR2HSV))

    prev = prep(frame)
    nb = len(BANDS)
    keys = [k for k in analyzer.METRICS if k != "cover"]
    out = {k: [] for k in keys + ["cover"]}

    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cur = prep(frame)
        maps, mask = analyzer.measure(cur, prev)
        rec = {k: np.zeros(nb, np.float32) for k in out}
        for b, (r0, r1) in enumerate(rows):
            m = mask[r0:r1]
            cnt = int(m.sum())
            rec["cover"][b] = cnt / m.size
            if cnt < MIN_PIXELS:
                continue
            for k in keys:
                rec[k][b] = maps[k][r0:r1][m].mean()
        for k in out:
            out[k].append(rec[k])
        prev = cur
        n += 1
        if progress and n % 250 == 0:
            print(f"  {n} frames...")

    cap.release()
    if n == 0:
        raise SystemExit(f"El video tiene un solo frame: {path}")
    res = {k: np.stack(v) for k, v in out.items()}       # (frames, bands)
    res["fps"] = np.float32(fps)
    res["bands"] = np.array([b[0] for b in BANDS])
    res["band_pixels"] = np.array([(r1 - r0) * width for r0, r1 in rows], np.int32)
    res["analyzer"] = np.array(analyzer.NAME)
    return res
