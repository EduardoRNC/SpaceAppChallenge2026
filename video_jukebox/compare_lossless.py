"""
Experimento: flujo óptico sobre el MP4 frente a los frames TIFF originales SIN compresión del SVS.

Si una variación del movimiento aparece en el MP4 pero no en el TIFF, la ha introducido el
códec; si aparece en ambos, es de la animación. Las dos fuentes pasan por el mismo
redimensionado, máscara, franjas y Farneback que analyze.py, en los mismos frames.

  TIFF:  https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003912/frames/2048x1024_1x1_30p/orig/
         flat_global_ecco2_2028x1024.<n>.tif  (RGB 8 bit, sin compresión; <n> = 1a columna
         de flat_ecco2_dates.txt, línea i = frame i del MP4)

Métricas por región, para pasos de 1 y N frames:
  ruido         error medio del vector de flujo MP4 frente a TIFF (EPE) relativo al TIFF
  coherencia    |media del flujo| / media de |flujo| en ventanas 9x9 (1 = vectores alineados)
  continuidad   correlación vectorial del campo entre pares consecutivos; autocorrelación
                a 1 frame y rugosidad de la serie de la región; ratio en fotogramas clave
  dirección     u, v medias y correlación de la serie de u entre fuentes
  variabilidad  desviación típica temporal de speed y correlación de speed entre fuentes

Salida en <out>/: metrics.json, REPORT.md, series.png, fields.png, regions.png

Uso:
    python compare_lossless.py MP4 DATES TIFF_DIR OUT [--start 960 --count 97] [--download]
                               [--width 512] [--stride 6]
"""
import argparse
import json
import shutil
from pathlib import Path
from urllib.request import Request, urlopen

import cv2
import numpy as np

from analyze import BANDS, MIN_PIXELS, band_rows, ocean_mask, temperature_index, vorticity
from flow_experiment import FARNEBACK, autocorr1, keyframes, roughness, touches_key

TIFF_URL = ("https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003912/frames/2048x1024_1x1_30p/orig/"
            "flat_global_ecco2_2028x1024.{}.tif")
NAMES = [b[0] for b in BANDS]


def frame_numbers(dates):
    return [int(line.split()[0]) for line in open(dates) if line.strip()]


def fetch(numbers, tif_dir):
    tif_dir.mkdir(parents=True, exist_ok=True)
    for k, n in enumerate(numbers):
        dest = tif_dir / f"{n}.tif"
        if dest.exists():
            continue
        part = dest.with_suffix(".part")
        req = Request(TIFF_URL.format(n), headers={"User-Agent": "earth-jukebox-data-fetch/0.1"})
        with urlopen(req, timeout=120) as r, open(part, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
        part.rename(dest)
        if (k + 1) % 20 == 0:
            print(f"  {k + 1}/{len(numbers)} TIFF")


def read_mp4(path, start, count):
    cap = cv2.VideoCapture(path)
    out, i = [], 0
    while len(out) < count:
        ok, f = cap.read()
        if not ok:
            break
        if i >= start:
            out.append(f)
        i += 1
    cap.release()
    return out


def psnr(a, b):
    mse = np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2)
    return float(10 * np.log10(255 ** 2 / mse)) if mse > 0 else float("inf")


def video_levels(f):
    """Rango limitado de video (16-235) aplicado a un frame RGB de rango completo."""
    return np.clip(16 + f.astype(np.float32) * 219 / 255, 0, 255).round().astype(np.uint8)


def pcorr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum()))


def frame_types(path):
    import subprocess
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                          "frame=pict_type", "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return [x.strip(",")[0] for x in out.stdout.split()]


def alignment(tg, mg, max_d=3):
    """Correlación media entre las diferencias temporales del TIFF (k) y del MP4 (k + d)."""
    dt = [tg[k + 1] - tg[k] for k in range(len(tg) - 1)]
    dm = [mg[k + 1] - mg[k] for k in range(len(mg) - 1)]
    ks = range(max_d, len(dt) - max_d)
    return {d: float(np.mean([pcorr(dt[k], dm[k + d]) for k in ks])) for d in range(-max_d, max_d + 1)}


def prep(frames, width):
    h = int(round(width * frames[0].shape[0] / frames[0].shape[1]))
    small = [cv2.resize(f, (width, h), interpolation=cv2.INTER_AREA) for f in frames]
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in small]
    hsv = [cv2.cvtColor(f, cv2.COLOR_BGR2HSV) for f in small]
    return gray, [ocean_mask(x) for x in hsv], [temperature_index(x) for x in hsv]


def flows(gray, stride):
    """Lista alineada con los frames: flujo (frame k-stride -> k) / stride, o None."""
    return [None if k < stride else
            cv2.calcOpticalFlowFarneback(gray[k - stride], gray[k], None, **FARNEBACK) / stride
            for k in range(len(gray))]


def coherence(flow, m):
    box = lambda x: cv2.blur(x, (9, 9))
    mag = np.linalg.norm(flow, axis=2)
    res = np.hypot(box(flow[..., 0]), box(flow[..., 1]))
    den = box(mag)
    ok = m & (den > 1e-6)
    return float((res[ok] / den[ok]).mean()) if ok.any() else np.nan


def vcorr(a, b, m):
    """Correlación vectorial (sin centrar) de dos campos dentro de la máscara."""
    a, b = a[m], b[m]
    den = np.sqrt((a ** 2).sum() * (b ** 2).sum())
    return float((a * b).sum() / den) if den > 0 else np.nan


def per_band(fl, masks, temps, rows, ref=None):
    """Series por frame y región (NaN donde no hay flujo o faltan píxeles)."""
    n, nb = len(fl), len(rows)
    keys = ("speed", "u", "v", "vort", "temp", "coh", "cont", "epe", "vc_ref")
    out = {k: np.full((n, nb), np.nan) for k in keys}
    for k in range(n):
        f = fl[k]
        for b, (r0, r1) in enumerate(rows):
            m = masks[k][r0:r1]
            if m.sum() < MIN_PIXELS:
                continue
            out["temp"][k, b] = temps[k][r0:r1][m].mean()
            if f is None:
                continue
            fb = f[r0:r1]
            out["speed"][k, b] = np.linalg.norm(fb, axis=2)[m].mean()
            out["u"][k, b] = fb[..., 0][m].mean()
            out["v"][k, b] = -fb[..., 1][m].mean()
            out["vort"][k, b] = np.abs(vorticity(f))[r0:r1][m].mean()
            out["coh"][k, b] = coherence(fb, m)
            if k + 1 < n and fl[k + 1] is not None:
                out["cont"][k, b] = vcorr(fb, fl[k + 1][r0:r1], m)
            if ref is not None and ref[k] is not None:
                rb = ref[k][r0:r1]
                err = np.linalg.norm(fb - rb, axis=2)[m].mean()
                out["epe"][k, b] = err / max(np.linalg.norm(rb, axis=2)[m].mean(), 1e-9)
                out["vc_ref"][k, b] = vcorr(fb, rb, m)
    return out


def corr(a, b):
    ok = ~np.isnan(a) & ~np.isnan(b)
    return float(np.corrcoef(a[ok], b[ok])[0, 1]) if ok.sum() > 2 else np.nan


def summarize(s, touch):
    g = np.nanmean(s["speed"], 1)
    ok = ~np.isnan(g)
    return dict(
        autocorr1=autocorr1(g), rugosidad=roughness(g),
        ratio_I=float(np.nanmean(g[touch & ok]) / np.nanmean(g[~touch & ok])),
        speed=float(np.nanmean(g)),
        region={name: dict(
            speed=float(np.nanmean(s["speed"][:, b])), speed_std=float(np.nanstd(s["speed"][:, b])),
            autocorr1=autocorr1(s["speed"][:, b]), u=float(np.nanmean(s["u"][:, b])),
            v=float(np.nanmean(s["v"][:, b])), vort=float(np.nanmean(s["vort"][:, b])),
            coherencia=float(np.nanmean(s["coh"][:, b])), continuidad=float(np.nanmean(s["cont"][:, b])),
            epe_rel=float(np.nanmean(s["epe"][:, b])) if not np.all(np.isnan(s["epe"][:, b])) else None,
            vcorr_tiff=float(np.nanmean(s["vc_ref"][:, b])) if not np.all(np.isnan(s["vc_ref"][:, b])) else None,
        ) for b, name in enumerate(NAMES)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("dates")
    ap.add_argument("tif_dir")
    ap.add_argument("out")
    ap.add_argument("--start", type=int, default=960)
    ap.add_argument("--count", type=int, default=97)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--stride", type=int, default=6)
    ap.add_argument("--download", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tif_dir = Path(a.tif_dir)

    numbers = frame_numbers(a.dates)[a.start:a.start + a.count]
    if a.download:
        fetch(numbers, tif_dir)
    tif = [cv2.imread(str(tif_dir / f"{n}.tif")) for n in numbers]
    mp4 = read_mp4(a.mp4, a.start, a.count)
    assert len(tif) == len(mp4) == a.count and all(t is not None for t in tif)
    print(f"{a.count} frames ({a.start}..{a.start + a.count - 1}), TIFF {tif[0].shape[1]}x{tif[0].shape[0]}")

    mid = a.count // 2
    levels = {c: [float(v) for v in np.polyfit(tif[mid][..., i].ravel().astype(np.float32),
                                               mp4[mid][..., i].ravel().astype(np.float32), 1)]
              for i, c in enumerate("BGR")}
    psnr_all = [psnr(m, t) for m, t in zip(mp4, tif)]
    psnr_lv = [psnr(m, video_levels(t)) for m, t in zip(mp4, tif)]

    key = keyframes(a.mp4)[a.start:a.start + a.count]
    types = frame_types(a.mp4)[a.start:a.start + a.count]
    res, series, fields = {}, {}, {}
    T = {}
    for src, frames in (("tiff", tif), ("mp4", mp4), ("tiff_niveles", [video_levels(t) for t in tif])):
        T[src] = prep(frames, a.width)
    del tif, mp4
    rows = band_rows(T["tiff"][0][0].shape[0])

    tg = [g.astype(np.float32) for g in T["tiff"][0]]
    mg = [g.astype(np.float32) for g in T["mp4"][0]]
    align = alignment(tg, mg)
    print("alineación (corr. de diferencias temporales TIFF[k] vs MP4[k+d]):",
          {d: round(v, 3) for d, v in align.items()})
    ratio = [float(np.abs(mg[k] - mg[k - 1]).mean() / np.abs(tg[k] - tg[k - 1]).mean()) for k in range(1, a.count)]
    change_by_type = {t: float(np.mean([r for r, tt in zip(ratio, types[1:]) if tt == t]))
                      for t in sorted(set(types[1:]))}

    def mask_temp(src):
        iou = np.mean([(x & y).sum() / max((x | y).sum(), 1) for x, y in zip(T["tiff"][1], T[src][1])])
        cov = [float(np.mean([m[r0:r1].mean() for m in T[src][1]])) for r0, r1 in rows]
        tmp = [float(np.nanmean([t[r0:r1][m[r0:r1]].mean() for t, m in zip(T[src][2], T[src][1])]))
               for r0, r1 in rows]
        return dict(iou_con_tiff=float(iou), cover=dict(zip(NAMES, cov)), temp=dict(zip(NAMES, tmp)))
    color = {src: mask_temp(src) for src in ("tiff", "tiff_niveles", "mp4")}

    for stride in (1, a.stride):
        ft = flows(T["tiff"][0], stride)
        fm = flows(T["mp4"][0], stride)
        st = per_band(ft, *T["tiff"][1:], rows)
        sm = per_band(fm, *T["mp4"][1:], rows, ref=ft)
        touch = np.concatenate([[False], touches_key(key, a.count - 1, stride)])
        res[f"s{stride}"] = dict(
            tiff=summarize(st, touch), mp4=summarize(sm, touch),
            entre_fuentes={name: dict(corr_speed=corr(st["speed"][:, b], sm["speed"][:, b]),
                                      corr_u=corr(st["u"][:, b], sm["u"][:, b]),
                                      corr_vort=corr(st["vort"][:, b], sm["vort"][:, b]),
                                      temp_dif=float(np.nanmean(np.abs(st["temp"][:, b] - sm["temp"][:, b]))))
                           for b, name in enumerate(NAMES)})
        series[stride] = (st, sm)
        mid = a.count // 2 + 3
        fields[stride] = (ft[mid], fm[mid], mid)

    dates = open(a.dates).read().split("\n")
    meta = dict(start=a.start, count=a.count, width=a.width, stride=a.stride,
                dates=[dates[a.start].split()[1], dates[a.start + a.count - 1].split()[1]],
                keyframes=[int(a.start + i) for i in np.where(key)[0]],
                psnr_mp4_tiff=dict(media=float(np.mean(psnr_all)), min=float(np.min(psnr_all)),
                                   max=float(np.max(psnr_all)),
                                   en_clave=float(np.mean([p for p, k in zip(psnr_all, key) if k])),
                                   resto=float(np.mean([p for p, k in zip(psnr_all, key) if not k])),
                                   con_niveles=float(np.mean(psnr_lv))),
                niveles_mp4_vs_tiff={c: dict(pendiente=v[0], offset=v[1]) for c, v in levels.items()},
                alineacion=align, cambio_mp4_vs_tiff_por_tipo=change_by_type, color=color)
    json.dump(dict(meta=meta, **res), open(out / "metrics.json", "w"), indent=1, ensure_ascii=False)
    plots(series, fields, key, a, out)
    report(meta, res, a, out)
    print(f"OK: {out}/REPORT.md, metrics.json, series.png, fields.png, regions.png")


def plots(series, fields, key, a, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t = np.arange(a.count)
    kf = np.where(key)[0]

    fig, axes = plt.subplots(len(NAMES), 2, figsize=(14, 11), sharex=True)
    for col, stride in enumerate(series):
        st, sm = series[stride]
        for b, name in enumerate(NAMES):
            ax = axes[b, col]
            ax.plot(t, sm["speed"][:, b], color="tab:red", lw=1, label="MP4")
            ax.plot(t, st["speed"][:, b], color="tab:blue", lw=1.3, label="TIFF sin compresión")
            for k in kf:
                ax.axvline(k, color="0.7", lw=0.8, ls=":")
            ax.set_ylabel(f"{name}\npx/frame", fontsize=8)
            ax.grid(alpha=0.3)
        axes[0, col].set_title(f"Movimiento aparente, paso {stride} frame(s) (líneas punteadas: fotogramas clave)",
                               fontsize=9)
    axes[0, 0].legend(fontsize=8)
    for ax in axes[-1]:
        ax.set_xlabel(f"frame del segmento (+{a.start})")
    fig.tight_layout()
    fig.savefig(out / "series.png", dpi=100)
    plt.close(fig)

    ft, fm, mid = fields[1]
    mt, mm = np.linalg.norm(ft, axis=2), np.linalg.norm(fm, axis=2)
    vmax = np.percentile(mt, 99)
    fig, axes = plt.subplots(3, 1, figsize=(10, 11))
    for ax, img, title in zip(axes, (mt, mm, np.linalg.norm(fm - ft, axis=2)),
                              ("TIFF sin compresión", "MP4", "|MP4 − TIFF| (error del vector)")):
        im = ax.imshow(img, cmap="magma", vmin=0, vmax=vmax)
        ax.set_title(f"|flujo| paso 1, frame {a.start + mid}: {title}", fontsize=9)
        ax.axis("off")
        fig.colorbar(im, ax=ax, fraction=0.025, label="px/frame")
    fig.tight_layout()
    fig.savefig(out / "fields.png", dpi=100)
    plt.close(fig)

    m = json.load(open(out / "metrics.json"))
    fig, axes = plt.subplots(1, 4, figsize=(16, 4))
    x = np.arange(len(NAMES))
    for ax, (key_, label) in zip(axes, (("autocorr1", "autocorr. 1 frame de speed"),
                                        ("coherencia", "coherencia espacial (0..1)"),
                                        ("continuidad", "continuidad del campo (0..1)"),
                                        ("speed", "speed media (px/frame)"))):
        for j, (var, src, col) in enumerate((("s1", "tiff", "tab:blue"), ("s1", "mp4", "tab:red"),
                                             (f"s{a.stride}", "tiff", "lightsteelblue"),
                                             (f"s{a.stride}", "mp4", "lightsalmon"))):
            vals = [m[var][src]["region"][n][key_] for n in NAMES]
            ax.bar(x + (j - 1.5) * 0.2, vals, 0.2, color=col, label=f"{src.upper()} {var}")
        ax.set_xticks(x, NAMES, rotation=30, fontsize=8)
        ax.set_title(label, fontsize=9)
        ax.axhline(0, color="k", lw=0.6)
        ax.grid(alpha=0.3, axis="y")
    axes[0].legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(out / "regions.png", dpi=100)
    plt.close(fig)


def report(meta, res, a, out):
    p = meta["psnr_mp4_tiff"]
    al = ", ".join(f"{d:+d}: {v:.3f}" for d, v in meta["alineacion"].items())
    lv = ", ".join(f"{c} {v['pendiente']:.3f}·x{v['offset']:+.1f}" for c, v in meta["niveles_mp4_vs_tiff"].items())
    ch = ", ".join(f"{t}: {v:.2f}" for t, v in meta["cambio_mp4_vs_tiff_por_tipo"].items())
    L = [f"# Flujo óptico: MP4 frente a TIFF sin compresión (SVS 3912)\n",
         f"Frames {meta['start']}–{meta['start'] + meta['count'] - 1} ({meta['dates'][0]} → {meta['dates'][1]}), "
         f"{a.width} px de ancho, fotogramas clave del MP4 en {meta['keyframes']}.\n",
         "Las magnitudes son proxies visuales en px/frame, no velocidades físicas.\n",
         "## Correspondencia entre fuentes\n",
         f"- Alineación (correlación de diferencias temporales TIFF[k] frente a MP4[k+d]): {al}.",
         f"- Niveles MP4 ≈ pendiente·TIFF + offset: {lv} (rango limitado de video: 0.859·x+16).",
         f"- PSNR MP4 frente a TIFF: {p['media']:.2f} dB (fotogramas clave {p['en_clave']:.2f}, resto {p['resto']:.2f}); "
         f"frente a TIFF con niveles de video: {p['con_niveles']:.2f} dB.",
         f"- Cambio entre frames del MP4 / del TIFF según el tipo del frame MP4: {ch}.\n",
         "| fuente | IoU máscara con TIFF | " + " | ".join(f"cover {n}" for n in NAMES) + " | "
         + " | ".join(f"índice {n}" for n in NAMES) + " |",
         "|---" * (2 + 2 * len(NAMES)) + "|"]
    for src, c in meta["color"].items():
        L.append(f"| {src} | {c['iou_con_tiff']:.3f} | " + " | ".join(f"{c['cover'][n]:.3f}" for n in NAMES)
                 + " | " + " | ".join(f"{c['temp'][n]:.3f}" for n in NAMES) + " |")
    for var, r in res.items():
        L.append(f"\n## Paso {var[1:]}\n")
        L.append("| fuente | autocorr. 1 | rugosidad | ratio fotogramas clave | speed media |\n|---|---|---|---|---|")
        for src in ("tiff", "mp4"):
            s = r[src]
            L.append(f"| {src.upper()} | {s['autocorr1']:.2f} | {s['rugosidad']:.2f} | {s['ratio_I']:.2f} | {s['speed']:.4f} |")
        L.append("\n| región | speed TIFF / MP4 | autocorr. TIFF / MP4 | coherencia TIFF / MP4 | continuidad TIFF / MP4 "
                 "| u TIFF / MP4 | EPE rel. MP4 | corr. vectorial MP4–TIFF | corr. speed | corr. u | corr. vort | Δ índice color |")
        L.append("|---" * 12 + "|")
        for n in NAMES:
            t, m, e = r["tiff"]["region"][n], r["mp4"]["region"][n], r["entre_fuentes"][n]
            L.append(f"| {n} | {t['speed']:.4f} / {m['speed']:.4f} | {t['autocorr1']:.2f} / {m['autocorr1']:.2f} | "
                     f"{t['coherencia']:.2f} / {m['coherencia']:.2f} | {t['continuidad']:.2f} / {m['continuidad']:.2f} | "
                     f"{t['u']:+.4f} / {m['u']:+.4f} | {m['epe_rel']:.2f} | {m['vcorr_tiff']:.2f} | "
                     f"{e['corr_speed']:.2f} | {e['corr_u']:.2f} | {e['corr_vort']:.2f} | {e['temp_dif']:.4f} |")
    L.append("\nFiguras: `series.png`, `fields.png`, `regions.png`. Datos: `metrics.json`.\n")
    (out / "REPORT.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
