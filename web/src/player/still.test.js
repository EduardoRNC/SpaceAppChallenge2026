import { test } from "node:test";
import assert from "node:assert/strict";
import { xForYear } from "./still.js";

// Marcas medidas en el último fotograma de la Keeling Curve (SVS 5119).
const ticks = [[1960, 259], [1970, 476.5], [1980, 715.5], [1990, 933],
  [2000, 1150.5], [2010, 1389.5], [2020, 1607], [2023.17, 1676]];

test("las marcas del eje caen exactamente en su píxel", () => {
  for (const [year, x] of ticks) assert.ok(Math.abs(xForYear(year, ticks) - x) < 1e-9);
});

test("entre marcas interpola y antes de 1960 extrapola (el dato empieza en 1958)", () => {
  assert.ok(Math.abs(xForYear(1975, ticks) - 596) < 0.01);
  const x1958 = xForYear(1958, ticks);
  assert.ok(x1958 < 259 && x1958 > 200);
});

test("después de mar-2023 (fin de la imagen) el cursor se queda al final", () => {
  assert.equal(xForYear(2026, ticks), 1676);
});
