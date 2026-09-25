import { planDirection } from '../src/domain/direction-planner';
import { prepareAnimationProject, buildAnimationBrief } from '../src/domain/animation-handoff';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, type MenuItemConstructorOptions } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { ProjectSchema, BlenderPlanSchema, type AbacoProject, type BlenderPlan } from '../src/domain/schema';
import { ASTRA_INSTRUCTIONS, blenderPlanJsonSchema } from '../src/domain/ai-contract';
import { applyPlan, evaluateTransform, validatePlan } from '../src/domain/animation';
import { JevActionInputSchema } from '../src/domain/jev-action';
import { layaLoadOptions, runLayaQuestions } from '../src/domain/laya-runtime';
import { nextExportVersion } from '../src/domain/versioning';
import { BLENDER_BUILD_SCRIPT } from './blender-template';
import { BLEND_ASSET_PROXY_SCRIPT } from './blend-asset-proxy';
import { hydratePortableProject, projectForStorage } from './project-storage';
import { exportScreenLayers } from './export-screen-layers';

type Settings = { apiKey?: string; jevApiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string };
const defaults: Settings = { reasoning: 'medium' };
let mainWindow: BrowserWindow | null = null;
let previewWindow: BrowserWindow | null = null;
type LayaRuntime = Awaited<ReturnType<(typeof import('@receptron/laya'))['Laya']['load']>>;
let layaRuntimePromise: Promise<LayaRuntime> | null = null;
type PreviewState = { project: AbacoProject; frame: number; theme: 'light' | 'dark' };
let latestPreviewState: PreviewState | null = null;
type MenuCommand = 'new' | 'open' | 'save' | 'undo' | 'redo' | 'export-astra' | 'export-direct' | 'settings';

function loadLayaRuntime(onProgress: (progress: { file: string; received: number; total: number | null }) => void) {
  if (!layaRuntimePromise) {
    layaRuntimePromise = import('@receptron/laya')
      .then(({ Laya }) => Laya.load(layaLoadOptions(onProgress)))
      .catch((cause) => {
        layaRuntimePromise = null;
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Laya was not loaded. ${detail}`);
      });
  }
  return layaRuntimePromise;
}

function sendMenuCommand(command: MenuCommand) {
  mainWindow?.webContents.send('menu:command', command);
}

function installApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [
      { label: 'New project', accelerator: 'CmdOrCtrl+N', click: () => sendMenuCommand('new') },
      { label: 'Open project…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('open') },
      { label: 'Save project', accelerator: 'CmdOrCtrl+S', click: () => sendMenuCommand('save') },
      { type: 'separator' },
      { label: 'Export', submenu: [
        { label: 'Blender + Astra…', click: () => sendMenuCommand('export-astra') },
        { label: 'Direct Blender export', click: () => sendMenuCommand('export-direct') },
      ] },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenuCommand('settings') },
      { type: 'separator' },
      { role: 'quit', label: 'Quit' },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuCommand('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuCommand('redo') },
      { type: 'separator' },
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' },
      { role: 'selectAll', label: 'Select all' },
    ] },
    { label: 'View', submenu: [
      { label: 'Open camera preview', accelerator: 'CmdOrCtrl+Shift+P', click: () => openPreviewWindow() },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Full screen' },
    ] },
    { label: 'Window', submenu: [
      { role: 'minimize', label: 'Minimize' },
      { role: 'close', label: 'Close' },
    ] },
    { label: 'Help', submenu: [
      { label: 'About Scene', click: () => dialog.showMessageBox(mainWindow!, { type: 'info', title: 'Scene', message: 'Scene', detail: `Version ${app.getVersion()}\nLocal editor for 3D animatics.` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    if (previewWindow.isMinimized()) previewWindow.restore();
    previewWindow.show();
    previewWindow.focus();
    return;
  }
  previewWindow = new BrowserWindow({
    width: 1100, height: 700, minWidth: 480, minHeight: 320,
    backgroundColor: '#090909', title: 'Camera Preview — Scene',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  previewWindow.on('closed', () => { previewWindow = null; });
  previewWindow.webContents.on('did-finish-load', () => {
    if (latestPreviewState) previewWindow?.webContents.send('preview:state', latestPreviewState);
  });
  if (app.isPackaged) await previewWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { preview: '1' } });
  else await previewWindow.loadURL('http://localhost:5173/?preview=1');
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
async function readSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as { encryptedApiKey?: string; encryptedJevApiKey?: string; reasoning?: 'medium' | 'high'; blenderPath?: string };
    const apiKey = raw.encryptedApiKey && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(raw.encryptedApiKey, 'base64')) : undefined;
    const jevApiKey = raw.encryptedJevApiKey && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(raw.encryptedJevApiKey, 'base64')) : undefined;
    return { ...defaults, reasoning: raw.reasoning ?? 'medium', blenderPath: raw.blenderPath, apiKey, jevApiKey };
  } catch { return defaults; }
}
async function writeSettings(settings: Settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  if ((settings.apiKey || settings.jevApiKey) && !safeStorage.isEncryptionAvailable()) {
    throw new Error('System encryption is unavailable. API keys were not saved.');
  }
  const encryptedApiKey = settings.apiKey ? safeStorage.encryptString(settings.apiKey).toString('base64') : undefined;
  const encryptedJevApiKey = settings.jevApiKey ? safeStorage.encryptString(settings.jevApiKey).toString('base64') : undefined;
  await fs.writeFile(settingsPath(), JSON.stringify({ encryptedApiKey, encryptedJevApiKey, reasoning: settings.reasoning, blenderPath: settings.blenderPath }, null, 2), { mode: 0o600 });
}

async function atomicWrite(filePath: string, contents: string) {
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temp, contents, 'utf8');
  await fs.rename(temp, filePath);
}

const portablePath = (value: string) => value.split(path.sep).join('/');
const safeAssetName = (value: string) => value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
const isDataUrl = (value: string) => value.startsWith('data:');
async function fileExists(filePath: string) {
  try { await fs.access(filePath); return true; } catch { return false; }
}
async function imageFileDataUrl(filePath: string) {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error(`Unreadable image: ${path.basename(filePath)}`);
  const size = image.getSize();
  const maxSide = 2560;
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  const preview = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }) : image;
  return preview.toDataURL();
}
const mediaMimeTypes: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};
async function mediaFileDataUrl(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = mediaMimeTypes[extension];
  if (!mime) throw new Error(`Unsupported audio format: ${extension || 'unknown'}`);
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
function dataUrlBuffer(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return undefined;
  const extension = match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/webp' ? '.webp' : '.png';
  return { extension, buffer: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])) };
}
async function makePortableProject(project: AbacoProject, root: string) {
  const portable = structuredClone(project);
  const copied = new Map<string, string>();
  const copyAsset = async (source: string, category: string, identity: string, fallback?: string) => {
    const usable = isDataUrl(source) ? source : source && await fileExists(source) ? source : fallback;
    if (!usable) throw new Error(`Missing asset during export: ${source || identity}`);
    const cached = copied.get(usable);
    if (cached) return cached;
    const encoded = isDataUrl(usable) ? dataUrlBuffer(usable) : undefined;
    const originalName = encoded ? `${identity}${encoded.extension}` : path.basename(usable);
    const destination = path.join(root, 'assets', category, `${identity.slice(0, 8)}-${safeAssetName(originalName)}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (encoded) await fs.writeFile(destination, encoded.buffer);
    else await fs.copyFile(usable, destination);
    const relative = portablePath(path.relative(root, destination));
    copied.set(usable, relative);
    return relative;
  };
  const copyObjBackground = async (source: string, identity: string) => {
    const directory = path.join(root, 'assets', 'sfondi', identity.slice(0, 8));
    await fs.mkdir(directory, { recursive: true });
    const objText = await fs.readFile(source, 'utf8');
    const destination = path.join(directory, safeAssetName(path.basename(source)));
    await fs.writeFile(destination, objText);
    const materialNames = [...objText.matchAll(/^\s*mtllib\s+(.+)\s*$/gmi)].map((match) => match[1].trim());
    for (const materialName of materialNames) {
      const materialSource = path.resolve(path.dirname(source), materialName);
      const materialText = await fs.readFile(materialSource, 'utf8').catch(() => undefined);
      if (!materialText) continue;
      await fs.writeFile(path.join(directory, path.basename(materialName)), materialText);
      const textureNames = [...materialText.matchAll(/^\s*(?:map_Ka|map_Kd|map_Ks|map_Ke|map_d|bump|map_bump|disp|decal)\s+(.+)\s*$/gmi)]
        .map((match) => match[1].trim().split(/\s+/).at(-1)!)
        .filter(Boolean);
      for (const textureName of textureNames) {
        const textureSource = path.resolve(path.dirname(materialSource), textureName);
        await fs.copyFile(textureSource, path.join(directory, path.basename(textureName))).catch(() => undefined);
      }
    }
    return portablePath(path.relative(root, destination));
  };
  for (const object of portable.objects) {
    if (object.kind === 'audio' && object.asset.sourcePath) {
      object.asset.sourcePath = await copyAsset(object.asset.sourcePath, 'audio', object.id);
    } else if (object.kind === 'blend_asset') {
      if (object.asset.sourcePath) object.asset.sourcePath = await copyAsset(object.asset.sourcePath, 'modelli', object.id);
      if (object.asset.proxyPath) object.asset.proxyPath = await copyAsset(object.asset.proxyPath, 'anteprime', `${object.id}-preview`);
    } else if (object.screenSpace && object.kind !== 'text' && (object.asset.sourcePath || object.asset.proxyPath)) {
      const relative = await copyAsset(object.asset.sourcePath, 'immagini', object.id, object.asset.proxyPath);
      object.asset.sourcePath = relative;
      object.asset.proxyPath = relative;
    }
  }
  for (const scene of portable.cameraCuts) {
    if (scene.background.path) scene.background.path = scene.background.kind === 'model' && path.extname(scene.background.path).toLowerCase() === '.obj'
      ? await copyObjBackground(scene.background.path, scene.id)
      : await copyAsset(scene.background.path, 'sfondi', scene.id);
  }
  return ProjectSchema.parse(portable);
}
function compactProject(project: AbacoProject) {
  const round = (value: unknown): unknown => {
    if (typeof value === 'number') return Number(value.toFixed(4));
    if (Array.isArray(value)) return value.map(round);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, round(item)]));
    return value;
  };
  const copy = prepareAnimationProject(project);
  copy.objects.sort((a, b) => a.id.localeCompare(b.id));
  copy.objects.forEach((object) => {
    object.keyframes.sort((a, b) => a.frame - b.frame || a.property.localeCompare(b.property));
    object.sceneNotes.sort((a, b) => a.frame - b.frame);
    if (object.kind === 'blend_asset') object.asset = { ...object.asset, sourcePath: '', proxyPath: '' };
  });
  copy.comments = copy.comments.filter((comment) => comment.status === 'pending').sort((a, b) => a.startFrame - b.startFrame);
  copy.cameraCuts.sort((a, b) => a.frame - b.frame);
  return round(copy);
}

async function runProcess(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`Blender exited with code ${code}.\n${output}`)));
  });
}

async function blenderCommand(extraFlatpakPermissions: string[] = []) {
  const settings = await readSettings();
  if (settings.blenderPath) return { command: settings.blenderPath, prefix: [] as string[] };
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Blender.app/Contents/MacOS/Blender',
      path.join(app.getPath('desktop'), 'Blender.app/Contents/MacOS/Blender'),
      path.join(app.getPath('home'), 'Applications/Blender.app/Contents/MacOS/Blender'),
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return { command: candidate, prefix: [] as string[] };
      } catch { /* prova la posizione successiva */ }
    }
    return { command: candidates[0], prefix: [] as string[] };
  }
  if (process.platform === 'linux') return { command: 'flatpak', prefix: ['run', ...extraFlatpakPermissions.map((value) => `--filesystem=${value}`), 'org.blender.Blender'] };
  return { command: 'blender', prefix: [] as string[] };
}

type BlendProxyMetadata = { boundsCenter: [number, number, number]; previewScale: number; groundOffset: number; meshCount?: number };
const blendProxyJobs = new Map<string, Promise<BlendProxyMetadata>>();

async function buildBlendAssetProxy(sourcePath: string, proxyPath: string, force = false): Promise<BlendProxyMetadata> {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedProxy = path.resolve(proxyPath);
  const markerPath = `${resolvedProxy}.v3.json`;
  const sourceStats = await fs.stat(resolvedSource);
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(markerPath, 'utf8')) as BlendProxyMetadata & { sourcePath: string; sourceMtimeMs: number };
      const proxyStats = await fs.stat(resolvedProxy);
      if (cached.sourcePath === resolvedSource && cached.sourceMtimeMs === sourceStats.mtimeMs && proxyStats.size > 1024 && (cached.meshCount ?? 0) > 0) return cached;
    } catch { /* proxy precedente o incompleto: viene rigenerato */ }
  }
  const existing = blendProxyJobs.get(resolvedProxy);
  if (existing) return existing;
  const job = (async () => {
    const cacheDir = path.dirname(resolvedProxy);
    const scriptPath = path.join(cacheDir, `${path.basename(resolvedProxy, '.glb')}.proxy-v2.py`);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(scriptPath, BLEND_ASSET_PROXY_SCRIPT, 'utf8');
    const invocation = await blenderCommand([`${path.dirname(resolvedSource)}:ro`, cacheDir]);
    try {
      const output = await runProcess(invocation.command, [...invocation.prefix, resolvedSource, '--background', '--python', scriptPath, '--', resolvedProxy], cacheDir);
      const marker = output.split(/\r?\n/).find((line) => line.startsWith('ABACO_BLEND_ASSET='));
      if (!marker) throw new Error(`Blender did not create the asset preview.\n${output}`);
      const metadata = JSON.parse(marker.slice('ABACO_BLEND_ASSET='.length)) as BlendProxyMetadata;
      if (!metadata.meshCount) throw new Error('The Blender file did not produce visible geometry for the preview.');
      await atomicWrite(markerPath, JSON.stringify({ ...metadata, sourcePath: resolvedSource, sourceMtimeMs: sourceStats.mtimeMs }));
      return metadata;
    } catch (error) {
      await fs.rm(resolvedProxy, { force: true }).catch(() => undefined);
      await fs.rm(markerPath, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Blender was not found. Configure it under File → Settings.');
      throw error;
    } finally {
      await fs.rm(scriptPath, { force: true }).catch(() => undefined);
    }
  })();
  blendProxyJobs.set(resolvedProxy, job);
  try { return await job; }
  finally { blendProxyJobs.delete(resolvedProxy); }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 960, minWidth: 640, minHeight: 480, backgroundColor: '#101319',
    title: 'Scene',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
    autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close();
  });
  let shiftDown = false;
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const next = Boolean(input.shift);
    if (next === shiftDown) return;
    shiftDown = next;
    mainWindow?.webContents.send('input:shift', shiftDown);
  });
  if (app.isPackaged) await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  else await mainWindow.loadURL('http://localhost:5173');
}

app.whenReady().then(() => { installApplicationMenu(); return createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

ipcMain.on('preview:project', (_event, payload: PreviewState) => {
  const parsed = ProjectSchema.safeParse(payload?.project);
  if (!parsed.success) return;
  const project = parsed.data;
  const frame = Math.max(project.settings.frameStart, Math.min(project.settings.frameEnd, Math.round(Number(payload.frame) || project.settings.frameStart)));
  latestPreviewState = { project, frame, theme: 'dark' };
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.webContents.send('preview:state', latestPreviewState);
});
ipcMain.on('preview:frame', (_event, incomingFrame: number) => {
  if (!latestPreviewState) return;
  const { frameStart, frameEnd } = latestPreviewState.project.settings;
  const frame = Math.max(frameStart, Math.min(frameEnd, Math.round(Number(incomingFrame) || frameStart)));
  latestPreviewState = { ...latestPreviewState, frame };
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.webContents.send('preview:frame', frame);
});
ipcMain.handle('preview:get', () => latestPreviewState);

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'openDirectory'], title: 'Open Scene project or folder', filters: [{ name: 'Scene', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  let filePath = result.filePaths[0];
  if ((await fs.stat(filePath)).isDirectory()) {
    const entries = await fs.readdir(filePath);
    const projectFile = entries.find((entry) => entry === 'project.abaco.json')
      ?? entries.find((entry) => entry.endsWith('.abaco.json'))
      ?? entries.find((entry) => entry === 'input.json');
    if (!projectFile) throw new Error('The folder does not contain a reloadable Scene project.');
    filePath = path.join(filePath, projectFile);
  }
  const stored = ProjectSchema.parse(JSON.parse(await fs.readFile(filePath, 'utf8')));
  const project = await hydratePortableProject(stored, filePath, imageFileDataUrl);
  return { project, path: filePath };
});

ipcMain.handle('project:save', async (_event, payload: { project: AbacoProject; path?: string }) => {
  const project = ProjectSchema.parse(prepareAnimationProject({ ...payload.project, updatedAt: new Date().toISOString() }));
  let filePath = payload.path;
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: 'scene.abaco.json', filters: [{ name: 'Scene', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }
  await atomicWrite(filePath, JSON.stringify(projectForStorage(project, filePath), null, 2));
  return { path: filePath, project };
});

ipcMain.handle('settings:get', async () => {
  const settings = await readSettings();
  return { hasApiKey: Boolean(settings.apiKey), hasJevApiKey: Boolean(settings.jevApiKey), reasoning: settings.reasoning, blenderPath: settings.blenderPath ?? '' };
});
ipcMain.handle('settings:save', async (_event, incoming: { apiKey?: string; jevApiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }) => {
  const current = await readSettings();
  await writeSettings({ apiKey: incoming.apiKey?.trim() || current.apiKey, jevApiKey: incoming.jevApiKey?.trim() || current.jevApiKey, reasoning: incoming.reasoning, blenderPath: incoming.blenderPath?.trim() || undefined });
  return { ok: true };
});
ipcMain.handle('settings:chooseBlender', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], title: 'Select Blender executable' });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('background:choose', async (_event, kind: 'image' | 'model') => {
  const filters = kind === 'image'
    ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    : [{ name: '3D models', extensions: ['glb', 'obj'] }];
  const result = await dialog.showOpenDialog(mainWindow!, { properties: kind === 'model' ? ['openFile', 'openDirectory'] : ['openFile'], title: kind === 'image' ? 'Choose a background' : 'Choose a GLB or OBJ model, or a folder', filters });
  if (result.canceled || !result.filePaths[0]) return null;
  let selected = result.filePaths[0];
  if (kind === 'model' && (await fs.stat(selected)).isDirectory()) {
    const entries = await fs.readdir(selected);
    const model = entries.sort((a, b) => a.localeCompare(b)).find((entry) => path.extname(entry).toLowerCase() === '.glb')
      ?? entries.sort((a, b) => a.localeCompare(b)).find((entry) => path.extname(entry).toLowerCase() === '.obj');
    if (!model) throw new Error('The folder does not contain a GLB or OBJ model.');
    selected = path.join(selected, model);
  }
  return { path: selected, name: path.basename(selected) };
});

ipcMain.handle('asset:load', async (_event, filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension in mediaMimeTypes) return mediaFileDataUrl(filePath);
  if (extension !== '.glb') return imageFileDataUrl(filePath);
  const buffer = await fs.readFile(filePath);
  return `data:model/gltf-binary;base64,${buffer.toString('base64')}`;
});

ipcMain.handle('model:load', async (_event, filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.glb') {
    const buffer = await fs.readFile(filePath);
    return { format: 'glb' as const, source: `data:model/gltf-binary;base64,${buffer.toString('base64')}` };
  }
  if (extension !== '.obj') throw new Error(`Unsupported scenery format: ${extension || 'unknown'}`);
  const source = await fs.readFile(filePath, 'utf8');
  const materialName = source.match(/^\s*mtllib\s+(.+)\s*$/mi)?.[1]?.trim();
  let materials: string | undefined;
  if (materialName) {
    const materialPath = path.resolve(path.dirname(filePath), materialName);
    materials = await fs.readFile(materialPath, 'utf8').catch(() => undefined);
  }
  return { format: 'obj' as const, source, materials };
});

ipcMain.handle('audio:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'], title: 'Add audio',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const sourcePath = path.resolve(result.filePaths[0]);
  return { sourcePath, name: path.basename(sourcePath, path.extname(sourcePath)) };
});

ipcMain.handle('blendAsset:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'], title: 'Add a character or Blender asset',
    filters: [{ name: 'Blender files', extensions: ['blend'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const sourcePath = path.resolve(result.filePaths[0]);
  const cacheDir = path.join(app.getPath('userData'), 'asset-cache');
  const assetId = crypto.randomUUID();
  const proxyPath = path.join(cacheDir, `${assetId}.glb`);
  const metadata = await buildBlendAssetProxy(sourcePath, proxyPath, true);
  return {
    sourcePath, proxyPath, collectionName: 'Blender Scene',
    name: path.basename(sourcePath, path.extname(sourcePath)),
    boundsCenter: metadata.boundsCenter, previewScale: metadata.previewScale, groundOffset: metadata.groundOffset,
  };
});

ipcMain.handle('blendAsset:ensureProxy', async (_event, asset: { sourcePath: string; proxyPath: string }) => {
  if (!asset.sourcePath || !asset.proxyPath) throw new Error('Invalid Blender asset path.');
  return buildBlendAssetProxy(asset.sourcePath, asset.proxyPath);
});

ipcMain.handle('ai:generate', async (_event, payload: { project: AbacoProject; contactSheet?: string }) => {
  const project = ProjectSchema.parse(prepareAnimationProject(payload.project));
  if (!project.comments.some((comment) => comment.status === 'pending')) {
    return { schemaVersion: 'BlenderPlanV1', summary: 'Current scene export without Astra instructions.', assumptions: [], warnings: ['No pending comments: the existing scene, camera, and animations were preserved.'], operations: [] };
  }
  const settings = await readSettings();
  if (!settings.apiKey) throw new Error('Configure the OpenAI API key in Settings first.');
  const client = new OpenAI({ apiKey: settings.apiKey });
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: JSON.stringify(compactProject(project)) }];
  if (payload.contactSheet?.startsWith('data:image/')) content.push({ type: 'input_image', image_url: payload.contactSheet, detail: 'low' });
  const response = await client.responses.create({
    model: 'gpt-6-astra', reasoning: { effort: settings.reasoning }, store: false,
    instructions: ASTRA_INSTRUCTIONS,
    input: [{ role: 'user', content }] as never,
    text: { format: { type: 'json_schema', name: 'blender_plan_v1', strict: true, schema: blenderPlanJsonSchema } } as never,
  });
  if (!response.output_text) throw new Error('Astra did not return a usable plan.');
  const plan = BlenderPlanSchema.parse(JSON.parse(response.output_text));
  const errors = validatePlan(project, plan);
  if (errors.length) throw new Error(`The plan was rejected:\n${errors.join('\n')}`);
  return plan;
});

ipcMain.handle('jev:action', async (event, incoming: unknown) => {
  const parsed = JevActionInputSchema.parse(incoming);
  const engine = parsed.engine ?? 'jev';
  const startedAt = Date.now();
  const project = ProjectSchema.parse(parsed.project);
  const selected = parsed.objectId ? project.objects.find((candidate) => candidate.id === parsed.objectId) : undefined;
  const object = parsed.target === 'camera' ? undefined : selected;
  if (parsed.target === 'camera' && (!selected || selected.kind !== 'camera')) throw new Error('The selected camera is invalid.');
  if (parsed.target !== 'camera' && parsed.objectId && (!object || object.kind === 'camera' || object.kind === 'audio' || object.kind.includes('light') || object.screenSpace)) {
    throw new Error('Select an animatable character or 3D element.');
  }
  if (object && !parsed.startPosition) throw new Error('The subject starting position is invalid.');
  if (!project.cameraCuts.some((scene) => scene.id === parsed.sceneId)) throw new Error('The active scene no longer exists.');
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === parsed.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  if (parsed.frame >= sceneEnd) throw new Error('Move the playhead before the last frame of the scene to create motion.');
  const wasWarm = engine === 'laya' && Boolean(layaRuntimePromise);
  const loadStartedAt = Date.now();
  let modelLoadMs = 0;
  let laya: LayaRuntime | undefined;
  let jevApiKey: string | undefined;
  if (engine === 'laya') {
    laya = await loadLayaRuntime((progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('laya:progress', progress);
    });
    modelLoadMs = Date.now() - loadStartedAt;
  } else {
    const settings = await readSettings();
    if (!settings.jevApiKey) throw new Error('Configure the TypeSafe/Jev API key in Settings first.');
    jevApiKey = settings.jevApiKey;
  }
  let decisionMs = 0;
  const runDecision = async (request: { model: string; state: unknown; questions: Record<string, unknown> }) => {
    const decisionStartedAt = Date.now();
    let raw: unknown;
    if (engine === 'laya') raw = await runLayaQuestions(laya!, request.state, request.questions as never);
    else {
      const response = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jevApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Jev did not complete the request (${response.status}).${detail ? ` ${detail.slice(0, 240)}` : ''}`);
      }
      raw = await response.json();
    }
    decisionMs += Date.now() - decisionStartedAt;
    return raw;
  };
  const compiled = await planDirection(project, parsed, runDecision);
  return { ...compiled, performance: { engine, totalMs: Date.now() - startedAt, decisionMs, modelLoadMs, warm: engine === 'jev' || wasWarm } };
});

ipcMain.handle('blender:build', async (_event, payload: { project: AbacoProject; plan: BlenderPlan; projectPath: string }) => {
  const project = ProjectSchema.parse(prepareAnimationProject(payload.project));
  const plan = BlenderPlanSchema.parse(payload.plan);
  const errors = validatePlan(project, plan);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!payload.projectPath) throw new Error('Save the project before generating the Blender file.');
  const exportsRoot = path.join(path.dirname(payload.projectPath), 'exports');
  await fs.mkdir(exportsRoot, { recursive: true });
  const entries = await fs.readdir(exportsRoot).catch(() => [] as string[]);
  const version = nextExportVersion(entries);
  const tempDir = path.join(exportsRoot, `.${version}-${crypto.randomUUID()}.tmp`);
  const finalDir = path.join(exportsRoot, version);
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const portableProject = await makePortableProject(project, tempDir);
    const projectBundlePath = path.join(tempDir, 'project.abaco.json');
    const inputPath = path.join(tempDir, 'input.json');
    const planPath = path.join(tempDir, 'plan.json');
    const scriptPath = path.join(tempDir, 'build_scene.py');
    const blendPath = path.join(tempDir, `scene_${version}.blend`);
    const audioPath = path.join(tempDir, `audio_${version}.wav`);
    await fs.writeFile(projectBundlePath, JSON.stringify(portableProject, null, 2));
    await fs.writeFile(inputPath, JSON.stringify({ ...portableProject, screenLayers: exportScreenLayers(project) }, null, 2));
    await fs.writeFile(path.join(tempDir, 'ISTRUZIONI_ANIMAZIONE.md'), buildAnimationBrief(portableProject));
    if (portableProject.animationStandard) await fs.writeFile(path.join(tempDir, 'STANDARD_ANIMAZIONE_ALLEGATO.md'), portableProject.animationStandard.content);
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2));
    await fs.writeFile(scriptPath, BLENDER_BUILD_SCRIPT);
    const invocation = await blenderCommand([tempDir]);
    const output = await runProcess(invocation.command, [...invocation.prefix, '--background', '--python-exit-code', '1', '--python', scriptPath, '--', inputPath, planPath, blendPath, audioPath], tempDir);
    if (!output.includes('ABACO_ANIMATIC_COMPLETE') || !(await fs.stat(blendPath)).size) {
      throw new Error('Blender did not generate a complete file.');
    }
    await fs.writeFile(path.join(tempDir, 'blender.log'), output);
    await fs.rename(tempDir, finalDir);
    return { version, directory: finalDir, blendPath: path.join(finalDir, `scene_${version}.blend`), audioPath: project.objects.some((object) => object.kind === 'audio') ? path.join(finalDir, `audio_${version}.wav`) : undefined };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
});
