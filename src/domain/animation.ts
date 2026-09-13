import { defaultBackground, defaultCameraFraming, defaultLighting, type AbacoProject, type AnimProperty, type BlenderPlan, type Keyframe, type KeyframeValue, type SceneObject, type Transform, type Vec3 } from './schema';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ease = (t: number, mode: Keyframe['interpolation']) => mode === 'constant' ? 0 : mode === 'bezier' ? t * t * (3 - 2 * t) : t;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

export function evaluateProperty(object: SceneObject, property: AnimProperty, frame: number): KeyframeValue {
  const base: Record<AnimProperty, KeyframeValue> = {
    position: object.transform.position, rotation: object.transform.rotation, scale: object.transform.scale,
    visibility: object.visible, text: object.text, lens: object.camera.lens,
  };
  const keys = object.keyframes.filter((key) => key.property === property).sort((a, b) => a.frame - b.frame);
  if (!keys.length || frame < keys[0].frame) return base[property];
  const nextIndex = keys.findIndex((key) => key.frame > frame);
  if (nextIndex < 0) return keys[keys.length - 1].value;
  const previous = keys[nextIndex - 1];
  const next = keys[nextIndex];
  const t = ease(clamp01((frame - previous.frame) / (next.frame - previous.frame)), previous.interpolation);
  if (typeof previous.value === 'number' && typeof next.value === 'number') return mix(previous.value, next.value, t);
  if (!Array.isArray(previous.value) || !Array.isArray(next.value)) return previous.value;
  const previousVector = previous.value as Vec3;
  const nextVector = next.value as Vec3;
  if (property === 'position' && previous.interpolation === 'bezier' && (previous.purpose === 'motion' || next.purpose === 'motion')) {
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

export function planValue(operation: BlenderPlan['operations'][number]): KeyframeValue {
  if (operation.value.vector) return operation.value.vector;
  if (operation.value.boolean !== null) return operation.value.boolean;
  if (operation.value.text !== null) return operation.value.text;
  if (operation.value.number !== null) return operation.value.number;
  throw new Error(`L'operazione ${operation.id} non contiene un valore`);
}

export function validatePlan(project: AbacoProject, plan: BlenderPlan): string[] {
  const errors: string[] = [];
  const objectMap = new Map(project.objects.map((object) => [object.id, object]));
  const comments = new Set(project.comments.map((comment) => comment.id));
  const conflicts = new Set<string>();
  for (const op of plan.operations) {
    const object = objectMap.get(op.objectId);
    if (!object) errors.push(`${op.id}: oggetto inesistente`);
    if (op.frame < project.settings.frameStart || op.frame > project.settings.frameEnd) errors.push(`${op.id}: frame fuori intervallo`);
    if (op.type === 'set_camera_cut' && object?.kind !== 'camera') errors.push(`${op.id}: il taglio non riferisce una camera`);
    if (op.type === 'set_keyframe') {
      try {
        const value = planValue(op);
        if (op.property === 'scale' && (!Array.isArray(value) || value.some((n) => n <= 0))) errors.push(`${op.id}: scala non positiva`);
        if (op.property === 'lens' && (typeof value !== 'number' || value <= 0)) errors.push(`${op.id}: obiettivo non positivo`);
      } catch (error) { errors.push((error as Error).message); }
    }
    for (const id of op.commentIds) if (!comments.has(id)) errors.push(`${op.id}: commento inesistente ${id}`);
    const key = `${op.type}:${op.objectId}:${op.frame}:${op.property}`;
    if (conflicts.has(key)) errors.push(`${op.id}: operazione in conflitto`);
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
    const existing = object.keyframes.find((key) => key.frame === operation.frame && key.property === operation.property);
    const keyframe: Keyframe = {
      id: existing?.id ?? crypto.randomUUID(), frame: operation.frame, property: operation.property as AnimProperty,
      value: planValue(operation), interpolation: operation.interpolation, source: 'ai', purpose: 'motion', commentIds: operation.commentIds,
    };
    if (existing) Object.assign(existing, keyframe); else object.keyframes.push(keyframe);
  }
  const resolved = new Set(plan.operations.flatMap((operation) => operation.commentIds));
  next.comments.forEach((comment) => { if (resolved.has(comment.id)) comment.status = 'applied'; });
  next.updatedAt = new Date().toISOString();
  return next;
}
