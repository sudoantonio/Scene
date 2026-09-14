import { describe, expect, it } from 'vitest';
import { Box3, Group, PerspectiveCamera, Ray, Scene, Vector3 } from 'three';
import { TransformControls, type TransformControlsGizmo } from 'three-stdlib';
import { hitsTransformHandle } from './gizmo';

describe('Priorità delle maniglie sul trascinamento libero', () => {
  it.each(['translate', 'rotate', 'scale'] as const)('riserva i picker %s anche se invisibili', (mode) => {
    const camera = new PerspectiveCamera(50, 1, .1, 100);
    camera.position.set(5, -8, 6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const object = new Group();
    new Scene().add(object);
    const controls = new TransformControls(camera, undefined);
    controls.attach(object).setMode(mode);
    controls.setSize(1.2);
    controls.updateMatrixWorld();
    const gizmo = controls.children.find((child) => child.type === 'TransformControlsGizmo') as TransformControlsGizmo;
    const picker = gizmo.picker[mode];
    expect(picker.visible).toBe(false);
    const handle = picker.children.find((child) => child.name === 'X' && child.visible)!;
    const target = new Box3().setFromObject(handle).getCenter(new Vector3());
    const ray = new Ray(camera.position.clone(), target.sub(camera.position).normalize());
    expect(hitsTransformHandle(controls, ray)).toBe(true);
    expect(hitsTransformHandle(controls, new Ray(new Vector3(100, 100, 100), new Vector3(1, 0, 0)))).toBe(false);
    controls.detach();
    expect(hitsTransformHandle(controls, ray)).toBe(false);
  });
  it('senza selezione lascia libero il movimento sul soggetto', () => {
    expect(hitsTransformHandle(null, new Ray())).toBe(false);
  });
});
