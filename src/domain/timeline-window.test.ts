import { describe, expect, it } from 'vitest';
import { timelineRowWindow } from './timeline-window';

describe('large timeline scrolling', () => {
  it('keeps motion and subtitles together without changing overall row positions', () => {
    const counts = Array.from({ length: 1000 }, (_, i) => i % 3 === 0 ? 2 : 1);
    for (const top of [0, 200, 4000, 22000, 49500]) {
      const window = timelineRowWindow(counts, top, 250, 38, 98);
      expect(window.end - window.start).toBeLessThan(18);
      expect(window.before + counts.slice(window.start, window.end).reduce((sum, count) => sum + count, 0) + window.after).toBe(counts.reduce((sum, count) => sum + count, 0));
      expect(window.offsets[window.start]).toBe(window.before);
    }
  });
  it('retains all rows in small timelines and when dimensions are unavailable', () => {
    expect(timelineRowWindow([1, 2, 1], 500, 200, 38, 98).end).toBe(3);
    expect(timelineRowWindow(Array(1000).fill(1), 0, 0, 38, 98).end).toBe(1000);
  });
});
