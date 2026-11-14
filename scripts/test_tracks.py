"""Tests del pipeline de datos.

Uso:  .venv/bin/pytest

Comparan con los valores publicados por NASA GISS. GISTEMP revisa ligeramente
los valores históricos en cada actualización mensual, así que se acepta una
tolerancia de ±0.02 °C.
"""

import json
from pathlib import Path

import pytest

from build_tracks import (
    OUT_DIR,
    annual_series,
    build_temperature_track,
    padded_range,
    parse_gistemp,
    record_years,
)

TOL = 0.02


@pytest.fixture(scope="module")
def track() -> dict:
    return build_temperature_track(parse_gistemp(), retrieved="test")


def value_at(track: dict, t: str) -> float:
    return next(p["v"] for p in track["series"] if p["t"] == t)


def annual_at(track: dict, year: int) -> float:
    return next(a["v"] for a in track["annual"] if a["year"] == year)


# --- Valores de control ---------------------------------------------------

def test_control_values(track):
    assert value_at(track, "1880-01") == pytest.approx(-0.19, abs=TOL)
    assert annual_at(track, 1880) == pytest.approx(-0.18, abs=TOL)
    assert annual_at(track, 2025) == pytest.approx(1.19, abs=TOL)
    assert value_at(track, "2026-10") == pytest.approx(1.55, abs=TOL)


def test_warming_since_1880_exceeds_frase_guia(track):
    # La frase guía dice "más de 1.3 °C desde 1880": el dato tiene que respaldarla.
    assert annual_at(track, 2025) - annual_at(track, 1880) > 1.3


# --- Integridad de la serie -------------------------------------------------

def test_series_starts_in_1880_and_has_no_gaps(track):
    series = track["series"]
    assert series[0]["t"] == "1880-01"
    for prev, cur in zip(series, series[1:]):
        py, pm = map(int, prev["t"].split("-"))
        cy, cm = map(int, cur["t"].split("-"))
        assert (cy, cm) == ((py, pm + 1) if pm < 12 else (py + 1, 1)), f"hueco tras {prev['t']}"


def test_month_count_matches_span(track):
    last_year, last_month = map(int, track["series"][-1]["t"].split("-"))
    assert len(track["series"]) == (last_year - 1880) * 12 + last_month
    assert len(track["series"]) >= 1762  # snapshot del 14-nov-2026 (hasta oct-2026)


def test_no_missing_values(track):
    for p in track["series"]:
        assert isinstance(p["v"], float), p


def test_all_values_inside_range(track):
    lo, hi = track["range"]
    assert all(lo <= p["v"] <= hi for p in track["series"])


def test_annual_only_complete_years(track):
    last_year, last_month = map(int, track["series"][-1]["t"].split("-"))
    years = [a["year"] for a in track["annual"]]
    if last_month < 12:
        assert last_year not in years


# --- Funciones auxiliares ---------------------------------------------------

def test_record_years_excludes_first_and_is_increasing(track):
    records = track["records"]
    assert 1880 not in records
    values = [annual_at(track, y) for y in records]
    assert values == sorted(values) and len(set(values)) == len(values)
    assert {2016, 2023, 2024} <= set(records)


def test_record_years_simple():
    annual = [{"year": 2000, "v": 0.5}, {"year": 2001, "v": 0.4},
              {"year": 2002, "v": 0.6}, {"year": 2003, "v": 0.6}]
    assert record_years(annual) == [2002]


def test_padded_range_rounds_outward():
    assert padded_range([-0.81, 1.55]) == [-0.9, 1.6]
    assert padded_range([-0.8, 1.6]) == [-0.8, 1.6]


# --- Archivo generado ---------------------------------------------------------

def test_generated_json_matches_builder(track):
    path = OUT_DIR / "temperature.json"
    if not path.exists():
        pytest.skip("ejecuta primero: python scripts/build_tracks.py")
    data = json.loads(path.read_text())
    assert data["series"] == track["series"]
    assert data["range"] == track["range"]
    assert "***" not in path.read_text()


# --- Validación con los fotogramas (Paso 7) -----------------------------------

def test_frame_colour_matches_data(track):
    """El color de la espiral en el vídeo sigue a los datos: r > 0.9."""
    import numpy as np

    warmth = track["frameWarmth"]
    if warmth is None:
        pytest.skip("ejecuta primero: python scripts/frame_features.py")
    means = {}
    for p in track["series"]:
        means.setdefault(int(p["t"][:4]), []).append(p["v"])
    w = np.array([row["w"] for row in warmth])
    t = np.array([np.mean(means[row["year"]]) for row in warmth])
    assert len(warmth) == len(means)
    assert np.corrcoef(w, t)[0, 1] > 0.9


# --- Pistas extra: CO₂ y hielo ártico (Paso 8) --------------------------------

from build_tracks import build_co2_track, build_sea_ice_track  # noqa: E402


@pytest.fixture(scope="module")
def co2() -> dict:
    return build_co2_track(retrieved="test")


@pytest.fixture(scope="module")
def ice() -> dict:
    return build_sea_ice_track(retrieved="test")


def test_co2_control_values(co2):
    # Valores publicados por NOAA GML (co2_mm_mlo.csv).
    assert value_at(co2, "1958-03") == pytest.approx(315.71, abs=0.01)
    assert value_at(co2, "2026-09") == pytest.approx(426.07, abs=0.05)


def test_co2_bells_mark_milestones(co2):
    annual = {a["year"]: a["v"] for a in co2["annual"]}
    for level, year in zip(co2["milestones"], co2["records"]):
        assert annual[year] >= level and annual[year - 1] < level


def test_co2_stress_rises_with_value(co2):
    s = co2["sound"]
    assert s["stressFull"] > s["stressZero"]
    lo, hi = co2["range"]
    assert lo <= co2["baseline"] <= hi


def test_sea_ice_climatology_is_centered(ice):
    # Las anomalías se calculan respecto a 1981–2010: en ese periodo su media es ~0.
    vals = [p["v"] for p in ice["series"] if 1981 <= int(p["t"][:4]) <= 2010]
    assert abs(sum(vals) / len(vals)) < 0.01


def test_sea_ice_known_gap_only(ice):
    # El único hueco conocido del Sea Ice Index: dic-1987 y ene-1988 (fallo del satélite).
    months = {p["t"] for p in ice["series"]}
    assert "1987-12" not in months and "1988-01" not in months
    assert len(ice["series"]) == (2026 - 1979) * 12 + int(ice["series"][-1]["t"][5:]) - 2


def test_sea_ice_tension_rises_as_ice_falls(ice):
    s = ice["sound"]
    assert s["stressFull"] < s["stressZero"]  # menos hielo = más tensión
    # Los récords de la campanita son mínimos: cada uno más bajo que el anterior.
    annual = {a["year"]: a["v"] for a in ice["annual"]}
    values = [annual[y] for y in ice["records"]]
    assert values == sorted(values, reverse=True)
    assert 2012 in ice["records"]


def test_tracks_index_lists_all_tracks():
    index_path = OUT_DIR / "tracks.json"
    if not index_path.exists():
        pytest.skip("ejecuta primero: python scripts/build_tracks.py")
    index = json.loads(index_path.read_text())
    assert [t["id"] for t in index] == ["temperature", "co2", "sea_ice"]
    for t in index:
        assert (OUT_DIR.parent / t["file"]).exists()
