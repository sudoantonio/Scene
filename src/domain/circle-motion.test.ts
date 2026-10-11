import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { objectMotionPoints, projectMotionPoints, pointsInCircle, fitViewPlane, circleViewLine, intersectViewLine, translatedPivot } from './circle-motion';

describe('two-object circle movement', () => {
  it('fits the constrained least-squares plane with every selected point, without a 50-point limit', () => {
    const points = Array.from({length: 120}, (_, i) => new THREE.Vector3(i, -i, i % 3));
    const plane = fitViewPlane(points, new THREE.Vector3(0, 0, -2))!;
    expect(plane.normal.toArray()).toEqual([0,0,-1]); expect(plane.constant).toBeCloseTo(1);
    const error = (offset: number) => points.reduce((sum, p) => sum + (plane.distanceToPoint(p) + offset) ** 2, 0);
    expect(error(0)).toBeLessThan(error(.1)); expect(error(0)).toBeLessThan(error(-.1));
    expect(fitViewPlane([], plane.normal)).toBeUndefined();
  });
  it('includes the circumference and supports an empty, one-point or enlarged aperture', () => {
    const points = [{point:new THREE.Vector3(1,2,3),x:3,y:4},{point:new THREE.Vector3(4,5,6),x:6,y:0}];
    expect(pointsInCircle(points,0,0,4)).toHaveLength(0);
    expect(pointsInCircle(points,0,0,5)).toEqual([points[0].point]);
    expect(pointsInCircle(points,0,0,6)).toHaveLength(2);
    expect(fitViewPlane([points[0].point], new THREE.Vector3(0,0,1))!.constant).toBe(-3);
  });
  it('collects transformed imported mesh vertices, deduplicates shared vertices and excludes helpers', () => {
    const root = new THREE.Group(); root.position.set(5,0,0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2,2,2)); mesh.position.set(0,0,3); root.add(mesh);
    const helper = new THREE.Group(); helper.userData.strokeSkip = true; helper.add(new THREE.Mesh(new THREE.SphereGeometry())); root.add(helper);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry()); hidden.visible = false; root.add(hidden);
    const points = objectMotionPoints(root); expect(points).toHaveLength(8);
    expect(points.every(p => [4,6].includes(p.x) && [2,4].includes(p.z))).toBe(true);
  });
  it('uses morph targets and each visible instance in world coordinates', () => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
    g.morphAttributes.position = [new THREE.Float32BufferAttribute([0,0,2],3)];
    const mesh = new THREE.Mesh(g); mesh.morphTargetInfluences![0] = .5;
    expect(objectMotionPoints(mesh)[0].z).toBe(1);
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);
    instanced.setMatrixAt(1,new THREE.Matrix4().makeTranslation(5,0,0));
    expect(objectMotionPoints(instanced)).toHaveLength(16);
  });
  it('collects actual glyph bounds rather than the Troika template quad', () => {
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
    g.setAttribute('aTroikaGlyphBounds',new THREE.InstancedBufferAttribute(new Float32Array([1,2,3,4]),4)); g.instanceCount=1;
    const points = objectMotionPoints(new THREE.Mesh(g)); expect(points).toHaveLength(4);
    expect(points.map(p=>p.toArray())).toContainEqual([3,4,0]);
  });
  it('projects the visible depth range and excludes vertices behind the camera', () => {
    const c = new THREE.PerspectiveCamera(60,1,.1,100); c.updateMatrixWorld(true);
    const points = projectMotionPoints([new THREE.Vector3(0,0,-5),new THREE.Vector3(0,0,5),new THREE.Vector3(0,0,-101)],c,{width:200,height:200});
    expect(points).toHaveLength(1); expect(points[0].x).toBe(100); expect(points[0].y).toBe(100);
  });
  it.each(['perspective','orthographic'])('keeps the perpendicular line and picked source offset in %s view', kind => {
    const c = kind==='perspective' ? new THREE.PerspectiveCamera(60,1,.1,100) : new THREE.OrthographicCamera(-5,5,5,-5,.1,100);
    c.updateMatrixWorld(true);
    const source = fitViewPlane([new THREE.Vector3(0,0,-5)],new THREE.Vector3(0,0,-1))!;
    const line = circleViewLine(c,{width:200,height:200},150,100,source)!;
    expect(line.direction.distanceTo(new THREE.Vector3(0,0,-1))).toBeLessThan(1e-12);
    const anchor = intersectViewLine(line,source)!;
    const target = intersectViewLine(line,fitViewPlane([new THREE.Vector3(0,0,-3)],source.normal)!)!;
    expect(target.x).toBeCloseTo(anchor.x); expect(target.z).toBeCloseTo(-3);
    const pivot = new THREE.Vector3(1,1,-4), moved = translatedPivot(pivot,anchor,target);
    expect(moved.clone().sub(pivot).toArray()).toEqual(target.clone().sub(anchor).toArray());
  });
});
