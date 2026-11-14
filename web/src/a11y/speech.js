// Anuncios accesibles.
//
// Los mensajes no se hablan: el texto aparece en pantalla y en una región aria-live.
// Así, las personas ciegas lo oyen con su propio lector de pantalla (Orca, NVDA,
// VoiceOver), con la voz y la velocidad que ya conocen, y la música no compite
// con una voz robótica.
// Decisión tomada tras la prueba del Paso 6: la voz del navegador sonaba robótica,
// tardaba demasiado y quitaba atención a la música. La única excepción es la intro
// breve en inglés (createVoice), que se pidió después y se puede saltar.

export function createAnnouncer({ liveRegion, visibleLog }) {
  return {
    /** Muestra el texto y lo envía al lector de pantalla. */
    say(text) {
      visibleLog.textContent = text;
      // Se vacía antes para que el lector lo repita aunque el texto no cambie.
      liveRegion.textContent = "";
      requestAnimationFrame(() => {
        liveRegion.textContent = text;
      });
    },
  };
}

/** 0.61 → "más 0,61 °C" (texto pensado para leerse bien con lector de pantalla). */
export function spokenValue(v, unit = "°C") {
  const sign = v > 0.004 ? "más " : v < -0.004 ? "menos " : "";
  const abs = Math.abs(v).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${abs} ${unit}`;
}

// --- Voz en inglés para la intro (Paso 7) -----------------------------------------
// Se usa solo en la intro breve antes de la Historia. Se prefieren las voces más
// naturales que ofrezca el sistema; en Linux suele haber solo espeak-ng.

const PREFERRED_VOICES = [/natural/i, /google/i, /samantha/i, /microsoft/i, /daniel/i, /karen/i];

function pickEnglishVoice(synth) {
  const english = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
  for (const pattern of PREFERRED_VOICES) {
    const match = english.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return english.find((v) => /en-(us|gb)/i.test(v.lang)) ?? english[0] ?? null;
}

export function createVoice() {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  let voice = null;
  const refresh = () => {
    if (synth) voice = pickEnglishVoice(synth);
  };
  refresh();
  synth?.addEventListener?.("voiceschanged", refresh);

  return {
    get available() {
      return Boolean(synth && voice);
    },
    /** Habla y resuelve al terminar (con un tiempo máximo por si `onend` no llega). */
    speak(text) {
      if (!synth || !voice) return Promise.resolve();
      return new Promise((resolve) => {
        const fallback = setTimeout(resolve, Math.max(1200, text.length * 80));
        const done = () => {
          clearTimeout(fallback);
          resolve();
        };
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = 1.1;
        u.onend = done;
        u.onerror = done;
        synth.cancel();
        synth.speak(u);
      });
    },
    cancel() {
      synth?.cancel();
    },
  };
}
