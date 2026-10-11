import { agentConnectionPath } from './mcp-client';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentAsset } from '../src/domain/agent-commands';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
const assets = new Map<string, AgentAsset>();
const pending = new Map<string, Pending>();
const extensions: Record<string, AgentAsset['kind']> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image',
  '.mp4': 'video', '.m4v': 'video', '.mov': 'video', '.webm': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.blend': 'blend_asset', '.glb': 'model',
};
const imageMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// Keep the authorized asset catalogue beside the existing MCP connection.
// Isolated QA profiles override both paths through SCENE_USER_DATA_DIR.
const selectedAssetsPath = () => path.join(path.dirname(agentConnectionPath()), 'agent-assets.json');

export function selectedAgentAssets() { return [...assets.values()]; }
export function publicAgentAssets() { return selectedAgentAssets().map(({ id, kind, name, sourcePath, landmarks }) => ({ id, kind, name, path: sourcePath, landmarks })); }

async function loadSelectedAssets(importBlend: (filePath: string) => Promise<Omit<AgentAsset, 'id' | 'kind'>>) {
  let saved: Array<{ id: string; sourcePath: string }> = [];
  try { saved = JSON.parse(await fs.readFile(selectedAssetsPath(), 'utf8')) as typeof saved; } catch { return; }
  if (!Array.isArray(saved)) return;
  for (const item of saved.slice(0, 500)) {
    if (!item || typeof item.id !== 'string' || typeof item.sourcePath !== 'string' || !path.isAbsolute(item.sourcePath)) continue;
    const kind = extensions[path.extname(item.sourcePath).toLowerCase()];
    if (!kind) continue;
    try {
      if (!(await fs.stat(item.sourcePath)).isFile()) continue;
      let asset: AgentAsset;
      if (kind === 'blend_asset') asset = { id: item.id, kind, ...await importBlend(item.sourcePath) };
      else {
        asset = { id: item.id, kind, name: path.basename(item.sourcePath), sourcePath: item.sourcePath };
        if (kind === 'image') asset.proxyPath = `data:${imageMime[path.extname(item.sourcePath).toLowerCase()]};base64,${(await fs.readFile(item.sourcePath)).toString('base64')}`;
        if (kind === 'model') asset.landmarks = await glbLandmarks(item.sourcePath);
      }
      assets.set(asset.id, asset);
    } catch { /* A missing or changed asset is omitted until the user selects it again. */ }
  }
}

async function persistSelectedAssets() {
  await fs.mkdir(path.dirname(selectedAssetsPath()), { recursive: true });
  await fs.writeFile(selectedAssetsPath(), JSON.stringify(selectedAgentAssets().map(({ id, sourcePath }) => ({ id, sourcePath }))), { mode: 0o600 });
}

async function glbLandmarks(filePath: string): Promise<NonNullable<AgentAsset['landmarks']>> {
  const file = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(20);
    await file.read(header, 0, 20, 0);
    if (header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB.');
    const size = header.readUInt32LE(12);
    if (size > 16_000_000) throw new Error('GLB metadata is too large.');
    const json = Buffer.alloc(size);
    await file.read(json, 0, size, 20);
    type Triple = [number, number, number];
    type Node = { name?: string; translation?: Triple; rotation?: [number, number, number, number]; scale?: Triple; mesh?: number };
    const data = JSON.parse(json.toString('utf8')) as {
      nodes?: Node[];
      meshes?: Array<{ primitives: Array<{ attributes: { POSITION?: number } }> }>;
      accessors?: Array<{ min?: Triple; max?: Triple }>;
    };
    const toEditor = (v: Triple): Triple => [v[0], -v[2], v[1]];
    const rotate = (v: Triple, q: [number, number, number, number]): Triple => {
      const [x, y, z, w] = q;
      const cross = (a: Triple, b: Triple): Triple => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const t = cross([x, y, z], v).map((n) => n * 2) as Triple;
      const u = cross([x, y, z], t);
      return v.map((n, i) => n + w * t[i] + u[i]) as Triple;
    };
    return (data.nodes ?? []).filter((node) => /Lavagna • superficie bianca|TV • schermo CRT spento|Divano • base arrotondata/i.test(node.name ?? '') && node.translation).slice(0, 8).map((node) => {
      const mesh = node.mesh === undefined ? undefined : data.meshes?.[node.mesh];
      const boxes = (mesh?.primitives ?? []).map((primitive) => primitive.attributes.POSITION === undefined ? undefined : data.accessors?.[primitive.attributes.POSITION]).filter((box): box is { min: Triple; max: Triple } => Boolean(box?.min && box.max));
      const min: Triple = boxes.length ? [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]))) as Triple : [0, 0, 0];
      const max: Triple = boxes.length ? [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]))) as Triple : [0, 0, 0];
      const scale = node.scale ?? [1, 1, 1];
      const q = node.rotation ?? [0, 0, 0, 1];
      const localCenter = min.map((n, axis) => (n + max[axis]) * .5 * scale[axis]) as Triple;
      const rotatedCenter = rotate(localCenter, q);
      const position = toEditor(node.translation!.map((n, axis) => n + rotatedCenter[axis]) as Triple);
      const surface = /Lavagna|TV/.test(node.name ?? '') && boxes.length;
      if (!surface) return { name: node.name!, position };
      const extents = min.map((n, axis) => (max[axis] - n) * Math.abs(scale[axis]));
      const thin = extents.indexOf(Math.min(...extents));
      const tangents = [0, 1, 2].filter((axis) => axis !== thin);
      const axes = [0, 1, 2].map((axis) => toEditor(rotate([0, 1, 2].map((i) => i === axis ? Math.sign(scale[i]) : 0) as Triple, q)));
      const vertical = Math.abs(axes[tangents[0]][2]) > Math.abs(axes[tangents[1]][2]) ? tangents[0] : tangents[1];
      const horizontal = tangents.find((axis) => axis !== vertical)!;
      let normal = axes[thin];
      const towardRoom: Triple = [-position[0], -position[1], 1.5 - position[2]];
      if (normal.reduce((sum, value, axis) => sum + value * towardRoom[axis], 0) < 0) normal = normal.map((value) => -value) as Triple;
      return { name: node.name!, position, normal, width: extents[horizontal], height: extents[vertical] };
    });
  } finally { await file.close(); }
}

export async function chooseAgentAssets(window: BrowserWindow, importBlend: (filePath: string) => Promise<Omit<AgentAsset, 'id' | 'kind'>>) {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose assets the AI can use', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Immagini, video, audio e Blender', extensions: Object.keys(extensions).map((item) => item.slice(1)) }],
  });
  if (result.canceled) return publicAgentAssets();
  for (const selected of result.filePaths) {
    const filePath = path.resolve(selected);
    const kind = extensions[path.extname(filePath).toLowerCase()];
    if (!kind || !(await fs.stat(filePath)).isFile()) continue;
    const existing = selectedAgentAssets().find((item) => item.sourcePath === filePath);
    if (existing) continue;
    const id = randomUUID();
    let asset: AgentAsset;
    if (kind === 'blend_asset') asset = { id, kind, ...await importBlend(filePath) };
    else {
      asset = { id, kind, name: path.basename(filePath), sourcePath: filePath };
      if (kind === 'image') asset.proxyPath = `data:${imageMime[path.extname(filePath).toLowerCase()]};base64,${(await fs.readFile(filePath)).toString('base64')}`;
      if (kind === 'model') asset.landmarks = await glbLandmarks(filePath);
    }
    assets.set(id, asset);
  }
  await persistSelectedAssets();
  return publicAgentAssets();
}

export async function startAgentBridge(window: () => BrowserWindow | null, importBlend: (filePath: string) => Promise<Omit<AgentAsset, 'id' | 'kind'>>) {
  await loadSelectedAssets(importBlend);
  const connectionPath = agentConnectionPath();
  const token = randomBytes(32).toString('hex');
  ipcMain.on('agent:response', (_event, response: { id: string; result?: unknown; error?: string }) => {
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error)); else request.resolve(response.result);
  });
  const rendererRequest = (method: string, args: unknown) => new Promise<unknown>((resolve, reject) => {
    const currentWindow = window();
    if (!currentWindow || currentWindow.isDestroyed()) return reject(new Error('Apri Scene per usare i tool AI.'));
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Tempo scaduto per ${method}.`)); }, method === 'export' || method === 'bundle' ? 600000 : 60000);
    pending.set(id, { resolve, reject, timer });
    currentWindow.webContents.send('agent:request', { id, method, args });
  });
  const server = createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.url !== '/rpc' || req.headers.authorization !== `Bearer ${token}`) return reply(403, { error: 'Accesso negato.' });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error('Request is too large.');
        chunks.push(chunk);
      }
      const { method, args } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { method: string; args?: unknown };
      let result: unknown;
      if (method === 'assets.list') result = publicAgentAssets();
      else if (method === 'assets.choose') {
        const currentWindow = window();
        if (!currentWindow) throw new Error('Open Scene before choosing assets.');
        result = await chooseAgentAssets(currentWindow, importBlend);
      } else if (['status', 'scene', 'storyboard', 'timing', 'framing', 'apply', 'preview', 'preview.motion', 'save', 'export', 'bundle'].includes(method)) {
        result = await rendererRequest(method, method === 'apply' ? { ...(args as object), assets: selectedAgentAssets() } : args);
      } else throw new Error(`Unknown method: ${method}`);
      reply(200, { result });
    } catch (error) { reply(400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local port unavailable.');
  await fs.mkdir(path.dirname(connectionPath), { recursive: true });
  await fs.writeFile(connectionPath, JSON.stringify({ port: address.port, token }), { mode: 0o600 });
  app.once('before-quit', () => {
    server.close();
    void fs.readFile(connectionPath, 'utf8').then(raw => { if (JSON.parse(raw).token === token) return fs.rm(connectionPath, { force: true }); }).catch(() => undefined);
  });
}
