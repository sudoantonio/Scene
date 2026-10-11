import { describe, expect, it } from 'vitest';
import { evaluateProperty, evaluateTransform, evaluateRenderProperty, evaluateRenderTransform, renderAnimationFrame } from './animation';
import { createSceneObject, type AnimProperty, type Keyframe } from './schema';
import { createPerformanceFixture } from './performance-fixture';
import { useEditor } from '../store/editor';

describe('render evaluation and immutable editor snapshots', () => {
  it('matches editing evaluation across curves, keys, holds and duplicate frames', () => {
    const object = createSceneObject('cube', 1);
    const key = (property: AnimProperty, frame: number, value: Keyframe['value'], extras: Partial<Keyframe> = {}): Keyframe => ({ id: crypto.randomUUID(), property, frame, value, interpolation: 'bezier', purpose: 'motion', source: 'user', commentIds: [], ...extras });
    object.keyframes = [key('position', 50, [2, 1, 2]), key('position', 1, [0, 0, 0], { holdFrames: 5, positionPath: [[0, 0, 0], [0, 1, 0], [1, 1, 1]] }), key('position', 20, [1, 1, 1]), key('rotation', 1, [0, 0, 0]), key('rotation', 50, [0, 0, 90]), key('visibility', 7, false), key('visibility', 7, true), key('text', 10, 'Hello'), key('scale', 1, [1, 1, 1]), key('scale', 30, [2, 2, 2])];
    for (const frame of [0, 1, 5, 6, 6.5, 7, 10, 15, 19, 20, 25, 30, 49, 50, 100]) {
      expect(evaluateRenderTransform(object, frame)).toEqual(evaluateTransform(object, frame));
      for (const property of ['visibility', 'text', 'lens'] as const) expect(evaluateRenderProperty(object, property, frame)).toEqual(evaluateProperty(object, property, frame));
    }
  });
  it('preserves the exact drawn surface at every sample of a 10,000 point path', () => {
    const actor = createPerformanceFixture(1).objects[1];
    for (let frame = 1; frame < 12000; frame += 71) expect(evaluateRenderTransform(actor, frame).position).toEqual(evaluateTransform(actor, frame).position);
    expect(evaluateRenderTransform(actor, 50)).toBe(evaluateRenderTransform(actor, 50));
    const edited = structuredClone(actor); edited.keyframes.at(-1)!.value = [9, 3, 2];
    expect(evaluateRenderTransform(edited, 50)).toEqual(evaluateTransform(edited, 50));
  });
  it('skips static frames but refreshes at boundaries and after holds', () => {
    const object = createSceneObject('cube', 1);
    object.keyframes = [{ id: crypto.randomUUID(), frame: 10, property: 'position', value: [1, 2, 3], interpolation: 'constant', source: 'user', commentIds: [] }, { id: crypto.randomUUID(), frame: 30, property: 'position', value: [4, 2, 3], interpolation: 'linear', holdFrames: 5, source: 'user', commentIds: [] }, { id: crypto.randomUUID(), frame: 50, property: 'position', value: [7, 2, 3], interpolation: 'constant', source: 'user', commentIds: [] }];
    expect(renderAnimationFrame(object, 9)).toBe(0); expect(renderAnimationFrame(object, 29)).toBe(10);
    expect(renderAnimationFrame(object, 35)).toBe(30); expect(renderAnimationFrame(object, 36)).toBe(36); expect(renderAnimationFrame(object, 100)).toBe(50);
    for (let frame = 1; frame <= 100; frame++) expect(evaluateRenderTransform(object, renderAnimationFrame(object, frame))).toEqual(evaluateTransform(object, frame));
  });
  it('updates rendered data after editing, undo, redo and reopening', () => {
    useEditor.getState().newProject(); useEditor.getState().addObject('cube');
    const state = useEditor.getState(), id = state.selectedId!;
    const original = state.project.objects.find(object => object.id === id)!;
    const first = evaluateRenderTransform(original, 1);
    state.setTransform(id, { ...first, position: [5, 1, 2] });
    const read = () => evaluateRenderTransform(useEditor.getState().project.objects.find(object => object.id === id)!, 1).position;
    expect(read()).toEqual([5, 1, 2]); state.undo(); expect(read()).toEqual(first.position); state.redo(); expect(read()).toEqual([5, 1, 2]);
    state.loadProject(JSON.parse(JSON.stringify(useEditor.getState().project)), ''); expect(read()).toEqual([5, 1, 2]);
    expect(evaluateRenderTransform(original, 1)).toBe(first);
  });
});
