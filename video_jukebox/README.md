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
  y se promedian por tiempo.

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

**Deriva música-video.** `compose.py` redondea `fps × 60 / bpm` a frames enteros por beat. A 30 fps y
90 BPM es exacto (20); a 29.97 fps la música se desfasa ~0.06 s por minuto y a 25 fps ~1.2 s por minuto
(17 frames por beat, además impar). `notes[].t` sigue el reloj del audio; `features.t` el del video.

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
