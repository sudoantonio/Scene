import { Laya } from '@receptron/laya';
import { createProject, createSceneObject } from '../src/domain/schema';
import { planDirection } from '../src/domain/direction-planner';
import { runLayaQuestions } from '../src/domain/laya-runtime';

const runtime = await Laya.load();
const phrases = [
  'la camera si avvicina e poi si allontana dal personaggio',
  'la camera si avvicina al personaggio e poi si allontana, continuando a inquadrarlo',
];
for (const instruction of phrases) {
  const project = createProject();
  project.settings.frameEnd = 90;
  project.objects[0]!.transform.position = [0, -8, 1];
  project.objects[0]!.transform.rotation = [90, 0, 0];
  const subject = createSceneObject('sphere', 1);
  subject.name = 'Personaggio'; subject.transform.position = [0, 0, 1]; project.objects.push(subject);
  const started = Date.now();
  try {
    const plan = await planDirection(project, { engine: 'laya', objectId: project.objects[0]!.id, target: 'camera', sceneId: project.cameraCuts[0]!.id, frame: 1, startPosition: null, instruction }, async (request) => runLayaQuestions(runtime, request.state, request.questions as never));
    const actions = plan.blenderPlan.directionPlan!.actions;
    const passed = actions.length === 2 && actions[0]!.motion === 'dolly_in' && actions[1]!.motion === 'dolly_out' && (!instruction.includes('inquadr') || actions.every((action) => action.keepInFrame));
    console.log(JSON.stringify({ instruction, passed, milliseconds: Date.now() - started, actions: actions.map(({ motion, keepInFrame, startFrame, endFrame }) => ({ motion, keepInFrame, startFrame, endFrame })) }));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ instruction, passed: false, milliseconds: Date.now() - started, error: String(error) })); process.exitCode = 1;
  }
}
