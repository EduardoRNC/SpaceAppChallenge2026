// Demo del video jukebox: el vídeo ECCO2 del NASA SVS con sus cuatro pistas FM.
// Esta primera etapa cubre reproducción sincronizada, transporte y mute/solo.

import { createTransport } from "./transport.js";
import { createFollower } from "./follower.js";
import { createPlayer } from "./player.js";
import { shortcutFor } from "./keys.js";
import { videoTarget } from "./clock.js";
import { gains, initialStates, reset, toggle } from "./mix.js";
import { barBeat, formatDate, formatTime, frameAt, modelDate } from "./format.js";
import { assetUrl, checkManifest } from "./manifest.js";
import { checkTimeline, chordAt, noteName, soundingAt } from "./timeline.js";
import { createPianoRoll } from "./pianoroll.js";
import { createRegionCharts, renderMappingList } from "./regions.js";

const MANIFEST = "data/jukebox/ecco2.json";
const STEP_S = 5;
const SEEK_TIMEOUT_MS = 2000;

const $ = (id) => document.getElementById(id);
const el = {
  title: $("jb-title"),
  video: $("jb-video"),
  caption: $("jb-caption"),
  play: $("jb-play"),
  back: $("jb-back"),
  fwd: $("jb-fwd"),
  seek: $("jb-seek"),
  time: $("jb-time"),
  date: $("jb-date"),
  bar: $("jb-bar"),
  chord: $("jb-chord"),
  roll: $("jb-roll"),
  now: $("jb-now"),
  regionPicker: $("jb-region-picker"),
  charts: $("jb-charts"),
  mapping: $("jb-mapping"),
  stems: $("jb-stems"),
  reset: $("jb-reset"),
  status: $("jb-status"),
  disclaimer: $("jb-disclaimer"),
  credits: $("jb-credits"),
  debug: $("jb-debug-values"),
};

let manifest, timeline, transport, follower, player, roll, regions, states, scrubbing = null, decodeInfo = "", nowText = "";
const say = (text) => (el.status.textContent = text);

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} al cargar ${url}`);
  return res.arrayBuffer();
}

function waitSeeked(video) {
  if (!video.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", done);
  });
}

const videoDuration = () => el.video.duration || manifest.video.duration_s;

function showFrameAt(t) {
  el.video.currentTime = videoTarget(t, videoDuration(), manifest.video.fps);
}

function onPlayerChange(event) {
  updatePlayButton();
  if (event === "end") say("Fin. Pulsa Reproducir para empezar de nuevo.");
  else if (event === "start" && el.status.textContent.startsWith("Fin")) say("");
}

function updatePlayButton() {
  const playing = player.playing;
  el.play.textContent = playing ? "Pausa" : "Reproducir";
  el.play.setAttribute("aria-pressed", String(playing));
}

function applyMix() {
  transport.setGains(gains(states));
  for (const s of states) {
    const row = el.stems.querySelector(`[data-stem="${s.id}"]`);
    row.querySelector(".jb-mute").setAttribute("aria-pressed", String(s.mute));
    row.querySelector(".jb-solo").setAttribute("aria-pressed", String(s.solo));
    row.classList.toggle("jb-silent", gains(states)[s.id] === 0);
  }
}

function setMix(next, message) {
  states = next;
  applyMix();
  if (message) say(message);
}

function stemLabel(id) {
  return manifest.audio.stems.find((s) => s.id === id).label;
}

function toggleStem(id, key) {
  const next = toggle(states, id, key);
  const on = next.find((s) => s.id === id)[key];
  const what = key === "mute" ? (on ? "silenciada" : "con sonido") : on ? "en solo" : "sin solo";
  setMix(next, `${stemLabel(id)}: ${what}.`);
}

function buildStemRows() {
  el.stems.replaceChildren(
    ...manifest.audio.stems.map((s, i) => {
      const li = document.createElement("li");
      li.dataset.stem = s.id;
      li.style.setProperty("--stem-color", s.color);
      li.innerHTML = `
        <span class="jb-swatch" aria-hidden="true"></span>
        <span class="jb-name"><strong>${s.label}</strong><small>Referencia DX7: ${s.instrument.split(" - ").pop()}</small></span>
        <span class="jb-meter" aria-hidden="true"><span></span></span>
        <button type="button" class="jb-mute" aria-pressed="false"
          aria-label="Silenciar ${s.label}" title="Silenciar (tecla ${i + 1})">M</button>
        <button type="button" class="jb-solo" aria-pressed="false"
          aria-label="Solo ${s.label}" title="Solo (Mayús + ${i + 1})">S</button>`;
      li.querySelector(".jb-mute").addEventListener("click", () => toggleStem(s.id, "mute"));
      li.querySelector(".jb-solo").addEventListener("click", () => toggleStem(s.id, "solo"));
      return li;
    }),
  );
}

function renderCredits() {
  const items = manifest.credits.map((c) => {
    const name = c.url ? `<a href="${c.url}">${c.text}</a>` : c.text;
    return `<li><strong>${c.role}:</strong> ${name}${c.detail ? ` — ${c.detail}` : ""}</li>`;
  });
  el.credits.innerHTML = `<ul>${items.join("")}</ul><p>${manifest.notice}</p>`;
  el.disclaimer.textContent = manifest.disclaimer;
}

function updateMusic(t) {
  const chord = chordAt(timeline.chords, Math.min(t, timeline.timing.music_duration_s - 1e-6));
  el.chord.textContent = chord ? `Acorde ${chord.name}` : "";
  const mix = gains(states);
  roll.draw(t, mix);
  regions.update(t);
  const parts = Object.entries(soundingAt(roll.lanes, t))
    .filter(([id, notes]) => notes.length && mix[id] > 0)
    .map(([id, notes]) => `${stemLabel(id)}: ${notes.map(noteName).join(" ")}`);
  const text = parts.length ? `Suena: ${parts.join(" · ")}` : "Ninguna nota sonando.";
  if (text !== nowText) el.now.textContent = nowText = text;
}

function updateReadout() {
  const t = scrubbing ? Number(el.seek.value) : transport.position();
  const { fps, frames } = manifest.video;
  const frame = frameAt(Math.min(t, manifest.video.duration_s), fps, frames);
  el.time.textContent = `${formatTime(t)} / ${formatTime(manifest.audio.duration_s)}`;
  if (!scrubbing) el.seek.value = t.toFixed(2);
  el.seek.setAttribute("aria-valuetext", `${formatTime(t)} de ${formatTime(manifest.audio.duration_s)}`);
  if (manifest.model_time) el.date.textContent = `Fecha del modelo: ${formatDate(modelDate(frame, manifest.model_time))} · fotograma ${frame + 1}/${frames}`;
  const { bar, beat } = barBeat(Math.min(t, manifest.timeline.music_duration_s - 1e-6), manifest.timeline.bpm);
  el.bar.textContent = `Compás ${bar} · tiempo ${beat}`;
  updateMusic(t);

  const levels = transport.levels();
  for (const [id, rms] of Object.entries(levels)) {
    const db = 20 * Math.log10(rms + 1e-9);
    const w = Math.max(0, Math.min(1, (db + 60) / 60));
    el.stems.querySelector(`[data-stem="${id}"] .jb-meter span`).style.width = `${(w * 100).toFixed(1)}%`;
  }

  const st = follower.stats;
  const ms = (x) => (x == null ? "—" : `${(x * 1000).toFixed(1)} ms`);
  el.debug.textContent = [
    `Desvío medio vídeo − audio (0,5 s): ${ms(st.meanDrift)}`,
    `Último fotograma: ${ms(st.frameDrift)} · máximo |desvío| en 10 s: ${ms(st.maxAbs)}`,
    `(a 30 fps cada fotograma se ve 33 ms: los valores por fotograma oscilan ±1/2 fotograma)`,
    `Saltos de corrección: ${st.seeks} · velocidad del vídeo: ${st.rate.toFixed(3)}`,
    `Latencia de salida: ${ms(transport.latency())}`,
    `Pistas decodificadas: ${decodeInfo}`,
  ].join("\n");
  window.jukeboxDebug.lastLevels = levels;
  requestAnimationFrame(updateReadout);
}

function runShortcut(action) {
  const ids = manifest.audio.stems.map((s) => s.id);
  switch (action.type) {
    case "toggle":
      return player.togglePlay();
    case "step":
      return player.jump(player.position() + action.direction * STEP_S);
    case "start":
      return player.jump(0);
    case "end":
      return player.jump(manifest.audio.duration_s);
    case "mute":
    case "solo":
      return toggleStem(ids[action.index], action.type);
    case "reset":
      return setMix(reset(states), "Todas las pistas con sonido.");
  }
}

function bindTransport() {
  el.play.addEventListener("click", () => player.togglePlay());
  el.back.addEventListener("click", () => player.jump(player.position() - STEP_S));
  el.fwd.addEventListener("click", () => player.jump(player.position() + STEP_S));
  el.reset.addEventListener("click", () => setMix(reset(states), "Todas las pistas con sonido."));

  el.seek.addEventListener("input", () => {
    if (scrubbing === null) {
      scrubbing = { resume: player.playing };
      if (player.playing) player.pause();
    }
    showFrameAt(Number(el.seek.value));
  });
  el.seek.addEventListener("change", () => {
    const resume = scrubbing?.resume;
    scrubbing = null;
    const t = Number(el.seek.value);
    if (resume) player.startAt(t);
    else player.jump(t);
  });

  transport.onEnded(() => player.handleEnded());

  document.addEventListener("keydown", (e) => {
    const action = shortcutFor(e, manifest.audio.stems.length);
    if (!action) return;
    e.preventDefault();
    runShortcut(action);
  });
}

async function init() {
  window.jukeboxDebug = {};
  try {
    const base = document.baseURI;
    manifest = await (await fetch(assetUrl(MANIFEST, base))).json();
    const problems = checkManifest(manifest);
    if (problems.length) throw new Error(`manifiesto no válido: ${problems.join("; ")}`);
    el.title.textContent = manifest.title;
    renderCredits();

    el.video.src = assetUrl(manifest.video.src, base);
    const videoReady = new Promise((resolve, reject) => {
      el.video.addEventListener("loadeddata", resolve, { once: true });
      el.video.addEventListener("error", () => reject(new Error("no se pudo cargar el vídeo")), { once: true });
    });

    const timelineReady = fetch(assetUrl(manifest.timeline.src, base)).then((res) => {
      if (!res.ok) throw new Error(`${res.status} al cargar el timeline`);
      return res.json();
    });

    const ctx = new AudioContext({ sampleRate: manifest.audio.sample_rate, latencyHint: "interactive" });
    let loaded = 0;
    say("Cargando pistas de audio…");
    const stems = await Promise.all(
      manifest.audio.stems.map(async (s) => {
        const buffer = await ctx.decodeAudioData(await fetchBytes(assetUrl(s.src, base)));
        say(`Cargando pistas de audio… ${++loaded}/${manifest.audio.stems.length}`);
        return { id: s.id, buffer };
      }),
    );
    const short = stems.filter((s) => s.buffer.length < manifest.audio.samples);
    if (short.length) throw new Error(`pistas más cortas de lo esperado: ${short.map((s) => s.id).join(", ")}`);
    const lengths = [...new Set(stems.map((s) => s.buffer.length))];
    decodeInfo = `${lengths.join(" / ")} muestras (esperadas ${manifest.audio.samples}) a ${ctx.sampleRate} Hz`;
    timeline = await timelineReady;
    const timelineProblems = checkTimeline(timeline, manifest);
    if (timelineProblems.length) throw new Error(`timeline no válido: ${timelineProblems.join("; ")}`);
    await videoReady;

    transport = createTransport(ctx, stems, manifest.audio.duration_s);
    follower = createFollower(el.video, transport, manifest.video.fps);
    player = createPlayer({
      video: el.video,
      transport,
      follower,
      duration: manifest.audio.duration_s,
      videoDuration,
      fps: manifest.video.fps,
      waitSeeked,
      onChange: onPlayerChange,
    });
    states = initialStates(manifest.audio.stems.map((s) => s.id));
    el.roll.closest("figure").hidden = false;
    roll = createPianoRoll({
      canvas: el.roll,
      timeline,
      stems: manifest.audio.stems,
      onSeek: (t) => player.jump(t),
    });
    regions = createRegionCharts({
      picker: el.regionPicker,
      container: el.charts,
      timeline,
      stems: manifest.audio.stems,
      onSeek: (t) => player.jump(t),
    });
    renderMappingList(el.mapping, manifest.audio.stems, timeline.features.metrics);
    for (const s of document.querySelectorAll(".jb-regions, .jb-map")) s.hidden = false;
    Object.assign(window.jukeboxDebug, { manifest, timeline, transport, follower, player, roll, regions, ctx, stems, getStates: () => states });

    buildStemRows();
    applyMix();
    el.seek.max = String(manifest.audio.duration_s);
    for (const b of [el.play, el.back, el.fwd, el.seek, el.reset]) b.disabled = false;
    bindTransport();
    updatePlayButton();
    requestAnimationFrame(updateReadout);
    say("Listo. Pulsa Reproducir o la barra espaciadora.");
  } catch (err) {
    console.error(err);
    say(`Error: ${err.message}`);
  }
}

init();
