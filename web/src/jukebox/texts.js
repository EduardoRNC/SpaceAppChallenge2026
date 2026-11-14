// Textos que vienen de los datos (manifiesto y timeline.json), en el idioma activo.
// Se traducen por identificador; los números, unidades e ids de los datos no se tocan.

/** Nombre de una pista ("Temperature" / "Temperatura"). */
export const stemLabel = (i18n, stem) => i18n.data(`data.stems.${stem.id}.label`, stem.label);

/** Patch DX7 de referencia ("Temperatura - STRINGS 1" → "STRINGS 1"): nombre propio, sin traducir. */
export const dx7Patch = (stem) => stem.instrument.split(" - ").pop();

/** Campo de texto de una medida: label, unit, derived_from o caveat. */
export const metricText = (i18n, id, metric, field) => i18n.data(`data.metrics.${id}.${field}`, metric[field]);

/** Problemas de checkManifest / checkTimeline en texto: kind = "manifest" | "timeline". */
export const problemsText = (i18n, kind, problems) => problems.map((p) => i18n.t(`problems.${kind}.${p.code}`, p)).join("; ");
