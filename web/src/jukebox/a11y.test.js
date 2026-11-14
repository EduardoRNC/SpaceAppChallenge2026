// Accesibilidad que se puede comprobar sin navegador: nombres, relaciones ARIA, controles de
// teclado y contraste de la paleta (WCAG 2.x). El contraste real de cada texto, con
// transparencias, se mide además en el navegador.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const html = readFileSync(`${WEB}jukebox.html`, "utf8");
const css = readFileSync(`${WEB}src/style.css`, "utf8");
const main = readFileSync(`${WEB}src/jukebox/main.js`, "utf8");
const regions = readFileSync(`${WEB}src/jukebox/regions.js`, "utf8");
const pianoroll = readFileSync(`${WEB}src/jukebox/pianoroll.js`, "utf8");
const MANIFEST = `${WEB}public/data/jukebox/ecco2.json`;

const tags = (name) => [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, "g"))];
const attr = (attrs, k) => attrs.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1] ?? null;
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function luminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const cssVar = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))[1];

test("todos los botones del HTML tienen nombre accesible", () => {
  for (const [, attrs, body] of tags("button")) {
    const name = attr(attrs, "aria-label") ?? body.replace(/<[^>]+>/g, "").trim();
    assert.ok(name, `botón sin nombre: <button${attrs}>`);
  }
});

test("las referencias ARIA y los <label for> apuntan a elementos que existen", () => {
  for (const m of html.matchAll(/\s(aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)) {
    for (const id of m[2].split(/\s+/)) assert.ok(ids.has(id), `${m[1]}="${id}" no existe`);
  }
});

test("Reproducir/Pausa cambia de nombre, así que no es un botón de alternancia", () => {
  const play = html.match(/<button id="jb-play"([^>]*)>/)[1];
  assert.equal(attr(play, "aria-pressed"), null);
  assert.doesNotMatch(main, /el\.play\.setAttribute\("aria-pressed"/);
});

test("los botones de alternancia (idioma, silencio, solo) exponen aria-pressed", () => {
  for (const lang of ["en", "es"]) {
    const b = html.match(new RegExp(`<button[^>]*data-lang="${lang}"[^>]*>`))[0];
    assert.match(b, /aria-pressed="(true|false)"/);
    assert.match(b, new RegExp(`lang="${lang}"`), "el nombre del idioma se pronuncia en su idioma");
  }
  assert.match(main, /mute\.setAttribute\("aria-pressed"/);
  assert.match(main, /\.jb-solo"\)\.setAttribute\("aria-pressed"/);
});

test("el piano roll y las gráficas se manejan con teclado como controles deslizantes", () => {
  const canvas = html.match(/<canvas([\s\S]*?)>/)[1];
  assert.equal(attr(canvas, "role"), "slider");
  assert.equal(attr(canvas, "tabindex"), "0");
  assert.ok(attr(canvas, "aria-label"));
  assert.ok(ids.has(attr(canvas, "aria-describedby")));
  for (const k of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) assert.match(pianoroll, new RegExp(k));
  assert.match(pianoroll, /addEventListener\("keydown"/);
  assert.match(regions, /role: "slider"/);
  assert.match(regions, /tabindex: 0/);
  for (const k of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext", "aria-label"]) assert.match(regions, new RegExp(k));
  assert.match(regions, /addEventListener\("keydown"/);
});

test("avisos y estado: región viva para el lector de pantalla", () => {
  assert.match(html, /id="jb-notice"[^>]*role="alert"/);
  assert.match(html, /id="jb-status"[^>]*role="status"/);
});

test("el foco siempre se ve", () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
  assert.doesNotMatch(css + readFileSync(`${WEB}src/jukebox/jukebox.css`, "utf8"), /outline:\s*(none|0)\b/);
});

test("contraste de la paleta: texto ≥ 4,5:1 y foco ≥ 3:1 sobre el fondo", () => {
  const bg = cssVar("bg");
  assert.ok(contrast(cssVar("fg"), bg) >= 4.5);
  assert.ok(contrast(cssVar("muted"), bg) >= 4.5);
  assert.ok(contrast(cssVar("accent"), bg) >= 4.5, "acento: botón principal y fichas");
  assert.ok(contrast(cssVar("bg"), cssVar("accent")) >= 4.5, "texto del botón principal");
  assert.ok(contrast(cssVar("focus"), bg) >= 3);
});

test("contraste de los colores de pista (texto de las fichas) sobre el fondo", { skip: !existsSync(MANIFEST) }, () => {
  const bg = cssVar("bg");
  for (const s of JSON.parse(readFileSync(MANIFEST, "utf8")).audio.stems) {
    assert.ok(contrast(s.color, bg) >= 4.5, `${s.id} ${s.color}: ${contrast(s.color, bg).toFixed(2)}`);
  }
});

test("pistas silenciadas: el texto se atenúa sin bajar de 4,5:1", () => {
  const jukeboxCss = readFileSync(`${WEB}src/jukebox/jukebox.css`, "utf8");
  const opacity = Number(jukeboxCss.match(/\.jb-silent \.jb-name\s*\{\s*opacity:\s*([\d.]+)/)[1]);
  const mix = (hex, alpha, under) => {
    const c = (h) => h.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16));
    const [a, b] = [c(hex), c(under)];
    return `#${a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
  };
  const row = mix("#ffffff", 0.04, cssVar("bg"));
  assert.ok(contrast(mix(cssVar("muted"), opacity, row), row) >= 4.5, `opacidad ${opacity}`);
});

test("la fórmula de contraste da los valores de referencia", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});
