import { visibilityIntervals } from './media-timeline';
import { objectPresenceRange } from './presence';
import { mapDirectionFrames } from './direction-integrity';
import { isVideoFile } from './video';
import type { AbacoProject, SceneObject } from './schema';

/** Mutates an editing draft. Media on either side remains separate at the join,
 * preserving its source time instead of restarting or continuing the wrong file position. */
export function closeTimelineGap(project: AbacoProject, sceneId: string) {
  const scenes = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  const index = scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0 || !scenes[index].isGap || scenes.length <= 1) return undefined;
  const start = scenes[index].frame, end = scenes[index + 1]?.frame ?? project.settings.frameEnd + 1;
  const duration = end - start;
  const map = (frame: number) => frame < start ? frame : frame >= end ? frame - duration : start;
  const mediaParts: Array<{ original: string; id: string; start: number; end: number }> = [];
  project.objects = project.objects.flatMap(object => {
    if (object.kind !== 'audio' && !isVideoFile(object.asset.sourcePath)) return [object];
    const ranges = visibilityIntervals(project, object);
    if (!ranges.some(range => range[1] <= start) || !ranges.some(range => range[0] >= end)) return [object];
    const original = structuredClone(object);
    const sourceStart = objectPresenceRange(original, project.settings.frameStart, project.settings.frameEnd + 1)?.[0] ?? start;
    return ranges.map(([from, to], part) => {
      const clip: SceneObject = part ? structuredClone(original) : object;
      if (part) { clip.id = crypto.randomUUID(); clip.keyframes.forEach(key => { key.id = crypto.randomUUID(); }); }
      clip.asset.timelineTrackId = original.asset.timelineTrackId ?? original.id;
      clip.visible = false;
      clip.keyframes = clip.keyframes.filter(key => key.property !== 'visibility');
      for (const [frame, value] of [[from, true], [to, false]] as const) clip.keyframes.push({ id: crypto.randomUUID(), frame, property: 'visibility', value, interpolation: 'constant', source: 'user', commentIds: [] });
      if (clip.kind !== 'audio') clip.asset.sourceOffset = (original.asset.sourceOffset ?? 0) + (from - sourceStart) / project.settings.fps;
      mediaParts.push({ original: original.id, id: clip.id, start: from, end: to });
      return clip;
    });
  });
  const splitMediaIds = new Set(mediaParts.map(part => part.id));
  for (const object of project.objects) {
    const linkedVideo = object.asset.linkedVideoId;
    const part = mediaParts.find(part => part.id === object.id);
    if (linkedVideo && part) object.asset.linkedVideoId = mediaParts.find(video => video.original === linkedVideo && video.start === part.start && video.end === part.end)?.id ?? linkedVideo;
    object.sceneIds = object.sceneIds.filter(id => id !== sceneId);
    object.keyframes = object.keyframes.filter(key => (splitMediaIds.has(object.id) && key.property === 'visibility') || key.frame < start || key.frame >= end).map(key => {
      const holdFrames = key.holdFrames === undefined ? undefined : Math.max(0, map(key.frame + key.holdFrames) - map(key.frame));
      return { ...key, frame: map(key.frame), ...(holdFrames === undefined ? {} : { holdFrames }) };
    });
    object.asset.controllerKeys = object.asset.controllerKeys?.filter(key => key.frame < start || key.frame >= end).map(key => ({ ...key, frame: map(key.frame) }));
    object.sceneNotes = object.sceneNotes.filter(note => note.frame < start || note.frame >= end).map(note => ({ ...note, frame: map(note.frame) }));
  }
  project.cameraCuts = project.cameraCuts.filter(scene => scene.id !== sceneId).map(scene => ({ ...scene, frame: map(scene.frame) }));
  project.comments = project.comments.filter(comment => comment.sceneId !== sceneId && comment.fromSceneId !== sceneId && comment.toSceneId !== sceneId && !(comment.startFrame >= start && comment.endFrame < end))
    .map(comment => ({ ...comment, startFrame: map(comment.startFrame), endFrame: map(comment.endFrame) }));
  project.directionPlans = project.directionPlans?.filter(plan => plan.sceneId !== sceneId);
  mapDirectionFrames(project, map);
  project.settings.frameEnd -= duration;
  return { start, end, duration, map };
}
