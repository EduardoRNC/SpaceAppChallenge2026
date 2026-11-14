// Manifiesto de activos que escribe video_jukebox/build_web.py.

export const SCHEMA = "earth-jukebox-web";
export const STEM_IDS = ["temperatura", "corrientes", "remolinos", "ecuatorial"];

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
  if (m.version !== 1) errors.push({ code: "version", value: String(m.version) });
  const ids = (m.audio?.stems ?? []).map((s) => s.id);
  if (ids.join() !== STEM_IDS.join()) errors.push({ code: "stems", ids: ids.join(", ") });
  const srcs = [m.video?.src, m.timeline?.src, ...(m.audio?.stems ?? []).map((s) => s.src)];
  for (const src of srcs) if (!isRelative(src)) errors.push({ code: "path", src: String(src) });
  if (!(m.video?.fps > 0) || !(m.video?.frames > 0)) errors.push({ code: "video" });
  if (!(m.audio?.samples > 0) || !(m.audio?.sample_rate > 0)) errors.push({ code: "audio" });
  if (!m.credits?.some((c) => c.url?.includes("svs.gsfc.nasa.gov"))) errors.push({ code: "credits" });
  return errors;
}

/** URL absoluta de un activo, relativa a la página (funciona en una subcarpeta). */
export function assetUrl(src, base) {
  return new URL(src, base).href;
}
