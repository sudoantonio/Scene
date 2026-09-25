import { describe, expect, it } from 'vitest';
import { createSceneObject } from './schema';
import { controllerMotionPaths } from './controller-motion-path';

describe('character motion paths', () => {
  it('shows a hand trajectory from controller keys even when the character stays in place', () => {
    const character = createSceneObject('blend_asset', 1);
    character.asset.boundsCenter = [0, 0, 0];
    character.asset.previewScale = .5;
    character.asset.controllers = [{ name: 'CTRL_MANO_DX', position: [0, 0, 0], worldPosition: [1, 0, 1], worldBasis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }];
    character.asset.controllerKeys = [
      { name: 'CTRL_MANO_DX', frame: 1, offset: [0, 0, 0] },
      { name: 'CTRL_MANO_DX', frame: 25, offset: [0, 0, 1] },
      { name: 'CTRL_MANO_DX', frame: 40, offset: [0, 0, 2] },
    ];
    character.transform.position = [2, 0, 0];
    character.transform.rotation = [0, 0, 90];
    character.transform.scale = [2, 1, 1];
    const paths = controllerMotionPaths(character, 1, 30, 1);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.points[0]).toEqual(expect.arrayContaining([expect.closeTo(2), expect.closeTo(1), expect.closeTo(.5)]));
    expect(paths[0]?.points.at(-1)).toEqual(expect.arrayContaining([expect.closeTo(2), expect.closeTo(1), expect.closeTo(1)]));
    expect(paths[0]?.keyPoints).toHaveLength(2);
  });

  it('omits a line when the hand has no change in pose', () => {
    const character = createSceneObject('blend_asset', 1);
    character.asset.controllers = [{ name: 'CTRL_MANO_DX', position: [0, 0, 0], worldPosition: [0, 0, 1] }];
    character.asset.controllerKeys = [
      { name: 'CTRL_MANO_DX', frame: 1, offset: [0, 0, 0] },
      { name: 'CTRL_MANO_DX', frame: 25, offset: [0, 0, 0] },
    ];
    expect(controllerMotionPaths(character, 1, 30, 1)).toEqual([]);
  });
});
