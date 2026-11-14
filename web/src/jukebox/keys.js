// Atajos de teclado del jukebox.
//
// Las teclas que usa el elemento con el foco son suyas: Espacio y Enter en botones,
// enlaces y <summary>; flechas, Inicio y Fin en la barra de posición; todo en campos de
// texto, desplegables y elementos editables. El resto de atajos funcionan en toda la página.

const ACTIVATE = new Set([" ", "Enter"]);
const NAVIGATE = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const BUTTON_INPUTS = new Set(["button", "submit", "reset", "image"]);
const BUTTON_ROLES = new Set(["button", "link", "tab", "menuitem", "switch", "checkbox", "option"]);

/** Qué teclas se queda el elemento: "all", un Set de teclas, o null si ninguna. */
export function ownedKeys(target) {
  if (!target || typeof target !== "object") return null;
  if (target.isContentEditable) return "all";
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return "all";
  if (tag === "INPUT") {
    const type = String(target.type || "text").toLowerCase();
    if (type === "range") return NAVIGATE;
    if (type === "radio") return new Set([...ACTIVATE, ...NAVIGATE]);
    if (type === "checkbox" || BUTTON_INPUTS.has(type)) return ACTIVATE;
    return "all"; // texto, número, fecha, color…
  }
  if (tag === "BUTTON" || tag === "SUMMARY" || (tag === "A" && target.href)) return ACTIVATE;
  const role = target.getAttribute?.("role");
  if (role === "slider") return NAVIGATE;
  if (role === "textbox" || role === "combobox" || role === "listbox") return "all";
  if (BUTTON_ROLES.has(role)) return ACTIVATE;
  return null;
}

/**
 * Acción del atajo para un evento keydown (o null si no hay que hacer nada):
 * { type: "toggle" | "step" | "start" | "end" | "mute" | "solo" | "reset", ... }.
 */
export function shortcutFor(e, stemCount = 4) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  const owned = ownedKeys(e.target);
  if (owned === "all" || owned?.has(e.key)) return null;

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (e.shiftKey) return null;
    return { type: "step", direction: e.key === "ArrowLeft" ? -1 : 1 };
  }
  // El resto no se repite al mantener la tecla pulsada.
  if (e.repeat) return null;
  if (e.key === " " && !e.shiftKey) return { type: "toggle" };
  if (e.key === "Home") return { type: "start" };
  if (e.key === "End") return { type: "end" };
  const digit = /^Digit([0-9])$/.exec(e.code ?? "");
  if (digit) {
    const n = Number(digit[1]);
    if (n === 0) return e.shiftKey ? null : { type: "reset" };
    if (n <= stemCount) return { type: e.shiftKey ? "solo" : "mute", index: n - 1 };
  }
  return null;
}
