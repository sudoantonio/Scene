import { describe, expect, it } from 'vitest';
import { shareProjectSnapshot } from './project-sharing';
import { createPerformanceFixture } from './performance-fixture';
import { useEditor } from '../store/editor';

describe('selective project snapshots', () => {
  it('shares unchanged elements and curve data without modifying the previous project', () => {
    const original = createPerformanceFixture(100), before = JSON.stringify(original), draft = structuredClone(original);
    draft.objects[1].color = '#ff0000';
    const next = shareProjectSnapshot(original, draft);
    expect(next.objects[2]).toBe(original.objects[2]); expect(next.cameraCuts).toBe(original.cameraCuts);
    expect(next.objects[1]).not.toBe(original.objects[1]); expect(next.objects[1].keyframes).toBe(original.objects[1].keyframes);
    expect(JSON.stringify(original)).toBe(before); expect(next.objects[1].color).toBe('#ff0000');
  });
  it('retains references through reordering and drops deleted elements', () => {
    const original = createPerformanceFixture(100), draft = structuredClone(original);
    draft.objects.splice(2, 1); draft.objects.reverse();
    const next = shareProjectSnapshot(original, draft), byId = new Map(original.objects.map(object=>[object.id, object]));
    expect(next.objects).toHaveLength(original.objects.length-1);
    next.objects.forEach(object => expect(object).toBe(byId.get(object.id)));
  });
  it('changes only the edited element and preserves previous undo data', () => {
    useEditor.getState().loadProject(createPerformanceFixture(100), '');
    const initial = useEditor.getState().project.objects[2];
    useEditor.getState().updateObject(initial.id, { color: initial.color });
    const before = useEditor.getState().project, saved = JSON.stringify(before), id = before.objects[2].id;
    useEditor.getState().updateObject(id, { color: '#ffffff' });
    const after = useEditor.getState().project;
    expect(after.objects[1]).toBe(before.objects[1]); expect(after.objects[2]).not.toBe(before.objects[2]); expect(JSON.stringify(before)).toBe(saved);
    useEditor.getState().undo(); expect(useEditor.getState().project).toEqual(before);
    useEditor.getState().redo(); expect(useEditor.getState().project.objects[1].keyframes).toBe(after.objects[1].keyframes);
  });
});
