import type { SceneObject, Vec3 } from './schema';

export function controllerOffset(asset: SceneObject['asset'], name: string, frame: number, startFrame = 1): Vec3 {
  const keys = (asset.controllerKeys ?? []).filter((key) => key.name === name).sort((a, b) => a.frame - b.frame);
  if (!keys.length) return [0, 0, 0];
  const before = [...keys].reverse().find((key) => key.frame <= frame) ?? { frame: startFrame, offset: [0, 0, 0] as Vec3 };
  const after = keys.find((key) => key.frame >= frame) ?? keys[keys.length - 1];
  if (frame <= startFrame && keys[0].frame > startFrame) return [0, 0, 0];
  if (before.frame === after.frame) return [...before.offset];
  const t = (frame - before.frame) / (after.frame - before.frame);
  return before.offset.map((value, axis) => value + (after.offset[axis] - value) * t) as Vec3;
}

export function controllerPose(asset: SceneObject['asset'], frame: number, startFrame = 1): Record<string, Vec3> {
  return Object.fromEntries((asset.controllers ?? []).map(({ name }) => [name, controllerOffset(asset, name, frame, startFrame)]));
}
