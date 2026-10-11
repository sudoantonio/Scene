import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, createSceneObject, ProjectSchema, type Keyframe, type Vec3 } from './schema';
import { evaluateTransform } from './animation';
import { audioStateAt } from './media-timeline';
import { mediaRange } from './media-edit';
import { useEditor } from '../store/editor';

const key = (frame: number, property: 'position' | 'visibility', value: Vec3 | boolean): Keyframe => ({ id: crypto.randomUUID(), frame, property, value, interpolation: 'constant', source: 'user', commentIds: [] });
const fixture = () => {
  const project = createProject(); project.settings.frameEnd = 216;
  const first = project.cameraCuts[0];
  project.cameraCuts.push({ ...structuredClone(first), id: crypto.randomUUID(), frame: 73, isGap: true, name: 'Empty space' }, { ...structuredClone(first), id: crypto.randomUUID(), frame: 145, name: 'Scene 2' });
  return project;
};
beforeEach(() => useEditor.getState().loadProject(fixture(), '/tmp/ripple.abaco.json'));

describe('closing a scene gap', () => {
  it('shifts scenes, animation, controllers, holds, notes and comments together with one undo', () => {
    const project = fixture(), actor = createSceneObject('cube', 1);
    actor.keyframes = [key(1, 'position', [0, 0, 1]), key(145, 'position', [9, 0, 1]), key(216, 'position', [12, 0, 1])];
    actor.keyframes[0].holdFrames = 150;
    actor.asset.controllerKeys = [{ name: 'Hand', frame: 90, offset: [1, 0, 0] }, { name: 'Hand', frame: 157, offset: [2, 0, 0] }];
    actor.sceneNotes = [{ frame: 165, text: 'Later note' }]; project.objects.push(actor);
    project.comments.push({ id: crypto.randomUUID(), text: 'Later', targetIds: [actor.id], startFrame: 145, endFrame: 216, status: 'pending', scope: 'scene', sceneId: project.cameraCuts[2].id });
    useEditor.getState().loadProject(project, '/tmp/ripple.abaco.json'); useEditor.getState().setFrame(165);
    const before = useEditor.getState().project;
    useEditor.getState().deleteScene(project.cameraCuts[1].id);
    const state = useEditor.getState(), nextActor = state.project.objects.find(o => o.id === actor.id)!;
    expect(state.project.cameraCuts.map(s => s.frame)).toEqual([1, 73]);
    expect(state.project.settings.frameEnd).toBe(144); expect(state.currentFrame).toBe(93);
    expect(evaluateTransform(nextActor, 73).position).toEqual([9, 0, 1]);
    expect(nextActor.keyframes.find(k => k.id === actor.keyframes[0].id)?.holdFrames).toBe(78);
    expect(nextActor.asset.controllerKeys).toEqual([{ name: 'Hand', frame: 85, offset: [2, 0, 0] }]);
    expect(nextActor.sceneNotes).toEqual([{ frame: 93, text: 'Later note' }]);
    expect(state.project.comments[0]).toMatchObject({ startFrame: 73, endFrame: 144 });
    expect(state.past).toHaveLength(1); expect(() => ProjectSchema.parse(state.project)).not.toThrow();
    const closed = state.project; state.undo(); expect(useEditor.getState().project).toEqual(before);
    useEditor.getState().redo(); expect(useEditor.getState().project).toEqual(closed);
    useEditor.getState().loadProject(ProjectSchema.parse(JSON.parse(JSON.stringify(closed))), '/tmp/reopened.abaco.json');
    expect(useEditor.getState().project.cameraCuts.map(s => s.frame)).toEqual([1, 73]);
  });

  it('preserves audio and video source positions on either side of a removed gap', () => {
    const project = fixture(), audio = createSceneObject('audio', 1), video = createSceneObject('plane', 1);
    audio.asset.sourcePath = '/sound.wav'; audio.audio.duration = 20; audio.audio.trimStart = 2; audio.audio.trimEnd = 20;
    video.asset.sourcePath = '/clip.mp4'; video.asset.sourceOffset = 2; video.asset.duration = 20;
    for (const object of [audio, video]) { object.visible = false; object.keyframes = [key(1, 'visibility', true), key(217, 'visibility', false)]; }
    project.objects.push(audio, video); useEditor.getState().loadProject(project, '/tmp/media.abaco.json');
    const beforeAudio = audioStateAt(project, audio, 157)?.sourceTime;
    useEditor.getState().deleteScene(project.cameraCuts[1].id);
    const closed = useEditor.getState().project;
    const sounds = closed.objects.filter(o => o.kind === 'audio'), videos = closed.objects.filter(o => o.asset.sourcePath === '/clip.mp4');
    expect(sounds).toHaveLength(2); expect(videos).toHaveLength(2);
    expect(sounds.map(o => mediaRange(closed, o))).toEqual([[1, 73], [73, 145]]);
    expect(audioStateAt(closed, sounds[1], 85)?.sourceTime).toBe(beforeAudio);
    expect(videos[1].asset.sourceOffset! + (85 - 73) / 24).toBe(2 + (157 - 1) / 24);
    expect(videos.every(o => o.asset.timelineTrackId === video.id)).toBe(true);
    expect(() => ProjectSchema.parse(closed)).not.toThrow();
  });

  it('closes leading and trailing gaps and leaves the remaining scene intact', () => {
    for (const index of [0, 2]) {
      const project = fixture(); delete project.cameraCuts[1].isGap; project.cameraCuts[index].isGap = true;
      useEditor.getState().loadProject(project, '/tmp/end-gap.abaco.json');
      useEditor.getState().deleteScene(project.cameraCuts[index].id);
      expect(useEditor.getState().project.cameraCuts.map(s => s.frame)).toEqual([1, 73]);
      expect(useEditor.getState().project.settings.frameEnd).toBe(144);
      expect(() => ProjectSchema.parse(useEditor.getState().project)).not.toThrow();
    }
  });
});
