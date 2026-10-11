import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createProject, createSceneObject, ProjectSchema, type Vec3 } from '../src/domain/schema';
import { BLENDER_BUILD_SCRIPT } from '../electron/blender-template';

const output = path.resolve(process.argv[2] ?? 'drawing-delivery');
mkdirSync(output, { recursive: true });
const project = createProject(); project.name = 'Disegno 3D · Jev — superfici e raccordi';
const panel = createSceneObject('plane', 1); panel.name = 'Pannello di disegno'; panel.color = '#596978';
panel.transform = { position: [0, 0, 1.5], rotation: [90, 0, 0], scale: [1.6, 1.3, 1] };
const sphere = createSceneObject('sphere', 1); sphere.name = 'Superficie curva'; sphere.color = '#527c70'; sphere.transform.position = [3, 0, 1];
project.objects.push(panel, sphere);
const stroke = (name: string, points: Vec3[], color: string, normals?: Vec3[]) => {
  const object = createSceneObject('stroke', project.objects.filter(o => o.kind === 'stroke').length + 1);
  const origin = points[0]; object.name = name; object.color = color; object.transform.position = [...origin];
  object.stroke = { points: points.map(p => p.map((v, axis) => v - origin[axis]) as Vec3), thickness: .045, normals };
  project.objects.push(object);
};
const panelPoints: Vec3[] = Array.from({ length: 180 }, (_, i) => {
  const t = i / 179 * Math.PI * 2;
  return [1.15 * Math.sin(t) * (1 + .15 * Math.cos(3 * t)), -.03, 1.5 + .9 * Math.cos(t)];
});
stroke('Tratto aderente al pannello', panelPoints, '#f4b84e', panelPoints.map(() => [0, -1, 0]));
const normals: Vec3[] = [];
const spherePoints: Vec3[] = Array.from({ length: 150 }, (_, i) => {
  const t = i / 149 * Math.PI * 1.7, latitude = .2 + .25 * Math.sin(t * 2);
  const normal: Vec3 = [Math.cos(t) * Math.cos(latitude), -Math.sin(t) * Math.cos(latitude), Math.sin(latitude)];
  normals.push(normal); return [3 + normal[0] * 1.03, normal[1] * 1.03, 1 + normal[2] * 1.03];
});
stroke('Tratto aderente alla sfera', spherePoints, '#e78d8a', normals);
stroke('Raccordo tra i punti vicini', Array.from({ length: 90 }, (_, i) => {
  const t = i / 89; return [1.1 + 1.15 * t, -.04 - .25 * Math.sin(Math.PI * t), 1.5 - .45 * t];
}), '#98d5ee');
writeFileSync(path.join(output, 'Disegno-3D-Jev.abaco.json'), JSON.stringify(ProjectSchema.parse(project), null, 2));
const blank = createProject(); blank.name = 'QA disegno'; blank.settings.resolutionX = 1280; blank.settings.resolutionY = 720;
writeFileSync(path.join(output, 'qa-empty.abaco.json'), JSON.stringify(blank));
const stress = structuredClone(project); stress.name = 'Prestazioni — 10.000 punti e 100 oggetti'; stress.objects = [stress.objects[0]];
for (let i = 0; i < 100; i++) {
  const object = createSceneObject('cube', i + 1); object.transform.position = [i % 10, Math.floor(i / 10), -1]; object.transform.scale = [.3, .3, .3]; stress.objects.push(object);
}
const dense = createSceneObject('stroke', 1); dense.name = '10.000 punti';
dense.stroke = { thickness: .01, points: Array.from({ length: 10000 }, (_, i) => [i % 100 * .1, Math.floor(i / 100) * .1, .1] as Vec3) };
stress.objects.push(dense); writeFileSync(path.join(output, 'Stress-10000-punti-100-oggetti.abaco.json'), JSON.stringify(ProjectSchema.parse(stress)));
writeFileSync(path.join(output, 'build-drawing.py'), BLENDER_BUILD_SCRIPT);
writeFileSync(path.join(output, 'empty-plan.json'), JSON.stringify({ schemaVersion: 'BlenderPlanV1', summary: '', operations: [], warnings: [] }));
writeFileSync(path.join(output, 'verify-drawing.py'), `import bpy, json, sys, math
from pathlib import Path
root = Path(sys.argv[sys.argv.index('--') + 1])
project = json.loads((root / 'Disegno-3D-Jev.abaco.json').read_text())
strokes = [item for item in project['objects'] if item['kind'] == 'stroke']
curves = [obj for obj in bpy.data.objects if obj.get('abaco_kind') == 'stroke']
assert len(curves) == len(strokes) == 3
for data in strokes:
    obj = next(obj for obj in curves if obj.get('abaco_id') == data['id'])
    assert obj.type == 'CURVE' and obj.data.dimensions == '3D'
    assert abs(obj.data.bevel_depth - data['stroke']['thickness'] / 2) < 1e-6
    assert len(obj.data.splines[0].points) == len(data['stroke']['points'])
    assert len(obj.data.materials) == 1
    for actual, expected in zip(obj.data.splines[0].points, data['stroke']['points']):
        assert all(abs(actual.co[axis] - expected[axis]) < 1e-5 for axis in range(3))
print('STROKE_BLENDER_VERIFIED', len(curves))
`);
console.log(`DRAWING_DEMO ${output}`);
