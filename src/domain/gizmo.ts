import { Raycaster, type Object3D, type Ray } from 'three';
import type { TransformControls, TransformControlsGizmo } from 'three-stdlib';

// TransformControls listens to native DOM events, after Fiber's object events.
// Its invisible pickers (not the occluded object's surface) own axis gestures.
export function hitsTransformHandle(controls: TransformControls | null, ray: Ray): boolean {
  if (!controls?.visible) return false;
  const gizmo = controls.children.find((child) => child.type === 'TransformControlsGizmo') as TransformControlsGizmo | undefined;
  const mode = controls.getMode() as 'translate' | 'rotate' | 'scale';
  const picker = gizmo?.picker[mode];
  if (!picker) return false;
  controls.updateMatrixWorld();
  const raycaster = new Raycaster();
  raycaster.ray.copy(ray);
  return raycaster.intersectObject(picker as Object3D, true).some((hit) => hit.object.visible);
}
