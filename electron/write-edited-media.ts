import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AbacoProject } from '../src/domain/schema';
import type { EditedMedia } from '../src/domain/edited-media';
import { captionsSrt, editedCaptions, visibilityIntervals } from '../src/domain/media-timeline';
import { exportScreenLayers } from './export-screen-layers';
import { evaluateProperty, evaluateTransform } from '../src/domain/animation';

export async function writeEditedMedia(root: string, project: AbacoProject, media?: EditedMedia) {
  const expected = project.objects.some(o => o.kind === 'audio' || (o.screenSpace && ['text', 'plane'].includes(o.kind)));
  if (!media && expected) throw new Error('Mancano i media montati. Esporta la cartella dall’app Scene per applicare tagli audio, ritagli e testi.');
  if (media && (media.projectId !== project.id || media.updatedAt !== project.updatedAt)) throw new Error('Il progetto e i media montati appartengono a revisioni diverse. Ripeti l’esportazione.');
  const objectIds = new Set(project.objects.map(o => o.id));
  const safeId = (id: string) => { if (!objectIds.has(id)) throw new Error('Media riferito a un elemento non presente nel progetto.'); return id; };
  const save = async (relative: string, bytes: Uint8Array | string) => { const destination = path.join(root, relative); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes); return relative; };
  const png = (value: string) => { if (!value.startsWith('data:image/png;base64,')) throw new Error('Livello immagine non valido.'); return Buffer.from(value.slice(22), 'base64'); };
  const wav = (value: Uint8Array, expectedSamples?: number) => {
    const b = Buffer.from(value);
    if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.readUInt32LE(24) !== 48000 || b.readUInt16LE(22) !== 2 || b.readUInt16LE(34) !== 16) throw new Error('Audio montato non valido.');
    if (expectedSamples !== undefined && b.length !== 44 + expectedSamples * 4) throw new Error('La durata dell’audio montato non corrisponde alla timeline.');
    return b;
  };
  if (project.objects.some(o => o.kind === 'audio') && !media?.audioMix) throw new Error('Manca la traccia audio montata.');
  const totalSamples = Math.round((project.settings.frameEnd - project.settings.frameStart + 1) / project.settings.fps * 48000);
  const mix = media?.audioMix ? await save('media/AUDIO_MONTATO.wav', wav(media.audioMix, totalSamples)) : undefined;
  const clips = [];
  for (const [i, entry] of (media?.audioClips ?? []).entries()) {
    const file = `media/audio/${safeId(entry.clip.objectId)}-${i + 1}.wav`;
    await save(file, wav(entry.wav, Math.round((entry.clip.endFrameExclusive - entry.clip.startFrame) / project.settings.fps * 48000)));
    clips.push({ ...entry.clip, file, editsAlreadyApplied: true });
  }
  const cropped = [];
  for (const entry of media?.croppedImages ?? []) {
    const file = await save(`media/immagini/${safeId(entry.objectId)}.png`, png(entry.png));
    cropped.push({ objectId: entry.objectId, file, cropAlreadyApplied: true });
  }
  const overlays = [];
  for (const entry of media?.overlays ?? []) {
    safeId(entry.objectId);
    const images: string[] = [];
    for (let i = 0; i < entry.images.length; i++) images.push(await save(`media/livelli/${entry.objectId}/${String(i + 1).padStart(5, '0')}.png`, png(entry.images[i])));
    for (const state of entry.states) if (!images[state.image] || state.startFrame < project.settings.frameStart || state.endFrameExclusive > project.settings.frameEnd + 1 || state.startFrame >= state.endFrameExclusive) throw new Error('Intervallo di un livello montato non valido.');
    overlays.push({ objectId: entry.objectId, order: project.objects.find(entryObject => entryObject.id === entry.objectId)?.kind === 'audio' ? project.objects.length + project.objects.findIndex(o => o.id === entry.objectId) : project.objects.findIndex(o => o.id === entry.objectId), frames: entry.states.map(s => ({ ...s, file: images[s.image] })) });
  }
  const screenLayers = exportScreenLayers(project);
  const texts = project.objects.filter(o => o.kind === 'text').map(o => ({ objectId: o.id, name: o.name, screenSpace: o.screenSpace, color: o.color, fontFamily: o.fontFamily, crop: o.screenCrop, frames: Array.from({ length: project.settings.frameEnd - project.settings.frameStart + 1 }, (_, i) => { const frame = project.settings.frameStart + i; return { frame, text: evaluateProperty(o, 'text', frame), visible: visibilityIntervals(project, o).some(([a,b]) => frame >= a && frame < b), transform: evaluateTransform(o, frame) }; }) }));
  await save('TESTI.json', JSON.stringify(texts, null, 2));
  const subtitles = editedCaptions(project);
  await save('SOTTOTITOLI_TIMELINE.json', JSON.stringify({
    schemaVersion: 'SceneSubtitlesTimelineV1',
    timeBase: 'seconds_from_video_start',
    fps: project.settings.fps,
    frameStart: project.settings.frameStart,
    audioMix: mix,
    captions: subtitles,
  }, null, 2));
  const srt = captionsSrt(project);
  if (srt) await save('media/SOTTOTITOLI_MONTATI.srt', srt);
  await save('MEDIA_MONTATI.json', JSON.stringify({
    schemaVersion: 'SceneEditedMediaV1', settings: project.settings,
    instructions: 'Usa audioMix a partire dal frameStart del progetto, oppure i singoli clip nelle rispettive posizioni, mai entrambi. Tagli, volume, loop e dissolvenze sono già applicati: non applicarli di nuovo. SOTTOTITOLI_TIMELINE.json contiene i testi e i tempi sul video finale, non sulla sorgente audio. media/SOTTOTITOLI_MONTATI.srt usa gli stessi tempi. I PNG in overlays hanno la risoluzione finale e includono già posizione, scala, rotazione, ritaglio e testo, compresi i sottotitoli: usa quei PNG oppure ricrea il testo dai tempi, non entrambi. Sovrapponi i PNG a pieno frame nell’ordine indicato, senza trasformarli di nuovo, solo negli intervalli [startFrame, endFrameExclusive). Le immagini ritagliate sono alternative di lavorazione, non livelli aggiuntivi. project.abaco.json e assets/ conservano gli originali modificabili. TESTI.json conserva anche i testi 3D: quelli richiedono il rendering della scena e non sono livelli 2D.',
    audioMix: mix, audioClips: clips, croppedImages: cropped, overlays, screenLayers,
    subtitlesTimeline: 'SOTTOTITOLI_TIMELINE.json',
    subtitleStyles: project.objects.filter(o => o.kind === 'audio').map(o => ({ objectId: o.id, showCaptions: o.audio.showCaptions, applyCaptionPositionToAll: o.audio.applyCaptionPositionToAll, ...o.audio.captionStyle, positions: o.audio.captions.map(caption => ({ captionId: caption.id, position: caption.position ?? o.audio.captionStyle.position })) })),
  }, null, 2));
}
