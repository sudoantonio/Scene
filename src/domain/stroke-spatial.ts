import * as THREE from 'three';
import type { Vec3 } from './schema';

export const MAX_STROKE_NEIGHBORS = 50;
export type StrokeElementContext = {
  source?: 'stroke' | 'motion' | 'object' | 'background' | 'screen' | 'caption';
  objectId?: string; name?: string; elementKind?: string; text?: string;
};
export type StrokeNeighbor = StrokeElementContext & { id: string; kind: 'point' | 'surface'; position: Vec3; normal?: Vec3; distance: number };
export type StrokeParameters = { adherence: number; continuity: number };
export const DEFAULT_STROKE_PARAMETERS: StrokeParameters = { adherence: .7, continuity: .6 };
type SpatialPoint = StrokeElementContext & { id: string; position: THREE.Vector3; normal?: Vec3 };
type PointNode = { box: THREE.Box3; points?: SpatialPoint[]; children?: [PointNode, PointNode] };
type SurfaceTriangle = { triangle: THREE.Triangle; box: THREE.Box3; center: THREE.Vector3 };
type SurfaceNode = { box: THREE.Box3; triangles?: SurfaceTriangle[]; children?: [SurfaceNode, SurfaceNode] };

const axisFor = (box: THREE.Box3): 'x' | 'y' | 'z' => {
  const size = box.getSize(new THREE.Vector3());
  return size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
};
function pointTree(points: SpatialPoint[]): PointNode {
  const box = new THREE.Box3();
  for (const point of points) box.expandByPoint(point.position);
  if (points.length <= 16) return { box, points };
  const axis = axisFor(box);
  points.sort((a, b) => a.position[axis] - b.position[axis] || compareIds(a.id, b.id));
  const middle = points.length >> 1;
  return { box, children: [pointTree(points.slice(0, middle)), pointTree(points.slice(middle))] };
}
function surfaceTree(triangles: SurfaceTriangle[]): SurfaceNode {
  const box = new THREE.Box3();
  for (const triangle of triangles) box.union(triangle.box);
  if (triangles.length <= 12) return { box, triangles };
  const axis = axisFor(box);
  triangles.sort((a, b) => a.center[axis] - b.center[axis]);
  const middle = triangles.length >> 1;
  return { box, children: [surfaceTree(triangles.slice(0, middle)), surfaceTree(triangles.slice(middle))] };
}
function compareIds(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
function insertNeighbor(list: StrokeNeighbor[], candidate: StrokeNeighbor) {
  let low = 0, high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1, other = list[middle];
    if (other.distance < candidate.distance || (other.distance === candidate.distance && compareIds(other.id, candidate.id) < 0)) low = middle + 1;
    else high = middle;
  }
  if (low >= MAX_STROKE_NEIGHBORS) return;
  list.splice(low, 0, candidate);
  if (list.length > MAX_STROKE_NEIGHBORS) list.pop();
}
const queryLimit = (radius: number, list: StrokeNeighbor[]) => list.length === MAX_STROKE_NEIGHBORS ? Math.min(radius, list[list.length - 1].distance) : radius;

/** Immutable tree for saved points; small immutable chunks for incoming points. */
export class StrokePointIndex {
  private trees: PointNode[] = [];
  private pending: SpatialPoint[] = [];
  constructor(points: Array<StrokeElementContext & { id: string; position: Vec3; normal?: Vec3 }> = []) {
    if (points.length) this.trees.push(pointTree(points.map(point => ({ ...point, position: new THREE.Vector3(...point.position) }))));
  }
  add(id: string, position: Vec3, normal?: Vec3) {
    this.pending.push({ id, position: new THREE.Vector3(...position), normal });
    if (this.pending.length === 128) { this.trees.push(pointTree(this.pending)); this.pending = []; }
  }
  query(center: THREE.Vector3, radius: number, result: StrokeNeighbor[] = []) {
    const visitPoint = (point: SpatialPoint) => {
      const distance = point.position.distanceTo(center);
      if (distance <= radius) insertNeighbor(result, { ...point, kind: 'point', position: point.position.toArray() as Vec3, distance });
    };
    const visit = (node: PointNode) => {
      if (node.box.distanceToPoint(center) > queryLimit(radius, result)) return;
      if (node.points) { for (const point of node.points) visitPoint(point); return; }
      const children = node.children!;
      const first = children[0].box.distanceToPoint(center) <= children[1].box.distanceToPoint(center) ? 0 : 1;
      visit(children[first]); visit(children[1 - first]);
    };
    for (const tree of this.trees) visit(tree);
    for (const point of this.pending) visitPoint(point);
    return result;
  }
}

/** Evaluates the rendered pose once, including imported meshes, skinning and morphs. */
export class StrokeSurface {
  readonly box: THREE.Box3;
  private tree: SurfaceNode;
  constructor(readonly id: string, root: THREE.Object3D, readonly context: StrokeElementContext = {}) {
    root.updateWorldMatrix(true, true);
    const triangles: SurfaceTriangle[] = [];
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || object.userData.strokeSkip) return;
      const geometry = object.geometry, positions = geometry.getAttribute('position');
      if (!positions) return;
      const glyphs = geometry.getAttribute('aTroikaGlyphBounds');
      if (glyphs || object.userData.strokeText) {
        // Troika places its instanced glyph quads in the vertex shader. The
        // template's position attribute is not the visible text geometry.
        if (!glyphs) return;
        const text = object as THREE.Mesh & { clipRect?: number[]; curveRadius?: number };
        const count = Math.min(glyphs.count, (geometry as THREE.InstancedBufferGeometry).instanceCount ?? glyphs.count);
        const clip = text.clipRect;
        const radius = text.curveRadius ?? 0;
        const vertex = (x: number, y: number) => new THREE.Vector3(radius ? Math.sin(x / radius) * radius : x, y, radius ? radius * (1 - Math.cos(x / radius)) : 0).applyMatrix4(object.matrixWorld);
        for (let i = 0; i < count; i++) {
          const left = Math.max(glyphs.getX(i), clip?.[0] ?? -Infinity), bottom = Math.max(glyphs.getY(i), clip?.[1] ?? -Infinity);
          const right = Math.min(glyphs.getZ(i), clip?.[2] ?? Infinity), top = Math.min(glyphs.getW(i), clip?.[3] ?? Infinity);
          if (right <= left || top <= bottom) continue;
          const segments = radius ? 8 : 1;
          for (let part = 0; part < segments; part++) {
            const x1 = THREE.MathUtils.lerp(left, right, part / segments), x2 = THREE.MathUtils.lerp(left, right, (part + 1) / segments);
            const a = vertex(x1, bottom), b = vertex(x2, bottom), c = vertex(x2, top), d = vertex(x1, top);
            for (const triangle of [new THREE.Triangle(a, b, c), new THREE.Triangle(a, c, d)]) {
              if (triangle.getArea() > 1e-14) triangles.push({ triangle, box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]), center: triangle.getMidpoint(new THREE.Vector3()) });
            }
          }
        }
        return;
      }
      const index = geometry.index;
      const count = index?.count ?? positions.count;
      const start = Math.max(0, geometry.drawRange.start);
      const end = Math.min(count, start + geometry.drawRange.count);
      if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
      const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
      for (let instance = 0; instance < instances; instance++) {
        const matrix = object.matrixWorld.clone();
        if (object instanceof THREE.InstancedMesh) {
          const local = new THREE.Matrix4(); object.getMatrixAt(instance, local); matrix.multiply(local);
        }
        const vertices = new Map<number, THREE.Vector3>();
        const vertex = (i: number) => {
          const id = index ? index.getX(i) : i;
          let point = vertices.get(id);
          if (!point) { point = object.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(matrix); vertices.set(id, point); }
          return point;
        };
        for (let i = start; i + 2 < end; i += 3) {
          const triangle = new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2));
          if (triangle.getArea() <= 1e-14) continue;
          triangles.push({ triangle, box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]), center: triangle.getMidpoint(new THREE.Vector3()) });
        }
      }
    });
    this.tree = surfaceTree(triangles);
    this.box = this.tree.box;
  }
  closest(center: THREE.Vector3, radius: number): StrokeNeighbor | undefined {
    let best = radius, found: StrokeNeighbor | undefined;
    const candidate = new THREE.Vector3();
    const visit = (node: SurfaceNode) => {
      if (node.box.distanceToPoint(center) > best) return;
      if (node.triangles) {
        for (const { triangle } of node.triangles) {
          triangle.closestPointToPoint(center, candidate);
          const distance = candidate.distanceTo(center);
          if (distance <= best) {
            best = distance;
            found = { ...this.context, id: `surface:${this.id}`, kind: 'surface', position: candidate.toArray() as Vec3, normal: triangle.getNormal(new THREE.Vector3()).toArray() as Vec3, distance };
          }
        }
      } else {
        const children = node.children!;
        const first = children[0].box.distanceToPoint(center) <= children[1].box.distanceToPoint(center) ? 0 : 1;
        visit(children[first]); visit(children[1 - first]);
      }
    };
    visit(this.tree);
    return found;
  }
  intersect(ray: THREE.Ray): { position: Vec3; normal: Vec3; distance: number } | undefined {
    let best = Infinity, found: ReturnType<StrokeSurface['intersect']>;
    const candidate = new THREE.Vector3(), boxHit = new THREE.Vector3();
    const visit = (node: SurfaceNode) => {
      if (node.box.isEmpty() || !ray.intersectBox(node.box, boxHit)) return;
      if (!node.box.containsPoint(ray.origin) && ray.origin.distanceTo(boxHit) > best) return;
      if (node.triangles) {
        for (const { triangle } of node.triangles) {
          if (!ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, candidate)) continue;
          const distance = ray.origin.distanceTo(candidate);
          if (distance < best) { best = distance; found = { position: candidate.toArray() as Vec3, normal: triangle.getNormal(new THREE.Vector3()).toArray() as Vec3, distance }; }
        }
      } else { visit(node.children![0]); visit(node.children![1]); }
    };
    visit(this.tree);
    return found;
  }
}

export function strokeNeighbors(center: THREE.Vector3, radius: number, points: StrokePointIndex, surfaces: StrokeSurface[]) {
  const result = points.query(center, radius);
  for (const surface of surfaces) {
    const closest = surface.closest(center, queryLimit(radius, result));
    if (closest) insertNeighbor(result, closest);
  }
  return result;
}
export function automaticStrokeRadius(diagonal: number, previous?: number, neighbors: StrokeNeighbor[] = []) {
  const scale = Number.isFinite(diagonal) && diagonal > 1e-8 ? diagonal : 1;
  const current = previous ?? scale * .2;
  if (neighbors.length < 8) return current;
  const distances = neighbors.map(n => n.distance).sort((a, b) => a - b);
  const middle = distances.length >> 1;
  const median = distances.length % 2 ? distances[middle] : (distances[middle - 1] + distances[middle]) / 2;
  const target = THREE.MathUtils.clamp(median * 4, scale * .05, scale * .5);
  return THREE.MathUtils.lerp(current, target, .2);
}

export function positionStrokePoint(ray: THREE.Ray, provisional: Vec3, neighbors: StrokeNeighbor[], radius: number,
  parameters: StrokeParameters, previous?: Vec3, surface?: { position: Vec3; normal: Vec3 }) {
  const depthOf = (point: Vec3) => new THREE.Vector3(...point).sub(ray.origin).dot(ray.direction);
  const baseDepth = depthOf(provisional);
  let targetDepth = baseDepth;
  if (surface) targetDepth = depthOf(surface.position);
  else {
    let total = 0, sum = 0;
    for (const neighbor of neighbors.slice(0, MAX_STROKE_NEIGHBORS)) {
      const weight = Math.pow(Math.max(0, 1 - neighbor.distance / Math.max(radius, 1e-8)), 2);
      sum += depthOf(neighbor.position) * weight; total += weight;
    }
    if (total > 1e-10) targetDepth = THREE.MathUtils.lerp(baseDepth, sum / total, parameters.adherence);
  }
  if (previous) {
    const oldDepth = depthOf(previous);
    targetDepth = THREE.MathUtils.lerp(targetDepth, oldDepth, parameters.continuity * .5);
    targetDepth = THREE.MathUtils.clamp(targetDepth, oldDepth - radius * .25, oldDepth + radius * .25);
  }
  const position = ray.at(Math.max(1e-5, targetDepth), new THREE.Vector3()).toArray() as Vec3;
  return { position, normal: surface?.normal };
}

export function strokeTubeGeometry(points: Vec3[], thickness: number) {
  if (points.length < 2) return new THREE.BufferGeometry();
  // Piecewise linear interpolation keeps the same centerline as Blender's POLY spline.
  class Polyline extends THREE.Curve<THREE.Vector3> {
    constructor() { super(); }
    getPoint(t: number, target = new THREE.Vector3()) {
      const position = t * (points.length - 1), i = Math.min(points.length - 2, Math.floor(position));
      return target.set(...points[i]).lerp(new THREE.Vector3(...points[i + 1]), position - i);
    }
    getPointAt(t: number, target = new THREE.Vector3()) { return this.getPoint(t, target); }
    getTangentAt(t: number, target = new THREE.Vector3()) {
      const i = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
      return target.set(...points[i + 1]).sub(new THREE.Vector3(...points[i])).normalize();
    }
  }
  return new THREE.TubeGeometry(new Polyline(), points.length - 1, thickness / 2, 8, false);
}
