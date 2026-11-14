// Traducciones de la interfaz: inglés (predeterminado) y español.
//
// Cada idioma es un objeto anidado de textos (en.js, es.js); `t("transport.play")` busca la
// clave en el idioma activo, después en inglés y, si no está en ninguno, devuelve la propia
// clave (y lo avisa con `onMissing`). Los textos pueden llevar variables: "{name}".
// Los textos que vienen de los datos (manifiesto, timeline.json) se traducen por su
// identificador; si falta la traducción se muestra el texto original de los datos.

import en from "./en.js";
import es from "./es.js";

export const LANGS = {
  en: { name: "English", locale: "en-US" },
  es: { name: "Español", locale: "es-ES" },
};
export const DEFAULT_LANG = "en";
export const STORAGE_KEY = "earth-jukebox.lang";
export const DICTIONARIES = { en, es };

export const isLang = (x) => Object.hasOwn(LANGS, x);

/** Valor de una clave "a.b.c" en un objeto anidado (o undefined). */
export function lookup(dict, key) {
  let node = dict;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Sustituye {nombre} por vars.nombre; deja la marca si falta la variable. */
export function interpolate(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (all, name) => (vars[name] == null ? all : String(vars[name])));
}

/** Todas las claves de un diccionario: { "a.b": "texto" }. */
export function flatten(dict, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Variables que usa un texto: ["name", …] ordenadas. */
export const placeholders = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/**
 * Preferencia guardada sin romper nada si el almacenamiento no existe o lo bloquea el
 * navegador (modo privado, iframes con sandbox, cookies desactivadas…).
 */
export function safeStorage(getStore = () => globalThis.localStorage) {
  const store = () => {
    try {
      return getStore() ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return store()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const s = store();
        if (!s) return false;
        s.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Idioma inicial: ?lang= en la URL, si no el guardado, si no inglés. */
export function initialLang({ search = "", storage = null } = {}) {
  const fromUrl = new URLSearchParams(search).get("lang");
  if (isLang(fromUrl)) return fromUrl;
  const saved = storage?.get(STORAGE_KEY);
  return isLang(saved) ? saved : DEFAULT_LANG;
}

export function createI18n({ dictionaries = DICTIONARIES, lang = DEFAULT_LANG, storage = null, onMissing = () => {} } = {}) {
  let current = isLang(lang) ? lang : DEFAULT_LANG;
  const listeners = new Set();
  const formats = new Map();

  const find = (key) => lookup(dictionaries[current], key) ?? lookup(dictionaries[DEFAULT_LANG], key);

  /** Formateador Intl del idioma activo (se reutiliza: se piden en cada fotograma). */
  function format(kind, options) {
    const id = `${current}|${kind}|${JSON.stringify(options)}`;
    if (!formats.has(id)) {
      const locale = LANGS[current].locale;
      formats.set(id, kind === "date" ? new Intl.DateTimeFormat(locale, options) : new Intl.NumberFormat(locale, options));
    }
    return formats.get(id);
  }

  return {
    get lang() {
      return current;
    },
    get locale() {
      return LANGS[current].locale;
    },
    t(key, vars) {
      const text = find(key);
      if (text == null) {
        onMissing(key, current);
        return key;
      }
      return interpolate(text, vars);
    },
    /** Texto de los datos: la traducción de `key` o, si no hay, el original. */
    data(key, original, vars) {
      const text = find(key);
      return text == null ? original : interpolate(text, vars);
    },
    has: (key) => find(key) != null,
    number: (value, options = {}) => format("number", options).format(value),
    date: (value, options = {}) => format("date", options).format(value),
    setLang(next) {
      if (!isLang(next) || next === current) return false;
      current = next;
      storage?.set(STORAGE_KEY, next);
      for (const fn of listeners) fn(next);
      return true;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Traduce el HTML estático marcado con atributos:
 * data-i18n="clave" (texto), data-i18n-html="clave" (texto con marcas propias: <kbd>,
 * <strong>…; solo textos de en.js/es.js, nunca datos) y data-i18n-attr="aria-label:clave;title:clave".
 */
export function translateDom(root, t) {
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll("[data-i18n-html]")) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of node.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
}
