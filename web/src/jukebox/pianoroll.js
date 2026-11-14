// Piano roll de las cuatro pistas: una ventana de unos segundos que avanza con el audio.
//
// Arriba, los acordes (uno por compás); debajo, un carril por pista con sus notas MIDI
// (agudo arriba, cada carril con su propio registro). El cabezal es la posición del audio
// que se oye. Las pistas sin sonido (mute/solo) se atenúan; las notas que suenan se resaltan.

import { buildLanes, chordLabels, isActive, noteBox, notesInWindow, rollView, timeAtX, xAt } from "./timeline.js";

const SPAN_S = 10;
const LEAD = 0.25;
const CHORD_H = 24;
const GAP = 3;

/** `labelOf(stem)`: nombre de la pista en el idioma activo (se pide en cada dibujo). */
export function createPianoRoll({ canvas, timeline, stems, labelOf = (s) => s.label, onSeek = () => {} }) {
  const ctx = canvas.getContext("2d");
  const lanes = buildLanes(timeline);
  const style = Object.fromEntries(stems.map((s) => [s.id, s]));
  const { seconds_per_beat: spb, beats_per_bar: perBar, music_duration_s: end } = timeline.timing;
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue("--fg").trim() || "#f2f4f8";
  const muted = css.getPropertyValue("--muted").trim() || "#b8c0d0";
  const accent = css.getPropertyValue("--accent").trim() || "#ffb347";
  let width = 0;
  let height = 0;
  let view = rollView(0, SPAN_S, LEAD);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  canvas.addEventListener("pointerdown", (e) => {
    const box = canvas.getBoundingClientRect();
    onSeek(timeAtX(e.clientX - box.left, view, box.width));
  });

  const x = (time) => xAt(time, view, width);

  function grid() {
    const first = Math.max(0, Math.ceil(view.t0 / spb));
    for (let b = first; b * spb <= Math.min(view.t1, end); b++) {
      const bar = b % perBar === 0;
      ctx.fillStyle = bar ? "rgb(255 255 255 / 0.18)" : "rgb(255 255 255 / 0.06)";
      ctx.fillRect(Math.round(x(b * spb)), bar ? 0 : CHORD_H, 1, height);
    }
    if (end < view.t1) {
      ctx.fillStyle = "rgb(0 0 0 / 0.35)";
      ctx.fillRect(x(end), 0, width - x(end), height);
    }
    if (view.t0 < 0) {
      ctx.fillStyle = "rgb(0 0 0 / 0.35)";
      ctx.fillRect(0, 0, x(0), height);
    }
  }

  const CHORD_FILL = { past: "rgb(255 255 255 / 0.03)", current: "rgb(255 179 71 / 0.28)", future: "rgb(255 255 255 / 0.07)" };

  function chords(t) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const measure = (s) => ctx.measureText(s).width;
    for (const c of chordLabels(timeline.chords, view, t, width, end, measure)) {
      ctx.fillStyle = CHORD_FILL[c.state];
      ctx.fillRect(c.x0 + 1, 2, c.x1 - c.x0 - 2, CHORD_H - 4);
      if (c.labelX == null) continue;
      ctx.fillStyle = c.state === "current" ? fg : muted;
      ctx.globalAlpha = c.state === "past" ? 0.45 : 1;
      ctx.fillText(c.name, c.labelX, CHORD_H / 2);
      ctx.globalAlpha = 1;
    }
  }

  function lane(l, top, laneH, t, gain) {
    const color = style[l.id]?.color ?? fg;
    ctx.fillStyle = "rgb(255 255 255 / 0.03)";
    ctx.fillRect(0, top, width, laneH);
    for (const n of notesInWindow(l.notes, view.t0, view.t1)) {
      const { y, h } = noteBox(n.note, l, top + 3, laneH - 6);
      const x0 = x(n.t);
      const w = Math.max(2, x(n.t + n.dur) - x0 - 1);
      const active = isActive(n, t);
      ctx.globalAlpha = (active ? 1 : 0.35 + (0.5 * n.vel) / 127) * (gain > 0 ? 1 : 0.2);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y, w, h);
      if (active && gain > 0) {
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y - 0.5, w - 1, h + 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const label = style[l.id] ? labelOf(style[l.id]) : l.id;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgb(11 16 32 / 0.75)";
    ctx.fillRect(4, top + 3, w, 16);
    ctx.fillStyle = gain > 0 ? color : muted;
    ctx.fillText(label, 9, top + 5);
  }

  return {
    lanes,
    get view() {
      return view;
    },
    /** Dibuja la ventana alrededor de t. `gains`: { id: 0 | 1 } (mute/solo). */
    draw(t, gains = {}) {
      if (!width || !height) return;
      view = rollView(t, SPAN_S, LEAD);
      ctx.clearRect(0, 0, width, height);
      grid();
      chords(t);
      const laneH = (height - CHORD_H - GAP * lanes.length) / lanes.length;
      lanes.forEach((l, i) => lane(l, CHORD_H + GAP + i * (laneH + GAP), laneH, t, gains[l.id] ?? 1));
      ctx.fillStyle = accent;
      ctx.fillRect(Math.round(x(t)) - 1, 0, 2, height);
    },
  };
}