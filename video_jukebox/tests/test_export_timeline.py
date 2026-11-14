"""Tests del jukebox con datos sintéticos (no hace falta ningún video de NASA).

Uso:  .venv/bin/pytest video_jukebox/tests
"""
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import compose
import export_timeline as et
from synthetic import synthetic_features, write_synthetic_video

JUKEBOX = Path(__file__).resolve().parents[1]
REGIONS = ["artico", "norte_medio", "tropicos", "sur_medio", "antartico"]
CHANNELS = ["temperatura", "corrientes", "remolinos", "ecuatorial"]


def events_for(feat, bpm=compose.BPM):
    """Lo mismo que escribe `compose.py --events`, pasado por JSON."""
    events, cc, meta = compose.compose(feat, bpm)
    ev = dict(events=[list(map(float, e)) for e in events],
              cc=[list(map(float, c)) for c in cc], meta=meta)
    return json.loads(json.dumps(ev))


def strict_json(tl):
    """Serializa como el CLI y vuelve a leer rechazando NaN/Infinity."""
    def no_constants(c):
        raise ValueError(f"constante no válida en JSON: {c}")
    return json.loads(json.dumps(tl, allow_nan=False), parse_constant=no_constants)


def midi_note_ons(path):
    """(tpq, [(tick, canal, nota)]) de un MIDI escrito por compose.write_midi."""
    data = Path(path).read_bytes()
    assert data[:4] == b"MThd"
    _, _, ntrk, tpq = struct.unpack(">IHHH", data[4:14])

    def vlq(p):
        n = 0
        while True:
            b = data[p]; p += 1
            n = (n << 7) | (b & 0x7F)
            if b < 0x80:
                return n, p

    pos, out = 14, []
    for _ in range(ntrk):
        assert data[pos:pos + 4] == b"MTrk"
        end = pos + 8 + struct.unpack(">I", data[pos + 4:pos + 8])[0]
        p, tick = pos + 8, 0
        while p < end:
            d, p = vlq(p)
            tick += d
            st = data[p]
            if st == 0xFF:
                ln, p = vlq(p + 2)
                p += ln
            elif st & 0xF0 == 0xC0:
                p += 2
            else:
                if st & 0xF0 == 0x90 and data[p + 2] > 0:
                    out.append((tick, st & 0x0F, data[p + 1]))
                p += 3
        pos = end
    return tpq, out


@pytest.fixture(scope="module")
def feat():
    return synthetic_features()


@pytest.fixture(scope="module")
def timeline(feat):
    return et.build_timeline(feat, events_for(feat))


# --- Estructura -----------------------------------------------------------

def test_five_regions_and_four_channels(timeline):
    assert [r["id"] for r in timeline["regions"]] == REGIONS
    assert [c["id"] for c in timeline["channels"]] == CHANNELS
    assert sorted({n["track"] for n in timeline["notes"]}) == sorted(CHANNELS)


def test_timeline_is_strict_json(timeline):
    assert strict_json(timeline)["schema"] == et.SCHEMA


def test_feature_series_aligned_with_frames(feat, timeline):
    n, fps = feat["temp"].shape[0], float(feat["fps"])
    t = timeline["features"]["t"]
    assert len(t) == n
    assert t[0] == pytest.approx(1 / fps, abs=1e-6) and t[-1] == pytest.approx(n / fps, abs=1e-6)
    for m in timeline["features"]["metrics"].values():
        assert list(m["by_region"]) == REGIONS
        assert all(len(s) == n for s in m["by_region"].values())


def test_metrics_are_labelled_as_visual_proxies(timeline):
    assert "no son mediciones físicas calibradas" in timeline["disclaimer"].lower()
    metrics = timeline["features"]["metrics"]
    assert set(metrics) == {"temp", "speed", "u", "v", "vort", "cover"}
    for m in metrics.values():
        assert m["nature"] == "visual_proxy" and m["calibrated"] is False
        assert m["unit"] and m["caveat"]
    assert "°C" not in metrics["temp"]["unit"] and "m/s" not in metrics["speed"]["unit"]


def test_clean_synthetic_data_has_no_warnings(timeline):
    assert timeline["validation"]["status"] == "ok", timeline["validation"]["warnings"]


# --- Sincronía con el BPM -------------------------------------------------

@pytest.mark.parametrize("bpm", [90, 100, 75, 80])
def test_note_times_follow_composer_bpm(feat, bpm):
    tl = et.build_timeline(feat, events_for(feat, bpm))
    fps = float(feat["fps"])
    effective = 60 * fps / round(fps * 60 / bpm)        # 80 BPM a 30 fps -> 81.82
    assert tl["timing"]["bpm"] == pytest.approx(effective)
    spb = 60.0 / effective
    assert tl["timing"]["seconds_per_beat"] == pytest.approx(spb)
    assert tl["timing"]["music_duration_s"] == pytest.approx(tl["timing"]["beats"] * spb)
    for n in tl["notes"]:
        assert n["t"] == pytest.approx(n["beat"] * spb, abs=1e-6)
        assert n["dur"] == pytest.approx(n["dur_beats"] * spb, abs=1e-6)
    for c in tl["chords"]:
        assert c["t"] == pytest.approx(c["bar"] * compose.BEATS_PER_BAR * spb, abs=1e-6)
    pads = [n for n in tl["notes"] if n["track"] == "temperatura"]
    assert all(n["beat"] % compose.BEATS_PER_BAR == 0 for n in pads)


def test_note_times_match_written_midi(feat, timeline, tmp_path):
    events, cc, meta = compose.compose(feat)
    mid = tmp_path / "x.mid"
    compose.write_midi(mid, events, cc, compose.BPM)
    tpq, ons = midi_note_ons(mid)
    spb = 60.0 / compose.BPM
    from_midi = sorted((tick / tpq * spb, ch, note) for tick, ch, note in ons)
    from_tl = sorted((n["t"], n["channel"], n["note"]) for n in timeline["notes"])
    assert len(from_midi) == len(from_tl)
    for (tm, cm, nm), (tt, ct, nt) in zip(from_midi, from_tl):
        assert (cm, nm) == (ct, nt)
        assert tm == pytest.approx(tt, abs=spb / tpq)


# --- Validación -----------------------------------------------------------

def test_skipped_regions_and_nan_become_null(feat):
    f = {k: v.copy() for k, v in feat.items()}
    f["cover"][10:20, 0] = 0.0                       # como deja analyze.py una franja sin píxeles
    for k in ("temp", "speed", "u", "v", "vort"):
        f[k][10:20, 0] = 0.0
    f["speed"][5, 2] = np.nan
    ev = events_for(feat)
    tl = strict_json(et.build_timeline(f, ev))
    temp = tl["features"]["metrics"]["temp"]["by_region"]["artico"]
    assert temp[10:20] == [None] * 10 and temp[9] is not None
    assert tl["features"]["metrics"]["cover"]["by_region"]["artico"][10] == 0.0
    assert tl["features"]["metrics"]["speed"]["by_region"]["tropicos"][5] is None
    assert tl["validation"]["checks"]["missing_fraction"]["artico"] == pytest.approx(10 / len(temp), abs=1e-4)
    text = " ".join(tl["validation"]["warnings"])
    assert "artico" in text and "no finitos" in text


def test_missing_detection_without_band_pixels(feat):
    f = {k: v.copy() for k, v in feat.items() if k != "band_pixels"}
    for k in ("temp", "speed", "u", "v", "vort"):
        f[k][0:5, 4] = 0.0
    assert et.missing_mask(f)[:, 4].sum() == 5


def test_low_cover_warns(feat):
    f = {k: v.copy() for k, v in feat.items()}
    f["cover"][:, 4] = 0.01
    f["band_pixels"] = f["band_pixels"] * 100        # sigue habiendo píxeles suficientes
    tl = et.build_timeline(f, events_for(feat))
    assert any("antartico" in w and "cobertura" in w for w in tl["validation"]["warnings"])


@pytest.mark.parametrize("fps", [29.97, 25.0, 24.0])
def test_composer_tempo_is_locked_to_video_frames(fps):
    f = synthetic_features(seconds=60, fps=fps)
    ev = events_for(f)
    assert ev["meta"]["bpm_requested"] == compose.BPM
    assert ev["meta"]["bpm"] == pytest.approx(60 * float(f["fps"]) / ev["meta"]["fpb"])
    tl = et.build_timeline(f, ev)
    assert tl["validation"]["checks"]["drift_at_end_s"] == pytest.approx(0, abs=1e-6)
    assert not any("deriva" in w for w in tl["validation"]["warnings"])


def test_export_still_warns_on_events_with_nominal_bpm():
    f = synthetic_features(seconds=60, fps=29.97)
    ev = events_for(f)
    ev["meta"]["bpm"] = 90.0                         # como los events.json anteriores al ajuste
    tl = et.build_timeline(f, ev)
    assert abs(tl["validation"]["checks"]["drift_at_end_s"]) > 1 / 29.97
    assert any("deriva" in w for w in tl["validation"]["warnings"])


def test_no_notes_after_incomplete_last_bar():
    f = synthetic_features(seconds=20)               # 30 beats: el último compás tiene 2
    tl = et.build_timeline(f, events_for(f))
    beats = tl["timing"]["beats"]
    assert beats % compose.BEATS_PER_BAR != 0
    bass = [n for n in tl["notes"] if n["track"] == "ecuatorial"]
    assert bass and all(n["beat"] + n["dur_beats"] <= beats + 1e-9 for n in bass)
    assert tl["validation"]["checks"]["notes_starting_after_end"] == 0


@pytest.mark.parametrize("mutate, match", [
    (lambda f: f.update(temp=f["temp"][:, :4]), "forma"),
    (lambda f: f.update(vort=f["vort"][:-3]), "forma"),
    (lambda f: f.update(bands=f["bands"][::-1]), "regiones"),
    (lambda f: f.update(fps=np.float32(0)), "FPS"),
    (lambda f: f.update(fps=np.float32(np.nan)), "FPS"),
    (lambda f: f.pop("cover"), "sin claves"),
])
def test_bad_features_are_rejected(feat, mutate, match):
    ev = events_for(feat)
    f = {k: v.copy() for k, v in feat.items()}
    mutate(f)
    with pytest.raises(et.TimelineError, match=match):
        et.build_timeline(f, ev)


def test_events_from_another_video_are_rejected(feat):
    other = synthetic_features(seconds=12)
    with pytest.raises(et.TimelineError, match="no corresponde"):
        et.build_timeline(feat, events_for(other))


def test_unknown_channel_is_rejected(feat):
    ev = events_for(feat)
    ev["events"].append([0.0, 1.0, 9.0, 60.0, 80.0])
    with pytest.raises(et.TimelineError, match="canal 9"):
        et.build_timeline(feat, ev)


# --- Pipeline por línea de comandos --------------------------------------

def run(*args, cwd=JUKEBOX):
    r = subprocess.run([sys.executable, *map(str, args)], cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_cli_compose_preview_and_export(tmp_path):
    npz = tmp_path / "f.npz"
    np.savez(npz, **synthetic_features(seconds=8))
    run("compose.py", npz, tmp_path / "f.mid", "--events", tmp_path / "f_events.json")
    run("render_preview.py", tmp_path / "f_events.json", tmp_path / "f.wav")
    out = run("export_timeline.py", npz, tmp_path / "f_events.json", tmp_path / "f_timeline.json",
              "--source", "video.mp4")
    assert "5 regiones" in out and "4 canales" in out
    assert (tmp_path / "f.mid").stat().st_size > 0 and (tmp_path / "f.wav").stat().st_size > 0
    tl = json.loads((tmp_path / "f_timeline.json").read_text(), parse_constant=float)
    assert tl["source"] == dict(features="f.npz", events="f_events.json", video="video.mp4")


def test_cli_fails_on_mismatched_inputs(tmp_path):
    a, b = tmp_path / "a.npz", tmp_path / "b.npz"
    np.savez(a, **synthetic_features(seconds=8))
    np.savez(b, **synthetic_features(seconds=12))
    run("compose.py", b, tmp_path / "b.mid", "--events", tmp_path / "b.json")
    r = subprocess.run([sys.executable, "export_timeline.py", a, tmp_path / "b.json", tmp_path / "t.json"],
                       cwd=JUKEBOX, capture_output=True, text=True)
    assert r.returncode == 1 and "no corresponde" in r.stderr
    assert not (tmp_path / "t.json").exists()


def test_synthetic_video_through_analyze(tmp_path):
    import analyze
    video = write_synthetic_video(tmp_path / "v.avi", seconds=4, fps=30)
    feat = analyze.analyze(str(video), width=128)
    assert feat["temp"].shape == (119, 5)
    assert float(feat["fps"]) == pytest.approx(30)
    assert feat["band_pixels"].sum() == 128 * 64
    # ecuador rojo (cálido) frente a polos azules; líneas hacia el oeste
    assert feat["temp"][:, 2].mean() > feat["temp"][:, 0].mean() + 0.3
    assert feat["u"][:, 2].mean() < 0
    tl = strict_json(et.build_timeline(feat, events_for(feat)))
    assert len(tl["regions"]) == 5 and len(tl["channels"]) == 4
    assert not math.isnan(tl["timing"]["music_duration_s"])


# --- Herramientas de validación con material real ------------------------

@pytest.mark.parametrize("overlay", [False, True])
def test_mask_check_finds_static_overlay(tmp_path, overlay):
    import mask_check
    video = write_synthetic_video(tmp_path / "v.avi", seconds=3, size=(512, 256), overlay=overlay)
    frames = mask_check.sample_frames(str(video), 20, 512)
    mask, temp, persist, static = mask_check.check(frames)
    rows = slice(int(0.92 * 256), int(0.92 * 256) + 10)
    if overlay:
        assert static[rows, 10:80].mean() > 0.8
        assert static[:200].sum() == 0
    else:
        assert static.sum() == 0


def test_flow_experiment_keyframe_window():
    import flow_experiment as fx
    key = np.zeros(50, bool)
    key[[0, 24, 48]] = True
    t1 = fx.touches_key(key, 49, 1)
    assert np.where(t1)[0].tolist() == [0, 23, 24, 47, 48]
    t6 = fx.touches_key(key, 49, 6)
    assert t6[23:30].all() and not t6[22] and not t6[30]     # frames [i-5, i+1] contienen el 24


def test_flow_experiment_stride1_matches_analyze(tmp_path):
    import analyze
    import flow_experiment as fx
    video = str(write_synthetic_video(tmp_path / "v.avi", seconds=2, fps=30))
    s1, u1, sn, un = fx.measure(video, 6, 128)
    ref = analyze.analyze(video, width=128)
    assert np.allclose(s1, ref["speed"], atol=1e-5) and np.allclose(u1, ref["u"], atol=1e-5)
    assert np.isnan(sn[:5]).all() and not np.isnan(sn[5:]).any()


def test_compare_lossless_helpers():
    import compare_lossless as cl
    lv = cl.video_levels(np.array([[[0, 128, 255]]], np.uint8))
    assert lv.tolist() == [[[16, 126, 235]]]
    rng = np.random.default_rng(0)
    base = [rng.standard_normal((32, 64)).cumsum(1) for _ in range(30)]
    noisy = [b + 0.3 * rng.standard_normal(b.shape) for b in base]
    al = cl.alignment(base, noisy[1:] + noisy[:1])        # MP4 adelantado un frame
    assert max(al, key=al.get) == -1
    assert max(cl.alignment(base, noisy).items(), key=lambda kv: kv[1])[0] == 0


def test_diagnostics_plots(tmp_path, timeline):
    import cv2
    import diagnostics
    out = tmp_path / "diag.png"
    diagnostics.plot_timeline(timeline, out)
    assert out.stat().st_size > 10_000
    bar = np.zeros((60, 300, 3), np.uint8)
    bar[20:40, 10:290] = np.stack([np.linspace(120, 0, 280), np.full(280, 230), np.full(280, 230)], -1).astype(np.uint8)
    cv2.imwrite(str(tmp_path / "bar.png"), cv2.cvtColor(bar, cv2.COLOR_HSV2BGR))
    deg, idx = diagnostics.colorbar_index(str(tmp_path / "bar.png"), 0, 32)
    assert np.all(np.diff(idx) >= -0.02) and idx[0] < 0.1 and idx[-1] > 0.9
