export const TRACKPAD_PAN_SENSITIVITY = 0.08;
export const TRACKPAD_ROTATE_SENSITIVITY = 0.001;
export const TRACKPAD_PINCH_SENSITIVITY = 0.0012;

// Lo spostamento segue il gesto fisico del trackpad: trascinare a destra o in
// alto deve portare la visuale nella stessa direzione percepita dall'utente.
export function trackpadCameraOffset(deltaX: number, deltaY: number) {
  return {
    horizontal: -deltaX * TRACKPAD_PAN_SENSITIVITY,
    vertical: deltaY * TRACKPAD_PAN_SENSITIVITY,
  };
}

export function normalizeWheelDelta(deltaX: number, deltaY: number, deltaMode: number, viewportHeight: number) {
  const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  return {
    x: Math.max(-160, Math.min(160, deltaX * multiplier)),
    y: Math.max(-160, Math.min(160, deltaY * multiplier)),
  };
}
