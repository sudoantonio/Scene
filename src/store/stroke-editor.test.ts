import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, ProjectSchema } from '../domain/schema';
import { evaluateTransform, evaluateProperty } from '../domain/animation';
import { useEditor } from './editor';
import { hydratePortableProject, projectForStorage } from '../../electron/project-storage';

beforeEach(() => useEditor.setState({ project: createProject(), past: [], future: [], currentFrame: 1, selectedIds: [], selectedId: undefined, dirty: false }));
describe('permanent stroke editing and persistence', () => {
  it('stores local points, creates one history operation, and supports undo/redo', () => {
    const state = useEditor.getState();
    const id = state.addStroke([[2, 3, 4], [3, 3, 4], [4, 4, 5]], .025, '#ff0000')!;
    const after = useEditor.getState(); const object = after.project.objects.find(o => o.id === id)!;
    expect(object.stroke!.points).toEqual([[0, 0, 0], [1, 0, 0], [2, 1, 1]]);
    expect(evaluateTransform(object, 1).position).toEqual([2, 3, 4]);
    expect(after.past).toHaveLength(1); expect(after.selectedId).toBe(id);
    after.undo(); expect(useEditor.getState().project.objects.some(o => o.id === id)).toBe(false);
    useEditor.getState().redo(); expect(useEditor.getState().project.objects.find(o => o.id === id)!.stroke!.points).toHaveLength(3);
  });
  it('supports transforms, duplication, thickness changes and deletion', () => {
    const id = useEditor.getState().addStroke([[0, 0, 1], [1, 0, 1]], .02, '#aabbcc')!;
    useEditor.getState().setTransform(id, { position: [3, 4, 5], rotation: [0, 0, 90], scale: [2, 2, 2] });
    useEditor.getState().updateObject(id, { stroke: { points: [[0, 0, 0], [1, 0, 0]], thickness: .1 } });
    const duplicate = useEditor.getState().duplicateSelection()[0];
    expect(useEditor.getState().project.objects.find(o => o.id === duplicate)!.stroke!.thickness).toBe(.1);
    useEditor.getState().deleteObject(id);
    // Scene's delete action hides an element in the active shot, preserving other shots.
    const deleted = useEditor.getState().project.objects.find(o => o.id === id);
    expect(!deleted || !evaluateProperty(deleted, 'visibility', 1)).toBe(true);
  });
  it('round-trips authored geometry and normals through portable storage', async () => {
    useEditor.getState().addStroke([[0, 0, 1], [1, 0, 1]], .02, '#aabbcc', [[0, 0, 1], [0, 0, 1]]);
    const project = useEditor.getState().project;
    const stored = projectForStorage(ProjectSchema.parse(project), '/tmp/drawing/project.abaco.json');
    const reloaded = await hydratePortableProject(stored, '/tmp/drawing/project.abaco.json', async () => '');
    expect(reloaded.objects.find(o => o.kind === 'stroke')!.stroke).toEqual(project.objects.find(o => o.kind === 'stroke')!.stroke);
  });
  it('loads old projects and rejects missing geometry or malformed strokes', () => {
    expect(ProjectSchema.safeParse(createProject()).success).toBe(true);
    expect(useEditor.getState().addStroke([[0, 0, 0]], .02, '#aabbcc')).toBeUndefined();
    expect(useEditor.getState().addStroke([[0, 0, 0], [1, 0, 0]], -.02, '#aabbcc')).toBeUndefined();
    const id = useEditor.getState().addStroke([[0, 0, 0], [1, 0, 0]], .02, '#aabbcc')!;
    const project = structuredClone(useEditor.getState().project); project.objects.find(o => o.id === id)!.stroke = undefined;
    expect(ProjectSchema.safeParse(project).success).toBe(false);
  });
});
