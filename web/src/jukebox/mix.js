// Mute y solo de las pistas del jukebox.
//
// Una pista suena si no está silenciada y, cuando alguna pista está en solo, si ella
// también lo está. Mute gana a solo, como en un mezclador.

export function initialStates(ids) {
  return ids.map((id) => ({ id, mute: false, solo: false }));
}

/** { id: 0 | 1 } para cada pista. */
export function gains(states) {
  const anySolo = states.some((s) => s.solo);
  return Object.fromEntries(
    states.map((s) => [s.id, !s.mute && (!anySolo || s.solo) ? 1 : 0]),
  );
}

/** Cambia `mute` o `solo` de una pista; devuelve estados nuevos. */
export function toggle(states, id, key) {
  return states.map((s) => (s.id === id ? { ...s, [key]: !s[key] } : s));
}

export function reset(states) {
  return states.map((s) => ({ ...s, mute: false, solo: false }));
}
