"""
Analizadores de video: uno por TIPO de visualización.

| nombre        | para qué videos                                      |
|---------------|------------------------------------------------------|
| ocean_flow    | líneas/partículas en movimiento coloreadas (ECCO2)   |
| color_map     | mapas de calor que cambian de color (temperatura, CO2)|
| night_lights  | la Tierra de noche (Black Marble)                    |

Para añadir uno nuevo: copia color_map.py, cambia NAME, SUMMARY, METRICS, DEFAULT_MUSIC y
measure(), y regístralo en ANALYZERS. Todo lo demás (composición, web) funciona sin cambios.

Cada módulo define:
  NAME           nombre corto (el que va en la ficha del video)
  SUMMARY        {es, en}: para qué sirve
  METRICS        medida -> {label, unit, derived_from, caveat}, cada texto {es, en};
                 debe incluir 'cover' (la calcula common.analyze_video)
  DEFAULT_MUSIC  qué medida controla cada pista (ver compose.py)
  measure(cur, prev) -> (mapas por píxel, máscara)
  mask(cur)      solo la máscara (la usa mask_check.py)
"""
from . import color_map, night_lights, ocean_flow
from .common import BANDS, MIN_PIXELS, analyze_video, band_rows

ANALYZERS = {m.NAME: m for m in (ocean_flow, color_map, night_lights)}


def get(name):
    try:
        return ANALYZERS[str(name)]
    except KeyError:
        raise KeyError(f"analizador desconocido '{name}'; disponibles: {', '.join(ANALYZERS)}") from None


def analyzer_of(feat):
    """Analizador con el que se generó un features.npz (los antiguos no lo guardaban: ECCO2)."""
    return get(str(feat["analyzer"])) if "analyzer" in feat else ocean_flow


def metric_text(analyzer, lang):
    """METRICS de un analizador en un idioma: {medida: {label, unit, derived_from, caveat}}."""
    return {k: {f: v[lang] for f, v in m.items()} for k, m in analyzer.METRICS.items()}


__all__ = ["ANALYZERS", "BANDS", "MIN_PIXELS", "analyze_video", "analyzer_of", "band_rows", "get",
           "metric_text"]
