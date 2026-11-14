"""
Earth Information Jukebox - Exportador: features.npz + events.json -> timeline.json

Junta en un solo JSON, con tiempos en segundos, lo que el video MUESTRA (las
características por frame y franja de analyze.py) y lo que la música TOCA (las
notas MIDI de compose.py), para que una interfaz web pueda dibujar y reproducir
ambas cosas sincronizadas.

IMPORTANTE: todas las características son PROXIES VISUALES calculados a partir
de los píxeles del video (color y flujo óptico). No son mediciones físicas
calibradas: 'temp' no está en °C ni 'speed' en m/s. Ver METRICS.

Tiempos
  notas            t = beat * 60 / bpm   (mismo reloj que el MIDI y el preview WAV)
  características  t = (fila + 1) / fps  (analyze.py no da fila para el primer frame:
                                          el flujo óptico necesita un par de frames)

Antes de escribir se valida el par: dimensiones, FPS, que events.json salga de
este features.npz, cobertura y valores faltantes. Los errores abortan; los avisos
quedan en timeline["validation"].

Uso:
    python export_timeline.py features.npz events.json timeline.json [--source video.mp4]
"""
import argparse
import json
import math
import os
import sys

import numpy as np

from analyze import BANDS, MIN_PIXELS
from compose import BEATS_PER_BAR, TRACKS

SCHEMA = "earth-jukebox-timeline"
VERSION = 1
FRAME_OFFSET = 1          # fila 0 de features = frame 1 del video
MIN_COVER = 0.02          # cobertura media por franja por debajo de la cual se avisa
MAX_FPS = 240.0

DISCLAIMER = ("Las características son proxies visuales derivados de los píxeles del video "
              "(color y flujo óptico). No son mediciones físicas calibradas.")

METRICS = {
    "temp": dict(label="Índice de color frío-cálido", unit="índice 0..1",
                 derived_from="tono (hue HSV) del píxel: azul = 0, rojo = 1",
                 caveat="Posición en la paleta de colores de la visualización, no temperatura en °C."),
    "speed": dict(label="Movimiento aparente", unit="px/frame",
                  derived_from="magnitud media del flujo óptico (Farneback)",
                  caveat="Depende de la resolución de análisis (--width) y del ritmo de la "
                         "animación; no es velocidad en m/s."),
    "u": dict(label="Movimiento aparente este-oeste", unit="px/frame",
              derived_from="componente horizontal del flujo óptico (+ = este)",
              caveat="En proyección equirectangular un píxel horizontal abarca menos km "
                     "cuanto más cerca del polo."),
    "v": dict(label="Movimiento aparente norte-sur", unit="px/frame",
              derived_from="componente vertical del flujo óptico (+ = norte)",
              caveat="Movimiento de las líneas dibujadas, no velocidad meridional física."),
    "vort": dict(label="Turbulencia aparente", unit="1/frame",
                 derived_from="valor absoluto del rotacional del flujo óptico",
                 caveat="Indicador de remolinos en la imagen, no vorticidad física en 1/s."),
    "cover": dict(label="Cobertura de píxeles válidos", unit="fracción 0..1",
                  derived_from="píxeles que pasan la máscara de saturación y brillo",
                  caveat="Fracción de píxeles coloreados, no fracción real de océano."),
}


class TimelineError(ValueError):
    """features.npz y events.json son inconsistentes y no se pueden exportar."""


def load_features(path):
    with np.load(path) as z:
        return {k: z[k] for k in z.files}


def num(x, nd=5):
    x = float(x)
    return round(x, nd) if math.isfinite(x) else None


def missing_mask(feat):
    """(frames, franjas) True donde analyze.py no midió la franja (pocos píxeles válidos).
    Con features antiguos sin 'band_pixels' se aproxima: todas las medidas a 0 exacto."""
    if "band_pixels" in feat:
        return np.rint(feat["cover"] * feat["band_pixels"][None, :]) < MIN_PIXELS
    keys = [k for k in METRICS if k != "cover"]
    return np.all([feat[k] == 0 for k in keys], axis=0)


def check_structure(feat, ev):
    """Comprobaciones que, si fallan, impiden exportar. Devuelve (n, fps, bpm, meta)."""
    absent = [k for k in list(METRICS) + ["fps", "bands"] if k not in feat]
    if absent:
        raise TimelineError(f"features.npz sin claves: {absent}")

    bands = [str(b) for b in feat["bands"]]
    expected = [b[0] for b in BANDS]
    if bands != expected:
        raise TimelineError(f"regiones {bands} distintas de las esperadas {expected}")

    n = feat["temp"].shape[0] if feat["temp"].ndim == 2 else 0
    for k in METRICS:
        if feat[k].shape != (n, len(bands)):
            raise TimelineError(f"'{k}' tiene forma {feat[k].shape}, se esperaba ({n}, {len(bands)})")
    if n == 0:
        raise TimelineError("features.npz no tiene frames")
    if "band_pixels" in feat and feat["band_pixels"].shape != (len(bands),):
        raise TimelineError(f"'band_pixels' tiene forma {feat['band_pixels'].shape}")

    fps = float(feat["fps"])
    if not (math.isfinite(fps) and 0 < fps <= MAX_FPS):
        raise TimelineError(f"FPS inválido: {fps}")

    meta = ev.get("meta")
    if not isinstance(meta, dict) or not isinstance(ev.get("events"), list):
        raise TimelineError("events.json sin 'meta' o 'events'")
    bpm = float(meta.get("bpm", float("nan")))
    if not (math.isfinite(bpm) and bpm > 0):
        raise TimelineError(f"BPM inválido: {meta.get('bpm')}")

    fpb = int(round(fps * 60.0 / bpm))
    nbeats = n // fpb
    if fpb < 2:
        raise TimelineError(f"menos de 2 frames por beat (fps={fps}, bpm={bpm})")
    if meta.get("fpb") != fpb or meta.get("nbeats") != nbeats:
        raise TimelineError(
            f"events.json no corresponde a este features.npz: meta fpb={meta.get('fpb')} "
            f"nbeats={meta.get('nbeats')}, esperado fpb={fpb} nbeats={nbeats}")
    nbars = int(math.ceil(nbeats / BEATS_PER_BAR))
    if meta.get("nbars") != nbars or len(meta.get("chords", [])) != nbars:
        raise TimelineError(f"se esperaban {nbars} compases con su acorde")

    channels = {t["ch"] for t in TRACKS.values()}
    for e in ev["events"]:
        if len(e) != 5:
            raise TimelineError(f"evento mal formado: {e}")
        beat, dur, ch, note, vel = e
        if int(ch) not in channels:
            raise TimelineError(f"evento en canal {int(ch)} desconocido: {e}")
        if not (math.isfinite(beat) and math.isfinite(dur)) or beat < 0 or dur <= 0:
            raise TimelineError(f"evento con tiempo inválido: {e}")
    return n, fps, bpm, meta


def soft_checks(feat, ev, n, fps, bpm, meta, missing):
    """Avisos que no impiden exportar, más un resumen numérico."""
    warnings = []
    bands = [str(b) for b in feat["bands"]]
    spb = 60.0 / bpm
    fpb, nbeats = meta["fpb"], meta["nbeats"]
    music_s = nbeats * spb

    nonfinite = {k: int((~np.isfinite(feat[k])).sum()) for k in METRICS}
    for k, c in nonfinite.items():
        if c:
            warnings.append(f"'{k}' tiene {c} valores no finitos (exportados como null)")

    miss_frac = missing.mean(0)
    cover_mean = np.nanmean(np.where(np.isfinite(feat["cover"]), feat["cover"], np.nan), 0)
    for b, name in enumerate(bands):
        if miss_frac[b] > 0:
            warnings.append(f"región '{name}': {miss_frac[b]:.1%} de frames sin dato "
                            f"(compose.py los trató como 0)")
        if not cover_mean[b] >= MIN_COVER:
            warnings.append(f"región '{name}': cobertura media {cover_mean[b]:.3f} < {MIN_COVER}")

    drift = nbeats * fpb / fps - music_s
    if abs(drift) > 1.0 / fps:
        warnings.append(f"deriva música-video de {drift:+.3f} s al final: fps*60/bpm = "
                        f"{fps * 60 / bpm:.3f} se redondeó a {fpb} frames por beat")
    if fpb % 2:
        warnings.append(f"{fpb} frames por beat es impar: las campanas (corcheas de "
                        f"{fpb // 2} frames) se desfasan respecto a los datos")

    late = sum(1 for e in ev["events"] if e[0] >= nbeats)
    if late:
        warnings.append(f"{late} notas empiezan después del final de la música ({music_s:.2f} s)")

    counts = {k: sum(1 for e in ev["events"] if int(e[2]) == t["ch"]) for k, t in TRACKS.items()}
    for k, c in counts.items():
        if c == 0:
            warnings.append(f"el canal '{k}' no tiene notas")

    checks = dict(
        frames=n, regions=len(bands), fps=fps, bpm=bpm,
        frames_per_beat=fpb, frames_used_by_music=nbeats * fpb,
        frames_unused_at_end=n - nbeats * fpb,
        music_coverage=round(nbeats * fpb / n, 4),
        drift_at_end_s=round(drift, 6),
        missing_fraction={b: round(float(f), 4) for b, f in zip(bands, miss_frac)},
        cover_mean={b: num(c, 4) for b, c in zip(bands, cover_mean)},
        nonfinite_values=nonfinite,
        notes_per_channel=counts,
        notes_starting_after_end=late,
    )
    return warnings, checks


def build_timeline(feat, ev, source=None):
    n, fps, bpm, meta = check_structure(feat, ev)
    missing = missing_mask(feat)
    warnings, checks = soft_checks(feat, ev, n, fps, bpm, meta, missing)

    bands = [str(b) for b in feat["bands"]]
    spb = 60.0 / bpm
    lat = {b[0]: (b[1], b[2]) for b in BANDS}
    ch_track = {t["ch"]: k for k, t in TRACKS.items()}

    metrics = {}
    for k in METRICS:
        by_region = {}
        for b, name in enumerate(bands):
            col = feat[k][:, b]
            gone = missing[:, b] if k != "cover" else np.zeros(n, bool)
            by_region[name] = [None if g else num(x) for x, g in zip(col, gone)]
        metrics[k] = dict(METRICS[k], nature="visual_proxy", calibrated=False, by_region=by_region)

    notes = [dict(t=round(beat * spb, 6), dur=round(dur * spb, 6), beat=beat, dur_beats=dur,
                  channel=int(ch), track=ch_track[int(ch)], note=int(note), vel=int(vel))
             for beat, dur, ch, note, vel in sorted(ev["events"], key=lambda e: (e[0], e[2], e[3]))]
    cc = [dict(t=round(beat * spb, 6), beat=beat, channel=int(ch), controller=int(ctl), value=int(val))
          for beat, ch, ctl, val in ev.get("cc", [])]
    chords = [dict(bar=i, t=round(i * BEATS_PER_BAR * spb, 6), name=name)
              for i, name in enumerate(meta["chords"])]

    return dict(
        schema=SCHEMA, version=VERSION, source=source or {}, disclaimer=DISCLAIMER,
        timing=dict(
            fps=fps, frames=n, frame_offset=FRAME_OFFSET,
            video_duration_s=round((n + FRAME_OFFSET) / fps, 6),
            bpm=bpm, beats_per_bar=BEATS_PER_BAR, seconds_per_beat=round(spb, 9),
            frames_per_beat=meta["fpb"], beats=meta["nbeats"], bars=meta["nbars"],
            music_duration_s=round(meta["nbeats"] * spb, 6),
        ),
        regions=[dict(id=name, index=b, lat_north=lat[name][0], lat_south=lat[name][1])
                 for b, name in enumerate(bands)],
        channels=[dict(id=k, midi_channel=t["ch"], program=t["program"], name=t["name"])
                  for k, t in TRACKS.items()],
        features=dict(t=[round((i + FRAME_OFFSET) / fps, 6) for i in range(n)], metrics=metrics),
        chords=chords, notes=notes, cc=cc,
        validation=dict(status="warnings" if warnings else "ok", warnings=warnings, checks=checks),
    )


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("features")
    ap.add_argument("events")
    ap.add_argument("out")
    ap.add_argument("--source", default=None, help="video de origen (solo se guarda el nombre)")
    a = ap.parse_args(argv)
    feat = load_features(a.features)
    with open(a.events) as f:
        ev = json.load(f)
    source = dict(features=os.path.basename(a.features), events=os.path.basename(a.events))
    if a.source:
        source["video"] = os.path.basename(a.source)
    try:
        tl = build_timeline(feat, ev, source)
    except TimelineError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    t = tl["timing"]
    print(f"OK: {t['frames']} frames x {len(tl['regions'])} regiones, {len(tl['notes'])} notas "
          f"en {len(tl['channels'])} canales, {t['music_duration_s']:.1f} s -> {a.out}")
    for w in tl["validation"]["warnings"]:
        print(f"  aviso: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
