import AnimationStandardPanel from './AnimationStandardPanel';
import SceneDirectionInput from './SceneDirectionInput';
import { Box, Circle, Cone, Cylinder, FileBox, Image, Music2, SquareDashed, TextCursorInput } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ObjectKind } from '../domain/schema';
import { combinedSceneDirection, sceneDirectionTargets } from '../domain/scene-direction';
import { useEditor } from '../store/editor';
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
  const setSceneDirection = useEditor((state) => state.setSceneDirection);
  const [directionDrafts, setDirectionDrafts] = useState<Record<string, string>>({});
  const pendingSaves = useRef(new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => () => {
    for (const [sceneId, pending] of pendingSaves.current) {
      clearTimeout(pending.timer);
      useEditor.getState().setSceneDirection(sceneId, pending.text);
    }
    pendingSaves.current.clear();
  }, []);
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.filter((scene) => scene.frame <= frame).at(-1);
  const savedDirection = activeScene ? combinedSceneDirection(project, activeScene.id) : '';
  const directionDraft = activeScene ? directionDrafts[activeScene.id] ?? savedDirection : '';
  const changeDirection = (text: string) => {
    if (!activeScene) return;
    const sceneId = activeScene.id;
    setDirectionDrafts((current) => ({ ...current, [sceneId]: text }));
    const previous = pendingSaves.current.get(sceneId);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      pendingSaves.current.delete(sceneId);
      if (combinedSceneDirection(useEditor.getState().project, sceneId) !== text) setSceneDirection(sceneId, text);
      setDirectionDrafts((current) => {
        if (current[sceneId] !== text) return current;
        const updated = { ...current };
        delete updated[sceneId];
        return updated;
      });
    }, 350);
    pendingSaves.current.set(sceneId, { text, timer });
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
        <div className="scene-direction-heading"><strong>Scene direction</strong></div>
        <SceneDirectionInput value={directionDraft} onChange={changeDirection} targets={activeScene ? sceneDirectionTargets(project, activeScene.id) : []} selectedId={selectedId} />
      </div>
      <AnimationStandardPanel />
    </section>}
  </div>;
}
