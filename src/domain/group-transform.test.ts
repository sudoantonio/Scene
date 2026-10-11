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

it('moves a saved surface curve together with its animation keys', async () => {
  const { createSceneObject } = await import('./schema');
  const { moveGroupMembers } = await import('./group-transform');
  const object = createSceneObject('cube',1);
  object.keyframes = [{id:crypto.randomUUID(),frame:1,property:'position',value:[0,0,0],interpolation:'linear',source:'user',commentIds:[],positionPath:[[0,0,0],[1,0,1],[1,3,4]]},{id:crypto.randomUUID(),frame:3,property:'position',value:[1,3,4],interpolation:'linear',source:'user',commentIds:[]}];
  const before=evaluateTransform(object,1.3).position;
  moveGroupMembers([object],{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},{position:[2,3,4],rotation:[0,0,0],scale:[1,1,1]});
  const after=evaluateTransform(object,1.3).position;
  after.forEach((v,i)=>expect(v).toBeCloseTo(before[i]+[2,3,4][i],5));
  expect(object.keyframes[0].positionPath?.[1]).toEqual([3,3,5]);
});
