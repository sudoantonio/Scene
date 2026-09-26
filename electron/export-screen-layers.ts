import { visibilityIntervals } from '../src/domain/media-timeline';
import { evaluateProperty, evaluateTransform } from '../src/domain/animation';
import type { AbacoProject } from '../src/domain/schema';

// Sample with the editor's evaluator so Blender matches motion easing,
// visibility intervals and text changes exactly at every exported frame.
export function exportScreenLayers(project: AbacoProject) {
  return project.objects.filter((object) => object.screenSpace && (object.kind === 'text' || object.kind === 'plane')).map((object) => ({
    objectId: object.id,
    frames: Array.from({ length: project.settings.frameEnd - project.settings.frameStart + 1 }, (_, index) => {
      const frame = project.settings.frameStart + index;
      const transform = evaluateTransform(object, frame);
      return {
        frame, x: transform.position[0], y: transform.position[2],
        rotation: transform.rotation[2], scale: Math.max(.1, transform.scale[0]),
        visible: visibilityIntervals(project, object).some(([a, b]) => frame >= a && frame < b),
        text: object.kind === 'text' ? String(evaluateProperty(object, 'text', frame)) : '',
      };
    }),
  }));
}
