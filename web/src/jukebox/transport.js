// Reproducción de las cuatro pistas con Web Audio.
//
// Cada pista es un AudioBufferSourceNode que pasa por su propia ganancia (mute/solo) y
// un analizador (nivel). Las cuatro arrancan en el mismo instante del AudioContext con
// el mismo offset, así que no pueden desfasarse entre sí. Pausar o saltar = parar las
// fuentes y crear otras nuevas (un AudioBufferSourceNode solo se puede arrancar una vez).

import { audiblePosition, LEAD_S } from "./clock.js";

const GAIN_TAU_S = 0.012; // rampa de mute/solo, sin clics

export function createTransport(ctx, stems, duration) {
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const tracks = stems.map(({ id, buffer }) => {
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    gain.connect(analyser);
    analyser.connect(master);
    return { id, buffer, gain, analyser, source: null, scratch: new Float32Array(analyser.fftSize) };
  });
  const state = { playing: false, offset: 0, startedAt: 0, duration };
  let generation = 0;
  let onEnded = () => {};

  /** Tiempo del contexto que se está oyendo ahora (descontada la latencia de salida). */
  function audibleContextTime(perfNow = performance.now()) {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      return ts.contextTime + (perfNow - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  function stopSources() {
    generation += 1;
    for (const t of tracks) {
      if (!t.source) continue;
      t.source.onended = null;
      try {
        t.source.stop();
      } catch {
        // ya parada
      }
      t.source.disconnect();
      t.source = null;
    }
  }

  function startAt(offset) {
    stopSources();
    const gen = generation;
    const when = ctx.currentTime + LEAD_S;
    for (const t of tracks) {
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gain);
      src.start(when, offset);
      src.stop(when + (duration - offset));
      t.source = src;
    }
    tracks[0].source.onended = () => {
      if (gen !== generation) return;
      stopSources();
      Object.assign(state, { playing: false, offset: duration });
      onEnded();
    };
    Object.assign(state, { playing: true, offset, startedAt: when });
    return when;
  }

  const clampT = (t) => Math.min(duration, Math.max(0, t));

  return {
    tracks,
    state,
    get playing() {
      return state.playing;
    },
    /** Posición (s) de la música que se oye en el instante `perfNow` (performance.now()). */
    position(perfNow) {
      return audiblePosition(state, audibleContextTime(perfNow));
    },
    /** Arranca en `at` (por defecto, donde se pausó). Devuelve el instante de arranque. */
    async play(at = state.offset) {
      await ctx.resume();
      const t = clampT(at) >= duration - 0.05 ? 0 : clampT(at);
      return startAt(t);
    },
    pause() {
      const p = this.position();
      stopSources();
      Object.assign(state, { playing: false, offset: p });
      return p;
    },
    /** Salta a t sin cambiar el estado de reproducción. */
    seek(t) {
      if (state.playing) startAt(clampT(t));
      else state.offset = clampT(t);
    },
    setGains(gains) {
      for (const t of tracks) t.gain.gain.setTargetAtTime(gains[t.id], ctx.currentTime, GAIN_TAU_S);
    },
    /** Nivel RMS de cada pista después de su ganancia: { id: rms }. */
    levels() {
      return Object.fromEntries(
        tracks.map((t) => {
          t.analyser.getFloatTimeDomainData(t.scratch);
          let sum = 0;
          for (const x of t.scratch) sum += x * x;
          return [t.id, Math.sqrt(sum / t.scratch.length)];
        }),
      );
    },
    onEnded(fn) {
      onEnded = fn;
    },
    latency() {
      return ctx.outputLatency || ctx.baseLatency || 0;
    },
  };
}
