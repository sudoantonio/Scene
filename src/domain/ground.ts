import type { SceneObject, Transform } from './schema';

export function groundOffsetForObject(object: SceneObject) {
  if (object.screenSpace || object.kind === 'plane' || object.kind === 'text') return 0;
  if (object.kind === 'blend_asset') return object.asset.groundOffset;
  return ['cube', 'sphere', 'cylinder', 'cone'].includes(object.kind) ? 1 : 0;
}

export function groundedPositionZ(object: SceneObject, transform: Transform) {
  return groundOffsetForObject(object) * Math.abs(transform.scale[2]);
}
