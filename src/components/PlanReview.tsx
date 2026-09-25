import { AlertTriangle, Check, Sparkles } from 'lucide-react';
import type { BlenderPlan } from '../domain/schema';
import { useEditor } from '../store/editor';
import Modal from './Modal';

export default function PlanReview({ plan, busy, onClose, onApprove }: { plan: BlenderPlan; busy: boolean; onClose(): void; onApprove(): void }) {
  const objects = useEditor((state) => state.project.objects);
  const name = (id: string) => objects.find((object) => object.id === id)?.name ?? id;
  return <Modal title="Review the proposed animation" onClose={onClose} wide>
    <div className="plan-summary"><Sparkles size={20} /><p>{plan.summary}</p></div>
    {(plan.warnings.length > 0 || plan.assumptions.length > 0) && <div className="plan-notes">
      {plan.warnings.map((warning) => <p key={warning}><AlertTriangle size={15} /> {warning}</p>)}
      {plan.assumptions.map((assumption) => <p key={assumption}>Assumption: {assumption}</p>)}
    </div>}
    <div className="operation-list">
      {plan.operations.map((operation) => <article key={operation.id}>
        <span className="operation-frame">F{operation.frame}</span>
        <div><strong>{operation.type === 'set_camera_cut' ? 'Camera cut' : operation.property}</strong><span>{name(operation.objectId)}</span><p>{operation.rationale}</p></div>
        <code>{operation.type === 'set_camera_cut' ? 'CUT' : JSON.stringify(operation.value.vector ?? operation.value.boolean ?? operation.value.text ?? operation.value.number)}</code>
      </article>)}
      {!plan.operations.length && <div className="empty-operations">There are no changes to apply. Review the directions.</div>}
    </div>
    <footer className="modal-actions"><button className="secondary" disabled={busy} onClick={onClose}>Go back</button><button className="primary" disabled={busy || !plan.operations.length} onClick={onApprove}><Check size={16} /> {busy ? 'Creating file…' : 'Create in Blender'}</button></footer>
  </Modal>;
}
