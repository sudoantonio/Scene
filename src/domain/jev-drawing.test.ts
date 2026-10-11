import { describe, expect, it, vi } from 'vitest';
import { JevDrawingInputSchema, jevDrawingRequest, parseJevDrawingResponse, StrokeJevGuide, type JevDrawingInput } from './jev-drawing';

const input: JevDrawingInput = { instruction: '', view: { position: [0, 0, 10], direction: [0, 0, -1], mode: 'free' }, position: [0, 0, 0], radius: 1, neighbors: [] };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe('Jev drawing guide', () => {
  it('sends typed questions and normalizes Score values to 0–1', () => {
    expect(jevDrawingRequest(input).model).toBe('jev-latest');
    expect(parseJevDrawingResponse({ answers: { adherence: { type: 'score', score: 3 }, continuity: { type: 'score', score: 2 } } })).toEqual({ adherence: .75, continuity: .5 });
    expect(() => parseJevDrawingResponse({ answers: { adherence: { type: 'score', score: 9 } } })).toThrow();
  });
  it('rejects more than 50 inputs and non-finite coordinates at the IPC boundary', () => {
    const neighbor = { id: 'point', kind: 'point', position: [0, 0, 0], distance: 0 };
    expect(JevDrawingInputSchema.safeParse({ ...input, neighbors: Array(50).fill(neighbor) }).success).toBe(true);
    expect(JevDrawingInputSchema.safeParse({ ...input, neighbors: Array(51).fill(neighbor) }).success).toBe(false);
    expect(JevDrawingInputSchema.safeParse({ ...input, position: [NaN, 0, 0] }).success).toBe(false);
  });
  it('throttles to one request a second and never overlaps requests', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const guide = new StrokeJevGuide(request); guide.begin();
    guide.update(input, 0); await flush(); guide.update(input, 2000);
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ adherence: .9, continuity: .8 }); await flush();
    expect(guide.parameters).toEqual({ adherence: .9, continuity: .8 });
    guide.update(input, 500); await flush(); expect(request).toHaveBeenCalledTimes(1);
    guide.update(input, 2001); await flush(); expect(request).toHaveBeenCalledTimes(2);
  });
  it('ignores replies from a finished stroke while keeping a single global flight', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const guide = new StrokeJevGuide(request); guide.begin(); guide.update(input, 0); await flush();
    guide.end(); guide.begin(); guide.update(input, 2000); await flush();
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ adherence: 1, continuity: 1 }); await flush();
    expect(guide.parameters).toEqual({ adherence: .7, continuity: .6 });
    guide.update(input, 2001); await flush(); expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([new Error('timeout'), new Error('offline'), { adherence: 2, continuity: NaN }])('retains the last valid parameters on errors or invalid results', async problem => {
    const request = vi.fn().mockResolvedValueOnce({ adherence: .8, continuity: .9 });
    if (problem instanceof Error) request.mockRejectedValueOnce(problem); else request.mockResolvedValueOnce(problem);
    const status = vi.fn(); const guide = new StrokeJevGuide(request, status); guide.begin();
    guide.update(input, 0); await flush(); guide.update(input, 1000); await flush();
    expect(guide.parameters).toEqual({ adherence: .8, continuity: .9 });
    expect(status.mock.calls.at(-1)![0]).toContain('local guidance active');
  });
});
