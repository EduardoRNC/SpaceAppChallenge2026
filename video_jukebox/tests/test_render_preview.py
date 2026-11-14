"""Stems del preview FM: sincronía, mezcla, ganancias y ausencia de saturación."""
import itertools
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

import compose
import render_preview as rp
from synthetic import synthetic_features

JUKEBOX = Path(__file__).resolve().parents[1]
LIMIT = 10 ** (-rp.HEADROOM_DB / 20)


def events_for(feat):
    events, cc, meta = compose.compose(feat)
    ev = dict(events=[list(map(float, e)) for e in events],
              cc=[list(map(float, c)) for c in cc], meta=meta)
    return json.loads(json.dumps(ev))


@pytest.fixture(scope="module")
def data():
    return events_for(synthetic_features(seconds=12))


@pytest.fixture(scope="module")
def stems(data):
    return rp.render_stems(data)


def read_wav(path):
    with wave.open(str(path)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (2, 2, rp.SR)
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2)


def test_one_stem_per_channel_with_identical_length(data, stems):
    x, _ = stems
    assert sorted(x) == [0, 1, 2, 3]
    assert {v.shape for v in x.values()} == {(rp.output_len(data["meta"]), 2)}
    assert len(rp.render(data)) == rp.output_len(data["meta"])


def test_stems_start_at_their_first_note(data, stems):
    x, _ = stems
    spb = 60 / data["meta"]["bpm"]
    for ch, v in x.items():
        start = min(int(b * spb * rp.SR) for b, _, c, _, _ in data["events"] if int(c) == ch)
        first = np.flatnonzero(np.abs(v).max(1) > 1e-9)[0]
        assert start <= first <= start + 2, (ch, start, first)


def test_each_stem_contains_only_its_channel(data, stems):
    x, gain = stems
    for ch in x:
        alone = dict(data, events=[e for e in data["events"] if int(e[2]) == ch])
        y, g = rp.render_stems(alone)
        np.testing.assert_allclose(y[ch] / g, x[ch] / gain, atol=1e-9)
        assert all(np.abs(y[c]).max() == 0 for c in y if c != ch)


def test_stems_sum_to_the_original_mix_before_saturation(data, stems):
    x, gain = stems
    linear = sum(x.values()) / gain
    pre = np.arctanh(rp.render(data) / 0.9) / 1.2       # deshace la saturación final del preview
    k = (pre * linear).sum() / (linear * linear).sum()
    assert np.abs(pre - k * linear).max() < 1e-6 * np.abs(pre).max()


def test_common_gain_preserves_balance(data, stems):
    x, gain = stems
    y, gain6 = rp.render_stems(data, headroom_db=6.0)
    assert gain / gain6 == pytest.approx(10 ** (5 / 20))
    for ch in x:
        np.testing.assert_allclose(y[ch] * gain / gain6, x[ch], atol=1e-12)


def test_no_mute_solo_combination_clips(stems):
    x, _ = stems
    peaks = [np.abs(sum(x[c] for c in combo)).max()
             for r in range(1, 5) for combo in itertools.combinations(x, r)]
    assert max(peaks) == pytest.approx(LIMIT)
    assert all(p <= LIMIT + 1e-12 for p in peaks)


def test_cli_writes_stems_and_keeps_the_mix(data, tmp_path):
    ev = tmp_path / "ev.json"
    ev.write_text(json.dumps(data))
    run = lambda *a: subprocess.run([sys.executable, "render_preview.py", *map(str, a)],
                                    cwd=JUKEBOX, check=True, capture_output=True)
    run(ev, tmp_path / "plain.wav")
    run(ev, tmp_path / "mix.wav", "--stems", tmp_path / "stems")
    assert (tmp_path / "plain.wav").read_bytes() == (tmp_path / "mix.wav").read_bytes()
    info = json.loads((tmp_path / "stems" / "stems.json").read_text())
    assert [s["id"] for s in info["stems"]] == ["temperatura", "corrientes", "remolinos", "ecuatorial"]
    pcm = [read_wav(tmp_path / "stems" / s["file"]) for s in info["stems"]]
    assert {len(p) for p in pcm} == {info["samples"], len(read_wav(tmp_path / "mix.wav"))}
    assert max(np.abs(p.astype(int)).max() for p in pcm) < 32767 * LIMIT + 1
    assert np.abs(sum(p.astype(int) for p in pcm)).max() < 32767 * LIMIT + 4
