import { evaluateProperty } from './animation';
import type { AbacoProject, SceneObject } from './schema';

export function visibilityIntervals(project: AbacoProject, object: SceneObject): Array<[number, number]> {
  const { frameStart, frameEnd } = project.settings;
  const scenes = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  const boundaries = [...new Set([frameStart, frameEnd + 1, ...object.keyframes.filter(k => k.property === 'visibility').map(k => k.frame), ...scenes.map(s => s.frame)])].filter(f => f >= frameStart && f <= frameEnd + 1).sort((a, b) => a - b);
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i], end = boundaries[i + 1];
    const scene = scenes.filter(s => s.frame <= start).at(-1);
    if (!evaluateProperty(object, 'visibility', start) || (object.sceneIds.length && (!scene || !object.sceneIds.includes(scene.id)))) continue;
    const previous = intervals.at(-1);
    if (previous?.[1] === start) previous[1] = end; else intervals.push([start, end]);
  }
  return intervals;
}
export function audioStateAt(project: AbacoProject, object: SceneObject, frame: number, decodedDuration = object.audio.duration) {
  const range = visibilityIntervals(project, object).find(([a, b]) => frame >= a && frame < b);
  if (!range || object.audio.muted) return undefined;
  const controls = object.audio;
  const end = Math.min(decodedDuration, controls.trimEnd > controls.trimStart ? controls.trimEnd : decodedDuration);
  const length = end - controls.trimStart;
  if (length <= 0) return undefined;
  const elapsed = (frame - range[0]) / project.settings.fps;
  if (!controls.loop && elapsed >= length) return undefined;
  const duration = (range[1] - range[0]) / project.settings.fps;
  const gain = controls.volume * (controls.fadeIn ? Math.min(1, elapsed / controls.fadeIn) : 1) * (controls.fadeOut ? Math.min(1, Math.max(0, duration - elapsed) / controls.fadeOut) : 1);
  return { sourceTime: controls.trimStart + (controls.loop ? elapsed % length : elapsed), gain };
}

export type AudioClip = { objectId: string; name: string; startFrame: number; endFrameExclusive: number; sourceStart: number; sourceEnd: number; loop: boolean; volume: number; fadeIn: number; fadeOut: number };
export function audioClips(project: AbacoProject, object: SceneObject, decodedDuration = object.audio.duration): AudioClip[] {
  const a = object.audio;
  if (object.kind !== 'audio' || a.muted) return [];
  const sourceStart = Math.min(a.trimStart, decodedDuration);
  const sourceEnd = Math.min(decodedDuration, a.trimEnd > a.trimStart ? a.trimEnd : decodedDuration);
  if (sourceEnd <= sourceStart) return [];
  return visibilityIntervals(project, object).map(([startFrame, endFrameExclusive]) => ({ objectId: object.id, name: object.name, startFrame, endFrameExclusive, sourceStart, sourceEnd, loop: a.loop, volume: a.volume, fadeIn: a.fadeIn, fadeOut: a.fadeOut }));
}

export function renderAudioClip(clip: AudioClip, channels: Float32Array[], sampleRate: number, fps: number) {
  const duration = (clip.endFrameExclusive - clip.startFrame) / fps;
  const count = Math.round(duration * sampleRate);
  const output = [new Float32Array(count), new Float32Array(count)];
  const length = clip.sourceEnd - clip.sourceStart;
  for (let i = 0; i < count; i++) {
    const elapsed = i / sampleRate;
    if (!clip.loop && elapsed >= length) break;
    const sourceTime = clip.sourceStart + (clip.loop ? elapsed % length : elapsed);
    const cursor = sourceTime * sampleRate, from = Math.floor(cursor), fraction = cursor - from;
    const gain = clip.volume * (clip.fadeIn ? Math.min(1, elapsed / clip.fadeIn) : 1) * (clip.fadeOut ? Math.min(1, Math.max(0, duration - elapsed) / clip.fadeOut) : 1);
    for (let c = 0; c < 2; c++) {
      const source = channels[Math.min(c, channels.length - 1)];
      const value = (source[from] ?? 0) * (1 - fraction) + (source[Math.min(from + 1, source.length - 1)] ?? 0) * fraction;
      output[c][i] = value * gain;
    }
  }
  return output;
}
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const samples = channels[0]?.length ?? 0, count = channels.length;
  const bytes = new Uint8Array(44 + samples * count * 2), view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < samples; i++) for (let c = 0; c < count; c++) { const sample = Math.max(-1, Math.min(1, channels[c][i])); view.setInt16(44 + (i * count + c) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
  return bytes;
}
export function editedCaptions(project: AbacoProject) {
  const fps = project.settings.fps;
  return project.objects.filter(o => o.kind === 'audio' && o.audio.showCaptions).flatMap(object => audioClips(project, object).flatMap(clip => {
    const length = clip.sourceEnd - clip.sourceStart;
    const duration = (clip.endFrameExclusive - clip.startFrame) / fps;
    const repeats = clip.loop ? Math.ceil(duration / length) : 1;
    return Array.from({ length: repeats }, (_, repeat) => object.audio.captions.flatMap(c => {
      const from = Math.max(c.start, clip.sourceStart), to = Math.min(c.end, clip.sourceEnd);
      const localStart = repeat * length + from - clip.sourceStart, localEnd = Math.min(duration, repeat * length + to - clip.sourceStart);
      if (to <= from || localEnd <= localStart) return [];
      const startFrame = clip.startFrame + Math.ceil(localStart * fps - 1e-9);
      const endFrameExclusive = Math.min(clip.endFrameExclusive, clip.startFrame + Math.ceil(localEnd * fps - 1e-9));
      if (endFrameExclusive <= startFrame) return [];
      const offset = (clip.startFrame - project.settings.frameStart) / fps;
      return [{
        start: offset + localStart, end: offset + localEnd,
        startFrame, endFrameExclusive,
        text: c.text, captionId: c.id, audioObjectId: object.id, audioName: object.name,
        sourceStartSeconds: from, sourceEndSeconds: from + localEnd - localStart,
        position: c.position ?? object.audio.captionStyle.position,
        style: { color: object.audio.captionStyle.color, fontFamily: object.audio.captionStyle.fontFamily, size: object.audio.captionStyle.size },
      }];
    })).flat();
  })).sort((a, b) => a.start - b.start);
}
export function captionsSrt(project: AbacoProject) {
  const time = (seconds: number) => { const ms = Math.round(seconds * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return editedCaptions(project).map((c, i) => `${i + 1}\n${time(c.start)} --> ${time(c.end)}\n${c.text}\n`).join('\n');
}
