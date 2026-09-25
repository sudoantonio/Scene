import { useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import { AnimationStandardSchema } from '../domain/schema';
import bundledStandard from '../assets/STANDARD_ANIMAZIONE_GENERALE.md?raw';
import { FileText, RotateCcw, WandSparkles, X } from 'lucide-react';

export default function AnimationStandardPanel() {
  const standard = useEditor(s => s.project.animationStandard);
  const setStandard = useEditor(s => s.setAnimationStandard);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const importFile = async (file?: File) => {
    if (!file) return;
    const projectId = useEditor.getState().project.id;
    setError(''); setLoading(true);
    try {
      if (!/\.(md|txt)$/i.test(file.name)) throw new Error('Choose a Markdown (.md) or text (.txt) document.');
      if (file.size > 500000) throw new Error('The document exceeds 500 KB.');
      const content = (await file.text()).replace(/^\uFEFF/, '');
      if (!content.trim()) throw new Error('The document is empty.');
      if (content.includes('\0')) throw new Error('The document must contain UTF-8 text.');
      const parsed = AnimationStandardSchema.parse({ name: file.name, content, attachedAt: new Date().toISOString() });
      if (useEditor.getState().project.id !== projectId) return;
      setStandard(parsed);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not read the document.'); }
    finally { setLoading(false); if (input.current) input.current.value = ''; }
  };
  return <div className="animation-standard-slot">
      <input ref={input} type="file" accept=".md,.txt,text/plain,text/markdown" hidden aria-label="Animation standard document" onChange={e => { void importFile(e.target.files?.[0]); }} />
      <button className="animation-standard-file" type="button" disabled={loading} onClick={() => input.current?.click()} title={standard ? 'Replace animation standard' : 'Attach animation standard'}><FileText size={15} /><span>{standard?.name ?? 'Animation standard'}</span>{standard ? <RotateCcw size={13} /> : <small>Attach file</small>}</button>
      {!standard && <button className="animation-standard-icon" type="button" disabled={loading} aria-label="Use included cartoon standard" title="Use included cartoon standard" onClick={() => { setError(''); setStandard({ name: 'STANDARD_ANIMAZIONE_GENERALE.md', content: bundledStandard, attachedAt: new Date().toISOString() }); }}><WandSparkles size={14} /></button>}
      {standard && <button className="animation-standard-icon" type="button" disabled={loading} aria-label="Remove animation standard" title="Remove animation standard" onClick={() => setStandard(undefined)}><X size={14} /></button>}
      {loading && <p role="status">Reading document…</p>}{error && <p role="alert">{error}</p>}
    </div>;
}
