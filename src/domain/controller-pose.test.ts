import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from './schema';
import { controllerOffset, controllerPose } from './controller-pose';
import { useEditor } from '../store/editor';

describe('Blender character controllers', () => {
  it('preserves the original pose until the first edit and interpolates between saved poses', () => {
    const object = createSceneObject('blend_asset', 1);
    object.asset.controllers = [{ name: 'CTRL_MANO_DX', position: [1, 2, 3] }];
    object.asset.controllerKeys = [
      { name: 'CTRL_MANO_DX', frame: 10, offset: [0, 0, 0] },
      { name: 'CTRL_MANO_DX', frame: 20, offset: [2, 0, -2] },
    ];
    expect(controllerOffset(object.asset, 'CTRL_MANO_DX', 1)).toEqual([0, 0, 0]);
    expect(controllerOffset(object.asset, 'CTRL_MANO_DX', 15)).toEqual([1, 0, -1]);
    expect(controllerPose(object.asset, 25)).toEqual({ CTRL_MANO_DX: [2, 0, -2] });
  });

  it('saves a dragged joint at the selected frame and restores it with Undo', () => {
    const project = createProject();
    const character = createSceneObject('blend_asset', 1);
    character.asset.controllers = [{ name: 'CTRL_MANO_DX', position: [0, 0, 0], worldPosition: [.6, 0, .5] }];
    project.objects.push(character);
    useEditor.getState().loadProject(project, '/private/tmp/character.abaco.json');
    useEditor.getState().setFrame(12);
    useEditor.getState().setControllerOffset(character.id, 'CTRL_MANO_DX', [.5, 0, 0]);
    const moved = useEditor.getState().project.objects.find((item) => item.id === character.id)!;
    expect(controllerOffset(moved.asset, 'CTRL_MANO_DX', 12)).toEqual([.5, 0, 0]);
    expect(controllerOffset(moved.asset, 'CTRL_MANO_DX', 1)).toEqual([0, 0, 0]);
    useEditor.getState().undo();
    const restored = useEditor.getState().project.objects.find((item) => item.id === character.id)!;
    expect(controllerOffset(restored.asset, 'CTRL_MANO_DX', 12)).toEqual([0, 0, 0]);
  });
});
