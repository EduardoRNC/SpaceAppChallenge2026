# Earth Information Jukebox

[English](README.md) · **Español**

Proyecto para el reto **[The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)** del NASA Space Apps Challenge 2026.

Convierte visualizaciones de la Tierra de NASA (videos del NASA Scientific Visualization Studio y
del Earth Information Center) en **cuatro voces de música** que siguen lo que muestra la imagen, y
las reproduce en una página web con el video sincronizado, mute/solo por pista, un piano roll y
gráficas de lo que se mide en cada franja de latitud.

El primer video publicado es el de corrientes y temperatura del océano del modelo ECCO2
([SVS 3912](https://svs.gsfc.nasa.gov/3912/)). El pipeline está hecho para **varios videos**: cada uno
se describe con un archivo pequeño, lo analiza el analizador de su tipo de visualización y aparece
en el selector de videos de la web.

## Cómo funciona

```
video NASA ──► analizador ──► medidas por frame ──► compositor ──► 4 pistas (MIDI + audio FM)
(SVS / EIC)    (por tipo)     y franja de latitud    (armonía          │
                                                       común)          └──► web: video + música
```

1. **Analizador (por tipo de video).** Divide el mapa equirectangular en 5 franjas de latitud
   (ártico, latitudes medias norte, trópicos, latitudes medias sur, antártico) y mide cada franja en
   cada frame:

   | Analizador | Para | Medidas |
   |---|---|---|
   | `ocean_flow` | líneas en movimiento coloreadas azul→rojo (corrientes ECCO2, vientos) | índice de color, movimiento aparente (flujo óptico), dirección, turbulencia |
   | `color_map` | mapas de calor que cambian de color (anomalías de temperatura, SST, CO₂) | índice rojo-azul, índice de tono, fracción en rojo intenso, cambio de la imagen |
   | `night_lights` | la Tierra de noche (Black Marble) | brillo, fracción encendida, luz que aparece |

2. **Compositor.** Un director armónico elige los acordes a partir de los datos (valores bajos →
   acordes oscuros, altos → brillantes) y todas las voces tocan solo notas del acorde vigente, así
   el resultado siempre suena armónico. Cuatro papeles, uno por pista: **pad** (acordes, volumen),
   **voces** (una por franja; norte = agudo, sur = grave), **acentos** (una campana en cada pico) y
   **bajo** (densidad según una franja). La ficha de cada video dice qué medida mueve cada papel.

3. **Página web.** Video y audio sincronizados (el audio es el reloj), con mute/solo, piano roll y
   gráficas por franja, en inglés y español, usable entera con teclado y lector de pantalla.

**Proxies visuales, no mediciones.** Todas las medidas salen de los píxeles del video. No son
temperaturas en °C ni velocidades en m/s, y la página lo dice junto a cada gráfica.

## Cómo correrlo

Requisitos: Python 3.10+, Node 18+ y ffmpeg.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd video_jukebox
../.venv/bin/python jukebox.py fetch ecco2      # baja el video de NASA (~250 MB, no se sube a git)
../.venv/bin/python jukebox.py build ecco2      # lo analiza, compone y publica en web/public
../.venv/bin/python jukebox.py list             # videos registrados y su estado
cd ..
.venv/bin/pytest                                 # tests del pipeline (videos sintéticos, sin descargas)

cd web
npm install
npm run dev      # http://localhost:5173/  (?video=<id>, ?lang=es)
npm test
npm run build    # sitio estático en web/dist (GitHub Pages: docs/DEPLOY_PAGES.md)
```

### Añadir un video nuevo

```bash
cd video_jukebox
python jukebox.py try mi_video.mp4               # qué analizador lo ve mejor
python jukebox.py add black_marble --video mi_video.mp4 --analyzer night_lights \
    --svs 5276 --title-en "Earth at night" --title-es "La Tierra de noche"
python jukebox.py preview black_marble           # escucharlo: out/black_marble/preview.mp4
python jukebox.py build black_marble             # publicarlo: aparece en el selector de la web
```

`add` escribe `video_jukebox/videos/<id>.json`: edítalo para renombrar las pistas, escribir los
textos en los dos idiomas y elegir qué medida mueve cada pista. Detalles: [`video_jukebox/README.es.md`](video_jukebox/README.es.md).

## Estructura

```
video_jukebox/            el pipeline (Python)
  jukebox.py              orquestador: try / add / fetch / build / preview / list / remove / check
  videos/<id>.json        una ficha por video: analizador, fuente, música, textos, créditos
  analyzers/              un analizador por tipo de visualización
  analyze.py compose.py export_timeline.py render_preview.py build_web.py   los pasos
  diagnostics.py mask_check.py                                              revisión de videos nuevos
  tests/
web/                      la página (Vite, Web Audio API, sin dependencias en ejecución)
  public/data/jukebox/    catalog.json + manifiesto y timeline de cada video
  public/media/jukebox/   video web y cuatro pistas de audio de cada video
docs/                     validación de ECCO2 y propuesta de publicación
```

## Créditos

Visualizaciones: NASA/Goddard Space Flight Center Scientific Visualization Studio. Video ECCO2
([SVS 3912](https://svs.gsfc.nasa.gov/3912/)): Greg Shirah, Horace Mitchell (NASA/GSFC), Eric
Sokolowsky (GST); ciencia: Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL), modelo ECCO2 (MIT/JPL).
La página de cada video muestra sus propios créditos. La música la genera este proyecto a partir de
índices visuales del video, con un sintetizador FM de 2 operadores para el preview (no es Dexed ni un
DX7 real). Este proyecto no está respaldado por NASA.
