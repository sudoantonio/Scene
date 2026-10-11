import { describe, expect, it } from 'vitest';
import { applyAgentCommands } from './agent-commands';
import { agentFramingIssues } from './agent-framing';
import { createProject } from './schema';

describe('MCP framing feedback', () => {
  it('segnala un soggetto dietro la camera e testo che esce dalla TV', () => {
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'TV', durationFrames: 72, camera: { position: [0, -5, 2], target: [0, 0, 1] } }]);
    const sceneId = project.cameraCuts[0].id;
    project = applyAgentCommands(project, [{ type: 'add_element', sceneId, kind: 'cube', name: 'Ub', transform: { position: [0, 0, 1] } }]);
    const id = project.objects.find((object) => object.name === 'Ub')!.id;
    project = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'Ub', beats: [{ sceneId, startOffsetFrames: 0, durationFrames: 48, dialogue: 'Ub', intention: 'Vederlo', visualAction: 'Ub entra', emotion: '', focusElementId: id, surface: 'none', pace: 'quick' }] }]);
    expect(agentFramingIssues(project)).toEqual([]);
    project = applyAgentCommands(project, [{ type: 'update_scene', sceneId, camera: { position: [0, -5, 2], target: [0, -10, 1] } }]);
    expect(agentFramingIssues(project).some((issue) => issue.code === 'target_behind_camera')).toBe(true);
    const assetId = crypto.randomUUID();
    project = applyAgentCommands(project, [{ type: 'set_scene_background', sceneId, assetId }], [{ id: assetId, kind: 'model', name: 'salotto.glb', sourcePath: '/tmp/salotto.glb', landmarks: [{ name: 'TV • schermo CRT', position: [1, 0, 1], normal: [0, -1, 0], width: 1.1, height: .8 }] }]);
    project = applyAgentCommands(project, [{ type: 'add_element', sceneId, kind: 'text', name: 'TV • Titolo', text: 'UNA SCRITTA TROPPO LUNGA', screenSpace: false, transform: { position: [1, 0, 1], scale: [1, 1, 1] } }]);
    expect(agentFramingIssues(project).some((issue) => issue.code === 'surface_content_overflow')).toBe(true);
  });
});
