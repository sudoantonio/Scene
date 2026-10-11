import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createSceneObject } from '../domain/schema';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';
import { ScreenSpaceLayers } from './Viewport';

beforeEach(() => { useEditor.getState().loadProject(createProject(), '/tmp/alignment.abaco.json'); vi.stubGlobal('PointerEvent', MouseEvent); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const setup = () => {
  const project = createProject(), first = createSceneObject('text', 1), second = createSceneObject('text', 2);
  project.objects.push(first, second); useEditor.getState().loadProject(project, '/tmp/alignment.abaco.json');
  useEditor.getState().select(second.id);
  const view = render(<ScreenSpaceLayers objects={[first, second]} frame={1} width={700} height={400} />);
  const layers = view.container.querySelectorAll('.screen-space-layer');
  vi.spyOn(layers[0], 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 180, bottom: 140, width: 80, height: 40 } as DOMRect);
  vi.spyOn(layers[1], 'getBoundingClientRect').mockReturnValue({ left: 300, top: 200, right: 380, bottom: 240, width: 80, height: 40 } as DOMRect);
  vi.spyOn(view.container.querySelector('.screen-space-layers')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 700, bottom: 400, width: 700, height: 400 } as DOMRect);
  return { ...view, first, layer: layers[0] };
};
describe('screen alignment guides', () => {
  it('aligns text against the previously selected layer, displays guides, and saves one undo on release', () => {
    const view = setup(), before = useEditor.getState().project;
    fireEvent.pointerDown(view.layer, { button: 0, clientX: 140, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 329, clientY: 215 });
    expect(view.container.querySelectorAll('.screen-alignment-guides line')).toHaveLength(2);
    expect(view.container.querySelector('.screen-alignment-feedback')).toHaveTextContent('Text 2');
    fireEvent.pointerUp(window, { clientX: 329, clientY: 215 });
    const object = useEditor.getState().project.objects.find(o => o.id === view.first.id)!;
    expect(evaluateTransform(object, 1).position[0]).toBeCloseTo(400 / 700);
    expect(evaluateTransform(object, 1).position[2]).toBeCloseTo(-.5);
    expect(view.container.querySelector('.screen-alignment-guides')).not.toBeInTheDocument();
    expect(useEditor.getState().past).toHaveLength(1);
    act(() => useEditor.getState().undo()); expect(useEditor.getState().project).toEqual(before);
  });
  it('holds an acquired guide, releases beyond its band, and bypasses snapping with Alt', () => {
    const view = setup();
    fireEvent.pointerDown(view.layer, { button: 0, clientX: 140, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 329, clientY: 215 });
    fireEvent.pointerMove(window, { clientX: 360, clientY: 245 });
    expect(view.container.querySelectorAll('.screen-alignment-guides line')).toHaveLength(2);
    fireEvent.pointerMove(window, { clientX: 400, clientY: 280 });
    expect(view.container.querySelector('.screen-alignment-guides')).not.toBeInTheDocument();
    fireEvent.pointerMove(window, { clientX: 329, clientY: 215, altKey: true });
    expect(view.container.querySelector('.screen-alignment-guides')).not.toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 329, clientY: 215 });
    const object = useEditor.getState().project.objects.find(o => o.id === view.first.id)!;
    expect(evaluateTransform(object, 1).position[0]).toBeCloseTo(378 / 700);
    expect(evaluateTransform(object, 1).position[2]).toBeCloseTo(-190 / 400);
  });
});
