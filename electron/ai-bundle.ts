import { exportCameraTimeline, IMPORT_CAMERA_SCRIPT } from './camera-timeline';
import type { EditedMedia } from '../src/domain/edited-media';
import { writeEditedMedia } from './write-edited-media';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type AbacoProject, ProjectSchema } from '../src/domain/schema';
import { prepareAnimationProject, buildAnimationBrief } from '../src/domain/animation-handoff';
import { assertAnimationHandoff } from '../src/domain/direction-integrity';
import { editedCaptions } from '../src/domain/media-timeline';

const safeName = (value: string) => value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'asset';
const slash = (value: string) => value.split(path.sep).join('/');
const dataExtensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/flac': '.flac', 'model/gltf-binary': '.glb' };
const exists = async (file: string) => { try { return (await fs.stat(file)).isFile(); } catch { return false; } };
export type PackBlend = (source: string, destination: string) => Promise<void>;

export async function collectPortableAssets(project: AbacoProject, root: string, projectPath?: string, packBlend?: PackBlend) {
  const portable = structuredClone(project);
  const warnings: string[] = [];
  const copied = new Map<string, string>();
  const base = projectPath ? path.dirname(projectPath) : process.cwd();
  const resolve = (value: string) => value.startsWith('data:') ? value : path.resolve(base, value);
  const copyAsset = async (source: string, category: string, label: string, fallback?: string): Promise<string> => {
    let value = source ? resolve(source) : '';
    if (!value.startsWith('data:') && (!value || !await exists(value))) {
      value = fallback ? resolve(fallback) : '';
      if (!value || (!value.startsWith('data:') && !await exists(value))) throw new Error(`File mancante: ${label}${source ? ` (${source})` : ''}. Ricollegalo al progetto prima di esportare.`);
      warnings.push(`${label}: usata la copia incorporata perché l’originale non è disponibile.`);
    }
    const cached = copied.get(value);
    if (cached) return cached;
    const match = value.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
    if (value.startsWith('data:') && (!match || !dataExtensions[match[1]])) throw new Error(`Formato incorporato non supportato: ${label}`);
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
    const name = match ? safeName(label) + dataExtensions[match[1]] : safeName(path.basename(value));
    const relative = `assets/${category}/${digest}/${name}`;
    const destination = path.join(root, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    copied.set(value, relative);
    if (match) await fs.writeFile(destination, match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])));
    else if (path.extname(value).toLowerCase() === '.obj' || path.extname(value).toLowerCase() === '.mtl') {
      // Rebase material and texture references too, including nested relative paths.
      const lines = (await fs.readFile(value, 'utf8')).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const dependency = lines[i].match(/^(\s*)(mtllib|map_Ka|map_Kd|map_Ks|map_Ke|map_d|bump|map_bump|disp|decal|norm)\s+(.+?)\s*$/i);
        if (!dependency) continue;
        const [, indent, command, raw] = dependency;
        const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
        if (command.toLowerCase() === 'mtllib') {
          // A file containing spaces is commonly unquoted in OBJ exports.
          const refs = await exists(path.resolve(path.dirname(value), raw)) ? [raw] : tokens.map(t => t.replace(/^['"]|['"]$/g, ''));
          const paths: string[] = [];
          for (const ref of refs) paths.push(slash(path.relative(path.dirname(destination), path.join(root, await copyAsset(path.resolve(path.dirname(value), ref), category, ref)))));
          lines[i] = `${indent}${command} ${paths.join(' ')}`;
        } else {
          const unquoted = raw.replace(/^['"]|['"]$/g, '');
          let ref = unquoted, options = '';
          if (!await exists(path.resolve(path.dirname(value), ref))) {
            ref = (tokens.at(-1) ?? '').replace(/^['"]|['"]$/g, '');
            options = tokens.slice(0, -1).join(' ');
          }
          const copiedRef = await copyAsset(path.resolve(path.dirname(value), ref), category, ref);
          lines[i] = `${indent}${command} ${options ? `${options} ` : ''}${slash(path.relative(path.dirname(destination), path.join(root, copiedRef)))}`;
        }
      }
      await fs.writeFile(destination, lines.join('\n'));
    } else {
      if (path.extname(value).toLowerCase() === '.blend' && packBlend) await packBlend(value, destination);
      else {
        await fs.copyFile(value, destination);
        if (path.extname(value).toLowerCase() === '.blend') warnings.push(`${name}: modello originale incluso; le sue eventuali risorse esterne non sono state verificate da Blender.`);
      }
    }
    copied.set(value, relative);
    return relative;
  };
  for (const object of portable.objects) {
    const asset = object.asset;
    if (object.kind === 'blend_asset') {
      asset.sourcePath = await copyAsset(asset.sourcePath, 'modelli', object.name);
      if (asset.proxyPath) asset.proxyPath = await copyAsset(asset.proxyPath, 'anteprime', `${object.name}-preview`);
    } else if (object.kind === 'audio') {
      asset.sourcePath = await copyAsset(asset.sourcePath, 'audio', object.name, asset.proxyPath);
      asset.proxyPath = '';
    } else if (asset.sourcePath || asset.proxyPath) {
      const relative = await copyAsset(asset.sourcePath, 'immagini', object.name, asset.proxyPath);
      const preview = asset.proxyPath ? await copyAsset(asset.proxyPath, 'anteprime', `${object.name}-preview`, asset.sourcePath) : relative;
      asset.sourcePath = relative; asset.proxyPath = preview;
    }
  }
  for (const scene of portable.cameraCuts) if (scene.background.kind !== 'none') {
    scene.background.path = await copyAsset(scene.background.path, 'sfondi', scene.background.name || scene.name || 'Sfondo');
  } else scene.background.path = '';
  return { project: ProjectSchema.parse(portable), warnings };
}

async function inventory(root: string, directory = root): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const result: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(root, file));
    else if (entry.isFile()) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      result.push({ path: slash(path.relative(root, file)), bytes: (await fs.stat(file)).size, sha256: hash.digest('hex') });
    }
  }
  return result;
}

/** Unique staging directory + atomic publish; a failed export never leaves a half bundle. */
export async function writeAiBundle(project: AbacoProject, parent: string, projectPath?: string, packBlend?: PackBlend, editedMedia?: EditedMedia) {
  const prepared = prepareAnimationProject(project);
  assertAnimationHandoff(prepared);
  await fs.mkdir(parent, { recursive: true });
  const token = randomUUID();
  const name = `${safeName(prepared.name)}-AI-${new Date().toISOString().replace(/[:.]/g, '-')}-${token.slice(0, 8)}`;
  const stage = path.join(parent, `.scene-ai-${token}.tmp`);
  const destination = path.join(parent, name);
  await fs.mkdir(stage);
  try {
    const { project: portable, warnings } = await collectPortableAssets(prepared, stage, projectPath, packBlend);
    await writeEditedMedia(stage, prepared, editedMedia);
    await fs.writeFile(path.join(stage, 'CAMERE.json'), JSON.stringify(exportCameraTimeline(prepared), null, 2));
    await fs.writeFile(path.join(stage, 'IMPORTA_CAMERE.py'), IMPORT_CAMERA_SCRIPT);
    const warn = [...(portable.animationHandoff?.issues.filter(i => i.severity !== 'info').map(i => i.message) ?? []), ...warnings];
    await fs.writeFile(path.join(stage, 'project.abaco.json'), JSON.stringify(portable, null, 2));
    await fs.writeFile(path.join(stage, 'ISTRUZIONI_ANIMAZIONE.md'), buildAnimationBrief(portable));
    if (portable.animationStandard) await fs.writeFile(path.join(stage, 'STANDARD_ANIMAZIONE_ALLEGATO.md'), portable.animationStandard.content);
    const captions = editedCaptions(portable);
    if (captions.length) await fs.writeFile(path.join(stage, 'TRASCRIZIONI.md'), `# Sottotitoli sulla timeline finale\n\nI secondi partono dall’inizio del video e corrispondono a media/AUDIO_MONTATO.wav. SOTTOTITOLI_TIMELINE.json contiene anche frame, posizione e stile.\n\n${captions.map(c => `- ${c.start.toFixed(3)}–${c.end.toFixed(3)} s · ${c.audioName}: ${c.text}`).join('\n')}\n`);
    const scenes = [...portable.cameraCuts].sort((a, b) => a.frame - b.frame);
    const summary = scenes.map((s, i) => ({ scene: s.name ?? `Scena ${i + 1}`, id: s.id, startFrame: s.frame, endFrame: (scenes[i + 1]?.frame ?? portable.settings.frameEnd + 1) - 1, cameraId: s.cameraId, continuity: s.actionContinuity ?? 'unspecified', direction: portable.comments.filter(c => c.sceneId === s.id && c.kind !== 'transition').map(c => c.text) }));
    await fs.writeFile(path.join(stage, 'SCENE.json'), JSON.stringify(summary, null, 2));
    await fs.writeFile(path.join(stage, 'CONTROLLI_CONSEGNA.json'), JSON.stringify({ ...portable.animationHandoff, assetWarnings: warnings }, null, 2));
    const readme = `# Consegna di Scene per l’AI\n\nProgetto: ${portable.name}\n\n1. Leggi ISTRUZIONI_ANIMAZIONE.md${portable.animationStandard ? ' e STANDARD_ANIMAZIONE_ALLEGATO.md' : ''}.\n2. Leggi MEDIA_MONTATI.json: media/AUDIO_MONTATO.wav contiene il montaggio audio già applicato; media/livelli contiene immagini e testi già posizionati e ritagliati, con gli intervalli esatti di utilizzo. Non applicare due volte tagli o trasformazioni. TESTI.json conserva contenuti e animazione del testo.\n3. Leggi SOTTOTITOLI_TIMELINE.json per testo, secondi e frame esatti sul video finale; media/SOTTOTITOLI_MONTATI.srt usa gli stessi tempi e TRASCRIZIONI.md li riepiloga. Sincronizza recitazione e montaggio con media/AUDIO_MONTATO.wav, non con i secondi della sorgente originale. I PNG dei sottotitoli nei livelli montati includono già il testo: non sovrapporlo due volte.\n4. Apri project.abaco.json: è il progetto completo e autorevole, riapribile in Scene. SCENE.json è un riepilogo.\n5. Risolvi tutti i percorsi relativi dalla cartella di questo documento. assets/ contiene immagini, audio, modelli, anteprime e sfondi effettivamente riferiti. Le anteprime non sostituiscono i modelli originali.\n6. Consulta CONTROLLI_CONSEGNA.json e gli eventuali punti da verificare sotto. MANIFEST.json elenca i file con dimensione e impronta SHA-256.\n7. Importa CAMERE.json con IMPORTA_CAMERE.py in Blender: contiene posizione, orientamento e focale esatti a ogni fotogramma, oltre ai tagli. Rispetta questi dati senza ricomporre le inquadrature.\n8. Costruisci la recitazione sul rig originale, rispettando regia, contatti, camera, fps e sincronizzazioni. I punti del proxy non sono una recitazione finale.\n9. Verifica brevi prove del movimento prima di rifinire e renderizzare tutto. Distingui verifica tecnica, valutazione a velocità reale e approvazione artistica. Non dichiarare svolti controlli che non hai potuto eseguire.\n\nFrequenza: ${portable.settings.fps} fps. Frame: ${portable.settings.frameStart}–${portable.settings.frameEnd}.\n\n${warn.length ? '## Punti da verificare\n\n' + warn.map(w => '- ' + w).join('\n') : 'Tutti i riferimenti diretti agli asset sono stati copiati e verificati.'}\n\nConsegna l’intera cartella mantenendo la struttura. Non occorrono credenziali o impostazioni personali di Scene. Il pacchetto è una consegna di regia, non un video finale già validato.\n`;
    await fs.writeFile(path.join(stage, 'LEGGIMI.md'), readme);
    const files = await inventory(stage);
    await fs.writeFile(path.join(stage, 'MANIFEST.json'), JSON.stringify({ schemaVersion: 'SceneAiBundleV1', project: 'project.abaco.json', standardVersion: portable.animationStandard?.version, createdAt: new Date().toISOString(), files, warnings: warn }, null, 2));
    await fs.rename(stage, destination);
    return { directory: destination, files: files.length + 1, warnings: warn };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}
