"""
Gráficos diagnósticos de un timeline.json: lo que mide el video frente a lo que toca la música.

  <out>.png           4 paneles de proxies visuales por región (índice de color, movimiento,
                      turbulencia, cobertura) + piano-roll de las notas con los acordes,
                      todo contra el tiempo del video (y la fecha del modelo si se da --dates)
  <out>_colormap.png  (con --colorbar) índice 'temp' frente a la barra de color oficial

Los ejes dicen "índice" o "px/frame": son proxies derivados de píxeles, no mediciones calibradas.

Uso:
    python diagnostics.py out/x_timeline.json out/x_diag [--dates flat_ecco2_dates.txt]
                          [--colorbar sst_ecco2_cbar.png --cbar-range 0 32]
"""
import argparse
import json
from datetime import datetime

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from analyzers.common import hue_index as temperature_index  # noqa: E402

CH_PALETTE = ["tab:red", "tab:blue", "tab:purple", "tab:brown"]


def panels(tl, n=4):
    """Las primeras medidas del timeline (sin 'v'/'u' si sobran) y siempre 'cover' al final."""
    metrics = tl["features"]["metrics"]
    keys = [k for k in metrics if k != "cover"]
    if len(keys) > n - 1:
        keys = [k for k in keys if k not in ("u", "v")] or keys
    keys = keys[: n - 1] + ["cover"]
    return [(k, f"{metrics[k]['label']}\n({metrics[k]['unit']}, proxy)") for k in keys]


def ch_colors(tl):
    return {c["id"]: CH_PALETTE[i % len(CH_PALETTE)] for i, c in enumerate(tl["channels"])}


def load_dates(path):
    """Fechas por frame (p. ej. flat_ecco2_dates.txt): '<frame>  <fecha ISO>' por línea."""
    out = []
    for line in open(path):
        parts = line.split()
        if len(parts) >= 2:
            out.append(datetime.strptime(parts[1], "%Y-%m-%dT%H:%MZ"))
    return out


def series(tl, metric, region):
    return np.array([np.nan if x is None else x for x in tl["features"]["metrics"][metric]["by_region"][region]])


def plot_timeline(tl, out, dates=None):
    PANELS, CH_COLORS = panels(tl), ch_colors(tl)
    t = np.array(tl["features"]["t"])
    regions = [r["id"] for r in tl["regions"]]
    fig, axes = plt.subplots(len(PANELS) + 1, 1, figsize=(13, 13), sharex=True,
                             gridspec_kw=dict(height_ratios=[1] * len(PANELS) + [1.4]))
    for ax, (metric, label) in zip(axes, PANELS):
        for r in regions:
            ax.plot(t, series(tl, metric, r), lw=0.9, label=r)
        ax.set_ylabel(label, fontsize=9)
        ax.grid(alpha=0.3)
    axes[0].legend(ncol=5, fontsize=8, loc="upper center", bbox_to_anchor=(0.5, 1.32))

    ax = axes[-1]
    for n in tl["notes"]:
        ax.plot([n["t"], n["t"] + n["dur"]], [n["note"]] * 2, color=CH_COLORS.get(n["track"], "k"),
                lw=2.2, alpha=0.75, solid_capstyle="butt")
    for c in tl["chords"]:
        ax.axvline(c["t"], color="0.8", lw=0.6, zorder=0)
        ax.text(c["t"] + 0.05, 1.0, c["name"], transform=ax.get_xaxis_transform(),
                fontsize=7, va="top", rotation=90, color="0.35")
    end = tl["timing"]["music_duration_s"]
    ax.axvline(end, color="k", ls="--", lw=0.8)
    ax.text(end, 0.02, " fin música", transform=ax.get_xaxis_transform(), fontsize=7)
    for k, col in CH_COLORS.items():
        ax.plot([], [], color=col, lw=3, label=k)
    ax.legend(ncol=4, fontsize=8, loc="lower left")
    ax.set_ylabel("Nota MIDI", fontsize=9)
    ax.set_xlabel("Tiempo del video (s)")
    ax.grid(alpha=0.3)

    tm = tl["timing"]
    title = (f"{tl['source'].get('video', '')}  |  {tm['frames']} frames a {tm['fps']:g} fps, "
             f"{tm['bpm']:g} BPM ({tm['frames_per_beat']} frames/beat)  |  proxies visuales, no calibrados")
    if dates:
        offset = tm["frame_offset"]
        idx = [int(round(x * tm["fps"])) for x in axes[0].get_xticks()]
        top = axes[0].secondary_xaxis("top")
        top.set_xticks([x for x, i in zip(axes[0].get_xticks(), idx) if 0 <= i < len(dates)])
        top.set_xticklabels([dates[i].strftime("%Y-%m-%d") for i in idx if 0 <= i < len(dates)], fontsize=8)
        top.set_xlabel(f"Fecha del modelo (fila i = frame i+{offset})", fontsize=8)
    fig.suptitle(title, fontsize=10, y=0.995)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)


def colorbar_index(path, vmin, vmax):
    """Columna a columna de la barra oficial: (°C según la etiqueta, índice 'temp' de analyze.py)."""
    img = cv2.imread(path)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1] > 100
    rows = np.where(sat.mean(1) > 0.5)[0]
    cols = np.where(sat[rows].mean(0) > 0.5)[0]
    band = hsv[rows.min() + 2:rows.max() - 1, cols.min() + 1:cols.max()]
    idx = temperature_index(band).mean(0)
    deg = np.linspace(vmin, vmax, len(idx))
    return deg, idx


def plot_colormap(path, out, vmin, vmax):
    deg, idx = colorbar_index(path, vmin, vmax)
    dev = np.abs(idx - (deg - vmin) / (vmax - vmin)).max()
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(deg, idx, lw=2)
    ax.plot([vmin, vmax], [0, 1], "k:", lw=1, label="relación lineal (referencia)")
    ax.set_xlabel("Temperatura indicada por la barra oficial (°C)")
    ax.set_ylabel("Índice 'temp' de analyze.py")
    ax.set_title(f"Índice frente a la barra oficial: monótono, desviación máx. {dev:.2f} de lo lineal\n"
                 "(inversión aproximada de la paleta, no medición)", fontsize=10)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return deg, idx, dev


def summary(tl, dates=None):
    PANELS = panels(tl)
    regions = [r["id"] for r in tl["regions"]]
    fps, offset = tl["timing"]["fps"], tl["timing"]["frame_offset"]
    print(f"{'región':<12}" + "".join(f"{m:>22}" for m, _ in PANELS))
    for r in regions:
        cells = []
        for m, _ in PANELS:
            s = series(tl, m, r)
            cells.append(f"{np.nanmean(s):7.3f} [{np.nanmin(s):6.3f},{np.nanmax(s):6.3f}]")
        print(f"{r:<12}" + "".join(f"{c:>22}" for c in cells))
    if dates and "temp" in tl["features"]["metrics"]:
        k = int(fps * 2)
        for r in ("norte_medio", "sur_medio"):
            s = np.convolve(series(tl, "temp", r), np.ones(k) / k, mode="valid")
            hi, lo = int(np.argmax(s)) + k // 2 + offset, int(np.argmin(s)) + k // 2 + offset
            if hi < len(dates) and lo < len(dates):
                print(f"índice de color '{r}' (media móvil 2 s): máximo {dates[hi]:%Y-%m-%d}, "
                      f"mínimo {dates[lo]:%Y-%m-%d}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("timeline")
    ap.add_argument("out", help="prefijo de salida (sin extensión)")
    ap.add_argument("--dates", default=None)
    ap.add_argument("--colorbar", default=None)
    ap.add_argument("--cbar-range", type=float, nargs=2, default=(0.0, 32.0))
    a = ap.parse_args()
    tl = json.load(open(a.timeline))
    dates = load_dates(a.dates) if a.dates else None
    plot_timeline(tl, a.out + ".png", dates)
    print(f"OK: {a.out}.png")
    if a.colorbar:
        deg, idx, dev = plot_colormap(a.colorbar, a.out + "_colormap.png", *a.cbar_range)
        marks = ", ".join(f"{v:.2f}≈{np.interp(v, idx, deg):.0f} °C" for v in (0.25, 0.5, 0.75, 0.9))
        print(f"OK: {a.out}_colormap.png  (índice según la paleta: {marks}; desviación máx. {dev:.3f})")
    summary(tl, dates)


if __name__ == "__main__":
    main()
