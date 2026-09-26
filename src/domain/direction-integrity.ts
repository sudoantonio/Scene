import type { AbacoProject, DirectionPlan } from './schema';
import { createBundledStandard } from './bundled-animation-standard';

export type HandoffIssue = NonNullable<AbacoProject['animationHandoff']>['issues'][number];
export function ensureAnimationStandard(project: AbacoProject) {
  if (!project.animationStandard && !project.animationStandardDisabled) project.animationStandard = createBundledStandard(project.updatedAt);
}

/** Reconcile metadata with authored preview keys; never change the visible movement. */
export function reconcileDirectionPlans(project: AbacoProject): HandoffIssue[] {
  const issues: HandoffIssue[] = [];
  const scenes = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  const sceneAt = (frame: number) => scenes.find((s, i) => frame >= s.frame && frame < (scenes[i + 1]?.frame ?? project.settings.frameEnd + 1));
  const plans = project.directionPlans ?? [];
  for (const plan of plans) {
    const issue = (severity: HandoffIssue['severity'], code: string, message: string) => issues.push({ severity, code, message, planId: plan.id });
    const object = project.objects.find(o => o.id === plan.objectId);
    if (!object) { issue('error', 'missing_object', `L’oggetto dell’azione «${plan.instruction}» non esiste più.`); continue; }
    const owner = sceneAt(plan.startFrame);
    if (!scenes.some(s => s.id === plan.sceneId)) {
      if (owner && (!object.sceneIds.length || object.sceneIds.includes(owner.id))) {
        plan.sceneId = owner.id;
        issue('info', 'scene_relinked', `«${plan.instruction}»: collegamento alla scena recuperato dalla posizione sulla timeline.`);
      } else { issue('error', 'missing_scene', `Impossibile associare «${plan.instruction}» a una scena.`); continue; }
    }
    // Legacy exports have no action/key links. Infer only an unambiguous, single-action scene.
    const scene = scenes.find(s => s.id === plan.sceneId)!;
    const sceneEnd = scenes[scenes.indexOf(scene) + 1]?.frame ?? project.settings.frameEnd + 1;
    if (plan.actions.length === 1 && plans.filter(p => p.sceneId === plan.sceneId && p.objectId === plan.objectId).length === 1) {
      const action = plan.actions[0];
      const candidates = object.keyframes.filter(k => k.purpose === 'motion' && ['position', 'rotation', 'scale'].includes(k.property) && k.frame >= scene.frame && k.frame < sceneEnd);
      if (new Set(candidates.map(k => k.frame)).size >= 2 && candidates.every(k => !k.directionActionId || k.directionActionId === action.id)) {
        candidates.forEach(k => { k.directionActionId = action.id; });
      }
    }
    for (const action of plan.actions) {
      const keys = object.keyframes.filter(k => k.directionActionId === action.id);
      const controls = (object.asset.controllerKeys ?? []).filter(k => k.directionActionId === action.id);
      // Transformation keys describe the motion range. Controller recovery may extend beyond it.
      const frames = (keys.length ? keys : controls).map(k => k.frame);
      if (new Set(frames).size >= 2) {
        const start = Math.min(...frames), end = Math.max(...frames);
        if (start !== action.startFrame || end !== action.endFrame) {
          issue('info', 'timing_aligned', `«${action.instruction}»: intervallo aggiornato ai punti del movimento (${start}–${end}).`);
          action.startFrame = start; action.endFrame = end;
        }
      }
      if (action.endFrame <= action.startFrame || action.startFrame < project.settings.frameStart || action.endFrame > project.settings.frameEnd) {
        issue('error', 'invalid_timing', `«${action.instruction}»: intervallo del movimento non valido. Correggilo nella timeline.`);
        continue;
      }
      action.durationSeconds = (action.endFrame - action.startFrame) / project.settings.fps;
      const raw = action.decision?.answers as { energy?: { score?: unknown } } | undefined;
      const energy = action.motionSpec?.energy ?? (typeof raw?.energy?.score === 'number' && Number.isFinite(raw.energy.score) ? Math.max(0, Math.min(4, raw.energy.score)) : undefined);
      if (action.motionSpec) {
        action.motionSpec.durationSeconds = action.durationSeconds;
        if (energy !== undefined) action.motionSpec.energy = energy;
      }
      if (action.referenceId && (!project.objects.some(o => o.id === action.referenceId) || action.referenceId === plan.objectId)) {
        delete action.referenceId;
        issue('warning', 'reference_removed', `«${action.instruction}»: bersaglio assente o coincidente con il soggetto; verificare la regia.`);
      }
      if (action.motionSpec?.referenceId && (!project.objects.some(o => o.id === action.motionSpec!.referenceId) || action.motionSpec.referenceId === plan.objectId)) delete action.motionSpec.referenceId;
      const actionScene = sceneAt(action.startFrame) ?? scene;
      const actionSceneEnd = (scenes[scenes.indexOf(actionScene) + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
      const sceneDirection = project.comments.filter(c => c.kind !== 'transition' && (c.sceneId === actionScene.id || (!c.sceneId && c.startFrame >= actionScene.frame && c.startFrame <= actionSceneEnd)) && (!c.targetIds.length || c.targetIds.includes(plan.objectId))).map(c => c.text);
      action.performance = {
        instruction: action.instruction, sceneDirection, energy,
        timing: action.durationExplicit ? 'explicit' : 'suggested', coordinates: 'preview',
        availableFrames: [actionScene.frame, actionSceneEnd],
      };
    }
    if (plan.actions.length) {
      plan.startFrame = Math.min(...plan.actions.map(a => a.startFrame));
      plan.endFrame = Math.max(...plan.actions.map(a => a.endFrame));
      const firstScene = sceneAt(plan.startFrame);
      if (firstScene) plan.sceneId = firstScene.id;
    } else issue('error', 'empty_plan', `«${plan.instruction}»: il piano non contiene azioni.`);
  }
  return issues;
}

/** Used by timeline edits, including plans with no translational proxy keys. */
export function mapDirectionFrames(project: AbacoProject, map: (frame: number) => number, matches: (plan: DirectionPlan) => boolean = () => true) {
  for (const plan of project.directionPlans ?? []) if (matches(plan)) {
    plan.startFrame = map(plan.startFrame); plan.endFrame = map(plan.endFrame);
    for (const action of plan.actions) { action.startFrame = map(action.startFrame); action.endFrame = map(action.endFrame); }
  }
}
export function assertAnimationHandoff(project: AbacoProject) {
  const errors = (project.animationHandoff?.issues ?? []).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(`Correggi questi punti prima di esportare:\n${errors.map(i => i.message).join('\n')}`);
}
