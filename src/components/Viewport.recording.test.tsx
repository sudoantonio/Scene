import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerspectiveCamera } from 'three';
import { createProject } from '../domain/schema';
import { evaluateTransform } from '../domain/animation';
import { useEditor } from '../store/editor';
import Viewport, { ScreenAssetImage } from './Viewport';
import Timeline from './Timeline';

// Only the GPU renderer is replaced. Keyboard events, RAF, delayed camera
// commits, timeline buttons and the editor store use their real implementations.
vi.mock('@react-three/fiber', async () => {
  const React = await import('react');
  const THREE = await import('three');
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(8, -10, 7);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 1);
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => React.Children.toArray(children).filter((child) =>
      React.isValidElement(child) && typeof child.type === 'function' && child.type.name === 'CameraViewControls'),
    useThree: (selector: (state: { camera: PerspectiveCamera }) => unknown) => selector({ camera }),
    useFrame: () => undefined,
    useLoader: () => undefined,
  };
});

vi.mock('@react-three/drei', async () => {
  const React = await import('react');
  const { useThree } = await import('@react-three/fiber');
  const THREE = await import('three');
  const OrbitControls = React.forwardRef((_: unknown, ref) => {
    const camera = useThree((state) => state.camera);
    const controls = React.useMemo(() => ({ object: camera, target: new THREE.Vector3(), update() {} }), [camera]);
    React.useImperativeHandle(ref, () => controls, [controls]);
    return null;
  });
  return { OrbitControls, Billboard: () => null, Grid: () => null, Line: () => null, PerspectiveCamera: () => null, Text: () => null, TransformControls: () => null };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useEditor.setState({ project: createProject(), currentFrame: 1, cameraView: true, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, past: [], future: [], dirty: false, isPlaying: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('REC camera dopo il cambio scena nella vista camera', () => {
  it('sostituisce una risorsa 2D non caricabile senza mostrare l’icona immagine rotta del browser', () => {
    render(<ScreenAssetImage source="asset-mancante.png" name="Bozza" />);
    fireEvent.error(screen.getByRole('img', { name: 'Bozza' }));
    expect(screen.queryByRole('img', { name: 'Bozza' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Immagine non disponibile: Bozza')).toBeInTheDocument();
  });

  it('usa un solo renderer WebGL per generare tutte le miniature', () => {
    act(() => {
      useEditor.getState().addShot();
      useEditor.getState().addShot();
    });
    const { container } = render(<Viewport />);
    expect(useEditor.getState().project.cameraCuts).toHaveLength(3);
    expect(container.querySelectorAll('.thumbnail-renderer')).toHaveLength(1);
  });

  it('mantiene visibili i controlli esterni anche senza una selezione', () => {
    render(<Viewport />);
    expect(screen.getByLabelText('Strumento trasformazione')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sposta' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ruota' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scala' })).toBeDisabled();
  });

  it('non salva una rotazione trackpad della camera quando REC è spento', () => {
    const before = structuredClone(useEditor.getState().project);
    const { container } = render(<Viewport />);
    fireEvent.wheel(container.querySelector('.canvas-stage')!, { deltaX: 0, deltaY: 28, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(400));
    expect(useEditor.getState().project).toEqual(before);
  });

  it('salva una rotazione trackpad della camera quando REC è acceso', () => {
    const { container } = render(<><Viewport /><Timeline /></>);
    const scene = useEditor.getState().project.cameraCuts[0];
    fireEvent.click(screen.getByRole('button', { name: 'Registra movimenti' }));
    act(() => useEditor.getState().setFrame(scene.frame + 12));
    fireEvent.wheel(container.querySelector('.canvas-stage')!, { deltaX: 0, deltaY: 28, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.click(screen.getByRole('button', { name: 'Ferma registrazione movimento' }));
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    expect(camera.keyframes.some((key) => key.property === 'rotation' && key.purpose === 'motion' && key.frame === scene.frame + 12)).toBe(true);
  });

  it.each([
    { sceneNumber: 1, paused: true, duration: 400 },
    { sceneNumber: 2, paused: true, duration: 400 },
    { sceneNumber: 3, paused: true, duration: 400 },
    { sceneNumber: 2, paused: false, duration: 400 },
    { sceneNumber: 3, paused: false, duration: 400 },
    { sceneNumber: 2, paused: true, duration: 32 },
  ])('registra con WASD nella scena $sceneNumber (pausa=$paused, durata=$duration ms)', ({ sceneNumber, paused, duration }) => {
    render(<><Viewport /><Timeline /></>);
    act(() => {
      useEditor.getState().addShot();
      useEditor.getState().addShot();
      useEditor.getState().setFrame(1);
    });
    const scenes = useEditor.getState().project.cameraCuts;
    const scene = scenes[sceneNumber - 1];
    const before = structuredClone(useEditor.getState().project);
    fireEvent.click(screen.getByTitle(`Scena ${sceneNumber}`));
    fireEvent.click(screen.getByRole('button', { name: 'Registra movimenti' }));
    act(() => {
      useEditor.getState().setFrame(scene.frame + 16);
      useEditor.getState().setPlaying(!paused);
    });
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    for (let time = 0; time < duration; time += 16) {
      act(() => {
        if (!paused && time % 48 === 0) useEditor.getState().setFrame(useEditor.getState().currentFrame + 1);
        vi.advanceTimersByTime(16);
      });
    }
    fireEvent.keyUp(window, { code: 'KeyW', key: 'w' });
    const finalFrame = useEditor.getState().currentFrame;
    fireEvent.click(screen.getByRole('button', { name: 'Ferma registrazione movimento' }));

    const project = useEditor.getState().project;
    const camera = project.objects.find((object) => object.id === scene.cameraId)!;
    const points = camera.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion' && key.frame >= scene.frame);
    const recordedFrames = points.map((key) => key.frame).sort((a, b) => a - b);
    expect(recordedFrames[0]).toBe(scene.frame);
    expect(recordedFrames.at(-1)).toBe(finalFrame);
    expect(evaluateTransform(camera, finalFrame).position).not.toEqual(evaluateTransform(camera, scene.frame).position);
    for (const other of scenes.filter((item) => item.id !== scene.id)) {
      const original = before.objects.find((object) => object.id === other.cameraId)!;
      const updated = project.objects.find((object) => object.id === other.cameraId)!;
      for (const key of original.keyframes) expect(updated.keyframes.find((item) => item.id === key.id)).toEqual(key);
      expect(evaluateTransform(updated, other.frame + 20)).toEqual(evaluateTransform(original, other.frame + 20));
      expect(updated.keyframes.filter((key) => key.purpose === 'motion')).toEqual(original.keyframes.filter((key) => key.purpose === 'motion'));
    }
    expect(screen.getByTitle(`Movimento camera · Scena ${sceneNumber} · trascina i bordi per cambiare velocità`)).toBeInTheDocument();
  });
});

describe('controlli della vista libera', () => {
  beforeEach(() => useEditor.setState({ cameraView: false }));

  it('usa automaticamente WASD per la visuale o per l’elemento selezionato', () => {
    render(<Viewport />);
    expect(screen.getByLabelText('Comandi camera stile Blender')).toHaveTextContent('muove la visuale');
    act(() => useEditor.getState().addObject('cube'));
    const cube = useEditor.getState().project.objects.find((object) => object.kind === 'cube')!;
    const before = evaluateTransform(cube, 1).position;
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    act(() => vi.advanceTimersByTime(64));
    fireEvent.keyUp(window, { code: 'KeyW', key: 'w' });
    const updated = useEditor.getState().project.objects.find((object) => object.id === cube.id)!;
    expect(evaluateTransform(updated, 1).position).not.toEqual(before);
    expect(screen.getByLabelText('Comandi camera stile Blender')).toHaveTextContent('muove Cubo 1');
  });

  it('mostra solo la miniatura camera e permette di ridurla', () => {
    render(<Viewport />);
    expect(screen.queryByRole('button', { name: 'Frame della ripresa' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Camera · Scena/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riduci anteprima camera' }));
    expect(screen.queryByRole('button', { name: "Apri l'anteprima della camera" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Espandi anteprima camera' }));
    expect(screen.getByRole('button', { name: "Apri l'anteprima della camera" })).toBeInTheDocument();
  });
});

describe('azioni rapide sul soggetto', () => {
  it('riporta l’elemento selezionato alla posizione della scena iniziale', () => {
    act(() => {
      useEditor.getState().addObject('cube');
      const id = useEditor.getState().selectedId!;
      useEditor.getState().setTransform(id, { position: [2, 1, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
      useEditor.getState().addShot();
      useEditor.getState().select(id);
      useEditor.getState().setTransform(id, { position: [8, 4, 1], rotation: [0, 0, 20], scale: [1.2, 1.2, 1.2] });
      useEditor.getState().setCameraView(true);
    });
    render(<Viewport />);
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina posizione iniziale' }));
    const state = useEditor.getState();
    const object = state.project.objects.find((item) => item.id === state.selectedId)!;
    expect(evaluateTransform(object, state.currentFrame).position).toEqual([2, 1, 1]);
    expect(evaluateTransform(object, state.currentFrame).rotation).toEqual([0, 0, 20]);
  });
});
