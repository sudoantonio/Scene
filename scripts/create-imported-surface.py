import bpy, sys
from pathlib import Path
root = Path(sys.argv[sys.argv.index('--') + 1])
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=.5)
bpy.context.object.name='Superficie importata'
bpy.ops.wm.save_as_mainfile(filepath=str(root/'superficie.blend'))
bpy.ops.export_scene.gltf(filepath=str(root/'superficie.glb'), export_format='GLB', use_selection=True)
