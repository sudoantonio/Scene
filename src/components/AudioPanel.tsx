import { useEffect, useState } from 'react';
import { Captions, Download, Volume2 } from 'lucide-react';
import { objectPresenceRange } from '../domain/presence';
import { useEditor } from '../store/editor';

function timecode(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}

export default function AudioPanel() {
  const selectedId = useEditor((state) => state.selectedId);
  const settings = useEditor((state) => state.project.settings);
  const selected = useEditor((state) => state.project.objects.find((object) => object.id === selectedId && object.kind === 'audio'));
  const updateObject = useEditor((state) => state.updateObject);
  const [language, setLanguage] = useState<'it-IT' | 'en-US'>('it-IT');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => window.abaco?.onTranscriptionProgress?.(({ received, total }) => setProgress(total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0)), []);
  if (!selected) return null;
  const editCaption = (id: string, patch: Partial<(typeof selected.audio.captions)[number]>) => {
    const latest = useEditor.getState().project.objects.find((item) => item.id === selected.id && item.kind === 'audio');
    if (!latest) return;
    updateObject(selected.id, { audio: { ...latest.audio, captions: latest.audio.captions.map((caption) => caption.id === id ? { ...caption, ...patch } : caption) } });
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
  const downloadSrt = () => {
    const range = objectPresenceRange(selected, settings.frameStart, settings.frameEnd + 1);
    const offset = ((range?.[0] ?? settings.frameStart) - settings.frameStart) / settings.fps - selected.audio.trimStart;
    const text = selected.audio.captions.map((caption, index) => `${index + 1}\n${timecode(caption.start + offset)} --> ${timecode(caption.end + offset)}\n${caption.text}\n`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selected.name || 'subtitles'}.srt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="audio-controls-section audio-controls-simple">
    <label className="audio-range"><span><Volume2 size={13} /> Volume</span><strong>{Math.round(selected.audio.volume * 100)}%</strong><input aria-label="Audio volume" type="range" min="0" max="1" step="0.01" value={selected.audio.volume} onChange={(event) => updateObject(selected.id, { audio: { ...selected.audio, volume: Number(event.target.value) } })} /></label>
    <div className="audio-captions-heading"><strong><Captions size={14} /> Subtitles</strong><select aria-label="Transcription language" value={language} onChange={(event) => setLanguage(event.target.value as 'it-IT' | 'en-US')}><option value="it-IT">Italiano</option><option value="en-US">English</option></select></div>
    <button className="audio-transcribe" type="button" disabled={busy} onClick={transcribe}>{busy ? progress === null ? 'Preparing local transcription…' : progress < 100 ? `Downloading model ${progress}%` : 'Transcribing on this Mac…' : selected.audio.captions.length ? 'Transcribe again' : 'Transcribe locally'}</button>
    {error && <p className="audio-transcribe-error" role="alert">{error}</p>}
    {selected.audio.captions.length > 0 && <>
      <div className="audio-caption-actions"><label><input type="checkbox" checked={selected.audio.showCaptions} onChange={(event) => updateObject(selected.id, { audio: { ...selected.audio, showCaptions: event.target.checked } })} /> Show subtitles</label><button type="button" onClick={downloadSrt}><Download size={13} /> Export SRT</button></div>
      <div className="audio-caption-list">{selected.audio.captions.map((caption) => <div className="audio-caption-row" key={caption.id}><div><input aria-label="Subtitle start" type="number" min="0" step="0.1" value={Number(caption.start.toFixed(2))} onChange={(event) => editCaption(caption.id, { start: Math.max(0, Number(event.target.value)) })} /><span>–</span><input aria-label="Subtitle end" type="number" min="0" step="0.1" value={Number(caption.end.toFixed(2))} onChange={(event) => editCaption(caption.id, { end: Math.max(0, Number(event.target.value)) })} /></div><textarea aria-label="Subtitle text" value={caption.text} onChange={(event) => editCaption(caption.id, { text: event.target.value })} /></div>)}</div>
    </>}
  </section>;
}
