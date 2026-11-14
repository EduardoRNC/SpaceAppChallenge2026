# The spiral that sounds — Earth Information Jukebox

**English** · [Español](README.es.md)

Project for the **[The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)** challenge of the NASA Space Apps Challenge 2026.

It turns the *NASA Climate Spiral* visualization from the Earth Information Center (EIC) into a soundscape generated in real time, so that global warming can be **understood just by listening**.

The repository also contains the **Video Jukebox**: a pipeline that turns a NASA map video into four-track music, and a web player for the ECCO2 ocean video (`web/jukebox.html`). See [Video Jukebox (ECCO2)](#video-jukebox-ecco2) below.

## Guiding sentence

> A blind or low-vision person should be able to understand, just by listening, that the Earth has warmed by more than 1.3 °C since 1880 and that warming accelerated from the 1980s on.

Every design decision is checked against this sentence.

## NASA data

| Piece | Source |
|---|---|
| EIC visualization | [SVS 5190 — NASA Climate Spiral 1880–Present](https://svs.gsfc.nasa.gov/5190/), from the NASA Scientific Visualization Studio |
| Numerical data | [GISTEMP v4 — Land-Ocean Global Means](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv), from NASA GISS. Monthly anomaly in °C relative to 1951–1980, since 1880 |

The visualization page links to this same CSV, so **what you see and what you hear come from the same data**.

### Extra jukebox tracks

| Track | Visualization | Data |
|---|---|---|
| Atmospheric CO₂ | [SVS 5119 — OCO-2 and Keeling Curve](https://svs.gsfc.nasa.gov/5119/) (last frame, with cursor) | [NOAA GML — Mauna Loa monthly CO₂](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv), 1958–present |
| Arctic sea ice | [SVS 5395 — Annual Arctic Sea Ice Minimum Area 1979–2024](https://svs.gsfc.nasa.gov/5395/) | [NSIDC Sea Ice Index v4 (G02135)](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/), monthly extent 1979–present |

## Sound design (mapping v1)

General rule: **warmer = higher, brighter and more tense**.

| Data | Sound |
|---|---|
| 1951–1980 mean (0 °C anomaly) | **Reference drone**: a fixed, soft note. It is the "axis" of the chart. |
| Monthly anomaly | **Pitch**: one note per month, quantized to a pentatonic scale, over about 3 octaves (from −0.8 to +1.6 °C). |
| Monthly anomaly | **Brightness** of the timbre (filter cutoff). |
| High anomaly | **Tension**: it starts in major pentatonic (calm). From about +0.5 °C, minor-mode notes are mixed in, and from about +1.0 °C a slight dissonance against the drone appears. The thresholds are tuned in the listening test. |
| Year | 1 year = 1 bar of 12 notes. The 146 years last about 60 s, the same as the video. |
| Start of a decade | Soft percussive tick, for orientation. |
| New annual record | Earcon (small bell). |
| Spiral frames | The color of the most recent segment controls an ambient texture. |

### Listening modes
- **History:** from 1880 to today, with the spiral video in sync.
- **Compare:** the 1880s against the 2010s.
- **Explore:** move through the years with the keyboard and hear the exact value spoken.

## Accessibility

It is a design requirement, not an extra:
- full keyboard control;
- a sound legend before starting;
- exact value spoken aloud;
- screen reader support;
- a text description of the visualization.

## How to run it

Requirements: Python 3.10 or later, Node 18 or later and ffmpeg.

```bash
# Python (data preparation)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/check_env.py   # checks the environment
.venv/bin/python scripts/fetch_data.py  # downloads GISTEMP into data/raw/
.venv/bin/python scripts/prepare_video.py   # downloads the Climate Spiral and builds the web version
.venv/bin/python scripts/frame_features.py  # measures the frame colors + docs/validation.png
.venv/bin/python scripts/build_tracks.py  # writes web/public/data/temperature.json
.venv/bin/pytest                        # data and video jukebox tests

# Web
cd web
npm install
npm run dev      # local development server (/jukebox.html: ECCO2 demo with mute/solo)
npm test         # sound engine and jukebox tests
npm run build    # build for publishing (web/dist)
```

The Climate Spiral page (`web/index.html`) is in Spanish only for now; the Video Jukebox page is in English and Spanish.

## Video Jukebox (ECCO2)

`web/jukebox.html` plays the NASA SVS visualization of ocean currents and sea surface temperature from the ECCO2 model ([SVS 3912](https://svs.gsfc.nasa.gov/3912/)) together with four music tracks generated from the video by `video_jukebox/`.

- **Synchronized video and music.** The audio is the master clock and the video follows it. If the video cannot keep up (slow network, a jump to a part that is not downloaded yet, a decoding error), the music stops at that point and a notice explains why. Playback resumes on its own when the video recovers, and a *Retry* button reloads the video and continues from the same point.
- **Four tracks with mute and solo**, a 10-second piano roll with the chords and notes, and charts of what the image measures in each latitude band.
- **English and Spanish.** English by default; the *English / Español* switch in the header changes the whole page (including dates, decimal separators and screen reader texts) without interrupting the music. The choice is stored in the browser; `?lang=es` or `?lang=en` in the URL forces it.
- **Keyboard and screen readers.** Every control works with the keyboard, the piano roll and the charts are sliders with spoken descriptions, and the shortcuts are listed on the page.
- **Visual proxies, not measurements.** The measures are computed from the video's pixels (color and optical flow). They are not temperatures in °C, speeds in m/s or physical vorticity; the color index does follow the seasons, while fast changes in apparent motion and turbulence are mostly video compression noise.

How the music is generated, how to rebuild the web assets and how to use the player: [`video_jukebox/README.md`](video_jukebox/README.md). Validation against the real ECCO2 video (in Spanish): [`docs/ECCO2_VALIDATION.md`](docs/ECCO2_VALIDATION.md).

## Future Work — Support for Additional NASA Visualizations

> This is a proposed extension, not a feature that is available today. The jukebox currently supports only the ECCO2 video (SVS 3912).

A future version could turn other NASA visualizations into music, for example the Black Marble night lights maps ([SVS 5276](https://svs.gsfc.nasa.gov/5276/)). The idea is to separate what is specific to each video from what can be shared:

- **One analyzer per kind of video.** Each analyzer would measure what that visualization shows (for night lights: how bright each region is and how it changes from year to year) and declare what each measure means and its caveats.
- **A common feature format.** The analyzers would write their measures to a shared format with musical roles (for example: what sets the chords, what sets the volume, what triggers accents), so the composer, the web player and the charts could work with any video without changes.
- **Same honesty rules.** Measures taken from the pixels of a visualization would still be labelled as uncalibrated visual proxies, not scientific measurements.

## Structure

```
scripts/        data and frame preparation (Python)
video_jukebox/  NASA video -> MIDI + timeline.json for the web (see its README)
data/raw/       downloaded original CSV files
web/            web app (Vite + Tone.js; the jukebox uses the Web Audio API directly)
docs/           creative process, decisions and listening tests (in Spanish)
```

## Status

- [x] Step 0 — Guiding sentence and mapping v1
- [x] Step 1 — Repository skeleton
- [x] Step 2 — Data pipeline
- [x] Step 3 — First sound
- [ ] Step 4 — Blind test and tuning
- [x] Step 5 — Video and sync
- [x] Step 6 — Accessible interface and modes
- [x] Step 7 — Frame layer and validation
- [ ] Step 8 — Extra tracks (optional)
- [ ] Step 9 — Publishing
- [ ] Step 10 — Story and submission

## Credits

Visualization: NASA Scientific Visualization Studio. Data: NASA GISS (GISTEMP Team). This project is not endorsed by NASA.

Jukebox demo (`jukebox.html`): visualization by the NASA/Goddard Space Flight Center Scientific Visualization Studio (Greg Shirah, Horace Mitchell (NASA/GSFC), Eric Sokolowsky (GST)), [SVS 3912](https://svs.gsfc.nasa.gov/3912/), with data from the ECCO2 model (MIT/JPL; Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL)). The music is generated by this project from visual indices of the video, with a 2-operator FM preview synthesizer (not Dexed, not a real DX7).
