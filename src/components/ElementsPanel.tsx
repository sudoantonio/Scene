import { Box, Check, Circle, Cone, Cylinder, FileBox, MessageSquare, MessageSquarePlus, SquareDashed, TextCursorInput, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ObjectKind, SceneComment, TimelineCommentScope } from '../domain/schema';
import { useEditor } from '../store/editor';

const shapes: Array<{ kind: ObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'cube', label: 'Cubo', icon: Box }, { kind: 'sphere', label: 'Sfera', icon: Circle },
  { kind: 'cylinder', label: 'Cilindro', icon: Cylinder }, { kind: 'cone', label: 'Cono', icon: Cone },
  { kind: 'plane', label: 'Piano', icon: SquareDashed },
];

export default function ElementsPanel({ mode }: { mode: 'scene' | 'add' }) {
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const addObject = useEditor((state) => state.addObject);
  const addBlendAsset = useEditor((state) => state.addBlendAsset);
  const select = useEditor((state) => state.select);
  const setTimelineComment = useEditor((state) => state.setTimelineComment);
  const [commentEditor, setCommentEditor] = useState<{ scope: TimelineCommentScope; objectId?: string; text: string }>();
  const sceneObjects = project.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light'));
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.filter((scene) => scene.frame <= frame).at(-1);
  const activeCamera = project.objects.find((object) => object.id === activeScene?.cameraId && object.kind === 'camera');
  const commentScope = (comment: SceneComment) => comment.scope ?? (comment.targetIds.length ? 'object' : 'scene');
  const commentSceneId = (comment: SceneComment) => comment.sceneId ?? scenes.filter((scene) => scene.frame <= comment.startFrame).at(-1)?.id;
  const commentFor = (scope: TimelineCommentScope, objectId?: string) => project.comments.find((comment) => comment.kind !== 'transition' && commentScope(comment) === scope && commentSceneId(comment) === activeScene?.id && (scope !== 'object' || comment.targetIds.includes(objectId!)));
  const openComment = (scope: TimelineCommentScope, objectId?: string) => setCommentEditor({ scope, objectId, text: commentFor(scope, objectId)?.text ?? '' });
  const saveComment = () => {
    if (!commentEditor || !activeScene || !commentEditor.text.trim()) return;
    setTimelineComment(commentEditor.scope, activeScene.id, commentEditor.text, commentEditor.objectId);
    setCommentEditor(undefined);
  };
  const removeComment = (scope: TimelineCommentScope, objectId?: string) => {
    if (!activeScene) return;
    setTimelineComment(scope, activeScene.id, '', objectId);
    setCommentEditor(undefined);
  };
  const CommentControl = ({ scope, label, objectId }: { scope: TimelineCommentScope; label: string; objectId?: string }) => {
    const comment = commentFor(scope, objectId);
    const editing = commentEditor?.scope === scope && commentEditor.objectId === objectId;
    return <div className={`scenography-comment-control ${comment ? 'has-comment' : ''}`}>
      {!editing && <button className={comment ? 'scenography-comment-preview' : 'scenography-add-comment'} disabled={!activeScene} title={comment ? `Modifica commento ${label}` : `Aggiungi commento ${label}`} onClick={() => openComment(scope, objectId)}>{comment ? <MessageSquare size={12} /> : <MessageSquarePlus size={12} />}<span>{comment ? comment.text : `Commento ${label}`}</span></button>}
      {editing && <div className="scenography-comment-editor">
        <textarea autoFocus placeholder={`Indicazione ${label}`} value={commentEditor.text} onChange={(event) => setCommentEditor({ ...commentEditor, text: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveComment(); if (event.key === 'Escape') setCommentEditor(undefined); }} />
        <div><button className="icon" title="Annulla" onClick={() => setCommentEditor(undefined)}><X size={13} /></button>{comment && <button className="icon danger" title="Elimina commento" onClick={() => removeComment(scope, objectId)}><Trash2 size={13} /></button>}<button className="subtle" disabled={!commentEditor.text.trim()} onClick={saveComment}><Check size={13} /> Salva</button></div>
      </div>}
    </div>;
  };
  return <div className="elements-panel">
    {mode === 'add' ? <section className="add-section">
      <div className="section-heading"><h2>Aggiungi elemento</h2></div>
      <h2>Forme</h2>
      <div className="shape-row">{shapes.map(({ kind, label, icon: Icon }) => <button key={kind} className="shape-button" onClick={() => addObject(kind)}><Icon size={15} /><span>{label}</span></button>)}</div>
      <h2 className="spaced-title">Inserisci</h2>
      <div className="quick-add">
        <button onClick={() => addObject('text')}><TextCursorInput size={15} /><span>Testo</span></button>
        <button onClick={async () => {
          try {
            if (!window.abaco) throw new Error('L’importazione .blend è disponibile nell’app desktop.');
            const asset = await window.abaco.chooseBlendAsset();
            if (asset) addBlendAsset(asset);
          } catch (error) { window.alert(error instanceof Error ? error.message : 'Importazione Blender non riuscita.'); }
        }}><FileBox size={15} /><span>Asset Blender</span></button>
      </div>
  </section> : <section className="outliner-section scene-elements-section">
      <div className="scenography-context-comments"><span>Commenti scena</span><CommentControl scope="scene" label={activeScene?.name ?? 'scena'} /><CommentControl scope="framing" label={activeCamera?.name ?? 'camera'} /></div>
      <div className="outliner scenography-outliner">{sceneObjects.map((object) => {
        return <div key={object.id} className={`scenography-object ${selectedId === object.id ? 'selected' : ''}`}>
          <button className="outliner-item" onClick={() => select(object.id)}><span className={`kind-dot ${object.kind}`} /><span>{object.name}</span></button>
          <CommentControl scope="object" label={object.name} objectId={object.id} />
        </div>;
      })}</div>
    </section>}
  </div>;
}
