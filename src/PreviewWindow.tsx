import { Canvas } from '@react-three/fiber';
import { Grid, Line } from '@react-three/drei';
import { useEffect, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { evaluateProperty, evaluateTransform } from './domain/animation';
import type { AbacoProject, SceneObject } from './domain/schema';
import { SceneBackground, ShotCamera, ThumbnailItem } from './components/Viewport';

type PreviewState = { project: AbacoProject; frame: number; theme: 'light' | 'dark' };

function PreviewLayers({ objects, frame }: { objects: SceneObject[]; frame: number }) {
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
      return <div key={object.id} className="preview-screen-layer" style={style}>
        <div className="screen-layer-content" style={{ clipPath: `inset(${crop[0] * 100}% ${crop[1] * 100}% ${crop[2] * 100}% ${crop[3] * 100}%)` }}>
          {object.kind === 'text'
            ? <span style={{ color: object.color }}>{evaluateProperty(object, 'text', frame) as string}</span>
            : <img src={object.asset.proxyPath} alt="" draggable={false} />}
        </div>
      </div>;
    })}
  </div>;
}

function CameraOutput({ state }: { state: PreviewState }) {
  const { project, frame, theme } = state;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const scene = scenes.filter((item) => item.frame <= frame).at(-1) ?? scenes[0];
  const camera = project.objects.find((object) => object.id === scene?.cameraId && object.kind === 'camera');
  if (!scene || !camera) return <div className="preview-empty">Nessuna inquadratura disponibile</div>;
  const aspect = project.settings.resolutionX / project.settings.resolutionY;
  const lightingStyle = { neutral: { ambient: .72, key: 1.7 }, soft: { ambient: 1.05, key: .9 }, warm: { ambient: .68, key: 1.75 }, dramatic: { ambient: .22, key: 2.7 } }[scene.lighting.preset];
  const angle = THREE.MathUtils.degToRad(scene.lighting.direction);
  const elevation = THREE.MathUtils.degToRad(scene.lighting.elevation);
  const radius = Math.cos(elevation) * 9;
  const lightPosition: [number, number, number] = [Math.sin(angle) * radius, -Math.cos(angle) * radius, 1.5 + Math.sin(elevation) * 9];
  return <div className="preview-monitor-frame" style={{ '--preview-aspect': String(aspect) } as CSSProperties}>
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
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
    <PreviewLayers objects={project.objects} frame={frame} />
  </div>;
}

export default function PreviewWindow() {
  const [state, setState] = useState<PreviewState | null>(null);
  useEffect(() => {
    document.title = 'Inquadratura — Abaco Animatic';
    const removeState = window.abaco?.onPreviewState(setState);
    const removeFrame = window.abaco?.onPreviewFrame((frame) => setState((current) => current ? { ...current, frame } : current));
    window.abaco?.getPreviewState().then((current) => { if (current) setState(current); }).catch(() => undefined);
    return () => { removeState?.(); removeFrame?.(); };
  }, []);
  return <main className={`preview-monitor theme-${state?.theme ?? 'dark'}`}>
    {state ? <CameraOutput state={state} /> : <div className="preview-empty">In attesa dell’inquadratura…</div>}
  </main>;
}
