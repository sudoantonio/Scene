import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateTransform } from './animation';
import { createProject, ProjectSchema } from './schema';
import { useEditor } from '../store/editor';

beforeEach(() => useEditor.getState().loadProject(createProject(), '/test.abaco.json'));

describe('Element groups', () => {
  it('selects, groups, moves, edits one member and ungroups without losing animation', () => {
    useEditor.getState().addObject('cube');
    const cube = useEditor.getState().selectedId!;
    useEditor.getState().addObject('sphere');
    const sphere = useEditor.getState().selectedId!;
    useEditor.getState().setTransform(sphere, { position: [2, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().select(cube);
    useEditor.getState().toggleSelection(sphere);
    useEditor.getState().groupSelection();
    expect(useEditor.getState().project.groups[0].memberIds).toEqual([cube, sphere]);
    useEditor.getState().setTransform(cube, { position: [1, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const moved = useEditor.getState().project;
    expect(evaluateTransform(moved.objects.find(o => o.id === sphere)!, 1).position).toEqual([3, 0, 1]);
    expect(ProjectSchema.parse(moved).groups).toHaveLength(1);
    useEditor.getState().undo();
    expect(evaluateTransform(useEditor.getState().project.objects.find(o => o.id === sphere)!, 1).position).toEqual([2, 0, 1]);
    useEditor.getState().redo();
    useEditor.getState().select(sphere);
    expect(useEditor.getState().selectedIds).toHaveLength(2);
    useEditor.getState().selectMember(sphere);
    expect(useEditor.getState().selectedIds).toEqual([sphere]);
    useEditor.getState().select(cube);
    useEditor.getState().ungroupSelection();
    expect(useEditor.getState().project.groups).toHaveLength(0);
    expect(evaluateTransform(useEditor.getState().project.objects.find(o => o.id === sphere)!, 1).position).toEqual([3, 0, 1]);
  });

  it('restores an older project without group metadata', () => {
    const older: Record<string, unknown> = { ...createProject() };
    delete older.groups;
    expect(ProjectSchema.parse(older).groups).toEqual([]);
  });
});
