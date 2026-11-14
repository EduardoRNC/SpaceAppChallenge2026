# La espiral que suena — Earth Information Jukebox

Proyecto para el reto **[The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)** de NASA Space Apps Challenge 2026.

Convierte la visualización *NASA Climate Spiral* del Earth Information Center (EIC) en un paisaje sonoro que se genera en tiempo real. Así, el calentamiento global se puede **entender solo escuchando**.

## Frase guía

> Una persona ciega o con baja visión debería poder entender, solo escuchando, que la Tierra se ha calentado más de 1.3 °C desde 1880 y que el calentamiento se aceleró a partir de los años 80.

Cada decisión de diseño se evalúa contra esta frase.

## Datos NASA

| Pieza | Fuente |
|---|---|
| Visualización EIC | [SVS 5190 — NASA Climate Spiral 1880–Present](https://svs.gsfc.nasa.gov/5190/), del NASA Scientific Visualization Studio |
| Datos numéricos | [GISTEMP v4 — Land-Ocean Global Means](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv), de NASA GISS. Anomalía mensual en °C respecto a 1951–1980, desde 1880 |

La página de la visualización enlaza este mismo CSV, así que **lo que se ve y lo que se oye salen de los mismos datos**.

### Pistas extra del jukebox

| Pista | Visualización | Datos |
|---|---|---|
| CO₂ atmosférico | [SVS 5119 — OCO-2 and Keeling Curve](https://svs.gsfc.nasa.gov/5119/) (último fotograma, con cursor) | [NOAA GML — CO₂ mensual de Mauna Loa](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv), 1958–hoy |
| Hielo marino ártico | [SVS 5395 — Annual Arctic Sea Ice Minimum Area 1979–2024](https://svs.gsfc.nasa.gov/5395/) | [NSIDC Sea Ice Index v4 (G02135)](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/), extensión mensual 1979–hoy |

## Diseño del sonido (mapeo v1)

Regla general: **más caliente = más agudo, más brillante y más tenso**.

| Dato | Sonido |
|---|---|
| Media 1951–1980 (anomalía 0 °C) | **Drone de referencia**: una nota fija y suave. Es el "eje" del gráfico. |
| Anomalía mensual | **Tono**: una nota por mes, cuantizada a una escala pentatónica, en unas 3 octavas (de −0.8 a +1.6 °C). |
| Anomalía mensual | **Brillo** del timbre (cutoff del filtro). |
| Anomalía alta | **Tensión**: empieza en pentatónica mayor (calma). A partir de unos +0.5 °C se mezclan notas de modo menor, y desde unos +1.0 °C aparece una disonancia leve contra el drone. Los umbrales se ajustan en el test de escucha. |
| Año | 1 año = 1 compás de 12 notas. Los 146 años duran unos 60 s, igual que el vídeo. |
| Inicio de década | Tick percusivo suave, para orientarse. |
| Nuevo récord anual | Earcon (campanita). |
| Frames de la espiral | El color del segmento más reciente controla una textura ambiental. |

### Modos de escucha
- **Historia:** de 1880 a hoy, con el vídeo de la espiral sincronizado.
- **Comparar:** la década de 1880 frente a la de 2010.
- **Explorar:** recorrer los años con el teclado y oír el valor exacto en voz.

## Accesibilidad

Es un requisito de diseño, no un extra:
- control completo con teclado;
- leyenda sonora antes de empezar;
- valor exacto en voz;
- compatibilidad con lectores de pantalla;
- descripción textual de la visualización.

## Cómo ejecutarlo

Requisitos: Python 3.10 o superior, Node 18 o superior y ffmpeg.

```bash
# Python (preparación de datos)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/check_env.py   # verifica el entorno
.venv/bin/python scripts/fetch_data.py  # descarga GISTEMP a data/raw/
.venv/bin/python scripts/prepare_video.py   # descarga la Climate Spiral y genera la versión web
.venv/bin/python scripts/frame_features.py  # mide el color de los fotogramas + docs/validation.png
.venv/bin/python scripts/build_tracks.py  # genera web/public/data/temperature.json
.venv/bin/pytest                        # tests de datos

# Web
cd web
npm install
npm run dev      # servidor local de desarrollo
npm test         # tests del motor de sonido
npm run build    # versión para publicar (web/dist)
```

## Estructura

```
scripts/     preparación de datos y frames (Python)
data/raw/    CSV originales descargados
web/         app web (Vite + Tone.js)
docs/        proceso creativo, decisiones y tests de escucha
```

## Estado

- [x] Paso 0 — Frase guía y mapeo v1
- [x] Paso 1 — Esqueleto del repo
- [x] Paso 2 — Pipeline de datos
- [x] Paso 3 — Primer sonido
- [ ] Paso 4 — Test a ciegas y ajuste
- [x] Paso 5 — Vídeo y sincronía
- [x] Paso 6 — Interfaz accesible y modos
- [x] Paso 7 — Capa de frames y validación
- [ ] Paso 8 — Pistas extra (opcional)
- [ ] Paso 9 — Publicación
- [ ] Paso 10 — Historia y entrega

## Créditos

Visualización: NASA Scientific Visualization Studio. Datos: NASA GISS (GISTEMP Team). Este proyecto no está respaldado por NASA.
