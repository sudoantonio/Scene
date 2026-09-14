import type { SceneObject } from './schema';

// Visibility only changes at keys. Do not scan every frame while the timeline
// rerenders during playback or recording of long scenes.
export function objectPresenceRange(object: SceneObject, sceneStart: number, sceneEnd: number): [number, number] | undefined {
  if (sceneStart >= sceneEnd) return undefined;
  const keys = object.keyframes.filter((key) => key.property === 'visibility').sort((a, b) => a.frame - b.frame);
  let visible = object.visible;
  for (const key of keys) {
    if (key.frame > sceneStart) break;
    visible = Boolean(key.value);
  }
  let first = visible ? sceneStart : undefined;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key.frame <= sceneStart) continue;
    if (key.frame >= sceneEnd) break;
    // Evaluation at a duplicate frame uses the last stored key.
    if (keys[index + 1]?.frame === key.frame) continue;
    visible = Boolean(key.value);
    if (visible && first === undefined) first = key.frame;
    if (!visible && first !== undefined) return [first, key.frame];
  }
  return first === undefined ? undefined : [first, sceneEnd];
}
