import { describe, expect, it } from 'vitest';
import { createSceneObject } from './schema';
import { isDrawnMotionTarget, motionPathFrames } from './drawn-motion';

describe('drawn motion sampling', () => {
  it('resamples uneven cursor samples by distance with exact duration and endpoints', () => {
    const samples = motionPathFrames([[2, 3, 4], [2.1, 3, 4], [4, 3, 4], [4, 5, 4]], 10, 4);
    expect(samples.map(sample => sample.frame)).toEqual([10, 11, 12, 13, 14]);
    expect(samples.map(sample => sample.position)).toEqual([[2, 3, 4], [3, 3, 4], [4, 3, 4], [4, 4, 4], [4, 5, 4]]);
  });
  it('ignores stationary and invalid paths and tolerates duplicate cursor samples', () => {
    expect(motionPathFrames([[0, 0, 0], [0, 0, 0]], 1, 20)).toEqual([]);
    expect(motionPathFrames([[NaN, 0, 0], [1, 0, 0]], 1, 20)).toEqual([]);
    expect(motionPathFrames([[0, 0, 0], [0, 0, 0], [1, 0, 0]], 1, 2).at(-1)?.position).toEqual([1, 0, 0]);
  });
  it('accepts 3D geometries including imported models and strokes and excludes helpers', () => {
    for (const kind of ['cube', 'blend_asset', 'stroke'] as const) expect(isDrawnMotionTarget(createSceneObject(kind, 1))).toBe(true);
    for (const kind of ['camera', 'audio', 'point_light'] as const) expect(isDrawnMotionTarget(createSceneObject(kind, 1))).toBe(false);
    const screen = createSceneObject('plane', 1); screen.screenSpace = true;
    expect(isDrawnMotionTarget(screen)).toBe(false);
  });
});

describe('dense motion controls', () => {
  it('keeps endpoints and selected keys visible without discarding recorded data', async () => {
    const { motionHandleKeys } = await import('./drawn-motion');
    const keys = Array.from({ length: 200 }, (_, i) => ({ id: String(i), value: [i / 200, 0, 0] }));
    const visible = motionHandleKeys(keys, .2, ['83']);
    expect(visible.length).toBeLessThan(10);
    expect(visible.map(key => key.id)).toEqual(expect.arrayContaining(['0', '83', '199']));
    expect(keys).toHaveLength(200);
    expect(motionHandleKeys(keys.slice(0, 5), .2)).toHaveLength(2);
  });
});
