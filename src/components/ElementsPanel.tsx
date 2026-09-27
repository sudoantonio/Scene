import AnimationStandardPanel from './AnimationStandardPanel';
import SceneDirectionInput from './SceneDirectionInput';
import { Box, Circle, Cone, Cylinder, FileBox, Image, Music2, SquareDashed, TextCursorInput, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ObjectKind } from '../domain/schema';
import { combinedSceneDirection, sceneDirectionTargets } from '../domain/scene-direction';
import { useEditor } from '../store/editor';
import { inspectAudio } from '../domain/audio';
import { inspectVideo } from '../domain/video';

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
  const addImage = useEditor((state) => state.addImage);
  const addVideo = useEditor((state) => state.addVideo);
  const addVideoScene = useEditor((state) => state.addVideoScene);
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
  const insertImage = async (space: 'screen' | 'world') => {
    try {
      if (!window.abaco) throw new Error('Image import is available in the desktop app.');
      const image = await window.abaco.chooseBackground('image');
      if (!image) return;
      const dataUrl = await window.abaco.loadAsset(image.path);
      const bitmap = new window.Image();
      const dimensions = new Promise<number>((resolve) => {
        bitmap.onload = () => resolve(bitmap.naturalWidth / Math.max(1, bitmap.naturalHeight));
        bitmap.onerror = () => resolve(1);
      });
      bitmap.src = dataUrl;
      const aspectRatio = await dimensions;
      addImage({ sourcePath: image.path, dataUrl, name: image.name, aspectRatio }, space);
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Image import failed.'); }
  };
  const insertVideo = async (mode: 'screen' | 'world' | 'scene') => {
    try {
      if (!window.abaco) throw new Error('Video import is available in the desktop app.');
      const selected = await window.abaco.chooseVideo();
      if (!selected) return;
      const metadata = await inspectVideo(selected.sourcePath);
      if (mode === 'scene') addVideoScene({ ...selected, duration: metadata.duration });
      else addVideo({ ...selected, duration: metadata.duration, aspectRatio: metadata.aspectRatio }, mode);
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Video import failed.'); }
  };
  return <div className="elements-panel">
    {mode === 'add' ? <section className="add-section">
      <div className="section-heading"><h2>Add element</h2></div>
      <h2>Shapes</h2>
      <div className="shape-row">{shapes.map(({ kind, label, icon: Icon }) => <button key={kind} className="shape-button" draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-scene-shape', kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addObject(kind)}><Icon size={15} /><span>{label}</span></button>)}</div>
      <h2 className="spaced-title">Insert</h2>
      <div className="quick-add">
        <button draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-scene-shape', 'text'); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addObject('text')}><TextCursorInput size={15} /><span>Text</span></button>
        <button onClick={() => void insertImage('screen')}><Image size={15} /><span>Image 2D</span></button>
        <button onClick={() => void insertImage('world')}><Image size={15} /><span>Image 3D</span></button>
        <button onClick={() => void insertVideo('world')}><Video size={15} /><span>Video 3D</span></button>
        <button onClick={() => void insertVideo('screen')}><Video size={15} /><span>Video 2D</span></button>
        <button onClick={() => void insertVideo('scene')}><Video size={15} /><span>Video scene</span></button>
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
      {activeScene && <label className="scene-action-continuity">Action between shots<select aria-label="Action continuity" value={activeScene.actionContinuity ?? 'unspecified'} onChange={event => useEditor.getState().setActionContinuity(activeScene.id, event.target.value as 'unspecified' | 'continue' | 'hold' | 'new_action')}><option value="unspecified">Use scene direction</option><option value="continue">Continue previous action</option><option value="hold">Hold the pose</option><option value="new_action">Start a new action</option></select></label>}
      <AnimationStandardPanel />
    </section>}
  </div>;
}
