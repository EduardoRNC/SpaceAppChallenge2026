// Intro breve en inglés antes de la Historia: qué significa cada capa del sonido.
// Cada pista trae sus propias frases (track.intro); INTRO_STEPS es la de temperatura.
// Cada frase se dice MIENTRAS suena su ejemplo (no después), para que dure poco:
// unos 15 s en total. Se puede saltar en cualquier momento.

export const INTRO_STEPS = [
  { text: "Low drone: the 1951 to 1980 average.", demo: "reference" },
  { text: "Melody: higher means warmer.", demo: "pitch" },
  { text: "Quick notes: the twelve months.", demo: "months" },
  { text: "Heartbeat: faster means hotter.", demo: "pulse" },
  { text: "Tense rub: extreme heat.", demo: "tension" },
  { text: "Shimmer: the colour of the spiral.", demo: "frames" },
  { text: "Bell: a record hot year.", demo: "record" },
  { text: "Tick: a new decade.", demo: "ticks" },
];

/**
 * @param engine    motor de sonido (con demo(kind))
 * @param voice     voz en inglés (createVoice)
 * @param captions  función que muestra el texto y lo envía al lector de pantalla
 * @param isCancelled  devuelve true para saltar la intro
 */
export async function playIntro({ engine, voice, captions, isCancelled, steps = INTRO_STEPS }) {
  for (const step of steps) {
    if (isCancelled()) return false;
    captions(step.text);
    await Promise.all([engine.demo(step.demo), voice.speak(step.text)]);
  }
  return !isCancelled();
}
