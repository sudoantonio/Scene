import * as THREE from 'three';
import { evaluateProperty } from './animation';
import type { AbacoProject, Vec3 } from './schema';
import { StrokeSurface, type StrokeElementContext } from './stroke-spatial';

export type SceneStrokePoint = StrokeElementContext & { id: string; position: Vec3; normal?: Vec3 };
export type SceneStrokeContext = {
  surfaces: StrokeSurface[]; points: SceneStrokePoint[]; bounds: THREE.Box3;
  selectedBounds?: THREE.Box3; selectedRoot?: THREE.Object3D;
};

/** Collect all rendered content; the cache follows geometry changes as well as poses. */
export class StrokeSceneContext {
  private cache = new WeakMap<THREE.Object3D, { signature: string; surface: StrokeSurface }>();
  collect(scene: THREE.Scene, project: AbacoProject, frame: number, selectedId?: string, excludedId?: string): SceneStrokeContext {
    scene.updateMatrixWorld(true);
    const objects = new Map(project.objects.map(object => [object.id, object]));
    const cuts = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
    const cut = cuts.filter(cut => cut.frame <= frame).at(-1);
    const shotStart = cut?.frame ?? project.settings.frameStart;
    const shotEnd = cuts.find(cut => cut.frame > frame)?.frame ?? project.settings.frameEnd + 1;
    const result: SceneStrokeContext = { surfaces: [], points: [], bounds: new THREE.Box3() };
    const seen = new Set<string>();
    scene.traverseVisible(root => {
      const object = objects.get(root.userData.sceneObjectId);
      const background = root.userData.strokeSceneElement as ({ id: string } & StrokeElementContext) | undefined;
      if (!object && !background) return;
      if (object && (object.screenSpace || object.kind === 'audio' || object.kind === 'camera' || object.kind.includes('light')
        || !evaluateProperty(object, 'visibility', frame) || (object.sceneIds.length > 0 && !object.sceneIds.includes(cut?.id ?? '')))) return;
      const id = object?.id ?? background!.id;
      if (seen.has(id)) return;
      seen.add(id);
      if (object?.id === selectedId) {
        result.selectedRoot = root; result.selectedBounds = new THREE.Box3().setFromObject(root);
      }
      if (id === excludedId) return;
      const context: StrokeElementContext = object ? {
        objectId: object.id, name: object.name.slice(0, 500), elementKind: object.kind,
        source: object.kind === 'stroke' ? 'stroke' : 'object',
        ...(object.kind === 'text' ? { text: String(evaluateProperty(object, 'text', frame)).slice(0, 2000) } : {}),
      } : { source: 'background', name: background!.name, elementKind: background!.elementKind };
      if (excludedId && object) for (const key of object.keyframes) {
        if (key.property === 'position' && (key.purpose === 'motion' || (key.purpose === undefined && key.frame > shotStart))
          && key.frame >= shotStart && key.frame < shotEnd && Array.isArray(key.value)) result.points.push({ ...context, source: 'motion', id: `${id}:motion:${key.id}`, position: key.value as Vec3 });
      }
      if (object?.kind === 'stroke' && object.stroke) {
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(root.matrixWorld);
        object.stroke.points.forEach((point, index) => {
          const normal = object.stroke?.normals?.[index];
          result.points.push({ ...context, id: `${id}:${index}`, position: new THREE.Vector3(...point).applyMatrix4(root.matrixWorld).toArray() as Vec3,
            normal: normal ? new THREE.Vector3(...normal).applyNormalMatrix(normalMatrix).toArray() as Vec3 : undefined });
        });
        result.bounds.union(new THREE.Box3().setFromObject(root));
        return;
      }
      const signature = [JSON.stringify(context)];
      root.traverseVisible(child => {
        signature.push(child.uuid, String(child.matrixWorld.elements));
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry;
        signature.push(String(geometry.id), String(geometry.drawRange.start), String(geometry.drawRange.count), String((geometry as THREE.InstancedBufferGeometry).instanceCount));
        for (const [name, attribute] of Object.entries(geometry.attributes) as Array<[string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute]>) signature.push(name, String(attribute.count), String('version' in attribute ? attribute.version : attribute.data.version));
        if (geometry.index) signature.push(String(geometry.index.count), String(geometry.index.version));
        if (child.morphTargetInfluences) signature.push(String(child.morphTargetInfluences));
        if (child instanceof THREE.SkinnedMesh) { child.skeleton.update(); signature.push(String(child.skeleton.boneMatrices)); }
        if (child instanceof THREE.InstancedMesh) signature.push(String(child.instanceMatrix.version), String(child.count));
        if (child.userData.strokeText) signature.push(String((child as THREE.Mesh & { clipRect?: number[] }).clipRect));
      });
      const key = signature.join('|');
      const previous = this.cache.get(root);
      const surface = previous?.signature === key ? previous.surface : new StrokeSurface(id, root, context);
      if (previous?.signature !== key) this.cache.set(root, { signature: key, surface });
      if (!surface.box.isEmpty()) {
        result.surfaces.push(surface); result.bounds.union(surface.box);
        if (id === selectedId) result.selectedBounds = surface.box;
      }
    });
    return result;
  }
}

/** Screen content is projected onto the current drawing plane using its rendered rectangle. */
export function screenStrokeSurface(id: string, corners: Array<[number, number]>, viewport: { left: number; top: number; width: number; height: number }, camera: THREE.Camera, plane: THREE.Plane, context: StrokeElementContext) {
  if (corners.length !== 4 || viewport.width <= 0 || viewport.height <= 0) return undefined;
  const coordinates: number[] = [];
  for (const [x, y] of corners) {
    const caster = new THREE.Raycaster();
    caster.setFromCamera(new THREE.Vector2((x - viewport.left) / viewport.width * 2 - 1, 1 - (y - viewport.top) / viewport.height * 2), camera);
    const point = caster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) return undefined;
    coordinates.push(...point.toArray());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3)); geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geometry);
  const surface = new StrokeSurface(id, mesh, context); geometry.dispose();
  return surface.box.isEmpty() ? undefined : surface;
}
