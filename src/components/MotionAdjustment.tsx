import { useEffect, useRef, useState } from 'react';
import { MotionAdjustmentSchema, selectedMotionSignature } from '../domain/motion-adjustment';
import { useEditor } from '../store/editor';
import { useStrokeDrawing } from '../store/stroke-drawing';

export default function MotionAdjustment() {
  const selection = useEditor(state => state.selectedMotion);
  const project = useEditor(state => state.project);
  const drawing = useStrokeDrawing(state => state.active);
  const recording = useEditor(state => Boolean(state.recordingSession));
  const [instruction, setInstruction] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => { generation.current++; setInstruction(''); setStatus(''); return () => { generation.current++; }; }, [project.id, selection?.objectId, selection?.sceneId, drawing]);
  const range = selection && selectedMotionSignature(project, selection.objectId, selection.sceneId);
  if (!selection || !range || drawing || recording) return null;
  const submit = async () => {
    if (inFlight.current || instruction.trim().length < 3) return;
    const { objectId, sceneId } = selection, original = range, projectId = project.id, token = generation.current;
    inFlight.current = true; setBusy(true); setStatus('Jev is updating the motion…');
    try {
      if (!window.abaco?.adjustMotion) throw new Error('Motion adjustment is available in the desktop app.');
      const result = MotionAdjustmentSchema.parse(await window.abaco.adjustMotion({ instruction: instruction.trim(), durationSeconds: (range.last - range.start) / project.settings.fps }));
      const current = useEditor.getState(), latest = selectedMotionSignature(current.project, objectId, sceneId);
      if (token !== generation.current) return;
      if (current.project.id !== projectId || current.selectedMotion?.objectId !== objectId || current.selectedMotion.sceneId !== sceneId || useStrokeDrawing.getState().active || current.recordingSession || latest?.signature !== original.signature) {
        setStatus('The motion changed. Submit the adjustment again.'); return;
      }
      current.adjustSelectedMotion(objectId, sceneId, result);
      setInstruction(''); setStatus('Motion updated.');
    } catch (error) {
      if (token === generation.current) setStatus((error instanceof Error ? error.message : 'Adjustment unavailable.').replace(/^Error invoking remote method 'jev:adjust-motion': (?:Error: )?/, ''));
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="motion-adjustment" aria-label="Adjust selected motion">
    <label>Adjust motion<textarea aria-label="Motion instructions" value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={2000} placeholder="E.g. slower, 4 seconds long, constant speed…" disabled={busy} /></label>
    <small>Duration and speed along the path.</small>
    <button disabled={busy || instruction.trim().length < 3} onClick={() => void submit()}>{busy ? 'Updating…' : 'Apply'}</button>
    {status && <output role="status">{status}</output>}
  </section>;
}
