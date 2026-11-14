// Gráficos de las medidas de una región (franja de latitud) a lo largo del vídeo.
//
// Una gráfica por medida, con su unidad, su advertencia y quién la usa en la música.
// Todas son índices visuales calculados de los píxeles: se rotulan como tales.

import { frameIndex, seriesPath, seriesRange } from "./timeline.js";
import { formatValue, HARMONY, latitudeText, METRIC_ORDER, REGION_LABELS, regionsText, TRACK_MAPPINGS, usesOf } from "./mappings.js";

const W = 600;
const H = 80;
const SVG = "http://www.w3.org/2000/svg";

const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** Lista "qué controla cada instrumento": una entrada por pista más los acordes. */
export function renderMappingList(list, stems, metrics) {
  const entry = (title, detail, color, uses) => {
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
      item.querySelector("em").textContent = `${metrics[u.metric]?.label ?? u.metric} (${regionsText(u)}):`;
      item.querySelector("span").textContent = `${u.effect}.`;
      ul.append(item);
    }
    li.append(head, ul);
    return li;
  };
  list.replaceChildren(
    entry(HARMONY.label, "el director armónico", "var(--accent)", HARMONY.uses),
    ...stems.map((s) => entry(s.label, `Referencia DX7: ${s.instrument.split(" - ").pop()}`, s.color, TRACK_MAPPINGS[s.id] ?? [])),
  );
}

export function createRegionCharts({ picker, container, timeline, stems, onSeek = () => {}, initial = "tropicos" }) {
  const { metrics, t: times } = timeline.features;
  const domain = [0, timeline.timing.video_duration_s];
  const stemById = Object.fromEntries(stems.map((s) => [s.id, s]));
  const ids = METRIC_ORDER.filter((m) => metrics[m]);
  let region = timeline.regions.some((r) => r.id === initial) ? initial : timeline.regions[0].id;
  let lastIndex = -1;
  const charts = [];

  for (const r of timeline.regions) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    Object.assign(input, { type: "radio", name: "jb-region", value: r.id, checked: r.id === region });
    input.addEventListener("change", () => input.checked && select(r.id));
    label.append(input, ` ${REGION_LABELS[r.id] ?? r.id} `);
    const small = document.createElement("small");
    small.textContent = latitudeText(r);
    label.append(small);
    picker.append(label);
  }

  for (const id of ids) {
    const m = metrics[id];
    const fig = document.createElement("figure");
    fig.className = "jb-chart";
    fig.innerHTML = `
      <figcaption>
        <span class="jb-chart-title"><strong></strong> <span class="jb-unit"></span></span>
        <span class="jb-proxy">Proxy visual · sin calibrar</span>
      </figcaption>
      <p class="jb-chart-now"></p>
      <p class="jb-chart-uses"></p>
      <p class="jb-chart-caveat"></p>`;
    fig.querySelector("strong").textContent = m.label;
    fig.querySelector(".jb-unit").textContent = `(${m.unit})`;
    fig.querySelector(".jb-chart-caveat").textContent = `${m.derived_from}. ${m.caveat}`;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img" });
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
    charts.push({ id, m, fig, svg, zero, line, head, range, now: fig.querySelector(".jb-chart-now"), uses: fig.querySelector(".jb-chart-uses") });
  }

  function usesText(id) {
    const uses = usesOf(id, region);
    if (!uses.length) return "No controla ningún instrumento: se muestra como contexto.";
    return uses.map((u) => `${u.id === HARMONY.id ? "Acordes" : stemById[u.id]?.label ?? u.id}: ${u.effect}.`).join(" ");
  }

  function select(next) {
    region = next;
    lastIndex = -1;
    const name = REGION_LABELS[region] ?? region;
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
      c.range.textContent = r ? `mín. ${formatValue(r.min)} · máx. ${formatValue(r.max)} ${c.m.unit}` : "sin datos";
      c.svg.setAttribute(
        "aria-label",
        `${c.m.label} en ${name} a lo largo del vídeo${r ? `: entre ${formatValue(r.min)} y ${formatValue(r.max)} (${c.m.unit})` : ""}. Índice visual, no medición calibrada.`,
      );
      const used = usesOf(c.id, region);
      c.fig.classList.toggle("jb-unused", !used.length);
      c.uses.replaceChildren();
      for (const u of used) {
        const chip = document.createElement("span");
        chip.className = "jb-chip";
        chip.style.setProperty("--stem-color", stemById[u.id]?.color ?? "var(--accent)");
        chip.textContent = u.id === HARMONY.id ? "Acordes" : stemById[u.id]?.label ?? u.id;
        c.uses.append(chip);
      }
      c.uses.append(document.createTextNode(` ${usesText(c.id)}`));
    }
  }

  select(region);

  return {
    get region() {
      return region;
    },
    select,
    /** Mueve el cabezal al tiempo t del audio (se queda en el último fotograma tras el vídeo). */
    update(t) {
      const tv = Math.min(Math.max(t, domain[0]), domain[1]);
      const x = ((tv - domain[0]) / (domain[1] - domain[0])) * W;
      for (const c of charts) {
        c.head.setAttribute("x1", x);
        c.head.setAttribute("x2", x);
      }
      const i = frameIndex(t, timeline.timing);
      if (i === lastIndex) return;
      lastIndex = i;
      for (const c of charts) c.now.textContent = `Ahora: ${formatValue(c.m.by_region[region][i])} ${c.m.unit}`;
    },
  };
}
