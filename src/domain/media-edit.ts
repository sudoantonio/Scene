import { objectPresenceRange } from './presence';
import { visibilityIntervals } from './media-timeline';
import { isVideoFile } from './video';
import type { AbacoProject, SceneObject } from './schema';

export function mediaRange(project: AbacoProject, object: SceneObject): [number, number] | undefined {
  if (object.kind === 'audio') return objectPresenceRange(object, project.settings.frameStart, project.settings.frameEnd + 1);
  const range = visibilityIntervals(project, object)[0];
  if (!range || !object.asset.duration) return range;
  const available = Math.max(1, Math.round((object.asset.duration - (object.asset.sourceOffset ?? 0)) * project.settings.fps));
  return [range[0], Math.min(range[1], range[0] + available)];
}
export function mediaTrimDelta(project: AbacoProject, object: SceneObject, range: readonly [number, number], edge: 'start' | 'end', requested: number) {
  const fps = project.settings.fps;
  const offset = object.kind === 'audio' ? object.audio.trimStart : object.asset.sourceOffset ?? 0;
  const duration = object.kind === 'audio' ? object.audio.duration : object.asset.duration ?? 0;
  const availableEnd = range[0] + Math.floor((duration - offset) * fps + 1e-6);
  return edge === 'start'
    ? Math.max(project.settings.frameStart - range[0], Math.ceil(-offset * fps - 1e-6), Math.min(range[1] - range[0] - 1, Math.round(requested)))
    : Math.max(range[0] + 1 - range[1], Math.min(availableEnd - range[1], Math.round(requested)));
}
// Follow video edits only while the extracted audio still matches the clip.
// Audio edited separately stays independent.
export function matchingVideoAudio(project: AbacoProject, video: SceneObject, range: readonly [number, number]) {
  if (!isVideoFile(video.asset.sourcePath)) return undefined;
  return project.objects.find(audio => {
    if (audio.kind !== 'audio' || audio.asset.linkedVideoId !== video.id) return false;
    const audioRange = mediaRange(project, audio);
    return audioRange?.[0] === range[0] && audioRange[1] === range[1]
      && Math.abs(audio.audio.trimStart - (video.asset.sourceOffset ?? 0)) < 1e-6;
  });
}
