/// <reference types="vite/client" />

import type { AbacoProject, BlenderPlan } from './domain/schema';
import type { JevActionInput, JevActionPlan } from './domain/jev-action';

type PreviewState = { project: AbacoProject; frame: number; theme: 'light' | 'dark' };

declare global {
  interface Window {
    abaco?: {
      openProject(): Promise<{ project: AbacoProject; path: string } | null>;
      saveProject(project: AbacoProject, path?: string): Promise<{ project: AbacoProject; path: string } | null>;
      getSettings(): Promise<{ hasApiKey: boolean; hasJevApiKey: boolean; reasoning: 'medium' | 'high'; blenderPath: string }>;
      saveSettings(settings: { apiKey?: string; jevApiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }): Promise<{ ok: boolean }>;
      chooseBlender(): Promise<string | null>;
      chooseBackground(kind: 'image' | 'model'): Promise<{ path: string; name: string } | null>;
      loadAsset(path: string): Promise<string>;
      loadModel(path: string): Promise<{ format: 'glb'; source: string } | { format: 'obj'; source: string; materials?: string }>;
      chooseAudio(): Promise<{ sourcePath: string; name: string } | null>;
      chooseBlendAsset(): Promise<{ sourcePath: string; proxyPath: string; collectionName: string; name: string; boundsCenter: [number, number, number]; previewScale: number; groundOffset: number } | null>;
      ensureBlendAssetProxy(asset: { sourcePath: string; proxyPath: string }): Promise<{ boundsCenter: [number, number, number]; previewScale: number; groundOffset: number }>;
      generatePlan(project: AbacoProject, contactSheet?: string): Promise<BlenderPlan>;
      generateJevAction(input: JevActionInput): Promise<JevActionPlan>;
      onLayaProgress(callback: (progress: { file: string; received: number; total: number | null }) => void): () => void;
      buildBlender(project: AbacoProject, plan: BlenderPlan, projectPath: string): Promise<{ version: string; directory: string; blendPath: string; audioPath?: string }>;
      syncPreviewProject(state: PreviewState): void;
      syncPreviewFrame(frame: number): void;
      getPreviewState(): Promise<PreviewState | null>;
      onPreviewState(callback: (state: PreviewState) => void): () => void;
      onPreviewFrame(callback: (frame: number) => void): () => void;
      onMenuCommand(callback: (command: 'new' | 'open' | 'save' | 'undo' | 'redo' | 'export-astra' | 'export-direct' | 'settings') => void): () => void;
      onShiftChange(callback: (pressed: boolean) => void): () => void;
    };
  }
}

export {};
