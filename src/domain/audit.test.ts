import { beforeEach, describe, expect, it } from 'vitest';
import { applyPlan, evaluateProperty, validatePlan } from './animation';
import { objectPresenceRange } from './presence';
import { createProject, createSceneObject, ProjectSchema, type AnimProperty, type BlenderPlan, type KeyframeValue } from './schema';
import { useEditor } from '../store/editor';

describe('Keyframe payload validation', () => {
  it.each<[AnimProperty, KeyframeValue]>([
    ['position', 10], ['rotation', 'invalid'], ['scale', [-1, 1, 1]],
    ['visibility', [1, 0, 0]], ['text', false], ['lens', 0],
  ])('rejects an incompatible %s value in saved projects and AI plans', (property, value) => {
    const project = createProject();
    const object = project.objects[0];
    object.keyframes.push({ id: crypto.randomUUID(), frame: 1, property, value, interpolation: 'linear', source: 'ai', commentIds: [] });
    expect(ProjectSchema.safeParse(project).success).toBe(false);
    object.keyframes = [];
    const plan: BlenderPlan = {
      schemaVersion: 'BlenderPlanV1', summary: '', assumptions: [], warnings: [],
      operations: [{ id: 'invalid', type: 'set_keyframe', objectId: object.id, frame: 1, property,
        value: { vector: Array.isArray(value) ? value : null, number: typeof value === 'number' ? value : null,
          boolean: typeof value === 'boolean' ? value : null, text: typeof value === 'string' ? value : null },
        interpolation: 'linear', rationale: '', commentIds: [] }],
    };
    expect(validatePlan(project, plan).length).toBeGreaterThan(0);
    expect(() => applyPlan(project, plan)).toThrow();
    expect(object.keyframes).toHaveLength(0);
  });
});

describe('Timeline visibility intervals', () => {
  it('matches frame evaluation at scene boundaries and duplicate visibility keys', () => {
    const object = createSceneObject('cube', 1);
    object.visible = false;
    object.keyframes = [[5, true], [10, false], [10, true], [16, false], [30, true]].map(([frame, value]) => ({
      id: crypto.randomUUID(), property: 'visibility', frame: frame as number, value: value as boolean,
      interpolation: 'constant', source: 'user', commentIds: [],
    }));
    for (let start = 1; start < 40; start += 1) {
      for (let end = start + 1; end < 41; end += 1) {
        const frames = Array.from({ length: end - start }, (_, i) => start + i);
        const first = frames.find((frame) => evaluateProperty(object, 'visibility', frame));
        const last = first === undefined ? undefined : frames.find((frame) => frame > first && !evaluateProperty(object, 'visibility', frame)) ?? end;
        expect(objectPresenceRange(object, start, end)).toEqual(first === undefined ? undefined : [first, last]);
      }
    }
  });

  it('uses visibility keys rather than scanning every frame of long scenes', () => {
    const object = createSceneObject('cube', 1);
    let reads = 0;
    Object.defineProperty(object, 'keyframes', { get: () => { reads += 1; return []; } });
    expect(objectPresenceRange(object, 1, 10_000_000)).toEqual([1, 10_000_000]);
    expect(reads).toBe(1);
  });
});

describe('Deleting scenes', () => {
  beforeEach(() => useEditor.getState().newProject());

  it('prunes memberships, objects exclusive to the deleted scene and their comments', () => {
    useEditor.getState().addObject('cube');
    const sharedId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const second = useEditor.getState().project.cameraCuts[1];
    useEditor.getState().addObject('text');
    const localId = useEditor.getState().selectedId!;
    const project = structuredClone(useEditor.getState().project);
    project.comments.push({ id: crypto.randomUUID(), text: 'Local note', targetIds: [localId], startFrame: 1, endFrame: 1, status: 'pending' });
    project.comments.push({ id: crypto.randomUUID(), text: 'Camera note', targetIds: [second.cameraId], startFrame: 1, endFrame: 1, status: 'pending' });
    useEditor.setState({ project });
    useEditor.getState().deleteScene(second.id);
    const result = useEditor.getState().project;
    expect(result.objects.some((object) => object.id === localId)).toBe(false);
    expect(result.objects.find((object) => object.id === sharedId)?.sceneIds).toEqual([result.cameraCuts[0].id]);
    expect(result.comments).toEqual([]);
    expect(ProjectSchema.safeParse(result).success).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().project).toEqual(project);
  });
});

describe('Store input and history invariants', () => {
  beforeEach(() => useEditor.getState().newProject());

  it('ignores invalid numeric settings without destroying the last valid projection', () => {
    const original = useEditor.getState().project;
    useEditor.getState().updateSettings({ fps: 0, resolutionX: NaN, resolutionY: 0, frameStart: -1, frameEnd: Infinity });
    expect(useEditor.getState().project).toBe(original);
    useEditor.getState().updateSettings({ fps: 121, resolutionX: 12.5 });
    expect(useEditor.getState().project).toBe(original);
    useEditor.getState().updateSettings({ fps: 30, resolutionY: 720 });
    expect(useEditor.getState().project.settings).toMatchObject({ fps: 30, resolutionY: 720 });
  });

  it('rejects invalid transforms before adding broken values to animation', () => {
    const original = useEditor.getState().project;
    const camera = original.objects[0];
    useEditor.getState().setTransform(camera.id, { ...camera.transform, position: [NaN, 0, 0] });
    useEditor.getState().setTransform(camera.id, { ...camera.transform, scale: [0, 1, 1] });
    expect(useEditor.getState().project).toBe(original);
  });

  it('keeps the playhead and selection valid when undo removes a scene or object', () => {
    useEditor.getState().addShot();
    expect(useEditor.getState().currentFrame).toBe(73);
    useEditor.getState().undo();
    expect(useEditor.getState().currentFrame).toBe(72);
    useEditor.getState().addObject('cube');
    const objectId = useEditor.getState().selectedId!;
    useEditor.getState().selectMotion({ objectId, sceneId: useEditor.getState().project.cameraCuts[0].id });
    useEditor.getState().undo();
    expect(useEditor.getState().selectedId).toBeUndefined();
    expect(useEditor.getState().selectedMotion).toBeUndefined();
    useEditor.getState().redo();
    expect(useEditor.getState().currentFrame).toBeLessThanOrEqual(useEditor.getState().project.settings.frameEnd);
  });

  it('applies delayed background imports to their original scene', () => {
    const firstId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().addShot();
    useEditor.getState().updateBackground({ kind: 'image', path: '/tmp/backdrop.png', name: 'Backdrop' }, firstId);
    expect(useEditor.getState().project.cameraCuts[0].background.kind).toBe('image');
    expect(useEditor.getState().project.cameraCuts[1].background.kind).toBe('none');
  });
});
