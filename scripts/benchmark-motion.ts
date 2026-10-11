import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createProject, createSceneObject, type Vec3 } from '../src/domain/schema';
import { automaticStrokeRadius, positionStrokePoint, StrokePointIndex, strokeNeighbors, StrokeSurface } from '../src/domain/stroke-spatial';
import { useEditor } from '../src/store/editor';
const project = createProject(); project.settings.frameEnd = 5000;
const surfaces: StrokeSurface[] = [];
for (let i = 0; i < 100; i++) {
  const object = createSceneObject('cube', i + 1); object.transform.position = [i % 10, Math.floor(i / 10), -.4]; object.transform.scale = [.2, .2, .2]; project.objects.push(object);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .4)); mesh.position.set(...object.transform.position); mesh.updateMatrixWorld(true); surfaces.push(new StrokeSurface(object.id, mesh));
}
const stroke = createSceneObject('stroke', 1); stroke.stroke = { thickness: .01, points: Array.from({ length: 10000 }, (_, i) => [i % 100 * .1, Math.floor(i / 100) * .1, 0] as Vec3) }; project.objects.push(stroke);
const target = createSceneObject('sphere', 1); project.objects.push(target);
useEditor.setState({ project, past: [], future: [], currentFrame: 1, recordingSession: undefined }); useEditor.getState().startRecording(project.cameraCuts[0].id);
const index = new StrokePointIndex(stroke.stroke.points.map((position, i) => ({ id: `p:${i}`, position })));
let radius = .4, keyId: string | undefined, previous: Vec3 | undefined; const times: number[] = [];
for (let frame = 2; frame <= 501; frame++) {
  const ray = new THREE.Ray(new THREE.Vector3(2 + Math.sin(frame / 35), 2 + Math.cos(frame / 35), 4), new THREE.Vector3(0, 0, -1));
  const provisional: Vec3 = [ray.origin.x, ray.origin.y, 0]; const start = performance.now();
  let neighbors = strokeNeighbors(new THREE.Vector3(...provisional), radius, index, surfaces);
  radius = automaticStrokeRadius(2, radius, neighbors); neighbors = strokeNeighbors(new THREE.Vector3(...provisional), radius, index, surfaces);
  const position = positionStrokePoint(ray, provisional, neighbors, radius, { adherence: .7, continuity: .6 }, previous).position;
  keyId = useEditor.getState().recordDrawnPosition(target.id, position, frame, 1, keyId)?.keyId;
  previous = position; times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const result = { points: 10000, objects: 100, samples: times.length, includes: ['neighbor query', 'automatic radius', 'depth placement', 'REC store update'], excludes: ['initial spatial index construction', 'animated neighbor geometry rebuild', 'GPU rendering'], p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1), targetMs: 16 };
writeFileSync(process.argv[2], JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
if (result.p95Ms >= 16) process.exitCode = 1;
