// Control de reproducción con dobles: el vídeo, el transporte y los temporizadores son
// falsos para poder decidir en qué orden llegan los eventos asíncronos.

import { test } from "node:test";
import assert from "node:assert/strict";

import { atEnd, createPlayer, END_EPS_S } from "./player.js";
import { createTransport } from "./transport.js";

const DURATION = 67.667;
const VIDEO_DURATION = 66.7;
const FPS = 30;
const LAST_FRAME = VIDEO_DURATION - 1 / FPS;

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setImmediate(r));

function fakeTransport() {
  const state = { playing: false, offset: 0, duration: DURATION };
  const starts = [];
  let gate = null;
  let ended = () => {};
  return {
    state,
    starts,
    get playing() {
      return state.playing;
    },
    position: () => state.offset,
    resume: () => (gate ? gate.promise : Promise.resolve()),
    start(at) {
      Object.assign(state, { playing: true, offset: at });
      starts.push(at);
    },
    pause() {
      state.playing = false;
      return state.offset;
    },
    seek(t) {
      if (state.playing) this.start(t);
      else state.offset = t;
    },
    latency: () => 0.03,
    onEnded(fn) {
      ended = fn;
    },
    // Ayudas del test
    advance(s) {
      if (state.playing) state.offset = Math.min(DURATION, state.offset + s);
    },
    reachEnd() {
      Object.assign(state, { playing: false, offset: DURATION });
      ended();
    },
    holdResume() {
      gate = deferred();
      return gate;
    },
  };
}

function setup() {
  const video = {
    currentTime: 0,
    paused: true,
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
  const follower = {
    active: false,
    starts: 0,
    start() {
      this.active = true;
      this.starts += 1;
    },
    stop() {
      this.active = false;
    },
    resetWindow() {},
  };
  const transport = fakeTransport();
  const seeks = [];
  const timers = [];
  const events = [];
  const player = createPlayer({
    video,
    transport,
    follower,
    duration: DURATION,
    videoDuration: () => VIDEO_DURATION,
    fps: FPS,
    waitSeeked: () => {
      const d = deferred();
      seeks.push(d);
      return d.promise;
    },
    schedule: (fn) => timers.push(fn),
    onChange: (e) => events.push(e),
  });
  transport.onEnded(() => player.handleEnded());
  const settle = async ({ order = "fifo" } = {}) => {
    const pending = seeks.splice(0);
    for (const d of order === "lifo" ? pending.reverse() : pending) d.resolve();
    await flush();
    for (const fn of timers.splice(0)) fn();
  };
  return { video, follower, transport, player, seeks, timers, events, settle };
}

async function playingAt(t) {
  const s = setup();
  s.player.startAt(t);
  await s.settle();
  assert.equal(s.player.playing, true);
  assert.equal(s.video.paused, false);
  return s;
}

test("arrancar: el audio espera al fotograma y el vídeo espera al audio", async () => {
  const { video, follower, transport, player, seeks, timers } = setup();
  player.startAt(10);
  assert.equal(video.currentTime, 10);
  assert.equal(player.playing, true, "cuenta como sonando mientras arranca");
  assert.deepEqual(transport.starts, []);
  seeks[0].resolve();
  await flush();
  assert.deepEqual(transport.starts, [10]);
  assert.equal(follower.active, false);
  timers.shift()();
  assert.equal(follower.active, true);
  assert.equal(video.paused, false);
});

test("saltos rápidos seguidos: solo arranca el último, lleguen como lleguen los seeked", async () => {
  for (const order of ["fifo", "lifo"]) {
    const s = await playingAt(10);
    for (let i = 0; i < 5; i++) s.player.jump(s.player.position() + 5);
    assert.equal(s.video.currentTime, 35);
    await s.settle({ order });
    assert.deepEqual(s.transport.starts, [10, 35], order);
    assert.equal(s.follower.starts, 2, "el seguidor arranca una vez por acción válida");
    assert.equal(s.video.paused, false);
  }
});

test("saltar mientras arranca reinicia en el destino nuevo, no en el viejo", async () => {
  const s = setup();
  s.transport.seek(10);
  s.player.togglePlay(); // pendiente del seeked
  s.player.jump(s.player.position() + 5);
  s.player.jump(s.player.position() + 5);
  await s.settle();
  assert.deepEqual(s.transport.starts, [20]);
  assert.equal(s.player.playing, true);
});

test("pausar durante el seek: no suena nada y se queda en el destino", async () => {
  const s = await playingAt(10);
  s.player.jump(30);
  s.player.pause();
  await s.settle();
  assert.deepEqual(s.transport.starts, [10]);
  assert.equal(s.transport.playing, false);
  assert.equal(s.player.playing, false);
  assert.equal(s.player.position(), 30);
  assert.equal(s.video.paused, true);
  assert.equal(s.video.currentTime, 30);
  assert.equal(s.follower.active, false);
});

test("pausar mientras el navegador despierta el audio: tampoco suena", async () => {
  const s = setup();
  const gate = s.transport.holdResume();
  s.player.startAt(20);
  s.seeks[0].resolve();
  await flush(); // ahora espera a resume()
  s.player.pause();
  gate.resolve();
  await flush();
  assert.deepEqual(s.transport.starts, []);
  assert.equal(s.player.playing, false);
  assert.equal(s.player.position(), 20);
});

test("Espacio dos veces seguidas cancela el arranque", async () => {
  const s = setup();
  s.player.togglePlay();
  s.player.togglePlay();
  await s.settle();
  assert.deepEqual(s.transport.starts, []);
  assert.equal(s.player.playing, false);
});

test("un temporizador viejo no suelta el vídeo después de una pausa ni de otro salto", async () => {
  const s = setup();
  s.player.startAt(10);
  s.seeks.shift().resolve();
  await flush();
  const old = s.timers.shift(); // arranque del vídeo de la primera acción, aún sin disparar
  s.player.pause();
  old();
  assert.equal(s.follower.active, false);
  assert.equal(s.video.paused, true);

  s.player.startAt(10);
  s.seeks.shift().resolve();
  await flush();
  const first = s.timers.shift();
  s.player.jump(40);
  s.seeks.shift().resolve();
  await flush();
  first();
  assert.equal(s.follower.starts, 0, "el temporizador de antes del salto no cuenta");
  s.timers.shift()();
  assert.equal(s.follower.starts, 1);
  assert.deepEqual(s.transport.starts, [10, 10, 40]);
});

test("saltar exactamente al final termina: audio parado, vídeo en el último fotograma", async () => {
  for (const startPlaying of [true, false]) {
    const s = startPlaying ? await playingAt(30) : setup();
    s.player.jump(DURATION);
    await s.settle();
    assert.equal(s.player.playing, false);
    assert.equal(s.player.ended, true);
    assert.equal(s.transport.playing, false);
    assert.equal(s.player.position(), DURATION);
    assert.ok(Math.abs(s.video.currentTime - LAST_FRAME) < 1e-9);
    assert.equal(s.video.paused, true);
    assert.equal(s.follower.active, false);
    assert.equal(s.events.at(-1), "end");
    assert.deepEqual(s.transport.starts, startPlaying ? [30] : [], "no vuelve a empezar solo");
  }
});

test("el final incluye los últimos END_EPS_S y los saltos que se pasan", async () => {
  assert.equal(atEnd(DURATION - END_EPS_S, DURATION), true);
  assert.equal(atEnd(DURATION - 0.2, DURATION), false);
  const s = await playingAt(65);
  s.player.jump(s.player.position() + 5); // 70 s → se recorta a la duración
  await s.settle();
  assert.equal(s.player.ended, true);
  const t = DURATION - 0.2;
  s.player.jump(t);
  assert.equal(s.player.ended, false);
  assert.equal(s.player.position(), t);
});

test("reproducir después del final vuelve a empezar en 0", async () => {
  const s = setup();
  s.player.jump(DURATION);
  s.player.togglePlay();
  await s.settle();
  assert.deepEqual(s.transport.starts, [0]);
  assert.equal(s.video.currentTime, 0);
});

test("reproducción repetida: tres vueltas completas", async () => {
  const s = setup();
  for (let i = 0; i < 3; i++) {
    s.player.togglePlay();
    await s.settle();
    assert.equal(s.player.playing, true);
    s.transport.advance(30);
    s.transport.reachEnd();
    assert.equal(s.player.ended, true);
    assert.equal(s.video.paused, true);
    assert.ok(Math.abs(s.video.currentTime - LAST_FRAME) < 1e-9);
    assert.equal(s.follower.active, false);
  }
  assert.deepEqual(s.transport.starts, [0, 0, 0]);
  assert.equal(s.follower.starts, 3);
});

// Transporte real con un AudioContext falso: las fuentes paradas no pueden avisar del final.
function fakeAudioContext() {
  const node = () => ({ connect() {}, disconnect() {}, gain: { setTargetAtTime() {} } });
  return {
    currentTime: 0,
    destination: {},
    resume: async () => {},
    createGain: node,
    createAnalyser: () => ({ ...node(), fftSize: 0, getFloatTimeDomainData() {} }),
    createBufferSource: () => ({ ...node(), onended: null, start() {}, stop() {} }),
  };
}

test("transporte: el aviso de fin de una fuente vieja no cuenta tras saltar", () => {
  const stems = ["a", "b"].map((id) => ({ id, buffer: {} }));
  const transport = createTransport(fakeAudioContext(), stems, DURATION);
  let ends = 0;
  transport.onEnded(() => (ends += 1));
  transport.start(10);
  const oldEnded = transport.tracks[0].source.onended;
  transport.seek(20);
  oldEnded();
  assert.equal(ends, 0);
  assert.equal(transport.playing, true);
  transport.tracks[0].source.onended();
  assert.equal(ends, 1);
  assert.equal(transport.playing, false);
  assert.equal(transport.state.offset, DURATION);
});

test("transporte: arrancar en la duración no vuelve en silencio al principio", () => {
  const transport = createTransport(fakeAudioContext(), [{ id: "a", buffer: {} }], DURATION);
  transport.start(DURATION + 5);
  assert.equal(transport.state.offset, DURATION);
});
