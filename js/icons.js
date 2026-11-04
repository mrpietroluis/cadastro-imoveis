// Ícones das ferramentas de desenho (traço de 1,75 em grade de 24 × 24, estilo CAD).
const P = {
  select: '<path d="M5 3l13 8-6 1.5L9 19z"/>',
  room: '<rect x="4" y="5" width="16" height="14"/><path d="M4 5h3M20 19h-3" stroke-width="3"/>',
  wall: '<path d="M3 9h18M3 15h18"/><path d="M6 9l4 6M11 9l4 6M16 9l4 6" stroke-width="1"/>',
  door: '<path d="M5 20V5h3M8 5a12 12 0 0 1 12 12"/><path d="M8 5v15" stroke-width="1"/>',
  window: '<rect x="3" y="9" width="18" height="6"/><path d="M3 12h18" stroke-width="1"/>',
  erase: '<path d="M14 4l6 6-9 9H6l-3-3z"/><path d="M8 10l6 6M3 21h18" stroke-width="1.2"/>',
  dim: '<path d="M4 17h16"/><path d="M4 13v8M20 13v8" stroke-width="1.2"/><path d="M3 18l2-2M19 18l2-2" stroke-width="1.2"/><path d="M8 9h8" stroke-width="1"/><path d="M10 6v3M14 6v3" stroke-width="1"/>',
  more: '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
  half: '<path d="M3 12h18"/><path d="M3 15h18" stroke-dasharray="2 2"/>',
  diag: '<rect x="4" y="5" width="16" height="14" stroke-width="1"/><path d="M4 19L20 5" stroke-width="2"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  north: '<circle cx="12" cy="12" r="8"/><path d="M12 4l3 9h-6z" fill="currentColor"/>',
  stair: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  column: '<rect x="7" y="7" width="10" height="10" fill="currentColor"/>',
  undo: '<path d="M9 7H5v4M5 7l5 5"/><path d="M5 7a9 9 0 1 1 3 11"/>',
  redo: '<path d="M15 7h4v4M19 7l-5 5"/><path d="M19 7a9 9 0 1 0-3 11"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M9 9l6 6M15 9l-6 6" stroke-width="1"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/>',
};

export function icon(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
  return tpl.content.firstChild;
}
