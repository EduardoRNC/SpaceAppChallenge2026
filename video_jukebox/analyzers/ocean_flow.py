"""
Analizador 'ocean_flow': líneas de corriente que se mueven, coloreadas por una paleta
azul (frío) -> rojo (cálido). Es el de ECCO2 (SVS 3912): tierra gris, océano con líneas.

Medidas por franja: color (temp), movimiento aparente (speed, u, v), turbulencia (vort).
"""
import cv2
import numpy as np

from .common import hue_index

NAME = "ocean_flow"
SUMMARY = {
    "es": "Líneas o partículas que se mueven (corrientes, viento) coloreadas de azul a rojo. "
          "Mide color y movimiento con flujo óptico.",
    "en": "Moving lines or particles (currents, wind) colored from blue to red. "
          "Measures color and motion with optical flow.",
}

# Textos de cada medida en los dos idiomas. El orden es el de las gráficas de la web.
METRICS = {
    "temp": dict(
        label=dict(es="Índice de color frío-cálido", en="Cold–warm color index"),
        unit=dict(es="índice 0..1", en="index 0..1"),
        derived_from=dict(es="tono (hue HSV) del píxel: azul = 0, rojo = 1",
                          en="pixel hue (HSV): blue = 0, red = 1"),
        caveat=dict(es="Posición en la paleta de colores de la visualización, no temperatura en °C.",
                    en="Position in the visualization's color palette, not temperature in °C.")),
    "speed": dict(
        label=dict(es="Movimiento aparente", en="Apparent motion"),
        unit=dict(es="px/frame", en="px/frame"),
        derived_from=dict(es="magnitud media del flujo óptico (Farneback)",
                          en="mean optical-flow magnitude (Farneback)"),
        caveat=dict(es="Depende de la resolución de análisis (--width) y del ritmo de la "
                       "animación; no es velocidad en m/s.",
                    en="Depends on the analysis resolution (--width) and on the pace of the "
                       "animation; not a speed in m/s.")),
    "u": dict(
        label=dict(es="Movimiento aparente este-oeste", en="Apparent east–west motion"),
        unit=dict(es="px/frame", en="px/frame"),
        derived_from=dict(es="componente horizontal del flujo óptico (+ = este)",
                          en="horizontal optical-flow component (+ = east)"),
        caveat=dict(es="En proyección equirectangular un píxel horizontal abarca menos km "
                       "cuanto más cerca del polo.",
                    en="In the equirectangular projection a horizontal pixel covers fewer km "
                       "the closer it is to the pole.")),
    "v": dict(
        label=dict(es="Movimiento aparente norte-sur", en="Apparent north–south motion"),
        unit=dict(es="px/frame", en="px/frame"),
        derived_from=dict(es="componente vertical del flujo óptico (+ = norte)",
                          en="vertical optical-flow component (+ = north)"),
        caveat=dict(es="Movimiento de las líneas dibujadas, no velocidad meridional física.",
                    en="Motion of the drawn lines, not physical meridional velocity.")),
    "vort": dict(
        label=dict(es="Turbulencia aparente", en="Apparent turbulence"),
        unit=dict(es="1/frame", en="1/frame"),
        derived_from=dict(es="valor absoluto del rotacional del flujo óptico",
                          en="absolute value of the optical-flow curl"),
        caveat=dict(es="Indicador de remolinos en la imagen, no vorticidad física en 1/s.",
                    en="An indicator of eddies in the image, not physical vorticity in 1/s.")),
    "cover": dict(
        label=dict(es="Cobertura de píxeles válidos", en="Valid-pixel coverage"),
        unit=dict(es="fracción 0..1", en="fraction 0..1"),
        derived_from=dict(es="píxeles que pasan la máscara de saturación y brillo",
                          en="pixels that pass the saturation and brightness mask"),
        caveat=dict(es="Fracción de píxeles coloreados, no fracción real de océano.",
                    en="Fraction of colored pixels, not the actual fraction of ocean.")),
}

# Música por defecto para este tipo de video (cada ficha de video puede cambiarla).
# Roles fijos por canal: 0 pad (acordes), 1 voces (una por franja), 2 acentos, 3 bajo.
DEFAULT_MUSIC = {
    "harmony": {"metric": "temp", "mode": "contrast", "regions": ["norte_medio", "sur_medio"]},
    "tracks": [
        {"id": "temperatura", "name": "Temperatura", "role": "pad", "patch": "STRINGS 1", "program": 3,
         "color": "#ff6b4a", "metric": "temp"},
        {"id": "corrientes", "name": "Corrientes", "role": "voices", "patch": "FLUTE 1", "program": 23,
         "color": "#4cc9f0", "activity": "speed", "pitch": "temp", "timbre": "vort"},
        {"id": "remolinos", "name": "Remolinos", "role": "accents", "patch": "TUB BELLS", "program": 25,
         "color": "#c77dff", "metric": "vort"},
        {"id": "ecuatorial", "name": "Corriente ecuatorial", "role": "bass", "patch": "BASS 1", "program": 14,
         "color": "#f4b942", "metric": "u", "region": "tropicos", "direction": -1},
    ],
}


def ocean_mask(hsv):
    """Píxeles de corriente: coloreados (saturados) y no demasiado oscuros.
    La tierra es gris (saturación baja), así que queda fuera."""
    s, v = hsv[..., 1], hsv[..., 2]
    return (s > 70) & (v > 50)


# nombre histórico (diagnostics.py, mask_check.py)
temperature_index = hue_index


def vorticity(flow):
    """Rotacional del campo de flujo: dv/dx - du/dy."""
    u, v = flow[..., 0], flow[..., 1]
    dv_dx = cv2.Sobel(v, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    du_dy = cv2.Sobel(u, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    return dv_dx - du_dy


def mask(cur):
    return ocean_mask(cur.hsv)


def measure(cur, prev):
    flow = cv2.calcOpticalFlowFarneback(prev.gray, cur.gray, None,
                                        pyr_scale=0.5, levels=3, winsize=9,
                                        iterations=3, poly_n=5, poly_sigma=1.1,
                                        flags=0)
    maps = {
        "temp": hue_index(cur.hsv),
        "speed": np.linalg.norm(flow, axis=2),
        "u": flow[..., 0],
        "v": -flow[..., 1],               # +v = hacia el norte
        "vort": np.abs(vorticity(flow)),
    }
    return maps, ocean_mask(cur.hsv)
