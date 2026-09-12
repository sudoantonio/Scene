import { contextBridge, ipcRenderer } from 'electron';
import type { AbacoProject, BlenderPlan } from '../src/domain/schema';

contextBridge.exposeInMainWorld('abaco', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project: AbacoProject, path?: string) => ipcRenderer.invoke('project:save', { project, path }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: { apiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }) => ipcRenderer.invoke('settings:save', settings),
  chooseBlender: () => ipcRenderer.invoke('settings:chooseBlender'),
  chooseBackground: (kind: 'image' | 'model') => ipcRenderer.invoke('background:choose', kind),
  loadAsset: (path: string) => ipcRenderer.invoke('asset:load', path),
  chooseBlendAsset: () => ipcRenderer.invoke('blendAsset:choose'),
  generatePlan: (project: AbacoProject, contactSheet?: string) => ipcRenderer.invoke('ai:generate', { project, contactSheet }),
  buildBlender: (project: AbacoProject, plan: BlenderPlan, projectPath: string) => ipcRenderer.invoke('blender:build', { project, plan, projectPath }),
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
