import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ObjectKind } from '../domain/schema';

export type PrimitiveKind = Extract<ObjectKind, 'cube' | 'sphere' | 'cone' | 'cylinder' | 'plane'>;
const geometries = new Map<PrimitiveKind, THREE.BufferGeometry>();
const materials = new Map<string, { value: THREE.MeshStandardMaterial; users: number }>();
export function primitiveGeometry(kind: PrimitiveKind) {
  let geometry = geometries.get(kind);
  if (!geometry) {
    geometry = kind === 'cube' ? new THREE.BoxGeometry(2, 2, 2) : kind === 'sphere' ? new THREE.SphereGeometry(1, 32, 18) : kind === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 2, 32) : kind === 'cone' ? new THREE.ConeGeometry(1, 2, 32) : new THREE.PlaneGeometry(2, 2);
    geometries.set(kind, geometry);
  }
  return geometry;
}
export function usePrimitiveMaterial(color: string) {
  const entry = useMemo(() => {
    let value = materials.get(color);
    if (!value) { value = { value: new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .02 }), users: 0 }; materials.set(color, value); }
    return value;
  }, [color]);
  useEffect(() => {
    entry.users++;
    return () => {
      entry.users--;
      queueMicrotask(() => {
        if (!entry.users && materials.get(color) === entry) { entry.value.dispose(); materials.delete(color); }
      });
    };
  }, [color, entry]);
  return entry.value;
}
export default function PrimitiveMesh({ kind, color }: { kind: PrimitiveKind; color: string }) {
  const material = usePrimitiveMaterial(color);
  return <mesh geometry={primitiveGeometry(kind)} material={material} castShadow={kind !== 'plane'} receiveShadow={kind === 'plane'} dispose={null} />;
}
