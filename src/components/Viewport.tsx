import { Canvas, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera, Text, TransformControls } from '@react-three/drei';
import { Box, Focus, LayoutTemplate, Move3d, Plus, Rotate3d, Scaling, TextCursorInput, Video } from 'lucide-react';
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { normalizeWheelDelta, trackpadCameraOffset, TRACKPAD_PINCH_SENSITIVITY, TRACKPAD_ROTATE_SENSITIVITY } from '../domain/gestures';
import type { SceneObject, Transform } from '../domain/schema';
import { useEditor } from '../store/editor';

let viewportCanvas: HTMLCanvasElement | null = null;
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export async function captureContactSheet(frames: number[]): Promise<string | undefined> {
  if (!viewportCanvas) return undefined;
  const editor = useEditor.getState();
  const original = editor.currentFrame;
  const selected = [...new Set(frames)].slice(0, 6);
  const shots: Array<{ frame: number; url: string }> = [];
  for (const frame of selected) {
    useEditor.getState().setFrame(frame);
    await nextPaint();
    shots.push({ frame, url: viewportCanvas.toDataURL('image/jpeg', 0.72) });
  }
  useEditor.getState().setFrame(original);
  if (!shots.length) return undefined;
  const cellWidth = 480, cellHeight = 300, columns = Math.min(2, shots.length), rows = Math.ceil(shots.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * columns; canvas.height = cellHeight * rows;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#101319'; context.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.all(shots.map(async (shot, index) => {
    const image = new Image(); image.src = shot.url; await image.decode();
    const x = (index % columns) * cellWidth, y = Math.floor(index / columns) * cellHeight;
    context.drawImage(image, x, y, cellWidth, cellHeight);
    context.fillStyle = 'rgba(8,10,14,.82)'; context.fillRect(x + 12, y + 12, 86, 30);
    context.fillStyle = '#fff'; context.font = '600 15px sans-serif'; context.fillText(`Frame ${shot.frame}`, x + 22, y + 33);
  }));
  return canvas.toDataURL('image/jpeg', 0.78);
}

function ImageBackground({ source }: { source: string }) {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const previous = scene.background;
    let active = true;
    let loaded: THREE.Texture | undefined;
    new THREE.TextureLoader().load(source, (texture) => {
      if (!active) { texture.dispose(); return; }
      loaded = texture;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
    }, undefined, () => {
      if (active) scene.background = previous;
    });
    return () => {
      active = false;
      if (scene.background === loaded) scene.background = previous;
      loaded?.dispose();
    };
  }, [scene, source]);
  return null;
}

function ModelBackground({ source }: { source: string }) {
  const gltf = useLoader(GLTFLoader, source);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={model} />;
}

class BackgroundAssetBoundary extends Component<{ resetKey: string; children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children; }
}

function AssetPlaceholder() {
  return <mesh castShadow><boxGeometry args={[1.4, 1.4, 1.4]} /><meshStandardMaterial color="#9cabb8" wireframe /></mesh>;
}

function BlendAssetModel({ source, object }: { source: string; object: SceneObject }) {
  const gltf = useLoader(GLTFLoader, source);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    return clone;
  }, [gltf.scene]);
  const center = object.asset.boundsCenter;
  return <group scale={object.asset.previewScale}>
    <primitive object={model} position={[-center[0], -center[1], -center[2]]} />
  </group>;
}

function BlendAssetVisual({ object }: { object: SceneObject }) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let active = true;
    setSource(undefined);
    if (object.asset.proxyPath) window.abaco?.loadAsset(object.asset.proxyPath).then((value) => { if (active) setSource(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [object.asset.proxyPath]);
  if (!source) return <AssetPlaceholder />;
  return <BackgroundAssetBoundary resetKey={object.asset.proxyPath} fallback={<AssetPlaceholder />}>
    <Suspense fallback={<AssetPlaceholder />}><BlendAssetModel source={source} object={object} /></Suspense>
  </BackgroundAssetBoundary>;
}

function SceneBackground({ kind, path }: { kind: 'none' | 'image' | 'model'; path: string }) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let active = true;
    setSource(undefined);
    if (kind !== 'none' && path) window.abaco?.loadAsset(path).then((value) => { if (active) setSource(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [kind, path]);
  if (!source) return null;
  return <BackgroundAssetBoundary resetKey={`${kind}:${path}`}><Suspense fallback={null}>{kind === 'image' ? <ImageBackground source={source} /> : <ModelBackground source={source} />}</Suspense></BackgroundAssetBoundary>;
}

function MeshVisual({ object }: { object: SceneObject }) {
  const material = <meshStandardMaterial color={object.color} roughness={0.62} metalness={0.02} />;
  switch (object.kind) {
    case 'cube': return <mesh castShadow>{material}<boxGeometry args={[2, 2, 2]} /></mesh>;
    case 'sphere': return <mesh castShadow>{material}<sphereGeometry args={[1, 32, 18]} /></mesh>;
    case 'cylinder': return <mesh castShadow>{material}<cylinderGeometry args={[1, 1, 2, 32]} /></mesh>;
    case 'cone': return <mesh castShadow>{material}<coneGeometry args={[1, 2, 32]} /></mesh>;
    case 'plane': return <mesh receiveShadow>{material}<planeGeometry args={[2, 2]} /></mesh>;
    case 'text': return <Text color={object.color} fontSize={1} anchorX="center" anchorY="middle">{object.text}</Text>;
    case 'blend_asset': return <BlendAssetVisual object={object} />;
    case 'camera': return <group><mesh rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.45, 0.8, 4]} /><meshBasicMaterial color="#79d5ff" wireframe /></mesh><mesh position={[0, 0, .45]}><boxGeometry args={[.8, .5, .5]} /><meshBasicMaterial color="#79d5ff" wireframe /></mesh></group>;
    case 'area_light': return <mesh><circleGeometry args={[.7, 28]} /><meshBasicMaterial color={object.color} side={THREE.DoubleSide} /></mesh>;
    case 'point_light': return <mesh><sphereGeometry args={[.28, 16, 12]} /><meshBasicMaterial color={object.color} /></mesh>;
    case 'sun_light': return <group><mesh><sphereGeometry args={[.32, 16, 12]} /><meshBasicMaterial color={object.color} /></mesh><axesHelper args={[1.2]} /></group>;
  }
}

function SceneItem({ object, cameraView, onDragChange }: { object: SceneObject; cameraView: boolean; onDragChange(value: boolean): void }) {
  const ref = useRef<THREE.Group>(null);
  const directDrag = useRef<{
    pointerId: number; moved: boolean; x: number; y: number;
    position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3;
    right: THREE.Vector3; up: THREE.Vector3; worldPerPixel: number;
    windowFinish?: (event: PointerEvent) => void;
  } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const currentFrame = useEditor((state) => state.currentFrame);
  const selectedId = useEditor((state) => state.selectedId);
  const mode = useEditor((state) => state.gizmoMode);
  const select = useEditor((state) => state.select);
  const setTransform = useEditor((state) => state.setTransform);
  const setPlaying = useEditor((state) => state.setPlaying);
  const transform = evaluateTransform(object, currentFrame);
  const text = evaluateProperty(object, 'text', currentFrame) as string;
  const visible = evaluateProperty(object, 'visibility', currentFrame) as boolean;
  const helperOnly = object.kind === 'camera' || object.kind.includes('light');
  const shown = useMemo(() => ({ ...object, text }), [object, text]);

  const commit = () => {
    if (!ref.current) return;
    const result: Transform = {
      position: ref.current.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
      rotation: [ref.current.rotation.x, ref.current.rotation.y, ref.current.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'],
      scale: ref.current.scale.toArray().map((value) => Math.max(0.001, Number(value.toFixed(4)))) as Transform['scale'],
    };
    setTransform(object.id, result);
  };

  const setCursor = (event: { nativeEvent: PointerEvent }, cursor: string) => {
    const target = event.nativeEvent.target;
    if (target instanceof HTMLElement) target.style.cursor = cursor;
  };
  const finishDrag = () => {
    const drag = directDrag.current;
    if (!drag) return;
    if (drag.windowFinish) window.removeEventListener('pointerup', drag.windowFinish);
    if (drag.moved) commit();
    directDrag.current = undefined;
    setDragging(false);
    onDragChange(false);
  };
  const startDirectDrag = (event: ThreeEvent<PointerEvent>) => {
    // Shift riserva sempre il gesto alla vista, anche sopra un oggetto.
    // I gesti touch vengono lasciati a OrbitControls, che riconosce le due dita.
    if (event.button !== 0 || event.nativeEvent.shiftKey || event.nativeEvent.pointerType === 'touch' || !ref.current) return;
    event.stopPropagation(); select(object.id); setPlaying(false);
    event.camera.updateMatrixWorld();
    const forward = event.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 1).normalize();
    const depth = Math.max(.5, Math.abs(ref.current.position.clone().sub(event.camera.position).dot(forward)));
    const canvasHeight = Math.max(1, (event.nativeEvent.target as HTMLElement | null)?.getBoundingClientRect?.().height ?? 600);
    const worldPerPixel = event.camera instanceof THREE.PerspectiveCamera
      ? (2 * depth * Math.tan(THREE.MathUtils.degToRad(event.camera.fov / 2))) / canvasHeight
      : 2 / canvasHeight;
    const dragState = {
      pointerId: event.pointerId, moved: false,
      x: event.nativeEvent.clientX, y: event.nativeEvent.clientY,
      position: ref.current.position.clone(), rotation: ref.current.rotation.clone(), scale: ref.current.scale.clone(),
      right, up, worldPerPixel,
    };
    const windowFinish = (pointer: PointerEvent) => { if (pointer.pointerId === dragState.pointerId) finishDrag(); };
    directDrag.current = { ...dragState, windowFinish };
    window.addEventListener('pointerup', windowFinish, { once: true });
    const pointerTarget = event.nativeEvent.target;
    if (pointerTarget instanceof Element) pointerTarget.setPointerCapture?.(event.pointerId);
    setDragging(true); onDragChange(true); setCursor(event, 'grabbing');
  };
  const moveDirectDrag = (event: ThreeEvent<PointerEvent>) => {
    const drag = directDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || !ref.current) return;
    event.stopPropagation();
    const dx = event.nativeEvent.clientX - drag.x;
    const dy = event.nativeEvent.clientY - drag.y;
    if (Math.hypot(dx, dy) < 2) return;
    if (mode === 'translate') {
      ref.current.position.copy(drag.position)
        .addScaledVector(drag.right, dx * drag.worldPerPixel)
        .addScaledVector(drag.up, -dy * drag.worldPerPixel);
    } else if (mode === 'rotate') {
      ref.current.rotation.set(drag.rotation.x + dy * 0.003, drag.rotation.y, drag.rotation.z + dx * 0.003);
    } else if (mode === 'scale') {
      const factor = THREE.MathUtils.clamp(Math.exp((dx - dy) * 0.003), .1, 10);
      ref.current.scale.set(
        THREE.MathUtils.clamp(drag.scale.x * factor, .05, 20),
        THREE.MathUtils.clamp(drag.scale.y * factor, .05, 20),
        THREE.MathUtils.clamp(drag.scale.z * factor, .05, 20),
      );
    }
    drag.moved = true;
  };
  const finishDirectDrag = (event: ThreeEvent<PointerEvent>) => {
    const drag = directDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const pointerTarget = event.nativeEvent.target;
    if (pointerTarget instanceof Element && pointerTarget.hasPointerCapture?.(event.pointerId)) pointerTarget.releasePointerCapture(event.pointerId);
    finishDrag(); setCursor(event, 'grab');
  };

  useEffect(() => () => {
    const listener = directDrag.current?.windowFinish;
    if (listener) window.removeEventListener('pointerup', listener);
  }, []);

  const visual = <group ref={ref} position={transform.position} rotation={transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={transform.scale} visible={visible && (!helperOnly || (selectedId === object.id && !cameraView))}
      onPointerOver={(event) => { event.stopPropagation(); setCursor(event, 'grab'); }} onPointerOut={(event) => { if (!dragging) setCursor(event, 'default'); }}
      onPointerDown={startDirectDrag} onPointerMove={moveDirectDrag} onPointerUp={finishDirectDrag} onPointerCancel={finishDirectDrag}>
      <MeshVisual object={shown} />
    </group>;

  if (selectedId !== object.id || !visible || helperOnly) return visual;
  return <>{visual}<TransformControls object={ref as unknown as RefObject<THREE.Object3D>} mode={mode} space={mode === 'rotate' ? 'local' : 'world'} size={0.62} enabled
    onMouseDown={() => { setPlaying(false); setDragging(true); onDragChange(true); }}
    onMouseUp={() => { commit(); setDragging(false); onDragChange(false); }} /></>;
}

function CameraViewControls({ frame, syncKey, target, disabled, controls, onCommit }: {
  frame: number; syncKey: string; disabled: boolean;
  target: Transform['position'];
  controls: React.RefObject<OrbitControlsImpl | null>;
  onCommit(position: Transform['position'], rotation: Transform['rotation'], target: Transform['position']): void;
}) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!controls.current) return;
    camera.up.set(0, 0, 1);
    controls.current.target.set(...target);
    controls.current.update();
  }, [camera, frame, syncKey, target]);

  return <OrbitControls ref={controls} makeDefault enabled={!disabled} enableDamping={false} enableZoom={false} screenSpacePanning rotateSpeed={.22} panSpeed={.24}
    mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    onEnd={() => onCommit(
      camera.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
      [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'],
      controls.current!.target.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
    )} />;
}

function ShotCamera({ object, aspect }: { object: SceneObject; aspect: number }) {
  const frame = useEditor((state) => state.currentFrame);
  const transform = evaluateTransform(object, frame);
  const lens = evaluateProperty(object, 'lens', frame) as number;
  const sensorHeight = 36 / aspect;
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(sensorHeight / (2 * lens)));
  return <PerspectiveCamera makeDefault position={transform.position} rotation={transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} up={[0, 0, 1]} fov={fov} near={0.01} far={1000} />;
}

function ThumbnailEmitter({ projectId, sceneId, revision }: { projectId: string; sceneId: string; revision: string }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    invalidate();
    const timer = window.setTimeout(() => {
      const url = gl.domElement.toDataURL('image/jpeg', .72);
      window.dispatchEvent(new CustomEvent('abaco:scene-thumbnail', { detail: { projectId, sceneId, url } }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [gl, invalidate, projectId, revision, sceneId]);
  return null;
}

function ThumbnailItem({ object, frame }: { object: SceneObject; frame: number }) {
  const transform = evaluateTransform(object, frame);
  const shown = { ...object, text: evaluateProperty(object, 'text', frame) as string };
  if (!evaluateProperty(object, 'visibility', frame)) return null;
  return <group position={transform.position} rotation={transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={transform.scale}><MeshVisual object={shown} /></group>;
}

export default function Viewport({ dark = false }: { dark?: boolean }) {
  const projectId = useEditor((state) => state.project.id);
  const objects = useEditor((state) => state.project.objects);
  const cuts = useEditor((state) => state.project.cameraCuts);
  const settings = useEditor((state) => state.project.settings);
  const frame = useEditor((state) => state.currentFrame);
  const select = useEditor((state) => state.select);
  const addObject = useEditor((state) => state.addObject);
  const selectedId = useEditor((state) => state.selectedId);
  const gizmoMode = useEditor((state) => state.gizmoMode);
  const setGizmoMode = useEditor((state) => state.setGizmoMode);
  const [cameraView, setCameraView] = useState(false);
  const [draggingObject, setDraggingObject] = useState(false);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const shotOrbitRef = useRef<OrbitControlsImpl | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraPanBuffer = useRef<{ x: number; y: number; timer?: number }>({ x: 0, y: 0 });
  const cameraRotateBuffer = useRef<{ x: number; y: number; timer?: number }>({ x: 0, y: 0 });
  const cameraCommitTimer = useRef<number | undefined>(undefined);
  const shiftPressed = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const hasContent = objects.some((object) => object.kind !== 'camera' && !object.kind.includes('light'));
  const activeCut = cuts.slice().sort((a, b) => b.frame - a.frame).find((cut) => cut.frame <= frame);
  const activeCamera = objects.find((object) => object.id === activeCut?.cameraId && object.kind === 'camera');
  const selectedObject = objects.find((object) => object.id === selectedId);
  const selectedSubject = selectedObject && selectedObject.kind !== 'camera' && !selectedObject.kind.includes('light') && evaluateProperty(selectedObject, 'visibility', frame)
    ? selectedObject : undefined;
  const framingSubject = selectedSubject ?? objects.find((object) => object.kind !== 'camera' && !object.kind.includes('light') && evaluateProperty(object, 'visibility', frame));
  const lighting = activeCut?.lighting ?? { preset: 'neutral' as const, intensity: 1, direction: 45, elevation: 45, color: '#ffffff' };
  const lightingStyle = {
    neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 },
    warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 },
  }[lighting.preset];
  const lightAngle = THREE.MathUtils.degToRad(lighting.direction);
  const lightElevation = THREE.MathUtils.degToRad(lighting.elevation);
  const lightRadius = Math.cos(lightElevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(lightAngle) * lightRadius, -Math.cos(lightAngle) * lightRadius, 1.5 + Math.sin(lightElevation) * 9];
  const aspect = settings.resolutionX / settings.resolutionY;
  const actionName = gizmoMode === 'translate' ? 'sposta' : gizmoMode === 'rotate' ? 'ruota' : 'ridimensiona';
  const cameraStageStyle = useMemo(() => {
    if (!cameraView || !viewportSize.width || !viewportSize.height) return cameraView ? { aspectRatio: `${settings.resolutionX} / ${settings.resolutionY}` } : undefined;
    const availableWidth = Math.max(1, viewportSize.width - 24);
    const availableHeight = Math.max(1, viewportSize.height - 24);
    const width = Math.min(availableWidth, availableHeight * aspect);
    return { width, height: width / aspect, aspectRatio: `${settings.resolutionX} / ${settings.resolutionY}` };
  }, [aspect, cameraView, settings.resolutionX, settings.resolutionY, viewportSize]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (cameraPanBuffer.current.timer) window.clearTimeout(cameraPanBuffer.current.timer);
    if (cameraRotateBuffer.current.timer) window.clearTimeout(cameraRotateBuffer.current.timer);
    if (cameraCommitTimer.current) window.clearTimeout(cameraCommitTimer.current);
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Shift' || event.shiftKey) shiftPressed.current = true; };
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Shift') shiftPressed.current = false; };
    const clear = () => { shiftPressed.current = false; };
    document.addEventListener('keydown', keyDown, true); document.addEventListener('keyup', keyUp, true); window.addEventListener('blur', clear);
    const removeDesktopListener = window.abaco?.onShiftChange((pressed) => { shiftPressed.current = pressed; });
    return () => { document.removeEventListener('keydown', keyDown, true); document.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', clear); removeDesktopListener?.(); };
  }, []);

  const centerFramingOnSubject = () => {
    if (!activeCamera || !activeCut || !framingSubject) return;
    const cameraTransform = evaluateTransform(activeCamera, frame);
    const subjectTransform = evaluateTransform(framingSubject, frame);
    const cameraPosition = new THREE.Vector3(...cameraTransform.position);
    const subjectPosition = new THREE.Vector3(...subjectTransform.position);
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.copy(cameraPosition);
    camera.lookAt(subjectPosition);
    const rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'];
    useEditor.getState().setCameraFraming(activeCut.id, cameraTransform.position, rotation, subjectTransform.position);
  };

  const scheduleCameraCommit = () => {
    const controls = shotOrbitRef.current;
    if (!controls || !activeCamera || !activeCut) return;
    const camera = controls.object;
    const sceneId = activeCut.id;
    const position = camera.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'];
    const rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'];
    const target = controls.target.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'];
    if (cameraCommitTimer.current) window.clearTimeout(cameraCommitTimer.current);
    cameraCommitTimer.current = window.setTimeout(() => {
      useEditor.getState().setCameraFraming(sceneId, position, rotation, target);
      cameraCommitTimer.current = undefined;
    }, 180);
  };

  const panShotView = (deltaX: number, deltaY: number) => {
    const controls = shotOrbitRef.current;
    if (!activeCamera || !controls) return;
    const camera = controls.object;
    camera.updateMatrixWorld();
    const distance = Math.max(.5, camera.position.distanceTo(controls.target));
    const fov = camera instanceof THREE.PerspectiveCamera ? THREE.MathUtils.degToRad(camera.fov) : THREE.MathUtils.degToRad(45);
    const worldPerPixel = (2 * distance * Math.tan(fov / 2)) / Math.max(1, stageRef.current?.clientHeight ?? 600);
    const gesture = trackpadCameraOffset(deltaX, deltaY);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(gesture.horizontal * worldPerPixel);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(gesture.vertical * worldPerPixel);
    camera.position.add(right).add(up); controls.target.add(right).add(up); controls.update();
    scheduleCameraCommit();
  };

  const rotateViewFromTrackpad = (deltaX: number, deltaY: number) => {
    const controls = cameraView ? shotOrbitRef.current : orbitRef.current;
    if (!controls) return;
    controls.setAzimuthalAngle(controls.getAzimuthalAngle() - deltaX * TRACKPAD_ROTATE_SENSITIVITY);
    controls.setPolarAngle(THREE.MathUtils.clamp(controls.getPolarAngle() - deltaY * TRACKPAD_ROTATE_SENSITIVITY, .05, Math.PI - .05));
    controls.update();
    if (!cameraView || !activeCamera) return;
    const camera = controls.object;
    scheduleCameraCommit();
  };

  const panViewFromTrackpad = (event: ReactWheelEvent<HTMLDivElement>) => {
    const delta = normalizeWheelDelta(event.deltaX, event.deltaY, event.deltaMode, event.currentTarget.clientHeight);
    // Chromium espone il pinch del trackpad come Ctrl + wheel: lo gestiamo qui
    // per evitare lo zoom dell'intera interfaccia.
    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      const factor = Math.exp(delta.y * TRACKPAD_PINCH_SENSITIVITY);
      if (cameraView && activeCamera) {
        const controls = shotOrbitRef.current;
        if (!controls) return;
        const camera = controls.object;
        const offset = camera.position.clone().sub(controls.target);
        if (offset.lengthSq() < .0001) offset.set(0, -1, .25);
        const distance = THREE.MathUtils.clamp(offset.length() * factor, .5, 100);
        camera.position.copy(controls.target).add(offset.setLength(distance));
        camera.lookAt(controls.target);
        controls.update();
        scheduleCameraCommit();
      } else if (orbitRef.current) {
        const controls = orbitRef.current;
        const offset = controls.object.position.clone().sub(controls.target);
        const distance = Math.max(0.2, Math.min(500, offset.length() * factor));
        controls.object.position.copy(controls.target).add(offset.setLength(distance));
        controls.update();
      }
      return;
    }
    // Su Linux Chromium può perdere shiftKey durante gli eventi wheel: oltre al
    // flag dell'evento manteniamo lo stato reale della tastiera.
    if (!event.shiftKey && !shiftPressed.current) {
      event.preventDefault(); event.stopPropagation();
      if (cameraView) {
        const buffer = cameraRotateBuffer.current;
        buffer.x += delta.x; buffer.y += delta.y;
        if (!buffer.timer) buffer.timer = window.setTimeout(() => {
          const pending = cameraRotateBuffer.current;
          const x = pending.x, y = pending.y;
          pending.x = 0; pending.y = 0; pending.timer = undefined;
          rotateViewFromTrackpad(x, y);
        }, 24);
      } else rotateViewFromTrackpad(delta.x, delta.y);
      return;
    }
    // Shift + due dita trasla la vista su entrambi gli assi, anche sopra oggetti.
    event.preventDefault();
    event.stopPropagation();
    if (cameraView) {
      const buffer = cameraPanBuffer.current;
      buffer.x += delta.x;
      buffer.y += delta.y;
      if (!buffer.timer) buffer.timer = window.setTimeout(() => {
        const pending = cameraPanBuffer.current;
        const x = pending.x, y = pending.y;
        pending.x = 0; pending.y = 0; pending.timer = undefined;
        panShotView(x, y);
      }, 32);
      return;
    }
    if (!orbitRef.current) return;
    const controls = orbitRef.current;
    const camera = controls.object;
    camera.updateMatrixWorld();
    const height = Math.max(1, event.currentTarget.clientHeight);
    const distance = camera.position.distanceTo(controls.target);
    const worldPerPixel = camera instanceof THREE.PerspectiveCamera
      ? (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height
      : 0.01;
    const gesture = trackpadCameraOffset(delta.x, delta.y);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(gesture.horizontal * worldPerPixel);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(gesture.vertical * worldPerPixel);
    camera.position.add(right).add(up);
    controls.target.add(right).add(up);
    controls.update();
  };

  return <div ref={viewportRef} className={`viewport ${cameraView ? 'camera-mode' : ''}`} data-testid="viewport">
    <div ref={stageRef} className="canvas-stage" onWheelCapture={panViewFromTrackpad}
      style={cameraStageStyle}>
    <Canvas shadows gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ position: [8, -10, 7], fov: 45, near: .01, far: 1000 }}
      onCreated={({ gl, camera }) => { viewportCanvas = gl.domElement; camera.up.set(0, 0, 1); }} onPointerMissed={() => select(undefined)}>
      <color attach="background" args={[dark ? '#242624' : '#f1f1ef']} />
      <SceneBackground kind={activeCut?.background?.kind ?? 'none'} path={activeCut?.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, lighting.intensity)} />
      <directionalLight color={lighting.color} position={lightPosition} intensity={lightingStyle.key * lighting.intensity} castShadow />
      {!cameraView && <Grid name="abaco-free-grid" args={[40, 40]} rotation={[Math.PI / 2, 0, 0]} cellSize={1} cellThickness={0.55} cellColor={dark ? '#3a3d3a' : '#d7d7d3'} sectionSize={5} sectionThickness={0.9} sectionColor={dark ? '#555955' : '#bdbdb7'} fadeDistance={45} infiniteGrid />}
      {objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <SceneItem key={object.id} object={object} cameraView={cameraView} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value && !cameraView; }} />)}
      {cameraView && activeCamera && <ShotCamera object={activeCamera} aspect={aspect} />}
      {cameraView && activeCamera && activeCut && <CameraViewControls controls={shotOrbitRef} frame={frame} target={activeCut.framing.target} syncKey={`${activeCut.id}:${JSON.stringify(activeCut.framing)}:${JSON.stringify(evaluateTransform(activeCamera, frame))}`} disabled={draggingObject} onCommit={(position, rotation, target) => useEditor.getState().setCameraFraming(activeCut.id, position, rotation, target)} />}
      {!cameraView && <OrbitControls ref={orbitRef} makeDefault enableDamping enabled={!draggingObject} target={[0, 0, 1]} />}
    </Canvas>
    </div>
    {activeCamera && activeCut && <div className="thumbnail-renderer" aria-hidden="true"><Canvas frameloop="demand" dpr={1} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <color attach="background" args={[dark ? '#242624' : '#f1f1ef']} />
      <SceneBackground kind={activeCut.background?.kind ?? 'none'} path={activeCut.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, lighting.intensity)} />
      <directionalLight color={lighting.color} position={lightPosition} intensity={lightingStyle.key * lighting.intensity} />
      {objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <ThumbnailItem key={object.id} object={object} frame={frame} />)}
      <ShotCamera object={activeCamera} aspect={aspect} />
      <ThumbnailEmitter projectId={projectId} sceneId={activeCut.id} revision={`${frame}:${JSON.stringify(activeCut.framing)}:${objects.map((object) => `${object.id}:${JSON.stringify(evaluateTransform(object, frame))}:${evaluateProperty(object, 'visibility', frame)}`).join('|')}`} />
    </Canvas></div>}
    <button className={`view-toggle ${cameraView ? 'active' : ''}`} title={cameraView ? 'Vista libera' : 'Vista camera'} aria-label={cameraView ? 'Vista libera' : 'Vista camera'} onClick={() => setCameraView((value) => !value)}>{cameraView ? <LayoutTemplate size={16} /> : <Video size={16} />}</button>
    <div className="viewport-top-right">
      {selectedSubject && <div className="viewport-tools" aria-label="Strumento trasformazione">{([
        ['translate', 'Sposta', Move3d],
        ['rotate', 'Ruota', Rotate3d],
        ['scale', 'Scala', Scaling],
      ] as const).map(([mode, label, Icon]) => <button key={mode} title={label} aria-label={label} className={gizmoMode === mode ? 'active' : ''} onClick={() => setGizmoMode(mode)}><Icon size={15} /></button>)}</div>}
    </div>
    {!hasContent && !cameraView && <div className="start-card">
      <div className="start-icon"><Box size={26} /></div>
      <strong>Crea la prima scena</strong>
      <p>Aggiungi una forma o un testo. Poi trascinalo direttamente nello spazio.</p>
      <div><button className="primary" onClick={() => addObject('cube')}><Plus size={16} /> Forma</button><button className="secondary" onClick={() => addObject('text')}><TextCursorInput size={16} /> Testo</button></div>
    </div>}
    {cameraView && activeCamera && framingSubject && <div className="viewport-bottom-left"><button className="center-shot center-subject" aria-label="Centra soggetto" title={`Ricentra l’inquadratura su ${framingSubject.name}`} onClick={centerFramingOnSubject}><Focus size={15} /></button></div>}
    <div className="viewport-help">Oggetto: {actionName} · Trascina sfondo: inquadratura · Shift + 2 dita: sposta · Pinch: zoom</div>
  </div>;
}
