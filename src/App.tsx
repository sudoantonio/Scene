import { useEffect, useRef, useState } from 'react';
import { Box, Plus, SlidersHorizontal, Sun } from 'lucide-react';
import { applyPlan } from './domain/animation';
import type { BlenderPlan } from './domain/schema';
import Inspector from './components/Inspector';
import ElementsPanel from './components/ElementsPanel';
import PlanReview from './components/PlanReview';
import SettingsModal from './components/SettingsModal';
import Timeline from './components/Timeline';
import Viewport, { captureContactSheet } from './components/Viewport';
import AudioPlayback from './components/AudioPlayback';
import JevFloatingComposer from './components/JevFloatingComposer';
import { useEditor } from './store/editor';
import headerLogo from './assets/abaco-scene-header.png';

const emptyPlan = (): BlenderPlan => ({ schemaVersion: 'BlenderPlanV1', summary: 'Esportazione diretta senza modifiche AI.', assumptions: [], warnings: [], operations: [] });
const initialLayout = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('abaco-layout-v1') ?? '{}');
    return { right: Number(saved.right) || 310, timeline: Number(saved.timeline) || 270 };
  } catch { return { right: 310, timeline: 270 }; }
};

export default function App() {
  const project = useEditor((state) => state.project);
  const projectPath = useEditor((state) => state.projectPath);
  const currentFrame = useEditor((state) => state.currentFrame);
  const playing = useEditor((state) => state.isPlaying);
  const dirty = useEditor((state) => state.dirty);
  const newProject = useEditor((state) => state.newProject);
  const loadProject = useEditor((state) => state.loadProject);
  const markSaved = useEditor((state) => state.markSaved);
  const setFrame = useEditor((state) => state.setFrame);
  const setPlaying = useEditor((state) => state.setPlaying);
  const setCameraView = useEditor((state) => state.setCameraView);
  const setGizmoMode = useEditor((state) => state.setGizmoMode);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const acceptPlan = useEditor((state) => state.acceptPlan);
  const [plan, setPlan] = useState<BlenderPlan>();
  const planProjectRef = useRef<ReturnType<typeof useEditor.getState>['project'] | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [inspectorPanel, setInspectorPanel] = useState<'edit' | 'scene' | 'light'>('edit');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const inspectorMenuRef = useRef<HTMLDivElement>(null);
  const inspectorPopoverRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(initialLayout);
  const [collapsed, setCollapsed] = useState({ right: false, timeline: false });
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const theme: 'dark' = 'dark';
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error' | 'info'; text: string }>();
  // File writes must finish in order, and their results must never replace edits
  // made while the native save operation was still running.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const notify = (type: 'ok' | 'error' | 'info', text: string) => { setMessage({ type, text }); window.setTimeout(() => setMessage(undefined), 6500); };
  const requireDesktop = () => { if (!window.abaco) { notify('error', 'Questa funzione richiede l’app desktop Electron.'); return false; } return true; };

  const save = async (path = projectPath) => {
    if (!requireDesktop()) return null;
    const snapshot = useEditor.getState().project;
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      if (useEditor.getState().project.id !== snapshot.id) return null;
      const result = await window.abaco!.saveProject(snapshot, path ?? useEditor.getState().projectPath);
      const current = useEditor.getState();
      if (current.project.id !== snapshot.id) return null;
      if (result && current.project.id === snapshot.id) {
        if (current.project === snapshot) markSaved(result.project, result.path);
        else useEditor.setState({ projectPath: result.path });
      }
      return result;
    });
    saveQueue.current = operation;
    return operation;
  };
  const open = async () => {
    if (!requireDesktop()) return;
    if (useEditor.getState().dirty && !window.confirm('Il progetto contiene modifiche non salvate. Aprire comunque un altro progetto?')) return;
    try {
      const result = await window.abaco!.openProject();
      if (result) { loadProject(result.project, result.path); notify('ok', `Aperto ${result.project.name}`); }
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Impossibile aprire il progetto.'); }
  };
  const createNew = () => {
    if (!dirty || window.confirm('Il progetto contiene modifiche non salvate. Creare comunque un nuovo progetto?')) newProject();
  };
  const generate = async () => {
    if (!requireDesktop()) return;
    try {
      setBusy(true); notify('info', 'Preparo scena, commenti e fotogrammi per Astra…');
      const saved = await save();
      if (!saved) return;
      const current = saved.project;
      if (!current.comments.some((comment) => comment.status === 'pending')) {
        const output = await window.abaco!.buildBlender(current, emptyPlan(), saved.path);
        notify('ok', `Cartella ${output.version} esportata: ${output.directory}. Contiene progetto, asset, file Blender${output.audioPath ? ' e traccia audio WAV separata' : ''}.`);
        return;
      }
      const frames = [useEditor.getState().currentFrame, ...current.comments.filter((comment) => comment.status === 'pending').flatMap((comment) => [comment.startFrame, comment.endFrame]), ...current.cameraCuts.map((cut) => cut.frame)];
      const sheet = await captureContactSheet(frames);
      const response = await window.abaco!.generatePlan(current, sheet);
      if (useEditor.getState().project !== current) {
        notify('error', 'Il progetto è cambiato durante la generazione. Genera di nuovo il piano sul progetto aggiornato.');
        return;
      }
      planProjectRef.current = current;
      setPlan(response); setMessage(undefined);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!plan || !projectPath || !window.abaco) return;
    if (useEditor.getState().project !== planProjectRef.current) {
      setPlan(undefined);
      notify('error', 'Il progetto è cambiato dopo la generazione. Genera di nuovo il piano prima di applicarlo.');
      return;
    }
    try {
      setBusy(true);
      const next = applyPlan(useEditor.getState().project, plan);
      const output = await window.abaco.buildBlender(next, plan, projectPath);
      if (useEditor.getState().project !== planProjectRef.current) {
        setPlan(undefined);
        notify('info', `Esportazione creata in ${output.directory}. Il progetto è stato modificato nel frattempo: il piano non è stato applicato alle nuove modifiche.`);
        return;
      }
      acceptPlan(plan);
      await save(projectPath);
      setPlan(undefined); notify('ok', `Cartella ${output.version} esportata: ${output.directory}. Contiene progetto, asset, file Blender${output.audioPath ? ' e traccia audio WAV separata' : ''}.`);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const exportDirect = async () => {
    if (!requireDesktop()) return;
    try {
      setBusy(true);
      const saved = await save();
      if (!saved) return;
      const output = await window.abaco!.buildBlender(saved.project, emptyPlan(), saved.path);
      notify('ok', `Cartella ${output.version} esportata: ${output.directory}. Contiene progetto, asset, file Blender${output.audioPath ? ' e traccia audio WAV separata' : ''}.`);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const beginResize = (part: 'right' | 'timeline', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY, value: layout[part] };
    let finalValue = origin.value;
    const valueFromPointer = (pointer: PointerEvent) => {
      const delta = part === 'right' ? origin.x - pointer.clientX : origin.y - pointer.clientY;
      const limits = part === 'timeline' ? [150, 520] : [240, 500];
      return Math.max(limits[0], Math.min(limits[1], origin.value + delta));
    };
    const move = (pointer: PointerEvent) => {
      finalValue = valueFromPointer(pointer);
      if (part === 'timeline' && shellRef.current) shellRef.current.style.gridTemplateRows = `40px minmax(0,1fr) 10px ${finalValue}px`;
      else if (workspaceRef.current) workspaceRef.current.style.gridTemplateColumns = `minmax(0,1fr) 10px minmax(0,${finalValue}px)`;
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      setLayout((current) => ({ ...current, [part]: finalValue }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const state = useEditor.getState();
      if (state.recordingSession) {
        const scenes = state.project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
        const index = scenes.findIndex((scene) => scene.id === state.recordingSession?.sceneId);
        const sceneEnd = scenes[index + 1]?.frame ?? state.project.settings.frameEnd + 1;
        if (index < 0 || state.currentFrame >= sceneEnd - 1) {
          state.stopRecording();
          return;
        }
      }
      if (state.currentFrame >= state.project.settings.frameEnd) { state.setFrame(state.project.settings.frameStart); state.setPlaying(false); }
      else state.setFrame(state.currentFrame + 1);
    }, 1000 / project.settings.fps);
    return () => window.clearInterval(timer);
  }, [playing, project.settings.fps]);

  useEffect(() => {
    if (!dirty || !projectPath || !window.abaco) return;
    const timer = window.setTimeout(() => { void save(projectPath).catch((error) => notify('error', error instanceof Error ? error.message : 'Salvataggio automatico non riuscito.')); }, 900);
    return () => window.clearTimeout(timer);
  }, [dirty, project, projectPath, markSaved]);

  useEffect(() => {
    try { localStorage.setItem('abaco-layout-v1', JSON.stringify(layout)); } catch { /* preferenze non disponibili */ }
  }, [layout]);

  useEffect(() => {
    window.abaco?.syncPreviewProject({ project, frame: currentFrame, theme });
  }, [project, theme]);

  useEffect(() => {
    window.abaco?.syncPreviewFrame(currentFrame);
  }, [currentFrame]);

  useEffect(() => {
    if (!viewportFullscreen) return;
    const exit = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewportFullscreen(false); };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [viewportFullscreen]);

  useEffect(() => {
    if (!addOpen) return;
    const close = (event: PointerEvent) => { if (!addMenuRef.current?.contains(event.target as Node)) setAddOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [addOpen]);

  useEffect(() => {
    if (!inspectorOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!inspectorPopoverRef.current?.contains(target) && !inspectorMenuRef.current?.contains(target)) setInspectorOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setInspectorOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [inspectorOpen]);

  useEffect(() => {
    document.title = `${project.name}${dirty ? ' •' : ''} — Scene`;
  }, [dirty, project.name]);

  useEffect(() => {
    const openMotionEditor = () => { setInspectorPanel('edit'); setInspectorOpen(true); };
    const openAudioEditor = () => { setInspectorPanel('edit'); setInspectorOpen(true); };
    window.addEventListener('abaco:edit-motion', openMotionEditor);
    window.addEventListener('abaco:edit-audio', openAudioEditor);
    return () => { window.removeEventListener('abaco:edit-motion', openMotionEditor); window.removeEventListener('abaco:edit-audio', openAudioEditor); };
  }, []);

  useEffect(() => window.abaco?.onMenuCommand((command) => {
    if (command === 'new') createNew();
    else if (command === 'open') open();
    else if (command === 'save') void save().catch((error) => notify('error', error instanceof Error ? error.message : 'Salvataggio non riuscito.'));
    else if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'export-astra') generate();
    else if (command === 'export-direct') exportDirect();
    else if (command === 'settings') setSettingsOpen(true);
  }), [dirty, projectPath]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === ' ') { event.preventDefault(); setPlaying(!useEditor.getState().isPlaying); }
      if (event.key.toLowerCase() === 'g') setGizmoMode('translate');
      if (event.key.toLowerCase() === 'r') setGizmoMode('rotate');
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [setGizmoMode, setPlaying]);

  const timelineHeight = collapsed.timeline ? 68 : layout.timeline;
  const toggleViewportFullscreen = () => {
    setViewportFullscreen((value) => {
      if (!value) setCameraView(true);
      return !value;
    });
  };
  return <div ref={shellRef} className={`app-shell theme-${theme} ${viewportFullscreen ? 'viewport-fullscreen' : ''}`} style={{ gridTemplateRows: `40px minmax(0,1fr) 10px ${timelineHeight}px` }}>
    <AudioPlayback />
    <div className="slim-headbar">
      <img className="headbar-logo" src={headerLogo} alt="Scene" draggable={false} />
      <div ref={addMenuRef} className="quick-add-menu"><button className="slim-add" onClick={() => setAddOpen((value) => !value)}><Plus size={17} /> Aggiungi</button>{addOpen && <div className="quick-add-popover" onClick={() => setAddOpen(false)}><ElementsPanel mode="add" /></div>}</div>
      <nav ref={inspectorMenuRef} className="header-inspector-tabs" aria-label="Controlli scena">{([
        ['edit', SlidersHorizontal, 'Modifica'], ['scene', Box, 'Scenografia'], ['light', Sun, 'Luce'],
      ] as const).map(([id, Icon, label]) => <button key={id} className={inspectorOpen && inspectorPanel === id ? 'active' : ''} aria-expanded={inspectorOpen && inspectorPanel === id} onClick={() => { if (inspectorPanel === id) setInspectorOpen((value) => !value); else { setInspectorPanel(id); setInspectorOpen(true); } }}><Icon size={14} />{label}</button>)}</nav>
    </div>
    <main ref={workspaceRef} className="workspace workspace-main-only" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div className="viewport-stack"><Viewport dark={theme === 'dark'} /><JevFloatingComposer /></div>
      {inspectorOpen && <div ref={inspectorPopoverRef} className="main-inspector-popover"><Inspector panel={inspectorPanel} onPanelChange={setInspectorPanel} floating onClose={() => setInspectorOpen(false)} /></div>}
    </main>
    <div className="panel-resizer horizontal" title="Ridimensiona timeline" onPointerDown={(event) => { if (!collapsed.timeline) beginResize('timeline', event); }} />
    <Timeline collapsed={collapsed.timeline} viewportFullscreen={viewportFullscreen} onToggleViewportFullscreen={toggleViewportFullscreen} onToggleCollapse={() => setCollapsed((value) => ({ ...value, timeline: !value.timeline }))} />
    {message && <div className={`toast ${message.type}`}>{message.type === 'error' ? 'Errore' : message.type === 'ok' ? 'Completato' : 'In corso'}<span>{message.text}</span></div>}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    {plan && <PlanReview plan={plan} busy={busy} onClose={() => setPlan(undefined)} onApprove={approve} />}
  </div>;
}
