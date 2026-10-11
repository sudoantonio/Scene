import { describe, expect, it } from 'vitest';
import { agentEditorStatus, applyAgentRequest } from './agent-editor';
import { useEditor } from './editor';

describe('modifiche AI nell’editor', () => {
  it('mantiene il contesto dell’oggetto selezionato mentre aggiunge forme e consente Annulla', () => {
    useEditor.getState().newProject();
    useEditor.getState().addObject('cube');
    const selectedId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    const originalVisibility = useEditor.getState().project.objects.find((object) => object.id === selectedId)!.visible;
    const before = agentEditorStatus();
    expect(before.selection).toMatchObject({ id: selectedId, kind: 'cube' });
    applyAgentRequest({ expectedRevision: before.revision, commands: [
      { type: 'update_element', elementId: selectedId, visible: false },
      { type: 'add_element', sceneId, kind: 'cube', name: 'Corpo cane', color: '#986b45' },
      { type: 'add_element', sceneId, kind: 'sphere', name: 'Testa cane', color: '#986b45' },
    ] });
    expect(useEditor.getState().selectedId).toBe(selectedId);
    expect(useEditor.getState().project.objects.find((object) => object.id === selectedId)?.visible).toBe(false);
    expect(useEditor.getState().project.objects.some((object) => object.name === 'Testa cane')).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().project.objects.find((object) => object.id === selectedId)?.visible).toBe(originalVisibility);
    expect(useEditor.getState().project.objects.some((object) => object.name === 'Testa cane')).toBe(false);
  });
  it('registra un solo passo Annulla e rifiuta revisioni superate', () => {
    useEditor.getState().newProject();
    const before = agentEditorStatus();
    const pastLength = useEditor.getState().past.length;
    const result = applyAgentRequest({ expectedRevision: before.revision, commands: [{ type: 'create_project', name: 'Prova', fps: 24, width: 1920, height: 1080 }, { type: 'add_scene', name: 'Casa', durationFrames: 48 }] });
    expect(result.revision).toBeGreaterThan(before.revision);
    expect(useEditor.getState().past).toHaveLength(pastLength + 1);
    expect(() => applyAgentRequest({ expectedRevision: before.revision, commands: [{ type: 'add_scene', name: 'Stale', durationFrames: 48 }] })).toThrow(/project changed/);
    useEditor.getState().undo();
    expect(useEditor.getState().project.id).toBe(before.projectId);
    expect(agentEditorStatus().revision).toBeGreaterThan(result.revision);
  });
});
