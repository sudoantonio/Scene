import { browserAsset } from './domain/browser-assets';
import { isVideoFile } from './domain/video';
import { prepareEditedMedia } from './domain/edited-media';
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { PanelRightOpen, Plus, Redo2, Undo2 } from './components/icons';
import { applyPlan } from './domain/animation';
import type { BlenderPlan } from './domain/schema';
import Inspector from './components/Inspector';
import ElementsPanel from './components/ElementsPanel';
import PlanReview from './components/PlanReview';
import SettingsModal from './components/SettingsModal';
import Timeline from './components/Timeline';
import Viewport, { captureContactSheet } from './components/Viewport';
import EditorClock from './components/EditorClock';
import AudioPlayback from './components/AudioPlayback';
import { useEditor } from './store/editor';
import { inspectAudio } from './domain/audio';
import { inspectVideo } from './domain/video';
import type { ObjectKind } from './domain/schema';
import { agentEditorStatus, agentFramingStatus, agentSceneDetail, agentStoryboardStatus, agentTimingStatus, applyAgentRequest } from './store/agent-editor';
import StrokeDrawingToolbar from './components/StrokeDrawingToolbar';
import { interfaceZoom } from './domain/interface-zoom';

const emptyPlan = (): BlenderPlan => ({ schemaVersion: 'BlenderPlanV1', summary: 'Direct export without AI changes.', assumptions: [], warnings: [], operations: [] });
const draggableShapes: ObjectKind[] = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'text'];
const acceptsDrop = (event: DragEvent) => Array.from(event.dataTransfer.types).some((type) => type === 'Files' || type === 'application/x-scene-shape');
const imageAspectRatio = (source: string) => new Promise<number>((resolve) => {
  const bitmap = new window.Image();
  bitmap.onload = () => resolve(bitmap.naturalWidth / Math.max(1, bitmap.naturalHeight));
  bitmap.onerror = () => resolve(1);
  bitmap.src = source;
});
const initialLayout = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('abaco-layout-v1') ?? '{}');
    return { right: Number(saved.right) || 310, timeline: Number(saved.timeline) || 270 };
  } catch { return { right: 310, timeline: 270 }; }
};

export default function App() {
  const project = useEditor((state) => state.project);
  const projectPath = useEditor((state) => state.projectPath);
  const dirty = useEditor((state) => state.dirty);
  const newProject = useEditor((state) => state.newProject);
  const loadProject = useEditor((state) => state.loadProject);
  const markSaved = useEditor((state) => state.markSaved);
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
  const [collapsed, setCollapsed] = useState(() => ({ right: !window.abaco && window.innerWidth < 900, timeline: !window.abaco && window.innerWidth < 600 && !new URLSearchParams(window.location.search).has('expanded-timeline') }));
  const theme: 'dark' = 'dark';
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error' | 'info'; text: string }>();
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  // File writes must finish in order, and their results must never replace edits
  // made while the native save operation was still running.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const notify = (type: 'ok' | 'error' | 'info', text: string) => { setMessage({ type, text }); window.setTimeout(() => setMessage(undefined), 6500); };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDropActive(false);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const shape = event.dataTransfer.getData('application/x-scene-shape') as ObjectKind;
    if (draggableShapes.includes(shape)) {
      useEditor.getState().addObject(shape);
      return;
    }
    if (!window.abaco) {
      for (const file of Array.from(event.dataTransfer.files)) {
        try {
          if (isVideoFile(file.name)) {
            const asset = await browserAsset(file), metadata = await inspectVideo(asset.sourcePath);
            if (event.altKey) useEditor.getState().addVideoScene({ ...asset, duration: metadata.duration });
            else useEditor.getState().addVideo({ ...asset, ...metadata }, event.shiftKey ? 'screen' : 'world');
          } else if (file.type.startsWith('audio/') || /\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name)) {
            const asset = await browserAsset(file); useEditor.getState().addAudio({ ...asset, ...await inspectAudio(asset.sourcePath) });
          } else if (file.type.startsWith('image/')) {
            const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
            useEditor.getState().addImage({ sourcePath: '', dataUrl, name: file.name, aspectRatio: await imageAspectRatio(dataUrl) }, event.shiftKey ? 'screen' : 'world');
          } else throw new Error('Drag a video, audio file, or image to add it to the scene.');
        } catch (error) { notify('error', error instanceof Error ? error.message : 'Import failed.'); }
      }
      return;
    }
    const paths = Array.from(event.dataTransfer.files).map((file) => window.abaco!.getDroppedFilePath(file)).filter(Boolean);
    if (!paths.length) return;
    let imported = 0;
    const failures: string[] = [];
    for (const filePath of paths) {
      try {
        const asset = await window.abaco.importDroppedAsset(filePath);
        if (asset.kind === 'image') {
          const dataUrl = await window.abaco.loadAsset(asset.path);
          useEditor.getState().addImage({ sourcePath: asset.path, dataUrl, name: asset.name, aspectRatio: await imageAspectRatio(dataUrl) }, event.shiftKey ? 'screen' : 'world');
        } else if (asset.kind === 'audio') {
          const source = await window.abaco.loadAsset(asset.sourcePath);
          useEditor.getState().addAudio({ ...asset, ...await inspectAudio(source) });
        } else if (asset.kind === 'video') {
          const metadata = await inspectVideo(asset.sourcePath);
          if (event.altKey) useEditor.getState().addVideoScene({ ...asset, duration: metadata.duration });
          else useEditor.getState().addVideo({ ...asset, duration: metadata.duration, aspectRatio: metadata.aspectRatio }, event.shiftKey ? 'screen' : 'world');
        } else useEditor.getState().addBlendAsset(asset.asset);
        imported += 1;
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    if (imported) notify('ok', `${imported} item${imported === 1 ? '' : 's'} added to the scene.${failures.length ? ` ${failures.length} failed: ${failures[0]}` : ''}`);
    else if (failures.length) notify('error', failures[0]!);
  };
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
      if (output) notify(output.warnings.length ? 'info' : 'ok', `Cartella per l’AI creata: ${output.directory}. ${output.files} file inclusi.${output.warnings.length ? ' See LEGGIMI.md for items to review.' : ''}`);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Export failed.'); }
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
  useEffect(() => window.abaco?.onAgentRequest?.(async ({ id, method, args }) => {
    try {
      let result: unknown;
      const state = useEditor.getState();
      if (method === 'status') result = agentEditorStatus((args as { detail?: 'summary' | 'full' } | undefined)?.detail === 'full' ? 'full' : 'summary');
      else if (method === 'scene') {
        const request = args as { sceneId: string; frame?: number };
        result = agentSceneDetail(request.sceneId, request.frame);
      } else if (method === 'storyboard') result = agentStoryboardStatus();
      else if (method === 'timing') result = agentTimingStatus();
      else if (method === 'framing') result = agentFramingStatus();
      else if (method === 'apply') result = applyAgentRequest(args);
      else if (method === 'preview.motion') {
        const motionId = (args as { motionId?: string } | undefined)?.motionId;
        const motion = agentEditorStatus('full').motions.find((item) => item.id === motionId);
        if (!motion) throw new Error('Motion not found. Reload the scene.');
        const frames = [...new Set([0, .25, .5, .75, 1].map((fraction) => Math.round(motion.startFrame + (motion.endFrame - motion.startFrame) * fraction)))];
        const durationSeconds = (motion.endFrame - motion.startFrame) / state.project.settings.fps;
        result = { frames, durationSeconds, pace: motion.pace, speedPerSecond: motion.speedPerSecond, speedUnit: motion.speedUnit, warnings: motion.warnings, image: await captureContactSheet(frames) };
      }
      else if (method === 'preview') {
        const frames = (args as { frames?: number[]; frame?: number })?.frames ?? [(args as { frame?: number })?.frame];
        if (!Array.isArray(frames) || !frames.length || frames.length > 6 || frames.some((frame) => !Number.isInteger(frame) || frame! < 1 || frame! > state.project.settings.frameEnd)) throw new Error('Frame fuori dal progetto.');
        result = { frames, image: await captureContactSheet(frames as number[]) };
      } else if (method === 'save') {
        const requestedPath = (args as { path?: string } | undefined)?.path;
        const saved = await save(requestedPath ?? projectPath);
        if (!saved) throw new Error('Save cancelled.');
        result = { path: saved.path, revision: agentEditorStatus().revision };
      } else if (method === 'export') {
        if (!useEditor.getState().projectPath) throw new Error('The project has no save path. Use scene_save with a path before scene_export_blender.');
        const saved = await save();
        if (!saved) throw new Error('Save cancelled.');
        const editedMedia = await prepareEditedMedia(saved.project, window.abaco!.loadAsset);
        result = await window.abaco!.buildBlender(saved.project, emptyPlan(), saved.path, editedMedia);
      } else if (method === 'bundle') {
        const outputDirectory = (args as { outputDirectory?: string } | undefined)?.outputDirectory;
        const snapshot = useEditor.getState();
        const editedMedia = await prepareEditedMedia(snapshot.project, window.abaco!.loadAsset);
        result = await window.abaco!.exportPortableFolder(snapshot.project, snapshot.projectPath, editedMedia, outputDirectory);
        if (!result) throw new Error('Export cancelled.');
      } else throw new Error(`Unknown method: ${method}`);
      window.abaco?.respondAgent({ id, result });
    } catch (error) { window.abaco?.respondAgent({ id, error: error instanceof Error ? error.message : String(error) }); }
  }), [projectPath]);
  const beginResize = (part: 'right' | 'timeline', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY, value: layout[part] };
    let finalValue = origin.value;
    const valueFromPointer = (pointer: PointerEvent) => {
      const delta = part === 'right' ? origin.x - pointer.clientX : origin.y - pointer.clientY;
      const limits = part === 'timeline' ? [150, 520] : [240, 500];
      return Math.max(limits[0], Math.min(limits[1], origin.value + delta / interfaceZoom()));
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
    if (!dirty || !projectPath || !window.abaco) return;
    const timer = window.setTimeout(() => { void save(projectPath).catch((error) => notify('error', error instanceof Error ? error.message : 'Autosave failed.')); }, 900);
    return () => window.clearTimeout(timer);
  }, [dirty, project, projectPath, markSaved]);

  useEffect(() => {
    try { localStorage.setItem('abaco-layout-v1', JSON.stringify(layout)); } catch { /* preferenze non disponibili */ }
  }, [layout]);


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
    const status = window.abaco?.getRecoveryStatus;
    if (!status) return;
    void status().then((recovered) => {
      if (recovered) notify('info', 'The viewport restarted and the local draft was restored. Review recent changes.');
    });
  }, []);

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
  const timelineHeight = collapsed.timeline ? 84 : layout.timeline;
  const dockInspectorBesideTimeline = collapsed.timeline && !collapsed.right;
  return <div ref={shellRef} className={`app-shell theme-${theme} ${dockInspectorBesideTimeline ? 'timeline-sidebar-docked' : ''}`} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={(event) => { void onDrop(event); }} style={{ gridTemplateRows: `40px minmax(0,1fr) 10px ${timelineHeight}px`, ...(dockInspectorBesideTimeline ? { gridTemplateColumns: `minmax(0,1fr) 10px minmax(0,${rightWidth}px)` } : {}) }}>
    {dropActive && <div className="asset-drop-overlay" aria-hidden="true">Drop to add · images and video become 3D · Shift: 2D · Option: video scene</div>}
    <EditorClock theme={theme} />
    <AudioPlayback />
    <div className="slim-headbar">
      <div className="headbar-create-tools"><div ref={addMenuRef} className="quick-add-menu"><button className="slim-add" onClick={() => setAddOpen((value) => !value)}><Plus size={17} /> Add</button>{addOpen && <div className="quick-add-popover" onClick={() => setAddOpen(false)}><ElementsPanel mode="add" /></div>}</div><StrokeDrawingToolbar /></div>
      <div className={`headbar-history ${collapsed.right ? 'with-panel-toggle' : ''}`}>
        <button type="button" aria-label="Undo" title="Undo · ⌘/Ctrl+Z" disabled={!canUndo} onClick={undo}><Undo2 size={19} /></button>
        <button type="button" aria-label="Redo" title="Redo · ⌘/Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}><Redo2 size={19} /></button>
      </div>
      {collapsed.right && <button className="headbar-inspector-open" aria-label="Open side panel" title="Open panels" onClick={() => setCollapsed((value) => ({ ...value, right: false }))}><PanelRightOpen size={15} /></button>}
    </div>
    <main ref={workspaceRef} className={`workspace ${collapsed.right || dockInspectorBesideTimeline ? 'inspector-hidden' : ''}`} style={{ gridTemplateColumns: collapsed.right || dockInspectorBesideTimeline ? 'minmax(0,1fr)' : `minmax(0,1fr) 10px minmax(0,${rightWidth}px)` }}>
      <div className="viewport-stack"><Viewport dark={theme === 'dark'} /></div>
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
