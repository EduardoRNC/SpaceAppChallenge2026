import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenValue } from "./speech.js";
import { SHORTCUTS } from "./keys.js";

test("valores para el lector de pantalla en español, con signo y coma decimal", () => {
  assert.equal(spokenValue(0.61), "más 0,61 °C");
  assert.equal(spokenValue(-0.2), "menos 0,20 °C");
  assert.equal(spokenValue(0), "0,00 °C");
  assert.equal(spokenValue(1.234), "más 1,23 °C");
});


test("todos los atajos tienen descripción", () => {
  for (const [key, desc] of SHORTCUTS) assert.ok(key && desc.length > 5, key);
});

test("la intro es breve y explica todas las capas", async () => {
  const { INTRO_STEPS } = await import("./intro.js");
  const expected = ["reference", "pitch", "months", "pulse", "tension", "frames", "record", "ticks"];
  assert.deepEqual(INTRO_STEPS.map((s) => s.demo), expected);
  for (const step of INTRO_STEPS) assert.ok(step.text.split(" ").length <= 8, step.text);
});
