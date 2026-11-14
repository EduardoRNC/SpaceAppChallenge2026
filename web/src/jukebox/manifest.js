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

/** Lista de problemas del manifiesto (vacía si es válido). */
export function checkManifest(m) {
  const errors = [];
  if (m?.schema !== SCHEMA) return [`esquema desconocido: ${m?.schema}`];
  if (m.version !== 1) errors.push(`versión no soportada: ${m.version}`);
  const ids = (m.audio?.stems ?? []).map((s) => s.id);
  if (ids.join() !== STEM_IDS.join()) errors.push(`pistas inesperadas: ${ids.join(", ")}`);
  const srcs = [m.video?.src, m.timeline?.src, ...(m.audio?.stems ?? []).map((s) => s.src)];
  for (const src of srcs) if (!isRelative(src)) errors.push(`ruta no relativa: ${src}`);
  if (!(m.video?.fps > 0) || !(m.video?.frames > 0)) errors.push("vídeo sin fps o frames");
  if (!(m.audio?.samples > 0) || !(m.audio?.sample_rate > 0)) errors.push("audio sin longitud");
  if (!m.credits?.some((c) => c.url?.includes("svs.gsfc.nasa.gov"))) errors.push("faltan los créditos del NASA SVS");
  return errors;
}

/** URL absoluta de un activo, relativa a la página (funciona en una subcarpeta). */
export function assetUrl(src, base) {
  return new URL(src, base).href;
}
