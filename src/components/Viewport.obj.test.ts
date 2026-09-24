import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orientObjBackground } from './Viewport';

describe('orientamento scenografia OBJ', () => {
  it('converte Y-up in Z-up, centra il palco e lo appoggia a terra', () => {
    const stage = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20, .25, 13));
    floor.position.set(-1.35, 1.35, .24);
    stage.add(floor);

    orientObjBackground(stage);

    const bounds = new THREE.Box3().setFromObject(stage);
    const center = bounds.getCenter(new THREE.Vector3());
    expect(bounds.min.z).toBeCloseTo(0, 5);
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(.25, 5);
  });
});
