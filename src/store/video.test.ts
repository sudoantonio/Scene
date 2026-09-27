import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateProperty } from '../domain/animation';
import { createProject, ProjectSchema } from '../domain/schema';
import { objectPresenceRange } from '../domain/presence';
import { syncVideo, videoTime } from '../domain/video';
import { hydratePortableProject, projectForStorage } from '../../electron/project-storage';
import { useEditor } from './editor';

beforeEach(() => useEditor.getState().loadProject(createProject(), '/tmp/scene.abaco'));

describe('video in the editor', () => {
  it('adds a video as an editable 3D plane and extends the final scene to fit it', () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.mp4', name: 'Clip', duration: 5, aspectRatio: 16 / 9 }, 'world');
    const project = ProjectSchema.parse(useEditor.getState().project);
    const video = project.objects.find((object) => object.name === 'Clip')!;
    expect(video.kind).toBe('plane');
    expect(video.screenSpace).toBe(false);
    expect(video.asset.previewScale).toBeCloseTo(16 / 9);
    expect(video.asset.duration).toBe(5);
    expect(project.settings.frameEnd).toBe(120);
  });

  it('adds a fixed 2D video layer', () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.webm', name: 'Overlay', duration: 2, aspectRatio: 1 }, 'screen');
    const video = useEditor.getState().project.objects.find((object) => object.name === 'Overlay')!;
    expect(video.screenSpace).toBe(true);
    expect(video.asset.sourcePath).toBe('/tmp/clip.webm');
    const audio = useEditor.getState().project.objects.find((object) => object.kind === 'audio' && object.asset.linkedVideoId === video.id)!;
    expect(audio.asset.sourcePath).toBe(video.asset.sourcePath);
    expect(audio.audio.duration).toBe(2);
  });

  it('places the whole video and its separate audio at the playhead', () => {
    useEditor.getState().setFrame(25);
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.mp4', name: 'Clip', duration: 4, aspectRatio: 1 }, 'screen');
    const project = ProjectSchema.parse(useEditor.getState().project);
    const video = project.objects.find((object) => object.name === 'Clip')!;
    const audio = project.objects.find((object) => object.asset.linkedVideoId === video.id)!;
    expect(objectPresenceRange(video, 1, project.settings.frameEnd + 1)).toEqual([25, 121]);
    expect(objectPresenceRange(audio, 1, project.settings.frameEnd + 1)).toEqual([25, 121]);
    expect(project.settings.frameEnd).toBe(120);
  });

  it('moves a full-length video later and extends its scene without shortening the block', () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.mp4', name: 'Clip', duration: 3, aspectRatio: 1 }, 'screen');
    const video = useEditor.getState().project.objects.find((object) => object.name === 'Clip')!;
    const scene = useEditor.getState().project.cameraCuts[0];
    useEditor.getState().moveObjectPresence(video.id, scene.id, 25);
    const project = ProjectSchema.parse(useEditor.getState().project);
    expect(project.settings.frameEnd).toBe(96);
    expect(objectPresenceRange(project.objects.find((object) => object.id === video.id)!, 1, 97)).toEqual([25, 97]);
    expect(objectPresenceRange(project.objects.find((object) => object.asset.linkedVideoId === video.id)!, 1, 97)).toEqual([1, 73]);
  });

  it('splits only the selected video and continues the source time in the second part', () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.mp4', name: 'Clip', duration: 3, aspectRatio: 1 }, 'screen');
    const original = useEditor.getState().project.objects.find((object) => object.name === 'Clip')!;
    const scene = useEditor.getState().project.cameraCuts[0];
    useEditor.getState().setFrame(25);
    useEditor.getState().splitObjectClip(original.id, scene.id);
    const project = ProjectSchema.parse(useEditor.getState().project);
    const first = project.objects.find((object) => object.id === original.id)!;
    const second = project.objects.find((object) => object.name === 'Clip (2)')!;
    const audio = project.objects.find((object) => object.asset.linkedVideoId === first.id)!;
    expect(project.cameraCuts).toHaveLength(1);
    expect(objectPresenceRange(first, 1, 73)).toEqual([1, 25]);
    expect(objectPresenceRange(second, 1, 73)).toEqual([25, 73]);
    expect(second.asset.sourceOffset).toBe(1);
    expect(videoTime(25, 25, 24, 3, second.asset.sourceOffset)).toBe(1);
    expect(objectPresenceRange(audio, 1, 73)).toEqual([1, 73]);
  });

  it('splits an audio block into independently editable source ranges', () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.mp4', name: 'Clip', duration: 3, aspectRatio: 1 }, 'screen');
    const audio = useEditor.getState().project.objects.find((object) => object.kind === 'audio')!;
    useEditor.getState().setFrame(25);
    useEditor.getState().splitObjectClip(audio.id);
    const project = ProjectSchema.parse(useEditor.getState().project);
    const first = project.objects.find((object) => object.id === audio.id)!;
    const second = project.objects.find((object) => object.name === `${audio.name} (2)`)!;
    expect(first.audio.trimEnd).toBe(1);
    expect(second.audio.trimStart).toBe(1);
    expect(objectPresenceRange(first, 1, 73)).toEqual([1, 25]);
    expect(objectPresenceRange(second, 1, 73)).toEqual([25, 73]);
  });

  it('extends an earlier scene and shifts later scenes when a new video lasts longer', () => {
    useEditor.getState().addShot();
    const before = useEditor.getState().project;
    const nextSceneFrame = before.cameraCuts[1].frame;
    const oldEnd = before.settings.frameEnd;
    useEditor.getState().setFrame(1);
    useEditor.getState().addVideo({ sourcePath: '/tmp/long.mp4', name: 'Long clip', duration: 5, aspectRatio: 1 }, 'screen');
    const project = ProjectSchema.parse(useEditor.getState().project);
    const video = project.objects.find((object) => object.name === 'Long clip')!;
    expect(project.cameraCuts[1].frame).toBe(nextSceneFrame + 48);
    expect(project.settings.frameEnd).toBe(oldEnd + 48);
    expect(objectPresenceRange(video, 1, project.cameraCuts[1].frame)).toEqual([1, 121]);
    expect(evaluateProperty(video, 'visibility', project.cameraCuts[1].frame)).toBe(false);
  });

  it('expands a shortened scene when the video end handle reaches its natural duration', () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/clip.mp4', name: 'Clip', duration: 2, aspectRatio: 1 }, 'screen');
    const scene = useEditor.getState().project.cameraCuts[0];
    const video = useEditor.getState().project.objects.find((object) => object.name === 'Clip')!;
    useEditor.getState().resizeScene(scene.id, 24);
    useEditor.getState().resizeObjectPresence(video.id, scene.id, 1, 200);
    const project = ProjectSchema.parse(useEditor.getState().project);
    const updated = project.objects.find((object) => object.id === video.id)!;
    expect(project.settings.frameEnd).toBe(48);
    expect(objectPresenceRange(updated, 1, 49)).toEqual([1, 49]);
  });

  it('creates a video-only scene without deleting 3D objects from earlier scenes', () => {
    useEditor.getState().addObject('cube');
    const prior = useEditor.getState().project;
    const cubeId = prior.objects.find((object) => object.kind === 'cube')!.id;
    useEditor.getState().addVideoScene({ sourcePath: '/tmp/clip.mov', name: 'Interlude', duration: 2 });
    const project = ProjectSchema.parse(useEditor.getState().project);
    const scene = project.cameraCuts.at(-1)!;
    const cube = project.objects.find((object) => object.id === cubeId)!;
    expect(scene.background).toEqual({ kind: 'video', path: '/tmp/clip.mov', name: 'Interlude' });
    expect(scene.name).toBe('Interlude');
    expect(project.settings.frameEnd).toBe(scene.frame + 47);
    expect(evaluateProperty(cube, 'visibility', 1)).toBe(true);
    expect(evaluateProperty(cube, 'visibility', scene.frame)).toBe(false);
  });

  it('keeps video as a file path after saving and reopening a portable project', async () => {
    useEditor.getState().addVideo({ sourcePath: '/tmp/scene/assets/clip.mp4', name: 'Clip', duration: 1, aspectRatio: 1 }, 'screen');
    const stored = projectForStorage(useEditor.getState().project, '/tmp/scene/project.abaco');
    const video = stored.objects.find((object) => object.name === 'Clip')!;
    expect(video.asset.sourcePath).toBe('assets/clip.mp4');
    const readImage = vi.fn();
    const loaded = await hydratePortableProject(stored, '/tmp/scene/project.abaco', readImage);
    expect(loaded.objects.find((object) => object.id === video.id)?.asset.sourcePath).toBe('/tmp/scene/assets/clip.mp4');
    expect(readImage).not.toHaveBeenCalled();
  });

  it('seeks video time from timeline frames and stops at its end', () => {
    expect(videoTime(49, 25, 24, 2)).toBe(1);
    expect(videoTime(100, 25, 24, 2)).toBeCloseTo(1.999);
  });

  it('does not pause an already playing video on every timeline update', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const video = { currentTime: 1, paused: false, play, pause } as unknown as HTMLVideoElement;
    syncVideo(video, 49, 25, 24, 3, true);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });
});
