// Qué medida de la imagen controla cada parte de la música.
// Resume video_jukebox/compose.py: si cambia el compositor, hay que cambiar esto.
//
// Las medidas se suavizan (mediana + media de 1 s), se promedian por tiempo y se normalizan
// a su propio rango antes de hacer música: la música sigue cambios relativos, no valores.
// Aquí solo está la estructura; el texto de cada efecto está en i18n (effects.<quién>.<medida>).

export const REGION_IDS = ["artico", "norte_medio", "tropicos", "sur_medio", "antartico"];

export const METRIC_ORDER = ["temp", "speed", "u", "v", "vort", "cover"];

const ALL = "all";

/** Los acordes: no son una pista, pero deciden las notas de todas. */
export const HARMONY = {
  id: "acordes",
  uses: [{ metric: "temp", regions: ["norte_medio", "sur_medio"] }],
};

export const TRACK_MAPPINGS = {
  temperatura: [{ metric: "temp", regions: ALL }],
  corrientes: [
    { metric: "speed", regions: ALL },
    { metric: "temp", regions: ALL },
    { metric: "vort", regions: ALL },
  ],
  remolinos: [{ metric: "vort", regions: ALL }],
  ecuatorial: [{ metric: "u", regions: ["tropicos"] }],
};

const covers = (use, region) => use.regions === ALL || use.regions.includes(region);

/** Clave i18n del efecto de una medida sobre una pista (o los acordes). */
export const effectKey = (id, metric) => `effects.${id}.${metric}`;

/** Quién usa la medida `metric` de la región `region`: [{ id, metric }] ("acordes" o el id de la pista). */
export function usesOf(metric, region) {
  const out = [];
  for (const use of HARMONY.uses) if (use.metric === metric && covers(use, region)) out.push({ id: HARMONY.id, metric });
  for (const [id, uses] of Object.entries(TRACK_MAPPINGS)) {
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
