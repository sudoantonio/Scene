import { prepareEditedMedia } from './domain/edited-media';
import { useEffect, useRef, useState } from 'react';
import { PanelRightOpen, Plus, Redo2, Undo2 } from 'lucide-react';
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

const emptyPlan = (): BlenderPlan => ({ schemaVersion: 'BlenderPlanV1', summary: 'Direct export without AI changes.', assumptions: [], warnings: [], operations: [] });
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
  const setGizmoMode = useEditor((state) => state.setGizmoMode);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const canUndo = useEditor((state) => state.past.length > 0);
  const canRedo = useEditor((state) => state.future.length > 0);
  const acceptPlan = useEditor((state) => state.acceptPlan);
  const [plan, setPlan] = useState<BlenderPlan>();
  const planProjectRef = useRef<ReturnType<typeof useEditor.getState>['project'] | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [inspectorPanel, setInspectorPanel] = useState<'edit' | 'scene' | 'light'>('edit');
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(initialLayout);
  const [collapsed, setCollapsed] = useState({ right: false, timeline: false });
  const theme: 'dark' = 'dark';
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error' | 'info'; text: string }>();
  // File writes must finish in order, and their results must never replace edits
  // made while the native save operation was still running.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const notify = (type: 'ok' | 'error' | 'info', text: string) => { setMessage({ type, text }); window.setTimeout(() => setMessage(undefined), 6500); };
  const requireDesktop = () => { if (!window.abaco) { notify('error', 'This feature requires the Electron desktop app.'); return false; } return true; };

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
    if (useEditor.getState().dirty && !window.confirm('The project has unsaved changes. Open another project anyway?')) return;
    try {
      const result = await window.abaco!.openProject();
      if (result) { loadProject(result.project, result.path); notify('ok', `Opened ${result.project.name}`); }
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Could not open the project.'); }
  };
  const createNew = () => {
    if (!dirty || window.confirm('The project has unsaved changes. Create a new project anyway?')) newProject();
  };
  const generate = async () => {
    if (!requireDesktop()) return;
    try {
      setBusy(true); notify('info', 'Preparing the scene, notes, and frames for Astra…');
      const saved = await save();
      if (!saved) return;
      const current = saved.project;
      if (!current.comments.some((comment) => comment.status === 'pending')) {
        const output = await window.abaco!.buildBlender(current, emptyPlan(), saved.path);
        notify('ok', `Folder ${output.version} exported to ${output.directory}. It contains the project, assets, and Blender file${output.audioPath ? ', plus a separate WAV audio track' : ''}.`);
        return;
      }
      const frames = [useEditor.getState().currentFrame, ...current.comments.filter((comment) => comment.status === 'pending').flatMap((comment) => [comment.startFrame, comment.endFrame]), ...current.cameraCuts.map((cut) => cut.frame)];
      const sheet = await captureContactSheet(frames);
      const response = await window.abaco!.generatePlan(current, sheet);
      if (useEditor.getState().project !== current) {
        notify('error', 'The project changed during generation. Generate the plan again from the updated project.');
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
      notify('error', 'The project changed after generation. Generate the plan again before applying it.');
      return;
    }
    try {
      setBusy(true);
      const next = applyPlan(useEditor.getState().project, plan);
      const output = await window.abaco.buildBlender(next, plan, projectPath);
      if (useEditor.getState().project !== planProjectRef.current) {
        setPlan(undefined);
        notify('info', `Export created in ${output.directory}. The project changed in the meantime, so the plan was not applied to the new changes.`);
        return;
      }
      acceptPlan(plan);
      await save(projectPath);
      setPlan(undefined); notify('ok', `Folder ${output.version} exported to ${output.directory}. It contains the project, assets, and Blender file${output.audioPath ? ', plus a separate WAV audio track' : ''}.`);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(false); }
  };
  const exportAiFolder = async () => {
    if (!requireDesktop() || busy) return;
    try {
      setBusy(true);
      window.dispatchEvent(new Event('abaco:flush-camera-edit'));
      const snapshot = useEditor.getState();
      const editedMedia = await prepareEditedMedia(snapshot.project, window.abaco!.loadAsset, text => notify('info', text));
      const output = await window.abaco!.exportAiFolder(snapshot.project, snapshot.projectPath, editedMedia);
      if (output) notify(output.warnings.length ? 'info' : 'ok', `Cartella per l’AI creata: ${output.directory}. ${output.files} file inclusi.${output.warnings.length ? ' Consulta LEGGIMI.md per i punti da verificare.' : ''}`);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Esportazione non riuscita.'); }
    finally { setBusy(false); }
  };
  const exportDirect = async () => {
    if (!requireDesktop()) return;
    try {
      setBusy(true);
      const saved = await save();
      if (!saved) return;
      const output = await window.abaco!.buildBlender(saved.project, emptyPlan(), saved.path);
      notify('ok', `Folder ${output.version} exported to ${output.directory}. It contains the project, assets, and Blender file${output.audioPath ? ', plus a separate WAV audio track' : ''}.`);
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
    const timer = window.setTimeout(() => { void save(projectPath).catch((error) => notify('error', error instanceof Error ? error.message : 'Autosave failed.')); }, 900);
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
    if (!addOpen) return;
    const close = (event: PointerEvent) => { if (!addMenuRef.current?.contains(event.target as Node)) setAddOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [addOpen]);

  useEffect(() => {
    document.title = `${project.name}${dirty ? ' •' : ''} — Scene`;
  }, [dirty, project.name]);

  useEffect(() => {
    const openMotionEditor = () => { setInspectorPanel('edit'); setCollapsed((value) => ({ ...value, right: false })); };
    const openAudioEditor = () => { setInspectorPanel('edit'); setCollapsed((value) => ({ ...value, right: false })); };
    window.addEventListener('abaco:edit-motion', openMotionEditor);
    window.addEventListener('abaco:edit-audio', openAudioEditor);
    return () => { window.removeEventListener('abaco:edit-motion', openMotionEditor); window.removeEventListener('abaco:edit-audio', openAudioEditor); };
  }, []);

  useEffect(() => window.abaco?.onMenuCommand((command) => {
    if (command === 'new') createNew();
    else if (command === 'open') open();
    else if (command === 'save') void save().catch((error) => notify('error', error instanceof Error ? error.message : 'Save failed.'));
    else if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'export-astra') generate();
    else if (command === 'export-direct') exportDirect();
    else if (command === 'export-ai-folder') exportAiFolder();
    else if (command === 'settings') setSettingsOpen(true);
  }), [dirty, projectPath, busy]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const editor = useEditor.getState();
      const selectedCanvasObjects = editor.selectedIds.some((id) => editor.project.objects.some((object) => object.id === id && object.kind !== 'camera' && object.kind !== 'audio' && !object.kind.includes('light')));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        if (editor.pasteSelection().length) event.preventDefault();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && selectedCanvasObjects) {
        const key = event.key.toLowerCase();
        if (key === 'c') { event.preventDefault(); editor.copySelection(); return; }
        if (key === 'd') { event.preventDefault(); editor.duplicateSelection(); return; }
        if (key === 'g') { event.preventDefault(); if (event.shiftKey) editor.ungroupSelection(); else editor.groupSelection(); return; }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCanvasObjects && !editor.selectedMotion) {
        event.preventDefault(); editor.deleteSelection(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (event.key === ' ') { event.preventDefault(); setPlaying(!useEditor.getState().isPlaying); }
      if (event.key.toLowerCase() === 'g') setGizmoMode('translate');
      if (event.key.toLowerCase() === 'r') setGizmoMode('rotate');
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [redo, setGizmoMode, setPlaying, undo]);

  const rightWidth = collapsed.right ? 32 : layout.right;
  const timelineHeight = collapsed.timeline ? 72 : layout.timeline;
  const dockInspectorBesideTimeline = collapsed.timeline && !collapsed.right;
  return <div ref={shellRef} className={`app-shell theme-${theme} ${dockInspectorBesideTimeline ? 'timeline-sidebar-docked' : ''}`} style={{ gridTemplateRows: `34px minmax(0,1fr) 10px ${timelineHeight}px`, ...(dockInspectorBesideTimeline ? { gridTemplateColumns: `minmax(0,1fr) 10px minmax(0,${rightWidth}px)` } : {}) }}>
    <AudioPlayback />
    <div className="slim-headbar">
      <div ref={addMenuRef} className="quick-add-menu"><button className="slim-add" onClick={() => setAddOpen((value) => !value)}><Plus size={17} /> Add</button>{addOpen && <div className="quick-add-popover" onClick={() => setAddOpen(false)}><ElementsPanel mode="add" /></div>}</div>
      <div className={`headbar-history ${collapsed.right ? 'with-panel-toggle' : ''}`}>
        <button type="button" aria-label="Undo" title="Undo · ⌘/Ctrl+Z" disabled={!canUndo} onClick={undo}><Undo2 size={19} /></button>
        <button type="button" aria-label="Redo" title="Redo · ⌘/Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}><Redo2 size={19} /></button>
      </div>
      {collapsed.right && <button className="headbar-inspector-open" aria-label="Open side panel" title="Open panels" onClick={() => setCollapsed((value) => ({ ...value, right: false }))}><PanelRightOpen size={15} /></button>}
    </div>
    <main ref={workspaceRef} className={`workspace ${collapsed.right || dockInspectorBesideTimeline ? 'inspector-hidden' : ''}`} style={{ gridTemplateColumns: collapsed.right || dockInspectorBesideTimeline ? 'minmax(0,1fr)' : `minmax(0,1fr) 10px minmax(0,${rightWidth}px)` }}>
      <div className="viewport-stack"><Viewport dark={theme === 'dark'} /><JevFloatingComposer /></div>
      {!collapsed.right && !dockInspectorBesideTimeline && <><div className="panel-resizer vertical" title="Resize side panel" onPointerDown={(event) => beginResize('right', event)} /><Inspector panel={inspectorPanel} onPanelChange={setInspectorPanel} onToggleCollapse={() => setCollapsed((value) => ({ ...value, right: true }))} /></>}
    </main>
    {dockInspectorBesideTimeline && <div className="panel-resizer vertical timeline-sidebar-divider" title="Resize side panel" onPointerDown={(event) => beginResize('right', event)} />}
    {dockInspectorBesideTimeline && <Inspector panel={inspectorPanel} onPanelChange={setInspectorPanel} onToggleCollapse={() => setCollapsed((value) => ({ ...value, right: true }))} />}
    <div className={`panel-resizer horizontal ${dockInspectorBesideTimeline ? 'timeline-sidebar-resizer' : ''}`} title="Resize timeline" onPointerDown={(event) => { if (!collapsed.timeline) beginResize('timeline', event); }} />
    <Timeline collapsed={collapsed.timeline} onToggleCollapse={() => setCollapsed((value) => ({ ...value, timeline: !value.timeline }))} />
    {message && <div className={`toast ${message.type}`}>{message.type === 'error' ? 'Error' : message.type === 'ok' ? 'Done' : 'Working'}<span>{message.text}</span></div>}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    {plan && <PlanReview plan={plan} busy={busy} onClose={() => setPlan(undefined)} onApprove={approve} />}
  </div>;
}
