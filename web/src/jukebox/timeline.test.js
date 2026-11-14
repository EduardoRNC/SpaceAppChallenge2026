import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildLanes,
  checkTimeline,
  chordAt,
  chordLabels,
  chordsInWindow,
  frameIndex,
  isActive,
  noteBox,
  noteName,
  notesInWindow,
  rollView,
  seriesPath,
  seriesRange,
  soundingAt,
  timeAtX,
  xAt,
} from "./timeline.js";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(PUBLIC + p, "utf8"));
const HAVE_ASSETS = existsSync(`${PUBLIC}data/jukebox/ecco2.json`);

const note = (t, dur, n, track = "temperatura", vel = 100) => ({ t, dur, note: n, track, vel });
const CHORDS = [
  { bar: 0, t: 0, name: "Dm9" },
  { bar: 1, t: 2.666667, name: "Bbmaj7" },
  { bar: 2, t: 5.333333, name: "Gm7" },
];

test("timeline publicado: válido, notas en el reloj del audio y medidas marcadas como proxies", (t) => {
  if (!HAVE_ASSETS) return t.skip("sin activos generados");
  const manifest = readJson("data/jukebox/ecco2.json");
  const tl = readJson(manifest.timeline.src);
  assert.deepEqual(checkTimeline(tl, manifest), []);
  const spb = 60 / tl.timing.bpm;
  for (const n of tl.notes) assert.ok(Math.abs(n.t - n.beat * spb) < 1e-5, `nota en ${n.t}`);
  for (const m of Object.values(tl.features.metrics)) {
    assert.equal(m.nature, "visual_proxy");
    assert.equal(m.calibrated, false);
    assert.ok(m.caveat && m.unit && m.derived_from);
  }
  const lanes = buildLanes(tl);
  assert.deepEqual(lanes.map((l) => l.id), manifest.audio.stems.map((s) => s.id));
  assert.equal(lanes.reduce((k, l) => k + l.notes.length, 0), tl.notes.length);
  assert.equal(tl.chords.length, tl.timing.bars);
});

test("checkTimeline rechaza esquema, canales, fps y medidas que se dicen calibradas", (t) => {
  if (!HAVE_ASSETS) return t.skip("sin activos generados");
  const manifest = readJson("data/jukebox/ecco2.json");
  const tl = readJson(manifest.timeline.src);
  assert.match(checkTimeline({ ...tl, schema: "otro" }, manifest)[0], /esquema/);
  assert.ok(checkTimeline({ ...tl, channels: tl.channels.slice(1) }, manifest).some((e) => e.includes("canales")));
  assert.ok(checkTimeline({ ...tl, timing: { ...tl.timing, fps: 25 } }, manifest).some((e) => e.includes("fps")));
  const metrics = { ...tl.features.metrics, temp: { ...tl.features.metrics.temp, calibrated: true } };
  const calibrated = { ...tl, features: { ...tl.features, metrics } };
  assert.ok(checkTimeline(calibrated, manifest).some((e) => e.includes("temp")));
});

test("carriles: uno por canal, notas ordenadas y registro con margen", () => {
  const tl = {
    channels: [{ id: "a" }, { id: "b" }, { id: "c" }],
    notes: [note(2, 1, 70, "a"), note(0, 1, 50, "a"), note(1, 1, 64, "b")],
  };
  const [a, b, c] = buildLanes(tl);
  assert.deepEqual(a.notes.map((n) => n.t), [0, 2]);
  assert.deepEqual([a.low, a.high], [49, 71]);
  assert.ok(b.high - b.low >= 12 && b.low < 64 && b.high > 64);
  assert.equal(c.notes.length, 0);
  assert.equal(c.high - c.low, 12);
});

test("notas visibles: incluye las que empezaron antes de la ventana y aún suenan", () => {
  const ns = [note(0, 3, 60), note(4, 0.5, 62), note(9.9, 1, 64), note(10, 1, 65)];
  assert.deepEqual(notesInWindow(ns, 2, 10).map((n) => n.note), [60, 62, 64]);
  assert.deepEqual(notesInWindow(ns, 3, 4).map((n) => n.note), [], "bordes abiertos");
});

test("nota activa: desde su inicio hasta justo antes de su final", () => {
  const n = note(1, 0.5, 60);
  assert.equal(isActive(n, 0.999), false);
  assert.equal(isActive(n, 1), true);
  assert.equal(isActive(n, 1.499), true);
  assert.equal(isActive(n, 1.5), false);
  const lanes = [{ id: "a", notes: [n, note(1.2, 1, 64)] }, { id: "b", notes: [] }];
  assert.deepEqual(soundingAt(lanes, 1.3), { a: [60, 64], b: [] });
});

test("acorde vigente: cambia exactamente al empezar el compás", () => {
  assert.equal(chordAt(CHORDS, -0.1), null);
  assert.equal(chordAt(CHORDS, 0).name, "Dm9");
  assert.equal(chordAt(CHORDS, 2.666).name, "Dm9");
  assert.equal(chordAt(CHORDS, 2.666667).name, "Bbmaj7");
  assert.equal(chordAt(CHORDS, 100).name, "Gm7");
  const visible = chordsInWindow(CHORDS, 2, 6, 8);
  assert.deepEqual(visible.map((c) => [c.name, c.end]), [["Dm9", 2.666667], ["Bbmaj7", 5.333333], ["Gm7", 8]]);
});

test("rótulos de acordes: nunca un nombre cortado; el que suena siempre visible", () => {
  const measure = (s) => s.length * 7;
  const bars = Array.from({ length: 10 }, (_, i) => ({ bar: i, t: i * 2.666667, name: ["Dm9", "Bbmaj7", "Gm7", "Cadd9"][i % 4] }));
  const width = 400;
  const end = 26.66667;
  for (let t = 0; t <= end; t += 0.05) {
    const view = rollView(t, 10, 0.25);
    const labels = chordLabels(bars, view, t, width, end, measure);
    const current = labels.filter((c) => c.state === "current");
    assert.equal(current.length, 1, `t=${t}`);
    assert.notEqual(current[0].labelX, null, `el acorde que suena tiene nombre en t=${t}`);
    for (const c of labels) {
      if (c.labelX == null) continue;
      assert.ok(c.labelX >= 0, `t=${t} ${c.name} empieza dentro del lienzo`);
      assert.ok(c.labelX + measure(c.name) <= Math.min(c.x1, width), `t=${t} ${c.name} cabe en su caja`);
      if (c.state !== "current") assert.ok(c.x0 >= 0, `t=${t} ${c.name}: solo el actual se fija al borde`);
    }
  }
});

test("rótulos de acordes: el que ya pasó y salió por la izquierda pierde el nombre", () => {
  const measure = (s) => s.length * 7;
  const view = rollView(3, 10, 0.25); // t0 = 0.5: el primer acorde (0–2,67 s) ya pasó y está a medias
  const [first, second] = chordLabels(CHORDS, view, 3, 400, 8, measure);
  assert.equal(first.state, "past");
  assert.equal(first.labelX, null);
  assert.equal(second.state, "current");
  assert.ok(second.labelX > 0);
});

test("ventana del piano roll: el cabezal al 25 % y x ↔ tiempo inversos", () => {
  const view = rollView(20, 10, 0.25);
  assert.deepEqual(view, { t0: 17.5, t1: 27.5, span: 10 });
  assert.equal(xAt(20, view, 800), 200);
  assert.equal(timeAtX(200, view, 800), 20);
  assert.equal(timeAtX(800, view, 800), 27.5);
  assert.equal(rollView(0).t0, -2.5, "al principio se ve un margen antes de 0");
});

test("altura de nota: agudo arriba y siempre dentro del carril", () => {
  const lane = { low: 48, high: 72 };
  const hi = noteBox(72, lane, 100, 50);
  const lo = noteBox(48, lane, 100, 50);
  assert.ok(hi.y < lo.y);
  for (const p of [48, 60, 72]) {
    const { y, h } = noteBox(p, lane, 100, 50);
    assert.ok(y >= 100 && y + h <= 150, `nota ${p}`);
    assert.ok(h >= 2);
  }
});

test("nombres de nota", () => {
  assert.equal(noteName(60), "C4");
  assert.equal(noteName(69), "A4");
  assert.equal(noteName(70), "B♭4");
  assert.equal(noteName(29), "F1");
});

test("índice de características: la fila 0 es el fotograma 1", () => {
  const timing = { fps: 30, frames: 2000, frame_offset: 1 };
  assert.equal(frameIndex(0, timing), 0);
  assert.equal(frameIndex(1 / 30, timing), 0);
  assert.equal(frameIndex(1, timing), 29);
  assert.equal(frameIndex(66.7, timing), 1999);
  assert.equal(frameIndex(70, timing), 1999);
});

test("series: rango sin huecos y trazo cortado en los null", () => {
  assert.deepEqual(seriesRange([null, 2, 5, NaN, 3]), { min: 2, max: 5 });
  assert.deepEqual(seriesRange([1, 1]), { min: 0.5, max: 1.5 });
  assert.equal(seriesRange([null, null]), null);
  const path = seriesPath([0, 1, 2, 3], [0, 1, null, 1], 30, 10, { min: 0, max: 1 }, [0, 3]);
  assert.equal(path, "M0.0 10.0L10.0 0.0M30.0 0.0");
});
