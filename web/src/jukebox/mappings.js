// Qué medida de la imagen controla cada parte de la música.
// Resume video_jukebox/compose.py: si cambia el compositor, hay que cambiar esto.
//
// Las medidas se suavizan (mediana + media de 1 s), se promedian por tiempo y se normalizan
// a su propio rango antes de hacer música: la música sigue cambios relativos, no valores.

export const REGION_LABELS = {
  artico: "Ártico",
  norte_medio: "Latitudes medias norte",
  tropicos: "Trópicos",
  sur_medio: "Latitudes medias sur",
  antartico: "Antártico",
};

export const METRIC_ORDER = ["temp", "speed", "u", "v", "vort", "cover"];

const ALL = "all";

/** Los acordes: no son una pista, pero deciden las notas de todas. */
export const HARMONY = {
  id: "acordes",
  label: "Acordes (todas las pistas)",
  uses: [
    {
      metric: "temp",
      regions: ["norte_medio", "sur_medio"],
      effect:
        "la diferencia norte − sur (las estaciones) elige, compás a compás, acordes oscuros o brillantes; con los más brillantes, las cuerdas suben una octava",
    },
  ],
};

export const TRACK_MAPPINGS = {
  temperatura: [
    { metric: "temp", regions: ALL, effect: "la media de las cinco franjas fija el volumen del acorde" },
  ],
  corrientes: [
    {
      metric: "speed",
      regions: ALL,
      effect: "cada franja tiene su voz: suena cuando su movimiento supera el 45 % de su rango, y más fuerte cuanto más se mueve",
    },
    { metric: "temp", regions: ALL, effect: "sube o baja la nota de la franja (±5 semitonos; norte = agudo, sur = grave)" },
    { metric: "vort", regions: ALL, effect: "la media de las cinco franjas cambia el timbre (modulación)" },
  ],
  remolinos: [
    {
      metric: "vort",
      regions: ALL,
      effect: "una campanada en cada pico de la franja (1,6 desviaciones sobre su mediana); más aguda cuanto más al norte",
    },
  ],
  ecuatorial: [
    {
      metric: "u",
      regions: ["tropicos"],
      effect: "cuanto más hacia el oeste (valores negativos), más notas por compás y más fuertes",
    },
  ],
};

const covers = (use, region) => use.regions === ALL || use.regions.includes(region);

/** Quién usa la medida `metric` de la región `region`: [{ id, effect }] ("acordes" o el id de la pista). */
export function usesOf(metric, region) {
  const out = [];
  for (const use of HARMONY.uses) if (use.metric === metric && covers(use, region)) out.push({ id: HARMONY.id, effect: use.effect });
  for (const [id, uses] of Object.entries(TRACK_MAPPINGS)) {
    for (const use of uses) if (use.metric === metric && covers(use, region)) out.push({ id, effect: use.effect });
  }
  return out;
}

/** Regiones de un uso, en texto. */
export function regionsText(use) {
  return use.regions === ALL ? "todas las franjas" : use.regions.map((r) => REGION_LABELS[r] ?? r).join(" y ");
}

/** "60°N–23°N", "23°N–23°S"… */
export function latitudeText(region) {
  const lat = (x) => (x === 0 ? "0°" : `${Math.abs(x)}°${x > 0 ? "N" : "S"}`);
  return `${lat(region.lat_north)}–${lat(region.lat_south)}`;
}

/** Valor de una medida con tres cifras significativas (o "sin dato"). */
export function formatValue(v) {
  if (v == null || !Number.isFinite(v)) return "sin dato";
  if (Math.abs(v) < 1e-6) return "0";
  return v.toLocaleString("es-ES", { maximumSignificantDigits: 3 });
}
