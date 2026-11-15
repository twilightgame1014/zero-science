# Shared construction scaffold kit (unit parts, Scaffold_* nodes).
# Pivot conventions (contract): Post = base centre, extends +Y (unit height 3.0);
# Beam = centre, unit length 1 along X; Plank = centre, unit length 1 along X;
# Brace = centre, unit length 1 along X (rotate +-45 deg in the wall plane);
# Ladder = base centre, height 3.0. Materials reuse assets/buildings-3d.
import bpy, sys
sys.path.insert(0, "/home/hatch/workspace/your_files/science-civilization-game/assets/buildings-3d/tools")
import build_buildings as bb

bpy.ops.wm.read_factory_settings(use_empty=True)
bb.setup_materials()
M = bb.M
post = bb.cyl("Scaffold_Post", (0, 0, 1.5), 0.07, 3.0, M["bark"], verts=8)
lash_a = bb.cyl("lashA", (0, 0, 2.2), 0.085, 0.12, M["rope"], verts=8)
lash_b = bb.cyl("lashB", (0, 0, 0.9), 0.085, 0.12, M["rope"], verts=8)
bpy.ops.object.select_all(action="DESELECT")
for o in (lash_a, lash_b, post): o.select_set(True)
bpy.context.view_layer.objects.active = post
bpy.ops.object.join()
beam = bb.box("Scaffold_Beam", (0, 0, 0), (1.0, 0.09, 0.12), M["planksV"])
plank = bb.box("Scaffold_Plank", (0, 0, 0), (1.0, 0.34, 0.05), M["planksH"])
brace = bb.box("Scaffold_Brace", (0, 0, 0), (1.0, 0.07, 0.07), M["planksV"])
lad = bb.root("Scaffold_Ladder"); lad.location = (0, 0, 0)
bb.box("railL", (-0.21, 0, 1.5), (0.06, 0.04, 3.0), M["planksV"]).parent = lad
bb.box("railR", (0.21, 0, 1.5), (0.06, 0.04, 3.0), M["planksV"]).parent = lad
for i in range(6):
    bb.box(f"rung{i}", (0, 0, 0.3 + i * 0.48), (0.4, 0.05, 0.05), M["planksH"]).parent = lad
import os
out = "/home/hatch/workspace/your_files/science-civilization-game/assets/construction/models/scaffold-kit.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("exported", out, os.path.getsize(out))
