import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { effectKey, formatValue, HARMONY_ID, latitudeText, ownersOf, REGION_IDS, regionsText, usesOf } from "./mappings.js";
import { createI18n } from "../i18n/index.js";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(PUBLIC + p, "utf8"));

// La música de ECCO2, tal como la escribe compose.py en el timeline.
const ECCO2 = {
  harmony: [{ metric: "temp", regions: ["norte_medio", "sur_medio"], mode: "contrast" }],
  tracks: {
    temperatura: { role: "pad", uses: [{ metric: "temp", regions: "all" }] },
    corrientes: {
      role: "voices",
      uses: [
        { metric: "speed", regions: "all" },
        { metric: "temp", regions: "all" },
        { metric: "vort", regions: "all" },
      ],
    },
    remolinos: { role: "accents", uses: [{ metric: "vort", regions: "all" }] },
    ecuatorial: { role: "bass", uses: [{ metric: "u", regions: ["tropicos"], direction: -1 }] },
  },
};

test("quién usa cada medida en cada región", () => {
  const ids = (m, r) => usesOf(ECCO2, m, r).map((u) => u.id);
  assert.deepEqual(ids("u", "tropicos"), ["ecuatorial"]);
  assert.deepEqual(ids("u", "artico"), [], "el bajo solo escucha los trópicos");
  assert.deepEqual(ids("temp", "norte_medio"), [HARMONY_ID, "temperatura", "corrientes"]);
  assert.deepEqual(ids("temp", "tropicos"), ["temperatura", "corrientes"]);
  assert.deepEqual(ids("vort", "antartico"), ["corrientes", "remolinos"]);
  assert.deepEqual(ids("speed", "sur_medio"), ["corrientes"]);
  for (const r of REGION_IDS) {
    assert.deepEqual(ids("v", r), [], "v no se usa en la música");
    assert.deepEqual(ids("cover", r), [], "cover no se usa en la música");
  }
});

test("en cada vídeo publicado, las medidas y regiones de la música existen y cada efecto tiene texto", (t) => {
  const path = `${PUBLIC}data/jukebox/catalog.json`;
  if (!existsSync(path)) return t.skip("sin activos generados");
  for (const v of readJson("data/jukebox/catalog.json").videos) {
    const m = readJson(v.manifest);
    const tl = readJson(m.timeline.src);
    const regions = tl.regions.map((r) => r.id);
    assert.deepEqual(regions, REGION_IDS);
    assert.deepEqual(Object.keys(tl.mapping.tracks), m.audio.stems.map((s) => s.id));
    for (const lang of ["en", "es"]) {
      const i18n = createI18n({ lang });
      i18n.addData(m.texts);
      for (const [owner, uses] of ownersOf(tl.mapping)) {
        for (const use of uses) {
          assert.ok(tl.features.metrics[use.metric], `${v.id}: ${use.metric}`);
          if (use.regions !== "all") for (const r of use.regions) assert.ok(regions.includes(r), r);
          assert.ok(i18n.has(effectKey(owner, use.metric)), `${v.id} ${lang} ${owner}.${use.metric}`);
        }
      }
      for (const r of REGION_IDS) assert.ok(i18n.has(`regions.names.${r}`), `${lang} ${r}`);
    }
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
