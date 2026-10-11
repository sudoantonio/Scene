import { useEffect } from 'react';
import { useEditor } from '../store/editor';

/** Frame changes reach the viewport/timeline directly, without rerendering App. */
export default function EditorClock({ theme }: { theme: 'light' | 'dark' }) {
  const playing = useEditor(state => state.isPlaying);
  const project = useEditor(state => state.project);
  useEffect(() => {
    if (!playing) return;
    let animationFrame = 0, previousTime = performance.now(), partialFrames = 0;
    const tick = (now: number) => {
      const state = useEditor.getState();
      if (!state.isPlaying) return;
      const elapsed = Math.min(250, Math.max(0, now - previousTime));
      previousTime = now; partialFrames += elapsed * state.project.settings.fps / 1000;
      const advance = Math.floor(partialFrames); partialFrames -= advance;
      if (!advance) { animationFrame = requestAnimationFrame(tick); return; }
      if (state.recordingSession) {
        const scenes = state.project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
        const index = scenes.findIndex(scene => scene.id === state.recordingSession?.sceneId);
        const end = scenes[index + 1]?.frame ?? state.project.settings.frameEnd + 1;
        if (index < 0 || state.currentFrame + advance >= end) { state.setFrame(Math.max(state.currentFrame, end - 1)); state.stopRecording(); return; }
      }
      if (state.currentFrame + advance >= state.project.settings.frameEnd) { state.setFrame(state.project.settings.frameStart); state.setPlaying(false); }
      else { state.setFrame(state.currentFrame + advance); animationFrame = requestAnimationFrame(tick); }
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [playing]);
  useEffect(() => {
    window.abaco?.syncPreviewProject({ project, frame: useEditor.getState().currentFrame, theme });
  }, [project, theme]);
  useEffect(() => {
    if (!window.abaco) return;
    window.abaco.syncPreviewFrame(useEditor.getState().currentFrame);
    return useEditor.subscribe((state, previous) => {
      if (state.currentFrame !== previous.currentFrame) window.abaco?.syncPreviewFrame(state.currentFrame);
    });
  }, []);
  return null;
}
