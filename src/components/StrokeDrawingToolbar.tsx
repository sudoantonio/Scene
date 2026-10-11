import { useEffect, useRef } from 'react';
import { Circle, Pencil, X } from './icons';
import { useEditor } from '../store/editor';
import { useStrokeDrawing } from '../store/stroke-drawing';

export default function StrokeDrawingToolbar() {
  const config = useStrokeDrawing();
  const project = useEditor(state => state.project);
  const recording = useEditor(state => Boolean(state.recordingSession));
  const selected = project.objects.some(object => object.id === config.sourceId);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!config.panelOpen) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) useStrokeDrawing.setState({ panelOpen: false }); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [config.panelOpen]);
  const toggle = () => {
    useEditor.getState().clearJevStroke();
    if (!config.active) {
      useEditor.getState().select(undefined);
      useStrokeDrawing.setState({ active: true, mode: 'motion', panelOpen: false, sourceId: undefined, destinationId: undefined, status: 'Click the object to move, then the second object. Click the first again to deselect it.' });
    } else useStrokeDrawing.setState({ panelOpen: !config.panelOpen });
  };
  const record = () => {
    const editor = useEditor.getState();
    if (editor.recordingSession) editor.stopRecording();
    else {
      const cut = editor.project.cameraCuts.filter(cut => cut.frame <= editor.currentFrame).sort((a, b) => a.frame - b.frame).at(-1);
      if (cut) editor.startRecording(cut.id);
    }
  };
  return <div ref={root} className="stroke-drawing-toolbar" aria-label="3D drawing · Jev">
    <button type="button" disabled={config.drawing} className={`slim-add ${config.active ? 'active' : ''}`} aria-label="3D drawing · Jev" title="Draw — click two objects, then press and drag normally" aria-pressed={config.active} onClick={toggle}><Pencil size={17} /></button>
    {config.active && config.panelOpen && <div className="stroke-drawing-options">
      <div className="stroke-drawing-mode-buttons" role="group" aria-label="3D drawing mode">
        <button type="button" data-drawing-mode="stroke" disabled={config.drawing} aria-pressed={config.mode === 'stroke'} onClick={() => useStrokeDrawing.setState({ mode: 'stroke', panelOpen: false, status: 'Drag to draw. Esc cancels the stroke.' })}>Stroke</button>
        <button type="button" data-drawing-mode="motion" disabled={config.drawing} aria-pressed={config.mode === 'motion'} onClick={() => useStrokeDrawing.setState({ mode: 'motion', status: 'Select the object to move first, then the destination.' })}>Motion</button>
      </div>
      {config.mode === 'motion' && <>
        <label>Duration · s<input aria-label="Motion duration" type="number" min="0.1" max="60" step="0.1" value={config.durationSeconds} disabled={config.drawing || recording} onChange={event => { const durationSeconds = Number(event.target.value); if (durationSeconds >= .1 && durationSeconds <= 60) useStrokeDrawing.setState({ durationSeconds }); }} /></label>
        <button aria-pressed={recording} disabled={config.drawing || !selected} className={recording ? 'active' : ''} onClick={record}><Circle size={14} /> {recording ? 'Stop REC motion' : 'REC motion'}</button>

      </>}
      {config.mode === 'stroke' && <><label>Optional guidance<input aria-label="Jev drawing instruction" placeholder="Follow object surfaces and connect nearby strokes…" maxLength={2000} value={config.instruction} onChange={event => useStrokeDrawing.setState({ instruction: event.target.value })} /></label>
      {config.mode === 'stroke' && <div className="stroke-drawing-style">
        <label>Color<input aria-label="3D stroke color" type="color" value={config.color} disabled={config.drawing} onChange={event => useStrokeDrawing.setState({ color: event.target.value })} /></label>
        <label>Thickness (m)<input aria-label="3D stroke thickness" type="number" min="0.001" max="1000" step="0.005" value={config.thickness} disabled={config.drawing} onChange={event => { const thickness = Number(event.target.value); if (thickness > 0 && thickness <= 1000) useStrokeDrawing.setState({ thickness }); }} /></label>
      </div>}
      <label className="stroke-influence"><input type="checkbox" checked={config.showInfluence} onChange={event => useStrokeDrawing.setState({ showInfluence: event.target.checked })} /> Show influence</label>

      </>}

      <button onClick={() => useStrokeDrawing.setState({ active: false, panelOpen: false })}><X size={14} /> Exit drawing</button>
    </div>}
  </div>;
}

export function StrokeDrawingFeedback() {
  const config = useStrokeDrawing();
  const objects = useEditor(state => state.project.objects);
  const recording = useEditor(state => Boolean(state.recordingSession));
  if (!config.active || config.panelOpen) return null;
  const status = config.mode === 'motion' && !recording && config.status.startsWith('Motion recorded.') ? 'Recording finished. Press Play to play the motion.' : config.status;
  return <div className="stroke-drawing-feedback">
    {config.mode === 'motion' && <small className="motion-pair-names"><span style={{ color: '#efae45' }}>1 · {objects.find(o => o.id === config.sourceId)?.name ?? 'Click the object to move'}</span><span style={{ color: '#42c9e8' }}>2 · {objects.find(o => o.id === config.destinationId)?.name ?? 'Click the destination object'}</span></small>}

    <output role="status" aria-label="Jev drawing guidance">{status}</output>
  </div>;
}
