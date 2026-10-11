import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { circleViewLine, fitViewPlane, intersectViewLine, objectMotionPoints, pointsInCircle, projectMotionPoints, translatedPivot, type ScreenPoint } from '../domain/circle-motion';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { clickMotionObject } from '../domain/motion-selection';
import { isDrawnMotionTarget, recordedSurfaceSamples } from '../domain/drawn-motion';
import { pathDistance, shortestSurfaceMotion } from '../domain/surface-motion';
import type { Vec3 } from '../domain/schema';
import { useEditor, type DrawnMotionCheckpoint } from '../store/editor';
import { useStrokeDrawing } from '../store/stroke-drawing';
import { interfaceZoom } from '../domain/interface-zoom';

type Pick = { camera: THREE.Camera; plane: THREE.Plane; anchor: THREE.Vector3; pivot: THREE.Vector3; project: ReturnType<typeof useEditor.getState>['project']; frame: number; cameraView: boolean; size: { width: number; height: number } };
type Press = { pointerId: number; clientX: number; clientY: number; hitId?: string; moved: boolean; started: number };
type Gesture = { pick: Pick; pointerId: number; destination: ScreenPoint[]; basePoints: Vec3[]; distance: number; recorded: Map<string, { distance: number; elapsed: number }>; previewSlope: THREE.Vector3; points: Vec3[]; last: [number, number]; checkpoint: DrawnMotionCheckpoint; recording: boolean; started: number; keyId?: string; frame: number; project: Pick['project']; duration: number; destinationFrame: number };

/** Source and destination are isolated before collecting their vertices. No global neighbors or AI fit. */
export default function CircleMotionDrawing() {
  const { gl, scene, camera } = useThree();
  const markers = useMemo(() => new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#ffd57b', size: 5, sizeAttenuation: false, depthTest: false })), []);
  const trail = useMemo(() => new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#efae45', depthTest: false })), []);
  useEffect(() => () => { markers.geometry.dispose(); (markers.material as THREE.Material).dispose(); }, [markers]);
  useEffect(() => () => { trail.geometry.dispose(); (trail.material as THREE.Material).dispose(); }, [trail]);
  useEffect(() => {
    const canvas = gl.domElement;
    let pick: Pick | undefined, gesture: Gesture | undefined, press: Press | undefined, applying = false, tick = 0;
    const enabled = () => { const s = useStrokeDrawing.getState(); return s.active && s.mode === 'motion'; };
    const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const inside = (x: number, y: number) => { const r = canvas.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    const cursor = (x: number, y: number) => {
      const stage = canvas.closest('.viewport')!.getBoundingClientRect();
      useStrokeDrawing.setState({ cursor: inside(x, y) ? { x: (x - stage.left) / interfaceZoom(), y: (y - stage.top) / interfaceZoom() } : undefined });
      const r = canvas.getBoundingClientRect(), zoom = interfaceZoom();
      return { x: (x - r.left) / zoom, y: (y - r.top) / zoom, width: r.width / zoom, height: r.height / zoom };
    };
    const rootFor = (id: string | undefined) => { let found: THREE.Object3D | undefined; scene.traverseVisible(o => { if (o.userData.sceneObjectId === id && id) found = o; }); return found; };
    const valid = (id: string | undefined) => {
      const e = useEditor.getState(), o = e.project.objects.find(o => o.id === id);
      const cut = e.project.cameraCuts.filter(c => c.frame <= e.currentFrame).sort((a, b) => a.frame - b.frame).at(-1);
      return isDrawnMotionTarget(o) && evaluateProperty(o, 'visibility', e.currentFrame) && (!o.sceneIds.length || o.sceneIds.includes(cut?.id ?? ''));
    };
    const stop = (message?: string, restore = true) => {
      const previous = gesture, pending = press; gesture = undefined; press = undefined; cancelAnimationFrame(tick);
      if (pending && canvas.hasPointerCapture(pending.pointerId)) canvas.releasePointerCapture(pending.pointerId);
      if (restore && previous?.recording) { applying = true; useEditor.getState().restoreDrawnMotion(previous.checkpoint); applying = false; }
      if (previous && canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
      markers.position.set(0, 0, 0);
      trail.visible = false;
      useStrokeDrawing.setState({ drawing: false, previewMotion: undefined, ...(message ? { status: message } : {}) });
    };
    const clear = () => { stop(); markers.visible = false; pick = undefined; useStrokeDrawing.setState({ sourcePointCount: 0, destinationPointCount: 0 }); };
    const hitObject = (event: { clientX: number; clientY: number }) => {
      const c = cursor(event.clientX, event.clientY), raycaster = new THREE.Raycaster();
      scene.updateMatrixWorld(true);
      raycaster.setFromCamera(new THREE.Vector2(c.x / c.width * 2 - 1, 1 - c.y / c.height * 2), camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        let object: THREE.Object3D | null = hit.object, id: string | undefined, skip = false;
        while (object) { if (object.userData.strokeSkip) skip = true; if (object.userData.sceneObjectId) id = object.userData.sceneObjectId; object = object.parent; }
        if (!skip && valid(id)) return id;
      }
    };
    const chooseObject = (id: string | undefined) => {
      const config = useStrokeDrawing.getState(), pair = clickMotionObject(config.sourceId, config.destinationId, id);
      useEditor.getState().select(pair.sourceId);
      useStrokeDrawing.setState({ ...pair, panelOpen: false, status: !pair.sourceId ? 'Click the object to move.' : !pair.destinationId ? 'First object selected. Click the second; click the first again to deselect it.' : 'Two objects selected. Press and drag on the first to draw; release on the second.' });
    };
    const selectPoints = (event: { clientX: number; clientY: number }) => {
      const config = useStrokeDrawing.getState(), root = rootFor(config.sourceId), e = useEditor.getState();
      if (!root || !valid(config.sourceId) || !valid(config.destinationId)) { clear(); useStrokeDrawing.setState({ status: 'Choose two different visible 3D objects.' }); return; }
      e.setPlaying(false); useEditor.getState().select(config.sourceId);
      const c = cursor(event.clientX, event.clientY), view = camera.clone(); view.updateMatrixWorld(true);
      const points = pointsInCircle(projectMotionPoints(objectMotionPoints(root), view, c), c.x, c.y, config.circleRadius);
      const plane = fitViewPlane(points, view.getWorldDirection(new THREE.Vector3()));
      if (!plane) { markers.visible = false; pick = undefined; useStrokeDrawing.setState({ sourcePointCount: 0, panelOpen: false, status: 'No points from the first object inside the circle. Move the cursor or enlarge the circle.' }); return; }
      markers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(p => p.toArray()), 3)); markers.position.set(0, 0, 0); markers.visible = true;
      const line = circleViewLine(view, c, c.x, c.y, plane), anchor = line && intersectViewLine(line, plane);
      if (!anchor) return;
      const editor = useEditor.getState(), object = editor.project.objects.find(o => o.id === config.sourceId)!;
      pick = { camera: view, plane, anchor, pivot: new THREE.Vector3(...evaluateTransform(object, editor.currentFrame).position), project: editor.project, frame: editor.currentFrame, cameraView: editor.cameraView, size: c };
      useStrokeDrawing.setState({ panelOpen: false, sourcePointCount: points.length, destinationPointCount: 0, status: `${points.length} starting points. Drag normally and release on the second object.` });
    };
    const record = (current: Gesture, now: number) => {
      if (!current.recording) return;
      const e = useEditor.getState();
      const frame = current.pick.frame + Math.max(1, Math.round((now - current.started) / 1000 * e.project.settings.fps));
      applying = true;
      const saved = e.recordDrawnPosition(useStrokeDrawing.getState().sourceId!, current.points.at(-1)!, frame, current.pick.frame, current.keyId);
      applying = false;
      if (saved) { current.keyId = saved.keyId; current.frame = saved.frame; current.project = useEditor.getState().project; current.recorded.set(saved.keyId, { distance: current.distance, elapsed: now - current.started }); }
    };
    const targetPlane = (current: Gesture, x: number, y: number) => {
      if (current.destinationFrame !== useEditor.getState().currentFrame) {
        const root = rootFor(useStrokeDrawing.getState().destinationId);
        current.destination = root ? projectMotionPoints(objectMotionPoints(root), current.pick.camera, current.pick.size) : [];
        current.destinationFrame = useEditor.getState().currentFrame;
      }
      const points = pointsInCircle(current.destination, x, y, useStrokeDrawing.getState().circleRadius);
      useStrokeDrawing.setState({ destinationPointCount: points.length });
      return fitViewPlane(points, current.pick.plane.normal);
    };
    const sample = (event: { clientX: number; clientY: number }, force = false) => {
      const current = gesture;
      if (!current || !inside(event.clientX, event.clientY)) return;
      const c = cursor(event.clientX, event.clientY);
      if (!force && Math.hypot(c.x - current.last[0], c.y - current.last[1]) < 3) return;
      const line = circleViewLine(current.pick.camera, current.pick.size, c.x, c.y, current.pick.plane);
      const anchor = line && intersectViewLine(line, current.pick.plane);
      if (!anchor) return;
      const base = translatedPivot(current.pick.pivot, current.pick.anchor, anchor).toArray() as Vec3;
      const length = pathDistance(base, current.basePoints.at(-1)!);
      if (length > 1e-10) { current.basePoints.push(base); current.distance += length; }
      // Fixed provisional depth gradient: destination subsets cannot introduce jumps.
      const depth = new THREE.Vector3(...base).sub(current.pick.pivot).dot(current.previewSlope);
      const position = new THREE.Vector3(...base).addScaledVector(current.pick.plane.normal, depth).toArray() as Vec3;
      current.last = [c.x, c.y];
      if (Math.hypot(...position.map((v, i) => v - current.points.at(-1)![i])) > 1e-8) current.points.push(position);
      const count = current.points.length;
      let attribute = trail.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!attribute || attribute.count < count) {
        attribute = new THREE.Float32BufferAttribute(new Float32Array(Math.max(256, count * 2) * 3), 3);
        trail.geometry.setAttribute('position', attribute);
        for (let i = 0; i < count; i++) attribute.setXYZ(i, ...current.points[i]);
      } else attribute.setXYZ(count - 1, ...position);
      attribute.needsUpdate = true; trail.geometry.setDrawRange(0, count); trail.visible = true;
      useStrokeDrawing.setState({ previewMotion: { objectId: useStrokeDrawing.getState().sourceId!, position } });
      markers.position.copy(new THREE.Vector3(...position).sub(current.pick.pivot));
      record(current, performance.now());
    };
    const recordingTick = () => { if (gesture?.recording) { record(gesture, performance.now()); tick = requestAnimationFrame(recordingTick); } };
    const beginGesture = (start: Press) => {
      const config = useStrokeDrawing.getState();
      selectPoints(start);
      if (!pick) return;
      if (!valid(config.sourceId) || !valid(config.destinationId)) { clear(); return; }
      const destination = rootFor(config.destinationId);
      if (!destination) { useStrokeDrawing.setState({ status: 'Wait for the destination object to load.' }); return; }
      const e = useEditor.getState(), c = cursor(start.clientX, start.clientY);
      if (Math.abs(c.width - pick.size.width) > 1 || Math.abs(c.height - pick.size.height) > 1) { clear(); useStrokeDrawing.setState({ status: 'The view changed: select the starting points again.' }); return; }
      e.setPlaying(false);
      const checkpoint: DrawnMotionCheckpoint = { project: e.project, currentFrame: e.currentFrame, recordingSession: e.recordingSession, recordingMotion: e.recordingMotion, selectedMotion: e.selectedMotion, past: e.past, future: e.future, dirty: e.dirty, isPlaying: false };
      const destinationPoints = projectMotionPoints(objectMotionPoints(destination), pick.camera, pick.size);
      const destinationPlane = fitViewPlane(destinationPoints.map(p => p.point), pick.plane.normal);
      const center = destinationPoints.reduce((sum, p) => [sum[0] + p.x, sum[1] + p.y], [0, 0]).map(v => v / Math.max(1, destinationPoints.length));
      const targetLine = circleViewLine(pick.camera, pick.size, center[0], center[1], pick.plane);
      const targetAnchor = targetLine && intersectViewLine(targetLine, pick.plane);
      const previewSlope = targetAnchor ? targetAnchor.sub(pick.anchor) : new THREE.Vector3();
      const lateralSquared = previewSlope.lengthSq();
      previewSlope.multiplyScalar(lateralSquared > 1e-12 && destinationPlane ? (pick.plane.constant - destinationPlane.constant) / lateralSquared : 0);
      gesture = { pick, pointerId: start.pointerId, destination: destinationPoints, basePoints: [pick.pivot.toArray() as Vec3], distance: 0, recorded: new Map(), previewSlope, points: [pick.pivot.toArray() as Vec3], last: [c.x, c.y], checkpoint, recording: Boolean(e.recordingSession), started: start.started, frame: e.currentFrame, project: e.project, duration: config.durationSeconds, destinationFrame: e.currentFrame };
      trail.geometry.deleteAttribute('position');
      canvas.setPointerCapture(start.pointerId);
      useStrokeDrawing.setState({ drawing: true, panelOpen: false, status: 'Drawing. Scroll to resize the circle. Release on the second object.' });
      sample(start, true); if (gesture.recording) tick = requestAnimationFrame(recordingTick);
    };
    const down = (event: PointerEvent) => {
      if (!enabled() || gesture || press || event.button !== 0) return;
      consume(event);
      press = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, hitId: hitObject(event), moved: false, started: performance.now() };
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!enabled()) return;
      cursor(event.clientX, event.clientY);
      if (press && event.pointerId === press.pointerId && (event.buttons & 1)) {
        consume(event);
        if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) < 3) return;
        press.moved = true;
        const config = useStrokeDrawing.getState();
        if (!config.sourceId || !config.destinationId) { useStrokeDrawing.setState({ status: 'Click the two objects first, then drag to draw.' }); return; }
        const start = press; press = undefined;
        beginGesture(start);
      }
      if (gesture && event.pointerId === gesture.pointerId && (event.buttons & 1)) { consume(event); sample(event); }
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (press && event.pointerId === press.pointerId) {
        consume(event); const pending = press; press = undefined;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (!pending.moved) chooseObject(pending.hitId);
        return;
      }
      const current = gesture;
      if (!current || event.pointerId !== current.pointerId) return;
      consume(event); const c = cursor(event.clientX, event.clientY);
      // Refresh the destination at release, including its currently rendered animation pose.
      current.destinationFrame = -Infinity;
      const plane = inside(event.clientX, event.clientY) && targetPlane(current, c.x, c.y);
      if (!plane) { stop('No destination points inside the circle: gesture not saved. Enlarge the circle and drag again.'); return; }
      sample(event, true);
      const path = shortestSurfaceMotion(current.basePoints, current.pick.plane.normal.toArray() as Vec3, current.pick.plane.constant - plane.constant);
      if (path.length < 2) { stop('The motion has no displacement. Drag again.'); return; }
      const sourceId = useStrokeDrawing.getState().sourceId!;
      gesture = undefined; cancelAnimationFrame(tick);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      applying = true;
      if (current.recording) {
        const object = useEditor.getState().project.objects.find(o => o.id === sourceId)!;
        const initial = object.keyframes.find(key => key.frame === current.pick.frame && key.property === 'position' && key.purpose === 'motion');
        const recorded = [...current.recorded].map(([id, sample]) => ({ id, progress: current.distance > 1e-10 ? sample.distance / current.distance : sample.elapsed / Math.max(1, performance.now() - current.started) }));
        if (initial && !current.recorded.has(initial.id)) recorded.unshift({ id: initial.id, progress: 0 });
        if (recorded.length) recorded.at(-1)!.progress = 1;
        useEditor.getState().remapRecordedDrawnMotion(sourceId, recordedSurfaceSamples(recorded, path));
        useEditor.getState().finishRecordingMovement();
      } else useEditor.getState().applyDrawnMotion(sourceId, path, current.duration, true);
      applying = false; markers.visible = false; trail.visible = false; pick = undefined;
      useStrokeDrawing.setState({ drawing: false, previewMotion: undefined, sourcePointCount: 0, status: current.recording ? 'Motion recorded. REC stays active: Stop REC ends the recording.' : 'Shortest curve saved. Press Play. Esc exits drawing so you can edit the path.' });
    };
    const wheel = (event: WheelEvent) => {
      if (!enabled() || !inside(event.clientX, event.clientY)) return;
      consume(event); if (!gesture) cursor(event.clientX, event.clientY);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      const c = useStrokeDrawing.getState();
      useStrokeDrawing.setState({ circleRadius: Math.max(4, Math.min(1200, c.circleRadius * Math.exp(-delta * .002))) });
    };
    const context = (event: MouseEvent) => { if (enabled() && inside(event.clientX, event.clientY)) consume(event); };
    const key = (event: KeyboardEvent) => {
      if (!enabled() || event.key !== 'Escape') return;
      consume(event);
      if (gesture || press) stop('Motion cancelled. Both objects remain selected.');
      else if (pick) { clear(); useStrokeDrawing.setState({ status: 'Point selection cancelled. Drag to try again.' }); }
      else useStrokeDrawing.setState({ active: false, panelOpen: false, cursor: undefined });
    };
    const interrupted = () => { if (gesture || press) stop('Motion cancelled: gesture interrupted.'); };
    const editorSubscription = useEditor.subscribe(e => {
      if (applying || !pick) return;
      const expected = gesture;
      if (e.project !== (expected?.project ?? pick.project) || e.currentFrame !== (expected?.frame ?? pick.frame) || e.cameraView !== pick.cameraView || (expected && Boolean(e.recordingSession) !== expected.recording)) {
        // External edits win over the gesture snapshot.
        stop('Scene or view changed: select the points again.', false); pick = undefined; useStrokeDrawing.setState({ sourcePointCount: 0 });
      } else if (e.isPlaying) e.setPlaying(false);
    });
    const drawingSubscription = useStrokeDrawing.subscribe((state, before) => {
      if (state.sourceId !== before.sourceId || state.destinationId !== before.destinationId || state.mode !== before.mode || !state.active && before.active) clear();
    });
    canvas.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: false }); window.addEventListener('contextmenu', context, true);
    window.addEventListener('keydown', key, true); window.addEventListener('blur', interrupted); window.addEventListener('pointercancel', interrupted, true);
    return () => {
      editorSubscription(); drawingSubscription(); clear();
      canvas.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      window.removeEventListener('wheel', wheel, true); window.removeEventListener('contextmenu', context, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', interrupted); window.removeEventListener('pointercancel', interrupted, true);
    };
  }, [gl, scene, camera, markers, trail]);
  return <><primitive object={markers} visible={false} frustumCulled={false} raycast={() => {}} userData={{ strokeSkip: true }} /><primitive object={trail} visible={false} frustumCulled={false} raycast={() => {}} userData={{ strokeSkip: true }} /><MotionPairOutline /></>;
}

function MotionPairOutline() {
  const { scene } = useThree();
  const config = useStrokeDrawing();
  const outlines = useMemo(() => [new THREE.BoxHelper(new THREE.Object3D(), '#efae45'), new THREE.BoxHelper(new THREE.Object3D(), '#42c9e8')], []);
  useEffect(() => () => { for (const outline of outlines) { outline.geometry.dispose(); (outline.material as THREE.Material).dispose(); } }, [outlines]);
  useFrame(() => {
    const ids = [config.sourceId, config.destinationId];
    for (let i = 0; i < outlines.length; i++) {
      const outline = outlines[i]; outline.visible = false;
      if (!config.active || config.mode !== 'motion' || !ids[i]) continue;
      let root: THREE.Object3D | undefined;
      scene.traverseVisible(object => { if (object.userData.sceneObjectId === ids[i]) root = object; });
      if (root) { root.updateWorldMatrix(true, true); outline.setFromObject(root); outline.visible = true; }
    }
  });
  return <>{outlines.map((outline, i) => <primitive key={i} object={outline} userData={{ strokeSkip: true }} raycast={() => {}} />)}</>;
}

export function CircleMotionCursor() {
  const c = useStrokeDrawing();
  if (!c.active || c.mode !== 'motion' || !c.sourceId || !c.destinationId || !c.cursor) return null;
  return <div className="motion-selection-circle" data-testid="motion-selection-circle" aria-label={`Selection circle, radius ${Math.round(c.circleRadius)} pixel`} style={{ left: c.cursor.x, top: c.cursor.y, width: c.circleRadius * 2, height: c.circleRadius * 2 }}><span>+</span></div>;
}
