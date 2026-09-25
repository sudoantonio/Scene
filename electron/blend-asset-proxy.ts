export const BLEND_ASSET_PROXY_SCRIPT = String.raw`import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
output_path = Path(argv[0])
pose = json.loads(argv[1]) if len(argv) > 1 else {}
supported = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
def explicitly_excluded(obj):
    labels = [obj.name, *[collection.name for collection in obj.users_collection]]
    normalized = " ".join(labels).casefold()
    return "esclus" in normalized or "copia mesh" in normalized or obj.name.casefold().startswith("studio |")

visible_objects = [obj for obj in bpy.context.scene.objects if obj.type in supported and not obj.hide_render and obj.visible_get()]
source_objects = [obj for obj in visible_objects if not explicitly_excluded(obj)]
if not source_objects:
    source_objects = visible_objects
if not source_objects:
    raise RuntimeError("The file contains no visible 3D objects")

# Hook targets are the actual movable joints in procedural Blender characters.
controllers_in_scene = {obj for obj in bpy.context.scene.objects if obj.type == "EMPTY" and obj.name.startswith("CTRL_")}
controllers = [{"name": obj.name, "position": [round(float(v), 6) for v in obj.location]}
               for obj in sorted(controllers_in_scene, key=lambda item: item.name)]
for armature in (obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"):
    for bone in armature.pose.bones:
        controllers.append({"name": "BONE|" + armature.name + "|" + bone.name,
                            "position": [round(float(v), 6) for v in bone.location]})
for obj in controllers_in_scene:
    offset = pose.get(obj.name)
    if isinstance(offset, list) and len(offset) == 3:
        obj.location = [float(obj.location[i]) + float(offset[i]) for i in range(3)]
for armature in (obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"):
    for bone in armature.pose.bones:
        offset = pose.get("BONE|" + armature.name + "|" + bone.name)
        if isinstance(offset, list) and len(offset) == 3:
            bone.location = [float(bone.location[i]) + float(offset[i]) for i in range(3)]
bpy.context.view_layer.update()

# L'export glTF può ignorare curve, oggetti dentro collezioni nascoste e rig
# complessi. Creiamo una fotografia statica valutata della geometria: preserva
# posa e materiali, ma non porta nell'editor controller tecnici o animazioni.
depsgraph = bpy.context.evaluated_depsgraph_get()
preview_collection = bpy.data.collections.new("ABACO_PREVIEW")
bpy.context.scene.collection.children.link(preview_collection)
preview_objects = []
for source in source_objects:
    try:
        evaluated = source.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        if not mesh.vertices:
            bpy.data.meshes.remove(mesh)
            continue
        preview = bpy.data.objects.new("ABACO_PREVIEW_" + source.name, mesh)
        preview.matrix_world = source.matrix_world.copy()
        preview.hide_render = False
        preview.hide_viewport = False
        preview_collection.objects.link(preview)
        preview_objects.append(preview)
    except Exception:
        continue

if not preview_objects:
    raise RuntimeError("The file contains no geometry that can be converted for preview")

points = []
for obj in preview_objects:
    for corner in obj.bound_box:
        points.append(obj.matrix_world @ Vector(corner))
minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
center = (minimum + maximum) * 0.5
largest = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z, 0.001)
preview_scale = 2.0 / largest
ground_offset = max(0.0, (center.z - minimum.z) * preview_scale)

bpy.ops.object.select_all(action="DESELECT")
for obj in preview_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = preview_objects[0]
output_path.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(output_path), export_format="GLB", use_selection=True,
    export_animations=False, export_cameras=False, export_lights=False
)
metadata = {
    "boundsCenter": [round(center.x, 6), round(center.y, 6), round(center.z, 6)],
    "previewScale": round(preview_scale, 8),
    "groundOffset": round(ground_offset, 8),
    "meshCount": len(preview_objects),
    "controllers": controllers,
}
print("ABACO_BLEND_ASSET=" + json.dumps(metadata))
`;
