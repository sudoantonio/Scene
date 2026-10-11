import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditorClock from './EditorClock';
import { useEditor } from '../store/editor';

let callbacks: Map<number, FrameRequestCallback>, sequence: number;
beforeEach(() => {
  callbacks = new Map(); sequence = 0; useEditor.getState().newProject();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; callbacks.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tick = (time: number) => act(() => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback(time)); });
describe('isolated playback clock', () => {
  it('advances without rerendering its parent and stops immediately on pause', () => {
    let parentRenders = 0;
    function Parent() { parentRenders++; return <EditorClock theme="dark" />; }
    render(<Parent />); const before = parentRenders;
    act(() => useEditor.getState().setPlaying(true));
    const now = performance.now(); tick(now + 50); expect(useEditor.getState().currentFrame).toBeGreaterThan(1);
    tick(now + 100); expect(parentRenders).toBe(before);
    const frame = useEditor.getState().currentFrame;
    act(() => useEditor.getState().setPlaying(false)); tick(now + 1000);
    expect(useEditor.getState().currentFrame).toBe(frame); expect(callbacks.size).toBe(0);
  });
  it('ends playback at the project boundary', () => {
    render(<EditorClock theme="dark" />);
    act(() => { useEditor.getState().setFrame(useEditor.getState().project.settings.frameEnd - 1); useEditor.getState().setPlaying(true); });
    tick(performance.now() + 100);
    expect(useEditor.getState().isPlaying).toBe(false); expect(useEditor.getState().currentFrame).toBe(1);
  });
});
