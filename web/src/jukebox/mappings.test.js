import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { effectKey, formatValue, HARMONY, latitudeText, METRIC_ORDER, REGION_IDS, regionsText, TRACK_MAPPINGS, usesOf } from "./mappings.js";
import { STEM_IDS } from "./manifest.js";
import { createI18n } from "../i18n/index.js";

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
  assert.deepEqual(REGION_IDS, regions);
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
  for (const r of REGION_IDS) {
    assert.deepEqual(ids("v", r), [], "v no se usa en la música");
    assert.deepEqual(ids("cover", r), [], "cover no se usa en la música");
  }
});

test("cada efecto tiene su texto en los dos idiomas", () => {
  for (const lang of ["en", "es"]) {
    const i18n = createI18n({ lang });
    for (const [id, uses] of [[HARMONY.id, HARMONY.uses], ...Object.entries(TRACK_MAPPINGS)]) {
      for (const u of uses) assert.ok(i18n.has(effectKey(id, u.metric)), `${lang} ${id}.${u.metric}`);
    }
    for (const r of REGION_IDS) assert.ok(i18n.has(`regions.names.${r}`), `${lang} ${r}`);
  }
});

test("textos de regiones, latitudes y valores en inglés y en español", () => {
  const en = createI18n({ lang: "en" });
  const es = createI18n({ lang: "es" });
  assert.equal(regionsText({ regions: "all" }, en.t), "all bands");
  assert.equal(regionsText({ regions: "all" }, es.t), "todas las franjas");
  assert.equal(regionsText({ regions: ["norte_medio", "sur_medio"] }, en.t), "Northern mid-latitudes and Southern mid-latitudes");
  assert.equal(regionsText({ regions: ["norte_medio", "sur_medio"] }, es.t), "Latitudes medias norte y Latitudes medias sur");
  assert.equal(latitudeText({ lat_north: 23, lat_south: -23 }), "23°N–23°S");
  assert.equal(latitudeText({ lat_north: 90, lat_south: 60 }), "90°N–60°N");
  assert.equal(formatValue(null, en), "no value");
  assert.equal(formatValue(Number.NaN, es), "sin dato");
  assert.equal(formatValue(0, es), "0");
  assert.equal(formatValue(0.034912, en), "0.0349");
  assert.equal(formatValue(0.034912, es), "0,0349");
  assert.equal(formatValue(-0.015, en), "-0.015");
  assert.equal(formatValue(-0.015, es), "-0,015");
  assert.equal(formatValue(0.8453, es), "0,845");
});
