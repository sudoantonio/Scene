const zoomKey = 'scene-interface-zoom';
export function interfaceZoom() {
  return Number(document.getElementById('root')?.style.zoom) || 1;
}

/** Page zoom for the editor, including the web preview's embedded browser. */
export function installInterfaceZoom() {
  const root = document.getElementById('root')!;
  const apply = (value: number) => {
    const zoom = Math.min(2, Math.max(.6, Math.round(value * 100) / 100));
    root.style.zoom = String(zoom);
    root.style.width = '100%';
    root.style.height = '100%';
    localStorage.setItem(zoomKey, String(zoom));
  };
  apply(Number(localStorage.getItem(zoomKey)) || 1.1);
  const keydown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    apply(event.key === '0' ? 1 : interfaceZoom() + (event.key === '-' ? -.1 : .1));
  };
  window.addEventListener('keydown', keydown, true);
  return () => window.removeEventListener('keydown', keydown, true);
}
