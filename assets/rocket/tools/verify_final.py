#!/usr/bin/env python3
"""Final verification: assemble the SHIPPED GLBs (not the working
scene) and render the check views.
Run: blender -b -noaudio --python verify_final.py
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent / "models"
PREVIEWS = HERE.parent / "previews"

def import_at(fname, offset):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / fname))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.parent is None:
            o.location = Vector(o.location) + Vector(offset)
    return new

def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    import_at("launch-pad.glb", (0, 0, 0))
    import_at("rocket.glb", (0, 0, 0))
    # S4 presentation: skeleton variants are in the same GLB and are
    # toggled off by the game at this stage
    for o in bpy.data.objects:
        if o.name.startswith("Frame_"):
            o.hide_render = True
    import_at("support-tower.glb", (-4.6, 0, 0))
    import_at("boarding-corridor.glb", (-3.7, 0, 16.83))
    import_at("control-terminal.glb", (6.5, -5.5, 0.8))
    # equipment row along the back edge of the slab (Blender +Y)
    row = ["electronics-fab.glb", "computer-bench.glb",
           "test-terminal.glb", "life-support.glb",
           "power-distribution.glb", "suit-stand.glb"]
    for i, f in enumerate(row):
        import_at(f, (-6.2 + i * 2.5, 6.3, 0.8))
    import_at("spacesuit-display.glb", (6.3, 6.3, 0.9))
    # ground plane + scale figure (protagonist visual height 1.33)
    bpy.ops.mesh.primitive_plane_add(size=90, location=(0, 0, -0.02))
    g = bpy.context.object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs[0].default_value = \
        (0.42, 0.44, 0.42, 1)
    g.data.materials.append(gm)
    bpy.ops.mesh.primitive_uv_sphere_add(location=(3.4, -3.2, 1.46))
    fig = bpy.context.object
    fig.dimensions = (0.56, 0.56, 1.33)
    bpy.ops.object.transform_apply(location=False, rotation=False,
                                   scale=True)
    fm = bpy.data.materials.new("fig")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs[0].default_value = \
        (0.114, 0.498, 0.482, 1)
    fig.data.materials.append(fm)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 40
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = False
    sc.render.resolution_x = 720
    sc.render.resolution_y = 540
    bpy.ops.object.light_add(type="SUN", location=(18, -14, 30))
    sun = bpy.context.object
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.ops.object.light_add(type="AREA", location=(-14, 10, 18))
    fill = bpy.context.object
    fill.data.energy = 350
    fill.data.shape = "DISK"
    fill.data.size = 14
    sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = \
        (0.55, 0.6, 0.68, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7

    def shot(name, loc, target, lens=42):
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.object
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens
        sc.camera = cam
        sc.render.filepath = str(PREVIEWS / name)
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)

    shot("final-full.png", (24, -27, 14), (0, 0, 9.5), lens=40)
    shot("final-back.png", (-6, 29, 13), (0, 0, 9.5), lens=40)
    shot("final-low.png", (7, -9.5, 1.3), (0, 0, 11), lens=30)
    shot("final-hatch.png", (-8.5, -5.5, 19.5), (-1.6, 0, 17.2),
         lens=50)
    shot("final-equipment.png", (0, 14.5, 2.4), (0, 5.8, 0.9), lens=44)
    print("FINAL VERIFY DONE")

main()
