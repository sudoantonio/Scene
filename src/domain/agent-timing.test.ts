import { describe, expect, it } from 'vitest';
import { applyAgentCommands } from './agent-commands';
import { agentTimingIssues } from './agent-timing';
import { createProject } from './schema';

describe('controllo del ritmo', () => {
  it('segnala keyframe di posizione troppo lontani nel comando generico animate', () => {
    let project = createProject();
    const sceneId = project.cameraCuts[0].id;
    project = applyAgentCommands(project, [{ type: 'add_element', sceneId, kind: 'cube', name: 'Ub' }]);
    const elementId = project.objects.find((item) => item.name === 'Ub')!.id;
    project = applyAgentCommands(project, [{ type: 'animate', sceneId, elementId, property: 'position', keys: [{ offsetFrames: 48, value: [3, 0, 1], interpolation: 'linear' }] }]);
    expect(agentTimingIssues(project).some((item) => item.code === 'slow_generic_animate' && item.elementId === elementId)).toBe(true);
  });
  it('segnala una scena priva di battute dopo la pianificazione', () => {
    let project = applyAgentCommands(createProject(), [{ type: 'add_scene', name: 'Prima', durationFrames: 48 }, { type: 'add_scene', name: 'Seconda', durationFrames: 48 }]);
    project = applyAgentCommands(project, [{ type: 'set_storyboard', script: 'Copione', beats: [{ sceneId: project.cameraCuts[0].id, startOffsetFrames: 0, durationFrames: 24, dialogue: '', intention: 'Apertura', visualAction: 'Mostra Ub', pace: 'quick', surface: 'none' }] }]);
    expect(agentTimingIssues(project).filter((item) => item.code === 'scene_without_story_beat')).toHaveLength(1);
  });
});
