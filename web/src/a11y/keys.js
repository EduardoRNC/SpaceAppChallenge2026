// Atajos de teclado. Respetan los controles nativos: si el foco está en un campo,
// un botón o un deslizador, las teclas que ese control ya usa no se interceptan.

export const SHORTCUTS = [
  ["Espacio", "Reproducir o detener"],
  ["← / →", "Historia: saltar una década. Explorar: año anterior o siguiente"],
  ["↑ / ↓", "Cambiar la velocidad"],
  ["M", "Cambiar de modo (Historia, Explorar, Comparar)"],
  ["H", "Mostrar esta lista de atajos (también para el lector de pantalla)"],
];

function nativeHandles(target, key) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  const type = target.getAttribute("type");
  if (tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  if (tag === "INPUT" && type === "range") return key.startsWith("Arrow") || key === " ";
  if (tag === "INPUT" && (type === "radio" || type === "checkbox")) {
    return key === " " || key.startsWith("Arrow");
  }
  if (tag === "INPUT") return true;
  if (tag === "BUTTON" || tag === "A") return key === " " || key === "Enter";
  return false;
}

export function bindShortcuts(actions) {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (nativeHandles(e.target, e.key)) return;

    const handlers = {
      " ": actions.toggle,
      ArrowLeft: () => actions.step(-1),
      ArrowRight: () => actions.step(1),
      ArrowUp: () => actions.speed(1),
      ArrowDown: () => actions.speed(-1),
      m: actions.nextMode,
      h: actions.help,
    };
    const handler = handlers[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!handler) return;
    e.preventDefault();
    handler();
  });
}
