import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from './schema';
import { compileJevAction, jevActionRequest, type JevActionResponse } from './jev-action';

const response = (overrides: Partial<JevActionResponse['answers']> = {}): JevActionResponse => ({
  model: 'jev-1.13.0',
  answers: {
    actionable: { type: 'noul', noul: .96 },
    action: { type: 'choice', choice: 'move', confidence: .91, probabilities: { move: .91 } },
    direction: { type: 'choice', choice: 'right', confidence: .88, probabilities: { right: .88 } },
    distance: { type: 'score', score: 3, confidence: .82, probabilities: { '3': .82 } },
    duration: { type: 'score', score: 2, confidence: .86, probabilities: { '2': .86 } },
    energy: { type: 'score', score: 3, confidence: .8, probabilities: { '3': .8 } },
    path: { type: 'choice', choice: 'smooth', confidence: .9, probabilities: { smooth: .9 } },
    ...overrides,
  },
});

describe('Jev action compiler', () => {
  it('sends the selected character and the coordinate convention as state', () => {
    const project = createProject();
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const request = jevActionRequest(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [1, 2, 3], instruction: 'corre a destra' });
    expect(request.model).toBe('jev-latest');
    expect(request.state.start_position_meters).toEqual({ x: 1, y: 2, z: 3 });
    expect(request.questions.action.type).toBe('choice');
  });

  it('compiles a typed move decision into position keyframes', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 10, startPosition: [1, 2, 0], instruction: 'vai a destra con decisione' }, response());
    expect(result.status).toBe('ready');
    expect(result.decision).toMatchObject({ action: 'move', direction: 'right', distanceMeters: 2, durationSeconds: 1, path: 'smooth' });
    expect(result.blenderPlan.operations).toHaveLength(2);
    expect(result.blenderPlan.operations[1].value.vector).toEqual([3, 2, 0]);
    expect(result.blenderPlan.operations[1].frame).toBe(34);
  });

  it('adds an apex to a jump and flags uncertain decisions for review', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'salta in avanti' }, response({
      action: { type: 'choice', choice: 'jump', confidence: .4, probabilities: { jump: .4 } },
      direction: { type: 'choice', choice: 'forward', confidence: .9, probabilities: { forward: .9 } },
    }));
    expect(result.status).toBe('review');
    expect(result.blenderPlan.operations).toHaveLength(3);
    expect(result.blenderPlan.warnings[0]).toContain('incerta');
  });
});
