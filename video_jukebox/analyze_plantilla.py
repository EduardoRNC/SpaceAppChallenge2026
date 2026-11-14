"""
PLANTILLA para analizar un video NUEVO (luces nocturnas, CO2, viento, hielo...).

Copia este archivo (p. ej. analyze_luces.py) y cambia SOLO la función `medir()`.
Lo demás (leer el video, dividir en franjas de latitud, guardar) ya está hecho.

El resultado es un features.npz con el mismo formato que analyze.py:
cada medida es una matriz (frames, franjas). Así compose.py puede leerlo.

Uso:
    python analyze_plantilla.py video.mp4 features_nuevo.npz
"""
import argparse
import cv2
import numpy as np

# Mismas franjas que analyze.py (mapa equirectangular: arriba = 90N)
BANDS = [("artico", 90, 60), ("norte_medio", 60, 23), ("tropicos", 23, -23),
         ("sur_medio", -23, -60), ("antartico", -60, -90)]


def medir(frame_bgr, prev_bgr, hsv, gray, prev_gray):
    """Devuelve un dict {nombre: mapa (alto, ancho)} con lo que quieras medir por píxel,
    y una máscara de píxeles válidos. CAMBIA ESTO según el tipo de video.

    Ejemplos ya listos (borra los que no necesites):
      brillo   -> luces nocturnas: cuánta luz hay
      nuevas   -> luces que aparecen (brillo que sube respecto al frame anterior)
      color    -> índice de color 0..1 (azul=0, rojo=1), útil para temperatura / CO2
      cambio   -> cuánto cambia la imagen (cualquier cosa que se mueva o aparezca)
    """
    v = hsv[..., 2].astype(np.float32) / 255
    h = hsv[..., 0].astype(np.float32)
    s = hsv[..., 1].astype(np.float32) / 255
    color = np.clip(1 - np.where(h > 150, 0, h) / 120, 0, 1)
    diff = (gray.astype(np.float32) - prev_gray.astype(np.float32)) / 255
    medidas = {
        "brillo": v,
        "nuevas": np.clip(diff, 0, None) * (v > 0.6),
        "color": color,
        "cambio": np.abs(diff),
    }
    # Máscara: qué píxeles cuentan. Aquí: todo lo que no sea gris (tierra/fondo).
    # Para luces nocturnas probablemente quieras todo: mascara = np.ones_like(v, bool)
    mascara = (s > 0.25) | (v > 0.6)
    return medidas, mascara


def band_rows(h):
    return [(int(round((90 - t) / 180 * h)), int(round((90 - b) / 180 * h))) for _, t, b in BANDS]


def analyze(path, width=512):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ok, frame = cap.read()
    if not ok:
        raise SystemExit("No se pudo leer el video")
    height = int(round(width * frame.shape[0] / frame.shape[1]))
    rows = band_rows(height)
    prev = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    out = {}
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        f = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        medidas, mascara = medir(f, prev, hsv, gray, prev_gray)
        medidas["cover"] = mascara.astype(np.float32)
        for k, m in medidas.items():
            fila = []
            for r0, r1 in rows:
                mk = mascara[r0:r1] if k != "cover" else np.ones_like(mascara[r0:r1])
                fila.append(m[r0:r1][mk].mean() if mk.any() else 0.0)
            out.setdefault(k, []).append(fila)
        prev, prev_gray = f, gray
    cap.release()
    res = {k: np.array(v, np.float32) for k, v in out.items()}
    res["fps"] = np.float32(fps)
    res["bands"] = np.array([b[0] for b in BANDS])
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=512)
    a = ap.parse_args()
    r = analyze(a.video, a.width)
    np.savez(a.out, **r)
    claves = [k for k in r if k not in ("fps", "bands")]
    print(f"OK: {r[claves[0]].shape[0]} frames x {len(r['bands'])} franjas, medidas: {claves} -> {a.out}")
