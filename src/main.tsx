import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PreviewWindow from './PreviewWindow';
import './styles.css';

const preview = new URLSearchParams(window.location.search).has('preview');
createRoot(document.getElementById('root')!).render(<StrictMode>{preview ? <PreviewWindow /> : <App />}</StrictMode>);
