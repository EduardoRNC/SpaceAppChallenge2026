"""Mide el color de la espiral en los fotogramas del vídeo y lo valida contra GISTEMP.

Uso:  python scripts/frame_features.py

Para cada año toma el fotograma en el que el año acaba de dibujarse y lo compara
con el del año anterior. Los píxeles que se iluminan son la vuelta nueva de la
espiral, y se mide su "calidez" según la paleta de la visualización:
azul → blanco (cerca de la media) → salmón → rojo → granate.

  calidez = signo(R − B) · (255 − G) / 255

El verde baja siempre al alejarse del blanco, hacia el azul o hacia el rojo. El
signo de R − B indica el lado. Así la medida crece de forma monótona del azul al
granate. La "rojez" simple (R − B) se saturaba al oscurecerse el rojo después
del año 2000.

Salidas:
  data/frame_features.csv  — año, calidez, píxeles nuevos (lo usa build_tracks.py)
  docs/validation.png      — calidez de los píxeles frente a la anomalía GISTEMP
"""

import csv
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT / "web" / "public" / "media" / "climate_spiral_es.mp4"
TRACK = ROOT / "web" / "public" / "data" / "temperature.json"
OUT_CSV = ROOT / "data" / "frame_features.csv"
OUT_PNG = ROOT / "docs" / "validation.png"

SIZE = 540  # resolución de análisis (el vídeo web es de 1080)
FPS = 60
# Anillo donde se dibuja la espiral, como fracción del ancho. Excluye la etiqueta
# del año (centro) y los nombres de los meses (borde).
R_MIN, R_MAX = 0.17, 0.47
BRIGHTEN = 30  # aumento mínimo de luminancia para considerar un píxel "nuevo"


def ring_mask(size: int) -> np.ndarray:
    yy, xx = np.mgrid[0:size, 0:size]
    r = np.hypot(xx - size / 2, yy - size / 2) / size
    return (r >= R_MIN) & (r <= R_MAX)


def read_frames(path: Path, indices: set[int]) -> dict[int, np.ndarray]:
    """Decodifica el vídeo con ffmpeg y conserva solo los fotogramas pedidos."""
    last = max(indices)
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(path), "-frames:v", str(last + 1),
         "-vf", f"scale={SIZE}:{SIZE}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    frame_bytes = SIZE * SIZE * 3
    frames = {}
    for i in range(last + 1):
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        if i in indices:
            frames[i] = np.frombuffer(buf, np.uint8).reshape(SIZE, SIZE, 3).astype(np.int16)
    proc.stdout.close()
    proc.wait()
    return frames


def measure(track: dict) -> list[dict]:
    video = track["video"]
    years = sorted({int(p["t"][:4]) for p in track["series"]})
    # Fotograma en el que termina cada año (índice i → fin del año i).
    end_frame = {
        i: min(round((video["tStart"] + (i + 1) * video["secondsPerYear"]) * FPS),
               round(video["tDataEnd"] * FPS))
        for i in range(len(years))
    }
    start_frame = {i: (end_frame[i - 1] if i > 0 else 0) for i in end_frame}
    frames = read_frames(VIDEO, set(end_frame.values()) | set(start_frame.values()))

    ring = ring_mask(SIZE)
    rows = []
    for i, year in enumerate(years):
        new, old = frames[end_frame[i]], frames[start_frame[i]]
        lum_gain = new.mean(axis=2) - old.mean(axis=2)
        mask = ring & (lum_gain > BRIGHTEN)
        n = int(mask.sum())
        if n == 0:
            rows.append({"year": year, "warmth": None, "pixels": 0})
            continue
        r, g, b = (new[..., c][mask] for c in range(3))
        warmth = np.sign(r - b) * (255 - g) / 255
        rows.append({"year": year, "warmth": round(float(warmth.mean()), 4), "pixels": n})
    return rows


def annual_means(track: dict) -> dict[int, float]:
    by_year: dict[int, list[float]] = {}
    for p in track["series"]:
        by_year.setdefault(int(p["t"][:4]), []).append(p["v"])
    return {y: sum(v) / len(v) for y, v in by_year.items()}


def plot(rows: list[dict], means: dict[int, float], r: float, fit: tuple[float, float]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    valid = [row for row in rows if row["warmth"] is not None]
    years = [row["year"] for row in valid]
    red = np.array([row["warmth"] for row in valid])
    temp = np.array([means[y] for y in years])
    slope, intercept = fit

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.6))
    ax1.plot(years, temp, color="#222", lw=1.6, label="GISTEMP (datos)")
    ax1.plot(years, slope * red + intercept, color="#d6604d", lw=1.2, alpha=0.9,
             label="Estimado desde el color de los píxeles")
    ax1.axhline(0, color="#4daf4a", lw=0.8, ls="--")
    ax1.set_title("Lo que se ve y lo que se oye cuentan lo mismo")
    ax1.set_xlabel("Año")
    ax1.set_ylabel("Anomalía (°C, vs 1951–1980)")
    ax1.legend(loc="upper left", fontsize=9)

    sc = ax2.scatter(red, temp, c=years, cmap="coolwarm", s=16)
    xs = np.linspace(red.min(), red.max(), 50)
    ax2.plot(xs, slope * xs + intercept, color="#333", lw=1)
    ax2.set_title(f"Calidez de la vuelta nueva vs anomalía (r = {r:.2f})")
    ax2.set_xlabel("Calidez de los píxeles nuevos (azul −1 … granate +1)")
    ax2.set_ylabel("Anomalía anual (°C)")
    fig.colorbar(sc, ax=ax2, label="Año")
    fig.tight_layout()
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, dpi=130)


def main() -> None:
    track = json.loads(TRACK.read_text())
    rows = measure(track)
    means = annual_means(track)

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["year", "warmth", "pixels"])
        writer.writeheader()
        writer.writerows(rows)

    valid = [row for row in rows if row["warmth"] is not None]
    red = np.array([row["warmth"] for row in valid])
    temp = np.array([means[row["year"]] for row in valid])
    r = float(np.corrcoef(red, temp)[0, 1])
    slope, intercept = np.polyfit(red, temp, 1)
    plot(rows, means, r, (slope, intercept))

    print(f"Años medidos: {len(valid)}/{len(rows)}  ·  correlación calidez–anomalía r = {r:.3f}")
    print(f"Escrito {OUT_CSV.relative_to(ROOT)} y {OUT_PNG.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
