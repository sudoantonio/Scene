import * as THREE from 'three';
import { createProject, createSceneObject, type Keyframe, type Vec3 } from './schema';

/** Deterministic heavy scene used by the opt-in performance harness. */
export function createPerformanceFixture(count = 1000) {
  const project = createProject();
  project.name = `Performance · ${count} objects`;
  project.settings.fps = 60; project.settings.frameEnd = 12000;
  const scene = project.cameraCuts[0], camera = project.objects[0];
  const view = new THREE.PerspectiveCamera();
  view.up.set(0, 0, 1); view.position.set(38, -48, 42); view.lookAt(0, 0, 1);
  camera.transform.position = view.position.toArray() as Vec3;
  camera.transform.rotation = [view.rotation.x, view.rotation.y, view.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3;
  scene.framing.target = [0, 0, 1]; scene.framing.distance = view.position.distanceTo(new THREE.Vector3(0, 0, 1));
  const side = Math.ceil(Math.sqrt(count));
  const colors = ['#9cabb8', '#d97373', '#448361', '#337ea9'];
  for (let index = 0; index < count; index++) {
    const object = createSceneObject(index % 5 === 0 ? 'sphere' : 'cube', index + 1);
    object.id = `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`;
    object.color = colors[index % colors.length]; object.transform.scale = [.28, .28, .28];
    object.transform.position = [(index % side - side / 2) * 1.3, (Math.floor(index / side) - side / 2) * 1.3, .5];
    object.sceneIds = [scene.id];
    if (index % 10 === 0) object.keyframes = Array.from({ length: 100 }, (_, keyIndex): Keyframe => ({
      id: crypto.randomUUID(), frame: 1 + keyIndex * 120, property: 'position', value: [object.transform.position[0], object.transform.position[1], .5 + (keyIndex % 2)], interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [],
    }));
    project.objects.push(object);
  }
  const actor = project.objects[1];
  const points: Vec3[] = Array.from({ length: 10000 }, (_, index) => {
    const t = index / 9999;
    return [actor.transform.position[0] + t * 8, actor.transform.position[1] + Math.sin(t * Math.PI * 4), .5];
  });
  actor.keyframes = [{ id: crypto.randomUUID(), frame: 1, property: 'position', value: points[0], positionPath: points, interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] }, { id: crypto.randomUUID(), frame: 11999, property: 'position', value: points.at(-1)!, interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] }];
  return project;
}

/** Clear geometry picking/dragging checks while retaining the large-scene batch. */
export function createPerformanceInteractionFixture() {
  const project = createPerformanceFixture(1000);
  project.name = 'Check · selection, drawing and REC';
  project.settings.fps = 24; project.settings.frameEnd = 240;
  project.objects.slice(1).forEach((object, index) => { object.keyframes = []; object.transform.position = [10000 + index, 10000, 1]; });
  const source = project.objects[1], destination = project.objects[2];
  source.kind = 'cube'; source.name = 'Object to move'; source.transform.position = [-2, 0, 1]; source.transform.scale = [1, 1, 1];
  destination.kind = 'sphere'; destination.name = 'Destination'; destination.transform.position = [2, 0, 1]; destination.transform.scale = [1, 1, 1];
  const camera = new THREE.PerspectiveCamera(); camera.up.set(0,0,1); camera.position.set(8,-10,7); camera.lookAt(0,0,1);
  project.objects[0].transform.position = camera.position.toArray() as Vec3;
  project.objects[0].transform.rotation = [camera.rotation.x,camera.rotation.y,camera.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3;
  project.cameraCuts[0].framing.distance = camera.position.distanceTo(new THREE.Vector3(0,0,1));
  return project;
}
