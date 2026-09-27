import { useState } from 'react';
import { Box, Image, Trash2, Video } from 'lucide-react';
import { defaultBackground } from '../domain/schema';
import { useEditor } from '../store/editor';
import { inspectVideo } from '../domain/video';

export default function BackgroundPanel() {
  const [error, setError] = useState('');
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const updateBackground = useEditor((state) => state.updateBackground);
  const updateSettings = useEditor((state) => state.updateSettings);
  const cut = project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((item) => item.frame <= frame);
  const background = cut?.background ?? defaultBackground();
  const formats = [
    { label: '16:9', width: 1920, height: 1080 }, { label: '9:16', width: 1080, height: 1920 },
    { label: '1:1', width: 1080, height: 1080 }, { label: '4:3', width: 1440, height: 1080 }, { label: '21:9', width: 2560, height: 1080 },
  ];
  const ratio = project.settings.resolutionX / project.settings.resolutionY;
  const format = formats.find((item) => Math.abs(item.width / item.height - ratio) < .01)?.label ?? 'custom';
  const choose = async (kind: 'image' | 'model') => {
    const projectId = project.id;
    const sceneId = cut?.id;
    try {
      setError('');
      if (!window.abaco) throw new Error('Background import is available in the desktop app.');
      const selected = await window.abaco.chooseBackground(kind);
      if (selected && sceneId && useEditor.getState().project.id === projectId) updateBackground({ kind, ...selected }, sceneId);
    } catch (reason) { setError((reason as Error).message || 'Could not load the background.'); }
  };
  const chooseVideo = async () => {
    const projectId = project.id;
    const sceneId = cut?.id;
    try {
      setError('');
      if (!window.abaco) throw new Error('Video import is available in the desktop app.');
      const selected = await window.abaco.chooseVideo();
      if (!selected || !sceneId || useEditor.getState().project.id !== projectId) return;
      const metadata = await inspectVideo(selected.sourcePath);
      updateBackground({ kind: 'video', path: selected.sourcePath, name: selected.name }, sceneId);
      const latest = useEditor.getState();
      if (latest.project.cameraCuts.at(-1)?.id === sceneId) latest.updateSettings({ frameEnd: Math.max(latest.project.settings.frameEnd, cut.frame + Math.round(metadata.duration * latest.project.settings.fps) - 1) });
    } catch (reason) { setError((reason as Error).message || 'Could not load the video.'); }
  };
  return <section className="background-panel">
    <span className="scene-subtitle">Background</span>
    <div className="background-actions">
      <div className="scene-aspect"><select aria-label="Frame format" value={format} onChange={(event) => { const next = formats.find((item) => item.label === event.target.value); if (next) updateSettings({ resolutionX: next.width, resolutionY: next.height }); }}>{format === 'custom' && <option value="custom">Custom</option>}{formats.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></div>
      <button onClick={() => choose('image')}><Image size={16} /><span>Image</span></button>
      <button onClick={() => choose('model')}><Box size={16} /><span>3D file</span></button>
      <button onClick={() => void chooseVideo()}><Video size={16} /><span>Video</span></button>
    </div>
    {background.kind !== 'none' && <div className="background-current"><span title={background.path}>{background.name}</span><button aria-label="Remove background" title="Remove" onClick={() => updateBackground(defaultBackground())}><Trash2 size={14} /></button></div>}
    {error && <small className="background-error">{error}</small>}
  </section>;
}
