# Video Jukebox: de un video de NASA a música

Convierte un video de mapa (equirectangular, como los del SVS / Earth Information Center)
en un MIDI de 4 pistas para el Yamaha DX7 (Dexed), más un preview para escucharlo ya.

Ejemplo de referencia: `ecco2_sst_flow.mp4` (corrientes + temperatura del mar, SVS 3912).

## Instalar y correr

```bash
# desde la raíz del repo (Python 3.10+; ffmpeg en el sistema)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r video_jukebox/requirements.txt
cd video_jukebox
PATH="../.venv/bin:$PATH" ./run.sh ecco2_sst_flow.mp4 oceano     # ~1-2 min
```

Salida en `out/` (no se sube a git):

| Archivo | Para qué |
|---|---|
| `oceano_features.npz` | características por frame y franja (paso 1) |
| `oceano.mid` | abrir en un DAW (Reaper, LMMS, Ardour) con una instancia de Dexed por pista |
| `oceano_events.json` | notas en beats, tal como las generó el compositor (para el preview) |
| `oceano_timeline.json` | características + notas en segundos, validadas, **para la interfaz web** |
| `oceano_preview.wav` | audio del sintetizador FM sencillo (no es Dexed, solo para comprobar) |
| `oceano_preview.mp4` | el video con ese audio |

O paso a paso:
```bash
python analyze.py video.mp4 features.npz
python compose.py features.npz salida.mid --events events.json
python export_timeline.py features.npz events.json timeline.json --source video.mp4
python render_preview.py events.json preview.wav
```

### Probar sin video de NASA

```bash
python tests/synthetic.py /tmp/sintetico.avi --seconds 8   # mapa falso con líneas de color
PATH="../.venv/bin:$PATH" ./run.sh /tmp/sintetico.avi sintetico
cd .. && .venv/bin/pytest                                  # tests de datos + jukebox
```

Los tests (`tests/test_export_timeline.py`) usan solo datos sintéticos: características generadas
y un video MJPG pequeño creado al vuelo. Comprueban que el timeline tiene 5 regiones y 4 canales,
que el tiempo de cada nota es `beat × 60 / BPM` y coincide con los ticks del MIDI escrito, y que la
validación rechaza dimensiones, FPS o pares features/events incoherentes.

### Validar con el video real ECCO2 (SVS 3912)

```bash
python fetch_ecco2.py [--control]      # video oficial + fechas + barra de color -> data/media/ecco2/
python diagnostics.py out/x_timeline.json out/x_diag --dates ../data/media/ecco2/flat_ecco2_dates.txt \
    --colorbar ../data/media/ecco2/sst_ecco2_cbar.png       # gráficos por región + piano-roll
python mask_check.py video.mp4 out/x    # qué entra en la máscara; detecta textos/leyendas estáticos
python flow_experiment.py video.mp4 --plot out/x_flow.png   # flujo óptico: señal frente a ruido del códec
```

Resultados, procedencia, licencia, comandos completos y limitaciones:
[`docs/ECCO2_VALIDATION.md`](../docs/ECCO2_VALIDATION.md). Resumen: el índice de color sigue las
estaciones; las variaciones de movimiento y turbulencia están dominadas por el ruido de compresión
del video (la dirección media sí es coherente); la música no se desfasa del video.

## Cómo funciona (4 pasos)

```
video.mp4 ──► analyze.py ──► features.npz ──► compose.py ──► salida.mid ──► Dexed
              (QUÉ pasa)     (números por       (CÓMO suena)  events.json ──► render_preview.py (preview)
                              frame y franja)        │              │
                                    └────────────────┴──► export_timeline.py ──► timeline.json (web)
```

### 1. `analyze.py`: qué pasa en el video
Divide el mapa en 5 franjas de latitud (ártico, norte medio, trópicos, sur medio, antártico).
En cada frame y en cada franja mide:

| Medida | Cómo | Qué es (proxy visual) |
|---|---|---|
| `temp` | tono del píxel (azul=0 … rojo=1) | posición en la paleta de color; sugiere temperatura, **no son °C** |
| `speed` | flujo óptico (OpenCV Farneback), px/frame | movimiento aparente de las líneas, **no m/s** |
| `u`, `v` | componentes del flujo, px/frame | dirección aparente (este/oeste, norte/sur) |
| `vort` | rotacional del flujo | remolinos aparentes en la imagen, no vorticidad física |
| `cover` | % de píxeles válidos | cuántos píxeles coloreados hay en la franja (no es % de océano real) |

La tierra (gris) y el fondo oscuro se ignoran con una máscara de saturación/brillo.
Todas son medidas **derivadas de píxeles**: dependen de la paleta, la compresión, la resolución
de análisis (`--width`) y la velocidad de la animación. Sirven para que la música siga lo que se ve,
no como datos científicos calibrados. Si una franja tiene menos de `MIN_PIXELS` (50) píxeles válidos
sus medidas quedan a 0; `band_pixels` (píxeles por franja) permite distinguir ese caso de un 0 real.

### 2. `compose.py`: cómo suena
- **Director armónico:** el contraste térmico norte−sur (las estaciones) elige los acordes,
  oscuros en invierno boreal y brillantes en verano. Todas las voces tocan SOLO notas del acorde
  vigente: la armonía queda garantizada aunque los datos sean caóticos.
- **Tempo:** 90 BPM → 1 tiempo = 20 frames a 30 fps. Los datos se suavizan (mediana + media de 1 s)
  y se promedian por tiempo. Si `fps × 60 / bpm` no es entero, el tempo se ajusta al número entero
  de frames por beat más cercano (p. ej. 25 fps y 90 BPM → 17 frames → 88.24 BPM) para que la música
  no se desfase del video; `events.json` guarda `bpm` (el usado) y `bpm_requested`.

| Canal | Instrumento DX7 | Datos |
|---|---|---|
| 1 | STRINGS 1 | acordes por compás; volumen = temperatura global |
| 2 | FLUTE 1 | una voz por franja (norte = agudo); suena si la corriente acelera; la temperatura de la franja mueve la nota; la turbulencia controla el timbre (CC1) |
| 3 | TUB BELLS | campanada en cada pico de vorticidad (remolino) |
| 4 | BASS 1 | raíz del acorde; más notas cuanto más fuerte va la corriente ecuatorial al oeste |

Todo lo que se puede ajustar está en el bloque **CONFIGURACIÓN** al principio de `compose.py`
(tempo, acordes, instrumentos, registro de cada franja).

### 3. `render_preview.py`: escuchar sin Dexed
Sintetizador FM de 2 operadores (el principio del DX7) + reverb. Solo para comprobar el mapeo.

```bash
python render_preview.py events.json preview.wav --stems out/stems   # mezcla + 4 pistas
```

Con `--stems DIR` escribe además `DIR/<pista>.wav` (`temperatura`, `corrientes`, `remolinos`,
`ecuatorial`) y `DIR/stems.json` (ganancia, picos y primera nota de cada pista). La mezcla
`preview.wav` es idéntica byte a byte a la de antes. Los stems:

- salen del mismo generador de voces que la mezcla: misma longitud, mismo comienzo (muestra 0)
  y la primera nota de cada pista cae en la misma muestra que en la mezcla;
- son lineales (sin la saturación `tanh` de la mezcla) y comparten **una sola ganancia**, elegida
  para que ninguna de las 15 combinaciones de mute/solo pase de −1 dBFS; así se conserva el balance
  entre instrumentos y la suma de los stems es la mezcla antes de saturar.

Tests: `tests/test_render_preview.py`.

## Activos para la web (`build_web.py`)

Prepara la demo `web/jukebox.html` a partir de lo que ya generó `run.sh` (`out/<nombre>_events.json`
y `out/<nombre>_timeline.json`) y del video original:

```bash
cd video_jukebox
python build_web.py --name ecco2_full --video ../data/media/ecco2/ecco2_sst_flow.mp4 \
    --dates ../data/media/ecco2/flat_ecco2_dates.txt          # ~30 s; --skip-video reutiliza el video
python build_web.py --name ecco2_full --check-only            # solo valida lo ya escrito
```

Escribe en `web/public/` (estos archivos **sí** se suben a git, para GitHub Pages):

| Archivo | Cómo | Tamaño (ECCO2) |
|---|---|---|
| `media/jukebox/ecco2.mp4` | H.264 1280×640, 2 pasadas a 1200 kb/s, GOP 30 (saltos rápidos), sin audio, `+faststart` | 10.0 MB |
| `media/jukebox/ecco2_<pista>.m4a` ×4 | stems del preview FM, AAC 128 kb/s | 0.8–1.1 MB cada uno |
| `data/jukebox/ecco2_timeline.json` | el timeline, minificado | 0.55 MB |
| `data/jukebox/ecco2.json` | manifiesto: rutas relativas, duración, colores, instrumentos DX7, fechas del modelo, créditos NASA | 4 KB |

Total 14.7 MB. Los WAV, el `.npz`, los videos originales y las figuras se quedan en `out/` y
`data/media/` (ignorados por git).

Antes de terminar valida y aborta si algo falla: rutas relativas y existentes (funcionan bajo
`https://<usuario>.github.io/SpaceAppChallenge2026/`), FPS, frames y ausencia de audio en el video,
que cada stem decodificado empiece en la misma muestra que el WAV (desfase 0) y no sea más corto que
la música, que ninguna combinación de pistas sature, presupuestos de tamaño y créditos NASA/ECCO2.
Imprime la calidad de cada stem (SNR frente al WAV). Tests: `tests/test_build_web.py` (video
sintético de 6 s).

**Calidad de los stems.** `compare_stems.py` compara cada WAV con su AAC publicado a igual
volumen (por bandas, en el ataque y en la caída de las campanadas) y con `--excerpt 8` escribe
fragmentos A/B en `out/compare/`:

```bash
python compare_stems.py --name ecco2_full --also 192 256 --excerpt 8
```

Con ECCO2 a 128 kb/s: temperatura, corrientes y bajo quedan a 34–40 dB de SNR. La campana
(`remolinos`) queda en 13 dB porque el patch FM (razón 3.5, índice 4) tiene un 5.7 % de su
energía por encima de 16 kHz y el codificador corta en 17.6 kHz; además el error se concentra
en el ataque (9 dB frente a 17 dB en la caída). En las notas más agudas (≥ 88, 25 de 69 campanadas)
parte de ese contenido es aliasing de la propia síntesis (−7 dB en la nota 98). A 256 kb/s no hay
corte y el SNR sube a 34 dB.

Probar la demo:

```bash
cd web && npm ci
npm run dev                         # http://localhost:5173/jukebox.html
npm run build && npx vite preview --base /SpaceAppChallenge2026/   # como en GitHub Pages
```

### 4. `export_timeline.py`: datos para la web
Junta `features.npz` y `events.json` en un JSON con todo en segundos:

| Clave | Contenido |
|---|---|
| `timing` | `fps`, `frames`, `bpm`, `seconds_per_beat`, `frames_per_beat`, `beats`, `bars`, duraciones de video y música |
| `regions` | las 5 franjas con sus latitudes |
| `channels` | los 4 canales (`temperatura`, `corrientes`, `remolinos`, `ecuatorial`) con canal MIDI y programa DX7 |
| `features.t` | tiempo de cada frame: `(fila + 1) / fps` (la fila 0 es el frame 1: el flujo óptico necesita dos frames) |
| `features.metrics` | por medida: `unit`, `derived_from`, `caveat`, `nature: "visual_proxy"`, `calibrated: false` y `by_region` = una serie por franja (`null` = sin dato) |
| `notes` | `t`, `dur` (s), `beat`, `dur_beats`, `channel`, `track`, `note`, `vel`; `t = beat × 60 / bpm`, igual que el MIDI |
| `chords`, `cc` | acorde de cada compás y controladores (CC1 timbre, CC11 expresión), con su `t` |
| `validation` | `status` (`ok` / `warnings`), lista de avisos y resumen numérico |

**Validación.** Aborta (código de salida 1, no escribe nada) si faltan medidas, las formas no son
`(frames, 5)`, las regiones no son las de `analyze.py`, el FPS o el BPM no son válidos, o si
`events.json` no sale de ese `features.npz` (su `fpb`/`nbeats` no cuadran). Avisa, sin abortar, de:
frames sin dato o valores no finitos (se exportan como `null`), cobertura media < 2 %, deriva
música-video, frames por beat impares y notas que empiezan después del final.

**Deriva música-video.** `notes[].t` sigue el reloj del audio y `features.t` el del video. Con el
tempo ajustado de `compose.py` coinciden; el aviso de deriva salta con `events.json` generados por
versiones anteriores (que usaban el BPM nominal: a 25 fps y 90 BPM se desfasaban ~1.2 s por minuto).

## Cómo añadir otro tipo de video (luces, CO2, viento, hielo…)

1. **Copia `analyze_plantilla.py`** (p. ej. `analyze_luces.py`) y cambia solo la función `medir()`.
   Ya trae medidas de ejemplo: `brillo`, `nuevas` (luces que aparecen), `color` y `cambio`.
   - Luces nocturnas → `brillo` y `nuevas`; máscara = todo el mapa
   - CO2 / temperatura en colores → `color`
   - Viento / corrientes → usa directamente `analyze.py` (flujo óptico)
   - Hielo → `brillo` (blanco) o el % de píxeles blancos por franja
2. **Comprueba los números** antes de hacer música: grafica cada medida por franja
   y verifica que tenga sentido (estaciones, regiones). Si no lo tiene, la música tampoco lo tendrá.
3. **En `compose.py`, añade una voz** como las que hay: lee tu medida, normalízala con `norm01()`,
   elige nota con `nearest_chord_tone()` (así respeta la armonía) y añade la pista a `TRACKS`.
   Un instrumento por categoría (luces → campanas, viento → flauta, etc.).
4. Al usar el **mismo director** (tempo y acordes) en todas las categorías, las pistas se pueden
   combinar en un solo MIDI y sonarán juntas.

## Requisitos del video
- Proyección **equirectangular** (mapa rectangular 2:1, norte arriba). Las páginas del SVS
  suelen tener una versión así ("equirectangular" o para Science On a Sphere).
- Mejor **sin textos, fecha ni barra de color** encima. Si los tiene, recórtalos antes o enmascáralos.
