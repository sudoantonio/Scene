import { describe, expect, it } from 'vitest';
import { allocateDirectionFrames, interpretDirection, planDirection, type DecisionRunner } from './direction-planner';
import { createProject, createSceneObject, ProjectSchema } from './schema';
import { applyPlan, evaluateTransform } from './animation';
import { useEditor } from '../store/editor';

const choice = (value: string) => ({ type: 'choice', choice: value, confidence: .95, probabilities: { [value]: .95 } });
const score = (value: number) => ({ type: 'score', score: value, confidence: .95, probabilities: { [value]: .95 } });
const runner: DecisionRunner = async (request) => {
  const state = request.state as { instruction: string; right_clause?: string };
  if ('clause_relation' in request.questions) return { answers: { clause_relation: choice(state.right_clause?.includes('inquadr') ? 'keep_in_frame' : state.right_clause?.includes('destra') ? 'join' : 'then') } };
  if ('motion_family' in request.questions) return { answers: { motion_family: choice('camera_translation') } };
  return { model: 'test-decisions', answers: { actionable: { type: 'noul', noul: .99 }, motion: choice(state.instruction.includes('allontana') ? 'dolly_out' : 'dolly_in'), distance: score(3), duration: score(4), energy: score(2), path: choice('direct') } };
};
function fixture() {
  const project = createProject();
  project.settings.frameEnd = 90;
  const camera = project.objects[0]!;
  camera.transform.position = [0, -8, 1];
  camera.transform.rotation = [90, 0, 0];
  const character = createSceneObject('sphere', 1);
  character.name = 'Personaggio'; character.transform.position = [0, 0, 1];
  project.objects.push(character);
  const input = { objectId: camera.id, target: 'camera' as const, sceneId: project.cameraCuts[0]!.id, frame: 1, startPosition: null, instruction: 'la camera si avvicina e poi si allontana dal personaggio, continuando a inquadrarlo' };
  return { project, camera, character, input };
}

describe('Persistent direction planning', () => {
  it('separates unseen verbs without a verb dictionary and keeps parameters together', async () => {
    expect((await interpretDirection('accenna un inchino e poi esita', runner)).actions).toHaveLength(2);
    expect((await interpretDirection('si sposta in alto e destra', runner)).actions).toEqual([{ instruction: 'si sposta in alto e destra', relation: 'then' }]);
    expect((await interpretDirection('avanza mentre saluta', runner)).actions[1]!.relation).toBe('with');
  });
  it('keeps a continuous framing clause out of the action list even when the model misclassifies it', async () => {
    const result = await interpretDirection('si avvicina e poi si allontana, continuando a inquadrarlo', async () => ({ answers: { clause_relation: choice('then') } }));
    expect(result.actions).toHaveLength(2);
    expect(result.constraints).toEqual(['continuando a inquadrarlo']);
  });
  it('allocates time for every action and refuses impossible explicit durations', () => {
    expect(allocateDirectionFrames([{ frames: 120, explicit: false }, { frames: 120, explicit: false }], 89)).toEqual([45, 44]);
    expect(() => allocateDirectionFrames([{ frames: 120, explicit: true }, { frames: 120, explicit: true }], 89)).toThrow('durate richieste');
  });
  it('creates an approach and retreat with shared focus in a three-second scene', async () => {
    const { project, camera, character, input } = fixture();
    const plan = await planDirection(project, input, runner);
    const direction = plan.blenderPlan.directionPlan!;
    expect(direction.actions.map((action) => action.motion)).toEqual(['dolly_in', 'dolly_out']);
    expect(direction.actions.every((action) => action.referenceId === character.id && action.keepInFrame)).toBe(true);
    expect(direction.endFrame).toBe(90);
    const applied = applyPlan(project, plan.blenderPlan);
    const result = applied.objects.find((object) => object.id === camera.id)!;
    const middle = evaluateTransform(result, direction.actions[0]!.endFrame).position;
    const end = evaluateTransform(result, 90).position;
    expect(middle[1]).toBeCloseTo(-6);
    expect(end[1]).toBeCloseTo(-8);
    expect(project.objects[0]!.keyframes).toHaveLength(0);
    useEditor.setState({ project });
    useEditor.getState().acceptJevPlan(plan.blenderPlan, input.sceneId);
    const saved = ProjectSchema.parse(JSON.parse(JSON.stringify(useEditor.getState().project)));
    expect(saved.directionPlans?.[0]?.actions).toHaveLength(2);
    useEditor.getState().undo();
    expect(useEditor.getState().project.directionPlans).toBeUndefined();
  });
  it('edits the second action while preserving the first action identity and timing', async () => {
    const { project, input } = fixture();
    const first = await planDirection(project, input, runner);
    const direction = first.blenderPlan.directionPlan!;
    const updated = applyPlan(project, first.blenderPlan);
    updated.directionPlans = [direction];
    let actionCalls = 0;
    const revised = await planDirection(updated, { ...input, instruction: 'si allontana di 1 metro dal personaggio', directionPlanId: direction.id, editActionId: direction.actions[1]!.id }, async (request) => {
      if ('motion' in request.questions) actionCalls++;
      return runner(request);
    });
    expect(actionCalls).toBe(1);
    expect(revised.blenderPlan.directionPlan!.id).toBe(direction.id);
    expect(revised.blenderPlan.directionPlan!.actions[0]).toEqual(direction.actions[0]);
    expect(revised.blenderPlan.directionPlan!.actions[1]!.id).toBe(direction.actions[1]!.id);
    const final = applyPlan(updated, revised.blenderPlan);
    expect(evaluateTransform(final.objects[0]!, 90).position[1]).toBeCloseTo(-7);
  });

  it('continues an existing direction and retains the earlier actions as model context', async () => {
    const { project, input } = fixture();
    const first = await planDirection(project, input, runner);
    const direction = first.blenderPlan.directionPlan!;
    const updated = applyPlan(project, first.blenderPlan);
    updated.directionPlans = [direction];
    const continued = await planDirection(updated, { ...input, instruction: 'poi si avvicina al personaggio', directionPlanId: direction.id, directionMode: 'continue' }, runner);
    const result = continued.blenderPlan.directionPlan!;
    expect(result.id).toBe(direction.id);
    expect(result.actions.map((action) => action.motion)).toEqual(['dolly_in', 'dolly_out', 'dolly_in']);
    expect(result.actions.slice(0, 2).map((action) => action.id)).toEqual(direction.actions.map((action) => action.id));
    expect(result.prompts?.map((prompt) => prompt.mode)).toEqual(['new', 'continue']);
    expect(result.endFrame).toBeLessThanOrEqual(90);
  });

  it('adds a follow-up constraint without turning it into another movement', async () => {
    const { project, input } = fixture();
    const first = await planDirection(project, input, runner);
    const direction = first.blenderPlan.directionPlan!;
    const updated = applyPlan(project, first.blenderPlan);
    updated.directionPlans = [direction];
    const refined = await planDirection(updated, { ...input, instruction: 'mantieni sempre il personaggio inquadrato', directionPlanId: direction.id, directionMode: 'refine' }, runner);
    const result = refined.blenderPlan.directionPlan!;
    expect(result.actions).toHaveLength(2);
    expect(result.actions.every((action) => action.keepInFrame)).toBe(true);
    expect(result.constraints).toContain('mantieni sempre il personaggio inquadrato');
    expect(result.prompts?.at(-1)).toEqual({ instruction: 'mantieni sempre il personaggio inquadrato', mode: 'refine' });
  });

  it('does not apply a partial plan when requested durations exceed the scene', async () => {
    const { project, input } = fixture();
    input.instruction = 'la camera si avvicina in 4 secondi e poi si allontana in 4 secondi dal personaggio';
    await expect(planDirection(project, input, runner)).rejects.toThrow('durate richieste');
    expect(project.objects[0]!.keyframes).toHaveLength(0);
  });
});
