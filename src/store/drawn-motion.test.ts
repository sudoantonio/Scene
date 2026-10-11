import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, ProjectSchema, type Vec3 } from '../domain/schema';
import { evaluateTransform } from '../domain/animation';
import { useEditor, type DrawnMotionCheckpoint } from './editor';
import { hydratePortableProject, projectForStorage } from '../../electron/project-storage';

beforeEach(() => {
  useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedIds: [], selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, past: [], future: [], dirty: false, isPlaying: false });
  useEditor.getState().addObject('cube');
});
afterEach(() => useEditor.getState().stopRecording());
const id = () => useEditor.getState().selectedId!;
const target = () => useEditor.getState().project.objects.find(object => object.id === id())!;
const motionKeys = () => target().keyframes.filter(key => key.property === 'position' && key.purpose === 'motion').sort((a, b) => a.frame - b.frame);
const begin = () => useEditor.getState().startRecording(useEditor.getState().project.cameraCuts[0].id);
const checkpoint = (): DrawnMotionCheckpoint => {
  const state = useEditor.getState();
  return { project: state.project, currentFrame: state.currentFrame, recordingSession: state.recordingSession, recordingMotion: state.recordingMotion, selectedMotion: state.selectedMotion, past: state.past, future: state.future, dirty: state.dirty, isPlaying: state.isPlaying };
};

describe('object motion paths and live recording', () => {
  it('creates frame-by-frame translation with one undo and no stroke object', () => {
    const before = useEditor.getState().project;
    const history = useEditor.getState().past.length;
    expect(useEditor.getState().applyDrawnMotion(id(), [[0, 0, 1], [1, 0, 1], [1, 1, 1]], 2)).toBe(true);
    const end = 1 + useEditor.getState().project.settings.fps * 2;
    expect(motionKeys()).toHaveLength(end);
    expect(evaluateTransform(target(), end).position).toEqual([1, 1, 1]);
    expect(useEditor.getState().past).toHaveLength(history + 1);
    expect(useEditor.getState().project.objects.some(object => object.kind === 'stroke')).toBe(false);
    useEditor.getState().undo(); expect(useEditor.getState().project).toEqual(before);
    useEditor.getState().redo(); expect(evaluateTransform(target(), end).position).toEqual([1, 1, 1]);
  });
  it('preserves rotation, scale and position points outside the path interval', () => {
    useEditor.getState().updateObject(id(), { keyframes: [...target().keyframes,
      { id: 'later', frame: 90, property: 'position', value: [9, 8, 7], interpolation: 'linear', purpose: 'motion', source: 'user', commentIds: [] },
      { id: 'rotation', frame: 20, property: 'rotation', value: [0, 0, 90], interpolation: 'linear', purpose: 'motion', source: 'user', commentIds: [] },
    ] });
    const rotation = target().keyframes.filter(key => key.property === 'rotation');
    useEditor.getState().applyDrawnMotion(id(), [[0, 0, 1], [2, 0, 1]], 1);
    expect(target().keyframes.find(key => key.id === 'later')?.value).toEqual([9, 8, 7]);
    expect(target().keyframes.filter(key => key.property === 'rotation')).toEqual(rotation);
  });
  it('keeps every recorded turn and coalesces updates within one frame', () => {
    begin(); const editor = useEditor.getState();
    let key = editor.recordDrawnPosition(id(), [1, 0, 1], 5, 1)!;
    key = editor.recordDrawnPosition(id(), [2, 0, 1], 5, 1, key.keyId)!;
    expect(key.frame).toBe(5);
    expect(evaluateTransform(target(), 4).position).toEqual([0, 0, 1]);
    key = editor.recordDrawnPosition(id(), [2, 2, 1], 6, 1, key.keyId)!;
    key = editor.recordDrawnPosition(id(), [0, 2, 1], 7, 1, key.keyId)!;
    expect(motionKeys().map(key => [key.frame, key.value])).toEqual([[1, [0, 0, 1]], [5, [2, 0, 1]], [6, [2, 2, 1]], [7, [0, 2, 1]]]);
    expect(useEditor.getState().currentFrame).toBe(7);
  });
  it('holds a pose during a recording pause', () => {
    begin(); const editor = useEditor.getState();
    const key = editor.recordDrawnPosition(id(), [2, 0, 1], 5, 1)!;
    editor.recordDrawnPosition(id(), [2, 2, 1], 30, 1, key.keyId);
    expect(evaluateTransform(target(), 20).position).toEqual([2, 0, 1]);
    expect(evaluateTransform(target(), 30).position).toEqual([2, 2, 1]);
  });
  it('preserves authored collisions and extends the shot without overwriting a later pose', () => {
    useEditor.getState().updateObject(id(), { keyframes: [...target().keyframes, { id: 'authored', frame: 5, property: 'position', value: [8, 8, 8], interpolation: 'linear', purpose: 'motion', source: 'user', commentIds: [] }] });
    begin(); const editor = useEditor.getState();
    const key = editor.recordDrawnPosition(id(), [1, 0, 1], 5, 1)!;
    expect(key.frame).toBe(6);
    expect(target().keyframes.find(key => key.id === 'authored')?.value).toEqual([8, 8, 8]);
    const last = editor.recordDrawnPosition(id(), [3, 0, 1], 500, 1, key.keyId)!;
    expect(last.frame).toBe(500); expect(useEditor.getState().project.settings.frameEnd).toBeGreaterThanOrEqual(500);
  });
  it('records multiple gestures as one REC undo operation', () => {
    const before = useEditor.getState().project, count = useEditor.getState().past.length;
    begin(); useEditor.getState().recordDrawnPosition(id(), [1, 0, 1], 10, 1);
    useEditor.getState().finishRecordingMovement();
    useEditor.getState().recordDrawnPosition(id(), [2, 1, 1], 20, 10);
    expect(useEditor.getState().past).toHaveLength(count);
    useEditor.getState().stopRecording(); expect(useEditor.getState().past).toHaveLength(count + 1);
    useEditor.getState().undo(); expect(useEditor.getState().project).toEqual(before);
    useEditor.getState().redo(); expect(evaluateTransform(target(), 20).position).toEqual([2, 1, 1]);
  });
  it('cancels only the current recorded gesture and retains previous REC gestures', () => {
    begin(); useEditor.getState().recordDrawnPosition(id(), [1, 0, 1], 10, 1); useEditor.getState().finishRecordingMovement();
    const saved = checkpoint();
    useEditor.getState().recordDrawnPosition(id(), [4, 2, 1], 30, 10);
    useEditor.getState().restoreDrawnMotion(saved);
    expect(useEditor.getState().project).toBe(saved.project);
    expect(useEditor.getState().currentFrame).toBe(10); expect(useEditor.getState().recordingSession).toBe(saved.recordingSession);
    useEditor.getState().stopRecording(); expect(evaluateTransform(target(), 30).position).toEqual([1, 0, 1]);
  });
  it('round trips motion paths in portable projects', async () => {
    const points: Vec3[] = [[0, 0, 1], [2, 1, 1], [0, 2, 1]];
    useEditor.getState().applyDrawnMotion(id(), points, 1);
    const project = ProjectSchema.parse(useEditor.getState().project);
    const restored = await hydratePortableProject(projectForStorage(project, '/tmp/motion.abaco.json'), '/tmp/motion.abaco.json', async () => '');
    expect(restored.objects.find(object => object.id === id())?.keyframes).toEqual(target().keyframes);
  });
  it('rejects invalid input and camera paths without changing history', () => {
    const editor = useEditor.getState(), before = editor.project;
    expect(editor.applyDrawnMotion(before.objects.find(object => object.kind === 'camera')!.id, [[0, 0, 0], [1, 0, 0]], 2)).toBe(false);
    expect(editor.applyDrawnMotion(id(), [[0, 0, 0], [NaN, 0, 0]], 2)).toBe(false);
    expect(editor.project).toBe(before);
  });
});

it('finalizes a constrained recorded path with the same frames, holds, undo and portable geometry', async () => {
  begin(); const editor = useEditor.getState(), history = editor.past.length;
  const a = editor.recordDrawnPosition(id(), [1,0,1], 5, 1)!;
  const b = editor.recordDrawnPosition(id(), [2,0,1], 30, 1, a.keyId)!;
  const frames = motionKeys().map(k=>[k.id,k.frame,k.holdFrames]);
  const corner: Vec3[] = [[0,0,1],[1,0,2],[1,3,5]];
  const { recordedSurfaceSamples } = await import('../domain/drawn-motion');
  const initial = motionKeys()[0];
  expect(editor.remapRecordedDrawnMotion(id(), recordedSurfaceSamples([{id:initial.id,progress:0},{id:a.keyId,progress:.1},{id:b.keyId,progress:1}],corner))).toBe(true);
  expect(motionKeys().map(k=>[k.id,k.frame,k.holdFrames])).toEqual(frames);
  expect(useEditor.getState().past).toHaveLength(history);
  expect(evaluateTransform(target(),20).position).toEqual(motionKeys()[1].value);
  expect(motionKeys()[1].positionPath).toHaveLength(3);
  const saved = ProjectSchema.parse(useEditor.getState().project);
  const restored = await hydratePortableProject(projectForStorage(saved,'/tmp/surface.abaco.json'),'/tmp/surface.abaco.json',async()=> '');
  expect(restored.objects.find(o=>o.id===id())?.keyframes).toEqual(target().keyframes);
  editor.stopRecording(); expect(useEditor.getState().past).toHaveLength(history+1);
  const after = useEditor.getState().project; editor.undo(); expect(motionKeys().length).toBe(0); editor.redo(); expect(useEditor.getState().project).toEqual(after);
});

it('saves a normal minimum curve with only two keys and inserts an editable point without changing its shape', () => {
  const editor = useEditor.getState(), sceneId = editor.project.cameraCuts[0].id;
  const points: Vec3[] = [[0,0,1],[1,0,2],[1,3,5]];
  expect(editor.applyDrawnMotion(id(),points,2,true)).toBe(true);
  expect(motionKeys()).toHaveLength(2);
  const poses = [4.5,11.3,20.8,35].map(frame=>evaluateTransform(target(),frame).position);
  expect(editor.insertMotionPoint(id(),sceneId,18,[1,1,3])).toBeDefined();
  expect(motionKeys()).toHaveLength(3);
  [4.5,11.3,20.8,35].forEach((frame,i)=>evaluateTransform(target(),frame).position.forEach((v,j)=>expect(v).toBeCloseTo(poses[i][j],8)));
  editor.undo(); expect(motionKeys()).toHaveLength(2);
});
