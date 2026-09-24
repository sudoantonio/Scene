import { ArrowUp, ChevronDown, ChevronUp, LoaderCircle, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { evaluateTransform } from '../domain/animation';
import { semanticMotionLabel, type DecisionEngine } from '../domain/jev-action';
import { useEditor } from '../store/editor';

const engineStorageKey = 'scene-decision-engine';
const formatDuration = (milliseconds: number) => milliseconds < 1_000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(2)} s`;

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
  const [engine, setEngine] = useState<DecisionEngine>(() => window.localStorage.getItem(engineStorageKey) === 'laya' ? 'laya' : 'jev');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editingAction, setEditingAction] = useState<{ planId: string; actionId: string; frame: number }>();
  const [directionMode, setDirectionMode] = useState<'new' | 'refine' | 'continue'>('new');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.find((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1)) ?? scenes[0];
  const selected = useMemo(() => project.objects.find((candidate) => candidate.id === selectedId
    && candidate.kind !== 'audio'
    && !candidate.kind.includes('light')
    && !candidate.screenSpace), [project.objects, selectedId]);
  const target = selected?.kind === 'camera' ? 'camera' : 'subject';
  const engineLabel = engine === 'laya' ? 'Laya' : 'Jev';
  const savedDirection = project.directionPlans?.find((plan) => plan.objectId === selectedId && plan.sceneId === activeScene?.id);
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
  useEffect(() => { clearStroke(); setMessage(''); setEditingAction(undefined); setDirectionMode('new'); }, [selectedId, activeScene?.id]);
  useEffect(() => { if (savedDirection && directionMode === 'new') setDirectionMode('refine'); }, [savedDirection?.id]);
  useEffect(() => { window.localStorage.setItem(engineStorageKey, engine); }, [engine]);
  useEffect(() => window.abaco?.onLayaProgress?.(({ file, received, total }) => {
    const percent = total ? ` · ${Math.min(100, Math.round(received / total * 100))}%` : '';
    setMessage(`Laya · download iniziale ${file}${percent}`);
  }), []);
  useEffect(() => {
    if (!message || busy) return;
    const timeout = window.setTimeout(() => setMessage(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const generate = async () => {
    const currentInstruction = instruction.trim();
    if (!selected || !activeScene || !currentInstruction || busy) return;
    if (!window.abaco) { setMessage(`${engineLabel} è disponibile nell’app desktop Scene.`); return; }
    setBusy(true); setMessage('');
    try {
      const requestFrame = editingAction?.frame ?? (savedDirection && directionMode === 'continue' ? savedDirection.endFrame : frame);
      const startPosition = target === 'subject' ? evaluateTransform(selected, requestFrame).position : null;
      const plan = await window.abaco.generateJevAction({
        project, engine, objectId: selected.id, target, sceneId: activeScene.id, frame: requestFrame, startPosition,
        directionPlanId: editingAction?.planId ?? (directionMode === 'new' ? undefined : savedDirection?.id), editActionId: editingAction?.actionId,
        directionMode: editingAction ? 'refine' : directionMode,
        instruction: currentInstruction,
        gesture: stroke.points.length > 1 ? { points: stroke.points, target, viewMode: stroke.viewMode, viewRotation: stroke.viewRotation, viewPosition: stroke.viewPosition, verticalFovDegrees: stroke.verticalFovDegrees, aspect: stroke.aspect } : undefined,
      });
      if (!plan.blenderPlan.operations.length) throw new Error(`${engineLabel} non ha trovato un movimento applicabile.`);
      acceptJevPlan(plan.blenderPlan, activeScene.id);
      const timing = plan.performance
        ? plan.performance.modelLoadMs > 1_000
          ? ` · totale ${formatDuration(plan.performance.totalMs)}, decisione ${formatDuration(plan.performance.decisionMs)}`
          : ` · ${formatDuration(plan.performance.decisionMs)}`
        : '';
      const sequence = plan.decision?.sequence;
      const motionSummary = sequence?.reduce((summary, step, index) => `${summary}${index ? step.relation === 'with' ? ' + ' : ' → ' : ''}${semanticMotionLabel(step.motion)}${step.referenceName ? ` ${step.referenceName}` : ''}`, '')
        ?? (plan.decision?.motion ? `${semanticMotionLabel(plan.decision.motion)}${plan.decision.reference?.name ? ` ${plan.decision.reference.name}` : ''}` : '');
      const interpretation = motionSummary ? `: ${motionSummary}` : '';
      clearStroke(); setInstruction(''); setEditingAction(undefined); setDirectionMode('refine'); setMessage(`${engineLabel} · Movimento applicato${interpretation} a ${selected.name}${timing}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `${engineLabel} non ha completato la richiesta.`);
    } finally { setBusy(false); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault(); void generate();
  };
  const placeholder = selected
    ? `${selected.name}: descrivi cosa deve fare…`
    : 'Seleziona una camera o un elemento…';

  if (!activeScene) return null;
  if (collapsed) return <div className="jev-floating-composer collapsed"><button className="jev-composer-expand" aria-label="Espandi input AI" title="Espandi input AI" onClick={() => setCollapsed(false)}><ChevronUp size={15} /><span>AI</span></button></div>;
  return <div className={`jev-floating-composer ${message ? 'has-message' : ''}`}>
    {savedDirection && !message && !editingAction && <details className="jev-direction-editor">
      <summary>Regia · {savedDirection.actions.length} movimenti</summary>
      <div>{savedDirection.actions.map((action, index) => <button key={action.id} type="button" disabled={busy} onClick={() => {
        setEditingAction({ planId: savedDirection.id, actionId: action.id, frame: savedDirection.startFrame });
        setInstruction(action.instruction); inputRef.current?.focus();
      }}>{index + 1}. {semanticMotionLabel(action.motion)} · {action.durationSeconds.toFixed(1)} s {action.keepInFrame ? '· soggetto inquadrato' : ''}</button>)}</div>
    </details>}
    {editingAction && !message && <div className="jev-composer-message">Correggi il movimento selezionato <button type="button" disabled={busy} onClick={() => { setEditingAction(undefined); setInstruction(''); setDirectionMode('refine'); }}>Annulla</button></div>}
    {message && <div className="jev-composer-message" role="status">{message}</div>}
    <div className="jev-composer-input" aria-label="Input azione" title={selected ? `Soggetto: ${selected.name}` : 'Seleziona il soggetto nella scena'}>
      <select className="decision-engine-switch" aria-label="Modello azione" value={engine} disabled={busy} onChange={(event) => setEngine(event.target.value as DecisionEngine)}>
        <option value="jev">Jev</option>
        <option value="laya">Laya</option>
      </select>
      {savedDirection && !editingAction && <select className="jev-direction-mode" aria-label="Tipo richiesta" value={directionMode} disabled={busy} onChange={(event) => setDirectionMode(event.target.value as typeof directionMode)}>
        <option value="refine">Aggiungi dettagli</option>
        <option value="continue">Continua movimento</option>
        <option value="new">Nuovo movimento</option>
      </select>}
      <textarea ref={inputRef} aria-label={`Azione ${engineLabel}`} rows={1} value={instruction} disabled={!selected || busy} onChange={(event) => setInstruction(event.target.value)} onKeyDown={keyDown} placeholder={busy ? `${engineLabel} sta creando il movimento…` : placeholder} />
      <button className="jev-composer-collapse" aria-label="Riduci input AI" title="Riduci input AI" onClick={() => { setStrokeActive(false); setCollapsed(true); inputRef.current?.blur(); }}><ChevronDown size={15} /></button>
      <button className={`jev-composer-tool ${stroke.active || stroke.points.length > 1 ? 'active' : ''}`} aria-label={stroke.points.length > 1 ? 'Ridisegna traiettoria' : 'Disegna traiettoria'} title={stroke.points.length > 1 ? 'Ridisegna traiettoria' : 'Disegna traiettoria'} disabled={!selected || busy} onClick={() => { setStrokePoints([]); setStrokeActive(true); }}><Pencil size={16} /></button>
      <button className="jev-composer-send" aria-label="Crea movimento" title="Crea movimento · Invio" disabled={!canSubmit} onClick={() => void generate()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={17} />}</button>
    </div>
  </div>;
}
