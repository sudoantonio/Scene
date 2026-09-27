import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, ProjectSchema } from '../domain/schema';
import { evaluateProperty } from '../domain/animation';
import { useEditor } from './editor';

beforeEach(() => useEditor.getState().loadProject(createProject(), '/test.abaco.json'));

describe('Canvas multi-selection actions', () => {
  it('adds images either as fixed 2D layers or movable 3D planes', () => {
    const asset = { sourcePath: '/image.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'Image', aspectRatio: 1.5 };
    useEditor.getState().addImage(asset, 'screen');
    const screen = useEditor.getState().project.objects.find((object) => object.id === useEditor.getState().selectedId)!;
    expect(screen.screenSpace).toBe(true);
    useEditor.getState().addImage(asset, 'world');
    const world = useEditor.getState().project.objects.find((object) => object.id === useEditor.getState().selectedId)!;
    expect(world.kind).toBe('plane');
    expect(world.screenSpace).toBe(false);
    expect(world.asset.previewScale).toBe(1.5);
    expect(world.transform.rotation).toEqual([90, 0, 0]);
    expect(ProjectSchema.parse(useEditor.getState().project).objects).toHaveLength(3);
  });

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
    expect(duplicates.every((id) => {
      const object = useEditor.getState().project.objects.find((item) => item.id === id);
      return object && evaluateProperty(object, 'visibility', 1) === false;
    })).toBe(true);
    expect(ProjectSchema.parse(useEditor.getState().project).groups).toHaveLength(3);
    useEditor.getState().undo();
    expect(duplicates.every((id) => {
      const object = useEditor.getState().project.objects.find((item) => item.id === id);
      return object && evaluateProperty(object, 'visibility', 1) === true;
    })).toBe(true);
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
