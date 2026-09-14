import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type AbacoProject } from './domain/schema';
import { useEditor } from './store/editor';
import App from './App';

vi.mock('./components/Viewport', () => ({ default: () => <div />, captureContactSheet: vi.fn() }));
vi.mock('./components/Inspector', () => ({ default: () => <div /> }));
vi.mock('./components/Timeline', () => ({ default: () => <div /> }));
vi.mock('./components/ElementsPanel', () => ({ default: () => <div /> }));

type SaveResult = { project: AbacoProject; path: string } | null;
type MenuCommand = Parameters<NonNullable<Window['abaco']>['onMenuCommand']>[0];
let menu: MenuCommand;
let saveProject: ReturnType<typeof vi.fn<NonNullable<Window['abaco']>['saveProject']>>;
let openProject: ReturnType<typeof vi.fn<NonNullable<Window['abaco']>['openProject']>>;
const deferred = () => {
  let resolve!: (value: SaveResult) => void;
  const promise = new Promise<SaveResult>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  useEditor.setState({ project: createProject(), projectPath: '/project.abaco', currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingSession: undefined, recordingMotion: undefined, past: [], future: [], dirty: false, isPlaying: false, cameraView: false });
  saveProject = vi.fn();
  openProject = vi.fn();
  window.abaco = { saveProject, openProject, syncPreviewProject: vi.fn(), syncPreviewFrame: vi.fn(), onMenuCommand: (callback: MenuCommand) => { menu = callback; return () => undefined; } } as unknown as NonNullable<Window['abaco']>;
});
afterEach(() => { cleanup(); delete window.abaco; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Salvataggi e apertura progetto', () => {
  it('non cancella modifiche effettuate mentre il salvataggio automatico è in corso', async () => {
    const pending = deferred();
    saveProject.mockReturnValue(pending.promise);
    useEditor.getState().addObject('cube');
    const savedSnapshot = useEditor.getState().project;
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(saveProject).toHaveBeenCalledOnce();
    act(() => useEditor.getState().addObject('sphere'));
    const edited = useEditor.getState().project;
    await act(async () => { pending.resolve({ project: savedSnapshot, path: '/project.abaco' }); });
    expect(useEditor.getState().project).toBe(edited);
    expect(useEditor.getState().dirty).toBe(true);
  });

  it('non ripristina il vecchio progetto quando un salvataggio termina dopo Nuovo', async () => {
    const pending = deferred();
    saveProject.mockReturnValue(pending.promise);
    const previous = useEditor.getState().project;
    render(<App />);
    await act(async () => { menu('save'); });
    act(() => useEditor.getState().newProject());
    const next = useEditor.getState().project;
    await act(async () => { pending.resolve({ project: previous, path: '/old.abaco' }); });
    expect(useEditor.getState().project).toBe(next);
    expect(useEditor.getState().projectPath).toBeUndefined();
  });

  it('serializza due salvataggi e conserva il percorso del primo Salva per le modifiche successive', async () => {
    const first = deferred();
    const second = deferred();
    saveProject.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    useEditor.setState({ projectPath: undefined });
    const initial = useEditor.getState().project;
    render(<App />);
    await act(async () => { menu('save'); });
    act(() => useEditor.getState().addObject('cube'));
    const latest = useEditor.getState().project;
    await act(async () => { menu('save'); });
    expect(saveProject).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve({ project: initial, path: '/new.abaco' }); });
    expect(saveProject).toHaveBeenNthCalledWith(2, latest, '/new.abaco');
    expect(useEditor.getState().dirty).toBe(true);
    await act(async () => { second.resolve({ project: latest, path: '/new.abaco' }); });
    expect(useEditor.getState().project).toBe(latest);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it('protegge modifiche non salvate prima di aprire un altro progetto', async () => {
    useEditor.getState().addObject('cube');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    await act(async () => { menu('open'); });
    expect(openProject).not.toHaveBeenCalled();
  });

  it('esporta lo snapshot salvato anche se si continua a modificare durante il salvataggio', async () => {
    const pending = deferred();
    saveProject.mockReturnValue(pending.promise);
    const build = vi.fn().mockResolvedValue({ version: 'v1', directory: '/export', blendPath: '/export/scene.blend' });
    window.abaco!.buildBlender = build;
    const snapshot = useEditor.getState().project;
    render(<App />);
    await act(async () => { menu('export-direct'); });
    act(() => useEditor.getState().addObject('cube'));
    await act(async () => { pending.resolve({ project: snapshot, path: '/project.abaco' }); });
    expect(build).toHaveBeenCalledWith(snapshot, expect.any(Object), '/project.abaco');
    expect(useEditor.getState().project.objects).toHaveLength(snapshot.objects.length + 1);
  });

  it('annulla l’esportazione in attesa quando si passa a un altro progetto', async () => {
    const pending = deferred();
    saveProject.mockReturnValue(pending.promise);
    const build = vi.fn();
    window.abaco!.buildBlender = build;
    const snapshot = useEditor.getState().project;
    render(<App />);
    await act(async () => { menu('export-direct'); });
    act(() => useEditor.getState().newProject());
    await act(async () => { pending.resolve({ project: snapshot, path: '/project.abaco' }); });
    expect(build).not.toHaveBeenCalled();
  });

  it('mostra gli errori di apertura senza perdere il progetto corrente', async () => {
    openProject.mockRejectedValue(new Error('File danneggiato'));
    const initial = useEditor.getState().project;
    render(<App />);
    await act(async () => { menu('open'); });
    expect(screen.getByText('File danneggiato')).toBeInTheDocument();
    expect(useEditor.getState().project).toBe(initial);
  });
});
