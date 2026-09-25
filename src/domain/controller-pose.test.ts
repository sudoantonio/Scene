import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProject, createSceneObject } from './schema';
import { applyControllerMorphs, controllerOffset, controllerOffsetFromWorldDelta, controllerPose, controllerWorldDelta } from './controller-pose';
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

  it('deforms the loaded preview immediately and resets weights when returning to rest', () => {
    const model = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    arm.morphTargetDictionary = { SCENE_POSE_0_0: 0, SCENE_POSE_0_1: 1, SCENE_POSE_0_2: 2 };
    arm.morphTargetInfluences = [0, 0, 0];
    model.add(arm);
    const controllers = [{ name: 'CTRL_MANO_DX', position: [0, 0, 0] as [number, number, number], morphTargets: ['SCENE_POSE_0_0', 'SCENE_POSE_0_1', 'SCENE_POSE_0_2'] as [string, string, string], morphStep: .25 }];
    applyControllerMorphs(model, controllers, { CTRL_MANO_DX: [.5, 0, 0] });
    expect(arm.morphTargetInfluences).toEqual([2, 0, 0]);
    applyControllerMorphs(model, controllers, { CTRL_MANO_DX: [0, 0, 0] });
    expect(arm.morphTargetInfluences).toEqual([0, 0, 0]);
  });

  it('maps cursor movement through a rotated Blender controller', () => {
    const controller = { name: 'CTRL_MANO_DX', position: [0, 0, 0] as [number, number, number], worldBasis: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]] };
    expect(controllerWorldDelta(controller, [.5, 0, 0])).toEqual([0, .5, 0]);
    expect(controllerOffsetFromWorldDelta(controller, [0, .5, 0])).toEqual([.5, 0, 0]);
  });
});
