import { z } from 'zod';
import { BlenderPlanSchema, type AbacoProject, type BlenderPlan, type SceneObject, type Vec3 } from './schema';

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
  }),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});
export type JevActionResponse = z.infer<typeof JevActionResponseSchema>;

export const JevActionInputSchema = z.object({
  project: z.unknown(),
  objectId: z.string().uuid(),
  sceneId: z.string().uuid(),
  frame: z.number().int().positive(),
  startPosition: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  instruction: z.string().trim().min(3).max(2_000),
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
  forward: 'Verso Y positivo nello spazio di Scene.',
  backward: 'Verso Y negativo nello spazio di Scene.',
  left: 'Verso X negativo nello spazio di Scene.',
  right: 'Verso X positivo nello spazio di Scene.',
  up: 'Verso Z positivo.',
  down: 'Verso Z negativo.',
};

export function jevActionRequest(project: AbacoProject, object: SceneObject, input: Omit<JevActionInput, 'project'>) {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === input.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  return {
    model: 'jev-latest',
    state: {
      application: 'Scene di ABACO, editor di animatic 3D',
      character: { id: object.id, name: object.name, kind: object.kind },
      instruction: input.instruction,
      current_frame: input.frame,
      scene_end_frame: sceneEnd,
      fps: project.settings.fps,
      start_position_meters: { x: input.startPosition[0], y: input.startPosition[1], z: input.startPosition[2] },
      start_rotation_degrees: { x: object.transform.rotation[0], y: object.transform.rotation[1], z: object.transform.rotation[2] },
      coordinate_system: 'X destra/sinistra, Y avanti/indietro, Z alto/basso. Le distanze sono metri.',
      constraint: 'Interpreta una sola azione principale. Non aggiungere eventi, oggetti o dialoghi non richiesti.',
    },
    questions: {
      actionable: { type: 'noul', instructions: 'La richiesta descrive un movimento o una posa abbastanza chiari da convertire in keyframe?' },
      action: { type: 'choice', instructions: 'Qual è l’azione principale richiesta?', criteria: actionCriteria },
      direction: { type: 'choice', instructions: 'Qual è la direzione principale? Per turn usa left o right; per rise usa up; per descend usa down.', criteria: directionCriteria },
      distance: { type: 'score', instructions: 'Quanto deve essere ampio lo spostamento?', criteria: ['Minimo: 0,25 m', 'Piccolo: 0,5 m', 'Medio: 1 m', 'Ampio: 2 m', 'Molto ampio: 4 m'] },
      duration: { type: 'score', instructions: 'Quanto deve durare l’azione?', criteria: ['Scatto: 0,25 s', 'Rapida: 0,5 s', 'Normale: 1 s', 'Lenta: 2 s', 'Molto lenta: 4 s'] },
      energy: { type: 'score', instructions: 'Qual è l’energia espressiva del movimento?', criteria: ['Quasi immobile', 'Controllata', 'Naturale', 'Decisa', 'Esplosiva'] },
      path: { type: 'choice', instructions: 'Che forma deve avere il tragitto?', criteria: { direct: 'Traiettoria diretta e lineare.', smooth: 'Movimento morbido con accelerazione e decelerazione.', arc: 'Traiettoria ad arco, adatta soprattutto a un salto.' } },
    },
  } as const;
}

const distances = [.25, .5, 1, 2, 4];
const durations = [.25, .5, 1, 2, 4];
const nearestLevel = (score: number, values: number[]) => values[Math.max(0, Math.min(values.length - 1, Math.round(score)))]!;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const directions: Record<string, Vec3> = {
  forward: [0, 1, 0], backward: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 0, 1], down: [0, 0, -1],
};

export const JevActionPlanSchema = z.object({
  schemaVersion: z.literal('JevActionPlanV1'),
  objectId: z.string().uuid(),
  instruction: z.string(),
  model: z.string(),
  status: z.enum(['ready', 'review']),
  confidence: z.number().min(0).max(1),
  decision: z.object({
    action: z.string(), direction: z.string(), distanceMeters: z.number(), durationSeconds: z.number(), energy: z.number(), path: z.string(), actionable: z.number(),
  }),
  blenderPlan: BlenderPlanSchema,
});
export type JevActionPlan = z.infer<typeof JevActionPlanSchema>;

export function compileJevAction(project: AbacoProject, object: SceneObject, input: Omit<JevActionInput, 'project'>, raw: JevActionResponse): JevActionPlan {
  const response = JevActionResponseSchema.parse(raw);
  const { answers } = response;
  const distance = nearestLevel(answers.distance.score, distances);
  const duration = nearestLevel(answers.duration.score, durations);
  const confidences = [answers.action.confidence, answers.direction.confidence, answers.distance.confidence, answers.duration.confidence, answers.energy.confidence, answers.path.confidence];
  const confidence = Math.min(...confidences);
  const direction = directions[answers.direction.choice] ?? directions.forward;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene) => scene.id === input.sceneId);
  const sceneEnd = (scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
  const endFrame = Math.min(sceneEnd, input.frame + Math.max(1, Math.round(duration * project.settings.fps)));
  const interpolation = answers.path.choice === 'direct' ? 'linear' : 'bezier';
  let endPosition = input.startPosition;
  let endRotation = object.transform.rotation;
  const action = answers.action.choice;
  if (['move', 'rise', 'descend'].includes(action)) endPosition = add(input.startPosition, scale(direction, distance));
  if (action === 'turn') {
    const amount = distance <= .5 ? 45 : distance <= 1 ? 90 : 180;
    endRotation = [object.transform.rotation[0], object.transform.rotation[1], object.transform.rotation[2] + (answers.direction.choice === 'left' ? amount : -amount)];
  }
  if (action === 'jump') {
    const horizontal: Vec3 = answers.direction.choice === 'up' || answers.direction.choice === 'down' ? [0, 0, 0] : scale(direction, distance);
    endPosition = add(input.startPosition, horizontal);
  }
  const value = (vector: Vec3) => ({ vector, boolean: null, text: null, number: null });
  const operations: BlenderPlan['operations'] = [
    { id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'position', value: value(input.startPosition), interpolation, rationale: 'Posizione iniziale indicata per l’azione Jev.', commentIds: [] },
  ];
  if (action === 'jump') {
    const apexFrame = Math.max(input.frame + 1, Math.round((input.frame + endFrame) / 2));
    const midpoint = scale(add(input.startPosition, endPosition), .5);
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: apexFrame, property: 'position', value: value([midpoint[0], midpoint[1], Math.max(input.startPosition[2], endPosition[2]) + Math.max(.35, distance * .5)]), interpolation: 'bezier', rationale: 'Apice del salto scelto da Jev.', commentIds: [] });
  }
  operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'position', value: value(endPosition), interpolation, rationale: `Azione ${action} compilata dalle decisioni Jev.`, commentIds: [] });
  if (action === 'turn') {
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: input.frame, property: 'rotation', value: value(object.transform.rotation), interpolation, rationale: 'Orientamento iniziale.', commentIds: [] });
    operations.push({ id: crypto.randomUUID(), type: 'set_keyframe', objectId: object.id, frame: endFrame, property: 'rotation', value: value(endRotation), interpolation, rationale: 'Rotazione scelta da Jev.', commentIds: [] });
  }
  const plan: BlenderPlan = { schemaVersion: 'BlenderPlanV1', summary: `Jev: ${input.instruction}`, assumptions: ['Coordinate mondo di Scene: X laterale, Y profondità, Z altezza.'], warnings: confidence < .55 || answers.actionable.noul < .6 ? ['Decisione incerta: controllare il JSON e l’anteprima prima di applicare.'] : [], operations };
  return JevActionPlanSchema.parse({
    schemaVersion: 'JevActionPlanV1', objectId: object.id, instruction: input.instruction, model: response.model,
    status: confidence >= .55 && answers.actionable.noul >= .6 ? 'ready' : 'review', confidence,
    decision: { action, direction: answers.direction.choice, distanceMeters: distance, durationSeconds: duration, energy: answers.energy.score, path: answers.path.choice, actionable: answers.actionable.noul },
    blenderPlan: plan,
  });
}
