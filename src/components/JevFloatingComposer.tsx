import { Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';
import JevActionPanel from './JevActionPanel';

export default function JevFloatingComposer() {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const selectedId = useEditor((state) => state.selectedId);
  const [open, setOpen] = useState(false);
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const activeScene = scenes.find((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1)) ?? scenes[0];
  const object = project.objects.find((candidate) => candidate.id === selectedId && candidate.kind !== 'camera' && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace);
  const position = object ? evaluateTransform(object, frame).position : undefined;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() === 'j' && !target?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) setOpen(true);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  if (!activeScene) return null;
  return <div className={`jev-floating-composer ${open ? 'open' : ''}`} onMouseEnter={() => setOpen(true)}>
    {!open && <button className="jev-floating-trigger" aria-label="Apri Jev" onClick={() => setOpen(true)}><Sparkles size={16} /><span>Descrivi la scena a Jev…</span><kbd>J</kbd></button>}
    {open && <section className="jev-floating-main" aria-label="Pannello principale Jev">
      <header><div><Sparkles size={15} /><span>Jev</span><small>{activeScene.name ?? 'Scena'}</small></div><button aria-label="Chiudi Jev" title="Chiudi" onClick={() => setOpen(false)}><X size={15} /></button></header>
      <div className="jev-floating-scroll"><JevActionPanel project={project} object={object} sceneId={activeScene.id} frame={frame} position={position} /></div>
    </section>}
  </div>;
}
