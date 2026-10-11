import { describe, expect, it } from 'vitest';
import { applyAgentCommands } from './agent-commands';
import { evaluateTransform } from './animation';
import { createProject, ProjectSchema } from './schema';

const makeBeat = (sceneId: string, focusElementId?: string) => ({ sceneId, startOffsetFrames: 0, durationFrames: 48, dialogue: 'Ub, è davvero casa tua?', intention: 'Sorprendere e mostrare la casa', visualAction: 'Ub reagisce davanti alla casa', emotion: 'sorpresa', focusElementId, surface: 'none' as const, pace: 'quick' as const });

describe('scaletta e regia MCP', () => {
  it('salva battute nel progetto, rifiuta tempi fuori scena e mantiene gli ID in correzione', () => {
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'La casa', durationFrames: 72 }]);
    const sceneId = project.cameraCuts[0].id;
    project = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'Ub, è davvero casa tua?', beats: [makeBeat(sceneId)] }]);
    const beatId = project.storyboard!.beats[0].id;
    expect(ProjectSchema.parse(project).storyboard?.beats[0].id).toBe(beatId);
    project = applyAgentCommands(project, [{ type: 'update_story_beat', beatId, intention: 'Mostrare la sorpresa prima della spiegazione' }]);
    expect(project.storyboard?.beats[0]).toMatchObject({ id: beatId, intention: 'Mostrare la sorpresa prima della spiegazione' });
    expect(() => applyAgentCommands(project, [{ type: 'set_storyboard', script: '', beats: [{ ...makeBeat(sceneId), durationFrames: 100 }] }])).toThrow(/Storyboard beat exceeds scene/);
  });

  it('applica una regia breve, annullabile e modificabile con camera, reazione e testo sulla lavagna', () => {
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'Spiegazione', durationFrames: 72 }]);
    const sceneId = project.cameraCuts[0].id;
    project = applyAgentCommands(project, [{ type: 'add_element', sceneId, kind: 'cube', name: 'Ub' }]);
    const ubId = project.objects.find((item) => item.name === 'Ub')!.id;
    const assetId = crypto.randomUUID();
    project = applyAgentCommands(project, [{ type: 'set_scene_background', sceneId, assetId }], [{ id: assetId, kind: 'model', name: 'salotto.glb', sourcePath: '/tmp/salotto.glb', landmarks: [{ name: 'Lavagna • superficie bianca', position: [2, 1, 2] }] }]);
    project = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'La bolla AI', beats: [makeBeat(sceneId, ubId)] }]);
    const beatId = project.storyboard!.beats[0].id;
    const directed = applyAgentCommands(project, [{ type: 'direct_beat', beatId, actions: [
      { action: 'focus', elementId: ubId, framing: 'medium', transition: 'cut' },
      { action: 'react', elementId: ubId, reaction: 'surprised' },
      { action: 'show_on_surface', surface: 'board', text: 'Profitti < aspettative' },
    ] }]);
    const boardText = directed.objects.find((item) => item.name.includes('Lavagna •'))!;
    expect(boardText.text).toBe('Profitti < aspettative');
    expect(boardText.screenSpace).toBe(false);
    expect(Math.hypot(...evaluateTransform(boardText, 1).position.map((value, axis) => value - [2, 1, 2][axis]))).toBeCloseTo(.08, 3);
    expect(boardText.transform.scale[0]).toBeLessThan(1);
    expect(directed.agentMotions).toHaveLength(1);
    expect(directed.objects.find((item) => item.id === ubId)!.keyframes.some((key) => key.purpose === 'motion')).toBe(true);
    expect(ProjectSchema.parse(directed).storyboard?.beats[0].id).toBe(beatId);
  });

  it('richiede asset autorizzati e una superficie nota prima di mostrare media', () => {
    const project = createProject();
    const sceneId = project.cameraCuts[0].id;
    const planned = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'Grafico', beats: [makeBeat(sceneId)] }]);
    const beatId = planned.storyboard!.beats[0].id;
    const assetId = crypto.randomUUID();
    expect(() => applyAgentCommands(planned, [{ type: 'direct_beat', beatId, actions: [{ action: 'show_on_surface', surface: 'tv', assetId }] }])).toThrow(/not authorized/);
    expect(() => applyAgentCommands(planned, [{ type: 'direct_beat', beatId, actions: [{ action: 'show_on_surface', surface: 'tv', text: 'Grafico' }] }])).toThrow(/Surface tv not found/);
    const shown = applyAgentCommands(planned, [{ type: 'direct_beat', beatId, actions: [{ action: 'show_on_surface', surface: 'tv', text: 'Grafico', anchor: [1, 2, 3] }] }]);
    expect(shown.objects.at(-1)?.transform.position).toEqual([1, 2, 3]);
    const withTv = applyAgentCommands(planned, [{ type: 'add_element', sceneId, kind: 'cube', name: 'TV', transform: { position: [4, 0, 2] } }]);
    const placed = applyAgentCommands(withTv, [{ type: 'direct_beat', beatId, actions: [{ action: 'show_on_surface', surface: 'tv', text: 'Grafico' }] }]);
    expect(Math.hypot(...placed.objects.at(-1)!.transform.position.map((value, axis) => value - [4, 0, 2][axis]))).toBeCloseTo(.08, 3);
    expect(placed.objects.at(-1)?.transform.scale[0]).toBeLessThan(1);
  });

  it('inquadra la superficie GLB usando centro, normale e dimensioni', () => {
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'Lavagna', durationFrames: 72 }]);
    const sceneId = project.cameraCuts[0].id;
    const assetId = crypto.randomUUID();
    project = applyAgentCommands(project, [{ type: 'set_scene_background', sceneId, assetId }], [{ id: assetId, kind: 'model', name: 'salotto.glb', sourcePath: '/tmp/salotto.glb', landmarks: [{ name: 'Lavagna • superficie bianca', position: [6, 0, 3], normal: [-1, 0, 0], width: 4, height: 2 }] }]);
    project = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'Costi', beats: [{ ...makeBeat(sceneId), surface: 'board' }] }]);
    const beatId = project.storyboard!.beats[0].id;
    project = applyAgentCommands(project, [{ type: 'direct_beat', beatId, actions: [{ action: 'focus_surface', surface: 'board', framing: 'medium' }, { action: 'show_on_surface', surface: 'board', text: 'Costi ↑ e profitti ↓' }] }]);
    const camera = project.objects.find((object) => object.id === project.cameraCuts[0].cameraId)!;
    expect(evaluateTransform(camera, 1).position[0]).toBeLessThan(6);
    const text = project.objects.find((object) => object.name.includes('Lavagna •'))!;
    expect(text.transform.scale[0]).toBeLessThan(1);
    expect(text.transform.position[0]).toBeLessThan(6);
    expect(text.text).toContain('Costi +');
    expect(text.text).toContain('profitti -');
    expect(text.color).toBe('#17212a');
  });
});
