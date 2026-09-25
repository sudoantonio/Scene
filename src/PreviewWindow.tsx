import { Canvas } from '@react-three/fiber';
import { Grid, Line } from '@react-three/drei';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import type { AbacoProject } from './domain/schema';
import { ReadonlyScreenLayers, SceneBackground, ShotCamera, ThumbnailItem, WebGLContextGuard } from './components/Viewport';

type PreviewState = { project: AbacoProject; frame: number; theme: 'light' | 'dark' };

function CameraOutput({ state }: { state: PreviewState }) {
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const recoverRenderer = useMemo(() => () => setRendererGeneration((value) => value + 1), []);
  const { project, frame, theme } = state;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const scene = scenes.filter((item) => item.frame <= frame).at(-1) ?? scenes[0];
  const camera = project.objects.find((object) => object.id === scene?.cameraId && object.kind === 'camera');
  if (!scene || !camera) return <div className="preview-empty">No camera view available</div>;
  const aspect = project.settings.resolutionX / project.settings.resolutionY;
  const lightingStyle = { neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 }, warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 } }[scene.lighting.preset];
  const angle = THREE.MathUtils.degToRad(scene.lighting.direction);
  const elevation = THREE.MathUtils.degToRad(scene.lighting.elevation);
  const radius = Math.cos(elevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(angle) * radius, -Math.cos(angle) * radius, 1.5 + Math.sin(elevation) * 9];
  return <div className="preview-monitor-frame" style={{ '--preview-aspect': String(aspect) } as CSSProperties}>
    <Canvas key={rendererGeneration} shadows dpr={[1, 2]} gl={{ antialias: true }}>
      <WebGLContextGuard onLost={recoverRenderer} />
      <color attach="background" args={[theme === 'dark' ? '#3d3d3d' : '#f1f1ef']} />
      <SceneBackground kind={scene.background?.kind ?? 'none'} path={scene.background?.path ?? ''} />
      <ambientLight intensity={lightingStyle.ambient * Math.max(.2, scene.lighting.intensity)} />
      <directionalLight color={scene.lighting.color} position={lightPosition} intensity={lightingStyle.key * scene.lighting.intensity} castShadow />
      <Grid args={[40, 40]} rotation={[Math.PI / 2, 0, 0]} cellSize={1} cellThickness={.55} cellColor={theme === 'dark' ? '#535353' : '#d7d7d3'} sectionSize={5} sectionThickness={.9} sectionColor={theme === 'dark' ? '#606060' : '#bdbdb7'} fadeDistance={45} infiniteGrid />
      <Line points={[[-20, 0, .012], [20, 0, .012]]} color="#c64d4d" lineWidth={1.2} transparent opacity={.94} />
      <Line points={[[0, -20, .012], [0, 20, .012]]} color="#5cab1a" lineWidth={1.2} transparent opacity={.94} />
      {project.objects.filter((object) => !object.screenSpace && object.kind !== 'camera' && !object.kind.includes('light')).map((object) => <ThumbnailItem key={object.id} object={object} frame={frame} />)}
      <ShotCamera object={camera} aspect={aspect} frame={frame} />
    </Canvas>
    <ReadonlyScreenLayers objects={project.objects} frame={frame} />
  </div>;
}

export default function PreviewWindow() {
  const [state, setState] = useState<PreviewState | null>(null);
  useEffect(() => {
    document.title = 'Camera Preview — Scene';
    let active = true;
    let receivedState = false;
    let latestFrame: number | undefined;
    const removeState = window.abaco?.onPreviewState((current) => {
      receivedState = true;
      latestFrame = current.frame;
      setState({ ...current, theme: 'dark' });
    });
    const removeFrame = window.abaco?.onPreviewFrame((frame) => {
      latestFrame = frame;
      setState((current) => current ? { ...current, frame } : current);
    });
    window.abaco?.getPreviewState().then((current) => {
      if (active && current && !receivedState) setState({ ...current, frame: latestFrame ?? current.frame, theme: 'dark' });
    }).catch(() => undefined);
    return () => { active = false; removeState?.(); removeFrame?.(); };
  }, []);
  return <main className={`preview-monitor theme-${state?.theme ?? 'dark'}`}>
    {state ? <CameraOutput state={state} /> : <div className="preview-empty">Waiting for camera view…</div>}
  </main>;
}
