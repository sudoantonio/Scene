import { z } from 'zod';
import type { AbacoProject } from './schema';

export const MotionAdjustmentInputSchema = z.object({
  instruction: z.string().trim().min(3).max(2000),
  durationSeconds: z.number().finite().positive().max(3600),
});
export type MotionAdjustmentInput = z.infer<typeof MotionAdjustmentInputSchema>;
export const MotionAdjustmentSchema = z.object({
  durationSeconds: z.number().finite().min(.1).max(3600),
  interpolation: z.enum(['keep', 'linear', 'bezier']),
});
export type MotionAdjustment = z.infer<typeof MotionAdjustmentSchema>;
export function motionAdjustmentRequest(input: MotionAdjustmentInput) {
  return { model: 'jev-latest', state: MotionAdjustmentInputSchema.parse(input), questions: {
    timing: { type: 'score', instructions: 'Adjust ONLY the duration of the selected existing movement according to the instruction. Preserve its drawn curve and endpoints. Keep duration when no timing change is requested. Choose the closest duration multiplier.', criteria: ['Quarter duration / four times faster', 'Half duration / twice faster', 'Keep current duration', 'One and a half times duration / slower', 'Twice duration / half speed', 'Four times duration / four times slower'] },
    interpolation: { type: 'choice', instructions: 'Adjust ONLY the timing along the existing curve. Keep it unless the user requests smooth start/stop or uniform speed.', criteria: { keep: 'Keep the existing timing', linear: 'Uniform speed along the curve', bezier: 'Smooth acceleration and deceleration, slow start and stop' } },
  } };
}
export function parseMotionAdjustment(raw: unknown, input: MotionAdjustmentInput): MotionAdjustment {
  const answer = z.object({ answers: z.object({
    timing: z.object({ type: z.literal('score'), score: z.number().finite().min(0).max(5) }),
    interpolation: z.object({ type: z.literal('choice'), choice: z.enum(['keep', 'linear', 'bezier']) }),
  }) }).parse(raw);
  const explicit = input.instruction.match(/\b(\d+(?:[.,]\d+)?)\s*(?:second[oi]|seconds?|s)\b/i);
  const durationSeconds = explicit ? Number(explicit[1].replace(',', '.')) : input.durationSeconds * [.25, .5, 1, 1.5, 2, 4][Math.round(answer.answers.timing.score)];
  return MotionAdjustmentSchema.parse({ durationSeconds, interpolation: answer.answers.interpolation.choice });
}
export function selectedMotionSignature(project: AbacoProject, objectId: string, sceneId: string) {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame), index = scenes.findIndex(scene => scene.id === sceneId);
  const object = project.objects.find(object => object.id === objectId), scene = scenes[index];
  if (!object || !scene) return undefined;
  const end = scenes[index + 1]?.frame ?? project.settings.frameEnd + 1;
  const keys = object.keyframes.filter(key => key.frame >= scene.frame && key.frame < end && ['position', 'rotation', 'scale'].includes(key.property) && (key.purpose === 'motion' || key.purpose === undefined && key.frame !== scene.frame));
  const frames = [...new Set(keys.map(key => key.frame))].sort((a, b) => a - b);
  if (frames.length < 2) return undefined;
  return { start: frames[0], last: frames.at(-1)!, signature: JSON.stringify({ keys, controllers: object.asset.controllerKeys, sceneStart: scene.frame, sceneEnd: end }) };
}
