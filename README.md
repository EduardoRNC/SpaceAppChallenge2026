# Earth Information Jukebox

**English** · [Español](README.es.md)

Project for the **[The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)** challenge of the NASA Space Apps Challenge 2026.

It turns NASA Earth visualizations (videos from the NASA Scientific Visualization Studio and the
Earth Information Center) into **four voices of music** that follow what the image shows, and
plays them in a web page with the video in sync, mute/solo per track, a piano roll and charts of
what is measured in each latitude band.

The first published video is the ECCO2 ocean currents and temperature visualization
([SVS 3912](https://svs.gsfc.nasa.gov/3912/)). The pipeline is built for **several videos**: each one
is described by a small file, analyzed by the analyzer for its kind of visualization and listed in
the web page's video picker.

## How it works

```
NASA video ──► analyzer ──► measures per frame ──► composer ──► 4 tracks (MIDI + FM audio)
(SVS / EIC)    (by kind)    and latitude band      (shared         │
                                                     harmony)       └──► web page: video + music
```

1. **Analyzer (by kind of video).** It splits the equirectangular map into 5 latitude bands
   (Arctic, northern mid-latitudes, tropics, southern mid-latitudes, Antarctic) and measures each
   band in every frame:

   | Analyzer | For | Measures |
   |---|---|---|
   | `ocean_flow` | moving lines colored blue→red (ECCO2 currents, winds) | color index, apparent motion (optical flow), direction, turbulence |
   | `color_map` | heatmaps that change color (temperature anomalies, SST, CO₂) | red–blue index, hue index, share in strong red, image change |
   | `night_lights` | Earth at night (Black Marble) | brightness, lit share, appearing light |

2. **Composer.** One harmonic director picks the chords from the data (low values → dark chords,
   high → bright), and every voice plays only notes of the current chord, so the result always
   sounds harmonious. Four roles, one per track: **pad** (chords, volume), **voices** (one per band;
   north = high, south = low), **accents** (a bell at each peak) and **bass** (density from one band).
   Each video file says which measure drives each role.

3. **Web page.** Video and audio stay in sync (the audio is the clock), with mute/solo, a piano roll
   and charts per band, in English and Spanish, fully usable with the keyboard and screen readers.

**Visual proxies, not measurements.** Every measure is computed from the video's pixels. They are
not temperatures in °C or speeds in m/s, and the page says so next to every chart.

## Run it

Requirements: Python 3.10+, Node 18+ and ffmpeg.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd video_jukebox
../.venv/bin/python jukebox.py fetch ecco2      # downloads the NASA video (~250 MB, not committed)
../.venv/bin/python jukebox.py build ecco2      # analyzes, composes and publishes it in web/public
../.venv/bin/python jukebox.py list             # registered videos and their state
cd ..
.venv/bin/pytest                                 # pipeline tests (synthetic videos, no download)

cd web
npm install
npm run dev      # http://localhost:5173/  (?video=<id>, ?lang=es)
npm test
npm run build    # static site in web/dist (GitHub Pages: docs/DEPLOY_PAGES.md)
```

### Adding a new video

```bash
cd video_jukebox
python jukebox.py try my_video.mp4               # which analyzer sees it best
python jukebox.py add black_marble --video my_video.mp4 --analyzer night_lights \
    --svs 5276 --title-en "Earth at night" --title-es "La Tierra de noche"
python jukebox.py preview black_marble           # listen: out/black_marble/preview.mp4
python jukebox.py build black_marble             # publish it: it appears in the web picker
```

`add` writes `video_jukebox/videos/<id>.json`: edit it to rename the tracks, write the texts in both
languages and choose which measure drives each track. Details: [`video_jukebox/README.md`](video_jukebox/README.md).

## Structure

```
video_jukebox/            the pipeline (Python)
  jukebox.py              orchestrator: try / add / fetch / build / preview / list / remove / check
  videos/<id>.json        one file per video: analyzer, source, music, texts, credits
  analyzers/              one analyzer per kind of visualization
  analyze.py compose.py export_timeline.py render_preview.py build_web.py   the steps
  diagnostics.py mask_check.py                                              checks for new videos
  tests/
web/                      the web page (Vite, Web Audio API, no runtime dependencies)
  public/data/jukebox/    catalog.json + per-video manifest and timeline
  public/media/jukebox/   per-video web video and four audio stems
docs/                     ECCO2 validation and publishing proposal
```

## Credits

Visualizations: NASA/Goddard Space Flight Center Scientific Visualization Studio. ECCO2 video
([SVS 3912](https://svs.gsfc.nasa.gov/3912/)): Greg Shirah, Horace Mitchell (NASA/GSFC), Eric
Sokolowsky (GST); science: Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL), ECCO2 model (MIT/JPL).
Each video's page shows its own credits. The music is generated by this project from visual indices
of the video, with a 2-operator FM preview synthesizer (not Dexed, not a real DX7). This project is
not endorsed by NASA.
