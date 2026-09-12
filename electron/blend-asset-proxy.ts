export const BLEND_ASSET_PROXY_SCRIPT = String.raw`import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
output_path = Path(argv[0])
supported = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
source_objects = [obj for obj in bpy.context.scene.objects if obj.type in supported and not obj.hide_render]
if not source_objects:
    raise RuntimeError("Il file non contiene oggetti 3D visibili")

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
    raise RuntimeError("Il file non contiene geometria convertibile per l'anteprima")

points = []
for obj in preview_objects:
    for corner in obj.bound_box:
        points.append(obj.matrix_world @ Vector(corner))
minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
center = (minimum + maximum) * 0.5
largest = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z, 0.001)
preview_scale = 2.0 / largest

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
    "meshCount": len(preview_objects),
}
print("ABACO_BLEND_ASSET=" + json.dumps(metadata))
`;
