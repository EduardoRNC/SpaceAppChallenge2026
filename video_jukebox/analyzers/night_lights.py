"""
Analizador 'night_lights': la Tierra de noche (Black Marble, SVS 5276 y similares).
Fondo oscuro con puntos de luz que aparecen, crecen o se apagan.

  bright  brillo medio (0..1)
  lit     fracción de píxeles encendidos (brillo > 0.35)
  new     luz que aparece: aumento de brillo respecto al frame anterior en píxeles encendidos

Máscara: todo el mapa (la oscuridad también es información).
"""
import numpy as np

NAME = "night_lights"
SUMMARY = {
    "es": "La Tierra de noche: luces sobre fondo oscuro. Mide cuánta luz hay, "
          "qué parte está encendida y la luz que aparece.",
    "en": "Earth at night: lights on a dark background. Measures how much light there is, "
          "how much is lit and the light that appears.",
}

LIT_THRESHOLD = 0.35

METRICS = {
    "bright": dict(
        label=dict(es="Brillo", en="Brightness"),
        unit=dict(es="índice 0..1", en="index 0..1"),
        derived_from=dict(es="valor (V de HSV) medio de los píxeles", en="mean pixel value (V in HSV)"),
        caveat=dict(es="Brillo de la imagen, no radiancia medida por el satélite.",
                    en="Image brightness, not radiance measured by the satellite.")),
    "lit": dict(
        label=dict(es="Fracción encendida", en="Lit share"),
        unit=dict(es="fracción 0..1", en="fraction 0..1"),
        derived_from=dict(es=f"píxeles con brillo > {LIT_THRESHOLD}",
                          en=f"pixels with brightness > {LIT_THRESHOLD}"),
        caveat=dict(es="Depende del umbral y del contraste del video; los océanos cuentan como apagados.",
                    en="It depends on the threshold and on the video's contrast; oceans count as dark.")),
    "new": dict(
        label=dict(es="Luz que aparece", en="Appearing light"),
        unit=dict(es="índice 0..1 por frame", en="index 0..1 per frame"),
        derived_from=dict(es="aumento de brillo frente al frame anterior en píxeles encendidos",
                          en="brightness increase over the previous frame in lit pixels"),
        caveat=dict(es="También sube con fundidos y cambios de cámara.",
                    en="It also rises with fades and camera moves.")),
    "cover": dict(
        label=dict(es="Cobertura de píxeles válidos", en="Valid-pixel coverage"),
        unit=dict(es="fracción 0..1", en="fraction 0..1"),
        derived_from=dict(es="todo el mapa cuenta", en="the whole map counts"),
        caveat=dict(es="Siempre 1 en este analizador.", en="Always 1 for this analyzer.")),
}

DEFAULT_MUSIC = {
    "harmony": {"metric": "lit", "mode": "mean"},
    "tracks": [
        {"id": "luz", "role": "pad", "patch": "STRINGS 1", "program": 3,
         "color": "#ffd166", "metric": "bright"},
        {"id": "ciudades", "role": "voices", "patch": "FLUTE 1", "program": 23,
         "color": "#4cc9f0", "activity": "lit", "pitch": "bright", "timbre": "new"},
        {"id": "destellos", "role": "accents", "patch": "TUB BELLS", "program": 25,
         "color": "#c77dff", "metric": "new"},
        {"id": "norte", "role": "bass", "patch": "BASS 1", "program": 14,
         "color": "#f4b942", "metric": "lit", "region": "norte_medio", "direction": 1},
    ],
}


def mask(cur):
    return np.ones(cur.gray.shape, bool)


def measure(cur, prev):
    v = cur.hsv[..., 2].astype(np.float32) / 255.0
    pv = prev.hsv[..., 2].astype(np.float32) / 255.0
    lit = v > LIT_THRESHOLD
    maps = {
        "bright": v,
        "lit": lit.astype(np.float32),
        "new": np.clip(v - pv, 0, None) * lit,
    }
    return maps, mask(cur)
