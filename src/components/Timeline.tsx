import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, EyeOff, GripVertical, LockKeyhole, Maximize2, MessageSquare, MessageSquarePlus, Minimize2, PanelBottomClose, PanelBottomOpen, Pause, Play, Scissors, Trash2, Video, X } from 'lucide-react';
import * as THREE from 'three';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import type { Interpolation, SceneComment, SceneObject, TimelineCommentScope, Transform } from '../domain/schema';
import { useEditor } from '../store/editor';

const modeNames: Record<Interpolation, string> = { constant: 'Stacco', bezier: 'Fluido', linear: 'Lineare' };
type TrackSelection = { scope: TimelineCommentScope; sceneId: string; objectId?: string; label: string };
type CommentDraft = TrackSelection & { text: string };
type DeleteTarget =
  | { kind: 'scene'; sceneId: string }
  | { kind: 'object'; objectId: string }
  | { kind: 'segment'; objectId: string; sceneId: string }
  | { kind: 'keyframe'; objectId: string; keyframeId: string };
function ElementThumbnail({ object, compact = false }: { object: SceneObject; compact?: boolean }) {
  const label = object.kind === 'text' ? 'T' : object.kind === 'blend_asset' ? 'B' : '';
  return <span className={`element-thumbnail ${object.kind} ${compact ? 'compact' : ''}`} style={{ '--element-color': object.color } as React.CSSProperties}>{label}</span>;
}
function objectChanged(object: SceneObject, from: number, to: number) {
  const before = [evaluateTransform(object, from), evaluateProperty(object, 'visibility', from), evaluateProperty(object, 'text', from), evaluateProperty(object, 'lens', from)];
  const after = [evaluateTransform(object, to), evaluateProperty(object, 'visibility', to), evaluateProperty(object, 'text', to), evaluateProperty(object, 'lens', to)];
  return JSON.stringify(before) !== JSON.stringify(after);
}

export default function Timeline({ collapsed, onToggleCollapse }: { collapsed?: boolean; onToggleCollapse?(): void }) {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const playing = useEditor((state) => state.isPlaying);
  const selectedId = useEditor((state) => state.selectedId);
  const setFrame = useEditor((state) => state.setFrame);
  const setPlaying = useEditor((state) => state.setPlaying);
  const select = useEditor((state) => state.select);
  const deleteKeyframe = useEditor((state) => state.deleteKeyframe);
  const splitScene = useEditor((state) => state.splitScene);
  const deleteScene = useEditor((state) => state.deleteScene);
  const resizeScene = useEditor((state) => state.resizeScene);
  const addTransitionComment = useEditor((state) => state.addTransitionComment);
  const setTimelineComment = useEditor((state) => state.setTimelineComment);
  const setTransitionMode = useEditor((state) => state.setTransitionMode);
  const updateObject = useEditor((state) => state.updateObject);
  const reorderObjects = useEditor((state) => state.reorderObjects);
  const deleteObject = useEditor((state) => state.deleteObject);
  const deleteObjectFromScene = useEditor((state) => state.deleteObjectFromScene);
  const setCameraFraming = useEditor((state) => state.setCameraFraming);
  const [fullscreen, setFullscreen] = useState(false);
  const [transitionDraft, setTransitionDraft] = useState<{ fromId: string; toId: string; label: string; text: string }>();
  const [motionDraft, setMotionDraft] = useState<{ objectId: string; sceneId: string; label: string; mode: Interpolation }>();
  const [selectedTrack, setSelectedTrack] = useState<TrackSelection>();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [commentDraft, setCommentDraft] = useState<CommentDraft>();
  const [sceneThumbnails, setSceneThumbnails] = useState<Record<string, string>>({});
  const [timelineZoom, setTimelineZoom] = useState(135);
  const start = project.settings.frameStart, end = project.settings.frameEnd;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const framingCamera = project.objects.find((object) => object.kind === 'camera');
  const selectedSubject = project.objects.find((object) => object.id === selectedId && object.kind !== 'camera' && !object.kind.includes('light') && evaluateProperty(object, 'visibility', frame));
  const framingSubject = selectedSubject ?? project.objects.find((object) => object.kind !== 'camera' && !object.kind.includes('light') && evaluateProperty(object, 'visibility', frame));
  const timelineObjects = project.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light'));
  const time = (frame - start) / project.settings.fps;
  const durationSeconds = Math.max(1, (end - start + 1) / project.settings.fps);
  const timecode = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}:${String(frame % project.settings.fps).padStart(2, '0')}`;
  const left = (value: number) => `${((value - start) / Math.max(1, end - start)) * 100}%`;
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFrame(start + ((event.clientX - rect.left) / rect.width) * (end - start));
  };
  const activeSceneIndex = scenes.findIndex((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? end + 1));
  const activeScene = scenes[activeSceneIndex] ?? scenes[0];
  const activeSceneEnd = scenes[activeSceneIndex + 1]?.frame ?? end + 1;
  const canSplit = activeSceneIndex >= 0 && frame > scenes[activeSceneIndex].frame + 1 && frame < activeSceneEnd - 1;
  const cameraTransform = framingCamera ? evaluateTransform(framingCamera, frame) : undefined;
  const subjectTransform = framingSubject ? evaluateTransform(framingSubject, frame) : undefined;
  const selectedMotionObject = project.objects.find((object) => object.id === selectedId && object.kind !== 'camera' && !object.kind.includes('light'));
  const defaultMotionObject = selectedMotionObject ?? framingCamera;
  const defaultMotionMode = defaultMotionObject && activeScene
    ? defaultMotionObject.keyframes.find((key) => key.frame === activeScene.frame && key.property === 'position')?.interpolation ?? 'constant'
    : 'constant';
  const currentMotion = motionDraft ?? (defaultMotionObject && activeScene ? {
    objectId: defaultMotionObject.id,
    sceneId: activeScene.id,
    label: selectedMotionObject ? `${selectedMotionObject.name} · ${activeScene.name ?? 'Scena'}` : `Inquadratura · ${activeScene.name ?? 'Scena'}`,
    mode: defaultMotionMode,
  } : undefined);
  const zoomDistance = cameraTransform && subjectTransform ? Math.max(.5, new THREE.Vector3(...cameraTransform.position).distanceTo(new THREE.Vector3(...subjectTransform.position))) : 8;
  const setCameraDistance = (distance: number) => {
    if (!framingCamera || !cameraTransform || !subjectTransform || !activeScene) return;
    const target = new THREE.Vector3(...subjectTransform.position);
    const cameraPosition = new THREE.Vector3(...cameraTransform.position);
    const offset = cameraPosition.sub(target);
    if (offset.lengthSq() < .0001) offset.set(0, -1, .25);
    const positionVector = target.clone().add(offset.normalize().multiplyScalar(distance));
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.copy(positionVector);
    camera.lookAt(target);
    const position = positionVector.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'];
    const rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'];
    setCameraFraming(activeScene.id, position, rotation, subjectTransform.position);
  };
  useEffect(() => {
    const loaded: Record<string, string> = {};
    for (const scene of scenes) {
      const value = localStorage.getItem(`abaco-thumb:${project.id}:${scene.id}`);
      if (value) loaded[scene.id] = value;
    }
    setSceneThumbnails(loaded);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; sceneId: string; url: string }>).detail;
      if (!detail || detail.projectId !== project.id) return;
      setSceneThumbnails((current) => ({ ...current, [detail.sceneId]: detail.url }));
      try { localStorage.setItem(`abaco-thumb:${detail.projectId}:${detail.sceneId}`, detail.url); } catch { /* cache piena */ }
    };
    window.addEventListener('abaco:scene-thumbnail', receive);
    return () => window.removeEventListener('abaco:scene-thumbnail', receive);
  }, [project.id, scenes.map((scene) => scene.id).join(':')]);
  const beginResize = (index: number, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault(); event.stopPropagation();
    const scene = scenes[index];
    const track = event.currentTarget.closest('.camera-track') as HTMLElement | null;
    if (!scene || !track) return;
    const startX = event.clientX;
    const originalDuration = (scenes[index + 1]?.frame ?? end + 1) - scene.frame;
    const framesPerPixel = (end - start + 1) / Math.max(1, track.getBoundingClientRect().width);
    const finish = (pointer: PointerEvent) => {
      resizeScene(scene.id, originalDuration + (pointer.clientX - startX) * framesPerPixel);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointerup', finish, { once: true });
  };
  const saveTransition = () => {
    if (!transitionDraft) return;
    addTransitionComment(transitionDraft.fromId, transitionDraft.toId, transitionDraft.text);
    setTransitionDraft(undefined);
  };
  const chooseMotion = (mode: Interpolation) => {
    if (!currentMotion) return;
    setTransitionMode(currentMotion.objectId, currentMotion.sceneId, mode);
    if (motionDraft) setMotionDraft({ ...motionDraft, mode });
  };
  const inferredScope = (comment: SceneComment): TimelineCommentScope => comment.scope ?? (comment.targetIds.length ? 'object' : 'scene');
  const inferredSceneId = (comment: SceneComment) => comment.sceneId ?? scenes.filter((scene) => scene.frame <= comment.startFrame).at(-1)?.id;
  const findTrackComment = (selection: TrackSelection) => project.comments.find((comment) => comment.kind !== 'transition' && inferredScope(comment) === selection.scope && inferredSceneId(comment) === selection.sceneId && (selection.scope !== 'object' || comment.targetIds.includes(selection.objectId!)));
  const isSelectedTrack = (selection: TrackSelection) => selectedTrack?.scope === selection.scope && selectedTrack.sceneId === selection.sceneId && selectedTrack.objectId === selection.objectId;
  const openComment = (selection: TrackSelection) => {
    setSelectedTrack(selection);
    setMotionDraft(undefined);
    setTransitionDraft(undefined);
    setCommentDraft({ ...selection, text: findTrackComment(selection)?.text ?? '' });
  };
  const currentCommentTarget = () => {
    if (selectedTrack) return selectedTrack;
    if (!activeScene) return undefined;
    const selectedObject = project.objects.find((object) => object.id === selectedId && object.kind !== 'camera' && !object.kind.includes('light'));
    return selectedObject
      ? { scope: 'object' as const, sceneId: activeScene.id, objectId: selectedObject.id, label: `${selectedObject.name} · ${activeScene.name ?? 'Scena'}` }
      : { scope: 'scene' as const, sceneId: activeScene.id, label: activeScene.name ?? 'Scena' };
  };
  const saveComment = () => {
    if (!commentDraft || !commentDraft.text.trim()) return;
    setTimelineComment(commentDraft.scope, commentDraft.sceneId, commentDraft.text, commentDraft.objectId);
    setCommentDraft(undefined);
  };
  const removeComment = () => {
    if (!commentDraft) return;
    setTimelineComment(commentDraft.scope, commentDraft.sceneId, '', commentDraft.objectId);
    setCommentDraft(undefined);
  };
  const noteBadge = (selection: TrackSelection, className = '') => {
    const note = findTrackComment(selection);
    if (!note) return null;
    return <span className={`timeline-comment-badge ${className}`} title={note.text} aria-label={`Modifica commento: ${note.text}`} role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); openComment(selection); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openComment(selection); } }}><MessageSquare size={11} /></span>;
  };
  const zoomTimelineFromWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setTimelineZoom((value) => Math.max(45, Math.min(240, value * Math.exp(-event.deltaY * .004))));
  };
  const transitionMarkers = scenes.slice(1).map((scene, index) => {
    const from = scenes[index];
    const note = project.comments.find((comment) => comment.kind === 'transition' && comment.fromSceneId === from.id && comment.toSceneId === scene.id);
    return <button key={`transition-${scene.id}`} className={`transition-marker ${note ? 'has-note' : ''}`} style={{ left: left(scene.frame) }} title={note?.text ?? 'Aggiungi una nota alla transizione'} onClick={(event) => {
      event.stopPropagation();
      setCommentDraft(undefined);
      setMotionDraft(undefined);
      setTransitionDraft({ fromId: from.id, toId: scene.id, label: `${from.name ?? `Scena ${index + 1}`} → ${scene.name ?? `Scena ${index + 2}`}`, text: note?.text ?? '' });
    }}><MessageSquare size={11} /></button>;
  });
  useEffect(() => {
    const selectScene = (event: Event) => {
      const sceneId = (event as CustomEvent<{ sceneId?: string }>).detail?.sceneId;
      const scene = scenes.find((item) => item.id === sceneId);
      if (!scene) return;
      select(undefined);
      setFrame(scene.frame);
      setSelectedTrack({ scope: 'scene', sceneId: scene.id, label: scene.name ?? 'Scena' });
      setDeleteTarget({ kind: 'scene', sceneId: scene.id });
      setMotionDraft(undefined);
      setCommentDraft(undefined);
      setTransitionDraft(undefined);
    };
    window.addEventListener('abaco:select-scene', selectScene);
    return () => window.removeEventListener('abaco:select-scene', selectScene);
  }, [scenes.map((scene) => scene.id).join(':'), select, setFrame]);
  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const deletion = deleteTarget ?? (selectedId ? { kind: 'object' as const, objectId: selectedId } : undefined);
      if (!deletion) return;
      event.preventDefault();
      if (deletion.kind === 'scene') deleteScene(deletion.sceneId);
      else if (deletion.kind === 'object') deleteObject(deletion.objectId);
      else if (deletion.kind === 'segment') deleteObjectFromScene(deletion.objectId, deletion.sceneId);
      else deleteKeyframe(deletion.objectId, deletion.keyframeId);
      setDeleteTarget(undefined);
      setSelectedTrack(undefined);
      setMotionDraft(undefined);
    };
    window.addEventListener('keydown', remove);
    return () => window.removeEventListener('keydown', remove);
  }, [deleteKeyframe, deleteObject, deleteObjectFromScene, deleteScene, deleteTarget, selectedId]);
  useEffect(() => {
    if (selectedId || !deleteTarget || deleteTarget.kind === 'scene') return;
    if (!activeScene) { setDeleteTarget(undefined); setSelectedTrack(undefined); return; }
    setDeleteTarget({ kind: 'scene', sceneId: activeScene.id });
    setSelectedTrack({ scope: 'scene', sceneId: activeScene.id, label: activeScene.name ?? 'Scena' });
    setMotionDraft(undefined);
  }, [activeScene?.id, selectedId]);
  return <section className={`timeline ${fullscreen ? 'fullscreen' : ''} ${collapsed ? 'collapsed' : ''}`}>
    <header className="timeline-toolbar">
      <div className="timeline-context">
        {transitionDraft ? <div className="transition-composer"><span>{transitionDraft.label}</span><input autoFocus placeholder="Descrivi la transizione" value={transitionDraft.text} onChange={(event) => setTransitionDraft({ ...transitionDraft, text: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveTransition(); if (event.key === 'Escape') setTransitionDraft(undefined); }} /><button disabled={!transitionDraft.text.trim()} onClick={saveTransition}>Salva</button></div> : currentMotion ? <div className="motion-composer"><span>{currentMotion.label}</span>{(['constant', 'bezier', 'linear'] as const).map((mode) => <button key={mode} className={currentMotion.mode === mode ? 'active' : ''} onClick={() => chooseMotion(mode)}>{modeNames[mode]}</button>)}</div> : <strong className="timecode">{timecode}</strong>}
      </div>
      <div className="transport timeline-transport">
        <button className="split-button icon" disabled={!canSplit} onClick={splitScene} title="Taglia la clip al cursore" aria-label="Taglia la clip al cursore"><Scissors size={15} /></button>
        <button className="icon" title="Vai all'inizio" onClick={() => setFrame(start)}><ChevronsLeft size={16} /></button>
        <button className="icon" title="Frame precedente" aria-label="Frame precedente" onClick={() => setFrame(frame - 1)}><ChevronLeft size={17} /></button>
        <button className="play" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
        <button className="icon" title="Frame successivo" aria-label="Frame successivo" onClick={() => setFrame(frame + 1)}><ChevronRight size={17} /></button>
        <button className="icon" title="Vai alla fine" onClick={() => setFrame(end)}><ChevronsRight size={16} /></button>
        <button className="timeline-comment-button" disabled={!currentCommentTarget()} title="Aggiungi un commento all’elemento selezionato" onClick={() => { const target = currentCommentTarget(); if (target) openComment(target); }}><MessageSquarePlus size={14} /><span>Commento</span></button>
      </div>
      <div className="timeline-actions"><div className={`timeline-camera-zoom ${!framingSubject ? 'disabled' : ''}`} title={framingSubject ? `Avvicina o allontana la camera da ${framingSubject.name}` : 'Aggiungi un elemento per regolare l’inquadratura'}><input aria-label={framingSubject ? `Distanza camera da ${framingSubject.name}` : 'Distanza camera dal soggetto'} type="range" min="0.5" max="30" step="0.1" disabled={!framingSubject} value={Math.min(30, zoomDistance)} onChange={(event) => setCameraDistance(Number(event.target.value))} /></div><span className="duration">{durationSeconds.toFixed(1)} s</span><button className="icon" title={fullscreen ? 'Esci da schermo intero' : 'Timeline a schermo intero'} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button><button className="icon" title={collapsed ? 'Apri timeline' : 'Riduci timeline'} onClick={onToggleCollapse}>{collapsed ? <PanelBottomOpen size={16} /> : <PanelBottomClose size={16} />}</button></div>
    </header>
    {commentDraft && <div className="timeline-comment-popover" role="dialog" aria-label={`Commento ${commentDraft.label}`}>
      <div className="comment-popover-head"><span title={commentDraft.label}>{commentDraft.label}</span><button className="icon" title="Chiudi" onClick={() => setCommentDraft(undefined)}><X size={14} /></button></div>
      <input autoFocus placeholder="Scrivi un’indicazione" value={commentDraft.text} onChange={(event) => setCommentDraft({ ...commentDraft, text: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveComment(); if (event.key === 'Escape') setCommentDraft(undefined); }} />
      <div className="comment-popover-actions">{findTrackComment(commentDraft) && <button className="subtle danger" onClick={removeComment}><Trash2 size={13} /> Elimina</button>}<button className="primary" disabled={!commentDraft.text.trim()} onClick={saveComment}><Check size={14} /> Salva</button></div>
    </div>}
    <div className="timeline-scroll" onWheelCapture={zoomTimelineFromWheel} style={{ '--timeline-content-width': `${Math.round(durationSeconds * timelineZoom)}px`, '--timeline-second-width': `${timelineZoom}px` } as React.CSSProperties}>
      <div className="ruler-label">Elementi</div>
      <div className="ruler elements-ruler" onClick={seek}><span style={{ left: left(start) }}>{start}</span><span style={{ left: left(Math.round((start + end) / 2)) }}>{Math.round((start + end) / 2)}</span><span style={{ left: left(end) }}>{end}</span><i style={{ left: left(frame) }} /></div>
      <div className="track-label scene-label locked-label"><span className="scene-hierarchy"><b>Scene</b><small>Inquadratura</small></span><LockKeyhole size={12} /></div>
      <div className="track scene-track" onClick={(event) => { seek(event); const rect = event.currentTarget.getBoundingClientRect(); const clickedFrame = start + ((event.clientX - rect.left) / rect.width) * (end - start); const scene = scenes.filter((item) => item.frame <= clickedFrame).at(-1) ?? scenes[0]; if (scene) { select(undefined); setSelectedTrack({ scope: 'scene', sceneId: scene.id, label: scene.name ?? 'Scena' }); setDeleteTarget({ kind: 'scene', sceneId: scene.id }); setMotionDraft(undefined); } }}>{scenes.map((scene, index) => {
        const nextFrame = scenes[index + 1]?.frame ?? end + 1;
        const nextScene = scenes[index + 1];
        const width = Math.max(1.5, ((nextFrame - scene.frame) / Math.max(1, end - start + 1)) * 100);
        const insetLeft = index > 0 ? 6 : 0, insetRight = index < scenes.length - 1 ? 6 : 1;
        const sceneSelection: TrackSelection = { scope: 'scene', sceneId: scene.id, label: scene.name ?? `Scena ${index + 1}` };
        const framingSelection: TrackSelection = { scope: 'framing', sceneId: scene.id, label: `Inquadratura · ${scene.name ?? `Scena ${index + 1}`}` };
        const cameraMode = framingCamera?.keyframes.find((key) => key.frame === scene.frame && key.property === 'position')?.interpolation ?? 'constant';
        const cameraChanged = Boolean(framingCamera && nextScene && objectChanged(framingCamera, scene.frame, nextScene.frame));
        return <div key={scene.id} className={`scene-clip ${activeSceneIndex === index ? 'active' : ''}`} style={{ left: `calc(${left(scene.frame)} + ${insetLeft}px)`, width: `calc(${width}% - ${insetLeft + insetRight}px)` }}>
          <button className={`scene-image ${isSelectedTrack(sceneSelection) ? 'selected-block' : ''}`} style={sceneThumbnails[scene.id] ? { backgroundImage: `linear-gradient(90deg,rgba(20,22,22,.1),rgba(20,22,22,.02)),url(${sceneThumbnails[scene.id]})` } : undefined} title={scene.name ?? `Scena ${index + 1}`} onClick={(event) => { event.stopPropagation(); setFrame(scene.frame); select(undefined); setSelectedTrack(sceneSelection); setDeleteTarget({ kind: 'scene', sceneId: scene.id }); setMotionDraft(undefined); setCommentDraft(undefined); }}>
            <span className="clip-title">{scene.name ?? `Scena ${index + 1}`}{noteBadge(sceneSelection, 'clip-comment')}</span><small>{((nextFrame - scene.frame) / project.settings.fps).toFixed(1)} s</small>
          </button>
          <button className={`scene-framing ${cameraMode} ${cameraChanged ? 'changed' : 'idle'} ${isSelectedTrack(framingSelection) ? 'selected-block' : ''}`} onClick={(event) => { event.stopPropagation(); setFrame(scene.frame); select(undefined); setSelectedTrack(framingSelection); setDeleteTarget(undefined); setCommentDraft(undefined); if (framingCamera) setMotionDraft({ objectId: framingCamera.id, sceneId: scene.id, label: nextScene ? `${framingSelection.label} → ${nextScene.name ?? `Scena ${index + 2}`}` : framingSelection.label, mode: cameraMode }); }}><Video className="framing-icon" size={10} /><span>{nextScene ? modeNames[cameraMode] : 'Fissa'}</span>{noteBadge(framingSelection, 'segment-comment')}</button>
          <span className="clip-resize-handle" onPointerDown={(event) => beginResize(index, event)} />
        </div>;
      })}{transitionMarkers}<i style={{ left: left(frame) }} /></div>
      {timelineObjects.map((object) => { const displayName = object.name; const objectVisible = evaluateProperty(object, 'visibility', frame) as boolean; return <div className={`track-pair object-row ${selectedId === object.id ? 'active' : ''}`} key={object.id}>
        <div className="track-label timeline-object-label" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/abaco-object', object.id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/abaco-object'); if (sourceId) reorderObjects(sourceId, object.id); }}>
          <GripVertical className="row-grip" size={12} /><ElementThumbnail object={object} /><button className="row-name" title={displayName} onClick={() => { select(object.id); setDeleteTarget({ kind: 'object', objectId: object.id }); if (activeScene) setSelectedTrack({ scope: 'object', sceneId: activeScene.id, objectId: object.id, label: `${displayName} · ${activeScene.name ?? 'Scena'}` }); }}>{displayName}</button>{activeScene && noteBadge({ scope: 'object', sceneId: activeScene.id, objectId: object.id, label: `${displayName} · ${activeScene.name ?? 'Scena'}` }, 'label-comment')}<button className="row-action" title={objectVisible ? 'Nascondi' : 'Mostra'} aria-label={objectVisible ? `Nascondi ${displayName}` : `Mostra ${displayName}`} onClick={() => updateObject(object.id, { visible: !objectVisible })}>{objectVisible ? <Eye size={12} /> : <EyeOff size={12} />}</button><button className="row-action danger" title="Elimina" aria-label={`Elimina ${displayName}`} onClick={() => deleteObject(object.id)}><Trash2 size={12} /></button>
        </div>
        <div className="track" onClick={seek}>
          {scenes.map((scene, index) => {
            const next = scenes[index + 1];
            const clipEnd = next?.frame ?? end + 1;
            const mode = object.keyframes.find((key) => key.frame === scene.frame && key.property === 'position')?.interpolation ?? 'constant';
            const width = ((clipEnd - scene.frame) / Math.max(1, end - start + 1)) * 100;
            const changed = next ? objectChanged(object, scene.frame, next.frame) : false;
            const visible = evaluateProperty(object, 'visibility', scene.frame) as boolean;
            const selection: TrackSelection = { scope: 'object', sceneId: scene.id, objectId: object.id, label: `${displayName} · ${scene.name ?? `Scena ${index + 1}`}` };
            return <button key={`${object.id}-${scene.id}`} className={`motion-segment ${mode} ${changed ? 'changed' : 'idle'} ${next ? '' : 'static'} ${visible ? '' : 'hidden'} ${isSelectedTrack(selection) ? 'selected-block' : ''}`} style={{ left: left(scene.frame), width: `${width}%` }} title={next ? `${displayName}: ${modeNames[mode]} fra ${scene.name ?? `Scena ${index + 1}`} e ${next.name ?? `Scena ${index + 2}`}` : `${displayName} in ${scene.name ?? `Scena ${index + 1}`}`} onClick={(event) => {
              event.stopPropagation(); select(object.id); setDeleteTarget({ kind: 'segment', objectId: object.id, sceneId: scene.id }); setTransitionDraft(undefined); setCommentDraft(undefined); setSelectedTrack(selection);
              if (next) setMotionDraft({ objectId: object.id, sceneId: scene.id, label: `${displayName} · ${scene.name ?? `Scena ${index + 1}`} → ${next.name ?? `Scena ${index + 2}`}`, mode });
            }}><span className="segment-thumbnails" aria-hidden="true"><ElementThumbnail object={object} compact /></span><span className="segment-mode">{next ? modeNames[mode] : 'Presente'}</span>{noteBadge(selection, 'segment-comment')}</button>;
          })}
          {object.keyframes.filter((key) => !scenes.some((scene) => scene.frame === key.frame)).map((key) => <button key={key.id} className={`key-marker ${key.source}`} style={{ left: left(key.frame) }} title={`${key.property} · frame ${key.frame}`} onClick={(event) => { event.stopPropagation(); setFrame(key.frame); select(object.id); setDeleteTarget({ kind: 'keyframe', objectId: object.id, keyframeId: key.id }); }}>
            {selectedId === object.id && frame === key.frame && <span onClick={(event) => { event.stopPropagation(); deleteKeyframe(object.id, key.id); }}><Trash2 size={10} /></span>}
          </button>)}
          <i style={{ left: left(frame) }} />
        </div>
      </div>})}
    </div>
  </section>;
}
