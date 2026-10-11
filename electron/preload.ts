import type { MotionAdjustment, MotionAdjustmentInput } from '../src/domain/motion-adjustment';
import type { JevDrawingInput, JevDrawingParameters } from '../src/domain/jev-drawing';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { EditedMedia } from '../src/domain/edited-media';
import type { AbacoProject, BlenderPlan } from '../src/domain/schema';
import type { JevActionInput, JevActionPlan } from '../src/domain/jev-action';
import type { FontId } from '../src/domain/text-style';

contextBridge.exposeInMainWorld('abaco', {
  getRecoveryStatus: (): Promise<boolean> => ipcRenderer.invoke('app:recovery-status'),
  chooseAgentAssets: () => ipcRenderer.invoke('agent:chooseAssets'),
  listAgentAssets: () => ipcRenderer.invoke('agent:listAssets'),
  onAgentRequest: (callback: (request: { id: string; method: string; args?: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: string; method: string; args?: unknown }) => callback(request);
    ipcRenderer.on('agent:request', listener);
    return () => ipcRenderer.removeListener('agent:request', listener);
  },
  respondAgent: (response: { id: string; result?: unknown; error?: string }) => ipcRenderer.send('agent:response', response),
  agentChat: (message: string, history: Array<{ role: 'user' | 'assistant'; text: string }>, target?: { objectId: string; sceneId: string; frame: number }) => ipcRenderer.invoke('agent:chat', { message, history, target }),
  chatGptStatus: () => ipcRenderer.invoke('chatgpt:status'),
  connectChatGpt: () => ipcRenderer.invoke('chatgpt:connect'),
  disconnectChatGpt: () => ipcRenderer.invoke('chatgpt:disconnect'),
  setChatGptModel: (model: string) => ipcRenderer.invoke('chatgpt:model', model),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project: AbacoProject, path?: string) => ipcRenderer.invoke('project:save', { project, path }),
  exportAiFolder: (project: AbacoProject, projectPath?: string, editedMedia?: EditedMedia) => ipcRenderer.invoke('project:exportAiFolder', { project, projectPath, editedMedia }),
  exportPortableFolder: (project: AbacoProject, projectPath: string | undefined, editedMedia: EditedMedia, outputDirectory?: string) => ipcRenderer.invoke('project:exportPortableFolder', { project, projectPath, editedMedia, outputDirectory }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: { apiKey?: string; jevApiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }) => ipcRenderer.invoke('settings:save', settings),
  chooseBlender: () => ipcRenderer.invoke('settings:chooseBlender'),
  chooseBackground: (kind: 'image' | 'model') => ipcRenderer.invoke('background:choose', kind),
  loadAsset: (path: string) => ipcRenderer.invoke('asset:load', path),
  loadFont: (font: FontId) => ipcRenderer.invoke('font:load', font),
  loadModel: (path: string) => ipcRenderer.invoke('model:load', path),
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  transcribeAudio: (sourcePath: string, language: 'it-IT' | 'en-US') => ipcRenderer.invoke('audio:transcribe', { sourcePath, language }),
  onTranscriptionProgress: (callback: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { received: number; total: number }) => callback(progress);
    ipcRenderer.on('audio:transcribe:progress', listener);
    return () => ipcRenderer.removeListener('audio:transcribe:progress', listener);
  },
  chooseBlendAsset: () => ipcRenderer.invoke('blendAsset:choose'),
  chooseVideo: () => ipcRenderer.invoke('video:choose'),
  videoSource: (filePath: string) => ipcRenderer.invoke('video:source', filePath),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  importDroppedAsset: (filePath: string) => ipcRenderer.invoke('asset:importDrop', filePath),
  ensureBlendAssetProxy: (asset: { sourcePath: string; proxyPath: string }) => ipcRenderer.invoke('blendAsset:ensureProxy', asset),
  generatePlan: (project: AbacoProject, contactSheet?: string) => ipcRenderer.invoke('ai:generate', { project, contactSheet }),
  guideJevDrawing: (input: JevDrawingInput): Promise<JevDrawingParameters> => ipcRenderer.invoke('jev:drawing', input),
  adjustMotion: (input: MotionAdjustmentInput): Promise<MotionAdjustment> => ipcRenderer.invoke('jev:adjust-motion', input),
  generateJevAction: (input: JevActionInput): Promise<JevActionPlan> => ipcRenderer.invoke('jev:action', input),
  onLayaProgress: (callback: (progress: { file: string; received: number; total: number | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { file: string; received: number; total: number | null }) => callback(progress);
    ipcRenderer.on('laya:progress', listener);
    return () => ipcRenderer.removeListener('laya:progress', listener);
  },
  buildBlender: (project: AbacoProject, plan: BlenderPlan, projectPath: string, editedMedia?: EditedMedia) => ipcRenderer.invoke('blender:build', { project, plan, projectPath, editedMedia }),
  syncPreviewProject: (state: { project: AbacoProject; frame: number; theme: 'light' | 'dark' }) => ipcRenderer.send('preview:project', state),
  syncPreviewFrame: (frame: number) => ipcRenderer.send('preview:frame', frame),
  getPreviewState: () => ipcRenderer.invoke('preview:get'),
  onPreviewState: (callback: (state: { project: AbacoProject; frame: number; theme: 'light' | 'dark' }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: { project: AbacoProject; frame: number; theme: 'light' | 'dark' }) => callback(state);
    ipcRenderer.on('preview:state', listener);
    return () => ipcRenderer.removeListener('preview:state', listener);
  },
  onPreviewFrame: (callback: (frame: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: number) => callback(frame);
    ipcRenderer.on('preview:frame', listener);
    return () => ipcRenderer.removeListener('preview:frame', listener);
  },
  onMenuCommand: (callback: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  onShiftChange: (callback: (pressed: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pressed: boolean) => callback(pressed);
    ipcRenderer.on('input:shift', listener);
    return () => ipcRenderer.removeListener('input:shift', listener);
  },
});
