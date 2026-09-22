import { useEffect, useState } from 'react';
import { Check, Clipboard, Sparkles } from 'lucide-react';
import type { AbacoProject, SceneObject, Vec3 } from '../domain/schema';
import type { JevActionPlan } from '../domain/jev-action';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';

export default function JevActionPanel({ project, object, sceneId, frame, position }: { project: AbacoProject; object?: SceneObject; sceneId: string; frame: number; position?: Vec3 }) {
  const acceptPlan = useEditor((state) => state.acceptPlan);
  const subjects = project.objects.filter((candidate) => candidate.kind !== 'camera' && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace);
  const [subjectId, setSubjectId] = useState(object?.id ?? '');
  const subject = subjects.find((candidate) => candidate.id === subjectId);
  const subjectPosition = subject ? evaluateTransform(subject, frame).position : undefined;
  const [startPosition, setStartPosition] = useState<Vec3>(position ?? [0, 0, 0]);
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<JevActionPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  useEffect(() => { if (object) setSubjectId(object.id); }, [object?.id]);
  useEffect(() => { setStartPosition(subjectPosition ?? [0, 0, 0]); setPlan(undefined); setApplied(false); }, [subjectId, frame, subjectPosition?.[0], subjectPosition?.[1], subjectPosition?.[2]]);

  const changeAxis = (axis: number, value: number) => setStartPosition((current) => current.map((entry, index) => index === axis ? value : entry) as Vec3);
  const generate = async () => {
    setError(''); setPlan(undefined); setApplied(false);
    if (!instruction.trim()) return setError('Descrivi cosa deve fare il personaggio.');
    if (!window.abaco) return setError('Jev è disponibile nell’app desktop Scene.');
    setBusy(true);
    try {
      setPlan(await window.abaco.generateJevAction({ project, objectId: subject?.id ?? null, sceneId, frame, startPosition: subject ? startPosition : null, instruction }));
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
    <p className="jev-intro">Descrivi la regia della scena. Jev può coordinare il soggetto selezionato e la camera attiva, poi Scene converte le decisioni in keyframe.</p>
    <label className="field"><span>Soggetto di riferimento</span><select aria-label="Soggetto Jev" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">Solo scena e camera</option>{subjects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
    {subject && <div className="jev-position">
      <span>Posizione iniziale</span>
      <div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}><span>{axis}</span><input aria-label={`Jev posizione ${axis}`} type="number" step="0.1" value={Number(startPosition[index].toFixed(3))} onChange={(event) => changeAxis(index, Number(event.target.value))} /></label>)}</div>
    </div>}
    <label className="field"><span>Descrizione della scena</span><textarea aria-label="Azione Jev" rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Esempio: il personaggio arretra mentre la camera avanza lentamente." /></label>
    <button className="jev-generate" disabled={busy || !instruction.trim()} onClick={generate}><Sparkles size={13} />{busy ? 'Jev sta decidendo…' : 'Crea regia'}</button>
    {error && <p className="jev-error">{error}</p>}
    {plan && <div className={`jev-result ${plan.status}`}>
      <header><strong>{plan.status === 'ready' ? 'Azione pronta' : 'Da controllare'}</strong><span>{Math.round(plan.confidence * 100)}% confidenza</span></header>
      <dl>
        {plan.objectId && <><div><dt>Soggetto</dt><dd>{plan.decision.action}</dd></div><div><dt>Direzione</dt><dd>{plan.decision.direction}</dd></div></>}
        {plan.decision.camera?.requested && <><div><dt>Camera</dt><dd>{plan.decision.camera.action}</dd></div><div><dt>Durata camera</dt><dd>{plan.decision.camera.durationSeconds} s</dd></div></>}
        <div><dt>Keyframe</dt><dd>{plan.blenderPlan.operations.length}</dd></div>
      </dl>
      {plan.blenderPlan.warnings.map((warning) => <p className="jev-warning" key={warning}>{warning}</p>)}
      <details><summary>JSON generato</summary><pre>{JSON.stringify(plan, null, 2)}</pre></details>
      <div className="jev-actions"><button className="subtle" onClick={copyJson}><Clipboard size={12} /> Copia JSON</button><button className="primary" disabled={applied} onClick={apply}><Check size={12} /> {applied ? 'Applicata' : 'Applica keyframe'}</button></div>
    </div>}
  </div>;
}
