"""Convierte los CSV de data/raw/ en pistas JSON para el jukebox.

Uso:  python scripts/build_tracks.py

Salidas (web/public/data/):
  temperature.json  — temperatura global (GISTEMP v4) + NASA Climate Spiral (SVS 5190)
  co2.json          — CO₂ en Mauna Loa (NOAA GML) + Keeling Curve (SVS 5119)
  sea_ice.json      — hielo marino ártico (NSIDC) + mínimo anual 1979–2024 (SVS 5395)
  tracks.json       — índice de pistas para el selector del jukebox

Esquema común de pista: ver README. Lo esencial para el sonido:
  baseline        valor que suena en la tónica (la nota del drone)
  range           rango del valor (tono: unas 3 octavas)
  sound.stressZero / sound.stressFull
                  traducen el valor a "estrés" en la escala de la temperatura
                  (0 → +1.4), para reutilizar los mismos umbrales de tensión en
                  todas las pistas. Si stressFull < stressZero, la tensión crece
                  cuando el valor BAJA (hielo).
"""

import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "web" / "public" / "data"

GISTEMP_CSV = RAW_DIR / "GLB.Ts+dSST.csv"
CO2_CSV = RAW_DIR / "co2_mm_mlo.csv"
NSIDC_CSV = RAW_DIR / "N_{:02d}_extent_v4.0.csv"
FRAME_FEATURES_CSV = ROOT / "data" / "frame_features.csv"  # lo genera frame_features.py

GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
CO2_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv"
NSIDC_URL = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

CO2_MILESTONES = [325, 350, 375, 400, 425]  # ppm: la campanita marca cada hito cruzado


# --- Utilidades comunes ---------------------------------------------------------

def padded_range(values: list[float], step: float = 0.1) -> list[float]:
    """Rango [mín, máx] redondeado hacia fuera a múltiplos de `step`."""
    lo = math.floor(min(values) / step) * step
    hi = math.ceil(max(values) / step) * step
    return [round(lo, 2), round(hi, 2)]


def record_years(annual: list[dict], direction: int = 1) -> list[int]:
    """Años que baten el récord (máximo si direction=1, mínimo si -1). El primer año no cuenta."""
    records, best = [], annual[0]["v"] * direction
    for row in annual[1:]:
        if row["v"] * direction > best:
            records.append(row["year"])
            best = row["v"] * direction
    return records


def annual_from_series(series: list[dict], complete_only: bool = True) -> list[dict]:
    """Media anual a partir de la serie mensual."""
    by_year: dict[int, list[float]] = {}
    for p in series:
        by_year.setdefault(int(p["t"][:4]), []).append(p["v"])
    return [
        {"year": y, "v": round(sum(vs) / len(vs), 3)}
        for y, vs in sorted(by_year.items())
        if not complete_only or len(vs) == 12
    ]


def intro(texts: dict[str, str]) -> list[dict]:
    """Intro breve en inglés: una frase por capa, en orden fijo. Las capas sin texto se omiten."""
    order = ["reference", "pitch", "months", "pulse", "tension", "frames", "record", "ticks"]
    return [{"text": texts[k], "demo": k} for k in order if texts.get(k)]


# --- Temperatura (GISTEMP v4) ---------------------------------------------------

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


def frame_warmth(path: Path = FRAME_FEATURES_CSV) -> list[dict] | None:
    """Calidez de cada vuelta de la espiral, medida en los fotogramas del vídeo."""
    if not path.exists():
        return None
    df = pd.read_csv(path).dropna(subset=["warmth"])
    return [{"year": int(y), "w": round(float(w), 4)} for y, w in zip(df["year"], df["warmth"])]


def build_temperature_track(df: pd.DataFrame, retrieved: str) -> dict:
    series = monthly_series(df)
    annual = annual_series(df)
    first, last = series[0]["t"], series[-1]["t"]
    return {
        "id": "temperature",
        "label": "Temperatura global (1880–hoy)",
        "title": "Temperatura global, 1880–hoy",
        "unit": "°C",
        "baseline": 0.0,
        "baselineLabel": "media 1951–1980",
        "range": padded_range([p["v"] for p in series]),
        "sound": {"stressZero": 0.0, "stressFull": 1.4},
        "format": {"decimals": 2, "signed": True, "unit": "°C", "suffix": "respecto a la media de 1951–1980"},
        "series": series,
        "annual": annual,
        "records": record_years(annual),
        "compare": [1880, 2010],
        # Calibración de la Climate Spiral (SVS 5190), medida sobre los frames.
        # Ver scripts/prepare_video.py y docs/PROCESS.md.
        "video": {
            "type": "video",
            "src": "media/climate_spiral_es.mp4",
            "tStart": 0.0,  # segundo del vídeo en el que empieza 1880-01
            "secondsPerYear": 0.1597,  # 144 años en 23.0 s (1880 → 2024)
            "tDataEnd": 23.45,  # fin de 2026-10; después, pausa y giro al cono 3D
            "duration": 30.0,
            "aspect": "1 / 1",
            "credit": "NASA Scientific Visualization Studio — Climate Spiral 1880–Present (SVS 5190)",
            "description": (
                "Visualización: una espiral dibuja cada mes alrededor de un reloj de 12 meses. "
                "Los círculos marcan −1 °C, 0 °C (la media de 1951–1980, en verde) y +1 °C. Las "
                "vueltas azules (frías) se quedan dentro; desde los años 80 las vueltas rojas "
                "(calientes) se abren hacia fuera. Al final, la espiral se inclina y forma un "
                "cono que se ensancha hacia 2026."
            ),
        },
        # Color medido en los fotogramas (scripts/frame_features.py): controla la capa "frames".
        "frameWarmth": frame_warmth(),
        "legend": [
            ["Drone grave", "la referencia (media de 1951–1980). Crece cuanto más calor hace."],
            ["Melodía", "una nota por año. Cuanto más aguda, más caliente fue ese año."],
            ["Arpegio y ostinato de fondo", "los 12 meses de cada año, uno agudo y otro grave."],
            ["Latido", "un corazón que se acelera con la temperatura, de reposo a taquicardia."],
            ["Tensión", "pasados +0.5 °C la escala se vuelve menor. Desde +0.4 °C entra un roce "
                        "de segunda menor contra el drone, y desde +0.8 °C un tritono."],
            ["Tick", "empieza una década."],
            ["Campanita", "ese año batió el récord de calor."],
            ["Acorde agudo con trémolo", "sale del color de la espiral en el vídeo. Cuanto más "
                                         "rojo se dibuja cada vuelta, más fuerte suena y más rápido tiembla."],
        ],
        "intro": intro({
            "reference": "Low drone: the 1951 to 1980 average.",
            "pitch": "Melody: higher means warmer.",
            "months": "Quick notes: the twelve months.",
            "pulse": "Heartbeat: faster means hotter.",
            "tension": "Tense rub: extreme heat.",
            "frames": "Shimmer: the colour of the spiral.",
            "record": "Bell: a record hot year.",
            "ticks": "Tick: a new decade.",
        }),
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


# --- CO₂ (NOAA GML, Mauna Loa) ----------------------------------------------------

def parse_co2(path: Path = CO2_CSV) -> list[dict]:
    """Serie mensual de CO₂ (ppm). Las líneas con `#` son comentarios; negativos = faltante."""
    df = pd.read_csv(path, comment="#")
    df = df[df["average"] > 0]
    return [
        {"t": f"{int(y)}-{int(m):02d}", "v": round(float(v), 2)}
        for y, m, v in zip(df["year"], df["month"], df["average"])
    ]


def milestone_years(annual: list[dict], milestones: list[float]) -> list[int]:
    """Primer año cuya media anual supera cada hito."""
    years = []
    for level in milestones:
        hit = next((row["year"] for row in annual if row["v"] >= level), None)
        if hit is not None:
            years.append(hit)
    return years


def build_co2_track(retrieved: str) -> dict:
    series = parse_co2()
    annual = annual_from_series(series)
    first, last = series[0]["t"], series[-1]["t"]
    return {
        "id": "co2",
        "label": "CO₂ atmosférico (1958–hoy)",
        "title": "CO₂ atmosférico en Mauna Loa, 1958–hoy",
        "unit": "ppm",
        "baseline": 350.0,  # la tónica: 350 ppm, el nivel que se suele citar como "seguro"
        "baselineLabel": "350 ppm",
        "range": padded_range([p["v"] for p in series], step=5),
        "sound": {"stressZero": 315.0, "stressFull": 425.0},  # 1958 → ~2025
        "format": {"decimals": 1, "signed": False, "unit": "ppm", "suffix": ""},
        "series": series,
        "annual": annual,
        "records": milestone_years(annual, CO2_MILESTONES),
        "milestones": CO2_MILESTONES,
        "compare": [1960, 2010],
        # Último fotograma de la Keeling Curve (SVS 5119): la curva completa 1958–mar 2023.
        # El vídeo no avanza en orden cronológico (dibuja 2015–2023 y luego se aleja hasta 1958),
        # así que se usa la imagen fija con un cursor que avanza con el año que suena.
        # Marcas del eje medidas en píxeles sobre la imagen de 1920×1080.
        "video": {
            "type": "still",
            "src": "media/co2_keeling_curve.jpg",
            "width": 1920,
            "height": 1080,
            "ticks": [[1960, 259], [1970, 476.5], [1980, 715.5], [1990, 933],
                      [2000, 1150.5], [2010, 1389.5], [2020, 1607], [2023.17, 1676]],
            "plotTop": 160,
            "plotBottom": 963,
            "aspect": "16 / 9",
            "credit": "NASA Scientific Visualization Studio — OCO-2 and Keeling Curve (SVS 5119); datos NOAA",
            "description": (
                "Visualización: la curva de Keeling, la concentración de CO₂ medida en Mauna Loa desde "
                "1958 (puntos rojos) y por el satélite OCO-2 de NASA desde 2015 (azules). Sube "
                "sin parar de unos 315 a más de 420 ppm, con un zigzag anual: la vegetación del "
                "hemisferio norte absorbe CO₂ en verano y lo libera en invierno. Una línea vertical "
                "marca el año que está sonando."
            ),
        },
        "frameWarmth": None,
        "legend": [
            ["Drone grave", "la referencia: 350 ppm, el nivel que se suele citar como seguro."],
            ["Melodía", "una nota por año. Cuanto más aguda, más CO₂ hubo ese año."],
            ["Arpegio y ostinato de fondo", "los 12 meses: se oye el zigzag de las estaciones, "
                                            "la Tierra respirando."],
            ["Latido", "se acelera a medida que sube el CO₂."],
            ["Tensión", "al superar unos 350 ppm la escala se vuelve menor y entra un roce "
                        "disonante; hacia 380 ppm, un tritono."],
            ["Tick", "empieza una década."],
            ["Campanita", "el CO₂ cruza un nuevo hito: 325, 350, 375, 400 o 425 ppm."],
        ],
        "intro": intro({
            "reference": "Low drone: 350 parts per million, the safe level.",
            "pitch": "Melody: higher means more carbon dioxide.",
            "months": "Quick notes: the seasons breathing.",
            "pulse": "Heartbeat: faster means more CO2.",
            "tension": "Tense rub: far above the safe level.",
            "record": "Bell: a new milestone crossed.",
            "ticks": "Tick: a new decade.",
        }),
        "description": (
            f"Concentración mensual de CO₂ en el observatorio de Mauna Loa, de {first} a {last}, "
            "en partes por millón (ppm). Es la serie que dibuja la curva de Keeling."
        ),
        "source": {
            "name": "NOAA Global Monitoring Laboratory — Mauna Loa CO₂ monthly mean",
            "url": CO2_URL,
            "visualization": "https://svs.gsfc.nasa.gov/5119/",
            "retrieved": retrieved,
        },
    }


# --- Hielo marino ártico (NSIDC Sea Ice Index v4) --------------------------------

def parse_sea_ice(pattern: Path = NSIDC_CSV) -> pd.DataFrame:
    """Extensión mensual (millones de km²) de los 12 archivos mensuales. -9999 = faltante."""
    frames = []
    for m in range(1, 13):
        df = pd.read_csv(str(pattern).format(m), skipinitialspace=True)
        df.columns = [c.strip() for c in df.columns]
        frames.append(df[["year", "mo", "extent"]])
    df = pd.concat(frames)
    df = df[(df["extent"] > 0) & (df["year"] >= 1979)]
    return df.sort_values(["year", "mo"]).reset_index(drop=True)


def sea_ice_anomalies(df: pd.DataFrame) -> list[dict]:
    """Anomalía mensual respecto a la climatología 1981–2010 de cada mes."""
    clim = df[(df["year"] >= 1981) & (df["year"] <= 2010)].groupby("mo")["extent"].mean()
    return [
        {"t": f"{int(y)}-{int(m):02d}", "v": round(float(e - clim[m]), 3)}
        for y, m, e in zip(df["year"], df["mo"], df["extent"])
    ]


def build_sea_ice_track(retrieved: str) -> dict:
    series = sea_ice_anomalies(parse_sea_ice())
    annual = annual_from_series(series, complete_only=False)
    complete = annual_from_series(series)
    first, last = series[0]["t"], series[-1]["t"]
    return {
        "id": "sea_ice",
        "label": "Hielo marino ártico (1979–hoy)",
        "title": "Hielo marino ártico, 1979–hoy",
        "unit": "millones de km²",
        "baseline": 0.0,
        "baselineLabel": "media 1981–2010",
        "range": padded_range([p["v"] for p in series]),
        # La tensión crece cuando el hielo BAJA: 0 → −2 millones de km² equivale a 0 → +1.4 °C.
        "sound": {"stressZero": 0.0, "stressFull": -2.0},
        "format": {"decimals": 2, "signed": True, "unit": "millones de km²",
                   "suffix": "respecto a la media de 1981–2010"},
        "series": series,
        "annual": annual,
        "records": record_years(complete, direction=-1),
        "compare": [1980, 2010],
        # Calibración de "Annual Arctic Sea Ice Minimum Area 1979–2024" (SVS 5395), medida
        # siguiendo el punto rojo más a la derecha del gráfico en cada fotograma.
        "video": {
            "type": "video",
            "src": "media/arctic_sea_ice_min.mp4",
            "tStart": 4.45,  # aparece el punto de 1979
            "secondsPerYear": 0.789,  # 45 años (1979 → 2024) en 35.5 s
            "tDataEnd": 40.3,  # fin de 2024; después, imagen fija hasta 46 s
            "duration": 46.0,
            "aspect": "16 / 9",
            "credit": "NASA Scientific Visualization Studio — Annual Arctic Sea Ice Minimum Area 1979–2024 (SVS 5395)",
            "description": (
                "Visualización: el Ártico visto desde arriba con el hielo de cada septiembre (su "
                "mínimo anual), año a año desde 1979. Un gráfico rojo suma un punto por año: baja "
                "de unos 7 a menos de 4 millones de km², con el récord en 2012."
            ),
        },
        "frameWarmth": None,
        "legend": [
            ["Drone grave", "la referencia: la extensión media de 1981–2010."],
            ["Melodía", "una nota por año. Cuanto más grave, menos hielo hubo ese año."],
            ["Arpegio y ostinato de fondo", "los 12 meses de cada año."],
            ["Latido", "se acelera a medida que desaparece el hielo."],
            ["Tensión", "cuanto más hielo falta, más menor se vuelve la escala y más roce disonante aparece."],
            ["Tick", "empieza una década."],
            ["Campanita", "ese año batió el récord de menos hielo."],
        ],
        "intro": intro({
            "reference": "Low drone: the 1981 to 2010 average.",
            "pitch": "Melody: lower means less ice.",
            "months": "Quick notes: the twelve months.",
            "pulse": "Heartbeat: faster means less ice.",
            "tension": "Tense rub: ice far below normal.",
            "record": "Bell: a record low year.",
            "ticks": "Tick: a new decade.",
        }),
        "description": (
            f"Anomalía mensual de la extensión del hielo marino ártico, de {first} a {last}, "
            "respecto a la media de 1981–2010 de cada mes, en millones de km²."
        ),
        "source": {
            "name": "NSIDC Sea Ice Index, Version 4 (G02135)",
            "url": NSIDC_URL,
            "visualization": "https://svs.gsfc.nasa.gov/5395/",
            "retrieved": retrieved,
        },
    }


# --- Salida -------------------------------------------------------------------------

def main() -> None:
    retrieved_file = RAW_DIR / "RETRIEVED.txt"
    retrieved = retrieved_file.read_text().strip() if retrieved_file.exists() else "desconocida"
    tracks = [
        build_temperature_track(parse_gistemp(), retrieved),
        build_co2_track(retrieved),
        build_sea_ice_track(retrieved),
    ]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for track in tracks:
        out = OUT_DIR / f"{track['id']}.json"
        out.write_text(json.dumps(track, ensure_ascii=False, separators=(",", ":")))
        index.append({"id": track["id"], "label": track["label"], "file": f"data/{out.name}"})
        print(
            f"Escrito {out.relative_to(ROOT)}: {len(track['series'])} meses "
            f"({track['series'][0]['t']} → {track['series'][-1]['t']}), "
            f"rango {track['range']}, campanitas en {len(track['records'])} años"
        )
    (OUT_DIR / "tracks.json").write_text(json.dumps(index, ensure_ascii=False, indent=2))
    print(f"Escrito {(OUT_DIR / 'tracks.json').relative_to(ROOT)}: {len(index)} pistas")


if __name__ == "__main__":
    main()
