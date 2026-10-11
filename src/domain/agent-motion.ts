import * as THREE from 'three';
import { z } from 'zod';
import { evaluateTransform } from './animation';
import { cameraBasis } from './camera-space';
import { StoryPaceSchema, type AbacoProject, type AnimProperty, type Keyframe, type SceneObject, type StoryPace, type Vec3 } from './schema';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const target = z.union([vector, z.object({ elementId: z.string().uuid(), offset: vector.default([0, 0, 0]) })]);
const common = { sceneId: z.string().uuid(), elementId: z.string().uuid(), beatId: z.string().uuid().optional(), startOffsetFrames: z.number().int().nonnegative().default(0), pace: StoryPaceSchema.optional(), durationSeconds: z.number().positive().max(3600).optional(), replaceMotionId: z.string().uuid().optional() };

export const AgentMotionSchema = z.discriminatedUnion('motion', [
  z.object({ ...common, motion: z.literal('move_to'), target }),
  z.object({ ...common, motion: z.literal('move_by'), delta: vector, space: z.enum(['world', 'local', 'camera']).default('world') }),
  z.object({ ...common, motion: z.literal('rotate'), deltaDegrees: vector }),
  z.object({ ...common, motion: z.literal('look_at'), target }),
  z.object({ ...common, motion: z.literal('orbit'), target, angleDegrees: z.number().finite().min(-720).max(720) }),
]);
export type AgentMotion = z.infer<typeof AgentMotionSchema>;

const array = (value: THREE.Vector3): Vec3 => value.toArray() as Vec3;
const distance = (a: Vec3, b: Vec3) => new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
const cameraRotationToward = (position: Vec3, point: Vec3): Vec3 => {
  if (distance(position, point) < 1e-6) throw new Error('The camera coincides with the target.');
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...point));
  return [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3;
};
const unwrap = (start: Vec3, end: Vec3): Vec3 => end.map((angle, axis) => angle + 360 * Math.round((start[axis] - angle) / 360)) as Vec3;

function sceneRange(project: AbacoProject, sceneId: string) {
  const cuts = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  const index = cuts.findIndex((cut) => cut.id === sceneId);
  if (index < 0) throw new Error('Scene not found.');
  return { scene: cuts[index], end: (cuts[index + 1]?.frame ?? project.settings.frameEnd + 1) - 1 };
}

function pointAt(project: AbacoProject, value: z.infer<typeof target>, frame: number): Vec3 {
  if (Array.isArray(value)) return value as Vec3;
  const reference = project.objects.find((item) => item.id === value.elementId);
  if (!reference || reference.kind === 'audio') throw new Error('Target object not found.');
  return array(new THREE.Vector3(...evaluateTransform(reference, frame).position).add(new THREE.Vector3(...value.offset)));
}

function writeKey(object: SceneObject, frame: number, property: 'position' | 'rotation', value: Vec3, interpolation: 'linear' | 'constant', motionId: string) {
  const existing = object.keyframes.find((item) => item.frame === frame && item.property === property);
  const next: Keyframe = { id: existing?.id ?? crypto.randomUUID(), frame, property, value, interpolation, source: 'ai', purpose: 'motion', directionActionId: motionId, commentIds: [] };
  if (existing) Object.assign(existing, next); else object.keyframes.push(next);
}

const paceLimits: Record<StoryPace, { metersPerSecond: number; degreesPerSecond: number; orbitDegreesPerSecond: number; minimumSeconds: number }> = {
  snap: { metersPerSecond: 7, degreesPerSecond: 420, orbitDegreesPerSecond: 300, minimumSeconds: .16 },
  quick: { metersPerSecond: 4, degreesPerSecond: 260, orbitDegreesPerSecond: 180, minimumSeconds: .25 },
  normal: { metersPerSecond: 2.5, degreesPerSecond: 180, orbitDegreesPerSecond: 120, minimumSeconds: .4 },
  slow: { metersPerSecond: 1.2, degreesPerSecond: 80, orbitDegreesPerSecond: 60, minimumSeconds: .8 },
};

export function applyAgentMotion(project: AbacoProject, incoming: AgentMotion): { id: string; startFrame: number; endFrame: number; properties: AnimProperty[]; durationSeconds: number; pace: StoryPace; warnings: string[] } {
  const motion = AgentMotionSchema.parse(incoming);
  const { scene, end } = sceneRange(project, motion.sceneId);
  const beat = motion.beatId ? project.storyboard?.beats.find((item) => item.id === motion.beatId && item.sceneId === scene.id) : undefined;
  if (motion.beatId && !beat) throw new Error('Beat not found in this scene.');
  const pace = motion.pace ?? beat?.pace ?? 'quick';
  const limits = paceLimits[pace];
  const beatEnd = beat ? scene.frame + beat.startOffsetFrames + beat.durationFrames - 1 : end;
  const object = project.objects.find((item) => item.id === motion.elementId);
  if (!object || object.kind === 'audio' || object.kind.includes('light') || (object.kind !== 'camera' && object.sceneIds.length && !object.sceneIds.includes(scene.id))) throw new Error('Object is not animatable or not present in the scene.');
  if (motion.motion === 'orbit' && object.kind !== 'camera') throw new Error('Orbit is available for cameras.');
  if (motion.replaceMotionId) {
    let owned = object.keyframes.filter((item) => item.directionActionId === motion.replaceMotionId);
    if (!owned.length) {
      const drawn = object.keyframes.filter(key => key.purpose === 'motion' && !key.directionActionId && key.frame >= scene.frame && key.frame <= end && ['position', 'rotation', 'scale'].includes(key.property)).sort((a,b)=>a.frame-b.frame || a.property.localeCompare(b.property));
      if (drawn[0]?.id === motion.replaceMotionId) owned = drawn;
    }
    if (!owned.length || owned.some((item) => item.frame < scene.frame || item.frame > end)) throw new Error('Motion to adjust not found in this scene.');
    const ownedIds = new Set(owned.map(key=>key.id));
    object.keyframes = object.keyframes.filter((item) => !ownedIds.has(item.id));
    project.agentMotions = project.agentMotions?.filter((item) => item.id !== motion.replaceMotionId);
  }
  const startFrame = scene.frame + (beat?.startOffsetFrames ?? 0) + motion.startOffsetFrames;
  if (startFrame >= beatEnd) throw new Error('Motion must start before the scene or beat ends.');
  const start = evaluateTransform(object, startFrame);
  const point = 'target' in motion ? pointAt(project, motion.target, startFrame) : undefined;
  let delta = [0, 0, 0] as Vec3;
  if (motion.motion === 'move_to') delta = array(new THREE.Vector3(...point!).sub(new THREE.Vector3(...start.position)));
  if (motion.motion === 'move_by') {
    if (motion.space === 'world') delta = motion.delta;
    else if (motion.space === 'camera') {
      const camera = project.objects.find((item) => item.id === scene.cameraId);
      if (!camera) throw new Error('Scene camera not found.');
      const basis = cameraBasis(evaluateTransform(camera, startFrame).rotation);
      delta = array(basis.reduce((result, axis, index) => result.addScaledVector(axis, motion.delta[index]), new THREE.Vector3()));
    } else {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...start.rotation.map(THREE.MathUtils.degToRad) as Vec3));
      delta = array(new THREE.Vector3(...motion.delta).applyQuaternion(q));
    }
  }
  const amount = motion.motion === 'move_to' || motion.motion === 'move_by' ? Math.hypot(...delta)
    : motion.motion === 'rotate' ? Math.max(...motion.deltaDegrees.map(Math.abs))
    : motion.motion === 'orbit' ? Math.abs(motion.angleDegrees)
    : Math.max(...unwrap(start.rotation, cameraRotationToward(start.position, point!)).map((angle, axis) => Math.abs(angle - start.rotation[axis])));
  if (amount < 1e-6) throw new Error('Motion does not change position or orientation.');
  const suggestedSeconds = Math.max(limits.minimumSeconds, amount / (motion.motion === 'move_to' || motion.motion === 'move_by' ? limits.metersPerSecond : motion.motion === 'orbit' ? limits.orbitDegreesPerSecond : limits.degreesPerSecond));
  const seconds = motion.durationSeconds ?? suggestedSeconds;
  const endFrame = startFrame + Math.max(1, Math.round(seconds * project.settings.fps));
  if (endFrame > beatEnd) throw new Error(`Motion ends at frame ${endFrame}, beyond the ${beat ? 'beat' : 'scene'} (${beatEnd}). Reduce the duration or extend the scene.`);
  const warnings: string[] = [];
  const availableFrames = beatEnd - startFrame + 1;
  if (endFrame - startFrame > availableFrames * .6) warnings.push('Motion takes over 60% of the available time; check pacing in the preview.');
  if (motion.durationSeconds && seconds > suggestedSeconds * 1.8 && pace !== 'slow') warnings.push(`Explicit duration ${seconds.toFixed(2)} s, slower than the ${pace} suggested pace (${suggestedSeconds.toFixed(2)} s).`);
  const properties: Array<'position' | 'rotation'> = motion.motion === 'orbit' ? ['position', 'rotation'] : motion.motion === 'move_to' || motion.motion === 'move_by' ? ['position'] : ['rotation'];
  for (const property of properties) {
    const collision = object.keyframes.find((item) => item.property === property && item.frame > startFrame && item.frame < endFrame);
    if (collision) throw new Error(`Keyframe ${property} at frame ${collision.frame} in the motion. Adjust that segment before adding another.`);
  }
  const id = motion.replaceMotionId ?? crypto.randomUUID();
  for (const property of properties) writeKey(object, startFrame, property, start[property], 'linear', id);
  if (motion.motion === 'move_to' || motion.motion === 'move_by') {
    writeKey(object, endFrame, 'position', array(new THREE.Vector3(...start.position).add(new THREE.Vector3(...delta))), 'constant', id);
  } else if (motion.motion === 'rotate') {
    writeKey(object, endFrame, 'rotation', start.rotation.map((angle, index) => angle + motion.deltaDegrees[index]) as Vec3, 'constant', id);
  } else if (motion.motion === 'look_at') {
    writeKey(object, endFrame, 'rotation', unwrap(start.rotation, cameraRotationToward(start.position, pointAt(project, motion.target, endFrame))), 'constant', id);
  } else {
    const center = point!;
    const relative = new THREE.Vector3(...start.position).sub(new THREE.Vector3(...center));
    if (relative.length() < 1e-6) throw new Error('The camera coincides with the orbit center.');
    const steps = endFrame - startFrame;
    let previousRotation = start.rotation;
    for (let step = 1; step <= steps; step++) {
      const frame = startFrame + Math.round((endFrame - startFrame) * step / steps);
      if (frame <= startFrame) continue;
      const radians = THREE.MathUtils.degToRad(motion.angleDegrees * step / steps);
      const position = array(relative.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), radians).add(new THREE.Vector3(...pointAt(project, motion.target, frame))));
      const rotation = unwrap(previousRotation, cameraRotationToward(position, pointAt(project, motion.target, frame)));
      writeKey(object, frame, 'position', position, step === steps ? 'constant' : 'linear', id);
      writeKey(object, frame, 'rotation', rotation, step === steps ? 'constant' : 'linear', id);
      previousRotation = rotation;
    }
  }
  project.agentMotions = [...(project.agentMotions ?? []), { id, sceneId: scene.id, elementId: object.id, beatId: beat?.id, motion: motion.motion, pace, durationExplicit: motion.durationSeconds !== undefined, startFrame, endFrame, amount, warnings }];
  return { id, startFrame, endFrame, properties, durationSeconds: (endFrame - startFrame) / project.settings.fps, pace, warnings };
}
