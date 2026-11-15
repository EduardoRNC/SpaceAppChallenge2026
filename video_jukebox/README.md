# Video Jukebox: from NASA videos to music

**English** · [Español](README.es.md)

Turns map videos (equirectangular, like those from the SVS / Earth Information Center) into a
4-track MIDI file for the Yamaha DX7 (Dexed), a preview you can listen to right away, and the files
of the web page. It works with **several videos**: each one has its own file and analyzer.

## The orchestrator: `jukebox.py`

Everything runs from `video_jukebox/` (with the root environment: `../.venv/bin/python`):

| Command | What it does |
|---|---|
| `python jukebox.py analyzers` | lists the kinds of video we can analyze and their measures |
| `python jukebox.py try VIDEO` | tries the 3 analyzers on the first frames and reports what each one sees |
| `python jukebox.py add ID --video V --analyzer A --svs N` | registers a new video: copies it to `data/media/ID/` and writes `videos/ID.json` |
| `python jukebox.py add ID --url URL ...` | same, but the video is downloaded with `fetch` |
| `python jukebox.py list` | registered videos: whether the video is present and whether it is on the web |
| `python jukebox.py fetch ID` | downloads the file's `source.downloads` |
| `python jukebox.py preview ID` | analysis + music + `out/ID/preview.mp4` (video with audio), without touching the web |
| `python jukebox.py build ID [ID…]` / `--all` | the whole path, published to `web/public` (and to the catalog) |
| `python jukebox.py remove ID` | removes it from the web and deletes its file (`--keep-file` keeps it) |
| `python jukebox.py check` | validates every video file and everything published |

`build` reuses the analysis (`out/ID/features.npz`) when the video and the analyzer did not change;
`--force` redoes it. `--skip-video` reuses the already encoded web video. Working outputs stay in
`out/ID/` (not committed): `features.npz`, `events.json`, `ID.mid`, `timeline.json` and, with
`--preview`, `preview.wav` and `preview.mp4`.

### Example: adding a video

```bash
python jukebox.py try ~/Downloads/black_marble.mp4
python jukebox.py add black_marble --video ~/Downloads/black_marble.mp4 --analyzer night_lights \
    --svs 5276 --title-en "Earth at night" --title-es "La Tierra de noche" \
    --date-range 2012-01-01T00:00Z 2016-12-31T00:00Z
# edit videos/black_marble.json (track names, texts, music)
python jukebox.py preview black_marble
python jukebox.py build black_marble
cd ../web && npm run dev     # http://localhost:5173/?video=black_marble
```

Before building a new video, check that it has no text, date or color bar on top (they contaminate
the measures): `python mask_check.py VIDEO out/check --analyzer night_lights`.

To try it without NASA videos: `python tests/synthetic.py /tmp/x.avi --kind heatmap|lights|lines`
writes a fake video, and `add ... --test` marks it as a test (no NASA credits required, and the page
warns that it is not NASA data). Do not publish test videos.

## A video file (`videos/<id>.json`)

```jsonc
{
  "id": "ecco2",                         // = file name; lowercase, digits and _
  "analyzer": "ocean_flow",              // ocean_flow | color_map | night_lights
  "svs": 3912,                           // NASA SVS page (optional)
  "source": {
    "video": "data/media/ecco2/ecco2_sst_flow.mp4",     // relative to the repository root
    "dates": "data/media/ecco2/flat_ecco2_dates.txt",   // optional: date of each frame
    "date_range": ["2007-03-25T12:00Z", "2008-03-03T12:00Z"],  // if there is no dates file
    "downloads": [{"url": "...", "file": "data/media/...", "bytes": 256266335}]
  },
  "music": { ... },                      // optional: defaults to the analyzer's
  "texts": { "en": {...}, "es": {...} }, // title, intro, caption, note, track names, effects
  "credits": [{"role": {"en": "...", "es": "..."}, "text": "...", "detail": "...", "url": "https://svs.gsfc.nasa.gov/..."}],
  "test": true                           // only for test videos
}
```

Any text can be a string (same in both languages) or `{"en": ..., "es": ...}`. `texts.<lang>` holds
`title`, `intro`, `caption`, `proxy_note` (how reliable the measures are in this video),
`stems.<track>.label` and, to replace the automatic explanation, `effects.<track or "acordes">.<measure>`.
The "not endorsed by NASA" notice, the visual-proxy disclaimer and the music credit are added
automatically.

### The music: four roles

Every video has 4 tracks, one per role. What changes from one video to another is **which measure
drives each role**:

```jsonc
"music": {
  "harmony": {"metric": "temp", "mode": "contrast", "regions": ["norte_medio", "sur_medio"]},
  //  or {"metric": "warm", "mode": "mean"}: mean of the five bands
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

| Role | Channel | What it does |
|---|---|---|
| `harmony` | — | picks the chords bar by bar: low values → dark chords, high → bright |
| `pad` | 1 | one chord per bar; `metric` (mean of the bands) sets the volume |
| `voices` | 2 | one voice per band (north = high); it plays when `activity` exceeds 45% of its range; `pitch` moves the note; `timbre` changes the modulation (CC1) |
| `accents` | 3 | a bell strike at each peak of `metric` in a band |
| `bass` | 4 | chord root; more notes the higher `metric` is in `region` (`direction: -1` counts negative values) |

`program` is the 0-based preset number in the DX7 ROM1A cartridge sent as a Program Change in the
MIDI file. Every voice plays only notes of the current chord, so the harmony always holds.
`compose.check_music` checks the roles, that the measures exist and that the bands are valid.

## The analyzers (`analyzers/`)

| Analyzer | For | Measures | Mask |
|---|---|---|---|
| `ocean_flow` | moving lines colored blue→red (ECCO2) | `temp`, `speed`, `u`, `v`, `vort` | saturated pixels (no gray land, no background) |
| `color_map` | heatmaps (anomalies, SST, CO₂) | `warm` (red−blue), `hue`, `hot`, `change` | everything but black background |
| `night_lights` | Earth at night | `bright`, `lit`, `new` | the whole map |

All of them also return `cover` (share of valid pixels per band). The 5 bands are Arctic (90–60°N),
northern mid-latitudes (60–23°N), tropics (23°N–23°S), southern mid-latitudes (23–60°S) and
Antarctic (60–90°S). A band with fewer than 50 valid pixels gets 0 for every measure (the page
shows it as "no value").

**Writing a new analyzer:** copy `analyzers/color_map.py`, change `NAME`, `SUMMARY`, `METRICS`
(English and Spanish texts, `cover` included), `DEFAULT_MUSIC`, `measure(cur, prev)` and `mask(cur)`,
and add it to `ANALYZERS` in `analyzers/__init__.py`. The test
`tests/test_jukebox.py::test_analyzer_contract` checks the contract. Neither the composer nor the
web page need changes.

## The individual steps

`jukebox.py` calls these modules; they can be run by hand for debugging:

```bash
python analyze.py video.mp4 features.npz --analyzer color_map
python compose.py features.npz out.mid --music videos/ecco2.json --events events.json
python export_timeline.py features.npz events.json timeline.json --source video.mp4
python render_preview.py events.json preview.wav [--stems folder]
python diagnostics.py timeline.json out/diag [--dates dates.txt]   # charts per band + piano roll
python build_web.py --check-only [--id ecco2]                       # validates what is published
```

- **`compose.py`.** The tempo is locked to a whole number of frames per beat (90 BPM at 30 fps =
  20 frames) so the music never drifts from the video. The data is smoothed (median + 1 s mean),
  averaged per beat and normalized to its own range.
- **`export_timeline.py`.** Joins measures and notes into a JSON in seconds for the web (`timing`,
  `regions`, `channels`, `mapping`, `features`, `notes`, `chords`, `cc`, `validation`). It aborts if
  `events.json` does not come from that `features.npz`; it warns (without aborting) about bands
  without data, low coverage, music–video drift or tracks without notes.
- **`render_preview.py`.** A 2-operator FM synthesizer (the DX7 principle) + reverb, one sound per
  role. With `--stems` it writes one track per channel with a shared gain that prevents clipping in
  any mute/solo combination.
- **`build_web.py`.** Writes to `web/public/` the video (H.264, 1280 px wide, no audio), the 4 AAC
  tracks, the timeline, the manifest (with texts in both languages) and the catalog. Before finishing
  it validates relative paths, frames and FPS, that each track starts on the same sample as its WAV,
  that no combination clips, sizes and NASA credits.

## Video requirements

- **Equirectangular** projection (2:1 map, north up). SVS pages usually have such a version
  ("equirectangular" or for Science On a Sphere).
- Preferably **without text, date or color bar** on top. If it has them, crop them first
  (`mask_check.py` detects them).

## ECCO2 validation

[`docs/ECCO2_VALIDATION.md`](../docs/ECCO2_VALIDATION.md) (in Spanish): the color index follows the
seasons; the variations in motion and turbulence are mostly compression noise (the mean direction is
coherent); the music does not drift from the video. After the reorganization into analyzers, ECCO2
produces exactly the same measures, notes and MIDI as before.

## Tests

```bash
cd .. && .venv/bin/pytest        # from the root
```

They only use synthetic data. `tests/test_jukebox.py` registers three test videos (one per
analyzer), builds them with `build --all`, checks the catalog, the analysis cache, `list`, `check`
and `remove`, and each analyzer's contract.
