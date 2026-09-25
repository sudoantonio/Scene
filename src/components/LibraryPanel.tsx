import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';

const THUMBNAIL_CACHE_VERSION = 'v3';
const thumbnailCacheKey = (projectId: string, sceneId: string) => `abaco-thumb:${THUMBNAIL_CACHE_VERSION}:${projectId}:${sceneId}`;

function ScenePreview({ frame, number, thumbnail, aspect }: { frame: number; number: number; thumbnail?: string; aspect: number }) {
  const objects = useEditor((state) => state.project.objects);
  const visible = objects.filter((object) => object.kind !== 'audio' && object.kind !== 'camera' && !object.kind.includes('light') && evaluateProperty(object, 'visibility', frame)).slice(0, 9);
  return <div className={`slide-preview ${thumbnail ? 'has-camera-thumbnail' : ''}`} style={{ aspectRatio: String(aspect) }}>{thumbnail && <img className="slide-camera-thumbnail" src={thumbnail} alt="" draggable={false} />}{!thumbnail && visible.map((object) => {
    const transform = evaluateTransform(object, frame);
    const size = Math.max(8, Math.min(32, ((transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3) * 13));
    return <i key={object.id} className={`preview-object ${object.kind}`} style={{ left: `${Math.max(8, Math.min(88, 50 + transform.position[0] * 6))}%`, top: `${Math.max(10, Math.min(84, 54 - transform.position[2] * 7 - transform.position[1] * 2))}%`, width: size, height: object.kind === 'text' ? 5 : size, background: object.color }} />;
  })}<span className="slide-number">{number}</span></div>;
}

export default function LibraryPanel({ collapsed, onToggleCollapse }: { collapsed?: boolean; onToggleCollapse?(): void }) {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const addShot = useEditor((state) => state.addShot);
  const select = useEditor((state) => state.select);
  const setFrame = useEditor((state) => state.setFrame);
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const aspect = project.settings.resolutionX / project.settings.resolutionY;
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  useEffect(() => {
    const cached = Object.fromEntries(scenes.map((scene) => [scene.id, localStorage.getItem(thumbnailCacheKey(project.id, scene.id))]).filter((entry): entry is [string, string] => Boolean(entry[1])));
    setThumbnails(cached);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; sceneId: string; url: string }>).detail;
      if (detail?.projectId === project.id) setThumbnails((current) => ({ ...current, [detail.sceneId]: detail.url }));
    };
    window.addEventListener('abaco:scene-thumbnail', receive);
    return () => window.removeEventListener('abaco:scene-thumbnail', receive);
  }, [project.id, scenes.map((scene) => scene.id).join(':')]);
  if (collapsed) return <aside className="left-panel panel-collapsed"><button title="Open panel" aria-label="Open left panel" onClick={onToggleCollapse}><PanelLeftOpen size={16} /></button></aside>;
  return <aside className="left-panel slides-only">
    <button className="panel-collapse panel-collapse-left" title="Collapse panel" aria-label="Collapse left panel" onClick={onToggleCollapse}><PanelLeftClose size={15} /></button>
    <div className="slides-list">{scenes.map((scene, index) => {
      const end = scenes[index + 1]?.frame ?? project.settings.frameEnd + 1;
      const active = frame >= scene.frame && frame < end;
      return <button key={scene.id} aria-label={`Scene ${index + 1}`} title={`Scene ${index + 1}`} className={`slide-button ${active ? 'active' : ''}`} onClick={() => { setFrame(scene.frame); select(undefined); window.dispatchEvent(new CustomEvent('abaco:select-scene', { detail: { sceneId: scene.id } })); }}><ScenePreview frame={scene.frame} number={index + 1} thumbnail={thumbnails[scene.id]} aspect={aspect} /></button>;
    })}</div>
    <button className="add-slide" aria-label="New scene" title="New scene" onClick={addShot}><Plus size={17} /></button>
  </aside>;
}
