import type { SceneObject, Vec3 } from './schema';
import * as THREE from 'three';

export function controllerOffset(asset: SceneObject['asset'], name: string, frame: number, startFrame = 1): Vec3 {
  const keys = (asset.controllerKeys ?? []).filter((key) => key.name === name).sort((a, b) => a.frame - b.frame);
  if (!keys.length) return [0, 0, 0];
  const before = [...keys].reverse().find((key) => key.frame <= frame) ?? { frame: startFrame, offset: [0, 0, 0] as Vec3 };
  const after = keys.find((key) => key.frame >= frame) ?? keys[keys.length - 1];
  if (frame <= startFrame && keys[0].frame > startFrame) return [0, 0, 0];
  if (before.frame === after.frame) return [...before.offset];
  const progress = (frame - before.frame) / (after.frame - before.frame);
  const mode = 'interpolation' in before ? before.interpolation : 'linear';
  const t = mode === 'constant' ? 0 : mode === 'bezier' ? progress * progress * (3 - 2 * progress) : progress;
  return before.offset.map((value, axis) => value + (after.offset[axis] - value) * t) as Vec3;
}

export function controllerPose(asset: SceneObject['asset'], frame: number, startFrame = 1): Record<string, Vec3> {
  return Object.fromEntries((asset.controllers ?? []).map(({ name }) => [name, controllerOffset(asset, name, frame, startFrame)]));
}

type Controller = NonNullable<SceneObject['asset']['controllers']>[number];

function basisMatrix(controller: Controller): THREE.Matrix3 {
  const [x, y, z] = controller.worldBasis ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return new THREE.Matrix3().set(x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]);
}

export function controllerWorldDelta(controller: Controller, offset: Vec3): Vec3 {
  return new THREE.Vector3(...offset).applyMatrix3(basisMatrix(controller)).toArray() as Vec3;
}

export function controllerOffsetFromWorldDelta(controller: Controller, delta: Vec3): Vec3 {
  const basis = basisMatrix(controller);
  return new THREE.Vector3(...delta).applyMatrix3(Math.abs(basis.determinant()) > 1e-6 ? basis.invert() : new THREE.Matrix3()).toArray() as Vec3;
}

export function applyControllerMorphs(model: THREE.Object3D, controllers: NonNullable<SceneObject['asset']['controllers']>, pose: Record<string, Vec3>): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.morphTargetInfluences || !child.morphTargetDictionary) return;
    child.morphTargetInfluences.fill(0);
    for (const controller of controllers) {
      if (!controller.morphTargets || !controller.morphStep) continue;
      const offset = pose[controller.name] ?? [0, 0, 0];
      controller.morphTargets.forEach((target, axis) => {
        const index = child.morphTargetDictionary?.[target];
        if (index !== undefined) child.morphTargetInfluences![index] = offset[axis] / controller.morphStep!;
      });
    }
  });
}
