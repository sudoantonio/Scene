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

function localDirection(controller: Controller, direction: Vec3, magnitude: number): Vec3 {
  const local = controllerOffsetFromWorldDelta(controller, direction);
  const length = Math.hypot(...local);
  return length > 1e-6 ? scale(local, magnitude / length) : [0, 0, 0];
}

function directionVector(direction: CharacterDirection | undefined): Vec3 {
  switch (direction) {
    case 'down': return [0, 0, -1];
    case 'left': return [-1, 0, 0];
    case 'right': return [1, 0, 0];
    case 'forward': return [0, -1, 0];
    case 'back': return [0, 1, 0];
    default: return [0, 0, 1];
  }
}

export function planCharacterMotion(object: SceneObject, instruction: string, answers: CharacterAnswers, startFrame: number, endFrame: number, energy = 2, startFrameProject = 1): PlanOperation[] {
  const intent = resolveCharacterMotion(instruction, answers, object);
  if (!intent || endFrame <= startFrame) return [];
  const controls = object.asset.controllers ?? [];
  const amplitude = Math.max(.2, Math.min(.8, .32 + energy * .07));
  const samples = new Map<string, { controller: Controller; frame: number; offset: Vec3 }>();
  const save = (controller: Controller | undefined, progress: number, delta: Vec3, reset = false) => {
    if (!controller) return;
    const frame = Math.round(startFrame + (endFrame - startFrame) * progress);
    const baseline = controllerOffset(object.asset, controller.name, startFrame, startFrameProject);
    samples.set(`${controller.name}:${frame}`, { controller, frame, offset: reset ? [0, 0, 0] : add(baseline, delta) });
  };
  const sides: CharacterSide[] = intent.side === 'both' ? ['left', 'right'] : [intent.side];
  const pose = (controller: Controller | undefined, worldDirection: Vec3, amount: number, progress = 1) => {
    if (!controller) return;
    save(controller, 0, [0, 0, 0]);
    save(controller, progress, localDirection(controller, worldDirection, amount));
  };
  if (intent.action === 'walk' || intent.action === 'run') {
    const strength = intent.action === 'run' ? amplitude * 1.2 : amplitude * .8;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const foot = selectControl(controls, 'foot', side) ?? selectControl(controls, 'knee', side);
      const hand = selectControl(controls, 'hand', side) ?? selectControl(controls, 'arm', side);
      for (const progress of [0, .25, .5, .75, 1]) {
        const phase = Math.sin(progress * Math.PI * 2) * sign;
        save(foot, progress, foot ? add(localDirection(foot, [0, -1, 0], phase * strength), localDirection(foot, [0, 0, 1], Math.max(0, phase) * strength * .4)) : [0, 0, 0]);
        save(hand, progress, hand ? localDirection(hand, [0, -1, 0], -phase * strength * .65) : [0, 0, 0]);
      }
    }
  } else if (intent.action === 'jump') {
    for (const side of ['left', 'right'] as const) {
      const knee = selectControl(controls, 'knee', side) ?? selectControl(controls, 'foot', side);
      save(knee, 0, [0, 0, 0]);
      save(knee, .25, knee ? localDirection(knee, [0, 0, -1], amplitude * .35) : [0, 0, 0]);
      save(knee, .5, knee ? localDirection(knee, [0, 0, 1], amplitude * .5) : [0, 0, 0]);
      save(knee, 1, [0, 0, 0]);
    }
  } else {
    for (const side of sides) {
      const leg = intent.part === 'foot' || intent.part === 'knee' || intent.part === 'leg' || intent.action === 'kick';
      const part = intent.part ?? (leg ? 'foot' : intent.action === 'bend' ? 'elbow' : 'hand');
      const controller = (intent.controllerName ? controls.find((control) => control.name === intent.controllerName) : undefined) ?? selectControl(controls, part, side)
        ?? (leg ? selectControl(controls, 'foot', side) : selectControl(controls, 'hand', side));
      if (!controller) continue;
      if (intent.action === 'lower') {
        save(controller, 0, [0, 0, 0]);
        save(controller, 1, [0, 0, 0], true);
      } else if (intent.action === 'wave') {
        const up = localDirection(controller, [0, 0, 1], amplitude);
        const across = localDirection(controller, [1, 0, 0], amplitude * .3);
        save(controller, 0, [0, 0, 0]);
        save(controller, .25, add(up, across));
        save(controller, .5, add(up, scale(across, -1)));
        save(controller, .75, add(up, across));
        save(controller, 1, [0, 0, 0]);
      } else if (intent.action === 'kick') {
        save(controller, 0, [0, 0, 0]);
        save(controller, .5, add(localDirection(controller, [0, -1, 0], amplitude), localDirection(controller, [0, 0, 1], amplitude * .45)));
        save(controller, 1, [0, 0, 0]);
      } else if (intent.action === 'point') pose(controller, [0, -1, 0], amplitude);
      else if (intent.action === 'bend') pose(controller, [0, 0, -1], amplitude * .7);
      else pose(controller, intent.action === 'raise' ? [0, 0, 1] : directionVector(intent.direction), amplitude);
    }
  }
  return [...samples.values()].sort((a, b) => a.frame - b.frame).map(({ controller, frame, offset }) => ({
    id: crypto.randomUUID(), type: 'set_controller_pose', objectId: object.id, frame, property: 'controller_pose', controllerName: controller.name,
    value: { vector: offset, boolean: null, text: null, number: null }, interpolation: 'linear',
    rationale: `Articulated character motion: ${intent.action}.`, commentIds: [],
  }));
}
