import manifest from '../../package.json';
import { shareProjectSnapshot } from '../domain/project-sharing';
import { AgentRequestSchema, agentSummary, applyAgentCommands, type AgentAsset } from '../domain/agent-commands';
import { evaluateTransform } from '../domain/animation';
import { editedCaptions } from '../domain/media-timeline';
import { agentTimingIssues } from '../domain/agent-timing';
import { agentFramingIssues } from '../domain/agent-framing';
import { useEditor } from './editor';

let revision = 0;
useEditor.subscribe((state, previous) => { if (state.project !== previous.project) revision += 1; });

export function agentEditorStatus(detail: 'summary' | 'full' = 'summary') {
  const state = useEditor.getState();
  const selected = state.project.objects.find((object) => object.id === state.selectedId);
  const ordered = state.project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const currentScene = ordered.find((scene, index) => state.currentFrame >= scene.frame && state.currentFrame < (ordered[index + 1]?.frame ?? state.project.settings.frameEnd + 1));
  const full = agentSummary(state.project);
  const compact = {
    projectId: full.projectId, name: full.name, fps: full.fps, resolution: full.resolution,
    storyboard: state.project.storyboard ? { beats: state.project.storyboard.beats.length, hasScript: Boolean(state.project.storyboard.script) } : undefined,
    motions: full.motions.map(({ id, elementId, name, startFrame, endFrame, durationSeconds, pace, beatId, speedPerSecond, speedUnit, warnings }) => ({ id, elementId, name, startFrame, endFrame, durationSeconds, pace, beatId, speedPerSecond, speedUnit, warnings })),
    scenes: full.scenes.map((scene) => ({ id: scene.id, name: scene.name, startFrame: scene.startFrame, durationFrames: scene.durationFrames, cameraId: scene.cameraId, background: scene.background, elementCount: scene.elements.length, beatCount: state.project.storyboard?.beats.filter((beat) => beat.sceneId === scene.id).length ?? 0 })),
  };
  return {
    applicationVersion: manifest.version, revision, path: state.projectPath, dirty: state.dirty, currentFrame: state.currentFrame, currentSceneId: currentScene?.id,
    selection: selected ? { id: selected.id, name: selected.name, kind: selected.kind, transform: evaluateTransform(selected, state.currentFrame), color: selected.color, visible: selected.visible, sceneIds: selected.sceneIds, asset: selected.asset.sourcePath ? selected.asset.sourcePath.split('/').at(-1) : undefined } : undefined,
    camera: currentScene ? (() => { const camera = state.project.objects.find((object) => object.id === currentScene.cameraId); return camera ? { id: camera.id, transform: evaluateTransform(camera, state.currentFrame) } : undefined; })() : undefined,
    ...(detail === 'full' ? full : compact),
  };
}

export function agentStoryboardStatus() {
  const project = useEditor.getState().project;
  return { revision, projectId: project.id, storyboard: project.storyboard ?? { script: '', beats: [] } };
}

export function agentTimingStatus() {
  const project = useEditor.getState().project;
  return { revision, projectId: project.id, issues: agentTimingIssues(project) };
}

export function agentFramingStatus() {
  const project = useEditor.getState().project;
  return { revision, projectId: project.id, issues: agentFramingIssues(project) };
}

export function agentSceneDetail(sceneId: string, frame?: number) {
  const project = useEditor.getState().project;
  const ordered = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const index = ordered.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error('Scene not found.');
  const scene = ordered[index];
  const endFrame = (ordered[index + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  const atFrame = frame ?? scene.frame;
  if (!Number.isInteger(atFrame) || atFrame < scene.frame || atFrame > endFrame) throw new Error('Frame outside the scene.');
  const present = project.objects.filter((object) => object.kind !== 'camera' && object.kind !== 'audio' && (object.sceneIds.length === 0 || object.sceneIds.includes(scene.id)));
  const audio = project.objects.filter((object) => object.kind === 'audio');
  const captions = editedCaptions(project).filter((item) => item.endFrameExclusive > scene.frame && item.startFrame <= endFrame).map((item) => ({ startFrame: item.startFrame, endFrameExclusive: item.endFrameExclusive, text: item.text, audioObjectId: item.audioObjectId }));
  const summary = agentSummary(project);
  return {
    revision, projectId: project.id, scene: { id: scene.id, name: scene.name, startFrame: scene.frame, endFrame, durationFrames: endFrame - scene.frame + 1, background: scene.background, lighting: scene.lighting, framing: scene.framing },
    atFrame,
    camera: (() => { const camera = project.objects.find((item) => item.id === scene.cameraId)!; return { id: camera.id, transform: evaluateTransform(camera, atFrame), lens: camera.camera.lens }; })(),
    beats: project.storyboard?.beats.filter((beat) => beat.sceneId === scene.id) ?? [],
    notes: project.comments.filter((item) => item.sceneId === scene.id && item.scope === 'scene').map((item) => item.text),
    elements: present.map((object) => ({ id: object.id, name: object.name, kind: object.kind, transform: evaluateTransform(object, atFrame), asset: object.asset.sourcePath ? object.asset.sourcePath.split('/').at(-1) : undefined, text: object.kind === 'text' ? object.text : undefined })),
    audio: audio.map((object) => ({ id: object.id, name: object.name, muted: object.audio.muted, volume: object.audio.volume, duration: object.audio.duration })),
    captions,
    motions: summary.motions.filter((motion) => motion.startFrame <= endFrame && motion.endFrame >= scene.frame),
    framingIssues: agentFramingIssues(project).filter((issue) => issue.sceneId === scene.id),
  };
}

export function applyAgentRequest(incoming: unknown) {
  const request = AgentRequestSchema.parse(incoming);
  const state = useEditor.getState();
  if (request.expectedRevision !== revision) throw new Error(`The project changed. Current revision: ${revision}. Read the state again and retry.`);
  const assets = ((incoming as { assets?: AgentAsset[] }).assets ?? []);
  const next = applyAgentCommands(state.project, request.commands, assets);
  const previousMotionIds = new Set(agentSummary(state.project).motions.map((motion) => motion.id));
  const previousObjectIds = new Set(state.project.objects.map((object) => object.id));
  const previousSceneIds = new Set(state.project.cameraCuts.map((scene) => scene.id));
  const previousBeatIds = new Set(state.project.storyboard?.beats.map((beat) => beat.id) ?? []);
  const summary = agentSummary(next);
  const replacedMotionIds = new Set(request.commands.filter((command) => command.type === 'motion').map((command) => command.type === 'motion' ? command.spec.replaceMotionId : undefined).filter(Boolean));
  useEditor.setState({ project: shareProjectSnapshot(state.project, next), past: [...state.past.slice(-49), state.project], future: [], dirty: true,
    currentFrame: Math.min(state.currentFrame, next.settings.frameEnd),
    selectedId: next.objects.some((object) => object.id === state.selectedId) ? state.selectedId : undefined,
    selectedIds: state.selectedIds.filter((id) => next.objects.some((object) => object.id === id)),
  });
  return { ...agentEditorStatus(), framingIssues: agentFramingIssues(next), createdSceneIds: next.cameraCuts.filter((scene) => !previousSceneIds.has(scene.id)).map((scene) => scene.id), createdElementIds: next.objects.filter((object) => !previousObjectIds.has(object.id)).map((object) => ({ id: object.id, name: object.name, kind: object.kind })), createdBeatIds: next.storyboard?.beats.filter((beat) => !previousBeatIds.has(beat.id)).map((beat) => beat.id) ?? [], appliedMotions: summary.motions.filter((motion) => !previousMotionIds.has(motion.id) || replacedMotionIds.has(motion.id)) };
}
