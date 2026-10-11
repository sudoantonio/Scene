import { describe, expect, it } from 'vitest';
import { applyAgentCommands } from './agent-commands';
import { evaluateProperty, evaluateTransform } from './animation';
import { createProject } from './schema';

const setup = () => {
  const project = createProject();
  const sceneId = project.cameraCuts[0].id;
  const next = applyAgentCommands(project, [{ type: 'add_element', sceneId, kind: 'cube', name: 'Soggetto' }]);
  return { project: next, sceneId, objectId: next.objects.find((item) => item.name === 'Soggetto')!.id };
};

const move = (project: ReturnType<typeof createProject>, spec: object) => applyAgentCommands(project, [{ type: 'motion', spec } as never]);

describe('movimenti MCP', () => {
  it('sposta un oggetto durante i frame intermedi e tiene la posa finale', () => {
    const { project, sceneId, objectId } = setup();
    const result = move(project, { motion: 'move_by', sceneId, elementId: objectId, startOffsetFrames: 0, delta: [2, 0, 0], space: 'world', durationSeconds: 1 });
    const object = result.objects.find((item) => item.id === objectId)!;
    expect(evaluateTransform(object, 1).position).toEqual([0, 0, 1]);
    expect(evaluateTransform(object, 13).position[0]).toBeCloseTo(1);
    expect(evaluateTransform(object, 25).position).toEqual([2, 0, 1]);
    expect(evaluateTransform(object, 35).position).toEqual([2, 0, 1]);
    expect(object.keyframes.find((key) => key.frame === 1 && key.property === 'position')?.interpolation).toBe('linear');
  });

  it('corregge un movimento per ID senza riscrivere altri keyframe', () => {
    const { project, sceneId, objectId } = setup();
    const first = move(project, { motion: 'move_by', sceneId, elementId: objectId, delta: [2, 0, 0], durationSeconds: 1 });
    const id = first.objects.find((item) => item.id === objectId)!.keyframes.find((key) => key.frame === 25 && key.property === 'position')!.directionActionId!;
    const corrected = move(first, { motion: 'move_by', sceneId, elementId: objectId, delta: [3, 0, 0], durationSeconds: .5, replaceMotionId: id });
    const object = corrected.objects.find((item) => item.id === objectId)!;
    expect(evaluateTransform(object, 7).position[0]).toBeCloseTo(1.5);
    expect(evaluateTransform(object, 13).position[0]).toBeCloseTo(3);
    expect(object.keyframes.some((key) => key.frame === 25 && key.property === 'position')).toBe(false);
    expect(object.keyframes.filter((key) => key.directionActionId === id)).toHaveLength(2);
  });

  it('usa destra e avanti della camera e non cambia la quota', () => {
    const { project, sceneId, objectId } = setup();
    const camera = project.objects.find((item) => item.kind === 'camera')!;
    camera.transform.position = [0, -5, 2];
    camera.transform.rotation = [90, 0, 0];
    const result = move(project, { motion: 'move_by', sceneId, elementId: objectId, delta: [1, 0, 0], space: 'camera', durationSeconds: .5 });
    expect(evaluateTransform(result.objects.find((item) => item.id === objectId)!, 13).position).toEqual([1, 0, 1]);
  });

  it('orbita con raggio costante e orienta la camera verso il soggetto', () => {
    const { project, sceneId, objectId } = setup();
    const camera = project.objects.find((item) => item.kind === 'camera')!;
    camera.transform.position = [2, 0, 1];
    const result = move(project, { motion: 'orbit', sceneId, elementId: camera.id, target: { elementId: objectId }, angleDegrees: 90, durationSeconds: 1 });
    const orbiting = result.objects.find((item) => item.id === camera.id)!;
    const subject = result.objects.find((item) => item.id === objectId)!;
    for (const frame of [1, 7, 13, 19, 25]) {
      const position = evaluateTransform(orbiting, frame).position;
      const target = evaluateTransform(subject, frame).position;
      expect(Math.hypot(position[0] - target[0], position[1] - target[1])).toBeCloseTo(2, 2);
    }
    expect(evaluateTransform(orbiting, 25).position[0]).toBeCloseTo(0, 4);
    expect(evaluateTransform(orbiting, 25).position[1]).toBeCloseTo(2, 4);
  });

  it('rifiuta movimenti fuori scena e keyframe intermedi in conflitto', () => {
    const { project, sceneId, objectId } = setup();
    expect(() => move(project, { motion: 'move_by', sceneId, elementId: objectId, delta: [1, 0, 0], durationSeconds: 10 })).toThrow(/beyond the scene/);
    const object = project.objects.find((item) => item.id === objectId)!;
    object.keyframes.push({ id: crypto.randomUUID(), frame: 10, property: 'position', value: [4, 0, 1], interpolation: 'linear', source: 'user', commentIds: [] });
    expect(() => move(project, { motion: 'move_by', sceneId, elementId: objectId, delta: [1, 0, 0], durationSeconds: 1 })).toThrow(/Keyframe position/);
  });

  it('interpola anche il comando animate con un solo keyframe finale', () => {
    const { project, sceneId, objectId } = setup();
    const result = applyAgentCommands(project, [{ type: 'animate', sceneId, elementId: objectId, property: 'position', keys: [{ offsetFrames: 24, value: [2, 0, 1], interpolation: 'linear' }] }]);
    expect((evaluateProperty(result.objects.find((item) => item.id === objectId)!, 'position', 13) as number[])[0]).toBeCloseTo(1);
  });

  it('usa il ritmo della battuta, mostra la durata e avvisa quando quella esplicita è lenta', () => {
    const { project, sceneId, objectId } = setup();
    const planned = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'Entra in scena', beats: [{ sceneId, startOffsetFrames: 0, durationFrames: 60, dialogue: '', intention: 'Ingresso rapido', visualAction: 'Il soggetto entra', pace: 'quick', surface: 'none' }] }]);
    const beatId = planned.storyboard!.beats[0].id;
    const quick = move(planned, { motion: 'move_by', sceneId, elementId: objectId, beatId, delta: [2, 0, 0] });
    expect(quick.agentMotions?.[0].pace).toBe('quick');
    expect(quick.agentMotions?.[0].endFrame).toBe(13);
    const slow = move(planned, { motion: 'move_by', sceneId, elementId: objectId, beatId, delta: [2, 0, 0], durationSeconds: 1.5 });
    expect(slow.agentMotions?.[0].warnings.join(' ')).toMatch(/slower/);
    expect(() => move(planned, { motion: 'move_by', sceneId, elementId: objectId, beatId, delta: [2, 0, 0], durationSeconds: 3 })).toThrow(/beyond the beat/);
  });
});
