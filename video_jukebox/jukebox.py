"""
Orquestador del Earth Information Jukebox: varios videos de NASA -> música -> web.

Cada video tiene su ficha en videos/<id>.json: qué analizador usa, de dónde sale el video,
qué medida controla cada pista y sus textos en inglés y español. Este script hace todo el
camino para uno o para todos:

    video ─► analizador ─► features.npz ─► compose ─► events.json + .mid
                                              └─► export_timeline ─► timeline.json
                                                       └─► build_web ─► web/public (+ catálogo)

Comandos (desde video_jukebox/):
    python jukebox.py analyzers                      tipos de video que sabemos analizar
    python jukebox.py try VIDEO                      prueba todos los analizadores en un video nuevo
    python jukebox.py add ID --video V --analyzer A  registra un video nuevo (crea videos/ID.json)
    python jukebox.py list                           videos registrados y su estado
    python jukebox.py fetch ID                       descarga los archivos de la ficha
    python jukebox.py build ID [ID...] | --all       analiza, compone y publica en la web
    python jukebox.py preview ID                     solo el video con música (out/ID/preview.mp4)
    python jukebox.py remove ID                      lo quita de la web (y su ficha)
    python jukebox.py check                          valida fichas y activos publicados
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np

import analyzers
import build_web as bw
import compose
import export_timeline as et
import render_preview as rp

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VIDEOS = HERE / "videos"
OUT = HERE / "out"
MEDIA = ROOT / "data" / "media"
WEB = bw.WEB
WIDTH = 512


class JukeboxError(RuntimeError):
    pass


# ----------------------------------------------------------------------------- fichas
def video_path(vid):
    return VIDEOS / f"{vid}.json"


def load_video(vid):
    p = video_path(vid)
    if not p.exists():
        raise JukeboxError(f"no hay ficha para '{vid}' ({p.relative_to(ROOT)}); usa 'add'")
    video = json.loads(p.read_text())
    if video.get("id") != vid:
        raise JukeboxError(f"{p.name}: el id de dentro ({video.get('id')}) no coincide con el nombre")
    analyzer = analyzers.get(video["analyzer"])
    video.setdefault("music", analyzer.DEFAULT_MUSIC)
    compose.check_music(video["music"], analyzer.METRICS)
    return video


def all_ids():
    return sorted(p.stem for p in VIDEOS.glob("*.json"))


def resolve(path):
    """Las rutas de las fichas son relativas a la raíz del repo."""
    p = Path(path)
    return p if p.is_absolute() else ROOT / p


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(Path(path).resolve())


# ----------------------------------------------------------------------------- analyzers / try
def cmd_analyzers(a):
    for name, m in analyzers.ANALYZERS.items():
        print(f"{name}\n  {m.SUMMARY['es']}")
        print("  medidas: " + ", ".join(f"{k} ({v['label']['es']})" for k, v in m.METRICS.items()))
        tracks = ", ".join(f"{t['id']}={t['role']}" for t in m.DEFAULT_MUSIC["tracks"])
        print(f"  música por defecto: acordes con '{m.DEFAULT_MUSIC['harmony']['metric']}'; {tracks}\n")


def sample(path, frames, width):
    """Los primeros `frames` frames, en un video temporal (los analizadores leen secuencias)."""
    tmp = OUT / "_try"
    tmp.mkdir(parents=True, exist_ok=True)
    clip = tmp / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-frames:v", str(frames),
                    "-vf", f"scale={width}:-2", "-an", "-c:v", "libx264", "-qp", "0", str(clip)],
                   check=True)
    return clip


def cmd_try(a):
    clip = sample(a.video, a.frames, 256)
    print(f"Muestra: {a.frames} primeros frames de {a.video}\n")
    for name, m in analyzers.ANALYZERS.items():
        feat = analyzers.analyze_video(clip, m, width=256, progress=False)
        cover = float(feat["cover"].mean())
        print(f"{name}: cobertura media {cover:.2f}")
        for k in m.METRICS:
            if k == "cover":
                continue
            x = feat[k]
            spread = float(np.std(x) / (np.mean(np.abs(x)) + 1e-9))
            print(f"   {k:8s} media {np.mean(x):8.4f}  variación relativa {spread:6.2f}")
    print("\nCómo elegir:")
    print("  - 'night_lights' si el video es la Tierra de noche (fondo negro con luces).")
    print("  - 'ocean_flow' si lo importante es algo que se MUEVE (líneas, partículas, viento).")
    print("  - 'color_map' si es un mapa de calor que cambia de color (temperatura, CO2...).")
    print("  Una cobertura < 0.05 en un analizador significa que su máscara casi no ve nada.")
    print("  Antes de construir, revisa textos o leyendas fijas con: "
          f"python mask_check.py {a.video} out/check --analyzer <nombre>")


# ----------------------------------------------------------------------------- add
def cmd_add(a):
    vid = a.id
    if not vid.replace("_", "").isalnum() or not vid.islower():
        raise JukeboxError("el id debe ser corto, en minúsculas, con letras, números o '_' (p. ej. black_marble)")
    if video_path(vid).exists() and not a.force:
        raise JukeboxError(f"ya existe {video_path(vid).relative_to(ROOT)} (usa --force para reemplazarla)")
    analyzer = analyzers.get(a.analyzer)
    dest = MEDIA / vid
    downloads = []
    if a.url:
        name = a.url.rstrip("/").split("/")[-1] or f"{vid}.mp4"
        downloads.append(dict(url=a.url, file=rel(dest / name)))
        source_video = dest / name
    else:
        src = Path(a.video).resolve()
        if not src.exists():
            raise JukeboxError(f"no existe {src}")
        if a.no_copy:
            source_video = src
        else:
            dest.mkdir(parents=True, exist_ok=True)
            source_video = dest / src.name
            if source_video != src:
                print(f"Copiando {src.name} a {rel(dest)}/ (no se sube a git)...")
                shutil.copy2(src, source_video)
    title_en = a.title_en or a.title or vid
    title_es = a.title_es or a.title or title_en
    credits = []
    if a.svs:
        credits.append({"role": {"en": "Visualization", "es": "Visualización"},
                        "text": "NASA/Goddard Space Flight Center Scientific Visualization Studio",
                        "url": f"https://svs.gsfc.nasa.gov/{a.svs}/"})
    elif a.credit_url:
        credits.append({"role": {"en": "Source", "es": "Fuente"}, "text": a.credit_text or a.credit_url,
                        "url": a.credit_url})
    elif a.test:
        credits.append({"role": {"en": "Test video", "es": "Video de prueba"},
                        "text": {"en": "Synthetic video, not NASA data", "es": "Video sintético, no son datos de NASA"},
                        "url": None})
    else:
        raise JukeboxError("indica de dónde sale el video: --svs ID (página del NASA SVS) o --credit-url URL "
                           "(o --test si es un video de prueba)")
    video = {
        "id": vid,
        "analyzer": analyzer.NAME,
        "svs": a.svs,
        "source": {"video": rel(source_video), "downloads": downloads},
        "music": analyzer.DEFAULT_MUSIC,
        "texts": {
            "en": {"title": title_en, "intro": a.intro_en or "", "caption": a.caption_en or "",
                   "proxy_note": "",
                   "stems": {t["id"]: {"label": t["id"].replace("_", " ").capitalize()}
                             for t in analyzer.DEFAULT_MUSIC["tracks"]}},
            "es": {"title": title_es, "intro": a.intro_es or "", "caption": a.caption_es or "",
                   "proxy_note": "",
                   "stems": {t["id"]: {"label": t["id"].replace("_", " ").capitalize()}
                             for t in analyzer.DEFAULT_MUSIC["tracks"]}},
        },
        "credits": credits,
    }
    if a.test:
        video["test"] = True
    if a.date_range:
        video["source"]["date_range"] = a.date_range
    VIDEOS.mkdir(exist_ok=True)
    video_path(vid).write_text(json.dumps(video, indent=2, ensure_ascii=False) + "\n")
    print(f"OK: {video_path(vid).relative_to(ROOT)}")
    print("Siguiente:")
    if a.url:
        print(f"  python jukebox.py fetch {vid}")
    print(f"  (opcional) edita videos/{vid}.json: nombres de pista, textos y qué medida controla cada pista")
    print(f"  python jukebox.py preview {vid}     # escucharlo sin tocar la web")
    print(f"  python jukebox.py build {vid}       # publicarlo en la web")
    if a.build:
        cmd_build(argparse.Namespace(ids=[vid], all=False, skip_video=False, force=False,
                                     preview=True, width=WIDTH, video_kbps=1200, audio_kbps=128))


# ----------------------------------------------------------------------------- list / fetch
def cmd_list(a):
    catalog = [v["id"] for v in bw.read_catalog(WEB)["videos"]]
    ids = all_ids()
    if not ids:
        print("No hay videos registrados: usa 'python jukebox.py add'")
    for vid in ids:
        try:
            v = load_video(vid)
            src = resolve(v["source"]["video"])
            state = [("video ok" if src.exists() else "falta el video (fetch)"),
                     ("en la web" if vid in catalog else "sin publicar")]
            title = v["texts"].get("es", {}).get("title", vid)
            print(f"{vid:16s} {v['analyzer']:13s} {' · '.join(state):34s} {title}")
        except Exception as e:  # noqa: BLE001 - mostrar todas las fichas aunque una falle
            print(f"{vid:16s} ERROR: {e}")
    for vid in catalog:
        if vid not in ids:
            print(f"{vid:16s} (en la web pero sin ficha)")


def download(url, dest, size=None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (size is None or dest.stat().st_size == size):
        print(f"  ya está: {rel(dest)}")
        return
    print(f"  bajando {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urlopen(Request(url, headers={"User-Agent": "earth-jukebox"}), timeout=60) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    if size is not None and tmp.stat().st_size != size:
        raise JukeboxError(f"{dest.name}: {tmp.stat().st_size} bytes, se esperaban {size}")
    tmp.replace(dest)


def cmd_fetch(a):
    for vid in a.ids:
        v = load_video(vid)
        items = v["source"].get("downloads", [])
        if not items:
            print(f"{vid}: la ficha no tiene descargas (el video es local: {v['source']['video']})")
        for d in items:
            download(d["url"], resolve(d["file"]), d.get("bytes"))


# ----------------------------------------------------------------------------- build
def features_for(vid, video, src, width, force):
    """Analiza el video, o reutiliza out/ID/features.npz si el video y el analizador no cambiaron."""
    out = OUT / vid
    out.mkdir(parents=True, exist_ok=True)
    npz, stamp_path = out / "features.npz", out / "features.json"
    st = src.stat()
    stamp = dict(video=rel(src), bytes=st.st_size, mtime=int(st.st_mtime), analyzer=video["analyzer"],
                 width=width)
    if not force and npz.exists() and stamp_path.exists() and json.loads(stamp_path.read_text()) == stamp:
        print(f"  1/4 análisis: reutilizo {rel(npz)}")
    else:
        print(f"  1/4 análisis ({video['analyzer']}, {width} px)...")
        np.savez(npz, **analyzers.analyze_video(src, analyzers.get(video["analyzer"]), width))
        stamp_path.write_text(json.dumps(stamp, indent=2))
    with np.load(npz) as z:
        return {k: z[k] for k in z.files}


def write_preview(vid, events, src):
    out = OUT / vid
    wav, mp4 = out / "preview.wav", out / "preview.mp4"
    rp.write_wav(wav, rp.render(events))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                    "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", str(mp4)], check=True)
    return mp4


def pipeline(vid, width=WIDTH, force=False):
    """Pasos 1-3 (análisis, música, timeline) en out/ID/. Devuelve (ficha, events, timeline, video)."""
    video = load_video(vid)
    src = resolve(video["source"]["video"])
    if not src.exists():
        hint = f"python jukebox.py fetch {vid}" if video["source"].get("downloads") else "revisa source.video"
        raise JukeboxError(f"{vid}: no encuentro el video {rel(src)} ({hint})")
    feat = features_for(vid, video, src, width, force)
    out = OUT / vid
    print("  2/4 música...")
    events_list, cc, meta = compose.compose(feat, compose.BPM, video["music"])
    events = dict(events=[list(map(float, e)) for e in events_list],
                  cc=[list(map(float, c)) for c in cc], meta=meta)
    (out / "events.json").write_text(json.dumps(events))
    compose.write_midi(out / f"{vid}.mid", events_list, cc, meta["bpm"], meta["tracks"])
    print(f"      {len(events_list)} notas, {meta['nbars']} compases, acordes: {' '.join(meta['chords'][:8])}…")
    print("  3/4 timeline...")
    try:
        timeline = et.build_timeline(feat, events, dict(video=src.name, features="features.npz",
                                                        events="events.json", id=vid))
    except et.TimelineError as e:
        raise JukeboxError(f"{vid}: {e}") from None
    (out / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, allow_nan=False))
    for w in timeline["validation"]["warnings"]:
        print(f"      aviso: {w}")
    return video, events, timeline, src


def cmd_build(a):
    ids = all_ids() if a.all else a.ids
    if not ids:
        raise JukeboxError("indica uno o más ids, o --all")
    failed = []
    for vid in ids:
        print(f"== {vid}")
        try:
            video, events, timeline, src = pipeline(vid, a.width, a.force)
            if a.preview:
                print(f"      preview: {rel(write_preview(vid, events, src))}")
            print("  4/4 web...")
            dates = video["source"].get("dates")
            dates = resolve(dates) if dates and resolve(dates).exists() else None
            manifest, report = bw.build(video, events, timeline, video_path=src, dates=dates,
                                        skip_video=a.skip_video, web=WEB,
                                        video_kbps=a.video_kbps, audio_kbps=a.audio_kbps)
            bw.print_report(report)
            print(f"OK: {vid} publicado en web/public ({manifest['texts']['es']['title']})")
        except (JukeboxError, bw.BuildError, compose.MusicError, KeyError) as e:
            print(f"ERROR: {e}", file=sys.stderr)
            failed.append(vid)
    if failed:
        raise JukeboxError(f"fallaron: {', '.join(failed)}")


def cmd_preview(a):
    for vid in a.ids:
        print(f"== {vid}")
        _, events, _, src = pipeline(vid, a.width, a.force)
        print(f"OK: {rel(write_preview(vid, events, src))}")


# ----------------------------------------------------------------------------- remove / check
def cmd_remove(a):
    removed = bw.remove_from_catalog(WEB, a.id)
    for f in removed:
        print(f"  borrado {rel(f)}")
    if not a.keep_file and video_path(a.id).exists():
        video_path(a.id).unlink()
        print(f"  borrada la ficha videos/{a.id}.json")
    print(f"OK: '{a.id}' ya no está en la web")


def cmd_check(a):
    problems = 0
    for vid in all_ids():
        try:
            load_video(vid)
            print(f"ficha {vid}: ok")
        except Exception as e:  # noqa: BLE001
            print(f"ficha {vid}: ERROR {e}")
            problems += 1
    for v in bw.read_catalog(WEB)["videos"]:
        try:
            m = json.loads((WEB / "public" / v["manifest"]).read_text())
            bw.validate(m, WEB / "public")
            print(f"web {v['id']}: ok")
        except Exception as e:  # noqa: BLE001
            print(f"web {v['id']}: ERROR {e}")
            problems += 1
    if problems:
        raise JukeboxError(f"{problems} problema(s)")


# ----------------------------------------------------------------------------- CLI
def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("analyzers", help="tipos de video que sabemos analizar").set_defaults(fn=cmd_analyzers)

    p = sub.add_parser("try", help="prueba todos los analizadores en los primeros frames de un video")
    p.add_argument("video")
    p.add_argument("--frames", type=int, default=150)
    p.set_defaults(fn=cmd_try)

    p = sub.add_parser("add", help="registra un video nuevo")
    p.add_argument("id", help="nombre corto: minúsculas, números y _ (p. ej. black_marble)")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--video", help="archivo de video local (se copia a data/media/ID/)")
    src.add_argument("--url", help="URL del video (se baja con 'fetch')")
    p.add_argument("--analyzer", required=True, choices=sorted(analyzers.ANALYZERS))
    p.add_argument("--title", help="título (mismo en los dos idiomas)")
    p.add_argument("--title-en"); p.add_argument("--title-es")
    p.add_argument("--intro-en"); p.add_argument("--intro-es")
    p.add_argument("--caption-en"); p.add_argument("--caption-es")
    p.add_argument("--svs", type=int, help="id de la página del NASA SVS (para los créditos)")
    p.add_argument("--credit-url", help="si no es del SVS: página de la fuente")
    p.add_argument("--credit-text")
    p.add_argument("--date-range", nargs=2, metavar=("PRIMERO", "ULTIMO"),
                   help="fecha del primer y último frame, p. ej. 2012-01-01T00:00Z 2016-12-31T00:00Z")
    p.add_argument("--test", action="store_true",
                   help="video de prueba (no de NASA): no exige créditos de NASA y la web lo marca")
    p.add_argument("--no-copy", action="store_true", help="no copiar el video, usar la ruta tal cual")
    p.add_argument("--force", action="store_true", help="reemplazar la ficha si existe")
    p.add_argument("--build", action="store_true", help="construir y publicar en seguida")
    p.set_defaults(fn=cmd_add)

    sub.add_parser("list", help="videos registrados y su estado").set_defaults(fn=cmd_list)

    p = sub.add_parser("fetch", help="descarga los archivos de la ficha")
    p.add_argument("ids", nargs="+")
    p.set_defaults(fn=cmd_fetch)

    for name, fn, helptext in (("build", cmd_build, "analiza, compone y publica en la web"),
                               ("preview", cmd_preview, "solo el video con música en out/ID/")):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("ids", nargs="*")
        if name == "build":
            p.add_argument("--all", action="store_true", help="todos los videos registrados")
            p.add_argument("--skip-video", action="store_true", help="reutiliza el video web ya codificado")
            p.add_argument("--preview", action="store_true", help="escribe también out/ID/preview.mp4")
            p.add_argument("--video-kbps", type=int, default=1200, help="calidad del video web")
            p.add_argument("--audio-kbps", type=int, default=128, help="calidad de los stems AAC")
        p.add_argument("--force", action="store_true", help="vuelve a analizar aunque haya caché")
        p.add_argument("--width", type=int, default=WIDTH, help="ancho de análisis en píxeles")
        p.set_defaults(fn=fn)

    p = sub.add_parser("remove", help="quita un video de la web")
    p.add_argument("id")
    p.add_argument("--keep-file", action="store_true", help="no borrar videos/ID.json")
    p.set_defaults(fn=cmd_remove)

    sub.add_parser("check", help="valida fichas y activos publicados").set_defaults(fn=cmd_check)
    return ap


def main(argv=None):
    a = parser().parse_args(argv)
    try:
        a.fn(a)
    except (JukeboxError, compose.MusicError, KeyError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
