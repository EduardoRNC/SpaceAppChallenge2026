"""
Paso final del jukebox: los activos web de UN video (los llama jukebox.py build).

A partir de las salidas del pipeline (events.json y timeline.json), de la ficha del video
(videos/<id>.json) y del video original escribe, con rutas relativas a la página:

  web/public/media/jukebox/<id>.mp4             video H.264 de 1280 px de ancho, sin audio, 2 pasadas
  web/public/media/jukebox/<id>_<pista>.m4a     4 stems FM (AAC), misma longitud y comienzo
  web/public/data/jukebox/<id>_timeline.json    timeline.json minificado
  web/public/data/jukebox/<id>.json             manifiesto: rutas, tiempos, pistas, textos, créditos
  web/public/data/jukebox/catalog.json          la lista de videos que ofrece la web

Después valida lo escrito: frames y FPS del video, longitud y desfase de los stems decodificados,
saturación en cualquier combinación de mute/solo, tamaños, rutas y créditos.

Uso directo (solo validar lo que ya está publicado):
    python build_web.py --check-only            # todos los videos del catálogo
    python build_web.py --check-only --id ecco2
"""
import argparse
import hashlib
import itertools
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

import numpy as np

import analyzers
import render_preview as rp
import texts as tx

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"
SCHEMA = "earth-jukebox-web"
VERSION = 2
CATALOG = "catalog.json"
CATALOG_SCHEMA = "earth-jukebox-catalog"
MEDIA_DIR = "media/jukebox"
DATA_DIR = "data/jukebox"
BUDGET = dict(video=12_000_000, stem=1_500_000, timeline=1_000_000, total=20_000_000)

class BuildError(RuntimeError):
    pass


def run(cmd):
    r = subprocess.run(list(map(str, cmd)), capture_output=True)
    if r.returncode != 0:
        raise BuildError(f"falló {cmd[0]}: {r.stderr.decode(errors='replace')[-800:]}")
    return r.stdout


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def probe(path):
    out = run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format",
               "-of", "json", path])
    return json.loads(out)


def range_dates(date_range, frames):
    """Fechas del primer y último frame (ficha del video) repartidas de forma uniforme."""
    first, last = (datetime.strptime(d, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) for d in date_range)
    step = (last - first).total_seconds() / max(frames - 1, 1)
    return dict(first=date_range[0], last=date_range[1], frames=frames, step_hours=round(step / 3600, 6),
                max_deviation_s=0.0, source="date_range")


def model_dates(path, frames):
    """Inicio, fin y uniformidad de las fechas del modelo (una línea por frame)."""
    dates = [datetime.strptime(line.split()[1], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
             for line in open(path) if len(line.split()) >= 2]
    if len(dates) != frames:
        raise BuildError(f"{path}: {len(dates)} fechas para {frames} frames")
    sec = np.array([d.timestamp() for d in dates])
    step = (sec[-1] - sec[0]) / (frames - 1)
    dev = np.abs(sec - (sec[0] + step * np.arange(frames))).max()
    if dev > 60:
        raise BuildError(f"fechas no uniformes (desviación {dev:.0f} s)")
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%MZ")
    return dict(first=iso(dates[0]), last=iso(dates[-1]), frames=frames,
                step_hours=round(step / 3600, 6), max_deviation_s=float(dev),
                source=Path(path).name)


def encode_video(src, dst, kbps, width=1280):
    with tempfile.TemporaryDirectory() as tmp:
        log = Path(tmp) / "x264"
        common = ["ffmpeg", "-v", "error", "-y", "-i", src, "-an",
                  "-vf", f"scale={width}:-2:flags=lanczos", "-fps_mode", "passthrough",
                  "-c:v", "libx264", "-preset", "slow", "-b:v", f"{kbps}k",
                  "-maxrate", f"{2 * kbps}k", "-bufsize", f"{4 * kbps}k",
                  "-profile:v", "high", "-pix_fmt", "yuv420p", "-g", "30",
                  "-passlogfile", log]
        run(common + ["-pass", "1", "-f", "mp4", os.devnull])
        run(common + ["-pass", "2", "-movflags", "+faststart", dst])


def encode_stems(events, dst_dir, slug, kbps):
    with tempfile.TemporaryDirectory() as tmp:
        info = rp.write_stems(events, tmp)
        for s in info["stems"]:
            out = dst_dir / f"{slug}_{s['id']}.m4a"
            run(["ffmpeg", "-v", "error", "-y", "-i", Path(tmp) / s["file"], "-c:a", "aac",
                 "-b:a", f"{kbps}k", "-movflags", "+faststart", out])
            s["file"] = out.name
        info["reference"] = {s["id"]: decode(Path(tmp) / f"{s['id']}.wav") for s in info["stems"]}
    return info


def decode(path, sr=rp.SR):
    raw = run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(sr), "-"])
    return np.frombuffer(raw, np.float32).reshape(-1, 2)


def lag(ref, x, max_lag=4096):
    """Desplazamiento (muestras) de x respecto a ref que maximiza la correlación."""
    n = min(len(ref), len(x), 10 * rp.SR)
    a, b = ref[:n, 0].astype(float), x[:n, 0].astype(float)
    spec = np.fft.irfft(np.fft.rfft(b, 2 * n) * np.conj(np.fft.rfft(a, 2 * n)))
    cand = np.r_[spec[:max_lag + 1], spec[-max_lag:]]
    k = int(np.argmax(cand))
    return k if k <= max_lag else k - len(cand)


def relative(path):
    p = str(path)
    return not (p.startswith("/") or "://" in p or ".." in Path(p).parts or "\\" in p)


def build(video, events, timeline, *, video_path=None, web=WEB, dates=None, skip_video=False,
          video_kbps=1200, audio_kbps=128):
    """Escribe los activos web de un video y devuelve (manifiesto, informe de validación)."""
    if timeline.get("schema") != "earth-jukebox-timeline":
        raise BuildError("el timeline no es del jukebox")
    if timeline["validation"]["status"] != "ok":
        print("Aviso: el timeline tiene avisos:", timeline["validation"]["warnings"], file=sys.stderr)
    slug = video["id"]
    tracks = events["meta"]["tracks"]
    music = {t["id"]: t for t in video["music"]["tracks"]}

    media, data = web / "public" / MEDIA_DIR, web / "public" / DATA_DIR
    media.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True)

    out_video = media / f"{slug}.mp4"
    if skip_video and out_video.exists():
        print(f"Video existente: {out_video}")
    else:
        if not video_path:
            raise BuildError("falta el video original (o usa --skip-video con uno ya codificado)")
        print(f"Codificando video ({video_kbps} kb/s, 2 pasadas)...")
        encode_video(video_path, out_video, video_kbps)
    vinfo = [s for s in probe(out_video)["streams"] if s["codec_type"] == "video"][0]

    print("Renderizando y codificando stems...")
    stems = encode_stems(events, media, slug, audio_kbps)
    reference = stems.pop("reference")

    tl_out = data / f"{slug}_timeline.json"
    tl_out.write_text(json.dumps(timeline, separators=(",", ":"), allow_nan=False))

    analyzer = analyzers.get(timeline["analyzer"])
    texts, credits = tx.build_texts(video, analyzer, timeline["mapping"], list(tracks))
    es = texts["es"]
    timing = timeline["timing"]
    frames = timing["frames"] + timing["frame_offset"]
    if dates:
        model_time = model_dates(dates, frames)
    elif video.get("source", {}).get("date_range"):
        model_time = range_dates(video["source"]["date_range"], frames)
    else:
        model_time = None
    manifest = dict(
        schema=SCHEMA, version=VERSION, id=slug, analyzer=timeline["analyzer"],
        svs=video.get("svs"), test=bool(video.get("test")),
        title=es["title"],
        generated_by="video_jukebox/jukebox.py build",
        paths_relative_to="la página (web/index.html); válido con base './' en GitHub Pages",
        video=dict(src=f"{MEDIA_DIR}/{out_video.name}", fps=timing["fps"], frames=frames,
                   duration_s=timing["video_duration_s"],
                   width=int(vinfo["width"]), height=int(vinfo["height"])),
        audio=dict(sample_rate=stems["sample_rate"], samples=stems["samples"],
                   duration_s=stems["duration_s"], gain=stems["gain"],
                   headroom_db=stems["headroom_db"], codec=f"AAC {audio_kbps} kb/s",
                   stems=[dict(id=s["id"], channel=s["channel"], role=tracks[s["id"]]["role"],
                               label=es["stems"][s["id"]]["label"],
                               color=music[s["id"]].get("color", "#cccccc"),
                               instrument=f"{es['stems'][s['id']]['label']} - {tracks[s['id']]['patch']}",
                               src=f"{MEDIA_DIR}/{s['file']}", first_note_s=s["first_note_s"])
                          for s in stems["stems"]]),
        timeline=dict(src=f"{DATA_DIR}/{tl_out.name}", bpm=timing["bpm"],
                      music_duration_s=timing["music_duration_s"]),
        model_time=model_time,
        credits=[{k: tx.pick(c.get(k), "es") for k in ("role", "text", "detail", "url")} for c in credits],
        notice=es["notice"], disclaimer=es["disclaimer"],
        texts=texts,
    )
    report = validate(manifest, web / "public", reference)
    manifest["assets"] = report["assets"]
    (data / f"{slug}.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    update_catalog(web, manifest)
    return manifest, report


def read_catalog(web=WEB):
    path = web / "public" / DATA_DIR / CATALOG
    if not path.exists():
        return dict(schema=CATALOG_SCHEMA, version=1, videos=[])
    return json.loads(path.read_text())


def write_catalog(catalog, web=WEB):
    path = web / "public" / DATA_DIR / CATALOG
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")


def update_catalog(web, manifest):
    """Añade o actualiza el video en el catálogo de la web (mantiene el orden)."""
    catalog = read_catalog(web)
    entry = dict(id=manifest["id"], manifest=f"{DATA_DIR}/{manifest['id']}.json",
                 title={lang: manifest["texts"][lang]["title"] for lang in tx.LANGS},
                 analyzer=manifest["analyzer"], duration_s=round(manifest["audio"]["duration_s"], 2),
                 test=bool(manifest.get("test")))
    videos = catalog["videos"]
    for i, v in enumerate(videos):
        if v["id"] == entry["id"]:
            videos[i] = entry
            break
    else:
        videos.append(entry)
    write_catalog(catalog, web)
    return catalog


def remove_from_catalog(web, video_id, delete_assets=True):
    """Quita el video del catálogo y borra sus activos (solo los que lista su manifiesto,
    así nunca se toca otro video aunque su id empiece igual)."""
    catalog = read_catalog(web)
    catalog["videos"] = [v for v in catalog["videos"] if v["id"] != video_id]
    write_catalog(catalog, web)
    removed = []
    manifest_path = web / "public" / DATA_DIR / f"{video_id}.json"
    if delete_assets and manifest_path.exists():
        m = json.loads(manifest_path.read_text())
        srcs = [m["video"]["src"], m["timeline"]["src"]] + [s["src"] for s in m["audio"]["stems"]]
        for f in [web / "public" / src for src in srcs if relative(src)] + [manifest_path]:
            if f.exists():
                f.unlink()
                removed.append(f)
    return removed


def validate(manifest, public, reference=None):
    """Comprueba los activos tal como los leerá el navegador. Lanza BuildError si algo falla."""
    errors, assets = [], {}
    srcs = [manifest["video"]["src"], manifest["timeline"]["src"]] + [s["src"] for s in manifest["audio"]["stems"]]
    for src in srcs:
        if not relative(src):
            errors.append(f"ruta no relativa: {src}")
        f = public / src
        if not f.exists():
            errors.append(f"no existe: {f}")
            continue
        assets[src] = dict(bytes=f.stat().st_size, sha256=sha256(f))
    if errors:
        raise BuildError("; ".join(errors))

    v = manifest["video"]
    info = probe(public / v["src"])
    vs = [s for s in info["streams"] if s["codec_type"] == "video"]
    if [s for s in info["streams"] if s["codec_type"] == "audio"]:
        errors.append("el video lleva pista de audio")
    vs = vs[0]
    fps = float(Fraction(vs["r_frame_rate"]))
    if abs(fps - v["fps"]) > 1e-6:
        errors.append(f"FPS del video {fps} != {v['fps']}")
    if int(vs["nb_read_frames"]) != v["frames"]:
        errors.append(f"frames del video {vs['nb_read_frames']} != {v['frames']}")
    if (vs["width"], vs["height"]) != (v["width"], v["height"]):
        errors.append(f"tamaño {vs['width']}x{vs['height']}")
    if abs(float(vs.get("start_time", 0))) > 1e-3:
        errors.append(f"el video empieza en {vs['start_time']} s")

    au = manifest["audio"]
    limit = 10 ** (-au["headroom_db"] / 20)
    decoded, stems_report = {}, []
    for s in au["stems"]:
        x = decode(public / s["src"])
        decoded[s["id"]] = x
        r = dict(id=s["id"], samples=len(x), peak_dbfs=round(float(20 * np.log10(np.abs(x).max() + 1e-12)), 2))
        # AAC puede rellenar hasta completar su último bloque de 1024 muestras; la web para
        # cada pista en duration_s, así que ese relleno no se oye.
        pad = len(x) - au["samples"]
        r["padding_samples"] = pad
        if not 0 <= pad < 2048:
            errors.append(f"{s['id']}: {len(x)} muestras decodificadas para {au['samples']}")
        if reference is not None:
            ref = reference[s["id"]]
            r["lag_samples"] = lag(ref, x)
            n = min(len(ref), len(x))
            signal, error = float((ref[:n] ** 2).sum()), float(((ref[:n] - x[:n]) ** 2).sum())
            # una pista sin notas no tiene señal: no hay SNR que medir
            r["snr_db"] = round(10 * np.log10(signal / error), 1) if signal > 0 and error > 0 else None
            if r["lag_samples"] != 0:
                errors.append(f"{s['id']}: desfase de {r['lag_samples']} muestras tras codificar")
        stems_report.append(r)
    n = min(len(x) for x in decoded.values())
    worst = max(np.abs(sum(decoded[c][:n] for c in combo)).max()
                for r in range(1, len(decoded) + 1) for combo in itertools.combinations(decoded, r))
    if worst > 1.0:
        errors.append(f"saturación tras codificar: pico {worst:.3f} en alguna combinación de pistas")
    if au["duration_s"] < manifest["timeline"]["music_duration_s"]:
        errors.append("el audio es más corto que la música")

    sizes = dict(video=assets[v["src"]]["bytes"], timeline=assets[manifest["timeline"]["src"]]["bytes"],
                 stem=max(assets[s["src"]]["bytes"] for s in au["stems"]),
                 total=sum(a["bytes"] for a in assets.values()))
    for k, b in sizes.items():
        if b > BUDGET[k]:
            errors.append(f"{k}: {b} bytes supera el presupuesto de {BUDGET[k]}")

    if not manifest.get("test") and not any("nasa.gov" in (c.get("url") or "") for c in manifest["credits"]):
        errors.append("los créditos necesitan al menos un enlace a la fuente de NASA (nasa.gov)")
    for lang in tx.LANGS:
        if "NASA" not in manifest["texts"][lang]["notice"]:
            errors.append(f"falta el aviso de no respaldo de NASA ({lang})")

    if errors:
        raise BuildError("; ".join(errors))
    return dict(assets=assets, sizes=sizes, stems=stems_report,
                worst_combination_peak_dbfs=round(float(20 * np.log10(worst)), 2),
                video=dict(fps=fps, frames=int(vs["nb_read_frames"]), size=f"{vs['width']}x{vs['height']}",
                           kbps=round(int(info["format"]["bit_rate"]) / 1000)))


def print_report(report):
    mb = lambda b: f"{b / 1e6:.2f} MB"
    print("Activos:")
    for src, a in report["assets"].items():
        print(f"  {src:42s} {mb(a['bytes']):>9s}  {a['sha256'][:12]}")
    print(f"  total {mb(report['sizes']['total'])}")
    v = report["video"]
    print(f"Video: {v['size']}, {v['fps']:g} fps, {v['frames']} frames, {v['kbps']} kb/s")
    for s in report["stems"]:
        snr = "sin señal" if s.get("snr_db") is None else f"{s['snr_db']} dB"
        extra = f", desfase {s['lag_samples']} muestras, SNR {snr}" if "lag_samples" in s else ""
        print(f"Stem {s['id']:12s} {s['samples']} muestras, pico {s['peak_dbfs']} dBFS{extra}")
    print(f"Peor combinación de pistas (mute/solo): {report['worst_combination_peak_dbfs']} dBFS")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-only", action="store_true", required=True,
                    help="valida los activos publicados (para generarlos: jukebox.py build)")
    ap.add_argument("--id", default=None, help="solo este video (por defecto, todo el catálogo)")
    ap.add_argument("--web", type=Path, default=WEB)
    a = ap.parse_args(argv)
    ids = [a.id] if a.id else [v["id"] for v in read_catalog(a.web)["videos"]]
    if not ids:
        print("El catálogo está vacío", file=sys.stderr)
        return 1
    status = 0
    for vid in ids:
        print(f"== {vid}")
        try:
            path = a.web / "public" / DATA_DIR / f"{vid}.json"
            print_report(validate(json.loads(path.read_text()), a.web / "public"))
            print("OK")
        except (BuildError, FileNotFoundError) as e:
            print(f"ERROR: {e}", file=sys.stderr)
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main())
