// Qué medida de la imagen controla cada parte de la música.
//
// Lo dice el propio timeline.json de cada vídeo (`mapping`, lo escribe video_jukebox/compose.py):
//   { harmony: [{ metric, regions }], tracks: { <pista>: { role, uses: [{ metric, regions }] } } }
// con regions = "all" o una lista de franjas. El texto de cada efecto llega en el manifiesto
// del vídeo (texts.<idioma>.effects.<quién>.<medida>), bajo "data.".
//
// Las medidas se suavizan (mediana + media de 1 s), se promedian por tiempo y se normalizan
// a su propio rango antes de hacer música: la música sigue cambios relativos, no valores.

export const REGION_IDS = ["artico", "norte_medio", "tropicos", "sur_medio", "antartico"];

/** Los acordes: no son una pista, pero deciden las notas de todas. */
export const HARMONY_ID = "acordes";

const ALL = "all";

const covers = (use, region) => use.regions === ALL || use.regions.includes(region);

/** Clave i18n (bajo "data.", del manifiesto) del efecto de una medida sobre una pista o los acordes. */
export const effectKey = (id, metric) => `data.effects.${id}.${metric}`;

/** Usos de cada dueño: [[HARMONY_ID, usos], [pista, usos], …]. */
export function ownersOf(mapping) {
  return [[HARMONY_ID, mapping.harmony], ...Object.entries(mapping.tracks).map(([id, t]) => [id, t.uses])];
}

/** Quién usa la medida `metric` de la región `region`: [{ id, metric }] ("acordes" o el id de la pista). */
export function usesOf(mapping, metric, region) {
  const out = [];
  for (const [id, uses] of ownersOf(mapping)) {
    for (const use of uses) if (use.metric === metric && covers(use, region)) out.push({ id, metric });
  }
  return out;
}

/** Regiones de un uso, en texto ("todas las franjas", "A y B"). `t`: traductor de i18n. */
export function regionsText(use, t) {
  if (use.regions === ALL) return t("regions.all");
  return use.regions.map((r) => t(`regions.names.${r}`)).reduce((a, b) => t("regions.and", { a, b }));
}

/** "60°N–23°N", "23°N–23°S"… */
export function latitudeText(region) {
  const lat = (x) => (x === 0 ? "0°" : `${Math.abs(x)}°${x > 0 ? "N" : "S"}`);
  return `${lat(region.lat_north)}–${lat(region.lat_south)}`;
}

/** Valor de una medida con tres cifras significativas en el idioma de `i18n` (o "sin dato"). */
export function formatValue(v, i18n) {
  if (v == null || !Number.isFinite(v)) return i18n.t("regions.noValue");
  if (Math.abs(v) < 1e-6) return "0";
  return i18n.number(v, { maximumSignificantDigits: 3 });
}
