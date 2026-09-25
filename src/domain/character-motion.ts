import type { PlanOperation, SceneObject, Vec3 } from './schema';
import { controllerOffset, controllerOffsetFromWorldDelta } from './controller-pose';

export const characterActionCriteria = {
  none: 'Nessuna articolazione deve muoversi; sposta o ruota soltanto il personaggio intero.',
  walk: 'Cammina: alterna gambe e braccia mentre il personaggio avanza.',
  run: 'Corre: alterna gambe e braccia con più energia.',
  jump: 'Salta: piega e distende le gambe durante il salto.',
  raise: 'Solleva una mano, un braccio o una gamba.',
  lower: 'Abbassa o riporta in posizione una mano, un braccio o una gamba.',
  wave: 'Saluta agitando la mano o il braccio.',
  point: 'Indica qualcosa estendendo un braccio.',
  bend: 'Piega un gomito o un ginocchio.',
  kick: 'Calcia con un piede o una gamba.',
  move_part: 'Sposta una parte del corpo in una direzione esplicita.',
} as const;
export type CharacterAction = keyof typeof characterActionCriteria;
export type CharacterSide = 'left' | 'right' | 'both';
export type CharacterPart = 'hand' | 'elbow' | 'foot' | 'knee' | 'arm' | 'leg';
export type CharacterDirection = 'up' | 'down' | 'left' | 'right' | 'forward' | 'back';

type Choice = { choice: string; confidence: number };
export type CharacterAnswers = { character_action?: Choice; character_side?: Choice; character_part?: Choice; character_direction?: Choice; character_controller?: Choice };
type Controller = NonNullable<SceneObject['asset']['controllers']>[number];

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const has = (text: string, pattern: RegExp) => pattern.test(normalize(text));

export function characterMotionHint(instruction: string): { action: CharacterAction; part?: CharacterPart; side?: CharacterSide; direction?: CharacterDirection } | undefined {
  const text = normalize(instruction);
  const side = /\b(?:entramb[ei]|ambedue|both|due braccia|due mani|due gambe|braccia|mani|gambe|piedi|arms|hands|legs|feet)\b/.test(text) ? 'both'
    : /\b(?:sinistr[ao]|left)\b/.test(text) ? 'left'
      : /\b(?:destr[ao]|right)\b/.test(text) ? 'right' : undefined;
  const part: CharacterPart | undefined = /\b(?:gomit\w*|elbow\w*)\b/.test(text) ? 'elbow'
    : /\b(?:ginocchi\w*|knee\w*)\b/.test(text) ? 'knee'
      : /\b(?:man[oi]|hands?|pols\w*|wrist\w*)\b/.test(text) ? 'hand'
        : /\b(?:bracc\w*|arms?)\b/.test(text) ? 'arm'
          : /\b(?:pied\w*|foot|feet)\b/.test(text) ? 'foot'
            : /\b(?:gamb\w*|legs?)\b/.test(text) ? 'leg' : undefined;
  const direction: CharacterDirection | undefined = /\b(?:alto|su|up)\b/.test(text) ? 'up'
    : /\b(?:basso|giu|down)\b/.test(text) ? 'down'
      : /\b(?:sinistra|left)\b/.test(text) ? 'left'
        : /\b(?:destra|right)\b/.test(text) ? 'right'
          : /\b(?:avanti|forward)\b/.test(text) ? 'forward'
            : /\b(?:indietro|back)\b/.test(text) ? 'back' : undefined;
  const action: CharacterAction | undefined = /\b(?:salut\w*|wave\w*|ciao)\b/.test(text) ? 'wave'
    : /\b(?:cammin\w*|marci\w*|walk\w*)\b/.test(text) ? 'walk'
      : /\b(?:corr\w*|corre\w*|run\w*|sprint\w*)\b/.test(text) ? 'run'
        : /\b(?:salt\w*|jump\w*)\b/.test(text) ? 'jump'
          : /\b(?:calci\w*|kick\w*)\b/.test(text) ? 'kick'
            : /\b(?:indic\w*|punt\w*|point\w*)\b/.test(text) && part ? 'point'
              : /\b(?:pieg\w*|flett\w*|bend\w*)\b/.test(text) && part ? 'bend'
                : /\b(?:sollev\w*|alz\w*|raise\w*|lift\w*)\b/.test(text) && part ? 'raise'
                  : /\b(?:abbass\w*|riport\w*|lower\w*)\b/.test(text) && part ? 'lower'
                    : /\b(?:muov\w*|spost\w*|move\w*)\b/.test(text) && part ? 'move_part' : undefined;
  return action ? { action, part, side, direction } : undefined;
}

function controllerSide(name: string): CharacterSide | undefined {
  if (/(?:^|[_ .|])(?:DX|DESTR\w*|RIGHT|R)(?:$|[_ .|])/i.test(name)) return 'right';
  if (/(?:^|[_ .|])(?:SX|SINISTR\w*|LEFT|L)(?:$|[_ .|])/i.test(name)) return 'left';
  return undefined;
}

function controllerPart(name: string): CharacterPart | undefined {
  const text = normalize(name);
  if (/mano|hand|wrist|polso/.test(text)) return 'hand';
  if (/gomito|elbow/.test(text)) return 'elbow';
  if (/braccio|arm|forearm/.test(text)) return 'arm';
  if (/piede|foot|ankle/.test(text)) return 'foot';
  if (/ginocchio|knee/.test(text)) return 'knee';
  if (/gamba|leg|thigh|shin/.test(text)) return 'leg';
  return undefined;
}

export function characterControlSummary(object: SceneObject): { name: string; part: CharacterPart | null; side: CharacterSide | null }[] {
  if (object.kind !== 'blend_asset') return [];
  return (object.asset.controllers ?? []).filter((controller) => controller.worldPosition)
    .map((controller) => ({ name: controller.name, part: controllerPart(controller.name) ?? null, side: controllerSide(controller.name) ?? null }));
}

export function resolveCharacterMotion(instruction: string, answers: CharacterAnswers, object: SceneObject): { action: CharacterAction; part?: CharacterPart; side: CharacterSide; direction?: CharacterDirection; controllerName?: string } | undefined {
  if (object.kind !== 'blend_asset' || !object.asset.controllers?.length) return undefined;
  const hint = characterMotionHint(instruction);
  const modelAction = answers.character_action;
  const selectedControl = object.asset.controllers.find((controller) => controller.name === answers.character_controller?.choice && controller.worldPosition);
  const mentionedBody = has(instruction, /\b(?:gest\w*|salut\w*|cammin\w*|corr\w*|calci\w*|salt\w*|bracc\w*|man[oi]|gamb\w*|pied\w*|gomit\w*|ginocchi\w*|cod\w*|test\w*|coll\w*|schien\w*|spall\w*|occh\w*|sguard\w*|sopraccigl\w*|arm|hand|leg|foot|tail|head|neck|spine|shoulder|eye|brow|gaze|wave|walk|run|kick|jump)\b/) || !!selectedControl && normalize(instruction).includes(normalize(selectedControl.name.split('|').at(-1)!.replace(/^CTRL_/, '').replaceAll('_', ' ')));
  const action = hint?.action ?? (mentionedBody && modelAction && modelAction.confidence >= .6 && modelAction.choice in characterActionCriteria ? modelAction.choice as CharacterAction : 'none');
  if (action === 'none') return undefined;
  const answerPart = answers.character_part?.choice;
  const part = hint?.part ?? (['hand', 'elbow', 'foot', 'knee', 'arm', 'leg'].includes(answerPart ?? '') ? answerPart as CharacterPart : undefined);
  const answerSide = answers.character_side?.choice;
  const side = hint?.side ?? (answerSide === 'left' || answerSide === 'right' || answerSide === 'both' ? answerSide : 'right');
  const answerDirection = answers.character_direction?.choice;
  const direction = hint?.direction ?? (['up', 'down', 'left', 'right', 'forward', 'back'].includes(answerDirection ?? '') ? answerDirection as CharacterDirection : undefined);
  return { action, part, side, direction, controllerName: hint?.part ? undefined : selectedControl?.name };
}

function selectControl(controllers: Controller[], part: CharacterPart, side: CharacterSide): Controller | undefined {
  const priorities: CharacterPart[] = part === 'arm' ? ['hand', 'arm', 'elbow'] : part === 'leg' ? ['foot', 'leg', 'knee'] : [part];
  for (const priority of priorities) {
    const matching = controllers.filter((controller) => controller.worldPosition && controllerPart(controller.name) === priority);
    const exact = matching.find((controller) => controllerSide(controller.name) === side);
    if (exact) return exact;
    if (matching.length === 1 && !controllerSide(matching[0]!.name)) return matching[0];
  }
  return undefined;
}

const add = (a: Vec3, b: Vec3): Vec3 => a.map((entry, axis) => entry + b[axis]!) as Vec3;
const scale = (vector: Vec3, amount: number): Vec3 => vector.map((entry) => entry * amount) as Vec3;
const normalized = (vector: Vec3, fallback: Vec3): Vec3 => {
  const length = Math.hypot(...vector);
  return length > 1e-6 ? scale(vector, 1 / length) : fallback;
};

function controllerDelta(controller: Controller, worldDelta: Vec3): Vec3 {
  const local = controllerOffsetFromWorldDelta(controller, worldDelta);
  const length = Math.hypot(...local);
  // A malformed or near-singular rig must never create unbounded pose keys.
  return length > 8 ? scale(local, 8 / length) : local;
}

function rigAxes(controllers: Controller[]): { right: Vec3; forward: Vec3 } {
  const pair = (part: CharacterPart) => [selectControl(controllers, part, 'left'), selectControl(controllers, part, 'right')] as const;
  const [left, right] = pair('hand')[0] && pair('hand')[1] ? pair('hand') : pair('foot');
  const lateral: Vec3 = left?.worldPosition && right?.worldPosition
    ? [right.worldPosition[0] - left.worldPosition[0], right.worldPosition[1] - left.worldPosition[1], 0] : [1, 0, 0];
  const axis = normalized(lateral, [1, 0, 0]);
  return { right: axis, forward: [axis[1], -axis[0], 0] };
}

function rigHeight(controllers: Controller[], previewScale: number): number {
  const positions = controllers.flatMap((controller) => controller.worldPosition ? [controller.worldPosition[2]] : []);
  const span = positions.length > 1 ? Math.max(...positions) - Math.min(...positions) : 0;
  return Math.max(.5, Math.min(4, span > .3 ? span : 2 / previewScale));
}

function directionVector(direction: CharacterDirection | undefined, right: Vec3, forward: Vec3): Vec3 {
  switch (direction) {
    case 'down': return [0, 0, -1];
    case 'left': return scale(right, -1);
    case 'right': return right;
    case 'forward': return forward;
    case 'back': return scale(forward, -1);
    default: return [0, 0, 1];
  }
}

export function planCharacterMotion(object: SceneObject, instruction: string, answers: CharacterAnswers, startFrame: number, endFrame: number, energy = 2, startFrameProject = 1, options: { fps?: number; travelDirection?: Vec3 } = {}): PlanOperation[] {
  const intent = resolveCharacterMotion(instruction, answers, object);
  if (!intent || endFrame <= startFrame) return [];
  const controls = object.asset.controllers ?? [];
  const height = rigHeight(controls, object.asset.previewScale);
  const intensity = Math.max(.75, Math.min(1.2, .8 + energy * .1));
  const axes = rigAxes(controls);
  const forward = normalized(options.travelDirection ? [options.travelDirection[0], options.travelDirection[1], 0] : axes.forward, axes.forward);
  const up: Vec3 = [0, 0, 1];
  const samples = new Map<string, { controller: Controller; frame: number; offset: Vec3 }>();
  const save = (controller: Controller | undefined, progress: number, worldDelta: Vec3, reset = false) => {
    if (!controller) return;
    const frame = Math.round(startFrame + (endFrame - startFrame) * progress);
    const baseline = controllerOffset(object.asset, controller.name, startFrame, startFrameProject);
    samples.set(`${controller.name}:${frame}`, { controller, frame, offset: reset ? [0, 0, 0] : add(baseline, controllerDelta(controller, worldDelta)) });
  };
  const sides: CharacterSide[] = intent.side === 'both' ? ['left', 'right'] : [intent.side];
  const pose = (controller: Controller | undefined, worldDelta: Vec3, progress = 1) => {
    if (!controller) return;
    save(controller, 0, [0, 0, 0]);
    save(controller, progress, worldDelta);
  };
  if (intent.action === 'walk' || intent.action === 'run') {
    const seconds = (endFrame - startFrame) / (options.fps ?? 24);
    const cycles = Math.max(1, Math.min(6, Math.round(seconds * (intent.action === 'run' ? 2 : 1.2))));
    const quarters = Math.min(endFrame - startFrame, cycles * 4);
    const stride = height * (intent.action === 'run' ? .25 : .18) * intensity;
    const lift = height * (intent.action === 'run' ? .17 : .12) * intensity;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const foot = selectControl(controls, 'foot', side) ?? selectControl(controls, 'knee', side);
      const knee = selectControl(controls, 'knee', side);
      const hand = selectControl(controls, 'hand', side) ?? selectControl(controls, 'arm', side);
      const elbow = selectControl(controls, 'elbow', side);
      for (let index = 0; index <= quarters; index++) {
        const progress = index / quarters;
        const phase = Math.sin(progress * Math.PI * 2 * cycles) * sign;
        const swing = Math.max(0, phase);
        save(foot, progress, add(scale(forward, phase * stride), scale(up, swing * lift)));
        if (knee && knee.name !== foot?.name) save(knee, progress, add(scale(forward, phase * stride * .55), scale(up, swing * lift * .65)));
        save(hand, progress, add(scale(forward, -phase * stride * .55), scale(up, Math.abs(phase) * height * .045)));
        if (elbow && elbow.name !== hand?.name) save(elbow, progress, add(scale(forward, -phase * stride * .25), scale(up, Math.abs(phase) * height * .025)));
      }
    }
  } else if (intent.action === 'jump') {
    for (const side of ['left', 'right'] as const) {
      const knee = selectControl(controls, 'knee', side) ?? selectControl(controls, 'foot', side);
      const foot = selectControl(controls, 'foot', side);
      for (const control of [knee, foot].filter((item, index, items) => item && items.findIndex((entry) => entry?.name === item.name) === index)) {
        save(control, 0, [0, 0, 0]);
        save(control, .2, scale(up, -height * .05));
        save(control, .5, scale(up, height * .17));
        save(control, 1, [0, 0, 0]);
      }
    }
  } else {
    for (const side of sides) {
      const leg = intent.part === 'foot' || intent.part === 'knee' || intent.part === 'leg' || intent.action === 'kick';
      const part = intent.part ?? (leg ? 'foot' : intent.action === 'bend' ? 'elbow' : 'hand');
      const controller = (intent.controllerName ? controls.find((control) => control.name === intent.controllerName) : undefined) ?? selectControl(controls, part, side)
        ?? (leg ? selectControl(controls, 'foot', side) : selectControl(controls, 'hand', side));
      if (!controller) continue;
      const elbow = !leg && part !== 'elbow' && !intent.controllerName ? selectControl(controls, 'elbow', side) : undefined;
      const knee = leg && part !== 'knee' && !intent.controllerName ? selectControl(controls, 'knee', side) : undefined;
      const outward = scale(axes.right, side === 'left' ? -1 : 1);
      if (intent.action === 'lower') {
        save(controller, 0, [0, 0, 0]);
        save(controller, 1, [0, 0, 0], true);
        if (elbow) { save(elbow, 0, [0, 0, 0]); save(elbow, 1, [0, 0, 0], true); }
        if (knee) { save(knee, 0, [0, 0, 0]); save(knee, 1, [0, 0, 0], true); }
      } else if (intent.action === 'wave') {
        const raised = add(scale(up, height * .72 * intensity), scale(outward, height * .12));
        const across = scale(axes.right, height * .08);
        save(controller, 0, [0, 0, 0]);
        save(controller, .2, raised);
        save(controller, .4, add(raised, across));
        save(controller, .6, add(raised, scale(across, -1)));
        save(controller, .8, add(raised, across));
        save(controller, 1, [0, 0, 0]);
        if (elbow) { save(elbow, 0, [0, 0, 0]); save(elbow, .2, add(scale(up, height * .34), scale(outward, height * .07))); save(elbow, .8, add(scale(up, height * .34), scale(outward, height * .07))); save(elbow, 1, [0, 0, 0]); }
      } else if (intent.action === 'kick') {
        save(controller, 0, [0, 0, 0]);
        save(controller, .5, add(scale(forward, height * .25 * intensity), scale(up, height * .22 * intensity)));
        save(controller, 1, [0, 0, 0]);
        if (knee) { save(knee, 0, [0, 0, 0]); save(knee, .5, add(scale(forward, height * .12), scale(up, height * .13))); save(knee, 1, [0, 0, 0]); }
      } else if (intent.action === 'raise') {
        if (leg) {
          pose(controller, scale(up, height * .24 * intensity));
          if (knee) pose(knee, scale(up, height * .14 * intensity));
        } else {
          pose(controller, add(scale(up, height * .8 * intensity), scale(outward, height * .12)));
          if (elbow) pose(elbow, add(scale(up, height * .35 * intensity), scale(outward, height * .07)));
        }
      } else if (intent.action === 'point') {
        pose(controller, add(scale(forward, height * .28 * intensity), scale(outward, height * .08)));
        if (elbow) pose(elbow, scale(forward, height * .13 * intensity));
      } else if (intent.action === 'bend') {
        pose(controller, add(scale(up, height * .13 * intensity), scale(outward, height * .07)));
        if (knee) pose(knee, scale(up, height * .1 * intensity));
      } else pose(controller, scale(directionVector(intent.direction, axes.right, axes.forward), height * .2 * intensity));
    }
  }
  return [...samples.values()].sort((a, b) => a.frame - b.frame).map(({ controller, frame, offset }) => ({
    id: crypto.randomUUID(), type: 'set_controller_pose', objectId: object.id, frame, property: 'controller_pose', controllerName: controller.name,
    value: { vector: offset, boolean: null, text: null, number: null }, interpolation: 'linear',
    rationale: `Articulated character motion: ${intent.action}.`, commentIds: [],
  }));
}
