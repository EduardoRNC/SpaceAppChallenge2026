// Gráficos de las medidas de una región (franja de latitud) a lo largo del vídeo.
//
// Una gráfica por medida, con su unidad, su advertencia y quién la usa en la música.
// Todas son índices visuales calculados de los píxeles: se rotulan como tales.
// Los textos salen de i18n; relabel() los cambia de idioma sin rehacer los controles.

import { frameIndex, seriesPath, seriesRange } from "./timeline.js";
import { effectKey, formatValue, HARMONY_ID, latitudeText, regionsText, usesOf } from "./mappings.js";
import { dx7Patch, metricText, stemLabel } from "./texts.js";
import { chartKeyTarget } from "./nav.js";

const W = 600;
const H = 80;
const SVG = "http://www.w3.org/2000/svg";

const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** Lista "qué controla cada instrumento": una entrada por pista más los acordes. */
export function renderMappingList(list, stems, metrics, mapping, i18n) {
  const { t } = i18n;
  const entry = (owner, title, detail, color, uses) => {
    const li = document.createElement("li");
    li.style.setProperty("--stem-color", color);
    const head = document.createElement("p");
    head.innerHTML = "<strong></strong> <small></small>";
    head.querySelector("strong").textContent = title;
    head.querySelector("small").textContent = detail;
    const ul = document.createElement("ul");
    for (const u of uses) {
      const item = document.createElement("li");
      item.innerHTML = "<em></em> <span></span>";
      const metric = metrics[u.metric] ? metricText(i18n, u.metric, metrics[u.metric], "label") : u.metric;
      item.querySelector("em").textContent = t("map.use", { metric, regions: regionsText(u, t) });
      item.querySelector("span").textContent = t("map.effect", { effect: i18n.data(effectKey(owner, u.metric), u.metric) });
      ul.append(item);
    }
    li.append(head, ul);
    return li;
  };
  list.replaceChildren(
    entry(HARMONY_ID, t("map.harmony"), t("map.harmonyDetail"), "var(--accent)", mapping.harmony),
    ...stems.map((s) =>
      entry(s.id, stemLabel(i18n, s), t("mixer.dx7", { patch: dx7Patch(s) }), s.color, mapping.tracks[s.id]?.uses ?? []),
    ),
  );
}

/**
 * Cada gráfica es también un control deslizante (role="slider"): con el teclado, las flechas
 * mueven un segundo y Re Pág / Av Pág diez; `timeText(s)` formatea el tiempo en el idioma activo.
 */
export function createRegionCharts({ picker, container, timeline, stems, i18n, timeText = String, onSeek = () => {}, initial = "tropicos" }) {
  const { t } = i18n;
  const { metrics, t: times } = timeline.features;
  const domain = [0, timeline.timing.video_duration_s];
  const clampT = (s) => Math.min(Math.max(s, domain[0]), domain[1]);
  const stemById = Object.fromEntries(stems.map((s) => [s.id, s]));
  const ids = Object.keys(metrics); // en el orden del analizador
  const { mapping } = timeline;
  let region = timeline.regions.some((r) => r.id === initial) ? initial : timeline.regions[0].id;
  let lastIndex = -1;
  let lastT = 0;
  const charts = [];
  const regionNames = [];

  const legend = document.createElement("legend");
  picker.append(legend);
  for (const r of timeline.regions) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    Object.assign(input, { type: "radio", name: "jb-region", value: r.id, checked: r.id === region });
    input.addEventListener("change", () => input.checked && select(r.id));
    const name = document.createElement("span");
    const small = document.createElement("small");
    small.textContent = latitudeText(r);
    label.append(input, name, small);
    picker.append(label);
    regionNames.push([r.id, name]);
  }

  for (const id of ids) {
    const m = metrics[id];
    const fig = document.createElement("figure");
    fig.className = "jb-chart";
    fig.innerHTML = `
      <figcaption>
        <span class="jb-chart-title"><strong></strong> <span class="jb-unit"></span></span>
        <span class="jb-proxy"></span>
      </figcaption>
      <p class="jb-chart-now"></p>
      <p class="jb-chart-uses"></p>
      <p class="jb-chart-caveat"></p>`;
    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "none",
      role: "slider",
      tabindex: 0,
      "aria-valuemin": domain[0],
      "aria-valuemax": domain[1].toFixed(1),
    });
    const zero = svgEl("line", { x1: 0, x2: W, class: "jb-zero" });
    const line = svgEl("path", { class: "jb-series", "vector-effect": "non-scaling-stroke" });
    const head = svgEl("line", { y1: 0, y2: H, class: "jb-head", "vector-effect": "non-scaling-stroke" });
    svg.append(zero, line, head);
    svg.addEventListener("pointerdown", (e) => {
      const box = svg.getBoundingClientRect();
      onSeek(domain[0] + ((e.clientX - box.left) / box.width) * (domain[1] - domain[0]));
    });
    fig.querySelector("figcaption").after(svg);
    const range = document.createElement("p");
    range.className = "jb-chart-range";
    svg.after(range);
    container.append(fig);
    const chart = { id, m, fig, svg, zero, line, head, range, now: fig.querySelector(".jb-chart-now"), uses: fig.querySelector(".jb-chart-uses") };
    svg.addEventListener("focus", () => syncAria(chart));
    svg.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = chartKeyTarget(e.key, clampT(lastT), domain[1]);
      if (target == null) return;
      e.preventDefault();
      onSeek(target);
      update(target);
      syncAria(chart);
    });
    charts.push(chart);
  }

  const label = (c) => metricText(i18n, c.id, c.m, "label");
  const unit = (c) => metricText(i18n, c.id, c.m, "unit");
  const who = (id) => (id === HARMONY_ID ? t("regions.chords") : stemById[id] ? stemLabel(i18n, stemById[id]) : id);

  function usesText(id) {
    const uses = usesOf(mapping, id, region);
    if (!uses.length) return t("regions.unused");
    return uses.map((u) => t("regions.use", { who: who(u.id), effect: i18n.data(effectKey(u.id, u.metric), u.metric) })).join(" ");
  }

  /** Textos que no dependen de la región. */
  function staticTexts() {
    legend.textContent = t("regions.picker");
    for (const [id, name] of regionNames) name.textContent = ` ${t(`regions.names.${id}`)} `;
    for (const c of charts) {
      c.fig.querySelector("strong").textContent = label(c);
      c.fig.querySelector(".jb-unit").textContent = `(${unit(c)})`;
      c.fig.querySelector(".jb-proxy").textContent = t("regions.proxy");
      c.fig.querySelector(".jb-chart-caveat").textContent =
        `${metricText(i18n, c.id, c.m, "derived_from")}. ${metricText(i18n, c.id, c.m, "caveat")}`;
    }
  }

  function select(next) {
    region = next;
    lastIndex = -1;
    const name = t(`regions.names.${region}`);
    for (const c of charts) {
      const values = c.m.by_region[region];
      const r = seriesRange(values);
      c.line.setAttribute("d", r ? seriesPath(times, values, W, H, r, domain) : "");
      const crossesZero = r && r.min < 0 && r.max > 0;
      c.zero.style.display = crossesZero ? "" : "none";
      if (crossesZero) {
        const y = H - ((0 - r.min) / (r.max - r.min)) * H;
        c.zero.setAttribute("y1", y);
        c.zero.setAttribute("y2", y);
      }
      const min = r && formatValue(r.min, i18n);
      const max = r && formatValue(r.max, i18n);
      c.range.textContent = r ? t("regions.range", { min, max, unit: unit(c) }) : t("regions.noData");
      c.svg.setAttribute(
        "aria-label",
        r
          ? t("regions.chartLabel", { metric: label(c), region: name, min, max, unit: unit(c) })
          : t("regions.chartLabelEmpty", { metric: label(c), region: name }),
      );
      const used = usesOf(mapping, c.id, region);
      c.fig.classList.toggle("jb-unused", !used.length);
      c.uses.replaceChildren();
      for (const u of used) {
        const chip = document.createElement("span");
        chip.className = "jb-chip";
        chip.style.setProperty("--stem-color", stemById[u.id]?.color ?? "var(--accent)");
        chip.textContent = who(u.id);
        c.uses.append(chip);
      }
      c.uses.append(document.createTextNode(` ${usesText(c.id)}`));
    }
    update(lastT);
    for (const c of charts) syncAria(c);
  }

  /** Texto del lector de pantalla: tiempo y valor en el instante del cabezal. */
  function syncAria(c) {
    const tv = clampT(lastT);
    const value = formatValue(c.m.by_region[region][frameIndex(tv, timeline.timing)], i18n);
    c.svg.setAttribute("aria-valuenow", tv.toFixed(1));
    c.svg.setAttribute("aria-valuetext", t("regions.valueText", { time: timeText(tv), value, unit: unit(c) }));
  }

  /** Mueve el cabezal al tiempo t del audio (se queda en el último fotograma tras el vídeo). */
  function update(t) {
    lastT = t;
    const tv = clampT(t);
    const x = ((tv - domain[0]) / (domain[1] - domain[0])) * W;
    for (const c of charts) {
      c.head.setAttribute("x1", x);
      c.head.setAttribute("x2", x);
    }
    const i = frameIndex(t, timeline.timing);
    if (i === lastIndex) return;
    lastIndex = i;
    for (const c of charts) c.now.textContent = i18n.t("regions.now", { value: formatValue(c.m.by_region[region][i], i18n), unit: unit(c) });
  }

  staticTexts();
  select(region);

  return {
    get region() {
      return region;
    },
    select,
    update,
    /** Actualiza el texto del lector de pantalla de todas las gráficas. */
    syncAria() {
      for (const c of charts) syncAria(c);
    },
    /** Vuelve a escribir todos los textos en el idioma activo. */
    relabel() {
      staticTexts();
      select(region);
    },
  };
}
