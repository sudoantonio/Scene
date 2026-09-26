import { describe, expect, it } from 'vitest';
import { createSceneObject, SceneObjectSchema } from './schema';
import { moveSubtitlePosition } from './subtitle-position';

const makeAudio = () => {
  const audio = createSceneObject('audio', 1).audio;
  audio.captions = [
    { id: crypto.randomUUID(), start: 0, end: 1, text: 'First' },
    { id: crypto.randomUUID(), start: 1, end: 2, text: 'Second', position: [.6, .8] },
  ];
  return audio;
};

describe('Subtitle spatial position', () => {
  it('moves the shared position and all individual overrides together by default', () => {
    const audio = makeAudio();
    const moved = moveSubtitlePosition(audio, audio.captions[0].id, [.4, .85]);
    expect(moved.captionStyle.position).toEqual([.4, .85]);
    expect(moved.captions[0].position).toBeUndefined();
    expect(moved.captions[1].position).toEqual([.5, .7]);
    expect(audio.captionStyle.position).toEqual([.5, .95]);
  });

  it('moves only the selected subtitle when Apply to all is unchecked', () => {
    const audio = { ...makeAudio(), applyCaptionPositionToAll: false };
    const moved = moveSubtitlePosition(audio, audio.captions[0].id, [.2, .3]);
    expect(moved.captionStyle.position).toEqual([.5, .95]);
    expect(moved.captions[0].position).toEqual([.2, .3]);
    expect(moved.captions[1].position).toEqual([.6, .8]);
  });

  it('loads projects saved before spatial subtitle controls with shared defaults', () => {
    const old = createSceneObject('audio', 1);
    delete (old.audio.captionStyle as { position?: [number, number] }).position;
    delete (old.audio as { applyCaptionPositionToAll?: boolean }).applyCaptionPositionToAll;
    const restored = SceneObjectSchema.parse(old);
    expect(restored.audio.captionStyle.position).toEqual([.5, .95]);
    expect(restored.audio.applyCaptionPositionToAll).toBe(true);
  });
});
