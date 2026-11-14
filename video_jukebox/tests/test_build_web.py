"""build_web.py de principio a fin con un video sintético (sin descargar nada de NASA)."""
import json

import numpy as np
import pytest

import analyze
import build_web as bw
import compose
import export_timeline as et
from synthetic import write_synthetic_video


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("web")
    out, web = tmp / "out", tmp / "web"
    out.mkdir()
    video = write_synthetic_video(tmp / "v.avi", seconds=6, fps=30, size=(256, 128))
    feat = analyze.analyze(str(video), width=128)
    np.savez(out / "s_features.npz", **feat)
    events, cc, meta = compose.compose(feat)
    ev = dict(events=[list(map(float, e)) for e in events], cc=[list(map(float, c)) for c in cc], meta=meta)
    (out / "s_events.json").write_text(json.dumps(ev))
    tl = et.build_timeline(et.load_features(out / "s_features.npz"), json.loads(json.dumps(ev)), source="v.avi")
    (out / "s_timeline.json").write_text(json.dumps(tl, allow_nan=False))
    code = bw.main(["--name", "s", "--video", str(video), "--slug", "demo", "--out", str(out),
                    "--web", str(web), "--video-kbps", "300", "--audio-kbps", "96"])
    assert code == 0
    return web, json.loads((web / "public" / bw.DATA_DIR / "demo.json").read_text())


def test_manifest_points_to_relative_existing_assets(built):
    web, m = built
    srcs = [m["video"]["src"], m["timeline"]["src"]] + [s["src"] for s in m["audio"]["stems"]]
    assert all(bw.relative(s) for s in srcs)
    assert all((web / "public" / s).exists() for s in srcs)
    assert set(m["assets"]) == set(srcs)
    assert [s["id"] for s in m["audio"]["stems"]] == ["temperatura", "corrientes", "remolinos", "ecuatorial"]


def test_video_keeps_every_frame_and_has_no_audio(built):
    web, m = built
    info = bw.probe(web / "public" / m["video"]["src"])
    assert [s["codec_type"] for s in info["streams"]] == ["video"]
    assert int(info["streams"][0]["nb_read_frames"]) == m["video"]["frames"] == 180


def test_stems_decode_with_same_start_and_no_clipping(built):
    web, m = built
    xs = [bw.decode(web / "public" / s["src"]) for s in m["audio"]["stems"]]
    assert {len(x) for x in xs} and min(len(x) for x in xs) >= m["audio"]["samples"]
    assert max(np.abs(x).max() for x in xs) <= 1.0
    assert m["audio"]["duration_s"] >= m["timeline"]["music_duration_s"]


def test_credits_and_notice(built):
    _, m = built
    assert any("svs.gsfc.nasa.gov/3912" in (c["url"] or "") for c in m["credits"])
    assert "No está respaldado por NASA" in m["notice"]
    assert "no son mediciones físicas calibradas" in m["disclaimer"].lower()


def test_check_only_detects_broken_paths(built):
    web, m = built
    bad = dict(m, video=dict(m["video"], src="/media/jukebox/demo.mp4"))
    with pytest.raises(bw.BuildError, match="ruta no relativa"):
        bw.validate(bad, web / "public")
    missing = dict(m, timeline=dict(m["timeline"], src="data/jukebox/nada.json"))
    with pytest.raises(bw.BuildError, match="no existe"):
        bw.validate(missing, web / "public")
