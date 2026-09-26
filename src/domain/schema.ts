import { z } from 'zod';
import { MotionSpecSchema } from './motion-spec';
import { createBundledStandard } from './bundled-animation-standard';
import { FONT_OPTIONS, type FontId } from './text-style';

export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema.refine((v) => v.every((n) => n > 0), 'Scale must be positive'),
});
export type Transform = z.infer<typeof TransformSchema>;

export const ObjectKindSchema = z.enum([
  'cube', 'sphere', 'cylinder', 'cone', 'plane', 'text', 'audio', 'blend_asset', 'camera', 'area_light', 'point_light', 'sun_light',
]);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;

export const InterpolationSchema = z.enum(['constant', 'linear', 'bezier']);
export type Interpolation = z.infer<typeof InterpolationSchema>;
export const AnimPropertySchema = z.enum(['position', 'rotation', 'scale', 'visibility', 'text', 'lens']);
export type AnimProperty = z.infer<typeof AnimPropertySchema>;

export const KeyframeValueSchema = z.union([Vec3Schema, z.boolean(), z.string(), z.number()]);
export type KeyframeValue = z.infer<typeof KeyframeValueSchema>;

export function isValidAnimationValue(property: string, value: unknown): value is KeyframeValue {
  if (property === 'position' || property === 'rotation' || property === 'scale') {
    return Array.isArray(value) && value.length === 3
      && value.every((component) => typeof component === 'number' && Number.isFinite(component)
        && (property !== 'scale' || component > 0));
  }
  if (property === 'visibility') return typeof value === 'boolean';
  if (property === 'text') return typeof value === 'string';
  return property === 'lens' && typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const KeyframeSchema = z.object({
  id: z.string().uuid(),
  frame: z.number().int().positive(),
  property: AnimPropertySchema,
  value: KeyframeValueSchema,
  interpolation: InterpolationSchema,
  holdFrames: z.number().int().nonnegative().optional(),
  source: z.enum(['user', 'ai']).default('user'),
  purpose: z.enum(['snapshot', 'motion']).optional(),
  directionActionId: z.string().uuid().optional(),
  commentIds: z.array(z.string().uuid()).default([]),
}).superRefine((key, ctx) => {
  if (!isValidAnimationValue(key.property, key.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: `Invalid value for ${key.property}` });
  }
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const SceneObjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: ObjectKindSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.enum(FONT_OPTIONS.map((option) => option.id) as [FontId, ...FontId[]]).default('system'),
  visible: z.boolean(),
  transform: TransformSchema,
  text: z.string().default('Text'),
  camera: z.object({ lens: z.number().positive() }).default({ lens: 50 }),
  light: z.object({ energy: z.number().nonnegative(), size: z.number().positive() }).default({ energy: 1000, size: 5 }),
  asset: z.object({
    sourcePath: z.string(),
    proxyPath: z.string(),
    collectionName: z.string().default(''),
    boundsCenter: Vec3Schema.default([0, 0, 0]),
    previewScale: z.number().finite().positive().default(1),
    groundOffset: z.number().finite().nonnegative().default(1),
    controllers: z.array(z.object({ name: z.string().min(1), position: Vec3Schema, worldPosition: Vec3Schema.optional(), worldBasis: z.tuple([Vec3Schema, Vec3Schema, Vec3Schema]).optional(), morphTargets: z.tuple([z.string(), z.string(), z.string()]).optional(), morphStep: z.number().positive().optional() })).optional(),
    controllerKeys: z.array(z.object({ name: z.string().min(1), frame: z.number().int().positive(), offset: Vec3Schema, source: z.enum(['user', 'ai']).optional(), directionActionId: z.string().uuid().optional(), interpolation: InterpolationSchema.optional() })).optional(),
  }).default({ sourcePath: '', proxyPath: '', collectionName: '', boundsCenter: [0, 0, 0], previewScale: 1, groundOffset: 1 }),
  audio: z.object({
    duration: z.number().finite().nonnegative().default(0),
    volume: z.number().finite().min(0).max(1).default(1),
    muted: z.boolean().default(false),
    loop: z.boolean().default(false),
    trimStart: z.number().finite().nonnegative().default(0),
    trimEnd: z.number().finite().nonnegative().default(0),
    fadeIn: z.number().finite().nonnegative().default(0),
    fadeOut: z.number().finite().nonnegative().default(0),
    waveform: z.array(z.number().finite().min(0).max(1)).max(8192).default([]),
    captions: z.array(z.object({ id: z.string().uuid(), start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative(), text: z.string(), position: z.tuple([z.number().min(.05).max(.95), z.number().min(.08).max(.98)]).optional() })).default([]),
    captionStyle: z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), fontFamily: z.enum(FONT_OPTIONS.map((option) => option.id) as [FontId, ...FontId[]]), size: z.number().min(.65).max(1.6), position: z.tuple([z.number().min(.05).max(.95), z.number().min(.08).max(.98)]).default([.5, .95]) }).default({ color: '#ffffff', fontFamily: 'system', size: 1, position: [.5, .95] }),
    applyCaptionPositionToAll: z.boolean().default(true),
    showCaptions: z.boolean().default(true),
  }).default({ duration: 0, volume: 1, muted: false, loop: false, trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0, waveform: [], captions: [], captionStyle: { color: '#ffffff', fontFamily: 'system', size: 1, position: [.5, .95] }, applyCaptionPositionToAll: true, showCaptions: true }),
  screenSpace: z.boolean().default(false),
  sceneIds: z.array(z.string().uuid()).default([]),
  screenCrop: z.tuple([z.number().min(0).max(.45), z.number().min(0).max(.45), z.number().min(0).max(.45), z.number().min(0).max(.45)]).default([0, 0, 0, 0]),
  sceneNotes: z.array(z.object({ frame: z.number().int().positive(), text: z.string() })).default([]),
  keyframes: z.array(KeyframeSchema).default([]),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const DirectionPresetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/), label: z.string().min(1),
  category: z.enum(['emotion', 'movement', 'camera']), version: z.number().int().positive(),
  prompt: z.string().min(1).max(20000),
});
export type DirectionPreset = z.infer<typeof DirectionPresetSchema>;
export const AnimationStandardSchema = z.object({
  name: z.string().min(1).max(255), content: z.string().trim().min(1).max(500000),
  attachedAt: z.string(), version: z.string().optional(),
});
export type AnimationStandard = z.infer<typeof AnimationStandardSchema>;

export const CommentSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  presets: z.array(DirectionPresetSchema).max(64).optional(),
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
export const defaultCameraFraming = (): CameraFraming => ({ target: [0, 0, 1], distance: Math.sqrt(114) });

export const CameraCutSchema = z.object({
  id: z.string().uuid(),
  cameraId: z.string().uuid(),
  frame: z.number().int().positive(),
  source: z.enum(['user', 'ai']).default('user'),
  commentIds: z.array(z.string().uuid()).default([]),
  name: z.string().optional(),
  transition: z.enum(['cut', 'auto']).optional(),
  actionContinuity: z.enum(['unspecified', 'continue', 'hold', 'new_action']).optional(),
  lighting: LightingSettingsSchema.default(defaultLighting),
  background: BackgroundSettingsSchema.default(defaultBackground),
  framing: CameraFramingSchema.default(defaultCameraFraming),
});
export type CameraCut = z.infer<typeof CameraCutSchema>;

export const DirectionPlanSchema = z.object({
  id: z.string().uuid(), sceneId: z.string().uuid(), objectId: z.string().uuid(),
  instruction: z.string(), startFrame: z.number().int(), endFrame: z.number().int(),
  constraints: z.array(z.string()).optional(),
  gesture: z.unknown().optional(),
  prompts: z.array(z.object({
    instruction: z.string(),
    mode: z.enum(['new', 'refine', 'continue', 'correct']),
  })).optional(),
  actions: z.array(z.object({
    id: z.string().uuid(), instruction: z.string(), motion: z.string(),
    characterAction: z.string().optional(),
    relation: z.enum(['then', 'with']), startFrame: z.number().int(), endFrame: z.number().int(),
    referenceId: z.string().uuid().optional(), keepInFrame: z.boolean(),
    distanceMeters: z.number(), durationSeconds: z.number(), durationExplicit: z.boolean().optional(),
    motionSpec: MotionSpecSchema.optional(),
    performance: z.object({
      instruction: z.string(), sceneDirection: z.array(z.string()),
      energy: z.number().min(0).max(4).optional(),
      timing: z.enum(['explicit', 'suggested']), coordinates: z.literal('preview'),
      availableFrames: z.tuple([z.number().int(), z.number().int()]),
    }).optional(),
    decision: z.record(z.unknown()).optional(),
  })),
});
export type DirectionPlan = z.infer<typeof DirectionPlanSchema>;

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
  animationStandard: AnimationStandardSchema.optional(),
  animationStandardDisabled: z.boolean().optional(),
  animationHandoff: z.object({
    version: z.literal(1), role: z.literal('storyboard'),
    standardVersion: z.string().optional(),
    issues: z.array(z.object({ severity: z.enum(['info', 'warning', 'error']), code: z.string(), message: z.string(), planId: z.string().optional() })),
  }).optional(),
  animationBrief: z.string().optional(),
  directionPlans: z.array(DirectionPlanSchema).optional(),
  objects: z.array(SceneObjectSchema),
  groups: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1), memberIds: z.array(z.string().uuid()).min(2) })).default([]),
  comments: z.array(CommentSchema),
  cameraCuts: z.array(CameraCutSchema),
}).superRefine((project, ctx) => {
  if (project.settings.frameEnd < project.settings.frameStart) {
    ctx.addIssue({ code: 'custom', path: ['settings', 'frameEnd'], message: 'The end frame is before the start frame' });
  }
  const ids = new Set(project.objects.map((object) => object.id));
  const grouped = new Set<string>();
  for (const group of project.groups) {
    for (const id of group.memberIds) {
      if (!ids.has(id) || grouped.has(id)) ctx.addIssue({ code: 'custom', message: `Invalid group member: ${id}` });
      grouped.add(id);
    }
  }
  const sceneIds = new Set(project.cameraCuts.map((scene) => scene.id));
  for (const comment of project.comments) {
    if (comment.endFrame < comment.startFrame) ctx.addIssue({ code: 'custom', message: 'Intervallo commento non valido' });
    for (const id of comment.targetIds) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `Comment object not found: ${id}` });
    if (comment.sceneId && !sceneIds.has(comment.sceneId)) ctx.addIssue({ code: 'custom', message: `Comment scene not found: ${comment.sceneId}` });
  }
  for (const cut of project.cameraCuts) {
    const camera = project.objects.find((object) => object.id === cut.cameraId);
    if (!camera || camera.kind !== 'camera') ctx.addIssue({ code: 'custom', message: `Camera not found: ${cut.cameraId}` });
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
  type: z.enum(['set_keyframe', 'set_camera_cut', 'set_controller_pose']),
  objectId: z.string().uuid(),
  frame: z.number().int().positive(),
  property: z.enum(['position', 'rotation', 'scale', 'visibility', 'text', 'lens', 'camera_cut', 'controller_pose']),
  controllerName: z.string().min(1).nullish().transform(value => value ?? undefined),
  directionActionId: z.string().uuid().optional(),
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
  directionPlan: DirectionPlanSchema.optional(),
});
export type BlenderPlan = z.infer<typeof BlenderPlanSchema>;

export const emptyTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

export function createSceneObject(kind: ObjectKind, index: number): SceneObject {
  const labels: Record<ObjectKind, string> = {
    cube: 'Cube', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone', plane: 'Plane', text: 'Text', audio: 'Audio', blend_asset: 'Blender asset',
    camera: 'Camera', area_light: 'Area light', point_light: 'Point light', sun_light: 'Sun',
  };
  const transform = emptyTransform();
  if (['cube', 'sphere', 'cylinder', 'cone'].includes(kind)) transform.position = [0, 0, 1];
  if (kind === 'text') transform.scale = [1, 1, 1];
  if (kind === 'plane') transform.position = [0, 0, 0.01];
  if (kind === 'camera') {
    transform.position = [7, -7, 5];
    transform.rotation = [60.255, 40.966, 20.538];
  }
  if (kind.includes('light')) transform.position = [4, -4, 6];
  const professionalColors: Record<ObjectKind, string> = {
    cube: '#7e8c94', sphere: '#899084', cylinder: '#887f76', cone: '#827b74', plane: '#717b78', text: '#718292', audio: '#d1a12a',
    blend_asset: '#777984', camera: '#d1a12a', area_light: '#f2dfac', point_light: '#f2dfac', sun_light: '#f2dfac',
  };
  return {
    id: crypto.randomUUID(), name: `${labels[kind]} ${index}`, kind, color: professionalColors[kind], fontFamily: 'system',
    visible: true, transform, text: 'Text', camera: { lens: 50 }, light: { energy: 1000, size: 5 },
    asset: { sourcePath: '', proxyPath: '', collectionName: '', boundsCenter: [0, 0, 0], previewScale: 1, groundOffset: 1 },
    audio: { duration: 0, volume: 1, muted: false, loop: false, trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0, waveform: [], captions: [], captionStyle: { color: '#ffffff', fontFamily: 'system', size: 1, position: [.5, .95] }, applyCaptionPositionToAll: true, showCaptions: true },
    screenSpace: kind === 'text', sceneIds: [], screenCrop: [0, 0, 0, 0], sceneNotes: [], keyframes: [],
  };
}

export function createProject(): AbacoProject {
  const now = new Date().toISOString();
  const camera = createSceneObject('camera', 1);
  return {
    schemaVersion: 'AbacoSceneV1', id: crypto.randomUUID(), name: 'New animatic', createdAt: now, updatedAt: now,
    settings: { fps: 24, frameStart: 1, frameEnd: 72, resolutionX: 1920, resolutionY: 1080, units: 'meters' },
    animationStandard: createBundledStandard(now),
    objects: [camera], groups: [], comments: [], cameraCuts: [{ id: crypto.randomUUID(), cameraId: camera.id, frame: 1, source: 'user', commentIds: [], name: 'Scene 1', transition: 'cut', lighting: defaultLighting(), background: defaultBackground(), framing: defaultCameraFraming() }],
  };
}
