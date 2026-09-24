import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { useEditor } from '../store/editor';
import Timeline from './Timeline';

beforeEach(() => {
  const project = createProject();
  project.objects[0].keyframes = [1, 36, 72].map((frame) => ({ id: `point-${frame}`, frame, property: 'position', purpose: 'motion', value: [frame, -10, 7], interpolation: 'linear', source: 'user', commentIds: [] }));
  useEditor.setState({ project, currentFrame: 20, cameraView: false, selectedId: undefined, selectedMotion: undefined, recordingSession: undefined, recordingMotion: undefined, past: [], future: [], dirty: false, isPlaying: false });
  vi.stubGlobal('PointerEvent', MouseEvent);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const motionFrames = () => useEditor.getState().project.objects[0].keyframes.filter(k => k.property === 'position' && k.purpose === 'motion').map(k => k.frame).sort((a, b) => a - b);

describe('Punti e maniglie del movimento', () => {
  it('mostra un audio lungo come clip unica con la sua waveform oltre i confini scena', () => {
    useEditor.getState().addShot();
    useEditor.getState().setFrame(60);
    useEditor.getState().addAudio({ sourcePath: '/sound.wav', name: 'Ambiente', duration: 5, waveform: [.2, .8, .4, 1] });
    const { container } = render(<Timeline />);
    expect(container.querySelectorAll('.presence-segment.audio-layer')).toHaveLength(1);
    expect(container.querySelectorAll('.audio-waveform rect')).toHaveLength(4);
    const audio = useEditor.getState().project.objects.find((object) => object.kind === 'audio')!;
    expect(audio.sceneIds).toEqual([]);
    expect(useEditor.getState().project.settings.frameEnd).toBeGreaterThan(72);
  });

  it('aggiunge una scena direttamente dalla timeline', () => {
    render(<Timeline />);
    const addScene = screen.getByRole('button', { name: 'Aggiungi scena dalla timeline' });
    expect(addScene.closest('.scene-track')).not.toBeNull();
    fireEvent.click(addScene);
    expect(useEditor.getState().project.cameraCuts).toHaveLength(2);
    expect(useEditor.getState().currentFrame).toBe(73);
  });

  it('sposta la testina cliccando nello spazio vuoto della timeline', () => {
    const { container } = render(<Timeline />);
    const timeline = container.querySelector('.timeline-scroll')!;
    const sceneTrack = container.querySelector('.scene-track')!;
    vi.spyOn(sceneTrack, 'getBoundingClientRect').mockReturnValue({ left: 180, right: 900, width: 720 } as DOMRect);
    fireEvent.click(timeline, { clientX: 540 });
    expect(useEditor.getState().currentFrame).toBe(37);
  });

  it('al secondo clic su una scena torna al suo inizio', () => {
    const { container } = render(<Timeline />);
    const scene = container.querySelector<HTMLButtonElement>('.scene-image[title="Scena 1"]')!;
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 720, width: 720 } as DOMRect);
    fireEvent.click(scene, { clientX: 360 });
    expect(useEditor.getState().currentFrame).toBe(37);
    fireEvent.click(scene, { clientX: 360 });
    expect(useEditor.getState().currentFrame).toBe(1);
  });

  it('al secondo clic sul rettangolo di un elemento torna all’inizio della scena', () => {
    useEditor.getState().addObject('cube');
    render(<Timeline />);
    const segment = screen.getByTitle(/Cubo 1 · frame/);
    vi.spyOn(segment, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 720, width: 720 } as DOMRect);
    fireEvent.click(segment, { clientX: 360 });
    expect(useEditor.getState().currentFrame).toBe(37);
    fireEvent.click(segment, { clientX: 360 });
    expect(useEditor.getState().currentFrame).toBe(1);
  });

  it.each([1, 72])('il punto al frame %s seleziona quel fotogramma senza ridimensionare', (frame) => {
    useEditor.setState({ cameraView: true });
    render(<Timeline />);
    const point = screen.getByRole('button', { name: `Punto movimento al frame ${frame}` });
    expect(point).toHaveAttribute('data-edge', frame === 1 ? 'start' : 'end');
    fireEvent.pointerDown(point, { clientX: 100 });
    fireEvent.pointerUp(window, { clientX: 100 });
    fireEvent.click(point);
    expect(useEditor.getState().currentFrame).toBe(frame);
    expect(motionFrames()).toEqual([1, 36, 72]);
  });

  it('annulla un trascinamento interrotto senza lasciare listener che spostano altri punti', () => {
    const { container } = render(<Timeline />);
    const track = container.querySelector('.movement-track')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 720, width: 720 } as DOMRect);
    const first = screen.getByRole('button', { name: 'Punto movimento al frame 1' });
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 180 });
    fireEvent.pointerCancel(window, { pointerId: 1, clientX: 180 });
    expect(motionFrames()).toEqual([1, 36, 72]);
    const middle = screen.getByRole('button', { name: 'Punto movimento al frame 36' });
    fireEvent.pointerDown(middle, { pointerId: 2, clientX: 300 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 400 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 400 });
    const frames = motionFrames();
    expect(frames).toHaveLength(3);
    expect(new Set(frames).size).toBe(3);
    expect(frames).not.toContain(36);
  });

  it('seleziona una barra e un punto senza cambiare la modalità della vista', () => {
    useEditor.setState({ cameraView: true });
    render(<Timeline />);
    const cameraMotion = screen.getByTitle(/Movimento camera/);
    expect(cameraMotion).toHaveClass('camera-motion-segment');
    fireEvent.click(cameraMotion);
    expect(useEditor.getState().cameraView).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Punto movimento al frame 36' }));
    expect(useEditor.getState().cameraView).toBe(true);
    expect(useEditor.getState().currentFrame).toBe(36);
  });

  it('in vista libera il clic seleziona il keyframe e porta la testina al suo fotogramma', () => {
    useEditor.getState().addObject('cube');
    const selectedBefore = useEditor.getState().selectedId;
    render(<Timeline />);
    fireEvent.click(screen.getByRole('button', { name: 'Punto movimento al frame 36' }));
    expect(useEditor.getState().currentFrame).toBe(36);
    expect(useEditor.getState().selectedId).toBe(selectedBefore);
    expect(useEditor.getState().selectedMotion).toMatchObject({ keyframeId: 'point-36' });
  });

  it('a timeline chiusa mostra tutte le scene nella barra cumulativa', () => {
    useEditor.getState().addShot();
    const { container } = render(<Timeline collapsed />);
    const overview = screen.getByRole('group', { name: 'Timeline ridotta delle scene' });
    expect(overview).toBeVisible();
    const segments = container.querySelectorAll('.collapsed-scene-segment');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveStyle({ left: '0px', width: '405px' });
    expect(segments[1]).toHaveStyle({ left: '405px', width: '405px' });
    expect(container.querySelector('.collapsed-scene-playhead')).not.toBeNull();
    expect(container.querySelector('.collapsed-scene-content')).toHaveStyle({ '--timeline-second-width': '135px' });
    expect(screen.queryByRole('button', { name: 'Elimina blocco selezionato' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Inquadratura a schermo intero')).not.toBeInTheDocument();
    expect(container.querySelector('.timeline-camera-zoom')).not.toBeInTheDocument();
    expect(overview.compareDocumentPosition(screen.getByRole('button', { name: 'Registra movimenti' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi scena dalla timeline ridotta' }));
    expect(useEditor.getState().project.cameraCuts).toHaveLength(3);
  });

  it('a timeline aperta non mostra la barra ridotta delle scene', () => {
    render(<Timeline />);
    expect(screen.queryByRole('group', { name: 'Timeline ridotta delle scene' })).not.toBeInTheDocument();
  });

  it('trascinare un punto sposta solo quel punto e non riscala gli altri tempi', () => {
    render(<Timeline />);
    const point = screen.getByRole('button', { name: 'Punto movimento al frame 1' });
    const track = point.closest('.movement-track')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ width: 720 } as DOMRect);
    fireEvent.pointerDown(point, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 100 });
    fireEvent.pointerUp(window, { clientX: 100 });
    expect(motionFrames()).toEqual([11, 36, 72]);
    expect(useEditor.getState().currentFrame).toBe(20);
    expect(useEditor.getState().selectedMotion?.keyframeId).toBeUndefined();
  });

  it('la maniglia resta indipendente e ridimensiona l’intero movimento', () => {
    render(<Timeline />);
    const handle = screen.getByRole('separator', { name: 'Ridimensiona fine movimento' });
    expect(handle.closest('.motion-key-ticks')).toBeNull();
    vi.spyOn(handle.closest('.movement-track')!, 'getBoundingClientRect').mockReturnValue({ width: 720 } as DOMRect);
    fireEvent.pointerDown(handle, { clientX: 720 });
    fireEvent.pointerMove(window, { clientX: 600 });
    fireEvent.pointerUp(window, { clientX: 600 });
    expect(motionFrames()).toEqual([1, 30, 60]);
  });
});
