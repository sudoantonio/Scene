import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Palette } from 'lucide-react';
import type { LightingSettings } from '../domain/schema';
import { useEditor } from '../store/editor';

type LightingPreset = LightingSettings['preset'];

const presets: Array<{ id: LightingPreset; label: string; settings: LightingSettings }> = [
  { id: 'neutral', label: 'Neutra', settings: { preset: 'neutral', intensity: 1, direction: 45, elevation: 45, color: '#ffffff' } },
  { id: 'soft', label: 'Morbida', settings: { preset: 'soft', intensity: .75, direction: 30, elevation: 60, color: '#fff1dc' } },
  { id: 'warm', label: 'Calda', settings: { preset: 'warm', intensity: 1.1, direction: 50, elevation: 35, color: '#ffc98f' } },
  { id: 'dramatic', label: 'Drammatica', settings: { preset: 'dramatic', intensity: 1.35, direction: -65, elevation: 18, color: '#ffd0b5' } },
];

export default function LightingPanel() {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const updateLighting = useEditor((state) => state.updateLighting);
  const ballRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ direction: number; elevation: number }>();
  const scene = project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((cut) => cut.frame <= frame);
  if (!scene) return null;
  const lighting = scene.lighting;
  const direction = preview?.direction ?? lighting.direction;
  const elevation = preview?.elevation ?? lighting.elevation;
  const radius = ((90 - elevation) / 90) * 42;
  const angle = direction * Math.PI / 180;
  const knobStyle = { left: `${50 + Math.sin(angle) * radius}%`, top: `${50 - Math.cos(angle) * radius}%` };
  const positionFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ballRef.current?.getBoundingClientRect();
    if (!rect) return { direction, elevation };
    let x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    const distance = Math.min(1, Math.hypot(x, y));
    return { direction: Math.round(Math.atan2(x, -y) * 180 / Math.PI), elevation: Math.round((1 - distance) * 90) };
  };
  const moveLight = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setPreview(positionFromPointer(event));
  };
  const finishLight = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = positionFromPointer(event);
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPreview(undefined); updateLighting(next);
  };
  return <div className="lighting-panel">
    <section>
      <div className="section-heading"><h2>Luce</h2></div>
      <div className="lighting-presets">{presets.map((preset) => <button key={preset.id} className={lighting.preset === preset.id ? 'active' : ''} onClick={() => updateLighting(preset.settings)}><i style={{ background: preset.settings.color }} />{preset.label}</button>)}</div>
    </section>
    <section>
      <label className="size-control"><div><span>Intensità</span><strong>{Math.round(lighting.intensity * 100)}%</strong></div><input type="range" min="0" max="2" step="0.05" value={lighting.intensity} onChange={(event) => updateLighting({ intensity: Number(event.target.value) })} /></label>
      <div className="lighting-direction"><span>Direzione</span><div ref={ballRef} className="light-direction-ball" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setPreview(positionFromPointer(event)); }} onPointerMove={moveLight} onPointerUp={finishLight} onPointerCancel={() => setPreview(undefined)}><i className="light-orbit orbit-x" /><i className="light-orbit orbit-y" /><b style={knobStyle} /></div><small>{Math.round(direction)}° · {Math.round(elevation)}°</small></div>
      <div className="lighting-color"><span><Palette size={13} /> Colore</span><label className="color-picker" title="Colore della luce"><input aria-label="Colore della luce" type="color" value={lighting.color} onChange={(event) => updateLighting({ color: event.target.value })} /><i style={{ background: lighting.color }} /></label></div>
    </section>
  </div>;
}
