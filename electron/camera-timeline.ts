import * as THREE from 'three';
import { evaluateTransform, evaluateProperty } from '../src/domain/animation';
import type { AbacoProject } from '../src/domain/schema';

export function exportCameraTimeline(project: AbacoProject) {
  const cuts = [...project.cameraCuts].sort((a, b) => a.frame - b.frame);
  const frames = [];
  for (let frame = project.settings.frameStart; frame <= project.settings.frameEnd; frame++) {
    const cut = cuts.filter(c => c.frame <= frame).at(-1);
    const object = project.objects.find(o => o.id === cut?.cameraId && o.kind === 'camera');
    if (!cut || !object) throw new Error(`Camera mancante al frame ${frame}.`);
    const transform = evaluateTransform(object, frame);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number], 'XYZ'));
    frames.push({ frame, sceneId: cut.id, cameraId: object.id, position: transform.position, rotationDegrees: transform.rotation, quaternionWXYZ: [q.w, q.x, q.y, q.z], lens: evaluateProperty(object, 'lens', frame) as number });
  }
  return { schemaVersion: 'SceneCameraTimelineV1', settings: project.settings, units: 'meters', sensorWidth: 36, sensorFit: 'HORIZONTAL', pixelAspect: [1, 1], quaternionOrder: 'WXYZ', instructions: 'Camere vincolanti valutate da Scene a ogni frame. Non ricostruire da soli i punti iniziali, non aggiungere look-at, non cambiare focale o composizione per adattare la recitazione. Usa quaternionWXYZ per evitare differenze di convenzione Euler tra Three.js e Blender. La posizione iniziale non sostituisce i successivi frame.', cuts: cuts.map(c => ({ id: c.id, frame: c.frame, cameraId: c.cameraId, name: c.name })), frames };
}

export const APPLY_CAMERA_TIMELINE_SCRIPT = String.raw`
def apply_scene_camera_timeline(scene, timeline, existing=None):
    import bpy
    from mathutils import Quaternion
    settings = timeline["settings"]
    cameras = {} if existing is None else {key: value for key, value in existing.items() if value.type == "CAMERA"}
    needed = {sample["cameraId"] for sample in timeline["frames"]}
    for camera_id in needed:
        if camera_id not in cameras:
            obj = next((o for o in bpy.data.objects if o.type == "CAMERA" and o.get("scene_camera_id") == camera_id), None)
            if obj is None:
                data = bpy.data.cameras.new("Scene | " + camera_id[:8])
                obj = bpy.data.objects.new(data.name, data)
                scene.collection.objects.link(obj)
            cameras[camera_id] = obj
        obj = cameras[camera_id]
        obj["scene_camera_id"] = camera_id
        obj.parent = None
        for constraint in list(obj.constraints): obj.constraints.remove(constraint)
        obj.animation_data_clear()
        obj.data.animation_data_clear()
        obj.scale = (1, 1, 1)
        obj.rotation_mode = "QUATERNION"
        obj.data.type = "PERSP"
        obj.data.sensor_fit = "HORIZONTAL"
        obj.data.sensor_width = timeline["sensorWidth"]
        obj.data.shift_x = 0
        obj.data.shift_y = 0
    for sample in timeline["frames"]:
        obj = cameras[sample["cameraId"]]
        obj.location = sample["position"]
        obj.rotation_quaternion = Quaternion(sample["quaternionWXYZ"])
        obj.data.lens = sample["lens"]
        obj.keyframe_insert("location", frame=sample["frame"])
        obj.keyframe_insert("rotation_quaternion", frame=sample["frame"])
        obj.data.keyframe_insert("lens", frame=sample["frame"])
    def curves(owner):
        action = owner.animation_data.action if owner.animation_data else None
        if action is None: return []
        if hasattr(action, "fcurves"): return list(action.fcurves)
        return [curve for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
    for obj in cameras.values():
        for curve in curves(obj) + curves(obj.data):
            for key in curve.keyframe_points: key.interpolation = "LINEAR"
    for marker in list(scene.timeline_markers):
        if marker.camera and settings["frameStart"] <= marker.frame <= settings["frameEnd"]: scene.timeline_markers.remove(marker)
    for cut in timeline["cuts"]:
        if cut["cameraId"] in cameras:
            marker = scene.timeline_markers.new("SCENE | " + cut.get("name", cut["id"]), frame=cut["frame"])
            marker.camera = cameras[cut["cameraId"]]
    scene.frame_start = settings["frameStart"]
    scene.frame_end = settings["frameEnd"]
    scene.render.fps = settings["fps"]
    scene.render.fps_base = 1
    scene.render.resolution_x = settings["resolutionX"]
    scene.render.resolution_y = settings["resolutionY"]
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1
    scene.render.pixel_aspect_y = 1
    scene.camera = cameras[timeline["frames"][0]["cameraId"]]
    scene.frame_set(settings["frameStart"])
    return cameras
`;
export const IMPORT_CAMERA_SCRIPT = `# Run in Blender: --python IMPORTA_CAMERE.py -- /path/to/CAMERE.json\nimport bpy, json, sys\nfrom pathlib import Path\n${APPLY_CAMERA_TIMELINE_SCRIPT}\narguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []\nsource = Path(arguments[0]) if arguments else Path(__file__).with_name('CAMERE.json')\ndata = json.loads(source.read_text(encoding='utf-8'))\napply_scene_camera_timeline(bpy.context.scene, data)\nprint('SCENE_CAMERAS_IMPORTED', len(data['frames']))\n`;
