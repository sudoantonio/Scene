import { describe, expect, it } from 'vitest';
import { LAYA_ONNX_REPOSITORY, layaLoadOptions, layaModelFiles, layaModelUrl, runLayaQuestions, type LayaSystemOneRuntime } from './laya-runtime';

describe('Laya local runtime', () => {
  it('uses the published root bundle without an unavailable checkpoint subfolder', () => {
    const options = layaLoadOptions(() => undefined);
    expect(options).toMatchObject({ repo: 'receptron/laya-onnx', revision: 'main' });
    expect(options).not.toHaveProperty('subfolder');
    expect(LAYA_ONNX_REPOSITORY).toBe('receptron/laya-onnx');
    expect(layaModelFiles).toContain('laya.onnx');
    expect(layaModelUrl('laya.onnx')).toBe('https://huggingface.co/receptron/laya-onnx/resolve/main/laya.onnx');
  });

  it('runs every question in its own inference batch and merges the answers', async () => {
    const calls: string[][] = [];
    const runtime = {
      systemOne: async (_state: unknown, questions: Record<string, { type: string }>) => {
        const names = Object.keys(questions);
        calls.push(names);
        return {
          model: 'laya-local',
          answers: Object.fromEntries(names.map((name) => [name, { type: 'noul', noul: 0.75 }])),
          usage: { input_tokens: 10, output_tokens: 1 },
        };
      },
    };

    const result = await runLayaQuestions(runtime as unknown as LayaSystemOneRuntime, { scene: 'one' }, {
      move_x: { type: 'noul', instructions: 'Move on X' },
      move_y: { type: 'noul', instructions: 'Move on Y' },
      rotate_z: { type: 'noul', instructions: 'Rotate on Z' },
    });

    expect(calls).toEqual([['move_x'], ['move_y'], ['rotate_z']]);
    expect(Object.keys(result.answers)).toEqual(['move_x', 'move_y', 'rotate_z']);
    expect(result.usage).toEqual({ input_tokens: 30, output_tokens: 3 });
  });
});
