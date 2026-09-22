import { useEffect, useState } from 'react';
import { Check, Clipboard, Sparkles } from 'lucide-react';
import type { AbacoProject, SceneObject, Vec3 } from '../domain/schema';
import type { JevActionPlan } from '../domain/jev-action';
import { useEditor } from '../store/editor';

export default function JevActionPanel({ project, object, sceneId, frame, position }: { project: AbacoProject; object: SceneObject; sceneId: string; frame: number; position: Vec3 }) {
  const acceptPlan = useEditor((state) => state.acceptPlan);
  const [startPosition, setStartPosition] = useState<Vec3>(position);
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<JevActionPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  useEffect(() => { setStartPosition(position); setPlan(undefined); setApplied(false); }, [object.id, frame, position[0], position[1], position[2]]);

  const changeAxis = (axis: number, value: number) => setStartPosition((current) => current.map((entry, index) => index === axis ? value : entry) as Vec3);
  const generate = async () => {
    setError(''); setPlan(undefined); setApplied(false);
    if (!instruction.trim()) return setError('Descrivi cosa deve fare il personaggio.');
    if (!window.abaco) return setError('Jev è disponibile nell’app desktop Scene.');
    setBusy(true);
    try {
      setPlan(await window.abaco.generateJevAction({ project, objectId: object.id, sceneId, frame, startPosition, instruction }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Jev non ha completato la richiesta.');
    } finally { setBusy(false); }
  };
  const apply = () => {
    if (!plan) return;
    acceptPlan(plan.blenderPlan); setApplied(true);
  };
  const copyJson = async () => {
    if (plan) await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
  };

  return <div className="jev-action-panel">
    <p className="jev-intro">Scrivi un’azione. Jev sceglie movimento, direzione, distanza e ritmo; Scene li converte in keyframe.</p>
    <div className="jev-position">
      <span>Posizione iniziale</span>
      <div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}><span>{axis}</span><input aria-label={`Jev posizione ${axis}`} type="number" step="0.1" value={Number(startPosition[index].toFixed(3))} onChange={(event) => changeAxis(index, Number(event.target.value))} /></label>)}</div>
    </div>
    <label className="field"><span>Cosa fa {object.name}</span><textarea aria-label="Azione Jev" rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Esempio: corre a destra per circa due metri, poi si ferma." /></label>
    <button className="jev-generate" disabled={busy || !instruction.trim()} onClick={generate}><Sparkles size={13} />{busy ? 'Jev sta decidendo…' : 'Crea azione'}</button>
    {error && <p className="jev-error">{error}</p>}
    {plan && <div className={`jev-result ${plan.status}`}>
      <header><strong>{plan.status === 'ready' ? 'Azione pronta' : 'Da controllare'}</strong><span>{Math.round(plan.confidence * 100)}% confidenza</span></header>
      <dl>
        <div><dt>Azione</dt><dd>{plan.decision.action}</dd></div><div><dt>Direzione</dt><dd>{plan.decision.direction}</dd></div>
        <div><dt>Distanza</dt><dd>{plan.decision.distanceMeters} m</dd></div><div><dt>Durata</dt><dd>{plan.decision.durationSeconds} s</dd></div>
      </dl>
      {plan.blenderPlan.warnings.map((warning) => <p className="jev-warning" key={warning}>{warning}</p>)}
      <details><summary>JSON generato</summary><pre>{JSON.stringify(plan, null, 2)}</pre></details>
      <div className="jev-actions"><button className="subtle" onClick={copyJson}><Clipboard size={12} /> Copia JSON</button><button className="primary" disabled={applied} onClick={apply}><Check size={12} /> {applied ? 'Applicata' : 'Applica keyframe'}</button></div>
    </div>}
  </div>;
}
