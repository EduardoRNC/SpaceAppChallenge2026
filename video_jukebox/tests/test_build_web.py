"""build_web.py de principio a fin con un video sintético (sin descargar nada de NASA)."""
import json

import numpy as np
import pytest

import analyze
import build_web as bw
import compose
import export_timeline as et
from synthetic import write_synthetic_video

VIDEO = {
    "id": "demo",
    "analyzer": "ocean_flow",
    "svs": 3912,
    "music": compose.DEFAULT_MUSIC,
    "texts": {
        "en": {"title": "Demo", "stems": {"temperatura": {"label": "Temperature"}}},
        "es": {"title": "Demostración", "stems": {"temperatura": {"label": "Temperatura"}}},
    },
    "credits": [{"role": {"en": "Visualization", "es": "Visualización"},
                 "text": "NASA/Goddard Space Flight Center Scientific Visualization Studio",
                 "url": "https://svs.gsfc.nasa.gov/3912/"}],
}


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("web")
    web = tmp / "web"
    video = write_synthetic_video(tmp / "v.avi", seconds=6, fps=30, size=(256, 128))
    feat = analyze.analyze(str(video), width=128, progress=False)
    events, cc, meta = compose.compose(feat)
    ev = json.loads(json.dumps(dict(events=[list(map(float, e)) for e in events],
                                    cc=[list(map(float, c)) for c in cc], meta=meta)))
    tl = et.build_timeline(feat, ev, source={"video": "v.avi"})
    m, _ = bw.build(VIDEO, ev, tl, video_path=video, web=web, video_kbps=300, audio_kbps=96)
    return web, json.loads((web / "public" / bw.DATA_DIR / "demo.json").read_text())


def test_manifest_points_to_relative_existing_assets(built):
    web, m = built
    srcs = [m["video"]["src"], m["timeline"]["src"]] + [s["src"] for s in m["audio"]["stems"]]
    assert all(bw.relative(s) for s in srcs)
    assert all((web / "public" / s).exists() for s in srcs)
    assert set(m["assets"]) == set(srcs)
    assert [s["id"] for s in m["audio"]["stems"]] == ["temperatura", "corrientes", "remolinos", "ecuatorial"]
    assert [s["role"] for s in m["audio"]["stems"]] == compose.ROLES


def test_video_keeps_every_frame_and_has_no_audio(built):
    web, m = built
    info = bw.probe(web / "public" / m["video"]["src"])
    assert [s["codec_type"] for s in info["streams"]] == ["video"]
    assert int(info["streams"][0]["nb_read_frames"]) == m["video"]["frames"] == 180
    assert (m["video"]["width"], m["video"]["height"]) == (1280, 640)


def test_stems_decode_with_same_start_and_no_clipping(built):
    web, m = built
    xs = [bw.decode(web / "public" / s["src"]) for s in m["audio"]["stems"]]
    assert {len(x) for x in xs} and min(len(x) for x in xs) >= m["audio"]["samples"]
    assert max(np.abs(x).max() for x in xs) <= 1.0
    assert m["audio"]["duration_s"] >= m["timeline"]["music_duration_s"]


def test_credits_notice_and_texts(built):
    _, m = built
    assert any("svs.gsfc.nasa.gov/3912" in (c["url"] or "") for c in m["credits"])
    assert "No está respaldado por NASA" in m["notice"]
    assert "Not endorsed by NASA" in m["texts"]["en"]["notice"]
    assert "no son mediciones físicas calibradas" in m["disclaimer"].lower()
    assert m["texts"]["es"]["title"] == m["title"] == "Demostración"
    assert m["texts"]["en"]["stems"]["temperatura"]["label"] == "Temperature"
    # sin traducción en la ficha: el id de la pista
    assert m["texts"]["en"]["stems"]["remolinos"]["label"] == "remolinos"
    assert m["texts"]["en"]["metrics"]["speed"]["label"] == "Apparent motion"
    effects = m["texts"]["es"]["effects"]
    assert set(effects) == {"acordes", "temperatura", "corrientes", "remolinos", "ecuatorial"}
    assert "Latitudes medias norte" in effects["acordes"]["temp"]
    assert "más negativo" in effects["ecuatorial"]["u"]


def test_catalog_lists_the_video(built):
    web, m = built
    cat = bw.read_catalog(web)
    assert cat["schema"] == bw.CATALOG_SCHEMA
    assert [v["id"] for v in cat["videos"]] == ["demo"]
    assert cat["videos"][0]["title"] == {"en": "Demo", "es": "Demostración"}


def test_check_only_detects_broken_paths(built):
    web, m = built
    bad = dict(m, video=dict(m["video"], src="/media/jukebox/demo.mp4"))
    with pytest.raises(bw.BuildError, match="ruta no relativa"):
        bw.validate(bad, web / "public")
    missing = dict(m, timeline=dict(m["timeline"], src="data/jukebox/nada.json"))
    with pytest.raises(bw.BuildError, match="no existe"):
        bw.validate(missing, web / "public")
    no_nasa = dict(m, credits=[dict(c, url="https://example.com") for c in m["credits"]])
    with pytest.raises(bw.BuildError, match="nasa.gov"):
        bw.validate(no_nasa, web / "public")
    assert bw.main(["--check-only", "--web", str(web)]) == 0
