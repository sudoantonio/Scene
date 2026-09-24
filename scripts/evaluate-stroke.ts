import { Laya } from '@receptron/laya';
import * as THREE from 'three';
import { createProject, createSceneObject, type Vec3 } from '../src/domain/schema';
import { planDirection } from '../src/domain/direction-planner';
import { runLayaQuestions } from '../src/domain/laya-runtime';

const runtime = await Laya.load();
for (const instruction of ['il cubo salta', 'segui il tratto']) {
  const project = createProject(); project.settings.frameEnd = 90;
  const subject = createSceneObject('cube', 1); subject.name = 'Cubo'; subject.transform.position = [0, 0, 1]; project.objects.push(subject);
  const view = new THREE.PerspectiveCamera(45, 16 / 9);
  view.position.set(0, -8, 1 + 8 / Math.sqrt(3)); view.rotation.set(Math.PI / 3, 0, 0); view.updateMatrixWorld(true);
  const intended: Vec3[] = [[0, 0, 1], [.5, 0, 3], [1, 0, 1]];
  const points = intended.map((p) => { const projected = new THREE.Vector3(...p).project(view); return [(projected.x + 1) / 2, (1 - projected.y) / 2] as [number, number]; });
  const started = Date.now();
  try {
    const plan = await planDirection(project, { engine: 'laya', objectId: subject.id, target: 'subject', sceneId: project.cameraCuts[0]!.id, frame: 1, startPosition: subject.transform.position, instruction, gesture: { target: 'subject', points, viewMode: 'free', viewPosition: view.position.toArray() as Vec3, viewRotation: [60, 0, 0], verticalFovDegrees: 45, aspect: 16 / 9 } }, async (request) => runLayaQuestions(runtime, request.state, request.questions as never));
    const positions = plan.blenderPlan.operations.filter((op) => op.property === 'position').map((op) => op.value.vector!);
    const jump = instruction.includes('salta');
    const passed = jump ? positions.length >= 3 && Math.max(...positions.map((p) => p[2])) > 2 && Math.abs(positions.at(-1)![2] - 1) < 1e-6 : positions.length >= 3;
    console.log(JSON.stringify({ instruction, passed, milliseconds: Date.now() - started, motion: plan.decision.motion, positions }));
    if (!passed) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ instruction, passed: false, error: String(error) })); process.exitCode = 1; }
}
