/// <reference types="vite/client" />
import type { MotionAdjustment, MotionAdjustmentInput } from './domain/motion-adjustment';
import type { JevDrawingInput, JevDrawingParameters } from './domain/jev-drawing';

import type { EditedMedia } from './domain/edited-media';
import type { AbacoProject, BlenderPlan } from './domain/schema';
import type { JevActionInput, JevActionPlan } from './domain/jev-action';
import type { FontId } from './domain/text-style';

type PreviewState = { project: AbacoProject; frame: number; theme: 'light' | 'dark' };

declare global {
  interface Window {
    abaco?: {
      chooseAgentAssets(): Promise<Array<{ id: string; kind: string; name: string; path: string }>>;
      listAgentAssets(): Promise<Array<{ id: string; kind: string; name: string; path: string }>>;
      onAgentRequest(callback: (request: { id: string; method: string; args?: unknown }) => void): () => void;
      respondAgent(response: { id: string; result?: unknown; error?: string }): void;
      agentChat(message: string, history: Array<{ role: 'user' | 'assistant'; text: string }>, target?: { objectId: string; sceneId: string; frame: number }): Promise<{ text: string; inputTokens: number; outputTokens: number; steps: number; preview?: string }>;
      chatGptStatus(): Promise<{ connected: boolean; email?: string; model?: string; models: Array<{ id: string; name: string }>; error?: string; usageUrl: string }>;
      connectChatGpt(): Promise<Awaited<ReturnType<NonNullable<Window['abaco']>['chatGptStatus']>>>;
      disconnectChatGpt(): Promise<{ disconnected: boolean; revoked: boolean }>;
      setChatGptModel(model: string): Promise<Awaited<ReturnType<NonNullable<Window['abaco']>['chatGptStatus']>>>;
      getRecoveryStatus(): Promise<boolean>;
      openProject(): Promise<{ project: AbacoProject; path: string } | null>;
      saveProject(project: AbacoProject, path?: string): Promise<{ project: AbacoProject; path: string } | null>;
      exportAiFolder(project: AbacoProject, projectPath?: string, editedMedia?: EditedMedia): Promise<{ directory: string; files: number; warnings: string[] } | null>;
      exportPortableFolder(project: AbacoProject, projectPath: string | undefined, editedMedia: EditedMedia, outputDirectory?: string): Promise<{ directory: string; projectPath: string; manifestPath: string; files: number } | null>;
      getSettings(): Promise<{ hasApiKey: boolean; hasJevApiKey: boolean; reasoning: 'medium' | 'high'; blenderPath: string }>;
      saveSettings(settings: { apiKey?: string; jevApiKey?: string; reasoning: 'medium' | 'high'; blenderPath?: string }): Promise<{ ok: boolean }>;
      chooseBlender(): Promise<string | null>;
      chooseBackground(kind: 'image' | 'model'): Promise<{ path: string; name: string } | null>;
      loadAsset(path: string): Promise<string>;
      loadFont(font: FontId): Promise<string | null>;
      loadModel(path: string): Promise<{ format: 'glb'; source: string } | { format: 'obj'; source: string; materials?: string }>;
      chooseAudio(): Promise<{ sourcePath: string; name: string } | null>;
      transcribeAudio(sourcePath: string, language: 'it-IT' | 'en-US'): Promise<Array<{ start: number; end: number; text: string }>>;
      onTranscriptionProgress(callback: (progress: { received: number; total: number }) => void): () => void;
      chooseBlendAsset(): Promise<{ sourcePath: string; proxyPath: string; collectionName: string; name: string; boundsCenter: [number, number, number]; previewScale: number; groundOffset: number; controllers?: Array<{ name: string; position: [number, number, number]; worldPosition?: [number, number, number]; worldBasis?: [[number, number, number], [number, number, number], [number, number, number]]; morphTargets?: [string, string, string]; morphStep?: number }> } | null>;
      getDroppedFilePath(file: File): string;
      chooseVideo(): Promise<{ sourcePath: string; name: string } | null>;
      videoSource(filePath: string): Promise<string>;
      importDroppedAsset(filePath: string): Promise<
        | { kind: 'image'; path: string; name: string }
        | { kind: 'audio'; sourcePath: string; name: string }
        | { kind: 'video'; sourcePath: string; name: string }
        | { kind: 'blend'; asset: NonNullable<Awaited<ReturnType<NonNullable<Window['abaco']>['chooseBlendAsset']>>> }
      >;
      ensureBlendAssetProxy(asset: { sourcePath: string; proxyPath: string; pose?: Record<string, [number, number, number]> }): Promise<{ boundsCenter: [number, number, number]; previewScale: number; groundOffset: number; controllers?: Array<{ name: string; position: [number, number, number]; worldPosition?: [number, number, number]; worldBasis?: [[number, number, number], [number, number, number], [number, number, number]]; morphTargets?: [string, string, string]; morphStep?: number }> }>;
      generatePlan(project: AbacoProject, contactSheet?: string): Promise<BlenderPlan>;
      guideJevDrawing(input: JevDrawingInput): Promise<JevDrawingParameters>;
      adjustMotion(input: MotionAdjustmentInput): Promise<MotionAdjustment>;
      generateJevAction(input: JevActionInput): Promise<JevActionPlan>;
      onLayaProgress(callback: (progress: { file: string; received: number; total: number | null }) => void): () => void;
      buildBlender(project: AbacoProject, plan: BlenderPlan, projectPath: string, editedMedia?: EditedMedia): Promise<{ version: string; directory: string; blendPath: string; audioPath?: string }>;
      syncPreviewProject(state: PreviewState): void;
      syncPreviewFrame(frame: number): void;
      getPreviewState(): Promise<PreviewState | null>;
      onPreviewState(callback: (state: PreviewState) => void): () => void;
      onPreviewFrame(callback: (frame: number) => void): () => void;
      onMenuCommand(callback: (command: 'new' | 'open' | 'save' | 'undo' | 'redo' | 'export-astra' | 'export-direct' | 'export-ai-folder' | 'settings') => void): () => void;
      onShiftChange(callback: (pressed: boolean) => void): () => void;
    };
  }
}

export {};
