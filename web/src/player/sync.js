// Sincroniza el vídeo de la Climate Spiral con el motor de sonido.
//
// El reloj maestro es el audio. El vídeo se reproduce a la velocidad que
// corresponde (playbackRate) y, en cada año, se corrige si se ha desfasado.
// Al terminar los datos, el vídeo sigue a velocidad normal y muestra el giro
// final al cono 3D como cierre.

const MIN_RATE = 0.0625; // límite inferior de los navegadores
const MAX_RATE = 16;

export function videoTimeForYear(index, video) {
  return video.tStart + index * video.secondsPerYear;
}

export function playbackRateFor(yearDuration, video) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, video.secondsPerYear / yearDuration));
}

export function createVideoSync(el, video) {
  // Desfase tolerado antes de corregir: 3/4 de año, en segundos de vídeo.
  const tolerance = video.secondsPerYear * 0.75;

  return {
    start(yearDuration) {
      el.currentTime = video.tStart;
      el.playbackRate = playbackRateFor(yearDuration, video);
      el.play().catch(() => {});
    },
    onYear(index) {
      const expected = videoTimeForYear(index, video);
      if (Math.abs(el.currentTime - expected) > tolerance) el.currentTime = expected;
    },
    finish() {
      el.playbackRate = 1;
      if (el.paused && el.currentTime < video.duration) el.play().catch(() => {});
    },
    stop() {
      el.pause();
    },
  };
}
