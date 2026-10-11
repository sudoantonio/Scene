import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProject, createSceneObject } from './schema';
import { StrokeSceneContext, screenStrokeSurface } from './stroke-scene-context';
import { StrokePointIndex, strokeNeighbors, StrokeSurface } from './stroke-spatial';

function glyphMesh() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.instanceCount = 2;
  geometry.setAttribute('aTroikaGlyphBounds', new THREE.InstancedBufferAttribute(new Float32Array([10, 1, 12, 3, 14, 1, 16, 3]), 4));
  const mesh = new THREE.Mesh(geometry); mesh.userData.strokeText = true; return mesh;
}

describe('complete scene neighborhood', () => {
  it('collects primitives, imported models, text and background without any saved stroke', () => {
    const project = createProject(), scene = new THREE.Scene();
    for (const kind of ['cube', 'blend_asset', 'text'] as const) {
      const object = createSceneObject(kind, 1); object.text = 'TESTO SCENA'; object.screenSpace = false; project.objects.push(object);
      const root = new THREE.Group(); root.userData.sceneObjectId = object.id;
      root.add(kind === 'text' ? glyphMesh() : new THREE.Mesh(new THREE.BoxGeometry())); scene.add(root);
    }
    const background = new THREE.Group(); background.userData.strokeSceneElement = { id: 'background:scene', name: 'Imported scenery', elementKind: 'model' };
    background.add(new THREE.Mesh(new THREE.PlaneGeometry(40, 40))); scene.add(background);
    const context = new StrokeSceneContext().collect(scene, project, 1);
    expect(context.points).toHaveLength(0); expect(context.surfaces).toHaveLength(4);
    const neighbors = strokeNeighbors(new THREE.Vector3(11, 2, .05), 30, new StrokePointIndex(), context.surfaces);
    expect(neighbors.map(neighbor => neighbor.elementKind)).toEqual(expect.arrayContaining(['text', 'cube', 'blend_asset', 'model']));
    expect(neighbors.find(neighbor => neighbor.elementKind === 'text')?.text).toBe('TESTO SCENA');
  });
  it('uses the visible glyph coordinates, not the shader template quad or empty spaces between glyphs', () => {
    const mesh = glyphMesh(); mesh.position.z = 4;
    const surface = new StrokeSurface('text', mesh);
    expect(surface.box.min.toArray()).toEqual([10, 1, 4]); expect(surface.box.max.toArray()).toEqual([16, 3, 4]);
    const ray = (x: number) => new THREE.Ray(new THREE.Vector3(x, 2, 10), new THREE.Vector3(0, 0, -1));
    expect(surface.intersect(ray(11))?.position).toEqual([11, 2, 4]);
    expect(surface.intersect(ray(13))).toBeUndefined(); expect(surface.intersect(ray(.5))).toBeUndefined();
  });
  it('does not invent a quad for text that has not finished loading', () => {
    const mesh = glyphMesh(); mesh.geometry.deleteAttribute('aTroikaGlyphBounds');
    expect(new StrokeSurface('loading-text', mesh).box.isEmpty()).toBe(true);
  });
  it('refreshes text when glyph data arrives during a stroke even when its transform is unchanged', () => {
    const project = createProject(), scene = new THREE.Scene(), object = createSceneObject('text', 1), root = new THREE.Group(), mesh = glyphMesh();
    object.screenSpace = false;
    const glyphs = mesh.geometry.getAttribute('aTroikaGlyphBounds'); mesh.geometry.deleteAttribute('aTroikaGlyphBounds');
    project.objects.push(object); root.userData.sceneObjectId = object.id; root.add(mesh); scene.add(root);
    const collector = new StrokeSceneContext(); expect(collector.collect(scene, project, 1).surfaces).toHaveLength(0);
    mesh.geometry.setAttribute('aTroikaGlyphBounds', glyphs);
    const loaded = collector.collect(scene, project, 1).surfaces[0];
    expect(loaded.box.max.x).toBe(16);
    glyphs.setZ(1, 18); (glyphs as THREE.BufferAttribute).needsUpdate = true;
    expect(collector.collect(scene, project, 1).surfaces[0].box.max.x).toBe(18);
  });
  it('retains objects when all saved strokes are removed and excludes only the object being moved', () => {
    const project = createProject(), scene = new THREE.Scene(); const cube = createSceneObject('cube', 1), stroke = createSceneObject('stroke', 1);
    stroke.stroke = { points: [[0, 0, 0], [1, 0, 0]], thickness: .02 }; project.objects.push(cube, stroke);
    for (const object of [cube, stroke]) { const root = new THREE.Group();root.userData.sceneObjectId = object.id; root.add(new THREE.Mesh(new THREE.BoxGeometry()));scene.add(root); }
    const collector = new StrokeSceneContext(), mixed = collector.collect(scene, project, 1);
    expect(mixed.surfaces).toHaveLength(1);expect(mixed.points).toHaveLength(2);
    project.objects = project.objects.filter(object => object.kind !== 'stroke');
    expect(collector.collect(scene, project, 1).surfaces).toHaveLength(1);
    expect(collector.collect(scene, project, 1, cube.id, cube.id).surfaces).toHaveLength(0);
  });
  it('respects hidden objects and helper meshes without hiding other scene elements', () => {
    const project = createProject(), scene = new THREE.Scene();
    for (const [i, kind] of ['cube', 'camera', 'point_light', 'audio', 'cube'].entries()) {
      const object = createSceneObject(kind as 'cube', i + 1); if(i===4)object.visible=false;
      project.objects.push(object);const root = new THREE.Group(); root.userData.sceneObjectId=object.id;root.add(new THREE.Mesh(new THREE.BoxGeometry()));scene.add(root);
    }
    expect(new StrokeSceneContext().collect(scene, project, 1).surfaces).toHaveLength(1);
  });
  it('projects visible screen content onto the drawing plane and passes it as a scene surface', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, .01, 100); camera.position.z = 10; camera.updateMatrixWorld(true);
    const surface = screenStrokeSurface('image', [[25, 25], [75, 25], [75, 75], [25, 75]], {left:0,top:0,width:100,height:100}, camera, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), {source:'screen',elementKind:'plane',name:'Imported image'})!;
    const neighbor = surface.closest(new THREE.Vector3(0, 0, .05), .1)!;
    expect(neighbor.source).toBe('screen');expect(neighbor.name).toBe('Imported image');expect(neighbor.distance).toBeCloseTo(.05);
  });
  it('applies a single limit of 50 to mixed scene surfaces and stroke points', () => {
    const scene = new THREE.Scene(), project = createProject();
    for(let i=0;i<70;i++) {const object=createSceneObject('cube',i+1);project.objects.push(object);const root=new THREE.Group();root.userData.sceneObjectId=object.id;root.position.x=i*.001;root.add(new THREE.Mesh(new THREE.BoxGeometry()));scene.add(root);}
    const context=new StrokeSceneContext().collect(scene,project,1);
    const index=new StrokePointIndex(Array.from({length:100},(_,i)=>({id:`stroke:${i}`,position:[0,0,i*.001] as [number,number,number]})));
    const neighbors=strokeNeighbors(new THREE.Vector3(0,0,.5),1,index,context.surfaces);
    expect(neighbors).toHaveLength(50);expect(neighbors.some(neighbor=>neighbor.source==='object')).toBe(true);
  });
});
