import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';
import Inspector from './Inspector';
import JevFloatingComposer from './JevFloatingComposer';

beforeEach(() => {
  window.localStorage.clear();
  useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingSession: undefined, recordingMotion: undefined, past: [], future: [], dirty: false, isPlaying: false, cameraView: false, jevStroke: { active: false, points: [] } });
});
afterEach(() => { cleanup(); delete window.abaco; });
const openAiAgent = () => fireEvent.click(screen.getByRole('button', { name: 'AI agent' }));

describe('Pannelli contestuali', () => {
  it('nasconde l’input AI finché non viene selezionato un soggetto', () => {
    render(<JevFloatingComposer />);
    expect(screen.queryByRole('textbox', { name: 'Jev action' })).not.toBeInTheDocument();
    expect(screen.queryByText('Soggetto di riferimento')).not.toBeInTheDocument();
    expect(screen.queryByText('Posizione iniziale')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Jev main panel' })).not.toBeInTheDocument();
  });

  it('mostra il pulsante AI agent e apre l’input solo dopo il clic', () => {
    useEditor.getState().addObject('cube');
    render(<JevFloatingComposer />);
    const button = screen.getByRole('button', { name: 'AI agent' });
    expect(button).toBeInTheDocument();
    expect(button.querySelector('img')).toHaveAttribute('src');
    expect(screen.queryByRole('textbox', { name: 'Jev action' })).not.toBeInTheDocument();
    openAiAgent();
    expect(screen.getByRole('textbox', { name: 'Jev action' })).toBeInTheDocument();
  });

  it('nasconde il tasto AI durante lo spostamento e lo mostra di nuovo al rilascio', async () => {
    useEditor.getState().addObject('cube');
    render(<JevFloatingComposer />);
    const viewport = document.createElement('div');
    viewport.className = 'viewport';
    document.body.append(viewport);
    const button = screen.getByRole('button', { name: 'AI agent' });
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 35, clientY: 20 });
    expect(screen.queryByRole('button', { name: 'AI agent' })).not.toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerId: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'AI agent' })).toBeInTheDocument());
    viewport.remove();
    expect(button).not.toBeInTheDocument();
  });

  it('aumenta l’altezza dell’input quando il testo occupa più righe', () => {
    useEditor.getState().addObject('cube');
    render(<JevFloatingComposer />);
    openAiAgent();
    const input = screen.getByRole('textbox', { name: 'Jev action' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 84 });
    fireEvent.change(input, { target: { value: 'Il soggetto entra da sinistra, si ferma al centro e poi guarda verso la camera.' } });
    expect(input).toHaveStyle({ height: '84px' });
  });

  it('reopens one saved direction action in the input and sends its identity', async () => {
    const project = createProject();
    const objectId = project.objects[0]!.id;
    const sceneId = project.cameraCuts[0]!.id;
    const planId = crypto.randomUUID(), actionId = crypto.randomUUID();
    project.directionPlans = [{ id: planId, sceneId, objectId, instruction: 'si allontana', startFrame: 1, endFrame: 24, actions: [{ id: actionId, instruction: 'si allontana', motion: 'dolly_out', relation: 'then', startFrame: 1, endFrame: 24, keepInFrame: false, distanceMeters: 2, durationSeconds: 1 }] }];
    useEditor.setState({ project, selectedId: objectId, currentFrame: 12 });
    const generateJevAction = vi.fn().mockRejectedValue(new Error('test'));
    window.abaco = { generateJevAction } as unknown as NonNullable<Window['abaco']>;
    render(<JevFloatingComposer />);
    openAiAgent();
    fireEvent.click(screen.getByText('Direction · 1 motion'));
    fireEvent.click(screen.getByRole('button', { name: /camera indietro/ }));
    const input = screen.getByRole('textbox', { name: 'Jev action' });
    expect(input).toHaveValue('si allontana');
    fireEvent.change(input, { target: { value: 'si allontana di 1 metro' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generateJevAction).toHaveBeenCalledWith(expect.objectContaining({ directionPlanId: planId, editActionId: actionId, frame: 1 })));
  });

  it('invia automaticamente la regia salvata come contesto del prompt successivo', async () => {
    const project = createProject();
    const objectId = project.objects[0]!.id;
    const sceneId = project.cameraCuts[0]!.id;
    const planId = crypto.randomUUID();
    project.directionPlans = [{ id: planId, sceneId, objectId, instruction: 'si avvicina', startFrame: 1, endFrame: 24, actions: [{ id: crypto.randomUUID(), instruction: 'si avvicina', motion: 'dolly_in', relation: 'then', startFrame: 1, endFrame: 24, keepInFrame: false, distanceMeters: 2, durationSeconds: 1 }] }];
    useEditor.setState({ project, selectedId: objectId, currentFrame: 12 });
    const generateJevAction = vi.fn().mockRejectedValue(new Error('test'));
    window.abaco = { generateJevAction } as unknown as NonNullable<Window['abaco']>;
    render(<JevFloatingComposer />);
    openAiAgent();
    expect(screen.queryByRole('combobox', { name: 'Request type' })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Jev action' });
    fireEvent.change(input, { target: { value: 'poi si allontana' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generateJevAction).toHaveBeenCalledWith(expect.objectContaining({ directionPlanId: planId, frame: 12, instruction: 'poi si allontana' })));
  });

  it('usa automaticamente l’elemento selezionato e applica la regia con Invio', async () => {
    useEditor.getState().addObject('cube');
    const objectId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    const generateJevAction = vi.fn().mockResolvedValue({ blenderPlan: { schemaVersion: 'BlenderPlanV1', summary: 'Jev', assumptions: [], warnings: [], operations: [{ id: crypto.randomUUID(), type: 'set_keyframe', objectId, frame: 1, property: 'position', value: { vector: [0, 0, 0], boolean: null, text: null, number: null }, interpolation: 'linear', rationale: 'Jev', commentIds: [] }] } });
    window.abaco = { generateJevAction } as unknown as NonNullable<Window['abaco']>;
    render(<JevFloatingComposer />);
    openAiAgent();
    const input = screen.getByRole('textbox', { name: 'Jev action' });
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('Cube 1'));
    fireEvent.change(input, { target: { value: 'vai a destra' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generateJevAction).toHaveBeenCalledWith(expect.objectContaining({ objectId, target: 'subject', sceneId, instruction: 'vai a destra' })));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('usa automaticamente la camera selezionata anche per il tratto disegnato', async () => {
    const camera = useEditor.getState().project.objects.find((object) => object.kind === 'camera')!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().select(camera.id);
    const generateJevAction = vi.fn().mockResolvedValue({ blenderPlan: { schemaVersion: 'BlenderPlanV1', summary: 'Jev camera', assumptions: [], warnings: [], operations: [{ id: crypto.randomUUID(), type: 'set_keyframe', objectId: camera.id, frame: 1, property: 'position', value: { vector: [0, -10, 7], boolean: null, text: null, number: null }, interpolation: 'linear', rationale: 'Jev', commentIds: [] }] } });
    window.abaco = { generateJevAction } as unknown as NonNullable<Window['abaco']>;
    render(<JevFloatingComposer />);
    openAiAgent();
    act(() => useEditor.getState().setJevStrokePoints([[.1, .5], [.9, .5]]));
    const input = screen.getByRole('textbox', { name: 'Jev action' });
    expect(input).toHaveAttribute('placeholder', expect.stringContaining(camera.name));
    fireEvent.change(input, { target: { value: 'avanza lentamente' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generateJevAction).toHaveBeenCalledWith(expect.objectContaining({ objectId: camera.id, target: 'camera', startPosition: null, gesture: expect.objectContaining({ target: 'camera' }) })));
  });

  it('permette di passare a Laya e invia lo stesso contesto al motore locale', async () => {
    useEditor.getState().addObject('cube');
    const objectId = useEditor.getState().selectedId!;
    const generateJevAction = vi.fn().mockResolvedValue({ blenderPlan: { schemaVersion: 'BlenderPlanV1', summary: 'Laya', assumptions: [], warnings: [], operations: [{ id: crypto.randomUUID(), type: 'set_keyframe', objectId, frame: 1, property: 'position', value: { vector: [0, 0, 0], boolean: null, text: null, number: null }, interpolation: 'linear', rationale: 'Laya', commentIds: [] }] }, performance: { engine: 'laya', totalMs: 180, decisionMs: 120, modelLoadMs: 0, warm: true } });
    window.abaco = { generateJevAction } as unknown as NonNullable<Window['abaco']>;
    render(<JevFloatingComposer />);
    openAiAgent();
    fireEvent.change(screen.getByRole('combobox', { name: 'Action model' }), { target: { value: 'laya' } });
    const input = screen.getByRole('textbox', { name: 'Laya action' });
    fireEvent.change(input, { target: { value: 'vai avanti' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generateJevAction).toHaveBeenCalledWith(expect.objectContaining({ engine: 'laya', objectId, instruction: 'vai avanti' })));
    expect(window.localStorage.getItem('scene-decision-engine')).toBe('laya');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Laya · Motion applied'));
    expect(screen.getByRole('status')).toHaveTextContent('120 ms');
  });

  it('attiva il disegno dal solo input senza cambiare la vista', () => {
    useEditor.getState().addObject('cube');
    render(<JevFloatingComposer />);
    openAiAgent();
    fireEvent.click(screen.getByRole('button', { name: 'Draw path' }));
    expect(useEditor.getState().cameraView).toBe(false);
    expect(useEditor.getState().jevStroke.active).toBe(true);
  });

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
    expect(body).toContainElement(screen.getByText('Numeric values'));
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

  it.each(['scene', 'framing', 'object'] as const)('scrive e salva indicazioni %s senza ricreare la textarea', (scope) => {
    useEditor.getState().addObject('cube');
    const initial = useEditor.getState();
    const objectId = initial.selectedId!;
    const scene = initial.project.cameraCuts[0];
    const label = scope === 'object' ? 'Cube 1' : scope === 'framing' ? initial.project.objects.find(o => o.id === scene.cameraId)!.name : scene.name!;
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(`Add ${label} comment`));
    const input = screen.getByRole('textbox', { name: `Direction for ${label}` });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Entra' } });
    expect(screen.getByRole('textbox', { name: `Direction for ${label}` })).toBe(input);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Entra lentamente in scena.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useEditor.getState().project.comments).toEqual(expect.arrayContaining([expect.objectContaining({ scope, sceneId: scene.id, text: 'Entra lentamente in scena.', targetIds: scope === 'object' ? [objectId] : expect.any(Array) })]));
  });

  it('mantiene bozza e contenitore quando si seleziona un elemento in Scenografia', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add Scene 1 comment'));
    const body = screen.getByRole('region', { name: 'Scenography content' });
    const input = screen.getByLabelText('Direction for Scene 1');
    fireEvent.change(input, { target: { value: 'Bozza da conservare' } });
    act(() => useEditor.getState().select(undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Select Cube 1' }));
    expect(screen.getByRole('region', { name: 'Scenography content' })).toBe(body);
    expect(screen.getByLabelText('Direction for Scene 1')).toBe(input);
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
    expect(screen.queryByRole('button', { name: `Select ${sphereName}` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Add Scene 1 comment'));
    fireEvent.change(screen.getByLabelText('Direction for Scene 1'), { target: { value: 'Prima scena' } });
    act(() => useEditor.getState().setFrame(secondScene.frame));
    expect(screen.getByRole('button', { name: `Select ${sphereName}` })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    act(() => useEditor.getState().setFrame(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useEditor.getState().project.comments[0]).toMatchObject({ text: 'Prima scena', sceneId: useEditor.getState().project.cameraCuts[0].id });
  });
});

describe('Preset nei campi Scenografia', () => {
  it('mostra / nel campo del personaggio, combina due preset e ne conserva i prompt al salvataggio', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add Cube 1 comment'));
    const input = screen.getByLabelText('Direction for Cube 1');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('option', { name: 'Annoyed Emotion' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Static camera Camera' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Annoyed Emotion' }));
    expect(input).toHaveValue('');
    expect(screen.getByText('Annoyed')).toBeInTheDocument();
    const query = '/si-av';
    fireEvent.change(input, { target: { value: query, selectionStart: query.length } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('');
    expect(screen.getByText('Approaches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const comment = useEditor.getState().project.comments[0];
    expect(comment.presets?.map(p => p.id)).toEqual(['scocciato', 'si-avvicina']);
    expect(comment.presets?.every(p => p.prompt.length > 100)).toBe(true);
    expect(screen.getByLabelText('Saved presets')).toBeInTheDocument();
    expect(screen.queryByText('/scocciato /si-avvicina')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Edit Cube 1 comment'));
    expect(screen.getByLabelText('Direction for Cube 1')).toHaveValue('');
    expect(screen.getByText('Annoyed')).toBeInTheDocument();
    expect(screen.getByText('Approaches')).toBeInTheDocument();
  });

  it('propone solo movimenti camera e lascia libera la descrizione narrativa', () => {
    const name = useEditor.getState().project.objects[0].name;
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(`Add ${name} comment`));
    const input = screen.getByLabelText(`Direction for ${name}`);
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('option', { name: 'Static camera Camera' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Annoyed Emotion' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Static camera Camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useEditor.getState().project.comments[0].presets?.[0].id).toBe('camera-statica');
    fireEvent.click(screen.getByTitle('Add Scene 1 comment'));
    const scene = screen.getByLabelText('Direction for Scene 1');
    expect(scene).toHaveValue('');
    fireEvent.change(scene, { target: { value: '/', selectionStart: 1 } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

it('allega lo standard direttamente da Scenografia', () => {
  render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
  const section = screen.getByText('Animation standard').closest('details')!;
  fireEvent.click(screen.getByText('Animation standard'));
  expect(section).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: 'Use included cartoon standard' }));
  expect(useEditor.getState().project.animationStandard?.name).toBe('STANDARD_ANIMAZIONE_GENERALE.md');
  expect(screen.getByText('Animation standard · Attached')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
