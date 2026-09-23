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

  for (const [name, question] of Object.entries(questions)) {
    const result = await runtime.systemOne(state, { [name]: question });
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
