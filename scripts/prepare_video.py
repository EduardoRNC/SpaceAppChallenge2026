"""Descarga la NASA Climate Spiral (SVS 5190) y genera la versión para la web.

Uso:  python scripts/prepare_video.py

- Original (2160×2160, 60 fps, 30 s, ~20 MB): data/media/ (no se sube a git)
- Versión web (1080×1080, 60 fps, ~6.6 MB):   web/public/media/climate_spiral_es.mp4

Calibración medida a ojo sobre los frames (ver docs/PROCESS.md):
  0 s → 1880-01 · 0.1597 s por año · ~23.45 s → fin de 2026-10 · 23.7–30 s → giro al cono 3D
"""

import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
SRC_URL = (
    "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005190/"
    "GISTEMP_Spiral_Spanish_degC_2160p60.mp4"
)
ORIGINAL = ROOT / "data" / "media" / "GISTEMP_Spiral_Spanish_degC_2160p60.mp4"
WEB = ROOT / "web" / "public" / "media" / "climate_spiral_es.mp4"


def main() -> None:
    ORIGINAL.parent.mkdir(parents=True, exist_ok=True)
    if not ORIGINAL.exists():
        req = Request(SRC_URL, headers={"User-Agent": "earth-jukebox-data-fetch/0.1"})
        with urlopen(req, timeout=120) as resp:
            ORIGINAL.write_bytes(resp.read())
        print(f"Descargado {ORIGINAL.relative_to(ROOT)}")

    WEB.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", str(ORIGINAL),
            "-vf", "scale=1080:1080",
            "-c:v", "libx264", "-preset", "slow", "-crf", "24",
            "-g", "30",  # un keyframe cada 0.5 s, para saltar rápido al sincronizar
            "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
            str(WEB),
        ],
        check=True,
    )
    print(f"Generado {WEB.relative_to(ROOT)} ({WEB.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
