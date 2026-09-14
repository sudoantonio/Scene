"""Run with Blender --background --python-exit-code 1 --python this_file."""
import json
from pathlib import Path
import sys
import tempfile
import copy
import math

import bpy
from bpy_extras.object_utils import world_to_camera_view

root = Path(tempfile.mkdtemp(prefix="abaco-export-check-"))
image = root / "background.png"
fixture_image = bpy.data.images.new("Fixture", width=2, height=2, alpha=True)
fixture_image.pixels = [1, 0, 0, 1] * 4
fixture_image.filepath_raw = str(image)
fixture_image.file_format = "PNG"
fixture_image.save()
camera = {"id": "camera", "name": "Camera", "kind": "camera", "color": "#ffffff", "visible": True,
          "transform": {"position": [0, -7, 3], "rotation": [70, 0, 0], "scale": [1, 1, 1]}, "camera": {"lens": 50}}
camera["keyframes"] = [{"frame": 1, "property": "position", "value": [0, -7, 3], "interpolation": "linear"},
                       {"frame": 5, "property": "position", "value": [5, -10, 7], "interpolation": "linear"},
                       {"frame": 1, "property": "lens", "value": 50, "interpolation": "linear"},
                       {"frame": 5, "property": "lens", "value": 80, "interpolation": "linear"}]
second_camera = copy.deepcopy(camera)
second_camera.update(id="camera2", name="Camera 2")
second_camera["transform"]["rotation"] = [45, 0, 30]
hidden = {"id": "hidden", "name": "Hidden cube", "kind": "cube", "color": "#ffffff", "visible": False,
          "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}}
image_layer = copy.deepcopy(hidden)
image_layer.update(id="image", name="Image overlay", kind="plane", visible=True, screenSpace=True,
                   asset={"sourcePath": "background.png"}, screenCrop=[.1, .2, .1, .2])
text_layer = copy.deepcopy(image_layer)
text_layer.update(id="text", name="Title overlay", kind="text", text="First title")
samples = [{"frame": frame, "x": .2, "y": -.3, "scale": 1.5, "rotation": 20, "visible": frame != 4, "text": ""} for frame in range(1, 11)]
text_samples = [dict(sample, text="First title" if sample["frame"] < 3 else "Second title") for sample in samples]
project = {"id": "test", "schemaVersion": "AbacoSceneV1", "settings": {"frameStart": 1, "frameEnd": 10, "fps": 24, "resolutionX": 640, "resolutionY": 360},
           "objects": [camera, second_camera, hidden, image_layer, text_layer],
           "screenLayers": [{"objectId": "image", "frames": samples}, {"objectId": "text", "frames": text_samples}],
           "cameraCuts": [{"id": "scene", "cameraId": "camera", "frame": 1, "background": {"kind": "image", "path": "background.png"}},
                          {"id": "scene2", "cameraId": "camera2", "frame": 6, "background": {"kind": "none", "path": ""}}]}
(root / "input.json").write_text(json.dumps(project))
(root / "plan.json").write_text(json.dumps({"operations": []}))
source = (Path(__file__).resolve().parents[1] / "electron/blender-template.ts").read_text()
script = source.split("String.raw`", 1)[1].rsplit("`;", 1)[0]
sys.argv = ["blender", "--", str(root / "input.json"), str(root / "plan.json"), str(root / "output.blend")]
exec(compile(script, "build_scene.py", "exec"), {"__name__": "__main__"})
assert (root / "output.blend").stat().st_size > 0
assert bpy.data.objects["Hidden cube"].hide_render
assert len(bpy.data.images) > 0
assert all(image.packed_file for image in bpy.data.images if image.source == "FILE"), "Export textures must survive moving the bundle"
overlays = [obj for obj in bpy.data.objects if obj.get("abaco_screen_space")]
assert len(overlays) == 5, "Each scene needs its own camera-bound layer and text variants"
for frame in (1, 3, 4, 5, 6, 10):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    visible = [obj for obj in overlays if not obj.hide_render]
    assert len(visible) == (0 if frame == 4 else 2), (frame, [obj.name for obj in visible])
    for obj in visible:
        assert obj.parent.type == "CAMERA"
        assert obj.parent.get("abaco_id") == ("camera" if frame < 6 else "camera2")
        projected = world_to_camera_view(bpy.context.scene, obj.parent, obj.matrix_world.translation)
        assert abs(projected.x - .6) < .0001 and abs(projected.y - .35) < .0001, (frame, projected)
        assert abs(obj.rotation_euler.z + 20 * 3.141592653589793 / 180) < .0001
        if obj.type == "MESH":
            assert len(obj.data.uv_layers) == 1
            left = world_to_camera_view(bpy.context.scene, obj.parent, obj.matrix_world @ obj.data.vertices[0].co)
            right = world_to_camera_view(bpy.context.scene, obj.parent, obj.matrix_world @ obj.data.vertices[1].co)
            expected_width = 260 / 1280 * 1.5 * .6
            assert abs(right.x - left.x - expected_width * math.cos(math.radians(20))) < .0001
            assert abs(right.y - left.y + expected_width * math.sin(math.radians(20)) * 640 / 360) < .0001
            textures = [node for node in obj.data.materials[0].node_tree.nodes if node.type == "TEX_IMAGE"]
            assert textures and textures[0].image.packed_file and textures[0].image.has_data
        else:
            assert obj.data.body == ("First title" if frame < 3 else "Second title")
bpy.context.scene.frame_set(1)
for obj in list(bpy.data.objects):
    if obj.type == "FONT" or obj.get("abaco_background_scene"):
        bpy.data.objects.remove(obj, do_unlink=True)
render = bpy.context.scene.render
render.resolution_x, render.resolution_y = 160, 90
render.resolution_percentage = 100
render.filepath = str(root / "screen-layer.png")
bpy.ops.render.render(write_still=True)
result = bpy.data.images.load(render.filepath)
pixel = (int(result.size[1] * .35) * result.size[0] + int(result.size[0] * .6)) * 4
red, green, blue, _ = result.pixels[pixel:pixel + 4]
assert red > green + .15 and red > blue + .15, (red, green, blue)
assert red > result.pixels[0] + .2, "The red pixel must come from the screen layer, not the background"
print("ABACO_EXPORT_CHECK_PASSED", root)
