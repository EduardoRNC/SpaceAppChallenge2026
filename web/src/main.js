import { createEngine } from "./engine/sonify.js";
import { createVideoSync } from "./player/sync.js";
import { createAnnouncer, createVoice, spokenValue } from "./a11y/speech.js";
import { playIntro } from "./a11y/intro.js";
import { SHORTCUTS, bindShortcuts } from "./a11y/keys.js";

// Pistas del jukebox. Añadir una pista = añadir su JSON (ver README, Paso 8).
const TRACKS = [{ id: "temperature", label: "Temperatura global (1880–hoy)", file: "data/temperature.json" }];

const SPEEDS = [
  { value: 2, label: "muy lenta, unos 5 minutos" },
  { value: 1, label: "lenta, unos 2 minutos y medio" },
  { value: 0.41, label: "pausada, alrededor de 1 minuto" },
  { value: 0.1597, label: "original del vídeo, unos 25 segundos" },
];
const EXPLORE_YEAR_SECONDS = 3; // un año en Explorar: 12 meses a 0.25 s
const COMPARE_YEAR_SECONDS = 0.6; // una década en Comparar: unos 6 s
const MODES = ["history", "explore", "compare"];
const MODE_NAMES = { history: "Historia", explore: "Explorar", compare: "Comparar" };
const PLAY_LABELS = {
  history: "Reproducir historia",
  explore: "Escuchar este año",
  compare: "Comparar décadas",
};

const $ = (id) => document.getElementById(id);
const els = {
  track: $("track"),
  title: $("track-title"),
  description: $("track-description"),
  video: $("spiral"),
  credit: $("spiral-credit"),
  year: $("year"),
  value: $("value"),
  explorePanel: $("explore-panel"),
  slider: $("year-slider"),
  play: $("play"),
  status: $("status"),
  log: $("announce-log"),
  shortcuts: $("shortcuts"),
  blind: $("blind-mode"),
  introToggle: $("intro-toggle"),
};

const engine = createEngine();
const announcer = createAnnouncer({ liveRegion: els.status, visibleLog: els.log });
const voice = createVoice(); // voz en inglés, solo para la intro
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let track = null;
let sync = null;
let mode = "history";
let historyStart = 0; // año (índice) desde el que empieza la Historia
let exploreIndex = 0;
let busy = false; // reproduciendo, comparando o en la leyenda
let runId = 0; // cada acción nueva invalida a la anterior
let introActive = false;
let skipIntro = false;

const years = () => engine.years;
const indexOfYear = (y) => Math.max(0, years().findIndex((row) => row.year === y));
const blindMode = () => els.blind.checked;
const formatValue = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} °C`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const formatNumber = (v) =>
  Math.abs(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// --- Interfaz ------------------------------------------------------------------

// Mensajes breves: visibles en pantalla y enviados al lector de pantalla.
const status = (text) => announcer.say(text);

function showYear(index) {
  const row = years()[index];
  if (!row) return;
  els.year.textContent = row.year;
  els.value.textContent = formatValue(row.v);
}

function setBusy(value) {
  busy = value;
  els.play.textContent = value ? "Detener" : PLAY_LABELS[mode];
}

function describeYear(index) {
  const row = years()[index];
  const partial = row.months < 12 ? ` (de enero a ${monthName(row.months)})` : "";
  return `${row.year}${partial}: ${spokenValue(row.v)} respecto a la media de 1951–1980.`;
}

function monthName(n) {
  return new Date(2000, n - 1, 1).toLocaleString("es-ES", { month: "long" });
}

function setMode(newMode, { announce = true } = {}) {
  stopAll();
  mode = newMode;
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  els.explorePanel.hidden = mode !== "explore";
  els.play.textContent = PLAY_LABELS[mode];
  if (mode === "explore") {
    showYear(exploreIndex);
    sync.showYear(exploreIndex);
  }
  if (announce) {
    const hints = {
      history: "Espacio: reproducir. ← →: saltar décadas.",
      explore: "← →: elegir año. Espacio: escucharlo.",
      compare: "Espacio: 1880–1889 frente a 2010–2019.",
    };
    announcer.say(`Modo ${MODE_NAMES[mode]}. ${hints[mode]}`);
  }
}

// --- Acciones -------------------------------------------------------------------

function stopAll() {
  runId++;
  skipIntro = true;
  voice.cancel();
  engine.hush();
  engine.stop();
  sync?.stop();
  setBusy(false);
}

async function startHistory(from, { withIntro = false } = {}) {
  const id = ++runId;
  setBusy(true);
  if (withIntro && els.introToggle.checked) {
    // Intro breve en inglés: qué significa cada capa. El botón permite saltarla.
    introActive = true;
    skipIntro = false;
    els.play.textContent = "Skip intro";
    sync.showYear(0);
    await playIntro({
      engine,
      voice,
      captions: (text) => announcer.say(text),
      isCancelled: () => skipIntro || id !== runId,
    });
    introActive = false;
    voice.cancel();
    engine.hush();
    if (id !== runId) return;
    els.play.textContent = "Detener";
  }
  status(from === 0 ? "Reproduciendo desde 1880." : `Reproduciendo desde ${years()[from].year}.`);
  sync.startAt(from, engine.yearDuration);
  const result = await engine.playRange({ from });
  if (id !== runId) return; // otra acción tomó el control
  setBusy(false);
  if (result === "finished") {
    sync.finish();
    historyStart = 0;
    status("Fin: de 1880 a hoy.");
  } else {
    historyStart = engine.currentIndex;
  }
}

async function playExploreYear() {
  const id = ++runId;
  setBusy(true);
  sync.showYear(exploreIndex);
  announcer.say(describeYear(exploreIndex));
  await engine.playRange({ from: exploreIndex, to: exploreIndex + 1, yearDuration: EXPLORE_YEAR_SECONDS });
  if (id !== runId) return;
  setBusy(false);
}

async function runCompare() {
  const id = ++runId;
  const alive = () => id === runId;
  setBusy(true);
  const decades = [1880, 2010].map((start) => ({
    start,
    from: indexOfYear(start),
    to: indexOfYear(start + 10),
  }));
  const mean = ({ from, to }) =>
    years().slice(from, to).reduce((s, r) => s + r.v, 0) / (to - from);

  for (const d of decades) {
    announcer.say(`${d.start}–${d.start + 9}`);
    await pause(500);
    if (!alive()) return;
    sync.startAt(d.from, COMPARE_YEAR_SECONDS);
    await engine.playRange({ from: d.from, to: d.to, yearDuration: COMPARE_YEAR_SECONDS });
    sync.stop();
    if (!alive()) return;
  }
  const diff = mean(decades[1]) - mean(decades[0]);
  announcer.say(
    `2010–2019 fue ${formatNumber(diff)} °C ${diff >= 0 ? "más cálida" : "más fría"} que 1880–1889.`,
  );
  setBusy(false);
}

function toggle() {
  if (introActive) {
    skipIntro = true; // salta la intro y empieza la música
    return;
  }
  if (busy) {
    stopAll();
    status("Detenido.");
    return;
  }
  if (mode === "history") startHistory(historyStart, { withIntro: historyStart === 0 });
  else if (mode === "explore") playExploreYear();
  else runCompare();
}

function step(dir) {
  const last = years().length - 1;
  if (mode === "explore") {
    if (busy) stopAll();
    exploreIndex = Math.max(0, Math.min(last, exploreIndex + dir));
    els.slider.value = years()[exploreIndex].year;
    onExploreChange();
    return;
  }
  if (mode === "history") {
    const current = busy ? engine.currentIndex : historyStart;
    const decade = Math.floor(years()[current].year / 10) * 10 + dir * 10;
    const target = Math.max(0, Math.min(last, indexOfYear(Math.max(1880, decade))));
    if (busy) {
      startHistory(target);
    } else {
      historyStart = target;
      showYear(target);
      sync.showYear(target);
      announcer.say(`Empezar en ${years()[target].year}.`);
    }
    return;
  }
  announcer.say("En el modo Comparar no hay saltos. Pulsa Espacio para comparar.");
}

function speed(dir) {
  const radios = [...document.querySelectorAll('input[name="speed"]')];
  const i = radios.findIndex((r) => r.checked);
  const next = Math.max(0, Math.min(radios.length - 1, i + dir));
  radios[next].checked = true;
  applySpeed(Number(radios[next].value), { restart: true });
}

function applySpeed(value, { restart = false } = {}) {
  engine.setYearDuration(value);
  const label = SPEEDS.find((s) => s.value === value)?.label ?? "";
  if (restart && busy && mode === "history") startHistory(engine.currentIndex);
  announcer.say(`Velocidad: ${label}.`);
}

function nextMode() {
  setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
}

function help() {
  announcer.say(`Atajos: ${SHORTCUTS.map(([k, d]) => `${k}: ${d}`).join(". ")}.`);
}

function onExploreChange({ fromSlider = false } = {}) {
  exploreIndex = indexOfYear(Number(els.slider.value));
  const row = years()[exploreIndex];
  els.slider.setAttribute("aria-valuetext", `${row.year}: ${formatValue(row.v)}`);
  showYear(exploreIndex);
  sync.showYear(exploreIndex);
  // Con el deslizador, el lector de pantalla ya anuncia su aria-valuetext: no se duplica.
  if (fromSlider) els.log.textContent = describeYear(exploreIndex);
  else announcer.say(describeYear(exploreIndex));
}

// --- Inicio -----------------------------------------------------------------------

async function loadTrack(entry) {
  stopAll();
  const res = await fetch(`${import.meta.env.BASE_URL}${entry.file}`);
  if (!res.ok) throw new Error(`No se pudo cargar la pista (${res.status})`);
  track = await res.json();
  engine.load(track);

  els.title.textContent = track.title;
  els.description.textContent = track.description;
  els.video.src = `${import.meta.env.BASE_URL}${track.video.src}`;
  els.credit.textContent = track.video.credit;
  sync = createVideoSync(els.video, track.video, { reducedMotion });

  const ys = years();
  els.slider.min = ys[0].year;
  els.slider.max = ys[ys.length - 1].year;
  exploreIndex = ys.length - 1;
  els.slider.value = ys[exploreIndex].year;
  els.slider.setAttribute("aria-valuetext", `${ys[exploreIndex].year}: ${formatValue(ys[exploreIndex].v)}`);
  historyStart = 0;
  showYear(0);
}

async function init() {
  for (const t of TRACKS) els.track.add(new Option(t.label, t.id));
  for (const [key, desc] of SHORTCUTS) {
    const dt = document.createElement("dt");
    dt.innerHTML = `<kbd>${key}</kbd>`;
    const dd = document.createElement("dd");
    dd.textContent = desc;
    els.shortcuts.append(dt, dd);
  }

  await loadTrack(TRACKS[0]);

  engine.on("year", ({ year, value, index }) => {
    els.year.textContent = year;
    els.value.textContent = formatValue(value);
    sync.onYear(index);
    // Mientras suena no se anuncia nada: la música manda.
  });

  els.track.addEventListener("change", () =>
    loadTrack(TRACKS.find((t) => t.id === els.track.value)).catch(showError),
  );
  els.play.addEventListener("click", toggle);
  els.slider.addEventListener("input", () => {
    if (busy) stopAll();
    onExploreChange({ fromSlider: true });
  });
  els.blind.addEventListener("change", () => document.body.classList.toggle("blind", blindMode()));

  document.querySelectorAll('input[name="mode"]').forEach((input) =>
    input.addEventListener("change", () => setMode(input.value)),
  );
  document.querySelectorAll('input[name="speed"]').forEach((input) =>
    input.addEventListener("change", () => applySpeed(Number(input.value))),
  );
  document.querySelectorAll('input[name="layer"]').forEach((input) =>
    input.addEventListener("change", () => engine.setLayer(input.value, input.checked)),
  );

  bindShortcuts({ toggle, step, speed, nextMode, help });

  els.play.disabled = false;
  setMode("history", { announce: false });
  status("Listo. Pulsa Espacio para reproducir.");
}

function showError(err) {
  els.status.textContent = `Error: ${err.message}`;
  console.error(err);
}

init().catch(showError);
