import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import StrokeDrawingToolbar from './StrokeDrawingToolbar';
import { useStrokeDrawing } from '../store/stroke-drawing';
import { useEditor } from '../store/editor';
import { createProject } from '../domain/schema';

beforeEach(() => { useEditor.setState({ project: createProject(), recordingSession: undefined, selectedId: undefined, currentFrame: 1, past: [], future: [] }); useStrokeDrawing.setState({ mode: 'stroke', durationSeconds: 2, previewMotion: undefined, panelOpen: false, elementCount: 0, surfaceNeighborCount: 0, sourceId: undefined, destinationId: undefined, sourcePointCount: 0, destinationPointCount: 0, circleRadius: 48, active: false, drawing: false, radius: .2, neighborCount: 0, instruction: '', thickness: .025, color: '#efae45', showInfluence: true }); });
afterEach(cleanup);
describe('drawing toolbar', () => {
  it('shows only the pencil while retaining an accessible name', () => {
    render(<StrokeDrawingToolbar />);
    const button = screen.getByRole('button', { name: '3D drawing · Jev' });
    expect(button.textContent).toBe(''); expect(button.querySelector('svg')).not.toBeNull();
  });
  it('enters normal-click selection directly without opening a menu', () => {
    render(<StrokeDrawingToolbar />);
    fireEvent.click(screen.getByRole('button', {name:'3D drawing · Jev'}));
    expect(useStrokeDrawing.getState().mode).toBe('motion');
    expect(useStrokeDrawing.getState().panelOpen).toBe(false);
    expect(screen.queryByLabelText('Object to move')).toBeNull();
  });
  it('closes the menu when stroke is selected and reopens it without disabling the pencil', () => {
    render(<StrokeDrawingToolbar />);
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stroke' }));
    expect(useStrokeDrawing.getState().active).toBe(true); expect(useStrokeDrawing.getState().panelOpen).toBe(false);
    expect(screen.queryByLabelText('Jev drawing instruction')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    expect(screen.getByLabelText('Jev drawing instruction')).toBeVisible();
    expect(useStrokeDrawing.getState().active).toBe(true);
  });
  it('selects a motion target and reuses the existing REC session', () => {
    useEditor.getState().addObject('cube'); const id = useEditor.getState().selectedId!;
    render(<StrokeDrawingToolbar />);
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    fireEvent.click(screen.getByRole('button', { name: 'Motion' }));
    act(() => useStrokeDrawing.setState({ sourceId: id }));
    fireEvent.click(screen.getByRole('button', { name: 'REC motion' }));
    expect(useEditor.getState().recordingSession).toBeDefined();
    expect(screen.getByLabelText('Motion duration')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop REC motion' }));
    expect(useEditor.getState().recordingSession).toBeUndefined();
  });
  it('uses direct viewport selection without duplicating selectors and guidance in the menu', () => {
    useStrokeDrawing.setState({ active: true, panelOpen: true, mode: 'motion' }); render(<StrokeDrawingToolbar />);
    expect(screen.queryByLabelText('Object to move')).toBeNull();
    expect(screen.queryByLabelText('Destination object')).toBeNull();
    expect(screen.getByLabelText('Motion duration')).toBeVisible();
  });
  it('enables drawing, clears the motion overlay and exposes settings', () => {
    useEditor.getState().setJevStrokeActive(true);
    render(<StrokeDrawingToolbar />);
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    expect(useStrokeDrawing.getState().active).toBe(true);
    expect(useEditor.getState().jevStroke.active).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stroke' }));
    fireEvent.click(screen.getByRole('button', { name: '3D drawing · Jev' }));
    fireEvent.change(screen.getByLabelText('Jev drawing instruction'), { target: { value: 'segui la superficie' } });
    fireEvent.change(screen.getByLabelText('3D stroke thickness'), { target: { value: '.1' } });
    expect(useStrokeDrawing.getState().instruction).toBe('segui la superficie');
    expect(useStrokeDrawing.getState().thickness).toBe(.1);
    fireEvent.click(screen.getByRole('button', { name: 'Exit drawing' }));
    expect(useStrokeDrawing.getState().active).toBe(false);
  });
});
