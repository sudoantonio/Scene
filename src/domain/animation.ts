import { defaultBackground, defaultCameraFraming, defaultLighting, isValidAnimationValue, type AbacoProject, type AnimProperty, type BlenderPlan, type Keyframe, type KeyframeValue, type SceneObject, type Transform, type Vec3 } from './schema';

import { validPositionPath } from './drawn-motion';
import { pathLengths, pointOnPath } from './surface-motion';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ease = (t: number, mode: Keyframe['interpolation']) => mode === 'constant' ? 0 : mode === 'bezier' ? t * t * (3 - 2 * t) : t;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

export function evaluateProperty(object: SceneObject, property: AnimProperty, frame: number): KeyframeValue {
  const keys = object.keyframes.filter((key) => key.property === property).sort((a, b) => a.frame - b.frame);
  return evaluateTrack(object, property, frame, keys);
}

function evaluateTrack(object: SceneObject, property: AnimProperty, frame: number, keys: Keyframe[], lengths?: (path: Vec3[]) => number[]): KeyframeValue {
  const base: Record<AnimProperty, KeyframeValue> = {
    position: object.transform.position, rotation: object.transform.rotation, scale: object.transform.scale,
    visibility: object.visible, text: object.text, lens: object.camera.lens,
  };
  if (!keys.length || frame < keys[0].frame) return base[property];
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  let low = 0, high = keys.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (keys[middle].frame <= frame) low = middle + 1;
    else high = middle;
  }
  const nextIndex = low;
  const previous = keys[nextIndex - 1];
  const next = keys[nextIndex];
  const holdUntil = Math.min(next.frame, previous.frame + (previous.holdFrames ?? 0));
  if (frame <= holdUntil) return previous.value;
  const segmentT = clamp01((frame - holdUntil) / Math.max(1, next.frame - holdUntil));
  // A camera segment must be completely defined by its two visible keyframes.
  // Spatial Catmull-Rom also considers neighbouring points and can therefore
  // introduce an unrequested rise, dip or lateral overshoot between them.
  const useSpatialSpline = object.kind !== 'camera'
    && property === 'position'
    && previous.interpolation === 'bezier'
    && (previous.purpose === 'motion' || next.purpose === 'motion');
  // Catmull-Rom already supplies a continuous tangent through motion points.
  // Applying smoothstep too would force velocity to zero at every keyframe.
  const t = useSpatialSpline ? segmentT : ease(segmentT, previous.interpolation);
  if (typeof previous.value === 'number' && typeof next.value === 'number') return mix(previous.value, next.value, t);
  if (!Array.isArray(previous.value) || !Array.isArray(next.value)) return previous.value;
  const previousVector = previous.value as Vec3;
  const nextVector = next.value as Vec3;
  const surfacePath = property === 'position' && previous.interpolation !== 'constant' ? validPositionPath(previous, next) : undefined;
  if (surfacePath) return pointOnPath(surfacePath, ease(segmentT, previous.interpolation), lengths?.(surfacePath));
  if (useSpatialSpline) {
    const before = (keys[Math.max(0, nextIndex - 2)].value as Vec3) ?? previousVector;
    const afterCandidate = keys[Math.min(keys.length - 1, nextIndex + 1)];
    const after = afterCandidate?.purpose === 'motion' ? afterCandidate.value as Vec3 : nextVector;
    return previousVector.map((_, index) => catmullRom(before[index], previousVector[index], nextVector[index], after[index], t)) as Vec3;
  }
  return previousVector.map((value, index) => mix(value, nextVector[index], t)) as Vec3;
}

export function evaluateTransform(object: SceneObject, frame: number): Transform {
  return {
    position: evaluateProperty(object, 'position', frame) as Vec3,
    rotation: evaluateProperty(object, 'rotation', frame) as Vec3,
    scale: evaluateProperty(object, 'scale', frame) as Vec3,
  };
}

const properties: AnimProperty[] = ['position', 'rotation', 'scale', 'visibility', 'text', 'lens'];
type RenderAnimation = {
  keys: Keyframe[]; count: number; tracks: Record<AnimProperty, Keyframe[]>;
  values: Partial<Record<AnimProperty, { frame: number; value: KeyframeValue }>>;
  transform?: { frame: number; value: Transform }; lengths: WeakMap<Vec3[], number[]>;
};
const renderAnimations = new WeakMap<SceneObject, RenderAnimation>();

/** Renderer inputs are published project snapshots. Editing uses the uncached
 * evaluator above so mutations while constructing a new snapshot stay valid. */
function renderAnimation(object: SceneObject): RenderAnimation {
  const current = renderAnimations.get(object);
  if (current?.keys === object.keyframes && current.count === object.keyframes.length) return current;
  const tracks: Record<AnimProperty, Keyframe[]> = { position: [], rotation: [], scale: [], visibility: [], text: [], lens: [] };
  for (const key of object.keyframes) tracks[key.property].push(key);
  for (const property of properties) tracks[property].sort((a, b) => a.frame - b.frame);
  const compiled: RenderAnimation = { keys: object.keyframes, count: object.keyframes.length, tracks, values: {}, lengths: new WeakMap() };
  renderAnimations.set(object, compiled); return compiled;
}

export function evaluateRenderProperty(object: SceneObject, property: AnimProperty, frame: number): KeyframeValue {
  const compiled = renderAnimation(object), cached = compiled.values[property];
  if (cached?.frame === frame) return cached.value;
  const value = evaluateTrack(object, property, frame, compiled.tracks[property], path => {
    let lengths = compiled.lengths.get(path);
    if (!lengths) { lengths = pathLengths(path); compiled.lengths.set(path, lengths); }
    return lengths;
  });
  compiled.values[property] = { frame, value }; return value;
}

export function evaluateRenderTransform(object: SceneObject, frame: number): Transform {
  const compiled = renderAnimation(object);
  if (compiled.transform?.frame === frame) return compiled.transform.value;
  const value = { position: evaluateRenderProperty(object, 'position', frame) as Vec3, rotation: evaluateRenderProperty(object, 'rotation', frame) as Vec3, scale: evaluateRenderProperty(object, 'scale', frame) as Vec3 };
  compiled.transform = { frame, value }; return value;
}

/** Keep static meshes on the same React props until a key boundary is crossed.
 * Video and rigged assets keep their real clock, including external rig keys. */
export function renderAnimationFrame(object: SceneObject, frame: number): number {
  if ((object.kind === 'blend_asset' && object.asset.controllerKeys?.length) || (object.kind === 'plane' && /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(object.asset.sourcePath))) return frame;
  const { tracks } = renderAnimation(object);
  let epoch = 0;
  for (const property of properties) {
    const keys = tracks[property];
    let low = 0, high = keys.length;
    while (low < high) { const middle = (low + high) >> 1; if (keys[middle].frame <= frame) low = middle + 1; else high = middle; }
    const previous = keys[low - 1], next = keys[low];
    if (!previous) continue;
    epoch = Math.max(epoch, previous.frame);
    if (next && previous.interpolation !== 'constant' && frame > Math.min(next.frame, previous.frame + (previous.holdFrames ?? 0)) && (typeof previous.value === 'number' || Array.isArray(previous.value))) return frame;
  }
  return epoch;
}

export function planValue(operation: BlenderPlan['operations'][number]): KeyframeValue {
  if (operation.value.vector) return operation.value.vector;
  if (operation.value.boolean !== null) return operation.value.boolean;
  if (operation.value.text !== null) return operation.value.text;
  if (operation.value.number !== null) return operation.value.number;
  throw new Error(`Operation ${operation.id} has no value`);
}

export function validatePlan(project: AbacoProject, plan: BlenderPlan): string[] {
  const errors: string[] = [];
  const objectMap = new Map(project.objects.map((object) => [object.id, object]));
  const comments = new Set(project.comments.map((comment) => comment.id));
  const conflicts = new Set<string>();
  for (const op of plan.operations) {
    const object = objectMap.get(op.objectId);
    if (!object) errors.push(`${op.id}: object not found`);
    if (op.frame < project.settings.frameStart || op.frame > project.settings.frameEnd) errors.push(`${op.id}: frame out of range`);
    if (op.type === 'set_camera_cut' && object?.kind !== 'camera') errors.push(`${op.id}: the cut does not reference a camera`);
    if (op.type === 'set_controller_pose') {
      if (op.property !== 'controller_pose' || !op.controllerName || !op.value.vector) errors.push(`${op.id}: invalid character pose`);
      if (object?.kind !== 'blend_asset' || !object.asset.controllers?.some((controller) => controller.name === op.controllerName)) errors.push(`${op.id}: character control not found`);
    }
    if (op.type === 'set_keyframe') {
      try {
        const value = planValue(op);
        if (!isValidAnimationValue(op.property, value)) errors.push(`${op.id}: invalid value for ${op.property}`);
        if (op.property === 'scale' && (!Array.isArray(value) || value.some((n) => n <= 0))) errors.push(`${op.id}: non-positive scale`);
        if (op.property === 'lens' && (typeof value !== 'number' || value <= 0)) errors.push(`${op.id}: non-positive lens`);
      } catch (error) { errors.push((error as Error).message); }
    }
    for (const id of op.commentIds) if (!comments.has(id)) errors.push(`${op.id}: comment not found ${id}`);
    const key = `${op.type}:${op.objectId}:${op.frame}:${op.property}:${op.controllerName ?? ''}`;
    if (conflicts.has(key)) errors.push(`${op.id}: conflicting operation`);
    conflicts.add(key);
  }
  return errors;
}

export function applyPlan(project: AbacoProject, plan: BlenderPlan): AbacoProject {
  const errors = validatePlan(project, plan);
  if (errors.length) throw new Error(errors.join('\n'));
  const next = structuredClone(project);
  for (const operation of plan.operations) {
    if (operation.type === 'set_camera_cut') {
      const existing = next.cameraCuts.find((cut) => cut.frame === operation.frame);
      const cut = { id: crypto.randomUUID(), cameraId: operation.objectId, frame: operation.frame, source: 'ai' as const, commentIds: operation.commentIds, lighting: defaultLighting(), background: defaultBackground(), framing: defaultCameraFraming() };
      if (existing) Object.assign(existing, cut, { id: existing.id }); else next.cameraCuts.push(cut);
      continue;
    }
    const object = next.objects.find((item) => item.id === operation.objectId)!;
    if (operation.type === 'set_controller_pose') {
      const keys = object.asset.controllerKeys ?? (object.asset.controllerKeys = []);
      const existing = keys.find((key) => key.name === operation.controllerName && key.frame === operation.frame);
      const value = operation.value.vector!;
      if (existing?.source === 'user' || (existing && !existing.source)) continue;
      if (existing) Object.assign(existing, { offset: value, source: 'ai' as const, directionActionId: operation.directionActionId, interpolation: operation.interpolation });
      else keys.push({ name: operation.controllerName!, frame: operation.frame, offset: value, source: 'ai', directionActionId: operation.directionActionId, interpolation: operation.interpolation });
      continue;
    }
    const existing = object.keyframes.find((key) => key.frame === operation.frame && key.property === operation.property);
    const keyframe: Keyframe = {
      id: existing?.id ?? crypto.randomUUID(), frame: operation.frame, property: operation.property as AnimProperty,
      value: planValue(operation), interpolation: operation.interpolation, source: 'ai', purpose: 'motion', commentIds: operation.commentIds, directionActionId: operation.directionActionId,
    };
    if (existing) Object.assign(existing, keyframe); else object.keyframes.push(keyframe);
  }
  const resolved = new Set(plan.operations.flatMap((operation) => operation.commentIds));
  next.comments.forEach((comment) => { if (resolved.has(comment.id)) comment.status = 'applied'; });
  next.updatedAt = new Date().toISOString();
  return next;
}
