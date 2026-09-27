import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateProperty } from '../domain/animation';
import { createProject, ProjectSchema } from '../domain/schema';
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
