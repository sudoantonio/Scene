import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PreviewWindow from './PreviewWindow';
import './styles.css';
import './modern-theme.css';

const preview = new URLSearchParams(window.location.search).has('preview');

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

createRoot(document.getElementById('root')!).render(<StrictMode><RootErrorBoundary>{preview ? <PreviewWindow /> : <App />}</RootErrorBoundary></StrictMode>);
