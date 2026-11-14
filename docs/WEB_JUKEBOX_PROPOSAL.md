# Propuesta mínima: interfaz web del video jukebox (ECCO2)

Estado: propuesta, sin implementar. Sin Dexed. Objetivo: una demo funcional y reproducible.

## Qué ve y oye el usuario

```
┌──────────────────────────── Video ECCO2 (sin audio propio) ────────────────────────────┐
│                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
 ▶/⏸  00:23.4 / 01:06.7   fecha del modelo: 2007-08-12          estado: validación ok
┌── Línea temporal (canvas) ────────────────────────────────────────────────────────────┐
│ acordes  Dm9 | Bbmaj7 | Gm7 | ...                                                     │
│ temperatura ▬▬▬▬  ▬▬▬▬                     │ ← cabezal; clic = saltar                 │
│ corrientes   ▬ ▬▬  ▬                       │                                          │
│ remolinos      ·   ·  ·                    │                                          │
│ ecuatorial  ▬ ▬ ▬▬ ▬                       │                                          │
└───────────────────────────────────────────────────────────────────────────────────────┘
┌ Instrumentos ─────────────────────┐ ┌ Regiones: [índice de color ▾] ─────────────────┐
│ ■ Temperatura · STRINGS  [M] [S]  │ │ ártico       ╱╲__╱   0.14                      │
│ ■ Corrientes  · FLUTE    [M] [S]  │ │ norte medio  ╱‾‾╲    0.68                      │
│ ■ Remolinos   · BELLS    [M] [S]  │ │ trópicos     ‾‾‾‾    0.85                      │
│ ■ Ecuatorial  · BASS     [M] [S]  │ │ sur medio    ╲__╱    0.41                      │
└───────────────────────────────────┘ │ antártico    ____    0.11                      │
                                      └────────────────────────────────────────────────┘
┌ ¿Qué es medido y qué es proxy? ───────────────────────────────────────────────────────┐
```

1. **Video sincronizado con la música.** El reloj maestro es el audio (`AudioContext`); el video
   sigue al audio y se corrige si se desvía más de 1.5 frames (50 ms a 30 fps).
2. **Línea temporal con notas MIDI**: un carril por instrumento (altura = nota dentro del carril),
   franja de acordes arriba y cabezal; clic o flechas para saltar.
3. **Cuatro instrumentos diferenciados** por color, carril, nombre y patch DX7 de referencia.
4. **Mute y solo por instrumento**, con botones `aria-pressed` y teclas (1–4 mute, Mayús+1–4 solo).
5. **Características por región**: cinco mini-gráficas (una por franja) de la medida elegida
   (`temp`, `speed`, `vort`, `cover`), con cabezal y valor actual; `null` se dibuja como hueco.
6. **Panel "¿Qué es medido y qué es proxy?"** (texto, no solo color), con lo que dicen los datos:

| Tipo | Qué | Fuente |
|---|---|---|
| Referencia de NASA (no la medimos nosotros) | fecha del modelo de cada frame; barra de color oficial 0–32 °C | `flat_ecco2_dates.txt`, `sst_ecco2_cbar.png` |
| Exacto por construcción | tiempo de video y de cada nota (s), BPM, compases | `timeline.timing`, `notes[].t` |
| **Proxy visual** (ninguno calibrado) | índice de color, movimiento, dirección, turbulencia, cobertura | `features.metrics[*]` (`nature: visual_proxy`, `calibrated: false`) |
| Fiabilidad del proxy en este video | índice de color: sigue las estaciones; dirección media: coherente; variaciones de movimiento y turbulencia: en gran parte ruido de compresión → **textura** | `docs/ECCO2_VALIDATION.md` |

   El valor del índice de color puede acompañarse de "≈ X °C según la paleta", marcado siempre
   como inversión aproximada de la barra, nunca como temperatura medida.

## Arquitectura

- **Página nueva** `web/jukebox.html` + `web/src/jukebox/` dentro de la app Vite existente (no toca
  la Climate Spiral). `vite.config.js` añade la segunda entrada de `build.rollupOptions.input`.
- **Sin dependencias nuevas**: Web Audio API nativa (Tone.js no hace falta para reproducir pistas).
- Módulos:
  - `audio.js`: decodifica 4 pistas, una `AudioBufferSourceNode` + `GainNode` por instrumento,
    arranque simultáneo con `start(when, offset)`; pausa/salto = parar y rearrancar con offset.
  - `mix.js` (puro): ganancias de mute/solo (si hay algún solo, suenan solo los solo).
  - `sync.js` (puro + DOM): `t` del audio → `video.currentTime`; corrige si `|Δ| > 1.5/fps`.
  - `timeline.js`: canvas con carriles, acordes y cabezal; `timeToX`, `noteRect` puros.
  - `features.js`: índice de frame `round(t·fps) − frame_offset`, mini-gráficas, valor actual.
  - `explain.js`: panel de proxies a partir de `features.metrics[*]` (`unit`, `derived_from`,
    `caveat`) y `validation.warnings`.
- Accesibilidad: reutilizar `a11y/speech.js` (anuncios `aria-live`), control completo por teclado,
  `prefers-reduced-motion` (sin animar el cabezal, solo el valor).

## Activos y cómo se generan (reproducible)

Un script `video_jukebox/build_web.py` que, a partir de `out/<nombre>_*`, escribe:

| Archivo | Cómo | Tamaño estimado |
|---|---|---|
| `web/public/media/jukebox/ecco2.mp4` | ffmpeg: 1280×640, H.264 2 pasadas a 1200 kb/s, sin audio, `+faststart`, GOP 30 para saltos | 10.0 MB |
| `web/public/media/jukebox/ecco2_<pista>.m4a` ×4 | stems del preview FM (ver abajo), AAC 128 kbps | 0.8–1.1 MB cada uno |
| `web/public/data/jukebox/ecco2_timeline.json` | `timeline.json` minificado | 553 KB (137 KB con gzip) |
| `web/public/data/jukebox/ecco2.json` | manifiesto: rutas, créditos NASA, colores, instrumentos y fechas del modelo | 4 KB |

Implementado (pasos 1–3 del plan); detalles y comandos en
[`video_jukebox/README.md`](../video_jukebox/README.md#activos-para-la-web-build_webpy). Con CRF el
video pesaba 27–47 MB, por eso se codifica a tasa fija. Los stems van a 128 kbps; la campana
(`remolinos`, espectro FM denso) queda con SNR 13 dB frente al WAV y no mejora mucho a 192 kbps
(14.9 dB): falta una escucha atenta para decidir si es audible.

**Mute/solo necesita pistas separadas**: el `preview.wav` actual es una mezcla. Propuesta mínima:
`render_preview.py --stems` renderiza cada canal por separado con **la misma ganancia de
normalización** que la mezcla (calculada una vez), sin cambiar el compositor ni el sonido de la
mezcla. Test: la suma de stems ≈ mezcla antes de la saturación final y misma duración.

## Tests y criterios de aceptación

- `node --test`: ganancias mute/solo, índice de frame por tiempo, `timeToX`, decisión de corrección
  de sincronía, lectura del panel de proxies desde un timeline sintético.
- `pytest`: stems (duración, suma ≈ mezcla) y `build_web.py` con datos sintéticos.
- Manual: `npm run dev` → `jukebox.html`; reproducir, saltar, pausar; desvío video-audio < 2 frames
  (indicador de depuración); mute/solo de cada instrumento; teclado y lector de pantalla.

## Plan en pasos pequeños

1. `render_preview.py --stems` + tests. **Hecho.**
2. `build_web.py` + activos generados. **Hecho.**
3. `jukebox.html` con video, audio por stems, mute/solo y sincronía. **Hecho** (el audio manda;
   el video lo sigue ajustando su velocidad ±1–10 % y solo salta si se desvía más de 0.3 s).
4. Línea temporal de notas. **Hecho:** piano roll de 10 s con cuatro carriles, acordes por compás y
   cabezal en la posición del audio; pulsar salta a ese momento (`web/src/jukebox/pianoroll.js`).
5. Paneles de regiones y de proxies. **Hecho:** selector de franja, una gráfica por medida con su
   unidad, la etiqueta "proxy visual · sin calibrar", su advertencia y qué pista la usa; lista de qué
   controla cada instrumento (`regions.js`, `mappings.js`, que resume `compose.py`).
6. Documentación y comprobación manual.

## Decisiones tomadas

- Audio: stems del preview FM (`render_preview.py --stems`), no síntesis en el navegador.
- Los activos web finales se versionan en git para publicar en GitHub Pages: solo el video
  optimizado, los cuatro stems comprimidos, `timeline.json` y el manifiesto. Nunca videos
  originales, `.npz`, WAV sin comprimir ni figuras de diagnóstico. `build_web.py` los regenera.
- Las rutas deben funcionar con el `base: "./"` de GitHub Pages, y la página mantiene la
  atribución a NASA/GSFC SVS y a ECCO2.
