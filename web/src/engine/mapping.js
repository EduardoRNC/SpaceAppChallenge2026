// Mapeo dato → sonido (v3: tonos limpios de la v1 + tensión progresiva de la v2).
// Funciones puras, sin Tone.js, para poder testearlas.
//
// Regla general: más caliente = más agudo, más brillante, más rápido y más tenso.
// La línea base (anomalía 0 °C, media 1951–1980) cae siempre en la tónica (C4).
//
// Varias pistas (Paso 8): el TONO sigue al valor de cada pista (más valor = más agudo),
// pero la TENSIÓN sigue al "estrés", que traduce el valor a la escala de la temperatura
// (0 → +1.4) con sound.stressZero / sound.stressFull. Así todas las pistas reutilizan
// los mismos umbrales. En el hielo, stressFull < stressZero: menos hielo = más tensión.

export const MAJOR_PENTA = [0, 2, 4, 7, 9]; // calma
export const MINOR_PENTA = [0, 3, 5, 7, 10]; // tensión
export const SCALES = [MAJOR_PENTA, MINOR_PENTA];

export const DEFAULTS = {
  baseline: 0,
  range: [-0.9, 1.6],
  tonicMidi: 60, // C4 = anomalía 0
  steps: 15, // grados de escala en todo el rango (unas 3 octavas con 5 notas)
  tensionStart: 0.5, // °C: empiezan a mezclarse notas menores
  tensionFull: 1.0, // °C: todo en pentatónica menor
  cutoffMin: 350, // Hz: timbre apagado
  cutoffMax: 6000, // Hz: timbre brillante
  b2Start: 0.4, // °C: entra la 2ª menor (Re♭) en el cluster
  b2Full: 1.0,
  tritoneStart: 0.8, // °C: entra el tritono (Fa♯)
  tritoneFull: 1.4,
  pulseBpmMin: 54, // latido en reposo
  pulseBpmMax: 144, // latido acelerado
  intensityStart: -0.2, // °C: crescendo general
  intensityFull: 1.4,
  cutoffStressRange: [-0.9, 1.6], // estrés que recorre el brillo de más apagado a más brillante
  stressZero: 0, // valor de la pista que equivale a estrés 0 (temperatura: 0 °C)
  stressFull: 1.4, // valor de la pista que equivale a estrés 1.4 (temperatura: +1.4 °C)
};

export const STRESS_FULL = 1.4;

export function configFromTrack(track, overrides = {}) {
  return {
    ...DEFAULTS,
    baseline: track.baseline,
    range: track.range,
    ...(track.sound ?? {}),
    ...overrides,
  };
}

/** Valor de la pista → estrés en la escala de la temperatura (0 → 1.4). */
export function stressOf(v, cfg) {
  return (STRESS_FULL * (v - cfg.stressZero)) / (cfg.stressFull - cfg.stressZero);
}

/** Inverso de stressOf: el valor de la pista que produce un estrés dado. */
export function valueForStress(s, cfg) {
  return cfg.stressZero + (s / STRESS_FULL) * (cfg.stressFull - cfg.stressZero);
}

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

const ramp = (v, start, full) => clamp01((v - start) / (full - start));

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

/** Nota MIDI de un grado en la escala dada. Funciona con grados negativos. */
export function midiForStep(step, scale, tonicMidi) {
  const octave = Math.floor(step / scale.length);
  const degree = ((step % scale.length) + scale.length) % scale.length;
  return tonicMidi + 12 * octave + scale[degree];
}

/** 0 = calma (pentatónica mayor), 1 = tensión total (pentatónica menor). */
export function tension(v, cfg) {
  return ramp(stressOf(v, cfg), cfg.tensionStart, cfg.tensionFull);
}

/**
 * Dither determinista entre 0 y 1 (secuencia de la razón áurea). Sirve para que
 * la transición entre modos sea gradual pero se repita igual en cada reproducción.
 */
export function dither(i) {
  return (i * 0.6180339887498949) % 1;
}

/** Escala para un valor: mezcla gradual de mayor a menor. */
export function scaleFor(v, i, cfg) {
  const position = tension(v, cfg) * (SCALES.length - 1); // 0..2
  const base = Math.floor(position);
  const next = Math.min(base + 1, SCALES.length - 1);
  return dither(i) < position - base ? SCALES[next] : SCALES[base];
}

/** Nota MIDI para un valor. `i` es el índice del evento (mes o año) usado en el dither. */
export function noteFor(v, i, cfg) {
  return midiForStep(stepFor(v, cfg), scaleFor(v, i, cfg), cfg.tonicMidi);
}

/** Frecuencia de corte del filtro, con escala exponencial porque el oído percibe así el brillo. */
export function cutoffFor(v, cfg) {
  const n = normalize(stressOf(v, cfg), cfg.cutoffStressRange);
  return cfg.cutoffMin * Math.pow(cfg.cutoffMax / cfg.cutoffMin, n);
}

/** Nivel de cada nota disonante del cluster (0..1): 2ª menor y tritono. */
export function clusterLevels(v, cfg) {
  const s = stressOf(v, cfg);
  return {
    minorSecond: ramp(s, cfg.b2Start, cfg.b2Full),
    tritone: ramp(s, cfg.tritoneStart, cfg.tritoneFull),
  };
}

/** Tempo del latido en pulsaciones por minuto. */
export function pulseBpm(v, cfg) {
  const n = ramp(stressOf(v, cfg), 0, cfg.intensityFull);
  return cfg.pulseBpmMin + n * (cfg.pulseBpmMax - cfg.pulseBpmMin);
}

/**
 * Momentos del latido, en segundos. El tempo depende de la temperatura del año que
 * suena en cada momento, no de la velocidad de reproducción. Es un latido real que se acelera.
 */
export function pulseTimes(years, yearDuration, cfg) {
  const total = years.length * yearDuration;
  const times = [];
  for (let t = 0; t < total; ) {
    const year = years[Math.min(years.length - 1, Math.floor(t / yearDuration))];
    times.push({ t, v: year.v });
    t += 60 / pulseBpm(year.v, cfg);
  }
  return times;
}

/** Crescendo general (0..1): volumen del drone y del latido. */
export function intensity(v, cfg) {
  return ramp(stressOf(v, cfg), cfg.intensityStart, cfg.intensityFull);
}

/** Rango [mín, máx] de la calidez medida en los fotogramas. */
export function warmthRange(frameWarmth) {
  const ws = frameWarmth.map((row) => row.w);
  return [Math.min(...ws), Math.max(...ws)];
}

/**
 * Capa de fotogramas: la calidez del color de la vuelta nueva (azul → granate)
 * controla el volumen y la velocidad del trémolo de un acorde agudo y limpio.
 */
export function frameTargets(w, range) {
  const f = normalize(w, range);
  return { level: 0.12 + 0.88 * f, tremoloHz: 1.5 + 8.5 * f };
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
