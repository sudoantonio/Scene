import { z } from 'zod';

export const MotionAxisSchema = z.number().min(-1).max(1);
export const MotionSpecSchema = z.object({
  version: z.literal(1),
  space: z.enum(['camera', 'world', 'reference']),
  translation: z.tuple([MotionAxisSchema, MotionAxisSchema, MotionAxisSchema]),
  rotation: z.tuple([MotionAxisSchema, MotionAxisSchema, MotionAxisSchema]),
  distanceMeters: z.number().nonnegative(),
  rotationDegrees: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  energy: z.number().min(0).max(4).optional(),
  path: z.enum(['hold', 'linear', 'smooth', 'arc', 'orbit', 'follow', 'drawn']),
  referenceId: z.string().uuid().optional(),
  framing: z.object({
    action: z.enum(['none', 'enter', 'exit']),
    edge: z.enum(['left', 'right', 'top', 'bottom']),
  }).default({ action: 'none', edge: 'left' }),
  constraints: z.object({
    lookAtReference: z.boolean(),
    maintainAltitude: z.boolean(),
    maintainDistance: z.boolean(),
  }),
});
export type MotionSpec = z.infer<typeof MotionSpecSchema>;

const axisPart = (value: number, positive: string, negative: string) => value > 0 ? positive : value < 0 ? negative : '';

export function describeMotionSpec(spec: MotionSpec) {
  const parts = [
    axisPart(spec.translation[0], 'forward', 'backward'),
    axisPart(spec.translation[1], 'right', 'left'),
    axisPart(spec.translation[2], 'up', 'down'),
    axisPart(spec.rotation[0], 'roll right', 'roll left'),
    axisPart(spec.rotation[1], 'pitch up', 'pitch down'),
    axisPart(spec.rotation[2], 'yaw right', 'yaw left'),
  ].filter(Boolean);
  if (spec.path === 'orbit') parts.unshift('orbit');
  if (spec.path === 'follow') parts.unshift('follow');
  if (spec.path === 'drawn') parts.unshift('drawn path');
  if (spec.framing.action === 'enter') parts.unshift(`enters the frame from the ${spec.framing.edge}`);
  if (spec.framing.action === 'exit') parts.unshift(`exits the frame toward the ${spec.framing.edge}`);
  if (spec.constraints.lookAtReference) parts.push('subject kept in frame');
  return parts.join(' + ') || 'still';
}
