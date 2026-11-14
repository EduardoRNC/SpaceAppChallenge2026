// Carga inicial del vídeo: esperar el primer fotograma sin quedarse colgado.
//
// Si en `timeoutMs` no llega ni `loadeddata` ni `error`, o si llega `error`, se avisa con
// onProblem("timeout" | "error") pero se sigue esperando: un vídeo lento puede llegar tarde y
// entonces la demo continúa sola. retry() vuelve a pedir el vídeo y a contar el plazo.

export const LOAD_TIMEOUT_MS = 15000;
const HAVE_CURRENT_DATA = 2;

export function waitFirstFrame(video, { timeoutMs = LOAD_TIMEOUT_MS, onProblem = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer = null;
  let done = false;
  let resolve;
  const promise = new Promise((r) => (resolve = r));

  function arm() {
    cancel(timer);
    timer = schedule(() => {
      timer = null;
      if (!done) onProblem("timeout");
    }, timeoutMs);
  }
  function loaded() {
    if (done) return;
    done = true;
    cancel(timer);
    video.removeEventListener("loadeddata", loaded);
    video.removeEventListener("error", failed);
    resolve();
  }
  function failed() {
    if (done) return;
    cancel(timer);
    timer = null;
    onProblem("error");
  }

  video.addEventListener("loadeddata", loaded);
  video.addEventListener("error", failed);
  if (video.readyState >= HAVE_CURRENT_DATA) loaded();
  else arm();

  return {
    promise,
    get loaded() {
      return done;
    },
    /** Vuelve a pedir el vídeo (tras el aviso) y empieza a contar otra vez. */
    retry() {
      if (done) return;
      video.load();
      arm();
    },
  };
}
