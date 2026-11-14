"""
Analizador 'color_map': mapas de calor (heatmaps) que cambian de color con el tiempo.
Ejemplos: anomalías de temperatura (GISTEMP, SVS 5603), temperatura del mar (MUR SST),
concentración de CO2 o de otros gases.

Funciona con paletas secuenciales (azul -> rojo) y divergentes (azul - blanco - rojo):
  hue    posición en la paleta azul -> rojo (0..1), ignora el blanco
  warm   (rojo - azul) / 255: positivo = rojizo, negativo = azulado, 0 = blanco/gris
  hot    fracción de píxeles claramente rojos (warm > 0.35)
  change cuánto cambia la imagen respecto al frame anterior

Máscara: todo lo que no sea fondo negro. Si el mapa tiene tierra gris o textos encima,
revisa con mask_check.py y recorta el video antes.
"""
import numpy as np

from .common import hue_index

NAME = "color_map"
SUMMARY = {
    "es": "Mapa de calor que cambia de color (temperatura, anomalías, CO2...). "
          "Mide el color de cada franja y cuánto cambia.",
    "en": "Heatmap that changes color (temperature, anomalies, CO2...). "
          "Measures each band's color and how much it changes.",
}

HOT_THRESHOLD = 0.35

METRICS = {
    "warm": dict(
        label=dict(es="Índice rojo-azul", en="Red–blue index"),
        unit=dict(es="índice −1..1", en="index −1..1"),
        derived_from=dict(es="(rojo − azul) / 255 de cada píxel: + rojizo, − azulado, 0 blanco",
                          en="(red − blue) / 255 per pixel: + reddish, − bluish, 0 white"),
        caveat=dict(es="Posición en la paleta de la visualización, no un valor en °C ni en ppm.",
                    en="Position in the visualization's palette, not a value in °C or ppm.")),
    "hue": dict(
        label=dict(es="Índice de color frío-cálido", en="Cold–warm color index"),
        unit=dict(es="índice 0..1", en="index 0..1"),
        derived_from=dict(es="tono (hue HSV) del píxel: azul = 0, rojo = 1",
                          en="pixel hue (HSV): blue = 0, red = 1"),
        caveat=dict(es="No distingue colores poco saturados (blanco, gris).",
                    en="It cannot tell apart unsaturated colors (white, gray).")),
    "hot": dict(
        label=dict(es="Fracción en rojo intenso", en="Share in strong red"),
        unit=dict(es="fracción 0..1", en="fraction 0..1"),
        derived_from=dict(es=f"píxeles con índice rojo-azul > {HOT_THRESHOLD}",
                          en=f"pixels with red–blue index > {HOT_THRESHOLD}"),
        caveat=dict(es="El umbral es fijo y depende de la paleta.",
                    en="The threshold is fixed and depends on the palette.")),
    "change": dict(
        label=dict(es="Cambio de la imagen", en="Image change"),
        unit=dict(es="índice 0..1 por frame", en="index 0..1 per frame"),
        derived_from=dict(es="diferencia absoluta de brillo con el frame anterior",
                          en="absolute brightness difference with the previous frame"),
        caveat=dict(es="También sube con fundidos, textos que cambian o ruido de compresión.",
                    en="It also rises with fades, changing text or compression noise.")),
    "cover": dict(
        label=dict(es="Cobertura de píxeles válidos", en="Valid-pixel coverage"),
        unit=dict(es="fracción 0..1", en="fraction 0..1"),
        derived_from=dict(es="píxeles que no son fondo negro", en="pixels that are not black background"),
        caveat=dict(es="Incluye tierra o textos si el mapa los tiene.",
                    en="It includes land or text if the map has them.")),
}

DEFAULT_MUSIC = {
    "harmony": {"metric": "warm", "mode": "mean"},
    "tracks": [
        {"id": "calor", "role": "pad", "patch": "STRINGS 1", "program": 3,
         "color": "#ff6b4a", "metric": "warm"},
        {"id": "regiones", "role": "voices", "patch": "FLUTE 1", "program": 23,
         "color": "#4cc9f0", "activity": "hot", "pitch": "warm", "timbre": "change"},
        {"id": "cambios", "role": "accents", "patch": "TUB BELLS", "program": 25,
         "color": "#c77dff", "metric": "change"},
        {"id": "tropicos", "role": "bass", "patch": "BASS 1", "program": 14,
         "color": "#f4b942", "metric": "warm", "region": "tropicos", "direction": 1},
    ],
}


def color_mask(hsv):
    return hsv[..., 2] > 40


def mask(cur):
    return color_mask(cur.hsv)


def measure(cur, prev):
    bgr = cur.bgr.astype(np.float32)
    warm = (bgr[..., 2] - bgr[..., 0]) / 255.0
    change = np.abs(cur.gray.astype(np.float32) - prev.gray.astype(np.float32)) / 255.0
    maps = {
        "warm": warm,
        "hue": hue_index(cur.hsv),
        "hot": (warm > HOT_THRESHOLD).astype(np.float32),
        "change": change,
    }
    return maps, color_mask(cur.hsv)
