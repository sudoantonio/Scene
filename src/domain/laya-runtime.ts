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
  temporal_structure: 'How are the requested actions related in time? Treat then as sequential and while as simultaneous.',
  motion_family: 'Which broad motion family best describes the selected target action? Use local_interpretation.family when present.',
  motion: 'Which single semantic motion primitive best represents the requested action? Use local_interpretation.motion when it is present.',
  reference_object: 'Which listed scene object is explicitly named or implied as the action reference? Choose none when there is no specific reference.',
  action: 'What is the main requested action? Use the local_interpretation hint when present.',
  direction: 'What is the main direction? Use the local_interpretation when present.',
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
  translate_x: 'Along X, should the selected target move forward, backward, or hold?',
  translate_y: 'Along Y, should the selected target move right, left, or hold?',
  translate_z: 'Along Z, should the selected target move up, down, or hold?',
  rotate_x: 'Should roll around X increase, decrease, or hold?',
  rotate_y: 'Should pitch around Y increase, decrease, or hold?',
  rotate_z: 'Should yaw around Z increase, decrease, or hold?',
  rotation_amount: 'How large should the rotation be?',
};

const englishQuestionCriteria: Record<string, Record<string, string> | string[]> = {
  temporal_structure: { single: 'one action', sequential: 'actions happen one after another', simultaneous: 'actions happen during the same interval', mixed: 'simultaneous actions followed or preceded by sequential actions' },
  motion_family: {
    locomotion: 'horizontal or radial subject translation', vertical: 'subject rise, descend, or jump', orientation: 'subject turn, look, or roll', pose: 'remain still', path: 'follow a drawn path',
    camera_translation: 'camera dolly, truck, or vertical translation', camera_orientation: 'camera pan, tilt, or roll', camera_orbit: 'camera orbit or subject follow',
  },
  motion: {
    hold: 'remain still', move_forward: 'move forward into the scene', move_backward: 'move backward', move_left: 'move screen-left', move_right: 'move screen-right',
    move_forward_left: 'move diagonally forward-left', move_forward_right: 'move diagonally forward-right', move_backward_left: 'move diagonally backward-left', move_backward_right: 'move diagonally backward-right',
    move_up: 'move upward', move_down: 'move downward', jump_in_place: 'jump and land in place', jump_forward: 'jump forward', turn_left: 'turn left in place', turn_right: 'turn right in place',
    look_up: 'pitch upward', look_down: 'pitch downward', roll_left: 'roll left', roll_right: 'roll right', move_away_camera: 'move radially away from camera', move_toward_camera: 'move radially toward camera',
    move_toward_object: 'move toward a named scene object', move_away_object: 'move away from a named scene object', look_at_object: 'turn to face a named scene object',
    follow_drawn_path: 'follow the supplied drawn path', dolly_in: 'camera moves toward subject', dolly_out: 'camera moves away from subject', truck_left: 'camera translates left', truck_right: 'camera translates right',
    pedestal_up: 'camera rises', pedestal_down: 'camera descends', pan_left: 'camera pans left', pan_right: 'camera pans right', tilt_up: 'camera tilts up', tilt_down: 'camera tilts down',
    orbit_left: 'camera orbits left around subject', orbit_right: 'camera orbits right around subject', follow_subject: 'camera follows subject',
  },
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
  translate_x: { increase: 'move forward', decrease: 'move backward', hold: 'no X movement' },
  translate_y: { increase: 'move right', decrease: 'move left', hold: 'no Y movement' },
  translate_z: { increase: 'move up or jump', decrease: 'move down or fall', hold: 'no Z movement' },
  rotate_x: { increase: 'positive roll', decrease: 'negative roll', hold: 'no X rotation' },
  rotate_y: { increase: 'look up', decrease: 'look down', hold: 'no Y rotation' },
  rotate_z: { increase: 'turn or look right', decrease: 'turn or look left', hold: 'no Z rotation' },
  rotation_amount: ['10 degrees', '20 degrees', '45 degrees', '90 degrees', '180 degrees'],
};

export function compactLayaState(state: unknown) {
  const source = state as Record<string, any>;
  return {
    instruction: source.instruction,
    selected_target: source.selected_target,
    local_interpretation: source.natural_language_hints,
    selected_motion_family: source.selected_motion_family,
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
  const translated = englishQuestionCriteria[name];
  const original = (question as { criteria?: Record<string, string> | string[] }).criteria;
  const criteria = translated && original && !Array.isArray(translated) && !Array.isArray(original)
    ? Object.fromEntries(Object.keys(original).map((key) => [key, translated[key] ?? original[key]]))
    : translated;
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
