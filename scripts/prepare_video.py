"""Descarga las visualizaciones del SVS y genera las versiones para la web.

Uso:  python scripts/prepare_video.py

Originales en data/media/ (no se suben a git); versiones web en web/public/media/.

  Temperatura — NASA Climate Spiral (SVS 5190), español °C, 2160×2160, 30 s
      → climate_spiral_es.mp4 (1080×1080).
      Calibración: 0 s = 1880-01 · 0.1597 s/año · 23.45 s = fin de 2026-10.
  CO₂ — OCO-2 and Keeling Curve (SVS 5119), 1920×1080, 30 s
      → co2_keeling_curve.jpg: el ÚLTIMO fotograma (curva completa 1958–mar 2023).
      El vídeo no avanza en orden cronológico, así que se usa como imagen fija con cursor.
  Hielo — Annual Arctic Sea Ice Minimum Area 1979–2024 (SVS 5395), 1920×1080, 46 s
      → arctic_sea_ice_min.mp4 (1280×720).
      Calibración: 4.45 s = 1979 · 0.789 s/año · 40.3 s = fin de 2024.

Ver docs/PROCESS.md para el método de calibración de cada una.
"""

import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "data" / "media"
WEB = ROOT / "web" / "public" / "media"
SVS = "https://svs.gsfc.nasa.gov/vis/a000000/"

VISUALS = [
    {
        "url": SVS + "a005100/a005190/GISTEMP_Spiral_Spanish_degC_2160p60.mp4",
        "out": "climate_spiral_es.mp4",
        "ffmpeg": ["-vf", "scale=1080:1080", "-c:v", "libx264", "-preset", "slow", "-crf", "24",
                   "-g", "30", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"],
    },
    {
        "url": SVS + "a005100/a005119/OCO2_KeelingCurve_1920x1080p30.mp4",
        "out": "co2_keeling_curve.jpg",
        "input": ["-sseof", "-0.1"],  # último fotograma
        "ffmpeg": ["-frames:v", "1", "-q:v", "3"],
    },
    {
        "url": SVS + "a005300/a005395/sea_ice_min_SSMI_2024_1080p30.mp4",
        "out": "arctic_sea_ice_min.mp4",
        "ffmpeg": ["-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "slow", "-crf", "28",
                   "-g", "15", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"],
    },
]


def download(url: str, dest: Path) -> None:
    if dest.exists():
        return
    req = Request(url, headers={"User-Agent": "earth-jukebox-data-fetch/0.1"})
    with urlopen(req, timeout=180) as resp:
        dest.write_bytes(resp.read())
    print(f"Descargado {dest.relative_to(ROOT)}")


def main() -> None:
    MEDIA.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    for visual in VISUALS:
        original = MEDIA / visual["url"].rsplit("/", 1)[1]
        download(visual["url"], original)
        out = WEB / visual["out"]
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", *visual.get("input", []), "-i", str(original),
             *visual["ffmpeg"], str(out)],
            check=True,
        )
        print(f"Generado {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
