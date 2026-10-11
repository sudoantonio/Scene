import * as THREE from 'three';
import { z } from 'zod';
import { evaluateProperty, evaluateTransform } from './animation';
import { applyAgentMotion } from './agent-motion';
import { createSceneObject, StoryPaceSchema, type AbacoProject, type Keyframe, type SceneObject, type StoryboardBeat, type Vec3 } from './schema';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const DirectActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('focus'), elementId: z.string().uuid(), framing: z.enum(['close', 'medium', 'wide']).default('medium'), transition: z.enum(['cut', 'push']).default('cut'), durationSeconds: z.number().positive().max(30).optional() }),
  z.object({ action: z.literal('focus_surface'), surface: z.enum(['tv', 'board']), framing: z.enum(['close', 'medium', 'wide']).default('medium') }),
  z.object({ action: z.literal('react'), elementId: z.string().uuid(), reaction: z.enum(['surprised', 'nod', 'bounce']), pace: StoryPaceSchema.optional() }),
  z.object({ action: z.literal('show_on_surface'), surface: z.enum(['tv', 'board', 'screen']), text: z.string().trim().min(1).max(2000).optional(), assetId: z.string().uuid().optional(), anchor: vector.optional(), name: z.string().trim().min(1).max(120).optional() }),
  z.object({ action: z.literal('enter'), elementId: z.string().uuid(), from: vector, to: vector, pace: StoryPaceSchema.optional(), durationSeconds: z.number().positive().max(30).optional() }),
  z.object({ action: z.literal('hold'), reason: z.string().trim().min(1).max(500) }),
]);
export type DirectAction = z.infer<typeof DirectActionSchema>;
export type DirectAsset = { id: string; kind: 'image' | 'video' | 'audio' | 'blend_asset' | 'model'; name: string; sourcePath: string; proxyPath?: string; aspectRatio?: number };

const findObject = (project: AbacoProject, id: string, beat: StoryboardBeat) => {
  const object = project.objects.find((item) => item.id === id);
  if (!object || object.kind === 'audio' || object.kind.includes('light') || (object.kind !== 'camera' && object.sceneIds.length && !object.sceneIds.includes(beat.sceneId))) throw new Error(`Object ${id} unavailable in the beat.`);
  return object;
};
const writeKey = (object: SceneObject, frame: number, property: 'position' | 'rotation' | 'scale' | 'visibility' | 'text' | 'lens', value: Keyframe['value'], motionId?: string) => {
  const existing = object.keyframes.find((item) => item.frame === frame && item.property === property);
  if (existing && existing.source === 'user') throw new Error(`Manual keyframe ${property} at frame ${frame}; move the beat or adjust the keyframe before applying direction.`);
  const next: Keyframe = { id: existing?.id ?? crypto.randomUUID(), frame, property, value, interpolation: property === 'visibility' || property === 'text' || property === 'lens' ? 'constant' : 'linear', source: 'ai', purpose: motionId ? 'motion' : 'snapshot', directionActionId: motionId, commentIds: [] };
  if (existing) Object.assign(existing, next); else object.keyframes.push(next);
};
const lookRotation = (from: Vec3, to: Vec3): Vec3 => {
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.position.set(...from);
  camera.lookAt(new THREE.Vector3(...to));
  return [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3;
};
const beatFrame = (project: AbacoProject, beat: StoryboardBeat) => project.cameraCuts.find((item) => item.id === beat.sceneId)!.frame + beat.startOffsetFrames;

function fitSurfaceText(text: string, surface: 'tv' | 'board' | 'screen', width?: number, height?: number): { text: string; scale: number } {
  if (surface === 'screen') return { text, scale: 1 };
  const displayText = text.replaceAll('→', '>').replaceAll('↑', '+').replaceAll('↓', '-');
  const maxChars = surface === 'tv' ? 12 : 24;
  const maxWidth = width ? width * .82 : surface === 'tv' ? 1.15 : 3.4;
  const maxHeight = height ? Math.min(height * .72, surface === 'tv' ? .7 : 2.4) : surface === 'tv' ? .7 : 1.5;
  const lines: string[] = [];
  for (const paragraph of displayText.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && `${line} ${word}`.length > maxChars) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  const contentWidth = Math.max(1, ...lines.map((line) => line.length)) * .6;
  const contentHeight = Math.max(1, lines.length) * 1.2;
  return { text: lines.join('\n'), scale: Math.min(1, maxWidth / contentWidth, maxHeight / contentHeight) };
}

function surfaceAnchor(project: AbacoProject, beat: StoryboardBeat, surface: 'tv' | 'board' | 'screen', explicit?: Vec3): { position: Vec3; normal?: Vec3; width?: number; height?: number } {
  if (explicit) return { position: explicit };
  if (surface === 'screen') return { position: [0, 0, 0] };
  const scene = project.cameraCuts.find((item) => item.id === beat.sceneId)!;
  const matcher = surface === 'tv' ? /\bTV\b|televis/i : /lavagna|whiteboard|blackboard/i;
  const landmark = scene.background.landmarks?.find((item) => matcher.test(item.name));
  if (landmark) return landmark;
  const object = project.objects.find((item) => (item.sceneIds.length === 0 || item.sceneIds.includes(scene.id)) && matcher.test(item.name));
  if (object) return { position: evaluateTransform(object, beatFrame(project, beat)).position };
  throw new Error(`Surface ${surface} not found. Select a background with landmarks or supply anchor [x,y,z].`);
}

export function applyDirectBeat(project: AbacoProject, beatId: string, rawActions: DirectAction[], assets: DirectAsset[] = []) {
  const beat = project.storyboard?.beats.find((item) => item.id === beatId);
  if (!beat) throw new Error('Beat not found. Save the storyboard with scene_set_storyboard first.');
  const scene = project.cameraCuts.find((item) => item.id === beat.sceneId)!;
  const start = beatFrame(project, beat);
  const end = start + beat.durationFrames - 1;
  const camera = findObject(project, scene.cameraId, beat);
  const results: Array<{ action: string; objectId?: string; motionIds?: string[]; warning?: string }> = [];
  for (const raw of rawActions) {
    const action = DirectActionSchema.parse(raw);
    if (action.action === 'hold') { results.push({ action: 'hold', warning: action.reason }); continue; }
    if (action.action === 'focus_surface') {
      const surface = surfaceAnchor(project, beat, action.surface);
      if (!surface.normal || !surface.width || !surface.height) throw new Error(`Surface ${action.surface} has no dimensions or orientation. Choose the set GLB with scene_choose_assets.`);
      const aspect = project.settings.resolutionX / project.settings.resolutionY;
      const lens = evaluateProperty(camera, 'lens', start) as number;
      const verticalHalfAngle = Math.atan((36 / aspect) / (2 * lens));
      const horizontalHalfAngle = Math.atan(36 / (2 * lens));
      const fitDistance = Math.max(surface.height / (2 * Math.tan(verticalHalfAngle)), surface.width / (2 * Math.tan(horizontalHalfAngle)));
      const multiplier = { close: 1.08, medium: 1.35, wide: 1.7 }[action.framing];
      const desired = new THREE.Vector3(...surface.position).addScaledVector(new THREE.Vector3(...surface.normal), fitDistance * multiplier).toArray() as Vec3;
      writeKey(camera, start, 'position', desired);
      writeKey(camera, start, 'rotation', lookRotation(desired, surface.position));
      results.push({ action: 'focus_surface', objectId: camera.id });
      continue;
    }
    if (action.action === 'focus') {
      const target = findObject(project, action.elementId, beat);
      const point = evaluateTransform(target, start).position;
      const current = evaluateTransform(camera, start).position;
      const direction = new THREE.Vector3(...current).sub(new THREE.Vector3(...point));
      if (direction.lengthSq() < 1e-6) direction.set(0, -1, .3);
      direction.normalize();
      const distance = { close: 3.2, medium: 6, wide: 10 }[action.framing];
      const desired = new THREE.Vector3(...point).addScaledVector(direction, distance).toArray() as Vec3;
      writeKey(camera, start, 'rotation', lookRotation(current, point));
      if (action.transition === 'cut') {
        writeKey(camera, start, 'position', desired);
        writeKey(camera, start, 'rotation', lookRotation(desired, point));
        results.push({ action: 'focus', objectId: camera.id });
      } else {
        const moved = applyAgentMotion(project, { motion: 'move_to', sceneId: beat.sceneId, elementId: camera.id, beatId, startOffsetFrames: 0, target: desired, pace: beat.pace, durationSeconds: action.durationSeconds });
        results.push({ action: 'focus', objectId: camera.id, motionIds: [moved.id], warning: moved.warnings.join(' ') || undefined });
      }
      continue;
    }
    if (action.action === 'react') {
      const object = findObject(project, action.elementId, beat);
      const pace = action.pace ?? beat.pace;
      const duration = { snap: .3, quick: .55, normal: .85, slow: 1.4 }[pace];
      const finish = Math.min(end, start + Math.max(2, Math.round(duration * project.settings.fps)));
      if (finish - start < 2) throw new Error('Beat too short for a reaction.');
      const middle = start + Math.floor((finish - start) / 2);
      const property = action.reaction === 'bounce' ? 'position' : 'rotation';
      if (object.keyframes.some((item) => item.property === property && item.frame > start && item.frame < finish)) throw new Error('The reaction would overlap existing keyframes.');
      const baseline = evaluateTransform(object, start)[property];
      const peak = [...baseline] as Vec3;
      if (action.reaction === 'surprised') peak[2] += 16;
      else if (action.reaction === 'nod') peak[0] += 13;
      else peak[2] += .3;
      const id = crypto.randomUUID();
      writeKey(object, start, property, baseline, id);
      writeKey(object, middle, property, peak, id);
      writeKey(object, finish, property, baseline, id);
      project.agentMotions = [...(project.agentMotions ?? []), { id, sceneId: beat.sceneId, elementId: object.id, beatId, motion: property === 'position' ? 'move_by' : 'rotate', pace, durationExplicit: false, startFrame: start, endFrame: finish, amount: action.reaction === 'bounce' ? .3 : action.reaction === 'nod' ? 13 : 16, warnings: [] }];
      results.push({ action: 'react', objectId: object.id, motionIds: [id] });
      continue;
    }
    if (action.action === 'enter') {
      const object = findObject(project, action.elementId, beat);
      writeKey(object, start, 'position', action.from);
      const moved = applyAgentMotion(project, { motion: 'move_to', sceneId: beat.sceneId, elementId: object.id, beatId, startOffsetFrames: 0, target: action.to, pace: action.pace ?? beat.pace, durationSeconds: action.durationSeconds });
      results.push({ action: 'enter', objectId: object.id, motionIds: [moved.id], warning: moved.warnings.join(' ') || undefined });
      continue;
    }
    if (Boolean(action.text) === Boolean(action.assetId)) throw new Error('Specify text or assetId for the surface.');
    const asset = action.assetId ? assets.find((item) => item.id === action.assetId && ['image', 'video'].includes(item.kind)) : undefined;
    if (action.assetId && !asset) throw new Error('Image or video not authorized for the surface.');
    const object = createSceneObject(asset ? 'plane' : 'text', project.objects.length + 1);
    object.name = action.name ?? `${action.surface === 'tv' ? 'TV' : action.surface === 'board' ? 'Lavagna' : 'Schermo'} • ${asset?.name ?? action.text!.slice(0, 32)}`;
    object.sceneIds = [scene.id];
    object.screenSpace = action.surface === 'screen';
    const surface = action.surface === 'screen' ? undefined : surfaceAnchor(project, beat, action.surface, action.anchor);
    const fitted = action.text ? fitSurfaceText(action.text, action.surface, surface?.width, surface?.height) : undefined;
    object.text = fitted?.text ?? '';
    object.color = action.surface === 'board' ? '#17212a' : '#ffffff';
    if (asset) { object.asset.sourcePath = asset.sourcePath; object.asset.proxyPath = asset.proxyPath ?? asset.sourcePath; object.asset.previewScale = asset.aspectRatio ?? 1; }
    if (action.surface === 'screen') object.transform.position = [0, 0, 0];
    else {
      const anchor = surface!;
      const cameraPosition = evaluateTransform(camera, start).position;
      const normal = anchor.normal ? new THREE.Vector3(...anchor.normal) : new THREE.Vector3(...cameraPosition).sub(new THREE.Vector3(...anchor.position)).normalize();
      const towardCamera = action.anchor ? new THREE.Vector3() : normal.clone().multiplyScalar(.08);
      object.transform.position = new THREE.Vector3(...anchor.position).add(towardCamera).toArray() as Vec3;
      object.transform.rotation = anchor.normal ? lookRotation(object.transform.position, anchor.position) : evaluateTransform(camera, start).rotation;
      const size = fitted?.scale ?? Math.min((anchor.width ?? (action.surface === 'tv' ? 1.15 : 3.4)) / 2, (anchor.height ?? (action.surface === 'tv' ? .7 : 1.5)) / 2) * .85;
      object.transform.scale = [size, size, size];
    }
    if (start > project.settings.frameStart) writeKey(object, project.settings.frameStart, 'visibility', false);
    writeKey(object, start, 'position', object.transform.position);
    writeKey(object, start, 'rotation', object.transform.rotation);
    writeKey(object, start, 'scale', object.transform.scale);
    writeKey(object, start, 'visibility', true);
    if (object.kind === 'text') writeKey(object, start, 'text', object.text);
    if (end < project.settings.frameEnd) writeKey(object, end + 1, 'visibility', false);
    project.objects.push(object);
    results.push({ action: 'show_on_surface', objectId: object.id });
  }
  return results;
}
