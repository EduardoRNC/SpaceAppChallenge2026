// Control de reproducción: Reproducir, Pausa, saltos, final y fallos del vídeo.
//
// Arrancar es asíncrono (esperar a que el vídeo tenga el fotograma, despertar el
// AudioContext y dejar que empiece a oírse el audio antes de soltar el vídeo). Cada acción
// del usuario invalida las anteriores con un token: un paso pendiente de una acción vieja
// nunca puede arrancar el audio ni el vídeo después de una pausa o de otro salto.
//
// Saltar al final (t ≥ duración − END_EPS_S) termina la reproducción: audio parado en la
// duración, vídeo en su último fotograma. Reproducir desde ahí empieza de nuevo en 0.
//
// Si el vídeo no puede seguir (no llega el fotograma, se queda cargando o falla la red) el
// audio no sigue solo: hold() lo para donde está ("holding") y recover() lo reanuda cuando
// el vídeo vuelve a estar listo. Si el vídeo da error, fail() lo deja en "failed" hasta que
// el usuario pulse Reintentar (retry(): recarga el vídeo y sigue donde estaba).

import { LEAD_S, videoTarget } from "./clock.js";

export const END_EPS_S = 0.05;

export const atEnd = (t, duration) => t >= duration - END_EPS_S;

/**
 * `video`: HTMLVideoElement (o similar); `transport`: createTransport(); `follower`: createFollower().
 * `waitSeeked(video)`: promesa que se cumple cuando el vídeo termina de buscar (false si se agota el tiempo).
 * `reloadVideo()`: promesa de true si el vídeo se pudo volver a cargar.
 * `schedule(fn, ms)`: setTimeout. `onChange(event)`: "start" | "playing" | "pause" | "seek" | "end" |
 * "hold" | "recover" | "error" | "retry".
 */
export function createPlayer({
  video,
  transport,
  follower,
  duration,
  videoDuration,
  fps,
  waitSeeked,
  reloadVideo = async () => true,
  schedule = setTimeout,
  onChange = () => {},
}) {
  let token = 0;
  // "playing" (también mientras arranca) | "paused" | "ended" | "holding" | "failed" | "retrying"
  let mode = "paused";
  let following = false; // el vídeo ya corre detrás del audio (pasado el margen de arranque)
  let resumeAfter = false; // al recuperar el vídeo, volver a sonar
  let reason = null;

  const clampT = (t) => Math.min(duration, Math.max(0, t));
  const wantsPlay = () => mode === "playing" || mode === "holding" || (mode === "retrying" && resumeAfter);
  const showFrame = (t) => {
    video.currentTime = videoTarget(t, videoDuration(), fps);
  };

  function halt() {
    token += 1;
    following = false;
    follower.stop();
    video.pause();
    return transport.pause();
  }

  async function startAt(t) {
    const target = clampT(t);
    if (atEnd(target, duration)) return finish();
    halt();
    const my = token;
    mode = "playing";
    reason = null;
    transport.seek(target);
    showFrame(target);
    onChange("start");
    const seeked = await waitSeeked(video);
    if (my !== token) return;
    if (seeked === false) return hold("seek");
    await transport.resume();
    if (my !== token) return;
    transport.start(target);
    onChange("playing");
    // El vídeo arranca cuando empieza a oírse el audio (margen de arranque + latencia de salida).
    schedule(() => {
      if (my !== token || !transport.playing) return;
      follower.resetWindow();
      follower.start();
      following = true;
      video.play()?.catch?.(() => {});
    }, (LEAD_S + transport.latency()) * 1000);
  }

  function pause() {
    const t = halt();
    mode = "paused";
    resumeAfter = false;
    reason = null;
    showFrame(t);
    onChange("pause");
  }

  function finish() {
    halt();
    mode = "ended";
    resumeAfter = false;
    reason = null;
    transport.seek(duration);
    showFrame(duration);
    onChange("end");
  }

  /** El vídeo no puede seguir: para el audio donde está y espera (`why`: "seek" | "buffering" | "network" | "frozen"). */
  function hold(why) {
    if (mode !== "playing") return false;
    halt();
    mode = "holding";
    resumeAfter = true;
    reason = why;
    onChange("hold");
    return true;
  }

  async function retry() {
    if (mode !== "failed" && mode !== "holding") return;
    const resume = resumeAfter;
    halt();
    const my = token;
    mode = "retrying";
    resumeAfter = resume;
    onChange("retry");
    const ok = await reloadVideo();
    if (my !== token) return;
    // Donde esté ahora (un salto durante la recarga cuenta).
    const t = transport.position();
    if (!ok) {
      mode = "failed";
      reason = "reload";
      onChange("error");
      return;
    }
    if (resume) return startAt(t);
    mode = "paused";
    reason = null;
    showFrame(t);
    onChange("seek");
  }

  return {
    /** Si la reproducción está pedida (sonando, arrancando, o esperando al vídeo para seguir). */
    get playing() {
      return wantsPlay();
    },
    get ended() {
      return mode === "ended";
    },
    get mode() {
      return mode;
    },
    get reason() {
      return reason;
    },
    /** El vídeo debería estar avanzando con el audio (para el vigilante de vídeo congelado). */
    get following() {
      return mode === "playing" && following && transport.playing;
    },
    position: () => transport.position(),
    startAt,
    pause,
    finish,
    hold,
    /** El vídeo vuelve a estar listo: sigue sonando donde se quedó. */
    recover() {
      if (mode !== "holding") return;
      onChange("recover");
      return startAt(transport.position());
    },
    /** El vídeo dio error (`why`: "network" | "decode" | "unsupported" | "aborted"…). */
    fail(why) {
      if (mode === "retrying") return; // de eso se ocupa retry()
      const wasPlaying = wantsPlay() || (mode === "failed" && resumeAfter);
      halt();
      mode = "failed";
      resumeAfter = wasPlaying;
      reason = why;
      onChange("error");
    },
    retry,
    togglePlay() {
      if (mode === "failed") {
        resumeAfter = true;
        return retry();
      }
      if (wantsPlay() || mode === "retrying") return pause();
      const t = transport.position();
      return startAt(mode === "ended" || atEnd(t, duration) ? 0 : t);
    },
    /** Salta a t manteniendo el estado: si sonaba (o estaba arrancando o esperando), sigue sonando. */
    jump(t) {
      const target = clampT(t);
      if (mode === "failed" || mode === "retrying") {
        // Sin vídeo: se recuerda el sitio y se sigue desde ahí al reintentar.
        transport.seek(Math.min(target, duration));
        onChange("seek");
        return;
      }
      if (atEnd(target, duration)) return finish();
      if (mode === "playing" || mode === "holding") return startAt(target);
      halt();
      mode = "paused";
      transport.seek(target);
      showFrame(target);
      onChange("seek");
    },
    /** El audio llegó solo al final (lo avisa el transporte). */
    handleEnded() {
      if (mode !== "playing") return;
      finish();
    },
  };
}
