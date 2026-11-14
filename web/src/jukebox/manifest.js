// Manifiesto de activos de cada vídeo y catálogo de vídeos (los escribe video_jukebox/jukebox.py).

export const SCHEMA = "earth-jukebox-web";
export const VERSION = 2;
export const CATALOG = "data/jukebox/catalog.json";
export const CATALOG_SCHEMA = "earth-jukebox-catalog";
export const ROLES = ["pad", "voices", "accents", "bass"];
const LANG_IDS = ["en", "es"];

/** Ruta relativa a la página: sin "/" inicial, sin esquema y sin "..". */
export function isRelative(src) {
  return (
    typeof src === "string" &&
    src.length > 0 &&
    !src.startsWith("/") &&
    !src.includes("://") &&
    !src.includes("\\") &&
    !src.split("/").includes("..")
  );
}

/**
 * Problemas del manifiesto (vacía si es válido): [{ code, ...variables }]. El texto de cada
 * código está en i18n (problems.manifest.<code>).
 */
export function checkManifest(m) {
  const errors = [];
  if (m?.schema !== SCHEMA) return [{ code: "schema", value: String(m?.schema) }];
  if (m.version !== VERSION) errors.push({ code: "version", value: String(m.version) });
  const stems = m.audio?.stems ?? [];
  const ids = stems.map((s) => s.id);
  const roles = stems.map((s) => s.role);
  if (stems.length !== ROLES.length || new Set(ids).size !== ids.length || [...roles].sort().join() !== [...ROLES].sort().join()) {
    errors.push({ code: "stems", ids: ids.join(", ") });
  }
  const srcs = [m.video?.src, m.timeline?.src, ...stems.map((s) => s.src)];
  for (const src of srcs) if (!isRelative(src)) errors.push({ code: "path", src: String(src) });
  if (!(m.video?.fps > 0) || !(m.video?.frames > 0)) errors.push({ code: "video" });
  if (!(m.audio?.samples > 0) || !(m.audio?.sample_rate > 0)) errors.push({ code: "audio" });
  if (!m.test && !m.credits?.some((c) => c.url?.includes("nasa.gov"))) errors.push({ code: "credits" });
  if (!LANG_IDS.every((l) => typeof m.texts?.[l]?.title === "string")) errors.push({ code: "texts" });
  return errors;
}

/** Problemas del catálogo de vídeos: [{ code, ...variables }] (problems.catalog.<code>). */
export function checkCatalog(c) {
  if (c?.schema !== CATALOG_SCHEMA) return [{ code: "schema", value: String(c?.schema) }];
  if (!Array.isArray(c.videos) || !c.videos.length) return [{ code: "empty" }];
  return c.videos.filter((v) => !v?.id || !isRelative(v.manifest)).map((v) => ({ code: "entry", id: String(v?.id) }));
}

/** El vídeo pedido en la URL (?video=id) o, si no existe, el primero del catálogo. */
export function pickVideo(catalog, search = "") {
  const wanted = new URLSearchParams(search).get("video");
  return catalog.videos.find((v) => v.id === wanted) ?? catalog.videos[0];
}

/** La misma URL con otro vídeo (conserva ?lang y el resto de parámetros). */
export function videoHref(href, id) {
  const url = new URL(href);
  url.searchParams.set("video", id);
  return url.href;
}

/** URL absoluta de un activo, relativa a la página (funciona en una subcarpeta). */
export function assetUrl(src, base) {
  return new URL(src, base).href;
}
