import AnimationStandardPanel from './AnimationStandardPanel';
import SceneDirectionInput from './SceneDirectionInput';
import { Box, Check, Circle, Cone, Cylinder, FileBox, Image, MessageSquare, Music2, SquareDashed, TextCursorInput } from 'lucide-react';
import { useState } from 'react';
import type { ObjectKind } from '../domain/schema';
import { combinedSceneDirection, sceneDirectionComments, sceneDirectionTargets } from '../domain/scene-direction';
import { useEditor } from '../store/editor';
import { evaluateProperty } from '../domain/animation';
import { inspectAudio } from '../domain/audio';

const shapes: Array<{ kind: ObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'cube', label: 'Cube', icon: Box }, { kind: 'sphere', label: 'Sphere', icon: Circle },
  { kind: 'cylinder', label: 'Cylinder', icon: Cylinder }, { kind: 'cone', label: 'Cone', icon: Cone },
  { kind: 'plane', label: 'Plane', icon: SquareDashed },
];

export default function ElementsPanel({ mode }: { mode: 'scene' | 'add' }) {
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const addObject = useEditor((state) => state.addObject);
  const addBlendAsset = useEditor((state) => state.addBlendAsset);
  const addScreenImage = useEditor((state) => state.addScreenImage);
  const addAudio = useEditor((state) => state.addAudio);
  const select = useEditor((state) => state.select);
  const setSceneDirection = useEditor((state) => state.setSceneDirection);
  const [directionDrafts, setDirectionDrafts] = useState<Record<string, string>>({});
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.filter((scene) => scene.frame <= frame).at(-1);
  const sceneEnd = scenes.find((scene) => scene.frame > frame)?.frame ?? project.settings.frameEnd + 1;
  const sceneObjects = project.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light') && activeScene && (object.sceneIds.length === 0 || object.sceneIds.includes(activeScene.id)) && (
    evaluateProperty(object, 'visibility', activeScene.frame) || object.keyframes.some((key) => key.property === 'visibility' && key.value === true && key.frame > activeScene.frame && key.frame < sceneEnd)
  ));
  const savedDirection = activeScene ? combinedSceneDirection(project, activeScene.id) : '';
  const directionDraft = activeScene ? directionDrafts[activeScene.id] ?? savedDirection : '';
  const directionComments = activeScene ? sceneDirectionComments(project, activeScene.id) : [];
  const directionChanged = Boolean(activeScene && (directionDraft !== savedDirection || directionComments.some((comment) => comment.scope !== 'scene')));
  const saveDirection = () => {
    if (!activeScene || !directionChanged) return;
    setSceneDirection(activeScene.id, directionDraft);
    setDirectionDrafts((current) => ({ ...current, [activeScene.id]: directionDraft.trim() }));
  };
  return <div className="elements-panel">
    {mode === 'add' ? <section className="add-section">
      <div className="section-heading"><h2>Add element</h2></div>
      <h2>Shapes</h2>
      <div className="shape-row">{shapes.map(({ kind, label, icon: Icon }) => <button key={kind} className="shape-button" onClick={() => addObject(kind)}><Icon size={15} /><span>{label}</span></button>)}</div>
      <h2 className="spaced-title">Insert</h2>
      <div className="quick-add">
        <button onClick={() => addObject('text')}><TextCursorInput size={15} /><span>Text</span></button>
        <button onClick={async () => { try { if (!window.abaco) throw new Error('Image import is available in the desktop app.'); const image = await window.abaco.chooseBackground('image'); if (image) addScreenImage({ sourcePath: image.path, dataUrl: await window.abaco.loadAsset(image.path), name: image.name }); } catch (error) { window.alert(error instanceof Error ? error.message : 'Image import failed.'); } }}><Image size={15} /><span>Image</span></button>
        <button onClick={async () => {
          try {
            if (!window.abaco) throw new Error('.blend import is available in the desktop app.');
            const asset = await window.abaco.chooseBlendAsset();
            if (asset) addBlendAsset(asset);
          } catch (error) { window.alert(error instanceof Error ? error.message : 'Blender import failed.'); }
        }}><FileBox size={15} /><span>Blender asset</span></button>
        <button onClick={async () => {
          try {
            if (!window.abaco) throw new Error('Audio import is available in the desktop app.');
            const asset = await window.abaco.chooseAudio();
            if (!asset) return;
            const source = await window.abaco.loadAsset(asset.sourcePath);
            const analysis = await inspectAudio(source);
            addAudio({ ...asset, ...analysis });
            window.dispatchEvent(new Event('abaco:edit-audio'));
          } catch (error) { window.alert(error instanceof Error ? error.message : 'Audio import failed.'); }
        }}><Music2 size={15} /><span>Audio</span></button>
      </div>
  </section> : <section className="outliner-section scene-elements-section">
      <div className="scene-direction-card">
        <div className="scene-direction-heading"><MessageSquare size={16} /><div><strong>Scene direction</strong><span>One description for the scene and everyone in it</span></div></div>
        <SceneDirectionInput value={directionDraft} onChange={(text) => activeScene && setDirectionDrafts((current) => ({ ...current, [activeScene.id]: text }))} onSave={saveDirection} targets={activeScene ? sceneDirectionTargets(project, activeScene.id) : []} selectedId={selectedId} />
        <div className="scene-direction-actions"><span>{directionChanged ? 'Unsaved changes' : directionComments.length ? 'Saved for this scene' : 'No direction yet'}</span><button className="scene-direction-save" disabled={!directionChanged} onClick={saveDirection}><Check size={14} /> Save direction</button></div>
      </div>
      <div className="scene-elements-heading"><h3>In this scene</h3><span>{sceneObjects.length} elements</span></div>
      <div className="outliner scenography-outliner">{sceneObjects.map((object) => <button key={object.id} className={`scenography-object ${selectedId === object.id ? 'selected' : ''}`} aria-label={`Select ${object.name}`} onClick={() => { select(object.id); if (object.kind === 'audio') window.dispatchEvent(new Event('abaco:edit-audio')); }}>{object.kind === 'audio' ? <Music2 size={14} /> : object.kind === 'text' ? <TextCursorInput size={14} /> : object.screenSpace ? <Image size={14} /> : <Box size={14} />}<span>{object.name}</span></button>)}</div>
      {!sceneObjects.length && <p className="inspector-help">No elements in this scene.</p>}
      <details className="scenography-standard"><summary>Animation standard{project.animationStandard ? ' · Attached' : ''}</summary><AnimationStandardPanel /></details>
    </section>}
  </div>;
}
