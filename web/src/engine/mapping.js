// Mapeo dato → sonido. Funciones puras, sin Tone.js, para poder testearlas.
//
// Regla general: más caliente = más agudo, más brillante y más tenso.
// La línea base (anomalía 0 °C, media 1951–1980) cae siempre en la tónica (C4).
// Así, una nota por encima del drone significa "más caliente que la media".

export const MAJOR_PENTA = [0, 2, 4, 7, 9]; // calma
export const MINOR_PENTA = [0, 3, 5, 7, 10]; // tensión

export const DEFAULTS = {
  baseline: 0,
  range: [-0.9, 1.6],
  tonicMidi: 60, // C4 = anomalía 0
  steps: 15, // grados de escala en todo el rango (unas 3 octavas)
  tensionStart: 0.5, // °C: empiezan a mezclarse notas menores
  tensionFull: 1.0, // °C: todo en modo menor
  dissonanceStart: 1.0, // °C: empieza la disonancia contra el drone
  dissonanceFull: 1.6, // °C: disonancia máxima
  cutoffMin: 350, // Hz, timbre más apagado
  cutoffMax: 6000, // Hz, timbre más brillante
};

export function configFromTrack(track, overrides = {}) {
  return { ...DEFAULTS, baseline: track.baseline, range: track.range, ...overrides };
}

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function normalize(v, [lo, hi]) {
  return clamp01((v - lo) / (hi - lo));
}

/** Tamaño de un grado de escala en °C. */
export function stepSize(cfg) {
  const [lo, hi] = cfg.range;
  return (hi - lo) / cfg.steps;
}

/** Grado de escala (entero) respecto a la línea base: 0 = media 1951–1980. */
export function stepFor(v, cfg) {
  const [lo, hi] = cfg.range;
  const clamped = Math.min(hi, Math.max(lo, v));
  return Math.round((clamped - cfg.baseline) / stepSize(cfg));
}

/** Nota MIDI de un grado, en escala mayor o menor. Funciona con grados negativos. */
export function midiForStep(step, minor, tonicMidi) {
  const scale = minor ? MINOR_PENTA : MAJOR_PENTA;
  const octave = Math.floor(step / scale.length);
  const degree = ((step % scale.length) + scale.length) % scale.length;
  return tonicMidi + 12 * octave + scale[degree];
}

/** 0 = calma (mayor), 1 = tensión total (menor). */
export function tension(v, cfg) {
  return clamp01((v - cfg.tensionStart) / (cfg.tensionFull - cfg.tensionStart));
}

/**
 * Dither determinista entre 0 y 1 (secuencia de la razón áurea). Sirve para que
 * la mezcla mayor/menor sea gradual pero se repita igual en cada reproducción.
 */
export function dither(i) {
  return (i * 0.6180339887498949) % 1;
}

/** Nota MIDI para un valor. `i` es el índice del evento (mes o año) usado en el dither. */
export function noteFor(v, i, cfg) {
  const minor = dither(i) < tension(v, cfg);
  return midiForStep(stepFor(v, cfg), minor, cfg.tonicMidi);
}

/** Frecuencia de corte del filtro, con escala exponencial porque el oído percibe así el brillo. */
export function cutoffFor(v, cfg) {
  const n = normalize(v, cfg.range);
  return cfg.cutoffMin * Math.pow(cfg.cutoffMax / cfg.cutoffMin, n);
}

/** Cantidad de disonancia contra el drone, entre 0 y 1. */
export function dissonance(v, cfg) {
  return clamp01((v - cfg.dissonanceStart) / (cfg.dissonanceFull - cfg.dissonanceStart));
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Medias por año calculadas a partir de la serie mensual (incluye el último año aunque esté incompleto). */
export function yearlyMeans(series) {
  const byYear = new Map();
  for (const { t, v } of series) {
    const year = Number(t.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(v);
  }
  return [...byYear].map(([year, vs]) => ({
    year,
    v: vs.reduce((a, b) => a + b, 0) / vs.length,
    months: vs.length,
  }));
}
