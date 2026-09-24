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
  path: z.enum(['hold', 'linear', 'smooth', 'arc', 'orbit', 'follow', 'drawn']),
  referenceId: z.string().uuid().optional(),
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
    axisPart(spec.translation[0], 'avanti', 'indietro'),
    axisPart(spec.translation[1], 'destra', 'sinistra'),
    axisPart(spec.translation[2], 'alto', 'basso'),
    axisPart(spec.rotation[0], 'roll destro', 'roll sinistro'),
    axisPart(spec.rotation[1], 'pitch alto', 'pitch basso'),
    axisPart(spec.rotation[2], 'yaw destro', 'yaw sinistro'),
  ].filter(Boolean);
  if (spec.path === 'orbit') parts.unshift('orbita');
  if (spec.path === 'follow') parts.unshift('inseguimento');
  if (spec.path === 'drawn') parts.unshift('tratto disegnato');
  if (spec.constraints.lookAtReference) parts.push('soggetto inquadrato');
  return parts.join(' + ') || 'fermo';
}
