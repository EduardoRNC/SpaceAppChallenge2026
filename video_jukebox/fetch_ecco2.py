"""
Descarga la visualización oficial ECCO2 del NASA SVS (ID 3912) para validar el jukebox.

  Página:   https://svs.gsfc.nasa.gov/3912/  "Global Sea Surface Currents and Temperature"
  Crédito:  NASA/Goddard Space Flight Center Scientific Visualization Studio
            (Greg Shirah, Horace Mitchell, Eric Sokolowsky; ciencia: Hong Zhang, Dimitris Menemenlis)
  Modelo:   ECCO2 (MIT/JPL), corrientes superficiales coloreadas por temperatura,
            2007-03-25T12:00Z .. 2008-03-03T12:00Z
  Licencia: el contenido del SVS es de dominio público salvo indicación contraria
            (https://svs.gsfc.nasa.gov/help/). Hay que acreditar a NASA y no sugerir su respaldo.

Archivos (en data/media/ecco2/, no se suben a git):
  ecco2_sst_flow.mp4     2048x1024, 30 fps, 2001 frames, sin textos ni barra de color
  flat_ecco2_dates.txt   fecha del modelo de cada frame
  sst_ecco2_cbar.png     barra de color oficial (azul 0 °C ... rojo 32 °C)
  con --control: flat_global_ecco2_2028x1024_comp_p30.mp4, la misma animación CON barra
                 de color incrustada (control positivo para mask_check.py)

Uso:
    python fetch_ecco2.py [--control]
"""
import argparse
import hashlib
import shutil
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "data" / "media" / "ecco2"
BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003912/"

# nombre -> tamaño en bytes publicado por el servidor (comprobación de descarga completa)
FILES = {
    "ecco2_sst_flow.mp4": 256_266_335,
    "flat_ecco2_dates.txt": None,
    "sst_ecco2_cbar.png": None,
}
CONTROL = {"flat_global_ecco2_2028x1024_comp_p30.mp4": 292_128_033}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download(url, dest, size=None):
    if dest.exists() and (size is None or dest.stat().st_size == size):
        return
    part = dest.with_suffix(dest.suffix + ".part")
    req = Request(url, headers={"User-Agent": "earth-jukebox-data-fetch/0.1"})
    with urlopen(req, timeout=180) as resp, open(part, "wb") as f:
        shutil.copyfileobj(resp, f, 1 << 20)
    if size is not None and part.stat().st_size != size:
        raise SystemExit(f"{dest.name}: {part.stat().st_size} bytes, se esperaban {size}")
    part.rename(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--control", action="store_true", help="descargar también la versión con barra de color")
    a = ap.parse_args()
    DEST.mkdir(parents=True, exist_ok=True)
    for name, size in {**FILES, **(CONTROL if a.control else {})}.items():
        path = DEST / name
        download(BASE + name, path, size)
        print(f"{name}  {path.stat().st_size:>11,} bytes  sha256 {sha256(path)}")


if __name__ == "__main__":
    main()
