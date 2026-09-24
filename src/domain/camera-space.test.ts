import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cameraTarget, fromCameraSpace, toCameraSpace } from './camera-space';
import { createProject, type Transform, type Vec3 } from './schema';
import { useEditor } from '../store/editor';
import { evaluateTransform } from './animation';

describe('camera-relative movement', () => {
  it.each([[60, 40, 20], [90, 0, 90], [15, -80, 130]] as Vec3[])('preserves screen axes and makes positive depth recede (%s)', (...rotation) => {
    const pose: Transform = { position: [7, -7, 5], rotation: rotation as Vec3, scale: [1, 1, 1] };
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, .01, 1000);
    camera.position.set(...pose.position);
    camera.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as Vec3);
    camera.updateMatrixWorld();
    const project = (point: Vec3) => new THREE.Vector3(...fromCameraSpace(point, pose)).project(camera);
    const near = project([1, 8, 1]);
    const far = project([1, 12, 1]);
    expect(project([2, 8, 1]).x).toBeGreaterThan(near.x);
    expect(project([1, 8, 2]).y).toBeGreaterThan(near.y);
    expect(Math.abs(far.x)).toBeLessThan(Math.abs(near.x));
    expect(Math.abs(far.y)).toBeLessThan(Math.abs(near.y));
    toCameraSpace(fromCameraSpace([1, 8, 1], pose), pose).forEach((v, i) => expect(v).toBeCloseTo([1, 8, 1][i]));
    expect(cameraTarget(pose, 8)).toEqual(fromCameraSpace([0, 8, 0], pose));
  });

  it('rejects a delayed camera commit addressed to a previous scene', () => {
    useEditor.getState().newProject();
    const first = useEditor.getState().project.cameraCuts[0];
    useEditor.getState().addShot();
    const before = structuredClone(useEditor.getState().project);
    useEditor.getState().setCameraFraming(first.id, [80, 80, 80], [0, 0, 0], [0, 0, 0]);
    expect(useEditor.getState().project).toEqual(before);
  });

  it('uses the chosen interpolation for camera points recorded with REC', () => {
    const project = createProject();
    useEditor.setState({ project, currentFrame: 1, selectedId: undefined, selectedMotion: undefined, recordingSession: undefined, interpolation: 'bezier', past: [], future: [] });
    const camera = project.objects[0];
    const scene = project.cameraCuts[0];
    useEditor.getState().setTransitionMode(camera.id, scene.id, 'linear');
    useEditor.getState().startRecording(scene.id);
    useEditor.getState().setFrame(25);
    useEditor.getState().setCameraFraming(scene.id, [9, -7, 5], camera.transform.rotation, [2, 0, 1]);
    useEditor.getState().stopRecording();
    const changed = useEditor.getState().project.objects[0];
    expect(changed.keyframes.find((k) => k.property === 'position' && k.frame === 1)?.interpolation).toBe('linear');
    expect(evaluateTransform(changed, 13).position).toEqual([8, -7, 5]);
  });
});
