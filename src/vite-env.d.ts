/// <reference types="vite/client" />

import type { AbacoProject, BlenderPlan } from './domain/schema';

declare global {
  interface Window {
    abaco?: {
      openProject(): Promise<{ project: AbacoProject; path: string } | null>;
      saveProject(project: AbacoProject, path?: string): Promise<{ project: AbacoProject; path: string } | null>;
      getSettings(): Promise<{ hasApiKey: boolean; reasoning: 'medium' | 'high'; blenderPath: string }>;
      saveSettings(settings: { apiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }): Promise<{ ok: boolean }>;
      chooseBlender(): Promise<string | null>;
      chooseBackground(kind: 'image' | 'model'): Promise<{ path: string; name: string } | null>;
      loadAsset(path: string): Promise<string>;
      chooseBlendAsset(): Promise<{ sourcePath: string; proxyPath: string; collectionName: string; name: string; boundsCenter: [number, number, number]; previewScale: number } | null>;
      generatePlan(project: AbacoProject, contactSheet?: string): Promise<BlenderPlan>;
      buildBlender(project: AbacoProject, plan: BlenderPlan, projectPath: string): Promise<{ version: string; directory: string; blendPath: string }>;
      onMenuCommand(callback: (command: 'new' | 'open' | 'save' | 'undo' | 'redo' | 'export-astra' | 'export-direct' | 'settings' | 'toggle-theme') => void): () => void;
      onShiftChange(callback: (pressed: boolean) => void): () => void;
    };
  }
}

export {};
