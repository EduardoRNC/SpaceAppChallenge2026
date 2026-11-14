"""compare_stems.compare: nivel, SNR y corte del codificador con señales sintéticas."""
import numpy as np
import pytest

import compare_stems as cs
import render_preview as rp


def tone(hz, seconds=2.0, amp=0.3):
    t = np.arange(int(seconds * rp.SR)) / rp.SR
    x = amp * np.sin(2 * np.pi * hz * t)
    return np.stack([x, x], 1)


def test_misma_senal_a_otro_volumen():
    ref = tone(440)
    r, g, err = cs.compare(ref, 0.5 * ref)
    assert r["level_db"] == pytest.approx(-6.02, abs=0.01)
    assert r["match_gain_db"] == pytest.approx(6.02, abs=0.01)
    assert r["snr_db"] > 100
    assert r["cutoff_hz"] is None


def test_detecta_el_corte_y_la_energia_perdida():
    low, high = tone(1000), tone(19000)
    r, _, _ = cs.compare(low + high, low)
    assert 15000 < r["cutoff_hz"] < 19500
    assert r["energy_above_cutoff_pct"] == pytest.approx(50, abs=2)
    assert r["snr_db"] == pytest.approx(3.0, abs=0.3)    # se pierde la mitad de la energía
    top = r["bands"][-1]
    assert top["share_pct"] == pytest.approx(50, abs=2) and top["aac_vs_wav_db"] < -30


def test_golpes_pre_eco_y_ataque():
    n = int(2 * rp.SR)
    ref = np.zeros((n, 2))
    starts = [int(0.5 * rp.SR), int(1.2 * rp.SR)]
    for s in starts:
        t = np.arange(int(0.4 * rp.SR)) / rp.SR
        ref[s:s + len(t)] += (np.sin(2 * np.pi * 880 * t) * np.exp(-t / 0.1))[:, None] * 0.5
    x = ref.copy()
    for s in starts:                                    # ruido justo antes del golpe
        x[s - int(0.015 * rp.SR):s] += 0.01
    r, _, _ = cs.compare(ref, x, starts)
    h = r["hits"]
    assert h["count"] == 2
    assert -60 < h["pre_echo_db"] < -20
    assert h["attack_peak_db"] == pytest.approx(0, abs=0.1)
