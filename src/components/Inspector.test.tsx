import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';
import Inspector from './Inspector';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('scene-decision-engine', 'jev');
  useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingSession: undefined, recordingMotion: undefined, past: [], future: [], dirty: false, isPlaying: false, cameraView: false, jevStroke: { active: false, points: [] } });
});
afterEach(() => { cleanup(); delete window.abaco; });
describe('Pannelli contestuali', () => {
  it('mostra solo il volume audio in Modifica e lascia invariata la scheda Lighting', () => {
    useEditor.getState().addAudio({ sourcePath: '/sound.wav', name: 'Passi', duration: 2.5, waveform: [.2, .8, .4] });
    const view = render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lighting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sound' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Audio volume')).toBeInTheDocument();
    expect(screen.queryByText('Mute')).not.toBeInTheDocument();
    expect(screen.queryByText('Loop')).not.toBeInTheDocument();
    view.rerender(<Inspector panel="light" onPanelChange={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Lighting controls' })).toBeInTheDocument();
  });

  it('applica uno sfondo alla scena che ha avviato l’importazione anche dopo un cambio scena', async () => {
    useEditor.getState().addShot();
    const [first, second] = useEditor.getState().project.cameraCuts;
    useEditor.getState().setFrame(first.frame);
    let resolve!: (value: { path: string; name: string }) => void;
    window.abaco = { chooseBackground: vi.fn(() => new Promise((done) => { resolve = done; })) } as unknown as NonNullable<Window['abaco']>;
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    act(() => useEditor.getState().setFrame(second.frame));
    await act(async () => { resolve({ path: '/background.png', name: 'Sfondo' }); });
    expect(useEditor.getState().project.cameraCuts[0].background).toMatchObject({ kind: 'image', path: '/background.png' });
    expect(useEditor.getState().project.cameraCuts[1].background.kind).toBe('none');
  });

  it('separa le schede dal contenuto scorrevole e richiude i controlli secondari', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    const body = screen.getByRole('region', { name: 'Edit controls' });
    expect(body).toHaveClass('inspector-scroll');
    expect(body).not.toContainElement(screen.getByRole('navigation'));
    expect(screen.getByText('Position and size').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Rotation', { exact: true }).closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Appearance').closest('details')).not.toHaveAttribute('open');
    expect(body).toContainElement(screen.getByText('Advanced values'));
  });

  it('accetta una dimensione 2D oltre il limite precedente anche dal pannello', () => {
    useEditor.getState().addImage({ sourcePath: '/tmp/photo.png', dataUrl: 'data:image/png;base64,AA==', name: 'Photo' }, 'screen');
    const id = useEditor.getState().selectedId!;
    render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Element size percent' }), { target: { value: '2000' } });
    expect(evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === id)!, 1).scale).toEqual([20, 20, 1]);
    act(() => useEditor.getState().loadProject(useEditor.getState().project, '/tmp/scene.abaco.json'));
    expect(evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === id)!, 1).scale).toEqual([20, 20, 1]);
  });

  it('appoggia un elemento selezionato sul piano', () => {
    useEditor.getState().addObject('cube');
    const id = useEditor.getState().selectedId!;
    useEditor.getState().setTransform(id, { position: [2, 3, 6], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5] });
    render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Place on ground' }));
    const object = useEditor.getState().project.objects.find((item) => item.id === id)!;
    expect(evaluateTransform(object, 1).position).toEqual([2, 3, 1.5]);
  });

  it('salva automaticamente una sola descrizione della scena senza ricreare la textarea', async () => {
    useEditor.getState().addObject('cube');
    const initial = useEditor.getState();
    const scene = initial.project.cameraCuts[0];
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Scene direction' });
    fireEvent.change(input, { target: { value: 'Entra' } });
    expect(screen.getByRole('textbox', { name: 'Scene direction' })).toBe(input);
    fireEvent.change(input, { target: { value: 'Entra lentamente in scena.' } });
    expect(screen.queryByRole('button', { name: 'Save direction' })).not.toBeInTheDocument();
    await waitFor(() => expect(useEditor.getState().project.comments).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'scene', sceneId: scene.id, text: 'Entra lentamente in scena.' })])));
    act(() => useEditor.getState().undo());
    expect(input).toHaveValue('');
  });

  it('mantiene bozza e contenitore quando si seleziona un elemento in Scenografia', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    const body = screen.getByRole('region', { name: 'Scenography content' });
    const input = screen.getByLabelText('Scene direction');
    fireEvent.change(input, { target: { value: 'Bozza da conservare' } });
    act(() => useEditor.getState().select(undefined));
    act(() => useEditor.getState().select(useEditor.getState().project.objects.find(o => o.name === 'Cube 1')!.id));
    expect(screen.getByRole('region', { name: 'Scenography content' })).toBe(body);
    expect(screen.getByLabelText('Scene direction')).toBe(input);
    expect(input).toHaveValue('Bozza da conservare');
  });

  it('mostra nei suggerimenti solo gli elementi della scena e salva la bozza nella scena giusta', async () => {
    useEditor.getState().addObject('cube');
    useEditor.getState().addShot();
    const secondScene = useEditor.getState().project.cameraCuts[1];
    useEditor.getState().addObject('sphere');
    const sphereName = useEditor.getState().project.objects.find(o => o.id === useEditor.getState().selectedId)!.name;
    useEditor.getState().setFrame(1);
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Scene direction'), { target: { value: '@', selectionStart: 1 } });
    expect(screen.queryByRole('option', { name: `${sphereName} Element` })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Scene direction'), { target: { value: 'Prima scena' } });
    act(() => useEditor.getState().setFrame(secondScene.frame));
    expect(screen.getByLabelText('Scene direction')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Scene direction'), { target: { value: '@', selectionStart: 1 } });
    expect(screen.getByRole('option', { name: `${sphereName} Element` })).toBeInTheDocument();
    act(() => useEditor.getState().setFrame(1));
    await waitFor(() => expect(useEditor.getState().project.comments).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Prima scena', sceneId: useEditor.getState().project.cameraCuts[0].id })])));
  });
});

describe('Scene direction mentions and motion presets', () => {
  it('offers element motions after @mention and saves their prompts', async () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    const input = screen.getByLabelText('Scene direction');
    fireEvent.change(input, { target: { value: '@Cu', selectionStart: 3 } });
    expect(screen.getByRole('option', { name: 'Cube 1 Element' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cube 1 Element' }).querySelector('svg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Cube 1 Element' }));
    fireEvent.change(input, { target: { value: '@Cube 1 /', selectionStart: 9 } });
    expect(screen.getByRole('option', { name: 'Annoyed Emotion' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Static camera Camera' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Annoyed Emotion' }));
    expect(input).toHaveValue('@Cube 1 /scocciato ');
    const query = '@Cube 1 /scocciato /si-av';
    fireEvent.change(input, { target: { value: query, selectionStart: query.length } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('@Cube 1 /scocciato /si-avvicina ');
    await waitFor(() => expect(useEditor.getState().project.comments[0]?.presets?.map(p => p.id)).toEqual(['scocciato', 'si-avvicina']));
    const comment = useEditor.getState().project.comments[0];
    expect(comment.scope).toBe('scene');
    expect(comment.presets?.map(p => p.id)).toEqual(['scocciato', 'si-avvicina']);
    expect(comment.presets?.every(p => p.prompt.length > 100)).toBe(true);
    expect(comment.targetIds).toContain(useEditor.getState().project.objects.find(o => o.name === 'Cube 1')!.id);
  });

  it('offers camera motions after @camera and switches with the last mention', async () => {
    const name = useEditor.getState().project.objects[0].name;
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    const input = screen.getByLabelText('Scene direction');
    fireEvent.change(input, { target: { value: `@${name} /`, selectionStart: name.length + 3 } });
    expect(screen.getByRole('option', { name: 'Static camera Camera' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Annoyed Emotion' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Static camera Camera' }));
    await waitFor(() => expect(useEditor.getState().project.comments[0]?.presets?.[0].id).toBe('camera-statica'));
    const next = `@${name} /camera-statica @Cube 1 /`;
    fireEvent.change(input, { target: { value: next, selectionStart: next.length } });
    expect(screen.getByRole('option', { name: 'Annoyed Emotion' })).toBeInTheDocument();
  });
});

it('mostra lo standard come riga compatta senza pannello apribile', () => {
  render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
  expect(screen.getByText(/STANDARD_ANIMAZIONE_GENERALE.md/).closest('details')).toBeNull();
  expect(useEditor.getState().project.animationStandard?.name).toBe('STANDARD_ANIMAZIONE_GENERALE.md');
  expect(screen.getByText(/STANDARD_ANIMAZIONE_GENERALE.md/)).toBeInTheDocument();
});
