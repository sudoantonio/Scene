import * as THREE from 'three';
import type { SceneObject, Transform, Vec3 } from './schema';

const quaternion = (rotation: Vec3) => new THREE.Quaternion().setFromEuler(new THREE.Euler(
  THREE.MathUtils.degToRad(rotation[0]), THREE.MathUtils.degToRad(rotation[1]), THREE.MathUtils.degToRad(rotation[2]), 'XYZ',
));
const matrix = (pose: Transform) => new THREE.Matrix4().compose(new THREE.Vector3(...pose.position), quaternion(pose.rotation), new THREE.Vector3(...pose.scale));
const vector = (value: THREE.Vector3): Vec3 => value.toArray().map((component) => Number(component.toFixed(5))) as Vec3;

/** Move a set of independent elements as a unit, preserving their existing animation keys. */
export function moveGroupMembers(objects: SceneObject[], previous: Transform, next: Transform) {
  const delta = matrix(next).multiply(matrix(previous).invert());
  const deltaOrientation = new THREE.Quaternion();
  const deltaSize = new THREE.Vector3();
  delta.decompose(new THREE.Vector3(), deltaOrientation, deltaSize);
  const movePosition = (value: Vec3) => vector(new THREE.Vector3(...value).applyMatrix4(delta));
  const moveRotation = (value: Vec3): Vec3 => {
    const angle = new THREE.Euler().setFromQuaternion(deltaOrientation.clone().multiply(quaternion(value)), 'XYZ');
    return [angle.x, angle.y, angle.z].map((radians) => Number(THREE.MathUtils.radToDeg(radians).toFixed(4))) as Vec3;
  };
  const moveScale = (value: Vec3): Vec3 => vector(new THREE.Vector3(...value).multiply(deltaSize)).map((component) => Math.max(.001, component)) as Vec3;
  for (const object of objects) {
    object.transform = {
      position: movePosition(object.transform.position),
      rotation: moveRotation(object.transform.rotation),
      scale: moveScale(object.transform.scale),
    };
    for (const key of object.keyframes) {
      if (key.property === 'position') key.value = movePosition(key.value as Vec3);
      else if (key.property === 'rotation') key.value = moveRotation(key.value as Vec3);
      else if (key.property === 'scale') key.value = moveScale(key.value as Vec3);
    }
  }
}
