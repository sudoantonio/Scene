import { pathLengths } from './surface-motion';
import { validPositionPath } from './drawn-motion';
import { z } from 'zod';
import * as THREE from 'three';
import { evaluateProperty, evaluateTransform } from './animation';
import { AgentMotionSchema, applyAgentMotion } from './agent-motion';
import { DirectActionSchema, applyDirectBeat } from './agent-direct';
import {
  createProject, createSceneObject, defaultBackground, defaultCameraFraming, defaultLighting,
  isValidAnimationValue, ProjectSchema, StoryboardBeatSchema, type AbacoProject, type AnimProperty, type KeyframeValue,
  type SceneObject, type Vec3,
} from './schema';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const transform = z.object({ position: vector.optional(), rotation: vector.optional(), scale: vector.optional() });
const camera = z.object({ position: vector, rotation: vector.optional(), target: vector.optional(), lens: z.number().positive().optional() }).refine((value) => value.rotation || value.target, 'Specifica rotation o target.');
const lighting = z.object({ preset: z.enum(['neutral', 'soft', 'warm', 'dramatic']).optional(), intensity: z.number().min(0).max(2).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
const base = z.object({ expectedRevision: z.number().int().nonnegative() });
export const IncomingStoryboardBeatSchema = StoryboardBeatSchema.omit({ id: true }).extend({ id: z.string().uuid().optional() });

export const AgentCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_project'), name: z.string().trim().min(1).max(120), fps: z.number().int().min(1).max(120).default(24), width: z.number().int().positive().default(1920), height: z.number().int().positive().default(1080) }),
  z.object({ type: z.literal('add_scene'), name: z.string().trim().min(1).max(120), durationFrames: z.number().int().min(6).max(21600), camera: camera.optional(), lighting: lighting.optional() }),
  z.object({ type: z.literal('update_scene'), sceneId: z.string().uuid(), name: z.string().trim().min(1).max(120).optional(), durationFrames: z.number().int().min(6).max(21600).optional(), camera: camera.optional(), lighting: lighting.optional() }),
  z.object({ type: z.literal('add_element'), sceneId: z.string().uuid(), kind: z.enum(['cube', 'sphere', 'cylinder', 'cone', 'plane', 'text', 'image', 'video', 'audio', 'blend_asset', 'area_light', 'point_light', 'sun_light']), name: z.string().trim().min(1).max(120), assetId: z.string().uuid().optional(), text: z.string().max(10000).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), screenSpace: z.boolean().optional(), transform: transform.optional() }),
  z.object({ type: z.literal('update_element'), elementId: z.string().uuid(), name: z.string().trim().min(1).max(120).optional(), text: z.string().max(10000).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), visible: z.boolean().optional(), transform: transform.optional() }),
  z.object({ type: z.literal('animate'), sceneId: z.string().uuid(), elementId: z.string().uuid(), property: z.enum(['position', 'rotation', 'scale', 'visibility', 'text', 'lens']), keys: z.array(z.object({ offsetFrames: z.number().int().nonnegative(), value: z.unknown(), interpolation: z.enum(['constant', 'linear', 'bezier']).default('linear') })).min(1).max(100) }),
  z.object({ type: z.literal('motion'), spec: AgentMotionSchema }),
  z.object({ type: z.literal('set_storyboard'), script: z.string().max(100000), beats: z.array(IncomingStoryboardBeatSchema).max(500) }),
  z.object({ type: z.literal('update_story_beat'), beatId: z.string().uuid(), startOffsetFrames: z.number().int().nonnegative().optional(), durationFrames: z.number().int().positive().optional(), dialogue: z.string().max(10000).optional(), intention: z.string().trim().min(1).max(2000).optional(), visualAction: z.string().trim().min(1).max(4000).optional(), emotion: z.string().max(120).optional(), focusElementId: z.string().uuid().nullable().optional(), surface: z.enum(['none', 'tv', 'board', 'screen']).optional(), pace: z.enum(['snap', 'quick', 'normal', 'slow']).optional() }),
  z.object({ type: z.literal('direct_beat'), beatId: z.string().uuid(), actions: z.array(DirectActionSchema).min(1).max(20) }),
  z.object({ type: z.literal('set_scene_note'), sceneId: z.string().uuid(), text: z.string().max(20000) }),
  z.object({ type: z.literal('set_scene_background'), sceneId: z.string().uuid(), assetId: z.string().uuid() }),
]);
export const AgentRequestSchema = base.extend({ commands: z.array(AgentCommandSchema).min(1).max(100) });
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export type AgentAsset = {
  id: string; kind: 'image' | 'video' | 'audio' | 'blend_asset' | 'model'; name: string; sourcePath: string;
  landmarks?: Array<{ name: string; position: Vec3; normal?: Vec3; width?: number; height?: number }>;
  proxyPath?: string; duration?: number; aspectRatio?: number; collectionName?: string;
  boundsCenter?: Vec3; previewScale?: number; groundOffset?: number;
  controllers?: SceneObject['asset']['controllers'];
};

const key = (object: SceneObject, frame: number, property: AnimProperty, value: KeyframeValue, interpolation: 'constant' | 'linear' | 'bezier' = 'constant') => {
  if (!isValidAnimationValue(property, value)) throw new Error(`Invalid value for ${property}.`);
  const existing = object.keyframes.find((item) => item.frame === frame && item.property === property);
  if (existing) Object.assign(existing, { value, interpolation, source: 'ai' as const });
  else object.keyframes.push({ id: crypto.randomUUID(), frame, property, value, interpolation, source: 'ai', commentIds: [] });
};
const scenes = (project: AbacoProject) => project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
const sceneAndEnd = (project: AbacoProject, id: string) => {
  const ordered = scenes(project);
  const index = ordered.findIndex((scene) => scene.id === id);
  if (index < 0) throw new Error(`Scene not found: ${id}`);
  return { scene: ordered[index], end: ordered[index + 1]?.frame ?? project.settings.frameEnd + 1 };
};
const setCamera = (project: AbacoProject, sceneId: string, value: z.infer<typeof camera>) => {
  const { scene } = sceneAndEnd(project, sceneId);
  const object = project.objects.find((item) => item.id === scene.cameraId && item.kind === 'camera');
  if (!object) throw new Error('Scene camera not found.');
  object.transform.position = value.position;
  let rotation = value.rotation;
  if (value.target) {
    const cameraObject = new THREE.PerspectiveCamera();
    cameraObject.position.set(...value.position);
    cameraObject.up.set(0, 0, 1);
    cameraObject.lookAt(new THREE.Vector3(...value.target));
    rotation = [cameraObject.rotation.x, cameraObject.rotation.y, cameraObject.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3;
  }
  object.transform.rotation = rotation!;
  if (value.lens) object.camera.lens = value.lens;
  key(object, scene.frame, 'position', value.position);
  key(object, scene.frame, 'rotation', rotation!);
  key(object, scene.frame, 'lens', object.camera.lens);
  if (value.target) scene.framing = { target: value.target, distance: Math.hypot(...value.position.map((n, i) => n - value.target![i])) };
};
const setLighting = (project: AbacoProject, sceneId: string, value: z.infer<typeof lighting>) => {
  const { scene } = sceneAndEnd(project, sceneId);
  scene.lighting = { ...scene.lighting, ...value };
};

export function applyAgentCommands(current: AbacoProject, commands: AgentCommand[], assets: AgentAsset[] = []): AbacoProject {
  let project = structuredClone(current);
  for (const raw of commands) {
    const command = AgentCommandSchema.parse(raw);
    if (command.type === 'create_project') {
      project = createProject();
      project.name = command.name;
      Object.assign(project.settings, { fps: command.fps, resolutionX: command.width, resolutionY: command.height, frameEnd: command.fps * 3 });
      continue;
    }
    if (command.type === 'add_scene') {
      const blank = project.cameraCuts.length === 1 && project.objects.length === 1 && project.cameraCuts[0].name === 'Scene 1' && project.settings.frameEnd === project.settings.fps * 3;
      let sceneId: string;
      if (blank) {
        const first = project.cameraCuts[0];
        first.name = command.name;
        first.source = 'ai';
        project.settings.frameEnd = command.durationFrames;
        sceneId = first.id;
      } else {
        const frame = project.settings.frameEnd + 1;
        const shotCamera = createSceneObject('camera', project.objects.filter((item) => item.kind === 'camera').length + 1);
        project.objects.push(shotCamera);
        const cut = { id: crypto.randomUUID(), cameraId: shotCamera.id, frame, source: 'ai' as const, commentIds: [], name: command.name, transition: 'cut' as const, lighting: defaultLighting(), background: defaultBackground(), framing: defaultCameraFraming() };
        project.cameraCuts.push(cut);
        project.settings.frameEnd += command.durationFrames;
        sceneId = cut.id;
      }
      if (command.camera) setCamera(project, sceneId, command.camera);
      if (command.lighting) setLighting(project, sceneId, command.lighting);
      continue;
    }
    if (command.type === 'update_scene') {
      const { scene, end } = sceneAndEnd(project, command.sceneId);
      if (command.name) scene.name = command.name;
      if (command.durationFrames !== undefined) {
        const delta = command.durationFrames - (end - scene.frame);
        if (delta) {
          for (const cut of project.cameraCuts) if (cut.frame >= end) cut.frame += delta;
          for (const object of project.objects) {
            for (const item of object.keyframes) if (item.frame >= end) item.frame += delta;
            for (const note of object.sceneNotes) if (note.frame >= end) note.frame += delta;
            for (const controller of object.asset.controllerKeys ?? []) if (controller.frame >= end) controller.frame += delta;
          }
          for (const note of project.comments) {
            if (note.startFrame >= end) note.startFrame += delta;
            if (note.endFrame >= end) note.endFrame += delta;
          }
          project.settings.frameEnd += delta;
        }
      }
      if (command.camera) setCamera(project, command.sceneId, command.camera);
      if (command.lighting) setLighting(project, command.sceneId, command.lighting);
      continue;
    }
    if (command.type === 'set_scene_background') {
      const { scene } = sceneAndEnd(project, command.sceneId);
      const asset = assets.find((item) => item.id === command.assetId);
      if (!asset || asset.kind !== 'model') throw new Error(`Unauthorized background model: ${command.assetId}`);
      scene.background = { kind: 'model', path: asset.sourcePath, name: asset.name, landmarks: asset.landmarks };
      continue;
    }
    if (command.type === 'set_storyboard') {
      project.storyboard = { script: command.script, beats: command.beats.map((beat) => StoryboardBeatSchema.parse({ ...beat, id: beat.id ?? crypto.randomUUID() })) };
      continue;
    }
    if (command.type === 'update_story_beat') {
      const beat = project.storyboard?.beats.find((item) => item.id === command.beatId);
      if (!beat) throw new Error('Beat to adjust not found.');
      const { type: _type, beatId: _beatId, ...changes } = command;
      Object.assign(beat, { ...changes, focusElementId: changes.focusElementId === null ? undefined : changes.focusElementId ?? beat.focusElementId });
      continue;
    }
    if (command.type === 'direct_beat') {
      applyDirectBeat(project, command.beatId, command.actions, assets);
      continue;
    }
    if (command.type === 'add_element') {
      const { scene, end } = sceneAndEnd(project, command.sceneId);
      const asset = command.assetId ? assets.find((item) => item.id === command.assetId) : undefined;
      const required = ['image', 'video', 'audio', 'blend_asset'].includes(command.kind);
      if (required && (!asset || (command.kind === 'blend_asset' ? !['blend_asset', 'model'].includes(asset.kind) : asset.kind !== command.kind))) throw new Error(`Asset not selected or incompatible: ${command.assetId ?? command.kind}`);
      const kind = command.kind === 'image' || command.kind === 'video' ? 'plane' : command.kind;
      const object = createSceneObject(kind, project.objects.length + 1);
      object.name = command.name;
      object.sceneIds = kind === 'audio' ? [] : [scene.id];
      object.screenSpace = command.screenSpace ?? (kind === 'text');
      if (command.text !== undefined) object.text = command.text;
      if (command.color) object.color = command.color;
      if (asset) {
        object.asset.sourcePath = asset.sourcePath;
        object.asset.proxyPath = asset.proxyPath ?? asset.sourcePath;
        object.asset.collectionName = asset.collectionName ?? '';
        object.asset.previewScale = asset.previewScale ?? asset.aspectRatio ?? 1;
        object.asset.groundOffset = asset.groundOffset ?? 0;
        object.asset.boundsCenter = asset.boundsCenter ?? [0, 0, 0];
        object.asset.controllers = asset.controllers;
        object.asset.duration = asset.duration;
        if (kind === 'audio') object.audio.duration = asset.duration ?? (end - scene.frame) / project.settings.fps;
      }
      if (command.transform) Object.assign(object.transform, command.transform);
      if (kind === 'plane' && !object.screenSpace && !command.transform) {
        object.transform.position = [0, 0, 1.5];
        object.transform.rotation = [90, 0, 0];
      }
      object.visible = kind !== 'audio';
      if (scene.frame > project.settings.frameStart) key(object, project.settings.frameStart, 'visibility', false);
      key(object, scene.frame, 'position', object.transform.position);
      key(object, scene.frame, 'rotation', object.transform.rotation);
      key(object, scene.frame, 'scale', object.transform.scale);
      key(object, scene.frame, 'visibility', true);
      if (kind === 'text') key(object, scene.frame, 'text', object.text);
      if (end <= project.settings.frameEnd) key(object, end, 'visibility', false);
      project.objects.push(object);
      continue;
    }
    if (command.type === 'update_element') {
      const object = project.objects.find((item) => item.id === command.elementId);
      if (!object) throw new Error(`Object not found: ${command.elementId}`);
      if (command.name) object.name = command.name;
      if (command.color) object.color = command.color;
      const firstFrame = object.sceneIds.length ? sceneAndEnd(project, object.sceneIds[0]).scene.frame : project.settings.frameStart;
      if (command.text !== undefined) { object.text = command.text; if (object.kind === 'text') key(object, firstFrame, 'text', command.text); }
      if (command.visible !== undefined) object.visible = command.visible;
      if (command.transform) {
        Object.assign(object.transform, command.transform);
        for (const property of ['position', 'rotation', 'scale'] as const) if (command.transform[property]) key(object, firstFrame, property, object.transform[property]);
      }
      continue;
    }
    if (command.type === 'motion') {
      applyAgentMotion(project, command.spec);
      continue;
    }
    if (command.type === 'animate') {
      const { scene, end } = sceneAndEnd(project, command.sceneId);
      const object = project.objects.find((item) => item.id === command.elementId);
      if (!object || (object.kind !== 'camera' && object.sceneIds.length > 0 && !object.sceneIds.includes(scene.id))) throw new Error('Object not present in the scene.');
      const sorted = [...command.keys].sort((a, b) => a.offsetFrames - b.offsetFrames);
      if (sorted[0].offsetFrames > 0) {
        const start = scene.frame;
        const startValue = evaluateProperty(object, command.property, start);
        key(object, start, command.property, startValue, sorted[0].interpolation);
      }
      for (const item of sorted) {
        const frame = scene.frame + item.offsetFrames;
        if (frame >= end) throw new Error(`The keyframe ${item.offsetFrames} exceeds the scene duration.`);
        key(object, frame, command.property, item.value as KeyframeValue, item.interpolation);
      }
      continue;
    }
    const { scene } = sceneAndEnd(project, command.sceneId);
    const existing = project.comments.find((item) => item.sceneId === scene.id && item.scope === 'scene');
    if (existing) existing.text = command.text || ' '; else if (command.text) project.comments.push({ id: crypto.randomUUID(), text: command.text, targetIds: [], startFrame: scene.frame, endFrame: scene.frame, status: 'pending', scope: 'scene', sceneId: scene.id });
  }
  project.updatedAt = new Date().toISOString();
  return ProjectSchema.parse(project);
}

export function agentSummary(project: AbacoProject) {
  const ordered = scenes(project);
  const motions = new Map<string, { id: string; elementId: string; name: string; startFrame: number; endFrame: number; properties: AnimProperty[] }>();
  for (const object of project.objects) for (const item of object.keyframes) {
    if (!item.directionActionId || item.purpose !== 'motion') continue;
    const current = motions.get(item.directionActionId);
    if (current) {
      current.startFrame = Math.min(current.startFrame, item.frame);
      current.endFrame = Math.max(current.endFrame, item.frame);
      if (!current.properties.includes(item.property)) current.properties.push(item.property);
    } else motions.set(item.directionActionId, { id: item.directionActionId, elementId: object.id, name: object.name, startFrame: item.frame, endFrame: item.frame, properties: [item.property] });
  }
  // User-drawn and REC paths also have stable IDs, without rewriting their keys.
  const drawnRecords = new Map<string, { sceneId: string; motion: 'move_to'; amount: number; pace: 'normal'; durationExplicit: boolean; warnings: string[] }>();
  for (const object of project.objects) for (let index = 0; index < ordered.length; index++) {
    const scene = ordered[index], end = ordered[index + 1]?.frame ?? project.settings.frameEnd + 1;
    const keys = object.keyframes.filter(key => key.purpose === 'motion' && !key.directionActionId && key.frame >= scene.frame && key.frame < end && ['position', 'rotation', 'scale'].includes(key.property)).sort((a,b)=>a.frame-b.frame || a.property.localeCompare(b.property));
    if (new Set(keys.map(key=>key.frame)).size < 2) continue;
    const id = keys[0].id, positions = keys.filter(key=>key.property==='position');
    let amount = 0;
    for (let point = 1; point < positions.length; point++) {
      const path = validPositionPath(positions[point-1], positions[point]) ?? [positions[point-1].value as Vec3, positions[point].value as Vec3];
      amount += pathLengths(path).at(-1) ?? 0;
    }
    motions.set(id, { id, elementId: object.id, name: object.name, startFrame: keys[0].frame, endFrame: keys.at(-1)!.frame, properties: [...new Set(keys.map(key=>key.property))] });
    drawnRecords.set(id, { sceneId: scene.id, motion: 'move_to', amount, pace: 'normal', durationExplicit: true, warnings: [] });
  }
  const motionRecords = new Map((project.agentMotions ?? []).map((item) => [item.id, item]));
  return {
    projectId: project.id, name: project.name, fps: project.settings.fps,
    resolution: [project.settings.resolutionX, project.settings.resolutionY],
    motions: [...motions.values()].map((motion) => {
      const record = motionRecords.get(motion.id) ?? drawnRecords.get(motion.id);
      const durationSeconds = (motion.endFrame - motion.startFrame) / project.settings.fps;
      return { ...motion, durationSeconds, pace: record?.pace, beatId: record && 'beatId' in record ? record.beatId : undefined, motion: record?.motion, amount: record?.amount, speedPerSecond: record && durationSeconds ? record.amount / durationSeconds : undefined, speedUnit: record ? ['move_to', 'move_by'].includes(record.motion) ? 'm/s' : '°/s' : undefined, durationExplicit: record?.durationExplicit, warnings: record?.warnings ?? [] };
    }),
    scenes: ordered.map((scene, index) => ({ id: scene.id, name: scene.name, startFrame: scene.frame, durationFrames: (ordered[index + 1]?.frame ?? project.settings.frameEnd + 1) - scene.frame, cameraId: scene.cameraId, background: scene.background.name || undefined,
      elements: project.objects.filter((object) => object.kind !== 'camera' && (object.sceneIds.length === 0 || object.sceneIds.includes(scene.id))).map((object) => ({ id: object.id, name: object.name, kind: object.kind, transform: evaluateTransform(object, scene.frame), asset: object.asset.sourcePath ? object.asset.sourcePath.split('/').at(-1) : undefined })) })),
  };
}
