import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Grid, Html, Line, OrbitControls, PerspectiveCamera, Text, TransformControls } from '@react-three/drei';
import { ArrowLeft, Box, Eye, EyeOff, Focus, Group, ImageOff, Minimize2, MousePointer2, Move3d, Plus, RotateCcw, Rotate3d, Scaling, TextCursorInput, Ungroup, Video } from 'lucide-react';
import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import * as THREE from 'three';
import { GLTFLoader, MTLLoader, OBJLoader, type OrbitControls as OrbitControlsImpl, type TransformControls as TransformControlsImpl } from 'three-stdlib';
import { hitsTransformHandle } from '../domain/gizmo';
import { groundedPositionZ } from '../domain/ground';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { fromCameraSpace, toCameraSpace } from '../domain/camera-space';
import { applyControllerMorphs, controllerOffset, controllerOffsetFromWorldDelta, controllerPose, controllerWorldDelta } from '../domain/controller-pose';
import { normalizeWheelDelta, trackpadCameraOffset, TRACKPAD_PINCH_SENSITIVITY, TRACKPAD_ROTATE_SENSITIVITY } from '../domain/gestures';
import type { CameraCut, Keyframe, SceneObject, Transform, Vec3 } from '../domain/schema';
import { useEditor } from '../store/editor';
import headerLogo from '../assets/abaco-scene-header.png';

let viewportCanvas: HTMLCanvasElement | null = null;
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function JevStrokeOverlay({ width, height, viewMode, getViewContext }: { width: number; height: number; viewMode: 'camera' | 'free'; getViewContext(): { rotation: Vec3; position: Vec3; verticalFovDegrees: number } }) {
  const stroke = useEditor((state) => state.jevStroke);
  const setPoints = useEditor((state) => state.setJevStrokePoints);
  const setActive = useEditor((state) => state.setJevStrokeActive);
  const setContext = useEditor((state) => state.setJevStrokeContext);
  const drawing = useRef<number | undefined>(undefined);
  const point = (event: ReactPointerEvent<SVGSVGElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [THREE.MathUtils.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1), THREE.MathUtils.clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1)];
  };
  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!stroke.active || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); drawing.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId); setPoints([point(event)]);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing.current !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const next = point(event), previous = useEditor.getState().jevStroke.points;
    const last = previous[previous.length - 1];
    if (!last || Math.hypot(next[0] - last[0], next[1] - last[1]) >= .004) setPoints([...previous.slice(-510), next]);
  };
  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing.current !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); drawing.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const context = getViewContext();
    setContext(viewMode, context.rotation, context.position, context.verticalFovDegrees, width / Math.max(1, height));
    setActive(false);
  };
  if (!stroke.active && stroke.points.length < 2) return null;
  const polyline = stroke.points.map(([x, y]) => `${x * width},${y * height}`).join(' ');
  return <svg className={`jev-stroke-overlay ${stroke.active ? 'drawing' : ''}`} aria-label="Draw Jev path" width={width} height={height} viewBox={`0 0 ${width} ${height}`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
    <defs><marker id="jev-stroke-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
    {stroke.points.length > 1 && <polyline points={polyline} markerEnd="url(#jev-stroke-arrow)" />}
    {stroke.active && stroke.points.length < 2 && <text x="50%" y="50%" textAnchor="middle">Drag to draw the path</text>}
  </svg>;
}

export function WebGLContextGuard({ primary = false, onLost }: { primary?: boolean; onLost(): void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      if (primary && viewportCanvas === canvas) viewportCanvas = null;
      onLost();
    };
    const restored = () => invalidate();
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      if (primary && viewportCanvas === canvas) viewportCanvas = null;
    };
  }, [gl, invalidate, onLost, primary]);
  return null;
}

export async function captureContactSheet(frames: number[]): Promise<string | undefined> {
  if (!viewportCanvas) return undefined;
  const editor = useEditor.getState();
  const original = editor.currentFrame;
  const selected = [...new Set(frames)].slice(0, 6);
  const shots: Array<{ frame: number; url: string }> = [];
  try {
    for (const frame of selected) {
      useEditor.getState().setFrame(frame);
      await nextPaint();
      if (!viewportCanvas) break;
      shots.push({ frame, url: viewportCanvas.toDataURL('image/jpeg', 0.72) });
    }
  } catch {
    return undefined;
  } finally {
    useEditor.getState().setFrame(original);
  }
  if (!shots.length) return undefined;
  const cellWidth = 480, cellHeight = 300, columns = Math.min(2, shots.length), rows = Math.ceil(shots.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * columns; canvas.height = cellHeight * rows;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#101319'; context.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.all(shots.map(async (shot, index) => {
    const image = new Image(); image.src = shot.url; await image.decode().catch(() => undefined);
    const x = (index % columns) * cellWidth, y = Math.floor(index / columns) * cellHeight;
    context.drawImage(image, x, y, cellWidth, cellHeight);
    context.fillStyle = 'rgba(8,10,14,.82)'; context.fillRect(x + 12, y + 12, 86, 30);
    context.fillStyle = '#fff'; context.font = '600 15px sans-serif'; context.fillText(`Frame ${shot.frame}`, x + 22, y + 33);
  }));
  return canvas.toDataURL('image/jpeg', 0.78);
}

function ImageBackground({ source }: { source: string }) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const previous = scene.background;
    let active = true;
    let loaded: THREE.Texture | undefined;
    new THREE.TextureLoader().load(source, (texture) => {
      if (!active) { texture.dispose(); return; }
      loaded = texture;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
      invalidate();
    }, undefined, () => {
      if (active) { scene.background = previous; invalidate(); }
    });
    return () => {
      active = false;
      if (scene.background === loaded) scene.background = previous;
      loaded?.dispose();
      invalidate();
    };
  }, [invalidate, scene, source]);
  return null;
}

function ModelBackground({ source }: { source: string }) {
  const gltf = useLoader(GLTFLoader, source);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={model} />;
}

export function orientObjBackground(object: THREE.Object3D) {
  object.rotation.x = Math.PI / 2;
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -center.y, -bounds.min.z);
  object.updateMatrixWorld(true);
  return object;
}

function ObjBackground({ source, materials }: { source: string; materials?: string }) {
  const model = useMemo(() => {
    const loader = new OBJLoader();
    if (materials) {
      const creator = new MTLLoader().parse(materials, '');
      creator.preload();
      loader.setMaterials(creator);
    }
    const object = loader.parse(source);
    // Blender scrive gli OBJ con Y verso l'alto. Scenes usa Z verso l'alto:
    // incorporiamo la conversione nell'oggetto, quindi lo centriamo e lo
    // appoggiamo al piano per evitare offset residui del file sorgente.
    orientObjBackground(object);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    return object;
  }, [materials, source]);
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

function BlendAssetModel({ source, object, controllers, pose }: { source: string; object: SceneObject; controllers: CharacterController[]; pose: Record<string, Vec3> }) {
  const gltf = useLoader(GLTFLoader, source);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; if (child.morphTargetInfluences) child.frustumCulled = false; }
    });
    return clone;
  }, [gltf.scene]);
  const poseSignature = JSON.stringify(pose);
  useLayoutEffect(() => applyControllerMorphs(model, controllers, pose), [model, controllers, poseSignature]);
  // L'exporter glTF converte le coordinate Blender (x, y, z) in (x, z, -y).
  // Il resto dell'editor usa Z verso l'alto: +90° su X ripristina quindi
  // l'orientamento originale del file Blender senza coricarne la geometria.
  const [centerX, centerY, centerZ] = object.asset.boundsCenter;
  const center: Vec3 = [centerX, centerZ, -centerY];
  return <group scale={object.asset.previewScale}>
    <group rotation={[Math.PI / 2, 0, 0]}>
      <primitive object={model} position={[-center[0], -center[1], -center[2]]} />
    </group>
  </group>;
}

type CharacterController = NonNullable<SceneObject['asset']['controllers']>[number];

function CharacterHandle({ object, controller, previewOffset, onPreviewOffset, onDragChange }: { object: SceneObject; controller: CharacterController; previewOffset: Vec3; onPreviewOffset(name: string, offset?: Vec3): void; onDragChange(value: boolean): void }) {
  const frame = useEditor((state) => state.currentFrame);
  const startFrame = useEditor((state) => state.project.settings.frameStart);
  const select = useEditor((state) => state.select);
  const setControllerOffset = useEditor((state) => state.setControllerOffset);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState<Vec3>();
  const drag = useRef<{ pointerId: number; x: number; y: number; base: THREE.Vector3; offset: Vec3; position: Vec3; moved: boolean; cleanup(): void; releaseCapture(): void } | undefined>(undefined);
  useEffect(() => () => { if (drag.current) { drag.current.cleanup(); drag.current.releaseCapture(); onDragChange(false); document.body.style.cursor = ''; } }, []);
  const world = controller.worldPosition;
  const base: Vec3 = world ? world.map((value, axis) => (value - object.asset.boundsCenter[axis]) * object.asset.previewScale) as Vec3 : [0, 0, 0];
  const worldOffset = controllerWorldDelta(controller, previewOffset);
  const position: Vec3 = draft ?? base.map((value, axis) => value + worldOffset[axis] * object.asset.previewScale) as Vec3;
  const name = controller.name.startsWith('BONE|') ? controller.name.split('|').at(-1)! : controller.name.replace(/^CTRL_/, '').replaceAll('_', ' ');
  if (!world) return null;
  const finish = (pointerId: number, commitPose: boolean) => {
    const state = drag.current;
    if (!state || state.pointerId !== pointerId) return;
    state.cleanup(); state.releaseCapture();
    if (state.moved && commitPose) {
      const worldDelta = new THREE.Vector3(...state.position).sub(state.base).multiplyScalar(1 / object.asset.previewScale).toArray() as Vec3;
      const delta = controllerOffsetFromWorldDelta(controller, worldDelta);
      setControllerOffset(object.id, controller.name, state.offset.map((value, axis) => value + delta[axis]) as Vec3);
    }
    drag.current = undefined;
    setDraft(undefined);
    onPreviewOffset(controller.name);
    onDragChange(false);
    document.body.style.cursor = '';
  };
  return <group>
    <mesh position={position} renderOrder={100} onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'grab'; }} onPointerOut={(event) => { event.stopPropagation(); setHovered(false); if (!drag.current) document.body.style.cursor = ''; }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const parent = event.eventObject.parent;
        if (!parent) return;
        select(object.id); onDragChange(true);
        parent.updateWorldMatrix(true, false);
        event.camera.updateMatrixWorld();
        const base = new THREE.Vector3(...position);
        const origin = parent.localToWorld(base.clone());
        const right = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 1).normalize();
        const height = Math.max(1, (event.nativeEvent.target as HTMLElement).getBoundingClientRect().height);
        const depth = Math.max(.1, origin.distanceTo(event.camera.position));
        const perPixel = event.camera instanceof THREE.PerspectiveCamera ? 2 * depth * Math.tan(THREE.MathUtils.degToRad(event.camera.fov / 2)) / height : 2 / height;
        const target = event.target as unknown as { setPointerCapture?(id: number): void; hasPointerCapture?(id: number): boolean; releasePointerCapture?(id: number): void };
        target.setPointerCapture?.(event.pointerId);
        const move = (pointer: PointerEvent) => {
          const state = drag.current;
          if (!state || pointer.pointerId !== state.pointerId) return;
          const dx = pointer.clientX - state.x;
          const dy = pointer.clientY - state.y;
          if (Math.hypot(dx, dy) < 2) return;
          const movedWorld = origin.clone().addScaledVector(right, dx * perPixel).addScaledVector(up, -dy * perPixel);
          const moved = parent.worldToLocal(movedWorld);
          state.position = moved.toArray() as Vec3;
          state.moved = true;
          setDraft(state.position);
          const worldDelta = moved.sub(state.base).multiplyScalar(1 / object.asset.previewScale).toArray() as Vec3;
          const delta = controllerOffsetFromWorldDelta(controller, worldDelta);
          onPreviewOffset(controller.name, state.offset.map((value, axis) => value + delta[axis]) as Vec3);
        };
        const upHandler = (pointer: PointerEvent) => finish(pointer.pointerId, true);
        const cancelHandler = (pointer: PointerEvent) => finish(pointer.pointerId, false);
        const blurHandler = () => finish(event.pointerId, false);
        const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upHandler); window.removeEventListener('pointercancel', cancelHandler); window.removeEventListener('blur', blurHandler); };
        drag.current = { pointerId: event.pointerId, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY,
          base, offset: controllerOffset(object.asset, controller.name, frame, startFrame), position, moved: false,
          cleanup, releaseCapture: () => { if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture?.(event.pointerId); } };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', upHandler);
        window.addEventListener('pointercancel', cancelHandler);
        window.addEventListener('blur', blurHandler);
      }} onPointerUp={(event) => { event.stopPropagation(); finish(event.pointerId, true); }} onPointerCancel={(event) => { event.stopPropagation(); finish(event.pointerId, false); }}>
      <sphereGeometry args={[hovered || drag.current ? .12 : .095, 16, 12]} />
      <meshBasicMaterial color={hovered || drag.current ? '#ffe085' : '#f4bd3d'} depthTest={false} />
    </mesh>
    {hovered && <Html center distanceFactor={8} position={[position[0], position[1], position[2] + .23]} style={{ pointerEvents: 'none' }}><span className="character-handle-label">{name}</span></Html>}
  </group>;
}

function BlendAssetVisual({ object, onDragChange }: { object: SceneObject; onDragChange?: (value: boolean) => void }) {
  const [source, setSource] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [poseControllers, setPoseControllers] = useState<CharacterController[]>(object.asset.controllers ?? []);
  const [draftPose, setDraftPose] = useState<Record<string, Vec3>>({});
  const updateObject = useEditor((state) => state.updateObject);
  const frame = useEditor((state) => state.currentFrame);
  const startFrame = useEditor((state) => state.project.settings.frameStart);
  const selected = useEditor((state) => state.selectedIds.includes(object.id));
  const pose = { ...controllerPose(object.asset, frame, startFrame), ...draftPose };
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!object.asset.proxyPath || !window.abaco) return;
      const metadata = object.asset.sourcePath
        ? await window.abaco.ensureBlendAssetProxy({ sourcePath: object.asset.sourcePath, proxyPath: object.asset.proxyPath })
        : undefined;
      if (active && metadata?.controllers) setPoseControllers(metadata.controllers);
      if (metadata && (
        JSON.stringify(metadata.controllers ?? []) !== JSON.stringify(object.asset.controllers ?? [])
        || metadata.previewScale !== object.asset.previewScale || metadata.groundOffset !== object.asset.groundOffset || metadata.boundsCenter.some((value, index) => value !== object.asset.boundsCenter[index])
      )) {
        const current = useEditor.getState().project.objects.find((item) => item.id === object.id);
        if (current) updateObject(object.id, { asset: {
          ...current.asset, boundsCenter: metadata.boundsCenter, previewScale: metadata.previewScale,
          groundOffset: metadata.groundOffset, controllers: metadata.controllers,
        } });
      }
      const value = await window.abaco.loadAsset(object.asset.proxyPath);
      if (active) setSource(value);
    };
    load().catch((error) => { if (active) setLoadError(error instanceof Error ? error.message.split('\n')[0] : 'Character preview unavailable'); });
    return () => { active = false; };
  }, [object.asset.proxyPath, object.asset.sourcePath]);
  if (!source) return <group><AssetPlaceholder />{loadError && <Html center><span className="character-handle-label">{loadError}</span></Html>}</group>;
  return <>
    <BackgroundAssetBoundary resetKey={object.asset.proxyPath} fallback={<group><AssetPlaceholder /><Html center><span className="character-handle-label">Character preview unavailable</span></Html></group>}>
      <Suspense fallback={<AssetPlaceholder />}><BlendAssetModel source={source} object={object} controllers={poseControllers} pose={pose} /></Suspense>
    </BackgroundAssetBoundary>
    {selected && onDragChange && poseControllers.filter((controller) => controller.worldPosition && controller.morphTargets?.length).map((controller) => <CharacterHandle key={controller.name} object={object} controller={controller} previewOffset={pose[controller.name] ?? [0, 0, 0]} onPreviewOffset={(name, offset) => setDraftPose((current) => { const next = { ...current }; if (offset) next[name] = offset; else delete next[name]; return next; })} onDragChange={onDragChange} />)}
  </>;
}

export function SceneBackground({ kind, path }: { kind: 'none' | 'image' | 'model'; path: string }) {
  const [source, setSource] = useState<string>();
  const [obj, setObj] = useState<{ source: string; materials?: string }>();
  useEffect(() => {
    let active = true;
    setSource(undefined);
    setObj(undefined);
    if (kind !== 'none' && path) {
      if (window.abaco && kind === 'model') window.abaco.loadModel(path).then((value) => {
        if (!active) return;
        if (value.format === 'obj') setObj(value);
        else setSource(value.source);
      }).catch(() => undefined);
      else if (window.abaco) window.abaco.loadAsset(path).then((value) => { if (active && value) setSource(value); }).catch(() => undefined);
      else setSource(path);
    }
    return () => { active = false; };
  }, [kind, path]);
  if (!source && !obj) return null;
  return <BackgroundAssetBoundary resetKey={`${kind}:${path}`}><Suspense fallback={null}>{kind === 'image' && source ? <ImageBackground source={source} /> : obj ? <ObjBackground source={obj.source} materials={obj.materials} /> : source ? <ModelBackground source={source} /> : null}</Suspense></BackgroundAssetBoundary>;
}

function CameraBackLogo() {
  const texture = useLoader(THREE.TextureLoader, headerLogo);
  return <mesh position={[0, 0, .596]}>
    <planeGeometry args={[.54, .154]} />
    <meshBasicMaterial map={texture} alphaMap={texture} color="#909090" transparent opacity={.35} depthWrite={false} />
  </mesh>;
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
    <Suspense fallback={null}><CameraBackLogo /></Suspense>
    <mesh position={[0, 0, .03]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.2, .29, .38, 24]} /><meshStandardMaterial color="#3c3c39" roughness={.3} /></mesh>
    <mesh position={[0, .36, .46]}><boxGeometry args={[.34, .18, .22]} /><meshStandardMaterial color="#858077" /></mesh>
    {corners.map((corner, index) => <Line key={index} points={[origin, corner]} color="#d9ad32" lineWidth={1.25} depthTest={false} transparent opacity={.82} />)}
    <Line points={[...corners, corners[0]]} color="#d9ad32" lineWidth={1.5} depthTest={false} transparent opacity={.88} />
    <Line points={[origin, [0, 0, -depth - .6]]} color="#b55d55" lineWidth={1.4} depthTest={false} transparent opacity={.82} />
    <mesh position={[0, 0, -depth]}><planeGeometry args={[halfWidth * 2, halfHeight * 2]} /><meshBasicMaterial color="#d9ad32" transparent opacity={.045} side={THREE.DoubleSide} depthWrite={false} /></mesh>
  </group>;
}

function MeshVisual({ object, hideText = false, onDragChange }: { object: SceneObject; hideText?: boolean; onDragChange?: (value: boolean) => void }) {
  const material = <meshStandardMaterial color={object.color} roughness={0.62} metalness={0.02} />;
  switch (object.kind) {
    case 'cube': return <mesh castShadow>{material}<boxGeometry args={[2, 2, 2]} /></mesh>;
    case 'sphere': return <mesh castShadow>{material}<sphereGeometry args={[1, 32, 18]} /></mesh>;
    case 'cylinder': return <mesh castShadow>{material}<cylinderGeometry args={[1, 1, 2, 32]} /></mesh>;
    case 'cone': return <mesh castShadow>{material}<coneGeometry args={[1, 2, 32]} /></mesh>;
    case 'plane': return <mesh receiveShadow>{material}<planeGeometry args={[2, 2]} /></mesh>;
    case 'text': return <Text visible={!hideText} color={object.color} fontSize={1} anchorX="center" anchorY="middle">{object.text}</Text>;
    case 'blend_asset': return <BlendAssetVisual object={object} onDragChange={onDragChange} />;
    case 'camera': return <CameraVisual object={object} />;
    case 'area_light': return <mesh><circleGeometry args={[.7, 28]} /><meshBasicMaterial color={object.color} side={THREE.DoubleSide} /></mesh>;
    case 'point_light': return <mesh><sphereGeometry args={[.28, 16, 12]} /><meshBasicMaterial color={object.color} /></mesh>;
    case 'sun_light': return <group><mesh><sphereGeometry args={[.32, 16, 12]} /><meshBasicMaterial color={object.color} /></mesh><axesHelper args={[1.2]} /></group>;
  }
}

function SceneItem({ object, cameraView, objectControls, interactionEnabled = true, onDragChange }: { object: SceneObject; cameraView: boolean; objectControls: RefObject<TransformControlsImpl | null>; interactionEnabled?: boolean; onDragChange(value: boolean): void }) {
  const ref = useRef<THREE.Group>(null);
  const translationProxy = useRef<THREE.Group>(null);
  const viewCamera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const selectionOutline = useRef<THREE.BoxHelper | null>(null);
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
  const selectedIds = useEditor((state) => state.selectedIds);
  const multiSelectMode = useEditor((state) => state.multiSelectMode);
  const selectedMotion = useEditor((state) => state.selectedMotion);
  const recordingSession = useEditor((state) => state.recordingSession);
  const mode = useEditor((state) => state.gizmoMode);
  const select = useEditor((state) => state.select);
  const selectMember = useEditor((state) => state.selectMember);
  const toggleSelection = useEditor((state) => state.toggleSelection);
  const setTransform = useEditor((state) => state.setTransform);
  const updateObject = useEditor((state) => state.updateObject);
  const setPlaying = useEditor((state) => state.setPlaying);
  const [textEditing, setTextEditing] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const transform = evaluateTransform(object, currentFrame);
  const text = evaluateProperty(object, 'text', currentFrame) as string;
  const visible = object.kind === 'camera' || evaluateProperty(object, 'visibility', currentFrame) as boolean;
  const helperOnly = object.kind === 'camera' || object.kind.includes('light');
  const helperSelected = selectedIds.includes(object.id) || selectedMotion?.objectId === object.id;
  useEffect(() => {
    if (!helperSelected || !visible || !ref.current || object.kind === 'camera' || object.kind === 'blend_asset' || object.kind.includes('light')) return;
    const outline = new THREE.BoxHelper(ref.current, 0xd8ab35);
    outline.material.depthTest = false;
    outline.renderOrder = 30;
    scene.add(outline);
    selectionOutline.current = outline;
    return () => { scene.remove(outline); outline.geometry.dispose(); outline.material.dispose(); if (selectionOutline.current === outline) selectionOutline.current = null; };
  }, [helperSelected, object.kind, scene, visible]);
  useFrame(() => selectionOutline.current?.update());
  const motionEditing = Boolean(selectedMotion);
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
    const threshold = .22;
    const snapToGround = (candidate: THREE.Vector3) => {
      const targetZ = groundedPositionZ(object, evaluateTransform(object, state.currentFrame));
      if (Math.abs(candidate.z - targetZ) <= .35) candidate.z = targetZ;
      return candidate;
    };
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
      return snapToGround(new THREE.Vector3(...fromCameraSpace(local, cameraPose)));
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
    return snapToGround(snapped);
  };

  const commit = (snap = true) => {
    if (!ref.current) return;
    if (snap && mode === 'translate') ref.current.position.copy(snapToOtherObjects(ref.current.position));
    const maximumScale = object.kind === 'plane' ? 12 : 20;
    if (object.kind === 'plane') ref.current.scale.z = 1;
    const result: Transform = {
      position: ref.current.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
      rotation: [ref.current.rotation.x, ref.current.rotation.y, ref.current.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'],
      scale: ref.current.scale.toArray().map((value, axis) => object.kind === 'plane' && axis === 2 ? 1 : THREE.MathUtils.clamp(Number(value.toFixed(4)), .05, maximumScale)) as Transform['scale'],
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
    if ((multiSelectMode || event.nativeEvent.metaKey || event.nativeEvent.ctrlKey) && event.button === 0) {
      event.stopPropagation(); toggleSelection(object.id); return;
    }
    // Shift riserva sempre il gesto alla vista, anche sopra un oggetto.
    // I gesti touch vengono lasciati a OrbitControls, che riconosce le due dita.
    if (event.button !== 0 || event.nativeEvent.shiftKey || event.nativeEvent.pointerType === 'touch' || !ref.current || gizmoDragging.current) return;
    // Reserve the gesture even if an object is closer than the overlaid arrow.
    if (hitsTransformHandle(objectControls.current, event.ray)) return;
    // Se il gizmo e l'oggetto sono sovrapposti, soltanto l'intersezione piu'
    // vicina deve gestire il gesto. In caso contrario i due controlli scrivono
    // contemporaneamente la stessa trasformazione e la rotazione sembra fermarsi.
    const nearest = event.intersections[0]?.object;
    if (nearest && nearest !== ref.current && !ref.current.getObjectById(nearest.id)) return;
    event.stopPropagation(); select(object.id); if (!recordingSession) setPlaying(false);
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
        THREE.MathUtils.clamp(drag.scale.x * factor, .05, object.kind === 'plane' ? 12 : 20),
        THREE.MathUtils.clamp(drag.scale.y * factor, .05, object.kind === 'plane' ? 12 : 20),
        object.kind === 'plane' ? 1 : THREE.MathUtils.clamp(drag.scale.z * factor, .05, 20),
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
    // An unrestricted snap could move the two axes the user did not drag.
    commit(false);
    setDragging(false);
    onDragChange(false);
  };
  const startGizmoDrag = () => {
    if (gizmoDragging.current) return;
    if (!recordingSession) setPlaying(false);
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

  const commitTextEdit = () => { updateObject(object.id, { text: textDraft }); setTextEditing(false); };
  const visual = <group ref={ref} position={transform.position} rotation={transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={transform.scale} visible={visible && (!helperOnly || (object.kind === 'camera' && !cameraView) || (helperSelected && !cameraView))}
      onPointerOver={motionEditing ? undefined : (event) => { if (!interactionEnabled) return; event.stopPropagation(); setCursor(event, 'grab'); }} onPointerOut={motionEditing ? undefined : (event) => { if (interactionEnabled && !dragging) setCursor(event, 'default'); }}
      onDoubleClick={(event) => { event.stopPropagation(); selectMember(object.id); if (object.kind === 'text') { setTextDraft(text); setTextEditing(true); } }}
      onClick={motionEditing ? undefined : (event) => { if (cameraView && !interactionEnabled) { event.stopPropagation(); select(object.id); } }}
      onPointerDown={motionEditing ? undefined : startDirectDrag} onPointerMove={motionEditing ? undefined : moveDirectDrag} onPointerUp={motionEditing ? undefined : finishDirectDrag} onPointerCancel={motionEditing ? undefined : finishDirectDrag}>
      <MeshVisual object={shown} hideText={textEditing} onDragChange={onDragChange} />
      {textEditing && <Html center zIndexRange={[100, 0]}>
        <textarea className="viewport-text-editor" aria-label={`Edit ${object.name}`} autoFocus value={textDraft} onChange={(event) => setTextDraft(event.target.value)} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setTextDraft(text); setTextEditing(false); }
          else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitTextEdit(); }
        }} />
      </Html>}
    </group>;

  // Durante il trascinamento diretto non montiamo il gizmo appena l'oggetto
  // diventa selezionato: due controller sullo stesso gruppo causavano blocchi
  // e salti soprattutto durante la scala.
  if (!interactionEnabled || motionEditing || directDrag.current || selectedId !== object.id || !visible || (cameraView && helperOnly) || (helperOnly && object.kind !== 'camera') || (object.kind === 'blend_asset' && !!object.asset.controllers?.length)) return visual;
  return <>{visual}<group ref={translationProxy} /><TransformControls ref={objectControls} object={(viewTranslation ? translationProxy : ref) as unknown as RefObject<THREE.Object3D>} mode={mode} space={viewTranslation || mode === 'rotate' ? 'local' : 'world'} size={1.2} enabled
    showZ={!viewTranslation && !(object.kind === 'plane' && mode === 'scale')}
    onObjectChange={() => {
      if (!ref.current) return;
      if (mode === 'translate' && viewTranslation && translationProxy.current) ref.current.position.copy(translationProxy.current.position);
      if (mode === 'scale' && object.kind === 'plane') {
        ref.current.scale.x = THREE.MathUtils.clamp(ref.current.scale.x, .05, 12);
        ref.current.scale.y = THREE.MathUtils.clamp(ref.current.scale.y, .05, 12);
        ref.current.scale.z = 1;
      }
      // Lo snap viene applicato una sola volta al rilascio. Applicarlo a ogni
      // pixel tratteneva l'oggetto sulla soglia e dava l'impressione di blocco.
    }}
    onMouseDown={startGizmoDrag}
    onMouseUp={finishGizmoDrag} /></>;
}

function CameraViewControls({ syncKey, target, controls }: {
  syncKey: string;
  target: Transform['position'];
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!controls.current) return;
    camera.up.set(0, 0, 1);
    controls.current.target.set(...target);
    controls.current.update();
  }, [camera, syncKey]);

  // The camera is driven by trackpad and keyboard so pointer events remain free
  // for selecting and transforming objects directly in camera view.
  return <OrbitControls ref={controls} makeDefault enabled={false} enableDamping={false} enableZoom={false} enableRotate={false} enablePan={false} />;
}

export const ShotCamera = memo(function ShotCamera({ object, aspect, frame: frameOverride, frameHeightRatio = 1, lockTransform = false }: { object: SceneObject; aspect: number; frame?: number; frameHeightRatio?: number; lockTransform?: boolean }) {
  const frame = useEditor((state) => frameOverride ?? state.currentFrame);
  const transform = evaluateTransform(object, frame);
  const lockedTransform = useRef(transform);
  if (!lockTransform) lockedTransform.current = transform;
  const cameraTransform = lockTransform ? lockedTransform.current : transform;
  const lens = evaluateProperty(object, 'lens', frame) as number;
  const sensorHeight = 36 / aspect;
  const frameFov = 2 * Math.atan(sensorHeight / (2 * lens));
  // In camera view the canvas also shows the workspace outside the exported frame.
  // Widen its vertical field of view so the rectangle still contains exactly the
  // same composition as thumbnails and exports.
  const safeFrameHeightRatio = THREE.MathUtils.clamp(frameHeightRatio, .1, 1);
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(frameFov / 2) / safeFrameHeightRatio));
  return <PerspectiveCamera makeDefault position={cameraTransform.position} rotation={cameraTransform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} up={[0, 0, 1]} fov={fov} near={0.01} far={1000} />;
});

const loadThumbnailImage = (source: string) => new Promise<HTMLImageElement | undefined>((resolve) => {
  if (!source) return resolve(undefined);
  const image = new window.Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(undefined);
  image.src = source;
});

function ThumbnailEmitter({ projectId, sceneId, revision, objects, frame, onCaptured }: { projectId: string; sceneId: string; revision: string; objects: SceneObject[]; frame: number; onCaptured?(): void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    let cancelled = false;
    invalidate();
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      invalidate();
      secondFrame = window.requestAnimationFrame(() => {
        invalidate();
        void (async () => {
          const source = gl.domElement;
          const output = document.createElement('canvas');
          output.width = source.width;
          output.height = source.height;
          const context = output.getContext('2d');
          if (!context) { onCaptured?.(); return; }
          context.drawImage(source, 0, 0);
          const frameScale = output.width / 1280;
          for (const object of objects.filter((item) => item.screenSpace && evaluateProperty(item, 'visibility', frame))) {
            const transform = evaluateTransform(object, frame);
            const scale = Math.max(.1, transform.scale[0]) * frameScale;
            const x = (transform.position[0] + 1) * output.width / 2;
            const y = (1 - transform.position[2]) * output.height / 2;
            context.save();
            context.translate(x, y);
            context.rotate(THREE.MathUtils.degToRad(transform.rotation[2]));
            if (object.kind === 'text') {
              const lines = String(evaluateProperty(object, 'text', frame)).split('\n');
              const fontSize = 34 * scale;
              context.font = `650 ${fontSize}px system-ui, sans-serif`;
              context.textAlign = 'center';
              context.textBaseline = 'middle';
              context.fillStyle = object.color;
              context.shadowColor = 'rgba(0,0,0,.45)';
              context.shadowBlur = Math.max(1, 3 * frameScale);
              lines.forEach((line, index) => context.fillText(line, 0, (index - (lines.length - 1) / 2) * fontSize * 1.08));
            } else {
              const image = await loadThumbnailImage(object.asset.proxyPath);
              if (image) {
                const width = 260 * scale;
                const height = width * image.naturalHeight / Math.max(1, image.naturalWidth);
                const [top, right, bottom, left] = object.screenCrop;
                const sourceX = image.naturalWidth * left, sourceY = image.naturalHeight * top;
                const sourceWidth = image.naturalWidth * Math.max(.01, 1 - left - right);
                const sourceHeight = image.naturalHeight * Math.max(.01, 1 - top - bottom);
                context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, -width / 2 + width * left, -height / 2 + height * top, width * (1 - left - right), height * (1 - top - bottom));
              }
            }
            context.restore();
          }
          if (cancelled) return;
          const url = output.toDataURL('image/jpeg', .76);
          window.dispatchEvent(new CustomEvent('abaco:scene-thumbnail', { detail: { projectId, sceneId, revision, url } }));
          onCaptured?.();
        })().catch(() => { if (!cancelled) onCaptured?.(); });
      });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
  }, [frame, gl, invalidate, objects, onCaptured, projectId, revision, sceneId]);
  return null;
}

export function ThumbnailItem({ object, frame }: { object: SceneObject; frame: number }) {
  const transform = evaluateTransform(object, frame);
  const shown = { ...object, text: evaluateProperty(object, 'text', frame) as string };
  if (!evaluateProperty(object, 'visibility', frame)) return null;
  return <group position={transform.position} rotation={transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={transform.scale}><MeshVisual object={shown} /></group>;
}

const thumbnailRevision = (scene: CameraCut, objects: SceneObject[]) => {
  const frame = scene.frame;
  return `${frame}:${JSON.stringify(scene)}:${objects.map((object) => `${object.id}:${object.kind}:${object.color}:${object.screenSpace}:${JSON.stringify(evaluateTransform(object, frame))}:${evaluateProperty(object, 'visibility', frame)}:${evaluateProperty(object, 'text', frame)}:${object.asset.proxyPath}:${object.screenCrop.join(',')}`).join('|')}`;
};

function SceneThumbnailRenderer({ projectId, scene, objects, aspect, dark, onCaptured }: { projectId: string; scene: CameraCut; objects: SceneObject[]; aspect: number; dark: boolean; onCaptured(): void }) {
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const recoverRenderer = useMemo(() => () => setRendererGeneration((value) => value + 1), []);
  const frame = scene.frame;
  const camera = objects.find((object) => object.id === scene.cameraId && object.kind === 'camera');
  if (!camera) return null;
  const lightingStyle = { neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 }, warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 } }[scene.lighting.preset];
  const angle = THREE.MathUtils.degToRad(scene.lighting.direction);
  const elevation = THREE.MathUtils.degToRad(scene.lighting.elevation);
  const radius = Math.cos(elevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(angle) * radius, -Math.cos(angle) * radius, 1.5 + Math.sin(elevation) * 9];
  const revision = thumbnailRevision(scene, objects);
  return <div className="thumbnail-renderer" style={{ aspectRatio: String(aspect) }}><Canvas key={rendererGeneration} frameloop="demand" dpr={1} gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <WebGLContextGuard onLost={recoverRenderer} />
    <color attach="background" args={[dark ? '#3d3d3d' : '#f1f1ef']} />
    <SceneBackground kind={scene.background?.kind ?? 'none'} path={scene.background?.path ?? ''} />
    <ambientLight intensity={lightingStyle.ambient * Math.max(.2, scene.lighting.intensity)} />
    <directionalLight color={scene.lighting.color} position={lightPosition} intensity={lightingStyle.key * scene.lighting.intensity} />
    {objects.filter((object) => object.kind !== 'audio' && !object.screenSpace && object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <ThumbnailItem key={object.id} object={object} frame={frame} />)}
    <ShotCamera object={camera} aspect={aspect} frame={frame} />
    <ThumbnailEmitter projectId={projectId} sceneId={scene.id} revision={revision} objects={objects} frame={frame} onCaptured={onCaptured} />
  </Canvas></div>;
}

function SceneThumbnailQueue({ projectId, scenes, objects, aspect, dark }: { projectId: string; scenes: CameraCut[]; objects: SceneObject[]; aspect: number; dark: boolean }) {
  const signature = scenes.map((scene) => `${scene.id}:${thumbnailRevision(scene, objects)}`).join('||');
  const [job, setJob] = useState({ signature, index: 0 });
  useEffect(() => {
    if (job.signature !== signature) setJob({ signature, index: 0 });
  }, [job.signature, signature]);
  const index = job.signature === signature ? job.index : 0;
  const scene = scenes[index];
  const complete = useMemo(() => () => setJob((current) => current.signature === signature ? { ...current, index: current.index + 1 } : current), [signature]);
  if (!scene) return null;
  return <div className="thumbnail-renderers" aria-hidden="true"><SceneThumbnailRenderer projectId={projectId} scene={scene} objects={objects} aspect={aspect} dark={dark} onCaptured={complete} /></div>;
}

function LiveCameraPreview({ scene, camera, objects, aspect, dark, onOpen, onFind }: { scene: CameraCut; camera: SceneObject; objects: SceneObject[]; aspect: number; dark: boolean; onOpen(): void; onFind(): void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const recoverRenderer = useMemo(() => () => setRendererGeneration((value) => value + 1), []);
  const frame = useEditor((state) => state.currentFrame);
  const lightingStyle = { neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 }, warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 } }[scene.lighting.preset];
  const angle = THREE.MathUtils.degToRad(scene.lighting.direction);
  const elevation = THREE.MathUtils.degToRad(scene.lighting.elevation);
  const radius = Math.cos(elevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(angle) * radius, -Math.cos(angle) * radius, 1.5 + Math.sin(elevation) * 9];
  if (collapsed) return <button className="live-camera-preview-collapsed" title="Expand camera preview" aria-label="Expand camera preview" onClick={() => setCollapsed(false)}><Video size={15} /></button>;
  return <div className="live-camera-preview" style={{ width: aspect < 1 ? 'clamp(92px, 14%, 128px)' : undefined }}>
    <button className="live-camera-preview-open" onClick={onOpen} title="Open camera view" aria-label="Open camera preview">
    <div className="live-camera-preview-canvas" style={{ aspectRatio: String(aspect) }}><Canvas key={rendererGeneration} frameloop="demand" dpr={1} gl={{ antialias: true }}>
      <WebGLContextGuard onLost={recoverRenderer} />
      <color attach="background" args={[dark ? '#353535' : '#f1f1ef']} />
      <SceneBackground kind={scene.background?.kind ?? 'none'} path={scene.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, scene.lighting.intensity)} />
      <directionalLight color={scene.lighting.color} position={lightPosition} intensity={lightingStyle.key * scene.lighting.intensity} />
      {objects.filter((object) => object.kind !== 'audio' && !object.screenSpace && object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <ThumbnailItem key={object.id} object={object} frame={frame} />)}
      <ShotCamera object={camera} aspect={aspect} frame={frame} />
    </Canvas><ReadonlyScreenLayers objects={objects} frame={frame} /></div></button>
    <button className="live-camera-preview-find" title="Find camera" aria-label="Find camera" onClick={onFind}><Focus size={13} /></button>
    <button className="live-camera-preview-collapse" title="Collapse camera preview" aria-label="Collapse camera preview" onClick={() => setCollapsed(true)}><Minimize2 size={13} /></button>
  </div>;
}

export function ScreenAssetImage({ source, name = '' }: { source: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  if (failed || !source) return <div className="screen-image-missing" title={name ? `Image unavailable: ${name}` : 'Image unavailable'}><ImageOff aria-hidden="true" /></div>;
  return <img src={source} alt={name} draggable={false} onError={() => setFailed(true)} />;
}

export function ReadonlyScreenLayers({ objects, frame }: { objects: SceneObject[]; frame: number }) {
  return <div className="preview-screen-layers">
    {objects.filter((object) => object.screenSpace && evaluateProperty(object, 'visibility', frame)).map((object) => {
      const transform = evaluateTransform(object, frame);
      const crop = object.screenCrop;
      const style = {
        left: `${(transform.position[0] + 1) * 50}%`,
        top: `${(1 - transform.position[2]) * 50}%`,
        transform: `translate(-50%, -50%) rotate(${transform.rotation[2]}deg)`,
        '--layer-scale': String(Math.max(.1, transform.scale[0])),
      } as CSSProperties;
      return <div key={object.id} className="preview-screen-layer" style={style}><div className="screen-layer-content" style={{ clipPath: `inset(${crop[0] * 100}% ${crop[1] * 100}% ${crop[2] * 100}% ${crop[3] * 100}%)` }}>
        {object.kind === 'text' ? <span style={{ color: object.color }}>{evaluateProperty(object, 'text', frame) as string}</span> : <ScreenAssetImage source={object.asset.proxyPath} name={object.name} />}
      </div></div>;
    })}
  </div>;
}

function ScreenSpaceLayers({ objects, frame, width, height }: { objects: SceneObject[]; frame: number; width: number; height: number }) {
  const select = useEditor((state) => state.select);
  const selectedId = useEditor((state) => state.selectedId);
  const setTransform = useEditor((state) => state.setTransform);
  const [interaction, setInteraction] = useState<{ id: string; mode: 'move' | 'resize' | 'rotate'; x: number; y: number; centerX: number; centerY: number; distance: number; angle: number; transform: Transform }>();
  const [preview, setPreview] = useState<{ id: string; transform: Transform }>();
  const previewRef = useRef<{ id: string; transform: Transform } | undefined>(undefined);
  const visible = objects.filter((object) => object.screenSpace && evaluateProperty(object, 'visibility', frame));
  useEffect(() => {
    if (!interaction) return;
    const move = (event: PointerEvent) => {
      const start = interaction.transform;
      const dx = event.clientX - interaction.x, dy = event.clientY - interaction.y;
      if (Math.hypot(dx, dy) < 4) return;
      let transform: Transform;
      if (interaction.mode === 'move') {
        const x = THREE.MathUtils.clamp(start.position[0] + (dx * 2) / width, -1.6, 1.6);
        const z = THREE.MathUtils.clamp(start.position[2] - (dy * 2) / height, -1.6, 1.6);
        transform = { ...start, position: [x, start.position[1], z] };
      } else if (interaction.mode === 'resize') {
        const distance = Math.max(8, Math.hypot(event.clientX - interaction.centerX, event.clientY - interaction.centerY));
        const scale = Math.max(.1, Math.min(8, start.scale[0] * distance / interaction.distance));
        transform = { ...start, scale: [scale, scale, scale] };
      } else {
        const angle = Math.atan2(event.clientY - interaction.centerY, event.clientX - interaction.centerX);
        const rotation = [...start.rotation] as Vec3;
        rotation[2] = start.rotation[2] + THREE.MathUtils.radToDeg(angle - interaction.angle);
        transform = { ...start, rotation };
      }
      previewRef.current = { id: interaction.id, transform };
      setPreview(previewRef.current);
    };
    const finish = () => {
      const result = previewRef.current;
      if (result?.id === interaction.id) setTransform(result.id, result.transform);
      previewRef.current = undefined;
      setPreview(undefined);
      setInteraction(undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    window.addEventListener('blur', finish, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); window.removeEventListener('blur', finish); };
  }, [height, interaction, setTransform, width]);
  const begin = (event: ReactPointerEvent<HTMLElement>, object: SceneObject, mode: 'move' | 'resize' | 'rotate') => {
    event.preventDefault(); event.stopPropagation(); select(object.id);
    const layer = (event.currentTarget.closest('.screen-space-layer') ?? event.currentTarget) as HTMLElement;
    const rect = layer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    const transform = evaluateTransform(object, frame);
    previewRef.current = { id: object.id, transform };
    setPreview(previewRef.current);
    setInteraction({ id: object.id, mode, x: event.clientX, y: event.clientY, centerX, centerY, distance: Math.max(8, Math.hypot(event.clientX - centerX, event.clientY - centerY)), angle: Math.atan2(event.clientY - centerY, event.clientX - centerX), transform });
  };
  return <div className="screen-space-layers" style={{ width, height }}>
    {visible.map((object) => {
      const transform = preview?.id === object.id ? preview.transform : evaluateTransform(object, frame);
      const crop = object.screenCrop;
      const style = { left: `${(transform.position[0] + 1) * 50}%`, top: `${(1 - transform.position[2]) * 50}%`, transform: `translate(-50%, -50%) rotate(${transform.rotation[2]}deg)`, '--layer-scale': String(Math.max(.1, transform.scale[0])) } as CSSProperties;
      const selected = selectedId === object.id;
      return <div key={object.id} className={`screen-space-layer ${selected ? 'selected' : ''}`} style={style} onPointerDown={(event) => begin(event, object, 'move')}>
        <div className="screen-layer-content" style={{ clipPath: `inset(${crop[0] * 100}% ${crop[1] * 100}% ${crop[2] * 100}% ${crop[3] * 100}%)` }}>{object.kind === 'text' ? <span style={{ color: object.color }}>{evaluateProperty(object, 'text', frame) as string}</span> : <ScreenAssetImage source={object.asset.proxyPath} name={object.name} />}</div>
        {selected && <><i className="screen-rotate-stem" /><button className="screen-rotate-handle" aria-label="Rotate layer" onPointerDown={(event) => begin(event, object, 'rotate')} />{['nw', 'ne', 'se', 'sw'].map((corner) => <button key={corner} className={`screen-resize-handle ${corner}`} aria-label="Resize layer" onPointerDown={(event) => begin(event, object, 'resize')} />)}</>}
      </div>;
    })}
  </div>;
}

function MotionPointHandle({ objectId, keyframe, selected, color, selectedColor, onSelect, onDragChange }: { objectId: string; keyframe: Keyframe; selected: boolean; color: string; selectedColor: string; onSelect(): void; onDragChange(value: boolean): void }) {
  const ref = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; start: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; worldPerPixel: number; moved: boolean } | undefined>(undefined);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const setPlaying = useEditor((state) => state.setPlaying);
  const updateMotionPoint = useEditor((state) => state.updateMotionPoint);
  const position = keyframe.value as Vec3;
  useEffect(() => () => dragCleanup.current?.(), []);
  useFrame(({ camera, size }) => {
    if (!ref.current) return;
    const distance = Math.max(.01, camera.position.distanceTo(ref.current.position));
    const worldPerPixel = camera instanceof THREE.PerspectiveCamera
      ? (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, size.height)
      : (camera.top - camera.bottom) / Math.max(1, size.height);
    ref.current.scale.setScalar(worldPerPixel * (selected || hovered ? 22 : 18));
  });
  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || !ref.current) return;
    event.stopPropagation();
    setPlaying(false);
    event.camera.updateMatrixWorld();
    const forward = event.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(event.camera.matrixWorld, 1).normalize();
    const depth = Math.max(.5, Math.abs(ref.current.position.clone().sub(event.camera.position).dot(forward)));
    const canvasHeight = Math.max(1, (event.nativeEvent.target as HTMLElement | null)?.getBoundingClientRect?.().height ?? 600);
    const worldPerPixel = event.camera instanceof THREE.PerspectiveCamera ? (2 * depth * Math.tan(THREE.MathUtils.degToRad(event.camera.fov / 2))) / canvasHeight : 2 / canvasHeight;
    dragCleanup.current?.();
    drag.current = { pointerId: event.pointerId, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY, start: ref.current.position.clone(), right, up, worldPerPixel, moved: false };
    onDragChange(true);
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      if (dragCleanup.current === cleanup) dragCleanup.current = undefined;
    };
    const move = (pointer: PointerEvent) => {
      const state = drag.current;
      if (!state || state.pointerId !== pointer.pointerId || !ref.current) return;
      const dx = pointer.clientX - state.x, dy = pointer.clientY - state.y;
      if (Math.hypot(dx, dy) < 6) return;
      ref.current.position.copy(state.start).addScaledVector(state.right, dx * state.worldPerPixel).addScaledVector(state.up, -dy * state.worldPerPixel);
      state.moved = true;
    };
    const finish = (pointer?: PointerEvent | Event) => {
      const state = drag.current;
      if (!state || (pointer instanceof PointerEvent && state.pointerId !== pointer.pointerId)) return;
      cleanup();
      dragCleanup.current = undefined;
      drag.current = undefined;
      if (state.moved && ref.current) updateMotionPoint(objectId, keyframe.id, ref.current.position.toArray().map((value) => Number(value.toFixed(4))) as Vec3);
      else onSelect();
      onDragChange(false);
      document.body.style.cursor = hovered ? 'grab' : 'default';
    };
    dragCleanup.current = () => { cleanup(); drag.current = undefined; onDragChange(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    window.addEventListener('blur', finish, { once: true });
  };
  return <>
    <group ref={ref} position={position} renderOrder={24} onPointerDown={startDrag} onClick={(event) => { event.stopPropagation(); }} onDoubleClick={(event) => { event.stopPropagation(); }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'grab'; }} onPointerOut={() => { setHovered(false); if (!drag.current) document.body.style.cursor = 'default'; }}>
      <Billboard follow>
        {(hovered || selected) && <mesh rotation={[0, 0, Math.PI / 4]} scale={1.42} renderOrder={24}><planeGeometry args={[1, 1]} /><meshBasicMaterial color={hovered ? '#fff2a6' : selectedColor} transparent opacity={.46} depthTest={false} depthWrite={false} side={THREE.DoubleSide} /></mesh>}
        <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={25}><planeGeometry args={[1, 1]} /><meshBasicMaterial color={hovered ? '#fff7c9' : selected ? selectedColor : color} depthTest={false} depthWrite={false} side={THREE.DoubleSide} /></mesh>
        <mesh renderOrder={26}><circleGeometry args={[1.2, 16]} /><meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      </Billboard>
    </group>
  </>;
}

function MotionPath({ objectId, sceneId, keyframes, points, pointFrames, color = '#ef3f3f', selectedColor = '#b41622', editable = false, onDragChange }: { objectId: string; sceneId: string; keyframes: Keyframe[]; points: Transform['position'][]; pointFrames: number[]; color?: string; selectedColor?: string; editable?: boolean; onDragChange(value: boolean): void }) {
  const [selectedPointId, setSelectedPointId] = useState<string>();
  const deleteMotionPoint = useEditor((state) => state.deleteMotionPoint);
  const insertMotionPoint = useEditor((state) => state.insertMotionPoint);
  const select = useEditor((state) => state.select);
  const selectMotion = useEditor((state) => state.selectMotion);
  const setFrame = useEditor((state) => state.setFrame);
  const setPlaying = useEditor((state) => state.setPlaying);
  const isCameraMotion = useEditor((state) => state.project.objects.find((object) => object.id === objectId)?.kind === 'camera');
  const directionMarkers = useMemo(() => {
    if (points.length < 3) return [];
    const interval = Math.max(2, Math.floor(points.length / 5));
    const markers: Array<{ position: Vec3; quaternion: [number, number, number, number] }> = [];
    for (let index = interval; index < points.length; index += interval) {
      const from = new THREE.Vector3(...points[Math.max(0, index - 1)]);
      const to = new THREE.Vector3(...points[index]);
      const direction = to.clone().sub(from);
      if (direction.lengthSq() < .0001) continue;
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      markers.push({ position: from.lerp(to, .5).toArray() as Vec3, quaternion: quaternion.toArray() as [number, number, number, number] });
    }
    return markers;
  }, [points]);
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
  const selectPathPoint = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 0 || !points.length) return;
    event.stopPropagation(); setPlaying(false); if (!isCameraMotion) select(objectId); selectMotion({ objectId, sceneId });
    const clicked = event.point;
    let nearestIndex = 0, nearestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = clicked.distanceToSquared(new THREE.Vector3(...point));
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });
    const frame = pointFrames[nearestIndex] ?? pointFrames[0];
    if (frame === undefined) return;
    const existingPoint = keyframes.reduce<Keyframe | undefined>((nearest, keyframe) => !nearest || Math.abs(keyframe.frame - frame) < Math.abs(nearest.frame - frame) ? keyframe : nearest, undefined);
    const sampledRange = Math.max(1, (pointFrames.at(-1) ?? frame) - (pointFrames[0] ?? frame));
    const handleFrameTolerance = Math.max(3, Math.ceil(sampledRange / 120) * 2);
    if (existingPoint && Math.abs(existingPoint.frame - frame) <= handleFrameTolerance) {
      setSelectedPointId(existingPoint.id);
      selectMotion({ objectId, sceneId, keyframeId: existingPoint.id });
      setFrame(existingPoint.frame);
      return;
    }
    const id = insertMotionPoint(objectId, sceneId, frame, clicked.toArray().map((value) => Number(value.toFixed(4))) as Vec3);
    if (id) { setSelectedPointId(id); selectMotion({ objectId, sceneId, keyframeId: id }); setFrame(frame); }
  };
  if (points.length < 2) return null;
  return <group renderOrder={20}>
    <Line points={points} color={color} lineWidth={editable ? 3.4 : 2.8} depthTest={false} transparent opacity={editable ? .98 : .8} raycast={() => null} />
    <Line points={points} color={color} lineWidth={12} depthTest={false} transparent opacity={.001} onClick={selectPathPoint} onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = 'copy'; }} onPointerOut={() => { document.body.style.cursor = 'default'; }} />
    {directionMarkers.map((marker, index) => <mesh key={`direction-${index}`} position={marker.position} quaternion={marker.quaternion} renderOrder={23}><coneGeometry args={[.09, .28, 3]} /><meshBasicMaterial color={color} depthTest={false} transparent opacity={editable ? 1 : .78} /></mesh>)}
    {keyframes.map((keyframe) => <MotionPointHandle key={keyframe.id} objectId={objectId} keyframe={keyframe} selected={editable && selectedPointId === keyframe.id} color={color} selectedColor={selectedColor} onSelect={() => { setSelectedPointId(keyframe.id); select(isCameraMotion ? undefined : objectId); selectMotion({ objectId, sceneId, keyframeId: keyframe.id }); setFrame(keyframe.frame); }} onDragChange={onDragChange} />)}
  </group>;
}

function SelectionAiAnchor() {
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const object = useEditor((state) => state.project.objects.find((candidate) => candidate.id === state.selectedId
    && candidate.kind !== 'audio'
    && !candidate.kind.includes('light')
    && !candidate.screenSpace));
  const previous = useRef('');

  useEffect(() => () => { window.dispatchEvent(new CustomEvent('scene:ai-anchor', { detail: undefined })); }, []);
  useFrame(({ camera, size }) => {
    if (!selectedId || !object) {
      if (previous.current !== 'hidden') {
        previous.current = 'hidden';
        window.dispatchEvent(new CustomEvent('scene:ai-anchor', { detail: undefined }));
      }
      return;
    }
    const transform = evaluateTransform(object, frame);
    const scale = Math.max(...transform.scale.map(Math.abs), .5);
    const point = new THREE.Vector3(...transform.position);
    point.z += object.kind === 'camera' ? .55 : THREE.MathUtils.clamp(scale * .65, .45, 2.5);
    point.project(camera);
    const projectsIntoView = Number.isFinite(point.x) && Number.isFinite(point.y) && point.z >= -1 && point.z <= 1;
    const rawX = projectsIntoView ? (point.x * .5 + .5) * size.width : size.width * .5;
    const rawY = projectsIntoView ? (-point.y * .5 + .5) * size.height : size.height - 62;
    const x = Math.round(THREE.MathUtils.clamp(rawX, 18, size.width - 18));
    const y = Math.round(THREE.MathUtils.clamp(rawY, 28, size.height - 28));
    const side = x > size.width * .62 ? 'left' : 'right';
    const signature = `${selectedId}:${x}:${y}:${side}`;
    if (signature === previous.current) return;
    previous.current = signature;
    window.dispatchEvent(new CustomEvent('scene:ai-anchor', { detail: { x, y, side } }));
  });
  return null;
}

export default function Viewport({ dark = false }: { dark?: boolean }) {
  const projectId = useEditor((state) => state.project.id);
  const objects = useEditor((state) => state.project.objects);
  const cuts = useEditor((state) => state.project.cameraCuts);
  const settings = useEditor((state) => state.project.settings);
  const frame = useEditor((state) => state.currentFrame);
  const selectedMotion = useEditor((state) => state.selectedMotion);
  const recordingMotion = useEditor((state) => state.recordingMotion);
  const recordingSession = useEditor((state) => state.recordingSession);
  const select = useEditor((state) => state.select);
  const addObject = useEditor((state) => state.addObject);
  const selectedId = useEditor((state) => state.selectedId);
  const selectedIds = useEditor((state) => state.selectedIds);
  const multiSelectMode = useEditor((state) => state.multiSelectMode);
  const setMultiSelectMode = useEditor((state) => state.setMultiSelectMode);
  const groups = useEditor((state) => state.project.groups);
  const groupSelection = useEditor((state) => state.groupSelection);
  const ungroupSelection = useEditor((state) => state.ungroupSelection);
  const gizmoMode = useEditor((state) => state.gizmoMode);
  const setGizmoMode = useEditor((state) => state.setGizmoMode);
  const cameraView = useEditor((state) => state.cameraView);
  const setCameraView = useEditor((state) => state.setCameraView);
  const [cameraHintVisible, setCameraHintVisible] = useState(true);
  const [showMotionPaths, setShowMotionPaths] = useState(() => window.localStorage.getItem('scene-show-motion-paths') !== 'false');
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const recoverRenderer = useMemo(() => () => setRendererGeneration((value) => value + 1), []);
  const [draggingObject, setDraggingObject] = useState(false);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const objectControls = useRef<TransformControlsImpl | null>(null);
  const shotOrbitRef = useRef<OrbitControlsImpl | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraPanBuffer = useRef<{ x: number; y: number; persist: boolean; timer?: number }>({ x: 0, y: 0, persist: true });
  const cameraRotateBuffer = useRef<{ x: number; y: number; persist: boolean; timer?: number }>({ x: 0, y: 0, persist: true });
  const cameraCommitTimer = useRef<number | undefined>(undefined);
  const pendingCameraCommit = useRef<{ projectId: string; sceneId: string; frame: number; position: Vec3; rotation: Vec3; target: Vec3 } | undefined>(undefined);
  const shiftPressed = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0, left: 0 });
  useEffect(() => { window.localStorage.setItem('scene-show-motion-paths', String(showMotionPaths)); }, [showMotionPaths]);
  const hasContent = objects.some((object) => object.kind !== 'audio' && object.kind !== 'camera' && !object.kind.includes('light'));
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
  const visibleMotionPaths = useMemo(() => {
    if (!activeCut) return [];
    const sceneEnd = cuts.slice().sort((a, b) => a.frame - b.frame).find((cut) => cut.frame > activeCut.frame)?.frame ?? settings.frameEnd + 1;
    return objects.flatMap((object) => {
      if (object.kind === 'audio' || object.kind.includes('light') || object.screenSpace || (object.kind === 'camera' && object.id !== activeCut.cameraId)) return [];
      const positionKeys = object.keyframes.filter((key) => key.property === 'position' && key.frame >= activeCut.frame && key.frame < sceneEnd).sort((a, b) => a.frame - b.frame);
      const keys = [...new Map(positionKeys.map((key) => [key.frame, key])).values()];
      const handles = keys.filter((key) => key.purpose === 'motion' || (key.purpose === undefined && key.frame !== activeCut.frame));
      if (!handles.length || keys.length < 2) return [];
      const first = keys[0]!.frame, last = keys[keys.length - 1]!.frame;
      const step = Math.max(1, Math.ceil((last - first) / 120));
      const samples: Array<{ point: Vec3; frame: number }> = [];
      for (let sample = first; sample <= last; sample += step) samples.push({ point: evaluateTransform(object, sample).position, frame: sample });
      if ((last - first) % step) samples.push({ point: evaluateTransform(object, last).position, frame: last });
      const filtered = samples.filter((sample, index) => index === 0 || sample.point.some((value, axis) => Math.abs(value - samples[index - 1]!.point[axis]) > .0001));
      if (filtered.length < 2) return [];
      return [{ object, keyframes: handles, points: filtered.map((sample) => sample.point), pointFrames: filtered.map((sample) => sample.frame), sceneId: activeCut.id }];
    });
  }, [activeCut?.id, cuts, objects, settings.frameEnd]);
  const selectedObject = objects.find((object) => object.id === selectedId);
  const selectedGroup = groups.find((group) => group.memberIds.length === selectedIds.length && group.memberIds.every((id) => selectedIds.includes(id)));
  const canGroup = selectedIds.length > 1 && !selectedGroup && selectedIds.every((id) => {
    const object = objects.find((candidate) => candidate.id === id);
    return object && object.kind !== 'camera' && object.kind !== 'audio' && !object.kind.includes('light') && !object.screenSpace && !groups.some((group) => group.memberIds.includes(id));
  });
  const selectedTransformable = selectedObject && selectedObject.kind !== 'audio' && !selectedObject.kind.includes('light') && evaluateProperty(selectedObject, 'visibility', frame)
    ? selectedObject : undefined;
  const selectedSubject = selectedObject && selectedObject.kind !== 'audio' && selectedObject.kind !== 'camera' && !selectedObject.kind.includes('light') && evaluateProperty(selectedObject, 'visibility', frame)
    ? selectedObject : undefined;
  const framingSubject = selectedSubject ?? objects.find((object) => object.kind !== 'audio' && object.kind !== 'camera' && !object.kind.includes('light') && evaluateProperty(object, 'visibility', frame));
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
    if (state.project.id === pending.projectId && (state.currentFrame === pending.frame || state.recordingSession?.sceneId === pending.sceneId)) {
      state.setCameraFraming(pending.sceneId, pending.position, pending.rotation, pending.target);
    }
  };

  const flushCameraEdit = () => {
    if (cameraPanBuffer.current.timer) window.clearTimeout(cameraPanBuffer.current.timer);
    if (cameraRotateBuffer.current.timer) window.clearTimeout(cameraRotateBuffer.current.timer);
    cameraPanBuffer.current = { x: 0, y: 0, persist: true };
    cameraRotateBuffer.current = { x: 0, y: 0, persist: true };
    flushPendingCameraCommit();
  };

  useEffect(() => {
    window.addEventListener('abaco:flush-camera-edit', flushCameraEdit);
    return () => window.removeEventListener('abaco:flush-camera-edit', flushCameraEdit);
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
    cameraPanBuffer.current = { x: 0, y: 0, persist: true };
    cameraRotateBuffer.current = { x: 0, y: 0, persist: true };
    cameraCommitTimer.current = undefined;
    pendingCameraCommit.current = undefined;
  }, [cameraView, projectId]);

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
  const restoreSelectedPosition = () => {
    if (!selectedSubject) return;
    const current = evaluateTransform(selectedSubject, frame);
    const initial = evaluateTransform(selectedSubject, settings.frameStart);
    useEditor.getState().setTransform(selectedSubject.id, { ...current, position: structuredClone(initial.position) });
  };

  const scheduleCameraCommit = () => {
    // The keyboard RAF outlives scene changes. Resolve the destination when
    // sampling, not from the render captured when its listener was installed.
    const state = useEditor.getState();
    const scene = state.project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((cut) => cut.frame <= state.currentFrame);
    const controls = shotOrbitRef.current;
    if (!controls || !scene || !state.project.objects.some((object) => object.id === scene.cameraId && object.kind === 'camera')) return;
    const camera = controls.object;
    pendingCameraCommit.current = {
      projectId: state.project.id,
      sceneId: scene.id,
      frame: state.currentFrame,
      position: camera.position.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
      rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((value) => Number(THREE.MathUtils.radToDeg(value).toFixed(3))) as Transform['rotation'],
      target: controls.target.toArray().map((value) => Number(value.toFixed(4))) as Transform['position'],
    };
    const recording = Boolean(state.recordingSession);
    if (cameraCommitTimer.current) {
      if (recording) return;
      window.clearTimeout(cameraCommitTimer.current);
    }
    cameraCommitTimer.current = window.setTimeout(flushPendingCameraCommit, recording ? 240 : 180);
  };

  const panControlledView = (controls: OrbitControlsImpl | null, deltaX: number, deltaY: number) => {
    if (!controls) return;
    const camera = controls.object;
    camera.updateMatrixWorld();
    const distance = Math.max(.5, camera.position.distanceTo(controls.target));
    const fov = camera instanceof THREE.PerspectiveCamera ? THREE.MathUtils.degToRad(camera.fov) : THREE.MathUtils.degToRad(45);
    const worldPerPixel = (2 * distance * Math.tan(fov / 2)) / Math.max(1, stageRef.current?.clientHeight ?? 600);
    const gesture = trackpadCameraOffset(deltaX, deltaY);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(gesture.horizontal * worldPerPixel);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(gesture.vertical * worldPerPixel);
    camera.position.add(right).add(up); controls.target.add(right).add(up); controls.update();
  };

  const panShotView = (deltaX: number, deltaY: number, persist = true) => {
    if (!activeCamera) return;
    panControlledView(shotOrbitRef.current, deltaX, deltaY);
    if (persist) scheduleCameraCommit();
  };

  const tiltViewFromTrackpad = (controls: OrbitControlsImpl | null, deltaX: number, deltaY: number) => {
    if (!controls) return;
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
  };

  const tiltShotCameraFromTrackpad = (deltaX: number, deltaY: number, persist = true) => {
    if (!activeCamera) return;
    tiltViewFromTrackpad(shotOrbitRef.current, deltaX, deltaY);
    if (persist) scheduleCameraCommit();
  };

  const panViewFromTrackpad = (event: ReactWheelEvent<HTMLDivElement>) => {
    const delta = normalizeWheelDelta(event.deltaX, event.deltaY, event.deltaMode, event.currentTarget.clientHeight);
    const persistCameraEdit = Boolean(cameraView && activeCamera);
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
        if (persistCameraEdit) scheduleCameraCommit();
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
      const buffer = cameraRotateBuffer.current;
      if (!buffer.timer) buffer.persist = persistCameraEdit;
      else buffer.persist = buffer.persist && persistCameraEdit;
      buffer.x += delta.x; buffer.y += delta.y;
      if (!buffer.timer) buffer.timer = window.setTimeout(() => {
        const pending = cameraRotateBuffer.current;
        const x = pending.x, y = pending.y, persist = pending.persist;
        pending.x = 0; pending.y = 0; pending.persist = true; pending.timer = undefined;
        if (cameraView) tiltShotCameraFromTrackpad(x, y, persist);
        // La vista libera usa lo stesso free-look smussato del frame: ruota lo
        // sguardo sul posto, senza orbitare attorno a un point della scena.
        else tiltViewFromTrackpad(orbitRef.current, x, y);
      }, 24);
      return;
    }
    // Shift + due dita trasla la vista su entrambi gli assi, anche sopra oggetti.
    event.preventDefault();
    event.stopPropagation();
    const buffer = cameraPanBuffer.current;
    if (!buffer.timer) buffer.persist = persistCameraEdit;
    else buffer.persist = buffer.persist && persistCameraEdit;
    buffer.x += delta.x;
    buffer.y += delta.y;
    if (!buffer.timer) buffer.timer = window.setTimeout(() => {
      const pending = cameraPanBuffer.current;
      const x = pending.x, y = pending.y, persist = pending.persist;
      pending.x = 0; pending.y = 0; pending.persist = true; pending.timer = undefined;
      if (cameraView) panShotView(x, y, persist);
      else panControlledView(orbitRef.current, x, y);
    }, 32);
  };

  useEffect(() => {
    const releaseViewportDrag = () => {
      setDraggingObject(false);
      if (orbitRef.current) orbitRef.current.enabled = !cameraView;
      document.body.style.cursor = 'default';
    };
    window.addEventListener('pointerup', releaseViewportDrag, true);
    window.addEventListener('pointercancel', releaseViewportDrag, true);
    window.addEventListener('blur', releaseViewportDrag);
    return () => {
      window.removeEventListener('pointerup', releaseViewportDrag, true);
      window.removeEventListener('pointercancel', releaseViewportDrag, true);
      window.removeEventListener('blur', releaseViewportDrag);
    };
  }, [cameraView]);

  useEffect(() => {
    const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const held = new Set<string>();
    let freeFlight: { sceneId: string; position: Vec3; rotation: Vec3; target: Vec3; lastCommitTime: number } | undefined;
    let animationFrame = 0;
    let previousTime = performance.now();
    let recordingFrameRemainder = 0;

    const editableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
    };
    const flushFreeFlight = () => {
      if (!freeFlight) return;
      const editor = useEditor.getState();
      editor.setCameraFraming(freeFlight.sceneId, freeFlight.position, freeFlight.rotation, freeFlight.target);
      freeFlight = undefined;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (editableTarget(event.target) || event.metaKey || event.ctrlKey) return;
      if (movementCodes.has(event.code)) {
        event.preventDefault();
        held.add(event.code);
        const editor = useEditor.getState();
        if (!editor.recordingSession) editor.setPlaying(false);
      }
      if (event.code.startsWith('Shift') || event.code.startsWith('Alt')) held.add(event.code);
    };
    const keyUp = (event: KeyboardEvent) => {
      held.delete(event.code);
      if (![...held].some((code) => movementCodes.has(code))) {
        flushFreeFlight();
        recordingFrameRemainder = 0;
      }
    };
    const clearKeys = () => { flushFreeFlight(); held.clear(); recordingFrameRemainder = 0; };
    const tick = (time: number) => {
      const deltaSeconds = Math.min(.05, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      if ([...held].some((code) => movementCodes.has(code))) {
        let editor = useEditor.getState();
        // REC has its own clock while movement keys are held. The Play state
        // remains off, but the recording cursor advances so every WASDQE
        // sample is visible and lands on a controllable frame.
        if (editor.recordingSession) {
          recordingFrameRemainder += deltaSeconds * editor.project.settings.fps;
          const frameStep = Math.floor(recordingFrameRemainder);
          if (frameStep > 0) {
            recordingFrameRemainder -= frameStep;
            const scenes = editor.project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
            const sceneIndex = scenes.findIndex((scene) => scene.id === editor.recordingSession?.sceneId);
            const sceneEnd = scenes[sceneIndex + 1]?.frame ?? editor.project.settings.frameEnd + 1;
            editor.setFrame(Math.min(sceneEnd - 1, editor.currentFrame + frameStep));
            editor = useEditor.getState();
          }
        } else recordingFrameRemainder = 0;
        const selected = editor.project.objects.find((object) => object.id === editor.selectedId
          && object.kind !== 'audio'
          && !object.kind.includes('light')
          && evaluateProperty(object, 'visibility', editor.currentFrame));
        if (selected && (selected.kind !== 'camera' || !cameraView || Boolean(editor.recordingSession))) {
          const transform = evaluateTransform(selected, editor.currentFrame);
          const controls = cameraView ? shotOrbitRef.current : orbitRef.current;
          const viewCamera = controls?.object;
          const forward = viewCamera?.getWorldDirection(new THREE.Vector3()) ?? new THREE.Vector3(0, 1, 0);
          forward.z = 0;
          if (forward.lengthSq() < .0001) forward.set(0, 1, 0);
          forward.normalize();
          const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();
          const speedModifier = ([...held].some((code) => code.startsWith('Shift')) ? 3 : 1) * ([...held].some((code) => code.startsWith('Alt')) ? .25 : 1);
          const movement = new THREE.Vector3();
          if (held.has('KeyW') || held.has('ArrowUp')) movement.add(forward);
          if (held.has('KeyS') || held.has('ArrowDown')) movement.sub(forward);
          if (held.has('KeyA') || held.has('ArrowLeft')) movement.sub(right);
          if (held.has('KeyD') || held.has('ArrowRight')) movement.add(right);
          if (held.has('KeyE')) movement.z += 1;
          if (held.has('KeyQ')) movement.z -= 1;
          if (movement.lengthSq() > 0) {
            movement.normalize().multiplyScalar(3 * deltaSeconds * speedModifier);
            const position = new THREE.Vector3(...transform.position).add(movement).toArray().map((value) => Number(value.toFixed(4))) as Transform['position'];
            if (selected.kind !== 'camera' || !cameraView || editor.recordingSession) editor.setTransform(selected.id, { ...transform, position });
          }
          animationFrame = requestAnimationFrame(tick);
          return;
        }
        if (!cameraView) {
          const controls = orbitRef.current;
          if (controls) {
            const camera = controls.object;
            camera.up.set(0, 0, 1);
            camera.updateMatrixWorld();
            const distance = Math.max(.5, camera.position.distanceTo(controls.target));
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
              controls.target.add(movement);
              controls.update();
            }
          }
          animationFrame = requestAnimationFrame(tick);
          return;
        }
        const currentScene = editor.project.cameraCuts.slice().sort((a, b) => b.frame - a.frame).find((scene) => scene.frame <= editor.currentFrame);
        const cameraObject = editor.project.objects.find((object) => object.id === currentScene?.cameraId && object.kind === 'camera');
        if (currentScene && cameraObject) {
          const controls = cameraView ? shotOrbitRef.current : undefined;
          const live = freeFlight?.sceneId === currentScene.id ? freeFlight : undefined;
          const transform = live
            ? { position: live.position, rotation: live.rotation, scale: evaluateTransform(cameraObject, editor.currentFrame).scale }
            : evaluateTransform(cameraObject, editor.currentFrame);
          const camera = controls?.object ?? new THREE.PerspectiveCamera();
          if (!controls) {
            camera.position.set(...transform.position);
            camera.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
          }
          camera.up.set(0, 0, 1);
          camera.updateMatrixWorld();
          const target = controls?.target ?? (live ? new THREE.Vector3(...live.target) : new THREE.Vector3(...transform.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), currentScene.framing.distance));
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
            if (cameraView && editor.recordingSession) scheduleCameraCommit();
            else {
              const lastCommitTime = live?.lastCommitTime ?? time;
              freeFlight = { sceneId: currentScene.id, position, rotation, target: framingTarget, lastCommitTime };
              if (editor.recordingSession && time - lastCommitTime >= 100) {
                editor.setCameraFraming(currentScene.id, position, rotation, framingTarget);
                freeFlight.lastCommitTime = time;
              }
            }
          }
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearKeys);
    window.addEventListener('abaco:flush-camera-edit', flushFreeFlight);
    animationFrame = requestAnimationFrame(tick);
    return () => {
      flushFreeFlight();
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
      window.removeEventListener('abaco:flush-camera-edit', flushFreeFlight);
    };
  }, [cameraView]);

  return <div ref={viewportRef} tabIndex={-1} onPointerDownCapture={(event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('button, input, textarea, select')) event.currentTarget.focus({ preventScroll: true });
  }} className={`viewport ${cameraView ? 'camera-mode' : ''} ${recordingMotion || recordingSession ? 'recording-motion' : ''}`} style={cameraFrame ? { '--camera-frame-width': `${cameraFrame.width}px`, '--camera-frame-height': `${cameraFrame.height}px` } as CSSProperties : undefined} data-testid="viewport">
    <div ref={stageRef} className="canvas-stage" onWheelCapture={panViewFromTrackpad}>
    <Canvas key={rendererGeneration} shadows gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ position: [8, -10, 7], fov: 45, near: .01, far: 1000 }}
      onCreated={({ gl, camera }) => { viewportCanvas = gl.domElement; camera.up.set(0, 0, 1); }} onPointerMissed={() => { if (!multiSelectMode) select(undefined); }}>
      <WebGLContextGuard primary onLost={recoverRenderer} />
      <SelectionAiAnchor />
      <PerspectiveCamera makeDefault={!cameraView} position={[8, -10, 7]} up={[0, 0, 1]} fov={45} near={.01} far={1000} />
      <color attach="background" args={[dark ? '#3d3d3d' : '#f1f1ef']} />
      <SceneBackground kind={activeCut?.background?.kind ?? 'none'} path={activeCut?.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, lighting.intensity)} />
      <directionalLight color={lighting.color} position={lightPosition} intensity={lightingStyle.key * lighting.intensity} castShadow />
      <Grid name="abaco-ground-grid" args={[40, 40]} rotation={[Math.PI / 2, 0, 0]} cellSize={1} cellThickness={0.55} cellColor={dark ? '#535353' : '#d7d7d3'} sectionSize={5} sectionThickness={0.9} sectionColor={dark ? '#606060' : '#bdbdb7'} fadeDistance={45} infiniteGrid />
      <Line name="abaco-x-axis" points={[[-20, 0, .012], [20, 0, .012]]} color="#c64d4d" lineWidth={1.2} transparent opacity={.94} />
      <Line name="abaco-y-axis" points={[[0, -20, .012], [0, 20, .012]]} color="#5cab1a" lineWidth={1.2} transparent opacity={.94} />
      {objects.filter((object) => object.kind !== 'audio' && !object.screenSpace && object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <SceneItem key={object.id} object={object} cameraView={cameraView} objectControls={objectControls} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value && !cameraView; }} />)}
      {!cameraView && activeCamera && <SceneItem object={activeCamera} cameraView={cameraView} objectControls={objectControls} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value; }} />}
      {showMotionPaths && visibleMotionPaths.map(({ object, keyframes, points, pointFrames, sceneId }) => <MotionPath key={`${sceneId}:${object.id}`} objectId={object.id} sceneId={sceneId} keyframes={keyframes} points={points} pointFrames={pointFrames} color={object.kind === 'camera' ? '#39b6e6' : '#ef3f3f'} selectedColor={object.kind === 'camera' ? '#0b6f99' : '#b41622'} editable={selectedMotion?.objectId === object.id && selectedMotion.sceneId === sceneId} onDragChange={(value) => { setDraggingObject(value); if (orbitRef.current) orbitRef.current.enabled = !value && !cameraView; }} />)}
      {cameraView && activeCamera && activeCut && <ShotCamera key={activeCut.id} object={activeCamera} aspect={aspect} frame={recordingSession?.startFrame} frameHeightRatio={cameraFrame?.heightRatio} lockTransform={Boolean(recordingSession)} />}
      {cameraView && activeCamera && activeCut && activeCameraTransform && activeCameraTarget && <CameraViewControls controls={shotOrbitRef} target={activeCameraTarget} syncKey={recordingSession ? activeCut.id : `${activeCut.id}:${JSON.stringify(activeCameraTarget)}:${JSON.stringify(activeCameraTransform)}`} />}
      {!cameraView && <OrbitControls ref={orbitRef} makeDefault enableDamping enabled={!draggingObject} target={[0, 0, 1]} />}
    </Canvas>
    </div>
    {cameraView && cameraFrame && <div className="camera-frame-guide" style={{ width: cameraFrame.width, height: cameraFrame.height }} aria-hidden="true" />}
    {cameraView && cameraFrame && <ScreenSpaceLayers objects={objects} frame={frame} width={cameraFrame.width} height={cameraFrame.height} />}
    {cameraView && cameraFrame && <JevStrokeOverlay width={cameraFrame.width} height={cameraFrame.height} viewMode="camera" getViewContext={() => {
      const camera = shotOrbitRef.current?.object;
      return { rotation: camera ? [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3 : activeCameraTransform?.rotation ?? [0, 0, 0], position: camera ? camera.position.toArray() as Vec3 : activeCameraTransform?.position ?? [0, 0, 0], verticalFovDegrees: camera instanceof THREE.PerspectiveCamera ? camera.fov : 45 };
    }} />}
    {!cameraView && viewportSize.width > 0 && viewportSize.height > 0 && <JevStrokeOverlay width={viewportSize.width} height={viewportSize.height} viewMode="free" getViewContext={() => {
      const camera = orbitRef.current?.object;
      return { rotation: camera ? [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3 : [0, 0, 0], position: camera ? camera.position.toArray() as Vec3 : [8, -10, 7], verticalFovDegrees: camera instanceof THREE.PerspectiveCamera ? camera.fov : 45 };
    }} />}
    {!recordingSession && <SceneThumbnailQueue projectId={projectId} scenes={cuts} objects={objects} aspect={aspect} dark={dark} />}
    {cameraView && <button className="view-toggle active" title="Return to free view" aria-label="Back to free view" onClick={() => setCameraView(false)}><ArrowLeft size={15} /><span>Back</span></button>}
    {cameraHintVisible && <div className={`camera-instructions-anchor ${cameraView && cameraFrame ? 'inside-frame' : ''}`} style={cameraView && cameraFrame ? { width: cameraFrame.width, height: cameraFrame.height } : undefined}>
      <div className="camera-drone-hint" aria-label="Blender-style camera controls">
        <button className="camera-hint-close" title="Hide instructions" aria-label="Hide instructions" onClick={() => setCameraHintVisible(false)}>×</button>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {selectedTransformable ? `moves ${selectedTransformable.name}` : cameraView ? 'moves the camera' : 'moves the view'}</span>
        <span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> alternative</span>
        <span><kbd>Q</kbd><kbd>E</kbd> down / up</span>
        <small>Two fingers tilt · Shift + two fingers pan</small>
        <small>Shift fast · Alt slow</small>
      </div>
    </div>}
    <div className="viewport-top-right">
      {!cameraView && <button className={`viewport-selection-tool ${multiSelectMode ? 'active' : ''}`} type="button" aria-label="Select multiple elements" aria-pressed={multiSelectMode} title="Select multiple elements · or ⌘/Ctrl-click" onClick={() => setMultiSelectMode(!multiSelectMode)}><MousePointer2 size={15} /></button>}
      {(canGroup || selectedGroup) && <div className="viewport-group-tools"><span>{selectedIds.length} selected</span><button type="button" aria-label={selectedGroup ? 'Ungroup elements' : 'Group elements'} title={selectedGroup ? 'Ungroup elements' : 'Group elements'} onClick={selectedGroup ? ungroupSelection : groupSelection}>{selectedGroup ? <Ungroup size={15} /> : <Group size={15} />}{selectedGroup ? 'Ungroup' : 'Group'}</button></div>}
      {(cameraView || selectedTransformable) && <div className="viewport-tools" aria-label="Transform tool">{([
        ['translate', 'Move', Move3d],
        ['rotate', 'Rotate', Rotate3d],
        ['scale', 'Scale', Scaling],
      ] as const).map(([mode, label, Icon]) => <button key={mode} disabled={!selectedTransformable} title={selectedTransformable ? label : `Select an element to use ${label.toLowerCase()}`} aria-label={label} className={gizmoMode === mode ? 'active' : ''} onClick={() => setGizmoMode(mode)}><Icon size={15} /></button>)}</div>}
    </div>
    <div className="viewport-bottom-right">
      <button className={`motion-path-visibility ${showMotionPaths ? 'active' : ''}`} aria-pressed={showMotionPaths} aria-label={showMotionPaths ? 'Hide motion paths' : 'Show motion paths'} title={showMotionPaths ? 'Hide paths' : 'Show paths'} onClick={() => setShowMotionPaths((value) => !value)}>{showMotionPaths ? <Eye size={15} /> : <EyeOff size={15} />}</button>
    </div>
    {!cameraView && activeCut && activeCamera && <LiveCameraPreview scene={activeCut} camera={activeCamera} objects={objects} aspect={aspect} dark={dark} onOpen={() => setCameraView(true)} onFind={() => {
      const controls = orbitRef.current;
      if (!controls || !activeCameraTransform) return;
      controls.target.set(...activeCameraTransform.position);
      controls.object.position.copy(controls.target).add(new THREE.Vector3(6, -8, 5));
      controls.update();
      select(activeCamera.id);
    }} />}
    {!hasContent && !cameraView && <div className="start-card">
      <div className="start-icon"><Box size={26} /></div>
      <strong>Create your first scene</strong>
      <p>Add a shape or text, then drag it directly in the workspace.</p>
      <div><button className="primary" onClick={() => addObject('cube')}><Plus size={16} /> Shape</button><button className="secondary" onClick={() => addObject('text')}><TextCursorInput size={16} /> Text</button></div>
    </div>}
    {cameraView && activeCamera && framingSubject && <div className="viewport-bottom-left"><button className="center-shot center-subject" aria-label="Center subject" title={`Recenter the frame on ${framingSubject.name}`} onClick={centerFramingOnSubject}><Focus size={15} /></button>{selectedSubject && <button className="center-shot restore-subject" aria-label="Restore starting position" title={`Return ${selectedSubject.name} to its position at the start of the scene`} onClick={restoreSelectedPosition}><RotateCcw size={15} /></button>}</div>}
  </div>;
}
