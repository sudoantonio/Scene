import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { queuePlaybackPointer } from './playback-pointer';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { evaluateRenderProperty, evaluateRenderTransform, renderAnimationFrame } from '../domain/animation';
import type { SceneObject } from '../domain/schema';
import { useEditor } from '../store/editor';
import { primitiveGeometry, usePrimitiveMaterial, type PrimitiveKind } from './PrimitiveMesh';

/** Large scenes batch compatible unselected primitives. Drawing, REC and selected
 * elements retain ordinary meshes and their existing controls/geometry picking. */
export default memo(function PrimitiveBatch({ objects, kind, color }: { objects: SceneObject[]; kind: PrimitiveKind; color: string }) {
  const frame = useEditor(state => state.currentFrame);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = usePrimitiveMaterial(color);
  const cache = useRef({ objects: undefined as SceneObject[] | undefined, epochs: [] as number[], matrix: new THREE.Matrix4(), position: new THREE.Vector3(), scale: new THREE.Vector3(), rotation: new THREE.Euler(), quaternion: new THREE.Quaternion() });
  useEffect(() => {
    const target = mesh.current;
    return () => { target?.dispose(); };
  }, []);
  useLayoutEffect(() => {
    const target = mesh.current; if (!target) return;
    const state = cache.current, reset = state.objects !== objects;
    if (reset) { state.objects = objects; state.epochs = []; target.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    let changed = false;
    target.instanceMatrix.clearUpdateRanges();
    objects.forEach((object, index) => {
      const epoch = renderAnimationFrame(object, frame);
      if (!reset && state.epochs[index] === epoch) return;
      const transform = evaluateRenderTransform(object, epoch);
      state.position.set(...transform.position); state.scale.set(...transform.scale);
      if (!evaluateRenderProperty(object, 'visibility', epoch)) state.scale.set(0, 0, 0);
      state.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
      state.quaternion.setFromEuler(state.rotation);
      state.matrix.compose(state.position, state.quaternion, state.scale);
      target.setMatrixAt(index, state.matrix); target.instanceMatrix.addUpdateRange(index * 16, 16);
      state.epochs[index] = epoch; changed = true;
    });
    if (changed) { target.instanceMatrix.needsUpdate = true; target.boundingSphere = null; }
  }, [objects, frame]);
  const select = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || event.instanceId === undefined || event.nativeEvent.pointerType === 'touch') return;
    const object = objects[event.instanceId]; if (!object) return;
    if (!evaluateRenderProperty(object, 'visibility', useEditor.getState().currentFrame)) return;
    event.stopPropagation();
    const state = useEditor.getState();
    const multiple = state.multiSelectMode || event.nativeEvent.shiftKey || event.nativeEvent.metaKey || event.nativeEvent.ctrlKey;
    if (!multiple) queuePlaybackPointer(object.id, event);
    state.setPlaying(false);
    if (multiple) state.toggleSelection(object.id);
    else state.select(object.id);
  };
  return <instancedMesh ref={mesh} args={[primitiveGeometry(kind), material, objects.length]} castShadow={kind !== 'plane'} receiveShadow={kind === 'plane'} frustumCulled={false} dispose={null} onPointerDown={select} userData={{ strokeSkip: true }} />;
});
