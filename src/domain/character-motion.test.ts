import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, ProjectSchema } from './schema';
import { applyPlan, validatePlan } from './animation';
import { controllerOffset } from './controller-pose';
import { characterMotionHint, planCharacterMotion, resolveCharacterMotion } from './character-motion';
import { compileJevAction, composeParallelJevPlans, jevActionRequest, type JevActionResponse } from './jev-action';
import { planDirection, type DecisionRunner } from './direction-planner';
import { useEditor } from '../store/editor';

const choice = (value: string) => ({ type: 'choice' as const, choice: value, confidence: .95, probabilities: { [value]: .95 } });
const score = (value: number) => ({ type: 'score' as const, score: value, confidence: .95, probabilities: { [value]: .95 } });
const response = (characterAction = 'none'): JevActionResponse => ({
  model: 'test', answers: {
    actionable: { type: 'noul', noul: .98 }, motion: choice('hold'), action: choice('hold'), direction: choice('forward'),
    distance: score(2), duration: score(2), energy: score(2), path: choice('smooth'),
    character_action: choice(characterAction), character_side: choice('right'), character_part: choice('arm'), character_direction: choice('up'),
  },
});
function fixture() {
  const project = createProject();
  project.settings.frameEnd = 90;
  const character = createSceneObject('blend_asset', 1);
  character.name = 'Personaggio';
  character.asset.controllers = ['MANO_DX', 'MANO_SX', 'GOMITO_DX', 'GOMITO_SX', 'GINOCCHIO_DX', 'GINOCCHIO_SX', 'PIEDE_DX', 'PIEDE_SX'].map((part) => ({
    name: `CTRL_${part}`, position: [0, 0, 0], worldPosition: [0, 0, 1],
    worldBasis: [[.28, 0, 0], [0, .28, 0], [0, 0, .28]],
    morphTargets: [`X_${part}`, `Y_${part}`, `Z_${part}`], morphStep: .25,
  }));
  project.objects.push(character);
  return { project, character, input: { objectId: character.id, sceneId: project.cameraCuts[0]!.id, frame: 1, startPosition: character.transform.position } };
}

describe('Jev and Laya articulated character motions', () => {
  it('gives both models the available controls and body-action choices', () => {
    const { project, character, input } = fixture();
    const request = jevActionRequest(project, character, { ...input, instruction: 'alza il braccio destro' });
    expect(request.state.character_controls).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'CTRL_MANO_DX', part: 'hand', side: 'right' })]));
    expect(request.questions.character_action?.criteria).toHaveProperty('raise');
    expect(request.state.natural_language_hints.character_action).toBe('raise');
  });

  it('raises only the requested arm, without moving the whole character, and saves playable keys', () => {
    const { project, character, input } = fixture();
    const plan = compileJevAction(project, character, { ...input, instruction: 'alza il braccio destro', engine: 'jev' }, response('raise'));
    expect(plan.decision.characterAction).toBe('raise');
    expect(plan.blenderPlan.operations.filter((op) => op.type === 'set_controller_pose').map((op) => op.controllerName)).toEqual(['CTRL_MANO_DX', 'CTRL_MANO_DX']);
    expect(plan.blenderPlan.operations.some((op) => op.property === 'position' || op.property === 'rotation')).toBe(false);
    expect(validatePlan(project, plan.blenderPlan)).toEqual([]);
    const result = applyPlan(project, plan.blenderPlan).objects.find((object) => object.id === character.id)!;
    const end = Math.max(...plan.blenderPlan.operations.map((op) => op.frame));
    expect(controllerOffset(result.asset, 'CTRL_MANO_DX', end)[2]).toBeGreaterThan(.2);
    expect(controllerOffset(result.asset, 'CTRL_MANO_DX', Math.floor(end / 2))[2]).toBeGreaterThan(0);
    expect(controllerOffset(result.asset, 'CTRL_MANO_SX', end)).toEqual([0, 0, 0]);
    expect(ProjectSchema.parse({ ...project, objects: project.objects.map((entry) => entry.id === character.id ? result : entry) })).toBeTruthy();
  });

  it('raises both arms when the instruction names them in the plural', () => {
    const { project, character, input } = fixture();
    const plan = compileJevAction(project, character, { ...input, instruction: 'alza le braccia' }, response('raise'));
    expect(new Set(plan.blenderPlan.operations.filter((op) => op.type === 'set_controller_pose').map((op) => op.controllerName))).toEqual(new Set(['CTRL_MANO_DX', 'CTRL_MANO_SX']));
  });

  it('animates a wave and returns the hand to its original pose', () => {
    const { project, character, input } = fixture();
    const plan = compileJevAction(project, character, { ...input, instruction: 'saluta con la mano sinistra', engine: 'laya' }, response('none'));
    const keys = plan.blenderPlan.operations.filter((op) => op.type === 'set_controller_pose');
    expect(plan.blenderPlan.summary).toContain('Laya');
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys.every((op) => op.controllerName === 'CTRL_MANO_SX')).toBe(true);
    const result = applyPlan(project, plan.blenderPlan).objects.find((object) => object.id === character.id)!;
    expect(controllerOffset(result.asset, 'CTRL_MANO_SX', keys.at(-1)!.frame)).toEqual([0, 0, 0]);
    expect(controllerOffset(result.asset, 'CTRL_MANO_SX', keys[1]!.frame)).not.toEqual([0, 0, 0]);
  });

  it('adds alternating limbs to a walking movement and supports undo when accepted', () => {
    const { project, character, input } = fixture();
    const plan = compileJevAction(project, character, { ...input, instruction: 'cammina avanti', engine: 'laya' }, response('walk'));
    expect(plan.blenderPlan.operations.some((op) => op.property === 'position')).toBe(true);
    expect(plan.blenderPlan.operations.some((op) => op.controllerName === 'CTRL_PIEDE_DX')).toBe(true);
    expect(plan.blenderPlan.operations.some((op) => op.controllerName === 'CTRL_PIEDE_SX')).toBe(true);
    expect(validatePlan(project, plan.blenderPlan)).toEqual([]);
    useEditor.setState({ project, currentFrame: 1, past: [], future: [] });
    useEditor.getState().acceptJevPlan(plan.blenderPlan, input.sceneId);
    const saved = useEditor.getState().project.objects.find((object) => object.id === character.id)!;
    expect(saved.asset.controllerKeys?.some((key) => key.source === 'ai')).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().project.objects.find((object) => object.id === character.id)!.asset.controllerKeys).toBeUndefined();
  });

  it('keeps manually placed joint keys when a later AI instruction affects that controller', () => {
    const { project, character, input } = fixture();
    character.asset.controllerKeys = [{ name: 'CTRL_MANO_DX', frame: 1, offset: [0, 0, .3], source: 'user' }];
    const plan = compileJevAction(project, character, { ...input, instruction: 'alza il braccio destro' }, response('raise'));
    const result = applyPlan(project, plan.blenderPlan).objects.find((object) => object.id === character.id)!;
    expect(result.asset.controllerKeys?.find((key) => key.frame === 1 && key.name === 'CTRL_MANO_DX')).toMatchObject({ offset: [0, 0, .3], source: 'user' });
  });

  it('does not invent a joint motion for a rigid whole-object translation', () => {
    const { character } = fixture();
    expect(characterMotionHint('sposta il personaggio a destra')).toBeUndefined();
    expect(resolveCharacterMotion('sposta il personaggio a destra', { character_action: choice('none') }, character)).toBeUndefined();
    expect(resolveCharacterMotion('alza il personaggio', { character_action: choice('raise'), character_controller: choice('CTRL_MANO_DX') }, character)).toBeUndefined();
    expect(planCharacterMotion(character, 'sposta il personaggio a destra', { character_action: choice('none') }, 1, 20)).toEqual([]);
  });

  it('lets the model target a named custom rig control beyond hands and legs', () => {
    const { project, character, input } = fixture();
    character.asset.controllers!.push({ name: 'BONE|Rig|Tail', position: [0, 0, 0], worldPosition: [0, 0, 1], morphTargets: ['tail_x', 'tail_y', 'tail_z'], morphStep: .25 });
    const answer = response('raise');
    answer.answers.character_controller = choice('BONE|Rig|Tail');
    const plan = compileJevAction(project, character, { ...input, instruction: 'alza la coda' }, answer);
    expect(plan.blenderPlan.operations.filter((op) => op.type === 'set_controller_pose').map((op) => op.controllerName)).toEqual(['BONE|Rig|Tail', 'BONE|Rig|Tail']);
  });

  it('keeps two articulated actions in order through the full Jev/Laya direction planner', async () => {
    const { project, character, input } = fixture();
    const run: DecisionRunner = async (request) => {
      if ('clause_relation' in request.questions) return { answers: { clause_relation: choice('then') } };
      if ('motion_family' in request.questions) return { answers: { motion_family: choice('pose') } };
      const instruction = (request.state as { instruction: string }).instruction;
      return response(instruction.includes('saluta') ? 'wave' : 'raise');
    };
    const plan = await planDirection(project, { ...input, engine: 'laya', instruction: 'alza il braccio destro poi saluta con la mano destra' }, run);
    expect(plan.blenderPlan.directionPlan?.actions.map((action) => action.characterAction)).toEqual(['raise', 'wave']);
    expect(validatePlan(project, plan.blenderPlan)).toEqual([]);
    const applied = applyPlan(project, plan.blenderPlan);
    const updated = applied.objects.find((object) => object.id === character.id)!;
    const firstEnd = plan.blenderPlan.directionPlan!.actions[0]!.endFrame;
    expect(controllerOffset(updated.asset, 'CTRL_MANO_DX', firstEnd)[2]).toBeGreaterThan(0);
    expect(updated.asset.controllerKeys?.length).toBeGreaterThan(4);
  });

  it('combines a walking arm swing and a wave on the same hand without conflicting keys', () => {
    const { project, character, input } = fixture();
    const walk = compileJevAction(project, character, { ...input, instruction: 'cammina avanti' }, response('walk'));
    const wave = compileJevAction(project, character, { ...input, instruction: 'saluta con la mano destra' }, response('wave'));
    const combined = composeParallelJevPlans(project, [walk, wave], 'cammina mentre saluta');
    expect(validatePlan(project, combined.blenderPlan)).toEqual([]);
    const right = combined.blenderPlan.operations.filter((op) => op.controllerName === 'CTRL_MANO_DX');
    expect(new Set(right.map((op) => op.frame)).size).toBe(right.length);
    const updated = applyPlan(project, combined.blenderPlan).objects.find((object) => object.id === character.id)!;
    expect(controllerOffset(updated.asset, 'CTRL_MANO_DX', right[1]!.frame)).not.toEqual([0, 0, 0]);
  });
});
