// Motor de sonificación con Tone.js.
//
// Capas (cada una se puede silenciar por separado):
//   melody   — una nota por año (media anual): lleva la tendencia
//   arp      — los 12 meses de cada año como arpegio suave, una octava más arriba
//   drone    — nota fija en la línea base, más una disonancia que crece por encima de +1.0 °C
//   ticks    — un tick al empezar cada década, para orientarse en el tiempo
//   records  — una campanita al cerrar un año récord

import * as Tone from "tone";
import {
  configFromTrack,
  cutoffFor,
  dissonance,
  midiToFreq,
  noteFor,
  yearlyMeans,
} from "./mapping.js";

export const LAYERS = ["melody", "arp", "drone", "ticks", "records"];

const LAYER_DB = { melody: -8, arp: -22, drone: -20, ticks: -20, records: -14 };

export function createEngine() {
  let graph = null;
  let track = null;
  let cfg = null;
  let years = [];
  let recordSet = new Set();
  let yearDuration = 0.41; // s por año; 146 años ≈ 60 s, igual que el vídeo
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
      LAYERS.map((name) => [name, new Tone.Volume(LAYER_DB[name])]),
    );

    // Melodía anual y arpegio mensual comparten el filtro de "brillo".
    const filter = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 0.7 });
    filter.connect(reverb);
    layers.melody.connect(filter);
    layers.arp.connect(filter);

    const melody = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.25, sustain: 0.25, release: 0.8 },
    }).connect(layers.melody);

    const arp = new Tone.PluckSynth({ attackNoise: 0.6, dampening: 3500, resonance: 0.9 })
      .connect(layers.arp);

    // Drone: C2 y C3, una y dos octavas por debajo de la tónica (C4 = 0 °C).
    // Los osciladores suenan siempre; droneEnv hace la entrada y la salida.
    // `layers.drone` queda libre para silenciar la capa con el interruptor.
    layers.drone.connect(reverb);
    const droneEnv = new Tone.Gain(0).connect(layers.drone);
    const droneLow = new Tone.Oscillator(midiToFreq(cfg.tonicMidi - 24), "sine").connect(droneEnv);
    const droneMid = new Tone.Oscillator(midiToFreq(cfg.tonicMidi - 12), "sine").connect(droneEnv);
    // Disonancia: segunda menor sobre el drone (Db3). Su ganancia sigue a la temperatura.
    const dissGain = new Tone.Gain(0).connect(droneEnv);
    const dissFilter = new Tone.Filter(900, "lowpass").connect(dissGain);
    const dissOsc = new Tone.Oscillator(midiToFreq(cfg.tonicMidi - 11), "sawtooth").connect(dissFilter);
    for (const osc of [droneLow, droneMid, dissOsc]) osc.start();

    const tickFilter = new Tone.Filter(2500, "highpass").connect(layers.ticks);
    layers.ticks.connect(reverb);
    const tick = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).connect(tickFilter);

    layers.records.connect(reverb);
    const bell = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 12,
      envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.2 },
      modulationEnvelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.5 },
    }).connect(layers.records);

    return { layers, filter, melody, arp, droneEnv, dissGain, tick, bell };
  }

  function applyMutes() {
    if (!graph) return;
    for (const name of LAYERS) graph.layers[name].mute = muted.has(name);
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

      transport.schedule((time) => {
        // Melodía anual
        const midi = noteFor(year.v, yi, cfg);
        g.melody.triggerAttackRelease(midiToFreq(midi), yd * 0.9, time, 0.7);
        // Tick de década
        if (year.year % 10 === 0) g.tick.triggerAttackRelease(0.05, time, 0.8);
        // Disonancia según la media anual
        g.dissGain.gain.linearRampToValueAtTime(0.35 * dissonance(year.v, cfg), time + yd);
        draw.schedule(() => emit("year", { year: year.year, value: year.v, index: yi }), time);
      }, t0);

      months.forEach((m, mi) => {
        transport.schedule((time) => {
          const v = m.v;
          g.filter.frequency.linearRampToValueAtTime(cutoffFor(v, cfg), time + monthDur);
          const midi = noteFor(v, firstMonthIndex + mi, cfg) + 12;
          // El primer mes del año va acentuado para que se oiga el compás.
          g.arp.triggerAttack(midiToFreq(midi), time);
          if (mi === 0) g.arp.volume.setValueAtTime(0, time);
          else if (mi === 1) g.arp.volume.setValueAtTime(-4, time);
        }, t0 + mi * monthDur);
      });

      // La campanita suena al cerrar el año, cuando ya se sabe que fue récord.
      if (recordSet.has(year.year)) {
        transport.schedule((time) => {
          g.bell.triggerAttackRelease(midiToFreq(cfg.tonicMidi + 31), 0.3, time, 0.8);
        }, t0 + yd * 0.92);
      }
    });

    const end = years.length * yd + 0.5;
    transport.schedule((time) => draw.schedule(() => stop(true), time), end);
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
    const first = track.series[0].v;
    resetParam(graph.filter.frequency, cutoffFor(first, cfg), now);
    resetParam(graph.dissGain.gain, 0, now);
    const env = graph.droneEnv.gain;
    env.cancelScheduledValues(now);
    env.setValueAtTime(env.value, now);
    env.linearRampToValueAtTime(1, now + 1.5);

    transport.start(now + 0.1);
    playing = true;
  }

  function resetParam(param, value, time) {
    param.cancelScheduledValues(time);
    param.setValueAtTime(value, time);
  }

  function stop(finished = false) {
    if (!playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    const now = Tone.now();
    graph.melody.releaseAll(now);
    const env = graph.droneEnv.gain;
    env.cancelScheduledValues(now);
    env.setValueAtTime(env.value, now);
    env.linearRampToValueAtTime(0, now + (finished ? 2.5 : 0.8));
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
