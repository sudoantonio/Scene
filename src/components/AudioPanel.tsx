import { useEffect, useState } from 'react';
import { Captions, Download, Languages, Scissors, Volume2 } from 'lucide-react';
import { captionsSrt } from '../domain/media-timeline';
import FontPicker from './FontPicker';
import { useEditor } from '../store/editor';

export default function AudioPanel() {
  const selectedId = useEditor((state) => state.selectedId);
  const selected = useEditor((state) => state.project.objects.find((object) => object.id === selectedId && object.kind === 'audio'));
  const updateObject = useEditor((state) => state.updateObject);
  const selectedCaption = useEditor((state) => state.selectedCaption);
  const selectCaption = useEditor((state) => state.selectCaption);
  const [language, setLanguage] = useState<'it-IT' | 'en-US'>('it-IT');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [textCursor, setTextCursor] = useState<{ captionId: string; offset: number }>();
  useEffect(() => window.abaco?.onTranscriptionProgress?.(({ received, total }) => setProgress(total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0)), []);
  if (!selected) return null;
  const editCaption = (id: string, patch: Partial<(typeof selected.audio.captions)[number]>) => {
    const latest = useEditor.getState().project.objects.find((item) => item.id === selected.id && item.kind === 'audio');
    if (!latest) return;
    updateObject(selected.id, { audio: { ...latest.audio, captions: latest.audio.captions.map((caption) => caption.id === id ? { ...caption, ...patch } : caption) } });
  };
  const splitCaptionAtCursor = (id: string, cursorOffset = textCursor?.offset) => {
    const latest = useEditor.getState().project.objects.find((item) => item.id === selected.id && item.kind === 'audio');
    const caption = latest?.kind === 'audio' ? latest.audio.captions.find((item) => item.id === id) : undefined;
    if (!latest || latest.kind !== 'audio' || !caption || cursorOffset === undefined) return;
    const offset = Math.max(0, Math.min(caption.text.length, cursorOffset));
    const before = caption.text.slice(0, offset).trimEnd();
    const after = caption.text.slice(offset).trimStart();
    if (!before || !after || caption.end <= caption.start) return;
    const splitTime = caption.start + (caption.end - caption.start) * offset / caption.text.length;
    if (splitTime <= caption.start || splitTime >= caption.end) return;
    const second = { ...caption, id: crypto.randomUUID(), start: splitTime, text: after };
    const captions = latest.audio.captions.flatMap((item) => item.id === id
      ? [{ ...item, end: splitTime, text: before }, second]
      : [item]).sort((a, b) => a.start - b.start);
    updateObject(selected.id, { audio: { ...latest.audio, captions } });
    setTextCursor(undefined);
  };
  const transcribe = async () => {
    if (!window.abaco) { setError('Local transcription is available in the desktop app.'); return; }
    setBusy(true); setProgress(null); setError('');
    try {
      const captions = await window.abaco.transcribeAudio(selected.asset.sourcePath, language);
      const latest = useEditor.getState().project.objects.find((item) => item.id === selected.id && item.kind === 'audio');
      if (latest) updateObject(selected.id, { audio: { ...latest.audio, captions: captions.map((caption) => ({ ...caption, id: crypto.randomUUID() })), showCaptions: true } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setProgress(null); }
  };
  const changeCaptionStyle = (style: Partial<typeof selected.audio.captionStyle>) => {
    const latest = useEditor.getState().project.objects.find((item) => item.id === selected.id && item.kind === 'audio');
    if (latest) updateObject(selected.id, { audio: { ...latest.audio, captionStyle: { ...latest.audio.captionStyle, ...style } } });
  };
  const downloadSrt = () => {
    const project = useEditor.getState().project;
    const text = captionsSrt({ ...project, objects: [selected] });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selected.name || 'subtitles'}.srt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="audio-controls-section audio-controls-simple">
    <label className="audio-range"><span><Volume2 size={13} /> Volume</span><strong>{Math.round(selected.audio.volume * 100)}%</strong><input aria-label="Audio volume" type="range" min="0" max="1" step="0.01" value={selected.audio.volume} onChange={(event) => updateObject(selected.id, { audio: { ...selected.audio, volume: Number(event.target.value) } })} /></label>
    <div className="audio-captions-heading"><strong><Captions size={14} /> Subtitles</strong></div>
    <div className="audio-transcribe-row">
      <button className="audio-transcribe" type="button" disabled={busy} onClick={transcribe}>{busy ? progress === null ? 'Preparing local transcription…' : progress < 100 ? `Downloading model ${progress}%` : 'Transcribing on this Mac…' : selected.audio.captions.length ? 'Transcribe again' : 'Transcribe locally'}</button>
      <label className="audio-caption-icon audio-language-icon" title={`Transcription language: ${language === 'it-IT' ? 'Italiano' : 'English'}`}><Languages size={16} aria-hidden="true" /><select aria-label="Transcription language" value={language} onChange={(event) => setLanguage(event.target.value as 'it-IT' | 'en-US')}><option value="it-IT">Italiano</option><option value="en-US">English</option></select></label>
      <button className="audio-caption-icon" type="button" aria-label="Export SRT" title="Export SRT" disabled={!selected.audio.captions.length} onClick={downloadSrt}><Download size={16} /></button>
    </div>
    {error && <p className="audio-transcribe-error" role="alert">{error}</p>}
    {selected.audio.captions.length > 0 && <>
      <div className="audio-caption-options">
        <label><input type="checkbox" checked={selected.audio.showCaptions} onChange={(event) => updateObject(selected.id, { audio: { ...selected.audio, showCaptions: event.target.checked } })} /> Show subtitles</label>
        <label><input type="checkbox" checked={selected.audio.applyCaptionPositionToAll} onChange={(event) => updateObject(selected.id, { audio: { ...selected.audio, applyCaptionPositionToAll: event.target.checked } })} /> Apply to all</label>
      </div>
      <p className="caption-position-hint">Drag a subtitle in the frame to move it.</p>
      <div className="caption-style-editor" aria-label="Subtitle appearance">
        <FontPicker name="Subtitle font" value={selected.audio.captionStyle.fontFamily} onChange={(fontFamily) => changeCaptionStyle({ fontFamily })} />
        <label className="caption-color-control"><span>Color</span><input aria-label="Subtitle color" type="color" value={selected.audio.captionStyle.color} onChange={(event) => changeCaptionStyle({ color: event.target.value })} /></label>
        <label className="caption-size-control"><span>Size</span><select aria-label="Subtitle size" value={selected.audio.captionStyle.size} onChange={(event) => changeCaptionStyle({ size: Number(event.target.value) })}><option value="0.85">Small</option><option value="1">Normal</option><option value="1.2">Large</option><option value="1.4">Very large</option></select></label>
      </div>
      <div className="audio-caption-list">{selected.audio.captions.map((caption) => <div className={`audio-caption-row ${selectedCaption?.audioId === selected.id && selectedCaption.captionId === caption.id ? 'selected' : ''}`} key={caption.id}><div className="audio-caption-combined"><textarea aria-label="Subtitle text" value={caption.text} onFocus={() => selectCaption({ audioId: selected.id, captionId: caption.id })} onChange={(event) => editCaption(caption.id, { text: event.target.value })} onSelect={(event) => setTextCursor({ captionId: caption.id, offset: event.currentTarget.selectionStart ?? 0 })} onKeyUp={(event) => setTextCursor({ captionId: caption.id, offset: event.currentTarget.selectionStart ?? 0 })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); splitCaptionAtCursor(caption.id, event.currentTarget.selectionStart); } }} />{textCursor?.captionId === caption.id && textCursor.offset > 0 && textCursor.offset < caption.text.length && <button className="audio-caption-split" aria-label="Split at cursor" title="Split at cursor" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => splitCaptionAtCursor(caption.id)}><Scissors size={12} /></button>}</div></div>)}</div>
    </>}
  </section>;
}
