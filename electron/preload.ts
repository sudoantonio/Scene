import { contextBridge, ipcRenderer } from 'electron';
import type { AbacoProject, BlenderPlan } from '../src/domain/schema';
import type { JevActionInput, JevActionPlan } from '../src/domain/jev-action';

contextBridge.exposeInMainWorld('abaco', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project: AbacoProject, path?: string) => ipcRenderer.invoke('project:save', { project, path }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: { apiKey?: string; jevApiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }) => ipcRenderer.invoke('settings:save', settings),
  chooseBlender: () => ipcRenderer.invoke('settings:chooseBlender'),
  chooseBackground: (kind: 'image' | 'model') => ipcRenderer.invoke('background:choose', kind),
  loadAsset: (path: string) => ipcRenderer.invoke('asset:load', path),
  loadModel: (path: string) => ipcRenderer.invoke('model:load', path),
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  transcribeAudio: (sourcePath: string, language: 'it-IT' | 'en-US') => ipcRenderer.invoke('audio:transcribe', { sourcePath, language }),
  onTranscriptionProgress: (callback: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { received: number; total: number }) => callback(progress);
    ipcRenderer.on('audio:transcribe:progress', listener);
    return () => ipcRenderer.removeListener('audio:transcribe:progress', listener);
  },
  chooseBlendAsset: () => ipcRenderer.invoke('blendAsset:choose'),
  ensureBlendAssetProxy: (asset: { sourcePath: string; proxyPath: string }) => ipcRenderer.invoke('blendAsset:ensureProxy', asset),
  generatePlan: (project: AbacoProject, contactSheet?: string) => ipcRenderer.invoke('ai:generate', { project, contactSheet }),
  generateJevAction: (input: JevActionInput): Promise<JevActionPlan> => ipcRenderer.invoke('jev:action', input),
  onLayaProgress: (callback: (progress: { file: string; received: number; total: number | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { file: string; received: number; total: number | null }) => callback(progress);
    ipcRenderer.on('laya:progress', listener);
    return () => ipcRenderer.removeListener('laya:progress', listener);
  },
  buildBlender: (project: AbacoProject, plan: BlenderPlan, projectPath: string) => ipcRenderer.invoke('blender:build', { project, plan, projectPath }),
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
