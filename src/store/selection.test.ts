import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, ProjectSchema } from '../domain/schema';
import { useEditor } from './editor';

beforeEach(() => useEditor.getState().loadProject(createProject(), '/test.abaco.json'));

describe('Canvas multi-selection actions', () => {
  it('copies, pastes, groups, duplicates and deletes selected elements with undo', () => {
    useEditor.getState().addObject('cube');
    const cube = useEditor.getState().selectedId!;
    useEditor.getState().addObject('sphere');
    const sphere = useEditor.getState().selectedId!;
    useEditor.getState().setSelection([cube, sphere]);
    useEditor.getState().groupSelection();
    useEditor.getState().copySelection();
    const pasted = useEditor.getState().pasteSelection();
    expect(pasted).toHaveLength(2);
    expect(useEditor.getState().project.groups).toHaveLength(2);
    const duplicates = useEditor.getState().duplicateSelection();
    expect(duplicates).toHaveLength(2);
    expect(ProjectSchema.parse(useEditor.getState().project).groups).toHaveLength(3);
    useEditor.getState().deleteSelection();
    expect(duplicates.every((id) => !useEditor.getState().project.objects.some((object) => object.id === id))).toBe(true);
    expect(ProjectSchema.parse(useEditor.getState().project).groups).toHaveLength(2);
    useEditor.getState().undo();
    expect(duplicates.every((id) => useEditor.getState().project.objects.some((object) => object.id === id))).toBe(true);
  });

  it('keeps older audio projects valid while adding editable subtitles', () => {
    const project = createProject();
    useEditor.getState().addAudio({ sourcePath: '/test.wav', name: 'Voice', duration: 2, waveform: [] });
    const saved = JSON.parse(JSON.stringify(useEditor.getState().project));
    delete saved.objects.find((object: { kind: string }) => object.kind === 'audio').audio.captions;
    delete saved.objects.find((object: { kind: string }) => object.kind === 'audio').audio.showCaptions;
    expect(ProjectSchema.parse(saved).objects.find((object) => object.kind === 'audio')?.audio.captions).toEqual([]);
    expect(project.objects.length).toBeGreaterThan(0);
  });
});
