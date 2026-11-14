import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { formatValue, HARMONY, latitudeText, METRIC_ORDER, REGION_LABELS, regionsText, TRACK_MAPPINGS, usesOf } from "./mappings.js";
import { STEM_IDS } from "./manifest.js";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));

test("cada pista explica al menos una medida, y solo hay pistas conocidas", () => {
  assert.deepEqual(Object.keys(TRACK_MAPPINGS), STEM_IDS);
  for (const uses of Object.values(TRACK_MAPPINGS)) assert.ok(uses.length > 0);
});

test("las medidas y regiones de los mapeos existen en el timeline publicado", (t) => {
  const path = `${PUBLIC}data/jukebox/ecco2_timeline.json`;
  if (!existsSync(path)) return t.skip("sin activos generados");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  const regions = tl.regions.map((r) => r.id);
  assert.deepEqual(Object.keys(REGION_LABELS), regions);
  assert.deepEqual([...METRIC_ORDER].sort(), Object.keys(tl.features.metrics).sort());
  for (const use of [...HARMONY.uses, ...Object.values(TRACK_MAPPINGS).flat()]) {
    assert.ok(tl.features.metrics[use.metric], use.metric);
    if (use.regions !== "all") for (const r of use.regions) assert.ok(regions.includes(r), r);
  }
});

test("quién usa cada medida en cada región", () => {
  const ids = (m, r) => usesOf(m, r).map((u) => u.id);
  assert.deepEqual(ids("u", "tropicos"), ["ecuatorial"]);
  assert.deepEqual(ids("u", "artico"), [], "el bajo solo escucha los trópicos");
  assert.deepEqual(ids("temp", "norte_medio"), ["acordes", "temperatura", "corrientes"]);
  assert.deepEqual(ids("temp", "tropicos"), ["temperatura", "corrientes"]);
  assert.deepEqual(ids("vort", "antartico"), ["corrientes", "remolinos"]);
  assert.deepEqual(ids("speed", "sur_medio"), ["corrientes"]);
  for (const r of Object.keys(REGION_LABELS)) {
    assert.deepEqual(ids("v", r), [], "v no se usa en la música");
    assert.deepEqual(ids("cover", r), [], "cover no se usa en la música");
  }
});

test("textos de regiones, latitudes y valores", () => {
  assert.equal(regionsText({ regions: "all" }), "todas las franjas");
  assert.equal(regionsText({ regions: ["norte_medio", "sur_medio"] }), "Latitudes medias norte y Latitudes medias sur");
  assert.equal(latitudeText({ lat_north: 23, lat_south: -23 }), "23°N–23°S");
  assert.equal(latitudeText({ lat_north: 90, lat_south: 60 }), "90°N–60°N");
  assert.equal(formatValue(null), "sin dato");
  assert.equal(formatValue(Number.NaN), "sin dato");
  assert.equal(formatValue(0), "0");
  assert.equal(formatValue(0.034912), "0,0349");
  assert.equal(formatValue(-0.015), "-0,015");
  assert.equal(formatValue(0.8453), "0,845");
});
