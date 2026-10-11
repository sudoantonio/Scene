import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { StrokeJevGuide } from '../domain/jev-drawing';
import { automaticStrokeRadius, positionStrokePoint, StrokePointIndex, strokeNeighbors, StrokeSurface, strokeTubeGeometry } from '../domain/stroke-spatial';
import { StrokeSceneContext, screenStrokeSurface, type SceneStrokePoint } from '../domain/stroke-scene-context';
import type { SceneObject, Vec3 } from '../domain/schema';
import { useEditor, type DrawnMotionCheckpoint } from '../store/editor';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { isDrawnMotionTarget } from '../domain/drawn-motion';
import { useStrokeDrawing } from '../store/stroke-drawing';

export function StrokeVisual({ stroke, color }: { stroke: NonNullable<SceneObject['stroke']>; color: string }) {
  const geometry = useMemo(() => strokeTubeGeometry(stroke.points, stroke.thickness), [stroke.points, stroke.thickness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.7} side={THREE.DoubleSide} /></mesh>;
}

type Session = {
  pointerId: number; camera: THREE.Camera; plane: THREE.Plane; project: ReturnType<typeof useEditor.getState>['project'];
  contextPoints: SceneStrokePoint[];
  frame: number; cameraView: boolean; surfaces: StrokeSurface[]; index: StrokePointIndex; diagonal: number; radius: number;
  motion?: { objectId: string; offset: THREE.Vector3; anchor: Vec3; recording: boolean; checkpoint: DrawnMotionCheckpoint; startFrame: number; started: number; duration: number; keyId?: string; contextFrame?: number; frameOffset: number };
  points: Vec3[]; normals: Vec3[]; lastScreen: [number, number]; thickness: number; color: string;
};

/** Capture native events before OrbitControls and R3F's selection listeners. */
export default function StrokeDrawing() {
  const { gl, scene, camera } = useThree();
  const active = useStrokeDrawing(state => state.active);
  const showInfluence = useStrokeDrawing(state => state.showInfluence);
  const session = useRef<Session | undefined>(undefined);
  const cancelSession = useRef<(message?: string, restore?: boolean) => void>(() => {});
  const preview = useRef<THREE.Line>(null);
  const influence = useRef<THREE.Mesh>(null);
  const guide = useRef<StrokeJevGuide | undefined>(undefined);
  if (!guide.current) guide.current = new StrokeJevGuide(
    input => window.abaco?.guideJevDrawing ? window.abaco.guideJevDrawing(input) : Promise.reject(new Error('Jev requires the desktop app.')),
    status => useStrokeDrawing.setState({ status }),
  );
  const previewGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(256 * 3), 3));
    geometry.setDrawRange(0, 0);
    return geometry;
  }, []);
  const previewLine = useMemo(() => new THREE.Line(previewGeometry, new THREE.LineBasicMaterial({ color: '#efae45', depthTest: true })), [previewGeometry]);
  useEffect(() => { if (influence.current) influence.current.visible = Boolean(active && session.current && showInfluence); }, [active, showInfluence]);

  useEffect(() => {
    const canvas = gl.domElement;
    let applying = false;
    let tickId = 0;
    let allocated = 0;
    let lastMetrics = 0;
    const hide = () => { if (preview.current) preview.current.visible = false; if (influence.current) influence.current.visible = false; };
    const cancel = (message = 'Gesture cancelled. Drag to start again.', restore = true) => {
      const current = session.current;
      session.current = undefined;
      guide.current!.end(); hide();
      cancelAnimationFrame(tickId);
      if (restore && current?.motion?.recording) { applying = true; useEditor.getState().restoreDrawnMotion(current.motion.checkpoint); applying = false; }
      useStrokeDrawing.setState({ previewMotion: undefined });
      if (current && canvas.hasPointerCapture(current.pointerId)) canvas.releasePointerCapture(current.pointerId);
      if (current) useStrokeDrawing.setState({ drawing: false, status: message });
    };
    cancelSession.current = cancel;
    const redraw = (current: Session, center: Vec3) => {
      const needed = current.points.length;
      if (needed > allocated) {
        allocated = Math.max(256, allocated * 2, needed);
        previewGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allocated * 3), 3).setUsage(THREE.DynamicDrawUsage));
        for (let i = 0; i < needed; i++) (previewGeometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(i, ...current.points[i]);
      } else (previewGeometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(needed - 1, ...current.points[needed - 1]);
      const attribute = previewGeometry.getAttribute('position') as THREE.BufferAttribute;
      attribute.needsUpdate = true;
      previewGeometry.setDrawRange(0, needed);
      if (preview.current) { preview.current.visible = true; (preview.current.material as THREE.LineBasicMaterial).color.set(current.color); }
      if (influence.current) {
        influence.current.visible = useStrokeDrawing.getState().showInfluence;
        influence.current.position.set(...center);
        influence.current.scale.setScalar(current.radius);
      }
    };
    const rayAt = (event: PointerEvent, viewCamera: THREE.Camera) => {
      const rect = canvas.getBoundingClientRect();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), viewCamera);
      return raycaster.ray;
    };
    const contextCollector = new StrokeSceneContext();
    const collect = (editor: ReturnType<typeof useEditor.getState>, excludedId?: string) => contextCollector.collect(scene, editor.project, editor.currentFrame, editor.selectedId, excludedId);
    const screenSurfaces = (current: Session) => {
      const stage = canvas.closest('.viewport');
      const editor = useEditor.getState();
      let viewport = canvas.getBoundingClientRect(), viewCamera = current.camera, plane = current.plane;
      let selector = '[data-stroke-screen-id]';
      if (!current.cameraView) {
        const preview = stage?.querySelector('.live-camera-preview-canvas');
        const cut = editor.project.cameraCuts.filter(cut => cut.frame <= editor.currentFrame).sort((a, b) => a.frame - b.frame).at(-1);
        const object = editor.project.objects.find(object => object.id === cut?.cameraId);
        if (!preview || !cut || !object) return [];
        viewport = preview.getBoundingClientRect();
        const aspect = editor.project.settings.resolutionX / editor.project.settings.resolutionY;
        const lens = Number(evaluateProperty(object, 'lens', editor.currentFrame));
        const shotCamera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan((36 / aspect) / (2 * lens))), aspect, .01, 1000);
        const transform = evaluateTransform(object, editor.currentFrame);
        shotCamera.position.set(...transform.position); shotCamera.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad) as Vec3); shotCamera.up.set(0, 0, 1); shotCamera.updateMatrixWorld(true);
        viewCamera = shotCamera;
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(shotCamera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...cut.framing.target));
        selector = '.live-camera-preview [data-stroke-preview-screen-id]';
      }
      const result: StrokeSurface[] = [];
      for (const element of stage?.querySelectorAll<HTMLElement>(selector) ?? []) {
        const id = element.dataset.strokeScreenId ?? element.dataset.strokePreviewScreenId!;
        if (id === current.motion?.objectId) continue;
        const content = element.querySelector<HTMLElement>('.screen-layer-content') ?? element;
        const rect = content.getBoundingClientRect();
        const clipping = element.closest('.screen-space-layers')?.getBoundingClientRect() ?? viewport;
        const left = Math.max(rect.left, clipping.left, viewport.left), top = Math.max(rect.top, clipping.top, viewport.top);
        const right = Math.min(rect.right, clipping.right, viewport.right), bottom = Math.min(rect.bottom, clipping.bottom, viewport.bottom);
        if (right <= left || bottom <= top) continue;
        const object = editor.project.objects.find(object => object.id === id);
        const surface = screenStrokeSurface(id, [[left, top], [right, top], [right, bottom], [left, bottom]], viewport, viewCamera, plane,
          { source: element.dataset.strokeCaption ? 'caption' : 'screen', objectId: object?.id, name: object?.name.slice(0, 500) ?? 'Sottotitolo', elementKind: object?.kind ?? 'text', text: content.textContent?.trim().slice(0, 2000) || undefined });
        if (surface) result.push(surface);
      }
      return result;
    };
    const sample = (event: PointerEvent, force = false) => {
      const current = session.current;
      if (!current || (!force && Math.hypot(event.clientX - current.lastScreen[0], event.clientY - current.lastScreen[1]) < 3)) return;
      if (current.points.length >= 100000) { useStrokeDrawing.setState({ status: '100,000-point limit reached: release to save.' }); return; }
      const bounds = canvas.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      {
        const context = collect(useEditor.getState(), current.motion?.objectId);
        current.surfaces = [...context.surfaces, ...screenSurfaces(current)];
        const samePoints = context.points.length === current.contextPoints.length && context.points.every((point, i) => {
          const old = current.contextPoints[i];
          return point.id === old.id && point.position.every((value, axis) => value === old.position[axis]) && String(point.normal) === String(old.normal);
        });
        if (!samePoints) {
          current.index = new StrokePointIndex(context.points);
          for (let i = 0; i < current.points.length - 2; i++) current.index.add(`current:${i}`, current.points[i], current.normals[i]);
          current.contextPoints = context.points;
        }

      }
      const ray = rayAt(event, current.camera);
      if (current.motion) ray.origin.add(current.motion.offset);
      let hit: ReturnType<StrokeSurface['intersect']>;
      for (const surface of current.surfaces) { const next = surface.intersect(ray); if (next && (!hit || next.distance < hit.distance)) hit = next; }
      const planePoint = ray.intersectPlane(current.plane, new THREE.Vector3());
      const provisional = hit?.position ?? (planePoint ? planePoint.toArray() as Vec3 : undefined);
      if (!provisional) { useStrokeDrawing.setState({ status: 'The drawing plane is outside the view. Select a visible object.' }); return; }
      let neighbors = strokeNeighbors(new THREE.Vector3(...provisional), current.radius, current.index, current.surfaces);
      current.radius = automaticStrokeRadius(current.diagonal, current.radius, neighbors);
      // Requery after radius adaptation so every supplied input is inside the current sphere.
      neighbors = strokeNeighbors(new THREE.Vector3(...provisional), current.radius, current.index, current.surfaces);
      const previous = current.points.at(-1);
      const result = positionStrokePoint(ray, provisional, neighbors, current.radius, guide.current!.parameters, previous, hit);
      if (current.motion && !previous) result.position = [...current.motion.anchor];
      current.lastScreen = [event.clientX, event.clientY];
      if (previous && new THREE.Vector3(...previous).distanceToSquared(new THREE.Vector3(...result.position)) < 1e-14) return;
      current.points.push(result.position);
      current.normals.push(result.normal ?? current.camera.getWorldDirection(new THREE.Vector3()).negate().toArray() as Vec3);
      // The last two points remain excluded; older samples enter the incremental index.
      const eligible = current.points.length - 3;
      if (eligible >= 0) current.index.add(`current:${eligible}`, current.points[eligible], current.normals[eligible]);
      redraw(current, provisional);
      if (current.motion) {
        useStrokeDrawing.setState({ previewMotion: { objectId: current.motion.objectId, position: result.position } });
        if (current.motion.recording && current.points.length > 1) record(current, performance.now());
      }
      const now = performance.now();
      if (now - lastMetrics > 50 || force) { useStrokeDrawing.setState({ radius: current.radius, neighborCount: neighbors.length, elementCount: current.surfaces.length, surfaceNeighborCount: neighbors.filter(neighbor => neighbor.kind === 'surface').length }); lastMetrics = now; }
      guide.current!.update({ instruction: useStrokeDrawing.getState().instruction, position: provisional, radius: current.radius, neighbors,
        view: { position: current.camera.position.toArray() as Vec3, direction: current.camera.getWorldDirection(new THREE.Vector3()).toArray() as Vec3, mode: current.cameraView ? 'camera' : 'free' } }, now);
    };
    const record = (current: Session, now: number) => {
      const motion = current.motion!;
      const frame = motion.startFrame + Math.round((now - motion.started) / 1000 * useEditor.getState().project.settings.fps) + motion.frameOffset;
      applying = true;
      const result = useEditor.getState().recordDrawnPosition(motion.objectId, current.points.at(-1)!, frame, motion.startFrame, motion.keyId);
      applying = false;
      if (result) { motion.keyId = result.keyId; motion.frameOffset += Math.max(0, result.frame - frame); }
      const editor = useEditor.getState(); current.project = editor.project; current.frame = editor.currentFrame;
    };
    const tick = () => {
      const current = session.current;
      if (!current?.motion?.recording) return;
      // Write stationary endpoints too: playback retains pauses and the gesture's real duration.
      const motion = current.motion;
      const frame = motion.startFrame + Math.round((performance.now() - motion.started) / 1000 * useEditor.getState().project.settings.fps) + motion.frameOffset;
      if (current.points.length > 1 && frame > current.frame) record(current, performance.now());
      tickId = requestAnimationFrame(tick);
    };
    const consume = (event: PointerEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const begin = (event: PointerEvent) => {
      if (!useStrokeDrawing.getState().active || useStrokeDrawing.getState().mode !== 'stroke' || event.button !== 0 || session.current) return;
      consume(event);
      const config = useStrokeDrawing.getState();
      const before = useEditor.getState();
      const target = before.project.objects.find(object => object.id === before.selectedId);
      if (config.mode === 'motion' && (!isDrawnMotionTarget(target) || !evaluateProperty(target, 'visibility', before.currentFrame))) { useStrokeDrawing.setState({ status: 'Select a 3D object to move.' }); return; }
      if (config.mode === 'stroke') useEditor.getState().stopRecording();
      useEditor.getState().setPlaying(false);
      const editor = useEditor.getState();
      const { surfaces, points, bounds, selectedBounds, selectedRoot } = collect(editor, config.mode === 'motion' ? target?.id : undefined);
      const referenceBox = selectedBounds ?? bounds;
      const diagonal = referenceBox.isEmpty() ? 1 : Math.max(1e-4, referenceBox.getSize(new THREE.Vector3()).length());
      const center = selectedBounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
      const viewCamera = camera.clone(); viewCamera.updateMatrixWorld(true);
      session.current = { pointerId: event.pointerId, camera: viewCamera, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(viewCamera.getWorldDirection(new THREE.Vector3()), center),
        contextPoints: points, project: editor.project, frame: editor.currentFrame, cameraView: editor.cameraView, surfaces, index: new StrokePointIndex(points), diagonal, radius: diagonal * .2,
        points: [], normals: [], lastScreen: [event.clientX, event.clientY], thickness: config.thickness, color: config.color };
      if (config.mode === 'motion' && target) {
        const anchor = selectedRoot?.getWorldPosition(new THREE.Vector3()).toArray() as Vec3 | undefined ?? evaluateTransform(target, editor.currentFrame).position;
        session.current.plane.setFromNormalAndCoplanarPoint(viewCamera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...anchor));
        const cursor = rayAt(event, viewCamera).intersectPlane(session.current.plane, new THREE.Vector3()) ?? new THREE.Vector3(...anchor);
        session.current.motion = { objectId: target.id, anchor, offset: new THREE.Vector3(...anchor).sub(cursor), recording: Boolean(editor.recordingSession),
          checkpoint: { project: editor.project, currentFrame: editor.currentFrame, recordingSession: editor.recordingSession, recordingMotion: editor.recordingMotion,
            selectedMotion: editor.selectedMotion, past: editor.past, future: editor.future, dirty: editor.dirty, isPlaying: editor.isPlaying },
          startFrame: editor.currentFrame, started: performance.now(), duration: config.durationSeconds, frameOffset: 0 };
      }
      allocated = 0; previewGeometry.setDrawRange(0, 0);
      canvas.setPointerCapture(event.pointerId);
      useStrokeDrawing.setState({ drawing: true, panelOpen: false, status: session.current.motion ? (session.current.motion.recording ? 'REC · live motion · Esc cancels the gesture' : 'Path preview · Esc cancels') : 'Drawing · Esc cancels' });
      guide.current!.begin(); sample(event, true);
      if (session.current?.motion?.recording) tickId = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => { if (event.pointerId === session.current?.pointerId && (event.buttons & 1) !== 0) { consume(event); sample(event); } };
    const finish = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      consume(event); sample(event);
      if (current.motion?.recording && current.points.length >= 2) record(current, performance.now());
      session.current = undefined; guide.current!.end(); hide(); cancelAnimationFrame(tickId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (current.motion) {
        if (current.points.length >= 2) {
          if (current.motion.recording) useEditor.getState().finishRecordingMovement();
          else useEditor.getState().applyDrawnMotion(current.motion.objectId, current.points, current.motion.duration);
        }
        useStrokeDrawing.setState({ drawing: false, previewMotion: undefined, status: current.points.length < 2 ? 'Drag at least 3 pixels to create motion.' : current.motion.recording ? 'Motion recorded. REC stays active; press Stop REC to finish.' : 'Path saved in the timeline. Press Play to play it.' });
        return;
      }
      if (current.points.length >= 2) useEditor.getState().addStroke(current.points, current.thickness, current.color, current.normals);
      useStrokeDrawing.setState({ drawing: false, status: current.points.length >= 2 ? 'Stroke saved. Drag to draw another.' : 'Drag at least 3 pixels to create a stroke.' });
    };
    const pointerCancel = (event: PointerEvent) => { if (event.pointerId === session.current?.pointerId) cancel('Stroke cancelled: gesture interrupted.'); };
    const key = (event: KeyboardEvent) => {
      if (useStrokeDrawing.getState().mode === 'stroke' && event.key === 'Escape' && (session.current || useStrokeDrawing.getState().active)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (session.current) cancel(); else useStrokeDrawing.setState({ active: false });
      }
    };
    const blur = () => { if (session.current) cancel('Stroke cancelled: window inactive.'); };
    const unsubscribe = useEditor.subscribe(editor => {
      const current = session.current;
      if (!current || applying) return;
      if (editor.project !== current.project || editor.currentFrame !== current.frame || editor.cameraView !== current.cameraView || (current.motion && (editor.selectedId !== current.motion.objectId || Boolean(editor.recordingSession) !== current.motion.recording))) cancel('Gesture ended: scene or view changed.', false);
      else if (editor.isPlaying) editor.setPlaying(false);
    });
    canvas.addEventListener('pointerdown', begin, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    return () => {
      unsubscribe(); cancel('Stroke cancelled: view updated.');
      canvas.removeEventListener('pointerdown', begin, true); window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true); window.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur);
    };
  }, [camera, gl, scene, previewGeometry]);
  useEffect(() => { if (!active && session.current) cancelSession.current(); }, [active]);
  useEffect(() => () => { previewGeometry.dispose(); (previewLine.material as THREE.Material).dispose(); }, [previewGeometry, previewLine]);
  return <>
    <primitive object={previewLine} ref={preview} visible={active} frustumCulled={false} raycast={() => {}} userData={{ strokeSkip: true }} />
    <mesh ref={influence} visible={false} raycast={() => {}} userData={{ strokeSkip: true }}><sphereGeometry args={[1, 16, 12]} /><meshBasicMaterial color="#eeb854" wireframe transparent opacity={.18} depthWrite={false} /></mesh>
  </>;
}
