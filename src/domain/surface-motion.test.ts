import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, ProjectSchema, createProject, type Vec3 } from './schema';
import { compactSurfacePath, pathLengths, shortestSurfaceMotion, pointOnPath } from './surface-motion';
import { evaluateTransform } from './animation';
import { motionPathFrames, recordedSurfaceSamples, motionHandleKeys } from './drawn-motion';

const length = (p: Vec3[]) => pathLengths(p).at(-1)!;
const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 8));

describe('minimum curve on the cursor ruled surface', () => {
  it('turns a straight screen gesture into one true 3D segment with different endpoint depths', () => {
    const base: Vec3[] = Array.from({ length: 100 }, (_, i) => [i / 10, 2, 3]);
    const path = shortestSurfaceMotion(base, [0, 0, -1], 7);
    expect(path).toHaveLength(2); close(path[0], [0, 2, 3]); close(path[1], [9.9, 2, -4]);
    expect(length(path)).toBeCloseTo(Math.hypot(9.9, 7));
    const normal = new THREE.Vector3(0, 0, -1);
    for (const pose of [[6, -8, 5], [-7, 3, 9], [2, 8, -3]] as Vec3[]) {
      const camera = new THREE.PerspectiveCamera(60, 1, .01, 100); camera.position.set(...pose); camera.lookAt(new THREE.Vector3(...pointOnPath(path, .5))); camera.updateMatrixWorld();
      const a = new THREE.Vector3(...path[0]).project(camera), b = new THREE.Vector3(...path[1]).project(camera), m = new THREE.Vector3(...pointOnPath(path, .4)).project(camera);
      expect(Math.abs((b.x-a.x)*(m.y-a.y)-(b.y-a.y)*(m.x-a.x))).toBeLessThan(1e-8);
    }
    expect(normal.length()).toBe(1);
  });
  it('preserves a deliberate corner and attains the intrinsic lower length bound', () => {
    const base: Vec3[] = [[0,0,0],[3,0,0],[3,4,0]];
    const path = shortestSurfaceMotion(base, [0,0,1], 7);
    expect(path).toHaveLength(3); close(path[1], [3,0,3]); close(path[2], [3,4,7]);
    expect(length(path)).toBeCloseTo(Math.hypot(7,7));
    // Equal depth increments per event would be longer on unequally sized segments.
    expect(length(path)).toBeLessThan(length([[0,0,0],[3,0,3.5],[3,4,7]]));
  });
  it('removes a closed detour at a crossing without cutting outside the surface', () => {
    const base: Vec3[] = [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,0],[3,0,0]];
    const path = shortestSurfaceMotion(base, [0,0,1], 4);
    expect(path).toHaveLength(2); close(path.at(-1)!, [3,0,4]); expect(length(path)).toBeCloseTo(5);
  });
  it('finds the shortest branch through an intersection inside segments', () => {
    const path = shortestSurfaceMotion([[0,0,0],[2,2,0],[0,2,0],[2,0,0]], [0,0,1], 2);
    expect(path).toHaveLength(3); close(path[1], [1,1,1]);
    expect(length(path)).toBeCloseTo(Math.sqrt(12));
  });
  it('handles overlaps, reversals, duplicates and pure depth motion', () => {
    const path = shortestSurfaceMotion([[0,0,0],[4,0,0],[1,0,0],[1,0,0],[3,0,0]], [0,0,1], 4);
    expect(path).toHaveLength(2); expect(length(path)).toBeCloseTo(5);
    expect(shortestSurfaceMotion([[0,0,0]], [0,0,1], 2)).toEqual([[0,0,0],[0,0,2]]);
    expect(shortestSurfaceMotion([[0,0,0]], [0,0,1], 0)).toEqual([]);
    expect(shortestSurfaceMotion([[NaN,0,0]], [0,0,1], 2)).toEqual([]);
  });
  it('works on an arbitrarily oriented view plane', () => {
    const n = new THREE.Vector3(1,2,3).normalize(), u = new THREE.Vector3(0,1,0).projectOnPlane(n).normalize();
    const origin = new THREE.Vector3(7,8,9), base = [0,2,5].map(x => origin.clone().addScaledVector(u,x).toArray() as Vec3);
    const path = shortestSurfaceMotion(base, n.toArray() as Vec3, -3);
    expect(path).toHaveLength(2); close(path[1], origin.clone().addScaledVector(u,5).addScaledVector(n,-3).toArray() as Vec3);
  });
  it('removes only redundant collinear samples and keeps a small intentional bend', () => {
    expect(compactSurfacePath([[0,0,0],[1,0,0],[2,0,0],[2,0,0]])).toEqual([[0,0,0],[2,0,0]]);
    expect(compactSurfacePath([[0,0,0],[1,.0001,0],[2,0,0]])).toHaveLength(3);
  });
});

describe('surface-preserving playback and sparse controls', () => {
  const points: Vec3[] = [[0,0,0],[1,0,1],[1,3,4]];
  it('retains corners between integer frames and after saving, including fractional playback', () => {
    const object = createSceneObject('cube', 1), samples = motionPathFrames(points,1,2,true);
    object.keyframes = samples.map(sample => ({ id: crypto.randomUUID(), frame: sample.frame, property:'position', value:sample.position, interpolation:'linear', purpose:'motion', source:'user', commentIds:[], ...(sample.positionPath ? {positionPath:sample.positionPath} : {}) }));
    const project = createProject(); project.objects.push(object); const restored = ProjectSchema.parse(JSON.parse(JSON.stringify(project))).objects.at(-1)!;
    expect(object.keyframes).toHaveLength(2);
    expect(object.keyframes[0].positionPath).toHaveLength(3);
    for (const frame of [1.2,1.4,1.5,1.8,2.3]) close(evaluateTransform(restored,frame).position, pointOnPath(points,(frame-1)/2));
    // Editing an endpoint disables the stale interval instead of snapping back.
    restored.keyframes[1].value = [9,9,9];
    close(evaluateTransform(restored,1.5).position,[2.25,2.25,2.25]);
  });
  it('remaps recorded pauses without changing frame identities', () => {
    const samples = recordedSurfaceSamples([{id:'a',progress:0},{id:'b',progress:.1},{id:'c',progress:.1},{id:'d',progress:1}],points);
    close(samples[1].position,samples[2].position); expect(samples.map(s=>s.keyId)).toEqual(['a','b','c','d']); expect(samples[2].positionPath).toHaveLength(3);
  });
  it('shows endpoints normally and at most six meaningful controls in edit mode', () => {
    const keys = Array.from({length:100},(_,i)=>({id:String(i),value:pointOnPath(points,i/99)}));
    expect(motionHandleKeys(keys,.01).map(k=>k.id)).toEqual(['0','99']);
    expect(motionHandleKeys(keys,.01,[],true).length).toBeLessThanOrEqual(6);
    expect(motionHandleKeys(keys,.01,['33'],true).map(k=>k.id)).toContain('33');
  });
});
