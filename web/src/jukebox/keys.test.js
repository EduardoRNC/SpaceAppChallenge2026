import { test } from "node:test";
import assert from "node:assert/strict";

import { ownedKeys, shortcutFor } from "./keys.js";

const BODY = { tagName: "BODY" };
const el = (tagName, extra = {}) => ({ tagName, getAttribute: (k) => extra[k] ?? null, ...extra });
const key = (k, target = BODY, extra = {}) => ({
  key: k,
  code: /^[0-9]$/.test(k) ? `Digit${k}` : k === " " ? "Space" : k,
  target,
  ...extra,
});

test("en la página: Espacio, flechas, Inicio, Fin, 1–4, Mayús+1–4 y 0", () => {
  assert.deepEqual(shortcutFor(key(" ")), { type: "toggle" });
  assert.deepEqual(shortcutFor(key("ArrowLeft")), { type: "step", direction: -1 });
  assert.deepEqual(shortcutFor(key("ArrowRight")), { type: "step", direction: 1 });
  assert.deepEqual(shortcutFor(key("Home")), { type: "start" });
  assert.deepEqual(shortcutFor(key("End")), { type: "end" });
  assert.deepEqual(shortcutFor(key("2")), { type: "mute", index: 1 });
  assert.deepEqual(shortcutFor(key("!", BODY, { code: "Digit1", shiftKey: true })), { type: "solo", index: 0 });
  assert.deepEqual(shortcutFor(key("0")), { type: "reset" });
  assert.equal(shortcutFor(key("5")), null, "solo hay cuatro pistas");
  assert.equal(shortcutFor(key("x")), null);
});

test("con modificadores, composición de texto o evento ya atendido, nada", () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    assert.equal(shortcutFor(key(" ", BODY, extra)), null, JSON.stringify(extra));
    assert.equal(shortcutFor(key("1", BODY, extra)), null, JSON.stringify(extra));
  }
});

test("botones, enlaces y <summary> se quedan Espacio y Enter, no los demás atajos", () => {
  for (const target of [el("BUTTON"), el("SUMMARY"), el("A", { href: "https://svs.gsfc.nasa.gov/3912/" }), el("DIV", { role: "button" })]) {
    assert.equal(shortcutFor(key(" ", target)), null, target.tagName);
    assert.equal(shortcutFor(key("Enter", target)), null, target.tagName);
    assert.deepEqual(shortcutFor(key("ArrowRight", target)), { type: "step", direction: 1 });
    assert.deepEqual(shortcutFor(key("1", target)), { type: "mute", index: 0 });
  }
  assert.deepEqual(shortcutFor(key(" ", el("A"))), { type: "toggle" }, "un <a> sin href no es un enlace");
});

test("la barra de posición se queda las flechas, Inicio y Fin; Espacio sigue reproduciendo", () => {
  const range = el("INPUT", { type: "range" });
  for (const k of ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp"]) assert.equal(shortcutFor(key(k, range)), null, k);
  assert.deepEqual(shortcutFor(key(" ", range)), { type: "toggle" });
  assert.deepEqual(shortcutFor(key("3", range)), { type: "mute", index: 2 });
});

test("el piano roll y las gráficas (role=slider) se quedan las teclas de navegación", () => {
  for (const target of [el("CANVAS", { role: "slider" }), el("svg", { role: "slider" })]) {
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
      assert.equal(shortcutFor(key(k, target)), null, `${target.tagName} ${k}`);
    }
    assert.deepEqual(shortcutFor(key(" ", target)), { type: "toggle" }, "Espacio sigue reproduciendo");
    assert.deepEqual(shortcutFor(key("2", target)), { type: "mute", index: 1 });
  }
});

test("campos de texto, desplegables y elementos editables se quedan todas las teclas", () => {
  const targets = [
    el("INPUT", { type: "text" }),
    el("INPUT", { type: "number" }),
    el("INPUT", { type: "search" }),
    el("TEXTAREA"),
    el("SELECT"),
    el("DIV", { isContentEditable: true }),
    el("DIV", { role: "textbox" }),
  ];
  for (const target of targets) {
    for (const k of [" ", "ArrowLeft", "Home", "End", "1", "0"]) {
      assert.equal(shortcutFor(key(k, target)), null, `${target.tagName} ${target.type ?? ""} ${k}`);
    }
  }
});

test("radios: Espacio y flechas cambian la opción; los números siguen silenciando", () => {
  const radio = el("INPUT", { type: "radio" });
  assert.equal(shortcutFor(key(" ", radio)), null);
  assert.equal(shortcutFor(key("ArrowRight", radio)), null);
  assert.deepEqual(shortcutFor(key("1", radio)), { type: "mute", index: 0 });
});

test("mantener pulsada una tecla solo repite los saltos", () => {
  assert.equal(shortcutFor(key(" ", BODY, { repeat: true })), null);
  assert.equal(shortcutFor(key("1", BODY, { repeat: true })), null);
  assert.equal(shortcutFor(key("End", BODY, { repeat: true })), null);
  assert.deepEqual(shortcutFor(key("ArrowRight", BODY, { repeat: true })), { type: "step", direction: 1 });
});

test("ownedKeys sin destino o con un elemento cualquiera: ninguna", () => {
  assert.equal(ownedKeys(null), null);
  assert.equal(ownedKeys(el("DIV")), null);
  assert.equal(ownedKeys(el("VIDEO")), null);
});
