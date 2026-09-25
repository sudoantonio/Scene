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
audio_output_path = Path(argv[3]) if len(argv) > 3 else output_path.with_suffix(".wav")
project = json.loads(input_path.read_text(encoding="utf-8"))
plan = json.loads(plan_path.read_text(encoding="utf-8"))

def asset_path(value):
    source = Path(value)
    return source if source.is_absolute() else input_path.parent / source

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
            if abs(point.co.x - frame) < 0.001:
                point.interpolation = interpolation_name(mode)
                # Blender's automatic Bezier handles may overshoot a camera
                # coordinate because of neighbouring keys. AUTO_CLAMPED keeps
                # every camera segment inside the values of its two endpoints.
                if obj.type == "CAMERA" and mode == "bezier":
                    point.handle_left_type = "AUTO_CLAMPED"
                    point.handle_right_type = "AUTO_CLAMPED"

def constrain_camera_segments(obj):
    if obj.type != "CAMERA": return
    for curve in action_fcurves(obj):
        if curve.data_path not in {"location", "rotation_euler"}: continue
        points = list(curve.keyframe_points)
        for index, point in enumerate(points):
            # A smooth camera segment uses horizontal cubic handles. Its value
            # therefore depends only on its two endpoints (smoothstep), exactly
            # like the Scene preview, and never on a neighbouring keyframe.
            if index > 0 and points[index - 1].interpolation == "BEZIER":
                previous = points[index - 1]
                point.handle_left_type = "FREE"
                point.handle_left = (point.co.x - (point.co.x - previous.co.x) / 3, point.co.y)
            if index + 1 < len(points) and point.interpolation == "BEZIER":
                following = points[index + 1]
                point.handle_right_type = "FREE"
                point.handle_right = (point.co.x + (following.co.x - point.co.x) / 3, point.co.y)

def apply_animation(obj, data):
    obj.hide_render = not data.get("visible", True)
    obj.hide_viewport = obj.hide_render
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
        mode = key.get("interpolation", "bezier")
        hold = max(0, int(key.get("holdFrames", 0)))
        set_interpolation(obj, frame, "constant" if hold else mode)
        if hold and prop in ("position", "rotation", "scale", "lens"):
            hold_frame = frame + hold
            if prop == "position": obj.location = value; obj.keyframe_insert("location", frame=hold_frame)
            elif prop == "rotation": obj.rotation_euler = [math.radians(v) for v in value]; obj.keyframe_insert("rotation_euler", frame=hold_frame)
            elif prop == "scale": obj.scale = value; obj.keyframe_insert("scale", frame=hold_frame)
            elif prop == "lens" and obj.type == "CAMERA": obj.data.lens = value; obj.data.keyframe_insert("lens", frame=hold_frame)
            set_interpolation(obj, hold_frame, mode)
    constrain_camera_segments(obj)

def create_blend_asset(data):
    asset = data.get("asset", {})
    source_path = asset_path(asset.get("sourcePath", ""))
    if not source_path.is_file():
        raise RuntimeError("Asset Blender non trovato: " + str(source_path))
    with bpy.data.libraries.load(str(source_path), link=False) as (data_from, data_to):
        data_to.objects = data_from.objects
    supported = {"MESH", "CURVE", "SURFACE", "META", "FONT", "ARMATURE", "EMPTY"}
    all_imported = [obj for obj in data_to.objects if obj is not None and obj.type in supported and (not obj.hide_render or obj.type in {"ARMATURE", "EMPTY"})]
    def explicitly_excluded(obj):
        normalized = obj.name.casefold()
        collection_names = " ".join(collection.name for collection in obj.users_collection).casefold()
        return normalized.startswith("studio |") or normalized.startswith("mesh |") or "esclus" in collection_names or "copia mesh" in collection_names
    preferred = [obj for obj in all_imported if not explicitly_excluded(obj)]
    imported = preferred if any(obj.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"} for obj in preferred) else all_imported
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
    bounds = [obj.matrix_world @ Vector(corner) for obj in imported if hasattr(obj, "bound_box") for corner in obj.bound_box]
    planar_xy = False
    if bounds:
        minimum = Vector((min(point.x for point in bounds), min(point.y for point in bounds), min(point.z for point in bounds)))
        maximum = Vector((max(point.x for point in bounds), max(point.y for point in bounds), max(point.z for point in bounds)))
        size = maximum - minimum
        planar_xy = size.z <= max(0.001, max(size.x, size.y) * 0.08)
    # I personaggi 2D di Abaco sono disegnati sul piano XY: li mettiamo in
    # piedi sul piano XZ, con il fronte rivolto verso -Y.
    if planar_xy:
        normalization.rotation_euler[0] = math.radians(90)
    offset = Vector(tuple(-factor * float(value) for value in center))
    normalization.location = normalization.rotation_euler.to_matrix() @ offset
    imported_set = set(imported)
    for obj in imported:
        if obj.parent not in imported_set:
            obj.parent = normalization
    controller_keys = asset.get("controllerKeys", [])
    for obj in imported:
        if obj.type == "ARMATURE":
            for bone in obj.pose.bones:
                name = "BONE|" + obj.name + "|" + bone.name
                keys = sorted((key for key in controller_keys if key.get("name") == name), key=lambda key: key["frame"])
                if not keys:
                    continue
                base = bone.location.copy()
                if keys[0]["frame"] > settings["frameStart"]:
                    bone.location = base
                    bone.keyframe_insert("location", frame=settings["frameStart"], group=bone.name)
                for key in keys:
                    bone.location = base + Vector(key["offset"])
                    bone.keyframe_insert("location", frame=key["frame"], group=bone.name)
            for curve in action_fcurves(obj):
                if curve.data_path.endswith(".location"):
                    for point in curve.keyframe_points:
                        point.interpolation = "LINEAR"
        if obj.type != "EMPTY":
            continue
        keys = sorted((key for key in controller_keys if key.get("name") == obj.name), key=lambda key: key["frame"])
        if not keys:
            continue
        base = obj.location.copy()
        first = keys[0]
        if first["frame"] > settings["frameStart"]:
            obj.location = base
            obj.keyframe_insert("location", frame=settings["frameStart"])
        for key in keys:
            obj.location = base + Vector(key["offset"])
            obj.keyframe_insert("location", frame=key["frame"])
        for curve in action_fcurves(obj):
            if curve.data_path == "location":
                for point in curve.keyframe_points:
                    point.interpolation = "LINEAR"
    root["abaco_id"] = data["id"]
    root["abaco_kind"] = "blend_asset"
    root["abaco_source_blend"] = str(source_path)
    root["abaco_scene_notes"] = json.dumps(data.get("sceneNotes", []), ensure_ascii=False)
    comment_ids = sorted({cid for key in data.get("keyframes", []) for cid in key.get("commentIds", [])})
    root["abaco_comment_ids"] = json.dumps(comment_ids)
    return root, imported

objects = {}
for data in project["objects"]:
    if data["kind"] in ("audio", "area_light", "point_light", "sun_light"):
        continue
    if data.get("screenSpace", False):
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
# agganciati alla camera; GLB e OBJ vengono importati come scenografie locali.
cuts = sorted(project.get("cameraCuts", []), key=lambda item: item["frame"])
for cut_index, cut in enumerate(cuts):
    background = cut.get("background", {"kind": "none", "path": ""})
    background_path = asset_path(background.get("path", ""))
    if background.get("kind") == "none" or not background_path.is_file():
        continue
    start = cut["frame"]
    end = cuts[cut_index + 1]["frame"] if cut_index + 1 < len(cuts) else settings["frameEnd"] + 1
    if background["kind"] == "model" and background_path.suffix.lower() == ".glb":
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(background_path))
        for imported in set(bpy.data.objects) - before:
            imported["abaco_background_scene"] = cut["id"]
            visibility_window(imported, start, end)
    elif background["kind"] == "model" and background_path.suffix.lower() == ".obj":
        before = set(bpy.data.objects)
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=str(background_path))
        else:
            bpy.ops.import_scene.obj(filepath=str(background_path))
        for imported in set(bpy.data.objects) - before:
            imported["abaco_background_scene"] = cut["id"]
            visibility_window(imported, start, end)
    elif background["kind"] == "image":
        camera = objects.get(cut["cameraId"])
        if not camera: continue
        image = bpy.data.images.load(str(background_path), check_existing=True)
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

def overlay_material(name, color, image=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = hex_color(color)
    emission.inputs["Strength"].default_value = 1
    if image is None:
        links.new(emission.outputs[0], output.inputs["Surface"])
    else:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        links.new(texture.outputs["Color"], emission.inputs["Color"])
        links.new(texture.outputs["Alpha"], mix.inputs[0])
        links.new(transparent.outputs[0], mix.inputs[1])
        links.new(emission.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], output.inputs["Surface"])
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        elif hasattr(material, "blend_method"):
            material.blend_method = "BLEND"
    return material

def screen_layer_object(data, name, body=None):
    if data["kind"] == "text":
        curve = bpy.data.curves.new(name, "FONT")
        curve.body = body
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.space_line = 1.08
        curve.size = 1
        curve.extrude = 0
        obj = bpy.data.objects.new(name, curve)
        curve.materials.append(overlay_material(name, data["color"]))
        aspect = 1
    else:
        image = bpy.data.images.load(str(asset_path(data["asset"]["sourcePath"])), check_existing=True)
        aspect = image.size[1] / max(1, image.size[0])
        top, right, bottom, left = data.get("screenCrop", [0, 0, 0, 0])
        corners = [(left, bottom), (1 - right, bottom), (1 - right, 1 - top), (left, 1 - top)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x - .5, (y - .5) * aspect, 0) for x, y in corners], [], [(0, 1, 2, 3)])
        uv = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                uv.data[loop_index].uv = corners[mesh.loops[loop_index].vertex_index]
        obj = bpy.data.objects.new(name, mesh)
        mesh.materials.append(overlay_material(name, "#ffffff", image))
    scene.collection.objects.link(obj)
    obj["abaco_id"] = data["id"]
    obj["abaco_screen_space"] = True
    obj.rotation_mode = "XYZ"
    if hasattr(obj, "visible_shadow"): obj.visible_shadow = False
    return obj

def overlay_visibility(obj, frame, visible):
    obj.hide_render = not visible
    obj.hide_viewport = not visible
    obj.keyframe_insert("hide_render", frame=frame)
    obj.keyframe_insert("hide_viewport", frame=frame)

# Screen layers use camera-local coordinates and remain the same fraction of
# the image after camera moves, lens changes and scene cuts. Each frame is baked
# from the editor evaluator; the resulting .blend needs no Python handlers.
screen_data = {data["id"]: data for data in project["objects"] if data.get("screenSpace", False)}
screen_layers = project.get("screenLayers", [])
for layer_index, layer in enumerate(screen_layers):
    data = screen_data[layer["objectId"]]
    for cut_index, cut in enumerate(cuts):
        camera = objects.get(cut["cameraId"])
        if camera is None: continue
        start = max(settings["frameStart"], cut["frame"])
        end = cuts[cut_index + 1]["frame"] if cut_index + 1 < len(cuts) else settings["frameEnd"] + 1
        samples = [sample for sample in layer["frames"] if start <= sample["frame"] < end]
        bodies = list(dict.fromkeys(sample["text"] for sample in samples)) if data["kind"] == "text" else [None]
        for variant_index, body in enumerate(bodies):
            name = data["name"] + " • schermo %d.%d" % (cut_index + 1, variant_index + 1)
            obj = screen_layer_object(data, name, body)
            obj.parent = camera
            obj["abaco_camera_id"] = cut["cameraId"]
            obj["abaco_scene_id"] = cut["id"]
            depth = max(camera.data.clip_start * 1.1, .11) + (len(screen_layers) - layer_index) * .0001
            if start > settings["frameStart"]: overlay_visibility(obj, settings["frameStart"], False)
            for sample in samples:
                frame = sample["frame"]
                scene.frame_set(frame)
                corners = camera.data.view_frame(scene=scene)
                width = (max(v.x / -v.z for v in corners) - min(v.x / -v.z for v in corners)) * depth
                height = (max(v.y / -v.z for v in corners) - min(v.y / -v.z for v in corners)) * depth
                obj.location = (sample["x"] * width / 2, sample["y"] * height / 2, -depth)
                obj.rotation_euler = (0, 0, -math.radians(sample["rotation"]))
                size = width * (34 if data["kind"] == "text" else 260) / 1280 * sample["scale"]
                obj.scale = (size, size, size)
                obj.keyframe_insert("location", frame=frame)
                obj.keyframe_insert("rotation_euler", frame=frame)
                obj.keyframe_insert("scale", frame=frame)
                overlay_visibility(obj, frame, sample["visible"] and (body is None or sample["text"] == body))
            if end <= settings["frameEnd"]: overlay_visibility(obj, end, False)
            for curve in action_fcurves(obj):
                for point in curve.keyframe_points: point.interpolation = "CONSTANT"

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

# Audio is kept in the Video Sequence Editor and mixed to a separate WAV next
# to the .blend. Visibility keys define the editable clip ranges in the timeline.
def audio_ranges(data):
    keys = sorted([key for key in data.get("keyframes", []) if key["property"] == "visibility"], key=lambda item: item["frame"])
    ranges, active, start = [], bool(data.get("visible", True)), settings["frameStart"]
    for key in keys:
        frame, value = int(key["frame"]), bool(key["value"])
        if value and not active: start, active = frame, True
        elif not value and active:
            if frame > start: ranges.append((start, frame))
            active = False
    if active: ranges.append((start, settings["frameEnd"] + 1))
    allowed = set(data.get("sceneIds", []))
    if not allowed: return ranges
    clipped = []
    ordered_cuts = sorted(project.get("cameraCuts", []), key=lambda item: item["frame"])
    for index, cut in enumerate(ordered_cuts):
        if cut["id"] not in allowed: continue
        scene_end = ordered_cuts[index + 1]["frame"] if index + 1 < len(ordered_cuts) else settings["frameEnd"] + 1
        for begin, end in ranges:
            left, right = max(begin, cut["frame"]), min(end, scene_end)
            if right > left: clipped.append((left, right))
    return clipped

audio_objects = [data for data in project["objects"] if data.get("kind") == "audio" and data.get("asset", {}).get("sourcePath")]
if audio_objects:
    editor = scene.sequence_editor_create()
    sequences = getattr(editor, "sequences", getattr(editor, "strips", None))
    channel = 1
    for data in audio_objects:
        source = asset_path(data["asset"]["sourcePath"])
        if not source.is_file(): raise RuntimeError("Audio non trovato: " + str(source))
        controls = data.get("audio", {})
        trim_start = max(0.0, float(controls.get("trimStart", 0)))
        source_end = float(controls.get("trimEnd", 0)) or float(controls.get("duration", 0))
        source_frames = max(1, int(round(max(0.01, source_end - trim_start) * settings["fps"])))
        for clip_index, (begin, end) in enumerate(audio_ranges(data)):
            cursor = begin
            while cursor < end:
                segment_end = min(end, cursor + source_frames)
                strip = sequences.new_sound(data["name"] + " • %d" % (clip_index + 1), str(source), channel=channel, frame_start=cursor)
                if hasattr(strip, "animation_offset_start"): strip.animation_offset_start = int(round(trim_start * settings["fps"]))
                strip.frame_final_end = segment_end
                volume = 0.0 if controls.get("muted", False) else max(0.0, min(1.0, float(controls.get("volume", 1))))
                strip.volume = volume
                fade_in = min(segment_end - cursor, int(round(max(0.0, float(controls.get("fadeIn", 0))) * settings["fps"])))
                fade_out = min(segment_end - cursor, int(round(max(0.0, float(controls.get("fadeOut", 0))) * settings["fps"])))
                if fade_in:
                    strip.volume = 0; strip.keyframe_insert("volume", frame=cursor)
                    strip.volume = volume; strip.keyframe_insert("volume", frame=cursor + fade_in)
                if fade_out:
                    strip.volume = volume; strip.keyframe_insert("volume", frame=segment_end - fade_out)
                    strip.volume = 0; strip.keyframe_insert("volume", frame=segment_end)
                if not controls.get("loop", False): break
                cursor = segment_end
            channel += 1

plan_text = bpy.data.texts.new("ABACO_PLAN.json")
plan_text.write(json.dumps(plan, ensure_ascii=False, indent=2))
scene["abaco_project_id"] = project["id"]
scene["abaco_schema"] = project["schemaVersion"]
scene.frame_set(settings["frameStart"])
output_path.parent.mkdir(parents=True, exist_ok=True)
# Export folders are renamed after this process finishes; textures must not
# retain dependencies on that temporary path or the original imported files.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
if audio_objects:
    audio_output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.sound.mixdown(filepath=str(audio_output_path), container="WAV", codec="PCM", accuracy=1024)
print("ABACO_ANIMATIC_COMPLETE", output_path)
`;
