import manifest from '../package.json';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AgentCommandSchema, IncomingStoryboardBeatSchema } from '../src/domain/agent-commands';
import { AgentMotionSchema } from '../src/domain/agent-motion';
import { DirectActionSchema } from '../src/domain/agent-direct';
import { callAgentBridge } from './mcp-client';

const textResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const run = async (method: string, args?: unknown) => {
  try { return textResult(await callAgentBridge(method, args)); }
  catch (error) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
};

export async function startMcpServer() {
  const server = new McpServer({ name: 'scene', version: manifest.version });
  server.registerTool('scene_get_state', {
    description: 'Primo passo per usare Scene: legge revisione e riepilogo compatto del progetto aperto. Chiama anche scene_list_assets prima di creare elementi richiesti dall’utente. Per gli elementi e la regia di una scena usa scene_get_scene; full restituisce il vecchio elenco completo.', inputSchema: { detail: z.enum(['summary', 'full']).default('summary') },
  }, async ({ detail }) => run('status', { detail }));
  server.registerTool('scene_get_scene', { description: 'Legge una scena alla volta: battute, note, elementi, camera, audio, sottotitoli e movimenti. Usa gli ID da scene_get_state.', inputSchema: { sceneId: z.string().uuid(), frame: z.number().int().positive().optional() } }, async (args) => run('scene', args));
  server.registerTool('scene_get_storyboard', { description: 'Legge copione e scaletta di battute salvati nel progetto.', inputSchema: {} }, async () => run('storyboard'));
  server.registerTool('scene_validate_timing', { description: 'Controlla movimenti troppo lenti, animate generici estesi e scene senza battute. Non modifica il progetto.', inputSchema: {} }, async () => run('timing'));
  server.registerTool('scene_validate_framing', { description: 'Controlla che i soggetti delle battute siano nell’inquadratura, che TV e lavagna siano viste dal lato giusto e che i contenuti entrino nelle superfici. Dopo scene_apply o scene_direct_beat, correggi tutti gli errori segnalati prima di consegnare.', inputSchema: {} }, async () => run('framing'));
  server.registerTool('scene_set_storyboard', {
    description: 'Salva nel progetto una scaletta strutturata del copione. Crea prima le scene, poi assegna ogni battuta a sceneId con intervallo, dialogo, intenzione, azione visiva e ritmo. Restituisce gli ID delle battute.',
    inputSchema: { expectedRevision: z.number().int().nonnegative(), script: z.string().max(100000), beats: z.array(IncomingStoryboardBeatSchema).min(1).max(500) },
  }, async ({ expectedRevision, script, beats }) => run('apply', { expectedRevision, commands: [{ type: 'set_storyboard', script, beats }] }));
  server.registerTool('scene_update_story_beat', {
    description: 'Corregge una sola battuta senza ricreare la scaletta. Rileggi la revisione e l’ID con scene_get_storyboard o scene_get_scene.',
    inputSchema: { expectedRevision: z.number().int().nonnegative(), beatId: z.string().uuid(), startOffsetFrames: z.number().int().nonnegative().optional(), durationFrames: z.number().int().positive().optional(), dialogue: z.string().max(10000).optional(), intention: z.string().trim().min(1).max(2000).optional(), visualAction: z.string().trim().min(1).max(4000).optional(), emotion: z.string().max(120).optional(), focusElementId: z.string().uuid().nullable().optional(), surface: z.enum(['none', 'tv', 'board', 'screen']).optional(), pace: z.enum(['snap', 'quick', 'normal', 'slow']).optional() },
  }, async ({ expectedRevision, ...changes }) => run('apply', { expectedRevision, commands: [{ type: 'update_story_beat', ...changes }] }));
  server.registerTool('scene_direct_beat', {
    description: 'Mette in scena una battuta esistente in un solo passo Annulla. Usa focus_surface per inquadrare TV o lavagna senza inventare coordinate: Scene legge centro, orientamento e dimensioni dal GLB. show_on_surface adatta testo/media alla superficie. Restituisce eventuali errori di inquadratura; controlla poi scene_validate_framing e scene_preview.',
    inputSchema: { expectedRevision: z.number().int().nonnegative(), beatId: z.string().uuid(), actions: z.array(DirectActionSchema).min(1).max(20) },
  }, async ({ expectedRevision, beatId, actions }) => run('apply', { expectedRevision, commands: [{ type: 'direct_beat', beatId, actions }] }));
  server.registerTool('scene_list_assets', {
    description: 'Elenca gli asset locali autorizzati con ID, percorso e landmark GLB (centro, normale, larghezza, altezza di TV e lavagna). Usa gli ID reali nei comandi: se l’utente chiede un personaggio o un set presente qui, non sostituirlo con un cubo segnaposto.', inputSchema: {},
  }, async () => run('assets.list'));
  server.registerTool('scene_choose_assets', {
    description: 'Apre in Scene il selettore di immagini, video, audio e file Blender che l’utente vuole rendere disponibili all’AI.', inputSchema: {},
  }, async () => run('assets.choose'));
  server.registerTool('scene_apply', {
    description: 'Applica in una singola operazione annullabile comandi strutturati per creare o modificare un animatic. Leggi prima revisione e asset con scene_get_state e scene_list_assets, poi passa expectedRevision. Se l’utente ha indicato GLB esistenti, usa set_scene_background e add_element con assetId: non creare cubi con il nome degli asset. Per più scene, invia prima create_project e add_scene; leggi gli ID restituiti prima di aggiungere elementi o animazioni. Poi usa storyboard, regia, anteprima e validatori.',
    inputSchema: { expectedRevision: z.number().int().nonnegative(), commands: z.array(AgentCommandSchema).min(1).max(100) },
  }, async (args) => run('apply', args));
  server.registerTool('scene_animate_motion', {
    description: 'Crea o corregge movimenti di camera e oggetti in un unico passo Annulla. Coordinate in metri, Z verso l’alto. Usa beatId e pace snap/quick/normal/slow per legare il movimento alla battuta; durationSeconds prevale e genera un avviso se troppo lento. move_by usa [destra, avanti, alto] nello spazio camera o assi XYZ nello spazio world/local. replaceMotionId corregge solo quel movimento.',
    inputSchema: { expectedRevision: z.number().int().nonnegative(), motions: z.array(AgentMotionSchema).min(1).max(30) },
  }, async ({ expectedRevision, motions }) => run('apply', { expectedRevision, commands: motions.map((spec) => ({ type: 'motion', spec })) }));
  server.registerTool('scene_preview', {
    description: 'Restituisce la vista camera pulita, indipendente dalla vista corrente dell’editor, come JPEG per un frame o foglio di contatto con fino a sei frame. Controlla inizio, metà e fine di ogni scena prima di consegnare.',
    inputSchema: { frame: z.number().int().positive().optional(), frames: z.array(z.number().int().positive()).min(1).max(6).optional() },
  }, async ({ frame, frames }) => {
    try {
      if (!frame && !frames) throw new Error('Indica frame o frames.');
      const result = await callAgentBridge('preview', { frames: frames ?? [frame] }) as { image?: string; message?: string };
      const match = result.image?.match(/^data:image\/jpeg;base64,(.+)$/);
      if (!match) return textResult(result.message ?? 'Preview unavailable.');
      return { content: [{ type: 'image' as const, data: match[1], mimeType: 'image/jpeg' }] };
    } catch (error) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
  });
  server.registerTool('scene_preview_motion', {
    description: 'Mostra cinque istanti temporizzati del movimento, con durata, ritmo e avvisi. Usa motionId dal risultato di scene_animate_motion o scene_get_scene.',
    inputSchema: { motionId: z.string().uuid() },
  }, async ({ motionId }) => {
    try {
      const result = await callAgentBridge('preview.motion', { motionId }) as { image?: string; frames: number[]; durationSeconds: number; pace?: string; speedPerSecond: number; speedUnit: string; warnings: string[] };
      const match = result.image?.match(/^data:image\/jpeg;base64,(.+)$/);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ frames: result.frames, durationSeconds: result.durationSeconds, pace: result.pace, speedPerSecond: result.speedPerSecond, speedUnit: result.speedUnit, warnings: result.warnings }) }, ...(match ? [{ type: 'image' as const, data: match[1], mimeType: 'image/jpeg' }] : [])] };
    } catch (error) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
  });
  server.registerTool('scene_save', { description: 'Salva il progetto Scene aperto. Se path è omesso usa il percorso corrente o apre la finestra Salva.', inputSchema: { path: z.string().endsWith('.abaco.json').optional() } }, async ({ path }) => run('save', { path }));
  server.registerTool('scene_export_blender', { description: 'Salva il progetto ed esporta un file Blender nella cartella versionata del progetto.', inputSchema: {} }, async () => run('export'));
  server.registerTool('scene_export_folder', { description: 'Esporta una cartella portatile con progetto riapribile, asset, audio montato con tagli/volume/dissolvenze, sottotitoli, media e camera. Se outputDirectory manca, apre la scelta della cartella in Scene.', inputSchema: { outputDirectory: z.string().optional() } }, async ({ outputDirectory }) => run('bundle', { outputDirectory }));
  await server.connect(new StdioServerTransport());
}
