import * as THREE from 'three';
import type { Vec3 } from './schema';

export const pathDistance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
export function pathLengths(points: Vec3[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + pathDistance(points[i - 1], points[i]));
  return lengths;
}
export function pointOnPath(points: Vec3[], progress: number, lengths = pathLengths(points)): Vec3 {
  if (!points.length) return [0, 0, 0];
  if (progress <= 0) return [...points[0]];
  if (progress >= 1) return [...points.at(-1)!];
  const distance = lengths.at(-1)! * progress;
  let low = 1, high = lengths.length - 1;
  while (low < high) { const middle = (low + high) >> 1; if (lengths[middle] < distance) low = middle + 1; else high = middle; }
  const t = (distance - lengths[low - 1]) / Math.max(1e-15, lengths[low] - lengths[low - 1]);
  return points[low - 1].map((v, axis) => v + (points[low][axis] - v) * t) as Vec3;
}
/** Include every corner between samples: interpolation must not cut across the drawn surface. */
export function pathInterval(points: Vec3[], from: number, to: number, lengths = pathLengths(points)): Vec3[] {
  const total = lengths.at(-1)!;
  return [pointOnPath(points, from, lengths), ...points.filter((_, i) => lengths[i] > from * total + 1e-12 && lengths[i] < to * total - 1e-12), pointOnPath(points, to, lengths)];
}
/** Only duplicates and numerically collinear vertices may be removed. No smoothing off the surface. */
export function compactSurfacePath(points: Vec3[], tolerance = 1e-10): Vec3[] {
  const result: Vec3[] = [];
  for (const point of points) {
    if (result.length && pathDistance(point, result.at(-1)!) <= tolerance) continue;
    while (result.length >= 2) {
      const a = new THREE.Vector3(...result.at(-2)!), b = new THREE.Vector3(...result.at(-1)!), c = new THREE.Vector3(...point);
      const ab = b.clone().sub(a), bc = c.clone().sub(b);
      if (ab.dot(bc) < 0 || ab.clone().cross(bc).length() > tolerance * (ab.length() + bc.length())) break;
      result.pop();
    }
    result.push([...point]);
  }
  return result;
}

type P2 = { x: number; y: number };
const cross = (a: P2, b: P2) => a.x * b.y - a.y * b.x;
const minus = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
const squared = (a: P2) => a.x * a.x + a.y * a.y;

/**
 * The surface is the union of parallel view-normal lines through the sampled stroke.
 * Its metric is ds² + dz². A planar shortest route (including switches at crossings)
 * lifted with depth linear in arc length has minimum length sqrt(L² + deltaDepth²).
 * It never bridges a corner or leaves that surface.
 */
export function shortestSurfaceMotion(basePoints: Vec3[], normal: Vec3, deltaDepth: number): Vec3[] {
  if (!basePoints.length || !basePoints.every(p => p.every(Number.isFinite)) || !normal.every(Number.isFinite) || !Number.isFinite(deltaDepth)) return [];
  const n = new THREE.Vector3(...normal); if (n.lengthSq() < 1e-20) return []; n.normalize();
  const origin = new THREE.Vector3(...basePoints[0]);
  const u = new THREE.Vector3(Math.abs(n.x) < .9 ? 1 : 0, Math.abs(n.x) < .9 ? 0 : 1, 0).projectOnPlane(n).normalize(), v = n.clone().cross(u);
  const points = compactSurfacePath(basePoints).map(p => { const q = new THREE.Vector3(...p).sub(origin); return { x: q.dot(u), y: q.dot(v) }; });
  const extent = points.reduce((largest, p) => Math.max(largest, Math.hypot(p.x, p.y)), 1), epsilon = extent * 1e-10;
  if (points.length === 1) return Math.abs(deltaDepth) < epsilon ? [] : [basePoints[0], origin.clone().addScaledVector(n, deltaDepth).toArray() as Vec3];
  const segments = points.slice(1).map((b, i) => ({ a: points[i], b, index: i, cuts: [{ t: 0, point: points[i] }, { t: 1, point: b }], minX: Math.min(points[i].x, b.x), maxX: Math.max(points[i].x, b.x), minY: Math.min(points[i].y, b.y), maxY: Math.max(points[i].y, b.y) }));
  let hasShortcut = false;
  const lift = (lateral: Vec3[]) => {
    const lengths = pathLengths(lateral), total = lengths.at(-1)!;
    if (total <= epsilon) return Math.abs(deltaDepth) <= epsilon ? [] : [basePoints[0], origin.clone().addScaledVector(n, deltaDepth).toArray() as Vec3];
    return compactSurfacePath(lateral.map((p, i) => new THREE.Vector3(...p).addScaledVector(n, deltaDepth * lengths[i] / total).toArray() as Vec3), epsilon);
  };
  const ordered = [...segments].sort((a, b) => a.minX - b.minX || a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i], da = minus(a.b, a.a), la = Math.sqrt(squared(da));
    for (let j = i + 1; j < ordered.length && ordered[j].minX <= a.maxX + epsilon; j++) {
      const b = ordered[j]; if (b.minY > a.maxY + epsilon || b.maxY < a.minY - epsilon) continue;
      const db = minus(b.b, b.a), lb = Math.sqrt(squared(db)), offset = minus(b.a, a.a), denominator = cross(da, db);
      const add = (segment: typeof a, t: number, point: P2) => { if (t >= -1e-10 && t <= 1 + 1e-10) segment.cuts.push({ t: Math.max(0, Math.min(1, t)), point }); };
      if (Math.abs(denominator) > epsilon * (la + lb)) {
        const t = cross(offset, db) / denominator, s = cross(offset, da) / denominator;
        if (t >= -1e-10 && t <= 1 + 1e-10 && s >= -1e-10 && s <= 1 + 1e-10) {
          if (Math.abs(a.index - b.index) > 1) hasShortcut = true;
          const p = { x: a.a.x + t * da.x, y: a.a.y + t * da.y }; add(a, t, p); add(b, s, p);
        }
      } else if (Math.abs(cross(offset, da)) <= epsilon * la) {
        if (Math.abs(a.index - b.index) > 1 || da.x * db.x + da.y * db.y < 0) hasShortcut = true;
        // Collinear overlaps and retracing create shared routes too.
        for (const p of [b.a, b.b]) add(a, (minus(p, a.a).x * da.x + minus(p, a.a).y * da.y) / squared(da), p);
        for (const p of [a.a, a.b]) add(b, (minus(p, b.a).x * db.x + minus(p, b.a).y * db.y) / squared(db), p);
      }
    }
  }
  if (!hasShortcut) return lift(compactSurfacePath(basePoints));
  const vertices: P2[] = [], edges: Array<Map<number, number>> = [], bins = new Map<string, number[]>();
  const node = (p: P2) => {
    const x = Math.floor(p.x / epsilon), y = Math.floor(p.y / epsilon);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of bins.get(`${x + dx},${y + dy}`) ?? []) if (Math.hypot(vertices[id].x - p.x, vertices[id].y - p.y) <= epsilon) return id;
    const id = vertices.length, key = `${x},${y}`; vertices.push(p); edges.push(new Map()); bins.set(key, [...(bins.get(key) ?? []), id]); return id;
  };
  const start = node(points[0]), end = node(points.at(-1)!);
  for (const segment of segments) {
    const cuts = segment.cuts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < cuts.length; i++) {
      const a = node(cuts[i - 1].point), b = node(cuts[i].point); if (a === b) continue;
      const distance = Math.hypot(vertices[a].x - vertices[b].x, vertices[a].y - vertices[b].y);
      edges[a].set(b, distance); edges[b].set(a, distance);
    }
  }
  const distances = vertices.map(() => Infinity), previous = vertices.map(() => -1);
  // Binary heap keeps long and heavily intersecting strokes inexpensive.
  const heap: Array<[number, number]> = [];
  const push = (entry: [number, number]) => { heap.push(entry); let i = heap.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent][0] <= entry[0]) break; heap[i] = heap[parent]; i = parent; } heap[i] = entry; };
  const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++; if (heap[child][0] >= last[0]) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first; };
  distances[start] = 0; push([0, start]);
  while (heap.length) {
    const [distance, id] = pop(); if (distance > distances[id]) continue; if (id === end) break;
    for (const [next, length] of edges[id]) if (distance + length < distances[next] - epsilon) { distances[next] = distance + length; previous[next] = id; push([distances[next], next]); }
  }
  if (!Number.isFinite(distances[end])) return [];
  const route: number[] = [end]; while (route[0] !== start) { const prev = previous[route[0]]; if (prev < 0) return []; route.unshift(prev); }
  return lift(route.map(id => origin.clone().addScaledVector(u, vertices[id].x).addScaledVector(v, vertices[id].y).toArray() as Vec3));
}
