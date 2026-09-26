import type { AbacoProject } from './schema';
import { evaluateProperty, evaluateTransform } from './animation';
import { audioClips, audioStateAt, encodeWav, renderAudioClip, visibilityIntervals, type AudioClip } from './media-timeline';
import { fontCss, type FontId } from './text-style';

export type EditedMedia = {
  projectId: string; updatedAt: string;
  audioMix?: Uint8Array;
  audioClips: Array<{ clip: AudioClip; wav: Uint8Array }>;
  overlays: Array<{ objectId: string; states: Array<{ startFrame: number; endFrameExclusive: number; image: number; text?: string }>; images: string[] }>;
  croppedImages: Array<{ objectId: string; png: string }>;
};
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function textBitmap(text: string, color: string, fontSize: number, frameScale: number, fontFamily: FontId) {
  const style = `display:block;width:max-content;padding:${2 * frameScale}px ${5 * frameScale}px;font:${650} ${fontSize}px/1.08 ${fontCss(fontFamily)};white-space:pre-wrap;text-align:left;color:${color};text-shadow:0 ${frameScale}px ${3 * frameScale}px rgba(0,0,0,.45);font-synthesis:none`;
  const measure = document.createElement('span'); measure.style.cssText = style + ';position:fixed;visibility:hidden'; measure.textContent = text; document.body.appendChild(measure);
  const bounds = measure.getBoundingClientRect(); measure.remove();
  const width = Math.max(1, Math.ceil(bounds.width)), height = Math.max(1, Math.ceil(bounds.height));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(style)}">${escapeXml(text)}</div></foreignObject></svg>`;
  return { image: await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)), width, height };
}
const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Immagine non leggibile durante l’esportazione.')); image.src = source; });

/** Bake the actual edit. Source project/assets are preserved separately for further editing. */
export async function prepareEditedMedia(project: AbacoProject, loadAsset: (source: string) => Promise<string>, progress?: (text: string) => void): Promise<EditedMedia> {
  const result: EditedMedia = { projectId: project.id, updatedAt: project.updatedAt, audioClips: [], overlays: [], croppedImages: [] };
  const { frameStart, frameEnd, fps, resolutionX: width, resolutionY: height } = project.settings;
  const sounds = project.objects.filter(o => o.kind === 'audio');
  if (sounds.length) {
    progress?.('Preparazione dell’audio montato…');
    const rate = 48000;
    const decoder = new OfflineAudioContext(2, 1, rate);
    const count = Math.round((frameEnd - frameStart + 1) / fps * rate);
    const mix = [new Float32Array(count), new Float32Array(count)];
    for (const object of sounds) {
      if (object.audio.muted || !visibilityIntervals(project, object).length) continue;
      const source = await loadAsset(object.asset.sourcePath);
      const bytes = await (await fetch(source)).arrayBuffer();
      const decoded = await decoder.decodeAudioData(bytes);
      const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, c) => decoded.getChannelData(c));
      for (const clip of audioClips(project, object, decoded.duration)) {
        const rendered = renderAudioClip(clip, channels, rate, fps);
        result.audioClips.push({ clip, wav: encodeWav(rendered, rate) });
        const start = Math.round((clip.startFrame - frameStart) / fps * rate);
        for (let c = 0; c < 2; c++) for (let i = 0; i < rendered[c].length && start + i < count; i++) mix[c][start + i] += rendered[c][i];
      }
    }
    result.audioMix = encodeWav(mix, rate);
  }
  await document.fonts.ready;
  const frameScale = width / 1280;
  for (const object of project.objects.filter(o => o.screenSpace && ['text', 'plane'].includes(o.kind))) {
    progress?.(`Preparazione di ${object.name}…`);
    const ranges = visibilityIntervals(project, object);
    if (!ranges.length) continue;
    let image: HTMLImageElement | undefined;
    if (object.kind === 'plane') {
      const source = object.asset.proxyPath.startsWith('data:') ? object.asset.proxyPath : await loadAsset(object.asset.proxyPath || object.asset.sourcePath);
      image = await loadImage(source);
      const cropCanvas = document.createElement('canvas');
      const [top, right, bottom, left] = object.screenCrop;
      const sw = image.naturalWidth * (1 - left - right), sh = image.naturalHeight * (1 - top - bottom);
      cropCanvas.width = Math.max(1, Math.round(sw)); cropCanvas.height = Math.max(1, Math.round(sh));
      const cropContext = cropCanvas.getContext('2d');
      if (!cropContext) throw new Error('Impossibile esportare il ritaglio dell’immagine.');
      cropContext.drawImage(image, image.naturalWidth * left, image.naturalHeight * top, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);
      result.croppedImages.push({ objectId: object.id, png: cropCanvas.toDataURL('image/png') });
    }
    const output: EditedMedia['overlays'][number] = { objectId: object.id, states: [], images: [] };
    const cache = new Map<string, number>();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossibile esportare i livelli della scena.');
    for (const [start, end] of ranges) for (let frame = start; frame < end; frame++) {
      const transform = evaluateTransform(object, frame);
      const text = object.kind === 'text' ? String(evaluateProperty(object, 'text', frame)) : undefined;
      const signature = JSON.stringify([transform, text]);
      let index = cache.get(signature);
      if (index === undefined) {
        ctx.clearRect(0, 0, width, height); ctx.save();
        ctx.translate((transform.position[0] + 1) * width / 2, (1 - transform.position[2]) * height / 2);
        ctx.rotate(transform.rotation[2] * Math.PI / 180);
        const scale = Math.max(.1, transform.scale[0]) * frameScale;
        const [top, right, bottom, left] = object.screenCrop;
        if (image) {
          const w = 260 * scale, h = w * image.naturalHeight / image.naturalWidth;
          ctx.beginPath(); ctx.rect(-w / 2 + w * left, -h / 2 + h * top, w * (1 - left - right), h * (1 - top - bottom)); ctx.clip();
          ctx.drawImage(image, -w / 2, -h / 2, w, h);
        } else {
          const bitmap = await textBitmap(text ?? '', object.color, 34 * scale, frameScale, object.fontFamily);
          const w = bitmap.width, h = bitmap.height;
          ctx.beginPath(); ctx.rect(-w / 2 + w * left, -h / 2 + h * top, w * (1 - left - right), h * (1 - top - bottom)); ctx.clip();
          ctx.drawImage(bitmap.image, -w / 2, -h / 2);
        }
        ctx.restore(); index = output.images.length; output.images.push(canvas.toDataURL('image/png')); cache.set(signature, index);
        if (output.images.length % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const last = output.states.at(-1);
      if (last && last.image === index && last.endFrameExclusive === frame) last.endFrameExclusive = frame + 1;
      else output.states.push({ startFrame: frame, endFrameExclusive: frame + 1, image: index, text });
    }
    result.overlays.push(output);
  }
  for (const object of sounds.filter((sound) => sound.audio.showCaptions && sound.audio.captions.length)) {
    progress?.(`Preparazione dei sottotitoli di ${object.name}…`);
    const output: EditedMedia['overlays'][number] = { objectId: object.id, states: [], images: [] };
    const cache = new Map<string, number>();
    const { color, fontFamily, size } = object.audio.captionStyle;
    for (let frame = frameStart; frame <= frameEnd; frame++) {
      const sourceTime = audioStateAt(project, object, frame)?.sourceTime;
      if (sourceTime === undefined) continue;
      const visible = object.audio.captions.filter((caption) => caption.start <= sourceTime && sourceTime < caption.end).map((caption) => ({ text: caption.text, position: caption.position ?? object.audio.captionStyle.position }));
      if (!visible.length) continue;
      const text = visible.map((caption) => caption.text).join(' ');
      const signature = JSON.stringify(visible);
      let index = cache.get(signature);
      if (index === undefined) {
        const fontSize = Math.max(16 * frameScale, 32 * frameScale * size);
        const stripHeight = Math.ceil(fontSize * 3.4);
        const stripWidth = Math.floor(width * .86);
        const style = `box-sizing:border-box;width:${stripWidth}px;height:${stripHeight}px;padding:0 2%;display:flex;align-items:flex-end;justify-content:center;text-align:center;color:${color};font:700 ${fontSize}px/1.3 ${fontCss(fontFamily)};text-shadow:0 ${2 * frameScale}px ${4 * frameScale}px #000,0 0 ${12 * frameScale}px #000;font-synthesis:none;white-space:pre-wrap`;
        const layers = visible.map((caption) => `<foreignObject x="${Math.round(caption.position[0] * width - stripWidth / 2)}" y="${Math.round(caption.position[1] * height - stripHeight)}" width="${stripWidth}" height="${stripHeight}"><div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(style)}">${escapeXml(caption.text)}</div></foreignObject>`).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${layers}</svg>`;
        const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Impossibile esportare i sottotitoli.');
        context.drawImage(image, 0, 0);
        index = output.images.length;
        output.images.push(canvas.toDataURL('image/png'));
        cache.set(signature, index);
      }
      const last = output.states.at(-1);
      if (last && last.image === index && last.endFrameExclusive === frame) last.endFrameExclusive = frame + 1;
      else output.states.push({ startFrame: frame, endFrameExclusive: frame + 1, image: index, text });
    }
    if (output.states.length) result.overlays.push(output);
  }
  return result;
}
