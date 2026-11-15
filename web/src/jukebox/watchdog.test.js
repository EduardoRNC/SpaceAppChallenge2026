// Vigilante del vídeo con un <video> falso y un reloj controlado por el test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_RESUME_WINDOW_S,
  autoResumeAllowed,
  bufferedAhead,
  canResume,
  createFreezeDetector,
  errorReason,
  FREEZE_GRACE_S,
  MAX_AUTO_RESUMES,
  POLL_MS,
  watchVideo,
} from "./watchdog.js";

const ranges = (...pairs) => ({ length: pairs.length, start: (i) => pairs[i][0], end: (i) => pairs[i][1] });

test("detector: el vídeo que avanza no está congelado; parado más de FREEZE_GRACE_S, sí", () => {
  const d = createFreezeDetector();
  let now = 0;
  const sample = (videoT, expecting = true) => d.sample({ now: (now += POLL_MS / 1000), videoT, expecting });
  for (let i = 0; i < 20; i++) assert.equal(sample(i * 0.25), false);
  const stuckAt = 20 * 0.25;
  const frozen = [];
  for (let i = 0; i < 6; i++) frozen.push(sample(stuckAt));
  // La primera muestra aún es movimiento (4,75 → 5); después, 1 s quieto.
  assert.deepEqual(frozen, [false, false, false, false, true, true], `aviso tras ${FREEZE_GRACE_S} s`);
  assert.equal(sample(stuckAt, false), false, "sin esperar movimiento (pausa, final del vídeo) no cuenta");
  assert.equal(sample(stuckAt), false, "y vuelve a empezar a contar");
});

test("detector: el salto de corrección a un tramo sin cargar no cuenta como avance", () => {
  const d = createFreezeDetector();
  let now = 0;
  const sample = (videoT, seeking = false) => d.sample({ now: (now += 0.25), videoT, seeking, expecting: true });
  sample(31.5);
  sample(31.88);
  assert.equal(sample(31.88), false);
  assert.equal(sample(32.77, true), false, "el seguidor salta (sigue buscando)");
  assert.equal(sample(32.77, true), false);
  assert.equal(sample(32.77, true), true, "1 s desde el último fotograma de verdad");
});

test("canResume: hace falta el fotograma siguiente y margen cargado (o llegar al final)", () => {
  assert.equal(canResume({ readyState: 2, seeking: false, ahead: 10, remaining: 30 }), false);
  assert.equal(canResume({ readyState: 4, seeking: true, ahead: 10, remaining: 30 }), false);
  assert.equal(canResume({ readyState: 3, seeking: false, ahead: 0.5, remaining: 30 }), false, "poco margen: volvería a congelarse");
  assert.equal(canResume({ readyState: 3, seeking: false, ahead: 2.5, remaining: 30 }), true);
  assert.equal(canResume({ readyState: 3, seeking: false, ahead: 0.9, remaining: 1 }), true, "cerca del final basta lo que queda");
  assert.equal(canResume({ readyState: 4, seeking: false, ahead: 0, remaining: 30 }), true);
});

test("bufferedAhead: el tramo cargado que contiene el tiempo", () => {
  assert.equal(bufferedAhead(ranges([0, 5], [10, 20]), 12), 8);
  assert.equal(bufferedAhead(ranges([0, 5], [10, 20]), 7), 0);
  assert.equal(bufferedAhead(undefined, 3), 0);
});

test("congelaciones seguidas: se reanuda solo hasta MAX_AUTO_RESUMES veces por ventana", () => {
  const holds = Array.from({ length: MAX_AUTO_RESUMES }, (_, i) => i * 2);
  assert.equal(autoResumeAllowed(holds, 10), true);
  assert.equal(autoResumeAllowed([...holds, 9], 10), false);
  assert.equal(autoResumeAllowed([...holds, 9], 9 + AUTO_RESUME_WINDOW_S + 5), true, "las viejas caducan");
});

test("motivos de MediaError", () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(errorReason), ["aborted", "network", "decode", "unsupported", "unknown"]);
});

// Integración con un vídeo y un reproductor falsos.
function rig() {
  const listeners = {};
  const video = {
    currentTime: 0,
    seeking: false,
    readyState: 4,
    buffered: ranges([0, 66.7]),
    error: null,
    addEventListener: (type, fn) => (listeners[type] ??= new Set()).add(fn),
    removeEventListener: (type, fn) => listeners[type]?.delete(fn),
    emit: (type) => listeners[type]?.forEach((fn) => fn()),
    listeners,
  };
  const calls = [];
  const player = {
    mode: "playing",
    following: true,
    hold(why) {
      calls.push(["hold", why]);
      if (this.mode !== "playing") return false;
      this.mode = "holding";
      this.following = false;
      return true;
    },
    recover() {
      calls.push(["recover"]);
      this.mode = "playing";
      this.following = true;
    },
    fail(why) {
      calls.push(["fail", why]);
      this.mode = "failed";
    },
  };
  let audioT = 10;
  const transport = { position: () => audioT };
  let clock = 0;
  let tick = null;
  let stuckCalls = 0;
  const dog = watchVideo({
    video,
    player,
    transport,
    fps: 30,
    videoDuration: () => 66.7,
    onStuck: () => (stuckCalls += 1),
    now: () => clock,
    every: (fn) => (tick = fn),
    cancel: () => (tick = null),
  });
  const step = (seconds, { videoMoves = true } = {}) => {
    for (let s = 0; s < seconds; s += POLL_MS / 1000) {
      clock += POLL_MS / 1000;
      if (player.mode === "playing") {
        audioT += POLL_MS / 1000;
        if (videoMoves) video.currentTime = audioT;
      }
      tick();
    }
  };
  return { video, player, transport, dog, calls, step, stuck: () => stuckCalls, setAudio: (t) => (audioT = t) };
}

test("red caída con el vídeo sonando: para el audio con el motivo de `stalled` y sigue cuando hay datos", () => {
  const r = rig();
  r.step(2);
  assert.deepEqual(r.calls, []);
  r.video.emit("stalled");
  r.video.readyState = 2;
  r.video.buffered = ranges([0, r.video.currentTime]);
  r.step(1.5, { videoMoves: false });
  assert.deepEqual(r.calls, [["hold", "network"]]);
  assert.equal(r.player.mode, "holding");
  r.step(2);
  assert.equal(r.player.mode, "holding", "sin datos sigue esperando");
  r.video.readyState = 3;
  r.video.buffered = ranges([0, 30]);
  r.step(0.25);
  assert.deepEqual(r.calls.at(-1), ["recover"]);
  assert.equal(r.player.mode, "playing");
});

test("`waiting` sin más datos: motivo buffering; un salto que no termina sin aviso: motivo seek", () => {
  const w = rig();
  w.step(1);
  w.video.emit("waiting");
  w.video.readyState = 2;
  w.step(1.5, { videoMoves: false });
  assert.deepEqual(w.calls, [["hold", "buffering"]]);

  const r = rig();
  r.step(1);
  r.video.seeking = true;
  r.step(1.5, { videoMoves: false });
  assert.deepEqual(r.calls, [["hold", "seek"]]);
  r.step(1);
  assert.equal(r.player.mode, "holding");
  r.video.seeking = false;
  r.step(0.25);
  assert.equal(r.player.mode, "playing");
});

test("al final del vídeo (el audio dura un poco más) la imagen quieta no es congelación", () => {
  const r = rig();
  r.setAudio(66.69);
  r.video.currentTime = 66.67;
  r.step(3, { videoMoves: false });
  assert.deepEqual(r.calls, []);
});

test("en pausa o arrancando (sin seguir al audio) tampoco cuenta", () => {
  const r = rig();
  r.player.following = false;
  r.step(3, { videoMoves: false });
  assert.deepEqual(r.calls, []);
});

test("se congela una y otra vez: deja de reanudar solo y avisa; una acción del usuario lo rearma", () => {
  const r = rig();
  for (let i = 0; i <= MAX_AUTO_RESUMES; i++) {
    let frozenFor = 0;
    while (r.player.mode === "playing" && frozenFor < 3) {
      r.step(0.25, { videoMoves: false });
      frozenFor += 0.25;
    }
    assert.equal(r.player.mode, "holding");
    assert.ok(frozenFor <= 1.25, `el audio para en ~1 s (${frozenFor} s)`);
    r.step(0.75);
    assert.equal(r.player.mode, "holding", "no rebota en el mismo instante aunque haya datos");
    r.step(0.5); // readyState 4 y más de MIN_HOLD_S esperando: se reanuda (salvo la última)
    assert.equal(r.player.mode, i < MAX_AUTO_RESUMES ? "playing" : "holding");
  }
  assert.equal(r.calls.filter(([c]) => c === "hold").length, MAX_AUTO_RESUMES + 1);
  assert.equal(r.calls.filter(([c]) => c === "recover").length, MAX_AUTO_RESUMES);
  assert.equal(r.player.mode, "holding");
  assert.equal(r.dog.stuck, true);
  assert.equal(r.stuck(), 1);
  r.step(5);
  assert.equal(r.player.mode, "holding", "no se reanuda solo");
  r.player.mode = "playing"; // el usuario pulsó Reintentar
  r.player.following = true;
  r.step(0.5);
  assert.equal(r.dog.stuck, false);
});

test("error del vídeo → player.fail con el motivo; un error vacío (load()) se ignora", () => {
  const r = rig();
  r.video.emit("error");
  assert.deepEqual(r.calls, []);
  r.video.error = { code: 2 };
  r.video.emit("error");
  assert.deepEqual(r.calls, [["fail", "network"]]);
});

test("stop() quita los escuchadores y el sondeo", () => {
  const r = rig();
  r.dog.stop();
  for (const set of Object.values(r.video.listeners)) assert.equal(set.size, 0);
});
