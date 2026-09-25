import * as THREE from 'three';
import { z } from 'zod';
import { applyPlan, evaluateTransform, validatePlan } from './animation';
import { cameraBasis } from './camera-space';
import { type AbacoProject, type DirectionPlan } from './schema';
import { compileJevAction, composeParallelJevPlans, JevActionInputSchema, JevActionResponseSchema, JevChoiceAnswerSchema, jevActionRequest, jevMotionFamilyRequest, mergeJevSequencePlans, resolveCameraFocusObject, resolveMotionFamily, rotationToward, type JevActionInput, type JevActionPlan } from './jev-action';

export type DecisionRunner = (request: { model: string; state: unknown; questions: Record<string, unknown> }) => Promise<unknown>;
export type DirectionClause = { instruction: string; relation: 'then' | 'with' };
const relationSchema = z.object({ answers: z.object({ clause_relation: JevChoiceAnswerSchema }) });
const familySchema = z.object({ answers: z.object({ motion_family: JevChoiceAnswerSchema }) });
const followupSchema = z.object({ answers: z.object({ followup_action: JevChoiceAnswerSchema }) });

async function inferFollowup(previousPlan: DirectionPlan, instruction: string, run: DecisionRunner) {
  const actionCriteria = Object.fromEntries(previousPlan.actions.map((action, index) => [`correct_${index + 1}`, `Corregge o sostituisce specificamente l’azione ${index + 1}: “${action.instruction}”.`]));
  const response = followupSchema.parse(await run({
    model: 'jev-latest',
    state: {
      new_instruction: instruction,
      current_direction: previousPlan.instruction,
      actions: previousPlan.actions.map((action, index) => ({ number: index + 1, instruction: action.instruction, motion: action.motion })),
      constraints: previousPlan.constraints ?? [],
    },
    questions: { followup_action: { type: 'choice', instructions: 'Decidi come applicare la nuova istruzione al piano esistente. Usa correct_N solo quando il testo corregge o sostituisce chiaramente quella specifica azione. Non inventare correzioni.', criteria: {
      continue: 'Aggiunge una o più azioni che avvengono dopo quelle esistenti, incluse frasi con poi, dopo, successivamente o infine.',
      refine: 'Aggiunge un vincolo o dettaglio al piano esistente senza aggiungere una nuova fase: velocità, intensità, precisione, inquadratura, altezza, distanza o stile.',
      new: 'Chiede esplicitamente di ignorare, eliminare, ricominciare o sostituire tutto il piano esistente con un nuovo movimento.',
      ...actionCriteria,
    } } },
  }));
  const choice = response.answers.followup_action.choice;
  if (choice === 'continue' || choice === 'refine' || choice === 'new') return { mode: choice as 'continue' | 'refine' | 'new' };
  const match = choice.match(/^correct_(\d+)$/);
  const action = match ? previousPlan.actions[Number(match[1]) - 1] : undefined;
  if (!action) throw new Error('It is unclear which motion to correct. Select it from the Direction menu or name it in your request.');
  return { mode: 'correct' as const, actionId: action.id };
}

/** Candidate boundaries depend on conjunctions, never on a dictionary of action verbs. */
export async function interpretDirection(instruction: string, run: DecisionRunner) {
  const parts = instruction.trim().split(/\s*(\be\s+poi\b|\bpoi\b|\bquindi\b|\bsuccessivamente\b|\bdopodich[eé]\b|\bmentre\b|\bcontemporaneamente\b|\ballo stesso tempo\b|\be\b|;|,(?!\d)|\.(?!\d))\s*/iu);
  const actions: DirectionClause[] = [{ instruction: parts[0]!, relation: 'then' }];
  const constraints: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const connector = parts[i]!;
    const right = parts[i + 1]?.trim();
    if (!right) continue;
    const left = actions.at(-1)!;
    // Continuous framing is a persistent constraint, not an extra timed movement.
    if (/\b(?:continu\w*|mant\w*|tien\w*|tenend\w*|sempre)\b[^.!?]{0,90}(?:inquadr\w*|centr\w*|vista)|(?:inquadr\w*|centr\w*)[^.!?]{0,40}\bsempre\b/iu.test(right)) {
      constraints.push(right); continue;
    }
    const response = relationSchema.parse(await run({
      model: 'jev-latest',
      state: { instruction, left_clause: left.instruction, right_clause: right, connector },
      questions: { clause_relation: { type: 'choice', instructions: 'Classify the right clause in context. A direction, amount or object completing the same action is join. A continuous instruction to keep the subject framed is keep_in_frame. Separate actions use then or with. Do not invent an action.', criteria: {
        join: 'Continuation or parameter of the same action, e.g. alto e destra.',
        then: 'Another action after the previous one.',
        with: 'Another action at the same time.',
        keep_in_frame: 'A constraint to keep looking at/framing the reference throughout the movements.',
      } } },
    }));
    let choice = response.answers.clause_relation.choice;
    if (!['join', 'then', 'with', 'keep_in_frame'].includes(choice)) throw new Error('The relationship between the actions was not recognized.');
    if (choice === 'keep_in_frame') { constraints.push(right); continue; }
    if (/poi|quindi|successivamente|dopodich|[;.]/i.test(connector)) choice = 'then';
    else if (/mentre|contemporaneamente|allo stesso tempo/i.test(connector)) choice = 'with';
    if (choice === 'join') left.instruction += ` ${connector} ${right}`;
    else actions.push({ instruction: right, relation: choice as 'then' | 'with' });
  }
  if (actions.length > 16) throw new Error('The request contains more than 16 actions. Split it into two requests.');
  return { actions, constraints };
}

function explicitSeconds(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:second\w*|sec|s)\b/i);
  return match ? Number(match[1]!.replace(',', '.')) : undefined;
}

/** Reserve time for every group; never silently drop the tail of a sequence. */
export function allocateDirectionFrames(groups: { frames: number; explicit: boolean }[], available: number) {
  const fixed = groups.reduce((sum, group) => sum + (group.explicit ? group.frames : 0), 0);
  const flexible = groups.filter((group) => !group.explicit);
  if (fixed + flexible.length > available) throw new Error('The sequence does not fit in the scene with the requested durations. Increase the scene duration. No motion was applied.');
  const desired = flexible.reduce((sum, group) => sum + group.frames, 0);
  const budget = Math.min(available - fixed, desired);
  let remaining = budget, weight = desired, count = flexible.length;
  return groups.map((group) => {
    if (group.explicit) return group.frames;
    count -= 1;
    const frames = count ? Math.max(1, Math.min(remaining - count, Math.round(remaining * group.frames / weight))) : remaining;
    remaining -= frames; weight -= group.frames;
    return frames;
  });
}

export async function planDirection(project: AbacoProject, input: Omit<JevActionInput, 'project'>, run: DecisionRunner): Promise<JevActionPlan> {
  if (!input.objectId) throw new Error('Select an element.');
  const scenes = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  const index = scenes.findIndex((scene) => scene.id === input.sceneId);
  const scene = scenes[index];
  if (!scene) throw new Error('The scene does not exist.');
  const end = (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  let previousPlan = input.directionPlanId ? project.directionPlans?.find((plan) => plan.id === input.directionPlanId && plan.objectId === input.objectId && plan.sceneId === input.sceneId) : undefined;
  let inferredMode: 'new' | 'refine' | 'continue' | 'correct' | undefined;
  if (previousPlan && !input.editActionId && !input.directionMode) {
    const followup = await inferFollowup(previousPlan, input.instruction, run);
    inferredMode = followup.mode;
    if (followup.actionId) input = { ...input, editActionId: followup.actionId };
    if (followup.mode === 'new') previousPlan = undefined;
  }
  if (input.editActionId && !previousPlan?.actions.some((action) => action.id === input.editActionId)) throw new Error('The motion to edit no longer exists.');
  const directionMode = previousPlan ? (input.editActionId ? 'correct' : input.directionMode ?? inferredMode ?? 'refine') : 'new';
  let interpreted;
  if (previousPlan && input.editActionId) {
    interpreted = { actions: previousPlan.actions.map((action) => ({ instruction: action.id === input.editActionId ? input.instruction : action.instruction, relation: action.relation })), constraints: previousPlan.constraints ?? [] };
  } else if (previousPlan && directionMode === 'continue') {
    const continuationInstruction = input.instruction.replace(/^\s*(?:e\s+poi|poi|quindi|successivamente|dopodich[eé])\s+/iu, '');
    const continuation = await interpretDirection(continuationInstruction, run);
    interpreted = {
      actions: [
        ...previousPlan.actions.map((action) => ({ instruction: action.instruction, relation: action.relation })),
        ...continuation.actions.map((action, index) => ({ ...action, relation: index === 0 ? 'then' as const : action.relation })),
      ],
      constraints: [...new Set([...(previousPlan.constraints ?? []), ...continuation.constraints])],
    };
  } else if (previousPlan && directionMode === 'refine') {
    const previousActions = previousPlan.actions.map((action, actionIndex) => `${actionIndex ? action.relation === 'with' ? 'mentre ' : 'poi ' : ''}${action.instruction}`).join(' ');
    const refinement = await interpretDirection(`${previousActions}, ${input.instruction}`, run);
    interpreted = { ...refinement, constraints: [...new Set([...(previousPlan.constraints ?? []), ...refinement.constraints])] };
  } else {
    interpreted = await interpretDirection(input.instruction, run);
  }
  if (previousPlan) input = { ...input, frame: previousPlan.startFrame, gesture: input.gesture ?? JevActionInputSchema.shape.gesture.parse(previousPlan.gesture) };
  const fullInstruction = previousPlan ? interpreted.actions.map((clause, index) => `${index ? clause.relation === 'with' ? 'mentre ' : 'poi ' : ''}${clause.instruction}`).join(' ') + (interpreted.constraints.length ? ', ' + interpreted.constraints.join(', ') : '') : input.instruction;
  const selected = project.objects.find((object) => object.id === input.objectId)!;
  const focus = input.target === 'camera' ? resolveCameraFocusObject(project, input.sceneId, input.frame, fullInstruction, scene.framing.target) : undefined;
  const drafts = [];
  // Resolve the entire request before mutating or compiling any scene state.
  for (const [draftIndex, clause] of interpreted.actions.entries()) {
    const actionInput = { ...input, gesture: draftIndex === 0 ? input.gesture : undefined, instruction: clause.instruction, contextInstruction: fullInstruction };
    const object = input.target === 'camera' ? undefined : selected;
    const stored = previousPlan?.actions[draftIndex];
    let raw;
    if (stored?.decision && stored.id !== input.editActionId && stored.instruction === clause.instruction) raw = JevActionResponseSchema.parse(stored.decision);
    else {
      const family = familySchema.parse(await run(jevMotionFamilyRequest(project, object, actionInput))).answers.motion_family.choice;
      raw = JevActionResponseSchema.parse(await run(jevActionRequest(project, object, actionInput, resolveMotionFamily(actionInput, family))));
    }
    const seconds = explicitSeconds(clause.instruction);
    const inferred = [.25, .5, 1, 2, 4][Math.max(0, Math.min(4, Math.round(raw.answers.duration.score)))]!;
    const unchanged = stored && stored.id !== input.editActionId && stored.instruction === clause.instruction;
    const preserveTiming = unchanged && directionMode !== 'continue';
    drafts.push({ clause, raw, stored: unchanged || stored?.id === input.editActionId ? stored : undefined, frames: unchanged ? stored.endFrame - stored.startFrame : Math.max(1, Math.round((seconds ?? inferred) * project.settings.fps)), explicit: seconds !== undefined || Boolean(preserveTiming || (unchanged && stored.durationExplicit)), durationExplicit: seconds !== undefined || Boolean(unchanged && stored.durationExplicit) });
  }
  const groups: typeof drafts[] = [];
  for (const draft of drafts) {
    if (draft.clause.relation === 'with' && groups.length) groups.at(-1)!.push(draft);
    else groups.push([draft]);
  }
  const sizes = allocateDirectionFrames(groups.map((group) => ({ frames: Math.max(...group.map((draft) => draft.frames)), explicit: group.some((draft) => draft.explicit) })), end - input.frame);
  const direction: DirectionPlan = {
    id: previousPlan?.id ?? crypto.randomUUID(), constraints: interpreted.constraints, gesture: input.gesture,
    prompts: [...(previousPlan?.prompts ?? (previousPlan ? [{ instruction: previousPlan.instruction, mode: 'new' as const }] : [])), { instruction: input.instruction, mode: directionMode }],
    sceneId: input.sceneId, objectId: input.objectId!, instruction: fullInstruction, startFrame: input.frame, endFrame: input.frame, actions: [],
  };
  let working = project, frame = input.frame;
  const plans: JevActionPlan[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    const groupPlans: JevActionPlan[] = [];
    const until = frame + sizes[groupIndex]!;
    for (const draft of group) {
      const object = input.target === 'camera' ? undefined : working.objects.find((entry) => entry.id === input.objectId);
      const modelReference = working.objects.find((entry) => entry.id === draft.raw.answers.reference_object?.choice && entry.id !== input.objectId && entry.kind !== 'camera' && entry.kind !== 'audio' && !entry.kind.includes('light') && !entry.screenSpace && (!entry.sceneIds.length || entry.sceneIds.includes(input.sceneId)));
      const ref = resolveCameraFocusObject(working, input.sceneId, frame, draft.clause.instruction, scene.framing.target) ?? modelReference ?? focus;
      const actionUntil = frame + Math.max(1, Math.round(draft.frames * sizes[groupIndex]! / Math.max(...group.map((entry) => entry.frames))));
      const compiled = compileJevAction(working, object, { ...input, instruction: draft.clause.instruction, contextInstruction: fullInstruction, referenceId: ref?.id, frame, endFrame: actionUntil, startPosition: object ? evaluateTransform(object, frame).position : null, gesture: direction.actions.length === 0 ? input.gesture : undefined }, draft.raw);
      if (!compiled.decision.motion || (!compiled.blenderPlan.operations.length && compiled.decision.motion !== 'hold')) throw new Error(`Action cannot be applied: “${draft.clause.instruction}”. No motion was applied.`);
      if (interpreted.constraints.length && input.target === 'camera' && ['pan_left', 'pan_right', 'tilt_up', 'tilt_down'].includes(compiled.decision.motion)) throw new Error('The requested rotation conflicts with keeping the subject centered. Specify the framing you want.');
      compiled.decision.relation = draft.clause.relation;
      // Stretch/compress the generated interval as a whole, preserving its internal timing.
      const last = Math.max(frame + 1, ...compiled.blenderPlan.operations.map((operation) => operation.frame));
      for (const operation of compiled.blenderPlan.operations) operation.frame = frame + Math.round((operation.frame - frame) * (actionUntil - frame) / (last - frame));
      direction.actions.push({ id: draft.stored?.id ?? crypto.randomUUID(), decision: draft.raw, instruction: draft.clause.instruction, motion: compiled.decision.motion, motionSpec: compiled.decision.motionSpec, relation: draft.clause.relation, startFrame: frame, endFrame: actionUntil, referenceId: ref?.id ?? compiled.decision.reference?.objectId, keepInFrame: interpreted.constraints.length > 0, distanceMeters: compiled.decision.distanceMeters, durationSeconds: (actionUntil - frame) / project.settings.fps, durationExplicit: draft.durationExplicit });
      groupPlans.push(compiled);
    }
    const combined = groupPlans.length > 1 ? composeParallelJevPlans(working, groupPlans, group.map((draft) => draft.clause.instruction).join(' mentre ')) : groupPlans[0]!;
    if (interpreted.constraints.length && input.target === 'camera') {
      const reference = direction.actions.at(-1)!.referenceId;
      const target = working.objects.find((object) => object.id === reference);
      if (!target) throw new Error('The subject to keep in frame could not be found. Use its name in the request.');
      const preview = applyPlan(working, combined.blenderPlan);
      const camera = preview.objects.find((object) => object.id === input.objectId)!;
      combined.blenderPlan.operations = combined.blenderPlan.operations.filter((operation) => operation.property !== 'rotation');
      // Visible, editable rotation keys ensure the constraint is not hidden in playback.
      const samples: typeof combined.blenderPlan.operations = [];
      let previous: number[] | undefined;
      for (let time = frame; time <= until; time++) {
        let rotation = rotationToward(evaluateTransform(camera, time).position, evaluateTransform(target, time).position);
        if (previous) rotation = rotation.map((angle, axis) => angle + 360 * Math.round((previous![axis]! - angle) / 360)) as typeof rotation;
        previous = rotation;
        samples.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: input.objectId!, frame: time, property: 'rotation', value: { vector: rotation, number: null, boolean: null, text: null }, interpolation: 'linear', rationale: 'Keep the subject in frame.', commentIds: [] });
      }
      const retained = new Set([0, samples.length - 1]);
      const simplify = (a: number, b: number) => {
        let worst = -1, error = .05;
        for (let i = a + 1; i < b; i++) {
          const t = (i - a) / (b - a);
          const delta = Math.max(...samples[i]!.value.vector!.map((angle, axis) => Math.abs(angle - (samples[a]!.value.vector![axis]! * (1 - t) + samples[b]!.value.vector![axis]! * t))));
          if (delta > error) { error = delta; worst = i; }
        }
        if (worst >= 0) { retained.add(worst); simplify(a, worst); simplify(worst, b); }
      };
      simplify(0, samples.length - 1);
      combined.blenderPlan.operations.push(...[...retained].sort((a, b) => a - b).map((i) => samples[i]!));
    }
    working = applyPlan(working, combined.blenderPlan);
    // Verify radial intent against actual scene geometry after composition.
    for (const action of direction.actions.filter((action) => action.startFrame === frame)) {
      const target = working.objects.find((object) => object.id === action.referenceId);
      const camera = working.objects.find((object) => object.id === input.objectId)!;
      if (input.target === 'camera' && target) {
        const distance = (time: number) => new THREE.Vector3(...evaluateTransform(camera, time).position).distanceTo(new THREE.Vector3(...evaluateTransform(target, time).position));
        if ((action.motion === 'dolly_in' && distance(until) >= distance(frame) - 1e-6) || (action.motion === 'dolly_out' && distance(until) <= distance(frame) + 1e-6)) throw new Error('The path does not preserve the requested distance from the subject. No motion was applied.');
        if (action.keepInFrame) for (let time = frame; time <= until; time++) {
          const transform = evaluateTransform(camera, time);
          const toward = new THREE.Vector3(...evaluateTransform(target, time).position).sub(new THREE.Vector3(...transform.position)).normalize();
          if (toward.dot(cameraBasis(transform.rotation)[1]) < .999) throw new Error('The framing constraint was not preserved.');
        }
      }
    }
    plans.push(combined); frame = until;
  }
  const result = mergeJevSequencePlans(plans, fullInstruction);
  direction.endFrame = frame;
  result.blenderPlan.directionPlan = direction;
  const errors = validatePlan(project, result.blenderPlan);
  if (errors.length) throw new Error(errors.join('\n'));
  const finalProject = applyPlan(project, result.blenderPlan);
  const finalCamera = finalProject.objects.find((entry) => entry.id === input.objectId)!;
  for (const action of direction.actions.filter((entry) => entry.keepInFrame && input.target === 'camera')) {
    const reference = finalProject.objects.find((entry) => entry.id === action.referenceId)!;
    for (let time = action.startFrame; time <= action.endFrame; time++) {
      const transform = evaluateTransform(finalCamera, time);
      const toward = new THREE.Vector3(...evaluateTransform(reference, time).position).sub(new THREE.Vector3(...transform.position)).normalize();
      if (toward.dot(cameraBasis(transform.rotation)[1]) < .999) throw new Error('The complete sequence loses the subject between two actions. No motion was applied.');
    }
  }
  return result;
}
