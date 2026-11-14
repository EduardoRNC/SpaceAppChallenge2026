"""
Experimento: ¿cuánto del "movimiento" medido es flujo de la visualización y cuánto ruido del códec?

Compara cuatro variantes del flujo óptico de analyze.py (mismos parámetros Farneback y máscara):

  s1        frames consecutivos (lo que hace analyze.py)
  s1-gop    igual, sin los pares que tocan un fotograma clave (I) del H.264
  sN        flujo entre frames separados N (por defecto 6), dividido por N -> px/frame
  sN-gop    igual, sin los pares que contienen un fotograma clave

Métricas (sobre la media de las 5 regiones y por región):
  autocorr1   autocorrelación a 1 frame: ruido alterno < 0, señal suave cerca de 1
  rugosidad   std(diferencias) / std(serie): ruido blanco ≈ 1.41, señal suave ≈ 0
  ratio_I     media en pares con fotograma clave / media en el resto (1 = sin efecto del códec)
  u_tropicos  componente este-oeste media en trópicos y % de frames hacia el oeste
              (las corrientes ecuatoriales superficiales van mayoritariamente al oeste)

Uso:
    python flow_experiment.py video.mp4 [--stride 6] [--width 512] [--features x_features.npz]
                              [--plot out/x_flow.png]
"""
import argparse
import subprocess
from collections import deque

import cv2
import numpy as np

from analyze import BANDS, MIN_PIXELS, band_rows, ocean_mask

FARNEBACK = dict(pyr_scale=0.5, levels=3, winsize=9, iterations=3, poly_n=5, poly_sigma=1.1, flags=0)


def keyframes(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                          "frame=key_frame", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout.split()
    return np.array([int(x.strip(",")) for x in out], bool)


def band_means(flow, mask, rows):
    mag = np.linalg.norm(flow, axis=2)
    speed, u = np.full(len(rows), np.nan), np.full(len(rows), np.nan)
    for b, (r0, r1) in enumerate(rows):
        m = mask[r0:r1]
        if m.sum() >= MIN_PIXELS:
            speed[b] = mag[r0:r1][m].mean()
            u[b] = flow[r0:r1, :, 0][m].mean()
    return speed, u


def measure(path, stride, width):
    cap = cv2.VideoCapture(path)
    grays = deque(maxlen=stride + 1)
    s1, sn, u1, un = [], [], [], []
    rows = None
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if rows is None:
            height = int(round(width * f.shape[0] / f.shape[1]))
            rows = band_rows(height)
        f = cv2.resize(f, (width, height), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        mask = ocean_mask(cv2.cvtColor(f, cv2.COLOR_BGR2HSV))
        grays.append(gray)
        if len(grays) >= 2:
            sp, u = band_means(cv2.calcOpticalFlowFarneback(grays[-2], gray, None, **FARNEBACK), mask, rows)
            s1.append(sp); u1.append(u)
            if len(grays) == stride + 1:
                fl = cv2.calcOpticalFlowFarneback(grays[0], gray, None, **FARNEBACK) / stride
                sp, u = band_means(fl, mask, rows)
            else:
                sp = u = np.full(len(rows), np.nan)
            sn.append(sp); un.append(u)
    cap.release()
    return map(np.array, (s1, u1, sn, un))      # (frames-1, bandas); fila i = par que termina en frame i+1


def touches_key(key, n_rows, stride):
    """Fila i (par que termina en el frame i+1) contiene un fotograma clave en [i+1-stride, i+1]."""
    c = np.concatenate([[0], np.cumsum(key)])
    end = np.arange(n_rows) + 1
    start = np.maximum(end - stride, 0)
    return (c[end + 1] - c[start]) > 0


def autocorr1(x):
    x = x - np.nanmean(x)
    a, b = x[:-1], x[1:]
    ok = ~np.isnan(a) & ~np.isnan(b)
    return float(np.corrcoef(a[ok], b[ok])[0, 1])


def roughness(x):
    d = np.diff(x)
    return float(np.nanstd(d) / np.nanstd(x))


def metrics(speed, u, touch, drop):
    s = speed.copy()
    if drop:
        s[touch] = np.nan
    g = np.nanmean(s, 1) if not np.all(np.isnan(s)) else s[:, 0]
    raw = np.nanmean(speed, 1)
    ok = ~np.isnan(raw)
    ratio = np.nanmean(raw[touch & ok]) / np.nanmean(raw[~touch & ok])
    ut = u[:, 2].copy()
    if drop:
        ut[touch] = np.nan
    return dict(autocorr1=autocorr1(g), rugosidad=roughness(g), ratio_I=float(ratio),
                speed_media=float(np.nanmean(g)), u_tropicos=float(np.nanmean(ut)),
                oeste=float(np.nanmean(ut[~np.isnan(ut)] < 0)), validas=float(np.mean(~np.isnan(g))),
                por_region=[float(np.nanmean(s[:, b])) for b in range(s.shape[1])],
                serie=g)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--stride", type=int, default=6)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--features", default=None, help="features.npz de analyze.py para comprobar que s1 coincide")
    ap.add_argument("--plot", default=None)
    a = ap.parse_args()

    key = keyframes(a.video)
    s1, u1, sn, un = measure(a.video, a.stride, a.width)
    n = len(s1)
    gop = np.diff(np.where(key)[0])
    print(f"{n + 1} frames, {key.sum()} fotogramas clave (cada {np.unique(gop).tolist()} frames), paso N = {a.stride}")
    if a.features:
        ref = np.load(a.features)["speed"]
        same = ref.shape == s1.shape and np.allclose(np.nan_to_num(s1), ref, atol=1e-5)
        print(f"s1 coincide con {a.features}: {same}")

    t1, tn = touches_key(key, n, 1), touches_key(key, n, a.stride)
    variants = {
        "s1": metrics(s1, u1, t1, False),
        "s1-gop": metrics(s1, u1, t1, True),
        f"s{a.stride}": metrics(sn, un, tn, False),
        f"s{a.stride}-gop": metrics(sn, un, tn, True),
    }
    print(f"\n{'variante':<10}{'autocorr1':>10}{'rugosidad':>10}{'ratio_I':>9}{'speed':>9}"
          f"{'u_tróp':>9}{'%oeste':>8}{'válidas':>9}")
    for k, m in variants.items():
        print(f"{k:<10}{m['autocorr1']:>10.2f}{m['rugosidad']:>10.2f}{m['ratio_I']:>9.2f}"
              f"{m['speed_media']:>9.4f}{m['u_tropicos']:>+9.4f}{m['oeste']:>8.0%}{m['validas']:>9.0%}")
    print(f"\nspeed media por región (px/frame): {', '.join(b[0] for b in BANDS)}")
    for k, m in variants.items():
        print(f"{k:<10}" + "".join(f"{x:>9.4f}" for x in m["por_region"]))

    if a.plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(len(variants), 1, figsize=(12, 9), sharex=True)
        t = (np.arange(n) + 1) / (cv2.VideoCapture(a.video).get(cv2.CAP_PROP_FPS) or 30.0)
        for ax, (k, m) in zip(axes, variants.items()):
            ax.plot(t, m["serie"], lw=0.7)
            ax.set_ylabel(f"{k}\npx/frame", fontsize=8)
            ax.set_title(f"autocorr1 {m['autocorr1']:.2f} · rugosidad {m['rugosidad']:.2f} · "
                         f"ratio_I {m['ratio_I']:.2f}", fontsize=8, loc="left")
            ax.grid(alpha=0.3)
        axes[-1].set_xlabel("Tiempo del video (s)")
        fig.suptitle("Movimiento aparente medio de las 5 regiones (proxy visual, no m/s)", fontsize=10)
        fig.tight_layout()
        fig.savefig(a.plot, dpi=110)
        print(f"OK: {a.plot}")


if __name__ == "__main__":
    main()
