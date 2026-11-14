// Motor de sonificación con Tone.js.
// v3: timbres limpios de la v1 + tensión progresiva de la v2, sin distorsión
// (sin ondas de sierra, sin ruido y sin compresor).
//
// Capas (cada una se puede silenciar por separado):
//   melody    — una nota por año (media anual), triángulo suave con brillo creciente
//   arp       — los 12 meses como arpegio pulsado, una octava más arriba (brillo)
//   ostinato  — los 12 meses como ostinato grave de fondo, una octava más abajo
//   drone     — C2 y C3 en ondas seno, con crescendo y un cluster limpio (Re♭, Fa♯)
//   pulse     — latido de timbal (lub-dub) que se acelera con la temperatura
//   ticks     — un tick al empezar cada década
//   records   — una campanita al cerrar un año récord
//   frames    — acorde agudo (Do5–Sol5) con trémolo, controlado por el COLOR de la
//               espiral medido en los fotogramas del vídeo (scripts/frame_features.py):
//               cuanto más cálido el color, más volumen y trémolo más rápido
//
// Reproducción: playRange({ from, to, yearDuration }) suena los años [from, to) y
// devuelve una promesa que se resuelve con "finished" o "stopped".

import * as Tone from "tone";
import {
  clusterLevels,
  configFromTrack,
  cutoffFor,
  frameTargets,
  intensity,
  midiToFreq,
  noteFor,
  pulseTimes,
  warmthRange,
  yearlyMeans,
} from "./mapping.js";

export const LAYERS = ["melody", "arp", "ostinato", "drone", "pulse", "ticks", "records", "frames"];

const LAYER_DB = {
  melody: -9,
  arp: -22,
  ostinato: -18,
  drone: -16,
  pulse: -10,
  ticks: -20,
  records: -14,
  frames: -24,
};

export function createEngine() {
  let graph = null;
  let track = null;
  let cfg = null;
  let years = []; // [{ year, v, months, monthStart, w }]
  let wRange = [0, 1]; // rango de la calidez medida en los fotogramas
  let recordSet = new Set();
  let yearDuration = 0.1597; // s por año: la velocidad original del vídeo (~25 s)
  let playing = false;
  let run = null; // { resolve } de la reproducción en curso
  let currentIndex = 0;
  const muted = new Set();
  const listeners = { year: [], end: [] };

  const emit = (name, payload) => listeners[name].forEach((fn) => fn(payload));

  async function buildGraph() {
    const reverb = new Tone.Reverb({ decay: 4, wet: 0.28 });
    await reverb.generate();
    const limiter = new Tone.Limiter(-1);
    reverb.chain(limiter, Tone.getDestination());

    const layers = Object.fromEntries(
      LAYERS.map((name) => [name, new Tone.Volume(LAYER_DB[name]).connect(reverb)]),
    );
    const t = cfg.tonicMidi;

    // --- Melodía y arpegio: comparten el filtro de "brillo" (v1) ---
    const brightness = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 0.7 }).connect(reverb);
    for (const name of ["melody", "arp"]) {
      layers[name].disconnect();
      layers[name].connect(brightness);
    }

    const melody = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.25, sustain: 0.25, release: 0.8 },
    }).connect(layers.melody);

    const arp = new Tone.PluckSynth({ attackNoise: 0.6, dampening: 3500, resonance: 0.9 })
      .connect(layers.arp);

    // --- Ostinato grave de fondo (la "melodía de fondo" de la v2, con timbre limpio) ---
    const ostinatoFilter = new Tone.Filter({ type: "lowpass", frequency: 900, Q: 0.7 })
      .connect(layers.ostinato);
    const ostinato = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.08 },
    }).connect(ostinatoFilter);

    // --- Drone en ondas seno (v1) con crescendo y cluster limpio ---
    // Las fuentes continuas suenan siempre; `droneEnv` hace la entrada y la salida
    // y `layers.drone` queda libre para el interruptor.
    const droneEnv = new Tone.Gain(0).connect(layers.drone);
    const droneLevel = new Tone.Gain(0.5).connect(droneEnv);
    const droneSources = [
      new Tone.Oscillator(midiToFreq(t - 24), "sine").connect(droneLevel), // C2
      new Tone.Oscillator(midiToFreq(t - 12), "sine").connect(droneLevel), // C3
    ];
    // Re♭3 contra Do3 produce un "batido" de unos 8 Hz: tensión sin ensuciar el timbre.
    const clusterFilter = new Tone.Filter(1000, "lowpass").connect(droneEnv);
    const minorSecond = new Tone.Gain(0).connect(clusterFilter);
    const tritone = new Tone.Gain(0).connect(clusterFilter);
    const clusterSources = [
      new Tone.Oscillator(midiToFreq(t - 11), "triangle").connect(minorSecond), // Re♭3
      new Tone.Oscillator(midiToFreq(t - 6), "triangle").connect(tritone), // Fa♯3
    ];
    [...droneSources, ...clusterSources].forEach((osc) => osc.start());

    // --- Latido ---
    const pulse = new Tone.MembraneSynth({
      pitchDecay: 0.06,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.1 },
    }).connect(layers.pulse);

    // --- Tick de década ---
    const tickFilter = new Tone.Filter(2500, "highpass").connect(layers.ticks);
    const tick = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).connect(tickFilter);

    // --- Campanita de récord (v1) ---
    const bell = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 12,
      envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.2 },
      modulationEnvelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.5 },
    }).connect(layers.records);

    // --- Capa de fotogramas: acorde agudo limpio con trémolo ---
    const framesEnv = new Tone.Gain(0).connect(layers.frames);
    const framesLevel = new Tone.Gain(0.12).connect(framesEnv);
    const tremolo = new Tone.Tremolo({ frequency: 1.5, depth: 0.7 }).connect(framesLevel).start();
    for (const midi of [t + 12, t + 19]) {
      new Tone.Oscillator(midiToFreq(midi), "triangle").connect(tremolo).start(); // C5, G5
    }

    return {
      layers,
      brightness,
      melody,
      arp,
      ostinato,
      droneEnv,
      droneLevel,
      minorSecond,
      tritone,
      pulse,
      tick,
      bell,
      framesEnv,
      framesLevel,
      tremolo,
    };
  }

  async function ensureGraph() {
    await Tone.start();
    if (!graph) graph = await buildGraph();
    applyMutes();
  }

  function applyMutes() {
    if (!graph) return;
    for (const name of LAYERS) graph.layers[name].mute = muted.has(name);
  }

  /** Valores de los parámetros continuos para un año (dato y color del fotograma). */
  function continuousTargets(year) {
    const k = intensity(year.v, cfg);
    const cluster = clusterLevels(year.v, cfg);
    const targets = [
      [graph.droneLevel.gain, 0.4 + 0.6 * k],
      [graph.minorSecond.gain, 0.3 * cluster.minorSecond],
      [graph.tritone.gain, 0.25 * cluster.tritone],
    ];
    if (year.w != null) {
      const f = frameTargets(year.w, wRange);
      targets.push([graph.framesLevel.gain, f.level], [graph.tremolo.frequency, f.tremoloHz]);
    }
    return targets;
  }

  function resetParam(param, value, time) {
    param.cancelScheduledValues(time);
    param.setValueAtTime(value, time);
  }

  function fadeEnv(param, to, seconds, now) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + seconds);
  }

  function pulseHit(time, v) {
    const vel = 0.35 + 0.55 * intensity(v, cfg);
    graph.pulse.triggerAttackRelease("C1", 0.3, time, vel);
    graph.pulse.triggerAttackRelease("C1", 0.2, time + 0.12, vel * 0.6);
  }

  /** Programa los años [from, to) en el Transport, empezando en el segundo 0. */
  function schedule(from, to, yd) {
    const transport = Tone.getTransport();
    const draw = Tone.getDraw();
    const g = graph;
    const monthDur = yd / 12;
    const slice = years.slice(from, to);

    slice.forEach((year, k) => {
      const yi = from + k;
      const t0 = k * yd;
      const months = track.series.slice(year.monthStart, year.monthStart + year.months);
      const loud = intensity(year.v, cfg);

      transport.schedule((time) => {
        const midi = noteFor(year.v, yi, cfg);
        // Crescendo: la melodía suena más fuerte cuanto más calor.
        g.melody.triggerAttackRelease(midiToFreq(midi), yd * 0.9, time, 0.45 + 0.45 * loud);
        if (year.year % 10 === 0) g.tick.triggerAttackRelease(0.05, time, 0.8);
        for (const [param, value] of continuousTargets(year)) {
          param.linearRampToValueAtTime(value, time + yd);
        }
        draw.schedule(() => {
          currentIndex = yi;
          emit("year", { year: year.year, value: year.v, index: yi });
        }, time);
      }, t0);

      months.forEach((m, mi) => {
        transport.schedule((time) => {
          g.brightness.frequency.linearRampToValueAtTime(cutoffFor(m.v, cfg), time + monthDur);
          const midi = noteFor(m.v, year.monthStart + mi, cfg);
          g.arp.triggerAttack(midiToFreq(midi + 12), time);
          // El primer mes del año va acentuado para que se oiga el compás.
          g.ostinato.triggerAttackRelease(midiToFreq(midi - 12), monthDur * 0.8, time, mi === 0 ? 0.9 : 0.5);
        }, t0 + mi * monthDur);
      });

      // La campanita suena al cerrar el año, cuando ya se sabe que fue récord.
      if (recordSet.has(year.year)) {
        transport.schedule((time) => {
          g.bell.triggerAttackRelease(midiToFreq(cfg.tonicMidi + 31), 0.3, time, 0.8);
        }, t0 + yd * 0.92);
      }
    });

    // Latido "lub-dub": su tempo sigue a la temperatura, no a la velocidad elegida.
    for (const { t, v } of pulseTimes(slice, yd, cfg)) {
      transport.schedule((time) => pulseHit(time, v), t);
    }

    const end = slice.length * yd + 0.3;
    transport.schedule((time) => draw.schedule(() => stop("finished"), time), end);
  }

  async function playRange({ from = 0, to = years.length, yearDuration: yd = yearDuration } = {}) {
    if (!track) return "stopped";
    stop("stopped", { quick: true });
    await ensureGraph();

    from = Math.max(0, Math.min(years.length - 1, from));
    to = Math.max(from + 1, Math.min(years.length, to));
    currentIndex = from;

    const transport = Tone.getTransport();
    transport.cancel();
    transport.seconds = 0;
    schedule(from, to, yd);

    // Limpia las automatizaciones que pudieran quedar de una reproducción anterior.
    const now = Tone.now();
    const first = years[from];
    resetParam(graph.brightness.frequency, cutoffFor(first.v, cfg), now);
    for (const [param, value] of continuousTargets(first)) resetParam(param, value, now);
    for (const env of [graph.droneEnv, graph.framesEnv]) fadeEnv(env.gain, 1, from === 0 ? 1.5 : 0.4, now);

    transport.start(now + 0.1);
    playing = true;
    return new Promise((resolve) => {
      run = { resolve, to };
    });
  }

  function stop(status = "stopped", { quick = false } = {}) {
    if (!playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    const now = Tone.now();
    graph.melody.releaseAll(now);
    const fade = status === "finished" ? 3.5 : quick ? 0.15 : 0.8;
    for (const env of [graph.droneEnv, graph.framesEnv]) fadeEnv(env.gain, 0, fade, now);
    playing = false;
    const current = run;
    run = null;
    if (status === "finished") emit("end", { reachedEnd: current?.to === years.length });
    current?.resolve(status);
  }

  // --- Ejemplos breves para la intro (uno por capa) ------------------------------

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Hace sonar el ejemplo de una capa y resuelve cuando termina (1–2.5 s). */
  async function demo(kind) {
    stop("stopped", { quick: true });
    await ensureGraph();
    const g = graph;
    const now = Tone.now() + 0.05;
    const calm = { v: 0, w: null };
    // Mantiene un fondo (drone y/o shimmer) durante `seconds` con los valores de `year`.
    const hold = (envs, year, seconds) => {
      for (const [param, value] of continuousTargets(year)) resetParam(param, value, now);
      for (const env of envs) {
        fadeEnv(env.gain, 1, 0.2, now);
        env.gain.setValueAtTime(1, now + seconds - 0.4);
        env.gain.linearRampToValueAtTime(0, now + seconds);
      }
    };

    switch (kind) {
      case "reference":
        hold([g.droneEnv], calm, 1.8);
        return wait(1800);
      case "pitch": {
        const values = [-0.5, -0.1, 0.3, 0.7, 1.1, 1.5];
        values.forEach((v, i) => {
          const time = now + i * 0.28;
          g.brightness.frequency.setValueAtTime(cutoffFor(v, cfg), time);
          g.melody.triggerAttackRelease(midiToFreq(noteFor(v, 0, cfg)), 0.3, time, 0.7);
        });
        return wait(values.length * 280 + 400);
      }
      case "months": {
        for (let i = 0; i < 12; i++) {
          const time = now + i * 0.11;
          const midi = noteFor(0.1 * Math.sin(i), i, cfg);
          g.arp.triggerAttack(midiToFreq(midi + 12), time);
          g.ostinato.triggerAttackRelease(midiToFreq(midi - 12), 0.08, time, i === 0 ? 0.9 : 0.5);
        }
        return wait(1500);
      }
      case "pulse": {
        let time = now;
        for (let i = 0; i < 2; i++, time += 60 / 54) pulseHit(time, 0);
        for (let i = 0; i < 4; i++, time += 60 / 144) pulseHit(time, 1.4);
        return wait((time - now) * 1000 + 200);
      }
      case "tension": {
        const from = continuousTargets(calm);
        const to = continuousTargets({ v: 1.5, w: null });
        hold([g.droneEnv], calm, 2.4);
        to.forEach(([param, value], i) => {
          param.setValueAtTime(from[i][1], now + 0.5);
          param.linearRampToValueAtTime(value, now + 1.3);
        });
        return wait(2400);
      }
      case "frames": {
        const hasFrames = years.some((y) => y.w != null);
        if (!hasFrames) return wait(0);
        const [lo, hi] = wRange;
        hold([g.framesEnv], { v: 0, w: lo }, 2.2);
        const f = frameTargets(hi, wRange);
        g.framesLevel.gain.linearRampToValueAtTime(f.level, now + 1.6);
        g.tremolo.frequency.linearRampToValueAtTime(f.tremoloHz, now + 1.6);
        return wait(2200);
      }
      case "record":
        g.bell.triggerAttackRelease(midiToFreq(cfg.tonicMidi + 31), 0.3, now, 0.8);
        return wait(1300);
      case "ticks":
        for (let i = 0; i < 3; i++) g.tick.triggerAttackRelease(0.05, now + i * 0.35, 0.8);
        return wait(1100);
      default:
        return wait(0);
    }
  }

  /** Silencia enseguida los fondos de los ejemplos (al saltar la intro). */
  function hush() {
    if (!graph) return;
    const now = Tone.now();
    graph.melody.releaseAll(now);
    for (const env of [graph.droneEnv, graph.framesEnv]) fadeEnv(env.gain, 0, 0.15, now);
  }

  return {
    load(newTrack, overrides = {}) {
      stop("stopped", { quick: true });
      track = newTrack;
      cfg = configFromTrack(track, overrides);
      const warmthByYear = new Map((track.frameWarmth ?? []).map((row) => [row.year, row.w]));
      if (track.frameWarmth?.length) wRange = warmthRange(track.frameWarmth);
      let monthStart = 0;
      years = yearlyMeans(track.series).map((y) => {
        const withStart = { ...y, monthStart, w: warmthByYear.get(y.year) ?? null };
        monthStart += y.months;
        return withStart;
      });
      recordSet = new Set(track.records);
      currentIndex = 0;
    },
    playRange,
    stop: () => stop("stopped"),
    demo,
    hush,
    get playing() {
      return playing;
    },
    get currentIndex() {
      return currentIndex;
    },
    get years() {
      return years;
    },
    get yearDuration() {
      return yearDuration;
    },
    /** Segundos por año para el modo Historia. */
    setYearDuration(seconds) {
      yearDuration = seconds;
    },
    setLayer(name, enabled) {
      if (enabled) muted.delete(name);
      else muted.add(name);
      applyMutes();
    },
    on(name, fn) {
      listeners[name].push(fn);
    },
  };
}
