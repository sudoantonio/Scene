import { describe, expect, it, vi } from 'vitest';
import { applyPlan, evaluateProperty, evaluateTransform, validatePlan } from './animation';
import { createProject, createSceneObject, ProjectSchema, type BlenderPlan } from './schema';
import { nextExportVersion } from './versioning';
import { normalizeWheelDelta, trackpadCameraOffset, TRACKPAD_PAN_SENSITIVITY, TRACKPAD_ROTATE_SENSITIVITY } from './gestures';
import { useEditor } from '../store/editor';

describe('AbacoSceneV1', () => {
  it('crea un progetto valido con camera iniziale', () => {
    const project = createProject();
    expect(ProjectSchema.parse(project).objects[0].kind).toBe('camera');
    expect(project.cameraCuts[0].frame).toBe(1);
    expect(project.cameraCuts[0].lighting.preset).toBe('neutral');
  });

  it('aggiunge l’illuminazione predefinita ai vecchi progetti', () => {
    const legacy = createProject() as unknown as { cameraCuts: Array<Record<string, unknown>> };
    delete legacy.cameraCuts[0].lighting;
    expect(ProjectSchema.parse(legacy).cameraCuts[0].lighting.intensity).toBe(1);
  });

  it('aggiunge uno sfondo vuoto ai vecchi progetti', () => {
    const legacy = createProject() as unknown as { cameraCuts: Array<Record<string, unknown>> };
    delete legacy.cameraCuts[0].background;
    delete legacy.cameraCuts[0].framing;
    expect(ProjectSchema.parse(legacy).cameraCuts[0].background.kind).toBe('none');
    expect(ProjectSchema.parse(legacy).cameraCuts[0].framing.target).toEqual([0, 0, 1]);
  });

  it('mantiene un asset Blender come singolo oggetto validato', () => {
    const asset = createSceneObject('blend_asset', 1);
    asset.name = 'Personaggio';
    asset.asset = { sourcePath: '/tmp/personaggio.blend', proxyPath: '/tmp/personaggio.glb', collectionName: 'Character', boundsCenter: [0, 0, 1.5], previewScale: .5, groundOffset: .75 };
    const project = createProject();
    project.objects.push(asset);
    expect(ProjectSchema.parse(project).objects.at(-1)?.asset.previewScale).toBe(.5);
  });

  it('recupera un piano con una scala corrotta senza coprire la scena', () => {
    const project = createProject();
    const plane = createSceneObject('plane', 1);
    plane.transform.scale = [500, 300, 80];
    plane.keyframes.push({ id: crypto.randomUUID(), frame: 1, property: 'scale', value: [800, 900, 40], interpolation: 'constant', source: 'user', commentIds: [] });
    project.objects.push(plane);
    useEditor.getState().loadProject(project, '/tmp/piano.abaco.json');
    const recovered = useEditor.getState().project.objects.find((object) => object.id === plane.id)!;
    expect(recovered.transform.scale).toEqual([12, 12, 1]);
    expect(recovered.keyframes[0].value).toEqual([12, 12, 1]);
  });

  it('chiude i piccoli vuoti artificiali degli elementi al confine tra scene', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const damaged = structuredClone(useEditor.getState().project);
    const secondScene = damaged.cameraCuts.slice().sort((a, b) => a.frame - b.frame)[1];
    const cube = damaged.objects.find((object) => object.id === cubeId)!;
    const boundaryKey = cube.keyframes.find((key) => key.property === 'visibility' && key.frame === secondScene.frame)!;
    boundaryKey.value = false;
    cube.keyframes.push({ id: crypto.randomUUID(), frame: secondScene.frame + 2, property: 'visibility', value: true, interpolation: 'constant', source: 'user', commentIds: [] });
    useEditor.getState().loadProject(damaged, '/tmp/transizione.abaco.json');
    const repaired = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateProperty(repaired, 'visibility', secondScene.frame)).toBe(true);
    expect(repaired.keyframes.some((key) => key.property === 'visibility' && key.frame === secondScene.frame + 2)).toBe(false);
  });

  it('interpola una posizione lineare', () => {
    const object = createSceneObject('cube', 1);
    object.keyframes = [
      { id: crypto.randomUUID(), frame: 1, property: 'position', value: [0, 0, 0], interpolation: 'linear', source: 'user', commentIds: [] },
      { id: crypto.randomUUID(), frame: 11, property: 'position', value: [10, 0, 0], interpolation: 'linear', source: 'user', commentIds: [] },
    ];
    expect(evaluateTransform(object, 6).position).toEqual([5, 0, 0]);
  });

  it('attraversa i punti fluidi senza azzerare la velocità', () => {
    const object = createSceneObject('cube', 1);
    object.keyframes = [1, 11, 21].map((frame, index) => ({
      id: crypto.randomUUID(), frame, property: 'position' as const, value: [index * 10, 0, 0] as [number, number, number],
      interpolation: 'bezier' as const, source: 'user' as const, purpose: 'motion' as const, commentIds: [],
    }));
    const before = (evaluateProperty(object, 'position', 11) as [number, number, number])[0] - (evaluateProperty(object, 'position', 10) as [number, number, number])[0];
    const after = (evaluateProperty(object, 'position', 12) as [number, number, number])[0] - (evaluateProperty(object, 'position', 11) as [number, number, number])[0];
    expect(before).toBeGreaterThan(.5);
    expect(after).toBeGreaterThan(.5);
  });

  it('vincola ogni segmento camera ai suoi due keyframe senza deviazioni inventate', () => {
    const camera = createSceneObject('camera', 1);
    camera.keyframes = [
      { id: crypto.randomUUID(), frame: 1, property: 'position', value: [0, 0, 5], interpolation: 'bezier', source: 'user', purpose: 'motion', commentIds: [] },
      { id: crypto.randomUUID(), frame: 11, property: 'position', value: [10, 0, 5], interpolation: 'bezier', source: 'user', purpose: 'motion', commentIds: [] },
      { id: crypto.randomUUID(), frame: 21, property: 'position', value: [10, 10, 15], interpolation: 'bezier', source: 'user', purpose: 'motion', commentIds: [] },
    ];

    const firstSegment = evaluateTransform(camera, 6).position;
    const secondSegment = evaluateTransform(camera, 16).position;

    expect(firstSegment).toEqual([5, 0, 5]);
    expect(secondSegment).toEqual([10, 5, 10]);
  });

  it('mantiene un punto per la sosta configurata e poi riparte', () => {
    const object = createSceneObject('cube', 1);
    object.keyframes = [
      { id: crypto.randomUUID(), frame: 1, property: 'position', value: [0, 0, 0], interpolation: 'linear', holdFrames: 3, source: 'user', purpose: 'motion', commentIds: [] },
      { id: crypto.randomUUID(), frame: 11, property: 'position', value: [10, 0, 0], interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] },
    ];
    expect(evaluateProperty(object, 'position', 4)).toEqual([0, 0, 0]);
    expect((evaluateProperty(object, 'position', 5) as [number, number, number])[0]).toBeCloseTo(10 / 7);
    expect(evaluateProperty(object, 'position', 11)).toEqual([10, 0, 0]);
  });
});

describe('BlenderPlanV1', () => {
  it('applica keyframe e traccia il commento', () => {
    const project = createProject();
    const cube = createSceneObject('cube', 1);
    const commentId = crypto.randomUUID();
    project.objects.push(cube);
    project.comments.push({ id: commentId, text: 'Spostalo a destra', targetIds: [cube.id], startFrame: 1, endFrame: 24, status: 'pending' });
    const plan: BlenderPlan = {
      schemaVersion: 'BlenderPlanV1', summary: 'Movimento', assumptions: [], warnings: [],
      operations: [{
        id: 'op-1', type: 'set_keyframe', objectId: cube.id, frame: 24, property: 'position',
        value: { vector: [3, 0, 0], boolean: null, text: null, number: null }, interpolation: 'bezier', rationale: 'Spostamento richiesto', commentIds: [commentId],
      }],
    };
    expect(validatePlan(project, plan)).toEqual([]);
    const result = applyPlan(project, plan);
    expect(result.objects.find((object) => object.id === cube.id)?.keyframes[0].source).toBe('ai');
    expect(result.comments[0].status).toBe('applied');
  });

  it('rifiuta oggetti e frame inesistenti', () => {
    const project = createProject();
    const plan: BlenderPlan = {
      schemaVersion: 'BlenderPlanV1', summary: '', assumptions: [], warnings: [],
      operations: [{
        id: 'bad', type: 'set_keyframe', objectId: crypto.randomUUID(), frame: 999, property: 'scale',
        value: { vector: [0, 1, 1], boolean: null, text: null, number: null }, interpolation: 'linear', rationale: '', commentIds: [],
      }],
    };
    expect(validatePlan(project, plan).length).toBeGreaterThanOrEqual(3);
  });
});

describe('versioni export', () => {
  it('non sovrascrive cartelle esistenti', () => {
    expect(nextExportVersion(['v001', 'v003', 'note.txt'])).toBe('v004');
    expect(nextExportVersion([])).toBe('v001');
  });
});

describe('gesture viewport', () => {
  it('inverte i delta del trackpad e ne riduce la sensibilità', () => {
    expect(TRACKPAD_PAN_SENSITIVITY).toBeLessThan(0.5);
    expect(trackpadCameraOffset(100, 100)).toEqual({ horizontal: -8, vertical: 8 });
    expect(TRACKPAD_ROTATE_SENSITIVITY).toBeLessThan(.002);
  });

  it('normalizza il panning del trackpad su entrambi gli assi e limita i picchi', () => {
    expect(normalizeWheelDelta(3, -4, 1, 600)).toEqual({ x: 48, y: -64 });
    expect(normalizeWheelDelta(900, -900, 0, 600)).toEqual({ x: 160, y: -160 });
  });
});

describe('scene indipendenti', () => {
  it('crea punti di movimento soltanto dopo l’attivazione esplicita', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [2, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes.some((key) => key.purpose === 'motion')).toBe(false);
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(40);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const positions = cube.keyframes.filter((key) => key.property === 'position').sort((a, b) => a.frame - b.frame);
    expect(positions.map((key) => [key.frame, key.purpose])).toEqual([[1, 'motion'], [25, 'motion'], [40, 'motion']]);
    expect(evaluateTransform(cube, 25).position).toEqual([2, 0, 1]);
    expect(evaluateTransform(cube, 40).position).toEqual([6, 0, 1]);
  });

  it('REC si interrompe senza trasformare gli spostamenti successivi in nuovi punti', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().stopMotion();
    useEditor.getState().setFrame(40);
    useEditor.getState().setTransform(cubeId, { position: [8, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(useEditor.getState().recordingMotion).toBeUndefined();
    expect(cube.keyframes.some((key) => key.purpose === 'motion' && key.frame === 40)).toBe(false);
  });

  it('una sessione REC registra tutti gli oggetti e la camera effettivamente mossi', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addObject('sphere');
    const sphereId = useEditor.getState().selectedId!;
    const scene = useEditor.getState().project.cameraCuts[0];
    const cameraId = scene.cameraId;
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setFrame(12);
    useEditor.getState().setTransform(cubeId, { position: [2, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().setFrame(18);
    useEditor.getState().setTransform(cubeId, { position: [4, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().setFrame(24);
    useEditor.getState().setTransform(sphereId, { position: [0, 3, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().setFrame(30);
    useEditor.getState().setCameraFraming(scene.id, [7, -7, 5], [60, 40, 20], [0, 0, 1]);
    useEditor.getState().stopRecording();
    const state = useEditor.getState();
    const cubeFrames = state.project.objects.find((object) => object.id === cubeId)!.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').map((key) => key.frame).sort((a, b) => a - b);
    const sphereFrames = state.project.objects.find((object) => object.id === sphereId)!.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').map((key) => key.frame).sort((a, b) => a - b);
    const cameraFrames = state.project.objects.find((object) => object.id === cameraId)!.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').map((key) => key.frame).sort((a, b) => a - b);
    expect(cubeFrames).toEqual([1, 18]);
    expect(sphereFrames).toEqual([1, 24]);
    expect(cameraFrames).toEqual([1, 30]);
    expect(state.recordingSession).toBeUndefined();
    expect(state.isPlaying).toBe(false);
    expect(state.selectedMotion).toEqual({ objectId: cameraId, sceneId: scene.id });
  });

  it('REC segue una scena selezionata durante la registrazione e salva lì il movimento', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const [firstScene, secondScene] = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().setFrame(firstScene.frame);
    useEditor.getState().startRecording(firstScene.id);
    useEditor.getState().setFrame(secondScene.frame);
    expect(useEditor.getState().recordingSession?.sceneId).toBe(secondScene.id);
    useEditor.getState().setFrame(secondScene.frame + 12);
    useEditor.getState().setTransform(cubeId, { position: [4, 2, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().stopRecording();
    const state = useEditor.getState();
    const cube = state.project.objects.find((object) => object.id === cubeId)!;
    const secondSceneMotion = cube.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion' && key.frame >= secondScene.frame);
    expect(secondSceneMotion.map((key) => key.frame).sort((a, b) => a - b)).toEqual([secondScene.frame, secondScene.frame + 12]);
    expect(state.selectedMotion).toEqual({ objectId: cubeId, sceneId: secondScene.id });
  });

  it('REC salva l’inquadratura modificata dopo il passaggio a una nuova scena', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'bezier', past: [], future: [], dirty: false });
    useEditor.getState().addShot();
    const [firstScene, secondScene] = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().setFrame(firstScene.frame);
    useEditor.getState().startRecording(firstScene.id);
    useEditor.getState().setFrame(secondScene.frame);
    useEditor.getState().setFrame(secondScene.frame + 18);
    useEditor.getState().setCameraFraming(secondScene.id, [9, -6, 4], [63, 0, 34], [1, 2, 1]);
    useEditor.getState().stopRecording();
    const state = useEditor.getState();
    const updatedScene = state.project.cameraCuts.find((scene) => scene.id === secondScene.id)!;
    const camera = state.project.objects.find((object) => object.id === updatedScene.cameraId)!;
    const motion = camera.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion' && key.frame >= secondScene.frame).sort((a, b) => a.frame - b.frame);
    expect(motion.map((key) => key.frame)).toEqual([secondScene.frame, secondScene.frame + 18]);
    expect(motion.at(-1)?.value).toEqual([9, -6, 4]);
    expect(state.selectedMotion).toEqual({ objectId: camera.id, sceneId: secondScene.id });
  });

  it('salva la visuale camera come punto controllabile anche senza REC', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'bezier', past: [], future: [], dirty: false });
    const scene = useEditor.getState().project.cameraCuts[0];
    const cameraId = scene.cameraId;
    useEditor.getState().selectMotion({ objectId: cameraId, sceneId: scene.id });
    useEditor.getState().setFrame(scene.frame + 20);
    useEditor.getState().setCameraFraming(scene.id, [8, -5, 6], [70, 0, 28], [0, 0, 1]);
    const camera = useEditor.getState().project.objects.find((object) => object.id === cameraId)!;
    const point = camera.keyframes.find((key) => key.property === 'position' && key.frame === scene.frame + 20 && key.purpose === 'motion');
    expect(point?.value).toEqual([8, -5, 6]);
    expect(useEditor.getState().selectedMotion).toMatchObject({ objectId: cameraId, sceneId: scene.id, keyframeId: point!.id });
  });

  it('crea un keyframe muovendo la camera in un frame intermedio senza REC', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    const scene = useEditor.getState().project.cameraCuts[0];
    const cameraId = scene.cameraId;
    useEditor.getState().setFrame(scene.frame + 18);
    useEditor.getState().setCameraFraming(scene.id, [7, -4, 5], [68, 0, 24], [0, 0, 1]);
    const state = useEditor.getState();
    const camera = state.project.objects.find((object) => object.id === cameraId)!;
    const point = camera.keyframes.find((key) => key.property === 'position' && key.frame === scene.frame + 18 && key.purpose === 'motion');
    expect(point?.value).toEqual([7, -4, 5]);
    expect(state.selectedMotion).toMatchObject({ objectId: cameraId, sceneId: scene.id, keyframeId: point!.id });
  });

  it('crea un keyframe spostando direttamente la camera nella vista libera senza REC', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    const scene = useEditor.getState().project.cameraCuts[0];
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    useEditor.getState().setFrame(scene.frame + 12);
    useEditor.getState().setTransform(camera.id, { position: [6, -3, 4], rotation: [65, 0, 20], scale: [1, 1, 1] });
    const state = useEditor.getState();
    const updated = state.project.objects.find((object) => object.id === scene.cameraId)!;
    const point = updated.keyframes.find((key) => key.property === 'position' && key.frame === scene.frame + 12 && key.purpose === 'motion');
    expect(point?.value).toEqual([6, -3, 4]);
    expect(state.selectedMotion).toMatchObject({ objectId: camera.id, sceneId: scene.id, keyframeId: point!.id });
  });

  it('REC si arma senza avviare la riproduzione', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false, isPlaying: false });
    const scene = useEditor.getState().project.cameraCuts[0];
    useEditor.getState().startRecording(scene.id);
    expect(useEditor.getState().recordingSession?.sceneId).toBe(scene.id);
    expect(useEditor.getState().isPlaying).toBe(false);
    useEditor.getState().stopRecording();
  });

  it('salva una nuova inquadratura nel keyframe camera cliccato senza REC', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false, isPlaying: false });
    const scene = useEditor.getState().project.cameraCuts[0];
    const cameraId = scene.cameraId;
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setFrame(24);
    useEditor.getState().setCameraFraming(scene.id, [7, -6, 5], [65, 0, 28], [0, 0, 1]);
    useEditor.getState().stopRecording();
    const positionKey = useEditor.getState().project.objects.find((object) => object.id === cameraId)!.keyframes.find((key) => key.property === 'position' && key.purpose === 'motion' && key.frame === 24)!;
    useEditor.getState().selectMotion({ objectId: cameraId, sceneId: scene.id, keyframeId: positionKey.id });
    useEditor.getState().setFrame(24);
    useEditor.getState().setCameraFraming(scene.id, [9, -4, 6], [70, 2, 35], [1, 1, 2]);
    const camera = useEditor.getState().project.objects.find((object) => object.id === cameraId)!;
    expect(camera.keyframes.find((key) => key.property === 'position' && key.frame === 24)?.value).toEqual([9, -4, 6]);
    expect(camera.keyframes.find((key) => key.property === 'rotation' && key.frame === 24)?.value).toEqual([70, 2, 35]);
  });

  it('salva anche un keyframe camera precedente privo del marcatore motion quando viene cliccato', () => {
    const project = createProject();
    const scene = project.cameraCuts[0];
    const camera = project.objects.find((object) => object.id === scene.cameraId)!;
    camera.keyframes.push({ id: 'legacy-camera-point', frame: 18, property: 'position', value: [5, -6, 4], interpolation: 'linear', source: 'user', commentIds: [] });
    camera.keyframes.push({ id: 'legacy-camera-rotation', frame: 18, property: 'rotation', value: [62, 0, 18], interpolation: 'linear', source: 'user', commentIds: [] });
    useEditor.setState({ project, currentFrame: 18, selectedId: undefined, selectedMotion: { objectId: camera.id, sceneId: scene.id, keyframeId: 'legacy-camera-point' }, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false, isPlaying: false });

    useEditor.getState().setCameraFraming(scene.id, [8, -4, 6], [70, 1, 32], [1, 0, 2]);

    const updated = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    expect(updated.keyframes.find((key) => key.property === 'position' && key.frame === 18)?.value).toEqual([8, -4, 6]);
    expect(updated.keyframes.find((key) => key.property === 'rotation' && key.frame === 18)?.value).toEqual([70, 1, 32]);
  });

  it('mantiene e aggiorna il keyframe camera selezionato quando la scena separa una camera condivisa', () => {
    const project = createProject();
    const firstScene = project.cameraCuts[0];
    project.cameraCuts.push({ ...structuredClone(firstScene), id: crypto.randomUUID(), frame: 40, name: 'Scena 2' });
    const camera = project.objects.find((object) => object.id === firstScene.cameraId)!;
    camera.keyframes.push({ id: 'shared-point', frame: 20, property: 'position', value: [4, -6, 4], interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] });
    camera.keyframes.push({ id: 'shared-rotation', frame: 20, property: 'rotation', value: [65, 0, 25], interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] });
    useEditor.setState({ project, currentFrame: 20, selectedId: undefined, selectedMotion: { objectId: camera.id, sceneId: firstScene.id, keyframeId: 'shared-point' }, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false, isPlaying: false });

    useEditor.getState().setCameraFraming(firstScene.id, [8, -3, 6], [72, 1, 42], [1, 0, 2]);

    const state = useEditor.getState();
    const sceneCamera = state.project.objects.find((object) => object.id === state.project.cameraCuts[0].cameraId)!;
    expect(sceneCamera.id).not.toBe(camera.id);
    expect(sceneCamera.keyframes.find((key) => key.property === 'position' && key.frame === 20)?.value).toEqual([8, -3, 6]);
    expect(sceneCamera.keyframes.find((key) => key.property === 'rotation' && key.frame === 20)?.value).toEqual([72, 1, 42]);
    expect(state.selectedMotion).toMatchObject({ objectId: sceneCamera.id, sceneId: firstScene.id });
    expect(sceneCamera.keyframes.some((key) => key.id === state.selectedMotion?.keyframeId && key.frame === 20)).toBe(true);
  });

  it('salva posizione rotazione e scala nel keyframe elemento cliccato', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false, isPlaying: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const scene = useEditor.getState().project.cameraCuts[0];
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setFrame(30);
    useEditor.getState().setTransform(cubeId, { position: [3, 0, 1], rotation: [0, 0, 20], scale: [1, 1, 1] });
    useEditor.getState().stopRecording();
    const positionKey = useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes.find((key) => key.property === 'position' && key.purpose === 'motion' && key.frame === 30)!;
    useEditor.getState().selectMotion({ objectId: cubeId, sceneId: scene.id, keyframeId: positionKey.id });
    useEditor.getState().setFrame(30);
    useEditor.getState().setTransform(cubeId, { position: [5, 2, 1], rotation: [4, 8, 45], scale: [1.2, 1.3, 1.4] });
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(cube, 30)).toMatchObject({ position: [5, 2, 1], rotation: [4, 8, 45], scale: [1.2, 1.3, 1.4] });
  });

  it('REC mantiene continua una piccola rotazione camera oltre il bordo di 180 gradi', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    const scene = useEditor.getState().project.cameraCuts[0];
    useEditor.getState().setCameraFraming(scene.id, [8, -10, 7], [0, 0, 179], [0, 0, 1]);
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setFrame(scene.frame + 12);
    useEditor.getState().setCameraFraming(scene.id, [8, -10, 7], [0, 0, -179], [0, 0, 1]);
    useEditor.getState().stopRecording();
    const camera = useEditor.getState().project.objects.find((object) => object.id === scene.cameraId)!;
    const rotations = camera.keyframes.filter((key) => key.property === 'rotation' && key.purpose === 'motion').sort((a, b) => a.frame - b.frame);
    const start = (rotations[0]!.value as [number, number, number])[2];
    const end = (rotations.at(-1)!.value as [number, number, number])[2];
    expect(Math.abs(end - start)).toBeCloseTo(2);
  });

  it('ripara le rotazioni camera discontinue già presenti nei progetti', () => {
    const project = createProject();
    const camera = project.objects[0];
    camera.transform.rotation = [0, 0, 179];
    camera.keyframes = [
      { id: crypto.randomUUID(), frame: 1, property: 'rotation', value: [0, 0, 179], interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] },
      { id: crypto.randomUUID(), frame: 13, property: 'rotation', value: [0, 0, -179], interpolation: 'linear', source: 'user', purpose: 'motion', commentIds: [] },
    ];
    useEditor.getState().loadProject(project, '/tmp/rotazioni-camera.abaco.json');
    const repaired = useEditor.getState().project.objects[0].keyframes.filter((key) => key.property === 'rotation').sort((a, b) => a.frame - b.frame);
    expect((repaired[1]!.value as [number, number, number])[2]).toBe(181);
    expect((evaluateTransform(useEditor.getState().project.objects[0], 7).rotation as [number, number, number])[2]).toBe(180);
  });

  it('compatta una registrazione continua in pochi punti senza perdere la posa finale', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'bezier', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startRecording(sceneId);
    for (let frame = 2; frame <= 72; frame += 1) {
      useEditor.getState().setFrame(frame);
      useEditor.getState().setTransform(cubeId, { position: [frame / 10, Math.sin(frame / 8), 1], rotation: [0, 0, frame], scale: [1, 1, 1] });
    }
    useEditor.getState().stopRecording();
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const positions = cube.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').sort((a, b) => a.frame - b.frame);
    expect(positions.length).toBeLessThanOrEqual(7);
    expect(positions.at(-1)?.frame).toBe(72);
    expect(evaluateTransform(cube, 72).position).toEqual([7.2, Math.sin(9), 1]);
  });

  it('ridimensiona un blocco movimento rimappando i punti e quindi la velocità', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startRecording(sceneId);
    useEditor.getState().setFrame(20);
    useEditor.getState().setTransform(cubeId, { position: [5, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().setFrame(40);
    useEditor.getState().setTransform(cubeId, { position: [10, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().stopRecording();
    useEditor.getState().resizeMotionRange(cubeId, sceneId, 10, 31);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const motionFrames = cube.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').map((key) => key.frame).sort((a, b) => a - b);
    expect(motionFrames).toEqual([10, 20, 30]);
    expect(evaluateTransform(cube, 10).position).toEqual([0, 0, 1]);
    expect(evaluateTransform(cube, 30).position).toEqual([10, 0, 1]);
  });

  it('REC porta al punto finale e produce subito un movimento modificabile', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    expect(useEditor.getState().currentFrame).toBe(72);
    useEditor.getState().setTransform(cubeId, { position: [5, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().stopMotion();
    useEditor.getState().setTransform(cubeId, { position: [7, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const positionPoints = cube.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').sort((a, b) => a.frame - b.frame);
    expect(positionPoints.map((key) => key.frame)).toEqual([1, 72]);
    expect(evaluateTransform(cube, 72).position).toEqual([7, 0, 1]);
  });

  it('REC in pausa aggiunge un punto senza sovrascrivere i keyframe esistenti', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'bezier', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setTransform(cubeId, { position: [8, 0, 1], rotation: [0, 0, 35], scale: [1.2, 1.2, 1.2] });
    useEditor.getState().stopMotion();
    const before = structuredClone(useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes);
    useEditor.getState().setFrame(1);
    useEditor.getState().selectMotion(undefined);
    useEditor.getState().startRecording(sceneId);
    useEditor.getState().setFrame(24);
    useEditor.getState().setPlaying(false);
    useEditor.getState().setTransform(cubeId, { position: [3, 2, 1], rotation: [0, 0, 12], scale: [1, 1, 1] });
    useEditor.getState().stopRecording();
    const after = useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes;
    for (const oldKey of before) expect(after.find((key) => key.id === oldKey.id)).toEqual(oldKey);
    expect(after.some((key) => key.property === 'position' && key.frame === 24 && key.purpose === 'motion' && JSON.stringify(key.value) === JSON.stringify([3, 2, 1]))).toBe(true);
  });

  it('REC avviato direttamente da una scena successiva crea i keyframe in quella scena', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, recordingSession: undefined, interpolation: 'bezier', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const secondScene = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame)[1];
    useEditor.getState().setFrame(secondScene.frame);
    useEditor.getState().select(cubeId);
    useEditor.getState().startRecording(secondScene.id);
    expect(useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes.some((key) => key.property === 'position' && key.purpose === 'motion' && key.frame === secondScene.frame)).toBe(true);
    useEditor.getState().setFrame(secondScene.frame + 16);
    useEditor.getState().setPlaying(false);
    useEditor.getState().setTransform(cubeId, { position: [5, 2, 1], rotation: [0, 0, 18], scale: [1, 1, 1] });
    useEditor.getState().stopRecording();
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const frames = cube.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion' && key.frame >= secondScene.frame).map((key) => key.frame).sort((a, b) => a - b);
    expect(frames).toEqual([secondScene.frame, secondScene.frame + 16]);
  });

  it('permette di spostare un punto esistente del percorso', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const point = useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes.find((key) => key.property === 'position' && key.frame === 25)!;
    useEditor.getState().updateMotionPoint(cubeId, point.id, [4, 2, 1]);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(cube, 25).position).toEqual([4, 2, 1]);
  });

  it('inserisce un punto modificabile cliccando tra due punti del percorso', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'bezier', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(49);
    useEditor.getState().setTransform(cubeId, { position: [8, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const insertedId = useEditor.getState().insertMotionPoint(cubeId, sceneId, 25, [4, 2, 1]);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(insertedId).toBeTruthy();
    expect(cube.keyframes.find((key) => key.id === insertedId)).toMatchObject({ frame: 25, property: 'position', value: [4, 2, 1], purpose: 'motion', source: 'user' });
    expect(evaluateTransform(cube, 25).position).toEqual([4, 2, 1]);
  });

  it('imposta la sosta sull’intera posa del punto e la limita al punto seguente', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 20], scale: [1.2, 1.2, 1.2] });
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const point = cube.keyframes.find((key) => key.property === 'position' && key.frame === 1)!;
    useEditor.getState().setMotionPointHold(cubeId, point.id, 999);
    const keys = useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes.filter((key) => key.frame === 1 && key.purpose === 'motion');
    expect(keys.map((key) => key.holdFrames)).toEqual([23, 23, 23]);
  });

  it('elimina soltanto il blocco movimento della scena', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().deleteMotionFromScene(cubeId, sceneId);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(cube.keyframes.some((key) => key.purpose === 'motion' && ['position', 'rotation', 'scale'].includes(key.property))).toBe(false);
    expect(evaluateTransform(cube, 25).position).toEqual([0, 0, 1]);
    expect(evaluateProperty(cube, 'visibility', 25)).toBe(true);
  });

  it('sposta ed elimina un punto di movimento dalla timeline', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 20], scale: [1.2, 1.2, 1.2] });
    const point = useEditor.getState().project.objects.find((object) => object.id === cubeId)!.keyframes.find((key) => key.property === 'position' && key.frame === 25)!;
    useEditor.getState().moveMotionPoint(cubeId, point.id, 37);
    let cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(cube.keyframes.filter((key) => ['position', 'rotation', 'scale'].includes(key.property) && key.frame === 37)).toHaveLength(3);
    expect(cube.keyframes.some((key) => key.frame === 25 && ['position', 'rotation', 'scale'].includes(key.property))).toBe(false);
    useEditor.getState().deleteMotionPoint(cubeId, point.id);
    cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(cube.keyframes.some((key) => key.frame === 37 && ['position', 'rotation', 'scale'].includes(key.property))).toBe(false);
  });

  it('spostando un punto elimina eventuali duplicati dello stesso fotogramma', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 1], rotation: [0, 0, 20], scale: [1.2, 1.2, 1.2] });
    const damaged = structuredClone(useEditor.getState().project);
    const object = damaged.objects.find((item) => item.id === cubeId)!;
    const point = object.keyframes.find((key) => key.property === 'position' && key.frame === 25)!;
    object.keyframes.push({ ...structuredClone(point), id: crypto.randomUUID(), value: [99, 99, 99] });
    useEditor.setState({ project: damaged });
    useEditor.getState().moveMotionPoint(cubeId, point.id, 37);
    const moved = useEditor.getState().project.objects.find((item) => item.id === cubeId)!.keyframes;
    expect(moved.filter((key) => key.property === 'position' && key.frame === 37)).toHaveLength(1);
    expect(moved.filter((key) => ['position', 'rotation', 'scale'].includes(key.property) && key.frame === 37)).toHaveLength(3);
  });

  it('allunga una scena oltre i tre secondi', () => {
    const project = createProject();
    const sceneId = project.cameraCuts[0].id;
    useEditor.setState({ project, currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().resizeScene(sceneId, 120);
    expect(useEditor.getState().project.settings.frameEnd).toBe(120);
  });

  it('spostando la camera mantiene coerente la direzione dell’inquadratura', () => {
    const project = createProject();
    const cameraId = project.objects[0].id;
    const scene = project.cameraCuts[0];
    useEditor.setState({ project, currentFrame: 1, selectedId: cameraId, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setFrame(25);
    useEditor.getState().setTransform(cameraId, { position: [8, -7, 5], rotation: [60.255, 40.966, 20.538], scale: [1, 1, 1] });
    useEditor.getState().stopRecording();
    const target = useEditor.getState().project.cameraCuts[0].framing.target;
    expect(target[0]).toBeCloseTo(1, 3);
    expect(target[1]).toBeCloseTo(0, 3);
    expect(target[2]).toBeCloseTo(1, 3);
  });

  it('aggiunge un asset Blender con snapshot indipendenti', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addBlendAsset({ sourcePath: '/tmp/personaggio.blend', proxyPath: '/tmp/personaggio.glb', collectionName: 'Character', name: 'Personaggio', boundsCenter: [0, 0, 1], previewScale: .8, groundOffset: .8 });
    const asset = useEditor.getState().project.objects.find((object) => object.kind === 'blend_asset')!;
    expect(asset.name).toBe('Personaggio');
    expect(asset.keyframes.map((key) => key.property)).toEqual(['position', 'rotation', 'scale', 'visibility']);
    expect(evaluateTransform(asset, 1).position[2]).toBeCloseTo(.8, 4);
    expect(evaluateTransform(asset, 1).rotation[2]).toBeCloseTo(45, 3);
    useEditor.getState().setTransform(asset.id, { ...evaluateTransform(asset, 1), position: [2, 3, 5] });
    useEditor.getState().alignObjectToGround(asset.id);
    expect(evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === asset.id)!, 1).position).toEqual([2, 3, .8]);
  });

  it('seleziona un nuovo elemento con lo strumento sposta', () => {
    useEditor.setState({ project: createProject(), gizmoMode: 'scale', selectedId: undefined, past: [], future: [] });
    useEditor.getState().addObject('cube');
    expect(useEditor.getState().gizmoMode).toBe('translate');
  });

  it('sostituisce un soggetto mantenendo identità, posizione, dimensione e movimento', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, interpolation: 'linear', past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().setTransform(cubeId, { position: [3, -2, 1], rotation: [5, 10, 15], scale: [1.8, 1.8, 1.8] });
    useEditor.getState().startMotion(cubeId, sceneId);
    useEditor.getState().setTransform(cubeId, { position: [6, -2, 1], rotation: [5, 10, 15], scale: [1.8, 1.8, 1.8] });
    useEditor.getState().stopMotion();
    useEditor.getState().replaceObject(cubeId, { kind: 'sphere', name: 'Sfera sostitutiva' });
    const replacement = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(replacement.kind).toBe('sphere');
    expect(replacement.screenSpace).toBe(false);
    expect(replacement.name).toBe('Sfera sostitutiva');
    expect(evaluateTransform(replacement, 1)).toEqual({ position: [3, -2, 1], rotation: [5, 10, 15], scale: [1.8, 1.8, 1.8] });
    expect(evaluateTransform(replacement, 72).position).toEqual([6, -2, 1]);
    expect(replacement.sceneIds).toEqual([sceneId]);
  });
  it('salva localmente anche la posizione di un progetto senza file', () => {
    vi.useFakeTimers();
    localStorage.removeItem('abaco-animatic-project-v1');
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().setTransform(cubeId, { position: [2.5, -1, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === cubeId)!, 1).position).toEqual([2.5, -1, 3]);
    vi.advanceTimersByTime(400);
    const saved = ProjectSchema.parse(JSON.parse(localStorage.getItem('abaco-animatic-project-v1')!));
    const cube = saved.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(cube, 1).position).toEqual([2.5, -1, 3]);
    vi.useRealTimers();
  });

  it('mantiene una sola camera nel progetto', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    const cameraId = useEditor.getState().project.objects[0].id;
    useEditor.getState().addObject('camera');
    expect(useEditor.getState().project.objects.filter((object) => object.kind === 'camera')).toHaveLength(1);
    expect(useEditor.getState().selectedId).toBe(cameraId);
  });

  it('una modifica nella seconda scena non cambia la prima', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().setTransform(cubeId, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().addShot();
    const secondFrame = useEditor.getState().currentFrame;
    useEditor.getState().setTransform(cubeId, { position: [5, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] });
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(cube, 1).position).toEqual([0, 0, 0]);
    expect(evaluateTransform(cube, secondFrame).position).toEqual([5, 0, 0]);
    expect(evaluateTransform(cube, secondFrame).scale).toEqual([2, 2, 2]);
    useEditor.getState().setFrame(1);
    useEditor.getState().setTransform(cubeId, { position: [-3, 0, 0], rotation: [0, 0, 0], scale: [.5, .5, .5] });
    const edited = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(edited, 1).position).toEqual([-3, 0, 0]);
    expect(evaluateTransform(edited, secondFrame).position).toEqual([5, 0, 0]);
    expect(evaluateTransform(edited, secondFrame).scale).toEqual([2, 2, 2]);
  });

  it('una nuova scena continua dalla posa finale della scena precedente', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    useEditor.getState().setTransform(cubeId, { position: [4, -2, 1], rotation: [10, 20, 30], scale: [1.5, 1.5, 1.5] });
    useEditor.getState().setFrame(1);
    useEditor.getState().addShot();
    const project = useEditor.getState().project;
    const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    const cube = project.objects.find((object) => object.id === cubeId)!;
    expect(scenes.map((scene) => scene.frame)).toEqual([1, 73, 145]);
    expect(evaluateTransform(cube, scenes[2].frame)).toEqual({ position: [4, -2, 1], rotation: [10, 20, 30], scale: [1.5, 1.5, 1.5] });
  });

  it('limita un nuovo elemento alla sola scena in cui viene aggiunto', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addShot();
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().setFrame(scenes[0].frame);
    useEditor.getState().addObject('cube');
    const cube = useEditor.getState().project.objects.find((object) => object.id === useEditor.getState().selectedId)!;
    expect(cube.sceneIds).toEqual([scenes[0].id]);
    expect(evaluateProperty(cube, 'visibility', scenes[0].frame)).toBe(true);
    expect(evaluateProperty(cube, 'visibility', scenes[1].frame)).toBe(false);
  });

  it('una nuova scena eredita gli elementi visibili della precedente', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const firstSceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().addShot();
    const project = useEditor.getState().project;
    const secondScene = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame)[1];
    const cube = project.objects.find((object) => object.id === cubeId)!;
    expect(cube.sceneIds).toEqual([firstSceneId, secondScene.id]);
    expect(evaluateProperty(cube, 'visibility', secondScene.frame)).toBe(true);
  });

  it('ridimensiona la presenza di un elemento dentro la scena al singolo frame', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().resizeObjectPresence(cubeId, sceneId, 13, 25);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateProperty(cube, 'visibility', 12)).toBe(false);
    expect(evaluateProperty(cube, 'visibility', 13)).toBe(true);
    expect(evaluateProperty(cube, 'visibility', 24)).toBe(true);
    expect(evaluateProperty(cube, 'visibility', 25)).toBe(false);
    expect(() => ProjectSchema.parse(useEditor.getState().project)).not.toThrow();
  });

  it('estende la presenza di un elemento nelle scene successive trascinando il rettangolo', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addShot();
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().setFrame(scenes[0].frame);
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().resizeObjectPresence(cubeId, scenes[0].id, scenes[0].frame, scenes[1].frame + 12);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(cube.sceneIds).toEqual(expect.arrayContaining([scenes[0].id, scenes[1].id]));
    expect(evaluateProperty(cube, 'visibility', scenes[1].frame)).toBe(true);
    expect(evaluateProperty(cube, 'visibility', scenes[1].frame + 11)).toBe(true);
    expect(evaluateProperty(cube, 'visibility', scenes[1].frame + 12)).toBe(false);
  });

  it('REC usa come fine il bordo visibile di un elemento accorciato', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingMotion: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const sceneId = useEditor.getState().project.cameraCuts[0].id;
    useEditor.getState().resizeObjectPresence(cubeId, sceneId, 1, 25);
    useEditor.getState().startMotion(cubeId, sceneId);
    const cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    const positionPoints = cube.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion').sort((a, b) => a.frame - b.frame);
    expect(useEditor.getState().currentFrame).toBe(24);
    expect(positionPoints.map((key) => key.frame)).toEqual([1, 24]);
  });

  it('incolla copie indipendenti soltanto nella scena scelta', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('text');
    const sourceId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const scene = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame)[1];
    const [copyId] = useEditor.getState().duplicateObjectsToScene([sourceId], scene.id);
    const copy = useEditor.getState().project.objects.find((object) => object.id === copyId)!;
    expect(copy.id).not.toBe(sourceId);
    expect(copy.sceneIds).toEqual([scene.id]);
    expect(evaluateProperty(copy, 'visibility', 1)).toBe(false);
    expect(evaluateProperty(copy, 'visibility', scene.frame)).toBe(true);
  });

  it('zoom e nota appartengono solo alla scena selezionata', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    const cameraId = useEditor.getState().project.objects[0].id;
    useEditor.getState().addShot();
    const secondFrame = useEditor.getState().currentFrame;
    useEditor.getState().updateObject(cameraId, { camera: { lens: 85 } });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().setSceneNote(cubeId, 'guarda confuso');
    const project = useEditor.getState().project;
    const camera = project.objects.find((object) => object.id === cameraId)!;
    const cube = project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateProperty(camera, 'lens', 1)).toBe(50);
    expect(evaluateProperty(camera, 'lens', secondFrame)).toBe(85);
    expect(cube.sceneNotes).toEqual([{ frame: secondFrame, text: 'guarda confuso' }]);
  });

  it('mantiene un preset luce indipendente per ogni scena', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().updateLighting({ preset: 'warm', color: '#ffc98f', intensity: 1.1 });
    useEditor.getState().addShot();
    useEditor.getState().updateLighting({ preset: 'dramatic', color: '#ffd0b5', intensity: 1.35 });
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    expect(scenes[0].lighting.preset).toBe('warm');
    expect(scenes[1].lighting.preset).toBe('dramatic');
  });

  it('mantiene uno sfondo indipendente per ogni scena', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().updateBackground({ kind: 'image', path: '/tmp/primo.png', name: 'primo.png' });
    useEditor.getState().addShot();
    useEditor.getState().updateBackground({ kind: 'model', path: '/tmp/secondo.glb', name: 'secondo.glb' });
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    expect(scenes.map((scene) => scene.background.kind)).toEqual(['image', 'model']);
  });

  it('riordina ed elimina solo gli elementi di contenuto', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addObject('text');
    const textId = useEditor.getState().selectedId!;
    useEditor.getState().reorderObjects(textId, cubeId);
    expect(useEditor.getState().project.objects.filter((object) => object.kind !== 'camera').map((object) => object.id)).toEqual([textId, cubeId]);
    useEditor.getState().deleteObject(textId);
    expect(useEditor.getState().project.objects.some((object) => object.id === textId)).toBe(false);
    expect(useEditor.getState().project.objects.filter((object) => object.kind === 'camera')).toHaveLength(1);
  });

  it('spostare la camera modifica soltanto la clip selezionata', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    const cameraId = useEditor.getState().project.objects[0].id;
    const firstPosition = [...useEditor.getState().project.objects[0].transform.position] as [number, number, number];
    useEditor.getState().addShot();
    const secondFrame = useEditor.getState().currentFrame;
    const secondPosition: [number, number, number] = [2, -4, 3];
    useEditor.getState().setTransform(cameraId, { position: secondPosition, rotation: [55, 0, 25], scale: [1, 1, 1] });
    const camera = useEditor.getState().project.objects.find((object) => object.id === cameraId)!;
    expect(evaluateTransform(camera, 1).position).toEqual(firstPosition);
    expect(evaluateTransform(camera, secondFrame - 1).position).toEqual(firstPosition);
    expect(evaluateTransform(camera, secondFrame).position).toEqual(secondPosition);
  });

  it('salva target e posa del rig camera soltanto nella scena indicata', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addShot();
    const modern = structuredClone(useEditor.getState().project);
    const modernScenes = modern.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    const originalSecondCameraId = modernScenes[1].cameraId;
    modernScenes[1].cameraId = modernScenes[0].cameraId;
    modern.objects = modern.objects.filter((object) => object.id !== originalSecondCameraId);
    useEditor.setState({ project: modern, currentFrame: modernScenes[1].frame, selectedId: undefined, past: [], future: [], dirty: false });
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    const cameraId = scenes[0].cameraId;
    const firstPosition = evaluateTransform(useEditor.getState().project.objects.find((object) => object.id === cameraId)!, scenes[0].frame).position;
    useEditor.getState().setCameraFraming(scenes[1].id, [2, -5, 3], [60, 10, 20], [1, 1, 0]);
    const project = useEditor.getState().project;
    const firstCamera = project.objects.find((object) => object.id === cameraId)!;
    const secondScene = project.cameraCuts.find((scene) => scene.id === scenes[1].id)!;
    const secondCamera = project.objects.find((object) => object.id === secondScene.cameraId)!;
    expect(secondScene.cameraId).not.toBe(cameraId);
    expect(evaluateTransform(firstCamera, scenes[0].frame).position).toEqual(firstPosition);
    expect(evaluateTransform(secondCamera, scenes[1].frame).position).toEqual([2, -5, 3]);
    expect(project.cameraCuts.find((scene) => scene.id === scenes[1].id)?.framing.target).toEqual([1, 1, 0]);
    expect(project.cameraCuts.find((scene) => scene.id === scenes[0].id)?.framing.target).toEqual([0, 0, 1]);
  });

  it('divide una clip al cursore creando una nuova scena', () => {
    useEditor.setState({ project: createProject(), currentFrame: 36, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().splitScene();
    const project = useEditor.getState().project;
    expect(project.cameraCuts.map((scene) => scene.frame).sort((a, b) => a - b)).toEqual([1, 36]);
    expect(project.cameraCuts.map((scene) => scene.name)).toEqual(['Scena 1', 'Scena 2']);
    expect(() => ProjectSchema.parse(project)).not.toThrow();
  });

  it('elimina una scena richiudendo la timeline senza cambiare quella successiva', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    useEditor.getState().addShot();
    useEditor.getState().setTransform(cubeId, { position: [9, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().deleteScene(scenes[1].id);
    const project = useEditor.getState().project;
    const cube = project.objects.find((object) => object.id === cubeId)!;
    expect(project.cameraCuts.map((scene) => scene.frame).sort((a, b) => a - b)).toEqual([1, 73]);
    expect(evaluateTransform(cube, 73).position).toEqual([9, 0, 0]);
    expect(project.settings.frameEnd).toBe(144);
    expect(() => ProjectSchema.parse(project)).not.toThrow();
  });

  it('elimina soltanto il blocco scelto quando l’elemento è stato copiato nella scena successiva', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const scenes = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().deleteObjectFromScene(cubeId, scenes[0].id);
    const project = useEditor.getState().project;
    const cube = project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateProperty(cube, 'visibility', scenes[0].frame)).toBe(false);
    expect(evaluateProperty(cube, 'visibility', scenes[1].frame)).toBe(true);
    expect(cube.sceneIds).toEqual([scenes[1].id]);
    expect(() => ProjectSchema.parse(project)).not.toThrow();
  });

  it('ridimensiona una clip spostando le scene successive senza cambiarle', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    const cameraId = useEditor.getState().project.objects[0].id;
    useEditor.getState().addShot();
    useEditor.getState().updateObject(cameraId, { camera: { lens: 85 } });
    const firstSceneId = useEditor.getState().project.cameraCuts.find((scene) => scene.frame === 1)!.id;
    useEditor.getState().resizeScene(firstSceneId, 48);
    const project = useEditor.getState().project;
    const camera = project.objects.find((object) => object.id === cameraId)!;
    expect(project.cameraCuts.map((scene) => scene.frame).sort((a, b) => a - b)).toEqual([1, 49]);
    expect(project.settings.frameEnd).toBe(120);
    expect(evaluateProperty(camera, 'lens', 1)).toBe(50);
    expect(evaluateProperty(camera, 'lens', 49)).toBe(85);
  });

  it('lega un commento alla transizione fra due scene', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addShot();
    const [from, to] = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().addTransitionComment(from.id, to.id, 'la camera si muove rapidamente e traballa');
    const comment = useEditor.getState().project.comments[0];
    expect(comment.kind).toBe('transition');
    expect(comment.fromSceneId).toBe(from.id);
    expect(comment.toSceneId).toBe(to.id);
    expect(comment.text).toContain('traballa');
  });

  it('lega, modifica ed elimina i commenti ai rettangoli della timeline', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().addShot();
    const [firstScene] = useEditor.getState().project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    useEditor.getState().setTimelineComment('scene', firstScene.id, 'Atmosfera sospesa');
    useEditor.getState().setTimelineComment('framing', firstScene.id, 'Primo piano lento');
    useEditor.getState().setTimelineComment('object', firstScene.id, 'Guarda confuso', cubeId);
    let comments = useEditor.getState().project.comments;
    expect(comments.map((comment) => comment.scope)).toEqual(['scene', 'framing', 'object']);
    expect(comments.find((comment) => comment.scope === 'object')?.targetIds).toEqual([cubeId]);
    expect(comments.find((comment) => comment.scope === 'framing')?.targetIds).toEqual([firstScene.cameraId]);
    useEditor.getState().setTimelineComment('object', firstScene.id, 'Si gira rapidamente', cubeId);
    comments = useEditor.getState().project.comments;
    expect(comments).toHaveLength(3);
    expect(comments.find((comment) => comment.scope === 'object')?.text).toBe('Si gira rapidamente');
    useEditor.getState().resizeScene(firstScene.id, 48);
    expect(useEditor.getState().project.comments.find((comment) => comment.scope === 'object')?.endFrame).toBe(48);
    useEditor.getState().setTimelineComment('scene', firstScene.id, '');
    expect(useEditor.getState().project.comments).toHaveLength(2);
    expect(() => ProjectSchema.parse(useEditor.getState().project)).not.toThrow();
  });

  it('duplica la nota dell’oggetto e poi la mantiene indipendente', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    useEditor.getState().setSceneNote(cubeId, 'guarda avanti');
    useEditor.getState().addShot();
    const secondFrame = useEditor.getState().currentFrame;
    useEditor.getState().setSceneNote(cubeId, 'guarda confuso');
    const notes = useEditor.getState().project.objects.find((object) => object.id === cubeId)!.sceneNotes.sort((a, b) => a.frame - b.frame);
    expect(notes).toEqual([{ frame: 1, text: 'guarda avanti' }, { frame: secondFrame, text: 'guarda confuso' }]);
  });

  it('sceglie stacco, fluido o lineare per ogni elemento', () => {
    useEditor.setState({ project: createProject(), currentFrame: 1, selectedId: undefined, past: [], future: [], dirty: false });
    useEditor.getState().addObject('cube');
    const cubeId = useEditor.getState().selectedId!;
    const firstScene = useEditor.getState().project.cameraCuts.find((scene) => scene.frame === 1)!;
    useEditor.getState().startMotion(cubeId, firstScene.id);
    useEditor.getState().addShot();
    useEditor.getState().setFrame(useEditor.getState().currentFrame - 1);
    useEditor.getState().setTransform(cubeId, { position: [6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    useEditor.getState().setTransitionMode(cubeId, firstScene.id, 'constant');
    let cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(cube, 37).position).toEqual([0, 0, 1]);
    useEditor.getState().setTransitionMode(cubeId, firstScene.id, 'linear');
    cube = useEditor.getState().project.objects.find((object) => object.id === cubeId)!;
    expect(evaluateTransform(cube, 37).position[0]).toBeCloseTo(3.04, 2);
  });
});
