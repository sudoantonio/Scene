import * as THREE from 'three';
import { evaluateTransform } from './animation';
import { controllerOffset, controllerWorldDelta } from './controller-pose';
import type { SceneObject, Vec3 } from './schema';

export type ControllerMotionPath = { controllerName: string; points: Vec3[]; keyPoints: Vec3[] };

export function controllerMotionPaths(object: SceneObject, sceneStart: number, sceneEnd: number, projectStart: number): ControllerMotionPath[] {
  if (object.kind !== 'blend_asset' || !object.asset.controllerKeys?.length) return [];
  const { controllers = [], controllerKeys, boundsCenter, previewScale } = object.asset;
  return controllers.flatMap((controller) => {
    if (!controller.worldPosition) return [];
    const keys = controllerKeys.filter((key) => key.name === controller.name && key.frame >= sceneStart && key.frame < sceneEnd)
      .sort((a, b) => a.frame - b.frame);
    if (keys.length < 2 || !keys.some((key) => key.offset.some((value, axis) => Math.abs(value - keys[0]!.offset[axis]!) > 1e-5))) return [];
    const positionAt = (frame: number): Vec3 => {
      const offset = controllerWorldDelta(controller, controllerOffset(object.asset, controller.name, frame, projectStart));
      const local = new THREE.Vector3(...controller.worldPosition!).sub(new THREE.Vector3(...boundsCenter))
        .add(new THREE.Vector3(...offset)).multiplyScalar(previewScale);
      const transform = evaluateTransform(object, frame);
      local.multiply(new THREE.Vector3(...transform.scale));
      local.applyEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad) as Vec3));
      return local.add(new THREE.Vector3(...transform.position)).toArray() as Vec3;
    };
    const first = keys[0]!.frame, last = keys[keys.length - 1]!.frame;
    const step = Math.max(1, Math.ceil((last - first) / 120));
    const frames: number[] = [];
    for (let frame = first; frame <= last; frame += step) frames.push(frame);
    if (frames.at(-1) !== last) frames.push(last);
    const points = frames.map(positionAt).filter((point, index, all) => index === 0 || point.some((value, axis) => Math.abs(value - all[index - 1]![axis]!) > 1e-5));
    return points.length < 2 ? [] : [{ controllerName: controller.name, points, keyPoints: keys.map((key) => positionAt(key.frame)) }];
  });
}
