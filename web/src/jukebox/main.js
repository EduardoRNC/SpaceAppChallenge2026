// Demo del video jukebox: el vídeo ECCO2 del NASA SVS con sus cuatro pistas FM.
// Reproducción sincronizada, mute/solo, piano roll, gráficas por región; en inglés o español.

import { createTransport } from "./transport.js";
import { createFollower } from "./follower.js";
import { createPlayer } from "./player.js";
import { watchVideo } from "./watchdog.js";
import { shortcutFor } from "./keys.js";
import { videoTarget } from "./clock.js";
import { gains, initialStates, reset, toggle } from "./mix.js";
import { barBeat, DATE_OPTIONS, formatTime, frameAt, modelDate } from "./format.js";
import { assetUrl, checkManifest } from "./manifest.js";
import { checkTimeline, chordAt, noteName, soundingAt } from "./timeline.js";
import { createPianoRoll } from "./pianoroll.js";
import { createRegionCharts, renderMappingList } from "./regions.js";
import { dx7Patch, problemsText, stemLabel } from "./texts.js";
import { createI18n, initialLang, safeStorage, translateDom } from "../i18n/index.js";

const MANIFEST = "data/jukebox/ecco2.json";
// Altavoz: con ondas mientras suena, tachado cuando la pista está silenciada (lo elige el CSS).
const SPEAKER_ICON = `<svg class="jb-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path class="jb-speaker" d="M4 9h4l5-4v14l-5-4H4z" />
  <path class="jb-waves" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  <path class="jb-cross" d="M16 9l6 6M22 9l-6 6" />
</svg>`;
const STEP_S = 5;
const SEEK_TIMEOUT_MS = 2000;
const RELOAD_TIMEOUT_MS = 15000;

const storage = safeStorage();
const i18n = createI18n({
  lang: initialLang({ search: location.search, storage }),
  storage,
  onMissing: (key, lang) => console.warn(`i18n: falta "${key}" (${lang})`),
});
const { t } = i18n;

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
  notice: $("jb-notice"),
  noticeText: $("jb-notice-text"),
  retry: $("jb-retry"),
  disclaimer: $("jb-disclaimer"),
  credits: $("jb-credits"),
  debug: $("jb-debug-values"),
};

let manifest, timeline, transport, follower, player, watchdog, roll, regions, states;
let scrubbing = null;
let decoded = null;
let nowText = "";

// El estado se guarda como función para poder reescribirlo al cambiar de idioma.
let status = () => "";
const say = (text) => {
  status = text;
  el.status.textContent = text();
};

/** Error con su texto en el idioma activo (se vuelve a traducir si cambia el idioma). */
class UiError extends Error {
  constructor(describe) {
    super(describe());
    this.describe = describe;
  }
}

const decimal = () => i18n.number(1.5).charAt(1);
const time = (s) => formatTime(s, decimal());
const ms = (x) => (x == null ? "—" : t("debug.ms", { value: i18n.number(x * 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new UiError(() => t("errors.fetch", { url, status: res.status }));
  return res.arrayBuffer();
}

/** true cuando el vídeo termina de buscar; false si tarda más de SEEK_TIMEOUT_MS. */
function waitSeeked(video) {
  if (!video.seeking) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      video.removeEventListener("seeked", seeked);
      resolve(ok);
    };
    const seeked = () => done(true);
    const timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", seeked);
  });
}

/** Vuelve a cargar el vídeo (tras un error de red): true cuando tiene el primer fotograma. */
function reloadVideo() {
  const video = el.video;
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("error", failed);
      resolve(ok);
    };
    const loaded = () => done(true);
    const failed = () => done(false);
    const timer = setTimeout(() => done(false), RELOAD_TIMEOUT_MS);
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("error", failed);
    video.load();
  });
}

// Aviso visible (role="alert") con su botón: el texto también es una función, por el idioma.
let notice = null;
function showNotice(text, action = "retry") {
  notice = { text, action };
  renderNotice();
}
function hideNotice() {
  notice = null;
  renderNotice();
}
function renderNotice() {
  el.notice.classList.toggle("jb-notice-on", notice != null);
  el.noticeText.textContent = notice ? notice.text() : "";
  el.retry.hidden = !notice?.action;
  if (notice?.action) el.retry.textContent = t(notice.action === "reload" ? "notice.reload" : "notice.retry");
}

/** Texto del aviso según el estado del reproductor (null si no hay nada que avisar). */
function noticeFor(mode, reason) {
  const at = { time: time(player.position()) };
  if (mode === "holding") return () => t(watchdog?.stuck ? "notice.stuck" : `notice.${reason}`, at);
  if (mode === "failed") return () => t(`notice.error.${reason}`, at);
  if (mode === "retrying") return () => t("notice.retrying");
  return null;
}

const videoDuration = () => el.video.duration || manifest.video.duration_s;

function showFrameAt(t) {
  el.video.currentTime = videoTarget(t, videoDuration(), manifest.video.fps);
}

const endStatus = () => t("status.end");

/** Texto hablado del piano roll y las gráficas en la posición actual (no en cada fotograma). */
function syncSliders() {
  if (!roll) return;
  const pos = player.position();
  roll.syncAria(pos);
  regions.update(pos);
  regions.syncAria();
}

function onPlayerChange(event) {
  updatePlayButton();
  if (event !== "start") syncSliders();
  if (event === "end") say(endStatus);
  else if (event === "start" && status === endStatus) say(() => "");
  if (event === "recover") say(() => t("notice.recovered"));
  const text = noticeFor(player.mode, player.reason);
  if (text) showNotice(text, player.mode === "retrying" ? null : "retry");
  else if (notice?.action !== "reload") hideNotice();
}

function updatePlayButton() {
  const playing = player?.playing ?? false;
  el.play.textContent = t(playing ? "transport.pause" : "transport.play");
}

const stemById = (id) => manifest.audio.stems.find((s) => s.id === id);
const label = (id) => stemLabel(i18n, stemById(id));

function applyMix() {
  transport.setGains(gains(states));
  updateMixButtons();
}

function updateMixButtons() {
  for (const s of states) {
    const row = el.stems.querySelector(`[data-stem="${s.id}"]`);
    const mute = row.querySelector(".jb-mute");
    const n = states.indexOf(s) + 1;
    mute.setAttribute("aria-pressed", String(s.mute));
    mute.title = t(s.mute ? "mixer.unmuteTitle" : "mixer.muteTitle", { n });
    row.querySelector(".jb-solo").setAttribute("aria-pressed", String(s.solo));
    row.classList.toggle("jb-silent", gains(states)[s.id] === 0);
  }
}

function setMix(next, message) {
  states = next;
  applyMix();
  if (message) say(message);
}

function toggleStem(id, key) {
  const next = toggle(states, id, key);
  const on = next.find((s) => s.id === id)[key];
  const what = key === "mute" ? (on ? "mixer.muted" : "mixer.unmuted") : on ? "mixer.soloOn" : "mixer.soloOff";
  setMix(next, () => t(what, { name: label(id) }));
}

const allOn = () => setMix(reset(states), () => t("mixer.allOn"));

function buildStemRows() {
  el.stems.replaceChildren(
    ...manifest.audio.stems.map((s) => {
      const li = document.createElement("li");
      li.dataset.stem = s.id;
      li.style.setProperty("--stem-color", s.color);
      li.innerHTML = `
        <span class="jb-swatch" aria-hidden="true"></span>
        <span class="jb-name"><strong></strong><small></small></span>
        <span class="jb-meter" aria-hidden="true"><span></span></span>
        <button type="button" class="jb-mute" aria-pressed="false">${SPEAKER_ICON}</button>
        <button type="button" class="jb-solo" aria-pressed="false"></button>`;
      li.querySelector(".jb-mute").addEventListener("click", () => toggleStem(s.id, "mute"));
      li.querySelector(".jb-solo").addEventListener("click", () => toggleStem(s.id, "solo"));
      return li;
    }),
  );
  relabelStems();
}

/** Textos de las filas del mezclador (sin rehacerlas: el foco se queda donde estaba). */
function relabelStems() {
  manifest.audio.stems.forEach((s, i) => {
    const row = el.stems.querySelector(`[data-stem="${s.id}"]`);
    const name = stemLabel(i18n, s);
    row.querySelector(".jb-name strong").textContent = name;
    row.querySelector(".jb-name small").textContent = t("mixer.dx7", { patch: dx7Patch(s) });
    row.querySelector(".jb-mute").setAttribute("aria-label", t("mixer.mute", { name }));
    const solo = row.querySelector(".jb-solo");
    solo.setAttribute("aria-label", t("mixer.solo", { name }));
    solo.title = t("mixer.soloTitle", { n: i + 1 });
    solo.textContent = t("mixer.soloShort");
  });
}

function renderCredits() {
  const ul = document.createElement("ul");
  manifest.credits.forEach((c, i) => {
    const key = `data.credits.${i}`;
    const li = document.createElement("li");
    const role = document.createElement("strong");
    role.textContent = `${i18n.data(`${key}.role`, c.role)}:`;
    const name = document.createElement(c.url ? "a" : "span");
    if (c.url) name.href = c.url;
    name.textContent = i18n.data(`${key}.text`, c.text);
    li.append(role, " ", name);
    if (c.detail) li.append(` — ${i18n.data(`${key}.detail`, c.detail)}`);
    ul.append(li);
  });
  const notice = document.createElement("p");
  notice.textContent = i18n.data("data.notice", manifest.notice);
  el.credits.replaceChildren(ul, notice);
  el.disclaimer.textContent = i18n.data("data.disclaimer", manifest.disclaimer);
}

const chordAtPos = (pos) => chordAt(timeline.chords, Math.min(pos, timeline.timing.music_duration_s - 1e-6));

/** Notas que se oyen en pos (las pistas silenciadas no cuentan). */
function soundingText(pos, mix = gains(states)) {
  const parts = Object.entries(soundingAt(roll.lanes, pos))
    .filter(([id, notes]) => notes.length && mix[id] > 0)
    .map(([id, notes]) => `${label(id)}: ${notes.map(noteName).join(" ")}`);
  return parts.length ? t("roll.sounding", { parts: parts.join(" · ") }) : t("roll.silent");
}

/** Lo que lee el lector de pantalla en el piano roll: tiempo, acorde y notas. */
function describeRoll(pos) {
  const chord = chordAtPos(pos);
  return t("roll.valueText", { time: time(pos), chord: chord ? chord.name : "–", notes: soundingText(pos) });
}

function updateMusic(pos) {
  const chord = chordAtPos(pos);
  el.chord.textContent = chord ? t("readout.chord", { name: chord.name }) : "";
  const mix = gains(states);
  roll.draw(pos, mix);
  regions.update(pos);
  const text = soundingText(pos, mix);
  if (text !== nowText) el.now.textContent = nowText = text;
}

function updateReadout() {
  const pos = scrubbing ? Number(el.seek.value) : transport.position();
  const { fps, frames } = manifest.video;
  const frame = frameAt(Math.min(pos, manifest.video.duration_s), fps, frames);
  const total = time(manifest.audio.duration_s);
  el.time.textContent = `${time(pos)} / ${total}`;
  if (!scrubbing) el.seek.value = pos.toFixed(2);
  el.seek.setAttribute("aria-valuetext", t("transport.positionText", { time: time(pos), total }));
  if (manifest.model_time) {
    const date = i18n.date(modelDate(frame, manifest.model_time), DATE_OPTIONS);
    el.date.textContent = t("readout.date", { date, frame: frame + 1, frames });
  }
  const { bar, beat } = barBeat(Math.min(pos, manifest.timeline.music_duration_s - 1e-6), manifest.timeline.bpm);
  el.bar.textContent = t("readout.bar", { bar, beat });
  updateMusic(pos);

  const levels = transport.levels();
  for (const [id, rms] of Object.entries(levels)) {
    const db = 20 * Math.log10(rms + 1e-9);
    const w = Math.max(0, Math.min(1, (db + 60) / 60));
    el.stems.querySelector(`[data-stem="${id}"] .jb-meter span`).style.width = `${(w * 100).toFixed(1)}%`;
  }

  const st = follower.stats;
  el.debug.textContent = [
    t("debug.mean", { value: ms(st.meanDrift) }),
    t("debug.frame", { value: ms(st.frameDrift), max: ms(st.maxAbs) }),
    t("debug.note"),
    t("debug.seeks", { seeks: st.seeks, rate: i18n.number(st.rate, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) }),
    t("debug.latency", { value: ms(transport.latency()) }),
    t("debug.decoded", { value: decoded ? t("debug.decodedValue", decoded) : "—" }),
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
      return allOn();
  }
}

function bindTransport() {
  el.play.addEventListener("click", () => player.togglePlay());
  el.back.addEventListener("click", () => player.jump(player.position() - STEP_S));
  el.fwd.addEventListener("click", () => player.jump(player.position() + STEP_S));
  el.reset.addEventListener("click", allOn);

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
    const pos = Number(el.seek.value);
    if (resume) player.startAt(pos);
    else player.jump(pos);
  });

  transport.onEnded(() => player.handleEnded());

  document.addEventListener("keydown", (e) => {
    const action = shortcutFor(e, manifest.audio.stems.length);
    if (!action) return;
    e.preventDefault();
    runShortcut(action);
  });
}

/**
 * Pone toda la página en el idioma activo. Solo cambia textos: no toca el audio, el vídeo
 * ni el reproductor, así que puede hacerse en plena reproducción.
 */
function applyLanguage() {
  document.documentElement.lang = i18n.lang;
  document.title = t("page.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("page.description"));
  translateDom(document, t);
  for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === i18n.lang));
  updatePlayButton();
  el.status.textContent = status();
  renderNotice();
  if (!manifest) return;
  el.title.textContent = i18n.data("data.title", manifest.title);
  renderCredits();
  if (!states) return;
  relabelStems();
  updateMixButtons();
  regions.relabel();
  syncSliders();
  renderMappingList(el.mapping, manifest.audio.stems, timeline.features.metrics, i18n);
  nowText = "";
}

function bindLanguage() {
  for (const b of document.querySelectorAll("[data-lang]")) b.addEventListener("click", () => i18n.setLang(b.dataset.lang));
  i18n.onChange(applyLanguage);
  applyLanguage();
}

async function init() {
  window.jukeboxDebug = { i18n };
  bindLanguage();
  el.retry.addEventListener("click", () => (notice?.action === "reload" ? location.reload() : player?.retry()));
  try {
    const base = document.baseURI;
    manifest = await (await fetch(assetUrl(MANIFEST, base))).json();
    const problems = checkManifest(manifest);
    if (problems.length) throw new UiError(() => t("errors.manifest", { problems: problemsText(i18n, "manifest", problems) }));
    delete el.title.dataset.i18n;
    applyLanguage();

    el.video.src = assetUrl(manifest.video.src, base);
    const videoReady = new Promise((resolve, reject) => {
      el.video.addEventListener("loadeddata", resolve, { once: true });
      el.video.addEventListener("error", () => reject(new UiError(() => t("errors.video"))), { once: true });
    });

    const timelineReady = fetch(assetUrl(manifest.timeline.src, base)).then((res) => {
      if (!res.ok) throw new UiError(() => t("errors.fetch", { url: manifest.timeline.src, status: res.status }));
      return res.json();
    });

    const ctx = new AudioContext({ sampleRate: manifest.audio.sample_rate, latencyHint: "interactive" });
    const total = manifest.audio.stems.length;
    let loaded = 0;
    say(() => t("status.loadingAudio"));
    const stems = await Promise.all(
      manifest.audio.stems.map(async (s) => {
        const buffer = await ctx.decodeAudioData(await fetchBytes(assetUrl(s.src, base)));
        const done = ++loaded;
        say(() => t("status.loadingProgress", { done, total }));
        return { id: s.id, buffer };
      }),
    );
    const short = stems.filter((s) => s.buffer.length < manifest.audio.samples);
    if (short.length) throw new UiError(() => t("errors.shortStems", { ids: short.map((s) => s.id).join(", ") }));
    const lengths = [...new Set(stems.map((s) => s.buffer.length))];
    decoded = { lengths: lengths.join(" / "), expected: manifest.audio.samples, rate: ctx.sampleRate };
    timeline = await timelineReady;
    const timelineProblems = checkTimeline(timeline, manifest);
    if (timelineProblems.length) {
      throw new UiError(() => t("errors.timeline", { problems: problemsText(i18n, "timeline", timelineProblems) }));
    }
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
      reloadVideo,
      onChange: onPlayerChange,
    });
    watchdog = watchVideo({
      video: el.video,
      player,
      transport,
      fps: manifest.video.fps,
      videoDuration,
      onStuck: () => onPlayerChange("hold"),
    });
    el.roll.closest("figure").hidden = false;
    roll = createPianoRoll({
      canvas: el.roll,
      timeline,
      stems: manifest.audio.stems,
      labelOf: (s) => stemLabel(i18n, s),
      describe: describeRoll,
      onSeek: (pos) => player.jump(pos),
    });
    regions = createRegionCharts({
      picker: el.regionPicker,
      container: el.charts,
      timeline,
      stems: manifest.audio.stems,
      i18n,
      timeText: time,
      onSeek: (pos) => player.jump(pos),
    });
    for (const s of document.querySelectorAll(".jb-regions, .jb-map")) s.hidden = false;
    Object.assign(window.jukeboxDebug, { manifest, timeline, transport, follower, player, watchdog, roll, regions, ctx, stems, getStates: () => states });

    buildStemRows();
    states = initialStates(manifest.audio.stems.map((s) => s.id));
    applyLanguage();
    el.seek.max = String(manifest.audio.duration_s);
    for (const b of [el.play, el.back, el.fwd, el.seek, el.reset]) b.disabled = false;
    bindTransport();
    requestAnimationFrame(updateReadout);
    say(() => t("status.ready"));
  } catch (err) {
    console.error(err);
    const message = () => (err.describe ? err.describe() : err.message);
    say(() => t("status.error", { message: message() }));
    showNotice(() => t("notice.loadFailed", { message: message() }), "reload");
  }
}

init();
