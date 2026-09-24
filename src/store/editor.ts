import { resolvePresets } from '../domain/direction-presets';
import { create } from 'zustand';
import * as THREE from 'three';
import { createProject, createSceneObject, defaultBackground, defaultCameraFraming, defaultLighting, isValidAnimationValue, ProjectSchema, type AbacoProject, type AnimProperty, type BackgroundSettings, type BlenderPlan, type Interpolation, type KeyframeValue, type LightingSettings, type ObjectKind, type SceneObject, type TimelineCommentScope, type Transform, type Vec3 } from '../domain/schema';
import { applyPlan, evaluateProperty, evaluateTransform } from '../domain/animation';
import { groundedPositionZ } from '../domain/ground';

type RecordingSession = {
  sceneId: string;
  startFrame: number;
  touchedObjectIds: string[];
  changed: boolean;
  lastMotion?: { objectId: string; sceneId: string };
  beforeProject: AbacoProject;
  lastFixedFrames: Record<string, number>;
  endpointFrames: Record<string, number>;
  endpointKeyIds: Record<string, string[]>;
};

type EditorState = {
  project: AbacoProject;
  projectPath?: string;
  selectedId?: string;
  currentFrame: number;
  isPlaying: boolean;
  cameraView: boolean;
  setCameraView(value: boolean): void;
  jevStroke: { active: boolean; points: [number, number][]; viewMode?: 'camera' | 'free'; viewRotation?: Vec3; viewPosition?: Vec3; verticalFovDegrees?: number; aspect?: number };
  setJevStrokeActive(active: boolean): void;
  setJevStrokePoints(points: [number, number][]): void;
  setJevStrokeContext(viewMode: 'camera' | 'free', viewRotation: Vec3, viewPosition: Vec3, verticalFovDegrees: number, aspect: number): void;
  clearJevStroke(): void;
  selectedMotion?: { objectId: string; sceneId: string; keyframeId?: string };
  recordingMotion?: { objectId: string; sceneId: string; startFrame: number; provisionalFrame?: number };
  recordingSession?: RecordingSession;
  interpolation: Interpolation;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  past: AbacoProject[];
  future: AbacoProject[];
  dirty: boolean;
  newProject(): void;
  loadProject(project: AbacoProject, path: string): void;
  markSaved(project: AbacoProject, path: string): void;
  select(id?: string): void;
  setFrame(frame: number): void;
  setPlaying(value: boolean): void;
  selectMotion(selection?: { objectId: string; sceneId: string; keyframeId?: string }): void;
  setInterpolation(value: Interpolation): void;
  setGizmoMode(value: 'translate' | 'rotate' | 'scale'): void;
  addObject(kind: ObjectKind): void;
  addScreenImage(asset: { sourcePath: string; dataUrl: string; name: string }): void;
  addAudio(asset: { sourcePath: string; name: string; duration: number; waveform: number[] }): void;
  addBlendAsset(asset: { sourcePath: string; proxyPath: string; collectionName: string; name: string; boundsCenter: Vec3; previewScale: number; groundOffset: number }): void;
  replaceObject(id: string, replacement: { kind: ObjectKind; name?: string; text?: string; screenSpace?: boolean; asset?: SceneObject['asset'] }): void;
  addShot(): void;
  splitScene(): void;
  deleteScene(id: string): void;
  resizeScene(id: string, durationFrames: number): void;
  setTransitionMode(objectId: string, sceneId: string, mode: Interpolation): void;
  startMotion(objectId: string, sceneId: string): void;
  stopMotion(): void;
  startRecording(sceneId: string): void;
  stopRecording(): void;
  removeSelected(): void;
  updateObject(id: string, patch: Record<string, unknown>): void;
  setSceneNote(id: string, text: string): void;
  setAnimationStandard(standard: AbacoProject['animationStandard']): void;
  updateSettings(patch: Partial<AbacoProject['settings']>): void;
  updateLighting(patch: Partial<LightingSettings>): void;
  updateBackground(background: BackgroundSettings, sceneId?: string): void;
  resetFraming(): void;
  setCameraFraming(sceneId: string, position: Vec3, rotation: Vec3, target: Vec3): void;
  reorderObjects(sourceId: string, targetId: string): void;
  deleteObject(id: string): void;
  duplicateObjectsToScene(objectIds: string[], sceneId: string): string[];
  resizeObjectPresence(objectId: string, sceneId: string, startFrame: number, endFrame: number): void;
  deleteObjectFromScene(objectId: string, sceneId: string): void;
  deleteMotionFromScene(objectId: string, sceneId: string): void;
  setTransform(id: string, transform: Transform): void;
  alignObjectToGround(id: string): void;
  keyPose(id: string): void;
  updateMotionPoint(objectId: string, keyframeId: string, position: Vec3): void;
  insertMotionPoint(objectId: string, sceneId: string, frame: number, position: Vec3): string | undefined;
  setMotionPointHold(objectId: string, keyframeId: string, holdFrames: number): void;
  moveMotionPoint(objectId: string, keyframeId: string, frame: number): void;
  resizeMotionRange(objectId: string, sceneId: string, startFrame: number, endFrame: number): void;
  deleteMotionPoint(objectId: string, keyframeId: string): void;
  keyProperty(id: string, property: 'visibility' | 'text'): void;
  deleteKeyframe(objectId: string, keyframeId: string): void;
  setTimelineComment(scope: TimelineCommentScope, sceneId: string, text: string, objectId?: string): void;
  addTransitionComment(fromSceneId: string, toSceneId: string, text: string): void;
  addCameraCut(): void;
  acceptPlan(plan: BlenderPlan): void;
  acceptJevPlan(plan: BlenderPlan, sceneId: string): void;
  undo(): void;
  redo(): void;
};

const snapshot = (project: AbacoProject) => structuredClone(project);
const normalizeProjectData = (project: AbacoProject) => {
  const next = snapshot(project);
  for (const object of next.objects) {
    if (object.kind === 'camera') {
      let reference = object.transform.rotation;
      const rotationKeys = object.keyframes.filter((key) => key.property === 'rotation' && Array.isArray(key.value)).sort((a, b) => a.frame - b.frame);
      for (const key of rotationKeys) {
        const raw = key.value as Vec3;
        const continuous = raw.map((angle, axis) => Math.abs(angle) <= 180
          ? angle + 360 * Math.round((reference[axis] - angle) / 360)
          : angle) as Vec3;
        key.value = continuous;
        reference = continuous;
      }
    }
    if (object.kind === 'audio') {
      object.audio.muted = false;
      object.audio.loop = false;
      object.audio.trimStart = 0;
      object.audio.trimEnd = object.audio.duration;
      object.audio.fadeIn = 0;
      object.audio.fadeOut = 0;
      const firstAudible = object.keyframes.filter((key) => key.property === 'visibility' && key.value === true).sort((a, b) => a.frame - b.frame)[0]?.frame ?? next.settings.frameStart;
      const audioEnd = firstAudible + Math.max(1, Math.round(object.audio.duration * next.settings.fps));
      object.sceneIds = [];
      object.visible = false;
      object.keyframes = object.keyframes.filter((key) => key.property !== 'visibility');
      if (firstAudible > next.settings.frameStart) putKey(object, next.settings.frameStart, 'visibility', false, 'constant');
      putKey(object, firstAudible, 'visibility', true, 'constant');
      putKey(object, audioEnd, 'visibility', false, 'constant');
      next.settings.frameEnd = Math.max(next.settings.frameEnd, audioEnd - 1);
      continue;
    }
    if (object.kind !== 'plane') continue;
    object.transform.scale = [THREE.MathUtils.clamp(object.transform.scale[0], .05, 12), THREE.MathUtils.clamp(object.transform.scale[1], .05, 12), 1];
    for (const key of object.keyframes) {
      if (key.property === 'scale' && Array.isArray(key.value)) key.value = [THREE.MathUtils.clamp(key.value[0], .05, 12), THREE.MathUtils.clamp(key.value[1], .05, 12), 1];
    }
  }
  const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  for (let index = 1; index < scenes.length; index += 1) {
    const boundary = scenes[index].frame;
    for (const object of next.objects) {
      if (object.kind === 'camera' || object.kind.includes('light')) continue;
      const spansBoundary = !object.sceneIds.length || (object.sceneIds.includes(scenes[index - 1].id) && object.sceneIds.includes(scenes[index].id));
      if (!spansBoundary || !evaluateProperty(object, 'visibility', boundary - 1) || evaluateProperty(object, 'visibility', boundary)) continue;
      const resume = object.keyframes
        .filter((key) => key.property === 'visibility' && key.frame > boundary && key.frame <= boundary + 2 && key.value === true)
        .sort((a, b) => a.frame - b.frame)[0];
      if (!resume) continue;
      object.keyframes = object.keyframes.filter((key) => !(key.property === 'visibility' && key.frame === boundary && key.value === false));
      resume.frame = boundary;
    }
  }
  return next;
};
const LOCAL_DRAFT_KEY = 'abaco-animatic-project-v1';
const flushPendingCameraEdit = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('abaco:flush-camera-edit'));
};
const initialProject = () => {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCAL_DRAFT_KEY);
    return saved ? normalizeProjectData(ProjectSchema.parse(JSON.parse(saved))) : createProject();
  } catch {
    return createProject();
  }
};

const sceneStarts = (project: AbacoProject) => [...new Set(project.cameraCuts.map((cut) => cut.frame))].sort((a, b) => a - b);
const activeSceneStart = (project: AbacoProject, frame: number) => sceneStarts(project).filter((start) => start <= frame).at(-1) ?? project.settings.frameStart;
const sceneRange = (project: AbacoProject, sceneId: string) => {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return undefined;
  return { scene: scenes[index], end: scenes[index + 1]?.frame ?? project.settings.frameEnd + 1 };
};
const putKey = (object: SceneObject, frame: number, property: AnimProperty, value: KeyframeValue, interpolation: Interpolation = 'constant', preserveInterpolation = false, purpose: 'snapshot' | 'motion' = 'snapshot') => {
  const existing = object.keyframes.find((key) => key.frame === frame && key.property === property);
  const data = { value: structuredClone(value), interpolation, source: 'user' as const, purpose, commentIds: [] };
  if (existing) {
    Object.assign(existing, preserveInterpolation ? { ...data, interpolation: existing.interpolation } : data);
    return existing;
  }
  const key = { id: crypto.randomUUID(), frame, property, ...data };
  object.keyframes.push(key);
  return key;
};

const putMotionKey = (object: SceneObject, sceneFrame: number, frame: number, property: AnimProperty, value: KeyframeValue, interpolation: Interpolation) => {
  const key = putKey(object, frame, property, value, interpolation, false, 'motion');
  const previous = object.keyframes
    .filter((key) => key.property === property && key.frame >= sceneFrame && key.frame < frame)
    .sort((a, b) => b.frame - a.frame)[0];
  if (previous) previous.interpolation = interpolation;
  return key;
};

const RECORDING_SAMPLE_INTERVAL = 12;
const recordingProperties = ['position', 'rotation', 'scale'] as const;
const unwrapRotation = (rotation: Vec3, reference: Vec3): Vec3 => rotation.map((angle, axis) =>
  angle + 360 * Math.round((reference[axis] - angle) / 360)) as Vec3;
const appendRecordingKey = (object: SceneObject, frame: number, property: typeof recordingProperties[number], value: KeyframeValue, interpolation: Interpolation) => {
  const key = { id: crypto.randomUUID(), frame, property, value: structuredClone(value), interpolation, source: 'user' as const, purpose: 'motion' as const, commentIds: [] };
  object.keyframes.push(key);
  return key;
};
const freeRecordingFrame = (object: SceneObject, desiredFrame: number, sceneFrame: number, sceneEnd: number, reusableIds: string[] = []) => {
  const reusable = new Set(reusableIds);
  const available = (frame: number) => !object.keyframes.some((key) => recordingProperties.includes(key.property as typeof recordingProperties[number]) && key.frame === frame && !reusable.has(key.id));
  if (available(desiredFrame)) return desiredFrame;
  for (let distance = 1; distance < sceneEnd - sceneFrame; distance += 1) {
    const after = desiredFrame + distance;
    if (after < sceneEnd && available(after)) return after;
    const before = desiredFrame - distance;
    if (before >= sceneFrame && available(before)) return before;
  }
  return undefined;
};
const recordTransformSample = (object: SceneObject, sceneFrame: number, sceneEnd: number, recordFrame: number, transform: Transform, interpolation: Interpolation, session: RecordingSession): RecordingSession => {
  const recordedSession = { ...session, changed: true, lastMotion: { objectId: object.id, sceneId: session.sceneId } };
  const touched = session.touchedObjectIds.includes(object.id);
  if (!touched) {
    const startTransform = evaluateTransform(object, session.startFrame);
    for (const property of recordingProperties) {
      if (!object.keyframes.some((key) => key.property === property && key.frame === session.startFrame)) {
        putKey(object, session.startFrame, property, startTransform[property], interpolation, false, 'motion');
      } else appendRecordingKey(object, session.startFrame, property, startTransform[property], interpolation);
    }
    const endpointFrame = freeRecordingFrame(object, recordFrame, sceneFrame, sceneEnd);
    if (endpointFrame === undefined) return session;
    const endpointKeys = recordingProperties.map((property) => putKey(object, endpointFrame, property, transform[property], interpolation, false, 'motion'));
    const fixed = endpointFrame - session.startFrame >= RECORDING_SAMPLE_INTERVAL ? endpointFrame : session.startFrame;
    return {
      ...recordedSession,
      touchedObjectIds: [...session.touchedObjectIds, object.id],
      lastFixedFrames: { ...session.lastFixedFrames, [object.id]: fixed },
      endpointFrames: { ...session.endpointFrames, [object.id]: endpointFrame },
      endpointKeyIds: { ...session.endpointKeyIds, [object.id]: endpointKeys.map((key) => key.id) },
    };
  }

  const fixedFrame = session.lastFixedFrames[object.id] ?? session.startFrame;
  const endpointFrame = session.endpointFrames[object.id] ?? fixedFrame;
  let endpointIds = session.endpointKeyIds[object.id] ?? [];
  const safeRecordFrame = freeRecordingFrame(object, recordFrame, sceneFrame, sceneEnd, endpointIds);
  if (safeRecordFrame === undefined) return session;
  if (safeRecordFrame > endpointFrame && endpointFrame === fixedFrame) {
    endpointIds = recordingProperties.map((property) => putKey(object, safeRecordFrame, property, transform[property], interpolation, false, 'motion').id);
  } else {
    const endpointKeys = object.keyframes.filter((key) => endpointIds.includes(key.id));
    for (const key of endpointKeys) {
      const property = key.property as 'position' | 'rotation' | 'scale';
      key.frame = safeRecordFrame;
      key.value = structuredClone(transform[property]);
      key.interpolation = interpolation;
      key.purpose = 'motion';
    }
  }
  const nextFixed = safeRecordFrame - fixedFrame >= RECORDING_SAMPLE_INTERVAL ? safeRecordFrame : fixedFrame;
  return {
    ...recordedSession,
    lastFixedFrames: { ...session.lastFixedFrames, [object.id]: nextFixed },
    endpointFrames: { ...session.endpointFrames, [object.id]: safeRecordFrame },
    endpointKeyIds: { ...session.endpointKeyIds, [object.id]: endpointIds },
  };
};

const closePreviousScene = (object: SceneObject, sceneFrame: number, properties: AnimProperty[] = ['position', 'rotation', 'scale']) => {
  for (const property of properties) {
    const previous = object.keyframes.filter((key) => key.property === property && key.frame < sceneFrame).sort((a, b) => b.frame - a.frame)[0];
    if (previous) previous.interpolation = 'constant';
  }
};

const makeObjectLocalToScene = (project: AbacoProject, object: SceneObject, sceneId: string) => {
  const range = sceneRange(project, sceneId);
  if (!range) return;
  object.sceneIds = [sceneId];
  object.visible = false;
  putKey(object, range.scene.frame, 'visibility', true, 'constant');
  if (range.end <= project.settings.frameEnd) putKey(object, range.end, 'visibility', false, 'constant');
};

const makeCameraShotIndependent = (project: AbacoProject, camera: SceneObject, sceneFrame: number, keepSceneStartConstant = true) => {
  const properties: AnimProperty[] = ['position', 'rotation', 'scale', 'lens'];
  closePreviousScene(camera, sceneFrame, properties);
  for (const property of properties) {
    if (keepSceneStartConstant) {
      const start = camera.keyframes.find((key) => key.property === property && key.frame === sceneFrame);
      if (start) start.interpolation = 'constant';
    }
  }
};

function ensureSceneSnapshots(project: AbacoProject) {
  const frames = sceneStarts(project);
  for (const object of project.objects) {
    const states = frames.map((frame) => ({
      frame, transform: evaluateTransform(object, frame), visible: evaluateProperty(object, 'visibility', frame),
      text: evaluateProperty(object, 'text', frame), lens: evaluateProperty(object, 'lens', frame),
    }));
    for (const state of states) {
      const ensure = (property: AnimProperty, value: KeyframeValue, interpolation: Interpolation = 'constant') => {
        if (!object.keyframes.some((key) => key.frame === state.frame && key.property === property)) putKey(object, state.frame, property, value, interpolation);
      };
      ensure('position', state.transform.position);
      ensure('rotation', state.transform.rotation);
      ensure('scale', state.transform.scale);
      ensure('visibility', state.visible, 'constant');
      if (object.kind === 'text') ensure('text', state.text, 'constant');
      if (object.kind === 'camera') ensure('lens', state.lens);
    }
  }
}

// Le vecchie versioni riutilizzavano lo stesso oggetto camera per tutte le
// clip. Al primo uso separiamo il rig della scena: così pose, movimento e
// interpolazione di una clip non possono più modificare quelle vicine.
const makeSceneCameraExclusive = (project: AbacoProject, scene: AbacoProject['cameraCuts'][number]) => {
  const source = project.objects.find((object) => object.id === scene.cameraId && object.kind === 'camera');
  if (!source) return undefined;
  if (!project.cameraCuts.some((cut) => cut.id !== scene.id && cut.cameraId === source.id)) return source;
  const sceneEnd = project.cameraCuts.filter((cut) => cut.frame > scene.frame).sort((a, b) => a.frame - b.frame)[0]?.frame ?? project.settings.frameEnd + 1;
  const transform = evaluateTransform(source, scene.frame);
  const lens = evaluateProperty(source, 'lens', scene.frame) as number;
  const camera = structuredClone(source);
  camera.id = crypto.randomUUID();
  camera.name = `Camera ${scene.name ?? 'scena'}`;
  camera.transform = structuredClone(transform);
  camera.keyframes = source.keyframes
    .filter((key) => key.frame >= scene.frame && key.frame < sceneEnd)
    .map((key) => ({ ...structuredClone(key), id: crypto.randomUUID() }));
  putKey(camera, scene.frame, 'position', transform.position, 'constant', false, 'snapshot');
  putKey(camera, scene.frame, 'rotation', transform.rotation, 'constant', false, 'snapshot');
  putKey(camera, scene.frame, 'scale', transform.scale, 'constant', false, 'snapshot');
  putKey(camera, scene.frame, 'lens', lens, 'constant', false, 'snapshot');
  project.objects.push(camera);
  scene.cameraId = camera.id;
  return camera;
};

const renameScenes = (project: AbacoProject) => project.cameraCuts.sort((a, b) => a.frame - b.frame).forEach((scene, index) => { scene.name = `Scena ${index + 1}`; });
const syncScopedCommentRanges = (project: AbacoProject) => {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  for (const comment of project.comments) {
    if (comment.kind === 'transition' || !comment.sceneId) continue;
    const index = scenes.findIndex((scene) => scene.id === comment.sceneId);
    if (index < 0) continue;
    comment.startFrame = scenes[index].frame;
    comment.endFrame = Math.max(comment.startFrame, (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1) - 1);
  }
};

export const useEditor = create<EditorState>((set, get) => {
  const commit = (project: AbacoProject) => set((state) => ({
    project: { ...project, updatedAt: new Date().toISOString() },
    past: [...state.past.slice(-49), snapshot(state.project)], future: [], dirty: true,
  }));
  const commitRecording = (project: AbacoProject, recordingSession: RecordingSession) => set({
    project: { ...project, updatedAt: new Date().toISOString() }, recordingSession, future: [], dirty: true,
  });
  return {
    project: initialProject(), currentFrame: 1, isPlaying: false, cameraView: false, setCameraView: (cameraView) => { flushPendingCameraEdit(); set({ cameraView }); }, jevStroke: { active: false, points: [] }, setJevStrokeActive: (active) => set((state) => ({ jevStroke: { ...state.jevStroke, active } })), setJevStrokePoints: (points) => set((state) => ({ jevStroke: { ...state.jevStroke, points } })), setJevStrokeContext: (viewMode, viewRotation, viewPosition, verticalFovDegrees, aspect) => set((state) => ({ jevStroke: { ...state.jevStroke, viewMode, viewRotation, viewPosition, verticalFovDegrees, aspect } })), clearJevStroke: () => set({ jevStroke: { active: false, points: [] } }), interpolation: 'bezier', gizmoMode: 'translate', past: [], future: [], dirty: false,
    newProject: () => set({ project: createProject(), projectPath: undefined, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, jevStroke: { active: false, points: [] }, currentFrame: 1, isPlaying: false, past: [], future: [], dirty: false }),
    loadProject: (project, projectPath) => { const normalized = normalizeProjectData(project); set({ project: normalized, projectPath, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, jevStroke: { active: false, points: [] }, currentFrame: normalized.settings.frameStart, isPlaying: false, past: [], future: [], dirty: false }); },
    markSaved: (project, projectPath) => set({ project, projectPath, dirty: false }),
    select: (selectedId) => set((state) => ({
      selectedId,
      selectedMotion: state.selectedMotion?.objectId === selectedId ? state.selectedMotion : undefined,
      gizmoMode: selectedId && selectedId !== state.selectedId ? 'translate' : state.gizmoMode,
    })),
    setFrame: (frame) => {
      const before = get();
      const nextFrame = Math.max(before.project.settings.frameStart, Math.min(before.project.settings.frameEnd, Math.round(frame)));
      const destination = before.project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((scene) => scene.frame <= nextFrame);
      const switchesRecordingScene = Boolean(before.recordingSession && destination && destination.id !== before.recordingSession.sceneId);
      if (!before.recordingSession || switchesRecordingScene) flushPendingCameraEdit();
      set((state) => {
        const clampedFrame = Math.max(state.project.settings.frameStart, Math.min(state.project.settings.frameEnd, nextFrame));
        const session = state.recordingSession;
        const targetScene = state.project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((scene) => scene.frame <= clampedFrame);
        if (!session || !targetScene || targetScene.id === session.sceneId) return { currentFrame: clampedFrame };
        const range = sceneRange(state.project, targetScene.id);
        const startFrame = range ? Math.max(range.scene.frame, Math.min(range.end - 2, clampedFrame)) : clampedFrame;
        return {
          currentFrame: startFrame,
          recordingSession: {
            ...session,
            sceneId: targetScene.id,
            startFrame,
            touchedObjectIds: [],
            lastFixedFrames: {},
            endpointFrames: {},
            endpointKeyIds: {},
          },
        };
      });
    },
    setPlaying: (isPlaying) => set({ isPlaying }),
    selectMotion: (selectedMotion) => set({ selectedMotion }),
    setInterpolation: (interpolation) => set({ interpolation }),
    setGizmoMode: (gizmoMode) => set({ gizmoMode }),
    addObject: (kind) => {
      const state = get();
      if (kind === 'camera') {
        const camera = state.project.objects.find((item) => item.kind === 'camera');
        if (camera) set({ selectedId: camera.id });
        return;
      }
      const object = createSceneObject(kind, state.project.objects.filter((item) => item.kind === kind).length + 1);
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      putKey(object, sceneFrame, 'position', object.transform.position);
      putKey(object, sceneFrame, 'rotation', object.transform.rotation);
      putKey(object, sceneFrame, 'scale', object.transform.scale);
      if (scene) makeObjectLocalToScene(next, object, scene.id);
      if (kind === 'text') putKey(object, sceneFrame, 'text', object.text, 'constant');
      next.objects.push(object);
      commit(next);
      set({ selectedId: object.id, gizmoMode: 'translate' });
    },
    addScreenImage: (asset) => {
      const state = get();
      const object = createSceneObject('plane', state.project.objects.filter((item) => item.screenSpace && item.kind === 'plane').length + 1);
      object.name = asset.name;
      object.screenSpace = true;
      object.asset = { sourcePath: asset.sourcePath, proxyPath: asset.dataUrl, collectionName: 'Livello 2D', boundsCenter: [0, 0, 0], previewScale: 1, groundOffset: 0 };
      object.transform.scale = [1, 1, 1];
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      putKey(object, sceneFrame, 'position', object.transform.position);
      putKey(object, sceneFrame, 'rotation', object.transform.rotation);
      putKey(object, sceneFrame, 'scale', object.transform.scale);
      if (scene) makeObjectLocalToScene(next, object, scene.id);
      next.objects.push(object);
      commit(next);
      set({ selectedId: object.id, gizmoMode: 'translate' });
    },
    addAudio: (asset) => {
      const state = get();
      const object = createSceneObject('audio', state.project.objects.filter((item) => item.kind === 'audio').length + 1);
      object.name = asset.name;
      object.asset.sourcePath = asset.sourcePath;
      object.audio.duration = Math.max(0, asset.duration);
      object.audio.waveform = asset.waveform.slice(0, 256);
      const next = snapshot(state.project);
      const clipStart = Math.max(next.settings.frameStart, state.currentFrame);
      const audioFrames = Math.max(1, Math.round(asset.duration * next.settings.fps));
      const clipEnd = clipStart + audioFrames;
      object.sceneIds = [];
      object.visible = false;
      if (clipStart > next.settings.frameStart) putKey(object, next.settings.frameStart, 'visibility', false, 'constant');
      putKey(object, clipStart, 'visibility', true, 'constant');
      putKey(object, clipEnd, 'visibility', false, 'constant');
      next.settings.frameEnd = Math.max(next.settings.frameEnd, clipEnd - 1);
      next.objects.push(object);
      commit(next);
      set({ selectedId: object.id, selectedMotion: undefined, gizmoMode: 'translate' });
    },
    addBlendAsset: (asset) => {
      const state = get();
      const object = createSceneObject('blend_asset', state.project.objects.filter((item) => item.kind === 'blend_asset').length + 1);
      object.name = asset.name;
      object.asset = {
        sourcePath: asset.sourcePath, proxyPath: asset.proxyPath, collectionName: asset.collectionName,
        boundsCenter: structuredClone(asset.boundsCenter), previewScale: asset.previewScale, groundOffset: asset.groundOffset,
      };
      object.transform.position[2] = asset.groundOffset;
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      const activeCut = next.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((cut) => cut.frame <= state.currentFrame);
      const camera = next.objects.find((item) => item.id === activeCut?.cameraId && item.kind === 'camera');
      if (camera) {
        const cameraPosition = evaluateTransform(camera, state.currentFrame).position;
        const deltaX = cameraPosition[0] - object.transform.position[0];
        const deltaY = cameraPosition[1] - object.transform.position[1];
        // Gli asset Blender sono considerati frontali lungo -Y. Li ruotiamo
        // attorno all'asse verticale per presentarli subito verso la camera.
        if (Math.hypot(deltaX, deltaY) > .0001) object.transform.rotation[2] = Number(THREE.MathUtils.radToDeg(Math.atan2(deltaX, -deltaY)).toFixed(3));
      }
      putKey(object, sceneFrame, 'position', object.transform.position);
      putKey(object, sceneFrame, 'rotation', object.transform.rotation);
      putKey(object, sceneFrame, 'scale', object.transform.scale);
      if (scene) makeObjectLocalToScene(next, object, scene.id);
      next.objects.push(object);
      commit(next);
      set({ selectedId: object.id, gizmoMode: 'translate' });
    },
    replaceObject: (id, replacement) => {
      const state = get();
      const next = snapshot(state.project);
      const index = next.objects.findIndex((item) => item.id === id && item.kind !== 'camera' && !item.kind.includes('light'));
      if (index < 0 || replacement.kind === 'camera' || replacement.kind.includes('light')) return;
      const current = next.objects[index];
      const fresh = createSceneObject(replacement.kind, next.objects.filter((item) => item.kind === replacement.kind && item.id !== id).length + 1);
      fresh.id = current.id;
      fresh.name = replacement.name?.trim() || fresh.name;
      fresh.visible = current.visible;
      fresh.transform = structuredClone(current.transform);
      fresh.sceneIds = structuredClone(current.sceneIds);
      fresh.sceneNotes = structuredClone(current.sceneNotes);
      fresh.keyframes = current.keyframes.filter((key) => ['position', 'rotation', 'scale', 'visibility'].includes(key.property)).map((key) => structuredClone(key));
      fresh.screenSpace = replacement.screenSpace ?? fresh.screenSpace;
      fresh.screenCrop = fresh.screenSpace && current.screenSpace ? structuredClone(current.screenCrop) : [0, 0, 0, 0];
      if (replacement.asset) fresh.asset = structuredClone(replacement.asset);
      if (replacement.kind === 'text') {
        fresh.text = replacement.text?.trim() || 'Testo';
        const sceneIds = new Set(fresh.sceneIds);
        for (const scene of next.cameraCuts) {
          if (!sceneIds.size || sceneIds.has(scene.id)) putKey(fresh, scene.frame, 'text', fresh.text, 'constant');
        }
      }
      next.objects[index] = fresh;
      commit(next);
      set({ selectedId: fresh.id, gizmoMode: 'translate' });
    },
    addShot: () => {
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const cuts = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const sourceCut = cuts.at(-1);
      if (!sourceCut) return;
      const sourceFrame = next.settings.frameEnd;
      const nextFrame = sourceFrame + 1;
      next.settings.frameEnd = nextFrame + next.settings.fps * 3 - 1;
      for (const object of next.objects) {
        const transform = evaluateTransform(object, sourceFrame);
        putKey(object, nextFrame, 'position', transform.position);
        putKey(object, nextFrame, 'rotation', transform.rotation);
        putKey(object, nextFrame, 'scale', transform.scale);
        putKey(object, nextFrame, 'visibility', evaluateProperty(object, 'visibility', sourceFrame), 'constant');
        if (object.kind === 'text') putKey(object, nextFrame, 'text', evaluateProperty(object, 'text', sourceFrame), 'constant');
        if (object.kind === 'camera') putKey(object, nextFrame, 'lens', evaluateProperty(object, 'lens', sourceFrame));
        const sourceNote = object.sceneNotes.filter((note) => note.frame <= sourceFrame).sort((a, b) => b.frame - a.frame)[0]?.text;
        if (sourceNote) object.sceneNotes.push({ frame: nextFrame, text: sourceNote });
      }
      const newScene: AbacoProject['cameraCuts'][number] = { id: crypto.randomUUID(), cameraId: sourceCut.cameraId, frame: nextFrame, source: 'user', commentIds: [], name: `Scena ${cuts.length + 1}`, transition: 'auto', lighting: structuredClone(sourceCut.lighting), background: structuredClone(sourceCut.background), framing: structuredClone(sourceCut.framing) };
      next.cameraCuts.push(newScene);
      for (const object of next.objects) {
        if (!object.sceneIds.length || object.kind === 'camera' || object.kind.includes('light')) continue;
        const copiedFromPrevious = object.sceneIds.includes(sourceCut.id) && Boolean(evaluateProperty(object, 'visibility', sourceFrame));
        if (copiedFromPrevious) {
          object.sceneIds.push(newScene.id);
          putKey(object, nextFrame, 'visibility', true, 'constant');
        } else putKey(object, nextFrame, 'visibility', false, 'constant');
      }
      makeSceneCameraExclusive(next, newScene);
      syncScopedCommentRanges(next);
      commit(next);
      set({ selectedId: undefined, currentFrame: nextFrame });
    },
    splitScene: () => {
      const state = get();
      const next = snapshot(state.project);
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const index = scenes.findIndex((scene, sceneIndex) => state.currentFrame >= scene.frame && state.currentFrame < (scenes[sceneIndex + 1]?.frame ?? next.settings.frameEnd + 1));
      const scene = scenes[index];
      const sceneEnd = scenes[index + 1]?.frame ?? next.settings.frameEnd + 1;
      if (!scene || state.currentFrame <= scene.frame + 1 || state.currentFrame >= sceneEnd - 1) return;
      ensureSceneSnapshots(next);
      for (const object of next.objects) {
        const transform = evaluateTransform(object, state.currentFrame);
        putKey(object, state.currentFrame, 'position', transform.position);
        putKey(object, state.currentFrame, 'rotation', transform.rotation);
        putKey(object, state.currentFrame, 'scale', transform.scale);
        putKey(object, state.currentFrame, 'visibility', evaluateProperty(object, 'visibility', state.currentFrame), 'constant');
        if (object.kind === 'text') putKey(object, state.currentFrame, 'text', evaluateProperty(object, 'text', state.currentFrame), 'constant');
        if (object.kind === 'camera') putKey(object, state.currentFrame, 'lens', evaluateProperty(object, 'lens', state.currentFrame));
      }
      for (const object of next.objects) {
        const sourceNote = object.sceneNotes.filter((note) => note.frame <= scene.frame).sort((a, b) => b.frame - a.frame)[0]?.text;
        if (sourceNote && !object.sceneNotes.some((note) => note.frame === state.currentFrame)) object.sceneNotes.push({ frame: state.currentFrame, text: sourceNote });
      }
      const split = { id: crypto.randomUUID(), cameraId: scene.cameraId, frame: state.currentFrame, source: 'user' as const, commentIds: [], transition: 'auto' as const, lighting: structuredClone(scene.lighting), background: structuredClone(scene.background), framing: structuredClone(scene.framing) };
      next.cameraCuts.push(split);
      for (const object of next.objects) {
        if (object.sceneIds.includes(scene.id)) object.sceneIds.push(split.id);
      }
      makeSceneCameraExclusive(next, split);
      const following = scenes[index + 1];
      if (following) next.comments.forEach((comment) => { if (comment.kind === 'transition' && comment.fromSceneId === scene.id && comment.toSceneId === following.id) comment.fromSceneId = split.id; });
      renameScenes(next);
      syncScopedCommentRanges(next);
      commit(next);
    },
    deleteScene: (id) => {
      const state = get();
      const next = snapshot(state.project);
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      if (scenes.length <= 1) return;
      const index = scenes.findIndex((scene) => scene.id === id);
      if (index < 0) return;
      ensureSceneSnapshots(next);
      const scene = scenes[index];
      const sceneEnd = scenes[index + 1]?.frame ?? next.settings.frameEnd + 1;
      const duration = sceneEnd - scene.frame;
      next.cameraCuts = next.cameraCuts.filter((cut) => cut.id !== id);
      if (!next.cameraCuts.some((cut) => cut.cameraId === scene.cameraId)) next.objects = next.objects.filter((object) => object.id !== scene.cameraId);
      // An empty sceneIds list means globally present. Remove objects local
      // only to the deleted scene before pruning their membership.
      next.objects = next.objects.filter((object) => !(object.sceneIds.length === 1 && object.sceneIds[0] === id));
      for (const cut of next.cameraCuts) if (cut.frame >= sceneEnd) cut.frame -= duration;
      for (const object of next.objects) {
        object.sceneIds = object.sceneIds.filter((sceneId) => sceneId !== id);
        object.keyframes = object.keyframes
          .filter((key) => key.frame < scene.frame || key.frame >= sceneEnd)
          .map((key) => key.frame >= sceneEnd ? { ...key, frame: key.frame - duration } : key);
        object.sceneNotes = object.sceneNotes
          .filter((note) => note.frame < scene.frame || note.frame >= sceneEnd)
          .map((note) => note.frame >= sceneEnd ? { ...note, frame: note.frame - duration } : note);
      }
      next.comments = next.comments
        .filter((comment) => comment.sceneId !== id && comment.fromSceneId !== id && comment.toSceneId !== id)
        .filter((comment) => comment.targetIds.every((targetId) => next.objects.some((object) => object.id === targetId)))
        .map((comment) => comment.startFrame >= sceneEnd
          ? { ...comment, startFrame: comment.startFrame - duration, endFrame: comment.endFrame - duration }
          : comment.endFrame >= scene.frame
            ? { ...comment, endFrame: Math.max(comment.startFrame, comment.endFrame - duration) }
            : comment);
      next.settings.frameEnd = Math.max(next.settings.frameStart + 5, next.settings.frameEnd - duration);
      renameScenes(next);
      syncScopedCommentRanges(next);
      commit(next);
      set({ selectedId: undefined, currentFrame: Math.max(next.settings.frameStart, Math.min(next.settings.frameEnd, scene.frame)) });
    },
    resizeScene: (id, requestedDuration) => {
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const index = scenes.findIndex((scene) => scene.id === id);
      if (index < 0) return;
      const scene = scenes[index];
      const oldBoundary = scenes[index + 1]?.frame ?? next.settings.frameEnd + 1;
      const oldDuration = oldBoundary - scene.frame;
      const newDuration = Math.max(6, Math.round(requestedDuration));
      const delta = newDuration - oldDuration;
      if (!delta) return;
      const newBoundary = oldBoundary + delta;
      if (delta < 0) {
        for (const object of next.objects) object.keyframes = object.keyframes.filter((key) => key.frame < newBoundary || key.frame >= oldBoundary);
      }
      for (const later of next.cameraCuts) if (later.frame >= oldBoundary) later.frame += delta;
      for (const object of next.objects) {
        for (const key of object.keyframes) if (key.frame >= oldBoundary) key.frame += delta;
        for (const note of object.sceneNotes) if (note.frame >= oldBoundary) note.frame += delta;
      }
      for (const comment of next.comments) {
        if (comment.startFrame >= oldBoundary) { comment.startFrame += delta; comment.endFrame += delta; }
        else if (comment.endFrame >= oldBoundary) comment.endFrame += delta;
        else if (delta < 0 && comment.endFrame >= newBoundary) comment.endFrame = Math.max(comment.startFrame, newBoundary - 1);
      }
      next.settings.frameEnd = Math.max(next.settings.frameStart + 5, next.settings.frameEnd + delta);
      renameScenes(next);
      syncScopedCommentRanges(next);
      commit(next);
      const movedFrame = state.currentFrame >= oldBoundary ? state.currentFrame + delta : Math.min(state.currentFrame, newBoundary - 1);
      set({ currentFrame: Math.max(next.settings.frameStart, Math.min(next.settings.frameEnd, movedFrame)) });
    },
    setTransitionMode: (objectId, sceneId, mode) => {
      const next = snapshot(get().project);
      ensureSceneSnapshots(next);
      const object = next.objects.find((item) => item.id === objectId);
      const scene = next.cameraCuts.find((item) => item.id === sceneId);
      if (!object || !scene) return;
      const nextSceneFrame = next.cameraCuts.filter((item) => item.frame > scene.frame).sort((a, b) => a.frame - b.frame)[0]?.frame ?? next.settings.frameEnd + 1;
      const animatedProperties: AnimProperty[] = ['position', 'rotation', 'scale', ...(object.kind === 'camera' ? ['lens' as const] : [])];
      for (const key of object.keyframes) if (key.frame >= scene.frame && key.frame < nextSceneFrame && animatedProperties.includes(key.property)) key.interpolation = mode;
      commit(next);
      set({ interpolation: mode });
    },
    startMotion: (objectId, sceneId) => {
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const scene = next.cameraCuts.find((item) => item.id === sceneId);
      let object = next.objects.find((item) => item.id === objectId);
      if (scene && object?.kind === 'camera' && scene.cameraId === object.id) object = makeSceneCameraExclusive(next, scene);
      if (!object || !scene) return;
      const sceneEnd = next.cameraCuts.filter((item) => item.frame > scene.frame).sort((a, b) => a.frame - b.frame)[0]?.frame ?? next.settings.frameEnd + 1;
      const motionFrame = Math.max(scene.frame, Math.min(sceneEnd - 1, state.currentFrame));
      const transform = evaluateTransform(object, motionFrame);
      const hasSavedMotion = object.keyframes.some((key) => key.purpose === 'motion' && key.frame >= scene.frame && key.frame < sceneEnd);
      if (!hasSavedMotion && motionFrame > scene.frame) {
        const initialTransform = evaluateTransform(object, scene.frame);
        for (const property of ['position', 'rotation', 'scale'] as const) {
          putMotionKey(object, scene.frame, scene.frame, property, initialTransform[property], state.interpolation);
        }
      }
      let editFrame = sceneEnd - 1;
      if (object.kind !== 'camera' && !object.kind.includes('light')) {
        while (editFrame > motionFrame && !evaluateProperty(object, 'visibility', editFrame)) editFrame -= 1;
      }
      for (const property of ['position', 'rotation', 'scale'] as const) {
        putMotionKey(object, scene.frame, motionFrame, property, transform[property], state.interpolation);
        if (editFrame > motionFrame) putMotionKey(object, scene.frame, editFrame, property, transform[property], state.interpolation);
      }
      commit(next);
      set({
        selectedMotion: { objectId: object.id, sceneId },
        recordingMotion: { objectId: object.id, sceneId, startFrame: motionFrame, provisionalFrame: editFrame > motionFrame ? editFrame : undefined },
        selectedId: object.id,
        currentFrame: Math.max(motionFrame, editFrame),
      });
    },
    stopMotion: () => set({ recordingMotion: undefined }),
    startRecording: (sceneId) => {
      flushPendingCameraEdit();
      const state = get();
      const range = sceneRange(state.project, sceneId);
      if (!range) return;
      const startFrame = Math.max(range.scene.frame, Math.min(range.end - 2, state.currentFrame));
      const next = snapshot(state.project);
      const selected = next.objects.find((object) => object.id === state.selectedId
        && object.kind !== 'camera'
        && !object.kind.includes('light')
        && evaluateProperty(object, 'visibility', startFrame));
      const touchedObjectIds: string[] = [];
      const lastFixedFrames: Record<string, number> = {};
      let lastMotion: RecordingSession['lastMotion'];
      if (selected) {
        const transform = evaluateTransform(selected, startFrame);
        for (const property of recordingProperties) appendRecordingKey(selected, startFrame, property, transform[property], state.interpolation);
        touchedObjectIds.push(selected.id);
        lastFixedFrames[selected.id] = startFrame;
        lastMotion = { objectId: selected.id, sceneId };
      }
      set({
        project: selected ? { ...next, updatedAt: new Date().toISOString() } : state.project,
        currentFrame: startFrame,
        recordingMotion: undefined,
        recordingSession: {
          sceneId, startFrame, touchedObjectIds, changed: Boolean(selected), beforeProject: snapshot(state.project), lastMotion,
          lastFixedFrames, endpointFrames: {}, endpointKeyIds: {},
        },
        isPlaying: false, dirty: selected ? true : state.dirty,
      });
    },
    stopRecording: () => {
      flushPendingCameraEdit();
      set((state) => {
        const session = state.recordingSession;
        const selection = session?.lastMotion;
        return {
          recordingSession: undefined,
          isPlaying: false,
          selectedId: selection?.objectId ?? state.selectedId,
          selectedMotion: selection ?? state.selectedMotion,
          past: session?.changed
            ? [...state.past.slice(-49), session.beforeProject]
            : state.past,
        };
      });
    },
    removeSelected: () => {
      const state = get();
      if (!state.selectedId) return;
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === state.selectedId);
      if (!object || object.kind === 'camera') return;
      ensureSceneSnapshots(next);
      putKey(object, activeSceneStart(next, state.currentFrame), 'visibility', false, 'constant');
      commit(next); set({ selectedId: undefined });
    },
    updateObject: (id, patch) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      ensureSceneSnapshots(next);
      const sceneFrame = activeSceneStart(next, get().currentFrame);
      const rest = { ...patch };
      if (typeof rest.visible === 'boolean') { putKey(object, sceneFrame, 'visibility', rest.visible, 'constant'); delete rest.visible; }
      if (typeof rest.text === 'string') { putKey(object, sceneFrame, 'text', rest.text, 'constant'); delete rest.text; }
      if (rest.camera && typeof rest.camera === 'object' && typeof (rest.camera as { lens?: unknown }).lens === 'number') {
        putKey(object, sceneFrame, 'lens', (rest.camera as { lens: number }).lens, 'constant');
        if (object.kind === 'camera') makeCameraShotIndependent(next, object, sceneFrame);
        delete rest.camera;
      }
      Object.assign(object, rest);
      commit(next);
    },
    setSceneNote: (id, text) => {
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      const frame = activeSceneStart(next, state.currentFrame);
      const existing = object.sceneNotes.find((note) => note.frame === frame);
      if (existing) existing.text = text;
      else object.sceneNotes.push({ frame, text });
      commit(next);
    },
    setAnimationStandard: (standard) => {
      const next = snapshot(get().project);
      if (standard) next.animationStandard = structuredClone(standard);
      else delete next.animationStandard;
      commit(ProjectSchema.parse(next));
    },
    updateSettings: (patch) => {
      const next = snapshot(get().project);
      for (const property of ['fps', 'frameStart', 'frameEnd', 'resolutionX', 'resolutionY'] as const) {
        const value = patch[property];
        if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
          && (property !== 'fps' || value <= 120)) next.settings[property] = value;
      }
      next.settings.frameEnd = Math.max(next.settings.frameStart, next.settings.frameEnd);
      if (JSON.stringify(next.settings) === JSON.stringify(get().project.settings)) return;
      commit(next);
      set((state) => ({ currentFrame: Math.max(next.settings.frameStart, Math.min(state.currentFrame, next.settings.frameEnd)) }));
    },
    updateLighting: (patch) => {
      const state = get();
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      if (!scene) return;
      scene.lighting = { ...scene.lighting, ...patch };
      commit(next);
    },
    updateBackground: (background, sceneId) => {
      const state = get();
      const next = snapshot(state.project);
      const scene = next.cameraCuts.find((cut) => sceneId ? cut.id === sceneId : cut.frame === activeSceneStart(next, state.currentFrame));
      if (!scene) return;
      scene.background = structuredClone(background);
      commit(next);
    },
    reorderObjects: (sourceId, targetId) => {
      if (sourceId === targetId) return;
      const next = snapshot(get().project);
      const technical = next.objects.filter((object) => object.kind === 'camera' || object.kind.includes('light'));
      const content = next.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light'));
      const sourceIndex = content.findIndex((object) => object.id === sourceId);
      const targetIndex = content.findIndex((object) => object.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [moving] = content.splice(sourceIndex, 1);
      content.splice(targetIndex, 0, moving);
      next.objects = [...technical, ...content];
      commit(next);
    },
    deleteObject: (id) => {
      const state = get();
      const object = state.project.objects.find((item) => item.id === id);
      if (!object || object.kind === 'camera' || object.kind.includes('light')) return;
      const next = snapshot(state.project);
      next.objects = next.objects.filter((item) => item.id !== id);
      next.comments = next.comments.flatMap((comment) => {
        if (!comment.targetIds.includes(id)) return [comment];
        const targetIds = comment.targetIds.filter((targetId) => targetId !== id);
        return targetIds.length ? [{ ...comment, targetIds }] : [];
      });
      commit(next);
      if (state.selectedId === id) set({ selectedId: undefined });
      if (state.selectedMotion?.objectId === id) set({ selectedMotion: undefined });
      if (state.recordingMotion?.objectId === id) set({ recordingMotion: undefined });
    },
    duplicateObjectsToScene: (objectIds, sceneId) => {
      const state = get();
      const next = snapshot(state.project);
      const range = sceneRange(next, sceneId);
      if (!range) return [];
      const created: string[] = [];
      for (const sourceId of [...new Set(objectIds)]) {
        const source = state.project.objects.find((object) => object.id === sourceId && object.kind !== 'camera' && !object.kind.includes('light'));
        if (!source) continue;
        const copy = structuredClone(source);
        copy.id = crypto.randomUUID();
        copy.name = `${source.name} copia`;
        copy.transform = evaluateTransform(source, state.currentFrame);
        copy.text = evaluateProperty(source, 'text', state.currentFrame) as string;
        copy.sceneNotes = [];
        copy.keyframes = [];
        putKey(copy, range.scene.frame, 'position', copy.transform.position);
        putKey(copy, range.scene.frame, 'rotation', copy.transform.rotation);
        putKey(copy, range.scene.frame, 'scale', copy.transform.scale);
        if (copy.kind === 'text') putKey(copy, range.scene.frame, 'text', copy.text, 'constant');
        makeObjectLocalToScene(next, copy, sceneId);
        next.objects.push(copy);
        created.push(copy.id);
      }
      if (!created.length) return [];
      commit(next);
      set({ selectedId: created.at(-1), gizmoMode: 'translate' });
      return created;
    },
    resizeObjectPresence: (objectId, sceneId, requestedStart, requestedEnd) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId && item.kind !== 'camera' && !item.kind.includes('light'));
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const sourceIndex = scenes.findIndex((scene) => scene.id === sceneId);
      if (!object || sourceIndex < 0) return;
      ensureSceneSnapshots(next);
      const projectStart = next.settings.frameStart;
      const projectEnd = next.settings.frameEnd + 1;
      const startFrame = Math.max(projectStart, Math.min(projectEnd - 1, Math.round(requestedStart)));
      const endFrame = Math.max(startFrame + 1, Math.min(projectEnd, Math.round(requestedEnd)));
      const sceneIndexAt = (frame: number) => scenes.findIndex((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? projectEnd));
      const firstIndex = Math.min(sourceIndex, Math.max(0, sceneIndexAt(startFrame)));
      const lastIndex = Math.max(sourceIndex, Math.max(0, sceneIndexAt(endFrame - 1)));
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const scene = scenes[index];
        const sceneEnd = scenes[index + 1]?.frame ?? projectEnd;
        const visibleStart = Math.max(startFrame, scene.frame);
        const visibleEnd = Math.min(endFrame, sceneEnd);
        if (visibleStart >= visibleEnd) continue;
        object.keyframes = object.keyframes.filter((key) => key.property !== 'visibility' || key.frame < scene.frame || key.frame >= sceneEnd);
        putKey(object, scene.frame, 'visibility', visibleStart === scene.frame, 'constant');
        if (visibleStart > scene.frame) putKey(object, visibleStart, 'visibility', true, 'constant');
        if (visibleEnd < sceneEnd) putKey(object, visibleEnd, 'visibility', false, 'constant');
        if (object.sceneIds.length && !object.sceneIds.includes(scene.id)) object.sceneIds.push(scene.id);
      }
      commit(next);
    },
    deleteObjectFromScene: (objectId, sceneId) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId && item.kind !== 'camera' && !item.kind.includes('light'));
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const index = scenes.findIndex((scene) => scene.id === sceneId);
      const scene = scenes[index];
      if (!object || !scene) return;
      ensureSceneSnapshots(next);
      const sceneEnd = scenes[index + 1]?.frame ?? next.settings.frameEnd + 1;
      if (object.sceneIds.length) {
        object.sceneIds = object.sceneIds.filter((id) => id !== sceneId);
        if (!object.sceneIds.length) {
          next.objects = next.objects.filter((item) => item.id !== objectId);
          next.comments = next.comments.filter((comment) => !comment.targetIds.includes(objectId));
          commit(next);
          return;
        }
      }
      object.keyframes = object.keyframes.filter((key) => key.frame < scene.frame || key.frame >= sceneEnd);
      object.sceneNotes = object.sceneNotes.filter((note) => note.frame < scene.frame || note.frame >= sceneEnd);
      putKey(object, scene.frame, 'visibility', false, 'constant');
      next.comments = next.comments.filter((comment) => !(comment.sceneId === sceneId && comment.targetIds.includes(objectId)));
      commit(next);
    },
    deleteMotionFromScene: (objectId, sceneId) => {
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const object = next.objects.find((item) => item.id === objectId);
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const index = scenes.findIndex((scene) => scene.id === sceneId);
      const scene = scenes[index];
      if (!object || !scene) return;
      const sceneEnd = scenes[index + 1]?.frame ?? next.settings.frameEnd + 1;
      const startTransform = evaluateTransform(object, scene.frame);
      object.keyframes = object.keyframes.filter((key) => {
        if (!['position', 'rotation', 'scale'].includes(key.property) || key.frame < scene.frame || key.frame >= sceneEnd) return true;
        return key.purpose !== 'motion' && !(key.purpose === undefined && key.frame !== scene.frame);
      });
      for (const property of ['position', 'rotation', 'scale'] as const) putKey(object, scene.frame, property, startTransform[property], 'constant', false, 'snapshot');
      closePreviousScene(object, scene.frame);
      if (object.kind === 'camera') {
        scene.framing.target = new THREE.Vector3(...startTransform.position).addScaledVector(
          new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(...startTransform.rotation.map(THREE.MathUtils.degToRad) as Vec3)),
          scene.framing.distance,
        ).toArray() as Vec3;
        makeCameraShotIndependent(next, object, scene.frame);
      }
      commit(next);
      if (state.selectedMotion?.objectId === objectId && state.selectedMotion.sceneId === sceneId) set({ selectedMotion: undefined });
      if (state.recordingMotion?.objectId === objectId && state.recordingMotion.sceneId === sceneId) set({ recordingMotion: undefined });
    },
    resetFraming: () => {
      const state = get();
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      const camera = scene ? makeSceneCameraExclusive(next, scene) : undefined;
      if (!camera || !scene) return;
      const defaults = createSceneObject('camera', 1);
      putKey(camera, sceneFrame, 'position', defaults.transform.position, 'constant');
      putKey(camera, sceneFrame, 'rotation', defaults.transform.rotation, 'constant');
      putKey(camera, sceneFrame, 'scale', defaults.transform.scale, 'constant');
      putKey(camera, sceneFrame, 'lens', 50, 'constant');
      scene.framing = defaultCameraFraming();
      makeCameraShotIndependent(next, camera, sceneFrame, state.currentFrame === sceneFrame);
      commit(next);
    },
    setCameraFraming: (sceneId, position, rotation, target) => {
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const scene = next.cameraCuts.find((cut) => cut.id === sceneId);
      const previousCameraId = scene?.cameraId;
      const camera = scene ? makeSceneCameraExclusive(next, scene) : undefined;
      if (!scene || !camera || ![...position, ...rotation, ...target].every(Number.isFinite)) return;
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      if (sceneFrame !== scene.frame) return;
      const session = state.recordingSession?.sceneId === scene.id ? state.recordingSession : undefined;
      const sessionActive = Boolean(session);
      const range = sceneRange(next, scene.id);
      const recordFrame = session && range ? Math.min(range.end - 1, Math.max(session.startFrame + 1, state.currentFrame)) : state.currentFrame;
      const selectedKey = state.selectedMotion?.objectId === camera.id && state.selectedMotion.sceneId === scene.id && state.selectedMotion.keyframeId
        ? camera.keyframes.find((key) => key.id === state.selectedMotion!.keyframeId && key.frame === state.currentFrame && key.purpose === 'motion')
        : undefined;
      // Camera navigation outside REC is only a workspace view. It must never
      // create animation, unless the user explicitly clicked that keyframe.
      if (!session && state.currentFrame !== sceneFrame && !selectedKey) return;
      const referenceRotation = evaluateTransform(camera, Math.max(sceneFrame, recordFrame - 1)).rotation;
      const continuousRotation = unwrapRotation(rotation, referenceRotation);
      let nextSession = session;
      if (session) {
        nextSession = recordTransformSample(camera, sceneFrame, range!.end, recordFrame, {
          position, rotation: continuousRotation, scale: evaluateTransform(camera, state.currentFrame).scale,
        }, state.interpolation, session);
      } else if (selectedKey) {
        putMotionKey(camera, sceneFrame, state.currentFrame, 'position', position, state.interpolation);
        putMotionKey(camera, sceneFrame, state.currentFrame, 'rotation', continuousRotation, state.interpolation);
      } else {
        putKey(camera, sceneFrame, 'position', position, 'constant', false, 'snapshot');
        putKey(camera, sceneFrame, 'rotation', continuousRotation, 'constant', false, 'snapshot');
      }
      scene.framing = {
        target: structuredClone(target),
        distance: Math.max(0.5, Math.min(100, Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]))),
      };
      makeCameraShotIndependent(next, camera, sceneFrame, !sessionActive && state.currentFrame === sceneFrame);
      if (nextSession) commitRecording(next, nextSession); else commit(next);
      if (previousCameraId && camera.id !== previousCameraId) set({
        ...(state.selectedId === previousCameraId ? { selectedId: camera.id } : {}),
        ...(state.selectedMotion?.objectId === previousCameraId && state.selectedMotion.sceneId === scene.id
          ? { selectedMotion: { ...state.selectedMotion, objectId: camera.id } }
          : {}),
      });
    },
    alignObjectToGround: (id) => {
      const state = get();
      const object = state.project.objects.find((item) => item.id === id && !item.screenSpace && item.kind !== 'audio' && item.kind !== 'camera' && !item.kind.includes('light'));
      if (!object) return;
      const transform = evaluateTransform(object, state.currentFrame);
      get().setTransform(id, { ...transform, position: [transform.position[0], transform.position[1], groundedPositionZ(object, transform)] });
    },
    setTransform: (id, transform) => {
      if (!recordingProperties.every((property) => isValidAnimationValue(property, transform[property]))) return;
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      let object = next.objects.find((item) => item.id === id);
      if (scene && object?.kind === 'camera' && scene.cameraId === object.id) object = makeSceneCameraExclusive(next, scene);
      if (!object) return;
      if (object.kind === 'plane') transform = { ...transform, scale: [THREE.MathUtils.clamp(transform.scale[0], .05, 12), THREE.MathUtils.clamp(transform.scale[1], .05, 12), 1] };
      const motionActive = state.recordingMotion?.objectId === id && state.recordingMotion.sceneId === scene?.id;
      const session = scene && state.recordingSession?.sceneId === scene.id ? state.recordingSession : undefined;
      const sessionActive = Boolean(session) && object.kind !== 'audio' && !object.kind.includes('light');
      const range = scene ? sceneRange(next, scene.id) : undefined;
      const recordFrame = session && range ? Math.min(range.end - 1, Math.max(session.startFrame + 1, state.currentFrame)) : state.currentFrame;
      const selectedKey = state.selectedMotion?.objectId === id && state.selectedMotion.sceneId === scene?.id && state.selectedMotion.keyframeId
        ? object.keyframes.find((key) => key.id === state.selectedMotion!.keyframeId && key.frame === state.currentFrame && key.purpose === 'motion')
        : undefined;
      const editingCameraBetweenKeys = object.kind === 'camera' && Boolean(scene) && state.currentFrame !== sceneFrame;
      // Moving the camera object outside REC only manipulates the working view.
      // Camera keyframes remain editable through their explicit path handles.
      if (editingCameraBetweenKeys && !sessionActive && !selectedKey) return;
      const provisionalFrame = motionActive ? state.recordingMotion?.provisionalFrame : undefined;
      if (provisionalFrame !== undefined && provisionalFrame !== state.currentFrame) {
        object.keyframes = object.keyframes.filter((key) => key.frame !== provisionalFrame || key.purpose !== 'motion' || !['position', 'rotation', 'scale'].includes(key.property));
      }
      let nextSession = session;
      if (sessionActive && session) {
        if (object.kind === 'camera') {
          const referenceRotation = evaluateTransform(object, Math.max(sceneFrame, recordFrame - 1)).rotation;
          transform = { ...transform, rotation: unwrapRotation(transform.rotation, referenceRotation) };
        }
        nextSession = recordTransformSample(object, sceneFrame, range!.end, recordFrame, transform, state.interpolation, session);
      } else {
        if (selectedKey && object.kind === 'camera') {
          const referenceRotation = evaluateTransform(object, Math.max(sceneFrame, state.currentFrame - 1)).rotation;
          transform = { ...transform, rotation: unwrapRotation(transform.rotation, referenceRotation) };
        }
        for (const property of ['position', 'rotation', 'scale'] as const) {
          const editingExistingPoint = object.kind !== 'camera'
            && state.selectedMotion?.objectId === id
            && state.selectedMotion.sceneId === scene?.id
            && object.keyframes.some((key) => key.property === property && key.frame === state.currentFrame && key.purpose === 'motion');
          if ((motionActive && object.kind !== 'camera') || selectedKey || editingExistingPoint) putMotionKey(object, sceneFrame, state.currentFrame, property, transform[property], state.interpolation);
          else putKey(object, sceneFrame, property, transform[property], 'constant', false, 'snapshot');
        }
      }
      if (object.kind === 'camera') {
        if (scene) {
          const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(transform.rotation[0]),
            THREE.MathUtils.degToRad(transform.rotation[1]),
            THREE.MathUtils.degToRad(transform.rotation[2]),
          ));
          scene.framing.target = new THREE.Vector3(...transform.position).addScaledVector(forward, scene.framing.distance).toArray() as Vec3;
        }
        makeCameraShotIndependent(next, object, sceneFrame, !sessionActive && state.currentFrame === sceneFrame);
      } else closePreviousScene(object, sceneFrame);
      if (sessionActive && nextSession) commitRecording(next, nextSession); else commit(next);
      if (object.id !== id) set({
        selectedId: object.id,
        selectedMotion: motionActive ? { objectId: object.id, sceneId: scene!.id } : undefined,
        recordingMotion: motionActive ? { ...state.recordingMotion!, objectId: object.id, sceneId: scene!.id } : state.recordingMotion,
      });
    },
    keyPose: (id) => {
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      ensureSceneSnapshots(next);
      const transform = evaluateTransform(object, state.currentFrame);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      for (const property of ['position', 'rotation', 'scale'] as const) {
        putMotionKey(object, sceneFrame, state.currentFrame, property, transform[property], state.interpolation);
      }
      if (object.kind === 'camera') {
        makeCameraShotIndependent(next, object, sceneFrame, state.currentFrame === sceneFrame);
      } else closePreviousScene(object, sceneFrame);
      commit(next);
    },
    updateMotionPoint: (objectId, keyframeId, position) => {
      if (!position.every(Number.isFinite)) return;
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId);
      const key = object?.keyframes.find((item) => item.id === keyframeId && item.property === 'position');
      if (!object || !key) return;
      key.value = structuredClone(position);
      key.purpose = 'motion';
      key.source = 'user';
      object.keyframes = object.keyframes.filter((item) => item.id === key.id || item.property !== 'position' || item.frame !== key.frame);
      commit(next);
    },
    insertMotionPoint: (objectId, sceneId, requestedFrame, position) => {
      if (!position.every(Number.isFinite)) return undefined;
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === objectId);
      const range = sceneRange(next, sceneId);
      if (!object || !range || object.kind === 'audio' || object.kind.includes('light') || object.screenSpace) return undefined;
      const frame = Math.max(range.scene.frame, Math.min(range.end - 1, Math.round(requestedFrame)));
      const existingKeys = object.keyframes.filter((item) => item.frame === frame && item.property === 'position');
      let key = existingKeys[0];
      if (key) Object.assign(key, { value: structuredClone(position), interpolation: state.interpolation, source: 'user', purpose: 'motion', commentIds: [] });
      else {
        key = { id: crypto.randomUUID(), frame, property: 'position', value: structuredClone(position), interpolation: state.interpolation, source: 'user', purpose: 'motion', commentIds: [] };
        object.keyframes.push(key);
      }
      object.keyframes = object.keyframes.filter((item) => item.id === key!.id || item.property !== 'position' || item.frame !== frame);
      closePreviousScene(object, range.scene.frame);
      commit(next);
      return key.id;
    },
    setMotionPointHold: (objectId, keyframeId, requestedHoldFrames) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId);
      const reference = object?.keyframes.find((item) => item.id === keyframeId && item.property === 'position');
      if (!object || !reference) return;
      const referenceScene = next.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((scene) => scene.frame <= reference.frame);
      const referenceSceneEnd = next.cameraCuts.filter((scene) => scene.frame > (referenceScene?.frame ?? reference.frame)).sort((a, b) => a.frame - b.frame)[0]?.frame ?? next.settings.frameEnd + 1;
      const followingFrame = object.keyframes
        .filter((key) => key.property === 'position' && key.purpose === 'motion' && key.frame > reference.frame && key.frame < referenceSceneEnd)
        .sort((a, b) => a.frame - b.frame)[0]?.frame;
      const maximum = followingFrame === undefined ? 0 : Math.max(0, followingFrame - reference.frame - 1);
      const holdFrames = Math.max(0, Math.min(maximum, Math.round(requestedHoldFrames)));
      for (const key of object.keyframes) {
        if (key.frame === reference.frame && key.purpose === 'motion') key.holdFrames = holdFrames;
      }
      commit(next);
    },
    moveMotionPoint: (objectId, keyframeId, requestedFrame) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId);
      const reference = object?.keyframes.find((key) => key.id === keyframeId && key.property === 'position');
      if (!object || !reference) return;
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const sceneIndex = scenes.findIndex((scene, index) => reference.frame >= scene.frame && reference.frame < (scenes[index + 1]?.frame ?? next.settings.frameEnd + 1));
      const scene = scenes[sceneIndex];
      if (!scene) return;
      const sceneEnd = scenes[sceneIndex + 1]?.frame ?? next.settings.frameEnd + 1;
      const frame = Math.max(scene.frame, Math.min(sceneEnd - 1, Math.round(requestedFrame)));
      const startTransform = evaluateTransform(object, scene.frame);
      const sourceKeys = object.keyframes.filter((key) => key.frame === reference.frame && ['position', 'rotation', 'scale'].includes(key.property) && (key.purpose === 'motion' || (key.purpose === undefined && key.frame !== scene.frame)));
      const uniqueByProperty = new Map<string, typeof reference>();
      for (const key of sourceKeys) if (!uniqueByProperty.has(key.property) || key.id === reference.id) uniqueByProperty.set(key.property, key);
      const moving = [...uniqueByProperty.values()];
      const properties = new Set(moving.map((key) => key.property));
      object.keyframes = object.keyframes.filter((key) => !sourceKeys.includes(key) && !(key.frame === frame && properties.has(key.property)));
      for (const key of moving) object.keyframes.push({ ...key, frame });
      for (const property of ['position', 'rotation', 'scale'] as const) {
        if (!object.keyframes.some((key) => key.frame === scene.frame && key.property === property)) putKey(object, scene.frame, property, startTransform[property], 'constant', false, 'snapshot');
      }
      closePreviousScene(object, scene.frame);
      commit(next);
    },
    resizeMotionRange: (objectId, sceneId, requestedStart, requestedEnd) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId);
      const range = sceneRange(next, sceneId);
      if (!object || !range) return;
      ensureSceneSnapshots(next);
      const transformProperties = new Set<AnimProperty>(['position', 'rotation', 'scale']);
      const isMotionKey = (key: SceneObject['keyframes'][number]) => key.frame >= range.scene.frame
        && key.frame < range.end
        && transformProperties.has(key.property)
        && (key.purpose === 'motion' || (key.purpose === undefined && key.frame !== range.scene.frame));
      const motionKeys = object.keyframes.filter(isMotionKey);
      const sourceFrames = [...new Set(motionKeys.map((key) => key.frame))].sort((a, b) => a - b);
      if (sourceFrames.length < 2) return;
      const sourceStart = sourceFrames[0], sourceLast = sourceFrames[sourceFrames.length - 1];
      const startFrame = Math.max(range.scene.frame, Math.min(range.end - 2, Math.round(requestedStart)));
      const endFrame = Math.min(range.end, Math.max(startFrame + 2, Math.round(requestedEnd)));
      const targetLast = endFrame - 1;
      const startTransform = evaluateTransform(object, sourceStart);
      const mapped = new Map<number, number>();
      for (const sourceFrame of sourceFrames) {
        const ratio = (sourceFrame - sourceStart) / Math.max(1, sourceLast - sourceStart);
        mapped.set(sourceFrame, Math.round(startFrame + ratio * (targetLast - startFrame)));
      }
      object.keyframes = object.keyframes.filter((key) => !isMotionKey(key));
      for (const key of motionKeys.sort((a, b) => a.frame - b.frame)) {
        const frame = mapped.get(key.frame)!;
        object.keyframes = object.keyframes.filter((existing) => existing.frame !== frame || existing.property !== key.property);
        object.keyframes.push({ ...key, frame });
      }
      for (const property of ['position', 'rotation', 'scale'] as const) {
        if (!object.keyframes.some((key) => key.frame === range.scene.frame && key.property === property)) {
          putKey(object, range.scene.frame, property, startTransform[property], 'constant', false, 'snapshot');
        }
      }
      closePreviousScene(object, range.scene.frame);
      commit(next);
    },
    deleteMotionPoint: (objectId, keyframeId) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId);
      const reference = object?.keyframes.find((key) => key.id === keyframeId && key.property === 'position');
      if (!object || !reference) return;
      const sceneFrame = activeSceneStart(next, reference.frame);
      const startTransform = evaluateTransform(object, sceneFrame);
      object.keyframes = object.keyframes.filter((key) => !(key.frame === reference.frame && ['position', 'rotation', 'scale'].includes(key.property) && (key.purpose === 'motion' || (key.purpose === undefined && key.frame !== sceneFrame))));
      for (const property of ['position', 'rotation', 'scale'] as const) {
        if (!object.keyframes.some((key) => key.frame === sceneFrame && key.property === property)) putKey(object, sceneFrame, property, startTransform[property], 'constant', false, 'snapshot');
      }
      closePreviousScene(object, sceneFrame);
      commit(next);
    },
    keyProperty: (id, property) => {
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      const value = evaluateProperty(object, property, state.currentFrame);
      const existing = object.keyframes.find((key) => key.frame === state.currentFrame && key.property === property);
      if (existing) Object.assign(existing, { value, interpolation: state.interpolation, source: 'user', purpose: 'motion', commentIds: [] });
      else object.keyframes.push({ id: crypto.randomUUID(), frame: state.currentFrame, property, value, interpolation: state.interpolation, source: 'user', purpose: 'motion', commentIds: [] });
      commit(next);
    },
    deleteKeyframe: (objectId, keyframeId) => {
      const next = snapshot(get().project);
      const object = next.objects.find((item) => item.id === objectId);
      if (!object) return;
      object.keyframes = object.keyframes.filter((key) => key.id !== keyframeId);
      commit(next);
    },
    setTimelineComment: (scope, sceneId, text, objectId) => {
      const state = get();
      const clean = text.trim();
      const next = snapshot(state.project);
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const sceneIndex = scenes.findIndex((scene) => scene.id === sceneId);
      const scene = scenes[sceneIndex];
      if (!scene || (scope === 'object' && (!objectId || !next.objects.some((object) => object.id === objectId && object.kind !== 'camera' && !object.kind.includes('light'))))) return;
      const inferredScope = (comment: AbacoProject['comments'][number]): TimelineCommentScope => comment.scope ?? (comment.targetIds.length ? 'object' : 'scene');
      const inferredSceneId = (comment: AbacoProject['comments'][number]) => comment.sceneId ?? scenes.filter((candidate) => candidate.frame <= comment.startFrame).at(-1)?.id;
      const existing = next.comments.find((comment) => comment.kind !== 'transition' && inferredScope(comment) === scope && inferredSceneId(comment) === sceneId && (scope !== 'object' || comment.targetIds.includes(objectId!)));
      if (!clean) {
        if (!existing) return;
        next.comments = next.comments.filter((comment) => comment.id !== existing.id);
      } else {
        const fields = {
          text: clean,
          presets: resolvePresets(clean, scope, existing?.presets),
          targetIds: scope === 'object' ? [objectId!] : scope === 'framing' ? [scene.cameraId] : [],
          startFrame: scene.frame,
          endFrame: Math.max(scene.frame, (scenes[sceneIndex + 1]?.frame ?? next.settings.frameEnd + 1) - 1),
          status: 'pending' as const,
          kind: 'direction' as const,
          scope,
          sceneId,
        };
        if (existing) Object.assign(existing, fields);
        else next.comments.push({ id: crypto.randomUUID(), ...fields });
      }
      commit(next);
    },
    addTransitionComment: (fromSceneId, toSceneId, text) => {
      const state = get();
      const clean = text.trim();
      if (!clean) return;
      const next = snapshot(state.project);
      const from = next.cameraCuts.find((scene) => scene.id === fromSceneId);
      const to = next.cameraCuts.find((scene) => scene.id === toSceneId);
      if (!from || !to || from.frame >= to.frame) return;
      const existing = next.comments.find((comment) => comment.kind === 'transition' && comment.fromSceneId === fromSceneId && comment.toSceneId === toSceneId);
      if (existing) Object.assign(existing, { text: clean, startFrame: from.frame, endFrame: to.frame, status: 'pending' as const });
      else next.comments.push({ id: crypto.randomUUID(), text: clean, targetIds: [], startFrame: from.frame, endFrame: to.frame, status: 'pending', kind: 'transition', fromSceneId, toSceneId });
      commit(next);
    },
    addCameraCut: () => {
      const state = get();
      const selected = state.project.objects.find((object) => object.id === state.selectedId);
      if (!selected || selected.kind !== 'camera') return;
      const next = snapshot(state.project);
      const existing = next.cameraCuts.find((cut) => cut.frame === state.currentFrame);
      if (existing) existing.cameraId = selected.id;
      else next.cameraCuts.push({ id: crypto.randomUUID(), cameraId: selected.id, frame: state.currentFrame, source: 'user', commentIds: [], lighting: defaultLighting(), background: defaultBackground(), framing: defaultCameraFraming() });
      commit(next);
    },
    acceptPlan: (plan) => commit(applyPlan(get().project, plan)),
    acceptJevPlan: (plan, sceneId) => {
      const current = get().project;
      const next = snapshot(current);
      const scenes = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const sceneIndex = scenes.findIndex((scene) => scene.id === sceneId);
      const scene = scenes[sceneIndex];
      if (!scene) return;
      const sceneEnd = scenes[sceneIndex + 1]?.frame ?? next.settings.frameEnd + 1;
      const touched = new Map<string, Set<string>>();
      plan.operations.filter((operation) => operation.type === 'set_keyframe').forEach((operation) => {
        const properties = touched.get(operation.objectId) ?? new Set<string>();
        properties.add(operation.property); touched.set(operation.objectId, properties);
      });
      next.objects.forEach((object) => {
        const properties = touched.get(object.id);
        if (!properties) return;
        object.keyframes = object.keyframes.filter((key) => !(key.frame >= scene.frame && key.frame < sceneEnd && properties.has(key.property) && key.source === 'ai' && key.purpose === 'motion' && key.commentIds.length === 0));
      });
      if (plan.directionPlan) {
        next.directionPlans = [...(next.directionPlans ?? []).filter((entry) => entry.sceneId !== sceneId || entry.objectId !== plan.directionPlan!.objectId), plan.directionPlan];
      }
      commit(applyPlan(next, plan));
    },
    undo: () => set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { project: previous, currentFrame: Math.max(previous.settings.frameStart, Math.min(previous.settings.frameEnd, state.currentFrame)), selectedId: previous.objects.some((object) => object.id === state.selectedId) ? state.selectedId : undefined, selectedMotion: undefined, past: state.past.slice(0, -1), future: [snapshot(state.project), ...state.future], recordingMotion: undefined, recordingSession: undefined, isPlaying: false, dirty: true };
    }),
    redo: () => set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return { project: next, currentFrame: Math.max(next.settings.frameStart, Math.min(next.settings.frameEnd, state.currentFrame)), selectedId: next.objects.some((object) => object.id === state.selectedId) ? state.selectedId : undefined, selectedMotion: undefined, past: [...state.past, snapshot(state.project)], future: state.future.slice(1), recordingMotion: undefined, recordingSession: undefined, isPlaying: false, dirty: true };
    }),
  };
});

if (typeof localStorage !== 'undefined') {
  let lastProject = useEditor.getState().project;
  let draftTimer: number | undefined;
  useEditor.subscribe((state) => {
    if (state.project === lastProject) return;
    lastProject = state.project;
    if (draftTimer) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      try { localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(lastProject)); } catch { /* spazio locale non disponibile */ }
      draftTimer = undefined;
    }, 350);
  });
}
