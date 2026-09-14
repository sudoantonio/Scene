import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { useEditor } from '../store/editor';
import Inspector from './Inspector';

beforeEach(() => {
  useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingSession: undefined, recordingMotion: undefined, past: [], future: [], dirty: false, isPlaying: false, cameraView: false });
});
afterEach(() => { cleanup(); delete window.abaco; });

describe('Pannelli contestuali', () => {
  it('mostra solo il volume audio in Modifica e lascia invariata la scheda Luce', () => {
    useEditor.getState().addAudio({ sourcePath: '/sound.wav', name: 'Passi', duration: 2.5, waveform: [.2, .8, .4] });
    const view = render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Luce' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suono' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Volume audio')).toBeInTheDocument();
    expect(screen.queryByText('Silenzia')).not.toBeInTheDocument();
    expect(screen.queryByText('Loop')).not.toBeInTheDocument();
    view.rerender(<Inspector panel="light" onPanelChange={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Controlli luce' })).toBeInTheDocument();
  });

  it('applica uno sfondo alla scena che ha avviato l’importazione anche dopo un cambio scena', async () => {
    useEditor.getState().addShot();
    const [first, second] = useEditor.getState().project.cameraCuts;
    useEditor.getState().setFrame(first.frame);
    let resolve!: (value: { path: string; name: string }) => void;
    window.abaco = { chooseBackground: vi.fn(() => new Promise((done) => { resolve = done; })) } as unknown as NonNullable<Window['abaco']>;
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Immagine' }));
    act(() => useEditor.getState().setFrame(second.frame));
    await act(async () => { resolve({ path: '/background.png', name: 'Sfondo' }); });
    expect(useEditor.getState().project.cameraCuts[0].background).toMatchObject({ kind: 'image', path: '/background.png' });
    expect(useEditor.getState().project.cameraCuts[1].background.kind).toBe('none');
  });

  it('separa le schede dal contenuto scorrevole e richiude i controlli secondari', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    const body = screen.getByRole('region', { name: 'Controlli modifica' });
    expect(body).toHaveClass('inspector-scroll');
    expect(body).not.toContainElement(screen.getByRole('navigation'));
    expect(screen.getByText('Posizione e dimensione').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Rotazione', { exact: true }).closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Aspetto').closest('details')).not.toHaveAttribute('open');
    expect(body).toContainElement(screen.getByText('Valori numerici'));
  });

  it.each(['scene', 'framing', 'object'] as const)('scrive e salva indicazioni %s senza ricreare la textarea', (scope) => {
    useEditor.getState().addObject('cube');
    const initial = useEditor.getState();
    const objectId = initial.selectedId!;
    const scene = initial.project.cameraCuts[0];
    const label = scope === 'object' ? 'Cubo 1' : scope === 'framing' ? initial.project.objects.find(o => o.id === scene.cameraId)!.name : scene.name!;
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(`Aggiungi commento ${label}`));
    const input = screen.getByRole('textbox', { name: `Indicazione ${label}` });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Entra' } });
    expect(screen.getByRole('textbox', { name: `Indicazione ${label}` })).toBe(input);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Entra lentamente in scena.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(useEditor.getState().project.comments).toEqual(expect.arrayContaining([expect.objectContaining({ scope, sceneId: scene.id, text: 'Entra lentamente in scena.', targetIds: scope === 'object' ? [objectId] : expect.any(Array) })]));
  });

  it('mantiene bozza e contenitore quando si seleziona un elemento in Scenografia', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Aggiungi commento Scena 1'));
    const body = screen.getByRole('region', { name: 'Contenuto scenografia' });
    const input = screen.getByLabelText('Indicazione Scena 1');
    fireEvent.change(input, { target: { value: 'Bozza da conservare' } });
    act(() => useEditor.getState().select(undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona Cubo 1' }));
    expect(screen.getByRole('region', { name: 'Contenuto scenografia' })).toBe(body);
    expect(screen.getByLabelText('Indicazione Scena 1')).toBe(input);
    expect(input).toHaveValue('Bozza da conservare');
  });

  it('mostra solo gli elementi appartenenti alla scena e non salva bozze nella scena sbagliata', () => {
    useEditor.getState().addObject('cube');
    useEditor.getState().addShot();
    const secondScene = useEditor.getState().project.cameraCuts[1];
    useEditor.getState().addObject('sphere');
    const sphereName = useEditor.getState().project.objects.find(o => o.id === useEditor.getState().selectedId)!.name;
    useEditor.getState().setFrame(1);
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: `Seleziona ${sphereName}` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Aggiungi commento Scena 1'));
    fireEvent.change(screen.getByLabelText('Indicazione Scena 1'), { target: { value: 'Prima scena' } });
    act(() => useEditor.getState().setFrame(secondScene.frame));
    expect(screen.getByRole('button', { name: `Seleziona ${sphereName}` })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    act(() => useEditor.getState().setFrame(1));
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(useEditor.getState().project.comments[0]).toMatchObject({ text: 'Prima scena', sceneId: useEditor.getState().project.cameraCuts[0].id });
  });
});
