import { describe, expect, it } from 'vitest';
import { alignmentTargets, snapAlignment } from './alignment';

describe('magnetic alignment', () => {
  const targets = alignmentTargets({ min: -1, center: 0, max: 1 }, { min: 4, center: 5, max: 6 }, 'other', 'Object');
  it('captures centers, matching edges and touching edges in screen pixels', () => {
    expect(snapAlignment(5.25, targets, 50).value).toBe(5);
    expect(snapAlignment(3.25, targets, 50).value).toBe(3);
    expect(snapAlignment(7.25, targets, 50).value).toBe(7);
    expect(snapAlignment(3.4, targets, 50).match).toBeUndefined();
  });
  it('holds the same guide across nearby alternatives, then releases from the raw pointer position', () => {
    const initial = snapAlignment(5.1, targets, 50);
    expect(snapAlignment(5.5, targets, 50, initial.match).value).toBe(5);
    expect(snapAlignment(5.7, targets, 50, initial.match).match).toBeUndefined();
    expect(snapAlignment(5.1, targets, 50, initial.match, true).value).toBe(5.1);
  });
  it('keeps the capture distance consistent at different zoom levels', () => {
    expect(snapAlignment(5.15, targets, 100).value).toBe(5);
    expect(snapAlignment(5.3, targets, 50).value).toBe(5);
    expect(snapAlignment(5.17, targets, 100).match).toBeUndefined();
  });
});
