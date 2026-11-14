import { createEngine } from "./engine/sonify.js";
import { createVideoSync } from "./player/sync.js";

const $ = (id) => document.getElementById(id);
const els = {
  title: $("track-title"),
  description: $("track-description"),
  year: $("year"),
  value: $("value"),
  play: $("play"),
  status: $("status"),
  video: $("spiral"),
  credit: $("spiral-credit"),
};

const engine = createEngine();

const blindToggle = $("blind-mode");
const blindMode = () => blindToggle.checked;
blindToggle.addEventListener("change", () => {
  document.body.classList.toggle("blind", blindMode());
});

const formatValue = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} °C`;

function setPlayingUI(playing) {
  els.play.textContent = playing ? "Detener" : "Reproducir";
}

async function init() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/temperature.json`);
  if (!res.ok) throw new Error(`No se pudo cargar la pista (${res.status})`);
  const track = await res.json();

  engine.load(track);
  els.title.textContent = track.title;
  els.description.textContent = track.description;

  els.video.src = `${import.meta.env.BASE_URL}${track.video.src}`;
  els.credit.textContent = track.video.credit;
  const sync = createVideoSync(els.video, track.video);

  els.play.disabled = false;
  els.status.textContent = "Listo. Pulsa Reproducir.";

  engine.on("year", ({ year, value, index }) => {
    els.year.textContent = year;
    els.value.textContent = formatValue(value);
    sync.onYear(index);
    // Solo se anuncia cada década: anunciar cada año saturaría al lector de pantalla.
    // En la prueba a ciegas no se anuncia nada, para no dar pistas.
    if (year % 10 === 0 && !blindMode()) els.status.textContent = `Década de ${year}`;
  });

  engine.on("end", () => {
    setPlayingUI(false);
    sync.finish(); // el vídeo termina a velocidad normal: giro al cono 3D
    els.status.textContent = "Fin: de 1880 a hoy.";
  });

  els.play.addEventListener("click", async () => {
    if (engine.playing) {
      engine.stop();
      sync.stop();
      setPlayingUI(false);
      els.status.textContent = "Detenido.";
      return;
    }
    await engine.play();
    sync.start(engine.yearDuration);
    setPlayingUI(true);
    els.status.textContent = "Reproduciendo desde 1880.";
  });

  document.querySelectorAll('input[name="speed"]').forEach((input) =>
    input.addEventListener("change", () => engine.setYearDuration(Number(input.value))),
  );

  document.querySelectorAll('input[name="layer"]').forEach((input) =>
    input.addEventListener("change", () => engine.setLayer(input.value, input.checked)),
  );
}

init().catch((err) => {
  els.status.textContent = `Error: ${err.message}`;
  console.error(err);
});
