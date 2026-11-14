// Textos de la posición: tiempo, fotograma, fecha del modelo y compás.

export function formatTime(s) {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

/** Fotograma del vídeo que se ve en el tiempo t (0 = primero). */
export function frameAt(t, fps, frames) {
  return Math.min(frames - 1, Math.max(0, Math.floor(t * fps + 1e-6)));
}

/**
 * Fecha del modelo ECCO2 del fotograma (dato de NASA, no medido por nosotros).
 * `modelTime`: { first, step_hours } del manifiesto.
 */
export function modelDate(frame, modelTime) {
  return new Date(Date.parse(modelTime.first) + frame * modelTime.step_hours * 3600e3);
}

export function formatDate(date) {
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Compás y tiempo (desde 1) en el instante t. */
export function barBeat(t, bpm, beatsPerBar = 4) {
  const beat = Math.floor((Math.max(0, t) * bpm) / 60 + 1e-6);
  return { bar: Math.floor(beat / beatsPerBar) + 1, beat: (beat % beatsPerBar) + 1 };
}
