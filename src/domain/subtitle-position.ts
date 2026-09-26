import type { SceneObject } from './schema';

export type SubtitlePosition = [number, number];
export const DEFAULT_SUBTITLE_POSITION: SubtitlePosition = [.5, .95];
const LIMITS = { minX: .05, maxX: .95, minY: .08, maxY: .98 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const clampSubtitlePosition = ([x, y]: SubtitlePosition): SubtitlePosition => [clamp(x, LIMITS.minX, LIMITS.maxX), clamp(y, LIMITS.minY, LIMITS.maxY)];

export function moveSubtitlePosition(audio: SceneObject['audio'], captionId: string, requested: SubtitlePosition): SceneObject['audio'] {
  const caption = audio.captions.find((item) => item.id === captionId);
  if (!caption) return audio;
  const target = clampSubtitlePosition(requested);
  if (!audio.applyCaptionPositionToAll) return {
    ...audio,
    captions: audio.captions.map((item) => item.id === captionId ? { ...item, position: target } : item),
  };

  const base = audio.captionStyle.position ?? DEFAULT_SUBTITLE_POSITION;
  const current = caption.position ?? base;
  const positions = [base, ...audio.captions.flatMap((item) => item.position ? [item.position] : [])];
  const deltaX = clamp(target[0] - current[0], LIMITS.minX - Math.min(...positions.map((position) => position[0])), LIMITS.maxX - Math.max(...positions.map((position) => position[0])));
  const deltaY = clamp(target[1] - current[1], LIMITS.minY - Math.min(...positions.map((position) => position[1])), LIMITS.maxY - Math.max(...positions.map((position) => position[1])));
  const translate = ([x, y]: SubtitlePosition): SubtitlePosition => [Number((x + deltaX).toFixed(5)), Number((y + deltaY).toFixed(5))];
  return {
    ...audio,
    captionStyle: { ...audio.captionStyle, position: translate(base) },
    captions: audio.captions.map((item) => item.position ? { ...item, position: translate(item.position) } : item),
  };
}
