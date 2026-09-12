import { Box, Circle, Cone, Cylinder, FileBox, SquareDashed, TextCursorInput } from 'lucide-react';
import type { ObjectKind } from '../domain/schema';
import { useEditor } from '../store/editor';

const shapes: Array<{ kind: ObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'cube', label: 'Cubo', icon: Box }, { kind: 'sphere', label: 'Sfera', icon: Circle },
  { kind: 'cylinder', label: 'Cilindro', icon: Cylinder }, { kind: 'cone', label: 'Cono', icon: Cone },
  { kind: 'plane', label: 'Piano', icon: SquareDashed },
];

export default function ElementsPanel({ mode }: { mode: 'scene' | 'add' }) {
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const addObject = useEditor((state) => state.addObject);
  const addBlendAsset = useEditor((state) => state.addBlendAsset);
  const select = useEditor((state) => state.select);
  const sceneObjects = project.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light'));
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
      <div className="section-heading"><h2>Elementi della scena</h2><span>{sceneObjects.length}</span></div>
      <div className="outliner">{sceneObjects.map((object) => <button key={object.id} className={`outliner-item ${selectedId === object.id ? 'selected' : ''}`} onClick={() => select(object.id)}><span className={`kind-dot ${object.kind}`} /><span>{object.name}</span></button>)}</div>
    </section>}
  </div>;
}
