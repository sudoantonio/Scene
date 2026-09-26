/** Blender packs textures and linked libraries into the exported copy only. */
export const PACK_BLEND_SCRIPT = String.raw`import bpy, sys, os
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
source, destination = args
bpy.ops.wm.open_mainfile(filepath=source, load_ui=False, use_scripts=False)
bpy.ops.file.pack_all()
if bpy.data.libraries:
    bpy.ops.file.pack_libraries()
remaining = [p for p in bpy.utils.blend_paths(absolute=True, packed=False) if p]
if remaining:
    raise RuntimeError("Risorse esterne non incorporabili nel modello: " + ", ".join(sorted(set(remaining))))
bpy.ops.wm.save_as_mainfile(filepath=destination, check_existing=False)
print("SCENE_ASSET_PACKED")
`;
