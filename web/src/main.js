import * as Tone from "tone";

const status = document.getElementById("status");

// Paso 1: solo comprobamos que la app arranca y que Tone.js carga.
status.textContent = `Listo. Motor de audio Tone.js ${Tone.version} cargado.`;
