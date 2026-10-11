import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '../domain/schema';
import { alignmentBounds, alignmentPeers, createObjectAlignment } from './object-alignment';

const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const setup = () => {
  const project = createProject(), object = createSceneObject('cube', 1), target = createSceneObject('cube', 2);
  object.transform.position = [3, 0, 1]; target.transform.position = [5, 0, 1]; project.objects.push(object, target);
  const scene = new THREE.Scene(), root = new THREE.Group(); root.position.set(...object.transform.position); root.userData.sceneObjectId = object.id;
  root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))); scene.add(root);
  const camera = new THREE.PerspectiveCamera(60, 1000 / 600, .1, 100); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return { project, object, target, scene, root, camera, viewport: { width: 1000, height: 600 } as DOMRect };
};
describe('3D alignment', () => {
  it('supports unbatched and instanced primitive targets and respects the gizmo axis', () => {
    const s = setup(), snapper = createObjectAlignment(s.object, s.project, 1, [s.object.id], s.scene, s.root, s.camera, false, s.viewport);
    const raw = new THREE.Vector3(3.25, 7, 1.07), snapped = snapper.apply(raw, [0]);
    expect(snapped.position.x).toBe(3); expect(snapped.position.y).toBe(7); expect(snapped.position.z).toBe(1.07);
    expect(snapped.guides[0].label).toBe(s.target.name);
    expect(snapper.apply(raw, [0], true).position.toArray()).toEqual(raw.toArray());
  });
  it('uses the rendered bounds of rotated imported geometry and ignores controller handles', () => {
    const object = createSceneObject('blend_asset', 1), root = new THREE.Group();
    root.rotation.z = Math.PI / 2; root.scale.set(.5, 2, 1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6)); mesh.position.set(3, 0, 2); root.add(mesh);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100)); handle.userData.strokeSkip = true; root.add(handle); root.updateMatrixWorld(true);
    const bounds = alignmentBounds(root, object, object.transform, basis), expected = new THREE.Box3().setFromObject(mesh);
    expect(bounds.min.distanceTo(expected.min)).toBeLessThan(1e-8); expect(bounds.max.distanceTo(expected.max)).toBeLessThan(1e-8);
  });
  it('filters audio, helpers, screen layers, hidden objects, other scenes and selected group members', () => {
    const s = setup(), audio = createSceneObject('audio', 1), text = createSceneObject('text', 1), hidden = createSceneObject('cube', 3), foreign = createSceneObject('cube', 4);
    hidden.visible = false; foreign.sceneIds = [crypto.randomUUID()]; s.project.objects.push(audio, text, hidden, foreign);
    expect(alignmentPeers(s.project, s.object, 1, [s.object.id])).toEqual([s.target]);
    expect(alignmentPeers(s.project, s.object, 1, [s.object.id, s.target.id])).toEqual([]);
  });
  it('shows the floor guide at the projected bottom instead of the object pivot', () => {
    const s = setup();
    s.camera.position.set(8, -10, 7); s.camera.up.set(0, 0, 1); s.camera.lookAt(0, 0, 1); s.camera.updateMatrixWorld();
    const snapper = createObjectAlignment(s.object, s.project, 1, [s.object.id], s.scene, s.root, s.camera, true, s.viewport);
    const result = snapper.apply(s.root.position.clone(), [1]);
    const floor = result.guides.find(guide => guide.label === 'Floor');
    expect(floor).toBeDefined();
    const world = new THREE.Box3().setFromObject(s.root);
    const bottom = Math.min(...[world.min.x, world.max.x].flatMap(x => [world.min.y, world.max.y].flatMap(y => [world.min.z, world.max.z].map(z => new THREE.Vector3(x,y,z).project(s.camera).y))));
    expect(floor!.to.clone().project(s.camera).y).toBeCloseTo(bottom, 6);
    expect(Math.abs(floor!.to.clone().project(s.camera).y - s.root.position.clone().project(s.camera).y)).toBeGreaterThan(.01);
  });
  it('aligns projected edges at different depths without moving the gizmo’s other axes', () => {
    const s = setup(); s.object.transform.position = [0, 0, 5]; s.object.transform.scale = [.2, .2, .2];
    s.root.position.set(0, 0, 5); s.root.scale.set(.2, .2, .2); s.target.transform.position = [2, 0, 0]; s.target.transform.scale = [.4, .4, .4];
    const snapper = createObjectAlignment(s.object, s.project, 1, [s.object.id], s.scene, s.root, s.camera, true, s.viewport);
    const result = snapper.apply(new THREE.Vector3(1.04, .3, 5), [0]);
    expect(result.guides).toHaveLength(1); expect(result.position.y).toBeCloseTo(.3, 8); expect(result.position.z).toBeCloseTo(5, 8);
    const targetBox = alignmentBounds(undefined, s.target, s.target.transform, basis);
    const projected = (box: THREE.Box3) => new THREE.Box3().setFromPoints([box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new THREE.Vector3(x, y, z).project(s.camera)))));
    const targetScreen = projected(targetBox); s.root.position.copy(result.position); s.root.updateMatrixWorld(true);
    const movingScreen = projected(alignmentBounds(s.root, s.object, s.object.transform, basis));
    const own = [movingScreen.min.x, movingScreen.getCenter(new THREE.Vector3()).x, movingScreen.max.x];
    const other = [targetScreen.min.x, targetScreen.getCenter(new THREE.Vector3()).x, targetScreen.max.x];
    expect(Math.min(...own.flatMap(x => other.map(y => Math.abs(x - y))))).toBeLessThan(1e-6);
  });
});
