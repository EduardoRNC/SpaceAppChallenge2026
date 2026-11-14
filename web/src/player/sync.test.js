import { test } from "node:test";
import assert from "node:assert/strict";
import { playbackRateFor, videoTimeForYear } from "./sync.js";

const video = { tStart: 0, secondsPerYear: 0.1597, tDataEnd: 23.45, duration: 30 };

test("puntos de control medidos en los frames del vídeo", () => {
  // Se vieron en los frames: 1974 en ~15 s, 1999 en ~19 s, 2024 en ~23 s.
  assert.ok(Math.abs(videoTimeForYear(1974 - 1880, video) - 15) < 0.2);
  assert.ok(Math.abs(videoTimeForYear(1999 - 1880, video) - 19) < 0.2);
  assert.ok(Math.abs(videoTimeForYear(2024 - 1880, video) - 23) < 0.2);
});

test("el último año (2026) empieza antes de que el vídeo termine los datos", () => {
  assert.ok(videoTimeForYear(2026 - 1880, video) < video.tDataEnd);
});

test("velocidad del vídeo: normal ≈ 0.39x; con la velocidad del vídeo original, 1x", () => {
  assert.ok(Math.abs(playbackRateFor(0.41, video) - 0.39) < 0.01);
  assert.equal(playbackRateFor(0.1597, video), 1);
});

test("la velocidad se mantiene dentro de los límites del navegador", () => {
  assert.equal(playbackRateFor(100, video), 0.0625);
  assert.equal(playbackRateFor(0.001, video), 16);
});
