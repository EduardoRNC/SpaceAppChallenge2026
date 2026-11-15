"""
Prepara los activos finales de la demo web del jukebox (web/jukebox.html).

A partir de las salidas de run.sh (out/<nombre>_events.json y _timeline.json) y del video
original escribe, con rutas relativas a la página (GitHub Pages):

  web/public/media/jukebox/<slug>.mp4             video H.264 1280x640, sin audio, 2 pasadas
  web/public/media/jukebox/<slug>_<pista>.m4a     4 stems FM (AAC), misma longitud y comienzo
  web/public/data/jukebox/<slug>_timeline.json    timeline.json minificado
  web/public/data/jukebox/<slug>.json             manifiesto: rutas, tiempos, pistas, créditos

Después valida lo escrito: frames y FPS del video, longitud y desfase de los stems decodificados,
saturación en cualquier combinación de mute/solo, tamaños, rutas y créditos.

Uso (desde video_jukebox/):
    python build_web.py --name ecco2_full --video ../data/media/ecco2/ecco2_sst_flow.mp4 \\
        --dates ../data/media/ecco2/flat_ecco2_dates.txt
    python build_web.py ... --check-only      # solo valida los activos existentes
"""
import argparse
import hashlib
import itertools
import json
import subprocess
import sys
import tempfile
import json
import os
import subprocess
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

import numpy as np

import render_preview as rp
from compose import TRACKS

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"
SCHEMA = "earth-jukebox-web"
VERSION = 1
MEDIA_DIR = "media/jukebox"
DATA_DIR = "data/jukebox"
BUDGET = dict(video=12_000_000, stem=1_500_000, timeline=1_000_000, total=20_000_000)

STEM_STYLE = {
    "temperatura": dict(label="Temperatura", color="#ff6b4a"),
    "corrientes": dict(label="Corrientes", color="#4cc9f0"),
    "remolinos": dict(label="Remolinos", color="#c77dff"),
    "ecuatorial": dict(label="Corriente ecuatorial", color="#f4b942"),
}

CREDITS = [
    dict(role="Visualización",
         text="NASA/Goddard Space Flight Center Scientific Visualization Studio",
         detail="Greg Shirah, Horace Mitchell (NASA/GSFC), Eric Sokolowsky (GST)",
         url="https://svs.gsfc.nasa.gov/3912/"),
    dict(role="Ciencia",
         text="Modelo ECCO2 (MIT/JPL)",
         detail="Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL)",
         url="https://ecco.jpl.nasa.gov/"),
    dict(role="Música",
         text="Generada por este proyecto a partir de índices visuales del video",
         detail="Preview FM de 2 operadores (no es Dexed ni un DX7 real)",
         url=None),
]
NOTICE = ("Proyecto para NASA Space Apps Challenge 2026. No está respaldado por NASA. "
          "Visualización de dominio público del NASA SVS.")


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


def encode_video(src, dst, kbps, size=(1280, 640)):
    with tempfile.TemporaryDirectory() as tmp:
        log = Path(tmp) / "x264"
        common = ["ffmpeg", "-v", "error", "-y", "-i", src, "-an",
                  "-vf", f"scale={size[0]}:{size[1]}:flags=lanczos", "-fps_mode", "passthrough",
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


def build(a):
    events = json.loads((a.out / f"{a.name}_events.json").read_text())
    tl_path = a.out / f"{a.name}_timeline.json"
    timeline = json.loads(tl_path.read_text())
    if timeline.get("schema") != "earth-jukebox-timeline":
        raise BuildError(f"{tl_path} no es un timeline del jukebox")
    if timeline["validation"]["status"] != "ok":
        print("Aviso: el timeline tiene avisos:", timeline["validation"]["warnings"], file=sys.stderr)

    media, data = a.web / "public" / MEDIA_DIR, a.web / "public" / DATA_DIR
    media.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True)

    video = media / f"{a.slug}.mp4"
    if a.skip_video and video.exists():
        print(f"Video existente: {video}")
    else:
        print(f"Codificando video ({a.video_kbps} kb/s, 2 pasadas)...")
        encode_video(a.video, video, a.video_kbps)

    print("Renderizando y codificando stems...")
    stems = encode_stems(events, media, a.slug, a.audio_kbps)
    reference = stems.pop("reference")

    tl_out = data / f"{a.slug}_timeline.json"
    tl_out.write_text(json.dumps(timeline, separators=(",", ":"), allow_nan=False))

    timing = timeline["timing"]
    manifest = dict(
        schema=SCHEMA, version=VERSION,
        title="Corrientes y temperatura del océano (ECCO2)",
        generated_by="video_jukebox/build_web.py",
        paths_relative_to="la página (web/jukebox.html); válido con base './' en GitHub Pages",
        video=dict(src=f"{MEDIA_DIR}/{video.name}", fps=timing["fps"],
                   frames=timing["frames"] + timing["frame_offset"],
                   duration_s=timing["video_duration_s"], width=1280, height=640),
        audio=dict(sample_rate=stems["sample_rate"], samples=stems["samples"],
                   duration_s=stems["duration_s"], gain=stems["gain"],
                   headroom_db=stems["headroom_db"], codec=f"AAC {a.audio_kbps} kb/s",
                   stems=[dict(id=s["id"], channel=s["channel"], **STEM_STYLE[s["id"]],
                               instrument=TRACKS[s["id"]]["name"],
                               src=f"{MEDIA_DIR}/{s['file']}", first_note_s=s["first_note_s"])
                          for s in stems["stems"]]),
        timeline=dict(src=f"{DATA_DIR}/{tl_out.name}", bpm=timing["bpm"],
                      music_duration_s=timing["music_duration_s"]),
        model_time=model_dates(a.dates, timing["frames"] + timing["frame_offset"]) if a.dates else None,
        credits=CREDITS, notice=NOTICE,
        disclaimer=timeline["disclaimer"],
    )
    report = validate(manifest, a.web / "public", reference)
    manifest["assets"] = report["assets"]
    (data / f"{a.slug}.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    return manifest, report


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
            r["snr_db"] = round(float(10 * np.log10((ref[:n] ** 2).sum() / ((ref[:n] - x[:n]) ** 2).sum())), 1)
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

    texts = json.dumps(manifest["credits"]) + manifest["notice"]
    for needed in ("NASA/Goddard Space Flight Center Scientific Visualization Studio",
                   "svs.gsfc.nasa.gov/3912", "ECCO2", "No está respaldado por NASA"):
        if needed not in texts:
            errors.append(f"falta en los créditos: {needed}")

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
        extra = f", desfase {s['lag_samples']} muestras, SNR {s['snr_db']} dB" if "lag_samples" in s else ""
        print(f"Stem {s['id']:12s} {s['samples']} muestras, pico {s['peak_dbfs']} dBFS{extra}")
    print(f"Peor combinación de pistas (mute/solo): {report['worst_combination_peak_dbfs']} dBFS")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True, help="prefijo de las salidas en out/ (p. ej. ecco2_full)")
    ap.add_argument("--video", type=Path, help="video original analizado")
    ap.add_argument("--dates", type=Path, help="fechas del modelo por frame (opcional)")
    ap.add_argument("--slug", default="ecco2", help="nombre de los activos web")
    ap.add_argument("--out", type=Path, default=HERE / "out", help="carpeta con las salidas de run.sh")
    ap.add_argument("--web", type=Path, default=WEB)
    ap.add_argument("--video-kbps", type=int, default=1200)
    ap.add_argument("--audio-kbps", type=int, default=128)
    ap.add_argument("--skip-video", action="store_true", help="reutiliza el video web si ya existe")
    ap.add_argument("--check-only", action="store_true", help="valida los activos existentes")
    a = ap.parse_args(argv)
    try:
        if a.check_only:
            path = a.web / "public" / DATA_DIR / f"{a.slug}.json"
            report = validate(json.loads(path.read_text()), a.web / "public")
        else:
            if not a.video and not a.skip_video:
                ap.error("--video es obligatorio salvo con --skip-video o --check-only")
            _, report = build(a)
    except BuildError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print_report(report)
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
