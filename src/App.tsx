import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { applyPlan } from './domain/animation';
import type { BlenderPlan } from './domain/schema';
import Inspector from './components/Inspector';
import ElementsPanel from './components/ElementsPanel';
import LibraryPanel from './components/LibraryPanel';
import PlanReview from './components/PlanReview';
import SettingsModal from './components/SettingsModal';
import Timeline from './components/Timeline';
import Viewport, { captureContactSheet } from './components/Viewport';
import { useEditor } from './store/editor';

const emptyPlan = (): BlenderPlan => ({ schemaVersion: 'BlenderPlanV1', summary: 'Esportazione diretta senza modifiche AI.', assumptions: [], warnings: [], operations: [] });
const initialLayout = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('abaco-layout-v1') ?? '{}');
    return { left: Number(saved.left) || 158, right: Number(saved.right) || 310, timeline: Number(saved.timeline) || 270 };
  } catch { return { left: 158, right: 310, timeline: 270 }; }
};
const initialTheme = (): 'light' | 'dark' => localStorage.getItem('abaco-theme') === 'dark' ? 'dark' : 'light';

export default function App() {
  const project = useEditor((state) => state.project);
  const projectPath = useEditor((state) => state.projectPath);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [inspectorPanel, setInspectorPanel] = useState<'edit' | 'scene' | 'light'>('edit');
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(initialLayout);
  const [collapsed, setCollapsed] = useState({ left: false, right: false, timeline: false });
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error' | 'info'; text: string }>();

  const notify = (type: 'ok' | 'error' | 'info', text: string) => { setMessage({ type, text }); window.setTimeout(() => setMessage(undefined), 6500); };
  const requireDesktop = () => { if (!window.abaco) { notify('error', 'Questa funzione richiede l’app desktop Electron.'); return false; } return true; };

  const save = async (path = projectPath) => {
    if (!requireDesktop()) return null;
    const result = await window.abaco!.saveProject(useEditor.getState().project, path);
    if (result) markSaved(result.project, result.path);
    return result;
  };
  const open = async () => {
    if (!requireDesktop()) return;
    const result = await window.abaco!.openProject();
    if (result) { loadProject(result.project, result.path); notify('ok', `Aperto ${result.project.name}`); }
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
      const current = useEditor.getState().project;
      if (!current.comments.some((comment) => comment.status === 'pending')) {
        const output = await window.abaco!.buildBlender(current, emptyPlan(), saved.path);
        notify('ok', `Creato ${output.version}: ${output.blendPath}. Nessun commento da interpretare: ho esportato la scena corrente.`);
        return;
      }
      const frames = [useEditor.getState().currentFrame, ...current.comments.filter((comment) => comment.status === 'pending').flatMap((comment) => [comment.startFrame, comment.endFrame]), ...current.cameraCuts.map((cut) => cut.frame)];
      const sheet = await captureContactSheet(frames);
      const response = await window.abaco!.generatePlan(current, sheet);
      setPlan(response); setMessage(undefined);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!plan || !projectPath || !window.abaco) return;
    try {
      setBusy(true);
      const next = applyPlan(useEditor.getState().project, plan);
      const output = await window.abaco.buildBlender(next, plan, projectPath);
      acceptPlan(plan);
      const saved = await window.abaco.saveProject(useEditor.getState().project, projectPath);
      if (saved) markSaved(saved.project, saved.path);
      setPlan(undefined); notify('ok', `Creato ${output.version}: ${output.blendPath}`);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const exportDirect = async () => {
    if (!requireDesktop()) return;
    try {
      setBusy(true);
      const saved = await save();
      if (!saved) return;
      const output = await window.abaco!.buildBlender(useEditor.getState().project, emptyPlan(), saved.path);
      notify('ok', `Creato ${output.version}: ${output.blendPath}`);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const beginResize = (part: 'left' | 'right' | 'timeline', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY, value: layout[part] };
    let finalValue = origin.value;
    const valueFromPointer = (pointer: PointerEvent) => {
      const delta = part === 'left' ? pointer.clientX - origin.x : part === 'right' ? origin.x - pointer.clientX : origin.y - pointer.clientY;
      const limits = part === 'timeline' ? [150, 520] : part === 'left' ? [96, 360] : [240, 500];
      return Math.max(limits[0], Math.min(limits[1], origin.value + delta));
    };
    const move = (pointer: PointerEvent) => {
      finalValue = valueFromPointer(pointer);
      if (part === 'timeline' && shellRef.current) shellRef.current.style.gridTemplateRows = `40px minmax(0,1fr) 5px ${finalValue}px`;
      else if (workspaceRef.current) workspaceRef.current.style.gridTemplateColumns = `minmax(0,${part === 'left' ? finalValue : layout.left}px) 5px minmax(0,1fr) 5px minmax(0,${part === 'right' ? finalValue : layout.right}px)`;
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
      if (state.currentFrame >= state.project.settings.frameEnd) { state.setFrame(state.project.settings.frameStart); state.setPlaying(false); }
      else state.setFrame(state.currentFrame + 1);
    }, 1000 / project.settings.fps);
    return () => window.clearInterval(timer);
  }, [playing, project.settings.fps]);

  useEffect(() => {
    if (!dirty || !projectPath || !window.abaco) return;
    const timer = window.setTimeout(() => window.abaco!.saveProject(useEditor.getState().project, projectPath).then((result) => { if (result) markSaved(result.project, result.path); }).catch(() => undefined), 900);
    return () => window.clearTimeout(timer);
  }, [dirty, project, projectPath, markSaved]);

  useEffect(() => {
    try { localStorage.setItem('abaco-layout-v1', JSON.stringify(layout)); } catch { /* preferenze non disponibili */ }
  }, [layout]);

  useEffect(() => {
    localStorage.setItem('abaco-theme', theme);
  }, [theme]);

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
    document.title = `${project.name}${dirty ? ' •' : ''} — Abaco Animatic`;
  }, [dirty, project.name]);

  useEffect(() => {
    const openMotionEditor = () => { setInspectorPanel('edit'); setCollapsed((value) => ({ ...value, right: false })); };
    window.addEventListener('abaco:edit-motion', openMotionEditor);
    return () => window.removeEventListener('abaco:edit-motion', openMotionEditor);
  }, []);

  useEffect(() => window.abaco?.onMenuCommand((command) => {
    if (command === 'new') createNew();
    else if (command === 'open') open();
    else if (command === 'save') save();
    else if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'export-astra') generate();
    else if (command === 'export-direct') exportDirect();
    else if (command === 'settings') setSettingsOpen(true);
    else if (command === 'toggle-theme') setTheme((value) => value === 'light' ? 'dark' : 'light');
  }), [dirty, projectPath]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === ' ') { event.preventDefault(); setPlaying(!useEditor.getState().isPlaying); }
      if (event.key.toLowerCase() === 'g') setGizmoMode('translate');
      if (event.key.toLowerCase() === 'r') setGizmoMode('rotate');
      if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) setGizmoMode('scale');
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [setGizmoMode, setPlaying]);

  const leftWidth = collapsed.left ? 32 : layout.left;
  const rightWidth = collapsed.right ? 32 : layout.right;
  const timelineHeight = collapsed.timeline ? 43 : layout.timeline;
  const toggleViewportFullscreen = () => {
    setViewportFullscreen((value) => {
      if (!value) setCameraView(true);
      return !value;
    });
  };
  return <div ref={shellRef} className={`app-shell theme-${theme} ${viewportFullscreen ? 'viewport-fullscreen' : ''}`} style={{ gridTemplateRows: `40px minmax(0,1fr) 5px ${timelineHeight}px` }}>
    <div className="slim-headbar"><div ref={addMenuRef} className="quick-add-menu"><button className="slim-add" onClick={() => setAddOpen((value) => !value)}><Plus size={17} /> Aggiungi</button>{addOpen && <div className="quick-add-popover" onClick={() => setAddOpen(false)}><ElementsPanel mode="add" /></div>}</div></div>
    <main ref={workspaceRef} className="workspace" style={{ gridTemplateColumns: `minmax(0,${leftWidth}px) 5px minmax(0,1fr) 5px minmax(0,${rightWidth}px)` }}>
      <LibraryPanel collapsed={collapsed.left} onToggleCollapse={() => setCollapsed((value) => ({ ...value, left: !value.left }))} />
      <div className="panel-resizer vertical" title="Ridimensiona pannello sinistro" onPointerDown={(event) => { if (!collapsed.left) beginResize('left', event); }} />
      <Viewport dark={theme === 'dark'} />
      <div className="panel-resizer vertical" title="Ridimensiona pannello destro" onPointerDown={(event) => { if (!collapsed.right) beginResize('right', event); }} />
      <Inspector panel={inspectorPanel} onPanelChange={setInspectorPanel} collapsed={collapsed.right} onToggleCollapse={() => setCollapsed((value) => ({ ...value, right: !value.right }))} />
    </main>
    <div className="panel-resizer horizontal" title="Ridimensiona timeline" onPointerDown={(event) => { if (!collapsed.timeline) beginResize('timeline', event); }} />
    <Timeline collapsed={collapsed.timeline} viewportFullscreen={viewportFullscreen} onToggleViewportFullscreen={toggleViewportFullscreen} onToggleCollapse={() => setCollapsed((value) => ({ ...value, timeline: !value.timeline }))} />
    {message && <div className={`toast ${message.type}`}>{message.type === 'error' ? 'Errore' : message.type === 'ok' ? 'Completato' : 'In corso'}<span>{message.text}</span></div>}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    {plan && <PlanReview plan={plan} busy={busy} onClose={() => setPlan(undefined)} onApprove={approve} />}
  </div>;
}
