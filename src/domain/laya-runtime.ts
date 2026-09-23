import type { Answer, Laya, Question } from '@receptron/laya';

export const LAYA_ONNX_REPOSITORY = 'receptron/laya-onnx';
export const LAYA_ONNX_REVISION = 'main';

export const layaModelFiles = [
  'laya.onnx',
  'laya.onnx.data',
  'laya_config.json',
  'tokenizer/tokenizer.json',
  'tokenizer/tokenizer_config.json',
] as const;

export function layaModelUrl(file: string) {
  return `https://huggingface.co/${LAYA_ONNX_REPOSITORY}/resolve/${LAYA_ONNX_REVISION}/${file}`;
}

export function layaLoadOptions<T>(onProgress: T) {
  return { repo: LAYA_ONNX_REPOSITORY, revision: LAYA_ONNX_REVISION, onProgress };
}

export type LayaSystemOneRuntime = Pick<Laya, 'systemOne'>;

const englishQuestionInstructions: Record<string, string> = {
  actionable: 'Does the user clearly request a movement or pose that can be converted to keyframes?',
  action: 'What is the main requested action? Use the local_interpretation hint when present.',
  direction: 'What is the main direction? Use the local_interpretation and axis_trigger_hints when present.',
  distance: 'How large should the movement be?',
  duration: 'How long should the movement last?',
  energy: 'How energetic should the movement feel?',
  path: 'What path shape should the movement use?',
  camera_requested: 'Does the instruction explicitly request movement or rotation of the selected camera?',
  camera_action: 'What is the main requested camera movement? Use camera_action_hint when present.',
  camera_distance: 'How large should the camera movement be?',
  camera_duration: 'How long should the camera movement last?',
  camera_path: 'What path shape should the camera use?',
  stroke_target: 'Does the drawn stroke represent the selected subject or the selected camera?',
  translate_x_positive: 'Should the selected target increase X, moving forward? The hint translate_x_positive means yes.',
  translate_x_negative: 'Should the selected target decrease X, moving backward? The hint translate_x_negative means yes.',
  translate_y_positive: 'Should the selected target increase Y, moving right? Looking right is rotation, not translation.',
  translate_y_negative: 'Should the selected target decrease Y, moving left? Looking left is rotation, not translation.',
  translate_z_positive: 'Should the selected target increase Z, moving up or jumping?',
  translate_z_negative: 'Should the selected target decrease Z, moving down or falling?',
  rotate_x_positive: 'Should the selected target roll positively around X?',
  rotate_x_negative: 'Should the selected target roll negatively around X?',
  rotate_y_positive: 'Should the selected target pitch positively around Y, looking up?',
  rotate_y_negative: 'Should the selected target pitch negatively around Y, looking down?',
  rotate_z_positive: 'Should the selected target yaw positively around Z, turning or looking right?',
  rotate_z_negative: 'Should the selected target yaw negatively around Z, turning or looking left?',
  rotation_amount: 'How large should the rotation be?',
};

const englishQuestionCriteria: Record<string, Record<string, string> | string[]> = {
  action: { move: 'change position', rise: 'move upward', descend: 'move downward', jump: 'jump and land', turn: 'change orientation', hold: 'remain still' },
  direction: { forward: 'forward into the scene', backward: 'backward', away_camera: 'away from camera', toward_camera: 'toward camera', left: 'left', right: 'right', up: 'up', down: 'down' },
  distance: ['0.25 meters', '0.5 meters', '1 meter', '2 meters', '4 meters'],
  duration: ['0.25 seconds', '0.5 seconds', '1 second', '2 seconds', '4 seconds'],
  energy: ['almost still', 'controlled', 'natural', 'strong', 'explosive'],
  path: { direct: 'straight linear path', smooth: 'smooth eased path', arc: 'curved or jump arc' },
  camera_action: { hold: 'camera remains still', push_in: 'camera moves toward subject', pull_out: 'camera moves away', truck_left: 'camera translates left', truck_right: 'camera translates right', rise: 'camera rises', descend: 'camera descends', pan_left: 'camera pans left', pan_right: 'camera pans right', tilt_up: 'camera tilts up', tilt_down: 'camera tilts down', orbit_left: 'camera orbits left', orbit_right: 'camera orbits right', follow_subject: 'camera follows subject' },
  camera_distance: ['0.25 meters', '0.5 meters', '1 meter', '2 meters', '4 meters'],
  camera_duration: ['0.25 seconds', '0.5 seconds', '1 second', '2 seconds', '4 seconds'],
  camera_path: { direct: 'straight linear path', smooth: 'smooth cinematic path', arc: 'curved or orbital path' },
  stroke_target: { subject: 'selected subject trajectory', camera: 'selected camera trajectory' },
  rotation_amount: ['10 degrees', '20 degrees', '45 degrees', '90 degrees', '180 degrees'],
};

export function compactLayaState(state: unknown) {
  const source = state as Record<string, any>;
  return {
    instruction: source.instruction,
    selected_target: source.selected_target,
    local_interpretation: source.natural_language_hints,
    axis_trigger_hints: source.axis_trigger_hints,
    camera_action_hint: source.camera_action_hint,
    current_frame: source.current_frame,
    scene_end_frame: source.scene_end_frame,
    start_position_meters: source.start_position_meters,
    start_rotation_degrees: source.start_rotation_degrees,
    active_camera: source.active_camera,
    camera_focus_target: source.camera_focus_target,
    drawn_stroke: source.drawn_stroke,
    coordinate_system: 'X forward/backward, Y right/left, Z up/down. Rotation X roll, Y pitch, Z yaw.',
  };
}

export function prepareLayaQuestion(name: string, question: Question): Question {
  const instructions = englishQuestionInstructions[name];
  const criteria = englishQuestionCriteria[name];
  return instructions ? { ...question, instructions, ...(criteria ? { criteria } : {}) } as Question : question;
}

/**
 * Laya builds one ONNX batch row for every question. Scene asks several independent
 * questions for each action, so running them together can allocate multiple GB of
 * temporary tensors and terminate Electron inside the native ONNX runtime.
 *
 * Keep the batch at one row and merge the compatible System One response. The model
 * stays loaded, while temporary inference memory can be reused between questions.
 */
export async function runLayaQuestions(
  runtime: LayaSystemOneRuntime,
  state: unknown,
  questions: Record<string, Question>,
) {
  const answers: Record<string, Answer> = {};
  let model = 'laya';
  let inputTokens = 0;
  let outputTokens = 0;
  const compactState = compactLayaState(state);

  for (const [name, question] of Object.entries(questions)) {
    const result = await runtime.systemOne(compactState, { [name]: prepareLayaQuestion(name, question) });
    model = result.model;
    Object.assign(answers, result.answers);
    inputTokens += result.usage.input_tokens;
    outputTokens += result.usage.output_tokens;
  }

  return {
    model,
    answers,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
