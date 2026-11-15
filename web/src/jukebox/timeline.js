// Lectura del timeline.json que escribe video_jukebox/export_timeline.py.
//
// Todo en segundos: las notas siguen el reloj del audio (t = beat × 60 / bpm) y las
// características el del vídeo (features.t[i] = (i + frame_offset) / fps).

export const TIMELINE_SCHEMA = "earth-jukebox-timeline";
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/**
 * Problemas del timeline frente al manifiesto (vacía si es válido): [{ code, ...variables }],
 * con el texto en i18n (problems.timeline.<code>).
 */
export function checkTimeline(t, manifest) {
  if (t?.schema !== TIMELINE_SCHEMA) return [{ code: "schema", value: String(t?.schema) }];
  const errors = [];
  if (t.version !== 2) errors.push({ code: "version", value: String(t.version) });
  const ids = (t.channels ?? []).map((c) => c.id);
  const expected = manifest ? manifest.audio.stems.map((s) => s.id) : ids;
  if (!ids.length || ids.join() !== expected.join()) errors.push({ code: "channels", ids: ids.join(", ") });
  if (!t.mapping?.harmony || ids.some((id) => !t.mapping.tracks?.[id])) errors.push({ code: "mapping" });
  if (!Array.isArray(t.notes) || !t.notes.length) errors.push({ code: "notes" });
  else if (t.notes.some((n) => !ids.includes(n.track))) errors.push({ code: "noteTrack" });
  const timing = t.timing ?? {};
  if (manifest && timing.fps !== manifest.video.fps) errors.push({ code: "fps", timeline: timing.fps, video: manifest.video.fps });
  if (manifest && !(timing.music_duration_s <= manifest.audio.duration_s)) errors.push({ code: "duration" });
  if (t.features?.t?.length !== timing.frames) errors.push({ code: "features" });
  for (const [id, m] of Object.entries(t.features?.metrics ?? {})) {
    // La interfaz presenta todas las medidas como índices visuales: si alguna dijera
    // estar calibrada, habría que revisar los textos antes de mostrarla.
    if (m.nature !== "visual_proxy" || m.calibrated !== false) errors.push({ code: "metric", id });
  }
  return errors;
}

/** Nombre de una nota MIDI (60 = C4). */
export function noteName(n) {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Un carril por pista, en el orden de `channels`: { id, notes (por tiempo), low, high }. */
export function buildLanes(timeline, minSpan = 12) {
  return timeline.channels.map(({ id }) => {
    const notes = timeline.notes.filter((n) => n.track === id).sort((a, b) => a.t - b.t || a.note - b.note);
    let low = Math.min(...notes.map((n) => n.note)) - 1;
    let high = Math.max(...notes.map((n) => n.note)) + 1;
    if (!notes.length) [low, high] = [60 - minSpan / 2, 60 + minSpan / 2];
    if (high - low < minSpan) {
      const grow = minSpan - (high - low);
      low -= Math.floor(grow / 2);
      high += Math.ceil(grow / 2);
    }
    return { id, notes, low, high };
  });
}

export const isActive = (note, t) => note.t <= t && t < note.t + note.dur;

/** Alturas que suenan en t, por pista: { id: [nota, …] }. */
export function soundingAt(lanes, t) {
  return Object.fromEntries(lanes.map((l) => [l.id, l.notes.filter((n) => isActive(n, t)).map((n) => n.note)]));
}

/** Notas que se ven (aunque sea en parte) entre t0 y t1. */
export function notesInWindow(notes, t0, t1) {
  return notes.filter((n) => n.t < t1 && n.t + n.dur > t0);
}

/** Acorde vigente en t (el último que empezó), o null antes del primero. */
export function chordAt(chords, t) {
  let found = null;
  for (const c of chords) {
    if (c.t <= t + 1e-6) found = c;
    else break;
  }
  return found;
}

/** Acordes que se ven entre t0 y t1, con su final (el siguiente acorde o el final de la música). */
export function chordsInWindow(chords, t0, t1, end) {
  return chords
    .map((c, i) => ({ ...c, end: chords[i + 1]?.t ?? end }))
    .filter((c) => c.t < t1 && c.end > t0);
}

/**
 * Rótulos de la franja de acordes. El acorde que suena se rotula siempre, al principio de la
 * parte visible de su caja; los demás, en su comienzo y solo si el nombre cabe entero (nunca un
 * nombre cortado entrando o saliendo). `measure(texto)` da el ancho en píxeles.
 * Devuelve [{ name, x0, x1, labelX | null, state: "past" | "current" | "future" }].
 */
export function chordLabels(chords, view, t, width, end, measure, pad = 6) {
  const current = chordAt(chords, t);
  return chordsInWindow(chords, view.t0, view.t1, end).map((c) => {
    const x0 = xAt(c.t, view, width);
    const x1 = xAt(c.end, view, width);
    const state = current && c.t === current.t ? "current" : c.end <= t ? "past" : "future";
    const left = state === "current" ? Math.max(x0, 0) : x0;
    const room = Math.min(x1, width) - pad;
    const labelX = left >= 0 && left + pad + measure(c.name) <= room ? left + pad : null;
    return { name: c.name, x0, x1, labelX, state };
  });
}

/** Ventana visible: `span` segundos con el cabezal a `lead` (fracción) del borde izquierdo. */
export function rollView(t, span = 10, lead = 0.25) {
  const t0 = t - span * lead;
  return { t0, t1: t0 + span, span };
}

export const xAt = (time, view, width) => ((time - view.t0) / view.span) * width;
export const timeAtX = (x, view, width) => view.t0 + (x / width) * view.span;

/** Posición vertical de una altura MIDI dentro de su carril (agudo arriba). */
export function noteBox(pitch, lane, top, height) {
  const step = height / (lane.high - lane.low + 1);
  const h = Math.max(3, Math.min(step, 8));
  const center = top + (lane.high - pitch + 0.5) * step;
  return { y: Math.min(top + height - h, Math.max(top, center - h / 2)), h };
}

/** Índice de features para el tiempo t (la fila i es el fotograma i + frame_offset). */
export function frameIndex(t, timing) {
  const i = Math.round(t * timing.fps) - (timing.frame_offset ?? 0);
  return Math.min(timing.frames - 1, Math.max(0, i));
}

/** Mínimo y máximo de una serie ignorando los huecos (null). */
export function seriesRange(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return null;
  if (min === max) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}

/**
 * Trazo SVG ("M x y L x y …") de una serie sobre un rectángulo de width × height.
 * Los huecos (null) cortan la línea. `xs` en las mismas unidades que `domain`.
 */
export function seriesPath(xs, values, width, height, range, domain) {
  const [d0, d1] = domain;
  const sx = (x) => ((x - d0) / (d1 - d0)) * width;
  const sy = (v) => height - ((v - range.min) / (range.max - range.min)) * height;
  let path = "";
  let pen = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    path += `${pen ? "L" : "M"}${sx(xs[i]).toFixed(1)} ${sy(v).toFixed(1)}`;
    pen = true;
  }
  return path;
}
