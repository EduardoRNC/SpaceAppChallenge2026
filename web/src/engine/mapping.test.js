import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  cutoffFor,
  dissonance,
  midiForStep,
  midiToFreq,
  noteFor,
  stepFor,
  tension,
  yearlyMeans,
} from "./mapping.js";

const cfg = DEFAULTS;

test("la línea base (0 °C) suena en la tónica C4", () => {
  assert.equal(stepFor(0, cfg), 0);
  assert.equal(noteFor(0, 0, cfg), 60);
});

test("más caliente = nota más aguda, sea cual sea el modo (mayor o menor)", () => {
  // Grado a grado: el grado k+1 siempre suena más agudo que el k, en cualquier modo.
  for (let step = -8; step < 12; step++) {
    for (const a of [false, true]) {
      for (const b of [false, true]) {
        assert.ok(
          midiForStep(step + 1, a, 60) > midiForStep(step, b, 60),
          `grado ${step}→${step + 1} (${a}/${b})`,
        );
      }
    }
  }
  // Valores reales: una anomalía mayor nunca suena más grave.
  const values = [-0.9, -0.5, -0.2, 0, 0.3, 0.6, 0.9, 1.2, 1.6];
  for (let i = 1; i < values.length; i++) {
    assert.ok(noteFor(values[i], i, cfg) >= noteFor(values[i - 1], i - 1, cfg));
  }
});

test("el rango completo ocupa unas 3 octavas", () => {
  const low = noteFor(cfg.range[0], 0, cfg);
  const high = noteFor(cfg.range[1], 0, cfg);
  assert.ok(high - low >= 30 && high - low <= 40, `${low}..${high}`);
});

test("valores fuera de rango se recortan, no se disparan", () => {
  assert.equal(stepFor(5, cfg), stepFor(cfg.range[1], cfg));
  assert.equal(stepFor(-5, cfg), stepFor(cfg.range[0], cfg));
});

test("tensión: calma hasta +0.5 °C, total desde +1.0 °C", () => {
  assert.equal(tension(0.3, cfg), 0);
  assert.equal(tension(0.5, cfg), 0);
  assert.ok(tension(0.75, cfg) > 0.4 && tension(0.75, cfg) < 0.6);
  assert.equal(tension(1.2, cfg), 1);
});

test("con tensión 0 todo está en mayor; con tensión 1, todo en menor", () => {
  const majorOnly = [0, 1, 2, 3, 4].map((s) => midiForStep(s, false, 60));
  const minorOnly = [0, 1, 2, 3, 4].map((s) => midiForStep(s, true, 60));
  for (let i = 0; i < 50; i++) {
    const calm = noteFor(0.2, i, cfg);
    assert.ok(!minorOnly.includes(calm) || majorOnly.includes(calm));
  }
  // A +1.3 °C la tensión es total, así que la nota pertenece a la pentatónica menor.
  const step = stepFor(1.3, cfg);
  assert.equal(noteFor(1.3, 7, cfg), midiForStep(step, true, 60));
});

test("disonancia: nula hasta +1.0 °C y máxima en +1.6 °C", () => {
  assert.equal(dissonance(0.9, cfg), 0);
  assert.equal(dissonance(1.0, cfg), 0);
  assert.equal(dissonance(1.6, cfg), 1);
});

test("brillo: crece con la temperatura dentro de [cutoffMin, cutoffMax]", () => {
  assert.equal(Math.round(cutoffFor(cfg.range[0], cfg)), cfg.cutoffMin);
  assert.equal(Math.round(cutoffFor(cfg.range[1], cfg)), cfg.cutoffMax);
  assert.ok(cutoffFor(1.0, cfg) > cutoffFor(0, cfg));
});

test("midiToFreq: A4 = 440 Hz, C4 ≈ 261.6 Hz", () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.63) < 0.01);
});

test("yearlyMeans agrupa por año e incluye años incompletos", () => {
  const series = [
    { t: "2000-01", v: 0.2 },
    { t: "2000-02", v: 0.4 },
    { t: "2001-01", v: 1.0 },
  ];
  const means = yearlyMeans(series);
  assert.equal(means.length, 2);
  assert.ok(Math.abs(means[0].v - 0.3) < 1e-9);
  assert.deepEqual([means[1].year, means[1].months], [2001, 1]);
});
