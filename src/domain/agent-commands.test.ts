import { describe, expect, it } from 'vitest';
import { agentSummary, applyAgentCommands } from './agent-commands';
import { createProject, ProjectSchema } from './schema';

describe('comandi animatic per MCP e chat', () => {
  it('crea scene, elementi e movimento in un progetto valido', () => {
    let project = applyAgentCommands(createProject(), [
      { type: 'create_project', name: 'Ub e la bolla AI', fps: 24, width: 1920, height: 1080 },
      { type: 'add_scene', name: 'La casa', durationFrames: 120, camera: { position: [7, -9, 5], target: [0, 0, 1.5], lens: 42 } },
      { type: 'add_scene', name: 'Il mercato', durationFrames: 144 },
    ]);
    expect(project.cameraCuts.map((scene) => scene.frame)).toEqual([1, 121]);
    const firstId = project.cameraCuts[0].id;
    project = applyAgentCommands(project, [
      { type: 'add_element', sceneId: firstId, kind: 'cube', name: 'Casa', color: '#ffd08a', transform: { position: [0, 0, 1], scale: [2, 2, 2] } },
      { type: 'set_scene_note', sceneId: firstId, text: '[shocked] Ub... is that your new house?!' },
    ]);
    const house = project.objects.find((object) => object.name === 'Casa')!;
    project = applyAgentCommands(project, [{ type: 'animate', sceneId: firstId, elementId: house.id, property: 'position', keys: [{ offsetFrames: 90, value: [1, 0, 1], interpolation: 'linear' }] }]);
    expect(house.id).toBeTruthy();
    expect(project.objects.find((object) => object.id === house.id)?.keyframes.some((key) => key.frame === 91)).toBe(true);
    expect(agentSummary(project).scenes).toHaveLength(2);
    expect(ProjectSchema.parse(project).id).toBe(project.id);
  });

  it('rifiuta asset non autorizzati senza mutare il progetto originale', () => {
    const project = createProject();
    const before = JSON.stringify(project);
    expect(() => applyAgentCommands(project, [{ type: 'add_element', sceneId: project.cameraCuts[0].id, kind: 'image', name: 'Casa', assetId: crypto.randomUUID() }])).toThrow(/Asset not selected/);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('sposta le scene successive quando cambia la durata', () => {
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'Prima', durationFrames: 30 }, { type: 'add_scene', name: 'Seconda', durationFrames: 40 }]);
    project = applyAgentCommands(project, [{ type: 'update_scene', sceneId: project.cameraCuts[0].id, durationFrames: 60 }]);
    expect(project.cameraCuts[1].frame).toBe(61);
    expect(project.settings.frameEnd).toBe(100);
  });

  it('nasconde gli elementi prima e dopo la propria scena e autorizza lo sfondo GLB', () => {
    const sourcePath = '/tmp/casa.glb';
    const assetId = crypto.randomUUID();
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'Prima', durationFrames: 30 }, { type: 'add_scene', name: 'Seconda', durationFrames: 40 }]);
    const sceneId = project.cameraCuts[1].id;
    project = applyAgentCommands(project, [
      { type: 'set_scene_background', sceneId, assetId },
      { type: 'add_element', sceneId, kind: 'cube', name: 'Grafico' },
    ], [{ id: assetId, kind: 'model', name: 'Casa', sourcePath }]);
    const graphic = project.objects.find((object) => object.name === 'Grafico')!;
    expect(project.cameraCuts[1].background.path).toBe(sourcePath);
    expect(graphic.keyframes.filter((key) => key.property === 'visibility').map((key) => [key.frame, key.value])).toEqual([[1, false], [31, true]]);
  });
});
