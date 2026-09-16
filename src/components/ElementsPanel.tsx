import AnimationStandardPanel from './AnimationStandardPanel';
import DirectionInput, { DirectionPreview } from './DirectionInput';
import { Box, Check, Circle, Cone, Cylinder, FileBox, Image, MessageSquare, Music2, SquareDashed, TextCursorInput, Trash2, Video } from 'lucide-react';
import { useState } from 'react';
import type { ObjectKind, SceneComment, TimelineCommentScope } from '../domain/schema';
import { useEditor } from '../store/editor';
import { evaluateProperty } from '../domain/animation';
import { inspectAudio } from '../domain/audio';

const shapes: Array<{ kind: ObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'cube', label: 'Cubo', icon: Box }, { kind: 'sphere', label: 'Sfera', icon: Circle },
  { kind: 'cylinder', label: 'Cilindro', icon: Cylinder }, { kind: 'cone', label: 'Cono', icon: Cone },
  { kind: 'plane', label: 'Piano', icon: SquareDashed },
];

type CommentDraft = { sceneId: string; scope: TimelineCommentScope; objectId?: string; text: string };

// Keep this component's identity stable while typing: declaring it inside
// ElementsPanel remounted the textarea on every change and lost its focus.
function SceneCommentControl({ scope, label, prompt, comment, text, disabled, onEdit, onChange, onCancel, onSave, onRemove }: {
  scope: TimelineCommentScope; label: string; prompt: string; comment?: SceneComment; text?: string; disabled: boolean;
  onEdit(): void; onChange(value: string): void; onCancel(): void; onSave(): void; onRemove(): void;
}) {
  return <div className={`scenography-comment-control ${comment ? 'has-comment' : ''}`}>
    {text === undefined ? <button className={comment ? 'scenography-comment-preview' : 'scenography-add-comment'} disabled={disabled} title={comment ? `Modifica commento ${label}` : `Aggiungi commento ${label}`} onClick={onEdit}>{comment ? <DirectionPreview value={comment.text} scope={scope} /> : <span>{prompt}</span>}</button> : <div className="scenography-comment-editor">
      <DirectionInput scope={scope} label={`Indicazione ${label}`} value={text} onChange={onChange} onSave={onSave} onClose={onCancel} />
      <div className="scenography-comment-actions">{comment && <button className="icon danger" title="Elimina commento" onClick={onRemove}><Trash2 size={13} /></button>}<button className="subtle comment-cancel" onClick={onCancel}>Annulla</button><button className="subtle comment-save" disabled={!text.trim()} onClick={onSave}><Check size={13} /> Salva</button></div>
    </div>}
  </div>;
}

export default function ElementsPanel({ mode }: { mode: 'scene' | 'add' }) {
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const addObject = useEditor((state) => state.addObject);
  const addBlendAsset = useEditor((state) => state.addBlendAsset);
  const addScreenImage = useEditor((state) => state.addScreenImage);
  const addAudio = useEditor((state) => state.addAudio);
  const select = useEditor((state) => state.select);
  const setTimelineComment = useEditor((state) => state.setTimelineComment);
  const [commentEditor, setCommentEditor] = useState<CommentDraft>();
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.filter((scene) => scene.frame <= frame).at(-1);
  const sceneEnd = scenes.find((scene) => scene.frame > frame)?.frame ?? project.settings.frameEnd + 1;
  const sceneObjects = project.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light') && activeScene && (object.sceneIds.length === 0 || object.sceneIds.includes(activeScene.id)) && (
    evaluateProperty(object, 'visibility', activeScene.frame) || object.keyframes.some((key) => key.property === 'visibility' && key.value === true && key.frame > activeScene.frame && key.frame < sceneEnd)
  ));
  const activeCamera = project.objects.find((object) => object.id === activeScene?.cameraId && object.kind === 'camera');
  const commentScope = (comment: SceneComment) => comment.scope ?? (comment.targetIds.length ? 'object' : 'scene');
  const commentSceneId = (comment: SceneComment) => comment.sceneId ?? scenes.filter((scene) => scene.frame <= comment.startFrame).at(-1)?.id;
  const commentFor = (scope: TimelineCommentScope, objectId?: string) => project.comments.find((comment) => comment.kind !== 'transition' && commentScope(comment) === scope && commentSceneId(comment) === activeScene?.id && (scope !== 'object' || comment.targetIds.includes(objectId!)));
  const openComment = (scope: TimelineCommentScope, objectId?: string) => activeScene && setCommentEditor({ sceneId: activeScene.id, scope, objectId, text: commentFor(scope, objectId)?.text ?? '' });
  const saveComment = () => {
    if (!commentEditor || !commentEditor.text.trim()) return;
    setTimelineComment(commentEditor.scope, commentEditor.sceneId, commentEditor.text, commentEditor.objectId);
    setCommentEditor(undefined);
  };
  const removeComment = (scope: TimelineCommentScope, objectId?: string) => {
    if (!activeScene) return;
    setTimelineComment(scope, activeScene.id, '', objectId);
    setCommentEditor(undefined);
  };
  const renderComment = (scope: TimelineCommentScope, label: string, objectId?: string) => {
    const comment = commentFor(scope, objectId);
    const editing = commentEditor?.sceneId === activeScene?.id && commentEditor?.scope === scope && commentEditor.objectId === objectId;
    const prompt = scope === 'scene' ? 'Descrivi la scena' : scope === 'framing' ? 'Descrivi il movimento camera' : `Descrivi il movimento di ${label}`;
    return <SceneCommentControl scope={scope} label={label} prompt={prompt} comment={comment} text={editing ? commentEditor.text : undefined} disabled={!activeScene} onEdit={() => openComment(scope, objectId)} onChange={(text) => setCommentEditor((current) => current && { ...current, text })} onCancel={() => setCommentEditor(undefined)} onSave={saveComment} onRemove={() => removeComment(scope, objectId)} />;
  };
  return <div className="elements-panel">
    {mode === 'add' ? <section className="add-section">
      <div className="section-heading"><h2>Aggiungi elemento</h2></div>
      <h2>Forme</h2>
      <div className="shape-row">{shapes.map(({ kind, label, icon: Icon }) => <button key={kind} className="shape-button" onClick={() => addObject(kind)}><Icon size={15} /><span>{label}</span></button>)}</div>
      <h2 className="spaced-title">Inserisci</h2>
      <div className="quick-add">
        <button onClick={() => addObject('text')}><TextCursorInput size={15} /><span>Testo</span></button>
        <button onClick={async () => { try { if (!window.abaco) throw new Error('L’importazione immagini è disponibile nell’app desktop.'); const image = await window.abaco.chooseBackground('image'); if (image) addScreenImage({ sourcePath: image.path, dataUrl: await window.abaco.loadAsset(image.path), name: image.name }); } catch (error) { window.alert(error instanceof Error ? error.message : 'Importazione immagine non riuscita.'); } }}><Image size={15} /><span>Immagine</span></button>
        <button onClick={async () => {
          try {
            if (!window.abaco) throw new Error('L’importazione .blend è disponibile nell’app desktop.');
            const asset = await window.abaco.chooseBlendAsset();
            if (asset) addBlendAsset(asset);
          } catch (error) { window.alert(error instanceof Error ? error.message : 'Importazione Blender non riuscita.'); }
        }}><FileBox size={15} /><span>Asset Blender</span></button>
        <button onClick={async () => {
          try {
            if (!window.abaco) throw new Error('L’importazione audio è disponibile nell’app desktop.');
            const asset = await window.abaco.chooseAudio();
            if (!asset) return;
            const source = await window.abaco.loadAsset(asset.sourcePath);
            const analysis = await inspectAudio(source);
            addAudio({ ...asset, ...analysis });
            window.dispatchEvent(new Event('abaco:edit-audio'));
          } catch (error) { window.alert(error instanceof Error ? error.message : 'Importazione audio non riuscita.'); }
        }}><Music2 size={15} /><span>Audio</span></button>
      </div>
  </section> : <section className="outliner-section scene-elements-section">
      <details className="scenography-standard"><summary>Standard animazione{project.animationStandard ? ' · Allegato' : ''}</summary><AnimationStandardPanel /></details>
      <h3 className="inspector-list-heading">Regia</h3>
      <div className="scenography-context-comments">
        <article className="scenography-note-card"><div className="scenography-note-title"><MessageSquare size={14} /><strong>Scena</strong></div>{renderComment('scene', activeScene?.name ?? 'scena')}</article>
        <article className="scenography-note-card"><div className="scenography-note-title"><Video size={14} /><strong>Camera</strong></div>{renderComment('framing', activeCamera?.name ?? 'camera')}</article>
      </div>
      <h3 className="inspector-list-heading">Elementi <span>{sceneObjects.length}</span></h3>
      <div className="outliner scenography-outliner">{sceneObjects.map((object) => {
        return <div key={object.id} className={`scenography-object ${selectedId === object.id ? 'selected' : ''}`}>
          <button className="outliner-item" aria-label={`Seleziona ${object.name}`} onClick={() => { select(object.id); if (object.kind === 'audio') window.dispatchEvent(new Event('abaco:edit-audio')); }}>{object.kind === 'audio' ? <Music2 size={14} /> : object.kind === 'text' ? <TextCursorInput size={14} /> : object.screenSpace ? <Image size={14} /> : <Box size={14} />}<span>{object.name}</span></button>
          {renderComment('object', object.name, object.id)}
        </div>;
      })}</div>
      {!sceneObjects.length && <p className="inspector-help">Nessun elemento in questa scena.</p>}
    </section>}
  </div>;
}
