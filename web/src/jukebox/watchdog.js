// Vigilante del vídeo: el audio no sigue sonando con la imagen congelada.
//
// Mientras suena, si el vídeo no avanza durante FREEZE_GRACE_S (se queda cargando, la red
// no responde, un seek no termina…) se para el audio (player.hold) y se espera. Cuando el
// vídeo tiene datos para seguir, se reanuda solo (player.recover). Si se congela una y otra
// vez seguidas, deja de reanudar solo y espera a que el usuario pulse Reintentar.
// Los eventos `waiting` y `stalled` solo dicen el motivo; la decisión es por el tiempo del
// vídeo, que es lo que se ve. Un `error` del vídeo pasa a player.fail().

export const FREEZE_GRACE_S = 1;
export const POLL_MS = 250;
export const RESUME_AHEAD_S = 2;
export const MIN_HOLD_S = 1; // espera mínima antes de reanudar solo (si no, rebota en el mismo instante)
export const MAX_AUTO_RESUMES = 2; // congelaciones seguidas que se reanudan solas…
export const AUTO_RESUME_WINDOW_S = 20; // …dentro de esta ventana

/** Detector de vídeo congelado: sample() cada POLL_MS; true cuando lleva FREEZE_GRACE_S sin avanzar. */
export function createFreezeDetector({ graceS = FREEZE_GRACE_S } = {}) {
  let lastVideoT = null;
  let movedAt = 0;
  const reset = () => {
    lastVideoT = null;
  };
  return {
    reset,
    /**
     * `now` en segundos; `expecting`: el vídeo debería estar avanzando ahora. Un salto en
     * curso (`seeking`) no es avanzar: el seguidor salta cuando el vídeo se queda atrás.
     */
    sample({ now, videoT, seeking = false, expecting }) {
      if (!expecting) {
        reset();
        return false;
      }
      if (lastVideoT === null || (!seeking && Math.abs(videoT - lastVideoT) > 1e-3)) {
        lastVideoT = videoT;
        movedAt = now;
        return false;
      }
      return now - movedAt >= graceS;
    },
  };
}

/** Segundos de vídeo cargados a partir de `t` (0 si `t` no está en ningún tramo cargado). */
export function bufferedAhead(buffered, t) {
  for (let i = 0; i < (buffered?.length ?? 0); i++) {
    if (buffered.start(i) <= t + 1e-3 && t <= buffered.end(i) + 1e-3) return buffered.end(i) - t;
  }
  return 0;
}

/**
 * ¿Puede seguir el vídeo? Con el fotograma actual y el siguiente (readyState ≥ 3) y, o bien
 * todo lo necesario (readyState 4), o RESUME_AHEAD_S cargados por delante (o hasta el final).
 */
export function canResume({ readyState, seeking, ahead, remaining }) {
  if (seeking || readyState < 3) return false;
  return readyState >= 4 || ahead >= Math.min(RESUME_AHEAD_S, Math.max(0, remaining - 0.1));
}

/** ¿Se puede reanudar solo otra vez? `holds`: instantes (s) de las congelaciones recientes. */
export function autoResumeAllowed(holds, now) {
  return holds.filter((t) => now - t <= AUTO_RESUME_WINDOW_S).length <= MAX_AUTO_RESUMES;
}

/** Motivo de un MediaError: 1 aborted, 2 network, 3 decode, 4 unsupported. */
export function errorReason(code) {
  return { 1: "aborted", 2: "network", 3: "decode", 4: "unsupported" }[code] ?? "unknown";
}

/**
 * Conecta el vigilante a un <video> real. `player`: createPlayer(); `transport`: createTransport().
 * `onStuck()`: se congeló demasiadas veces seguidas y ya no se reanuda solo.
 * Devuelve { stop, stuck }.
 */
export function watchVideo({
  video,
  player,
  transport,
  fps,
  videoDuration,
  onStuck = () => {},
  now = () => performance.now() / 1000,
  every = (fn, ms) => setInterval(fn, ms),
  cancel = (id) => clearInterval(id),
}) {
  const detector = createFreezeDetector();
  const holds = [];
  let hint = null; // último aviso del navegador: "buffering" | "network"
  let stuck = false;
  let holdingSince = null;

  const onWaiting = () => (hint = "buffering");
  const onStalled = () => (hint = "network");
  const onError = () => {
    if (!video.error) return; // load() vacía el error al recargar
    player.fail(errorReason(video.error.code));
  };
  const onPlaying = () => (hint = null);
  video.addEventListener("waiting", onWaiting);
  video.addEventListener("stalled", onStalled);
  video.addEventListener("error", onError);
  video.addEventListener("playing", onPlaying);

  function tick() {
    const t = now();
    const expecting =
      player.following && !globalThis.document?.hidden && transport.position() < videoDuration() - 1 / fps;
    if (detector.sample({ now: t, videoT: video.currentTime, seeking: video.seeking, expecting })) {
      detector.reset();
      if (player.hold(hint ?? (video.seeking ? "seek" : "frozen"))) {
        holds.push(t);
        stuck = !autoResumeAllowed(holds, t);
        if (stuck) onStuck();
      }
    }
    if (player.mode !== "holding") holdingSince = null;
    else holdingSince ??= t;
    if (player.mode === "holding" && !stuck && t - holdingSince >= MIN_HOLD_S) {
      const pos = Math.min(transport.position(), videoDuration());
      const state = {
        readyState: video.readyState,
        seeking: video.seeking,
        ahead: bufferedAhead(video.buffered, video.currentTime),
        remaining: videoDuration() - pos,
      };
      if (canResume(state)) {
        hint = null;
        player.recover();
      }
    }
    if (stuck && player.mode !== "holding") {
      // El usuario actuó (Reintentar, Reproducir, Pausa): vuelve a reanudar solo.
      stuck = false;
      holds.length = 0;
    }
    while (holds.length && t - holds[0] > AUTO_RESUME_WINDOW_S) holds.shift();
  }
  const timer = every(tick, POLL_MS);

  return {
    get stuck() {
      return stuck;
    },
    stop() {
      cancel(timer);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("error", onError);
      video.removeEventListener("playing", onPlaying);
    },
  };
}
