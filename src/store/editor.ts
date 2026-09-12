import { create } from 'zustand';
import { createProject, createSceneObject, defaultBackground, defaultCameraFraming, defaultLighting, ProjectSchema, type AbacoProject, type AnimProperty, type BackgroundSettings, type BlenderPlan, type Interpolation, type KeyframeValue, type LightingSettings, type ObjectKind, type SceneObject, type TimelineCommentScope, type Transform, type Vec3 } from '../domain/schema';
import { applyPlan, evaluateProperty, evaluateTransform } from '../domain/animation';

type EditorState = {
  project: AbacoProject;
  projectPath?: string;
  selectedId?: string;
  currentFrame: number;
  isPlaying: boolean;
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
  setInterpolation(value: Interpolation): void;
  setGizmoMode(value: 'translate' | 'rotate' | 'scale'): void;
  addObject(kind: ObjectKind): void;
  addBlendAsset(asset: { sourcePath: string; proxyPath: string; collectionName: string; name: string; boundsCenter: Vec3; previewScale: number }): void;
  addShot(): void;
  splitScene(): void;
  resizeScene(id: string, durationFrames: number): void;
  setTransitionMode(objectId: string, sceneId: string, mode: Interpolation): void;
  removeSelected(): void;
  updateObject(id: string, patch: Record<string, unknown>): void;
  setSceneNote(id: string, text: string): void;
  updateSettings(patch: Partial<AbacoProject['settings']>): void;
  updateLighting(patch: Partial<LightingSettings>): void;
  updateBackground(background: BackgroundSettings): void;
  resetFraming(): void;
  setCameraFraming(sceneId: string, position: Vec3, rotation: Vec3, target: Vec3): void;
  reorderObjects(sourceId: string, targetId: string): void;
  deleteObject(id: string): void;
  setTransform(id: string, transform: Transform): void;
  keyPose(id: string): void;
  keyProperty(id: string, property: 'visibility' | 'text'): void;
  deleteKeyframe(objectId: string, keyframeId: string): void;
  setTimelineComment(scope: TimelineCommentScope, sceneId: string, text: string, objectId?: string): void;
  addTransitionComment(fromSceneId: string, toSceneId: string, text: string): void;
  addCameraCut(): void;
  acceptPlan(plan: BlenderPlan): void;
  undo(): void;
  redo(): void;
};

const snapshot = (project: AbacoProject) => structuredClone(project);
const LOCAL_DRAFT_KEY = 'abaco-animatic-project-v1';
const initialProject = () => {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCAL_DRAFT_KEY);
    return saved ? ProjectSchema.parse(JSON.parse(saved)) : createProject();
  } catch {
    return createProject();
  }
};

const sceneStarts = (project: AbacoProject) => [...new Set(project.cameraCuts.map((cut) => cut.frame))].sort((a, b) => a - b);
const activeSceneStart = (project: AbacoProject, frame: number) => sceneStarts(project).filter((start) => start <= frame).at(-1) ?? project.settings.frameStart;
const putKey = (object: SceneObject, frame: number, property: AnimProperty, value: KeyframeValue, interpolation: Interpolation = 'constant', preserveInterpolation = false) => {
  const existing = object.keyframes.find((key) => key.frame === frame && key.property === property);
  const data = { value: structuredClone(value), interpolation, source: 'user' as const, commentIds: [] };
  if (existing) Object.assign(existing, preserveInterpolation ? { ...data, interpolation: existing.interpolation } : data);
  else object.keyframes.push({ id: crypto.randomUUID(), frame, property, ...data });
};

const makeCameraShotIndependent = (project: AbacoProject, camera: SceneObject, sceneFrame: number) => {
  const frames = sceneStarts(project);
  const sceneIndex = frames.indexOf(sceneFrame);
  const affectedFrames = sceneIndex > 0 ? [frames[sceneIndex - 1], sceneFrame] : [sceneFrame];
  const properties: AnimProperty[] = ['position', 'rotation', 'scale', 'lens'];
  for (const key of camera.keyframes) {
    if (affectedFrames.includes(key.frame) && properties.includes(key.property)) key.interpolation = 'constant';
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
  return {
    project: initialProject(), currentFrame: 1, isPlaying: false, interpolation: 'bezier', gizmoMode: 'translate', past: [], future: [], dirty: false,
    newProject: () => set({ project: createProject(), projectPath: undefined, selectedId: undefined, currentFrame: 1, past: [], future: [], dirty: false }),
    loadProject: (project, projectPath) => set({ project, projectPath, selectedId: undefined, currentFrame: project.settings.frameStart, past: [], future: [], dirty: false }),
    markSaved: (project, projectPath) => set({ project, projectPath, dirty: false }),
    select: (selectedId) => set({ selectedId }),
    setFrame: (frame) => set((state) => ({ currentFrame: Math.max(state.project.settings.frameStart, Math.min(state.project.settings.frameEnd, Math.round(frame))) })),
    setPlaying: (isPlaying) => set({ isPlaying }),
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
      object.visible = sceneFrame === next.settings.frameStart;
      putKey(object, sceneFrame, 'position', object.transform.position);
      putKey(object, sceneFrame, 'rotation', object.transform.rotation);
      putKey(object, sceneFrame, 'scale', object.transform.scale);
      if (sceneFrame > next.settings.frameStart) {
        putKey(object, next.settings.frameStart, 'visibility', false, 'constant');
        putKey(object, sceneFrame - 1, 'visibility', false, 'constant');
      }
      putKey(object, sceneFrame, 'visibility', true, 'constant');
      if (kind === 'text') putKey(object, sceneFrame, 'text', object.text, 'constant');
      next.objects.push(object);
      commit(next);
      set({ selectedId: object.id });
    },
    addBlendAsset: (asset) => {
      const state = get();
      const object = createSceneObject('blend_asset', state.project.objects.filter((item) => item.kind === 'blend_asset').length + 1);
      object.name = asset.name;
      object.asset = {
        sourcePath: asset.sourcePath, proxyPath: asset.proxyPath, collectionName: asset.collectionName,
        boundsCenter: structuredClone(asset.boundsCenter), previewScale: asset.previewScale,
      };
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      object.visible = sceneFrame === next.settings.frameStart;
      putKey(object, sceneFrame, 'position', object.transform.position);
      putKey(object, sceneFrame, 'rotation', object.transform.rotation);
      putKey(object, sceneFrame, 'scale', object.transform.scale);
      if (sceneFrame > next.settings.frameStart) {
        putKey(object, next.settings.frameStart, 'visibility', false, 'constant');
        putKey(object, sceneFrame - 1, 'visibility', false, 'constant');
      }
      putKey(object, sceneFrame, 'visibility', true, 'constant');
      next.objects.push(object);
      commit(next);
      set({ selectedId: object.id });
    },
    addShot: () => {
      const state = get();
      const next = snapshot(state.project);
      ensureSceneSnapshots(next);
      const sourceFrame = activeSceneStart(next, state.currentFrame);
      const cuts = next.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
      const sourceCut = cuts.filter((cut) => cut.frame <= sourceFrame).at(-1) ?? cuts[0];
      if (!sourceCut) return;
      const nextFrame = (cuts.at(-1)?.frame ?? next.settings.frameStart) + next.settings.fps * 3;
      next.settings.frameEnd = Math.max(next.settings.frameEnd, nextFrame + next.settings.fps * 3 - 1);
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
      next.cameraCuts.push({ id: crypto.randomUUID(), cameraId: sourceCut.cameraId, frame: nextFrame, source: 'user', commentIds: [], name: `Scena ${cuts.length + 1}`, transition: 'auto', lighting: structuredClone(sourceCut.lighting), background: structuredClone(sourceCut.background), framing: structuredClone(sourceCut.framing) });
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
      const following = scenes[index + 1];
      if (following) next.comments.forEach((comment) => { if (comment.kind === 'transition' && comment.fromSceneId === scene.id && comment.toSceneId === following.id) comment.fromSceneId = split.id; });
      renameScenes(next);
      syncScopedCommentRanges(next);
      commit(next);
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
      const animatedProperties: AnimProperty[] = ['position', 'rotation', 'scale', ...(object.kind === 'camera' ? ['lens' as const] : [])];
      for (const key of object.keyframes) if (key.frame === scene.frame && animatedProperties.includes(key.property)) key.interpolation = mode;
      commit(next);
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
    updateSettings: (patch) => {
      const next = snapshot(get().project);
      next.settings = { ...next.settings, ...patch };
      next.settings.frameEnd = Math.max(next.settings.frameStart, next.settings.frameEnd);
      commit(next);
      set((state) => ({ currentFrame: Math.min(state.currentFrame, next.settings.frameEnd) }));
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
    updateBackground: (background) => {
      const state = get();
      const next = snapshot(state.project);
      const scene = next.cameraCuts.find((cut) => cut.frame === activeSceneStart(next, state.currentFrame));
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
    },
    resetFraming: () => {
      const state = get();
      const next = snapshot(state.project);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      const cameraId = next.cameraCuts.find((cut) => cut.frame === sceneFrame)?.cameraId;
      const scene = next.cameraCuts.find((cut) => cut.frame === sceneFrame);
      const camera = next.objects.find((object) => object.id === cameraId && object.kind === 'camera');
      if (!camera || !scene) return;
      const defaults = createSceneObject('camera', 1);
      putKey(camera, sceneFrame, 'position', defaults.transform.position, 'constant');
      putKey(camera, sceneFrame, 'rotation', defaults.transform.rotation, 'constant');
      putKey(camera, sceneFrame, 'scale', defaults.transform.scale, 'constant');
      putKey(camera, sceneFrame, 'lens', 50, 'constant');
      scene.framing = defaultCameraFraming();
      makeCameraShotIndependent(next, camera, sceneFrame);
      commit(next);
    },
    setCameraFraming: (sceneId, position, rotation, target) => {
      const next = snapshot(get().project);
      const scene = next.cameraCuts.find((cut) => cut.id === sceneId);
      const camera = next.objects.find((object) => object.id === scene?.cameraId && object.kind === 'camera');
      if (!scene || !camera || ![...position, ...rotation, ...target].every(Number.isFinite)) return;
      ensureSceneSnapshots(next);
      putKey(camera, scene.frame, 'position', position, 'constant');
      putKey(camera, scene.frame, 'rotation', rotation, 'constant');
      putKey(camera, scene.frame, 'scale', evaluateTransform(camera, scene.frame).scale, 'constant');
      scene.framing = {
        target: structuredClone(target),
        distance: Math.max(0.5, Math.min(100, Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]))),
      };
      makeCameraShotIndependent(next, camera, scene.frame);
      commit(next);
    },
    setTransform: (id, transform) => {
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      ensureSceneSnapshots(next);
      const sceneFrame = activeSceneStart(next, state.currentFrame);
      for (const property of ['position', 'rotation', 'scale'] as const) putKey(object, sceneFrame, property, transform[property], 'constant', object.kind !== 'camera');
      if (object.kind === 'camera') makeCameraShotIndependent(next, object, sceneFrame);
      commit(next);
    },
    keyPose: (id) => {
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      const transform = evaluateTransform(object, state.currentFrame);
      for (const property of ['position', 'rotation', 'scale'] as const) {
        const existing = object.keyframes.find((key) => key.frame === state.currentFrame && key.property === property);
        const value = transform[property];
        if (existing) Object.assign(existing, { value, interpolation: state.interpolation, source: 'user', commentIds: [] });
        else object.keyframes.push({ id: crypto.randomUUID(), frame: state.currentFrame, property, value, interpolation: state.interpolation, source: 'user', commentIds: [] });
      }
      commit(next);
    },
    keyProperty: (id, property) => {
      const state = get();
      const next = snapshot(state.project);
      const object = next.objects.find((item) => item.id === id);
      if (!object) return;
      const value = evaluateProperty(object, property, state.currentFrame);
      const existing = object.keyframes.find((key) => key.frame === state.currentFrame && key.property === property);
      if (existing) Object.assign(existing, { value, interpolation: state.interpolation, source: 'user', commentIds: [] });
      else object.keyframes.push({ id: crypto.randomUUID(), frame: state.currentFrame, property, value, interpolation: state.interpolation, source: 'user', commentIds: [] });
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
    undo: () => set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { project: previous, past: state.past.slice(0, -1), future: [snapshot(state.project), ...state.future], dirty: true };
    }),
    redo: () => set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return { project: next, past: [...state.past, snapshot(state.project)], future: state.future.slice(1), dirty: true };
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
