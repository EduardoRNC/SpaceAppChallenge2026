"""Convierte los CSV de data/raw/ en pistas JSON para la web.

Uso:  python scripts/build_tracks.py

Salida: web/public/data/temperature.json, con el esquema común de pista que
usa el motor de sonido (ver README).
"""

import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "web" / "public" / "data"

GISTEMP_CSV = RAW_DIR / "GLB.Ts+dSST.csv"
GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def parse_gistemp(path: Path = GISTEMP_CSV) -> pd.DataFrame:
    """Lee el CSV de GISTEMP. La línea 1 es un título y `***` marca un dato faltante."""
    return pd.read_csv(path, skiprows=1, na_values="***")


def monthly_series(df: pd.DataFrame) -> list[dict]:
    """Serie mensual ordenada: [{"t": "1880-01", "v": -0.19}, ...], sin meses faltantes."""
    long = df.melt(id_vars="Year", value_vars=MONTHS, var_name="month", value_name="v")
    long["m"] = long["month"].map({name: i + 1 for i, name in enumerate(MONTHS)})
    long = long.dropna(subset=["v"]).sort_values(["Year", "m"])
    return [
        {"t": f"{int(y)}-{int(m):02d}", "v": round(float(v), 2)}
        for y, m, v in zip(long["Year"], long["m"], long["v"])
    ]


def annual_series(df: pd.DataFrame) -> list[dict]:
    """Media anual (columna J-D). Solo incluye los años completos."""
    annual = df[["Year", "J-D"]].dropna()
    return [{"year": int(y), "v": round(float(v), 2)} for y, v in annual.values]


def record_years(annual: list[dict]) -> list[int]:
    """Años cuya media anual supera a todas las anteriores. El primer año no cuenta."""
    records, best = [], annual[0]["v"]
    for row in annual[1:]:
        if row["v"] > best:
            records.append(row["year"])
            best = row["v"]
    return records


def padded_range(values: list[float], step: float = 0.1) -> list[float]:
    """Rango [mín, máx] redondeado hacia fuera a múltiplos de `step`."""
    lo = math.floor(min(values) / step) * step
    hi = math.ceil(max(values) / step) * step
    return [round(lo, 2), round(hi, 2)]


def build_temperature_track(df: pd.DataFrame, retrieved: str) -> dict:
    series = monthly_series(df)
    annual = annual_series(df)
    first, last = series[0]["t"], series[-1]["t"]
    return {
        "id": "temperature",
        "title": "Temperatura global, 1880–hoy",
        "unit": "°C",
        "baseline": 0.0,
        "baselineLabel": "media 1951–1980",
        "range": padded_range([p["v"] for p in series]),
        "series": series,
        "annual": annual,
        "records": record_years(annual),
        # Calibración de la Climate Spiral (SVS 5190), medida sobre los frames.
        # Ver scripts/prepare_video.py y docs/PROCESS.md.
        "video": {
            "src": "media/climate_spiral_es.mp4",
            "tStart": 0.0,  # segundo del vídeo en el que empieza 1880-01
            "secondsPerYear": 0.1597,  # 144 años en 23.0 s (1880 → 2024)
            "tDataEnd": 23.45,  # fin de 2026-10; después, pausa y giro al cono 3D
            "duration": 30.0,
            "credit": "NASA Scientific Visualization Studio — Climate Spiral 1880–Present (SVS 5190)",
        },
        "description": (
            "Anomalía mensual de la temperatura global de la superficie, de tierra y océano, "
            f"desde {first} hasta {last}, respecto a la media de 1951–1980. "
            "Es la misma serie de datos que dibuja la visualización NASA Climate Spiral."
        ),
        "source": {
            "name": "NASA GISS Surface Temperature Analysis (GISTEMP v4)",
            "url": GISTEMP_URL,
            "visualization": "https://svs.gsfc.nasa.gov/5190/",
            "retrieved": retrieved,
        },
    }


def main() -> None:
    retrieved_file = RAW_DIR / "RETRIEVED.txt"
    retrieved = retrieved_file.read_text().strip() if retrieved_file.exists() else "desconocida"
    track = build_temperature_track(parse_gistemp(), retrieved)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "temperature.json"
    out.write_text(json.dumps(track, ensure_ascii=False, separators=(",", ":")))
    print(
        f"Escrito {out.relative_to(ROOT)}: {len(track['series'])} meses "
        f"({track['series'][0]['t']} → {track['series'][-1]['t']}), "
        f"rango {track['range']}, {len(track['records'])} años récord"
    )


if __name__ == "__main__":
    main()
