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
