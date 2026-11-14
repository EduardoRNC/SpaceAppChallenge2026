// Imagen fija con cursor: para visualizaciones cuyo vídeo no avanza en orden
// cronológico (la Keeling Curve, SVS 5119). Se usa su último fotograma (la curva
// completa) y una línea vertical que se desliza hasta el año que está sonando.
//
// Misma interfaz que createVideoSync: startAt, onYear, finish, showYear, stop.

/** Posición x (píxeles de la imagen original) de un año decimal: interpolación por tramos entre las marcas del eje. */
export function xForYear(year, ticks) {
  if (year <= ticks[0][0]) {
    const [[y0, x0], [y1, x1]] = ticks;
    return x0 + ((year - y0) * (x1 - x0)) / (y1 - y0); // extrapola antes de la primera marca
  }
  for (let i = 1; i < ticks.length; i++) {
    const [y0, x0] = ticks[i - 1];
    const [y1, x1] = ticks[i];
    if (year <= y1) return x0 + ((year - y0) * (x1 - x0)) / (y1 - y0);
  }
  return ticks[ticks.length - 1][1]; // después del último dato de la imagen, el cursor se queda al final
}

export function createStillSync({ playhead, still, firstYear, reducedMotion = false }) {
  let yearDuration = 0.4;

  const place = (index, { glide = false } = {}) => {
    const x = xForYear(firstYear + index, still.ticks);
    const animate = glide && !reducedMotion;
    playhead.style.transition = animate ? `left ${yearDuration}s linear` : "none";
    playhead.style.left = `${(100 * x) / still.width}%`;
  };

  playhead.style.top = `${(100 * still.plotTop) / still.height}%`;
  playhead.style.height = `${(100 * (still.plotBottom - still.plotTop)) / still.height}%`;

  return {
    startAt(index, yd) {
      yearDuration = yd;
      playhead.hidden = false;
      place(index);
    },
    onYear(index) {
      // Se desliza hasta el final del año que acaba de empezar a sonar.
      place(index + 1, { glide: true });
    },
    finish() {},
    showYear(index) {
      playhead.hidden = false;
      place(index + 1);
    },
    stop() {
      // Congela el cursor donde esté.
      const left = getComputedStyle(playhead).left;
      playhead.style.transition = "none";
      playhead.style.left = left;
    },
  };
}
