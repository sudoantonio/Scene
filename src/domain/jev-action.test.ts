import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProject, createSceneObject } from './schema';
import { applyPlan, evaluateTransform, validatePlan } from './animation';
import { compileJevAction, composeParallelJevPlans, jevActionRequest, jevMotionFamilyRequest, jevTemporalRequest, mergeJevSequencePlans, resolveMotionFamily, resolveTemporalStructure, splitJevInstruction, splitMotionTimeline, type JevActionResponse } from './jev-action';
import { useEditor } from '../store/editor';

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
  it('splits opposite directions into ordered actions instead of cancelling them', () => {
    expect(splitJevInstruction('il personaggio si gira a destra e sinistra')).toEqual([
      'il personaggio si gira a destra',
      'il personaggio si gira a sinistra',
    ]);
    expect(splitJevInstruction('avanza, poi salta e gira a sinistra')).toEqual(['avanza', 'salta', 'gira a sinistra']);
    expect(splitJevInstruction('gira a destra e poi a sinistra')).toEqual(['gira a destra', 'gira a sinistra']);
    expect(splitJevInstruction('la camera si avvicina e poi si allontana dal personaggio')).toEqual([
      'la camera si avvicina',
      'si allontana dal personaggio',
    ]);
    expect(splitJevInstruction('si sposta in alto a destra')).toEqual(['si sposta in alto a destra']);
  });

  it('builds sequential and simultaneous timeline groups from one natural sentence', () => {
    const instruction = 'avanza mentre guarda a sinistra, poi salta';
    expect(resolveTemporalStructure(instruction, 'single')).toBe('mixed');
    expect(splitMotionTimeline(instruction, 'mixed')).toEqual([
      { instructions: ['avanza', 'guarda a sinistra'] },
      { instructions: ['salta'] },
    ]);
    expect(resolveTemporalStructure('avanza e gira a destra', 'simultaneous')).toBe('simultaneous');
    expect(splitMotionTimeline('avanza e gira a destra', 'simultaneous')).toEqual([{ instructions: ['avanza', 'gira a destra'] }]);
    expect(splitMotionTimeline('la camera si avvicina e poi si allontana dal personaggio', 'sequential')).toEqual([
      { instructions: ['la camera si avvicina'] },
      { instructions: ['si allontana dal personaggio'] },
    ]);
  });

  it('merges consecutive rotations without duplicate boundary keyframes', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const sceneId = project.cameraCuts[0].id;
    const right = compileJevAction(project, character, { objectId: character.id, sceneId, frame: 1, startPosition: character.transform.position, instruction: 'gira a destra' }, response({
      action: { type: 'choice', choice: 'turn', confidence: .95, probabilities: { turn: .95 } },
      rotate_z: { type: 'choice', choice: 'increase', confidence: .95, probabilities: { increase: .95 } },
    }));
    const afterRight = applyPlan(project, right.blenderPlan);
    const middleFrame = Math.max(...right.blenderPlan.operations.map((operation) => operation.frame));
    const updatedCharacter = afterRight.objects.find((candidate) => candidate.id === character.id)!;
    const left = compileJevAction(afterRight, updatedCharacter, { objectId: character.id, sceneId, frame: middleFrame, startPosition: evaluateTransform(updatedCharacter, middleFrame).position, instruction: 'gira a sinistra' }, response({
      action: { type: 'choice', choice: 'turn', confidence: .95, probabilities: { turn: .95 } },
      rotate_z: { type: 'choice', choice: 'decrease', confidence: .95, probabilities: { decrease: .95 } },
    }));
    const merged = mergeJevSequencePlans([right, left], 'gira a destra e sinistra');
    const rotations = merged.blenderPlan.operations.filter((operation) => operation.property === 'rotation');
    expect(rotations.map((operation) => operation.frame)).toEqual([1, middleFrame, Math.max(...left.blenderPlan.operations.map((operation) => operation.frame))]);
    expect(rotations.map((operation) => operation.value.vector![2])).toEqual([0, 90, 0]);
    expect(merged.decision.sequence?.map((step) => step.motion)).toEqual(['turn_right', 'turn_left']);
    expect(merged.decision.sequence?.map((step) => step.relation)).toEqual(['then', 'then']);
    expect(validatePlan(project, merged.blenderPlan)).toEqual([]);
  });

  it('adds simultaneous movement deltas instead of overwriting one action', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const input = { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1] as [number, number, number] };
    const forward = compileJevAction(project, character, { ...input, instruction: 'avanza' }, response());
    const rise = compileJevAction(project, character, { ...input, instruction: 'sale' }, response());
    forward.decision.relation = 'then';
    rise.decision.relation = 'with';
    const composed = composeParallelJevPlans(project, [forward, rise], 'avanza mentre sale');
    const applied = applyPlan(project, composed.blenderPlan);
    const endFrame = Math.max(...composed.blenderPlan.operations.map((operation) => operation.frame));
    const end = evaluateTransform(applied.objects.find((object) => object.id === character.id)!, endFrame).position;
    expect(end).toEqual([0, 2, 3]);
    expect(composed.decision.sequence?.map((step) => step.relation)).toEqual(['then', 'with']);
    expect(validatePlan(project, composed.blenderPlan)).toEqual([]);
  });
  it('sends the selected character and the coordinate convention as state', () => {
    const project = createProject();
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    project.objects[0].transform.rotation = [90, 0, 0];
    const request = jevActionRequest(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [1, 2, 3], instruction: 'corre a destra' });
    expect(request.model).toBe('jev-latest');
    expect(request.state.start_position_meters).toEqual({ x: 1, y: 2, z: 3 });
    expect(request.state.active_camera?.rotation_degrees).toEqual([90, 0, 0]);
    expect(request.state.scene_context.objects).toEqual(expect.arrayContaining([expect.objectContaining({ id: character.id, name: character.name, transform: expect.objectContaining({ position: character.transform.position }) })]));
    expect(request.state.scene_context.active_scene).toMatchObject({ id: project.cameraCuts[0].id, framing: project.cameraCuts[0].framing });
    expect(request.questions.motion.type).toBe('choice');
    expect(request.state.natural_language_hints.motion).toBe('move_right');
    expect(request.questions).not.toHaveProperty('action');
    expect(request.questions).not.toHaveProperty('direction');
    expect(request.questions.translate_x).toMatchObject({ type: 'choice' });
    expect(request.questions.translate_y).toMatchObject({ type: 'choice' });
    expect(request.questions.translate_z).toMatchObject({ type: 'choice' });
    expect(request.questions.rotate_x).toMatchObject({ type: 'choice' });
    expect(request.questions.rotate_y).toMatchObject({ type: 'choice' });
    expect(request.questions.rotate_z).toMatchObject({ type: 'choice' });
    expect(request.questions.coordinate_space).toMatchObject({ type: 'choice' });
  });

  it('compiles one model-selected semantic primitive into deterministic geometry', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, {
      objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1,
      startPosition: [0, 0, 1], instruction: 'esegui il movimento concordato',
    }, response({ motion: { type: 'choice', choice: 'move_forward_right', confidence: .96, probabilities: { move_forward_right: .96 } } }));
    expect(result.decision.motion).toBe('move_forward_right');
    const end = result.blenderPlan.operations.at(-1)!.value.vector!;
    expect(end[0]).toBeCloseTo(Math.SQRT2);
    expect(end[1]).toBeCloseTo(Math.SQRT2);
    expect(end[2]).toBe(1);
  });

  it('offers camera primitives only when the selected target is a camera', () => {
    const project = createProject();
    const camera = project.objects[0];
    const request = jevActionRequest(project, undefined, { objectId: camera.id, target: 'camera', sceneId: project.cameraCuts[0].id, frame: 1, startPosition: null, instruction: 'orbita verso destra' });
    expect(request.questions.motion.criteria).toHaveProperty('orbit_right');
    expect(request.questions.motion.criteria).not.toHaveProperty('jump_forward');
    expect(request.state.natural_language_hints.motion).toBe('orbit_right');
  });

  it('routes through temporal structure and a small motion family before choosing a primitive', () => {
    const project = createProject();
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const input = { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: character.transform.position, instruction: 'esegui il gesto concordato' };
    const temporal = jevTemporalRequest(project, character, input);
    const family = jevMotionFamilyRequest(project, character, input);
    const precise = jevActionRequest(project, character, input, resolveMotionFamily(input, 'orientation'));
    expect(Object.keys(temporal.questions)).toEqual(['temporal_structure']);
    expect(Object.keys(family.questions)).toEqual(['motion_family']);
    expect(Object.keys(precise.questions.motion.criteria)).toEqual(['turn_left', 'turn_right', 'look_up', 'look_down', 'roll_left', 'roll_right', 'look_at_object']);
    expect(Object.keys(precise.questions.motion.criteria).length).toBeLessThan(10);
  });

  it('grounds a relational movement to an object that exists in the active scene', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    character.name = 'Personaggio';
    character.transform.position = [0, 0, 1];
    const table = createSceneObject('cube', 2);
    table.name = 'Tavolo';
    table.transform.position = [4, 0, 1];
    project.objects.push(character, table);
    const input = { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: character.transform.position, instruction: 'vai verso il Tavolo' };
    const request = jevActionRequest(project, character, input, 'locomotion');
    expect(request.questions.reference_object.criteria).toHaveProperty(table.id);
    const result = compileJevAction(project, character, input, response({
      motion: { type: 'choice', choice: 'move_toward_object', confidence: .96, probabilities: { move_toward_object: .96 } },
      reference_object: { type: 'choice', choice: table.id, confidence: .98, probabilities: { [table.id]: .98 } },
    }));
    expect(result.decision.reference).toEqual({ objectId: table.id, name: 'Tavolo' });
    expect(result.blenderPlan.operations.at(-1)?.value.vector).toEqual([2, 0, 1]);
  });

  it('orients the selected subject toward a named scene object', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    character.name = 'Personaggio';
    character.transform.position = [0, 0, 1];
    const table = createSceneObject('cube', 2);
    table.name = 'Tavolo';
    table.transform.position = [4, 0, 1];
    project.objects.push(character, table);
    const input = { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: character.transform.position, instruction: 'mantieni il Tavolo in vista' };
    const result = compileJevAction(project, character, input, response({
      motion: { type: 'choice', choice: 'look_at_object', confidence: .96, probabilities: { look_at_object: .96 } },
      reference_object: { type: 'choice', choice: table.id, confidence: .98, probabilities: { [table.id]: .98 } },
    }));
    expect(result.decision.reference).toEqual({ objectId: table.id, name: 'Tavolo' });
    expect(result.blenderPlan.operations.at(-1)?.property).toBe('rotation');
    expect(result.blenderPlan.operations.at(-1)?.value.vector).toEqual([0, 0, 90]);
  });

  it('sends a compact description of the stroke to Jev', () => {
    const project = createProject();
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const request = jevActionRequest(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'segui il tratto', gesture: { target: 'auto', points: [[.1, .6], [.5, .2], [.9, .6]] } });
    expect(request.state.drawn_stroke).toMatchObject({ start: [.1, .6], end: [.9, .6] });
    expect(request.state.drawn_stroke!.curvature_ratio).toBeGreaterThan(1);
    expect(request.questions.motion.type).toBe('choice');
    expect(request.state.natural_language_hints.motion).toBe('follow_drawn_path');
  });

  it('labels the compiled plan with the selected Laya engine', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { engine: 'laya', objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 0], instruction: 'vai a destra' }, { ...response(), model: 'laya-multilingual' });
    expect(result.blenderPlan.summary).toContain('Laya');
    expect(result.blenderPlan.operations.some((operation) => operation.rationale.includes('Laya'))).toBe(true);
  });

  it('uses natural-language intent when Laya returns hold and low axis scores', () => {
    const project = createProject();
    project.settings.frameEnd = 120;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const layaHold = response({
      actionable: { type: 'noul', noul: .05 },
      action: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      direction: { type: 'choice', choice: 'forward', confidence: .2, probabilities: { forward: .2 } },
      translate_x: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      translate_y: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      translate_z: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      rotate_x: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      rotate_y: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      rotate_z: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
    });
    const turn = compileJevAction(project, character, { engine: 'laya', objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: character.transform.position, instruction: 'si volta verso destra' }, layaHold);
    expect(turn.status).toBe('ready');
    expect(turn.decision).toMatchObject({ action: 'turn', direction: 'right' });
    expect(turn.blenderPlan.operations.filter((operation) => operation.property === 'rotation')).toHaveLength(2);
    const walk = compileJevAction(project, character, { engine: 'laya', objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: character.transform.position, instruction: 'cammina con calma' }, layaHold);
    expect(walk.decision).toMatchObject({ action: 'move', direction: 'forward' });
    expect(walk.blenderPlan.operations.filter((operation) => operation.property === 'position')).toHaveLength(2);
    const rotate = compileJevAction(project, character, { engine: 'laya', objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: character.transform.position, instruction: 'ruota su se stesso di 180 gradi' }, layaHold);
    expect(rotate.decision).toMatchObject({ action: 'turn', direction: 'right' });
    expect(rotate.blenderPlan.operations.at(-1)?.value.vector?.[2]).toBe(180);
  });

  it('compiles a typed move decision into position keyframes', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    project.objects[0].transform.rotation = [90, 0, 0];
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 10, startPosition: [1, 2, 0], instruction: 'vai a destra con decisione' }, response());
    expect(result.status).toBe('ready');
    expect(result.decision).toMatchObject({ action: 'move', direction: 'right', distanceMeters: 2, durationSeconds: 1, path: 'smooth' });
    expect(result.blenderPlan.operations).toHaveLength(2);
    expect(result.blenderPlan.operations[1].value.vector).toEqual([3, 2, 0]);
    expect(result.blenderPlan.operations[1].frame).toBe(34);
  });

  it('interprets right relative to the active camera', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.rotation = [60, 0, 90];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [1, 2, 0], instruction: 'vai a destra' }, response());
    const end = result.blenderPlan.operations[1].value.vector!;
    expect(end[0]).toBeCloseTo(1);
    expect(end[1]).toBeCloseTo(4);
  });

  it.each([
    ['allontana dalla camera', 'away_camera', 4],
    ['si avvicina alla camera', 'toward_camera', 0],
  ])('honours the explicit camera direction in “%s”', (instruction, expectedDirection, expectedX) => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.position = [0, 0, 5];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [2, 0, 0], instruction }, response({
      direction: { type: 'choice', choice: expectedDirection === 'away_camera' ? 'backward' : 'forward', confidence: .9, probabilities: {} },
    }));
    expect(result.decision.direction).toBe(expectedDirection);
    expect(result.blenderPlan.operations[1].value.vector).toEqual([expectedX, 0, 0]);
  });

  it('animates only the selected subject even when the text also mentions the camera', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.position = [0, -5, 2];
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'il personaggio va a destra mentre la camera avanza lentamente' }, response({
      camera_requested: { type: 'noul', noul: .98 },
      camera_action: { type: 'choice', choice: 'push_in', confidence: .94, probabilities: { push_in: .94 } },
      camera_distance: { type: 'score', score: 3, confidence: .9, probabilities: { '3': .9 } },
      camera_duration: { type: 'score', score: 3, confidence: .91, probabilities: { '3': .91 } },
      camera_path: { type: 'choice', choice: 'smooth', confidence: .95, probabilities: { smooth: .95 } },
    }));
    expect(result.decision.camera).toMatchObject({ requested: false });
    expect(result.blenderPlan.operations.filter((operation) => operation.objectId === character.id)).toHaveLength(2);
    const cameraOperations = result.blenderPlan.operations.filter((operation) => operation.objectId === project.objects[0].id);
    expect(cameraOperations).toHaveLength(0);
  });

  it('combines independent axes and respects exact metres, seconds and degrees', () => {
    const project = createProject();
    project.settings.frameEnd = 200;
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, {
      objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1],
      instruction: 'avanza e va a destra di 3 metri mentre gira a destra di 90 gradi in 2 secondi',
    }, response({
      translate_x: { type: 'choice', choice: 'increase', confidence: .96, probabilities: { increase: .96 } },
      translate_y: { type: 'choice', choice: 'increase', confidence: .96, probabilities: { increase: .96 } },
      translate_z: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      rotate_x: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      rotate_y: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      rotate_z: { type: 'choice', choice: 'increase', confidence: .96, probabilities: { increase: .96 } },
    }));
    const endPosition = result.blenderPlan.operations.find((operation) => operation.property === 'position' && operation.frame === 49)!.value.vector!;
    const endRotation = result.blenderPlan.operations.find((operation) => operation.property === 'rotation' && operation.frame === 49)!.value.vector!;
    expect(endPosition[0]).toBeCloseTo(3 / Math.sqrt(2));
    expect(endPosition[1]).toBeCloseTo(3 / Math.sqrt(2));
    expect(endPosition[2]).toBe(1);
    expect(endRotation).toEqual([0, 0, 90]);
    expect(result.decision.motionSpec).toMatchObject({
      version: 1,
      translation: [1, 1, 0],
      rotation: [0, 0, 1],
      distanceMeters: 3,
      rotationDegrees: 90,
      durationSeconds: 2,
    });
  });

  it('composes camera translation and rotation in the same interval', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const camera = project.objects[0]!;
    camera.transform.position = [0, -8, 2];
    camera.transform.rotation = [90, 0, 0];
    const result = compileJevAction(project, undefined, {
      objectId: camera.id, target: 'camera', sceneId: project.cameraCuts[0]!.id, frame: 1, startPosition: null,
      instruction: 'sale di 2 metri mentre ruota a destra di 45 gradi',
    }, response({
      motion: { type: 'choice', choice: 'pedestal_up', confidence: .96, probabilities: { pedestal_up: .96 } },
      translate_x: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      translate_y: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      translate_z: { type: 'choice', choice: 'increase', confidence: .96, probabilities: { increase: .96 } },
      rotate_x: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      rotate_y: { type: 'choice', choice: 'hold', confidence: .96, probabilities: { hold: .96 } },
      rotate_z: { type: 'choice', choice: 'increase', confidence: .96, probabilities: { increase: .96 } },
    }));
    const position = [...result.blenderPlan.operations].reverse().find((operation) => operation.property === 'position')?.value.vector;
    const rotation = [...result.blenderPlan.operations].reverse().find((operation) => operation.property === 'rotation')?.value.vector;
    expect(position).toEqual([0, -8, 4]);
    expect(rotation).toEqual([90, 0, 45]);
    expect(result.decision.motionSpec).toMatchObject({ translation: [0, 0, 1], rotation: [0, 0, 1] });
  });

  it('keeps jump intent and reconstructs the drawn arc on a world-vertical plane', () => {
    const project = createProject(); project.settings.frameEnd = 100;
    const subject = createSceneObject('cube', 1); project.objects.push(subject);
    const view = new THREE.PerspectiveCamera(45, 16 / 9, .01, 1000);
    view.position.set(0, -8, 1 + 8 / Math.sqrt(3));
    view.rotation.set(Math.PI / 3, 0, 0); view.updateMatrixWorld(true);
    const intended: [number, number, number][] = [[0, 0, 1], [.5, 0, 3], [1, 0, 1]];
    const points = intended.map((point) => { const p = new THREE.Vector3(...point).project(view); return [(p.x + 1) / 2, (1 - p.y) / 2] as [number, number]; });
    const input = { objectId: subject.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: intended[0], instruction: 'il cubo salta', gesture: { target: 'subject' as const, points, viewMode: 'free' as const, viewRotation: [60, 0, 0] as [number, number, number], viewPosition: view.position.toArray() as [number, number, number], verticalFovDegrees: 45, aspect: 16 / 9 } };
    expect(resolveMotionFamily(input, 'path')).toBe('vertical');
    const plan = compileJevAction(project, subject, input, response({ motion: { type: 'choice', choice: 'follow_drawn_path', confidence: .9, probabilities: { follow_drawn_path: .9 } } }));
    expect(plan.decision.action).toBe('jump');
    const actual = plan.blenderPlan.operations.filter((op) => op.property === 'position');
    expect(actual).toHaveLength(3);
    actual.forEach((op, i) => op.value.vector!.forEach((value, axis) => expect(value).toBeCloseTo(intended[i][axis], 5)));
  });

  it('uses world height for a drawn jump even from a top view without projection data', () => {
    const project = createProject(); project.settings.frameEnd = 100;
    const subject = createSceneObject('cube', 1); project.objects.push(subject);
    const result = compileJevAction(project, subject, { objectId: subject.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'il cubo salta', gesture: { target: 'subject', viewRotation: [0, 0, 0], points: [[.5, .7], [.5, .2], [.5, .7]] } }, response());
    const points = result.blenderPlan.operations.filter((op) => op.property === 'position').map((op) => op.value.vector!);
    expect(points[1][2]).toBeGreaterThan(1);
    expect(points.every((point) => point[0] === 0 && point[1] === 0)).toBe(true);
    expect(points.at(-1)![2]).toBe(1);
  });

  it('turns a curved canvas stroke into intermediate subject keyframes', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'corre seguendo la curva', gesture: { target: 'subject', points: [[.2, .5], [.5, .2], [.8, .5]] } }, response());
    const positions = result.blenderPlan.operations.map((operation) => operation.value.vector!);
    expect(result.decision.gesture).toEqual({ target: 'subject', points: 3 });
    expect(positions).toHaveLength(3);
    expect(positions[1][1]).toBeGreaterThan(0);
    expect(positions[2][0]).toBeCloseTo(2);
  });

  it('interprets a stroke from the orientation of the free view', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'corre seguendo il tratto', gesture: { target: 'subject', viewMode: 'free', viewRotation: [60, 0, 90], points: [[.2, .5], [.8, .5]] } }, response());
    const end = result.blenderPlan.operations.at(-1)!.value.vector!;
    expect(end[0]).toBeCloseTo(0);
    expect(end[1]).toBeCloseTo(2);
    expect(result.blenderPlan.operations).toHaveLength(2);
  });

  it('projects a free-view stroke exactly onto the subject ground plane', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const subject = createSceneObject('cube', 1);
    subject.transform.position = [1, 2, 1];
    project.objects.push(subject);
    const view = new THREE.PerspectiveCamera(45, 16 / 9, .01, 1000);
    view.position.set(8, -10, 8);
    view.up.set(0, 0, 1);
    view.lookAt(1, 2, 1);
    view.updateMatrixWorld(true);
    const intended: [number, number, number][] = [[1, 2, 1], [3, 3, 1], [2, 6, 1]];
    const points = intended.map((point) => {
      const projected = new THREE.Vector3(...point).project(view);
      return [(projected.x + 1) / 2, (1 - projected.y) / 2] as [number, number];
    });
    const rotation = [view.rotation.x, view.rotation.y, view.rotation.z].map(THREE.MathUtils.radToDeg) as [number, number, number];
    const result = compileJevAction(project, subject, {
      objectId: subject.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: intended[0], instruction: 'segue il tratto',
      gesture: { target: 'subject', viewMode: 'free', viewRotation: rotation, viewPosition: view.position.toArray() as [number, number, number], verticalFovDegrees: 45, aspect: 16 / 9, points },
    }, response());
    const actual = result.blenderPlan.operations.filter((operation) => operation.property === 'position');
    expect(actual).toHaveLength(3);
    actual.forEach((operation, index) => operation.value.vector!.forEach((value, axis) => expect(value).toBeCloseTo(intended[index]![axis], 5)));
  });

  it('uses the visible stroke length to determine the movement scale', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const start: [number, number, number] = [0, 0, 1];
    const result = compileJevAction(project, character, {
      objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: start,
      instruction: 'segui la freccia',
      gesture: { target: 'subject', viewMode: 'free', viewRotation: [60, 0, 90], viewPosition: [0, -10, 5], verticalFovDegrees: 45, aspect: 16 / 9, points: [[.1, .5], [.9, .5]] },
    }, response({ distance: { type: 'score', score: 0, confidence: .9, probabilities: { '0': .9 } } }));
    const end = result.blenderPlan.operations.at(-1)!.value.vector!;
    expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])).toBeGreaterThan(10);
  });

  it('keeps the direction changes of a dense S-shaped stroke with a limited number of points', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const points = Array.from({ length: 80 }, (_, index) => {
      const progress = index / 79;
      return [.5 + Math.sin(progress * Math.PI * 2) * .35, .1 + progress * .8] as [number, number];
    });
    const result = compileJevAction(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'segue il tratto', gesture: { target: 'subject', points } }, response());
    const positions = result.blenderPlan.operations.map((operation) => operation.value.vector!);
    expect(positions.length).toBeGreaterThan(4);
    expect(positions.length).toBeLessThanOrEqual(12);
    expect(Math.max(...positions.map((position) => position[0]))).toBeGreaterThan(.5);
    expect(Math.min(...positions.map((position) => position[0]))).toBeLessThan(-.5);
  });

  it('replaces previous Jev points instead of accumulating them', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    project.objects[0].transform.rotation = [90, 0, 0];
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const input = { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1] as [number, number, number], instruction: 'segue il tratto', gesture: { target: 'subject' as const, points: Array.from({ length: 80 }, (_, index) => [index / 100, .5] as [number, number]) } };
    const first = compileJevAction(project, character, input, response());
    useEditor.setState({ project, past: [], future: [] });
    useEditor.getState().acceptJevPlan(first.blenderPlan, input.sceneId);
    const second = compileJevAction(project, character, { ...input, gesture: { target: 'subject', points: [[.2, .5], [.8, .5]] } }, response());
    useEditor.getState().acceptJevPlan(second.blenderPlan, input.sceneId);
    const applied = useEditor.getState().project.objects.find((object) => object.id === character.id)!;
    expect(applied.keyframes.filter((key) => key.property === 'position' && key.source === 'ai')).toHaveLength(2);
  });

  it('directs the selected camera without requiring a selected subject', () => {
    const project = createProject();
    const camera = project.objects[0];
    const result = compileJevAction(project, undefined, { objectId: camera.id, target: 'camera', sceneId: project.cameraCuts[0].id, frame: 1, startPosition: null, instruction: 'la camera arretra lentamente' }, response({
      camera_requested: { type: 'noul', noul: .98 },
      camera_action: { type: 'choice', choice: 'pull_out', confidence: .94, probabilities: { pull_out: .94 } },
      camera_distance: { type: 'score', score: 2, confidence: .9, probabilities: { '2': .9 } },
      camera_duration: { type: 'score', score: 3, confidence: .91, probabilities: { '3': .91 } },
      camera_path: { type: 'choice', choice: 'smooth', confidence: .95, probabilities: { smooth: .95 } },
    }));
    expect(result.objectId).toBeNull();
    expect(result.decision.camera?.action).toBe('pull_out');
    expect(result.blenderPlan.operations).toHaveLength(2);
  });

  it('treats the selected camera as the only target even when the text does not name it', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const camera = project.objects[0];
    const input = { objectId: camera.id, target: 'camera' as const, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: null, instruction: 'avanza lentamente' };
    const request = jevActionRequest(project, undefined, input);
    expect(request.state.selected_target).toMatchObject({ id: camera.id, role: 'camera' });
    const result = compileJevAction(project, undefined, input, response({
      camera_requested: { type: 'noul', noul: 0 },
      camera_action: { type: 'choice', choice: 'hold', confidence: .94, probabilities: { hold: .94 } },
      camera_distance: { type: 'score', score: 2, confidence: .9, probabilities: { '2': .9 } },
      camera_duration: { type: 'score', score: 3, confidence: .91, probabilities: { '3': .91 } },
      camera_path: { type: 'choice', choice: 'smooth', confidence: .95, probabilities: { smooth: .95 } },
    }));
    expect(result.decision.camera).toMatchObject({ requested: true, action: 'push_in' });
    expect(result.blenderPlan.operations.every((operation) => operation.objectId === camera.id)).toBe(true);
  });

  it('turns a closed drawn orbit into a full circle at the real camera-target radius', () => {
    const project = createProject();
    project.settings.frameEnd = 160;
    const camera = project.objects[0];
    camera.transform.position = [0, -10, 5];
    project.cameraCuts[0].framing.target = [-20, -20, 1];
    const character = createSceneObject('blend_asset', 1);
    character.name = 'Personaggio Fluido';
    character.transform.position = [2, 3, 2];
    project.objects.push(character);
    const points = Array.from({ length: 25 }, (_, index) => {
      const angle = Math.PI * 2 * index / 24;
      return [.5 + Math.cos(angle) * .35, .5 + Math.sin(angle) * .3] as [number, number];
    });
    const input = {
      objectId: camera.id, target: 'camera', sceneId: project.cameraCuts[0].id, frame: 1, startPosition: null,
      instruction: 'gira intorno al personaggio', gesture: { target: 'camera', points },
    } as const;
    const request = jevActionRequest(project, undefined, input);
    expect(request.state.camera_focus_target).toMatchObject({ id: character.id, name: character.name, position: character.transform.position });
    const result = compileJevAction(project, undefined, input, response({
      camera_requested: { type: 'noul', noul: .99 },
      camera_action: { type: 'choice', choice: 'hold', confidence: .9, probabilities: { hold: .9 } },
      camera_distance: { type: 'score', score: 1, confidence: .9, probabilities: { '1': .9 } },
      camera_duration: { type: 'score', score: 4, confidence: .91, probabilities: { '4': .91 } },
      camera_path: { type: 'choice', choice: 'smooth', confidence: .95, probabilities: { smooth: .95 } },
    }));
    const positions = result.blenderPlan.operations.filter((operation) => operation.property === 'position').map((operation) => operation.value.vector!);
    const rotationOperations = result.blenderPlan.operations.filter((operation) => operation.property === 'rotation');
    const initialRadius = Math.hypot(positions[0][0] - 2, positions[0][1] - 3, positions[0][2] - 2);
    expect(result.decision.camera?.action).toBe('orbit_right');
    expect(positions).toHaveLength(9);
    positions.forEach((position) => expect(Math.hypot(position[0] - 2, position[1] - 3, position[2] - 2)).toBeCloseTo(initialRadius));
    positions.forEach((position) => expect(position[2]).toBeCloseTo(positions[0][2]));
    positions[0].forEach((value, axis) => expect(positions.at(-1)![axis]).toBeCloseTo(value, 5));
    expect(Math.max(...positions.map((position) => position[0])) - Math.min(...positions.map((position) => position[0]))).toBeGreaterThan(8);
    const applied = applyPlan(project, result.blenderPlan);
    const appliedCamera = applied.objects.find((object) => object.id === camera.id)!;
    rotationOperations.forEach((operation) => {
      const rotation = operation.value.vector!;
      const position = evaluateTransform(appliedCamera, operation.frame).position;
      const view = new THREE.PerspectiveCamera();
      view.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
      const towardCharacter = new THREE.Vector3(...evaluateTransform(character, operation.frame).position).sub(new THREE.Vector3(...position)).normalize();
      expect(view.getWorldDirection(new THREE.Vector3()).dot(towardCharacter)).toBeGreaterThan(.999);
    });
  });

  it('keeps a drawn camera move level unless vertical movement is requested', () => {
    const project = createProject();
    project.settings.frameEnd = 100;
    const camera = project.objects[0];
    const result = compileJevAction(project, undefined, {
      objectId: camera.id, target: 'camera', sceneId: project.cameraCuts[0].id, frame: 1, startPosition: null,
      instruction: 'sposta la camera seguendo il tratto', gesture: { target: 'camera', viewMode: 'free', viewRotation: [52, 0, 30], points: [[.1, .8], [.5, .2], [.9, .7]] },
    }, response({
      camera_requested: { type: 'noul', noul: .99 },
      camera_action: { type: 'choice', choice: 'truck_right', confidence: .94, probabilities: { truck_right: .94 } },
      camera_distance: { type: 'score', score: 2, confidence: .9, probabilities: { '2': .9 } },
      camera_duration: { type: 'score', score: 3, confidence: .91, probabilities: { '3': .91 } },
      camera_path: { type: 'choice', choice: 'smooth', confidence: .95, probabilities: { smooth: .95 } },
    }));
    const positions = result.blenderPlan.operations.filter((operation) => operation.property === 'position').map((operation) => operation.value.vector!);
    expect(positions).toHaveLength(3);
    positions.forEach((position) => expect(position[2]).toBeCloseTo(positions[0][2]));
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
