import * as THREE from 'three';
import { evaluateProperty, evaluateTransform } from './animation';
import type { AbacoProject, Vec3 } from './schema';

export type FramingIssue = { severity: 'error' | 'warning'; code: string; sceneId: string; beatId?: string; elementId?: string; frame: number; message: string };

export function agentFramingIssues(project: AbacoProject): FramingIssue[] {
  const issues: FramingIssue[] = [];
  if (!project.storyboard) return issues;
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  for (const beat of project.storyboard.beats) {
    const scene = scenes.find((item) => item.id === beat.sceneId);
    if (!scene) continue;
    const frame = scene.frame + beat.startOffsetFrames + Math.floor(beat.durationFrames / 2);
    const shot = project.objects.find((item) => item.id === scene.cameraId);
    if (!shot) continue;
    const cameraTransform = evaluateTransform(shot, frame);
    const lens = evaluateProperty(shot, 'lens', frame) as number;
    const aspect = project.settings.resolutionX / project.settings.resolutionY;
    const verticalFov = THREE.MathUtils.radToDeg(2 * Math.atan((36 / aspect) / (2 * lens)));
    const camera = new THREE.PerspectiveCamera(verticalFov, aspect, .01, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(...cameraTransform.position);
    camera.rotation.set(...cameraTransform.rotation.map(THREE.MathUtils.degToRad) as Vec3);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let target: Vec3 | undefined;
    let normal: Vec3 | undefined;
    if (beat.focusElementId) {
      const object = project.objects.find((item) => item.id === beat.focusElementId);
      if (object) target = evaluateTransform(object, frame).position;
    } else if (beat.surface === 'board' || beat.surface === 'tv') {
      const matcher = beat.surface === 'board' ? /lavagna|whiteboard|blackboard/i : /TV|televis/i;
      const landmark = scene.background.landmarks?.find((item) => matcher.test(item.name));
      if (landmark) { target = landmark.position; normal = landmark.normal; }
    }
    if (!target) continue;
    const point = new THREE.Vector3(...target);
    const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
    const projected = point.clone().project(camera);
    if (view.z >= 0 || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      issues.push({ severity: 'error', code: 'target_behind_camera', sceneId: scene.id, beatId: beat.id, frame, message: `The camera for scene «${scene.name}» faces away from «${beat.visualAction}».` });
    } else if (Math.abs(projected.x) > .85 || Math.abs(projected.y) > .85) {
      issues.push({ severity: 'error', code: 'target_outside_frame', sceneId: scene.id, beatId: beat.id, frame, message: `The beat subject is outside the frame (x=${projected.x.toFixed(2)}, y=${projected.y.toFixed(2)}).` });
    }
    if (normal) {
      const toCamera = new THREE.Vector3(...cameraTransform.position).sub(point).normalize();
      if (toCamera.dot(new THREE.Vector3(...normal)) < .25) issues.push({ severity: 'warning', code: 'surface_backface', sceneId: scene.id, beatId: beat.id, frame, message: `The surface ${beat.surface} is viewed edge-on or from behind.` });
    }
  }
  for (const scene of scenes) {
    for (const object of project.objects.filter((item) => item.kind === 'text' && item.sceneIds.includes(scene.id) && /^(Lavagna|TV) •/.test(item.name))) {
      const surface = object.name.startsWith('TV') ? 'tv' : 'board';
      const landmark = scene.background.landmarks?.find((item) => surface === 'tv' ? /TV • schermo CRT|TV • cornice/i.test(item.name) : /Lavagna • superficie/i.test(item.name));
      if (!landmark?.width || !landmark.height) continue;
      const frame = Math.max(scene.frame, object.keyframes.find((key) => key.property === 'visibility' && key.value === true)?.frame ?? scene.frame);
      const scale = evaluateTransform(object, frame).scale[0];
      const text = evaluateProperty(object, 'text', frame) as string;
      const lines = text.split('\n');
      const width = Math.max(...lines.map((line) => line.length)) * .6 * scale;
      const height = lines.length * 1.2 * scale;
      if (width > landmark.width * .9 || height > landmark.height * .85) issues.push({ severity: 'error', code: 'surface_content_overflow', sceneId: scene.id, elementId: object.id, frame, message: `«${object.name}» exceeds the surface ${surface}: ${width.toFixed(2)} × ${height.toFixed(2)} m versus ${landmark.width.toFixed(2)} × ${landmark.height.toFixed(2)} m.` });
    }
  }
  return issues;
}
