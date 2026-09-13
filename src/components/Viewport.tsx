import { Canvas, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls, PerspectiveCamera, Text, TransformControls } from '@react-three/drei';
import { Box, Focus, LayoutTemplate, Move3d, Plus, Rotate3d, Scaling, TextCursorInput, Video } from 'lucide-react';
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { fromCameraSpace, toCameraSpace } from '../domain/camera-space';
import { normalizeWheelDelta, trackpadCameraOffset, TRACKPAD_PINCH_SENSITIVITY, TRACKPAD_ROTATE_SENSITIVITY } from '../domain/gestures';
import type { CameraCut, Keyframe, SceneObject, Transform, Vec3 } from '../domain/schema';
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
  return <mesh castShadow><boxGeometry args={[1.4, 1.4, 1.4]} /><meshStandardMaterial color="#7e8c94" wireframe /></mesh>;
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
  // L'exporter glTF converte le coordinate Blender (x, y, z) in (x, z, -y).
  // Convertiamo allo stesso modo il centro; la rotazione del gruppo rimette
  // dritte e frontali le tavole 2D create sul piano XY in Blender.
  const [centerX, centerY, centerZ] = object.asset.boundsCenter;
  const center: Vec3 = [centerX, centerZ, -centerY];
  return <group scale={object.asset.previewScale}>
    <group rotation={[Math.PI, 0, 0]}>
      <primitive object={model} position={[-center[0], -center[1], -center[2]]} />
    </group>
  </group>;
}

function BlendAssetVisual({ object }: { object: SceneObject }) {
  const [source, setSource] = useState<string>();
  const updateObject = useEditor((state) => state.updateObject);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    const load = async () => {
      if (!object.asset.proxyPath || !window.abaco) return;
      const metadata = object.asset.sourcePath
        ? await window.abaco.ensureBlendAssetProxy({ sourcePath: object.asset.sourcePath, proxyPath: object.asset.proxyPath })
        : undefined;
      if (metadata && (metadata.previewScale !== object.asset.previewScale || metadata.boundsCenter.some((value, index) => value !== object.asset.boundsCenter[index]))) {
        updateObject(object.id, { asset: { ...object.asset, ...metadata } });
      }
      const value = await window.abaco.loadAsset(object.asset.proxyPath);
      if (active) setSource(value);
    };
    load().catch(() => undefined);
    return () => { active = false; };
  }, [object.asset.proxyPath, object.asset.sourcePath]);
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

function CameraVisual({ object }: { object: SceneObject }) {
  const settings = useEditor((state) => state.project.settings);
  const frame = useEditor((state) => state.currentFrame);
  const aspect = settings.resolutionX / settings.resolutionY;
  const depth = 3.2;
  const sensorHeight = 36 / aspect;
  const fov = 2 * Math.atan(sensorHeight / (2 * (evaluateProperty(object, 'lens', frame) as number)));
  const halfHeight = Math.tan(fov / 2) * depth;
  const halfWidth = halfHeight * aspect;
  const origin: [number, number, number] = [0, 0, -0.18];
  const corners: Array<[number, number, number]> = [
    [-halfWidth, -halfHeight, -depth], [halfWidth, -halfHeight, -depth],
    [halfWidth, halfHeight, -depth], [-halfWidth, halfHeight, -depth],
  ];
  return <group>
    <mesh position={[0, 0, .35]}><boxGeometry args={[.82, .55, .48]} /><meshStandardMaterial color="#858077" roughness={.42} /></mesh>
    <mesh position={[0, 0, .03]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.2, .29, .38, 24]} /><meshStandardMaterial color="#3c3c39" roughness={.3} /></mesh>
    <mesh position={[0, .36, .46]}><boxGeometry args={[.34, .18, .22]} /><meshStandardMaterial color="#858077" /></mesh>
    {corners.map((corner, index) => <Line key={index} points={[origin, corner]} color="#d9ad32" lineWidth={1.25} depthTest={false} transparent opacity={.82} />)}
    <Line points={[...corners, corners[0]]} color="#d9ad32" lineWidth={1.5} depthTest={false} transparent opacity={.88} />
    <Line points={[origin, [0, 0, -depth - .6]]} color="#b55d55" lineWidth={1.4} depthTest={false} transparent opacity={.82} />
    <mesh position={[0, 0, -depth]}><planeGeometry args={[halfWidth * 2, halfHeight * 2]} /><meshBasicMaterial color="#d9ad32" transparent opacity={.045} side={THREE.DoubleSide} depthWrite={false} /></mesh>
  </group>;
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
    case 'camera': return <CameraVisual object={object} />;
    case 'area_light': return <mesh><circleGeometry args={[.7, 28]} /><meshBasicMaterial color={object.color} side={THREE.DoubleSide} /></mesh>;
    case 'point_light': return <mesh><sphereGeometry args={[.28, 16, 12]} /><meshBasicMaterial color={object.color} /></mesh>;
    case 'sun_light': return <group><mesh><sphereGeometry args={[.32, 16, 12]} /><meshBasicMaterial color={object.color} /></mesh><axesHelper args={[1.2]} /></group>;
  }
}

function SceneItem({ object, cameraView, interactionEnabled = true, onDragChange }: { object: SceneObject; cameraView: boolean; interactionEnabled?: boolean; onDragChange(value: boolean): void }) {
  const ref = useRef<THREE.Group>(null);
  const translationProxy = useRef<THREE.Group>(null);
  const viewCamera = useThree((state) => state.camera);
  const directDrag = useRef<{
    pointerId: number; moved: boolean; x: number; y: number;
    position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3;
    right: THREE.Vector3; up: THREE.Vector3; worldPerPixel: number;
    cleanup?: () => void;
  } | undefined>(undefined);
  const gizmoDragging = useRef(false);
  const gizmoCleanup = useRef<(() => void) | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const currentFrame = useEditor((state) => state.currentFrame);
  const selectedId = useEditor((state) => state.selectedId);
  const selectedMotion = useEditor((state) => state.selectedMotion);
  const mode = useEditor((state) => state.gizmoMode);
  const select = useEditor((state) => state.select);
  const setTransform = useEditor((state) => state.setTransform);
  const setPlaying = useEditor((state) => state.setPlaying);
  const transform = evaluateTransform(object, currentFrame);
  const text = evaluateProperty(object, 'text', currentFrame) as string;
  const visible = object.kind === 'camera' || evaluateProperty(object, 'visibility', currentFrame) as boolean;
  const helperOnly = object.kind === 'camera' || object.kind.includes('light');
  const helperSelected = selectedId === object.id || selectedMotion?.objectId === object.id;
  const shown = useMemo(() => ({ ...object, text }), [object, text]);
  const viewTranslation = cameraView && mode === 'translate';
  useLayoutEffect(() => {
    if (!viewTranslation || !translationProxy.current || gizmoDragging.current) return;
    translationProxy.current.position.set(...transform.position);
    translationProxy.current.quaternion.copy(viewCamera.quaternion);
    translationProxy.current.updateMatrixWorld();
  });

  const snapToOtherObjects = (position: THREE.Vector3) => {
    const state = useEditor.getState();
    const others = state.project.objects.filter((item) => item.id !== object.id && item.kind !== 'camera' && !item.kind.includes('light') && evaluateProperty(item, 'visibility', state.currentFrame));
    if (!others.length) return position;
    const threshold = .22;
    if (cameraView) {
      const cameraPose: Transform = {
        position: viewCamera.position.toArray() as Vec3,
        rotation: [viewCamera.rotation.x, viewCamera.rotation.y, viewCamera.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3,
        scale: [1, 1, 1],
      };
      const local = toCameraSpace(position.toArray() as Vec3, cameraPose);
      for (const axis of [0, 2] as const) {
        let nearest = local[axis], nearestDistance = threshold;
        for (const item of others) {
          const value = toCameraSpace(evaluateTransform(item, state.currentFrame).position, cameraPose)[axis];
          const distance = Math.abs(local[axis] - value);
          if (distance < nearestDistance) { nearest = value; nearestDistance = distance; }
        }
        local[axis] = nearest;
      }
      return new THREE.Vector3(...fromCameraSpace(local, cameraPose));
    }
    const snapped = position.clone();
    for (const axis of [0, 1, 2] as const) {
      let nearest = snapped.getComponent(axis), nearestDistance = threshold;
      for (const item of others) {
        const value = evaluateTransform(item, state.currentFrame).position[axis];
        const distance = Math.abs(snapped.getComponent(axis) - value);
        if (distance < nearestDistance) { nearest = value; nearestDistance = distance; }
      }
      snapped.setComponent(axis, nearest);
    }
    return snapped;
  };

  const commit = () => {
    if (!ref.current) return;
    if (mode === 'translate') ref.current.position.copy(snapToOtherObjects(ref.current.position));
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
    drag.cleanup?.();
    if (drag.moved) commit();
    directDrag.current = undefined;
    setDragging(false);
    onDragChange(false);
  };
  const startDirectDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!interactionEnabled) return;
    // Shift riserva sempre il gesto alla vista, anche sopra un oggetto.
    // I gesti touch vengono lasciati a OrbitControls, che riconosce le due dita.
    if (event.button !== 0 || event.nativeEvent.shiftKey || event.nativeEvent.pointerType === 'touch' || !ref.current || gizmoDragging.current) return;
    // Se il gizmo e l'oggetto sono sovrapposti, soltanto l'intersezione piu'
    // vicina deve gestire il gesto. In caso contrario i due controlli scrivono
    // contemporaneamente la stessa trasformazione e la rotazione sembra fermarsi.
    const nearest = event.intersections[0]?.object;
    if (nearest && nearest !== ref.current && !ref.current.getObjectById(nearest.id)) return;
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
    const windowCancel = (pointer: PointerEvent) => { if (pointer.pointerId === dragState.pointerId) finishDrag(); };
    const windowBlur = () => finishDrag();
    const cleanup = () => {
      window.removeEventListener('pointerup', windowFinish);
      window.removeEventListener('pointercancel', windowCancel);
      window.removeEventListener('blur', windowBlur);
    };
    directDrag.current = { ...dragState, cleanup };
    window.addEventListener('pointerup', windowFinish);
    window.addEventListener('pointercancel', windowCancel);
    window.addEventListener('blur', windowBlur);
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
      ref.current.position.copy(snapToOtherObjects(ref.current.position));
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

  const finishGizmoDrag = () => {
    if (!gizmoDragging.current) return;
    gizmoDragging.current = false;
    gizmoCleanup.current?.();
    gizmoCleanup.current = undefined;
    commit();
    setDragging(false);
    onDragChange(false);
  };
  const startGizmoDrag = () => {
    if (gizmoDragging.current) return;
    setPlaying(false);
    gizmoDragging.current = true;
    setDragging(true);
    onDragChange(true);
    const finish = () => finishGizmoDrag();
    const cleanup = () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
    };
    gizmoCleanup.current = cleanup;
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };

  useEffect(() => () => {
    directDrag.current?.cleanup?.();
    gizmoCleanup.current?.();
  }, []);

  const visual = <group ref={ref} position={transform.position} rotation={transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={transform.scale} visible={visible && (!helperOnly || (object.kind === 'camera' && !cameraView) || (helperSelected && !cameraView))}
      onPointerOver={(event) => { if (!interactionEnabled) return; event.stopPropagation(); setCursor(event, 'grab'); }} onPointerOut={(event) => { if (interactionEnabled && !dragging) setCursor(event, 'default'); }}
      onClick={(event) => { if (cameraView && !interactionEnabled) { event.stopPropagation(); select(object.id); } }}
      onPointerDown={startDirectDrag} onPointerMove={moveDirectDrag} onPointerUp={finishDirectDrag} onPointerCancel={finishDirectDrag}>
      <MeshVisual object={shown} />
    </group>;

  if (!interactionEnabled || selectedId !== object.id || !visible || (cameraView && helperOnly) || (helperOnly && object.kind !== 'camera')) return visual;
  return <>{visual}<group ref={translationProxy} /><TransformControls object={(viewTranslation ? translationProxy : ref) as unknown as RefObject<THREE.Object3D>} mode={mode} space={viewTranslation || mode === 'rotate' ? 'local' : 'world'} size={0.8} enabled
    showZ={!viewTranslation}
    onObjectChange={() => {
      if (mode !== 'translate' || !ref.current) return;
      if (viewTranslation && translationProxy.current) ref.current.position.copy(translationProxy.current.position);
      ref.current.position.copy(snapToOtherObjects(ref.current.position));
      if (viewTranslation && translationProxy.current) translationProxy.current.position.copy(ref.current.position);
    }}
    onMouseDown={startGizmoDrag}
    onMouseUp={finishGizmoDrag} /></>;
}

function CameraViewControls({ frame, syncKey, target, controls }: {
  frame: number; syncKey: string;
  target: Transform['position'];
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!controls.current) return;
    camera.up.set(0, 0, 1);
    controls.current.target.set(...target);
    controls.current.update();
  }, [camera, frame, syncKey]);

  // The camera is driven by trackpad and keyboard so pointer events remain free
  // for selecting and transforming objects directly in camera view.
  return <OrbitControls ref={controls} makeDefault enabled={false} enableDamping={false} enableZoom={false} enableRotate={false} enablePan={false} />;
}

function ShotCamera({ object, aspect, frame: frameOverride, frameHeightRatio = 1 }: { object: SceneObject; aspect: number; frame?: number; frameHeightRatio?: number }) {
  const currentFrame = useEditor((state) => state.currentFrame);
  const frame = frameOverride ?? currentFrame;
  const transform = evaluateTransform(object, frame);
  const lens = evaluateProperty(object, 'lens', frame) as number;
  const sensorHeight = 36 / aspect;
  const frameFov = 2 * Math.atan(sensorHeight / (2 * lens));
  // In camera view the canvas also shows the workspace outside the exported frame.
  // Widen its vertical field of view so the rectangle still contains exactly the
  // same composition as thumbnails and exports.
  const safeFrameHeightRatio = THREE.MathUtils.clamp(frameHeightRatio, .1, 1);
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(frameFov / 2) / safeFrameHeightRatio));
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

function SceneThumbnailRenderer({ projectId, scene, objects, aspect, dark }: { projectId: string; scene: CameraCut; objects: SceneObject[]; aspect: number; dark: boolean }) {
  const frame = scene.frame;
  const camera = objects.find((object) => object.id === scene.cameraId && object.kind === 'camera');
  if (!camera) return null;
  const lightingStyle = { neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 }, warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 } }[scene.lighting.preset];
  const angle = THREE.MathUtils.degToRad(scene.lighting.direction);
  const elevation = THREE.MathUtils.degToRad(scene.lighting.elevation);
  const radius = Math.cos(elevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(angle) * radius, -Math.cos(angle) * radius, 1.5 + Math.sin(elevation) * 9];
  const revision = `${frame}:${JSON.stringify(scene)}:${objects.map((object) => `${object.id}:${JSON.stringify(evaluateTransform(object, frame))}:${evaluateProperty(object, 'visibility', frame)}`).join('|')}`;
  return <div className="thumbnail-renderer"><Canvas frameloop="demand" dpr={1} gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <color attach="background" args={[dark ? '#242624' : '#f1f1ef']} />
    <SceneBackground kind={scene.background?.kind ?? 'none'} path={scene.background?.path ?? ''} />
    <ambientLight intensity={lightingStyle.ambient * Math.max(.2, scene.lighting.intensity)} />
    <directionalLight color={scene.lighting.color} position={lightPosition} intensity={lightingStyle.key * scene.lighting.intensity} />
    {objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <ThumbnailItem key={object.id} object={object} frame={frame} />)}
    <ShotCamera object={camera} aspect={aspect} frame={frame} />
    <ThumbnailEmitter projectId={projectId} sceneId={scene.id} revision={revision} />
  </Canvas></div>;
}

function LiveCameraPreview({ scene, camera, objects, aspect, dark, onOpen }: { scene: CameraCut; camera: SceneObject; objects: SceneObject[]; aspect: number; dark: boolean; onOpen(): void }) {
  const frame = useEditor((state) => state.currentFrame);
  const lightingStyle = { neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 }, warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 } }[scene.lighting.preset];
  const angle = THREE.MathUtils.degToRad(scene.lighting.direction);
  const elevation = THREE.MathUtils.degToRad(scene.lighting.elevation);
  const radius = Math.cos(elevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(angle) * radius, -Math.cos(angle) * radius, 1.5 + Math.sin(elevation) * 9];
  return <button className="live-camera-preview" style={{ width: aspect < 1 ? 'clamp(92px, 14%, 128px)' : undefined }} onClick={onOpen} title="Apri la vista camera" aria-label="Apri l'anteprima della camera">
    <div className="live-camera-preview-canvas" style={{ aspectRatio: String(aspect) }}><Canvas frameloop="demand" dpr={1} gl={{ antialias: true }}>
      <color attach="background" args={[dark ? '#242624' : '#f1f1ef']} />
      <SceneBackground kind={scene.background?.kind ?? 'none'} path={scene.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, scene.lighting.intensity)} />
      <directionalLight color={scene.lighting.color} position={lightPosition} intensity={lightingStyle.key * scene.lighting.intensity} />
      {objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <ThumbnailItem key={object.id} object={object} frame={frame} />)}
      <ShotCamera object={camera} aspect={aspect} frame={frame} />
    </Canvas></div>
    <span className="live-camera-preview-label"><Video size={12} /> Camera · {scene.name}</span>
  </button>;
}

function MotionPointHandle({ objectId, keyframe, selected, onSelect, onDragChange }: { objectId: string; keyframe: Keyframe; selected: boolean; onSelect(): void; onDragChange(value: boolean): void }) {
  const ref = useRef<THREE.Group>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; start: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; worldPerPixel: number; moved: boolean } | undefined>(undefined);
  const setFrame = useEditor((state) => state.setFrame);
  const setPlaying = useEditor((state) => state.setPlaying);
  const updateMotionPoint = useEditor((state) => state.updateMotionPoint);
  const position = keyframe.value as Vec3;
  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || !ref.current) return;
    event.stopPropagation();
    setPlaying(false);
    setFrame(keyframe.frame);
    onSelect();
    event.camera.updateMatrixWorld();
    const forward = event.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 1).normalize();
    const depth = Math.max(.5, Math.abs(ref.current.position.clone().sub(event.camera.position).dot(forward)));
    const canvasHeight = Math.max(1, (event.nativeEvent.target as HTMLElement | null)?.getBoundingClientRect?.().height ?? 600);
    const worldPerPixel = event.camera instanceof THREE.PerspectiveCamera ? (2 * depth * Math.tan(THREE.MathUtils.degToRad(event.camera.fov / 2))) / canvasHeight : 2 / canvasHeight;
    drag.current = { pointerId: event.pointerId, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY, start: ref.current.position.clone(), right, up, worldPerPixel, moved: false };
    const target = event.nativeEvent.target;
    if (target instanceof Element) target.setPointerCapture?.(event.pointerId);
    onDragChange(true);
  };
  const moveDrag = (event: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || !ref.current) return;
    event.stopPropagation();
    const dx = event.nativeEvent.clientX - state.x, dy = event.nativeEvent.clientY - state.y;
    if (Math.hypot(dx, dy) < 1) return;
    ref.current.position.copy(state.start).addScaledVector(state.right, dx * state.worldPerPixel).addScaledVector(state.up, -dy * state.worldPerPixel);
    state.moved = true;
  };
  const finishDrag = (event: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (state.moved && ref.current) updateMotionPoint(objectId, keyframe.id, ref.current.position.toArray().map((value) => Number(value.toFixed(4))) as Vec3);
    const target = event.nativeEvent.target;
    if (target instanceof Element && target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    drag.current = undefined;
    onDragChange(false);
  };
  return <>
    <group ref={ref} position={position} renderOrder={24} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = 'grab'; }} onPointerOut={() => { if (!drag.current) document.body.style.cursor = 'default'; }}>
      <mesh><sphereGeometry args={[selected ? .15 : .115, 18, 14]} /><meshBasicMaterial color={selected ? '#ffffff' : '#ef3f3f'} depthTest={false} /></mesh>
      <mesh><sphereGeometry args={[.28, 12, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
    </group>
  </>;
}

function MotionPath({ objectId, keyframes, points, onDragChange }: { objectId: string; keyframes: Keyframe[]; points: Transform['position'][]; onDragChange(value: boolean): void }) {
  const [selectedPointId, setSelectedPointId] = useState<string>();
  const deleteMotionPoint = useEditor((state) => state.deleteMotionPoint);
  useEffect(() => {
    if (selectedPointId && !keyframes.some((key) => key.id === selectedPointId)) setSelectedPointId(undefined);
  }, [keyframes, selectedPointId]);
  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      if (!selectedPointId || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      event.preventDefault();
      deleteMotionPoint(objectId, selectedPointId);
      setSelectedPointId(undefined);
    };
    window.addEventListener('keydown', remove);
    return () => window.removeEventListener('keydown', remove);
  }, [deleteMotionPoint, objectId, selectedPointId]);
  if (points.length < 2) return null;
  return <group renderOrder={20}>
    <Line points={points} color="#ef3f3f" lineWidth={2.4} depthTest={false} transparent opacity={.95} />
    {keyframes.map((keyframe) => <MotionPointHandle key={keyframe.id} objectId={objectId} keyframe={keyframe} selected={selectedPointId === keyframe.id} onSelect={() => setSelectedPointId(keyframe.id)} onDragChange={onDragChange} />)}
  </group>;
}

export default function Viewport({ dark = false }: { dark?: boolean }) {
  const projectId = useEditor((state) => state.project.id);
  const objects = useEditor((state) => state.project.objects);
  const cuts = useEditor((state) => state.project.cameraCuts);
  const settings = useEditor((state) => state.project.settings);
  const frame = useEditor((state) => state.currentFrame);
  const selectedMotion = useEditor((state) => state.selectedMotion);
  const select = useEditor((state) => state.select);
  const addObject = useEditor((state) => state.addObject);
  const selectedId = useEditor((state) => state.selectedId);
  const gizmoMode = useEditor((state) => state.gizmoMode);
  const setGizmoMode = useEditor((state) => state.setGizmoMode);
  const cameraView = useEditor((state) => state.cameraView);
  const setCameraView = useEditor((state) => state.setCameraView);
  const [cameraHintVisible, setCameraHintVisible] = useState(true);
  const [draggingObject, setDraggingObject] = useState(false);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const shotOrbitRef = useRef<OrbitControlsImpl | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraPanBuffer = useRef<{ x: number; y: number; timer?: number }>({ x: 0, y: 0 });
  const cameraRotateBuffer = useRef<{ x: number; y: number; timer?: number }>({ x: 0, y: 0 });
  const cameraCommitTimer = useRef<number | undefined>(undefined);
  const pendingCameraCommit = useRef<{ projectId: string; sceneId: string; frame: number; position: Vec3; rotation: Vec3; target: Vec3 } | undefined>(undefined);
  const shiftPressed = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0, left: 0 });
  const hasContent = objects.some((object) => object.kind !== 'camera' && !object.kind.includes('light'));
  const activeCut = cuts.slice().sort((a, b) => b.frame - a.frame).find((cut) => cut.frame <= frame);
  const activeCamera = objects.find((object) => object.id === activeCut?.cameraId && object.kind === 'camera');
  const activeCameraTransform = activeCamera ? evaluateTransform(activeCamera, frame) : undefined;
  const activeCameraTarget = activeCameraTransform && activeCut
    ? new THREE.Vector3(...activeCameraTransform.position).addScaledVector(
      new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(...activeCameraTransform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])),
      activeCut.framing.distance,
    ).toArray() as Transform['position']
    : activeCut?.framing.target;
  const motionObject = objects.find((object) => object.id === selectedMotion?.objectId);
  const motionSceneIndex = cuts.findIndex((cut) => cut.id === selectedMotion?.sceneId);
  const motionScene = motionSceneIndex >= 0 ? cuts[motionSceneIndex] : undefined;
  const motionSceneEnd = motionScene ? (cuts.filter((cut) => cut.frame > motionScene.frame).sort((a, b) => a.frame - b.frame)[0]?.frame ?? settings.frameEnd + 1) : undefined;
  const motionPositionKeys = useMemo(() => motionObject && motionScene && motionSceneEnd
    ? motionObject.keyframes.filter((key) => key.property === 'position' && key.frame >= motionScene.frame && key.frame < motionSceneEnd).sort((a, b) => a.frame - b.frame)
    : [], [motionObject, motionScene, motionSceneEnd]);
  const motionPathPoints = useMemo(() => {
    if (!motionObject || !motionScene || !motionSceneEnd) return [];
    const realPoints = motionPositionKeys.filter((key) => key.purpose === 'motion' || (key.purpose === undefined && key.frame !== motionScene.frame));
    if (!realPoints.length || motionPositionKeys.length < 2) return [];
    const positionFrames = motionPositionKeys.map((key) => key.frame);
    const first = positionFrames[0], last = positionFrames[positionFrames.length - 1];
    const step = Math.max(1, Math.ceil((last - first) / 120));
    const points: Transform['position'][] = [];
    for (let sample = first; sample <= last; sample += step) points.push(evaluateTransform(motionObject, sample).position);
    if ((last - first) % step) points.push(evaluateTransform(motionObject, last).position);
    return points.filter((point, index) => index === 0 || point.some((value, axis) => Math.abs(value - points[index - 1][axis]) > .0001));
  }, [motionObject, motionPositionKeys, motionScene, motionSceneEnd]);
  const selectedObject = objects.find((object) => object.id === selectedId);
  const selectedTransformable = selectedObject && !selectedObject.kind.includes('light') && evaluateProperty(selectedObject, 'visibility', frame)
    ? selectedObject : undefined;
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
  const cameraFrame = useMemo(() => {
    if (!cameraView || !viewportSize.width || !viewportSize.height) return undefined;
    const margin = Math.min(48, Math.max(20, Math.min(viewportSize.width, viewportSize.height) * .07));
    const availableWidth = Math.max(1, viewportSize.width - margin * 2);
    const availableHeight = Math.max(1, viewportSize.height - margin * 2);
    const width = Math.min(availableWidth, availableHeight * aspect);
    const height = width / aspect;
    return { width, height, heightRatio: height / viewportSize.height };
  }, [aspect, cameraView, viewportSize]);

  const flushPendingCameraCommit = () => {
    const pending = pendingCameraCommit.current;
    if (!pending) return;
    if (cameraCommitTimer.current) window.clearTimeout(cameraCommitTimer.current);
    cameraCommitTimer.current = undefined;
    pendingCameraCommit.current = undefined;
    const state = useEditor.getState();
    if (state.project.id === pending.projectId && state.currentFrame === pending.frame) {
      state.setCameraFraming(pending.sceneId, pending.position, pending.rotation, pending.target);
    }
  };

  const cameraMotionSelection = motionObject?.kind === 'camera' ? `${selectedMotion?.sceneId}:${motionObject.id}` : undefined;
  useEffect(() => {
    if (!cameraMotionSelection || !motionObject) return;
    setCameraView(false);
    if (selectedId !== motionObject.id) select(motionObject.id);
  }, [cameraMotionSelection]);

  useEffect(() => {
    if (cameraView || !cameraMotionSelection) return;
    const request = requestAnimationFrame(() => {
      const controls = orbitRef.current;
      if (!controls || !activeCameraTransform) return;
      controls.target.set(...activeCameraTransform.position);
      controls.object.position.copy(controls.target).add(new THREE.Vector3(6, -8, 5));
      controls.update();
    });
    return () => cancelAnimationFrame(request);
  }, [cameraView, cameraMotionSelection]);

  useEffect(() => {
    window.addEventListener('abaco:flush-camera-edit', flushPendingCameraCommit);
    return () => window.removeEventListener('abaco:flush-camera-edit', flushPendingCameraCommit);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: element.clientWidth, height: element.clientHeight, left: rect.left });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (cameraPanBuffer.current.timer) window.clearTimeout(cameraPanBuffer.current.timer);
    if (cameraRotateBuffer.current.timer) window.clearTimeout(cameraRotateBuffer.current.timer);
    if (cameraCommitTimer.current) window.clearTimeout(cameraCommitTimer.current);
    cameraPanBuffer.current = { x: 0, y: 0 };
    cameraRotateBuffer.current = { x: 0, y: 0 };
    cameraCommitTimer.current = undefined;
    pendingCameraCommit.current = undefined;
  }, [frame, cameraView, projectId, activeCut?.id]);

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
    const cameraTransform = activeCameraTransform ?? evaluateTransform(activeCamera, frame);
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
    pendingCameraCommit.current = {
      projectId,
      sceneId: activeCut.id,
      frame,
      position: camera.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
      rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'],
      target: controls.target.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
    };
    if (cameraCommitTimer.current) window.clearTimeout(cameraCommitTimer.current);
    cameraCommitTimer.current = window.setTimeout(flushPendingCameraCommit, 180);
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

  const tiltShotCameraFromTrackpad = (deltaX: number, deltaY: number) => {
    const controls = shotOrbitRef.current;
    if (!controls || !activeCamera) return;
    const camera = controls.object;
    const distance = Math.max(.5, camera.position.distanceTo(controls.target));
    const direction = camera.getWorldDirection(new THREE.Vector3()).normalize();
    const worldUp = new THREE.Vector3(0, 0, 1);
    direction.applyAxisAngle(worldUp, deltaX * TRACKPAD_ROTATE_SENSITIVITY);
    const right = new THREE.Vector3().crossVectors(direction, worldUp).normalize();
    const tilted = direction.clone().applyAxisAngle(right, deltaY * TRACKPAD_ROTATE_SENSITIVITY);
    if (Math.abs(tilted.dot(worldUp)) < .985) direction.copy(tilted);
    controls.target.copy(camera.position).addScaledVector(direction, distance);
    camera.lookAt(controls.target);
    controls.update();
    scheduleCameraCommit();
  };

  const panViewFromTrackpad = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (draggingObject) { event.preventDefault(); event.stopPropagation(); return; }
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
          tiltShotCameraFromTrackpad(x, y);
        }, 24);
      } else if (!cameraView) rotateViewFromTrackpad(delta.x, delta.y);
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

  useEffect(() => {
    const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const held = new Set<string>();
    let animationFrame = 0;
    let previousTime = performance.now();

    const editableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
    };
    const keyDown = (event: KeyboardEvent) => {
      if (editableTarget(event.target) || event.metaKey || event.ctrlKey) return;
      if (movementCodes.has(event.code)) {
        event.preventDefault();
        held.add(event.code);
        useEditor.getState().setPlaying(false);
      }
      if (event.code.startsWith('Shift') || event.code.startsWith('Alt')) held.add(event.code);
    };
    const keyUp = (event: KeyboardEvent) => { held.delete(event.code); };
    const clearKeys = () => held.clear();
    const tick = (time: number) => {
      const deltaSeconds = Math.min(.05, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      if ([...held].some((code) => movementCodes.has(code))) {
        const editor = useEditor.getState();
        const currentScene = editor.project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((scene) => scene.frame <= editor.currentFrame);
        const cameraObject = editor.project.objects.find((object) => object.id === currentScene?.cameraId && object.kind === 'camera');
        if (currentScene && cameraObject) {
          const controls = cameraView ? shotOrbitRef.current : undefined;
          const transform = evaluateTransform(cameraObject, editor.currentFrame);
          const camera = controls?.object ?? new THREE.PerspectiveCamera();
          if (!controls) {
            camera.position.set(...transform.position);
            camera.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
          }
          camera.up.set(0, 0, 1);
          camera.updateMatrixWorld();
          const target = controls?.target ?? new THREE.Vector3(...transform.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), currentScene.framing.distance);
          const distance = Math.max(.5, camera.position.distanceTo(target));
          const speedModifier = ([...held].some((code) => code.startsWith('Shift')) ? 3 : 1) * ([...held].some((code) => code.startsWith('Alt')) ? .25 : 1);
          const step = THREE.MathUtils.clamp(distance * .72, .65, 18) * deltaSeconds * speedModifier;
          const forward = camera.getWorldDirection(new THREE.Vector3()).normalize();
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
          const movement = new THREE.Vector3();
          if (held.has('KeyW') || held.has('ArrowUp')) movement.add(forward);
          if (held.has('KeyS') || held.has('ArrowDown')) movement.sub(forward);
          if (held.has('KeyA') || held.has('ArrowLeft')) movement.sub(right);
          if (held.has('KeyD') || held.has('ArrowRight')) movement.add(right);
          if (held.has('KeyE')) movement.z += 1;
          if (held.has('KeyQ')) movement.z -= 1;
          if (movement.lengthSq() > 0) {
            movement.normalize().multiplyScalar(step);
            camera.position.add(movement);
            target.add(movement);
            camera.lookAt(target);
            camera.updateMatrixWorld();
            controls?.update();
            const position = camera.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'];
            const rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'];
            const framingTarget = target.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'];
            if (cameraView) scheduleCameraCommit();
            else editor.setCameraFraming(currentScene.id, position, rotation, framingTarget);
          }
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearKeys);
    animationFrame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
    };
  }, [cameraView]);

  return <div ref={viewportRef} className={`viewport ${cameraView ? 'camera-mode' : ''}`} data-testid="viewport">
    <div ref={stageRef} className="canvas-stage" onWheelCapture={panViewFromTrackpad}>
    <Canvas shadows gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ position: [8, -10, 7], fov: 45, near: .01, far: 1000 }}
      onCreated={({ gl, camera }) => { viewportCanvas = gl.domElement; camera.up.set(0, 0, 1); }} onPointerMissed={() => select(undefined)}>
      <PerspectiveCamera makeDefault={!cameraView} position={[8, -10, 7]} up={[0, 0, 1]} fov={45} near={.01} far={1000} />
      <color attach="background" args={[dark ? '#242624' : '#f1f1ef']} />
      <SceneBackground kind={activeCut?.background?.kind ?? 'none'} path={activeCut?.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, lighting.intensity)} />
      <directionalLight color={lighting.color} position={lightPosition} intensity={lightingStyle.key * lighting.intensity} castShadow />
      <Grid name="abaco-ground-grid" args={[40, 40]} rotation={[Math.PI / 2, 0, 0]} cellSize={1} cellThickness={0.55} cellColor={dark ? '#3a3d3a' : '#d7d7d3'} sectionSize={5} sectionThickness={0.9} sectionColor={dark ? '#555955' : '#bdbdb7'} fadeDistance={45} infiniteGrid />
      {objects.filter((object) => object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <SceneItem key={object.id} object={object} cameraView={cameraView} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value && !cameraView; }} />)}
      {!cameraView && activeCamera && <SceneItem object={activeCamera} cameraView={cameraView} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value; }} />}
      {motionObject && motionPathPoints.length > 1 && <MotionPath objectId={motionObject.id} keyframes={motionPositionKeys} points={motionPathPoints} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value && !cameraView; }} />}
      {cameraView && activeCamera && <ShotCamera object={activeCamera} aspect={aspect} frameHeightRatio={cameraFrame?.heightRatio} />}
      {cameraView && activeCamera && activeCut && activeCameraTransform && activeCameraTarget && <CameraViewControls controls={shotOrbitRef} frame={frame} target={activeCameraTarget} syncKey={`${activeCut.id}:${JSON.stringify(activeCameraTarget)}:${JSON.stringify(activeCameraTransform)}`} />}
      {!cameraView && <OrbitControls ref={orbitRef} makeDefault enableDamping enabled={!draggingObject} target={[0, 0, 1]} />}
    </Canvas>
    </div>
    {cameraView && cameraFrame && <div className="camera-frame-guide" style={{ width: cameraFrame.width, height: cameraFrame.height }} aria-hidden="true" />}
    <div className="thumbnail-renderers" aria-hidden="true">{cuts.map((scene) => <SceneThumbnailRenderer key={scene.id} projectId={projectId} scene={scene} objects={objects} aspect={aspect} dark={dark} />)}</div>
    <button className={`view-toggle ${cameraView ? 'active' : ''}`} title={cameraView ? 'Vista libera' : 'Vista camera'} aria-label={cameraView ? 'Vista libera' : 'Vista camera'} onClick={() => setCameraView(!cameraView)}>{cameraView ? <LayoutTemplate size={16} /> : <Video size={16} />}</button>
    {cameraHintVisible && <div className={`camera-instructions-anchor ${cameraView && cameraFrame ? 'inside-frame' : ''}`} style={cameraView && cameraFrame ? { width: cameraFrame.width, height: cameraFrame.height } : undefined}>
      <div className="camera-drone-hint" aria-label="Comandi camera stile Blender">
        <button className="camera-hint-close" title="Nascondi istruzioni" aria-label="Nascondi istruzioni" onClick={() => setCameraHintVisible(false)}>×</button>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> vola</span>
        <span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> alternativa</span>
        <span><kbd>Q</kbd><kbd>E</kbd> giù / su</span>
        <small>2 dita inclina · Shift + 2 dita sposta</small>
        <small>Shift veloce · Alt lento</small>
      </div>
    </div>}
    <div className="viewport-top-right">
      {!cameraView && activeCameraTransform && <button className="secondary small" onClick={() => {
        const controls = orbitRef.current;
        if (!controls) return;
        controls.target.set(...activeCameraTransform.position);
        controls.object.position.copy(controls.target).add(new THREE.Vector3(6, -8, 5));
        controls.update();
        select(activeCamera!.id);
      }}>Trova camera</button>}
      {selectedTransformable && <div className="viewport-tools" aria-label="Strumento trasformazione">{([
        ['translate', 'Sposta', Move3d],
        ['rotate', 'Ruota', Rotate3d],
        ['scale', 'Scala', Scaling],
      ] as const).map(([mode, label, Icon]) => <button key={mode} title={label} aria-label={label} className={gizmoMode === mode ? 'active' : ''} onClick={() => setGizmoMode(mode)}><Icon size={15} /></button>)}</div>}
    </div>
    {!cameraView && activeCut && activeCamera && <LiveCameraPreview scene={activeCut} camera={activeCamera} objects={objects} aspect={aspect} dark={dark} onOpen={() => setCameraView(true)} />}
    {!hasContent && !cameraView && <div className="start-card">
      <div className="start-icon"><Box size={26} /></div>
      <strong>Crea la prima scena</strong>
      <p>Aggiungi una forma o un testo. Poi trascinalo direttamente nello spazio.</p>
      <div><button className="primary" onClick={() => addObject('cube')}><Plus size={16} /> Forma</button><button className="secondary" onClick={() => addObject('text')}><TextCursorInput size={16} /> Testo</button></div>
    </div>}
    {cameraView && activeCamera && framingSubject && <div className="viewport-bottom-left"><button className="center-shot center-subject" aria-label="Centra soggetto" title={`Ricentra l’inquadratura su ${framingSubject.name}`} onClick={centerFramingOnSubject}><Focus size={15} /></button></div>}
    <div className="viewport-help">{cameraView
      ? '2 dita: inclina · Shift + 2 dita: sposta · pizzica: zoom · WASD/frecce: vola · gli oggetti restano modificabili'
      : `Camera: WASD/frecce vola · Q/E giù-su · Oggetto: ${actionName} con aggancio`}</div>
  </div>;
}
