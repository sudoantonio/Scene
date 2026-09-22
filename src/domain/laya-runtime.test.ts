import { describe, expect, it } from 'vitest';
import { LAYA_ONNX_REPOSITORY, layaLoadOptions, layaModelFiles, layaModelUrl } from './laya-runtime';

describe('Laya local runtime', () => {
  it('uses the published root bundle without an unavailable checkpoint subfolder', () => {
    const options = layaLoadOptions(() => undefined);
    expect(options).toMatchObject({ repo: 'receptron/laya-onnx', revision: 'main' });
    expect(options).not.toHaveProperty('subfolder');
    expect(LAYA_ONNX_REPOSITORY).toBe('receptron/laya-onnx');
    expect(layaModelFiles).toContain('laya.onnx');
    expect(layaModelUrl('laya.onnx')).toBe('https://huggingface.co/receptron/laya-onnx/resolve/main/laya.onnx');
  });
});
