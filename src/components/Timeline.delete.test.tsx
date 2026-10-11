import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../domain/schema';
import { useEditor } from '../store/editor';
import Timeline from './Timeline';

beforeEach(() => useEditor.getState().loadProject(createProject(), '/tmp/delete.abaco.json'));
afterEach(cleanup);
describe('timeline trash', () => {
  it('deletes a scene, then closes its empty space and shifts the following scene', () => {
    useEditor.getState().addShot(); useEditor.getState().addShot();
    const scenes = useEditor.getState().project.cameraCuts;
    const view = render(<Timeline />);
    fireEvent.click(screen.getByTitle('Scene 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected block' }));
    expect(useEditor.getState().project.cameraCuts[1].isGap).toBe(true);
    fireEvent.click(screen.getByTitle('Empty space'));
    fireEvent.click(screen.getByRole('button', { name: 'Close empty space' }));
    expect(useEditor.getState().project.cameraCuts.map(s => s.id)).toEqual([scenes[0].id, scenes[2].id]);
    expect(useEditor.getState().project.cameraCuts.map(s => s.frame)).toEqual([1, 73]);
    expect(view.container.querySelector('.scene-gap')).not.toBeInTheDocument();
  });
  it('deletes an entire element row even when the playhead is in empty space, and undoes once', () => {
    useEditor.getState().addObject('cube'); const id = useEditor.getState().selectedId!;
    useEditor.getState().addShot(); useEditor.getState().addShot();
    useEditor.getState().deleteScene(useEditor.getState().project.cameraCuts[1].id);
    const before = useEditor.getState().project, count = useEditor.getState().past.length;
    render(<Timeline />); fireEvent.click(screen.getByRole('button', { name: 'Delete Cube 1' }));
    expect(useEditor.getState().project.objects.some(o => o.id === id)).toBe(false);
    expect(useEditor.getState().past).toHaveLength(count + 1);
    act(() => useEditor.getState().undo()); expect(useEditor.getState().project).toEqual(before);
  });
  it('deletes the selected clip with the transport trash and supports Undo', () => {
    useEditor.getState().addAudio({ sourcePath: '/sound.wav', name: 'Audio', duration: 2, waveform: [] });
    const id = useEditor.getState().selectedId!, before = useEditor.getState().project;
    const view = render(<Timeline />); fireEvent.click(view.container.querySelector('.audio-layer')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected block' }));
    expect(useEditor.getState().project.objects.some(o => o.id === id)).toBe(false);
    act(() => useEditor.getState().undo()); expect(useEditor.getState().project).toEqual(before);
  });
});
