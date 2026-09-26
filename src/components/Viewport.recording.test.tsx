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
  window.localStorage.removeItem('scene-show-motion-paths');
  useEditor.setState({ project: createProject(), currentFrame: 1, cameraView: true, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, past: [], future: [], dirty: false, isPlaying: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('REC camera dopo il cambio scena nella vista camera', () => {
  it('trascina un sottotitolo nello spazio e applica lo spostamento a tutti solo quando richiesto', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    act(() => useEditor.getState().addAudio({ sourcePath: '/voice.wav', name: 'Voice', duration: 3, waveform: [] }));
    const audio = useEditor.getState().project.objects.find((object) => object.kind === 'audio')!;
    const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
    act(() => useEditor.getState().updateObject(audio.id, { audio: { ...audio.audio, captions: [
      { id: firstId, start: 0, end: 1, text: 'First' },
      { id: secondId, start: 1, end: 2, text: 'Second' },
    ] } }));
    render(<Viewport />);
    const first = screen.getByLabelText('Subtitle in frame: First');
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 160, clientY: 70 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 160, clientY: 70 });
    let changed = useEditor.getState().project.objects.find((object) => object.id === audio.id)!;
    expect(changed.audio.captionStyle.position[0]).toBeGreaterThan(.5);
    expect(changed.audio.captionStyle.position[1]).toBeLessThan(.95);
    expect(changed.audio.captions[1].position).toBeUndefined();
    expect(useEditor.getState().selectedCaption).toEqual({ audioId: audio.id, captionId: firstId });

    act(() => useEditor.getState().updateObject(audio.id, { audio: { ...changed.audio, applyCaptionPositionToAll: false } }));
    fireEvent.pointerDown(first, { button: 0, pointerId: 2, clientX: 160, clientY: 70 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 200, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 200, clientY: 50 });
    const individual = useEditor.getState().project.objects.find((object) => object.id === audio.id)!;
    expect(individual.audio.captionStyle.position).toEqual(changed.audio.captionStyle.position);
    expect(individual.audio.captions[0].position).toBeDefined();
    expect(individual.audio.captions[1].position).toBeUndefined();
    width.mockRestore(); height.mockRestore();
  });

  it('sostituisce una risorsa 2D non caricabile senza mostrare l’icona immagine rotta del browser', () => {
    render(<ScreenAssetImage source="asset-mancante.png" name="Bozza" />);
    fireEvent.error(screen.getByRole('img', { name: 'Bozza' }));
    expect(screen.queryByRole('img', { name: 'Bozza' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Image unavailable: Bozza')).toBeInTheDocument();
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
    expect(screen.getByLabelText('Transform tool')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scale' })).toBeDisabled();
  });

  it('salva la posa base modificata col trackpad anche quando REC è spento', () => {
    const before = structuredClone(useEditor.getState().project);
    const { container } = render(<Viewport />);
    fireEvent.wheel(container.querySelector('.canvas-stage')!, { deltaX: 0, deltaY: 28, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(400));
    expect(useEditor.getState().project).not.toEqual(before);
    const scene = useEditor.getState().project.cameraCuts[0];
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    expect(camera.keyframes.filter((key) => key.purpose === 'motion')).toHaveLength(0);
  });

  it('non sposta la vista con il trackpad durante una selezione Shift nel canvas', () => {
    const before = structuredClone(useEditor.getState().project);
    const { container } = render(<Viewport />);
    const stage = container.querySelector('.canvas-stage') as HTMLDivElement;
    stage.setPointerCapture = vi.fn();
    stage.hasPointerCapture = vi.fn().mockReturnValue(true);
    stage.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(stage, { button: 0, pointerId: 1, shiftKey: true, clientX: 20, clientY: 20 });
    fireEvent.wheel(stage, { deltaX: 0, deltaY: 28, deltaMode: 0, shiftKey: true });
    fireEvent.pointerUp(stage, { pointerId: 1, shiftKey: true, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(400));
    expect(useEditor.getState().project).toEqual(before);
  });

  it('crea un keyframe controllabile col trackpad fuori da REC su un frame intermedio', () => {
    const scene = useEditor.getState().project.cameraCuts[0];
    act(() => useEditor.getState().setFrame(scene.frame + 12));
    const { container } = render(<Viewport />);
    fireEvent.wheel(container.querySelector('.canvas-stage')!, { deltaX: 0, deltaY: 28, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(400));
    const state = useEditor.getState();
    const camera = state.project.objects.find((object) => object.id === scene.cameraId)!;
    const point = camera.keyframes.find((key) => key.property === 'position' && key.frame === scene.frame + 12 && key.purpose === 'motion');
    expect(point).toBeDefined();
    expect(state.selectedMotion).toMatchObject({ objectId: camera.id, sceneId: scene.id, keyframeId: point!.id });
  });

  it('annulla il delta trackpad in attesa prima di cambiare frame', () => {
    const before = structuredClone(useEditor.getState().project);
    const { container } = render(<Viewport />);
    fireEvent.wheel(container.querySelector('.canvas-stage')!, { deltaX: 0, deltaY: 28, deltaMode: 0 });
    act(() => useEditor.getState().setFrame(14));
    act(() => vi.advanceTimersByTime(400));
    expect(useEditor.getState().project).toEqual(before);
  });

  it('salva una rotazione trackpad della camera quando REC è acceso', () => {
    const { container } = render(<><Viewport /><Timeline /></>);
    const scene = useEditor.getState().project.cameraCuts[0];
    fireEvent.click(screen.getByRole('button', { name: 'Record motion' }));
    act(() => useEditor.getState().setFrame(scene.frame + 12));
    fireEvent.wheel(container.querySelector('.canvas-stage')!, { deltaX: 0, deltaY: 28, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.click(screen.getByRole('button', { name: 'Stop motion recording' }));
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    expect(camera.keyframes.some((key) => key.property === 'rotation' && key.purpose === 'motion' && key.frame === scene.frame + 12)).toBe(true);
  });

  it('muove la posa base della camera con WASDQE senza richiedere REC', () => {
    render(<Viewport />);
    const scene = useEditor.getState().project.cameraCuts[0];
    const before = evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!, scene.frame).position;
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    act(() => vi.advanceTimersByTime(96));
    fireEvent.keyUp(window, { code: 'KeyW', key: 'w' });
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    expect(evaluateTransform(camera, scene.frame).position).not.toEqual(before);
    expect(camera.keyframes.filter((key) => key.purpose === 'motion')).toHaveLength(0);
    expect(useEditor.getState().recordingSession).toBeUndefined();
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
    fireEvent.click(screen.getByTitle(`Scene ${sceneNumber}`));
    fireEvent.click(screen.getByRole('button', { name: 'Record motion' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Stop motion recording' }));

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
    expect(screen.getByTitle(`Motion camera · Scene ${sceneNumber} · drag the edges to change speed`)).toBeInTheDocument();
  });
});

describe('controlli della vista libera', () => {
  beforeEach(() => useEditor.setState({ cameraView: false }));

  it('usa automaticamente WASD per la visuale o per l’elemento selezionato', () => {
    render(<Viewport />);
    expect(screen.getByLabelText('Blender-style camera controls')).toHaveTextContent('moves the view');
    act(() => useEditor.getState().addObject('cube'));
    const cube = useEditor.getState().project.objects.find((object) => object.kind === 'cube')!;
    const before = evaluateTransform(cube, 1).position;
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    act(() => vi.advanceTimersByTime(64));
    fireEvent.keyUp(window, { code: 'KeyW', key: 'w' });
    const updated = useEditor.getState().project.objects.find((object) => object.id === cube.id)!;
    expect(evaluateTransform(updated, 1).position).not.toEqual(before);
    expect(screen.getByLabelText('Blender-style camera controls')).toHaveTextContent('moves Cube 1');
  });

  it('muove e salva con WASD anche la camera selezionata fuori da REC', () => {
    const scene = useEditor.getState().project.cameraCuts[0];
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    act(() => {
      useEditor.getState().setFrame(scene.frame + 10);
      useEditor.getState().select(camera.id);
    });
    render(<Viewport />);
    const before = evaluateTransform(camera, scene.frame + 10).position;
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    act(() => vi.advanceTimersByTime(80));
    fireEvent.keyUp(window, { code: 'KeyW', key: 'w' });
    const state = useEditor.getState();
    const updated = state.project.objects.find((object) => object.id === scene.cameraId)!;
    expect(evaluateTransform(updated, scene.frame + 10).position).not.toEqual(before);
    expect(updated.keyframes.some((key) => key.property === 'position' && key.frame === scene.frame + 10 && key.purpose === 'motion')).toBe(true);
    expect(state.recordingSession).toBeUndefined();
  });

  it('ridà il controllo WASDQE alla viewport dopo aver scritto in un campo', () => {
    const { container } = render(<><textarea aria-label="Input AI" /><Viewport /></>);
    const input = screen.getByRole('textbox', { name: 'Input AI' });
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.pointerDown(container.querySelector('.viewport')!);
    expect(document.activeElement).toBe(container.querySelector('.viewport'));
  });

  it('permette di nascondere e mostrare le traiettorie', () => {
    render(<Viewport />);
    const hide = screen.getByRole('button', { name: 'Hide motion paths' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hide);
    const show = screen.getByRole('button', { name: 'Show motion paths' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('scene-show-motion-paths')).toBe('false');
  });

  it('muove un elemento con Q ed E anche durante REC fermo', () => {
    render(<Viewport />);
    act(() => {
      useEditor.getState().addObject('cube');
      useEditor.getState().startRecording(useEditor.getState().project.cameraCuts[0].id);
    });
    const cubeId = useEditor.getState().selectedId!;
    const before = evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === cubeId)!, 1).position[2];
    fireEvent.keyDown(window, { code: 'KeyE', key: 'e' });
    act(() => vi.advanceTimersByTime(64));
    fireEvent.keyUp(window, { code: 'KeyE', key: 'e' });
    const afterUp = evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === cubeId)!, useEditor.getState().currentFrame).position[2];
    expect(afterUp).toBeGreaterThan(before);
    expect(useEditor.getState().isPlaying).toBe(false);
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q' });
    act(() => vi.advanceTimersByTime(64));
    fireEvent.keyUp(window, { code: 'KeyQ', key: 'q' });
    const afterDown = evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === cubeId)!, useEditor.getState().currentFrame).position[2];
    expect(afterDown).toBeLessThan(afterUp);
  });

  it('mostra solo la miniatura camera e permette di ridurla', () => {
    render(<Viewport />);
    expect(screen.queryByRole('button', { name: 'Shot frame' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Camera · Scene/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse camera preview' }));
    expect(screen.queryByRole('button', { name: "Open camera preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand camera preview' }));
    expect(screen.getByRole('button', { name: "Open camera preview" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Restore starting position' }));
    const state = useEditor.getState();
    const object = state.project.objects.find((item) => item.id === state.selectedId)!;
    expect(evaluateTransform(object, state.currentFrame).position).toEqual([2, 1, 1]);
    expect(evaluateTransform(object, state.currentFrame).rotation).toEqual([0, 0, 20]);
  });
});
