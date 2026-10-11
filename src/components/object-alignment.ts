import * as THREE from 'three';
import { alignmentTargets, snapAlignment, type AlignmentTarget } from '../domain/alignment';
import { evaluateRenderProperty, evaluateRenderTransform } from '../domain/animation';
import type { AbacoProject, SceneObject, Transform } from '../domain/schema';
import { primitiveGeometry, type PrimitiveKind } from './PrimitiveMesh';

const corners = (box: THREE.Box3) => [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new THREE.Vector3(x, y, z))));
function alignmentWorldPoints(root: THREE.Object3D | undefined, object: SceneObject, transform: Transform) {
  const points: THREE.Vector3[] = [];
  const includeGeometry = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => {
    if (['sphere', 'cone', 'cylinder'].includes(object.kind)) {
      const positions = geometry.getAttribute('position');
      if (positions) for (let i = 0; i < positions.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
    } else {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) corners(geometry.boundingBox).forEach(point => points.push(point.applyMatrix4(matrix)));
    }
  };
  if (root) root.traverseVisible(child => {
    if (!(child instanceof THREE.Mesh)) return;
    for (let ancestor: THREE.Object3D | null = child; ancestor && ancestor !== root; ancestor = ancestor.parent) if (ancestor.userData.strokeSkip) return;
    includeGeometry(child.geometry, child.matrixWorld);
  });
  if (!points.length) {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]));
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...transform.position), quaternion, new THREE.Vector3(...transform.scale));
    if (['cube', 'sphere', 'cone', 'cylinder', 'plane'].includes(object.kind)) includeGeometry(primitiveGeometry(object.kind as PrimitiveKind), matrix);
    else points.push(new THREE.Vector3(...transform.position));
  }
  return points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
}
export function alignmentBounds(root: THREE.Object3D | undefined, object: SceneObject, transform: Transform, basis: THREE.Vector3[]) {
  return new THREE.Box3().setFromPoints(alignmentWorldPoints(root, object, transform).map(point => new THREE.Vector3(...basis.map(axis => point.dot(axis)))));
}

export function alignmentPeers(project: AbacoProject, object: SceneObject, frame: number, selectedIds: string[]) {
  const sceneId = [...project.cameraCuts].sort((a, b) => b.frame - a.frame).find(scene => scene.frame <= frame)?.id;
  const excluded = new Set([object.id, ...selectedIds]);
  return project.objects.filter(peer => !excluded.has(peer.id) && peer.kind !== 'audio' && peer.kind !== 'camera' && !peer.kind.includes('light') && peer.screenSpace === object.screenSpace
    && (!peer.sceneIds.length || peer.sceneIds.includes(sceneId ?? '')) && evaluateRenderProperty(peer, 'visibility', frame));
}

export type AlignmentGuide = { id: string; label: string; axis: number; from: THREE.Vector3; to: THREE.Vector3 };
export function createObjectAlignment(object: SceneObject, project: AbacoProject, frame: number, selectedIds: string[], scene: THREE.Scene, root: THREE.Group, camera: THREE.Camera, viewAligned: boolean, viewport: DOMRect) {
  const basis = viewAligned ? [0, 1, 2].map(axis => new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, axis).normalize()) : [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  scene.updateMatrixWorld(true);
  const roots = new Map<string, THREE.Object3D>();
  scene.traverseVisible(node => { if (node.userData.sceneObjectId) roots.set(node.userData.sceneObjectId, node); });
  const pivot = root.position.clone(), localPivot = new THREE.Vector3(...basis.map(axis => pivot.dot(axis)));
  const ownWorld = alignmentWorldPoints(root, object, evaluateRenderTransform(object, frame));
  const own = new THREE.Box3().setFromPoints(ownWorld.map(point => new THREE.Vector3(...basis.map(axis => point.dot(axis)))));
  const ownCenter = own.getCenter(new THREE.Vector3()).sub(localPivot);
  const worldBounds = alignmentBounds(root, object, evaluateRenderTransform(object, frame), [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]);
  const floorZ = pivot.z - worldBounds.min.z;
  const targets: AlignmentTarget[][] = [[], [], []], points = new Map<string, THREE.Vector3>();
  const fromLocal = (local: THREE.Vector3) => basis.reduce((world, axis, index) => world.addScaledVector(axis, local.getComponent(index)), new THREE.Vector3());
  const screenPeers: Array<{ id: string; label: string; box: THREE.Box3 }> = [];
  const peers = alignmentPeers(project, object, frame, selectedIds).sort((a, b) => new THREE.Vector3(...evaluateRenderTransform(a, frame).position).distanceToSquared(pivot) - new THREE.Vector3(...evaluateRenderTransform(b, frame).position).distanceToSquared(pivot));
  for (const peer of peers) {
    const transform = evaluateRenderTransform(peer, frame), projected = new THREE.Vector3(...transform.position).project(camera);
    if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.3 || Math.abs(projected.y) > 1.3) continue;
    const box = alignmentBounds(roots.get(peer.id), peer, transform, basis), center = box.getCenter(new THREE.Vector3());
    if (viewAligned) screenPeers.push({ id: peer.id, label: peer.name, box: new THREE.Box3().setFromPoints(alignmentWorldPoints(roots.get(peer.id), peer, transform).map(point => point.project(camera))) });
    for (let axis = 0; axis < 3; axis++) {
      const anchors = alignmentTargets({ min: own.min.getComponent(axis) - localPivot.getComponent(axis), center: ownCenter.getComponent(axis), max: own.max.getComponent(axis) - localPivot.getComponent(axis) },
        { min: box.min.getComponent(axis), center: center.getComponent(axis), max: box.max.getComponent(axis) }, `${peer.id}:${axis}`, peer.name);
      targets[axis].push(...anchors);
      for (const anchor of anchors) points.set(anchor.id, fromLocal(center.clone().setComponent(axis, anchor.targetCoordinate)));
    }
  }
  const held: Array<AlignmentTarget | undefined> = [];
  return {
    apply(position: THREE.Vector3, allowedAxes: number[], bypass = false) {
      if (viewAligned) {
        if (bypass) { held.length = 0; return { position: position.clone(), guides: [] }; }
        const result = position.clone(), guides: AlignmentGuide[] = [];
        const projected = position.clone().project(camera);
        const ownScreenAt = (at: THREE.Vector3) => new THREE.Box3().setFromPoints(ownWorld.map(point => point.clone().add(at.clone().sub(pivot)).project(camera)));
        for (const axis of allowedAxes.filter(axis => axis < 2)) {
          const makeTargets = (at: THREE.Vector3) => {
            const box = ownScreenAt(at), center = box.getCenter(new THREE.Vector3()), origin = at.clone().project(camera).getComponent(axis);
            return screenPeers.flatMap(peer => alignmentTargets({ min: box.min.getComponent(axis) - origin, center: center.getComponent(axis) - origin, max: box.max.getComponent(axis) - origin },
              { min: peer.box.min.getComponent(axis), center: peer.box.getCenter(new THREE.Vector3()).getComponent(axis), max: peer.box.max.getComponent(axis) }, `${peer.id}:${axis}`, peer.label));
          };
          const candidates = makeTargets(position);
          if (axis === 1 && Math.abs(basis[1].z) > .2) {
            const ground = result.clone().addScaledVector(basis[1], (floorZ - result.z) / basis[1].z).project(camera);
            candidates.unshift({ id: 'ground', label: 'Floor', value: ground.y, movingOffset: 0, targetCoordinate: ground.y });
          }
          const snapped = snapAlignment(projected.getComponent(axis), candidates, (axis ? viewport.height : viewport.width) / 2, held[axis]);
          held[axis] = snapped.match;
          if (!snapped.match) continue;
          let anchor = snapped.match;
          for (let iteration = 0; iteration < 4; iteration++) {
            if (anchor.id !== 'ground') anchor = makeTargets(result).find(candidate => candidate.id === anchor.id)!;
            result.copy(result.clone().project(camera).setComponent(axis, anchor.value).unproject(camera));
          }
          const from = ownScreenAt(result).getCenter(new THREE.Vector3()).setComponent(axis, anchor.targetCoordinate);
          const peer = screenPeers.find(peer => anchor.id.startsWith(`${peer.id}:`));
          const to = peer ? peer.box.getCenter(new THREE.Vector3()).setComponent(axis, anchor.targetCoordinate) : ownScreenAt(result).getCenter(new THREE.Vector3()).setComponent(axis, ownScreenAt(result).min.getComponent(axis));
          guides.push({ id: `${axis}:${anchor.id}`, axis, label: anchor.label, from: from.unproject(camera), to: to.unproject(camera) });
        }
        return { position: result, guides };
      }
      const local = new THREE.Vector3(...basis.map(axis => position.dot(axis))), result = position.clone(), guides: AlignmentGuide[] = [];
      const depth = Math.max(.1, Math.abs(position.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()))));
      const fallback = camera instanceof THREE.PerspectiveCamera ? viewport.height / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) : viewport.height / 2;
      for (const axis of allowedAxes) {
        const before = position.clone().project(camera), after = position.clone().addScaledVector(basis[axis], .1).project(camera);
        const pixels = Math.hypot((after.x - before.x) * viewport.width / 2, (after.y - before.y) * viewport.height / 2) * 10;
        const candidates = [...targets[axis]];
        const groundAxis = viewAligned ? 1 : 2;
        if (axis === groundAxis && Math.abs(basis[axis].z) > .2) candidates.unshift({ id: 'ground', label: 'Floor', value: local.getComponent(axis) + (floorZ - result.z) / basis[axis].z, movingOffset: 0, targetCoordinate: 0 });
        const snap = snapAlignment(local.getComponent(axis), candidates, pixels > 1 ? pixels : fallback, held[axis], bypass);
        held[axis] = snap.match;
        result.addScaledVector(basis[axis], snap.value - local.getComponent(axis));
        if (snap.match) {
          const from = fromLocal(local.clone().add(ownCenter).setComponent(axis, snap.value + snap.match.movingOffset));
          const to = snap.match.id === 'ground' ? new THREE.Vector3(from.x, from.y, 0) : points.get(snap.match.id)!;
          guides.push({ id: `${axis}:${snap.match.id}`, axis, label: snap.match.label, from, to });
        }
      }
      for (const guide of guides) {
        const match = held[guide.axis]!;
        guide.from = result.clone().add(fromLocal(ownCenter)).addScaledVector(basis[guide.axis], match.movingOffset - ownCenter.getComponent(guide.axis));
      }
      return { position: result, guides };
    },
  };
}
