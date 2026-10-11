import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useEditor } from '../store/editor';

export const performanceReview = new URLSearchParams(window.location.search).has('performance-test');
const commits: number[] = [];
export function recordPerformanceCommit(_id: string, _phase: string, duration: number) {
  if (performanceReview) { commits.push(duration); if (commits.length > 2000) commits.shift(); }
}
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;

/** Diagnostics are opt-in, do not enter project data, and avoid React updates. */
export function PerformanceProbe() {
  const session = useRef({ start: 0, previous: 0, lastReport: 0, frames: [] as number[], calls: [] as number[], timelineFrames: new Set<number>(), complete: false });
  useFrame(({ gl }) => {
    const state = session.current, now = performance.now();
    if (state.complete) return;
    if (!state.start) { state.start = now; state.previous = now; return; }
    const elapsed = now - state.start;
    if (elapsed < 3000) { state.previous = now; commits.length = 0; return; }
    state.frames.push(now - state.previous); state.previous = now;
    state.calls.push(gl.info.render.calls); state.timelineFrames.add(useEditor.getState().currentFrame);
    if (now - state.lastReport < 500) return;
    state.lastReport = now;
    const complete = state.frames.length >= 300 || elapsed >= 33000;
    const target = document.getElementById('scene-performance-report');
    if (target) target.textContent = JSON.stringify({ complete, viewport: { width: window.innerWidth, height: window.innerHeight, zoom: Number(document.getElementById('root')?.style.zoom) || 1 }, objects: useEditor.getState().project.objects.length - 1, pathPoints: 10000, sampledFrames: state.frames.length, timelineFrames: state.timelineFrames.size, fps: 1000 * state.frames.length / state.frames.reduce((sum, value) => sum + value, 0), frameP50Ms: percentile(state.frames, .5), frameP95Ms: percentile(state.frames, .95), drawCallsP50: percentile(state.calls, .5), reactCommits: commits.length, reactCommitP95Ms: percentile(commits, .95) });
    if (complete) { state.complete = true; useEditor.getState().setPlaying(false); }
  });
  return null;
}
