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
      if (!/\.(md|txt)$/i.test(file.name)) throw new Error('Scegli un documento Markdown (.md) o testo (.txt).');
      if (file.size > 500000) throw new Error('Il documento supera 500 KB.');
      const content = (await file.text()).replace(/^\uFEFF/, '');
      if (!content.trim()) throw new Error('Il documento è vuoto.');
      if (content.includes('\0')) throw new Error('Il documento deve contenere testo UTF-8.');
      const parsed = AnimationStandardSchema.parse({ name: file.name, content, attachedAt: new Date().toISOString() });
      if (useEditor.getState().project.id !== projectId) return;
      setStandard(parsed);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Impossibile leggere il documento.'); }
    finally { setLoading(false); if (input.current) input.current.value = ''; }
  };
  return <div className="standard-panel">
      <p>Allega le regole che l’AI dovrà usare per costruire e animare questo progetto.</p>
      <input ref={input} type="file" accept=".md,.txt,text/plain,text/markdown" hidden aria-label="Documento standard animazione" onChange={e => { void importFile(e.target.files?.[0]); }} />
      <div className="standard-buttons"><button className="primary" disabled={loading} onClick={() => input.current?.click()}>{standard ? 'Sostituisci documento' : 'Allega documento'}</button><button className="secondary" disabled={loading} onClick={() => { setError(''); setStandard({ name: 'STANDARD_ANIMAZIONE_GENERALE.md', content: bundledStandard, attachedAt: new Date().toISOString() }); }}>Usa standard cartoon incluso</button></div>
      <small>File .md o .txt, fino a 500 KB. Il testo è incorporato nel progetto e nell’export; non dipende dal file originale. Per aggiornarlo, allega la nuova versione.</small>
      {standard ? <div className="standard-attached"><strong>{standard.name}</strong><small>Allegato il {new Date(standard.attachedAt).toLocaleDateString('it-IT')} · {standard.content.length.toLocaleString('it-IT')} caratteri</small><details><summary>Leggi documento</summary><pre>{standard.content}</pre></details><button className="subtle danger" disabled={loading} onClick={() => setStandard(undefined)}>Rimuovi dal progetto</button></div> : <p className="direction-hint">Nessun documento allegato. La descrizione delle scene resta a tua disposizione.</p>}
      {loading && <p role="status">Lettura documento…</p>}{error && <p role="alert">{error}</p>}
    </div>;
}
