import { describe, expect, it } from 'vitest';
import { LAYA_ONNX_REPOSITORY, compactLayaState, layaLoadOptions, layaModelFiles, layaModelUrl, runLayaQuestions, type LayaSystemOneRuntime } from './laya-runtime';

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
    const states: unknown[] = [];
    const instructions: string[] = [];
    const runtime = {
      systemOne: async (state: unknown, questions: Record<string, { type: string; instructions: string }>) => {
        const names = Object.keys(questions);
        calls.push(names);
        states.push(state);
        instructions.push(questions[names[0]!]!.instructions);
        return {
          model: 'laya-local',
          answers: Object.fromEntries(names.map((name) => [name, { type: 'noul', noul: 0.75 }])),
          usage: { input_tokens: 10, output_tokens: 1 },
        };
      },
    };

    const result = await runLayaQuestions(runtime as unknown as LayaSystemOneRuntime, { instruction: 'vai avanti', scene_context: { very_large: 'x'.repeat(20_000) }, natural_language_hints: { action: 'move', direction: 'forward' } }, {
      translate_x: { type: 'choice', instructions: 'Muovi su X', criteria: { increase: 'avanti', decrease: 'indietro', hold: 'fermo' } },
      move_y: { type: 'noul', instructions: 'Move on Y' },
      rotate_z: { type: 'noul', instructions: 'Rotate on Z' },
    });

    expect(calls).toEqual([['translate_x'], ['move_y'], ['rotate_z']]);
    expect(Object.keys(result.answers)).toEqual(['translate_x', 'move_y', 'rotate_z']);
    expect(result.usage).toEqual({ input_tokens: 30, output_tokens: 3 });
    expect(states[0]).toEqual(expect.objectContaining({ instruction: 'vai avanti', local_interpretation: { action: 'move', direction: 'forward' } }));
    expect(JSON.stringify(states[0])).not.toContain('very_large');
    expect(instructions[0]).toMatch(/^Along X/);
  });

  it('keeps the compact state below the English checkpoint context budget', () => {
    const state = compactLayaState({ instruction: 'cammina verso destra', scene_context: { objects: Array(100).fill({ notes: 'molto testo' }) }, natural_language_hints: { action: 'move', direction: 'right' } });
    expect(JSON.stringify(state).length).toBeLessThan(2_000);
    expect(state).toMatchObject({ instruction: 'cammina verso destra', local_interpretation: { action: 'move', direction: 'right' } });
  });
});
