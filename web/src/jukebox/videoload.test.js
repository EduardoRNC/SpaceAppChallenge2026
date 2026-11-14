import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LOAD_TIMEOUT_MS, waitFirstFrame } from "./videoload.js";

function fakeVideo(readyState = 0) {
  const listeners = new Map();
  return {
    readyState,
    loads: 0,
    load() {
      this.loads += 1;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    count: (type) => listeners.get(type)?.size ?? 0,
  };
}

function fakeClock() {
  let now = 0;
  const timers = new Map();
  let id = 0;
  return {
    schedule: (fn, ms) => (timers.set(++id, { fn, at: now + ms }), id),
    cancel: (k) => timers.delete(k),
    advance(ms) {
      now += ms;
      for (const [k, tm] of [...timers]) if (tm.at <= now && timers.delete(k)) tm.fn();
    },
    get pending() {
      return timers.size;
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function setup(readyState) {
  const video = fakeVideo(readyState);
  const clock = fakeClock();
  const problems = [];
  const load = waitFirstFrame(video, { timeoutMs: 1000, onProblem: (p) => problems.push(p), ...clock });
  let resolved = false;
  load.promise.then(() => (resolved = true));
  return { video, clock, problems, load, isResolved: async () => (await flush(), resolved) };
}

test("el plazo por defecto es razonable: ni inmediato ni indefinido", () => {
  assert.ok(LOAD_TIMEOUT_MS >= 5000 && LOAD_TIMEOUT_MS <= 30000);
});

test("loadeddata a tiempo: sigue sin avisos, sin temporizadores ni escuchas", async () => {
  const s = setup();
  s.clock.advance(500);
  s.video.emit("loadeddata");
  assert.equal(await s.isResolved(), true);
  assert.equal(s.load.loaded, true);
  assert.deepEqual(s.problems, []);
  assert.equal(s.clock.pending, 0);
  assert.equal(s.video.count("loadeddata") + s.video.count("error"), 0);
  s.clock.advance(5000);
  assert.deepEqual(s.problems, [], "ningún aviso tardío");
});

test("si el vídeo ya tenía el primer fotograma, no espera", async () => {
  const s = setup(2);
  assert.equal(await s.isResolved(), true);
  assert.equal(s.clock.pending, 0);
});

test("regresión: sin loadeddata ni error, avisa al vencer el plazo en vez de quedarse colgada", async () => {
  const s = setup();
  s.clock.advance(999);
  assert.deepEqual(s.problems, []);
  s.clock.advance(1);
  assert.deepEqual(s.problems, ["timeout"]);
  assert.equal(await s.isResolved(), false);
  s.clock.advance(10_000);
  assert.deepEqual(s.problems, ["timeout"], "un aviso por intento, no uno por segundo");
});

test("si el vídeo llega tarde tras el aviso, la demo continúa sola", async () => {
  const s = setup();
  s.clock.advance(1000);
  s.video.emit("loadeddata");
  assert.equal(await s.isResolved(), true);
  assert.equal(s.video.loads, 0, "sin recargar");
});

test("Reintentar vuelve a pedir el vídeo y a contar el plazo", async () => {
  const s = setup();
  s.clock.advance(1000);
  s.load.retry();
  assert.equal(s.video.loads, 1);
  s.clock.advance(999);
  assert.deepEqual(s.problems, ["timeout"]);
  s.clock.advance(1);
  assert.deepEqual(s.problems, ["timeout", "timeout"], "el nuevo intento también tiene plazo");
  s.load.retry();
  s.clock.advance(300);
  s.video.emit("loadeddata");
  assert.equal(await s.isResolved(), true);
  assert.equal(s.clock.pending, 0);
});

test("error del vídeo: avisa al momento, sin esperar el plazo, y se puede reintentar", async () => {
  const s = setup();
  s.clock.advance(200);
  s.video.emit("error");
  assert.deepEqual(s.problems, ["error"]);
  assert.equal(s.clock.pending, 0, "tras el error no hay además aviso de plazo");
  s.load.retry();
  s.video.emit("loadeddata");
  assert.equal(await s.isResolved(), true);
});

test("tras cargar, Reintentar y los eventos viejos no hacen nada", async () => {
  const s = setup();
  s.video.emit("loadeddata");
  await s.isResolved();
  s.load.retry();
  s.video.emit("error");
  s.clock.advance(5000);
  assert.equal(s.video.loads, 0);
  assert.deepEqual(s.problems, []);
});

test("main.js usa la espera con plazo y su aviso tiene botón Reintentar", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /waitFirstFrame\(el\.video/);
  assert.doesNotMatch(main, /addEventListener\("loadeddata", resolve/, "ya no hay espera sin plazo");
  assert.match(main, /notice\?\.action === "load"/);
  assert.match(main, /"notice\.loadSlow"/);
});
