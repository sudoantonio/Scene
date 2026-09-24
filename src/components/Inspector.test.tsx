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

describe('Pannelli contestuali', () => {
  it('nasconde l’input AI finché non viene selezionato un soggetto', () => {
    render(<JevFloatingComposer />);
    expect(screen.queryByRole('textbox', { name: 'Azione Jev' })).not.toBeInTheDocument();
    expect(screen.queryByText('Soggetto di riferimento')).not.toBeInTheDocument();
    expect(screen.queryByText('Posizione iniziale')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pannello principale Jev' })).not.toBeInTheDocument();
  });

  it('aumenta l’altezza dell’input quando il testo occupa più righe', () => {
    useEditor.getState().addObject('cube');
    render(<JevFloatingComposer />);
    const input = screen.getByRole('textbox', { name: 'Azione Jev' });
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
    fireEvent.click(screen.getByText('Regia · 1 movimenti'));
    fireEvent.click(screen.getByRole('button', { name: /camera indietro/ }));
    const input = screen.getByRole('textbox', { name: 'Azione Jev' });
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
    expect(screen.queryByRole('combobox', { name: 'Tipo richiesta' })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Azione Jev' });
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
    const input = screen.getByRole('textbox', { name: 'Azione Jev' });
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('Cubo 1'));
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
    act(() => useEditor.getState().setJevStrokePoints([[.1, .5], [.9, .5]]));
    const input = screen.getByRole('textbox', { name: 'Azione Jev' });
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Modello azione' }), { target: { value: 'laya' } });
    const input = screen.getByRole('textbox', { name: 'Azione Laya' });
    fireEvent.change(input, { target: { value: 'vai avanti' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generateJevAction).toHaveBeenCalledWith(expect.objectContaining({ engine: 'laya', objectId, instruction: 'vai avanti' })));
    expect(window.localStorage.getItem('scene-decision-engine')).toBe('laya');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Laya · Movimento applicato'));
    expect(screen.getByRole('status')).toHaveTextContent('120 ms');
  });

  it('attiva il disegno dal solo input senza cambiare la vista', () => {
    useEditor.getState().addObject('cube');
    render(<JevFloatingComposer />);
    fireEvent.click(screen.getByRole('button', { name: 'Disegna traiettoria' }));
    expect(useEditor.getState().cameraView).toBe(false);
    expect(useEditor.getState().jevStroke.active).toBe(true);
  });

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

  it('appoggia un elemento selezionato sul piano', () => {
    useEditor.getState().addObject('cube');
    const id = useEditor.getState().selectedId!;
    useEditor.getState().setTransform(id, { position: [2, 3, 6], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5] });
    render(<Inspector panel="edit" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Appoggia al piano' }));
    const object = useEditor.getState().project.objects.find((item) => item.id === id)!;
    expect(evaluateTransform(object, 1).position).toEqual([2, 3, 1.5]);
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

describe('Preset nei campi Scenografia', () => {
  it('mostra / nel campo del personaggio, combina due preset e ne conserva i prompt al salvataggio', () => {
    useEditor.getState().addObject('cube');
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Aggiungi commento Cubo 1'));
    const input = screen.getByLabelText('Indicazione Cubo 1');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('option', { name: 'Scocciato Emozione' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Camera statica Camera' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Scocciato Emozione' }));
    expect(input).toHaveValue('');
    expect(screen.getByText('Scocciato')).toBeInTheDocument();
    const query = '/si-av';
    fireEvent.change(input, { target: { value: query, selectionStart: query.length } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('');
    expect(screen.getByText('Si avvicina')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    const comment = useEditor.getState().project.comments[0];
    expect(comment.presets?.map(p => p.id)).toEqual(['scocciato', 'si-avvicina']);
    expect(comment.presets?.every(p => p.prompt.length > 100)).toBe(true);
    expect(screen.getByLabelText('Preset salvati')).toBeInTheDocument();
    expect(screen.queryByText('/scocciato /si-avvicina')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Modifica commento Cubo 1'));
    expect(screen.getByLabelText('Indicazione Cubo 1')).toHaveValue('');
    expect(screen.getByText('Scocciato')).toBeInTheDocument();
    expect(screen.getByText('Si avvicina')).toBeInTheDocument();
  });

  it('propone solo movimenti camera e lascia libera la descrizione narrativa', () => {
    const name = useEditor.getState().project.objects[0].name;
    render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(`Aggiungi commento ${name}`));
    const input = screen.getByLabelText(`Indicazione ${name}`);
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('option', { name: 'Camera statica Camera' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Scocciato Emozione' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Camera statica Camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(useEditor.getState().project.comments[0].presets?.[0].id).toBe('camera-statica');
    fireEvent.click(screen.getByTitle('Aggiungi commento Scena 1'));
    const scene = screen.getByLabelText('Indicazione Scena 1');
    expect(scene).toHaveValue('');
    fireEvent.change(scene, { target: { value: '/', selectionStart: 1 } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

it('allega lo standard direttamente da Scenografia', () => {
  render(<Inspector panel="scene" onPanelChange={vi.fn()} />);
  const section = screen.getByText('Standard animazione').closest('details')!;
  fireEvent.click(screen.getByText('Standard animazione'));
  expect(section).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: 'Usa standard cartoon incluso' }));
  expect(useEditor.getState().project.animationStandard?.name).toBe('STANDARD_ANIMAZIONE_GENERALE.md');
  expect(screen.getByText('Standard animazione · Allegato')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
