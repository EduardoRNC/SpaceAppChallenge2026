// Control de reproducción: Reproducir, Pausa, saltos y final.
//
// Arrancar es asíncrono (esperar a que el vídeo tenga el fotograma, despertar el
// AudioContext y dejar que empiece a oírse el audio antes de soltar el vídeo). Cada acción
// del usuario invalida las anteriores con un token: un paso pendiente de una acción vieja
// nunca puede arrancar el audio ni el vídeo después de una pausa o de otro salto.
//
// Saltar al final (t ≥ duración − END_EPS_S) termina la reproducción: audio parado en la
// duración, vídeo en su último fotograma. Reproducir desde ahí empieza de nuevo en 0.

import { LEAD_S, videoTarget } from "./clock.js";

export const END_EPS_S = 0.05;

export const atEnd = (t, duration) => t >= duration - END_EPS_S;

/**
 * `video`: HTMLVideoElement (o similar); `transport`: createTransport(); `follower`: createFollower().
 * `waitSeeked(video)`: promesa que se cumple cuando el vídeo termina de buscar.
 * `schedule(fn, ms)`: setTimeout. `onChange(event)`: "start" | "playing" | "pause" | "seek" | "end".
 */
export function createPlayer({ video, transport, follower, duration, videoDuration, fps, waitSeeked, schedule = setTimeout, onChange = () => {} }) {
  let token = 0;
  let mode = "paused"; // "playing" (también mientras arranca) | "paused" | "ended"

  const clampT = (t) => Math.min(duration, Math.max(0, t));
  const showFrame = (t) => {
    video.currentTime = videoTarget(t, videoDuration(), fps);
  };

  function halt() {
    token += 1;
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
    transport.seek(target);
    showFrame(target);
    onChange("start");
    await waitSeeked(video);
    if (my !== token) return;
    await transport.resume();
    if (my !== token) return;
    transport.start(target);
    onChange("playing");
    // El vídeo arranca cuando empieza a oírse el audio (margen de arranque + latencia de salida).
    schedule(() => {
      if (my !== token || !transport.playing) return;
      follower.resetWindow();
      follower.start();
      video.play()?.catch?.(() => {});
    }, (LEAD_S + transport.latency()) * 1000);
  }

  function pause() {
    const t = halt();
    mode = "paused";
    showFrame(t);
    onChange("pause");
  }

  function finish() {
    halt();
    mode = "ended";
    transport.seek(duration);
    showFrame(duration);
    onChange("end");
  }

  return {
    get playing() {
      return mode === "playing";
    },
    get ended() {
      return mode === "ended";
    },
    position: () => transport.position(),
    startAt,
    pause,
    finish,
    togglePlay() {
      if (mode === "playing") return pause();
      const t = transport.position();
      return startAt(mode === "ended" || atEnd(t, duration) ? 0 : t);
    },
    /** Salta a t manteniendo el estado: si sonaba (o estaba arrancando), sigue sonando. */
    jump(t) {
      const target = clampT(t);
      if (atEnd(target, duration)) return finish();
      if (mode === "playing") return startAt(target);
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
