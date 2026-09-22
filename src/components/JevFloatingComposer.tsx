import { ArrowUp, LoaderCircle, Pencil, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';

export default function JevFloatingComposer() {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const selectedId = useEditor((state) => state.selectedId);
  const stroke = useEditor((state) => state.jevStroke);
  const acceptJevPlan = useEditor((state) => state.acceptJevPlan);
  const setStrokeActive = useEditor((state) => state.setJevStrokeActive);
  const setStrokePoints = useEditor((state) => state.setJevStrokePoints);
  const clearStroke = useEditor((state) => state.clearJevStroke);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.find((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1)) ?? scenes[0];
  const selected = useMemo(() => project.objects.find((candidate) => candidate.id === selectedId
    && candidate.kind !== 'audio'
    && !candidate.kind.includes('light')
    && !candidate.screenSpace), [project.objects, selectedId]);
  const target = selected?.kind === 'camera' ? 'camera' : 'subject';
  const canSubmit = Boolean(selected && instruction.trim() && !busy);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (event.key.toLowerCase() === 'j' && !element?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')) {
        event.preventDefault(); inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => { clearStroke(); setMessage(''); }, [selectedId, activeScene?.id]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const generate = async () => {
    const currentInstruction = instruction.trim();
    if (!selected || !activeScene || !currentInstruction || busy) return;
    if (!window.abaco) { setMessage('Jev è disponibile nell’app desktop Scene.'); return; }
    setBusy(true); setMessage('');
    try {
      const startPosition = target === 'subject' ? evaluateTransform(selected, frame).position : null;
      const plan = await window.abaco.generateJevAction({
        project, objectId: selected.id, target, sceneId: activeScene.id, frame, startPosition,
        instruction: currentInstruction,
        gesture: stroke.points.length > 1 ? { points: stroke.points, target, viewMode: stroke.viewMode, viewRotation: stroke.viewRotation, viewPosition: stroke.viewPosition, verticalFovDegrees: stroke.verticalFovDegrees, aspect: stroke.aspect } : undefined,
      });
      if (!plan.blenderPlan.operations.length) throw new Error('Jev non ha trovato un movimento applicabile.');
      acceptJevPlan(plan.blenderPlan, activeScene.id);
      clearStroke(); setInstruction(''); setMessage(`Movimento applicato a ${selected.name}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Jev non ha completato la richiesta.');
    } finally { setBusy(false); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault(); void generate();
  };
  const placeholder = selected
    ? `Descrivi cosa deve fare ${selected.name}…`
    : 'Seleziona una camera o un elemento…';

  if (!activeScene) return null;
  return <div className={`jev-floating-composer ${message ? 'has-message' : ''}`}>
    {message && <div className="jev-composer-message" role="status">{message}</div>}
    <div className="jev-composer-input" aria-label="Input Jev" title={selected ? `Soggetto: ${selected.name}` : 'Seleziona il soggetto nella scena'}>
      <Sparkles className="jev-composer-mark" size={17} />
      <textarea ref={inputRef} aria-label="Azione Jev" rows={1} value={instruction} disabled={!selected || busy} onChange={(event) => setInstruction(event.target.value)} onKeyDown={keyDown} placeholder={busy ? 'Jev sta creando il movimento…' : placeholder} />
      <button className={`jev-composer-tool ${stroke.active || stroke.points.length > 1 ? 'active' : ''}`} aria-label={stroke.points.length > 1 ? 'Ridisegna traiettoria' : 'Disegna traiettoria'} title={stroke.points.length > 1 ? 'Ridisegna traiettoria' : 'Disegna traiettoria'} disabled={!selected || busy} onClick={() => { setStrokePoints([]); setStrokeActive(true); }}><Pencil size={16} /></button>
      <button className="jev-composer-send" aria-label="Crea movimento" title="Crea movimento · Invio" disabled={!canSubmit} onClick={() => void generate()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={17} />}</button>
    </div>
  </div>;
}
