# Validación del video jukebox con el video real ECCO2 (SVS 3912)

Fecha: 2026-11-15. Rama: `feature/miu-timeline`.

> **Registro histórico.** Esta validación se hizo antes de la limpieza del repositorio. Algunos
> scripts que cita (`run.sh`, `fetch_ecco2.py`, `flow_experiment.py`, `compare_lossless.py`,
> `compare_stems.py`) ya no están en la rama; siguen en la historia de git (commit `142f279`).
> Hoy: `python jukebox.py fetch ecco2` baja el video, las fechas y la barra de color, y
> `python jukebox.py build ecco2` hace todo el pipeline. `analyze.py` es ahora el analizador
> `ocean_flow` (`analyzers/ocean_flow.py`), con exactamente los mismos cálculos.

Todo lo que mide `analyze.py` son **índices visuales derivados de píxeles**, no mediciones
científicas calibradas. Este documento comprueba hasta qué punto esos índices siguen lo que
muestra la visualización y dónde se contaminan.

**Resumen**

| Medida | Veredicto en este video |
|---|---|
| `temp` (índice de color) | Fiable como proxy: sigue el ciclo estacional de cada hemisferio |
| `cover` | Fiable; baja en los polos (~5 %) |
| `u`, `v` (signo medio) | La dirección media es coherente (trópicos hacia el oeste el 100 % del tiempo) |
| `speed`, `vort` y las variaciones de `u` | Dominados por el ruido de compresión H.264; no se ha demostrado señal recuperable |
| Textos y leyendas | Ninguno en `ecco2_sst_flow.mp4`; la versión con barra de color sí contamina la región antártica |
| Sincronía música-video | Exacta a 30 fps y 90 BPM; el compositor ahora fija el tempo a frames enteros |

## 1. Fuente, licencia y procedencia

| | |
|---|---|
| Página | [NASA SVS 3912 — Global Sea Surface Currents and Temperature](https://svs.gsfc.nasa.gov/3912/), publicada el 2012-03-16 |
| Crédito | NASA/Goddard Space Flight Center Scientific Visualization Studio. Animadores: Greg Shirah, Horace Mitchell (NASA/GSFC), Eric Sokolowsky (GST). Ciencia: Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL) |
| Datos | Modelo ECCO2 (MIT/JPL, MITgcm), corrientes superficiales coloreadas por temperatura del mar, 2007-03-25T12:00Z → 2008-03-03T12:00Z |
| Licencia | El [SVS](https://svs.gsfc.nasa.gov/help/) indica que su contenido es de dominio público salvo indicación contraria (la página no indica otra cosa ni lleva audio). Las [guías de NASA](https://www.nasa.gov/multimedia/guidelines/index.html) piden acreditar a NASA y no sugerir respaldo |

`python video_jukebox/fetch_ecco2.py [--control]` descarga a `data/media/ecco2/` (no se sube a git):

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `ecco2_sst_flow.mp4` (versión analizada, sin textos ni barra) | 256 266 335 | `eede4b8230e37e2241ae8459a83c5ce21f824e1dacc3ea692d7dbcec35c42851` |
| `flat_ecco2_dates.txt` (fecha del modelo por frame) | 50 025 | `2911a0e01ba21542462283276636f834511527ac45b9e5df76226acc03f743fb` |
| `sst_ecco2_cbar.png` (barra oficial: azul 0 °C … rojo 32 °C) | 8 867 | `7c4c25f9ca51bb458c100ca4d31f452b8dfdbce8898e2945b7042729d55404c5` |
| `flat_global_ecco2_2028x1024_comp_p30.mp4` (control: con barra de color) | 292 128 033 | `73f7b27bf585d8b534310b384f19080ab2b36d6172ba9e11cab0719c5268ea34` |

## 2. Metadatos (ffprobe)

`ecco2_sst_flow.mp4`: H.264 Main, 2048×1024 (2:1, equirectangular), yuv420p, **30/1 fps constante**,
66.700 s, **2001 frames** decodificados (`-count_frames`), sin pista de audio. OpenCV lee lo mismo
(30.0 fps, 2001 frames). Las 2001 líneas de `flat_ecco2_dates.txt` coinciden con los 2001 frames:
1 frame ≈ 4 h 07 min de modelo, 1 s de video ≈ 5.2 días.

GOP: un fotograma clave (I) cada 24 frames (84 en total), con 1000 P y 917 B.

## 3. Cómo reproducir (incluidas las figuras)

Las figuras se generan en `video_jukebox/out/ecco2/` (ignorado por git).

```bash
cd video_jukebox
export PATH="../.venv/bin:$PATH" MPLCONFIGDIR=/tmp/mpl
python fetch_ecco2.py --control                       # ~3 min, ~550 MB
M=../data/media/ecco2
mkdir -p out/ecco2

ffprobe -v error -count_frames -show_entries stream=width,height,r_frame_rate,nb_read_frames,duration \
    -of json $M/ecco2_sst_flow.mp4 > out/ecco2/ffprobe.json

# segmento corto primero (sin recodificar: mismos píxeles que el original)
ffmpeg -v error -y -i $M/ecco2_sst_flow.mp4 -t 20 -c copy out/ecco2/ecco2_20s.mp4
./run.sh out/ecco2/ecco2_20s.mp4 ecco2_20s            # ~11 s
./run.sh $M/ecco2_sst_flow.mp4 ecco2_full             # ~35 s

# figuras
python diagnostics.py out/ecco2_full_timeline.json out/ecco2/full_diag \
    --dates $M/flat_ecco2_dates.txt --colorbar $M/sst_ecco2_cbar.png
    # -> out/ecco2/full_diag.png (proxies por región + piano-roll), full_diag_colormap.png
python mask_check.py $M/ecco2_sst_flow.mp4 out/ecco2/clean                         # -> clean_mask.png
python mask_check.py $M/flat_global_ecco2_2028x1024_comp_p30.mp4 out/ecco2/control # -> control_mask.png
python flow_experiment.py $M/ecco2_sst_flow.mp4 --features out/ecco2_full_features.npz \
    --plot out/ecco2/flow_experiment.png                                           # ~55 s
```

Salidas del video completo: `ecco2_full_features.npz` (2000×5), `.mid` (381 notas, 25 compases),
`_events.json`, `_timeline.json` (553 KB, estado `ok`, sin avisos), `_preview.wav` y `_preview.mp4`.

## 4. Índice de color (`temp`): sigue las estaciones

| Región | Media [mín, máx] | Cobertura media |
|---|---|---|
| ártico | 0.144 [0.110, 0.209] | 0.059 |
| norte medio | 0.600 [0.499, 0.710] | 0.251 |
| trópicos | 0.854 [0.839, 0.881] | 0.556 |
| sur medio | 0.448 [0.384, 0.524] | 0.511 |
| antártico | 0.115 [0.089, 0.178] | 0.050 |

Con media móvil de 2 s, el índice de la franja norte media tiene su máximo el **2007-09-04** y su
mínimo el **2008-02-27**; la sur media, máximo el **2008-02-09** y mínimo el **2007-08-24**. Es el
ciclo estacional esperado en cada hemisferio, y el director armónico lo convierte en
Dm9 (marzo) → Cmaj7/Gadd9 (agosto-septiembre) → Dm9 (febrero).

Frente a la barra oficial (`full_diag_colormap.png`), el índice es monótono y se aparta como mucho
0.086 de una relación lineal con 0–32 °C (0.25 ≈ 6 °C, 0.50 ≈ 16 °C, 0.75 ≈ 24 °C, 0.90 ≈ 29 °C).
Es una **inversión aproximada de la paleta**, útil para describir el sonido ("más agudo = más
cálido en la paleta"), pero no una temperatura medida: mezcla líneas brillantes y tenues, ignora
el fondo oscuro y promedia píxeles sin ponderar por área.

La música es **relativa al clip**: `compose.py` normaliza con percentiles del propio clip. El
segmento de 20 s (marzo-julio) recorre toda la escalera de acordes, igual que el año completo.
El mismo acorde no significa la misma temperatura en clips distintos.

## 5. Movimiento y turbulencia: ruido de compresión

### Diagnóstico con el método actual (`analyze.py`, 512 px, frames consecutivos)

- Valores diminutos: 0.018–0.038 px/frame de media. Es esperable: 1 px ≈ 78 km en el ecuador y
  1 frame ≈ 4 h, así que una corriente de 0.1–1 m/s se mueve 0.02–0.2 px/frame.
- En las filas cuyo frame final es un fotograma clave, el movimiento es **2.3–2.9 veces** mayor
  que en el resto, y el **74–83 %** de los picos (> percentil 95) caen en una transición de
  fotograma clave, aunque son ~8 % de las filas.
- Autocorrelación a 1 frame de −0.61 (media de regiones) y periodo dominante de 2 frames: la
  alternancia B/P del códec.
- Solo el **0.2–4 %** de la varianza de `speed` y `vort` está en escalas mayores de 2 s.

Componentes con signo frente a magnitudes (2000 filas):

| Medida | Varianza en escalas > 2 s | Signo de la media móvil de 2 s |
|---|---|---|
| `speed`, `vort` (magnitudes, siempre ≥ 0) | 0.2–4 % | — |
| `u` trópicos | 2.1 % | hacia el oeste el **100 %** del tiempo (media −0.0174 px/frame) |
| `u`, `v` otras regiones | 3.8–15 % | estable el 69–100 % del tiempo |

El ruido del códec suma siempre en positivo en una magnitud, pero se cancela al promediar
componentes con signo. Por eso la **dirección media** es fiable (las corrientes ecuatoriales
superficiales van mayoritariamente al oeste) y las **variaciones** no.

### Experimento: comparación de métodos (`flow_experiment.py`)

Mismos parámetros Farneback y máscara; la variante `s1` reproduce exactamente `features.npz`.
`ratio_I` = movimiento medio en pares que tocan un fotograma clave / resto.

| Variante | autocorr. 1 frame | rugosidad | ratio_I | speed media | filas válidas |
|---|---|---|---|---|---|
| `s1` frames consecutivos (actual) | −0.61 | 1.80 | 1.56 | 0.0258 | 100 % |
| `s1-gop` sin pares con fotograma clave | −0.83 | 1.93 | 1.56 | 0.0246 | 92 % |
| `s6` flujo entre frames separados 6 (÷6) | 0.28 | 1.20 | 1.08 | 0.0162 | 100 % |
| `s6-gop` | 0.73 | 0.71 | 1.08 | 0.0158 | 71 % |
| *control:* `s1` + media móvil de 6 frames | 0.28 | 1.20 | 1.07 | 0.0258 | 100 % |
| *control:* `s1` + media móvil 6 sin fotogramas clave | 0.74 | 0.69 | — | — | 71 % |
| *referencia:* ruido blanco + media móvil 6 | 0.83 | 0.58 | — | — | — |

Speed media por región (px/frame):

| Variante | ártico | norte medio | trópicos | sur medio | antártico |
|---|---|---|---|---|---|
| `s1` | 0.0377 | 0.0182 | 0.0284 | 0.0188 | 0.0258 |
| `s6` | 0.0211 | 0.0111 | 0.0224 | 0.0116 | 0.0147 |

Conclusiones:

1. **Quitar solo los fotogramas clave no ayuda**: el ruido dominante es la alternancia B/P.
2. **La mejora temporal de `s6` se explica por el suavizado**: una media móvil de 6 frames sobre
   el método actual da las mismas métricas, y el ruido blanco suavizado aún sale "más suave".
   Estas métricas no prueban que se recupere señal.
3. **Lo que sí cambia `s6` es el nivel**: reduce la media un 37 %, sobre todo en los polos
   (ártico −44 %, trópicos −21 %), y los trópicos pasan a ser la región más rápida. Los frames TIFF
   sin compresión muestran la misma caída (0.0271 → 0.0163), así que no es un sesgo del códec sino
   vibración frame a frame de la animación o del estimador.
4. Comparación con los frames TIFF originales sin compresión (`compare_lossless.py`, frames
   960–1056): a paso 1 la variación del MP4 es casi toda artefacto (su serie de speed correlaciona
   0.04–0.19 con la del TIFF; picos en fotogramas clave 1.60 frente a 1.00); a paso 6 el TIFF tiene
   estructura temporal (autocorrelación 0.58) y el MP4 la recupera en parte (0.35–0.48 en speed,
   0.45–0.92 en u). La dirección media coincide en ambas fuentes y el índice de color difiere como
   mucho 0.033.

## 6. Contaminación por textos, leyendas y máscaras

`mask_check.py` busca píxeles que estén siempre en la máscara y casi no cambien de brillo
(figuras `clean_mask.png` y `control_mask.png`).

| Video | Píxeles estáticos | Efecto |
|---|---|---|
| `ecco2_sst_flow.mp4` (limpio) | 0 en las 5 regiones | sin textos, fecha ni leyendas |
| `…comp_p30.mp4` (control con barra) | 1 grupo, x 11–81 · y 239–250 (lat −78…−86) | **49.7 %** de la máscara antártica; índice 0.537 frente a 0.109 → el índice antártico pasaría de ~0.11 a ~0.32 |

Otros sesgos del video limpio:

- **Borde polar norte.** El 47.5 % de los píxeles válidos del ártico está por encima de 84° N, una
  franja de 2-3 filas que el mapa equirectangular estira a todo el ancho. Su movimiento medio
  (0.053 px/frame) duplica el del resto del ártico (0.027).
- **Sin ponderación por área.** Todas las medias son por píxel; en equirectangular las latitudes
  altas pesan más de lo que corresponde a su superficie.
- **Cobertura baja en los polos** (ártico 5.9 %, antártico 5.0 %). Ningún frame quedó sin dato
  (`MIN_PIXELS` = 50).
- La tierra gris queda bien excluida por la máscara de saturación.

## 7. Tiempo de la música frente al tiempo del video

Con el FPS real (30) y el BPM por defecto (90): 20 frames por beat **exactos**, 100 beats, 25
compases, 66.667 s de música para 66.700 s de video. Deriva **0**; no sobra ningún frame. En
`ecco2_full_preview.mp4` ambas pistas empiezan en 0; el audio dura 66.687 s y el video 66.700 s.

Deriva que tenía `compose.py` antes de esta iteración (2000 filas a 30 fps):

| BPM | frames/beat (exacto) | deriva al final | s por minuto | frames/beat impar |
|---|---|---|---|---|
| 60, 72, 75, **90**, 100, 120 | entero | 0 | 0 | 72 y 120 sí |
| 80 | 22 (22.5) | −1.500 s | −1.33 | |
| 110 | 16 (16.36) | −1.515 s | −1.33 | |
| 128 | 14 (14.06) | −0.296 s | −0.27 | |
| 140 | 13 (12.86) | +0.729 s | +0.67 | sí |

A 90 BPM con otros FPS: 29.97 → +0.06 s/min; 25 → +1.2 s/min; 24 y 60 → 0.

**Cambio aplicado en `compose.py`:**
- El tempo se ajusta a un número entero de frames por beat: `bpm = 60 · fps / round(fps · 60 / bpm)`
  (80 → 81.82, 110 → 112.5; 90 a 30 fps no cambia). `meta` guarda `bpm` (el usado) y
  `bpm_requested`. Deriva 0 a cualquier FPS.
- El bajo no emite notas después del final cuando el último compás está incompleto.
- Verificado: con `ecco2_full_features.npz` el MIDI es **idéntico byte a byte** al anterior; en el
  segmento de 20 s solo desaparecen las 4 notas del bajo que sonaban entre 20.0 y 21.3 s.

Desfases que siguen existiendo (por diseño):

| Fuente | Magnitud |
|---|---|
| Fila i de features = frame i+1 (el flujo necesita dos frames) | 1 frame = 33 ms |
| Cada nota resume el beat que **empieza** con ella (`per_beat`) | la nota anticipa lo que representa entre 0.03 y 0.67 s (0.35 s de media) |
| Campanas con frames/beat impar (p. ej. 25 fps a 90 BPM → 17) | corcheas de 8 frames frente a 8.5; `export_timeline.py` lo avisa |

## 8. Pendiente y propuestas (no implementadas)

1. **Flujo a escala de la música:** la comparación con TIFF (punto 5) cubre solo 3.2 s. Para
   validar la escala que usa la música (suavizado de 1 s, beats de 20 frames) hace falta un tramo
   TIFF ≥ 20 s (≥ 600 frames, ~3.8 GB) antes de pasar `analyze.py` a flujo con paso 6.
2. Mientras tanto, en la demo, presentar las voces `corrientes` y `remolinos` como textura
   (no como dato fiel) o bajar su peso; el bajo puede seguir la dirección media de `u` en trópicos.
3. Ponderar por `cos(latitud)` y excluir |lat| > 84°.
4. Escucha crítica del preview con el video (sincronía percibida).

Las conclusiones valen para esta visualización. Otros videos del SVS pueden tener otro FPS, GOP,
paleta o superposiciones: `mask_check.py` y los avisos de `export_timeline.py` ayudan a detectarlo.
