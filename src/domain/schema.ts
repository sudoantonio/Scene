import { z } from 'zod';

export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema.refine((v) => v.every((n) => n > 0), 'La scala deve essere positiva'),
});
export type Transform = z.infer<typeof TransformSchema>;

export const ObjectKindSchema = z.enum([
  'cube', 'sphere', 'cylinder', 'cone', 'plane', 'text', 'blend_asset', 'camera', 'area_light', 'point_light', 'sun_light',
]);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;

export const InterpolationSchema = z.enum(['constant', 'linear', 'bezier']);
export type Interpolation = z.infer<typeof InterpolationSchema>;
export const AnimPropertySchema = z.enum(['position', 'rotation', 'scale', 'visibility', 'text', 'lens']);
export type AnimProperty = z.infer<typeof AnimPropertySchema>;

export const KeyframeValueSchema = z.union([Vec3Schema, z.boolean(), z.string(), z.number()]);
export type KeyframeValue = z.infer<typeof KeyframeValueSchema>;

export const KeyframeSchema = z.object({
  id: z.string().uuid(),
  frame: z.number().int().positive(),
  property: AnimPropertySchema,
  value: KeyframeValueSchema,
  interpolation: InterpolationSchema,
  source: z.enum(['user', 'ai']).default('user'),
  commentIds: z.array(z.string().uuid()).default([]),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const SceneObjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: ObjectKindSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  visible: z.boolean(),
  transform: TransformSchema,
  text: z.string().default('Testo'),
  camera: z.object({ lens: z.number().positive() }).default({ lens: 50 }),
  light: z.object({ energy: z.number().nonnegative(), size: z.number().positive() }).default({ energy: 1000, size: 5 }),
  asset: z.object({
    sourcePath: z.string(),
    proxyPath: z.string(),
    collectionName: z.string().default(''),
    boundsCenter: Vec3Schema.default([0, 0, 0]),
    previewScale: z.number().finite().positive().default(1),
  }).default({ sourcePath: '', proxyPath: '', collectionName: '', boundsCenter: [0, 0, 0], previewScale: 1 }),
  sceneNotes: z.array(z.object({ frame: z.number().int().positive(), text: z.string() })).default([]),
  keyframes: z.array(KeyframeSchema).default([]),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const CommentSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  targetIds: z.array(z.string().uuid()),
  startFrame: z.number().int().positive(),
  endFrame: z.number().int().positive(),
  status: z.enum(['pending', 'applied']),
  kind: z.enum(['direction', 'transition']).optional(),
  scope: z.enum(['scene', 'framing', 'object']).optional(),
  sceneId: z.string().uuid().optional(),
  fromSceneId: z.string().uuid().optional(),
  toSceneId: z.string().uuid().optional(),
});
export type SceneComment = z.infer<typeof CommentSchema>;
export type TimelineCommentScope = 'scene' | 'framing' | 'object';

export const LightingPresetSchema = z.enum(['neutral', 'soft', 'warm', 'dramatic']);
export const LightingSettingsSchema = z.object({
  preset: LightingPresetSchema,
  intensity: z.number().min(0).max(2),
  direction: z.number().min(-180).max(180),
  elevation: z.number().min(0).max(90).default(45),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type LightingSettings = z.infer<typeof LightingSettingsSchema>;
export const defaultLighting = (): LightingSettings => ({ preset: 'neutral', intensity: 1, direction: 45, elevation: 45, color: '#ffffff' });

export const BackgroundSettingsSchema = z.object({
  kind: z.enum(['none', 'image', 'model']),
  path: z.string().default(''),
  name: z.string().default(''),
});
export type BackgroundSettings = z.infer<typeof BackgroundSettingsSchema>;
export const defaultBackground = (): BackgroundSettings => ({ kind: 'none', path: '', name: '' });

export const CameraFramingSchema = z.object({
  target: Vec3Schema,
  distance: z.number().finite().min(0.5).max(100),
});
export type CameraFraming = z.infer<typeof CameraFramingSchema>;
export const defaultCameraFraming = (): CameraFraming => ({ target: [0, 0, 0], distance: Math.sqrt(123) });

export const CameraCutSchema = z.object({
  id: z.string().uuid(),
  cameraId: z.string().uuid(),
  frame: z.number().int().positive(),
  source: z.enum(['user', 'ai']).default('user'),
  commentIds: z.array(z.string().uuid()).default([]),
  name: z.string().optional(),
  transition: z.enum(['cut', 'auto']).optional(),
  lighting: LightingSettingsSchema.default(defaultLighting),
  background: BackgroundSettingsSchema.default(defaultBackground),
  framing: CameraFramingSchema.default(defaultCameraFraming),
});
export type CameraCut = z.infer<typeof CameraCutSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal('AbacoSceneV1'),
  id: z.string().uuid(),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    fps: z.number().int().min(1).max(120),
    frameStart: z.number().int().positive(),
    frameEnd: z.number().int().positive(),
    resolutionX: z.number().int().positive(),
    resolutionY: z.number().int().positive(),
    units: z.literal('meters'),
  }),
  objects: z.array(SceneObjectSchema),
  comments: z.array(CommentSchema),
  cameraCuts: z.array(CameraCutSchema),
}).superRefine((project, ctx) => {
  if (project.settings.frameEnd < project.settings.frameStart) {
    ctx.addIssue({ code: 'custom', path: ['settings', 'frameEnd'], message: 'Il frame finale precede quello iniziale' });
  }
  const ids = new Set(project.objects.map((object) => object.id));
  const sceneIds = new Set(project.cameraCuts.map((scene) => scene.id));
  for (const comment of project.comments) {
    if (comment.endFrame < comment.startFrame) ctx.addIssue({ code: 'custom', message: 'Intervallo commento non valido' });
    for (const id of comment.targetIds) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `Oggetto commento inesistente: ${id}` });
    if (comment.sceneId && !sceneIds.has(comment.sceneId)) ctx.addIssue({ code: 'custom', message: `Scena commento inesistente: ${comment.sceneId}` });
  }
  for (const cut of project.cameraCuts) {
    const camera = project.objects.find((object) => object.id === cut.cameraId);
    if (!camera || camera.kind !== 'camera') ctx.addIssue({ code: 'custom', message: `Camera inesistente: ${cut.cameraId}` });
  }
});
export type AbacoProject = z.infer<typeof ProjectSchema>;

const OperationValueSchema = z.object({
  vector: Vec3Schema.nullable(),
  boolean: z.boolean().nullable(),
  text: z.string().nullable(),
  number: z.number().finite().nullable(),
});

export const PlanOperationSchema = z.object({
  id: z.string(),
  type: z.enum(['set_keyframe', 'set_camera_cut']),
  objectId: z.string().uuid(),
  frame: z.number().int().positive(),
  property: z.enum(['position', 'rotation', 'scale', 'visibility', 'text', 'lens', 'camera_cut']),
  value: OperationValueSchema,
  interpolation: InterpolationSchema,
  rationale: z.string(),
  commentIds: z.array(z.string().uuid()),
});
export type PlanOperation = z.infer<typeof PlanOperationSchema>;

export const BlenderPlanSchema = z.object({
  schemaVersion: z.literal('BlenderPlanV1'),
  summary: z.string(),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  operations: z.array(PlanOperationSchema),
});
export type BlenderPlan = z.infer<typeof BlenderPlanSchema>;

export const emptyTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

export function createSceneObject(kind: ObjectKind, index: number): SceneObject {
  const labels: Record<ObjectKind, string> = {
    cube: 'Cubo', sphere: 'Sfera', cylinder: 'Cilindro', cone: 'Cono', plane: 'Piano', text: 'Testo', blend_asset: 'Asset Blender',
    camera: 'Camera', area_light: 'Luce area', point_light: 'Luce punto', sun_light: 'Sole',
  };
  const transform = emptyTransform();
  if (kind === 'camera') {
    transform.position = [7, -7, 5];
    transform.rotation = [54.462, 39.136, 24.268];
  }
  if (kind.includes('light')) transform.position = [4, -4, 6];
  return {
    id: crypto.randomUUID(), name: `${labels[kind]} ${index}`, kind, color: kind.includes('light') ? '#fff1c7' : '#9cabb8',
    visible: true, transform, text: 'Testo', camera: { lens: 50 }, light: { energy: 1000, size: 5 },
    asset: { sourcePath: '', proxyPath: '', collectionName: '', boundsCenter: [0, 0, 0], previewScale: 1 }, sceneNotes: [], keyframes: [],
  };
}

export function createProject(): AbacoProject {
  const now = new Date().toISOString();
  const camera = createSceneObject('camera', 1);
  return {
    schemaVersion: 'AbacoSceneV1', id: crypto.randomUUID(), name: 'Nuovo animatic', createdAt: now, updatedAt: now,
    settings: { fps: 24, frameStart: 1, frameEnd: 72, resolutionX: 1920, resolutionY: 1080, units: 'meters' },
    objects: [camera], comments: [], cameraCuts: [{ id: crypto.randomUUID(), cameraId: camera.id, frame: 1, source: 'user', commentIds: [], name: 'Scena 1', transition: 'cut', lighting: defaultLighting(), background: defaultBackground(), framing: defaultCameraFraming() }],
  };
}
