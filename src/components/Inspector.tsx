import { Box, Braces, Circle, Cone, Crop, Cylinder, FileBox, Frame, Image, Move3d, MoveDown, Palette, PanelRightClose, PanelRightOpen, RefreshCw, Rotate3d, SlidersHorizontal, SquareDashed, Sun, TextCursorInput, Trash2, X } from 'lucide-react';
import * as THREE from 'three';
import { evaluateProperty, evaluateTransform } from '../domain/animation';
import { cameraTarget, fromCameraSpace, toCameraSpace } from '../domain/camera-space';
import type { Transform, Vec3 } from '../domain/schema';
import { useEditor } from '../store/editor';
import FontPicker from './FontPicker';
import ElementsPanel from './ElementsPanel';
import LightingPanel from './LightingPanel';
import AudioPanel from './AudioPanel';
import BackgroundPanel from './BackgroundPanel';
import InspectorGroup from './InspectorGroup';

type InspectorPanel = 'edit' | 'scene' | 'light';
function NumberField({ value, onChange, label, name }: { value: number; onChange(value: number): void; label: string; name: string }) {
  return <label className="number-field"><span>{label}</span><input aria-label={name} type="number" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function VectorFields({ label, value, onChange }: { label: string; value: Vec3; onChange(value: Vec3): void }) {
  return <div className="vector-row"><span>{label}</span><div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={axis} name={`${label} ${axis}`} value={value[index]} onChange={(number) => { const next = [...value] as Vec3; next[index] = number; onChange(next); }} />)}</div></div>;
}

const styleColors = ['#2f3437', '#9cabb8', '#d97373', '#dfab01', '#448361', '#337ea9', '#9065b0'];

export default function Inspector({ panel, onPanelChange, collapsed, onToggleCollapse, floating = false, onClose }: { panel: InspectorPanel; onPanelChange(panel: InspectorPanel): void; collapsed?: boolean; onToggleCollapse?(): void; floating?: boolean; onClose?(): void }) {
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const frame = useEditor((state) => state.currentFrame);
  const cameraView = useEditor((state) => state.cameraView);
  const updateObject = useEditor((state) => state.updateObject);
  const replaceObject = useEditor((state) => state.replaceObject);
  const setTransform = useEditor((state) => state.setTransform);
  const alignObjectToGround = useEditor((state) => state.alignObjectToGround);
  const setCameraFraming = useEditor((state) => state.setCameraFraming);
  const resetFraming = useEditor((state) => state.resetFraming);
  const removeSelected = useEditor((state) => state.removeSelected);
  const selectedAudio = project.objects.find((item) => item.id === selectedId && item.kind === 'audio');
  const object = project.objects.find((item) => item.id === selectedId && item.kind !== 'audio' && item.kind !== 'camera' && !item.kind.includes('light'));
  const transform = object ? evaluateTransform(object, frame) : undefined;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  const sceneIndex = scenes.findIndex((scene, index) => frame >= scene.frame && frame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1));
  const activeScene = scenes[sceneIndex] ?? scenes[0];
  const camera = project.objects.find((item) => item.id === activeScene?.cameraId && item.kind === 'camera');
  const cameraTransform = camera ? evaluateTransform(camera, frame) : undefined;
  const positionValues = transform && cameraView && cameraTransform && !object?.screenSpace ? toCameraSpace(transform.position, cameraTransform) : transform?.position;
  const positionControls: Array<[string, 0 | 1 | 2, number, number]> = object?.screenSpace
    ? [['Horizontal', 0, -1.6, 1.6], ['Vertical', 2, -1.6, 1.6]]
    : [['Horizontal', 0, -20, 20], ['Depth', 1, -20, 20], ['Height', 2, -5, 20]];
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
      if (!window.abaco) throw new Error('Image replacement is available in the desktop app.');
      const image = await window.abaco.chooseBackground('image');
      if (!image) return;
      replaceObject(object.id, {
        kind: 'plane', name: image.name, screenSpace: true,
        asset: { sourcePath: image.path, proxyPath: await window.abaco.loadAsset(image.path), collectionName: '2D Layer', boundsCenter: [0, 0, 0], previewScale: 1, groundOffset: 0 },
      });
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Image replacement failed.'); }
  };
  const replaceWithBlendAsset = async () => {
    if (!object) return;
    try {
      if (!window.abaco) throw new Error('.blend replacement is available in the desktop app.');
      const asset = await window.abaco.chooseBlendAsset();
      if (!asset) return;
      replaceObject(object.id, { kind: 'blend_asset', name: asset.name, asset });
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Blender replacement failed.'); }
  };

  if (collapsed) return <aside className="inspector panel-collapsed"><button title="Open panel" aria-label="Open right panel" onClick={onToggleCollapse}><PanelRightOpen size={16} /></button></aside>;
  return <aside className={`inspector simple-inspector ${floating ? 'floating-inspector' : ''}`}>
    {floating ? <header className="floating-inspector-header"><strong>{panel === 'edit' ? 'Edit' : panel === 'scene' ? 'Scenography' : 'Lighting'}</strong><button className="icon" aria-label="Close controls" title="Close" onClick={onClose}><X size={15} /></button></header> : <nav className="right-tabs" aria-label="Right panel sections"><button className="inspector-collapse-tab" title="Collapse panel" aria-label="Collapse right panel" onClick={onToggleCollapse}><PanelRightClose size={15} /></button>{([
      ['edit', SlidersHorizontal, 'Edit'], ['scene', Box, 'Scenography'], ['light', Sun, 'Lighting'],
    ] as const).map(([id, Icon, label]) => <button key={id} className={panel === id ? 'active' : ''} onClick={() => onPanelChange(id)}><Icon size={13} />{label}</button>)}</nav>}
    <div className="inspector-scroll" key={`${panel}:${panel === 'edit' ? object?.id ?? selectedAudio?.id ?? 'camera' : ''}`} role="region" aria-label={panel === 'edit' ? 'Edit controls' : panel === 'scene' ? 'Scenography content' : 'Lighting controls'} tabIndex={0}>
    {panel === 'light' ? <LightingPanel /> : panel === 'scene' ? <div className="scenography-content"><header className="inspector-context scenography-context-header"><strong>{activeScene?.name ?? 'Scene'}</strong><span>Scenography</span></header><InspectorGroup title="Stage and background" icon={<Frame size={13} />} variant="setup"><BackgroundPanel /></InspectorGroup><ElementsPanel mode="scene" /></div> : <>
      {selectedAudio ? <AudioPanel /> : object && transform ? <section className="object-section edit-stack">
        <div className="inspector-identity">
          <span className="inspector-kind">{object.kind === 'text' ? 'Text · 2D' : object.screenSpace ? 'Image · 2D' : 'Element · 3D'}</span>
          <div className="name-row"><input aria-label="Element name" className="object-name" value={object.name} onChange={(event) => updateObject(object.id, { name: event.target.value || object.name })} /><button className="icon danger" title="Delete" onClick={removeSelected}><Trash2 size={14} /></button></div>
          {object.kind === 'text' && <label className="field"><span>Text</span><textarea value={evaluateProperty(object, 'text', frame) as string} onChange={(event) => updateObject(object.id, { text: event.target.value })} /></label>}
          <details className="replace-object-control"><summary><RefreshCw size={13} /> Replace</summary><div className="replace-object-menu">
            {!object.screenSpace && <>{([['cube', 'Cube', Box], ['sphere', 'Sphere', Circle], ['cylinder', 'Cylinder', Cylinder], ['cone', 'Cone', Cone], ['plane', 'Plane', SquareDashed]] as const).map(([kind, label, Icon]) => <button key={kind} onClick={(event) => { replaceObject(object.id, { kind, name: label }); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}><Icon size={13} />{label}</button>)}<button onClick={replaceWithBlendAsset}><FileBox size={13} />Blender asset</button></>}
            {object.screenSpace && <><button onClick={(event) => { replaceObject(object.id, { kind: 'text', name: 'Text', text: 'Text', screenSpace: true }); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}><TextCursorInput size={13} />Text</button><button onClick={replaceWithImage}><Image size={13} />Image</button></>}
          </div></details>
        </div>

        <InspectorGroup title="Position and size" icon={<Move3d size={13} />} variant="primary" defaultOpen hint={object.screenSpace ? '2D' : cameraView ? 'Camera' : 'Space'}>
          <div className="camera-sliders">
          {positionControls.map(([label, axis, min, max]) => <label key={`position-${axis}`}><span>{cameraView && axis === 2 ? 'Vertical' : label}</span><strong>{object.screenSpace ? `${Math.round(positionValues![axis] * 100)}%` : `${positionValues![axis].toFixed(1)} m`}</strong><input aria-label={`${label} element`} title={cameraView && axis === 1 ? 'Increase to move the character away from the camera' : undefined} type="range" min={cameraView && axis === 1 && !object.screenSpace ? .1 : Math.min(min, positionValues![axis])} max={Math.max(max, positionValues![axis])} step={object.screenSpace ? '.01' : '0.1'} value={positionValues![axis]} onChange={(event) => changeTransformAxis('position', axis, Number(event.target.value))} /></label>)}
          </div>
          <div className="size-control"><div><span>Size</span><strong>{Math.round(((transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3) * 100)}%</strong></div><input aria-label="Element size" type="range" min="0.1" max="4" step="0.05" value={(transform.scale[0] + transform.scale[1] + transform.scale[2]) / 3} onChange={(event) => { const size = Number(event.target.value); changeTransform('scale', [size, size, size]); }} /></div>
          {!object.screenSpace && <button className="subtle align-ground" onClick={() => alignObjectToGround(object.id)}><MoveDown size={13} /> Place on ground</button>}
        </InspectorGroup>

        <InspectorGroup title="Rotation" icon={<Rotate3d size={13} />} variant="secondary"><div className="camera-sliders">
          {([
            ['Tilt X', 0], ['Tilt Y', 1], ['Turn', 2],
          ] as const).map(([label, axis]) => <label key={`rotation-${axis}`}><span>{label}</span><strong>{transform.rotation[axis].toFixed(0)}°</strong><input aria-label={`${label} element`} type="range" min="-180" max="180" step="1" value={transform.rotation[axis]} onChange={(event) => changeTransformAxis('rotation', axis, Number(event.target.value))} /></label>)}
        </div></InspectorGroup>
        <InspectorGroup title="Appearance" icon={<Palette size={13} />} variant="secondary">
          <div className="group-title"><span>Color</span><label className="visible-compact"><input type="checkbox" checked={evaluateProperty(object, 'visibility', frame) as boolean} onChange={(event) => updateObject(object.id, { visible: event.target.checked })} /> Visible</label></div>
          <div className="style-row"><label className="color-picker" title="Choose a color"><input aria-label="Custom color" type="color" value={object.color} onChange={(event) => updateObject(object.id, { color: event.target.value })} /></label>{styleColors.map((color) => <button key={color} aria-label={`Color ${color}`} title={color} className={object.color.toLowerCase() === color ? 'active' : ''} style={{ background: color }} onClick={() => updateObject(object.id, { color })} />)}</div>
          {object.kind === 'text' && <div className="text-font-control"><FontPicker name="Text font" value={object.fontFamily} onChange={(fontFamily) => updateObject(object.id, { fontFamily })} /></div>}
        </InspectorGroup>
        {object.screenSpace && <InspectorGroup title="Crop" icon={<Crop size={13} />} variant="secondary"><div className="camera-sliders">{(['Top', 'Right', 'Bottom', 'Left'] as const).map((label, index) => <label key={label}><span>{label}</span><strong>{Math.round(object.screenCrop[index] * 100)}%</strong><input aria-label={`Crop ${label}`} type="range" min="0" max="0.45" step="0.01" value={object.screenCrop[index]} onChange={(event) => { const crop = [...object.screenCrop] as [number, number, number, number]; crop[index] = Number(event.target.value); updateObject(object.id, { screenCrop: crop }); }} /></label>)}</div></InspectorGroup>}
        <InspectorGroup title="Advanced values" icon={<Braces size={13} />} variant="secondary">
          <VectorFields label="Position" value={transform.position} onChange={(value) => changeTransform('position', value)} />
          <VectorFields label="Rotation°" value={transform.rotation} onChange={(value) => changeTransform('rotation', value)} />
          <VectorFields label="Scale" value={transform.scale} onChange={(value) => changeTransform('scale', value.map((n) => Math.max(.001, n)) as Vec3)} />
        </InspectorGroup>
      </section> : <div className="camera-edit-panel"><header className="inspector-context"><strong>Camera</strong><span>{activeScene?.name ?? 'Scene'}</span></header>{activeScene && cameraTransform && <InspectorGroup title="Framing" icon={<Frame size={13} />} variant="primary" defaultOpen><div className="camera-sliders"><label><span>Distance</span><strong>{activeScene.framing.distance.toFixed(1)} m</strong><input aria-label="Zoom camera" type="range" min="0.5" max="30" step="0.1" value={Math.min(30, activeScene.framing.distance)} onChange={(event) => setCameraZoom(Number(event.target.value))} /></label>{([
        ['Horizontal', 0, -20, 20], ['Depth', 1, -20, 20], ['Height', 2, -5, 20],
      ] as const).map(([label, axis, min, max]) => <label key={label}><span>{label}</span><strong>{cameraTransform.position[axis].toFixed(1)} m</strong><input aria-label={`${label} camera`} type="range" min={Math.min(min, cameraTransform.position[axis])} max={Math.max(max, cameraTransform.position[axis])} step="0.1" value={cameraTransform.position[axis]} onChange={(event) => moveCameraAxis(axis, Number(event.target.value))} /></label>)}</div><button className="subtle camera-reset" onClick={resetFraming}><RefreshCw size={12} /> Reset camera</button></InspectorGroup>}</div>}

    </>}
    </div>
  </aside>;
}
