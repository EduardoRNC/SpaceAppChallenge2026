"""Descarga los datos originales a data/raw/.

Uso:  python scripts/fetch_data.py

Los CSV descargados se guardan en el repositorio. Así, los tests y la web
trabajan siempre con la misma copia de los datos, aunque la fuente se
actualice cada mes.
"""

from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"

SOURCES = {
    # NASA GISS — GISTEMP v4, medias globales tierra-océano (anomalía en °C, base 1951–1980)
    "GLB.Ts+dSST.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
}


def download(url: str, dest: Path) -> int:
    req = Request(url, headers={"User-Agent": "earth-jukebox-data-fetch/0.1"})
    with urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return len(data)


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        size = download(url, RAW_DIR / name)
        print(f"Descargado {name} ({size:,} bytes) desde {url}")
    # Fecha de descarga: build_tracks.py la incluye en el JSON como "retrieved".
    (RAW_DIR / "RETRIEVED.txt").write_text(date.today().isoformat() + "\n")


if __name__ == "__main__":
    main()
