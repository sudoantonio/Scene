import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { evaluateProperty } from '../domain/animation';
import { useEditor } from '../store/editor';
import { useStrokeDrawing } from '../store/stroke-drawing';
import MotionAdjustment from './MotionAdjustment';

beforeEach(() => { useEditor.getState().loadProject(createProject(), '/tmp/test.abaco.json'); useStrokeDrawing.setState({ active: false }); });
afterEach(() => { cleanup(); delete window.abaco; });
const motion = () => {
  useEditor.getState().addObject('cube'); const id = useEditor.getState().selectedId!;
  useEditor.getState().applyDrawnMotion(id, [[0,0,0], [1,0,0], [1,2,0]], 2, true);
  return id;
};
const instruction = () => { fireEvent.change(screen.getByLabelText('Motion instructions'), { target: { value: 'durata 2.5 secondi, fluido' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply' })); };
describe('selected movement corrections', () => {
  it('does not offer corrections for a plain object selection, drawing or REC', () => {
    useEditor.getState().addObject('cube'); render(<MotionAdjustment />);
    expect(screen.queryByLabelText('Motion instructions')).toBeNull();
    act(() => motion()); expect(screen.getByLabelText('Motion instructions')).toBeVisible();
    act(() => useStrokeDrawing.setState({active:true})); expect(screen.queryByLabelText('Motion instructions')).toBeNull();
  });
  it('updates duration and pacing atomically with undo while preserving the curve and endpoints', async () => {
    const id = motion(), before = structuredClone(useEditor.getState().project), past = useEditor.getState().past.length;
    const adjustMotion = vi.fn().mockResolvedValue({ durationSeconds: 2.5, interpolation: 'bezier' });
    window.abaco = { adjustMotion } as unknown as NonNullable<Window['abaco']>;
    render(<MotionAdjustment />); instruction();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Motion updated'));
    expect(adjustMotion).toHaveBeenCalledWith({ instruction: 'durata 2.5 secondi, fluido', durationSeconds: 2 });
    const object = useEditor.getState().project.objects.find(o=>o.id===id)!;
    const keys = object.keyframes.filter(k=>k.purpose==='motion'&&k.property==='position').sort((a,b)=>a.frame-b.frame);
    expect(keys).toHaveLength(2); expect(keys[1].frame-keys[0].frame).toBe(60);
    expect(keys[0].positionPath).toEqual(before.objects.find(o=>o.id===id)!.keyframes.find(k=>k.positionPath)!.positionPath);
    expect(evaluateProperty(object,'position',(keys[0].frame+keys[1].frame)/2)).toEqual([1,.5,0]);
    expect(useEditor.getState().past.length).toBe(past+1);
    act(()=>useEditor.getState().undo()); expect(useEditor.getState().project).toEqual(before);
  });
  it('ignores an answer after switching selection and permits only one pending call', async () => {
    motion(); let resolve!: (value: unknown)=>void;
    const adjustMotion=vi.fn(()=>new Promise(r=>{resolve=r;}));
    window.abaco={adjustMotion} as unknown as NonNullable<Window['abaco']>;
    render(<MotionAdjustment />); instruction(); expect(screen.getByRole('button', {name:'Updating…'})).toBeDisabled();
    const before=structuredClone(useEditor.getState().project);
    act(()=>useEditor.getState().select(undefined)); await act(async()=>resolve({durationSeconds:4,interpolation:'linear'}));
    expect(useEditor.getState().project).toEqual(before); expect(adjustMotion).toHaveBeenCalledTimes(1);
  });
  it('rejects stale corrections after an intervening edit', async () => {
    const id=motion(); let resolve!: (value:unknown)=>void;
    window.abaco={adjustMotion:()=>new Promise(r=>{resolve=r;})} as unknown as NonNullable<Window['abaco']>;
    render(<MotionAdjustment />); instruction();
    act(()=>useEditor.getState().resizeMotionRange(id,useEditor.getState().project.cameraCuts[0].id,1,40));
    const before=structuredClone(useEditor.getState().project);
    await act(async()=>resolve({durationSeconds:4,interpolation:'linear'}));
    expect(useEditor.getState().project).toEqual(before); expect(screen.getByRole('status')).toHaveTextContent('motion changed');
  });
  it('keeps the drawing unchanged on invalid answers or service failure', async () => {
    motion(); const before=structuredClone(useEditor.getState().project);
    const adjustMotion=vi.fn().mockResolvedValueOnce({durationSeconds:-2,interpolation:'garbage'}).mockRejectedValueOnce(new Error('Jev indisponibile'));
    window.abaco={adjustMotion} as unknown as NonNullable<Window['abaco']>;
    render(<MotionAdjustment />); instruction(); await waitFor(()=>expect(screen.getByRole('button',{name:'Apply'})).toBeEnabled());
    expect(useEditor.getState().project).toEqual(before); fireEvent.click(screen.getByRole('button',{name:'Apply'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Jev indisponibile')); expect(useEditor.getState().project).toEqual(before);
  });
});
