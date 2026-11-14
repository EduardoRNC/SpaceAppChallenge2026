// Reloj del jukebox: manda el audio y el vídeo lo sigue.
//
// La posición es la de la música que se está oyendo (descontada la latencia de salida).
// El vídeo se corrige con playbackRate cuando se desvía más de un cuarto de fotograma,
// hasta dejarlo por debajo de una décima (histéresis: sin ella el desvío se queda quieto
// justo en el borde del margen). Si se desvía más de HARD_SEEK_S (tras un salto del
// usuario o un atasco), salta.

export const LEAD_S = 0.06; // margen para programar el arranque de las pistas
export const HARD_SEEK_S = 0.3;
export const START_FRAMES = 0.25;
export const STOP_FRAMES = 0.1;
export const MIN_RATE_CORRECTION = 0.01;
export const MAX_RATE_CORRECTION = 0.1;
export const CONVERGE_S = 1; // tiempo aproximado para absorber un desvío pequeño

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Posición de la música (s) en el instante `contextTime` del AudioContext.
 * `state`: { playing, offset, startedAt, duration }; startedAt en tiempo de contexto.
 */
export function audiblePosition(state, contextTime) {
  if (!state.playing) return state.offset;
  return clamp(state.offset + Math.max(0, contextTime - state.startedAt), 0, state.duration);
}

/**
 * Corrección del vídeo para un desvío `drift` = tiempo del vídeo − tiempo del audio (s).
 * `correcting`: si ya se estaba corrigiendo (lo devuelve la llamada anterior).
 * Devuelve { seek, rate, correcting }: si seek, saltar al tiempo del audio; si no, usar `rate`.
 */
export function followVideo(drift, fps, correcting = false) {
  const size = Math.abs(drift);
  if (size > HARD_SEEK_S) return { seek: true, rate: 1, correcting: false };
  if (size <= (correcting ? STOP_FRAMES : START_FRAMES) / fps) return { seek: false, rate: 1, correcting: false };
  // En pasos del 1 % para no cambiar playbackRate en cada fotograma.
  const steps = Math.round(clamp(size / CONVERGE_S, MIN_RATE_CORRECTION, MAX_RATE_CORRECTION) * 100);
  return { seek: false, rate: 1 - (Math.sign(drift) * steps) / 100, correcting: true };
}

/**
 * Media de las muestras [tiempo, valor] de los últimos `span` segundos hasta `now`,
 * o null si hay menos de `minSamples`.
 */
export function recentMean(samples, now, span, minSamples = 1) {
  const xs = samples.filter(([t]) => t >= now - span && t <= now).map(([, x]) => x);
  return xs.length >= minSamples ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Último tiempo de vídeo con imagen (el audio dura algo más por la cola de la reverb). */
export function videoTarget(t, videoDuration, fps) {
  return clamp(t, 0, videoDuration - 1 / fps);
}
