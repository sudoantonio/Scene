import { z } from 'zod';
import * as THREE from 'three';
import { BlenderPlanSchema, type AbacoProject, type BlenderPlan, type Keyframe, type SceneObject, type Vec3 } from './schema';
import { applyPlan, evaluateProperty, evaluateTransform } from './animation';
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

export const SemanticMotionSchema = z.enum([
  'hold', 'move_forward', 'move_backward', 'move_left', 'move_right',
  'move_forward_left', 'move_forward_right', 'move_backward_left', 'move_backward_right',
  'move_up', 'move_down', 'jump_in_place', 'jump_forward',
  'turn_left', 'turn_right', 'look_up', 'look_down', 'roll_left', 'roll_right',
  'move_away_camera', 'move_toward_camera', 'move_toward_object', 'move_away_object', 'look_at_object', 'follow_drawn_path',
  'dolly_in', 'dolly_out', 'truck_left', 'truck_right', 'pedestal_up', 'pedestal_down',
  'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'orbit_left', 'orbit_right', 'follow_subject',
]);
export type SemanticMotion = z.infer<typeof SemanticMotionSchema>;

export const MotionFamilySchema = z.enum([
  'locomotion', 'vertical', 'orientation', 'pose',
  'camera_translation', 'camera_orientation', 'camera_orbit', 'path',
]);
export type MotionFamily = z.infer<typeof MotionFamilySchema>;

export const TemporalStructureSchema = z.enum(['single', 'sequential', 'simultaneous', 'mixed']);
export type TemporalStructure = z.infer<typeof TemporalStructureSchema>;

export const JevRoutingResponseSchema = z.object({
  model: z.string(),
  answers: z.object({
    temporal_structure: JevChoiceAnswerSchema.optional(),
    motion_family: JevChoiceAnswerSchema.optional(),
  }),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});
export type JevRoutingResponse = z.infer<typeof JevRoutingResponseSchema>;

export const JevActionResponseSchema = z.object({
  model: z.string(),
  answers: z.object({
    actionable: JevNoulAnswerSchema,
    motion: JevChoiceAnswerSchema.optional(),
    reference_object: JevChoiceAnswerSchema.optional(),
    action: JevChoiceAnswerSchema.optional(),
    direction: JevChoiceAnswerSchema.optional(),
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
  contextInstruction: z.string().optional(),
  directionPlanId: z.string().uuid().optional(),
  editActionId: z.string().uuid().optional(),
  referenceId: z.string().uuid().optional(),
  endFrame: z.number().int().positive().optional(),
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

const subjectMotionCriteria = {
  hold: 'Resta fermo.',
  move_forward: 'Avanza dentro la scena.',
  move_backward: 'Arretra.',
  move_left: 'Si sposta a sinistra nell’inquadratura.',
  move_right: 'Si sposta a destra nell’inquadratura.',
  move_forward_left: 'Avanza in diagonale verso sinistra.',
  move_forward_right: 'Avanza in diagonale verso destra.',
  move_backward_left: 'Arretra in diagonale verso sinistra.',
  move_backward_right: 'Arretra in diagonale verso destra.',
  move_up: 'Sale lungo Z.',
  move_down: 'Scende lungo Z.',
  jump_in_place: 'Salta e atterra nello stesso punto.',
  jump_forward: 'Salta avanzando.',
  turn_left: 'Gira su se stesso verso sinistra.',
  turn_right: 'Gira su se stesso verso destra.',
  look_up: 'Ruota il pitch verso l’alto.',
  look_down: 'Ruota il pitch verso il basso.',
  roll_left: 'Si inclina sul lato sinistro.',
  roll_right: 'Si inclina sul lato destro.',
  move_away_camera: 'Si allontana radialmente dalla camera attiva.',
  move_toward_camera: 'Si avvicina radialmente alla camera attiva.',
  move_toward_object: 'Si muove verso un elemento nominato nella scena.',
  move_away_object: 'Si allontana da un elemento nominato nella scena.',
  look_at_object: 'Si orienta per guardare un elemento nominato nella scena.',
  follow_drawn_path: 'Segue il tratto disegnato; sceglilo solo quando il tratto è presente.',
};

const cameraMotionCriteria = {
  hold: 'La camera resta ferma.',
  dolly_in: 'La camera avanza verso il soggetto e stringe l’inquadratura.',
  dolly_out: 'La camera arretra dal soggetto e allarga l’inquadratura.',
  truck_left: 'La camera trasla verso sinistra mantenendo il soggetto in quadro.',
  truck_right: 'La camera trasla verso destra mantenendo il soggetto in quadro.',
  pedestal_up: 'La camera sale.',
  pedestal_down: 'La camera scende.',
  pan_left: 'La camera ruota o sposta lo sguardo verso sinistra dalla posizione attuale.',
  pan_right: 'La camera ruota o sposta lo sguardo verso destra dalla posizione attuale.',
  tilt_up: 'La camera inclina lo sguardo verso l’alto.',
  tilt_down: 'La camera inclina lo sguardo verso il basso.',
  roll_left: 'La camera ruota sul proprio asse verso sinistra.',
  roll_right: 'La camera ruota sul proprio asse verso destra.',
  orbit_left: 'La camera orbita attorno al soggetto verso sinistra.',
  orbit_right: 'La camera orbita attorno al soggetto verso destra.',
  follow_subject: 'La camera segue lo spostamento del soggetto mantenendo la distanza.',
  follow_drawn_path: 'La camera segue il tratto disegnato; sceglilo solo quando il tratto è presente.',
};

const subjectFamilyCriteria = {
  locomotion: 'Spostamento orizzontale, diagonale, verso la camera o lontano dalla camera.',
  vertical: 'Salita, discesa o salto.',
  orientation: 'Rotazione, sguardo o inclinazione senza spostamento principale.',
  path: 'Movimento che deve seguire un tratto disegnato.',
  pose: 'Il soggetto resta fermo o mantiene una posa.',
};

const cameraFamilyCriteria = {
  camera_translation: 'Dolly, truck o movimento verticale della camera.',
  camera_orientation: 'Pan, tilt o roll dalla posizione corrente.',
  camera_orbit: 'Orbita attorno a un soggetto o inseguimento del soggetto.',
  path: 'La camera deve seguire il tratto disegnato.',
  pose: 'La camera resta ferma.',
};

const familyMotions: Record<MotionFamily, SemanticMotion[]> = {
  locomotion: ['move_forward', 'move_backward', 'move_left', 'move_right', 'move_forward_left', 'move_forward_right', 'move_backward_left', 'move_backward_right', 'move_away_camera', 'move_toward_camera', 'move_toward_object', 'move_away_object'],
  vertical: ['move_up', 'move_down', 'jump_in_place', 'jump_forward'],
  orientation: ['turn_left', 'turn_right', 'look_up', 'look_down', 'roll_left', 'roll_right', 'look_at_object'],
  pose: ['hold'],
  camera_translation: ['dolly_in', 'dolly_out', 'truck_left', 'truck_right', 'pedestal_up', 'pedestal_down'],
  camera_orientation: ['pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'roll_left', 'roll_right'],
  camera_orbit: ['orbit_left', 'orbit_right', 'follow_subject'],
  path: ['follow_drawn_path'],
};

function motionFamily(motion: SemanticMotion | undefined, cameraOnly: boolean): MotionFamily | undefined {
  if (!motion) return undefined;
  if (motion === 'follow_drawn_path') return 'path';
  if (motion === 'hold') return 'pose';
  const families = cameraOnly
    ? (['camera_translation', 'camera_orientation', 'camera_orbit'] as const)
    : (['locomotion', 'vertical', 'orientation'] as const);
  return families.find((family) => familyMotions[family].includes(motion));
}

function criteriaForFamily(family: MotionFamily | undefined, cameraOnly: boolean) {
  const source = cameraOnly ? cameraMotionCriteria : subjectMotionCriteria;
  const allowed = family ? familyMotions[family] : Object.keys(source) as SemanticMotion[];
  const entries = allowed.filter((motion) => motion in source).map((motion) => [motion, source[motion as keyof typeof source]]);
  return Object.fromEntries(entries) as Partial<Record<SemanticMotion, string>>;
}

export function resolveMotionFamily(input: Pick<JevActionInput, 'instruction' | 'target' | 'gesture'>, predicted?: string): MotionFamily {
  const cameraOnly = input.target === 'camera';
  const local = motionFamily(naturalMotionPrimitive(input.instruction, cameraOnly, input.gesture), cameraOnly);
  if (local) return local;
  const parsed = MotionFamilySchema.safeParse(predicted);
  const allowed = cameraOnly ? cameraFamilyCriteria : subjectFamilyCriteria;
  if (parsed.success && parsed.data in allowed) return parsed.data;
  return input.gesture ? 'path' : cameraOnly ? 'camera_translation' : 'locomotion';
}

const semanticMotionLabels: Record<SemanticMotion, string> = {
  hold: 'resta fermo', move_forward: 'avanza', move_backward: 'arretra', move_left: 'va a sinistra', move_right: 'va a destra',
  move_forward_left: 'avanza a sinistra', move_forward_right: 'avanza a destra', move_backward_left: 'arretra a sinistra', move_backward_right: 'arretra a destra',
  move_up: 'sale', move_down: 'scende', jump_in_place: 'salta sul posto', jump_forward: 'salta in avanti', turn_left: 'gira a sinistra', turn_right: 'gira a destra',
  look_up: 'guarda in alto', look_down: 'guarda in basso', roll_left: 'si inclina a sinistra', roll_right: 'si inclina a destra',
  move_away_camera: 'si allontana dalla camera', move_toward_camera: 'si avvicina alla camera', follow_drawn_path: 'segue il tratto',
  move_toward_object: 'va verso', move_away_object: 'si allontana da', look_at_object: 'guarda',
  dolly_in: 'camera avanti', dolly_out: 'camera indietro', truck_left: 'camera a sinistra', truck_right: 'camera a destra', pedestal_up: 'camera sale', pedestal_down: 'camera scende',
  pan_left: 'pan a sinistra', pan_right: 'pan a destra', tilt_up: 'tilt in alto', tilt_down: 'tilt in basso', orbit_left: 'orbita a sinistra', orbit_right: 'orbita a destra', follow_subject: 'segue il soggetto',
};

export function semanticMotionLabel(motion: string) {
  const parsed = SemanticMotionSchema.safeParse(motion);
  return parsed.success ? semanticMotionLabels[parsed.data] : motion.replaceAll('_', ' ');
}

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

export function jevActionRequest(project: AbacoProject, object: SceneObject | undefined, input: Omit<JevActionInput, 'project'>, family?: MotionFamily) {
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
  const normalizedText = normalizedInstruction(input.instruction);
  const referenceObjects = project.objects.filter((candidate) => candidate.id !== input.objectId
    && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace
    && (!candidate.sceneIds.length || candidate.sceneIds.includes(input.sceneId)))
    .sort((a, b) => Number(normalizedText.includes(normalizedInstruction(b.name))) - Number(normalizedText.includes(normalizedInstruction(a.name))))
    .slice(0, 18);
  const referenceCriteria = Object.fromEntries([
    ...referenceObjects.map((candidate) => [candidate.id, `${candidate.name}, ${candidate.kind}, posizione ${evaluateTransform(candidate, input.frame).position.join(', ')}`]),
    ['none', 'Nessun elemento specifico è il riferimento dell’azione.'],
  ]);
  const standardContent = project.animationStandard?.content ?? '';
  const naturalIntent = naturalMotionIntent(input.instruction, input.target === 'camera');
  const naturalMotion = naturalMotionPrimitive(input.instruction, input.target === 'camera', input.gesture);
  const naturalFamily = motionFamily(naturalMotion, input.target === 'camera');
  return {
    model: 'jev-latest',
    state: {
      application: 'Scene di ABACO, editor di animatic 3D',
      selected_target: selectedTarget ? { id: selectedTarget.id, name: selectedTarget.name, kind: selectedTarget.kind, role: input.target === 'camera' ? 'camera' : 'subject' } : null,
      camera_focus_target: focusObject ? { id: focusObject.id, name: focusObject.name, position: evaluateTransform(focusObject, input.frame).position } : null,
      selected_subject: object ? { id: object.id, name: object.name, kind: object.kind } : null,
      available_subjects: project.objects.filter((candidate) => candidate.kind !== 'camera' && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace).map((candidate) => ({ id: candidate.id, name: candidate.name, kind: candidate.kind })),
      available_reference_objects: referenceObjects.map((candidate) => ({ id: candidate.id, name: candidate.name, kind: candidate.kind, position: evaluateTransform(candidate, input.frame).position })),
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
      context_instruction: input.contextInstruction,
      natural_language_hints: { family: naturalFamily ?? null, motion: naturalMotion ?? null, action: naturalIntent.action ?? null, direction: naturalIntent.direction ?? null },
      selected_motion_family: family ?? null,
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
      decision_rules: 'Scegli una sola primitiva semantica che rappresenti l’azione richiesta in questo segmento. Scene convertirà la primitiva in coordinate, rotazioni e keyframe deterministici. Non animare elementi diversi dal soggetto selezionato.',
      constraint: input.target === 'camera'
        ? 'La camera attiva è il soggetto selezionato: interpreta la richiesta esclusivamente come movimento o rotazione della camera. Non animare altri elementi.'
        : 'Interpreta una sola azione principale del soggetto selezionato. Non aggiungere eventi, oggetti o dialoghi non richiesti.',
    },
    questions: {
      actionable: { type: 'noul', instructions: 'La richiesta descrive un movimento o una posa abbastanza chiari da convertire in keyframe?' },
      motion: { type: 'choice', instructions: input.target === 'camera' ? 'Quale singola primitiva descrive meglio il movimento della camera selezionata?' : 'Quale singola primitiva descrive meglio il movimento del soggetto selezionato?', criteria: criteriaForFamily(family, input.target === 'camera') },
      reference_object: { type: 'choice', instructions: 'Quale elemento della scena è il riferimento esplicito dell’azione? Scegli none se la frase non nomina o non implica un elemento preciso.', criteria: referenceCriteria },
      distance: { type: 'score', instructions: 'Quanto deve essere ampio lo spostamento?', criteria: ['Minimo: 0,25 m', 'Piccolo: 0,5 m', 'Medio: 1 m', 'Ampio: 2 m', 'Molto ampio: 4 m'] },
      duration: { type: 'score', instructions: 'Quanto deve durare l’azione?', criteria: ['Scatto: 0,25 s', 'Rapida: 0,5 s', 'Normale: 1 s', 'Lenta: 2 s', 'Molto lenta: 4 s'] },
      energy: { type: 'score', instructions: 'Qual è l’energia espressiva del movimento?', criteria: ['Quasi immobile', 'Controllata', 'Naturale', 'Decisa', 'Esplosiva'] },
      path: { type: 'choice', instructions: 'Che forma deve avere il tragitto?', criteria: { direct: 'Traiettoria diretta e lineare.', smooth: 'Movimento morbido con accelerazione e decelerazione.', arc: 'Traiettoria ad arco, adatta soprattutto a un salto.' } },
      rotation_amount: { type: 'score', instructions: 'Quanto deve essere ampia la rotazione?', criteria: ['Minima: 10°', 'Piccola: 20°', 'Media: 45°', 'Ampia: 90°', 'Completa: 180°'] },
    },
  } as const;
}

export function jevTemporalRequest(project: AbacoProject, object: SceneObject | undefined, input: Omit<JevActionInput, 'project'>) {
  const base = jevActionRequest(project, object, input);
  return {
    model: base.model,
    state: base.state,
    questions: {
      temporal_structure: {
        type: 'choice',
        instructions: 'Come sono collegate temporalmente le azioni descritte? Considera “poi” come sequenza e “mentre” come simultaneità.',
        criteria: {
          single: 'Una sola azione.',
          sequential: 'Due o più azioni eseguite una dopo l’altra.',
          simultaneous: 'Due o più azioni eseguite nello stesso intervallo.',
          mixed: 'La frase combina azioni simultanee e azioni successive.',
        },
      },
    },
  } as const;
}

export function jevMotionFamilyRequest(project: AbacoProject, object: SceneObject | undefined, input: Omit<JevActionInput, 'project'>) {
  const base = jevActionRequest(project, object, input);
  return {
    model: base.model,
    state: base.state,
    questions: {
      motion_family: {
        type: 'choice',
        instructions: input.target === 'camera' ? 'A quale famiglia appartiene il movimento principale della camera?' : 'A quale famiglia appartiene il movimento principale del soggetto?',
        criteria: input.target === 'camera' ? cameraFamilyCriteria : subjectFamilyCriteria,
      },
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
    motion: SemanticMotionSchema.optional(),
    relation: z.enum(['then', 'with']).optional(),
    sequence: z.array(z.object({ instruction: z.string(), motion: SemanticMotionSchema, relation: z.enum(['then', 'with']), referenceName: z.string().optional() })).optional(),
    reference: z.object({ objectId: z.string().uuid(), name: z.string() }).optional(),
    action: z.string(), direction: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), energy: z.number(), path: z.string(), actionable: z.number(),
    camera: z.object({ requested: z.boolean(), action: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), path: z.string() }).optional(),
    gesture: z.object({ target: z.enum(['subject', 'camera']), points: z.number().int().positive() }).optional(),
  }),
  blenderPlan: BlenderPlanSchema,
});
export type JevActionPlan = z.infer<typeof JevActionPlanSchema>;

const sequenceVerbs = '(?:gir|ruot|volt|orient|guard|inclin|pieg|va|vai|muov|spost|trasl|dirig|scivol|avanz|arretr|indietreggi|sal|scend|salt|balz|cad|corr|cammin|marci|orbit|segu|avvicin|allontan|string|allarg|entr|esc|alz|abbass|sollev|insegu|accompagn|punt|carrell|scorr)\\w*';
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

export type MotionTimelineGroup = { instructions: string[] };

export function resolveTemporalStructure(instruction: string, predicted?: string): TemporalStructure {
  const text = normalizedInstruction(instruction);
  const hasThen = /[.;]|\b(?:poi|quindi|successivamente|dopodiche)\b/.test(text);
  const hasWhile = /\b(?:mentre|contemporaneamente|allo stesso tempo)\b/.test(text);
  if (hasThen && hasWhile) return 'mixed';
  if (hasWhile) return 'simultaneous';
  if (hasThen) return 'sequential';
  const parsed = TemporalStructureSchema.safeParse(predicted);
  return parsed.success ? parsed.data : 'single';
}

function sequentialClauses(instruction: string) {
  return instruction.trim().replace(/\s+/g, ' ').replace(/\be\s+poi\b/giu, 'poi')
    .split(/\s*(?:[.;]|,\s*(?=poi\b)|\b(?:poi|quindi|successivamente|dopodiché|dopodiche)\b)\s*/iu)
    .map((part) => part.trim()).filter(Boolean);
}

function simultaneousClauses(instruction: string) {
  const whileParts = instruction.split(/\s*\b(?:mentre|contemporaneamente|allo stesso tempo)\b\s*/iu).filter(Boolean);
  return whileParts.flatMap((part) => part.split(new RegExp(`\\s+e\\s+(?=(?:(?:il|la)\\s+(?:personaggio|camera)\\s+)?(?:si\\s+)?${sequenceVerbs}\\b)`, 'iu')))
    .map((part) => part.trim()).filter(Boolean);
}

/** Builds sequential groups whose instructions run in parallel inside each group. */
export function splitMotionTimeline(instruction: string, structure: TemporalStructure): MotionTimelineGroup[] {
  if (structure === 'single') return [{ instructions: [instruction.trim()] }];
  if (structure === 'sequential') return splitJevInstruction(instruction).map((step) => ({ instructions: [step] }));
  if (structure === 'simultaneous') {
    const parts = simultaneousClauses(instruction);
    return [{ instructions: (parts.length > 1 ? parts : splitJevInstruction(instruction)).slice(0, 8) }];
  }
  const groups: MotionTimelineGroup[] = [];
  let count = 0;
  for (const clause of sequentialClauses(instruction)) {
    if (count >= 8) break;
    const instructions = simultaneousClauses(clause).slice(0, 8 - count);
    if (instructions.length) {
      groups.push({ instructions });
      count += instructions.length;
    }
  }
  return groups;
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
    decision: {
      ...last.decision,
      sequence: plans.flatMap((plan) => plan.decision.sequence ?? (plan.decision.motion ? [{ instruction: plan.instruction, motion: plan.decision.motion, relation: plan.decision.relation ?? 'then', referenceName: plan.decision.reference?.name }] : [])),
    },
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

/** Adds simultaneous transform deltas so parallel movements do not overwrite each other. */
export function composeParallelJevPlans(project: AbacoProject, plans: JevActionPlan[], instruction: string): JevActionPlan {
  if (plans.length < 2) return JevActionPlanSchema.parse({ ...plans[0], instruction });
  const merged = mergeJevSequencePlans(plans, instruction);
  const appliedProjects = plans.map((plan) => applyPlan(project, plan.blenderPlan));
  const keys = new Set(plans.flatMap((plan) => plan.blenderPlan.operations.map((operation) => `${operation.objectId}:${operation.property}`)));
  const conflicting = new Set([...keys].filter((key) => plans.filter((plan) => plan.blenderPlan.operations.some((operation) => `${operation.objectId}:${operation.property}` === key)).length > 1));
  const untouched = merged.blenderPlan.operations.filter((operation) => !conflicting.has(`${operation.objectId}:${operation.property}`));
  const composed: BlenderPlan['operations'] = [];

  for (const key of conflicting) {
    const separator = key.indexOf(':');
    const objectId = key.slice(0, separator);
    const property = key.slice(separator + 1) as 'position' | 'rotation' | 'scale';
    if (!['position', 'rotation', 'scale'].includes(property)) continue;
    const sourceObject = project.objects.find((candidate) => candidate.id === objectId);
    if (!sourceObject) continue;
    const contributors = plans.map((plan, index) => ({ plan, applied: appliedProjects[index]! }))
      .filter(({ plan }) => plan.blenderPlan.operations.some((operation) => operation.objectId === objectId && operation.property === property));
    const frames = [...new Set(contributors.flatMap(({ plan }) => plan.blenderPlan.operations.filter((operation) => operation.objectId === objectId && operation.property === property).map((operation) => operation.frame)))].sort((a, b) => a - b);
    for (const frame of frames) {
      const baseline = evaluateTransform(sourceObject, frame)[property];
      const vector = contributors.reduce<Vec3>((result, { applied }) => {
        const candidate = applied.objects.find((object) => object.id === objectId);
        const value = candidate ? evaluateTransform(candidate, frame)[property] : baseline;
        return result.map((entry, axis) => entry + value[axis]! - baseline[axis]!) as Vec3;
      }, [...baseline] as Vec3);
      composed.push({
        id: crypto.randomUUID(), type: 'set_keyframe', objectId, frame, property,
        value: { vector, boolean: null, text: null, number: null }, interpolation: 'bezier',
        rationale: 'Composizione deterministica di movimenti simultanei.', commentIds: [],
      });
    }
  }
  return JevActionPlanSchema.parse({
    ...merged,
    blenderPlan: { ...merged.blenderPlan, summary: `${merged.blenderPlan.summary} (simultanee)`, operations: [...untouched, ...composed].sort((a, b) => a.frame - b.frame) },
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

export function resolveCameraFocusObject(project: AbacoProject, sceneId: string, frame: number, instruction: string, fallbackTarget?: Vec3) {
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
    ['orbit_left', /\borbit\w*[^.!?]{0,24}(?:sinistra|antiorari)/],
    ['orbit_right', /\borbit\w*[^.!?]{0,24}(?:destra|orari)/],
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

export function rotationToward(position: Vec3, target: Vec3): Vec3 {
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

type SemanticIntent = {
  action: string;
  direction: string;
  translation: Vec3;
  rotation: Vec3;
  cameraAction?: string;
};

function semanticMotionIntent(motion: SemanticMotion): SemanticIntent {
  const intents: Record<SemanticMotion, SemanticIntent> = {
    hold: { action: 'hold', direction: 'forward', translation: [0, 0, 0], rotation: [0, 0, 0], cameraAction: 'hold' },
    move_forward: { action: 'move', direction: 'forward', translation: [1, 0, 0], rotation: [0, 0, 0] },
    move_backward: { action: 'move', direction: 'backward', translation: [-1, 0, 0], rotation: [0, 0, 0] },
    move_left: { action: 'move', direction: 'left', translation: [0, -1, 0], rotation: [0, 0, 0] },
    move_right: { action: 'move', direction: 'right', translation: [0, 1, 0], rotation: [0, 0, 0] },
    move_forward_left: { action: 'move', direction: 'forward', translation: [1, -1, 0], rotation: [0, 0, 0] },
    move_forward_right: { action: 'move', direction: 'forward', translation: [1, 1, 0], rotation: [0, 0, 0] },
    move_backward_left: { action: 'move', direction: 'backward', translation: [-1, -1, 0], rotation: [0, 0, 0] },
    move_backward_right: { action: 'move', direction: 'backward', translation: [-1, 1, 0], rotation: [0, 0, 0] },
    move_up: { action: 'rise', direction: 'up', translation: [0, 0, 1], rotation: [0, 0, 0] },
    move_down: { action: 'descend', direction: 'down', translation: [0, 0, -1], rotation: [0, 0, 0] },
    jump_in_place: { action: 'jump', direction: 'up', translation: [0, 0, 0], rotation: [0, 0, 0] },
    jump_forward: { action: 'jump', direction: 'forward', translation: [1, 0, 0], rotation: [0, 0, 0] },
    turn_left: { action: 'turn', direction: 'left', translation: [0, 0, 0], rotation: [0, 0, -1] },
    turn_right: { action: 'turn', direction: 'right', translation: [0, 0, 0], rotation: [0, 0, 1] },
    look_up: { action: 'turn', direction: 'up', translation: [0, 0, 0], rotation: [0, 1, 0] },
    look_down: { action: 'turn', direction: 'down', translation: [0, 0, 0], rotation: [0, -1, 0] },
    roll_left: { action: 'turn', direction: 'left', translation: [0, 0, 0], rotation: [-1, 0, 0], cameraAction: 'hold' },
    roll_right: { action: 'turn', direction: 'right', translation: [0, 0, 0], rotation: [1, 0, 0], cameraAction: 'hold' },
    move_away_camera: { action: 'move', direction: 'away_camera', translation: [0, 0, 0], rotation: [0, 0, 0] },
    move_toward_camera: { action: 'move', direction: 'toward_camera', translation: [0, 0, 0], rotation: [0, 0, 0] },
    move_toward_object: { action: 'move', direction: 'toward_object', translation: [0, 0, 0], rotation: [0, 0, 0] },
    move_away_object: { action: 'move', direction: 'away_object', translation: [0, 0, 0], rotation: [0, 0, 0] },
    look_at_object: { action: 'turn', direction: 'toward_object', translation: [0, 0, 0], rotation: [0, 0, 0] },
    follow_drawn_path: { action: 'move', direction: 'forward', translation: [1, 0, 0], rotation: [0, 0, 0], cameraAction: 'hold' },
    dolly_in: { action: 'hold', direction: 'forward', translation: [1, 0, 0], rotation: [0, 0, 0], cameraAction: 'push_in' },
    dolly_out: { action: 'hold', direction: 'backward', translation: [-1, 0, 0], rotation: [0, 0, 0], cameraAction: 'pull_out' },
    truck_left: { action: 'hold', direction: 'left', translation: [0, -1, 0], rotation: [0, 0, 0], cameraAction: 'truck_left' },
    truck_right: { action: 'hold', direction: 'right', translation: [0, 1, 0], rotation: [0, 0, 0], cameraAction: 'truck_right' },
    pedestal_up: { action: 'hold', direction: 'up', translation: [0, 0, 1], rotation: [0, 0, 0], cameraAction: 'rise' },
    pedestal_down: { action: 'hold', direction: 'down', translation: [0, 0, -1], rotation: [0, 0, 0], cameraAction: 'descend' },
    pan_left: { action: 'hold', direction: 'left', translation: [0, 0, 0], rotation: [0, 0, -1], cameraAction: 'pan_left' },
    pan_right: { action: 'hold', direction: 'right', translation: [0, 0, 0], rotation: [0, 0, 1], cameraAction: 'pan_right' },
    tilt_up: { action: 'hold', direction: 'up', translation: [0, 0, 0], rotation: [0, 1, 0], cameraAction: 'tilt_up' },
    tilt_down: { action: 'hold', direction: 'down', translation: [0, 0, 0], rotation: [0, -1, 0], cameraAction: 'tilt_down' },
    orbit_left: { action: 'hold', direction: 'left', translation: [0, 0, 0], rotation: [0, 0, 0], cameraAction: 'orbit_left' },
    orbit_right: { action: 'hold', direction: 'right', translation: [0, 0, 0], rotation: [0, 0, 0], cameraAction: 'orbit_right' },
    follow_subject: { action: 'hold', direction: 'forward', translation: [0, 0, 0], rotation: [0, 0, 0], cameraAction: 'follow_subject' },
  };
  return intents[motion];
}

function naturalMotionPrimitive(instruction: string, cameraOnly: boolean, gesture?: JevActionInput['gesture']): SemanticMotion | undefined {
  const text = normalizedInstruction(instruction);
  if (cameraOnly) {
    const explicit = explicitCameraMotion(instruction, true);
    const cameraMap: Record<string, SemanticMotion> = {
      push_in: 'dolly_in', pull_out: 'dolly_out', truck_left: 'truck_left', truck_right: 'truck_right',
      rise: 'pedestal_up', descend: 'pedestal_down', pan_left: 'pan_left', pan_right: 'pan_right',
      tilt_up: 'tilt_up', tilt_down: 'tilt_down', orbit_left: 'orbit_left', orbit_right: 'orbit_right', follow_subject: 'follow_subject',
    };
    if (explicit) return cameraMap[explicit];
    const axes = explicitAxisIntent(instruction, true);
    if (axes.rotation[0] === 1) return 'roll_right';
    if (axes.rotation[0] === -1) return 'roll_left';
    if (gesture) return 'follow_drawn_path';
    if (/\b(?:resta|rimani|ferma|immobile|stop)\w*\b/.test(text)) return 'hold';
    return undefined;
  }
  const intent = naturalMotionIntent(instruction, false);
  const [forward, right, vertical] = intent.axes.translation;
  const [roll, pitch, yaw] = intent.axes.rotation;
  if (gesture) return 'follow_drawn_path';
  const radial = explicitCameraDirection(instruction);
  if (radial === 'away_camera') return 'move_away_camera';
  if (radial === 'toward_camera') return 'move_toward_camera';
  if (intent.action === 'hold') return 'hold';
  if (intent.action === 'jump') return forward === 1 ? 'jump_forward' : 'jump_in_place';
  if ([roll, pitch, yaw].some((value) => value !== undefined) && [forward, right, vertical].some((value) => value !== undefined)) return undefined;
  if (roll === 1) return 'roll_right';
  if (roll === -1) return 'roll_left';
  if (pitch === 1) return 'look_up';
  if (pitch === -1) return 'look_down';
  if (yaw === 1 && forward === undefined && right === undefined && vertical === undefined) return 'turn_right';
  if (yaw === -1 && forward === undefined && right === undefined && vertical === undefined) return 'turn_left';
  if (vertical === 1 && forward === undefined && right === undefined) return 'move_up';
  if (vertical === -1 && forward === undefined && right === undefined) return 'move_down';
  if (forward === 1 && right === 1) return 'move_forward_right';
  if (forward === 1 && right === -1) return 'move_forward_left';
  if (forward === -1 && right === 1) return 'move_backward_right';
  if (forward === -1 && right === -1) return 'move_backward_left';
  if (forward === 1) return 'move_forward';
  if (forward === -1) return 'move_backward';
  if (right === 1) return 'move_right';
  if (right === -1) return 'move_left';
  return undefined;
}

function answerAxis(answer: JevActionResponse['answers']['translate_x'], explicit: number | undefined) {
  if (explicit !== undefined) return explicit;
  if (!answer || answer.confidence < .62) return 0;
  return answer.choice === 'increase' ? 1 : answer.choice === 'decrease' ? -1 : 0;
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

function resolveInstructionReference(project: AbacoProject, input: Omit<JevActionInput, 'project'>, selectedId: string | null, answer?: string) {
  const candidates = project.objects.filter((candidate) => candidate.id !== selectedId
    && candidate.kind !== 'audio' && !candidate.kind.includes('light') && !candidate.screenSpace
    && (!candidate.sceneIds.length || candidate.sceneIds.includes(input.sceneId)));
  const text = normalizedInstruction(input.instruction);
  const named = candidates.filter((candidate) => text.includes(normalizedInstruction(candidate.name))).sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return named;
  if (/\b(?:camera|telecamera|inquadratura)\b/.test(text)) {
    const scene = project.cameraCuts.find((candidate) => candidate.id === input.sceneId);
    const camera = candidates.find((candidate) => candidate.id === scene?.cameraId);
    if (camera) return camera;
  }
  return answer && answer !== 'none' ? candidates.find((candidate) => candidate.id === answer) : undefined;
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
  const localMotion = naturalMotionPrimitive(input.instruction, cameraOnly, input.gesture);
  const parsedModelMotion = SemanticMotionSchema.safeParse(answers.motion?.choice);
  const modelMotion = parsedModelMotion.success ? parsedModelMotion.data : undefined;
  const motion = localMotion ?? modelMotion;
  const semanticIntent = motion ? semanticMotionIntent(motion) : undefined;
  const referenceObject = resolveInstructionReference(project, input, input.objectId, answers.reference_object?.choice);
  const requiresReference = motion === 'move_toward_object' || motion === 'move_away_object' || motion === 'look_at_object';
  const missingReference = requiresReference && !referenceObject;
  const explicitAxes = naturalIntent.axes;
  const translationAxes: Vec3 = semanticIntent?.translation ?? [answerAxis(answers.translate_x, explicitAxes.translation[0]), answerAxis(answers.translate_y, explicitAxes.translation[1]), answerAxis(answers.translate_z, explicitAxes.translation[2])];
  const rotationAxes: Vec3 = semanticIntent?.rotation ?? [answerAxis(answers.rotate_x, explicitAxes.rotation[0]), answerAxis(answers.rotate_y, explicitAxes.rotation[1]), answerAxis(answers.rotate_z, explicitAxes.rotation[2])];
  const hasAxisTranslation = translationAxes.some((entry) => entry !== 0);
  const hasAxisRotation = rotationAxes.some((entry) => entry !== 0);
  const drawnFullOrbit = closedStroke(input.gesture?.points) && /(?:gira\w*|ruota\w*|orbit\w*)[^.!?]{0,30}(?:attorno|intorno)|(?:attorno|intorno)[^.!?]{0,30}(?:personaggi|soggett|element)/.test(normalizedInstruction(input.instruction));
  const explicitCameraAction = explicitCameraMotion(input.instruction, cameraOnly) ?? (drawnFullOrbit ? drawnOrbitDirection(input.gesture?.points) : undefined);
  const cameraAction = semanticIntent?.cameraAction ?? explicitCameraAction ?? answers.camera_action?.choice ?? 'hold';
  const gestureTarget = input.gesture ? (cameraOnly ? 'camera' : 'subject') : undefined;
  const cameraRequested = cameraOnly;
  const subjectConfidences = object ? [answers.motion?.confidence ?? answers.action?.confidence, answers.direction?.confidence, answers.distance.confidence, answers.duration.confidence, answers.energy.confidence, answers.path.confidence].filter((entry): entry is number => entry !== undefined) : [];
  const cameraConfidences = cameraRequested ? [answers.motion?.confidence ?? answers.camera_action?.confidence, answers.distance.confidence, answers.duration.confidence, answers.path.confidence].filter((entry): entry is number => entry !== undefined) : [];
  const confidences = [...subjectConfidences, ...cameraConfidences];
  const modelConfidence = Math.min(...(confidences.length ? confidences : [0]));
  const confidence = input.engine === 'laya' && motion && motion === localMotion ? Math.max(.9, modelConfidence) : modelConfidence;
  const cameraIntent = explicitCameraDirection(input.instruction);
  const directionChoice = semanticIntent?.direction ?? cameraIntent ?? naturalIntent.direction ?? answers.direction?.choice ?? 'forward';
  const startPosition = input.startPosition ?? (object ? evaluateTransform(object, input.frame).position : [0, 0, 0]);
  const directions: Record<string, Vec3> = { ...cameraRelativeDirections(project, input.sceneId, input.frame), ...radialCameraDirections(project, input.sceneId, input.frame, startPosition) };
  if (referenceObject) {
    const referencePosition = evaluateTransform(referenceObject, input.frame).position;
    const toward = normalizeGround([referencePosition[0] - startPosition[0], referencePosition[1] - startPosition[1], 0], directions.forward!);
    directions.toward_object = toward;
    directions.away_object = scale(toward, -1);
  }
  const drawnBasis = input.gesture?.viewRotation ? cameraBasis(input.gesture.viewRotation).map((axis) => axis.toArray() as Vec3) : undefined;
  const drawnRight = drawnBasis ? normalizeGround(drawnBasis[0]!, directions.right!) : directions.right!;
  const drawnForward = drawnBasis ? normalizeGround(drawnBasis[1]!, directions.forward!) : directions.forward!;
  const drawnUp = drawnBasis ? normalizeVector(drawnBasis[2]!, [0, 0, 1]) : [0, 0, 1] as Vec3;
  const direction = directions[directionChoice] ?? directions.forward;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === input.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  const endFrame = Math.min(input.endFrame ?? sceneEnd, sceneEnd, input.frame + Math.max(1, Math.round(duration * project.settings.fps)));
  const interpolation = answers.path.choice === 'direct' ? 'linear' : 'bezier';
  let endPosition = startPosition;
  const objectTransform = object ? evaluateTransform(object, input.frame) : undefined;
  let endRotation = objectTransform?.rotation ?? [0, 0, 0];
  let action = object ? (semanticIntent?.action ?? naturalIntent.action ?? (gestureTarget === 'subject' ? (['jump', 'rise', 'descend'].includes(answers.action?.choice ?? '') ? answers.action!.choice : 'move') : cameraIntent && answers.action?.choice !== 'jump' ? 'move' : answers.action?.choice ?? 'hold')) : 'hold';
  if (object && hasAxisTranslation && action !== 'jump') action = translationAxes[2] !== 0 && translationAxes[0] === 0 && translationAxes[1] === 0 ? (translationAxes[2] > 0 ? 'rise' : 'descend') : 'move';
  if (object && hasAxisRotation && !hasAxisTranslation && action !== 'jump') action = 'turn';
  const subjectAxisDirection = normalizeVector(add(add(scale(directions.forward!, translationAxes[0]), scale(directions.right!, translationAxes[1])), [0, 0, translationAxes[2]]), direction);
  if (object && !missingReference && ['move', 'rise', 'descend'].includes(action)) endPosition = add(startPosition, scale(hasAxisTranslation && !cameraIntent ? subjectAxisDirection : direction, distance));
  if (object && motion === 'look_at_object' && referenceObject) {
    const target = evaluateTransform(referenceObject, input.frame).position;
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(target[0] - startPosition[0], target[1] - startPosition[1]));
    endRotation = [objectTransform!.rotation[0], objectTransform!.rotation[1], yaw];
  } else if (object && hasAxisRotation) {
    endRotation = objectTransform!.rotation.map((value, axis) => value + rotationAxes[axis]! * rotationAmount) as Vec3;
  } else if (object && action === 'turn') {
    const amount = rotationAmount;
    endRotation = [objectTransform!.rotation[0], objectTransform!.rotation[1], objectTransform!.rotation[2] + (directionChoice === 'left' ? -amount : amount)];
  }
  if (object && action === 'jump') {
    const horizontal: Vec3 = directionChoice === 'up' || directionChoice === 'down' ? [0, 0, 0] : scale(direction, distance);
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
  if (object && !missingReference && (action === 'turn' || hasAxisRotation)) {
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'rotation', value: value(objectTransform!.rotation), interpolation, rationale: 'Orientamento iniziale.', commentIds: [] });
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'rotation', value: value(endRotation), interpolation, rationale: `Rotazione scelta da ${engineLabel}.`, commentIds: [] });
  }

  const scene = scenes[sceneIndex];
  const cameraObject = cameraOnly
    ? project.objects.find((candidate) => candidate.id === input.objectId && candidate.kind === 'camera')
    : project.objects.find((candidate) => candidate.id === scene?.cameraId && candidate.kind === 'camera');
  const cameraFocusObject = cameraOnly && scene ? project.objects.find((entry) => entry.id === input.referenceId) ?? resolveCameraFocusObject(project, input.sceneId, input.frame, input.instruction, scene.framing.target) ?? resolveCameraFocusObject(project, input.sceneId, input.frame, input.contextInstruction ?? '', scene.framing.target) : object;
  const cameraDistance = explicitMeasurement(input.instruction, 'distance') ?? nearestLevel(answers.camera_distance?.score ?? answers.distance.score, distances);
  const cameraDuration = explicitMeasurement(input.instruction, 'duration') ?? nearestLevel(answers.camera_duration?.score ?? answers.duration.score, durations);
  const cameraInterpolation = answers.camera_path?.choice === 'direct' ? 'linear' : 'bezier';
  if (cameraRequested && cameraObject && scene) {
    const cameraTransform = evaluateTransform(cameraObject, input.frame);
    const cameraEndFrame = Math.min(input.endFrame ?? sceneEnd, sceneEnd, input.frame + Math.max(1, Math.round(cameraDuration * project.settings.fps)));
    const targetStart = object ? startPosition : cameraFocusObject ? evaluateTransform(cameraFocusObject, input.frame).position : cameraOnly ? scene.framing.target : cameraTarget(cameraTransform, scene.framing.distance);
    const targetEnd = object ? endPosition : cameraFocusObject ? evaluateTransform(cameraFocusObject, cameraEndFrame).position : targetStart;
    let cameraEndPosition = cameraTransform.position;
    let cameraEndRotation = cameraTransform.rotation;
    const towardTarget = normalizeVector([targetStart[0] - cameraTransform.position[0], targetStart[1] - cameraTransform.position[1], targetStart[2] - cameraTransform.position[2]], [0, 1, 0]);
    const screenRight = normalizeGround(cameraBasis(cameraTransform.rotation)[0].toArray() as Vec3, [1, 0, 0]);
    const atomicCameraDirection = normalizeVector(add(add(scale(towardTarget, translationAxes[0]), scale(screenRight, translationAxes[1])), [0, 0, translationAxes[2]]), towardTarget);
    if (cameraOnly && hasAxisTranslation && !['push_in', 'pull_out', 'orbit_left', 'orbit_right', 'follow_subject'].includes(cameraAction)) cameraEndPosition = add(cameraTransform.position, scale(atomicCameraDirection, cameraDistance));
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
  const actionable = motion && motion !== 'hold' ? Math.max(.9, answers.actionable.noul) : object && naturalIntent.action && naturalIntent.action !== 'hold' ? Math.max(.9, answers.actionable.noul) : object ? answers.actionable.noul : 1;
  const warnings = confidence < .55 || actionable < .6 ? ['Decisione incerta: controllare il JSON e l’anteprima prima di applicare.'] : [];
  if (missingReference) warnings.push('Il movimento richiede un elemento di riferimento presente nella scena.');
  if (!operations.length) warnings.push('La descrizione non contiene un movimento applicabile al soggetto selezionato o alla camera.');
  const plan: BlenderPlan = { schemaVersion: 'BlenderPlanV1', summary: `${engineLabel} · Regia: ${input.instruction}`, assumptions: ['Le direzioni del soggetto sono relative alla camera attiva; i movimenti camera mantengono il soggetto selezionato come riferimento.'], warnings, operations };
  return JevActionPlanSchema.parse({
    schemaVersion: 'JevActionPlanV1', objectId: object?.id ?? null, instruction: input.instruction, model: response.model,
    status: confidence >= .55 && actionable >= .6 && operations.length ? 'ready' : 'review', confidence,
    decision: { motion, action, direction: directionChoice, distanceMeters: distance, durationSeconds: duration, energy: answers.energy.score, path: answers.path.choice, actionable, reference: referenceObject ? { objectId: referenceObject.id, name: referenceObject.name } : undefined, camera: { requested: cameraRequested, action: cameraAction, distanceMeters: cameraDistance, durationSeconds: cameraDuration, path: answers.camera_path?.choice ?? answers.path.choice }, gesture: gestureTarget && input.gesture ? { target: gestureTarget, points: input.gesture.points.length } : undefined },
    blenderPlan: plan,
  });
}
