export const ALIGNMENT_CAPTURE_PX = 16;
export const ALIGNMENT_RELEASE_PX = 28;
export type AlignmentTarget = { id: string; label: string; value: number; movingOffset: number; targetCoordinate: number };
export type AlignmentExtent = { min: number; center: number; max: number };

export function alignmentTargets(moving: AlignmentExtent, target: AlignmentExtent, id: string, label: string): AlignmentTarget[] {
  return ([['center', 'center'], ['min', 'min'], ['max', 'max'], ['max', 'min'], ['min', 'max']] as const).map(([from, to]) => ({
    id: `${id}:${from}:${to}`, label, value: target[to] - moving[from], movingOffset: moving[from], targetCoordinate: target[to],
  }));
}

/** A wider release band keeps a captured guide stable without preventing escape:
 * every sample must be measured from the raw pointer/gizmo position. */
export function snapAlignment(raw: number, targets: AlignmentTarget[], pixelsPerUnit: number, previous?: AlignmentTarget, bypass = false) {
  if (bypass || !Number.isFinite(raw)) return { value: raw, match: undefined };
  const scale = Math.max(.000001, pixelsPerUnit);
  const held = previous && targets.find(target => target.id === previous.id);
  if (held && Math.abs(raw - held.value) * scale <= ALIGNMENT_RELEASE_PX) return { value: held.value, match: held };
  let match: AlignmentTarget | undefined, distance = ALIGNMENT_CAPTURE_PX;
  for (const target of targets) {
    const next = Math.abs(raw - target.value) * scale;
    if (next <= distance && (!match || next < distance)) { match = target; distance = next; }
  }
  return { value: match?.value ?? raw, match };
}
