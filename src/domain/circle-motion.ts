import * as THREE from 'three';

export type ScreenPoint = { point: THREE.Vector3; x: number; y: number };
export type ViewSize = { width: number; height: number };

/** Actual vertices in world coordinates, independent of triangle indexing and helpers. */
export function objectMotionPoints(root: THREE.Object3D): THREE.Vector3[] {
  root.updateWorldMatrix(true, true);
  const points: THREE.Vector3[] = [], unique = new Set<string>();
  const add = (point: THREE.Vector3) => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) return;
    const key = [point.x, point.y, point.z].map(v => Math.round(v * 1e6)).join(',');
    if (!unique.has(key)) { unique.add(key); points.push(point); }
  };
  root.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.strokeSkip) return;
    for (let parent: THREE.Object3D | null = object.parent; parent && parent !== root; parent = parent.parent) if (parent.userData.strokeSkip) return;
    const geometry = object.geometry, glyphs = geometry.getAttribute('aTroikaGlyphBounds');
    if (glyphs || object.userData.strokeText) {
      if (!glyphs) return;
      const text = object as THREE.Mesh & { clipRect?: number[]; curveRadius?: number };
      const count = Math.min(glyphs.count, (geometry as THREE.InstancedBufferGeometry).instanceCount ?? glyphs.count);
      for (let i = 0; i < count; i++) {
        const l = Math.max(glyphs.getX(i), text.clipRect?.[0] ?? -Infinity), b = Math.max(glyphs.getY(i), text.clipRect?.[1] ?? -Infinity);
        const r = Math.min(glyphs.getZ(i), text.clipRect?.[2] ?? Infinity), t = Math.min(glyphs.getW(i), text.clipRect?.[3] ?? Infinity);
        if (r <= l || t <= b) continue;
        for (const x of [l, r]) for (const y of [b, t]) {
          const radius = text.curveRadius;
          add(new THREE.Vector3(radius ? Math.sin(x / radius) * radius : x, y, radius ? radius * (1 - Math.cos(x / radius)) : 0).applyMatrix4(object.matrixWorld));
        }
      }
      return;
    }
    const positions = geometry.getAttribute('position');
    if (!positions) return;
    if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      const matrix = object.matrixWorld.clone();
      if (object instanceof THREE.InstancedMesh) { const local = new THREE.Matrix4(); object.getMatrixAt(instance, local); matrix.multiply(local); }
      for (let i = 0; i < positions.count; i++) add(object.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(matrix));
    }
  });
  return points;
}

export function projectMotionPoints(points: THREE.Vector3[], camera: THREE.Camera, size: ViewSize): ScreenPoint[] {
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const projected: ScreenPoint[] = [];
  for (const point of points) {
    const clip = new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(matrix);
    if (clip.w <= 0 || clip.z < -clip.w || clip.z > clip.w) continue;
    projected.push({ point, x: (clip.x / clip.w + 1) * size.width / 2, y: (1 - clip.y / clip.w) * size.height / 2 });
  }
  return projected;
}

export function pointsInCircle(points: ScreenPoint[], x: number, y: number, radius: number): THREE.Vector3[] {
  if (!(radius > 0)) return [];
  const squared = radius * radius;
  return points.filter(p => (p.x - x) ** 2 + (p.y - y) ** 2 <= squared).map(p => p.point);
}

/** Minimizes sum (normal.dot(point) - depth)^2 with the view normal fixed. */
export function fitViewPlane(points: THREE.Vector3[], normal: THREE.Vector3): THREE.Plane | undefined {
  if (!points.length || normal.lengthSq() < 1e-12) return;
  const n = normal.clone().normalize();
  const mean = points.reduce((sum, point) => sum + n.dot(point), 0) / points.length;
  return new THREE.Plane(n, -mean);
}

/** The circle's perpendicular line is registered on a fixed camera-parallel reference plane. */
export function circleViewLine(camera: THREE.Camera, size: ViewSize, x: number, y: number, reference: THREE.Plane): THREE.Ray | undefined {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x / size.width * 2 - 1, 1 - y / size.height * 2), camera);
  const origin = raycaster.ray.intersectPlane(reference, new THREE.Vector3());
  if (!origin) return;
  return new THREE.Ray(origin, camera.getWorldDirection(new THREE.Vector3()).normalize());
}

export function intersectViewLine(line: THREE.Ray, plane: THREE.Plane): THREE.Vector3 | undefined {
  // A line, rather than a half-ray: a target may lie on either side of the reference plane.
  const denominator = plane.normal.dot(line.direction);
  if (Math.abs(denominator) < 1e-12) return;
  return line.origin.clone().addScaledVector(line.direction, -plane.distanceToPoint(line.origin) / denominator);
}

export function translatedPivot(pivot: THREE.Vector3, sourceAnchor: THREE.Vector3, targetAnchor: THREE.Vector3): THREE.Vector3 {
  return pivot.clone().add(targetAnchor).sub(sourceAnchor);
}
