# Video Jukebox: de videos de NASA a música

[English](README.md) · **Español**

Convierte videos de mapas (equirectangulares, como los del SVS / Earth Information Center) en un
MIDI de 4 pistas para el Yamaha DX7 (Dexed), en un preview que se puede escuchar ya y en los
archivos de la página web. Funciona con **varios videos**: cada uno tiene su ficha y su analizador.

## El orquestador: `jukebox.py`

Todo se hace desde `video_jukebox/` (con el entorno de la raíz: `../.venv/bin/python`):

| Comando | Qué hace |
|---|---|
| `python jukebox.py analyzers` | lista los tipos de video que sabemos analizar y sus medidas |
| `python jukebox.py try VIDEO` | prueba los 3 analizadores en los primeros frames y dice cuál ve qué |
| `python jukebox.py add ID --video V --analyzer A --svs N` | registra un video nuevo: copia el video a `data/media/ID/` y crea `videos/ID.json` |
| `python jukebox.py add ID --url URL ...` | igual, pero el video se baja con `fetch` |
| `python jukebox.py list` | videos registrados: si tienen el video y si están en la web |
| `python jukebox.py fetch ID` | baja los archivos de la ficha (`source.downloads`) |
| `python jukebox.py preview ID` | análisis + música + `out/ID/preview.mp4` (el video con el audio), sin tocar la web |
| `python jukebox.py build ID [ID…]` / `--all` | todo el camino y publica en `web/public` (y en el catálogo) |
| `python jukebox.py remove ID` | lo quita de la web y borra su ficha (`--keep-file` la conserva) |
| `python jukebox.py check` | valida todas las fichas y todo lo publicado |

`build` reutiliza el análisis (`out/ID/features.npz`) si el video y el analizador no cambiaron;
`--force` lo repite. `--skip-video` reutiliza el video web ya codificado. Las salidas de trabajo
quedan en `out/ID/` (no se suben a git): `features.npz`, `events.json`, `ID.mid`, `timeline.json` y,
con `--preview`, `preview.wav` y `preview.mp4`.

### Ejemplo: añadir un video

```bash
python jukebox.py try ~/Descargas/black_marble.mp4
python jukebox.py add black_marble --video ~/Descargas/black_marble.mp4 --analyzer night_lights \
    --svs 5276 --title-en "Earth at night" --title-es "La Tierra de noche" \
    --date-range 2012-01-01T00:00Z 2016-12-31T00:00Z
# editar videos/black_marble.json (nombres de pista, textos, música)
python jukebox.py preview black_marble
python jukebox.py build black_marble
cd ../web && npm run dev     # http://localhost:5173/?video=black_marble
```

Antes de construir un video nuevo, comprueba que no tiene textos, fecha o barra de color encima
(contaminan las medidas): `python mask_check.py VIDEO out/check --analyzer night_lights`.

Para probar sin videos de NASA: `python tests/synthetic.py /tmp/x.avi --kind heatmap|lights|lines`
genera un video falso, y `add ... --test` lo marca como prueba (no exige créditos de NASA y la web
avisa de que no son datos de NASA). No publiques videos de prueba.

## La ficha de un video (`videos/<id>.json`)

```jsonc
{
  "id": "ecco2",                         // = nombre del archivo; minúsculas, números y _
  "analyzer": "ocean_flow",              // ocean_flow | color_map | night_lights
  "svs": 3912,                           // página del NASA SVS (opcional)
  "source": {
    "video": "data/media/ecco2/ecco2_sst_flow.mp4",     // relativo a la raíz del repo
    "dates": "data/media/ecco2/flat_ecco2_dates.txt",   // opcional: fecha de cada frame
    "date_range": ["2007-03-25T12:00Z", "2008-03-03T12:00Z"],  // si no hay archivo de fechas
    "downloads": [{"url": "...", "file": "data/media/...", "bytes": 256266335}]
  },
  "music": { ... },                      // opcional: si falta, la del analizador
  "texts": { "en": {...}, "es": {...} }, // título, intro, pie de foto, nota, nombres de pista, efectos
  "credits": [{"role": {"en": "...", "es": "..."}, "text": "...", "detail": "...", "url": "https://svs.gsfc.nasa.gov/..."}],
  "test": true                           // solo para videos de prueba
}
```

Cualquier texto puede ser una cadena (igual en los dos idiomas) o `{"en": ..., "es": ...}`. En
`texts.<idioma>` van `title`, `intro`, `caption`, `proxy_note` (qué tan fiables son las medidas en
este video), `stems.<pista>.label` y, si quieres cambiar la explicación automática,
`effects.<pista o "acordes">.<medida>`. El aviso de "no respaldado por NASA", el de proxies
visuales y el crédito de la música se añaden solos.

### La música: cuatro papeles

Cada video tiene 4 pistas, una por papel. Lo que cambia de un video a otro es **qué medida mueve
cada papel**:

```jsonc
"music": {
  "harmony": {"metric": "temp", "mode": "contrast", "regions": ["norte_medio", "sur_medio"]},
  //  o {"metric": "warm", "mode": "mean"}: media de las cinco franjas
  "tracks": [
    {"id": "temperatura", "role": "pad",     "patch": "STRINGS 1", "program": 3,  "color": "#ff6b4a", "metric": "temp"},
    {"id": "corrientes",  "role": "voices",  "patch": "FLUTE 1",   "program": 23, "color": "#4cc9f0",
     "activity": "speed", "pitch": "temp", "timbre": "vort"},
    {"id": "remolinos",   "role": "accents", "patch": "TUB BELLS", "program": 25, "color": "#c77dff", "metric": "vort"},
    {"id": "ecuatorial",  "role": "bass",    "patch": "BASS 1",    "program": 14, "color": "#f4b942",
     "metric": "u", "region": "tropicos", "direction": -1}
  ]
}
```

| Papel | Canal | Qué hace |
|---|---|---|
| armonía (`harmony`) | — | elige los acordes compás a compás: valores bajos → acordes oscuros, altos → brillantes |
| `pad` | 1 | acorde por compás; `metric` (media de franjas) fija el volumen |
| `voices` | 2 | una voz por franja (norte = agudo); suena cuando `activity` supera el 45 % de su rango; `pitch` sube o baja la nota; `timbre` cambia la modulación (CC1) |
| `accents` | 3 | una campanada en cada pico de `metric` en una franja |
| `bass` | 4 | raíz del acorde; más notas cuanto mayor es `metric` en `region` (`direction: -1` cuenta los valores negativos) |

`program` es el número (desde 0) del preset del cartucho ROM1A del DX7 que se manda como Program
Change en el MIDI. Todas las voces tocan solo notas del acorde vigente: la armonía queda
garantizada. Lo comprueba `compose.check_music` (papeles, medidas que existen, franjas válidas).

## Los analizadores (`analyzers/`)

| Analizador | Para | Medidas | Máscara |
|---|---|---|---|
| `ocean_flow` | líneas que se mueven coloreadas azul→rojo (ECCO2) | `temp`, `speed`, `u`, `v`, `vort` | píxeles saturados (fuera la tierra gris y el fondo) |
| `color_map` | mapas de calor (anomalías, SST, CO₂) | `warm` (rojo−azul), `hue`, `hot`, `change` | todo lo que no es fondo negro |
| `night_lights` | la Tierra de noche | `bright`, `lit`, `new` | todo el mapa |

Todos devuelven además `cover` (fracción de píxeles válidos por franja). Las 5 franjas son
ártico (90–60°N), norte medio (60–23°N), trópicos (23°N–23°S), sur medio (23–60°S) y antártico
(60–90°S). Si una franja tiene menos de 50 píxeles válidos, sus medidas valen 0 (y la web la
muestra como "sin dato").

**Escribir un analizador nuevo:** copia `analyzers/color_map.py`, cambia `NAME`, `SUMMARY`,
`METRICS` (textos en inglés y español, incluido `cover`), `DEFAULT_MUSIC`, `measure(cur, prev)` y
`mask(cur)`, y añádelo a `ANALYZERS` en `analyzers/__init__.py`. El test
`tests/test_jukebox.py::test_analyzer_contract` comprueba que cumple el contrato. Ni el compositor
ni la web necesitan cambios.

## Los pasos sueltos

`jukebox.py` llama a estos módulos; se pueden usar a mano para depurar:

```bash
python analyze.py video.mp4 features.npz --analyzer color_map
python compose.py features.npz salida.mid --music videos/ecco2.json --events events.json
python export_timeline.py features.npz events.json timeline.json --source video.mp4
python render_preview.py events.json preview.wav [--stems carpeta]
python diagnostics.py timeline.json out/diag [--dates fechas.txt]   # gráficas por franja + piano roll
python build_web.py --check-only [--id ecco2]                        # valida lo publicado
```

- **`compose.py`.** El tempo se ajusta a un número entero de frames por tiempo (90 BPM a 30 fps =
  20 frames) para que la música no se desfase del video. Los datos se suavizan (mediana + media de
  1 s), se promedian por tiempo y se normalizan a su propio rango.
- **`export_timeline.py`.** Junta medidas y notas en un JSON en segundos para la web
  (`timing`, `regions`, `channels`, `mapping`, `features`, `notes`, `chords`, `cc`, `validation`).
  Aborta si `events.json` no sale de ese `features.npz`; avisa (sin abortar) de franjas sin dato,
  cobertura baja, deriva música-video o pistas sin notas.
- **`render_preview.py`.** Sintetizador FM de 2 operadores (el principio del DX7) + reverb, un
  sonido por papel. Con `--stems` escribe una pista por canal con una ganancia común que evita la
  saturación en cualquier combinación de mute/solo.
- **`build_web.py`.** Escribe en `web/public/` el video (H.264, 1280 px de ancho, sin audio), las
  4 pistas AAC, el timeline, el manifiesto (con los textos en los dos idiomas) y el catálogo. Antes
  de terminar valida: rutas relativas, frames y FPS, que cada pista empiece en la misma muestra que
  el WAV, que ninguna combinación sature, tamaños y créditos de NASA.

## Requisitos del video

- Proyección **equirectangular** (mapa 2:1, norte arriba). Las páginas del SVS suelen tener una
  versión así ("equirectangular" o para Science On a Sphere).
- Mejor **sin textos, fecha ni barra de color** encima. Si los tiene, recórtalos antes
  (`mask_check.py` los detecta).

## Validación con ECCO2

[`docs/ECCO2_VALIDATION.md`](../docs/ECCO2_VALIDATION.md): el índice de color sigue las estaciones;
las variaciones de movimiento y turbulencia son sobre todo ruido de compresión (la dirección media
sí es coherente); la música no se desfasa del video. Con la reorganización por analizadores, ECCO2
produce exactamente las mismas medidas, notas y MIDI que antes.

## Tests

```bash
cd .. && .venv/bin/pytest        # desde la raíz
```

Solo usan datos sintéticos. `tests/test_jukebox.py` registra tres videos de prueba (uno por
analizador), los construye con `build --all`, comprueba el catálogo, la caché del análisis,
`list`, `check` y `remove`, y el contrato de cada analizador.
