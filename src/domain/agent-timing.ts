import type { AbacoProject, Keyframe } from './schema';

export type TimingIssue = { severity: 'warning' | 'info'; code: string; sceneId?: string; elementId?: string; motionId?: string; startFrame?: number; endFrame?: number; message: string };
const difference = (first: Keyframe['value'], second: Keyframe['value']) => Array.isArray(first) && Array.isArray(second) ? Math.hypot(...first.map((value, index) => value - second[index])) : 0;

export function agentTimingIssues(project: AbacoProject): TimingIssue[] {
  const issues: TimingIssue[] = [];
  const cuts = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  if (project.storyboard) for (const scene of cuts) if (!project.storyboard.beats.some((beat) => beat.sceneId === scene.id)) issues.push({ severity: 'warning', code: 'scene_without_story_beat', sceneId: scene.id, message: `Scene ${scene.name ?? scene.id} has no storyboard beats.` });
  for (const motion of project.agentMotions ?? []) {
    for (const message of motion.warnings) issues.push({ severity: 'warning', code: 'motion_pace', sceneId: motion.sceneId, elementId: motion.elementId, motionId: motion.id, startFrame: motion.startFrame, endFrame: motion.endFrame, message });
    if (project.storyboard && !motion.beatId) issues.push({ severity: 'info', code: 'motion_without_beat', sceneId: motion.sceneId, elementId: motion.elementId, motionId: motion.id, message: 'Motion is not linked to a beat; check synchronization with the script.' });
  }
  for (const object of project.objects) {
    for (const property of ['position', 'rotation'] as const) {
      const keys = object.keyframes.filter((key) => key.property === property).sort((a, b) => a.frame - b.frame);
      for (let index = 1; index < keys.length; index++) {
        const before = keys[index - 1], after = keys[index];
        if (before.purpose === 'motion' || after.purpose === 'motion' || (before.source !== 'ai' && after.source !== 'ai')) continue;
        const seconds = (after.frame - before.frame) / project.settings.fps;
        if (seconds <= 1.5 || difference(before.value, after.value) < (property === 'position' ? .2 : 10)) continue;
        const scene = cuts.find((cut, cutIndex) => before.frame >= cut.frame && after.frame <= (cuts[cutIndex + 1]?.frame ?? project.settings.frameEnd + 1));
        issues.push({ severity: 'warning', code: 'slow_generic_animate', sceneId: scene?.id, elementId: object.id, startFrame: before.frame, endFrame: after.frame, message: `${object.name}: ${property} changes over ${seconds.toFixed(2)} s using animate. Use scene_animate_motion with a pace or confirm an intentional pause.` });
      }
    }
  }
  return issues;
}
