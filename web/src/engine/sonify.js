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

import * as Tone from "tone";
import {
  clusterLevels,
  configFromTrack,
  cutoffFor,
  intensity,
  midiToFreq,
  noteFor,
  pulseTimes,
  yearlyMeans,
} from "./mapping.js";

export const LAYERS = ["melody", "arp", "ostinato", "drone", "pulse", "ticks", "records"];

const LAYER_DB = {
  melody: -9,
  arp: -22,
  ostinato: -18,
  drone: -16,
  pulse: -10,
  ticks: -20,
  records: -14,
};

export function createEngine() {
  let graph = null;
  let track = null;
  let cfg = null;
  let years = [];
  let recordSet = new Set();
  let yearDuration = 0.1597; // s por año: la velocidad original del vídeo (~25 s)
  let playing = false;
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
    };
  }

  function applyMutes() {
    if (!graph) return;
    for (const name of LAYERS) graph.layers[name].mute = muted.has(name);
  }

  /** Valores de los parámetros continuos para una anomalía dada. */
  function continuousTargets(v) {
    const k = intensity(v, cfg);
    const cluster = clusterLevels(v, cfg);
    return [
      [graph.droneLevel.gain, 0.4 + 0.6 * k],
      [graph.minorSecond.gain, 0.3 * cluster.minorSecond],
      [graph.tritone.gain, 0.25 * cluster.tritone],
    ];
  }

  function schedule() {
    const transport = Tone.getTransport();
    const draw = Tone.getDraw();
    const g = graph;
    const yd = yearDuration;
    const monthDur = yd / 12;
    let monthIndex = 0;

    years.forEach((year, yi) => {
      const t0 = yi * yd;
      const months = track.series.slice(monthIndex, monthIndex + year.months);
      const firstMonthIndex = monthIndex;
      monthIndex += year.months;
      const k = intensity(year.v, cfg);

      transport.schedule((time) => {
        const midi = noteFor(year.v, yi, cfg);
        // Crescendo: la melodía suena más fuerte cuanto más calor.
        g.melody.triggerAttackRelease(midiToFreq(midi), yd * 0.9, time, 0.45 + 0.45 * k);
        if (year.year % 10 === 0) g.tick.triggerAttackRelease(0.05, time, 0.8);
        for (const [param, value] of continuousTargets(year.v)) {
          param.linearRampToValueAtTime(value, time + yd);
        }
        draw.schedule(() => emit("year", { year: year.year, value: year.v, index: yi }), time);
      }, t0);

      months.forEach((m, mi) => {
        transport.schedule((time) => {
          g.brightness.frequency.linearRampToValueAtTime(cutoffFor(m.v, cfg), time + monthDur);
          const midi = noteFor(m.v, firstMonthIndex + mi, cfg);
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
    for (const { t, v } of pulseTimes(years, yd, cfg)) {
      const vel = 0.35 + 0.55 * intensity(v, cfg);
      transport.schedule((time) => {
        g.pulse.triggerAttackRelease("C1", 0.3, time, vel);
        g.pulse.triggerAttackRelease("C1", 0.2, time + 0.12, vel * 0.6);
      }, t);
    }

    const end = years.length * yd + 0.3;
    transport.schedule((time) => draw.schedule(() => stop(true), time), end);
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

  async function play() {
    if (playing || !track) return;
    await Tone.start();
    if (!graph) graph = await buildGraph();
    applyMutes();

    const transport = Tone.getTransport();
    transport.cancel();
    transport.seconds = 0;
    schedule();

    // Limpia las automatizaciones que pudieran quedar de una reproducción anterior.
    const now = Tone.now();
    const first = years[0].v;
    resetParam(graph.brightness.frequency, cutoffFor(first, cfg), now);
    for (const [param, value] of continuousTargets(first)) resetParam(param, value, now);
    fadeEnv(graph.droneEnv.gain, 1, 1.5, now);

    transport.start(now + 0.1);
    playing = true;
  }

  function stop(finished = false) {
    if (!playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    const now = Tone.now();
    graph.melody.releaseAll(now);
    fadeEnv(graph.droneEnv.gain, 0, finished ? 3.5 : 0.8, now);
    playing = false;
    if (finished) emit("end");
  }

  return {
    load(newTrack, overrides = {}) {
      track = newTrack;
      cfg = configFromTrack(track, overrides);
      years = yearlyMeans(track.series);
      recordSet = new Set(track.records);
    },
    play,
    stop: () => stop(false),
    get playing() {
      return playing;
    },
    get yearDuration() {
      return yearDuration;
    },
    /** Segundos por año. Se aplica en la siguiente reproducción. */
    setYearDuration(seconds) {
      yearDuration = seconds;
    },
    totalDuration() {
      return years.length * yearDuration;
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
