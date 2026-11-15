import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { gains, initialStates, reset, toggle } from "./mix.js";
import {
  audiblePosition,
  followVideo,
  HARD_SEEK_S,
  MAX_RATE_CORRECTION,
  recentMean,
  videoTarget,
} from "./clock.js";
import { barBeat, formatTime, frameAt, modelDate } from "./format.js";
import { assetUrl, checkCatalog, checkManifest, isRelative, pickVideo, ROLES, videoHref } from "./manifest.js";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));
const IDS = ["a", "b", "c", "d"];

test("sin mute ni solo suenan las cuatro pistas", () => {
  assert.deepEqual(gains(initialStates(IDS)), { a: 1, b: 1, c: 1, d: 1 });
});

test("mute silencia solo esa pista", () => {
  assert.deepEqual(gains(toggle(initialStates(IDS), "b", "mute")), { a: 1, b: 0, c: 1, d: 1 });
});

test("con solo suenan únicamente las pistas en solo", () => {
  let s = toggle(initialStates(IDS), "c", "solo");
  assert.deepEqual(gains(s), { a: 0, b: 0, c: 1, d: 0 });
  s = toggle(s, "a", "solo");
  assert.deepEqual(gains(s), { a: 1, b: 0, c: 1, d: 0 });
});

test("mute gana a solo y reset lo deja todo con sonido", () => {
  let s = toggle(toggle(initialStates(IDS), "c", "solo"), "c", "mute");
  assert.deepEqual(gains(s), { a: 0, b: 0, c: 0, d: 0 });
  assert.deepEqual(gains(reset(s)), { a: 1, b: 1, c: 1, d: 1 });
});

test("toggle no modifica el estado anterior", () => {
  const s = initialStates(IDS);
  toggle(s, "a", "mute");
  assert.equal(s[0].mute, false);
});

test("posición del audio: pausado, antes de arrancar, sonando y al final", () => {
  const st = { playing: false, offset: 12, startedAt: 100, duration: 60 };
  assert.equal(audiblePosition(st, 500), 12);
  st.playing = true;
  assert.equal(audiblePosition(st, 99.97), 12); // aún en el margen de arranque
  assert.ok(Math.abs(audiblePosition(st, 103.5) - 15.5) < 1e-9);
  assert.equal(audiblePosition(st, 1000), 60);
});

test("el vídeo no se toca si se desvía menos de un cuarto de fotograma", () => {
  assert.deepEqual(followVideo(0.008, 30), { seek: false, rate: 1, correcting: false });
  assert.deepEqual(followVideo(-0.008, 30), { seek: false, rate: 1, correcting: false });
  assert.equal(followVideo(-0.014, 30).correcting, true);
});

test("desvíos pequeños se corrigen con la velocidad, en la dirección correcta", () => {
  const ahead = followVideo(0.05, 30);
  const behind = followVideo(-0.05, 30);
  assert.equal(ahead.seek, false);
  assert.ok(ahead.rate < 1 && behind.rate > 1);
  assert.ok(followVideo(0.29, 30).rate >= 1 - MAX_RATE_CORRECTION);
});

test("histéresis: una vez corrigiendo, sigue hasta una décima de fotograma", () => {
  const first = followVideo(0.02, 30);
  assert.equal(first.correcting, true);
  const mid = followVideo(0.005, 30, first.correcting); // ya dentro del margen de inicio
  assert.equal(mid.correcting, true);
  assert.ok(mid.rate <= 0.99, "al menos un 1 % de corrección");
  assert.equal(followVideo(0.002, 30, true).correcting, false);
  assert.equal(followVideo(0.005, 30, false).correcting, false);
});

test("la media reciente absorbe la alternancia de fotogramas (+13 / −21 ms)", () => {
  const xs = Array.from({ length: 30 }, (_, i) => [i / 30, i % 2 ? 0.013 : -0.021]);
  assert.ok(Math.abs(recentMean(xs, 29 / 30, 0.5) - -0.004) < 0.002);
  assert.equal(followVideo(recentMean(xs, 29 / 30, 0.5), 30).correcting, false);
  assert.equal(recentMean(xs.slice(0, 3), 2 / 30, 0.5, 8), null);
});

test("desvíos grandes se corrigen con un salto", () => {
  assert.equal(followVideo(HARD_SEEK_S + 0.01, 30).seek, true);
  assert.equal(followVideo(-2, 30).seek, true);
});

test("tras el final del vídeo se queda en el último fotograma", () => {
  assert.ok(Math.abs(videoTarget(67.5, 66.7, 30) - (66.7 - 1 / 30)) < 1e-9);
  assert.equal(videoTarget(-1, 66.7, 30), 0);
  assert.equal(videoTarget(10, 66.7, 30), 10);
});

test("tiempo, fotograma y compás", () => {
  assert.equal(formatTime(0), "0:00.0");
  assert.equal(formatTime(67.66), "1:07.7");
  assert.equal(frameAt(1, 30, 2001), 30);
  assert.equal(frameAt(100, 30, 2001), 2000);
  assert.deepEqual(barBeat(0, 90), { bar: 1, beat: 1 });
  assert.deepEqual(barBeat(2 / 3, 90), { bar: 1, beat: 2 }); // exacto en el borde del tiempo
  assert.deepEqual(barBeat(4 * (2 / 3), 90), { bar: 2, beat: 1 });
});

test("fecha del modelo por fotograma", () => {
  const mt = { first: "2007-03-25T12:00Z", step_hours: 4.128 };
  assert.equal(modelDate(0, mt).toISOString(), "2007-03-25T12:00:00.000Z");
  assert.equal(modelDate(2000, mt).toISOString().slice(0, 13), "2008-03-03T12");
});

test("rutas relativas a la página, también en una subcarpeta de GitHub Pages", () => {
  assert.ok(isRelative("media/jukebox/ecco2.mp4"));
  for (const bad of ["/media/x.mp4", "https://x/y.mp4", "../x.mp4", "a/../../x", ""]) {
    assert.equal(isRelative(bad), false, bad);
  }
  assert.equal(
    assetUrl("media/jukebox/ecco2.mp4", "https://user.github.io/SpaceAppChallenge2026/index.html"),
    "https://user.github.io/SpaceAppChallenge2026/media/jukebox/ecco2.mp4",
  );
});

test("el catálogo y los manifiestos publicados son válidos y sus archivos existen", (t) => {
  const path = `${PUBLIC}data/jukebox/catalog.json`;
  if (!existsSync(path)) return t.skip("sin activos generados (python video_jukebox/jukebox.py build --all)");
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(checkCatalog(catalog), []);
  for (const v of catalog.videos) {
    const m = JSON.parse(readFileSync(PUBLIC + v.manifest, "utf8"));
    assert.deepEqual(checkManifest(m), [], v.id);
    assert.equal(m.id, v.id);
    assert.deepEqual([...m.audio.stems.map((s) => s.role)].sort(), [...ROLES].sort());
    for (const src of [m.video.src, m.timeline.src, ...m.audio.stems.map((s) => s.src)]) {
      assert.ok(existsSync(PUBLIC + src), src);
    }
    assert.ok(m.audio.duration_s >= m.timeline.music_duration_s);
    assert.match(m.notice, /No está respaldado por NASA/);
  }
});

const manifestWith = (over = {}) => ({
  schema: "earth-jukebox-web",
  version: 2,
  video: { src: "v.mp4", fps: 30, frames: 10 },
  timeline: { src: "t.json" },
  audio: {
    samples: 1,
    sample_rate: 44100,
    stems: ROLES.map((role, i) => ({ id: `p${i}`, role, src: `p${i}.m4a` })),
  },
  credits: [{ url: "https://svs.gsfc.nasa.gov/3912/" }],
  texts: { en: { title: "A" }, es: { title: "B" } },
  ...over,
});

test("checkManifest acepta cualquier vídeo con cuatro pistas, una por papel", () => {
  assert.deepEqual(checkManifest(manifestWith()), []);
});

test("checkManifest detecta rutas absolutas, pistas que faltan, créditos y textos", () => {
  const m = manifestWith({
    video: { src: "/abs.mp4", fps: 30, frames: 10 },
    audio: { samples: 1, sample_rate: 44100, stems: [{ id: "temperatura", role: "pad", src: "a.m4a" }] },
    credits: [{ url: "https://example.com" }],
    texts: { en: { title: "A" } },
  });
  const errors = checkManifest(m);
  assert.ok(errors.some((e) => e.code === "path" && e.src === "/abs.mp4"));
  assert.ok(errors.some((e) => e.code === "stems" && e.ids === "temperatura"));
  assert.ok(errors.some((e) => e.code === "credits"));
  assert.ok(errors.some((e) => e.code === "texts"));
  assert.ok(!checkManifest(manifestWith({ test: true, credits: [] })).some((e) => e.code === "credits"),
    "un vídeo de prueba no necesita créditos de NASA");
});

test("catálogo: válido, vacío o con entradas rotas", () => {
  const ok = { schema: "earth-jukebox-catalog", videos: [{ id: "a", manifest: "data/jukebox/a.json" }] };
  assert.deepEqual(checkCatalog(ok), []);
  assert.deepEqual(checkCatalog({ schema: "x" }), [{ code: "schema", value: "x" }]);
  assert.deepEqual(checkCatalog({ schema: "earth-jukebox-catalog", videos: [] }), [{ code: "empty" }]);
  assert.deepEqual(checkCatalog({ schema: "earth-jukebox-catalog", videos: [{ id: "b", manifest: "/b.json" }] }),
    [{ code: "entry", id: "b" }]);
});

test("elegir vídeo: ?video=id, si no existe el primero; y cambiar conserva ?lang", () => {
  const catalog = { videos: [{ id: "ecco2" }, { id: "luces" }] };
  assert.equal(pickVideo(catalog, "?video=luces").id, "luces");
  assert.equal(pickVideo(catalog, "?video=nada").id, "ecco2");
  assert.equal(pickVideo(catalog, "").id, "ecco2");
  assert.equal(
    videoHref("https://u.github.io/SpaceAppChallenge2026/?lang=es&video=ecco2", "luces"),
    "https://u.github.io/SpaceAppChallenge2026/?lang=es&video=luces",
  );
});
