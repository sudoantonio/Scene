import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { automaticStrokeRadius, DEFAULT_STROKE_PARAMETERS, positionStrokePoint, StrokePointIndex, strokeNeighbors, StrokeSurface, strokeTubeGeometry } from './stroke-spatial';
import type { Vec3 } from './schema';

const origin = new THREE.Vector3();
function box(id: string, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  mesh.position.set(x, y, z); return new StrokeSurface(id, mesh);
}
describe('3D stroke neighborhood and placement', () => {
  it.each([0, 1, 50, 51, 500])('bounds %i nearby points to 50', count => {
    const index = new StrokePointIndex(Array.from({ length: count }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}`, position: [i * .001, 0, 0] as Vec3 })));
    const neighbors = strokeNeighbors(origin, 1, index, []);
    expect(neighbors).toHaveLength(Math.min(count, 50));
    expect(neighbors.every(n => n.distance <= 1)).toBe(true);
    if (count) expect(neighbors[0].id).toBe('p0000');
  });
  it('uses one shared limit for points and object surfaces', () => {
    const index = new StrokePointIndex(Array.from({ length: 70 }, (_, i) => ({ id: `p${i}`, position: [0, i * .01, 0] as Vec3 })));
    const result = strokeNeighbors(origin, 2, index, [box('a', 1), box('b', -1)]);
    expect(result).toHaveLength(50);
    expect(result.filter(n => n.kind === 'surface')).toHaveLength(2);
    expect(result.every(n => n.distance <= 2)).toBe(true);
  });
  it('uses an actual closest surface even when the object center is outside the sphere', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 2)); mesh.position.x = 10;
    const surface = new StrokeSurface('long-box', mesh);
    const neighbor = surface.closest(new THREE.Vector3(-.1, 0, 0), .2)!;
    expect(neighbor.distance).toBeCloseTo(.1);
    expect(neighbor.position[0]).toBeCloseTo(0);
    expect(surface.intersect(new THREE.Ray(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0)))!.distance).toBeCloseTo(5);
  });
  it('evaluates imported mesh transforms and morph geometry, excluding hidden children', () => {
    const root = new THREE.Group(); root.position.z = 3;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const morph = mesh.geometry.getAttribute('position').clone();
    for (let i = 0; i < morph.count; i++) morph.setZ(i, 2);
    mesh.geometry.morphAttributes.position = [morph]; mesh.updateMorphTargets(); mesh.morphTargetInfluences![0] = .5;
    mesh.scale.set(2, 1, 1); root.add(mesh);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)); hidden.visible = false; root.add(hidden);
    const surface = new StrokeSurface('import', root);
    expect(surface.closest(new THREE.Vector3(0, 0, 4.1), 1)!.position[2]).toBeCloseTo(4);
    expect(surface.box.min.x).toBeCloseTo(-2);
    const hit = surface.intersect(new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1)))!;
    expect(hit.position[2]).toBeCloseTo(4);
  });
  it('resolves equal-distance neighbors by a stable id', () => {
    const index = new StrokePointIndex([{ id: 'b', position: [1, 0, 0] }, { id: 'a', position: [-1, 0, 0] }]);
    expect(index.query(origin, 1).map(n => n.id)).toEqual(['a', 'b']);
  });
  it('includes individual instance transforms from imported instanced geometry', () => {
    const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 2);
    instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 0));
    instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 5, 0));
    const surface = new StrokeSurface('instances', instances);
    expect(surface.closest(new THREE.Vector3(0, 3.9, 0), .2)!.position[1]).toBeCloseTo(4);
    expect(surface.intersect(new THREE.Ray(new THREE.Vector3(0, 5, 10), new THREE.Vector3(0, 0, -1)))!.position[2]).toBeCloseTo(1);
  });
  it('queries appended point chunks and respects a spherical boundary', () => {
    const index = new StrokePointIndex();
    for (let i = 0; i < 300; i++) index.add(`p${i}`, [i / 100, 0, 0]);
    index.add('outside', [.9, .9, .9]);
    const result = index.query(origin, 1);
    expect(result).toHaveLength(50); expect(result.some(n => n.id === 'outside')).toBe(false);
  });
  it('adapts the radius with limits and smoothing, holding it in empty space', () => {
    expect(automaticStrokeRadius(0)).toBe(.2);
    expect(automaticStrokeRadius(10)).toBe(2);
    expect(automaticStrokeRadius(10, 2, [])).toBe(2);
    const neighbors = new StrokePointIndex(Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, position: [.01, 0, 0] as Vec3 }))).query(origin, 2);
    expect(automaticStrokeRadius(10, 2, neighbors)).toBeCloseTo(1.7);
    neighbors.forEach(n => n.distance = 100);
    expect(automaticStrokeRadius(10, 2, neighbors)).toBeCloseTo(2.6);
  });
  it('keeps a new point on the cursor ray and limits depth changes', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    const result = positionStrokePoint(ray, [0, 0, 0], [], 1, DEFAULT_STROKE_PARAMETERS, [0, 0, 5], { position: [0, 0, 0], normal: [0, 0, 1] });
    expect(result.position).toEqual([0, 0, 4.75]);
    expect(result.normal).toEqual([0, 0, 1]);
  });
  it('uses weighted neighbor depth and preserves the fallback when there are no neighbors', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    const neighbors = [{ id: 'near', kind: 'point' as const, position: [0, 0, 2] as Vec3, distance: .1 }];
    expect(positionStrokePoint(ray, [0, 0, 0], neighbors, 1, { adherence: 1, continuity: 0 }).position[2]).toBeCloseTo(2);
    expect(positionStrokePoint(ray, [0, 0, 0], [], 1, DEFAULT_STROKE_PARAMETERS).position[2]).toBe(0);
  });
  it('creates tube geometry with the authored centerline and thickness', () => {
    const geometry = strokeTubeGeometry([[0, 0, 0], [0, 0, 1], [0, 0, 2]], .1);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x).toBeCloseTo(.05);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(2);
    geometry.dispose();
  });
  it('preserves every centerline vertex with uneven segment lengths', () => {
    const points: Vec3[] = [[0, 0, 0], [0, 0, .01], [0, 0, 10], [1, 0, 10]];
    const geometry = strokeTubeGeometry(points, .02), vertices = geometry.getAttribute('position');
    points.forEach((point, ring) => {
      const center = new THREE.Vector3();
      for (let j = 0; j < 8; j++) center.add(new THREE.Vector3().fromBufferAttribute(vertices, ring * 9 + j));
      center.divideScalar(8); expect(center.distanceTo(new THREE.Vector3(...point))).toBeLessThan(1e-5);
    });
    geometry.dispose();
  });
  it('keeps spatial updates below 16 ms with 10,000 points and 100 objects', () => {
    const points = new StrokePointIndex(Array.from({ length: 10000 }, (_, i) => ({ id: `${i}`, position: [(i % 100) * .1, Math.floor(i / 100) * .1, .05] as Vec3 })));
    const surfaces = Array.from({ length: 100 }, (_, i) => box(`object${i}`, i % 10, Math.floor(i / 10), -1));
    const timings: number[] = [];
    const ray = new THREE.Ray(new THREE.Vector3(5, 5, 10), new THREE.Vector3(0, 0, -1));
    for (let i = 0; i < 150; i++) {
      const center = new THREE.Vector3(4 + (i % 10) * .1, 4, .1);
      const start = performance.now();
      for (const surface of surfaces) surface.intersect(ray);
      const neighbors = strokeNeighbors(center, 2, points, surfaces);
      const radius = automaticStrokeRadius(10, 2, neighbors);
      const adapted = strokeNeighbors(center, radius, points, surfaces);
      positionStrokePoint(ray, center.toArray() as Vec3, adapted, radius, DEFAULT_STROKE_PARAMETERS);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * .95)];
    console.info(`STROKE_BENCHMARK p50=${timings[75].toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${timings.at(-1)!.toFixed(3)}ms`);
    expect(p95).toBeLessThan(16);
  });
});
