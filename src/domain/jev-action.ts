import { z } from 'zod';
import * as THREE from 'three';
import { BlenderPlanSchema, type AbacoProject, type BlenderPlan, type SceneObject, type Vec3 } from './schema';
import { evaluateTransform } from './animation';
import { cameraBasis, cameraTarget } from './camera-space';

export const JevChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
});
export const JevScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number().finite(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
  legend: z.record(z.string(), z.string()).optional(),
});
export const JevNoulAnswerSchema = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });

export const JevActionResponseSchema = z.object({
  model: z.string(),
  answers: z.object({
    actionable: JevNoulAnswerSchema,
    action: JevChoiceAnswerSchema,
    direction: JevChoiceAnswerSchema,
    distance: JevScoreAnswerSchema,
    duration: JevScoreAnswerSchema,
    energy: JevScoreAnswerSchema,
    path: JevChoiceAnswerSchema,
    camera_requested: JevNoulAnswerSchema.optional(),
    camera_action: JevChoiceAnswerSchema.optional(),
    camera_distance: JevScoreAnswerSchema.optional(),
    camera_duration: JevScoreAnswerSchema.optional(),
    camera_path: JevChoiceAnswerSchema.optional(),
    stroke_target: JevChoiceAnswerSchema.optional(),
  }),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});
export type JevActionResponse = z.infer<typeof JevActionResponseSchema>;

export const JevActionInputSchema = z.object({
  project: z.unknown(),
  objectId: z.string().uuid().nullable(),
  sceneId: z.string().uuid(),
  frame: z.number().int().positive(),
  startPosition: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).nullable(),
  instruction: z.string().trim().min(3).max(2_000),
  gesture: z.object({
    points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(512),
    target: z.enum(['auto', 'subject', 'camera']).default('auto'),
  }).optional(),
});
export type JevActionInput = z.infer<typeof JevActionInputSchema>;

const actionCriteria = {
  move: 'Il personaggio cambia posizione sul piano o nello spazio.',
  rise: 'Il personaggio sale o prende quota.',
  descend: 'Il personaggio scende o perde quota.',
  jump: 'Il personaggio compie un salto e torna a una quota di appoggio.',
  turn: 'Il personaggio cambia orientamento senza una traslazione significativa.',
  hold: 'Il personaggio resta nella posizione indicata; la richiesta descrive una pausa o immobilità.',
};

const directionCriteria = {
  forward: 'Dentro l’inquadratura, seguendo la direzione di vista della camera.',
  backward: 'Fuori dall’inquadratura, nel verso opposto alla direzione di vista della camera.',
  away_camera: 'Si allontana radialmente dalla posizione della camera attiva.',
  toward_camera: 'Si avvicina radialmente alla posizione della camera attiva.',
  left: 'Verso il lato sinistro dell’inquadratura.',
  right: 'Verso il lato destro dell’inquadratura.',
  up: 'Verso Z positivo.',
  down: 'Verso Z negativo.',
};

const cameraActionCriteria = {
  hold: 'La camera resta ferma.',
  push_in: 'La camera avanza verso il soggetto o stringe l’inquadratura.',
  pull_out: 'La camera arretra dal soggetto o allarga l’inquadratura.',
  truck_left: 'La camera trasla verso sinistra mantenendo il soggetto in quadro.',
  truck_right: 'La camera trasla verso destra mantenendo il soggetto in quadro.',
  rise: 'La camera sale.',
  descend: 'La camera scende.',
  pan_left: 'La camera ruota o sposta lo sguardo verso sinistra dalla posizione attuale.',
  pan_right: 'La camera ruota o sposta lo sguardo verso destra dalla posizione attuale.',
  tilt_up: 'La camera inclina lo sguardo verso l’alto.',
  tilt_down: 'La camera inclina lo sguardo verso il basso.',
  orbit_left: 'La camera orbita attorno al soggetto verso sinistra.',
  orbit_right: 'La camera orbita attorno al soggetto verso destra.',
  follow_subject: 'La camera segue lo spostamento del soggetto mantenendo la distanza.',
};

function gestureSummary(points: [number, number][] | undefined) {
  if (!points || points.length < 2) return null;
  const first = points[0]!, last = points[points.length - 1]!;
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  const dx = last[0] - first[0], dy = last[1] - first[1], chord = Math.hypot(dx, dy);
  const horizontal = Math.abs(dx) > Math.abs(dy) * .65 ? (dx >= 0 ? 'right' : 'left') : '';
  const vertical = Math.abs(dy) > Math.abs(dx) * .65 ? (dy >= 0 ? 'down_on_screen' : 'up_on_screen') : '';
  return { start: first, end: last, delta: { x: dx, y: dy }, direction: [horizontal, vertical].filter(Boolean).join('_') || 'diagonal', normalized_length: length, curvature_ratio: length / Math.max(.0001, chord), samples: points.filter((_, index) => index % Math.max(1, Math.ceil(points.length / 24)) === 0 || index === points.length - 1) };
}

export function jevActionRequest(project: AbacoProject, object: SceneObject | undefined, input: Omit<JevActionInput, 'project'>) {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === input.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  const camera = project.objects.find((candidate) => candidate.id === scenes[sceneIndex]?.cameraId && candidate.kind === 'camera');
  const cameraTransform = camera ? evaluateTransform(camera, input.frame) : undefined;
  const objectTransform = object ? evaluateTransform(object, input.frame) : undefined;
  return {
    model: 'jev-latest',
    state: {
      application: 'Scene di ABACO, editor di animatic 3D',
      selected_subject: object ? { id: object.id, name: object.name, kind: object.kind } : null,
      available_subjects: project.objects.filter((candidate) => candidate.kind !== 'camera' && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace).map((candidate) => ({ id: candidate.id, name: candidate.name, kind: candidate.kind })),
      instruction: input.instruction,
      current_frame: input.frame,
      scene_end_frame: sceneEnd,
      fps: project.settings.fps,
      start_position_meters: input.startPosition ? { x: input.startPosition[0], y: input.startPosition[1], z: input.startPosition[2] } : null,
      start_rotation_degrees: objectTransform ? { x: objectTransform.rotation[0], y: objectTransform.rotation[1], z: objectTransform.rotation[2] } : null,
      active_camera: cameraTransform ? { position: cameraTransform.position, rotation_degrees: cameraTransform.rotation } : null,
      drawn_stroke: gestureSummary(input.gesture?.points),
      drawn_stroke_target_preference: input.gesture?.target ?? null,
      coordinate_system: 'Destra e sinistra seguono l’orizzontale dell’inquadratura. Avanti entra nella scena allontanandosi dalla camera; indietro si avvicina alla camera. Alto e basso seguono Z. Le distanze sono metri.',
      constraint: 'Interpreta una sola azione principale. Non aggiungere eventi, oggetti o dialoghi non richiesti.',
    },
    questions: {
      actionable: { type: 'noul', instructions: 'La richiesta descrive un movimento o una posa abbastanza chiari da convertire in keyframe?' },
      action: { type: 'choice', instructions: 'Qual è l’azione principale richiesta?', criteria: actionCriteria },
      direction: { type: 'choice', instructions: 'Qual è la direzione principale? “Allontanarsi dalla camera” significa away_camera; “avvicinarsi alla camera” significa toward_camera. Per turn usa left o right; per rise usa up; per descend usa down.', criteria: directionCriteria },
      distance: { type: 'score', instructions: 'Quanto deve essere ampio lo spostamento?', criteria: ['Minimo: 0,25 m', 'Piccolo: 0,5 m', 'Medio: 1 m', 'Ampio: 2 m', 'Molto ampio: 4 m'] },
      duration: { type: 'score', instructions: 'Quanto deve durare l’azione?', criteria: ['Scatto: 0,25 s', 'Rapida: 0,5 s', 'Normale: 1 s', 'Lenta: 2 s', 'Molto lenta: 4 s'] },
      energy: { type: 'score', instructions: 'Qual è l’energia espressiva del movimento?', criteria: ['Quasi immobile', 'Controllata', 'Naturale', 'Decisa', 'Esplosiva'] },
      path: { type: 'choice', instructions: 'Che forma deve avere il tragitto?', criteria: { direct: 'Traiettoria diretta e lineare.', smooth: 'Movimento morbido con accelerazione e decelerazione.', arc: 'Traiettoria ad arco, adatta soprattutto a un salto.' } },
      camera_requested: { type: 'noul', instructions: 'La richiesta contiene un movimento, una rotazione o un comportamento esplicito della camera?' },
      camera_action: { type: 'choice', instructions: 'Qual è il movimento principale richiesto per la camera?', criteria: cameraActionCriteria },
      camera_distance: { type: 'score', instructions: 'Quanto deve essere ampio il movimento della camera?', criteria: ['Minimo: 0,25 m', 'Piccolo: 0,5 m', 'Medio: 1 m', 'Ampio: 2 m', 'Molto ampio: 4 m'] },
      camera_duration: { type: 'score', instructions: 'Quanto deve durare il movimento della camera?', criteria: ['Scatto: 0,25 s', 'Rapido: 0,5 s', 'Normale: 1 s', 'Lento: 2 s', 'Molto lento: 4 s'] },
      camera_path: { type: 'choice', instructions: 'Come deve muoversi la camera?', criteria: { direct: 'Movimento lineare e meccanico.', smooth: 'Movimento cinematografico morbido.', arc: 'Movimento curvo o orbitale.' } },
      stroke_target: { type: 'choice', instructions: 'Se è presente un tratto disegnato, quale movimento rappresenta in base alla descrizione?', criteria: { subject: 'La traiettoria del soggetto selezionato.', camera: 'La traiettoria della camera attiva.' } },
    },
  } as const;
}

const distances = [.25, .5, 1, 2, 4];
const durations = [.25, .5, 1, 2, 4];
const nearestLevel = (score: number, values: number[]) => values[Math.max(0, Math.min(values.length - 1, Math.round(score)))]!;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const normalizeGround = (vector: Vec3, fallback: Vec3): Vec3 => {
  const length = Math.hypot(vector[0], vector[1]);
  return length < .0001 ? fallback : [vector[0] / length, vector[1] / length, 0];
};
export function cameraRelativeDirections(project: AbacoProject, sceneId: string, frame: number): Record<string, Vec3> {
  const scene = project.cameraCuts.find((candidate) => candidate.id === sceneId);
  const camera = project.objects.find((candidate) => candidate.id === scene?.cameraId && candidate.kind === 'camera');
  if (!camera) return { forward: [0, 1, 0], backward: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 0, 1], down: [0, 0, -1] };
  const cameraTransform = evaluateTransform(camera, frame);
  const [screenRight, intoScene] = cameraBasis(cameraTransform.rotation).map((axis) => axis.toArray() as Vec3);
  const right = normalizeGround(screenRight, [1, 0, 0]);
  const forward = normalizeGround(intoScene, [0, 1, 0]);
  return { forward, backward: scale(forward, -1), left: scale(right, -1), right, up: [0, 0, 1], down: [0, 0, -1] };
}

function explicitCameraDirection(instruction: string): 'away_camera' | 'toward_camera' | undefined {
  const text = instruction.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const matches: { index: number; direction: 'away_camera' | 'toward_camera' }[] = [];
  const patterns: ['away_camera' | 'toward_camera', RegExp][] = [
    ['away_camera', /(?:allontan\w*|lontan\w*)[^.!?,;]{0,32}(?:dalla|da\s+la)\s+(?:tele)?camera|away\s+from\s+(?:the\s+)?camera/g],
    ['toward_camera', /(?:avvicin\w*)[^.!?,;]{0,32}(?:alla|a\s+la|verso\s+la)\s+(?:tele)?camera|towards?\s+(?:the\s+)?camera/g],
  ];
  patterns.forEach(([direction, pattern]) => {
    for (const match of text.matchAll(pattern)) matches.push({ index: match.index, direction });
  });
  return matches.sort((a, b) => b.index - a.index)[0]?.direction;
}

function radialCameraDirections(project: AbacoProject, sceneId: string, frame: number, position: Vec3): Record<string, Vec3> {
  const scene = project.cameraCuts.find((candidate) => candidate.id === sceneId);
  const camera = project.objects.find((candidate) => candidate.id === scene?.cameraId && candidate.kind === 'camera');
  if (!camera) return {};
  const cameraPosition = evaluateTransform(camera, frame).position;
  const away = normalizeGround([position[0] - cameraPosition[0], position[1] - cameraPosition[1], 0], [0, 1, 0]);
  return { away_camera: away, toward_camera: scale(away, -1) };
}

export const JevActionPlanSchema = z.object({
  schemaVersion: z.literal('JevActionPlanV1'),
  objectId: z.string().uuid().nullable(),
  instruction: z.string(),
  model: z.string(),
  status: z.enum(['ready', 'review']),
  confidence: z.number().min(0).max(1),
  decision: z.object({
    action: z.string(), direction: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), energy: z.number(), path: z.string(), actionable: z.number(),
    camera: z.object({ requested: z.boolean(), action: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), path: z.string() }).optional(),
    gesture: z.object({ target: z.enum(['subject', 'camera']), points: z.number().int().positive() }).optional(),
  }),
  blenderPlan: BlenderPlanSchema,
});
export type JevActionPlan = z.infer<typeof JevActionPlanSchema>;

const normalizeVector = (vector: Vec3, fallback: Vec3): Vec3 => {
  const length = Math.hypot(...vector);
  return length < .0001 ? fallback : vector.map((entry) => entry / length) as Vec3;
};
const sameVector = (a: Vec3, b: Vec3) => a.every((entry, index) => Math.abs(entry - b[index]) < .0001);
const cameraWords = /camera|telecamera|inquadratur|carrell|panoram|dolly|orbit|zoom|ripresa/;

function strokeTrajectory(points: [number, number][], origin: Vec3, horizontal: Vec3, vertical: Vec3, distance: number, maxPoints = 9) {
  const count = Math.min(maxPoints, points.length);
  const samples = Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / Math.max(1, count - 1))]!);
  const first = samples[0]!;
  const rawOffsets = samples.map(([x, y]) => add(scale(horizontal, x - first[0]), scale(vertical, first[1] - y)));
  const extent = Math.max(.0001, ...rawOffsets.map((offset) => Math.hypot(...offset)));
  const segmentLengths = samples.map((point, index) => index ? Math.hypot(point[0] - samples[index - 1]![0], point[1] - samples[index - 1]![1]) : 0);
  const total = Math.max(.0001, segmentLengths.reduce((sum, entry) => sum + entry, 0));
  let elapsed = 0;
  return rawOffsets.map((offset, index) => {
    elapsed += segmentLengths[index]!;
    return { position: add(origin, scale(offset, distance / extent)), progress: index ? elapsed / total : 0 };
  });
}

function normalizedInstruction(instruction: string) {
  return instruction.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function explicitCameraMotion(instruction: string) {
  const text = normalizedInstruction(instruction);
  const patterns: [string, RegExp][] = [
    ['follow_subject', /(?:camera|telecamera)[^.!?]{0,32}(?:segue|insegue|accompagna)/],
    ['orbit_left', /(?:camera|telecamera)[^.!?]{0,32}(?:orbita|gira)[^.!?]{0,20}(?:sinistra|antiorari)/],
    ['orbit_right', /(?:camera|telecamera)[^.!?]{0,32}(?:orbita|gira)[^.!?]{0,20}(?:destra|orari)/],
    ['pan_left', /(?:panoramica|pan|sguardo)[^.!?]{0,20}(?:sinistra)/],
    ['pan_right', /(?:panoramica|pan|sguardo)[^.!?]{0,20}(?:destra)/],
    ['tilt_up', /(?:camera|telecamera|inquadratura)[^.!?]{0,32}(?:inclina|guarda|punta)[^.!?]{0,16}(?:alto|su)/],
    ['tilt_down', /(?:camera|telecamera|inquadratura)[^.!?]{0,32}(?:inclina|guarda|punta)[^.!?]{0,16}(?:basso|giu)/],
    ['push_in', /(?:camera|telecamera)[^.!?]{0,32}(?:avanza|si avvicina|stringe|entra)|(?:push[ -]?in|dolly[ -]?in)/],
    ['pull_out', /(?:camera|telecamera)[^.!?]{0,32}(?:arretra|si allontana|allarga|esce)|(?:pull[ -]?out|dolly[ -]?out)/],
    ['truck_left', /(?:camera|telecamera)[^.!?]{0,32}(?:trasla|scorre|carrella)[^.!?]{0,16}(?:sinistra)/],
    ['truck_right', /(?:camera|telecamera)[^.!?]{0,32}(?:trasla|scorre|carrella)[^.!?]{0,16}(?:destra)/],
    ['rise', /(?:camera|telecamera)[^.!?]{0,32}(?:sale|si alza|solleva)/],
    ['descend', /(?:camera|telecamera)[^.!?]{0,32}(?:scende|si abbassa)/],
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0];
}

function rotationToward(position: Vec3, target: Vec3): Vec3 {
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...target));
  return [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((entry) => THREE.MathUtils.radToDeg(entry)) as Vec3;
}

export function compileJevAction(project: AbacoProject, object: SceneObject | undefined, input: Omit<JevActionInput, 'project'>, raw: JevActionResponse): JevActionPlan {
  const response = JevActionResponseSchema.parse(raw);
  const { answers } = response;
  const distance = nearestLevel(answers.distance.score, distances);
  const duration = nearestLevel(answers.duration.score, durations);
  const explicitCameraAction = explicitCameraMotion(input.instruction);
  const mentionsCamera = cameraWords.test(normalizedInstruction(input.instruction));
  const cameraAction = explicitCameraAction ?? answers.camera_action?.choice ?? 'hold';
  const gestureTarget = input.gesture ? (input.gesture.target === 'auto' ? (answers.stroke_target?.choice === 'camera' || !object ? 'camera' : 'subject') : input.gesture.target) : undefined;
  const cameraRequested = gestureTarget === 'camera' || (cameraAction !== 'hold' && (mentionsCamera || (answers.camera_requested?.noul ?? 0) >= .6));
  const subjectConfidences = object ? [answers.action.confidence, answers.direction.confidence, answers.distance.confidence, answers.duration.confidence, answers.energy.confidence, answers.path.confidence] : [];
  const cameraConfidences = cameraRequested ? [answers.camera_action?.confidence, answers.camera_distance?.confidence, answers.camera_duration?.confidence, answers.camera_path?.confidence].filter((entry): entry is number => entry !== undefined) : [];
  const confidences = [...subjectConfidences, ...cameraConfidences];
  const confidence = Math.min(...(confidences.length ? confidences : [0]));
  const cameraIntent = explicitCameraDirection(input.instruction);
  const directionChoice = cameraIntent ?? answers.direction.choice;
  const startPosition = input.startPosition ?? (object ? evaluateTransform(object, input.frame).position : [0, 0, 0]);
  const directions: Record<string, Vec3> = { ...cameraRelativeDirections(project, input.sceneId, input.frame), ...radialCameraDirections(project, input.sceneId, input.frame, startPosition) };
  const direction = directions[directionChoice] ?? directions.forward;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === input.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  const endFrame = Math.min(sceneEnd, input.frame + Math.max(1, Math.round(duration * project.settings.fps)));
  const interpolation = answers.path.choice === 'direct' ? 'linear' : 'bezier';
  let endPosition = startPosition;
  const objectTransform = object ? evaluateTransform(object, input.frame) : undefined;
  let endRotation = objectTransform?.rotation ?? [0, 0, 0];
  const action = object ? (gestureTarget === 'subject' ? (['jump', 'rise', 'descend'].includes(answers.action.choice) ? answers.action.choice : 'move') : cameraIntent && answers.action.choice !== 'jump' ? 'move' : answers.action.choice) : 'hold';
  if (object && ['move', 'rise', 'descend'].includes(action)) endPosition = add(startPosition, scale(direction, distance));
  if (object && action === 'turn') {
    const amount = distance <= .5 ? 45 : distance <= 1 ? 90 : 180;
    endRotation = [objectTransform!.rotation[0], objectTransform!.rotation[1], objectTransform!.rotation[2] + (answers.direction.choice === 'left' ? amount : -amount)];
  }
  if (object && action === 'jump') {
    const horizontal: Vec3 = answers.direction.choice === 'up' || answers.direction.choice === 'down' ? [0, 0, 0] : scale(direction, distance);
    endPosition = add(startPosition, horizontal);
  }
  const strokeVertical: Vec3 = ['jump', 'rise', 'descend'].includes(action) ? [0, 0, 1] : directions.forward!;
  const subjectStroke = object && gestureTarget === 'subject' && input.gesture ? strokeTrajectory(input.gesture.points, startPosition, directions.right!, strokeVertical, distance, endFrame - input.frame + 1) : undefined;
  if (subjectStroke?.length) endPosition = subjectStroke[subjectStroke.length - 1]!.position;
  const value = (vector: Vec3) => ({ vector, boolean: null, text: null, number: null });
  const operations: BlenderPlan['operations'] = [];
  if (subjectStroke) {
    let previousFrame = input.frame - 1;
    subjectStroke.forEach((point, index) => {
      const remaining = subjectStroke.length - 1 - index;
      const pointFrame = Math.max(previousFrame + 1, Math.min(endFrame - remaining, Math.round(input.frame + (endFrame - input.frame) * point.progress)));
      previousFrame = pointFrame;
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object!.id, frame: pointFrame, property: 'position', value: value(point.position), interpolation: 'bezier', rationale: index ? 'Traiettoria disegnata sul canvas e interpretata da Jev.' : 'Inizio della traiettoria disegnata.', commentIds: [] });
    });
  } else if (object && ['move', 'rise', 'descend', 'jump'].includes(action)) operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'position', value: value(startPosition), interpolation, rationale: 'Posizione iniziale indicata per l’azione Jev.', commentIds: [] });
  if (!subjectStroke && object && action === 'jump') {
    const apexFrame = Math.max(input.frame + 1, Math.round((input.frame + endFrame) / 2));
    const midpoint = scale(add(startPosition, endPosition), .5);
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: apexFrame, property: 'position', value: value([midpoint[0], midpoint[1], Math.max(startPosition[2], endPosition[2]) + Math.max(.35, distance * .5)]), interpolation: 'bezier', rationale: 'Apice del salto scelto da Jev.', commentIds: [] });
  }
  if (!subjectStroke && object && ['move', 'rise', 'descend', 'jump'].includes(action)) operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'position', value: value(endPosition), interpolation, rationale: `Azione ${action} compilata dalle decisioni Jev.`, commentIds: [] });
  if (object && action === 'turn') {
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'rotation', value: value(objectTransform!.rotation), interpolation, rationale: 'Orientamento iniziale.', commentIds: [] });
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'rotation', value: value(endRotation), interpolation, rationale: 'Rotazione scelta da Jev.', commentIds: [] });
  }

  const scene = scenes[sceneIndex];
  const cameraObject = project.objects.find((candidate) => candidate.id === scene?.cameraId && candidate.kind === 'camera');
  const cameraDistance = nearestLevel(answers.camera_distance?.score ?? answers.distance.score, distances);
  const cameraDuration = nearestLevel(answers.camera_duration?.score ?? answers.duration.score, durations);
  const cameraInterpolation = answers.camera_path?.choice === 'direct' ? 'linear' : 'bezier';
  if (cameraRequested && cameraObject && scene) {
    const cameraTransform = evaluateTransform(cameraObject, input.frame);
    const targetStart = object ? startPosition : cameraTarget(cameraTransform, scene.framing.distance);
    const targetEnd = object ? endPosition : targetStart;
    let cameraEndPosition = cameraTransform.position;
    let cameraEndRotation = cameraTransform.rotation;
    const towardTarget = normalizeVector([targetStart[0] - cameraTransform.position[0], targetStart[1] - cameraTransform.position[1], targetStart[2] - cameraTransform.position[2]], [0, 1, 0]);
    const screenRight = normalizeGround(cameraBasis(cameraTransform.rotation)[0].toArray() as Vec3, [1, 0, 0]);
    if (cameraAction === 'push_in') cameraEndPosition = add(cameraTransform.position, scale(towardTarget, Math.min(cameraDistance, Math.max(.1, Math.hypot(targetStart[0] - cameraTransform.position[0], targetStart[1] - cameraTransform.position[1], targetStart[2] - cameraTransform.position[2]) * .8))));
    else if (cameraAction === 'pull_out') cameraEndPosition = add(cameraTransform.position, scale(towardTarget, -cameraDistance));
    else if (cameraAction === 'truck_left') cameraEndPosition = add(cameraTransform.position, scale(screenRight, -cameraDistance));
    else if (cameraAction === 'truck_right') cameraEndPosition = add(cameraTransform.position, scale(screenRight, cameraDistance));
    else if (cameraAction === 'rise') cameraEndPosition = add(cameraTransform.position, [0, 0, cameraDistance]);
    else if (cameraAction === 'descend') cameraEndPosition = add(cameraTransform.position, [0, 0, -cameraDistance]);
    else if (cameraAction === 'follow_subject') cameraEndPosition = add(cameraTransform.position, [targetEnd[0] - targetStart[0], targetEnd[1] - targetStart[1], targetEnd[2] - targetStart[2]]);
    else if (cameraAction === 'orbit_left' || cameraAction === 'orbit_right') {
      const angle = THREE.MathUtils.degToRad([10, 20, 35, 60, 90][Math.max(0, Math.min(4, Math.round(answers.camera_distance?.score ?? 2)))]! * (cameraAction === 'orbit_left' ? 1 : -1));
      const offset = new THREE.Vector3(...cameraTransform.position).sub(new THREE.Vector3(...targetStart)).applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      cameraEndPosition = new THREE.Vector3(...targetEnd).add(offset).toArray() as Vec3;
    }
    if (['truck_left', 'truck_right', 'rise', 'descend', 'orbit_left', 'orbit_right'].includes(cameraAction)) cameraEndRotation = rotationToward(cameraEndPosition, targetEnd);
    if (cameraAction === 'pan_left' || cameraAction === 'pan_right') cameraEndRotation = rotationToward(cameraEndPosition, add(targetStart, scale(screenRight, cameraDistance * (cameraAction === 'pan_left' ? -1 : 1))));
    if (cameraAction === 'tilt_up' || cameraAction === 'tilt_down') cameraEndRotation = rotationToward(cameraEndPosition, add(targetStart, [0, 0, cameraDistance * (cameraAction === 'tilt_up' ? 1 : -1)]));
    const cameraEndFrame = Math.min(sceneEnd, input.frame + Math.max(1, Math.round(cameraDuration * project.settings.fps)));
    const cameraStroke = gestureTarget === 'camera' && input.gesture ? strokeTrajectory(input.gesture.points, cameraTransform.position, screenRight, [0, 0, 1], cameraDistance, cameraEndFrame - input.frame + 1) : undefined;
    if (cameraStroke) {
      const targetDelta: Vec3 = [targetEnd[0] - targetStart[0], targetEnd[1] - targetStart[1], targetEnd[2] - targetStart[2]];
      let previousFrame = input.frame - 1;
      cameraStroke.forEach((point, index) => {
        const remaining = cameraStroke.length - 1 - index;
        const pointFrame = Math.max(previousFrame + 1, Math.min(cameraEndFrame - remaining, Math.round(input.frame + (cameraEndFrame - input.frame) * point.progress)));
        previousFrame = pointFrame;
        const pointTarget = add(targetStart, scale(targetDelta, point.progress));
        operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: pointFrame, property: 'position', value: value(point.position), interpolation: 'bezier', rationale: index ? 'Traiettoria camera disegnata sul canvas e interpretata da Jev.' : 'Inizio della traiettoria camera disegnata.', commentIds: [] });
        operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: pointFrame, property: 'rotation', value: value(rotationToward(point.position, pointTarget)), interpolation: 'bezier', rationale: 'La camera mantiene il soggetto di riferimento durante il tratto.', commentIds: [] });
      });
    } else if (!sameVector(cameraTransform.position, cameraEndPosition)) {
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: input.frame, property: 'position', value: value(cameraTransform.position), interpolation: cameraInterpolation, rationale: 'Posizione iniziale della camera per la regia Jev.', commentIds: [] });
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: cameraEndFrame, property: 'position', value: value(cameraEndPosition), interpolation: cameraInterpolation, rationale: `Movimento camera ${cameraAction} scelto da Jev.`, commentIds: [] });
    }
    if (!cameraStroke && !sameVector(cameraTransform.rotation, cameraEndRotation)) {
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: input.frame, property: 'rotation', value: value(cameraTransform.rotation), interpolation: cameraInterpolation, rationale: 'Orientamento iniziale della camera per la regia Jev.', commentIds: [] });
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: cameraEndFrame, property: 'rotation', value: value(cameraEndRotation), interpolation: cameraInterpolation, rationale: `Orientamento camera ${cameraAction} scelto da Jev.`, commentIds: [] });
    }
  }
  const actionable = object ? answers.actionable.noul : 1;
  const warnings = confidence < .55 || actionable < .6 ? ['Decisione incerta: controllare il JSON e l’anteprima prima di applicare.'] : [];
  if (!operations.length) warnings.push('La descrizione non contiene un movimento applicabile al soggetto selezionato o alla camera.');
  const plan: BlenderPlan = { schemaVersion: 'BlenderPlanV1', summary: `Jev · Regia: ${input.instruction}`, assumptions: ['Le direzioni del soggetto sono relative alla camera attiva; i movimenti camera mantengono il soggetto selezionato come riferimento.'], warnings, operations };
  return JevActionPlanSchema.parse({
    schemaVersion: 'JevActionPlanV1', objectId: object?.id ?? null, instruction: input.instruction, model: response.model,
    status: confidence >= .55 && actionable >= .6 && operations.length ? 'ready' : 'review', confidence,
    decision: { action, direction: directionChoice, distanceMeters: distance, durationSeconds: duration, energy: answers.energy.score, path: answers.path.choice, actionable, camera: { requested: cameraRequested, action: cameraAction, distanceMeters: cameraDistance, durationSeconds: cameraDuration, path: answers.camera_path?.choice ?? 'smooth' }, gesture: gestureTarget && input.gesture ? { target: gestureTarget, points: input.gesture.points.length } : undefined },
    blenderPlan: plan,
  });
}
