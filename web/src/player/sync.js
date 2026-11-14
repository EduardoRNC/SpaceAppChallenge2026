// Sincroniza el vídeo de la Climate Spiral con el motor de sonido.
//
// El reloj maestro es el audio. El vídeo se reproduce a la velocidad que
// corresponde (playbackRate) y, en cada año, se corrige si se ha desfasado.
// Al terminar los datos, el vídeo sigue a velocidad normal y muestra el giro
// final al cono 3D como cierre.
//
// Con "reducir movimiento" el vídeo no se anima: muestra el fotograma del año
// y se actualiza a saltos, una vez por década.

const MIN_RATE = 0.0625; // límite inferior de los navegadores
const MAX_RATE = 16;

export function videoTimeForYear(index, video) {
  return video.tStart + index * video.secondsPerYear;
}

export function playbackRateFor(yearDuration, video) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, video.secondsPerYear / yearDuration));
}

export function createVideoSync(el, video, { reducedMotion = false } = {}) {
  // Desfase tolerado antes de corregir: 3/4 de año, en segundos de vídeo.
  const tolerance = video.secondsPerYear * 0.75;
  let following = false;

  /** Fotograma con el año ya dibujado completo. */
  const frameForYear = (index) =>
    Math.min(video.tDataEnd, videoTimeForYear(index + 1, video));

  return {
    /** Empieza a seguir al audio desde el año `index`. */
    startAt(index, yearDuration) {
      following = true;
      el.currentTime = videoTimeForYear(index, video);
      if (reducedMotion) return;
      el.playbackRate = playbackRateFor(yearDuration, video);
      el.play().catch(() => {});
    },
    onYear(index) {
      if (!following) return;
      if (reducedMotion) {
        if (index % 10 === 0) el.currentTime = frameForYear(index);
        return;
      }
      const expected = videoTimeForYear(index, video);
      if (Math.abs(el.currentTime - expected) > tolerance) el.currentTime = expected;
    },
    /** Fin de la historia completa: el giro al cono 3D, a velocidad normal. */
    finish() {
      following = false;
      if (reducedMotion) {
        el.currentTime = video.tDataEnd;
        return;
      }
      el.playbackRate = 1;
      if (el.paused && el.currentTime < video.duration) el.play().catch(() => {});
    },
    /** Muestra la espiral hasta el año `index`, en pausa. */
    showYear(index) {
      following = false;
      el.pause();
      el.currentTime = frameForYear(index);
    },
    stop() {
      following = false;
      el.pause();
    },
  };
}
