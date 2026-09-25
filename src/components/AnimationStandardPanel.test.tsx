import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AnimationStandardPanel from './AnimationStandardPanel';
import { useEditor } from '../store/editor';
import { createProject } from '../domain/schema';
beforeEach(() => useEditor.getState().loadProject(createProject(), '/test.abaco.json'));
afterEach(cleanup);
describe('Documento standard', () => {
  it('allega il file come contenuto e lo rimuove senza riempire la scena', async () => {
    render(<AnimationStandardPanel />);
    const file = new File(['Regole della scena'], 'standard.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: async () => 'Regole della scena' });
    fireEvent.change(screen.getByLabelText('Animation standard document'), { target: { files: [file] } });
    await waitFor(() => expect(useEditor.getState().project.animationStandard?.content).toBe('Regole della scena'));
    expect(screen.getByText('standard.md')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove from project'));
    expect(useEditor.getState().project.animationStandard).toBeUndefined();
    expect(useEditor.getState().project.comments).toEqual([]);
  });
  it('rifiuta il documento vuoto e conserva quello precedente', async () => {
    render(<AnimationStandardPanel />);
    fireEvent.click(screen.getByText('Use included cartoon standard'));
    const original = useEditor.getState().project.animationStandard;
    expect(original?.content).toContain('Confronto iniziale obbligatorio');
    const file = new File([' '], 'vuoto.md'); Object.defineProperty(file, 'text', { value: async () => ' ' });
    fireEvent.change(screen.getByLabelText('Animation standard document'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('empty'));
    expect(useEditor.getState().project.animationStandard).toEqual(original);
  });
  it('non allega al nuovo progetto un file selezionato nel precedente', async () => {
    render(<AnimationStandardPanel />);
    let finish!: (text: string) => void;
    const file = new File(['abc'], 'regole.md'); Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    fireEvent.change(screen.getByLabelText('Animation standard document'), { target: { files: [file] } });
    act(() => useEditor.getState().newProject());
    await act(async () => { finish('Regole'); });
    expect(useEditor.getState().project.animationStandard).toBeUndefined();
  });
});
