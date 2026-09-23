import { z } from 'zod';
import * as THREE from 'three';
import { BlenderPlanSchema, type AbacoProject, type BlenderPlan, type Keyframe, type SceneObject, type Vec3 } from './schema';
import { evaluateProperty, evaluateTransform } from './animation';
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
    translate_x: JevChoiceAnswerSchema.optional(),
    translate_y: JevChoiceAnswerSchema.optional(),
    translate_z: JevChoiceAnswerSchema.optional(),
    rotate_x: JevChoiceAnswerSchema.optional(),
    rotate_y: JevChoiceAnswerSchema.optional(),
    rotate_z: JevChoiceAnswerSchema.optional(),
    translate_x_positive: JevNoulAnswerSchema.optional(),
    translate_x_negative: JevNoulAnswerSchema.optional(),
    translate_y_positive: JevNoulAnswerSchema.optional(),
    translate_y_negative: JevNoulAnswerSchema.optional(),
    translate_z_positive: JevNoulAnswerSchema.optional(),
    translate_z_negative: JevNoulAnswerSchema.optional(),
    rotate_x_positive: JevNoulAnswerSchema.optional(),
    rotate_x_negative: JevNoulAnswerSchema.optional(),
    rotate_y_positive: JevNoulAnswerSchema.optional(),
    rotate_y_negative: JevNoulAnswerSchema.optional(),
    rotate_z_positive: JevNoulAnswerSchema.optional(),
    rotate_z_negative: JevNoulAnswerSchema.optional(),
    rotation_amount: JevScoreAnswerSchema.optional(),
  }),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});
export type JevActionResponse = z.infer<typeof JevActionResponseSchema>;

export const DecisionEngineSchema = z.enum(['jev', 'laya']);
export type DecisionEngine = z.infer<typeof DecisionEngineSchema>;

export const JevActionInputSchema = z.object({
  project: z.unknown(),
  engine: DecisionEngineSchema.optional(),
  objectId: z.string().uuid().nullable(),
  target: z.enum(['subject', 'camera']).optional(),
  sceneId: z.string().uuid(),
  frame: z.number().int().positive(),
  startPosition: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).nullable(),
  instruction: z.string().trim().min(3).max(2_000),
  gesture: z.object({
    points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(512),
    target: z.enum(['auto', 'subject', 'camera']).default('auto'),
    viewMode: z.enum(['camera', 'free']).optional(),
    viewRotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    viewPosition: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    verticalFovDegrees: z.number().min(1).max(179).optional(),
    aspect: z.number().min(.1).max(10).optional(),
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
  const selectedCamera = input.target === 'camera' ? project.objects.find((candidate) => candidate.id === input.objectId && candidate.kind === 'camera') : undefined;
  const referenceCamera = selectedCamera ?? camera;
  const cameraTransform = referenceCamera ? evaluateTransform(referenceCamera, input.frame) : undefined;
  const objectTransform = object ? evaluateTransform(object, input.frame) : undefined;
  const selectedTarget = input.target === 'camera' ? selectedCamera : object;
  const focusObject = input.target === 'camera' ? resolveCameraFocusObject(project, input.sceneId, input.frame, input.instruction, scenes[sceneIndex]?.framing.target) : object;
  const activeScene = scenes[sceneIndex];
  const sceneObjects = project.objects.filter((candidate) => !candidate.sceneIds.length || candidate.sceneIds.includes(input.sceneId)).map((candidate) => {
    const transform = evaluateTransform(candidate, input.frame);
    return {
      id: candidate.id, name: candidate.name, kind: candidate.kind,
      visible: evaluateProperty(candidate, 'visibility', input.frame), color: candidate.color,
      transform: { position: transform.position, rotation_degrees: transform.rotation, scale: transform.scale },
      asset_bounds_center: candidate.kind === 'blend_asset' ? candidate.asset.boundsCenter : null,
      light: candidate.kind.includes('light') ? candidate.light : null,
      audio: candidate.kind === 'audio' ? { duration_seconds: candidate.audio.duration, volume: candidate.audio.volume, muted: candidate.audio.muted } : null,
      notes: candidate.sceneNotes,
      animation_in_scene: candidate.keyframes.filter((key) => key.frame >= (activeScene?.frame ?? input.frame) && key.frame <= sceneEnd).map((key) => ({ frame: key.frame, property: key.property, value: key.value, interpolation: key.interpolation, purpose: key.purpose ?? null })),
    };
  });
  const standardContent = project.animationStandard?.content ?? '';
  const naturalIntent = naturalMotionIntent(input.instruction, input.target === 'camera');
  const lexicalAxes = naturalIntent.axes;
  const axisTriggerHints = [
    lexicalAxes.translation[0] === 1 ? 'translate_x_positive' : lexicalAxes.translation[0] === -1 ? 'translate_x_negative' : null,
    lexicalAxes.translation[1] === 1 ? 'translate_y_positive' : lexicalAxes.translation[1] === -1 ? 'translate_y_negative' : null,
    lexicalAxes.translation[2] === 1 ? 'translate_z_positive' : lexicalAxes.translation[2] === -1 ? 'translate_z_negative' : null,
    lexicalAxes.rotation[0] === 1 ? 'rotate_x_positive' : lexicalAxes.rotation[0] === -1 ? 'rotate_x_negative' : null,
    lexicalAxes.rotation[1] === 1 ? 'rotate_y_positive' : lexicalAxes.rotation[1] === -1 ? 'rotate_y_negative' : null,
    lexicalAxes.rotation[2] === 1 ? 'rotate_z_positive' : lexicalAxes.rotation[2] === -1 ? 'rotate_z_negative' : null,
  ].filter((entry): entry is string => Boolean(entry));
  return {
    model: 'jev-latest',
    state: {
      application: 'Scene di ABACO, editor di animatic 3D',
      selected_target: selectedTarget ? { id: selectedTarget.id, name: selectedTarget.name, kind: selectedTarget.kind, role: input.target === 'camera' ? 'camera' : 'subject' } : null,
      camera_focus_target: focusObject ? { id: focusObject.id, name: focusObject.name, position: evaluateTransform(focusObject, input.frame).position } : null,
      selected_subject: object ? { id: object.id, name: object.name, kind: object.kind } : null,
      available_subjects: project.objects.filter((candidate) => candidate.kind !== 'camera' && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace).map((candidate) => ({ id: candidate.id, name: candidate.name, kind: candidate.kind })),
      scene_context: {
        project: { id: project.id, name: project.name, fps: project.settings.fps, frame_range: [project.settings.frameStart, project.settings.frameEnd], resolution: [project.settings.resolutionX, project.settings.resolutionY] },
        active_scene: activeScene ? { id: activeScene.id, name: activeScene.name ?? `Scena ${sceneIndex + 1}`, frame_range: [activeScene.frame, sceneEnd], framing: activeScene.framing, lighting: activeScene.lighting, background: { kind: activeScene.background.kind, name: activeScene.background.name } } : null,
        timeline_scenes: scenes.map((scene, index) => ({ id: scene.id, name: scene.name ?? `Scena ${index + 1}`, frame: scene.frame, camera_id: scene.cameraId })),
        objects: sceneObjects,
        directions: project.comments.filter((comment) => comment.sceneId === input.sceneId || (comment.startFrame <= sceneEnd && comment.endFrame >= (activeScene?.frame ?? input.frame))).map((comment) => ({ text: comment.text, scope: comment.scope ?? null, target_ids: comment.targetIds, status: comment.status })),
        animation_brief: project.animationBrief ?? null,
        animation_standard: project.animationStandard ? { name: project.animationStandard.name, content: standardContent.slice(0, 20_000), truncated: standardContent.length > 20_000 } : null,
      },
      instruction: input.instruction,
      natural_language_hints: { action: naturalIntent.action ?? null, direction: naturalIntent.direction ?? null },
      axis_trigger_hints: axisTriggerHints,
      camera_action_hint: explicitCameraMotion(input.instruction, input.target === 'camera') ?? null,
      current_frame: input.frame,
      scene_end_frame: sceneEnd,
      fps: project.settings.fps,
      start_position_meters: input.startPosition ? { x: input.startPosition[0], y: input.startPosition[1], z: input.startPosition[2] } : null,
      start_rotation_degrees: objectTransform ? { x: objectTransform.rotation[0], y: objectTransform.rotation[1], z: objectTransform.rotation[2] } : null,
      active_camera: cameraTransform ? { position: cameraTransform.position, rotation_degrees: cameraTransform.rotation } : null,
      drawn_stroke: input.gesture ? { ...gestureSummary(input.gesture.points), view_mode: input.gesture.viewMode ?? 'camera', view_rotation_degrees: input.gesture.viewRotation ?? cameraTransform?.rotation ?? null, view_position: input.gesture.viewPosition ?? cameraTransform?.position ?? null, vertical_fov_degrees: input.gesture.verticalFovDegrees ?? 45, aspect: input.gesture.aspect ?? project.settings.resolutionX / project.settings.resolutionY } : null,
      drawn_stroke_target_preference: input.gesture?.target ?? null,
      coordinate_system: 'Destra e sinistra seguono l’orizzontale dell’inquadratura. Avanti entra nella scena allontanandosi dalla camera; indietro si avvicina alla camera. Alto e basso seguono Z. Le distanze sono metri.',
      spatial_rules: 'I movimenti ordinari restano sul piano XY e mantengono la quota Z iniziale. Z cambia solo con una richiesta esplicita di salita, discesa o salto. Un’orbita camera chiusa resta su un piano orizzontale, conserva il raggio camera-soggetto e mantiene il soggetto al centro.',
      decision_rules: 'Valuta separatamente ogni asse. X positivo=avanti, X negativo=indietro; Y positivo=destra, Y negativo=sinistra; Z positivo=salire, Z negativo=scendere. Rotazione X=roll, Y=pitch, Z=yaw. Non dedurre movimenti della camera quando il soggetto selezionato non è una camera, e non animare elementi diversi dal soggetto selezionato.',
      constraint: input.target === 'camera'
        ? 'La camera attiva è il soggetto selezionato: interpreta la richiesta esclusivamente come movimento o rotazione della camera. Non animare altri elementi.'
        : 'Interpreta una sola azione principale del soggetto selezionato. Non aggiungere eventi, oggetti o dialoghi non richiesti.',
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
      translate_z_positive: { type: 'noul', instructions: 'La richiesta ordina al soggetto selezionato di aumentare Z, cioè salire o saltare? Rispondi falso se deve stare fermo su Z o scendere.' },
      translate_z_negative: { type: 'noul', instructions: 'La richiesta ordina al soggetto selezionato di diminuire Z, cioè scendere o cadere? Rispondi falso se deve stare fermo su Z o salire.' },
      translate_y_positive: { type: 'noul', instructions: 'La richiesta ordina al soggetto selezionato di aumentare Y, cioè spostarsi a destra? “Guardare a destra” è una rotazione e qui vale falso.' },
      translate_y_negative: { type: 'noul', instructions: 'La richiesta ordina al soggetto selezionato di diminuire Y, cioè spostarsi a sinistra? “Guardare a sinistra” è una rotazione e qui vale falso.' },
      translate_x_positive: { type: 'noul', instructions: 'La richiesta ordina al soggetto selezionato di aumentare X, cioè andare avanti? Rispondi falso se deve stare fermo su X o andare indietro.' },
      translate_x_negative: { type: 'noul', instructions: 'La richiesta ordina al soggetto selezionato di diminuire X, cioè andare indietro? Rispondi falso se deve stare fermo su X o andare avanti.' },
      rotate_y_positive: { type: 'noul', instructions: 'La richiesta ordina pitch positivo sull’asse Y, cioè guardare verso l’alto? Salire senza cambiare sguardo qui vale falso.' },
      rotate_y_negative: { type: 'noul', instructions: 'La richiesta ordina pitch negativo sull’asse Y, cioè guardare verso il basso? Scendere senza cambiare sguardo qui vale falso.' },
      rotate_x_positive: { type: 'noul', instructions: 'La richiesta ordina roll positivo sull’asse X, cioè inclinarsi da un lato? Rispondi falso per una traslazione laterale.' },
      rotate_x_negative: { type: 'noul', instructions: 'La richiesta ordina roll negativo sull’asse X, cioè inclinarsi dal lato opposto? Rispondi falso per una traslazione laterale.' },
      rotate_z_positive: { type: 'noul', instructions: 'La richiesta ordina yaw positivo sull’asse Z, cioè girare o guardare verso destra? Spostarsi a destra senza ruotare qui vale falso.' },
      rotate_z_negative: { type: 'noul', instructions: 'La richiesta ordina yaw negativo sull’asse Z, cioè girare o guardare verso sinistra? Spostarsi a sinistra senza ruotare qui vale falso.' },
      rotation_amount: { type: 'score', instructions: 'Quanto deve essere ampia la rotazione?', criteria: ['Minima: 10°', 'Piccola: 20°', 'Media: 45°', 'Ampia: 90°', 'Completa: 180°'] },
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
  performance: z.object({
    engine: DecisionEngineSchema,
    totalMs: z.number().nonnegative(),
    decisionMs: z.number().nonnegative(),
    modelLoadMs: z.number().nonnegative(),
    warm: z.boolean(),
  }).optional(),
  decision: z.object({
    action: z.string(), direction: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), energy: z.number(), path: z.string(), actionable: z.number(),
    camera: z.object({ requested: z.boolean(), action: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), path: z.string() }).optional(),
    gesture: z.object({ target: z.enum(['subject', 'camera']), points: z.number().int().positive() }).optional(),
  }),
  blenderPlan: BlenderPlanSchema,
});
export type JevActionPlan = z.infer<typeof JevActionPlanSchema>;

const sequenceVerbs = '(?:gira|ruota|volta|orienta|guarda|inclina|piega|va|vai|muove|sposta|trasla|dirige|scivola|avanza|arretra|indietreggia|sale|scende|salta|balza|cade|corre|cammina|marcia|orbita|segue)\\w*';
const sequenceDirections = '(?:destra|sinistra|alto|basso|su|giù|giu|avanti|indietro)';

/** Separates ordered actions without breaking ordinary descriptive conjunctions. */
export function splitJevInstruction(instruction: string): string[] {
  const clean = instruction.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  const sequenced = clean.replace(/\be\s+poi\b/giu, 'e');
  const clauses = sequenced.split(/\s*(?:[.;]|,\s*(?=poi\b)|\b(?:poi|quindi|successivamente|dopodiché|dopodiche)\b)\s*/iu).filter(Boolean);
  const result: string[] = [];
  const opposite = new Set(['destra:sinistra', 'sinistra:destra', 'alto:basso', 'basso:alto', 'su:giu', 'giu:su', 'avanti:indietro', 'indietro:avanti']);

  for (const clause of clauses) {
    const paired = clause.match(new RegExp(`^(.*?\\b${sequenceVerbs}.*?)\\b(?:(a|in|verso)\\s+)?(${sequenceDirections})\\s+e\\s+(?:(a|in|verso)\\s+)?(${sequenceDirections})(.*)$`, 'iu'));
    if (paired) {
      const [, prefix, firstPreposition, firstDirection, secondPreposition, secondDirection, suffix] = paired;
      const normalizedFirst = normalizedInstruction(firstDirection).replace('giù', 'giu');
      const normalizedSecond = normalizedInstruction(secondDirection).replace('giù', 'giu');
      if (opposite.has(`${normalizedFirst}:${normalizedSecond}`)) {
        const preposition = firstPreposition ? `${firstPreposition} ` : '';
        const nextPreposition = secondPreposition ? `${secondPreposition} ` : preposition;
        result.push(`${prefix}${preposition}${firstDirection}`.trim(), `${prefix}${nextPreposition}${secondDirection}${suffix}`.trim());
        continue;
      }
    }
    const actionParts = clause.split(new RegExp(`\\s+e\\s+(?=(?:(?:il|la)\\s+(?:personaggio|camera)\\s+)?(?:si\\s+)?${sequenceVerbs}\\b)`, 'iu')).filter(Boolean);
    result.push(...actionParts.map((part) => part.trim()));
  }
  return result.slice(0, 8);
}

/** Combines consecutive compiled actions into one conflict-free plan for a single apply. */
export function mergeJevSequencePlans(plans: JevActionPlan[], instruction: string): JevActionPlan {
  if (!plans.length) throw new Error('La sequenza non contiene azioni compilate.');
  if (plans.length === 1) return JevActionPlanSchema.parse({ ...plans[0], instruction });
  const operations = new Map<string, BlenderPlan['operations'][number]>();
  plans.forEach((plan) => plan.blenderPlan.operations.forEach((operation) => {
    operations.set(`${operation.type}:${operation.objectId}:${operation.frame}:${operation.property}`, operation);
  }));
  const first = plans[0]!;
  const last = plans.at(-1)!;
  const engineLabel = first.blenderPlan.summary.split(' · ')[0] ?? 'Jev';
  const combinedOperations = [...operations.values()];
  return JevActionPlanSchema.parse({
    ...last,
    instruction,
    objectId: first.objectId,
    confidence: Math.min(...plans.map((plan) => plan.confidence)),
    status: plans.every((plan) => plan.status === 'ready') && combinedOperations.length ? 'ready' : 'review',
    blenderPlan: {
      schemaVersion: 'BlenderPlanV1',
      summary: `${engineLabel} · Sequenza di ${plans.length} azioni: ${instruction}`,
      assumptions: [...new Set(plans.flatMap((plan) => plan.blenderPlan.assumptions))],
      warnings: [...new Set(plans.flatMap((plan) => plan.blenderPlan.warnings))],
      operations: combinedOperations,
    },
  });
}

const normalizeVector = (vector: Vec3, fallback: Vec3): Vec3 => {
  const length = Math.hypot(...vector);
  return length < .0001 ? fallback : vector.map((entry) => entry / length) as Vec3;
};
const sameVector = (a: Vec3, b: Vec3) => a.every((entry, index) => Math.abs(entry - b[index]) < .0001);

function strokeProjection(gesture: JevActionInput['gesture'] | undefined, reference: Vec3) {
  if (!gesture?.viewPosition || !gesture.verticalFovDegrees || !gesture.aspect) return undefined;
  const depth = Math.hypot(
    gesture.viewPosition[0] - reference[0],
    gesture.viewPosition[1] - reference[1],
    gesture.viewPosition[2] - reference[2],
  );
  const verticalSpan = THREE.MathUtils.clamp(2 * depth * Math.tan(THREE.MathUtils.degToRad(gesture.verticalFovDegrees) / 2), .25, 200);
  return { horizontalSpan: verticalSpan * gesture.aspect, verticalSpan };
}

function pointSegmentDistance(point: [number, number], start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = THREE.MathUtils.clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator, 0, 1);
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t));
}

function simplifyStroke(points: [number, number][], maxPoints: number) {
  const retained = points.reduce<Array<{ point: [number, number]; index: number }>>((result, point, index) => {
    const previous = result.at(-1)?.point;
    if (!previous || index === points.length - 1 || Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= .004) result.push({ point, index });
    return result;
  }, []);
  const rdp = (tolerance: number) => {
    const keep = new Set([0, retained.length - 1]);
    const visit = (startIndex: number, endIndex: number) => {
      let furthest = -1, furthestDistance = tolerance;
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const distance = pointSegmentDistance(retained[index]!.point, retained[startIndex]!.point, retained[endIndex]!.point);
        if (distance > furthestDistance) { furthest = index; furthestDistance = distance; }
      }
      if (furthest < 0) return;
      keep.add(furthest);
      visit(startIndex, furthest);
      visit(furthest, endIndex);
    };
    visit(0, retained.length - 1);
    return [...keep].sort((a, b) => a - b).map((index) => retained[index]!);
  };
  let simplified = rdp(.008);
  if (simplified.length <= maxPoints) return simplified;
  let low = .008, high = 1;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const middle = (low + high) / 2;
    const candidate = rdp(middle);
    if (candidate.length > maxPoints) low = middle;
    else { high = middle; simplified = candidate; }
  }
  return simplified;
}

function strokeTrajectory(points: [number, number][], origin: Vec3, horizontal: Vec3, vertical: Vec3, distance: number, maxPoints = 12, projection?: { horizontalSpan: number; verticalSpan: number }) {
  const samples = simplifyStroke(points, Math.min(maxPoints, points.length));
  const first = samples[0]!.point;
  const rawOffsets = samples.map(({ point: [x, y] }) => add(
    scale(horizontal, (x - first[0]) * (projection?.horizontalSpan ?? 1)),
    scale(vertical, (first[1] - y) * (projection?.verticalSpan ?? 1)),
  ));
  const extent = Math.max(.0001, ...rawOffsets.map((offset) => Math.hypot(...offset)));
  const cumulativeLengths = points.map((point, index) => index ? Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]) : 0);
  for (let index = 1; index < cumulativeLengths.length; index += 1) cumulativeLengths[index] += cumulativeLengths[index - 1]!;
  const firstLength = cumulativeLengths[samples[0]!.index] ?? 0;
  const total = Math.max(.0001, (cumulativeLengths[samples.at(-1)!.index] ?? firstLength) - firstLength);
  return rawOffsets.map((offset, index) => {
    const elapsed = (cumulativeLengths[samples[index]!.index] ?? firstLength) - firstLength;
    return { position: add(origin, projection ? offset : scale(offset, distance / extent)), progress: index ? elapsed / total : 0 };
  });
}

function normalizedInstruction(instruction: string) {
  return instruction.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function searchableText(value: string) {
  return normalizedInstruction(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function resolveCameraFocusObject(project: AbacoProject, sceneId: string, frame: number, instruction: string, fallbackTarget?: Vec3) {
  const text = searchableText(instruction);
  const genericReference = /\b(personaggi\w*|soggett\w*|protagonist\w*|character\w*|element\w*)\b/.test(text);
  const candidates = project.objects.filter((candidate) => candidate.kind !== 'camera'
    && candidate.kind !== 'audio'
    && !candidate.kind.includes('light')
    && !candidate.screenSpace
    && (!candidate.sceneIds.length || candidate.sceneIds.includes(sceneId))
    && evaluateProperty(candidate, 'visibility', frame) === true);
  const scored = candidates.map((candidate) => {
    const name = searchableText(candidate.name);
    const tokens = name.split(' ').filter((token) => token.length >= 4);
    const exact = name.length >= 3 && text.includes(name) ? 100 : 0;
    const tokenScore = tokens.filter((token) => text.includes(token)).length * 10;
    const distance = fallbackTarget ? new THREE.Vector3(...evaluateTransform(candidate, frame).position).distanceTo(new THREE.Vector3(...fallbackTarget)) : 0;
    return { candidate, score: exact + tokenScore, distance };
  }).filter((entry) => entry.score > 0 || genericReference);
  return scored.sort((a, b) => b.score - a.score || a.distance - b.distance)[0]?.candidate;
}

function closedStroke(points: [number, number][] | undefined) {
  if (!points || points.length < 6) return false;
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const closure = Math.hypot(points[0]![0] - points.at(-1)![0], points[0]![1] - points.at(-1)![1]);
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  return diagonal > .08 && closure <= diagonal * .3 && length >= diagonal * 2;
}

function drawnOrbitDirection(points: [number, number][] | undefined): 'orbit_left' | 'orbit_right' {
  if (!points || points.length < 3) return 'orbit_right';
  let signedArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!, next = points[(index + 1) % points.length]!;
    signedArea += current[0] * next[1] - next[0] * current[1];
  }
  return signedArea >= 0 ? 'orbit_right' : 'orbit_left';
}

function cameraOrbitTrajectory(position: Vec3, center: Vec3, direction: 'orbit_left' | 'orbit_right', fullCircle: boolean) {
  const offset = new THREE.Vector3(...position).sub(new THREE.Vector3(...center));
  const horizontalRadius = Math.hypot(offset.x, offset.y);
  if (horizontalRadius < .1) offset.x = Math.max(.1, Math.hypot(...offset.toArray()));
  const sweep = (fullCircle ? Math.PI * 2 : Math.PI / 2) * (direction === 'orbit_left' ? 1 : -1);
  const pointCount = fullCircle ? 9 : 4;
  return Array.from({ length: pointCount }, (_, index) => {
    const progress = index / (pointCount - 1);
    const point = offset.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), sweep * progress).add(new THREE.Vector3(...center));
    point.z = position[2];
    return { position: point.toArray() as Vec3, progress };
  });
}

function explicitCameraMotion(instruction: string, selectedCamera = false) {
  const text = normalizedInstruction(instruction);
  const patterns: [string, RegExp][] = [
    ['follow_subject', /(?:camera|telecamera)[^.!?]{0,32}(?:segue|insegue|accompagna)/],
    ['orbit_left', /(?:camera|telecamera)[^.!?]{0,32}(?:orbita|gira)[^.!?]{0,20}(?:sinistra|antiorari)/],
    ['orbit_right', /(?:camera|telecamera)[^.!?]{0,32}(?:orbita|gira)[^.!?]{0,20}(?:destra|orari)/],
    ['orbit_right', /(?:camera|telecamera)?[^.!?]{0,16}(?:orbita|gira)[^.!?]{0,24}(?:attorno|intorno)/],
    ['pan_left', /(?:panoramica|pan|sguardo)[^.!?]{0,20}(?:sinistra)/],
    ['pan_right', /(?:panoramica|pan|sguardo)[^.!?]{0,20}(?:destra)/],
    ['pan_left', /(?:camera|telecamera)[^.!?]{0,32}(?:gira|ruota|volta|orienta)[^.!?]{0,16}(?:sinistra)/],
    ['pan_right', /(?:camera|telecamera)[^.!?]{0,32}(?:gira|ruota|volta|orienta)[^.!?]{0,16}(?:destra)/],
    ['tilt_up', /(?:camera|telecamera|inquadratura)[^.!?]{0,32}(?:inclina|guarda|punta)[^.!?]{0,16}(?:alto|su)/],
    ['tilt_down', /(?:camera|telecamera|inquadratura)[^.!?]{0,32}(?:inclina|guarda|punta)[^.!?]{0,16}(?:basso|giu)/],
    ['push_in', /(?:camera|telecamera)[^.!?]{0,32}(?:avanza|si avvicina|stringe|entra)|(?:push[ -]?in|dolly[ -]?in)/],
    ['pull_out', /(?:camera|telecamera)[^.!?]{0,32}(?:arretra|si allontana|allarga|esce)|(?:pull[ -]?out|dolly[ -]?out)/],
    ['truck_left', /(?:camera|telecamera)[^.!?]{0,32}(?:va|muove|sposta|trasla|scorre|carrella)[^.!?]{0,16}(?:sinistra)/],
    ['truck_right', /(?:camera|telecamera)[^.!?]{0,32}(?:va|muove|sposta|trasla|scorre|carrella)[^.!?]{0,16}(?:destra)/],
    ['rise', /(?:camera|telecamera)[^.!?]{0,32}(?:sale|si alza|solleva)/],
    ['descend', /(?:camera|telecamera)[^.!?]{0,32}(?:scende|si abbassa)/],
  ];
  const named = patterns.find(([, pattern]) => pattern.test(text))?.[0];
  if (named || !selectedCamera) return named;
  const selectedPatterns: [string, RegExp][] = [
    ['follow_subject', /\b(?:segue|insegue|accompagna)\b/],
    ['orbit_left', /(?:orbita|gira)[^.!?]{0,24}(?:attorno|intorno)[^.!?]{0,24}(?:sinistra|antiorari)/],
    ['orbit_right', /(?:orbita|gira)[^.!?]{0,24}(?:attorno|intorno)/],
    ['pan_left', /(?:gira|ruota|volta|orienta)[^.!?]{0,18}\bsinistra\b/],
    ['pan_right', /(?:gira|ruota|volta|orienta)[^.!?]{0,18}\bdestra\b/],
    ['push_in', /\b(?:avanza|avvicina\w*|stringe|entra)\b/],
    ['pull_out', /\b(?:arretra|allontana\w*|allarga|esce)\b/],
    ['truck_left', /(?:va|muov\w*|dirig\w*|scivol\w*|trasla|scorre|carrella|sposta\w*)[^.!?]{0,18}\bsinistra\b/],
    ['truck_right', /(?:va|muov\w*|dirig\w*|scivol\w*|trasla|scorre|carrella|sposta\w*)[^.!?]{0,18}\bdestra\b/],
    ['rise', /\b(?:sale|sali|alza\w*|solleva\w*)\b/],
    ['descend', /\b(?:scende|scendi|abbassa\w*)\b/],
  ];
  return selectedPatterns.find(([, pattern]) => pattern.test(text))?.[0];
}

function rotationToward(position: Vec3, target: Vec3): Vec3 {
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...target));
  return [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((entry) => THREE.MathUtils.radToDeg(entry)) as Vec3;
}

function unwrapRotation(previous: Vec3 | undefined, rotation: Vec3): Vec3 {
  if (!previous) return rotation;
  return rotation.map((value, axis) => {
    let next = value;
    while (next - previous[axis] > 180) next -= 360;
    while (next - previous[axis] < -180) next += 360;
    return next;
  }) as Vec3;
}

type AxisIntent = { translation: [number | undefined, number | undefined, number | undefined]; rotation: [number | undefined, number | undefined, number | undefined] };

function explicitAxisIntent(instruction: string, cameraOnly: boolean): AxisIntent {
  const complete = normalizedInstruction(instruction);
  const clauses = complete.split(/\bmentre\b|[.;]/).map((entry) => entry.trim()).filter(Boolean);
  const scoped = cameraOnly ? clauses.filter((entry) => /camera|telecamera|inquadratur|ripresa/.test(entry)) : clauses.filter((entry) => !/camera|telecamera|inquadratur|ripresa/.test(entry));
  const text = scoped.length ? scoped.join(' ') : complete;
  const movingRight = /(?:va|vai|muov\w*|spost\w*|dirig\w*|scivol\w*|trasl\w*|corr\w*|cammin\w*|marci\w*|scorr\w*|carrell\w*)[^.!?]{0,24}\bdestra\b|\bdestra\b[^.!?]{0,24}(?:va|vai|muov\w*|spost\w*|dirig\w*|scivol\w*|trasl\w*|corr\w*|cammin\w*)/.test(text);
  const movingLeft = /(?:va|vai|muov\w*|spost\w*|dirig\w*|scivol\w*|trasl\w*|corr\w*|cammin\w*|marci\w*|scorr\w*|carrell\w*)[^.!?]{0,24}\bsinistra\b|\bsinistra\b[^.!?]{0,24}(?:va|vai|muov\w*|spost\w*|dirig\w*|scivol\w*|trasl\w*|corr\w*|cammin\w*)/.test(text);
  const yawRight = /(?:gira|ruota|volta|orienta|pivot|yaw)[^.!?]{0,20}\bdestra\b|\bdestra\b[^.!?]{0,20}(?:gira|ruota|volta|orienta|pivot|yaw)/.test(text);
  const yawLeft = /(?:gira|ruota|volta|orienta|pivot|yaw)[^.!?]{0,20}\bsinistra\b|\bsinistra\b[^.!?]{0,20}(?:gira|ruota|volta|orienta|pivot|yaw)/.test(text);
  const pitchUp = /(?:pitch|guarda|sguardo|testa|inclina|punta|orienta)[^.!?]{0,20}(?:verso\s+)?(?:l alto|alto|su)\b/.test(text);
  const pitchDown = /(?:pitch|guarda|sguardo|testa|inclina|punta|orienta)[^.!?]{0,20}(?:verso\s+)?(?:il\s+)?(?:basso|giu)\b/.test(text);
  const rollRight = /(?:roll|inclina|piega)[^.!?]{0,24}(?:lato\s+)?destro\b/.test(text);
  const rollLeft = /(?:roll|inclina|piega)[^.!?]{0,24}(?:lato\s+)?sinistro\b/.test(text);
  return {
    translation: [
      /\b(?:avanti|avanza|prosegue|procede|entra)\b/.test(text) ? 1 : /\b(?:indietro|arretra|retrocede|indietreggia|indietreggiare)\b/.test(text) ? -1 : undefined,
      movingRight ? 1 : movingLeft ? -1 : undefined,
      /\b(?:sale|sali|salire|alza|solleva|ascende|decolla|vola)\b/.test(text) ? 1 : /\b(?:scende|scendi|scendere|abbassa|cade|precipita|atterra)\b/.test(text) ? -1 : undefined,
    ],
    rotation: [rollRight ? 1 : rollLeft ? -1 : undefined, pitchUp ? 1 : pitchDown ? -1 : undefined, yawRight ? 1 : yawLeft ? -1 : undefined],
  };
}

type NaturalMotionIntent = { axes: AxisIntent; action?: string; direction?: string };

function naturalMotionIntent(instruction: string, cameraOnly: boolean): NaturalMotionIntent {
  const text = normalizedInstruction(instruction);
  const axes = explicitAxisIntent(instruction, cameraOnly);
  if (/\b(?:resta|rimani|fermo|immobile|stop|non\s+(?:muover|spostar|girar))\w*\b/.test(text)) return { axes, action: 'hold' };
  const jumping = /\b(?:salta|saltare|balza|balzare)\w*\b/.test(text);
  const genericTurn = /\b(?:gira|girare|ruota|ruotare|volta|voltarsi|orienta|orientarsi|pivot)\w*\b/.test(text);
  if (!axes.rotation.some((value) => value !== undefined) && genericTurn) axes.rotation[2] = 1;
  const turning = axes.rotation.some((value) => value !== undefined);
  const translating = axes.translation.some((value) => value !== undefined);
  const genericMove = /\b(?:cammina|camminare|corre|correre|marcia|marciare|procede|procedere|avanza|avanzare|muove|muoversi|sposta|spostarsi|dirige|dirigersi|scivola|scivolare|passo)\w*\b/.test(text);
  if (!translating && genericMove && !turning) axes.translation[0] = 1;
  const radialDirection = explicitCameraDirection(instruction);
  const direction = radialDirection ?? (axes.translation[1] === 1 || axes.rotation[2] === 1 ? 'right'
    : axes.translation[1] === -1 || axes.rotation[2] === -1 ? 'left'
      : axes.translation[2] === 1 ? 'up' : axes.translation[2] === -1 ? 'down'
        : axes.translation[0] === -1 ? 'backward' : axes.translation[0] === 1 ? 'forward' : jumping ? 'up' : undefined);
  const action = jumping ? 'jump' : radialDirection ? 'move' : turning && !axes.translation.some((value) => value !== undefined) ? 'turn'
    : axes.translation[2] === 1 && axes.translation[0] === undefined && axes.translation[1] === undefined ? 'rise'
      : axes.translation[2] === -1 && axes.translation[0] === undefined && axes.translation[1] === undefined ? 'descend'
        : axes.translation.some((value) => value !== undefined) ? 'move' : undefined;
  return { axes, action, direction };
}

function answerAxis(answer: JevActionResponse['answers']['translate_x'], explicit: number | undefined) {
  if (explicit !== undefined) return explicit;
  if (!answer || answer.confidence < .62) return 0;
  return answer.choice === 'increase' ? 1 : answer.choice === 'decrease' ? -1 : 0;
}

function answerBinaryAxis(
  positive: JevActionResponse['answers']['translate_x_positive'],
  negative: JevActionResponse['answers']['translate_x_negative'],
  legacy: JevActionResponse['answers']['translate_x'],
  explicit: number | undefined,
) {
  if (explicit !== undefined) return explicit;
  if (!positive && !negative) return answerAxis(legacy, undefined);
  const positiveScore = positive?.noul ?? 0;
  const negativeScore = negative?.noul ?? 0;
  const strongest = Math.max(positiveScore, negativeScore);
  if (strongest < .62 || Math.abs(positiveScore - negativeScore) < .15) return 0;
  return positiveScore > negativeScore ? 1 : -1;
}

function binaryAxisConflict(
  positive: JevActionResponse['answers']['translate_x_positive'],
  negative: JevActionResponse['answers']['translate_x_negative'],
) {
  if (!positive || !negative) return false;
  return positive.noul >= .62 && negative.noul >= .62 && Math.abs(positive.noul - negative.noul) < .15;
}

function explicitMeasurement(instruction: string, unit: 'distance' | 'duration' | 'rotation') {
  const text = normalizedInstruction(instruction);
  const pattern = unit === 'distance' ? /(\d+(?:[.,]\d+)?)\s*(centimetr\w*|cm|metr\w*|m)\b/
    : unit === 'duration' ? /(\d+(?:[.,]\d+)?)\s*(second\w*|sec|s)\b/
      : /(\d+(?:[.,]\d+)?)\s*(grad\w*|°)\b/;
  const match = text.match(pattern);
  if (!match) return undefined;
  const amount = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return unit === 'distance' && /^(?:centimetr|cm)/.test(match[2]!) ? amount / 100 : amount;
}

export function compileJevAction(project: AbacoProject, object: SceneObject | undefined, input: Omit<JevActionInput, 'project'>, raw: JevActionResponse): JevActionPlan {
  const response = JevActionResponseSchema.parse(raw);
  const engineLabel = input.engine === 'laya' ? 'Laya' : 'Jev';
  const { answers } = response;
  const cameraOnly = input.target === 'camera';
  const distance = explicitMeasurement(input.instruction, 'distance') ?? nearestLevel(answers.distance.score, distances);
  const duration = explicitMeasurement(input.instruction, 'duration') ?? nearestLevel(answers.duration.score, durations);
  const rotationAmount = explicitMeasurement(input.instruction, 'rotation') ?? [10, 20, 45, 90, 180][Math.max(0, Math.min(4, Math.round(answers.rotation_amount?.score ?? answers.distance.score)))]!;
  const naturalIntent = naturalMotionIntent(input.instruction, cameraOnly);
  const explicitAxes = naturalIntent.axes;
  const translationAxes: Vec3 = [
    answerBinaryAxis(answers.translate_x_positive, answers.translate_x_negative, answers.translate_x, explicitAxes.translation[0]),
    answerBinaryAxis(answers.translate_y_positive, answers.translate_y_negative, answers.translate_y, explicitAxes.translation[1]),
    answerBinaryAxis(answers.translate_z_positive, answers.translate_z_negative, answers.translate_z, explicitAxes.translation[2]),
  ];
  const rotationAxes: Vec3 = [
    answerBinaryAxis(answers.rotate_x_positive, answers.rotate_x_negative, answers.rotate_x, explicitAxes.rotation[0]),
    answerBinaryAxis(answers.rotate_y_positive, answers.rotate_y_negative, answers.rotate_y, explicitAxes.rotation[1]),
    answerBinaryAxis(answers.rotate_z_positive, answers.rotate_z_negative, answers.rotate_z, explicitAxes.rotation[2]),
  ];
  const hasAxisConflict = [
    [answers.translate_x_positive, answers.translate_x_negative],
    [answers.translate_y_positive, answers.translate_y_negative],
    [answers.translate_z_positive, answers.translate_z_negative],
    [answers.rotate_x_positive, answers.rotate_x_negative],
    [answers.rotate_y_positive, answers.rotate_y_negative],
    [answers.rotate_z_positive, answers.rotate_z_negative],
  ].some(([positive, negative]) => binaryAxisConflict(positive, negative));
  const hasAxisTranslation = translationAxes.some((entry) => entry !== 0);
  const hasAxisRotation = rotationAxes.some((entry) => entry !== 0);
  const drawnFullOrbit = closedStroke(input.gesture?.points) && /(?:gira\w*|ruota\w*|orbit\w*)[^.!?]{0,30}(?:attorno|intorno)|(?:attorno|intorno)[^.!?]{0,30}(?:personaggi|soggett|element)/.test(normalizedInstruction(input.instruction));
  const explicitCameraAction = explicitCameraMotion(input.instruction, cameraOnly) ?? (drawnFullOrbit ? drawnOrbitDirection(input.gesture?.points) : undefined);
  const cameraAction = explicitCameraAction ?? answers.camera_action?.choice ?? 'hold';
  const gestureTarget = input.gesture ? (cameraOnly ? 'camera' : 'subject') : undefined;
  const cameraRequested = cameraOnly;
  const subjectConfidences = object ? [answers.action.confidence, answers.direction.confidence, answers.distance.confidence, answers.duration.confidence, answers.energy.confidence, answers.path.confidence] : [];
  const cameraConfidences = cameraRequested ? [answers.camera_action?.confidence, answers.camera_distance?.confidence, answers.camera_duration?.confidence, answers.camera_path?.confidence].filter((entry): entry is number => entry !== undefined) : [];
  const confidences = [...subjectConfidences, ...cameraConfidences];
  const modelConfidence = Math.min(...(confidences.length ? confidences : [0]));
  const confidence = input.engine === 'laya' && naturalIntent.action ? Math.max(.9, modelConfidence) : modelConfidence;
  const cameraIntent = explicitCameraDirection(input.instruction);
  const directionChoice = cameraIntent ?? naturalIntent.direction ?? answers.direction.choice;
  const startPosition = input.startPosition ?? (object ? evaluateTransform(object, input.frame).position : [0, 0, 0]);
  const directions: Record<string, Vec3> = { ...cameraRelativeDirections(project, input.sceneId, input.frame), ...radialCameraDirections(project, input.sceneId, input.frame, startPosition) };
  const drawnBasis = input.gesture?.viewRotation ? cameraBasis(input.gesture.viewRotation).map((axis) => axis.toArray() as Vec3) : undefined;
  const drawnRight = drawnBasis ? normalizeGround(drawnBasis[0]!, directions.right!) : directions.right!;
  const drawnForward = drawnBasis ? normalizeGround(drawnBasis[1]!, directions.forward!) : directions.forward!;
  const drawnUp = drawnBasis ? normalizeVector(drawnBasis[2]!, [0, 0, 1]) : [0, 0, 1] as Vec3;
  const direction = directions[directionChoice] ?? directions.forward;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === input.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  const endFrame = Math.min(sceneEnd, input.frame + Math.max(1, Math.round(duration * project.settings.fps)));
  const interpolation = answers.path.choice === 'direct' ? 'linear' : 'bezier';
  let endPosition = startPosition;
  const objectTransform = object ? evaluateTransform(object, input.frame) : undefined;
  let endRotation = objectTransform?.rotation ?? [0, 0, 0];
  let action = object ? (naturalIntent.action ?? (gestureTarget === 'subject' ? (['jump', 'rise', 'descend'].includes(answers.action.choice) ? answers.action.choice : 'move') : cameraIntent && answers.action.choice !== 'jump' ? 'move' : answers.action.choice)) : 'hold';
  if (object && hasAxisTranslation && action !== 'jump') action = translationAxes[2] !== 0 && translationAxes[0] === 0 && translationAxes[1] === 0 ? (translationAxes[2] > 0 ? 'rise' : 'descend') : 'move';
  if (object && hasAxisRotation && !hasAxisTranslation && action !== 'jump') action = 'turn';
  if (object && ['move', 'rise', 'descend'].includes(action)) endPosition = add(startPosition, scale(hasAxisTranslation && !cameraIntent ? normalizeVector(translationAxes, direction) : direction, distance));
  if (object && hasAxisRotation) {
    endRotation = objectTransform!.rotation.map((value, axis) => value + rotationAxes[axis]! * rotationAmount) as Vec3;
  } else if (object && action === 'turn') {
    const amount = rotationAmount;
    endRotation = [objectTransform!.rotation[0], objectTransform!.rotation[1], objectTransform!.rotation[2] + (answers.direction.choice === 'left' ? -amount : amount)];
  }
  if (object && action === 'jump') {
    const horizontal: Vec3 = answers.direction.choice === 'up' || answers.direction.choice === 'down' ? [0, 0, 0] : scale(direction, distance);
    endPosition = add(startPosition, horizontal);
  }
  const strokeVertical: Vec3 = ['jump', 'rise', 'descend'].includes(action) ? drawnUp : drawnForward;
  const subjectStroke = object && gestureTarget === 'subject' && input.gesture ? strokeTrajectory(input.gesture.points, startPosition, drawnRight, strokeVertical, distance, Math.min(12, endFrame - input.frame + 1), strokeProjection(input.gesture, startPosition)) : undefined;
  if (subjectStroke?.length) endPosition = subjectStroke[subjectStroke.length - 1]!.position;
  const value = (vector: Vec3) => ({ vector, boolean: null, text: null, number: null });
  const operations: BlenderPlan['operations'] = [];
  if (subjectStroke) {
    let previousFrame = input.frame - 1;
    subjectStroke.forEach((point, index) => {
      const remaining = subjectStroke.length - 1 - index;
      const pointFrame = Math.max(previousFrame + 1, Math.min(endFrame - remaining, Math.round(input.frame + (endFrame - input.frame) * point.progress)));
      previousFrame = pointFrame;
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object!.id, frame: pointFrame, property: 'position', value: value(point.position), interpolation: 'bezier', rationale: index ? `Traiettoria disegnata sul canvas e interpretata da ${engineLabel}.` : 'Inizio della traiettoria disegnata.', commentIds: [] });
    });
  } else if (object && ['move', 'rise', 'descend', 'jump'].includes(action)) operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'position', value: value(startPosition), interpolation, rationale: `Posizione iniziale indicata per l’azione ${engineLabel}.`, commentIds: [] });
  if (!subjectStroke && object && action === 'jump') {
    const apexFrame = Math.max(input.frame + 1, Math.round((input.frame + endFrame) / 2));
    const midpoint = scale(add(startPosition, endPosition), .5);
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: apexFrame, property: 'position', value: value([midpoint[0], midpoint[1], Math.max(startPosition[2], endPosition[2]) + Math.max(.35, distance * .5)]), interpolation: 'bezier', rationale: `Apice del salto scelto da ${engineLabel}.`, commentIds: [] });
  }
  if (!subjectStroke && object && ['move', 'rise', 'descend', 'jump'].includes(action)) operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'position', value: value(endPosition), interpolation, rationale: `Azione ${action} compilata dalle decisioni ${engineLabel}.`, commentIds: [] });
  if (object && (action === 'turn' || hasAxisRotation)) {
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'rotation', value: value(objectTransform!.rotation), interpolation, rationale: 'Orientamento iniziale.', commentIds: [] });
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'rotation', value: value(endRotation), interpolation, rationale: `Rotazione scelta da ${engineLabel}.`, commentIds: [] });
  }

  const scene = scenes[sceneIndex];
  const cameraObject = cameraOnly
    ? project.objects.find((candidate) => candidate.id === input.objectId && candidate.kind === 'camera')
    : project.objects.find((candidate) => candidate.id === scene?.cameraId && candidate.kind === 'camera');
  const cameraFocusObject = cameraOnly && scene ? resolveCameraFocusObject(project, input.sceneId, input.frame, input.instruction, scene.framing.target) : object;
  const cameraDistance = explicitMeasurement(input.instruction, 'distance') ?? nearestLevel(answers.camera_distance?.score ?? answers.distance.score, distances);
  const cameraDuration = explicitMeasurement(input.instruction, 'duration') ?? nearestLevel(answers.camera_duration?.score ?? answers.duration.score, durations);
  const cameraInterpolation = answers.camera_path?.choice === 'direct' ? 'linear' : 'bezier';
  if (cameraRequested && cameraObject && scene) {
    const cameraTransform = evaluateTransform(cameraObject, input.frame);
    const cameraEndFrame = Math.min(sceneEnd, input.frame + Math.max(1, Math.round(cameraDuration * project.settings.fps)));
    const targetStart = object ? startPosition : cameraFocusObject ? evaluateTransform(cameraFocusObject, input.frame).position : cameraOnly ? scene.framing.target : cameraTarget(cameraTransform, scene.framing.distance);
    const targetEnd = object ? endPosition : cameraFocusObject ? evaluateTransform(cameraFocusObject, cameraEndFrame).position : targetStart;
    let cameraEndPosition = cameraTransform.position;
    let cameraEndRotation = cameraTransform.rotation;
    const towardTarget = normalizeVector([targetStart[0] - cameraTransform.position[0], targetStart[1] - cameraTransform.position[1], targetStart[2] - cameraTransform.position[2]], [0, 1, 0]);
    const screenRight = normalizeGround(cameraBasis(cameraTransform.rotation)[0].toArray() as Vec3, [1, 0, 0]);
    const atomicCameraDirection = normalizeVector(add(add(scale(towardTarget, translationAxes[0]), scale(screenRight, translationAxes[1])), [0, 0, translationAxes[2]]), towardTarget);
    if (cameraOnly && hasAxisTranslation && !['orbit_left', 'orbit_right', 'follow_subject'].includes(cameraAction)) cameraEndPosition = add(cameraTransform.position, scale(atomicCameraDirection, cameraDistance));
    else if (cameraAction === 'push_in') cameraEndPosition = add(cameraTransform.position, scale(towardTarget, Math.min(cameraDistance, Math.max(.1, Math.hypot(targetStart[0] - cameraTransform.position[0], targetStart[1] - cameraTransform.position[1], targetStart[2] - cameraTransform.position[2]) * .8))));
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
    if (cameraOnly && hasAxisRotation) cameraEndRotation = cameraTransform.rotation.map((value, axis) => value + rotationAxes[axis]! * rotationAmount) as Vec3;
    const cameraStroke = gestureTarget === 'camera' && input.gesture
      ? drawnFullOrbit && (cameraAction === 'orbit_left' || cameraAction === 'orbit_right')
        ? cameraOrbitTrajectory(cameraTransform.position, targetStart, cameraAction, true)
        : strokeTrajectory(input.gesture.points, cameraTransform.position, drawnRight, ['rise', 'descend'].includes(cameraAction) ? drawnUp : drawnForward, cameraDistance, Math.min(12, cameraEndFrame - input.frame + 1), strokeProjection(input.gesture, targetStart))
      : undefined;
    if (cameraStroke) {
      const targetDelta: Vec3 = [targetEnd[0] - targetStart[0], targetEnd[1] - targetStart[1], targetEnd[2] - targetStart[2]];
      const cameraPathKeys: Keyframe[] = [];
      let previousFrame = input.frame - 1;
      cameraStroke.forEach((point, index) => {
        const remaining = cameraStroke.length - 1 - index;
        const pointFrame = Math.max(previousFrame + 1, Math.min(cameraEndFrame - remaining, Math.round(input.frame + (cameraEndFrame - input.frame) * point.progress)));
        previousFrame = pointFrame;
        const pointTarget = cameraFocusObject ? evaluateTransform(cameraFocusObject, pointFrame).position : add(targetStart, scale(targetDelta, point.progress));
        operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: pointFrame, property: 'position', value: value(point.position), interpolation: 'bezier', rationale: index ? `Traiettoria camera disegnata sul canvas e interpretata da ${engineLabel}.` : 'Inizio della traiettoria camera disegnata.', commentIds: [] });
        cameraPathKeys.push({ id: crypto.randomUUID(), frame: pointFrame, property: 'position', value: point.position, interpolation: 'bezier', source: 'ai', purpose: 'motion', commentIds: [] });
        if (!cameraFocusObject) operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: pointFrame, property: 'rotation', value: value(rotationToward(point.position, pointTarget)), interpolation: 'bezier', rationale: 'La camera mantiene il soggetto di riferimento durante il tratto.', commentIds: [] });
      });
      if (cameraFocusObject) {
        const previewCamera = structuredClone(cameraObject);
        previewCamera.keyframes = previewCamera.keyframes.filter((key) => !(key.property === 'position' && key.frame >= input.frame && key.frame <= cameraEndFrame && key.source === 'ai' && key.purpose === 'motion' && key.commentIds.length === 0));
        previewCamera.keyframes.push(...cameraPathKeys);
        const segmentCount = Math.min(12, Math.max(3, cameraEndFrame - input.frame));
        const rotationFrames = [...new Set(Array.from({ length: segmentCount + 1 }, (_, index) => Math.round(input.frame + (cameraEndFrame - input.frame) * index / segmentCount)))];
        let previousRotation: Vec3 | undefined;
        rotationFrames.forEach((rotationFrame) => {
          const position = evaluateTransform(previewCamera, rotationFrame).position;
          const target = evaluateTransform(cameraFocusObject, rotationFrame).position;
          const rotation = unwrapRotation(previousRotation, rotationToward(position, target));
          previousRotation = rotation;
          operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: rotationFrame, property: 'rotation', value: value(rotation), interpolation: 'linear', rationale: `La camera mantiene ${cameraFocusObject.name} al centro dell’inquadratura.`, commentIds: [] });
        });
      }
    } else if (!sameVector(cameraTransform.position, cameraEndPosition)) {
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: input.frame, property: 'position', value: value(cameraTransform.position), interpolation: cameraInterpolation, rationale: `Posizione iniziale della camera per la regia ${engineLabel}.`, commentIds: [] });
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: cameraEndFrame, property: 'position', value: value(cameraEndPosition), interpolation: cameraInterpolation, rationale: `Movimento camera ${cameraAction} scelto da ${engineLabel}.`, commentIds: [] });
    }
    if (!cameraStroke && !sameVector(cameraTransform.rotation, cameraEndRotation)) {
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: input.frame, property: 'rotation', value: value(cameraTransform.rotation), interpolation: cameraInterpolation, rationale: `Orientamento iniziale della camera per la regia ${engineLabel}.`, commentIds: [] });
      operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: cameraObject.id, frame: cameraEndFrame, property: 'rotation', value: value(cameraEndRotation), interpolation: cameraInterpolation, rationale: `Orientamento camera ${cameraAction} scelto da ${engineLabel}.`, commentIds: [] });
    }
  }
  const actionable = object && naturalIntent.action && naturalIntent.action !== 'hold' ? Math.max(.9, answers.actionable.noul) : object ? answers.actionable.noul : 1;
  const warnings = confidence < .55 || actionable < .6 ? ['Decisione incerta: controllare il JSON e l’anteprima prima di applicare.'] : [];
  if (hasAxisConflict) warnings.push('Decisioni opposte sullo stesso asse: il movimento in conflitto è stato mantenuto fermo.');
  if (!operations.length) warnings.push('La descrizione non contiene un movimento applicabile al soggetto selezionato o alla camera.');
  const plan: BlenderPlan = { schemaVersion: 'BlenderPlanV1', summary: `${engineLabel} · Regia: ${input.instruction}`, assumptions: ['Le direzioni del soggetto sono relative alla camera attiva; i movimenti camera mantengono il soggetto selezionato come riferimento.'], warnings, operations };
  return JevActionPlanSchema.parse({
    schemaVersion: 'JevActionPlanV1', objectId: object?.id ?? null, instruction: input.instruction, model: response.model,
    status: confidence >= .55 && actionable >= .6 && operations.length ? 'ready' : 'review', confidence,
    decision: { action, direction: directionChoice, distanceMeters: distance, durationSeconds: duration, energy: answers.energy.score, path: answers.path.choice, actionable, camera: { requested: cameraRequested, action: cameraAction, distanceMeters: cameraDistance, durationSeconds: cameraDuration, path: answers.camera_path?.choice ?? 'smooth' }, gesture: gestureTarget && input.gesture ? { target: gestureTarget, points: input.gesture.points.length } : undefined },
    blenderPlan: plan,
  });
}
