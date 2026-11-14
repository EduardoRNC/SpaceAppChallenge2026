import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  MAJOR_PENTA,
  MINOR_PENTA,
  SCALES,
  clusterLevels,
  configFromTrack,
  cutoffFor,
  frameTargets,
  warmthRange,
  intensity,
  midiForStep,
  midiToFreq,
  noteFor,
  pulseBpm,
  pulseTimes,
  scaleFor,
  stepFor,
  stressOf,
  valueForStress,
  tension,
  yearlyMeans,
} from "./mapping.js";

const cfg = DEFAULTS;

test("la línea base (0 °C) suena en la tónica C4", () => {
  assert.equal(stepFor(0, cfg), 0);
  assert.equal(noteFor(0, 0, cfg), 60);
});

test("más caliente = nota más aguda, sea cual sea el modo", () => {
  // Grado a grado: el grado k+1 siempre suena más agudo que el k, en cualquier combinación de modos.
  for (let step = -10; step < 14; step++) {
    for (const a of SCALES) {
      for (const b of SCALES) {
        assert.ok(midiForStep(step + 1, a, 60) > midiForStep(step, b, 60), `grado ${step}`);
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

test("modo: pentatónica mayor hasta +0.5 °C, menor desde +1.0 °C", () => {
  assert.equal(tension(0.5, cfg), 0);
  assert.equal(tension(1.0, cfg), 1);
  for (let i = 0; i < 30; i++) {
    assert.equal(scaleFor(0.2, i, cfg), MAJOR_PENTA);
    assert.equal(scaleFor(1.2, i, cfg), MINOR_PENTA);
  }
});

test("cluster disonante: 2ª menor desde +0.4 °C y tritono desde +0.8 °C", () => {
  assert.deepEqual(clusterLevels(0.3, cfg), { minorSecond: 0, tritone: 0 });
  const mid = clusterLevels(0.9, cfg);
  assert.ok(mid.minorSecond > 0.8 && mid.tritone > 0 && mid.tritone < 0.3);
  assert.deepEqual(clusterLevels(1.5, cfg), { minorSecond: 1, tritone: 1 });
});

test("latido: reposo a 0 °C o menos, y más rápido cuanto más calor", () => {
  assert.equal(pulseBpm(-0.5, cfg), cfg.pulseBpmMin);
  assert.equal(pulseBpm(0, cfg), cfg.pulseBpmMin);
  assert.ok(pulseBpm(0.7, cfg) > pulseBpm(0.3, cfg));
  assert.equal(pulseBpm(1.5, cfg), cfg.pulseBpmMax);
});

test("pulseTimes: latidos más juntos en años calientes, sin importar la velocidad", () => {
  const years = [
    ...Array.from({ length: 40 }, () => ({ v: 0 })),
    ...Array.from({ length: 40 }, () => ({ v: 1.4 })),
  ];
  for (const yd of [0.16, 0.41, 2]) {
    const times = pulseTimes(years, yd, cfg);
    const half = 40 * yd;
    const cold = times.filter((p) => p.t < half).length;
    const hot = times.filter((p) => p.t >= half).length;
    assert.ok(hot > cold * 2, `yd=${yd}: ${cold} vs ${hot}`);
  }
});

test("el crescendo crece con la temperatura", () => {
  assert.ok(intensity(1.0, cfg) > intensity(0.2, cfg));
  assert.equal(intensity(1.4, cfg), 1);
});

test("brillo: crece con la temperatura dentro de [cutoffMin, cutoffMax]", () => {
  assert.equal(Math.round(cutoffFor(cfg.range[0], cfg)), cfg.cutoffMin);
  assert.equal(Math.round(cutoffFor(cfg.range[1], cfg)), cfg.cutoffMax);
  assert.ok(cutoffFor(1.0, cfg) > cutoffFor(0, cfg));
});

test("capa de fotogramas: más cálido el color = más volumen y trémolo más rápido", () => {
  const frames = [{ w: -0.2 }, { w: 0.1 }, { w: 0.66 }];
  const range = warmthRange(frames);
  assert.deepEqual(range, [-0.2, 0.66]);
  const cold = frameTargets(-0.2, range);
  const hot = frameTargets(0.66, range);
  assert.ok(hot.level > cold.level && hot.tremoloHz > cold.tremoloHz);
  assert.equal(hot.level, 1);
  assert.equal(frameTargets(-5, range).level, cold.level); // fuera de rango se recorta
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

// --- Varias pistas (Paso 8) -------------------------------------------------------

test("temperatura: el estrés es la propia anomalía (identidad)", () => {
  for (const v of [-0.5, 0, 0.7, 1.4]) assert.ok(Math.abs(stressOf(v, cfg) - v) < 1e-12);
});

test("CO₂: 315 ppm = estrés 0 y 425 ppm = estrés máximo; la tónica es 350 ppm", () => {
  const co2 = configFromTrack({ baseline: 350, range: [310, 435], sound: { stressZero: 315, stressFull: 425 } });
  assert.equal(stressOf(315, co2), 0);
  assert.ok(Math.abs(stressOf(425, co2) - 1.4) < 1e-12);
  assert.equal(noteFor(350, 0, co2), 60);
  assert.ok(tension(420, co2) > tension(360, co2));
  assert.ok(Math.abs(valueForStress(0.7, co2) - 370) < 1e-9);
});

test("hielo: menos hielo = más tensión, pero tono más grave", () => {
  const ice = configFromTrack({ baseline: 0, range: [-3.1, 1.3], sound: { stressZero: 0, stressFull: -2 } });
  assert.ok(stressOf(-1.5, ice) > stressOf(0.5, ice));
  assert.ok(intensity(-1.8, ice) > intensity(0, ice));
  assert.ok(pulseBpm(-2, ice) > pulseBpm(0, ice));
  assert.ok(clusterLevels(-1.8, ice).minorSecond > 0);
  assert.ok(noteFor(-1.5, 0, ice) < noteFor(0.5, 0, ice)); // tono: menos hielo = más grave
  assert.ok(cutoffFor(-1.5, ice) > cutoffFor(0.5, ice)); // brillo sigue a la tensión
});
