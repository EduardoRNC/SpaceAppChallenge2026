// Anuncios accesibles, sin voz sintetizada.
//
// La página no habla: el texto aparece en pantalla y en una región aria-live.
// Así, las personas ciegas lo oyen con su propio lector de pantalla (Orca, NVDA,
// VoiceOver), con la voz y la velocidad que ya conocen, y la música no compite
// con una voz robótica.
// Decisión tomada tras la prueba del Paso 6: la voz del navegador sonaba robótica,
// tardaba demasiado y quitaba atención a la música.

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
