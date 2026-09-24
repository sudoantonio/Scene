import DirectionInput from './DirectionInput';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Box, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Circle, Cylinder, Eye, EyeOff, GripVertical, Image, Lightbulb, LockKeyhole, MessageCircle, MoveRight, Music2, PanelBottomClose, PanelBottomOpen, Pause, Play, Plus, Scissors, Square, Trash2, Triangle, Type, Video, X } from 'lucide-react';
import { evaluateProperty } from '../domain/animation';
import { objectPresenceRange } from '../domain/presence';
import type { SceneComment, SceneObject, TimelineCommentScope } from '../domain/schema';
import { useEditor } from '../store/editor';

type TrackSelection = { scope: TimelineCommentScope; sceneId: string; objectId?: string; label: string };
type CommentDraft = TrackSelection & { text: string };
type DeleteTarget =
  | { kind: 'scene'; sceneId: string }
  | { kind: 'object'; objectId: string }
  | { kind: 'segment'; objectId: string; sceneId: string }
  | { kind: 'motion'; objectId: string; sceneId: string }
  | { kind: 'keyframe'; objectId: string; keyframeId: string };
let copiedTimelineObjectIds: string[] = [];
function ElementThumbnail({ object, compact = false }: { object: SceneObject; compact?: boolean }) {
  const size = compact ? 12 : 14;
  const icon = object.kind === 'text' ? <Type size={size} />
    : object.kind === 'audio' ? <Music2 size={size} />
    : object.screenSpace ? <Image size={size} />
      : object.kind === 'blend_asset' || object.kind === 'cube' ? <Box size={size} />
        : object.kind === 'sphere' ? <Circle size={size} />
          : object.kind === 'cylinder' ? <Cylinder size={size} />
            : object.kind === 'cone' ? <Triangle size={size} />
              : object.kind === 'plane' ? <Square size={size} />
                : object.kind === 'camera' ? <Video size={size} />
                  : <Lightbulb size={size} />;
  return <span className={`element-thumbnail ${object.kind} ${compact ? 'compact' : ''}`} style={{ '--element-color': object.color } as React.CSSProperties} aria-label={object.kind}>{icon}</span>;
}
function AudioWaveform({ values }: { values: number[] }) {
  const samples = values.length ? values : Array.from({ length: 64 }, (_, index) => .18 + Math.abs(Math.sin(index * 1.73)) * .35);
  return <svg className="audio-waveform" viewBox={`0 0 ${samples.length} 1`} preserveAspectRatio="none" aria-hidden="true">{samples.map((value, index) => <rect key={index} x={index + .16} y={(1 - value) / 2} width=".68" height={value} rx=".12" />)}</svg>;
}
export default function Timeline({ collapsed, onToggleCollapse }: { collapsed?: boolean; onToggleCollapse?(): void }) {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const playing = useEditor((state) => state.isPlaying);
  const selectedId = useEditor((state) => state.selectedId);
  const selectedMotion = useEditor((state) => state.selectedMotion);
  const cameraView = useEditor((state) => state.cameraView);
  const recordingSession = useEditor((state) => state.recordingSession);
  const setFrame = useEditor((state) => state.setFrame);
  const setPlaying = useEditor((state) => state.setPlaying);
  const select = useEditor((state) => state.select);
  const selectMotion = useEditor((state) => state.selectMotion);
  const startRecording = useEditor((state) => state.startRecording);
  const stopRecording = useEditor((state) => state.stopRecording);
  const moveMotionPoint = useEditor((state) => state.moveMotionPoint);
  const resizeMotionRange = useEditor((state) => state.resizeMotionRange);
  const deleteMotionPoint = useEditor((state) => state.deleteMotionPoint);
  const splitScene = useEditor((state) => state.splitScene);
  const deleteScene = useEditor((state) => state.deleteScene);
  const resizeScene = useEditor((state) => state.resizeScene);
  const addTransitionComment = useEditor((state) => state.addTransitionComment);
  const setTimelineComment = useEditor((state) => state.setTimelineComment);
  const updateObject = useEditor((state) => state.updateObject);
  const reorderObjects = useEditor((state) => state.reorderObjects);
  const deleteObject = useEditor((state) => state.deleteObject);
  const duplicateObjectsToScene = useEditor((state) => state.duplicateObjectsToScene);
  const resizeObjectPresence = useEditor((state) => state.resizeObjectPresence);
  const deleteObjectFromScene = useEditor((state) => state.deleteObjectFromScene);
  const deleteMotionFromScene = useEditor((state) => state.deleteMotionFromScene);
  const addShot = useEditor((state) => state.addShot);
  const [transitionDraft, setTransitionDraft] = useState<{ fromId: string; toId: string; label: string; text: string }>();
  const [selectedTrack, setSelectedTrack] = useState<TrackSelection>();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [commentDraft, setCommentDraft] = useState<CommentDraft>();
  const [sceneThumbnails, setSceneThumbnails] = useState<Record<string, string>>({});
  const [timelineZoom, setTimelineZoom] = useState(135);
  const [selectedTimelineObjectIds, setSelectedTimelineObjectIds] = useState<Set<string>>(new Set());
  const [presencePreview, setPresencePreview] = useState<{ objectId: string; sceneId: string; start: number; end: number }>();
  const [motionRangePreview, setMotionRangePreview] = useState<{ objectId: string; sceneId: string; start: number; end: number }>();
  const motionPointDragged = useRef(false);
  const motionPointDragCleanup = useRef<(() => void) | undefined>(undefined);
  const selectedTimelineObjectIdsRef = useRef(selectedTimelineObjectIds);
  selectedTimelineObjectIdsRef.current = selectedTimelineObjectIds;
  useEffect(() => () => motionPointDragCleanup.current?.(), []);
  const start = project.settings.frameStart, end = project.settings.frameEnd;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const timelineObjects = project.objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light'));
  const time = (frame - start) / project.settings.fps;
  const durationSeconds = Math.max(1, (end - start + 1) / project.settings.fps);
  const rulerSeconds = Array.from({ length: Math.floor(durationSeconds) + 1 }, (_, second) => second);
  const formatRulerTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const timecode = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}:${String(frame % project.settings.fps).padStart(2, '0')}`;
  const left = (value: number) => `${((value - start) / Math.max(1, end - start)) * 100}%`;
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFrame(start + ((event.clientX - rect.left) / rect.width) * (end - start));
  };
  const frameInsideBlock = (event: React.MouseEvent<HTMLElement>, rangeStart: number, rangeEnd: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(rangeStart + ratio * Math.max(0, rangeEnd - rangeStart - 1));
  };
  const seekFromEmptyTimeline = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const track = event.currentTarget.querySelector('.scene-track') as HTMLElement | null;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right) return;
    setFrame(start + ((event.clientX - rect.left) / Math.max(1, rect.width)) * (end - start));
  };
  const activeSceneIndex = scenes.findIndex((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? end + 1));
  const activeScene = scenes[activeSceneIndex] ?? scenes[0];
  const activeSceneEnd = scenes[activeSceneIndex + 1]?.frame ?? end + 1;
  const toggleRecording = () => {
    if (recordingSession) {
      stopRecording();
      return;
    }
    if (!activeScene) return;
    selectMotion(undefined);
    startRecording(activeScene.id);
  };
  const canSplit = activeSceneIndex >= 0 && frame > scenes[activeSceneIndex].frame + 1 && frame < activeSceneEnd - 1;
  const selectTimelineObject = (objectId: string, additive = false) => {
    setSelectedTimelineObjectIds((current) => {
      if (!additive) return new Set([objectId]);
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId); else next.add(objectId);
      return next;
    });
    select(objectId);
    selectMotion(undefined);
    if (project.objects.find((object) => object.id === objectId)?.kind === 'audio') window.dispatchEvent(new Event('abaco:edit-audio'));
  };
  useEffect(() => {
    const loaded: Record<string, string> = {};
    for (const scene of scenes) {
      const value = localStorage.getItem(`abaco-thumb:v3:${project.id}:${scene.id}`);
      if (value) loaded[scene.id] = value;
    }
    setSceneThumbnails(loaded);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; sceneId: string; url: string }>).detail;
      if (!detail || detail.projectId !== project.id) return;
      setSceneThumbnails((current) => ({ ...current, [detail.sceneId]: detail.url }));
      try { localStorage.setItem(`abaco-thumb:v3:${detail.projectId}:${detail.sceneId}`, detail.url); } catch { /* cache piena */ }
    };
    window.addEventListener('abaco:scene-thumbnail', receive);
    return () => window.removeEventListener('abaco:scene-thumbnail', receive);
  }, [project.id, scenes.map((scene) => scene.id).join(':')]);
  const beginResize = (index: number, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault(); event.stopPropagation();
    const scene = scenes[index];
    const track = event.currentTarget.closest('.scene-track') as HTMLElement | null;
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
  const beginResizePresence = (object: SceneObject, sceneId: string, sceneStart: number, sceneEnd: number, edge: 'start' | 'end', event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault(); event.stopPropagation();
    const track = event.currentTarget.closest('.presence-track') as HTMLElement | null;
    const range = objectPresenceRange(object, sceneStart, sceneEnd);
    if (!track || !range) return;
    const startX = event.clientX;
    const framesPerPixel = (end - start + 1) / Math.max(1, track.getBoundingClientRect().width);
    let preview = { objectId: object.id, sceneId, start: range[0], end: range[1] };
    setPresencePreview(preview);
    const update = (clientX: number) => {
      const delta = Math.round((clientX - startX) * framesPerPixel);
      preview = edge === 'start'
        ? { ...preview, start: Math.max(start, Math.min(range[1] - 1, range[0] + delta)), end: range[1] }
        : { ...preview, start: range[0], end: Math.max(range[0] + 1, Math.min(end + 1, range[1] + delta)) };
      setPresencePreview(preview);
    };
    const move = (pointer: PointerEvent) => update(pointer.clientX);
    const finish = (pointer: PointerEvent) => {
      update(pointer.clientX);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      resizeObjectPresence(object.id, sceneId, preview.start, preview.end);
      setPresencePreview(undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };
  const saveTransition = () => {
    if (!transitionDraft) return;
    addTransitionComment(transitionDraft.fromId, transitionDraft.toId, transitionDraft.text);
    setTransitionDraft(undefined);
  };
  const inferredScope = (comment: SceneComment): TimelineCommentScope => comment.scope ?? (comment.targetIds.length ? 'object' : 'scene');
  const inferredSceneId = (comment: SceneComment) => comment.sceneId ?? scenes.filter((scene) => scene.frame <= comment.startFrame).at(-1)?.id;
  const findTrackComment = (selection: TrackSelection) => project.comments.find((comment) => comment.kind !== 'transition' && inferredScope(comment) === selection.scope && inferredSceneId(comment) === selection.sceneId && (selection.scope !== 'object' || comment.targetIds.includes(selection.objectId!)));
  const isSelectedTrack = (selection: TrackSelection) => selectedTrack?.scope === selection.scope && selectedTrack.sceneId === selection.sceneId && selectedTrack.objectId === selection.objectId;
  const openComment = (selection: TrackSelection) => {
    setSelectedTrack(selection);
    setTransitionDraft(undefined);
    setCommentDraft({ ...selection, text: findTrackComment(selection)?.text ?? '' });
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
    return <span className={`timeline-comment-badge ${className}`} title={note.text} aria-label={`Modifica commento: ${note.text}`} role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); openComment(selection); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openComment(selection); } }}><MessageCircle size={11} /></span>;
  };
  const zoomTimelineFromWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setTimelineZoom((value) => Math.max(45, Math.min(240, value * Math.exp(-event.deltaY * .004))));
  };
  const beginMoveMotionPoint = (object: SceneObject, sceneId: string, sceneFrame: number, sceneEnd: number, keyframeId: string, keyframeFrame: number, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault(); event.stopPropagation();
    motionPointDragCleanup.current?.();
    const marker = event.currentTarget;
    const track = marker.closest('.movement-track') as HTMLElement | null;
    if (!track) return;
    setPlaying(false);
    if (object.kind !== 'camera') select(object.id);
    selectMotion({ objectId: object.id, sceneId });
    if (cameraView) setFrame(keyframeFrame);
    setDeleteTarget({ kind: 'keyframe', objectId: object.id, keyframeId });
    motionPointDragged.current = false;
    const startX = event.clientX;
    const pixels = Math.max(1, track.getBoundingClientRect().width);
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      marker.style.translate = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      if (motionPointDragCleanup.current === cleanup) motionPointDragCleanup.current = undefined;
    };
    const move = (pointer: PointerEvent) => {
      const delta = pointer.clientX - startX;
      if (Math.abs(delta) < 3) return;
      motionPointDragged.current = true;
      marker.style.translate = `${delta}px 0`;
    };
    const finish = (pointer: PointerEvent) => {
      if (finished) return;
      const deltaFrames = Math.round(((pointer.clientX - startX) / pixels) * (end - start + 1));
      const nextFrame = Math.max(sceneFrame, Math.min(sceneEnd - 1, keyframeFrame + deltaFrames));
      cleanup();
      if (motionPointDragged.current) {
        moveMotionPoint(object.id, keyframeId, nextFrame);
        if (cameraView) setFrame(nextFrame);
        window.setTimeout(() => { motionPointDragged.current = false; }, 0);
      } else if (cameraView) setFrame(keyframeFrame);
    };
    const cancel = () => {
      cleanup();
      motionPointDragged.current = false;
    };
    motionPointDragCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
    window.addEventListener('blur', cancel, { once: true });
  };
  const beginResizeMotion = (object: SceneObject, sceneId: string, sceneStart: number, sceneEnd: number, motionStart: number, motionEnd: number, edge: 'start' | 'end', event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault(); event.stopPropagation();
    const track = event.currentTarget.closest('.movement-track') as HTMLElement | null;
    if (!track) return;
    const startX = event.clientX;
    const framesPerPixel = (end - start + 1) / Math.max(1, track.getBoundingClientRect().width);
    let preview = { objectId: object.id, sceneId, start: motionStart, end: motionEnd };
    setMotionRangePreview(preview);
    const update = (clientX: number) => {
      const delta = Math.round((clientX - startX) * framesPerPixel);
      preview = edge === 'start'
        ? { ...preview, start: Math.max(sceneStart, Math.min(motionEnd - 2, motionStart + delta)), end: motionEnd }
        : { ...preview, start: motionStart, end: Math.max(motionStart + 2, Math.min(sceneEnd, motionEnd + delta)) };
      setMotionRangePreview(preview);
    };
    const move = (pointer: PointerEvent) => update(pointer.clientX);
    const finish = (pointer: PointerEvent) => {
      update(pointer.clientX);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      resizeMotionRange(object.id, sceneId, preview.start, preview.end);
      setMotionRangePreview(undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };
  const renderMotionTrack = (object: SceneObject | undefined, camera = false) => {
    const clips = scenes.flatMap((scene, index) => {
      const motionObject = camera ? project.objects.find((item) => item.id === scene.cameraId && item.kind === 'camera') : object;
      if (!motionObject) return [];
      const sceneEnd = scenes[index + 1]?.frame ?? end + 1;
      const positionKeys = motionObject.keyframes.filter((key) => key.property === 'position' && key.frame >= scene.frame && key.frame < sceneEnd).sort((a, b) => a.frame - b.frame);
      const keys = [...new Map(positionKeys.map((key) => [key.frame, key])).values()];
      const realPoints = keys.filter((key) => key.purpose === 'motion' || (key.purpose === undefined && key.frame !== scene.frame));
      if (!realPoints.length) return [];
      const firstFrame = Math.min(...realPoints.map((key) => key.frame));
      const lastMotionFrame = Math.max(...realPoints.map((key) => key.frame));
      const storedMotionEnd = Math.min(sceneEnd, Math.max(firstFrame + 2, lastMotionFrame + 1));
      const preview = motionRangePreview?.objectId === motionObject.id && motionRangePreview.sceneId === scene.id ? motionRangePreview : undefined;
      const motionStart = preview?.start ?? firstFrame;
      const motionEnd = preview?.end ?? storedMotionEnd;
      const active = selectedMotion?.objectId === motionObject.id && selectedMotion.sceneId === scene.id;
      const width = Math.max(0.2, ((motionEnd - motionStart) / Math.max(1, end - start + 1)) * 100);
      return [<button key={`${motionObject.id}-${scene.id}-movement`} className={`recorded-motion-segment ${camera ? 'camera-motion-segment' : ''} ${preview ? 'resizing' : ''} ${active ? 'selected-block' : ''}`} style={{ left: left(motionStart), width: `${width}%` }} title={`Movimento ${camera ? 'camera' : motionObject.name} · ${scene.name ?? 'Scena'} · trascina i bordi per cambiare velocità`} onClick={(event) => {
        event.stopPropagation();
        if (frame < scene.frame || frame >= sceneEnd) setFrame(firstFrame);
        if (motionObject.kind !== 'camera') select(motionObject.id);
        selectMotion({ objectId: motionObject.id, sceneId: scene.id });
        window.dispatchEvent(new CustomEvent('abaco:edit-motion'));
        setSelectedTrack({ scope: camera ? 'framing' : 'object', sceneId: scene.id, objectId: camera ? undefined : motionObject.id, label: `Movimento ${camera ? 'camera' : motionObject.name}` });
        setDeleteTarget({ kind: 'motion', objectId: motionObject.id, sceneId: scene.id });
        setCommentDraft(undefined);
        setTransitionDraft(undefined);
      }}>
        <span className="motion-resize-handle start" role="separator" aria-label="Ridimensiona inizio movimento" title="Trascina per ridimensionare l’inizio" onPointerDown={(event) => beginResizeMotion(motionObject, scene.id, scene.frame, sceneEnd, firstFrame, storedMotionEnd, 'start', event)} />
        <span className="motion-clip-caption"><MoveRight className="timeline-motion-icon" size={11} /><span>Movimento</span><small>{realPoints.length} punti</small></span>
        <span className="motion-key-ticks">{realPoints.map((key, index) => <span key={key.id} role="button" tabIndex={0} title={`Seleziona il punto al frame ${key.frame}`} aria-label={`Punto movimento al frame ${key.frame}`} data-edge={index === 0 ? 'start' : index === realPoints.length - 1 ? 'end' : undefined} className={`motion-key-tick ${deleteTarget?.kind === 'keyframe' && deleteTarget.keyframeId === key.id ? 'selected' : ''}`} style={{ left: `${((key.frame - firstFrame) / Math.max(1, lastMotionFrame - firstFrame)) * 100}%` }} onClick={(event) => { event.stopPropagation(); if (motionPointDragged.current) return; setPlaying(false); if (motionObject.kind !== 'camera') select(motionObject.id); selectMotion({ objectId: motionObject.id, sceneId: scene.id }); setDeleteTarget({ kind: 'keyframe', objectId: motionObject.id, keyframeId: key.id }); if (cameraView) setFrame(key.frame); }} onKeyDown={(event) => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); event.stopPropagation(); setPlaying(false); if (motionObject.kind !== 'camera') select(motionObject.id); selectMotion({ objectId: motionObject.id, sceneId: scene.id }); setDeleteTarget({ kind: 'keyframe', objectId: motionObject.id, keyframeId: key.id }); if (cameraView) setFrame(key.frame); }} onPointerDown={(event) => beginMoveMotionPoint(motionObject, scene.id, scene.frame, sceneEnd, key.id, key.frame, event)} />)}</span>
        <span className="motion-resize-handle end" role="separator" aria-label="Ridimensiona fine movimento" title="Trascina per ridimensionare la fine" onPointerDown={(event) => beginResizeMotion(motionObject, scene.id, scene.frame, sceneEnd, firstFrame, storedMotionEnd, 'end', event)} />
      </button>];
    });
    if (!clips.length) return null;
    return <Fragment key={`${camera ? 'camera' : object!.id}-motion-track`}><div className={`track-label movement-label ${camera ? 'camera-movement-label' : ''}`}><span className="movement-hierarchy">{camera ? <Video size={13} /> : <MoveRight size={13} />}Movimento {camera ? 'camera' : ''}</span></div><div className={`track movement-track ${camera ? 'camera-movement-track' : ''}`} onClick={seek}>{clips}<i style={{ left: left(frame) }} /></div></Fragment>;
  };
  const transitionMarkers = scenes.slice(1).map((scene, index) => {
    const from = scenes[index];
    const note = project.comments.find((comment) => comment.kind === 'transition' && comment.fromSceneId === from.id && comment.toSceneId === scene.id);
    return <button key={`transition-${scene.id}`} className={`transition-marker ${note ? 'has-note' : ''}`} style={{ left: left(scene.frame) }} title={note?.text ?? 'Aggiungi una nota alla transizione'} onClick={(event) => {
      event.stopPropagation();
      setCommentDraft(undefined);
      setTransitionDraft({ fromId: from.id, toId: scene.id, label: `${from.name ?? `Scena ${index + 1}`} → ${scene.name ?? `Scena ${index + 2}`}`, text: note?.text ?? '' });
    }}>{note ? <MessageCircle size={11} /> : <Plus size={12} />}</button>;
  });
  useEffect(() => {
    const selectScene = (event: Event) => {
      const sceneId = (event as CustomEvent<{ sceneId?: string }>).detail?.sceneId;
      const scene = scenes.find((item) => item.id === sceneId);
      if (!scene) return;
      select(undefined);
      setSelectedTimelineObjectIds(new Set());
      setFrame(scene.frame);
      setSelectedTrack({ scope: 'scene', sceneId: scene.id, label: scene.name ?? 'Scena' });
      setDeleteTarget({ kind: 'scene', sceneId: scene.id });
      setCommentDraft(undefined);
      setTransitionDraft(undefined);
    };
    window.addEventListener('abaco:select-scene', selectScene);
    return () => window.removeEventListener('abaco:select-scene', selectScene);
  }, [scenes.map((scene) => scene.id).join(':'), select, setFrame]);
  const deleteSelectedBlock = () => {
      const deletion = deleteTarget;
      if (!deletion) return;
      if (deletion.kind === 'scene') deleteScene(deletion.sceneId);
      else if (deletion.kind === 'object') deleteObject(deletion.objectId);
      else if (deletion.kind === 'segment') deleteObjectFromScene(deletion.objectId, deletion.sceneId);
      else if (deletion.kind === 'motion') deleteMotionFromScene(deletion.objectId, deletion.sceneId);
      else deleteMotionPoint(deletion.objectId, deletion.keyframeId);
      if (deletion.kind === 'motion') selectMotion(undefined);
      setDeleteTarget(undefined);
      setSelectedTrack(undefined);
  };
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        setSelectedTimelineObjectIds(new Set(timelineObjects.map((object) => object.id)));
        if (timelineObjects[0]) select(timelineObjects[0].id);
      } else if (key === 'c') {
        const ids = selectedTimelineObjectIdsRef.current.size
          ? [...selectedTimelineObjectIdsRef.current]
          : selectedId && timelineObjects.some((object) => object.id === selectedId) ? [selectedId] : [];
        if (!ids.length) return;
        event.preventDefault();
        copiedTimelineObjectIds = ids;
      } else if (key === 'v' && activeScene && copiedTimelineObjectIds.length) {
        event.preventDefault();
        const created = duplicateObjectsToScene(copiedTimelineObjectIds, activeScene.id);
        if (created.length) setSelectedTimelineObjectIds(new Set(created));
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [activeScene?.id, duplicateObjectsToScene, selectedId, timelineObjects.map((object) => object.id).join(':')]);
  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (selectedTimelineObjectIdsRef.current.size > 1) {
        event.preventDefault();
        for (const objectId of selectedTimelineObjectIdsRef.current) deleteObject(objectId);
        setSelectedTimelineObjectIds(new Set());
        setDeleteTarget(undefined);
        setSelectedTrack(undefined);
        return;
      }
      if (!deleteTarget) return;
      event.preventDefault();
      deleteSelectedBlock();
    };
    window.addEventListener('keydown', remove);
    return () => window.removeEventListener('keydown', remove);
  }, [deleteTarget]);
  return <section className={`timeline ${collapsed ? 'collapsed' : ''}`}>
    <header className="timeline-toolbar">
      {collapsed && <div className="timeline-mini-row">
        <div className="collapsed-scene-row">
          <div className="collapsed-scene-overview" role="group" aria-label="Timeline ridotta delle scene">
            <div className="collapsed-scene-content" style={{ width: `${Math.max(800, Math.round(durationSeconds * timelineZoom))}px`, '--timeline-second-width': `${timelineZoom}px` } as React.CSSProperties}>
              {scenes.map((scene, index) => {
              const nextFrame = scenes[index + 1]?.frame ?? end + 1;
              const stripLeft = ((scene.frame - start) / project.settings.fps) * timelineZoom;
              const stripWidth = ((nextFrame - scene.frame) / project.settings.fps) * timelineZoom;
              return <button key={scene.id} type="button" className={`collapsed-scene-segment ${activeSceneIndex === index ? 'active' : ''}`} aria-label={`${scene.name ?? `Scena ${index + 1}`} · frame ${scene.frame}-${nextFrame - 1}`} title={`Anteprima ${scene.name ?? `Scena ${index + 1}`}`} style={{ left: `${stripLeft}px`, width: `${stripWidth}px`, backgroundImage: sceneThumbnails[scene.id] ? `linear-gradient(rgba(20,20,20,.18), rgba(20,20,20,.18)), url(${sceneThumbnails[scene.id]})` : undefined }} onClick={(event) => { event.stopPropagation(); setFrame(frameInsideBlock(event, scene.frame, nextFrame)); }}><span>{index + 1}</span></button>;
              })}
              <i className="collapsed-scene-playhead" style={{ left: `${((frame - start) / project.settings.fps) * timelineZoom}px` }} />
            </div>
          </div>
          <button type="button" className="collapsed-add-scene" title="Aggiungi una nuova scena" aria-label="Aggiungi scena dalla timeline ridotta" onClick={(event) => { event.stopPropagation(); addShot(); }}><Plus size={13} /></button>
        </div>
      </div>}
      <div className="timeline-control-row">
      <div className="timeline-context">
        <strong className="timecode">{timecode}</strong>
      </div>
      <div className="timeline-center-stack">
        <div className="transport timeline-transport">
          <button className="split-button icon" disabled={!canSplit} onClick={splitScene} title="Taglia la clip al cursore" aria-label="Taglia la clip al cursore"><Scissors size={15} /></button>
          <button className="icon" title="Vai all'inizio" onClick={() => setFrame(start)}><ChevronsLeft size={16} /></button>
          <button className="icon" title="Frame precedente" aria-label="Frame precedente" onClick={() => setFrame(frame - 1)}><ChevronLeft size={17} /></button>
          <button className="play" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <button className={`timeline-record ${recordingSession ? 'active' : ''}`} disabled={!activeScene} title={recordingSession ? `Ferma registrazione · ${recordingSession.touchedObjectIds.length} soggetti mossi` : 'Registra movimenti di camera e oggetti'} aria-label={recordingSession ? 'Ferma registrazione movimento' : 'Registra movimenti'} onClick={toggleRecording}><i /></button>
          <button className="icon" title="Frame successivo" aria-label="Frame successivo" onClick={() => setFrame(frame + 1)}><ChevronRight size={17} /></button>
          <button className="icon" title="Vai alla fine" onClick={() => setFrame(end)}><ChevronsRight size={16} /></button>
        </div>
      </div>
      <div className="timeline-actions"><span className="duration">{durationSeconds.toFixed(1)} s</span><button className="icon" title={collapsed ? 'Apri timeline' : 'Riduci timeline'} onClick={onToggleCollapse}>{collapsed ? <PanelBottomOpen size={16} /> : <PanelBottomClose size={16} />}</button></div>
      </div>
    </header>
    {commentDraft && <div className="timeline-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommentDraft(undefined); }}><div className="timeline-comment-popover" role="dialog" aria-modal="true" aria-label={`Commento ${commentDraft.label}`}>
      <div className="comment-popover-head"><span title={commentDraft.label}>Commento · {commentDraft.label}</span><button className="icon" title="Chiudi" onClick={() => setCommentDraft(undefined)}><X size={14} /></button></div>
      <DirectionInput value={commentDraft.text} scope={commentDraft.scope} onChange={text => setCommentDraft({ ...commentDraft, text })} onSave={saveComment} onClose={() => setCommentDraft(undefined)} />
      <div className="comment-popover-actions">{findTrackComment(commentDraft) && <button className="subtle danger" onClick={removeComment}><Trash2 size={13} /> Elimina</button>}<button className="subtle" onClick={() => setCommentDraft(undefined)}>Annulla</button><button className="primary" disabled={!commentDraft.text.trim()} onClick={saveComment}><Check size={14} /> Salva</button></div>
    </div></div>}
    {transitionDraft && <div className="timeline-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTransitionDraft(undefined); }}><div className="timeline-comment-popover" role="dialog" aria-modal="true" aria-label={`Transizione ${transitionDraft.label}`}>
      <div className="comment-popover-head"><span title={transitionDraft.label}>Transizione · {transitionDraft.label}</span><button className="icon" title="Chiudi" onClick={() => setTransitionDraft(undefined)}><X size={14} /></button></div>
      <textarea autoFocus placeholder="Descrivi la transizione" value={transitionDraft.text} onChange={(event) => setTransitionDraft({ ...transitionDraft, text: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveTransition(); if (event.key === 'Escape') setTransitionDraft(undefined); }} />
      <div className="comment-popover-actions"><button className="subtle" onClick={() => setTransitionDraft(undefined)}>Annulla</button><button className="primary" disabled={!transitionDraft.text.trim()} onClick={saveTransition}><Check size={14} /> Salva</button></div>
    </div></div>}
    <div className="timeline-scroll" onClick={seekFromEmptyTimeline} onWheelCapture={zoomTimelineFromWheel} style={{ '--timeline-content-width': `${Math.round(durationSeconds * timelineZoom)}px`, '--timeline-second-width': `${timelineZoom}px` } as React.CSSProperties}>
      <div className="ruler-label">Tempo</div>
      <div className="ruler timeline-ruler" onClick={seek}>{rulerSeconds.map((second) => <span key={second} style={{ left: left(start + second * project.settings.fps) }}>{formatRulerTime(second)}</span>)}<i style={{ left: left(frame) }} /></div>
      <div className="track-label scene-label locked-label"><b><Video size={12} /> Scene</b><LockKeyhole size={12} /></div>
      <div className="track scene-track" onClick={(event) => { seek(event); const rect = event.currentTarget.getBoundingClientRect(); const clickedFrame = start + ((event.clientX - rect.left) / rect.width) * (end - start); const scene = scenes.filter((item) => item.frame <= clickedFrame).at(-1) ?? scenes[0]; if (scene) { select(undefined); setSelectedTimelineObjectIds(new Set()); setSelectedTrack({ scope: 'scene', sceneId: scene.id, label: scene.name ?? 'Scena' }); setDeleteTarget({ kind: 'scene', sceneId: scene.id }); } }}>{scenes.map((scene, index) => {
        const nextFrame = scenes[index + 1]?.frame ?? end + 1;
        const width = Math.max(1.5, ((nextFrame - scene.frame) / Math.max(1, end - start + 1)) * 100);
        const sceneSelection: TrackSelection = { scope: 'scene', sceneId: scene.id, label: scene.name ?? `Scena ${index + 1}` };
        return <div key={scene.id} className={`scene-clip ${activeSceneIndex === index ? 'active' : ''}`} style={{ left: left(scene.frame), width: `${width}%` }}>
          <button className={`scene-image ${isSelectedTrack(sceneSelection) ? 'selected-block' : ''}`} style={sceneThumbnails[scene.id] ? { backgroundImage: `linear-gradient(90deg,rgba(20,22,22,.1),rgba(20,22,22,.02)),url(${sceneThumbnails[scene.id]})` } : undefined} title={scene.name ?? `Scena ${index + 1}`} onClick={(event) => { event.stopPropagation(); setFrame(isSelectedTrack(sceneSelection) ? scene.frame : frameInsideBlock(event, scene.frame, nextFrame)); select(undefined); setSelectedTimelineObjectIds(new Set()); setSelectedTrack(sceneSelection); setDeleteTarget({ kind: 'scene', sceneId: scene.id }); setCommentDraft(undefined); }}>
            <span className="clip-title"><span className="clip-title-text">{scene.name ?? `Scena ${index + 1}`}</span>{noteBadge(sceneSelection, 'clip-comment')}</span><small>{((nextFrame - scene.frame) / project.settings.fps).toFixed(1)} s</small>
          </button>
          <span className="clip-resize-handle" onPointerDown={(event) => beginResize(index, event)} />
        </div>;
      })}{transitionMarkers}<button className="timeline-add-scene" title="Aggiungi una nuova scena" aria-label="Aggiungi scena dalla timeline" onClick={(event) => { event.stopPropagation(); addShot(); }}><Plus size={16} /></button><i style={{ left: left(frame) }} /></div>
      {renderMotionTrack(undefined, true)}
      {timelineObjects.map((object) => { const displayName = object.name; const objectVisible = evaluateProperty(object, 'visibility', frame) as boolean; const audioRange = object.kind === 'audio' ? objectPresenceRange(object, start, end + 1) : undefined; return <Fragment key={object.id}><div className={`track-pair object-row ${selectedTimelineObjectIds.has(object.id) || selectedId === object.id ? 'active' : ''}`}>
        <div className="track-label timeline-object-label" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/abaco-object', object.id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/abaco-object'); if (sourceId) reorderObjects(sourceId, object.id); }}>
          <GripVertical className="row-grip" size={12} /><ElementThumbnail object={object} /><button className="row-name" title={displayName} onClick={(event) => { selectTimelineObject(object.id, event.metaKey || event.ctrlKey); setDeleteTarget({ kind: 'object', objectId: object.id }); if (activeScene) setSelectedTrack({ scope: 'object', sceneId: activeScene.id, objectId: object.id, label: `${displayName} · ${activeScene.name ?? 'Scena'}` }); }}>{displayName}</button>{activeScene && noteBadge({ scope: 'object', sceneId: activeScene.id, objectId: object.id, label: `${displayName} · ${activeScene.name ?? 'Scena'}` }, 'label-comment')}<button className="row-action" title={objectVisible ? 'Nascondi' : 'Mostra'} aria-label={objectVisible ? `Nascondi ${displayName}` : `Mostra ${displayName}`} onClick={() => updateObject(object.id, { visible: !objectVisible })}>{objectVisible ? <Eye size={12} /> : <EyeOff size={12} />}</button><button className="row-action danger" title="Elimina" aria-label={`Elimina ${displayName}`} onClick={() => deleteObject(object.id)}><Trash2 size={12} /></button>
        </div>
        <div className="track presence-track" onClick={seek}>
          {object.kind === 'audio' ? audioRange && <button className={`presence-segment audio-layer ${selectedId === object.id ? 'selected-block' : ''}`} style={{ left: left(audioRange[0]), width: `${((audioRange[1] - audioRange[0]) / Math.max(1, end - start + 1)) * 100}%` }} title={`${displayName} · ${(object.audio.duration).toFixed(1)} s`} onClick={(event) => { event.stopPropagation(); selectTimelineObject(object.id, event.metaKey || event.ctrlKey); setDeleteTarget({ kind: 'object', objectId: object.id }); setTransitionDraft(undefined); setCommentDraft(undefined); }}><AudioWaveform values={object.audio.waveform} /><span className="audio-clip-label"><Music2 size={11} />{displayName}</span></button> : scenes.map((scene, index) => {
            const next = scenes[index + 1];
            const clipEnd = next?.frame ?? end + 1;
            const selection: TrackSelection = { scope: 'object', sceneId: scene.id, objectId: object.id, label: `${displayName} · ${scene.name ?? `Scena ${index + 1}`}` };
            if (object.sceneIds.length > 0 && !object.sceneIds.includes(scene.id)) return null;
            const storedRange = objectPresenceRange(object, scene.frame, clipEnd);
            const preview = presencePreview?.objectId === object.id && presencePreview.sceneId === scene.id ? presencePreview : undefined;
            const range = preview ? [preview.start, preview.end] as const : storedRange;
            if (!range) return null;
            const width = ((range[1] - range[0]) / Math.max(1, end - start + 1)) * 100;
            return <button key={`${object.id}-${scene.id}`} className={`presence-segment ${object.kind === 'text' && object.screenSpace ? 'text-layer' : object.screenSpace ? 'image-layer' : ''} ${preview ? 'resizing' : ''} ${isSelectedTrack(selection) ? 'selected-block' : ''}`} style={{ left: left(range[0]), width: `${width}%` }} title={`${displayName} · frame ${range[0]}–${range[1] - 1}`} onClick={(event) => {
              event.stopPropagation(); setFrame(isSelectedTrack(selection) ? scene.frame : frameInsideBlock(event, range[0], range[1])); selectTimelineObject(object.id, event.metaKey || event.ctrlKey); setDeleteTarget({ kind: 'segment', objectId: object.id, sceneId: scene.id }); setTransitionDraft(undefined); setCommentDraft(undefined); setSelectedTrack(selection);
            }}><span className="presence-resize-handle start" role="separator" aria-label="Ridimensiona inizio elemento" onPointerDown={(event) => beginResizePresence(object, scene.id, scene.frame, clipEnd, 'start', event)} /><span className="segment-thumbnails" aria-hidden="true"><ElementThumbnail object={object} compact /></span><span className="segment-mode">Presente</span>{noteBadge(selection, 'segment-comment')}<span className="presence-resize-handle end" role="separator" aria-label="Ridimensiona fine elemento" onPointerDown={(event) => beginResizePresence(object, scene.id, scene.frame, clipEnd, 'end', event)} /></button>;
          })}
          <i style={{ left: left(frame) }} />
        </div>
      </div>{object.kind !== 'audio' && renderMotionTrack(object)}</Fragment>})}
    </div>
  </section>;
}
