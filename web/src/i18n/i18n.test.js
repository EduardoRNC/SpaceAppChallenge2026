import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createI18n,
  DEFAULT_LANG,
  DICTIONARIES,
  flatten,
  initialLang,
  interpolate,
  lookup,
  placeholders,
  safeStorage,
  STORAGE_KEY,
} from "./index.js";
import { checkManifest } from "../jukebox/manifest.js";
import { checkTimeline } from "../jukebox/timeline.js";
import { DATE_OPTIONS, formatTime } from "../jukebox/format.js";
import { problemsText } from "../jukebox/texts.js";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const WEB = fileURLToPath(new URL("../../", import.meta.url));
const PUBLIC = `${WEB}public/`;
const HAVE_ASSETS = existsSync(`${PUBLIC}data/jukebox/ecco2.json`);
const readJson = (p) => JSON.parse(readFileSync(PUBLIC + p, "utf8"));

const en = flatten(DICTIONARIES.en);
const es = flatten(DICTIONARIES.es);

function memoryStore() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
}

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sources(`${dir}${d.name}/`) : d.name.endsWith(".js") && !d.name.endsWith(".test.js") ? [`${dir}${d.name}`] : [],
  );
const JUKEBOX_SOURCES = [...sources(`${SRC}jukebox/`), `${SRC}i18n/index.js`];

test("los dos idiomas tienen las mismas claves, sin textos vacíos y con las mismas variables", () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const [key, text] of Object.entries(en)) {
    for (const [lang, dict] of [["en", en], ["es", es]]) {
      assert.equal(typeof dict[key], "string", `${lang} ${key}`);
      assert.ok(dict[key].trim().length > 0, `${lang} ${key} vacío`);
    }
    assert.deepEqual(placeholders(es[key]), placeholders(text), `variables de ${key}`);
  }
});

test("las claves que usan el código y el HTML existen en los dos idiomas", () => {
  const roots = Object.keys(DICTIONARIES.en).join("|");
  const literal = new RegExp(`["'\`]((?:${roots})\\.[\\w.]+)["'\`]`, "g");
  const used = new Set();
  for (const file of JUKEBOX_SOURCES) for (const m of readFileSync(file, "utf8").matchAll(literal)) used.add(m[1]);
  const html = readFileSync(`${WEB}jukebox.html`, "utf8");
  for (const m of html.matchAll(/data-i18n(?:-html)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(";")) used.add(pair.split(":")[1].trim());
  assert.ok(used.size > 60, `solo ${used.size} claves encontradas`);
  for (const key of used) {
    assert.ok(key in en, `falta en inglés: ${key}`);
    assert.ok(key in es, `falta en español: ${key}`);
  }
});

test("el HTML empieza en inglés y tiene el selector English / Español", () => {
  const html = readFileSync(`${WEB}jukebox.html`, "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /data-lang="en"[^>]*>English</);
  assert.match(html, /data-lang="es"[^>]*>Español</);
  assert.match(html, /lang="es" data-lang="es"/, "el botón Español se pronuncia en español");
});

test("los componentes no llevan textos en español escritos a mano", () => {
  const spanish = /[áéíóúñÁÉÍÓÚÑ¿¡]|\b(Pulsa|Cargando|Silenciar|Reproducir|Acorde|Suena|Ahora|sin dato|Listo|pista|vídeo)\b/;
  for (const file of JUKEBOX_SOURCES) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
      .join("\n");
    for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      if (m[2] === "Español") continue; // el nombre del idioma en el selector
      assert.doesNotMatch(m[2], spanish, `${file.slice(SRC.length)}: ${m[0]}`);
    }
  }
});

test("los textos de los datos: en español, los originales del pipeline; en inglés, todos traducidos", (t) => {
  if (!HAVE_ASSETS) return t.skip("sin activos generados");
  const manifest = readJson("data/jukebox/ecco2.json");
  const timeline = readJson(manifest.timeline.src);
  const fields = [
    ["data.title", manifest.title],
    ["data.notice", manifest.notice],
    ["data.disclaimer", manifest.disclaimer],
    ["data.disclaimer", timeline.disclaimer],
    ...manifest.audio.stems.map((s) => [`data.stems.${s.id}.label`, s.label]),
    ...manifest.credits.flatMap((c, i) =>
      ["role", "text", "detail"].filter((f) => c[f]).map((f) => [`data.credits.${i}.${f}`, c[f]]),
    ),
    ...Object.entries(timeline.features.metrics).flatMap(([id, m]) =>
      ["label", "unit", "derived_from", "caveat"].map((f) => [`data.metrics.${id}.${f}`, m[f]]),
    ),
  ];
  for (const [key, original] of fields) {
    assert.equal(es[key], original, `es ${key} debe ser el texto de los datos`);
    assert.ok(en[key], `falta en inglés: ${key}`);
  }
  for (const r of timeline.regions) assert.ok(en[`regions.names.${r.id}`] && es[`regions.names.${r.id}`], r.id);
});

test("las unidades y nombres propios no se traducen", () => {
  for (const id of ["speed", "u", "v"]) assert.equal(en[`data.metrics.${id}.unit`], "px/frame");
  assert.equal(en["data.metrics.vort.unit"], "1/frame");
  assert.equal(en["data.metrics.temp.unit"], "index 0..1");
  for (const key of ["data.title", "data.notice", "header.intro", "player.caption"]) {
    assert.match(en[key], /NASA|ECCO2/, key);
  }
  assert.match(en["mixer.dx7"], /DX7/);
  assert.match(es["mixer.dx7"], /DX7/);
});

test("avisos científicos precisos en los dos idiomas", () => {
  assert.match(en["regions.warning"], /uncalibrated visual proxies/);
  assert.match(en["regions.warning"], /optical flow/);
  assert.match(en["regions.proxy"], /Visual proxy · uncalibrated/);
  assert.match(en["data.disclaimer"], /visual proxies/);
  assert.match(en["data.disclaimer"], /not calibrated physical measurements/);
  assert.match(en["data.metrics.speed.label"], /Apparent motion/);
  assert.match(en["data.metrics.vort.label"], /Apparent turbulence/);
  assert.match(en["what.body"], /visual indices/);
  assert.match(es["regions.warning"], /proxies visuales sin calibrar/);
  assert.match(es["regions.warning"], /flujo óptico/);
  assert.match(es["regions.proxy"], /Proxy visual · sin calibrar/);
  assert.match(es["data.metrics.speed.label"], /Movimiento aparente/);
  for (const dict of [en, es]) {
    for (const id of ["temp", "speed", "u", "v", "vort", "cover"]) assert.ok(dict[`data.metrics.${id}.caveat`], id);
  }
});

test("t(): idioma activo, después inglés, después la clave", () => {
  const missing = [];
  const dictionaries = { en: { a: { b: "Hello {name}" }, only: "English only" }, es: { a: { b: "Hola {name}" } } };
  const i18n = createI18n({ dictionaries, lang: "es", onMissing: (k, l) => missing.push([k, l]) });
  assert.equal(i18n.t("a.b", { name: "Nari" }), "Hola Nari");
  assert.equal(i18n.t("only"), "English only");
  assert.equal(i18n.t("nope.key"), "nope.key");
  assert.deepEqual(missing, [["nope.key", "es"]]);
  assert.equal(i18n.data("nope", "original"), "original");
  assert.equal(i18n.data("a.b", "original", { name: "x" }), "Hola x");
  assert.equal(lookup(dictionaries.en, "a"), undefined, "una rama no es un texto");
  assert.equal(interpolate("{a} y {b}", { a: 1 }), "1 y {b}");
});

test("idioma inicial: ?lang=, si no el guardado, si no inglés", () => {
  const store = memoryStore();
  const storage = safeStorage(() => store);
  assert.equal(initialLang({ search: "", storage }), DEFAULT_LANG);
  assert.equal(DEFAULT_LANG, "en");
  store.setItem(STORAGE_KEY, "es");
  assert.equal(initialLang({ search: "", storage }), "es");
  assert.equal(initialLang({ search: "?lang=en", storage }), "en");
  store.setItem(STORAGE_KEY, "fr");
  assert.equal(initialLang({ search: "?lang=xx", storage }), "en", "valores desconocidos no cuentan");
});

test("cambiar de idioma lo guarda y avisa una vez; un idioma desconocido no cambia nada", () => {
  const store = memoryStore();
  const i18n = createI18n({ storage: safeStorage(() => store) });
  const seen = [];
  i18n.onChange((l) => seen.push(l));
  assert.equal(i18n.lang, "en");
  assert.equal(i18n.setLang("es"), true);
  assert.equal(i18n.setLang("es"), false);
  assert.equal(i18n.setLang("fr"), false);
  assert.deepEqual(seen, ["es"]);
  assert.equal(store.data.get(STORAGE_KEY), "es");
  assert.equal(i18n.t("transport.play"), "Reproducir");
});

test("sin almacenamiento (bloqueado o inexistente) el idioma sigue funcionando", () => {
  const blocked = safeStorage(() => {
    throw new DOMException("denied", "SecurityError");
  });
  const throwing = safeStorage(() => ({
    getItem() {
      throw new Error("x");
    },
    setItem() {
      throw new Error("quota");
    },
  }));
  for (const storage of [blocked, throwing, safeStorage(() => undefined)]) {
    assert.equal(storage.get(STORAGE_KEY), null);
    assert.equal(storage.set(STORAGE_KEY, "es"), false);
    assert.equal(initialLang({ storage }), "en");
    const i18n = createI18n({ storage });
    assert.equal(i18n.setLang("es"), true);
    assert.equal(i18n.lang, "es");
  }
});

test("números, decimales y fechas según el idioma", () => {
  const en = createI18n({ lang: "en" });
  const es = createI18n({ lang: "es" });
  assert.equal(en.number(0.5), "0.5");
  assert.equal(es.number(0.5), "0,5");
  assert.equal(formatTime(67.66, en.number(1.5).charAt(1)), "1:07.7");
  assert.equal(formatTime(67.66, es.number(1.5).charAt(1)), "1:07,7");
  const date = new Date(Date.UTC(2007, 2, 25, 12));
  assert.equal(en.date(date, DATE_OPTIONS), "March 25, 2007");
  assert.equal(es.date(date, DATE_OPTIONS), "25 de marzo de 2007");
  en.setLang("es");
  assert.equal(en.number(0.5), "0,5", "el formateador sigue al idioma activo");
});

test("mensajes de error en inglés y en español", () => {
  const en = createI18n({ lang: "en" });
  const es = createI18n({ lang: "es" });
  const problems = checkManifest({ schema: "earth-jukebox-web", version: 2, video: {}, audio: {}, credits: [] });
  assert.match(problemsText(en, "manifest", problems), /unsupported version: 2/);
  assert.match(problemsText(es, "manifest", problems), /versión no soportada: 2/);
  assert.match(problemsText(en, "manifest", problems), /NASA SVS credits are missing/);
  assert.match(problemsText(es, "manifest", problems), /faltan los créditos del NASA SVS/);
  const tl = checkTimeline({ schema: "x" });
  assert.equal(problemsText(en, "timeline", tl), "unknown timeline schema: x");
  assert.equal(problemsText(es, "timeline", tl), "esquema de timeline desconocido: x");
  assert.equal(en.t("errors.fetch", { url: "a.json", status: 404 }), "could not load a.json (HTTP 404)");
  assert.equal(es.t("errors.fetch", { url: "a.json", status: 404 }), "no se pudo cargar a.json (HTTP 404)");
});

test("aviso de carga inicial del vídeo en inglés y en español, con el nombre del botón", () => {
  for (const [lang, retry] of [["en", "Retry"], ["es", "Reintentar"]]) {
    const i18n = createI18n({ lang });
    assert.equal(i18n.t("notice.retry"), retry);
    for (const key of ["notice.loadSlow", "notice.loadError"]) {
      assert.ok(i18n.t(key).includes(retry), `${lang} ${key}`);
    }
    assert.ok(i18n.t("status.loadingVideo"));
  }
  assert.match(createI18n({ lang: "es" }).t("notice.loadSlow"), /vídeo/);
});

test("cambiar de idioma solo reescribe textos: no toca el reproductor, el transporte ni el vídeo", () => {
  const main = readFileSync(`${SRC}jukebox/main.js`, "utf8");
  const body = (name) => {
    const start = main.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = main.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < main.length; i++) {
      if (main[i] === "{") depth += 1;
      if (main[i] === "}" && --depth === 0) return main.slice(open, i + 1);
    }
    return "";
  };
  const text = ["applyLanguage", "relabelStems", "updateMixButtons", "renderCredits", "updatePlayButton", "syncSliders"].map(body).join("\n");
  assert.doesNotMatch(text, /\b(player|transport|follower)\.(?!playing\b|position\()\w+\s*\(/, "sin llamadas al reproductor (solo leer la posición)");
  assert.doesNotMatch(text, /el\.video|\.currentTime|\.play\(|\.pause\(/, "sin tocar el vídeo");
  assert.match(body("applyLanguage"), /documentElement\.lang = i18n\.lang/);
  assert.match(body("applyLanguage"), /el\.time\.textContent = /, "el reloj usa el decimal del idioma también antes de cargar");
});
