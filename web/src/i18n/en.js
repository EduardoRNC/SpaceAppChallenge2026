// English (default language). Same keys as es.js; tests check that none is missing.
// Proper names (NASA, ECCO2, DX7), chord and note names, units and numbers stay as they are.

export default {
  page: {
    title: "Video jukebox: the ocean that sounds — Earth Information Jukebox",
    description:
      "Ocean currents and temperature (NASA SVS, ECCO2 model) turned into four voices of music.",
    skip: "Skip to content",
  },
  lang: {
    label: "Language",
  },
  header: {
    title: "The ocean that sounds",
    intro:
      "One year of ocean currents and temperature from the ECCO2 model, as shown in the NASA SVS visualization, turned into four voices. Press <kbd>Space</kbd> to play.",
    spiral: "← The spiral that sounds (Spanish only)",
  },
  player: {
    loading: "Loading…",
    caption:
      "Surface currents colored by sea temperature (blue, cold; red, warm). Visualization: NASA/GSFC Scientific Visualization Studio.",
  },
  transport: {
    play: "Play",
    pause: "Pause",
    back: "Back 5 seconds",
    forward: "Forward 5 seconds",
    position: "Position",
    positionText: "{time} of {total}",
  },
  readout: {
    date: "Model date: {date} · frame {frame}/{frames}",
    bar: "Bar {bar} · beat {beat}",
    chord: "Chord {name}",
  },
  roll: {
    label: "Piano roll: chords and notes of the four tracks",
    caption:
      "10-second piano roll: chords on top and one row per track (high notes at the top). The orange line is what is sounding now. Click the chart to jump to that moment, or focus it and use the arrow keys (one beat), Page Up / Page Down (one bar) and Home / End.",
    valueText: "{time}. Chord {chord}. {notes}",
    sounding: "Sounding: {parts}",
    silent: "No notes sounding.",
  },
  mixer: {
    legend: "Tracks",
    reset: "Unmute all",
    dx7: "DX7 reference: {patch}",
    mute: "Mute {name}",
    muteTitle: "Mute (key {n})",
    unmuteTitle: "Unmute (key {n})",
    solo: "Solo {name}",
    soloTitle: "Solo (Shift + {n})",
    soloShort: "S",
    muted: "{name}: muted.",
    unmuted: "{name}: unmuted.",
    soloOn: "{name}: solo on.",
    soloOff: "{name}: solo off.",
    allOn: "All tracks unmuted.",
  },
  status: {
    loadingAudio: "Loading audio tracks…",
    loadingProgress: "Loading audio tracks… {done}/{total}",
    ready: "Ready. Press Play or the space bar.",
    end: "End. Press Play to start again.",
    error: "Error: {message}",
  },
  notice: {
    buffering:
      "The video is still loading. The music is paused at {time} and will continue on its own when the video is ready.",
    network:
      "The video stopped receiving data (network problem?). The music is paused at {time} and will continue on its own if the connection comes back; you can also press Retry.",
    seek: "The video is taking too long to reach {time}. The music is waiting for it and will continue on its own; you can also press Retry.",
    frozen: "The video froze. The music is paused at {time} and will continue on its own when the video can play again.",
    stuck: "The video keeps freezing. The music is paused at {time}. Press Retry to reload the video.",
    error: {
      network:
        "The video could not be loaded because of a network error. Check your connection and press Retry; the music will continue from {time}.",
      decode: "The browser could not decode the video. Press Retry; if it happens again, reload the page.",
      unsupported: "This browser cannot play the video file (MP4, H.264). Please try another browser.",
      aborted: "Loading the video was interrupted. Press Retry to continue from {time}.",
      unknown: "The video stopped working. Press Retry to continue from {time}.",
      reload: "The video still does not respond. Check your connection and press Retry again.",
    },
    retrying: "Reloading the video…",
    recovered: "The video is ready again: playback continues.",
    loadFailed: "The demo could not start: {message}. Check your connection and reload the page.",
    retry: "Retry",
    reload: "Reload the page",
  },
  errors: {
    fetch: "could not load {url} (HTTP {status})",
    video: "the video could not be loaded",
    shortStems: "audio tracks shorter than expected: {ids}",
    manifest: "invalid asset manifest: {problems}",
    timeline: "invalid timeline: {problems}",
  },
  problems: {
    manifest: {
      schema: "unknown schema: {value}",
      version: "unsupported version: {value}",
      stems: "unexpected tracks: {ids}",
      path: "path is not relative: {src}",
      video: "video without fps or frames",
      audio: "audio without length",
      credits: "the NASA SVS credits are missing",
    },
    timeline: {
      schema: "unknown timeline schema: {value}",
      version: "unsupported timeline version: {value}",
      channels: "unexpected channels: {ids}",
      notes: "timeline without notes",
      noteTrack: "notes from an unknown track",
      fps: "timeline fps {timeline} ≠ video {video}",
      duration: "the music is longer than the audio",
      features: "features.t does not have one value per frame",
      metric: "metric {id} is not marked as an uncalibrated visual proxy",
    },
  },
  debug: {
    summary: "Audio–video sync (diagnostics)",
    mean: "Mean video − audio offset (0.5 s): {value}",
    frame: "Last frame: {value} · max |offset| in 10 s: {max}",
    note: "(at 30 fps each frame is shown for 33 ms: per-frame values swing by ±1/2 frame)",
    seeks: "Correction jumps: {seeks} · video speed: {rate}",
    latency: "Output latency: {value}",
    decoded: "Decoded tracks: {value}",
    decodedValue: "{lengths} samples (expected {expected}) at {rate} Hz",
    ms: "{value} ms",
  },
  regions: {
    title: "What the image measures, by region",
    warning:
      "<strong>All these measures are uncalibrated visual proxies.</strong> They are computed from the video's pixels (color and optical flow): they are not temperatures in °C, speeds in m/s or physical vorticity. They are shown frame by frame, without the smoothing the music uses. In this video, fast changes in apparent motion and turbulence are mostly compression noise; the color index does follow the seasons.",
    keys: "Click a chart to jump to that moment, or focus it and use the arrow keys (1 s), Page Up / Page Down (10 s) and Home / End.",
    picker: "Region (latitude band)",
    proxy: "Visual proxy · uncalibrated",
    now: "Now: {value} {unit}",
    valueText: "{time}: {value} ({unit})",
    range: "min {min} · max {max} {unit}",
    noData: "no data",
    noValue: "no value",
    unused: "Not used by any instrument: shown for context.",
    chords: "Chords",
    use: "{who}: {effect}.",
    chartLabel:
      "{metric} in {region} over the video: between {min} and {max} ({unit}). Visual index, not a calibrated measurement.",
    chartLabelEmpty: "{metric} in {region} over the video: no data. Visual index, not a calibrated measurement.",
    all: "all bands",
    and: "{a} and {b}",
    names: {
      artico: "Arctic",
      norte_medio: "Northern mid-latitudes",
      tropicos: "Tropics",
      sur_medio: "Southern mid-latitudes",
      antartico: "Antarctic",
    },
  },
  map: {
    title: "What controls each instrument",
    intro:
      "Each track follows one or more of the measures above. Before they become notes they are smoothed and compared with their own range: the music follows relative changes, not absolute values.",
    harmony: "Chords (all tracks)",
    harmonyDetail: "the harmonic director",
    use: "{metric} ({regions}):",
    effect: "{effect}.",
  },
  effects: {
    acordes: {
      temp: "the north − south difference (the seasons) picks darker or brighter chords, bar by bar; with the brightest ones, the strings move up an octave",
    },
    temperatura: {
      temp: "the mean of the five bands sets the volume of the chord",
    },
    corrientes: {
      speed: "each band has its own voice: it sounds when its motion exceeds 45% of its range, and louder the more it moves",
      temp: "raises or lowers the band's note (±5 semitones; north = high, south = low)",
      vort: "the mean of the five bands changes the timbre (modulation)",
    },
    remolinos: {
      vort: "a bell strike at each peak of the band (more than 1.6 standard deviations above its median); higher-pitched the further north",
    },
    ecuatorial: {
      u: "the more westward (negative values), the more notes per bar and the louder they are",
    },
  },
  keys: {
    title: "Keyboard shortcuts",
    space: "Space",
    playPause: "Play or pause",
    step: "Back or forward 5 s",
    home: "Home",
    end: "End",
    startEnd: "Go to the start or the end",
    mute: "Mute or unmute a track",
    shift: "Shift",
    solo: "Solo a track",
    reset: "Unmute all tracks",
    note: "When a button has focus, Space and Enter press it. On the position bar, the piano roll and the charts, the arrow keys, Home and End move within that control. Text fields and drop-downs have no shortcuts.",
  },
  what: {
    title: "What you are hearing",
    body:
      "Each voice follows an index computed from the video's pixels (color, apparent motion, eddies). They are <strong>visual indices</strong>, not calibrated scientific measurements. What does come from NASA is the model date of each frame.",
  },
  data: {
    title: "Ocean currents and temperature (ECCO2)",
    notice:
      "Project for the NASA Space Apps Challenge 2026. Not endorsed by NASA. Public-domain visualization from the NASA SVS.",
    disclaimer:
      "The features are visual proxies derived from the video's pixels (color and optical flow). They are not calibrated physical measurements.",
    stems: {
      temperatura: { label: "Temperature" },
      corrientes: { label: "Currents" },
      remolinos: { label: "Eddies" },
      ecuatorial: { label: "Equatorial current" },
    },
    credits: {
      0: {
        role: "Visualization",
        text: "NASA/Goddard Space Flight Center Scientific Visualization Studio",
        detail: "Greg Shirah, Horace Mitchell (NASA/GSFC), Eric Sokolowsky (GST)",
      },
      1: {
        role: "Science",
        text: "ECCO2 model (MIT/JPL)",
        detail: "Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL)",
      },
      2: {
        role: "Music",
        text: "Generated by this project from visual indices of the video",
        detail: "2-operator FM preview (not Dexed, not a real DX7)",
      },
    },
    metrics: {
      temp: {
        label: "Cold–warm color index",
        unit: "index 0..1",
        derived_from: "pixel hue (HSV): blue = 0, red = 1",
        caveat: "Position in the visualization's color palette, not temperature in °C.",
      },
      speed: {
        label: "Apparent motion",
        unit: "px/frame",
        derived_from: "mean optical-flow magnitude (Farneback)",
        caveat: "Depends on the analysis resolution (--width) and on the pace of the animation; not a speed in m/s.",
      },
      u: {
        label: "Apparent east–west motion",
        unit: "px/frame",
        derived_from: "horizontal optical-flow component (+ = east)",
        caveat: "In the equirectangular projection a horizontal pixel covers fewer km the closer it is to the pole.",
      },
      v: {
        label: "Apparent north–south motion",
        unit: "px/frame",
        derived_from: "vertical optical-flow component (+ = north)",
        caveat: "Motion of the drawn lines, not physical meridional velocity.",
      },
      vort: {
        label: "Apparent turbulence",
        unit: "1/frame",
        derived_from: "absolute value of the optical-flow curl",
        caveat: "An indicator of eddies in the image, not physical vorticity in 1/s.",
      },
      cover: {
        label: "Valid-pixel coverage",
        unit: "fraction 0..1",
        derived_from: "pixels that pass the saturation and brightness mask",
        caveat: "Fraction of colored pixels, not the actual fraction of ocean.",
      },
    },
  },
};
