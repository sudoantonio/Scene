export const BLEND_ASSET_PROXY_SCRIPT = String.raw`import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
output_path = Path(argv[0])
supported = {"MESH", "CURVE", "SURFACE", "META", "FONT", "ARMATURE", "EMPTY"}
objects = [obj for obj in bpy.context.scene.objects if obj.type in supported and not obj.hide_render]
renderable = [obj for obj in objects if obj.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}]
if not renderable:
    raise RuntimeError("Il file non contiene oggetti 3D visibili")

points = []
for obj in renderable:
    for corner in obj.bound_box:
        points.append(obj.matrix_world @ Vector(corner))
minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
center = (minimum + maximum) * 0.5
largest = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z, 0.001)
preview_scale = 2.0 / largest

bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = renderable[0]
output_path.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(output_path), export_format="GLB", use_selection=True,
    export_animations=False, export_cameras=False, export_lights=False
)
metadata = {
    "boundsCenter": [round(center.x, 6), round(center.y, 6), round(center.z, 6)],
    "previewScale": round(preview_scale, 8),
}
print("ABACO_BLEND_ASSET=" + json.dumps(metadata))
`;
