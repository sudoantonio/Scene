import { Volume2 } from 'lucide-react';
import { useEditor } from '../store/editor';

export default function AudioPanel() {
  const selectedId = useEditor((state) => state.selectedId);
  const selected = useEditor((state) => state.project.objects.find((object) => object.id === selectedId && object.kind === 'audio'));
  const updateObject = useEditor((state) => state.updateObject);
  if (!selected) return null;
  return <section className="audio-controls-section audio-controls-simple">
    <label className="audio-range"><span><Volume2 size={13} /> Volume</span><strong>{Math.round(selected.audio.volume * 100)}%</strong><input aria-label="Volume audio" type="range" min="0" max="1" step="0.01" value={selected.audio.volume} onChange={(event) => updateObject(selected.id, { audio: { ...selected.audio, volume: Number(event.target.value) } })} /></label>
  </section>;
}
