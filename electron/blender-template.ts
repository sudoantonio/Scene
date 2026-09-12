export const BLENDER_BUILD_SCRIPT = String.raw`import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
input_path = Path(argv[0])
plan_path = Path(argv[1])
output_path = Path(argv[2])
project = json.loads(input_path.read_text(encoding="utf-8"))
plan = json.loads(plan_path.read_text(encoding="utf-8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
settings = project["settings"]
scene.frame_start = settings["frameStart"]
scene.frame_end = settings["frameEnd"]
scene.render.fps = settings["fps"]
scene.render.resolution_x = settings["resolutionX"]
scene.render.resolution_y = settings["resolutionY"]
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "METERS"
engine_items = scene.bl_rna.properties["render"].fixed_type.properties["engine"].enum_items.keys()
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engine_items else "BLENDER_EEVEE"
scene.world = bpy.data.worlds.new("Abaco World")
scene.world.color = (0.035, 0.045, 0.06)

def hex_color(value):
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)) + (1.0,)

def make_material(data):
    material = bpy.data.materials.new("MAT • " + data["name"])
    material.diffuse_color = hex_color(data["color"])
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = material.diffuse_color
        principled.inputs["Roughness"].default_value = 0.65
    return material

def create_object(data, suffix="", text_override=None):
    kind = data["kind"]
    name = data["name"] + suffix
    if kind == "cube": bpy.ops.mesh.primitive_cube_add(size=2)
    elif kind == "sphere": bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16)
    elif kind == "cylinder": bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=1, depth=2)
    elif kind == "cone": bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=1, radius2=0, depth=2)
    elif kind == "plane": bpy.ops.mesh.primitive_plane_add(size=2)
    elif kind == "text":
        curve = bpy.data.curves.new(name, "FONT")
        curve.body = text_override if text_override is not None else data.get("text", "Testo")
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.extrude = 0.025
        obj = bpy.data.objects.new(name, curve)
        scene.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
    elif kind == "camera":
        camera = bpy.data.cameras.new(name)
        camera.lens = data.get("camera", {}).get("lens", 50)
        obj = bpy.data.objects.new(name, camera)
        scene.collection.objects.link(obj)
    elif kind in ("area_light", "point_light", "sun_light"):
        light_type = {"area_light": "AREA", "point_light": "POINT", "sun_light": "SUN"}[kind]
        light = bpy.data.lights.new(name, light_type)
        light.energy = data.get("light", {}).get("energy", 1000)
        if light_type == "AREA": light.shape, light.size = "DISK", data.get("light", {}).get("size", 5)
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
    else: raise ValueError("Tipo non supportato: " + kind)
    if kind in ("cube", "sphere", "cylinder", "cone", "plane"):
        obj = bpy.context.object
    obj.name = name
    if kind in ("cube", "sphere", "cylinder", "cone", "plane", "text"):
        obj.data.materials.append(make_material(data))
    obj["abaco_id"] = data["id"]
    obj["abaco_kind"] = kind
    obj["abaco_scene_notes"] = json.dumps(data.get("sceneNotes", []), ensure_ascii=False)
    comment_ids = sorted({cid for key in data.get("keyframes", []) for cid in key.get("commentIds", [])})
    obj["abaco_comment_ids"] = json.dumps(comment_ids)
    return obj

def set_transform(obj, transform):
    obj.location = transform["position"]
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = [math.radians(value) for value in transform["rotation"]]
    obj.scale = transform["scale"]

def action_fcurves(obj):
    if not obj.animation_data or not obj.animation_data.action: return []
    action = obj.animation_data.action
    if hasattr(action, "fcurves"): return list(action.fcurves)
    result = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []): result.extend(list(bag.fcurves))
    return result

def interpolation_name(value):
    return {"constant": "CONSTANT", "linear": "LINEAR", "bezier": "BEZIER"}.get(value, "BEZIER")

def set_interpolation(obj, frame, mode):
    for curve in action_fcurves(obj):
        for point in curve.keyframe_points:
            if abs(point.co.x - frame) < 0.001: point.interpolation = interpolation_name(mode)

def apply_animation(obj, data):
    for key in sorted(data.get("keyframes", []), key=lambda item: item["frame"]):
        frame, prop, value = key["frame"], key["property"], key["value"]
        if prop == "position": obj.location = value; obj.keyframe_insert("location", frame=frame)
        elif prop == "rotation": obj.rotation_euler = [math.radians(v) for v in value]; obj.keyframe_insert("rotation_euler", frame=frame)
        elif prop == "scale": obj.scale = value; obj.keyframe_insert("scale", frame=frame)
        elif prop == "visibility":
            obj.hide_render = not value; obj.hide_viewport = not value
            obj.keyframe_insert("hide_render", frame=frame); obj.keyframe_insert("hide_viewport", frame=frame)
        elif prop == "lens" and obj.type == "CAMERA":
            obj.data.lens = value; obj.data.keyframe_insert("lens", frame=frame)
        set_interpolation(obj, frame, key.get("interpolation", "bezier"))

def create_blend_asset(data):
    asset = data.get("asset", {})
    source_path = Path(asset.get("sourcePath", ""))
    if not source_path.is_file():
        raise RuntimeError("Asset Blender non trovato: " + str(source_path))
    with bpy.data.libraries.load(str(source_path), link=False) as (data_from, data_to):
        data_to.objects = data_from.objects
    supported = {"MESH", "CURVE", "SURFACE", "META", "FONT", "ARMATURE", "EMPTY"}
    imported = [obj for obj in data_to.objects if obj is not None and obj.type in supported and not obj.hide_render]
    if not any(obj.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"} for obj in imported):
        raise RuntimeError("L’asset non contiene oggetti 3D importabili: " + str(source_path))
    collection = bpy.data.collections.new("ASSET • " + data["name"])
    scene.collection.children.link(collection)
    for obj in imported:
        collection.objects.link(obj)
    root = bpy.data.objects.new(data["name"], None)
    scene.collection.objects.link(root)
    normalization = bpy.data.objects.new("NORMALIZE • " + data["name"], None)
    collection.objects.link(normalization)
    normalization.parent = root
    center = asset.get("boundsCenter", [0, 0, 0])
    factor = max(0.000001, float(asset.get("previewScale", 1)))
    normalization.scale = (factor, factor, factor)
    normalization.location = tuple(-factor * float(value) for value in center)
    imported_set = set(imported)
    for obj in imported:
        if obj.parent not in imported_set:
            obj.parent = normalization
    root["abaco_id"] = data["id"]
    root["abaco_kind"] = "blend_asset"
    root["abaco_source_blend"] = str(source_path)
    root["abaco_scene_notes"] = json.dumps(data.get("sceneNotes", []), ensure_ascii=False)
    comment_ids = sorted({cid for key in data.get("keyframes", []) for cid in key.get("commentIds", [])})
    root["abaco_comment_ids"] = json.dumps(comment_ids)
    return root, imported

objects = {}
for data in project["objects"]:
    if data["kind"] in ("area_light", "point_light", "sun_light"):
        continue
    if data["kind"] == "blend_asset":
        obj, imported_objects = create_blend_asset(data)
        set_transform(obj, data["transform"])
        apply_animation(obj, data)
        for imported_obj in imported_objects:
            visibility_data = dict(data)
            visibility_data["keyframes"] = [key for key in data.get("keyframes", []) if key["property"] == "visibility"]
            apply_animation(imported_obj, visibility_data)
        objects[data["id"]] = obj
        continue
    text_keys = sorted([key for key in data.get("keyframes", []) if key["property"] == "text"], key=lambda item: item["frame"])
    if data["kind"] != "text" or not text_keys:
        obj = create_object(data)
        set_transform(obj, data["transform"])
        apply_animation(obj, data)
        objects[data["id"]] = obj
        continue
    variants = [(settings["frameStart"], data.get("text", "Testo"))]
    for key in text_keys:
        if variants[-1][0] == key["frame"]: variants[-1] = (key["frame"], key["value"])
        else: variants.append((key["frame"], key["value"]))
    for index, (start, body) in enumerate(variants):
        obj = create_object(data, " • testo %02d" % (index + 1), body)
        set_transform(obj, data["transform"])
        apply_animation(obj, data)
        if start > settings["frameStart"]:
            obj.hide_render = True; obj.hide_viewport = True
            obj.keyframe_insert("hide_render", frame=settings["frameStart"]); obj.keyframe_insert("hide_viewport", frame=settings["frameStart"])
            obj.keyframe_insert("hide_render", frame=start - 1); obj.keyframe_insert("hide_viewport", frame=start - 1)
        obj.hide_render = False; obj.hide_viewport = False
        obj.keyframe_insert("hide_render", frame=start); obj.keyframe_insert("hide_viewport", frame=start)
        if index + 1 < len(variants):
            end = variants[index + 1][0]
            obj.keyframe_insert("hide_render", frame=end - 1); obj.keyframe_insert("hide_viewport", frame=end - 1)
            obj.hide_render = True; obj.hide_viewport = True
            obj.keyframe_insert("hide_render", frame=end); obj.keyframe_insert("hide_viewport", frame=end)
        set_interpolation(obj, start, "constant")
        objects.setdefault(data["id"], obj)

def visibility_window(obj, start, end):
    first = settings["frameStart"]
    if start > first:
        obj.hide_render = True; obj.hide_viewport = True
        obj.keyframe_insert("hide_render", frame=first); obj.keyframe_insert("hide_viewport", frame=first)
        obj.keyframe_insert("hide_render", frame=start - 1); obj.keyframe_insert("hide_viewport", frame=start - 1)
    obj.hide_render = False; obj.hide_viewport = False
    obj.keyframe_insert("hide_render", frame=start); obj.keyframe_insert("hide_viewport", frame=start)
    if end <= settings["frameEnd"]:
        obj.keyframe_insert("hide_render", frame=end - 1); obj.keyframe_insert("hide_viewport", frame=end - 1)
        obj.hide_render = True; obj.hide_viewport = True
        obj.keyframe_insert("hide_render", frame=end); obj.keyframe_insert("hide_viewport", frame=end)
    set_interpolation(obj, start, "constant")

# Ogni sfondo appartiene alla propria scena. Le immagini diventano pannelli
# agganciati alla camera; i GLB vengono importati come scenografie locali.
cuts = sorted(project.get("cameraCuts", []), key=lambda item: item["frame"])
for cut_index, cut in enumerate(cuts):
    background = cut.get("background", {"kind": "none", "path": ""})
    asset_path = Path(background.get("path", ""))
    if background.get("kind") == "none" or not asset_path.is_file():
        continue
    start = cut["frame"]
    end = cuts[cut_index + 1]["frame"] if cut_index + 1 < len(cuts) else settings["frameEnd"] + 1
    if background["kind"] == "model" and asset_path.suffix.lower() == ".glb":
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(asset_path))
        for imported in set(bpy.data.objects) - before:
            imported["abaco_background_scene"] = cut["id"]
            visibility_window(imported, start, end)
    elif background["kind"] == "image":
        camera = objects.get(cut["cameraId"])
        if not camera: continue
        image = bpy.data.images.load(str(asset_path), check_existing=True)
        mesh = bpy.data.meshes.new("ABACO • Sfondo")
        mesh.from_pydata([(-1,-1,0), (1,-1,0), (1,1,0), (-1,1,0)], [], [(0,1,2,3)])
        panel = bpy.data.objects.new("ABACO • Sfondo • " + str(cut_index + 1), mesh)
        scene.collection.objects.link(panel)
        panel.parent = camera
        panel.location = (0, 0, -10)
        vertical = 2 * 10 * math.tan(camera.data.angle_y / 2)
        panel.scale = (vertical * settings["resolutionX"] / settings["resolutionY"] / 2, vertical / 2, 1)
        material = bpy.data.materials.new(panel.name)
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        principled = nodes.get("Principled BSDF")
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        if "Emission Color" in principled.inputs:
            links.new(texture.outputs["Color"], principled.inputs["Emission Color"])
            principled.inputs["Emission Strength"].default_value = 1.0
        mesh.materials.append(material)
        panel["abaco_background_scene"] = cut["id"]
        visibility_window(panel, start, end)

# Abaco usa due luci tecniche controllate dai preset di ogni scena. Le vecchie
# lampade presenti nei progetti rimangono nei dati, ma non vengono più create.
key_data = bpy.data.lights.new("ABACO • Luce principale", "AREA")
key_data.shape = "DISK"
key_data.size = 5
key_light = bpy.data.objects.new("ABACO • Luce principale", key_data)
scene.collection.objects.link(key_light)
fill_data = bpy.data.lights.new("ABACO • Riempimento", "AREA")
fill_data.shape = "DISK"
fill_data.size = 7
fill_light = bpy.data.objects.new("ABACO • Riempimento", fill_data)
scene.collection.objects.link(fill_light)

light_styles = {
    "neutral": (1.7, .72), "soft": (.9, 1.05),
    "warm": (1.75, .68), "dramatic": (2.7, .22),
}

def aim_light(obj):
    obj.rotation_euler = ((Vector((0, 0, 1)) - obj.location).to_track_quat("-Z", "Y")).to_euler()

for cut in sorted(project.get("cameraCuts", []), key=lambda item: item["frame"]):
    frame = cut["frame"]
    lighting = cut.get("lighting", {"preset": "neutral", "intensity": 1, "direction": 45, "elevation": 45, "color": "#ffffff"})
    key_factor, fill_factor = light_styles.get(lighting.get("preset", "neutral"), light_styles["neutral"])
    intensity = max(0, min(2, lighting.get("intensity", 1)))
    angle = math.radians(lighting.get("direction", 45))
    elevation = math.radians(max(0, min(90, lighting.get("elevation", 45))))
    radius = math.cos(elevation) * 9
    height = 1.5 + math.sin(elevation) * 9
    key_light.location = (math.sin(angle) * radius, -math.cos(angle) * radius, height)
    fill_light.location = (-math.sin(angle) * radius * .72, math.cos(angle) * radius * .72, max(2, height * .6))
    aim_light(key_light); aim_light(fill_light)
    rgb = hex_color(lighting.get("color", "#ffffff"))[:3]
    key_data.color = rgb
    fill_data.color = tuple(min(1, channel * .82 + .18) for channel in rgb)
    key_data.energy = 900 * key_factor * intensity
    fill_data.energy = 450 * fill_factor * intensity
    for obj in (key_light, fill_light):
        obj.keyframe_insert("location", frame=frame)
        obj.keyframe_insert("rotation_euler", frame=frame)
        set_interpolation(obj, frame, "constant")
    for light in (key_data, fill_data):
        light.keyframe_insert("energy", frame=frame)
        light.keyframe_insert("color", frame=frame)
        set_interpolation(light, frame, "constant")

for marker in list(scene.timeline_markers): scene.timeline_markers.remove(marker)
for cut in sorted(project.get("cameraCuts", []), key=lambda item: item["frame"]):
    camera = objects.get(cut["cameraId"])
    if camera:
        marker = scene.timeline_markers.new("CUT • " + camera.name, frame=cut["frame"])
        marker.camera = camera
        if scene.camera is None: scene.camera = camera

plan_text = bpy.data.texts.new("ABACO_PLAN.json")
plan_text.write(json.dumps(plan, ensure_ascii=False, indent=2))
scene["abaco_project_id"] = project["id"]
scene["abaco_schema"] = project["schemaVersion"]
scene.frame_set(settings["frameStart"])
output_path.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
print("ABACO_ANIMATIC_COMPLETE", output_path)
`;
