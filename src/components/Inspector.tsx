import { useState } from 'react';
import { ChevronRight, KeyRound, Palette, PanelRightClose, PanelRightOpen, Trash2 } from 'lucide-react';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import type { Transform, Vec3 } from '../domain/schema';
import { useEditor } from '../store/editor';
import ElementsPanel from './ElementsPanel';
import LightingPanel from './LightingPanel';
import BackgroundPanel from './BackgroundPanel';

function NumberField({ value, onChange, label }: { value: number; onChange(value: number): void; label: string }) {
  return <label className="number-field"><span>{label}</span><input type="number" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function VectorFields({ label, value, onChange }: { label: string; value: Vec3; onChange(value: Vec3): void }) {
  return <div className="vector-row"><span>{label}</span><div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={axis} value={value[index]} onChange={(number) => { const next = [...value] as Vec3; next[index] = number; onChange(next); }} />)}</div></div>;
}

const styleColors = ['#2f3437', '#9cabb8', '#d97373', '#dfab01', '#448361', '#337ea9', '#9065b0'];

export default function Inspector({ collapsed, onToggleCollapse }: { collapsed?: boolean; onToggleCollapse?(): void }) {
  const [panel, setPanel] = useState<'edit' | 'scene' | 'light'>('edit');
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const updateObject = useEditor((state) => state.updateObject);
  const setTransform = useEditor((state) => state.setTransform);
  const keyPose = useEditor((state) => state.keyPose);
  const keyProperty = useEditor((state) => state.keyProperty);
  const removeSelected = useEditor((state) => state.removeSelected);
  const object = project.objects.find((item) => item.id === selectedId && item.kind !== 'camera' && !item.kind.includes('light'));
  const transform = object ? evaluateTransform(object, frame) : undefined;

  const changeTransform = (property: keyof Transform, value: Vec3) => object && transform && setTransform(object.id, { ...transform, [property]: value });

  if (collapsed) return <aside className="inspector panel-collapsed"><button title="Apri pannello" aria-label="Apri pannello destro" onClick={onToggleCollapse}><PanelRightOpen size={16} /></button></aside>;
  return <aside className="inspector simple-inspector">
    <button className="panel-collapse panel-collapse-right" title="Riduci pannello" aria-label="Riduci pannello destro" onClick={onToggleCollapse}><PanelRightClose size={15} /></button>
    <div className="right-tabs"><button className={panel === 'edit' ? 'active' : ''} onClick={() => setPanel('edit')}>Modifica</button><button className={panel === 'scene' ? 'active' : ''} onClick={() => setPanel('scene')}>Scena</button><button className={panel === 'light' ? 'active' : ''} onClick={() => setPanel('light')}>Luce</button></div>
    {panel === 'light' ? <LightingPanel /> : panel === 'scene' ? <><BackgroundPanel /><ElementsPanel mode="scene" /></> : <>
      {object && transform ? <section className="object-section edit-stack">
        <div className="edit-group identity-group">
          <div className="name-row"><input aria-label="Nome elemento" className="object-name" value={object.name} onChange={(event) => updateObject(object.id, { name: event.target.value || object.name })} /><button className="icon danger" title="Elimina" onClick={removeSelected}><Trash2 size={14} /></button></div>
          {object.kind === 'text' && <label className="field"><span>Testo</span><textarea value={evaluateProperty(object, 'text', frame) as string} onChange={(event) => updateObject(object.id, { text: event.target.value })} /></label>}
        </div>

        <div className="edit-group compact-style">
          <div className="group-title"><span><Palette size={13} /> Stile</span><label className="visible-compact"><input type="checkbox" checked={evaluateProperty(object, 'visibility', frame) as boolean} onChange={(event) => updateObject(object.id, { visible: event.target.checked })} /> Visibile</label></div>
          <div className="style-row"><label className="color-picker" title="Scegli un colore"><input aria-label="Colore personalizzato" type="color" value={object.color} onChange={(event) => updateObject(object.id, { color: event.target.value })} /></label>{styleColors.map((color) => <button key={color} aria-label={`Colore ${color}`} title={color} className={object.color.toLowerCase() === color ? 'active' : ''} style={{ background: color }} onClick={() => updateObject(object.id, { color })} />)}</div>
          <div className="size-control"><div><span>Dimensione</span><strong>{Math.round(((transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3) * 100)}%</strong></div><input aria-label="Dimensione elemento" type="range" min="0.1" max="4" step="0.05" value={(transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3} onChange={(event) => { const size = Number(event.target.value); changeTransform('scale', [size, size, size]); }} /></div>
        </div>

        <div className="edit-group movement-group"><span className="group-label">Movimento</span><button className="secondary small" onClick={() => keyPose(object.id)}><KeyRound size={14} /> Crea qui</button>{object.kind === 'text' && <button className="subtle compact" onClick={() => keyProperty(object.id, 'text')}><KeyRound size={13} /> Testo</button>}</div>

        <details className="advanced-panel"><summary><ChevronRight size={14} /> Precisione</summary><div>
          <VectorFields label="Posizione" value={transform.position} onChange={(value) => changeTransform('position', value)} />
          <VectorFields label="Rotazione°" value={transform.rotation} onChange={(value) => changeTransform('rotation', value)} />
          <VectorFields label="Scala" value={transform.scale} onChange={(value) => changeTransform('scale', value.map((n) => Math.max(.001, n)) as Vec3)} />
        </div></details>
      </section> : <div className="empty-panel compact-empty"><span>Nessun elemento selezionato</span></div>}

    </>}
  </aside>;
}
