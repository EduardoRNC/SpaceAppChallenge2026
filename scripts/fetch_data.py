"""Descarga los datos originales a data/raw/.

Uso:  python scripts/fetch_data.py

Los CSV descargados se guardan en el repositorio. Así, los tests y la web
trabajan siempre con la misma copia de los datos, aunque la fuente se
actualice cada mes.
"""

import time
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"

NSIDC_MONTHLY = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_{:02d}_extent_v4.0.csv"

SOURCES = {
    # NASA GISS — GISTEMP v4, medias globales tierra-océano (anomalía en °C, base 1951–1980)
    "GLB.Ts+dSST.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
    # NOAA GML — CO₂ mensual en Mauna Loa (ppm), desde marzo de 1958
    "co2_mm_mlo.csv": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv",
    # NSIDC Sea Ice Index v4 (G02135) — extensión mensual del hielo ártico (millones de km²), un archivo por mes
    **{f"N_{m:02d}_extent_v4.0.csv": NSIDC_MONTHLY.format(m) for m in range(1, 13)},
}


def download(url: str, dest: Path, attempts: int = 4) -> int:
    """Descarga con reintentos: los servidores de datos a veces responden 500 un momento."""
    req = Request(url, headers={"User-Agent": "earth-jukebox-data-fetch/0.1"})
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(req, timeout=60) as resp:
                data = resp.read()
            break
        except (HTTPError, URLError) as err:
            if attempt == attempts:
                raise
            print(f"  reintento {attempt} para {dest.name} ({err})")
            time.sleep(2 * attempt)
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
