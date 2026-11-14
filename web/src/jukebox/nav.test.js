import { test } from "node:test";
import assert from "node:assert/strict";
import { chartKeyTarget, rollKeyTarget } from "./nav.js";

const grid = { beat: 0.5, bar: 2, end: 60 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("piano roll: las flechas van al tiempo siguiente o anterior", () => {
  near(rollKeyTarget("ArrowRight", 10.2, grid), 10.5);
  near(rollKeyTarget("ArrowUp", 10.2, grid), 10.5);
  near(rollKeyTarget("ArrowRight", 10.5, grid), 11);
  near(rollKeyTarget("ArrowLeft", 10.2, grid), 10, "primero al principio del tiempo en curso");
  near(rollKeyTarget("ArrowDown", 10.2, grid), 10);
  near(rollKeyTarget("ArrowLeft", 10.5, grid), 10, "en el borde, al anterior");
  near(rollKeyTarget("ArrowLeft", 10.52, grid), 10, "casi en el borde cuenta como borde");
});

test("piano roll: Re Pág / Av Pág saltan de compás (de acorde)", () => {
  near(rollKeyTarget("PageUp", 10.2, grid), 12);
  near(rollKeyTarget("PageDown", 10.2, grid), 10);
  near(rollKeyTarget("PageDown", 10, grid), 8);
  near(rollKeyTarget("PageUp", 12, grid), 14);
});

test("piano roll: Inicio, Fin y los bordes", () => {
  assert.equal(rollKeyTarget("Home", 33, grid), 0);
  assert.equal(rollKeyTarget("End", 33, grid), 60);
  assert.equal(rollKeyTarget("ArrowLeft", 0, grid), 0);
  assert.equal(rollKeyTarget("PageUp", 59.9, grid), 60);
  assert.equal(rollKeyTarget("ArrowRight", 60, grid), 60);
});

test("piano roll: las demás teclas no son suyas", () => {
  for (const key of [" ", "Enter", "Tab", "1", "a", "Escape"]) assert.equal(rollKeyTarget(key, 5, grid), null, key);
});

test("gráficas: flechas un segundo, Re Pág / Av Pág diez, dentro del vídeo", () => {
  assert.equal(chartKeyTarget("ArrowRight", 20, 66.7), 21);
  assert.equal(chartKeyTarget("ArrowUp", 20, 66.7), 21);
  assert.equal(chartKeyTarget("ArrowLeft", 20, 66.7), 19);
  assert.equal(chartKeyTarget("ArrowDown", 20, 66.7), 19);
  assert.equal(chartKeyTarget("PageUp", 20, 66.7), 30);
  assert.equal(chartKeyTarget("PageDown", 20, 66.7), 10);
  assert.equal(chartKeyTarget("PageDown", 4, 66.7), 0);
  assert.equal(chartKeyTarget("PageUp", 60, 66.7), 66.7);
  assert.equal(chartKeyTarget("Home", 20, 66.7), 0);
  assert.equal(chartKeyTarget("End", 20, 66.7), 66.7);
  assert.equal(chartKeyTarget(" ", 20, 66.7), null);
  assert.equal(chartKeyTarget("Enter", 20, 66.7), null);
});
