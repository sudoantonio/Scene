import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '../src/domain/schema';
import { exportScreenLayers } from './export-screen-layers';

describe('Blender screen layer sampling', () => {
  it('samples position, scale, rotation and visibility using the editor timeline', () => {
    const project = createProject();
    project.settings.frameEnd = 5;
    const image = createSceneObject('plane', 1);
    image.screenSpace = true;
    image.visible = false;
    image.keyframes = [
      { id: crypto.randomUUID(), frame: 1, property: 'position', value: [-1, 0, 0], interpolation: 'linear', source: 'user', commentIds: [] },
      { id: crypto.randomUUID(), frame: 5, property: 'position', value: [1, 0, 1], interpolation: 'linear', source: 'user', commentIds: [] },
      { id: crypto.randomUUID(), frame: 3, property: 'visibility', value: true, interpolation: 'constant', source: 'user', commentIds: [] },
    ];
    image.transform.rotation[2] = 30;
    image.transform.scale = [2, 2, 2];
    project.objects.push(image);
    const [layer] = exportScreenLayers(project);
    expect(layer.frames).toHaveLength(5);
    expect(layer.frames[1].visible).toBe(false);
    expect(layer.frames[2]).toMatchObject({ frame: 3, x: 0, y: .5, scale: 2, rotation: 30, visible: true });
  });

  it('exports text changes across scene boundaries and excludes world objects', () => {
    const project = createProject();
    project.settings.frameEnd = 4;
    const text = createSceneObject('text', 1);
    text.text = 'Prima';
    text.keyframes = [{ id: crypto.randomUUID(), frame: 3, property: 'text', value: 'Dopo', interpolation: 'constant', source: 'user', commentIds: [] }];
    project.objects.push(text, createSceneObject('cube', 1));
    const layers = exportScreenLayers(project);
    expect(layers).toHaveLength(1);
    expect(layers[0].frames.map((frame) => frame.text)).toEqual(['Prima', 'Prima', 'Dopo', 'Dopo']);
  });
});
