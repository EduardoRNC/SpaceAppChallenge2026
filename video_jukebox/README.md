# Video Jukebox: de un video de NASA a música

Convierte un video de mapa (equirectangular, como los del SVS / Earth Information Center)
en un MIDI de 4 pistas para el Yamaha DX7 (Dexed), más un preview para escucharlo ya.

Ejemplo de referencia: `ecco2_sst_flow.mp4` (corrientes + temperatura del mar, SVS 3912).

## Instalar y correr

```bash
pip install -r requirements.txt        # numpy, scipy, opencv-python (+ ffmpeg en el sistema)
./run.sh ecco2_sst_flow.mp4 oceano     # ~1-2 min
```

Salida en `out/`:
- `oceano.mid`: abrir en un DAW (Reaper, LMMS, Ardour) con una instancia de Dexed por pista
- `oceano_preview.mp4`: el video con un sintetizador FM sencillo (no es Dexed, solo para comprobar)

O paso a paso:
```bash
python analyze.py video.mp4 features.npz
python compose.py features.npz salida.mid --events events.json
python render_preview.py events.json preview.wav
```

## Cómo funciona (3 pasos)

```
video.mp4 ──► analyze.py ──► features.npz ──► compose.py ──► salida.mid ──► Dexed
              (QUÉ pasa)     (números por       (CÓMO suena)        └─► render_preview.py (preview)
                              frame y franja)
```

### 1. `analyze.py`: qué pasa en el video
Divide el mapa en 5 franjas de latitud (ártico, norte medio, trópicos, sur medio, antártico).
En cada frame y en cada franja mide:

| Medida | Cómo | Qué significa |
|---|---|---|
| `temp` | color del píxel (azul=0 … rojo=1) | temperatura del mar |
| `speed` | flujo óptico (OpenCV Farneback) | velocidad de la corriente |
| `u`, `v` | componentes del flujo | dirección (este/oeste, norte/sur) |
| `vort` | rotacional del flujo | remolinos / turbulencia |
| `cover` | % de píxeles válidos | cuánto océano hay en la franja |

La tierra (gris) y el fondo oscuro se ignoran con una máscara de saturación/brillo.

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
