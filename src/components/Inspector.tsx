import { Box, Braces, Circle, Cone, Crop, Cylinder, FileBox, Frame, Image, KeyRound, Move3d, MoveDown, Palette, PanelRightClose, PanelRightOpen, RefreshCw, Rotate3d, Route, SlidersHorizontal, Sparkles, SquareDashed, Sun, TextCursorInput, Trash2 } from 'lucide-react';
import * as THREE from 'three';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { cameraTarget, fromCameraSpace, toCameraSpace } from '../domain/camera-space';
import type { Transform, Vec3 } from '../domain/schema';
import { useEditor } from '../store/editor';
import ElementsPanel from './ElementsPanel';
import LightingPanel from './LightingPanel';
import AudioPanel from './AudioPanel';
import BackgroundPanel from './BackgroundPanel';
import InspectorGroup from './InspectorGroup';
import JevActionPanel from './JevActionPanel';

type InspectorPanel = 'edit' | 'scene' | 'jev' | 'light';
const motionNames = { constant: 'Stacco', bezier: 'Fluido', linear: 'Lineare' } as const;

function NumberField({ value, onChange, label, name }: { value: number; onChange(value: number): void; label: string; name: string }) {
  return <label className="number-field"><span>{label}</span><input aria-label={name} type="number" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function VectorFields({ label, value, onChange }: { label: string; value: Vec3; onChange(value: Vec3): void }) {
  return <div className="vector-row"><span>{label}</span><div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={axis} name={`${label} ${axis}`} value={value[index]} onChange={(number) => { const next = [...value] as Vec3; next[index] = number; onChange(next); }} />)}</div></div>;
}

const styleColors = ['#2f3437', '#9cabb8', '#d97373', '#dfab01', '#448361', '#337ea9', '#9065b0'];

export default function Inspector({ panel, onPanelChange, collapsed, onToggleCollapse }: { panel: InspectorPanel; onPanelChange(panel: InspectorPanel): void; collapsed?: boolean; onToggleCollapse?(): void }) {
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const cameraView = useEditor((state) => state.cameraView);
  const updateObject = useEditor((state) => state.updateObject);
  const replaceObject = useEditor((state) => state.replaceObject);
  const setTransform = useEditor((state) => state.setTransform);
  const alignObjectToGround = useEditor((state) => state.alignObjectToGround);
  const selectedMotion = useEditor((state) => state.selectedMotion);
  const startMotion = useEditor((state) => state.startMotion);
  const keyPose = useEditor((state) => state.keyPose);
  const setTransitionMode = useEditor((state) => state.setTransitionMode);
  const setMotionPointHold = useEditor((state) => state.setMotionPointHold);
  const setCameraFraming = useEditor((state) => state.setCameraFraming);
  const resetFraming = useEditor((state) => state.resetFraming);
  const removeSelected = useEditor((state) => state.removeSelected);
  const selectedAudio = project.objects.find((item) => item.id === selectedId && item.kind === 'audio');
  const object = project.objects.find((item) => item.id === selectedId && item.kind !== 'audio' && item.kind !== 'camera' && !item.kind.includes('light'));
  const transform = object ? evaluateTransform(object, frame) : undefined;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1));
  const activeScene = scenes[sceneIndex] ?? scenes[0];
  const activeSceneEnd = scenes[sceneIndex + 1]?.frame ?? project.settings.frameEnd + 1;
  const camera = project.objects.find((item) => item.id === activeScene?.cameraId && item.kind === 'camera');
  const cameraTransform = camera ? evaluateTransform(camera, frame) : undefined;
  const positionValues = transform && cameraView && cameraTransform && !object?.screenSpace ? toCameraSpace(transform.position, cameraTransform) : transform?.position;
  const positionControls: Array<[string, 0 | 1 | 2, number, number]> = object?.screenSpace
    ? [['Orizzontale', 0, -1.6, 1.6], ['Verticale', 2, -1.6, 1.6]]
    : [['Orizzontale', 0, -20, 20], ['Profondità', 1, -20, 20], ['Altezza', 2, -5, 20]];
  const motionObject = selectedAudio ? undefined : object ?? camera;
  const motionMode = motionObject && activeScene
    ? motionObject.keyframes.filter((key) => key.property === 'position' && key.frame >= activeScene.frame && key.frame < activeSceneEnd).sort((a, b) => a.frame - b.frame)[0]?.interpolation ?? 'constant'
    : 'constant';
  const motionActive = Boolean(motionObject && activeScene && selectedMotion?.objectId === motionObject.id && selectedMotion.sceneId === activeScene.id);
  const selectedMotionPoint = motionActive ? motionObject?.keyframes.find((key) => key.property === 'position' && key.purpose === 'motion' && key.frame === frame) : undefined;
  const nextMotionPoint = selectedMotionPoint ? motionObject?.keyframes.filter((key) => key.property === 'position' && key.purpose === 'motion' && key.frame > selectedMotionPoint.frame && key.frame < activeSceneEnd).sort((a, b) => a.frame - b.frame)[0] : undefined;
  const maximumHoldFrames = selectedMotionPoint && nextMotionPoint ? Math.max(0, nextMotionPoint.frame - selectedMotionPoint.frame - 1) : 0;
  const createMotionHere = () => {
    if (!motionObject || !activeScene) return;
    if (!motionActive) startMotion(motionObject.id, activeScene.id);
    keyPose(motionObject.id);
  };

  const changeTransform = (property: keyof Transform, value: Vec3) => object && transform && setTransform(object.id, { ...transform, [property]: value });
  const changeTransformAxis = (property: 'position' | 'rotation', axis: 0 | 1 | 2, value: number) => {
    if (!transform) return;
    const next = [...(property === 'position' ? positionValues! : transform[property])] as Vec3;
    next[axis] = value;
    changeTransform(property, property === 'position' && cameraView && cameraTransform && !object?.screenSpace ? fromCameraSpace(next, cameraTransform) : next);
  };
  const moveCameraAxis = (axis: 0 | 1 | 2, value: number) => {
    if (!activeScene || !cameraTransform) return;
    const delta = value - cameraTransform.position[axis];
    const position = [...cameraTransform.position] as Vec3;
    const target = cameraTarget(cameraTransform, activeScene.framing.distance);
    position[axis] = value;
    target[axis] += delta;
    setCameraFraming(activeScene.id, position, cameraTransform.rotation, target);
  };
  const setCameraZoom = (distance: number) => {
    if (!activeScene || !cameraTransform) return;
    const target = new THREE.Vector3(...cameraTarget(cameraTransform, activeScene.framing.distance));
    const direction = new THREE.Vector3(...cameraTransform.position).sub(target);
    if (direction.lengthSq() < .0001) direction.set(1, -1, .5);
    const position = target.clone().add(direction.normalize().multiplyScalar(distance)).toArray() as Vec3;
    setCameraFraming(activeScene.id, position, cameraTransform.rotation, target.toArray() as Vec3);
  };
  const replaceWithImage = async () => {
    if (!object) return;
    try {
      if (!window.abaco) throw new Error('La sostituzione con immagini è disponibile nell’app desktop.');
      const image = await window.abaco.chooseBackground('image');
      if (!image) return;
      replaceObject(object.id, {
        kind: 'plane', name: image.name, screenSpace: true,
        asset: { sourcePath: image.path, proxyPath: await window.abaco.loadAsset(image.path), collectionName: 'Livello 2D', boundsCenter: [0, 0, 0], previewScale: 1, groundOffset: 0 },
      });
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Sostituzione immagine non riuscita.'); }
  };
  const replaceWithBlendAsset = async () => {
    if (!object) return;
    try {
      if (!window.abaco) throw new Error('La sostituzione con file .blend è disponibile nell’app desktop.');
      const asset = await window.abaco.chooseBlendAsset();
      if (!asset) return;
      replaceObject(object.id, { kind: 'blend_asset', name: asset.name, asset });
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Sostituzione Blender non riuscita.'); }
  };

  const motionControls = motionObject && activeScene && <InspectorGroup title="Movimento" icon={<Route size={13} />} defaultOpen>
    <div className="inspector-motion-action"><span>{object ? object.name : 'Camera'}<small>{activeScene.name ?? 'Scena'}</small></span><button className="motion-create" onClick={createMotionHere}><KeyRound size={13} /> Crea qui</button></div>
    <label className="motion-mode-field"><span>Interpolazione</span><select disabled={!motionActive} aria-label={`Tipo movimento ${object ? object.name : 'camera'}`} value={motionMode} onChange={(event) => setTransitionMode(motionObject.id, activeScene.id, event.target.value as keyof typeof motionNames)}>{(['constant', 'bezier', 'linear'] as const).map((mode) => <option key={mode} value={mode}>{motionNames[mode]}</option>)}</select></label>
    {selectedMotionPoint && nextMotionPoint && <div className="motion-point-hold">
      <label><span>Sosta al punto</span><strong>{((selectedMotionPoint.holdFrames ?? 0) / project.settings.fps).toFixed(2)} s</strong><input aria-label="Durata sosta al punto" type="range" min="0" max={maximumHoldFrames} step="1" value={Math.min(maximumHoldFrames, selectedMotionPoint.holdFrames ?? 0)} onChange={(event) => setMotionPointHold(motionObject.id, selectedMotionPoint.id, Number(event.target.value))} /></label>
      <button className="subtle compact" disabled={!selectedMotionPoint.holdFrames} onClick={() => setMotionPointHold(motionObject.id, selectedMotionPoint.id, 0)}>Nessuna sosta</button>
      <small>0,00 s attraversa il punto senza fermarsi.</small>
    </div>}
    {motionActive && !selectedMotionPoint && <p className="inspector-help">Seleziona un punto nella barra per regolarne la sosta.</p>}
    {!motionActive && <p className="inspector-help">Seleziona un movimento nella timeline o crea un punto qui.</p>}
  </InspectorGroup>;
  if (collapsed) return <aside className="inspector panel-collapsed"><button title="Apri pannello" aria-label="Apri pannello destro" onClick={onToggleCollapse}><PanelRightOpen size={16} /></button></aside>;
  return <aside className="inspector simple-inspector">
    <nav className="right-tabs" aria-label="Sezioni pannello destro"><button className="inspector-collapse-tab" title="Riduci pannello" aria-label="Riduci pannello destro" onClick={onToggleCollapse}><PanelRightClose size={15} /></button>{([
      ['edit', SlidersHorizontal, 'Modifica'], ['scene', Box, 'Scenografia'], ['jev', Sparkles, 'Jev'], ['light', Sun, 'Luce'],
    ] as const).map(([id, Icon, label]) => <button key={id} className={panel === id ? 'active' : ''} onClick={() => onPanelChange(id)}><Icon size={13} />{label}</button>)}</nav>
    <div className="inspector-scroll" key={`${panel}:${['edit', 'jev'].includes(panel) ? object?.id ?? selectedAudio?.id ?? 'camera' : ''}`} role="region" aria-label={panel === 'edit' ? 'Controlli modifica' : panel === 'scene' ? 'Contenuto scenografia' : panel === 'jev' ? 'Generatore azioni Jev' : 'Controlli luce'} tabIndex={0}>
    {panel === 'light' ? <LightingPanel /> : panel === 'scene' ? <div className="scenography-content"><header className="inspector-context scenography-context-header"><strong>{activeScene?.name ?? 'Scena'}</strong><span>Scenografia e indicazioni</span></header><InspectorGroup title="Inquadratura e sfondo" icon={<Frame size={13} />} collapsible={false}><BackgroundPanel /></InspectorGroup><ElementsPanel mode="scene" /></div> : panel === 'jev' ? <div className="jev-tab-content"><header className="inspector-context"><strong>Jev · Regia scena</strong><span>{object ? object.name : activeScene?.name ?? 'Scena'}</span></header>{activeScene ? <InspectorGroup title="Descrivi la regia" icon={<Sparkles size={13} />} collapsible={false}><JevActionPanel project={project} object={object} sceneId={activeScene.id} frame={frame} position={transform?.position} /></InspectorGroup> : <p className="inspector-help jev-empty">Aggiungi una scena per usare Jev.</p>}</div> : <>
      {selectedAudio ? <AudioPanel /> : object && transform ? <section className="object-section edit-stack">
        <div className="inspector-identity">
          <span className="inspector-kind">{object.kind === 'text' ? 'Testo · 2D' : object.screenSpace ? 'Immagine · 2D' : 'Elemento · 3D'}</span>
          <div className="name-row"><input aria-label="Nome elemento" className="object-name" value={object.name} onChange={(event) => updateObject(object.id, { name: event.target.value || object.name })} /><button className="icon danger" title="Elimina" onClick={removeSelected}><Trash2 size={14} /></button></div>
          {object.kind === 'text' && <label className="field"><span>Testo</span><textarea value={evaluateProperty(object, 'text', frame) as string} onChange={(event) => updateObject(object.id, { text: event.target.value })} /></label>}
          <details className="replace-object-control"><summary><RefreshCw size={13} /> Sostituisci</summary><div className="replace-object-menu">
            {!object.screenSpace && <>{([['cube', 'Cubo', Box], ['sphere', 'Sfera', Circle], ['cylinder', 'Cilindro', Cylinder], ['cone', 'Cono', Cone], ['plane', 'Piano', SquareDashed]] as const).map(([kind, label, Icon]) => <button key={kind} onClick={(event) => { replaceObject(object.id, { kind, name: label }); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}><Icon size={13} />{label}</button>)}<button onClick={replaceWithBlendAsset}><FileBox size={13} />Asset Blender</button></>}
            {object.screenSpace && <><button onClick={(event) => { replaceObject(object.id, { kind: 'text', name: 'Testo', text: 'Testo', screenSpace: true }); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}><TextCursorInput size={13} />Testo</button><button onClick={replaceWithImage}><Image size={13} />Immagine</button></>}
          </div></details>
        </div>

        <InspectorGroup title="Posizione e dimensione" icon={<Move3d size={13} />} defaultOpen hint={object.screenSpace ? '2D' : cameraView ? 'Camera' : 'Spazio'}>
          <div className="camera-sliders">
          {positionControls.map(([label, axis, min, max]) => <label key={`position-${axis}`}><span>{cameraView && axis === 2 ? 'Verticale' : label}</span><strong>{object.screenSpace ? `${Math.round(positionValues![axis] * 100)}%` : `${positionValues![axis].toFixed(1)} m`}</strong><input aria-label={`${label} elemento`} title={cameraView && axis === 1 ? 'Aumenta per allontanare il personaggio dalla camera' : undefined} type="range" min={cameraView && axis === 1 && !object.screenSpace ? .1 : Math.min(min, positionValues![axis])} max={Math.max(max, positionValues![axis])} step={object.screenSpace ? '.01' : '0.1'} value={positionValues![axis]} onChange={(event) => changeTransformAxis('position', axis, Number(event.target.value))} /></label>)}
          </div>
          {!object.screenSpace && <button className="subtle align-ground" onClick={() => alignObjectToGround(object.id)}><MoveDown size={13} /> Appoggia al piano</button>}
          <div className="size-control"><div><span>Dimensione</span><strong>{Math.round(((transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3) * 100)}%</strong></div><input aria-label="Dimensione elemento" type="range" min="0.1" max="4" step="0.05" value={(transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3} onChange={(event) => { const size = Number(event.target.value); changeTransform('scale', [size, size, size]); }} /></div>
        </InspectorGroup>

        <InspectorGroup title="Rotazione" icon={<Rotate3d size={13} />}><div className="camera-sliders">
          {([
            ['Inclina X', 0], ['Inclina Y', 1], ['Gira', 2],
          ] as const).map(([label, axis]) => <label key={`rotation-${axis}`}><span>{label}</span><strong>{transform.rotation[axis].toFixed(0)}°</strong><input aria-label={`${label} elemento`} type="range" min="-180" max="180" step="1" value={transform.rotation[axis]} onChange={(event) => changeTransformAxis('rotation', axis, Number(event.target.value))} /></label>)}
        </div></InspectorGroup>
        <InspectorGroup title="Aspetto" icon={<Palette size={13} />}><div className="group-title"><span>Colore</span><label className="visible-compact"><input type="checkbox" checked={evaluateProperty(object, 'visibility', frame) as boolean} onChange={(event) => updateObject(object.id, { visible: event.target.checked })} /> Visibile</label></div><div className="style-row"><label className="color-picker" title="Scegli un colore"><input aria-label="Colore personalizzato" type="color" value={object.color} onChange={(event) => updateObject(object.id, { color: event.target.value })} /></label>{styleColors.map((color) => <button key={color} aria-label={`Colore ${color}`} title={color} className={object.color.toLowerCase() === color ? 'active' : ''} style={{ background: color }} onClick={() => updateObject(object.id, { color })} />)}</div></InspectorGroup>
        {object.screenSpace && <InspectorGroup title="Ritaglio" icon={<Crop size={13} />}><div className="camera-sliders">{(['Alto', 'Destra', 'Basso', 'Sinistra'] as const).map((label, index) => <label key={label}><span>{label}</span><strong>{Math.round(object.screenCrop[index] * 100)}%</strong><input aria-label={`Ritaglio ${label}`} type="range" min="0" max="0.45" step="0.01" value={object.screenCrop[index]} onChange={(event) => { const crop = [...object.screenCrop] as [number, number, number, number]; crop[index] = Number(event.target.value); updateObject(object.id, { screenCrop: crop }); }} /></label>)}</div></InspectorGroup>}
        {motionControls}
        <InspectorGroup title="Valori numerici" icon={<Braces size={13} />}>
          <VectorFields label="Posizione" value={transform.position} onChange={(value) => changeTransform('position', value)} />
          <VectorFields label="Rotazione°" value={transform.rotation} onChange={(value) => changeTransform('rotation', value)} />
          <VectorFields label="Scala" value={transform.scale} onChange={(value) => changeTransform('scale', value.map((n) => Math.max(.001, n)) as Vec3)} />
        </InspectorGroup>
      </section> : <div className="camera-edit-panel"><header className="inspector-context"><strong>Camera</strong><span>{activeScene?.name ?? 'Scena'}</span></header>{activeScene && cameraTransform && <InspectorGroup title="Inquadratura" icon={<Frame size={13} />} defaultOpen><div className="camera-sliders"><label><span>Distanza</span><strong>{activeScene.framing.distance.toFixed(1)} m</strong><input aria-label="Zoom camera" type="range" min="0.5" max="30" step="0.1" value={Math.min(30, activeScene.framing.distance)} onChange={(event) => setCameraZoom(Number(event.target.value))} /></label>{([
        ['Orizzontale', 0, -20, 20], ['Profondità', 1, -20, 20], ['Altezza', 2, -5, 20],
      ] as const).map(([label, axis, min, max]) => <label key={label}><span>{label}</span><strong>{cameraTransform.position[axis].toFixed(1)} m</strong><input aria-label={`${label} camera`} type="range" min={Math.min(min, cameraTransform.position[axis])} max={Math.max(max, cameraTransform.position[axis])} step="0.1" value={cameraTransform.position[axis]} onChange={(event) => moveCameraAxis(axis, Number(event.target.value))} /></label>)}</div><button className="subtle camera-reset" onClick={resetFraming}><RefreshCw size={12} /> Ripristina camera</button></InspectorGroup>}{motionControls}</div>}

    </>}
    </div>
  </aside>;
}
