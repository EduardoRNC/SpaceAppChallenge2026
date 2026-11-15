// Navegación con teclado del piano roll y de las gráficas (equivalente a pulsar en ellas).
//
// Piano roll: ← → (y ↓ ↑) un tiempo; Re Pág / Av Pág un compás (un acorde); Inicio / Fin.
// Gráficas: ← → (y ↓ ↑) un segundo; Re Pág / Av Pág diez segundos; Inicio / Fin.
// Hacia atrás se va primero al principio del tiempo o compás en curso, como en un reproductor.

const SNAP_S = 0.05; // si ya está (casi) en el borde, se va al anterior

function snapStep(t, step, direction) {
  const k = Math.floor(t / step + 1e-6);
  const start = k * step;
  if (direction > 0) return start + step;
  return t - start > SNAP_S ? start : start - step;
}

const clamp = (t, end) => Math.min(end, Math.max(0, t));

/** Destino de una tecla en el piano roll, o null si la tecla no es suya. */
export function rollKeyTarget(key, t, { beat, bar, end }) {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(snapStep(t, beat, 1), end);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(snapStep(t, beat, -1), end);
    case "PageUp":
      return clamp(snapStep(t, bar, 1), end);
    case "PageDown":
      return clamp(snapStep(t, bar, -1), end);
    case "Home":
      return 0;
    case "End":
      return end;
    default:
      return null;
  }
}

/** Destino de una tecla en una gráfica (`end`: duración del vídeo), o null. */
export function chartKeyTarget(key, t, end) {
  const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[key];
  if (step != null) return clamp(t + step, end);
  if (key === "Home") return 0;
  if (key === "End") return end;
  return null;
}
