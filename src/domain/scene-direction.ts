import type { AbacoProject, SceneObject } from './schema';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sceneDirectionComments(project: AbacoProject, sceneId: string) {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const scene = scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) return [];
  const nextFrame = scenes.find((candidate) => candidate.frame > scene.frame)?.frame ?? project.settings.frameEnd + 1;
  return project.comments.filter((comment) => comment.kind !== 'transition' && (
    comment.sceneId === sceneId || (!comment.sceneId && comment.startFrame >= scene.frame && comment.startFrame < nextFrame)
  ));
}

export function combinedSceneDirection(project: AbacoProject, sceneId: string) {
  const comments = sceneDirectionComments(project, sceneId);
  const scene = project.cameraCuts.find((candidate) => candidate.id === sceneId);
  return comments.map((comment) => {
    if (comment.scope === 'scene' || (!comment.scope && !comment.targetIds.length)) return comment.text;
    const target = project.objects.find((object) => object.id === comment.targetIds[0]);
    const name = target?.name ?? (comment.scope === 'framing' ? project.objects.find((object) => object.id === scene?.cameraId)?.name : undefined);
    return name ? `@${name} ${comment.text}` : comment.text;
  }).join('\n\n');
}

export function sceneDirectionTargets(project: AbacoProject, sceneId: string) {
  const scene = project.cameraCuts.find((candidate) => candidate.id === sceneId);
  if (!scene) return [];
  return project.objects.filter((object) => object.id === scene.cameraId || (
    object.kind !== 'camera' && !object.kind.includes('light') && object.kind !== 'audio' &&
    (!object.sceneIds.length || object.sceneIds.includes(sceneId))
  ));
}

function mentionIndex(text: string, target: SceneObject) {
  const names = target.kind === 'camera' ? [target.name, 'camera'] : [target.name];
  return Math.max(...names.map((name) => {
    const matcher = new RegExp(`@${escapeRegex(name)}(?=$|[\\s.,;:!?/])`, 'gi');
    return [...text.matchAll(matcher)].at(-1)?.index ?? -1;
  }));
}

export function mentionedSceneTargetIds(text: string, targets: SceneObject[]) {
  return targets.filter((target) => mentionIndex(text, target) >= 0).map((target) => target.id);
}

export function sceneTargetBefore(text: string, caret: number, targets: SceneObject[], fallbackId?: string) {
  const prefix = text.slice(0, caret);
  const matches = targets.map((target) => ({ target, index: mentionIndex(prefix, target) })).filter(({ index }) => index >= 0);
  return matches.sort((a, b) => b.index - a.index)[0]?.target ?? targets.find((target) => target.id === fallbackId);
}
