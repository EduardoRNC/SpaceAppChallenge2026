"""El orquestador (jukebox.py) con varios videos sintéticos, de 'add' a la web; y el contrato
que cumple cada analizador. Todo en carpetas temporales: no toca web/public ni videos/."""
import json

import numpy as np
import pytest

import analyzers
import build_web as bw
import compose
import jukebox
from analyzers.common import Frame
from synthetic import synthetic_features, write_heatmap_video, write_lights_video, write_synthetic_video


# ---------------------------------------------------------------- contrato de los analizadores
@pytest.mark.parametrize("name", sorted(analyzers.ANALYZERS))
def test_analyzer_contract(name):
    m = analyzers.get(name)
    assert m.NAME == name
    assert set(m.SUMMARY) == {"en", "es"}
    assert "cover" in m.METRICS
    for metric, fields in m.METRICS.items():
        assert set(fields) == {"label", "unit", "derived_from", "caveat"}, metric
        for f, text in fields.items():
            assert text["en"].strip() and text["es"].strip(), (metric, f)
    compose.check_music(m.DEFAULT_MUSIC, m.METRICS)
    rng = np.random.default_rng(0)
    bgr = rng.integers(0, 255, (64, 128, 3), dtype=np.uint8)
    import cv2
    cur = Frame(bgr, cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV))
    maps, mask = m.measure(cur, cur)
    assert set(maps) == set(m.METRICS) - {"cover"}
    assert all(x.shape == (64, 128) for x in maps.values())
    assert mask.shape == (64, 128) and mask.dtype == bool
    assert np.array_equal(m.mask(cur), mask)


def test_unknown_analyzer_has_a_clear_error():
    with pytest.raises(KeyError, match="disponibles"):
        analyzers.get("nada")


# ---------------------------------------------------------------- música por ficha
def test_music_errors_are_explained():
    metrics = analyzers.get("ocean_flow").METRICS
    music = json.loads(json.dumps(compose.DEFAULT_MUSIC))
    music["tracks"][1]["activity"] = "brillo"
    with pytest.raises(compose.MusicError, match="brillo"):
        compose.check_music(music, metrics)
    music = json.loads(json.dumps(compose.DEFAULT_MUSIC))
    music["tracks"][2]["role"] = "pad"
    with pytest.raises(compose.MusicError, match="papeles"):
        compose.check_music(music, metrics)
    music = json.loads(json.dumps(compose.DEFAULT_MUSIC))
    music["harmony"] = {"metric": "temp", "mode": "contrast", "regions": ["tropicos"]}
    with pytest.raises(compose.MusicError, match="2 franjas"):
        compose.check_music(music, metrics)


def test_music_from_the_video_file_changes_the_notes():
    feat = synthetic_features(seconds=12)
    base, _, meta = compose.compose(feat)
    music = json.loads(json.dumps(compose.DEFAULT_MUSIC))
    music["harmony"] = {"metric": "speed", "mode": "mean"}
    music["tracks"][3].update(metric="vort", region="artico", direction=1)
    other, _, meta2 = compose.compose(feat, music=music)
    assert base != other
    assert meta2["mapping"]["harmony"] == [dict(metric="speed", regions="all", slot="harmony", mode="mean")]
    assert meta2["mapping"]["tracks"]["ecuatorial"]["uses"] == [
        dict(metric="vort", regions=["artico"], slot="metric", direction=1)]


def test_mapping_merges_a_measure_used_twice_by_the_voices():
    music = json.loads(json.dumps(analyzers.get("night_lights").DEFAULT_MUSIC))
    music["tracks"][1]["pitch"] = music["tracks"][1]["activity"]
    uses = compose.mapping_of(music)["tracks"]["ciudades"]["uses"]
    assert [u["slot"] for u in uses] == ["activity+pitch", "timbre"]


# ---------------------------------------------------------------- orquestador
@pytest.fixture()
def repo(tmp_path, monkeypatch):
    """Un 'repo' vacío en tmp: fichas, salidas, medios y web."""
    monkeypatch.setattr(jukebox, "ROOT", tmp_path)
    monkeypatch.setattr(jukebox, "VIDEOS", tmp_path / "videos")
    monkeypatch.setattr(jukebox, "OUT", tmp_path / "out")
    monkeypatch.setattr(jukebox, "MEDIA", tmp_path / "data" / "media")
    monkeypatch.setattr(jukebox, "WEB", tmp_path / "web")
    return tmp_path


def run(*args):
    return jukebox.main([str(a) for a in args])


def test_add_build_list_remove_several_videos(repo, capsys):
    heat = write_heatmap_video(repo / "calor.avi", seconds=4, size=(256, 128))
    lights = write_lights_video(repo / "luces.avi", seconds=4, size=(256, 128))
    lines = write_synthetic_video(repo / "lineas.avi", seconds=4, size=(256, 128))

    assert run("add", "calor", "--video", heat, "--analyzer", "color_map", "--test",
               "--title-en", "Heat", "--title-es", "Calor") == 0
    assert run("add", "luces", "--video", lights, "--analyzer", "night_lights", "--test", "--title", "Luces") == 0
    assert run("add", "lineas", "--video", lines, "--analyzer", "ocean_flow", "--svs", "3912",
               "--date-range", "2007-03-25T12:00Z", "2007-04-25T12:00Z", "--title", "Líneas") == 0
    ficha = json.loads((repo / "videos" / "calor.json").read_text())
    assert ficha["analyzer"] == "color_map" and ficha["test"] is True
    assert ficha["source"]["video"] == "data/media/calor/calor.avi"
    assert (repo / "data" / "media" / "calor" / "calor.avi").exists(), "el video se copia a data/media"

    assert run("add", "calor", "--video", heat, "--analyzer", "color_map", "--test") == 1, "no pisa una ficha"
    assert run("add", "sin_credito", "--video", heat, "--analyzer", "color_map") == 1, "pide créditos"

    assert run("build", "--all", "--video-kbps", "200", "--audio-kbps", "96") == 0
    cat = bw.read_catalog(repo / "web")
    assert [v["id"] for v in cat["videos"]] == ["calor", "lineas", "luces"]
    by_id = {v["id"]: v for v in cat["videos"]}
    assert by_id["calor"]["title"] == {"en": "Heat", "es": "Calor"}
    assert by_id["calor"]["test"] and not by_id["lineas"]["test"]
    for vid, analyzer in (("calor", "color_map"), ("luces", "night_lights"), ("lineas", "ocean_flow")):
        m = json.loads((repo / "web" / "public" / bw.DATA_DIR / f"{vid}.json").read_text())
        tl = json.loads((repo / "web" / "public" / m["timeline"]["src"]).read_text())
        assert m["analyzer"] == tl["analyzer"] == analyzer
        assert list(tl["features"]["metrics"]) == list(analyzers.get(analyzer).METRICS)
        assert list(tl["mapping"]["tracks"]) == [s["id"] for s in m["audio"]["stems"]]
        assert (repo / "out" / vid / f"{vid}.mid").exists()
    assert json.loads((repo / "web" / "public" / bw.DATA_DIR / "lineas.json").read_text())["model_time"]["first"] \
        == "2007-03-25T12:00Z"

    # segunda vez: reutiliza el análisis
    capsys.readouterr()
    assert run("build", "luces", "--skip-video", "--audio-kbps", "96") == 0
    assert "reutilizo" in capsys.readouterr().out

    assert run("check") == 0
    assert run("list") == 0
    out = capsys.readouterr().out
    assert "calor" in out and "en la web" in out

    assert run("remove", "luces") == 0
    assert [v["id"] for v in bw.read_catalog(repo / "web")["videos"]] == ["calor", "lineas"]
    assert not list((repo / "web" / "public").rglob("luces*"))
    assert (repo / "web" / "public" / bw.DATA_DIR / "lineas.json").exists(), "no toca otros videos"
    assert not (repo / "videos" / "luces.json").exists()


def test_build_reports_missing_video(repo, capsys):
    video = write_heatmap_video(repo / "x.avi", seconds=2, size=(128, 64))
    assert run("add", "perdido", "--video", video, "--analyzer", "color_map", "--test", "--no-copy") == 0
    video.unlink()
    assert run("build", "perdido") == 1
    assert "no encuentro el video" in capsys.readouterr().err


def test_try_reports_every_analyzer(repo, capsys):
    video = write_lights_video(repo / "l.avi", seconds=2, size=(128, 64))
    assert run("try", video, "--frames", "20") == 0
    out = capsys.readouterr().out
    for name in analyzers.ANALYZERS:
        assert name in out


def test_the_ecco2_file_in_the_repo_is_valid():
    video = jukebox.load_video("ecco2")
    assert video["analyzer"] == "ocean_flow"
    assert video["music"] == compose.DEFAULT_MUSIC
    assert any("svs.gsfc.nasa.gov/3912" in (c.get("url") or "") for c in video["credits"])
