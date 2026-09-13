import * as THREE from 'three';
import type { Transform, Vec3 } from './schema';

export function cameraBasis(rotation: Vec3) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as Vec3));
  return [new THREE.Vector3(1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 0, -1).applyQuaternion(q), new THREE.Vector3(0, 1, 0).applyQuaternion(q)];
}

// Coordinates in metres: screen-right, away from the camera, screen-up.
export function toCameraSpace(position: Vec3, camera: Transform): Vec3 {
  const offset = new THREE.Vector3(...position).sub(new THREE.Vector3(...camera.position));
  return cameraBasis(camera.rotation).map((axis) => offset.dot(axis)) as Vec3;
}

export function fromCameraSpace(position: Vec3, camera: Transform): Vec3 {
  const result = new THREE.Vector3(...camera.position);
  cameraBasis(camera.rotation).forEach((axis, index) => result.addScaledVector(axis, position[index]));
  return result.toArray() as Vec3;
}

export function cameraTarget(camera: Transform, distance: number): Vec3 {
  return new THREE.Vector3(...camera.position).addScaledVector(cameraBasis(camera.rotation)[1], distance).toArray() as Vec3;
}
