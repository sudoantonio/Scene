import { describe, expect, it } from 'vitest';
import { createSceneObject } from './schema';
import { controllerOffset, controllerPose } from './controller-pose';

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
});
