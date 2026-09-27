import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Transform } from '../domain/schema';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from './editor';
const pose = (x: number): Transform => ({ position: [x, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
const points = (id: string) => useEditor.getState().project.objects.find(o => o.id === id)!.keyframes.filter(k => k.property === 'position' && k.purpose === 'motion').sort((a,b) => a.frame-b.frame);
beforeEach(() => {
  vi.useFakeTimers();
  useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedIds: [], selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, past: [], future: [], dirty: false, isPlaying: false });
});
afterEach(() => { useEditor.getState().stopRecording(); vi.useRealTimers(); });
describe('record movement endpoints', () => {
  it('returns from point editing to element controls when the element is selected again', () => {
    useEditor.getState().addObject('cube');
    const id = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().selectMotion({ objectId: id, sceneId });
    useEditor.getState().select(id);
    expect(useEditor.getState().selectedId).toBe(id);
    expect(useEditor.getState().selectedMotion).toBeUndefined();
  });
  it('uses the last recorded pose as the final pose of a newly created element', () => {
    useEditor.getState().addObject('cube');
    const id = useEditor.getState().selectedId!;
    const scene = useEditor.getState().project.cameraCuts[0];
    const initialPosition = evaluateTransform(useEditor.getState().project.objects.find(o => o.id === id)!, scene.frame).position;
    expect(points(id)).toHaveLength(0);

    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setTransform(id, pose(5));
    useEditor.getState().finishRecordingMovement();
    useEditor.getState().setTransform(id, pose(9));
    useEditor.getState().stopRecording();

    const object = useEditor.getState().project.objects.find(o => o.id === id)!;
    expect(evaluateTransform(object, scene.frame).position).toEqual(initialPosition);
    expect(points(id).map(key => key.frame)).toEqual([1, 13, 25]);
    expect(evaluateTransform(object, useEditor.getState().project.settings.frameEnd).position).toEqual([9, 0, 1]);
  });
  it('adds points when an existing path handle is dragged during REC', () => {
    useEditor.getState().addObject('cube');
    const id = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startRecording(sceneId);
    for (const x of [1, 2]) {
      useEditor.getState().setTransform(id, pose(x));
      useEditor.getState().finishRecordingMovement();
    }
    useEditor.getState().stopRecording();
    const original = structuredClone(points(id));
    expect(original.map(key => key.frame)).toEqual([1, 13, 25]);

    useEditor.getState().setFrame(25);
    useEditor.getState().startRecording(sceneId);
    useEditor.getState().updateMotionPoint(id, original[2].id, [3, 0, 1]);
    useEditor.getState().updateMotionPoint(id, original[2].id, [4, 0, 1]);

    const recorded = points(id);
    expect(recorded.map(key => key.frame)).toEqual([1, 13, 25, 37, 49]);
    for (const old of original) expect(recorded.find(key => key.id === old.id)).toEqual(old);
    expect(recorded.at(-1)?.value).toEqual([4, 0, 1]);
  });
  it.each([24,30,60])('fixes one endpoint per pause at half-second intervals at %i fps', fps => {
    useEditor.getState().updateSettings({ fps });
    useEditor.getState().addObject('cube');
    const id = useEditor.getState().selectedId!;
    useEditor.getState().startRecording(useEditor.getState().project.cameraCuts[0].id);
    for(let i=1;i<=20;i++) { useEditor.getState().setTransform(id, pose(i)); vi.advanceTimersByTime(100); }
    expect(points(id).map(k=>k.frame)).toEqual([1,1+fps/2]);
    vi.advanceTimersByTime(350);
    useEditor.getState().setTransform(id, pose(25));
    vi.advanceTimersByTime(350);
    expect(points(id).map(k=>k.frame)).toEqual([1,1+fps/2,1+fps]);
    expect(points(id).at(-1)?.value).toEqual([25,0,1]);
    vi.advanceTimersByTime(2000);
    expect(points(id)).toHaveLength(3);
  });
  it('does not modify the project when REC is armed and stopped without moving', () => {
    useEditor.getState().addObject('cube');
    const before=structuredClone(useEditor.getState().project);
    useEditor.getState().startRecording(before.cameraCuts[0].id);
    useEditor.getState().stopRecording();
    expect(useEditor.getState().project).toEqual(before);
  });
  it('records camera pauses and ignores a duplicate final flush', () => {
    const scene=useEditor.getState().project.cameraCuts[0];
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setCameraFraming(scene.id,[4,-6,4],[60,0,0],[0,0,1]);
    vi.advanceTimersByTime(350);
    useEditor.getState().setCameraFraming(scene.id,[4,-6,4],[60,0,0],[0,0,1]);
    expect(points(scene.cameraId).map(k=>k.frame)).toEqual([1,13]);
    useEditor.getState().setCameraFraming(scene.id,[6,-6,4],[60,0,0],[0,0,1]);
    useEditor.getState().stopRecording();
    expect(points(scene.cameraId).map(k=>k.frame)).toEqual([1,13,25]);
    useEditor.getState().undo();
    expect(points(scene.cameraId)).toHaveLength(0);
  });
  it('does not create camera motion through framing or transforms outside REC', () => {
    const scene=useEditor.getState().project.cameraCuts[0];
    useEditor.getState().setFrame(25);
    useEditor.getState().setCameraFraming(scene.id,[4,-6,4],[60,0,0],[0,0,1]);
    useEditor.getState().setTransform(scene.cameraId,pose(5));
    expect(points(scene.cameraId)).toHaveLength(0);
  });
  it.each([false, true])('extends the scene and shifts following scenes (following=%s)', following => {
    if (following) useEditor.getState().addShot();
    const before=structuredClone(useEditor.getState().project);
    const scene=before.cameraCuts[0];
    const boundary=before.cameraCuts[1]?.frame ?? before.settings.frameEnd+1;
    useEditor.getState().setFrame(boundary-5);
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setTransform(scene.cameraId,pose(9));
    useEditor.getState().finishRecordingMovement();
    useEditor.getState().setTransform(scene.cameraId,pose(12));
    useEditor.getState().stopRecording();
    const after=useEditor.getState().project;
    expect(points(scene.cameraId).map(k=>k.frame)).toEqual([boundary-5,boundary+7,boundary+19]);
    expect(after.settings.frameEnd).toBe(before.settings.frameEnd+20);
    if (following) {
      expect(after.cameraCuts[1].frame).toBe(boundary+20);
      const original=before.objects.find(o=>o.id===before.cameraCuts[1].cameraId)!;
      const updated=after.objects.find(o=>o.id===original.id)!;
      for(const key of original.keyframes) expect(updated.keyframes.find(k=>k.id===key.id)).toEqual({...key,frame:key.frame>=boundary?key.frame+20:key.frame});
    }
    useEditor.getState().undo();
    expect(useEditor.getState().project).toEqual(before);
  });
});
