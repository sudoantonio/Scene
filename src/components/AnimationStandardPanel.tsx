import { useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import { AnimationStandardSchema } from '../domain/schema';
import bundledStandard from '../assets/STANDARD_ANIMAZIONE_GENERALE.md?raw';

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
  return <div className="standard-panel">
      <p>Attach the rules the AI should use to build and animate this project.</p>
      <input ref={input} type="file" accept=".md,.txt,text/plain,text/markdown" hidden aria-label="Animation standard document" onChange={e => { void importFile(e.target.files?.[0]); }} />
      <div className="standard-buttons"><button className="primary" disabled={loading} onClick={() => input.current?.click()}>{standard ? 'Replace document' : 'Attach document'}</button><button className="secondary" disabled={loading} onClick={() => { setError(''); setStandard({ name: 'STANDARD_ANIMAZIONE_GENERALE.md', content: bundledStandard, attachedAt: new Date().toISOString() }); }}>Use included cartoon standard</button></div>
      <small>Markdown or text file, up to 500 KB. Its contents are embedded in the project and export. Attach a new version to update it.</small>
      {standard ? <div className="standard-attached"><strong>{standard.name}</strong><small>Attached on {new Date(standard.attachedAt).toLocaleDateString('en-GB')} · {standard.content.length.toLocaleString('en-GB')} characters</small><details><summary>Read document</summary><pre>{standard.content}</pre></details><button className="subtle danger" disabled={loading} onClick={() => setStandard(undefined)}>Remove from project</button></div> : <p className="direction-hint">No document attached. You can still describe each scene.</p>}
      {loading && <p role="status">Reading document…</p>}{error && <p role="alert">{error}</p>}
    </div>;
}
