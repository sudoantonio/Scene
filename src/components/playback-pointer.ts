import type { ThreeEvent } from '@react-three/fiber';

let pending: { objectId: string; event: ThreeEvent<PointerEvent>; cleanup(): void } | undefined;

/** Transfer the same press from a playback instance to its ordinary editor mesh. */
export function queuePlaybackPointer(objectId: string, event: ThreeEvent<PointerEvent>) {
  pending?.cleanup();
  const cancel = (pointer: PointerEvent) => { if (pointer.pointerId === event.pointerId) clear(); };
  const clear = () => { pending?.cleanup(); pending = undefined; };
  const cleanup = () => {
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', clear);
  };
  pending = { objectId, event: { ...event, intersections: [] }, cleanup };
  window.addEventListener('pointerup', cancel); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', clear);
}
export function takePlaybackPointer(objectId: string) {
  if (pending?.objectId !== objectId) return undefined;
  const request = pending; request.cleanup(); pending = undefined; return request.event;
}
