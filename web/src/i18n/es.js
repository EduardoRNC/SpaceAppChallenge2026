// Español. Mismas claves que en.js (lo comprueban los tests). Los textos de `data` son
// los del manifiesto y del timeline.json tal como los escribe el pipeline.

export default {
  page: {
    title: "Video jukebox: el océano que suena — Earth Information Jukebox",
    description:
      "Corrientes y temperatura del océano (NASA SVS, modelo ECCO2) convertidas en cuatro voces de música.",
    skip: "Saltar al contenido",
  },
  lang: {
    label: "Idioma",
  },
  header: {
    title: "El océano que suena",
    intro:
      "Las corrientes y la temperatura del océano de un año del modelo ECCO2, en la visualización del NASA SVS, convertidas en cuatro voces. Pulsa <kbd>Espacio</kbd> para reproducir.",
    spiral: "← La espiral que suena",
  },
  player: {
    loading: "Cargando…",
    caption:
      "Corrientes superficiales coloreadas por la temperatura del mar (azul, frío; rojo, cálido). Visualización: NASA/GSFC Scientific Visualization Studio.",
  },
  transport: {
    play: "Reproducir",
    pause: "Pausa",
    back: "Retroceder 5 segundos",
    forward: "Avanzar 5 segundos",
    position: "Posición",
    positionText: "{time} de {total}",
  },
  readout: {
    date: "Fecha del modelo: {date} · fotograma {frame}/{frames}",
    bar: "Compás {bar} · tiempo {beat}",
    chord: "Acorde {name}",
  },
  roll: {
    label: "Piano roll: acordes y notas de las cuatro pistas",
    caption:
      "Piano roll de 10 s: acordes arriba y una fila por pista (agudo arriba). La línea naranja es lo que suena ahora. Pulsa en el gráfico para saltar a ese momento, o ponle el foco y usa las flechas (un tiempo), Re Pág / Av Pág (un compás) e Inicio / Fin.",
    valueText: "{time}. Acorde {chord}. {notes}",
    sounding: "Suena: {parts}",
    silent: "Ninguna nota sonando.",
  },
  mixer: {
    legend: "Pistas",
    reset: "Todas con sonido",
    dx7: "Referencia DX7: {patch}",
    mute: "Silenciar {name}",
    muteTitle: "Silenciar (tecla {n})",
    unmuteTitle: "Activar sonido (tecla {n})",
    solo: "Solo {name}",
    soloTitle: "Solo (Mayús + {n})",
    soloShort: "S",
    muted: "{name}: silenciada.",
    unmuted: "{name}: con sonido.",
    soloOn: "{name}: en solo.",
    soloOff: "{name}: sin solo.",
    allOn: "Todas las pistas con sonido.",
  },
  status: {
    loadingAudio: "Cargando pistas de audio…",
    loadingProgress: "Cargando pistas de audio… {done}/{total}",
    ready: "Listo. Pulsa Reproducir o la barra espaciadora.",
    end: "Fin. Pulsa Reproducir para empezar de nuevo.",
    error: "Error: {message}",
  },
  notice: {
    buffering:
      "El vídeo aún está cargando. La música está en pausa en {time} y seguirá sola cuando el vídeo esté listo.",
    network:
      "El vídeo dejó de recibir datos (¿problema de red?). La música está en pausa en {time} y seguirá sola si vuelve la conexión; también puedes pulsar Reintentar.",
    seek: "El vídeo tarda demasiado en llegar a {time}. La música lo espera y seguirá sola; también puedes pulsar Reintentar.",
    frozen: "El vídeo se congeló. La música está en pausa en {time} y seguirá sola cuando el vídeo pueda continuar.",
    stuck: "El vídeo se congela una y otra vez. La música está en pausa en {time}. Pulsa Reintentar para volver a cargar el vídeo.",
    error: {
      network:
        "No se pudo cargar el vídeo por un error de red. Comprueba la conexión y pulsa Reintentar; la música seguirá desde {time}.",
      decode: "El navegador no pudo decodificar el vídeo. Pulsa Reintentar; si vuelve a pasar, recarga la página.",
      unsupported: "Este navegador no puede reproducir el archivo de vídeo (MP4, H.264). Prueba con otro navegador.",
      aborted: "Se interrumpió la carga del vídeo. Pulsa Reintentar para seguir desde {time}.",
      unknown: "El vídeo dejó de funcionar. Pulsa Reintentar para seguir desde {time}.",
      reload: "El vídeo sigue sin responder. Comprueba la conexión y vuelve a pulsar Reintentar.",
    },
    retrying: "Volviendo a cargar el vídeo…",
    recovered: "El vídeo vuelve a estar listo: sigue la reproducción.",
    loadFailed: "La demo no pudo arrancar: {message}. Comprueba la conexión y recarga la página.",
    retry: "Reintentar",
    reload: "Recargar la página",
  },
  errors: {
    fetch: "no se pudo cargar {url} (HTTP {status})",
    video: "no se pudo cargar el vídeo",
    shortStems: "pistas de audio más cortas de lo esperado: {ids}",
    manifest: "manifiesto de activos no válido: {problems}",
    timeline: "timeline no válido: {problems}",
  },
  problems: {
    manifest: {
      schema: "esquema desconocido: {value}",
      version: "versión no soportada: {value}",
      stems: "pistas inesperadas: {ids}",
      path: "ruta no relativa: {src}",
      video: "vídeo sin fps o frames",
      audio: "audio sin longitud",
      credits: "faltan los créditos del NASA SVS",
    },
    timeline: {
      schema: "esquema de timeline desconocido: {value}",
      version: "versión de timeline no soportada: {value}",
      channels: "canales inesperados: {ids}",
      notes: "timeline sin notas",
      noteTrack: "notas de una pista desconocida",
      fps: "fps del timeline {timeline} ≠ vídeo {video}",
      duration: "la música dura más que el audio",
      features: "features.t no tiene un valor por fotograma",
      metric: "medida {id} no marcada como proxy visual sin calibrar",
    },
  },
  debug: {
    summary: "Sincronía audio–vídeo (diagnóstico)",
    mean: "Desvío medio vídeo − audio (0,5 s): {value}",
    frame: "Último fotograma: {value} · máximo |desvío| en 10 s: {max}",
    note: "(a 30 fps cada fotograma se ve 33 ms: los valores por fotograma oscilan ±1/2 fotograma)",
    seeks: "Saltos de corrección: {seeks} · velocidad del vídeo: {rate}",
    latency: "Latencia de salida: {value}",
    decoded: "Pistas decodificadas: {value}",
    decodedValue: "{lengths} muestras (esperadas {expected}) a {rate} Hz",
    ms: "{value} ms",
  },
  regions: {
    title: "Lo que mide la imagen, por región",
    warning:
      "<strong>Todas estas medidas son proxies visuales sin calibrar.</strong> Se calculan a partir de los píxeles del vídeo (color y flujo óptico): no son temperaturas en °C, ni velocidades en m/s, ni vorticidad física. Se muestran por fotograma, sin el suavizado que usa la música. En este vídeo, las variaciones rápidas de movimiento aparente y turbulencia se deben sobre todo al ruido de compresión; el índice de color sí sigue las estaciones.",
    keys: "Pulsa en una gráfica para saltar a ese momento, o ponle el foco y usa las flechas (1 s), Re Pág / Av Pág (10 s) e Inicio / Fin.",
    picker: "Región (franja de latitud)",
    proxy: "Proxy visual · sin calibrar",
    now: "Ahora: {value} {unit}",
    valueText: "{time}: {value} ({unit})",
    range: "mín. {min} · máx. {max} {unit}",
    noData: "sin datos",
    noValue: "sin dato",
    unused: "No controla ningún instrumento: se muestra como contexto.",
    chords: "Acordes",
    use: "{who}: {effect}.",
    chartLabel:
      "{metric} en {region} a lo largo del vídeo: entre {min} y {max} ({unit}). Índice visual, no medición calibrada.",
    chartLabelEmpty: "{metric} en {region} a lo largo del vídeo: sin datos. Índice visual, no medición calibrada.",
    all: "todas las franjas",
    and: "{a} y {b}",
    names: {
      artico: "Ártico",
      norte_medio: "Latitudes medias norte",
      tropicos: "Trópicos",
      sur_medio: "Latitudes medias sur",
      antartico: "Antártico",
    },
  },
  map: {
    title: "Qué controla cada instrumento",
    intro:
      "Cada pista sigue una o varias de las medidas de arriba. Antes de convertirlas en notas se suavizan y se comparan con su propio rango: la música sigue cambios relativos, no valores absolutos.",
    harmony: "Acordes (todas las pistas)",
    harmonyDetail: "el director armónico",
    use: "{metric} ({regions}):",
    effect: "{effect}.",
  },
  effects: {
    acordes: {
      temp: "la diferencia norte − sur (las estaciones) elige, compás a compás, acordes oscuros o brillantes; con los más brillantes, las cuerdas suben una octava",
    },
    temperatura: {
      temp: "la media de las cinco franjas fija el volumen del acorde",
    },
    corrientes: {
      speed: "cada franja tiene su voz: suena cuando su movimiento supera el 45 % de su rango, y más fuerte cuanto más se mueve",
      temp: "sube o baja la nota de la franja (±5 semitonos; norte = agudo, sur = grave)",
      vort: "la media de las cinco franjas cambia el timbre (modulación)",
    },
    remolinos: {
      vort: "una campanada en cada pico de la franja (más de 1,6 desviaciones típicas sobre su mediana); más aguda cuanto más al norte",
    },
    ecuatorial: {
      u: "cuanto más hacia el oeste (valores negativos), más notas por compás y más fuertes",
    },
  },
  keys: {
    title: "Atajos de teclado",
    space: "Espacio",
    playPause: "Reproducir o pausar",
    step: "Retroceder o avanzar 5 s",
    home: "Inicio",
    end: "Fin",
    startEnd: "Ir al principio o al final",
    mute: "Silenciar o activar una pista",
    shift: "Mayús",
    solo: "Solo de una pista",
    reset: "Todas las pistas con sonido",
    note: "Con el foco en un botón, Espacio y Enter lo pulsan. En la barra de posición, el piano roll y las gráficas, las flechas, Inicio y Fin se mueven dentro de ese control. En campos de texto y desplegables no hay atajos.",
  },
  what: {
    title: "Qué estás oyendo",
    body:
      "Cada voz sigue un índice calculado a partir de los píxeles del vídeo (color, movimiento aparente, remolinos). Son <strong>índices visuales</strong>, no mediciones científicas calibradas. Lo que sí procede de NASA es la fecha del modelo de cada fotograma.",
  },
  data: {
    title: "Corrientes y temperatura del océano (ECCO2)",
    notice:
      "Proyecto para NASA Space Apps Challenge 2026. No está respaldado por NASA. Visualización de dominio público del NASA SVS.",
    disclaimer:
      "Las características son proxies visuales derivados de los píxeles del video (color y flujo óptico). No son mediciones físicas calibradas.",
    stems: {
      temperatura: { label: "Temperatura" },
      corrientes: { label: "Corrientes" },
      remolinos: { label: "Remolinos" },
      ecuatorial: { label: "Corriente ecuatorial" },
    },
    credits: {
      0: {
        role: "Visualización",
        text: "NASA/Goddard Space Flight Center Scientific Visualization Studio",
        detail: "Greg Shirah, Horace Mitchell (NASA/GSFC), Eric Sokolowsky (GST)",
      },
      1: {
        role: "Ciencia",
        text: "Modelo ECCO2 (MIT/JPL)",
        detail: "Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL)",
      },
      2: {
        role: "Música",
        text: "Generada por este proyecto a partir de índices visuales del video",
        detail: "Preview FM de 2 operadores (no es Dexed ni un DX7 real)",
      },
    },
    metrics: {
      temp: {
        label: "Índice de color frío-cálido",
        unit: "índice 0..1",
        derived_from: "tono (hue HSV) del píxel: azul = 0, rojo = 1",
        caveat: "Posición en la paleta de colores de la visualización, no temperatura en °C.",
      },
      speed: {
        label: "Movimiento aparente",
        unit: "px/frame",
        derived_from: "magnitud media del flujo óptico (Farneback)",
        caveat: "Depende de la resolución de análisis (--width) y del ritmo de la animación; no es velocidad en m/s.",
      },
      u: {
        label: "Movimiento aparente este-oeste",
        unit: "px/frame",
        derived_from: "componente horizontal del flujo óptico (+ = este)",
        caveat: "En proyección equirectangular un píxel horizontal abarca menos km cuanto más cerca del polo.",
      },
      v: {
        label: "Movimiento aparente norte-sur",
        unit: "px/frame",
        derived_from: "componente vertical del flujo óptico (+ = norte)",
        caveat: "Movimiento de las líneas dibujadas, no velocidad meridional física.",
      },
      vort: {
        label: "Turbulencia aparente",
        unit: "1/frame",
        derived_from: "valor absoluto del rotacional del flujo óptico",
        caveat: "Indicador de remolinos en la imagen, no vorticidad física en 1/s.",
      },
      cover: {
        label: "Cobertura de píxeles válidos",
        unit: "fracción 0..1",
        derived_from: "píxeles que pasan la máscara de saturación y brillo",
        caveat: "Fracción de píxeles coloreados, no fracción real de océano.",
      },
    },
  },
};
