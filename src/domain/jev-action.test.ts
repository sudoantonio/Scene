import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProject, createSceneObject } from './schema';
import { applyPlan, evaluateTransform } from './animation';
import { compileJevAction, jevActionRequest, type JevActionResponse } from './jev-action';
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
    expect(request.questions.action.type).toBe('choice');
    expect(request.questions.translate_x.criteria).toHaveProperty('hold');
    expect(request.questions.rotate_z.criteria).toHaveProperty('increase');
  });

  it('sends a compact description of the stroke to Jev', () => {
    const project = createProject();
    const character = createSceneObject('sphere', 1);
    project.objects.push(character);
    const request = jevActionRequest(project, character, { objectId: character.id, sceneId: project.cameraCuts[0].id, frame: 1, startPosition: [0, 0, 1], instruction: 'segui il tratto', gesture: { target: 'auto', points: [[.1, .6], [.5, .2], [.9, .6]] } });
    expect(request.state.drawn_stroke).toMatchObject({ start: [.1, .6], end: [.9, .6] });
    expect(request.state.drawn_stroke!.curvature_ratio).toBeGreaterThan(1);
    expect(request.questions.stroke_target.type).toBe('choice');
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
    expect(result.blenderPlan.operations[1].value.vector).toEqual([1, 4, 0]);
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
