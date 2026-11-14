"""
Earth Information Jukebox - Analizador de video de corrientes oceánicas + temperatura.

Lee un video tipo NASA ECCO2 (mapa equirectangular, tierra gris, océano con
líneas de corriente coloreadas de azul=frío a rojo=cálido) y extrae, frame a
frame y por franja de latitud:

  temp   : índice de temperatura 0..1 (a partir del tono/hue del color)
  speed  : velocidad media del flujo (flujo óptico, píxeles/frame)
  u, v   : componente media este-oeste y norte-sur del flujo
  vort   : vorticidad media absoluta (remolinos / turbulencia)
  cover  : fracción de píxeles de océano válidos en la franja

Uso:
    python analyze.py video.mp4 features.npz [--width 512]
"""
import argparse
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


def band_rows(h):
    rows = []
    for _, top, bot in BANDS:
        r0 = int(round((90 - top) / 180 * h))
        r1 = int(round((90 - bot) / 180 * h))
        rows.append((r0, r1))
    return rows


def ocean_mask(hsv):
    """Píxeles de corriente: coloreados (saturados) y no demasiado oscuros.
    La tierra es gris (saturación baja), así que queda fuera."""
    s, v = hsv[..., 1], hsv[..., 2]
    return (s > 70) & (v > 50)


def temperature_index(hsv):
    """Hue de OpenCV (0-180): rojo≈0, amarillo≈30, verde≈60, azul≈120.
    Lo convertimos a 0 (frío/azul) .. 1 (cálido/rojo)."""
    h = hsv[..., 0].astype(np.float32)
    h = np.where(h > 150, 0, h)          # rojos que dan la vuelta (≈170-180) -> 0
    return np.clip(1.0 - h / 120.0, 0, 1)


def vorticity(flow):
    """Rotacional del campo de flujo: dv/dx - du/dy."""
    u, v = flow[..., 0], flow[..., 1]
    dv_dx = cv2.Sobel(v, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    du_dy = cv2.Sobel(u, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    return dv_dx - du_dy


def analyze(path, width=512):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ok, frame = cap.read()
    if not ok:
        raise SystemExit("No se pudo leer el video")
    h0, w0 = frame.shape[:2]
    height = int(round(width * h0 / w0))
    rows = band_rows(height)

    def prep(f):
        f = cv2.resize(f, (width, height), interpolation=cv2.INTER_AREA)
        return f, cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), cv2.cvtColor(f, cv2.COLOR_BGR2HSV)

    _, prev_gray, _ = prep(frame)
    nb = len(BANDS)
    out = {k: [] for k in ("temp", "speed", "u", "v", "vort", "cover")}

    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        _, gray, hsv = prep(frame)
        flow = cv2.calcOpticalFlowFarneback(prev_gray, gray, None,
                                            pyr_scale=0.5, levels=3, winsize=9,
                                            iterations=3, poly_n=5, poly_sigma=1.1,
                                            flags=0)
        mask = ocean_mask(hsv)
        temp = temperature_index(hsv)
        mag = np.linalg.norm(flow, axis=2)
        vort = np.abs(vorticity(flow))

        rec = {k: np.zeros(nb, np.float32) for k in out}
        for b, (r0, r1) in enumerate(rows):
            m = mask[r0:r1]
            cnt = int(m.sum())
            rec["cover"][b] = cnt / m.size
            if cnt < MIN_PIXELS:
                continue
            rec["temp"][b] = temp[r0:r1][m].mean()
            rec["speed"][b] = mag[r0:r1][m].mean()
            rec["u"][b] = flow[r0:r1, :, 0][m].mean()
            rec["v"][b] = -flow[r0:r1, :, 1][m].mean()   # +v = hacia el norte
            rec["vort"][b] = vort[r0:r1][m].mean()
        for k in out:
            out[k].append(rec[k])
        prev_gray = gray
        n += 1
        if n % 250 == 0:
            print(f"  {n} frames...")

    cap.release()
    res = {k: np.stack(v) for k, v in out.items()}       # (frames, bands)
    res["fps"] = np.float32(fps)
    res["bands"] = np.array([b[0] for b in BANDS])
    res["band_pixels"] = np.array([(r1 - r0) * width for r0, r1 in rows], np.int32)
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=512)
    a = ap.parse_args()
    r = analyze(a.video, a.width)
    np.savez(a.out, **r)
    print(f"OK: {r['temp'].shape[0]} frames x {r['temp'].shape[1]} franjas -> {a.out}")
