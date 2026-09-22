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
