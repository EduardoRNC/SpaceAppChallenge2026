// El vídeo sigue al audio.
//
// Con requestVideoFrameCallback mide el desvío de cada fotograma realmente presentado
// frente al audio que se oye en ese momento. Un vídeo de 30 fps en una pantalla de 60 Hz
// alterna entre dos valores separados un fotograma (p. ej. +13 / −21 ms), así que se
// corrige la media del último medio segundo, no cada fotograma. Si el navegador no da
// la medida, se usa video.currentTime.

import { followVideo, recentMean, videoTarget } from "./clock.js";

const WINDOW_S = 10; // ventana del panel de sincronía
const SMOOTH_S = 0.5;
const MIN_SAMPLES = 8;
const FRESH_MS = 100;

export function createFollower(video, transport, fps) {
  const stats = { drift: 0, frameDrift: null, meanDrift: null, maxAbs: 0, seeks: 0, rate: 1, history: [] };
  let active = false;
  let correcting = false;
  let lastFrameAt = -Infinity;

  function clearHistory() {
    stats.history.length = 0;
    stats.maxAbs = 0;
    stats.frameDrift = null;
    stats.meanDrift = null;
    lastFrameAt = -Infinity;
  }

  function control() {
    if (active && transport.playing && !video.seeking && video.readyState >= 2) {
      const t = transport.position();
      const target = videoTarget(t, video.duration, fps);
      if (t < target + 1 / fps) {
        const fresh = stats.meanDrift != null && performance.now() - lastFrameAt < FRESH_MS;
        const drift = fresh ? stats.meanDrift : video.currentTime - t;
        const d = followVideo(drift, fps, correcting);
        correcting = d.correcting;
        stats.drift = drift;
        if (d.seek) {
          video.currentTime = target;
          stats.seeks += 1;
          clearHistory();
        } else if (video.playbackRate !== d.rate) {
          video.playbackRate = d.rate;
        }
        stats.rate = video.playbackRate;
        if (video.paused) video.play().catch(() => {});
      } else if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    }
    requestAnimationFrame(control);
  }

  function measure(now, md) {
    if (active && transport.playing && !video.seeking) {
      const audio = transport.position(md.expectedDisplayTime ?? now);
      // expectedDisplayTime es cuando el fotograma empieza a verse: lo ideal es mediaTime = audio.
      const d = md.mediaTime - audio;
      if (audio < video.duration - 1 / fps) {
        stats.frameDrift = d;
        lastFrameAt = performance.now();
        const nowS = lastFrameAt / 1000;
        stats.history.push([nowS, d]);
        while (stats.history.length && stats.history[0][0] < nowS - WINDOW_S) stats.history.shift();
        stats.maxAbs = Math.max(...stats.history.map(([, x]) => Math.abs(x)));
        stats.meanDrift = recentMean(stats.history, nowS, SMOOTH_S, MIN_SAMPLES);
      }
    }
    video.requestVideoFrameCallback(measure);
  }

  requestAnimationFrame(control);
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) video.requestVideoFrameCallback(measure);

  return {
    stats,
    start() {
      active = true;
    },
    stop() {
      active = false;
      correcting = false;
      video.playbackRate = 1;
    },
    resetWindow: clearHistory,
  };
}
