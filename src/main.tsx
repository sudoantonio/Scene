import { restoreBrowserAssets } from './domain/browser-assets';
import { useEditor } from './store/editor';
import { ProjectSchema } from './domain/schema';
import { Component, Profiler, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createPerformanceFixture, createPerformanceInteractionFixture } from './domain/performance-fixture';
import { performanceReview, recordPerformanceCommit } from './components/PerformanceProbe';
import { createRoot } from 'react-dom/client';
import App from './App';
import PreviewWindow from './PreviewWindow';
import './styles.css';
import './modern-theme.css';
import { installInterfaceZoom } from './domain/interface-zoom';

const preview = new URLSearchParams(window.location.search).has('preview');
if (!preview) {
  const removeZoom = installInterfaceZoom();
  import.meta.hot?.dispose(removeZoom);
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Unrecoverable renderer error', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main role="alert" style={{ width: '100%', height: '100%', padding: 28, display: 'grid', placeItems: 'center', color: '#e5e5e5', background: '#0d0d0d', fontFamily: 'system-ui, sans-serif' }}>
      <section style={{ width: 'min(480px, 100%)', padding: 22, background: '#202020', border: '1px solid #3b3b3b', borderRadius: 14 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 18 }}>The view stopped unexpectedly</h1>
        <p style={{ margin: '0 0 18px', color: '#b8b8b8', fontSize: 13 }}>Your project was not deleted. Reload the renderer to restore the interface.</p>
        <button style={{ minHeight: 34, padding: '0 14px', color: '#171717', background: '#d9ad32', border: 0, borderRadius: 8 }} onClick={() => window.location.reload()}>Reload view</button>
      </section>
    </main>;
  }
}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
const mount = () => root.render(<StrictMode><RootErrorBoundary>{performanceReview ? <Profiler id="editor" onRender={recordPerformanceCommit}><App /><output id="scene-performance-report" style={{ display: 'none' }} /></Profiler> : preview ? <PreviewWindow /> : <App />}</RootErrorBoundary></StrictMode>);

// Browser review fixture is opt-in and never replaces an existing preview session.
if (performanceReview) {
  const count = Math.min(3000, Math.max(1, Number(new URLSearchParams(window.location.search).get('performance-test')) || 1000));
  const interaction = new URLSearchParams(window.location.search).has('performance-interaction');
  useEditor.getState().loadProject(interaction ? createPerformanceInteractionFixture() : createPerformanceFixture(count), '');
  useEditor.getState().setCameraView(true); useEditor.getState().setPlaying(!interaction); mount();
} else if (!window.abaco && new URLSearchParams(window.location.search).has('editor-demo') && !localStorage.getItem('scene-editor-demo-initialized')) {
  fetch('./editor-demo/project.json').then(response => response.json()).then(raw => {
    useEditor.getState().loadProject(ProjectSchema.parse(raw), '');
    localStorage.setItem('scene-editor-demo-initialized', '1');
  }).catch(error => console.error('Preview fixture could not be loaded', error)).finally(mount);
} else if (!window.abaco && !preview) {
  restoreBrowserAssets(useEditor.getState().project).then(project => { if (project !== useEditor.getState().project) useEditor.getState().loadProject(project, ''); }).catch(error => console.error('Local media restore failed', error)).finally(mount);
} else mount();
