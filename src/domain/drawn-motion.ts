import type { Keyframe, SceneObject, Vec3 } from './schema';
import { compactSurfacePath, pathDistance, pathInterval, pathLengths, pointOnPath } from './surface-motion';

/** A stored interval is used only while both endpoint keys still match it. */
export function validPositionPath(previous: Keyframe, next: Keyframe): Vec3[] | undefined {
  const path = previous.positionPath;
  return path && previous.property === 'position' && next.property === 'position' && Array.isArray(previous.value) && Array.isArray(next.value) && pathDistance(path[0], previous.value as Vec3) < 1e-8 && pathDistance(path.at(-1)!, next.value as Vec3) < 1e-8 ? path : undefined;
}

export function isDrawnMotionTarget(object: SceneObject | undefined): object is SceneObject {
  return Boolean(object && object.kind !== 'camera' && object.kind !== 'audio' && !object.kind.includes('light') && !object.screenSpace);
}

/** Resample by distance, so a drawn path has a predictable duration and speed. */
export function motionPathFrames(points: Vec3[], startFrame: number, durationFrames: number, preserveSurface = false): Array<{ frame: number; position: Vec3; positionPath?: Vec3[] }> {
  if (!Number.isFinite(startFrame) || !Number.isFinite(durationFrames) || durationFrames <= 0 || points.length < 2 || !points.every(point => point.length === 3 && point.every(Number.isFinite))) return [];
  const count = Math.max(1, Math.min(7200, Math.round(durationFrames)));
  if (preserveSurface) {
    const path = compactSurfacePath(points);
    if (pathLengths(path).at(-1)! < 1e-8) return [];
    return [{ frame: startFrame, position: path[0], ...(path.length > 2 ? { positionPath: path } : {}) }, { frame: startFrame + count, position: path.at(-1)! }];
  }
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...points[i].map((value, axis) => value - points[i - 1][axis])));
  const total = lengths.at(-1)!;
  if (total < 1e-8) return [];
  let segment = 1;
  return Array.from({ length: count + 1 }, (_, index) => {
    const distance = total * index / count;
    while (segment < lengths.length - 1 && lengths[segment] < distance) segment++;
    const fraction = (distance - lengths[segment - 1]) / Math.max(1e-12, lengths[segment] - lengths[segment - 1]);
    const position = points[segment - 1].map((value, axis) => value + (points[segment][axis] - value) * fraction) as Vec3;
    return { frame: startFrame + index, position };
  });
}

/** Endpoints in normal view; a few significant controls when editing. Saved keys are untouched. */
export function motionHandleKeys<T extends { id: string; value: unknown }>(keys: T[], minimumDistance: number, selectedIds: string[] = [], editing = false): T[] {
  if (keys.length <= 2) return keys;
  const included = new Set([0, keys.length - 1]);
  keys.forEach((key, i) => { if (selectedIds.includes(key.id)) included.add(i); });
  if (editing) {
    // Greedy geometric error selection favors meaningful turns over evenly spaced frame markers.
    while (included.size < 6) {
      const indices = [...included].sort((a, b) => a - b); let best = -1, error = Math.max(minimumDistance, 1e-8);
      for (let k = 1; k < indices.length; k++) {
        const from = indices[k - 1], to = indices[k], a = keys[from].value as Vec3, b = keys[to].value as Vec3;
        const ab = b.map((v, i) => v - a[i]), denominator = ab.reduce((sum, v) => sum + v * v, 0);
        for (let i = from + 1; i < to; i++) {
          const p = keys[i].value as Vec3, t = denominator > 0 ? Math.max(0, Math.min(1, p.reduce((sum, v, axis) => sum + (v - a[axis]) * ab[axis], 0) / denominator)) : 0;
          const distance = pathDistance(p, a.map((v, axis) => v + ab[axis] * t) as Vec3);
          if (distance > error) { best = i; error = distance; }
        }
      }
      if (best < 0) break; included.add(best);
    }
  }
  return [...included].sort((a, b) => a - b).map(i => keys[i]);
}

/** Remap REC to the minimum curve, retaining each key's time, pauses and identity. */
export function recordedSurfaceSamples<T extends { id: string; progress: number }>(keys: T[], points: Vec3[]): Array<{ keyId: string; position: Vec3; positionPath?: Vec3[] }> {
  const lengths = pathLengths(points);
  return keys.map((key, i) => {
    const next = keys[i + 1], path = next && next.progress >= key.progress ? pathInterval(points, key.progress, next.progress, lengths) : undefined;
    return { keyId: key.id, position: pointOnPath(points, key.progress, lengths), ...(path && path.length > 2 ? { positionPath: path } : {}) };
  });
}
