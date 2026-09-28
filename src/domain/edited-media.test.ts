import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, createSceneObject } from './schema';
import { prepareEditedMedia } from './edited-media';

afterEach(() => vi.unstubAllGlobals());

describe('AI export media preparation', () => {
  it('keeps video audio timing without loading the whole movie into the renderer', async () => {
    const project = createProject();
    project.settings.frameEnd = 24;
    const audio = createSceneObject('audio', 1);
    audio.asset.sourcePath = '/project/movie.mp4';
    audio.audio.duration = 1;
    audio.audio.trimEnd = 1;
    project.objects.push(audio);
    vi.stubGlobal('OfflineAudioContext', class {});
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    const load = vi.fn(async () => { throw new Error('Video must not be loaded as an audio data URL'); });
    const media = await prepareEditedMedia(project, load);
    expect(load).not.toHaveBeenCalled();
    expect(media.videoAudioClips).toMatchObject([{ objectId: audio.id, clip: { startFrame: 1, endFrameExclusive: 25, sourceStart: 0, sourceEnd: 1 } }]);
    expect(media.audioMix?.length).toBe(44 + 48000 * 4);
  });
});
