#!/usr/bin/env python3
"""Render assembly-stage views S1..S4 from rocket-scene.blend.

Stage visibility (node-name rules, mirrored in README.md):
  S1 skeleton only (Frame_*), no capsule, no corridor, no rack
  S2 propulsion + lower skin (P4 open), upper frame + one panel,
     rack on site, no capsule, no corridor
  S3 full skin + capsule, rack on site, corridor not connected
  S4 complete: corridor connected, rack cleared
Run: blender -b -noaudio --python render_stages.py
"""
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
PREVIEWS = HERE.parent / "previews"

bpy.ops.wm.open_mainfile(filepath=str(HERE.parent / "rocket-scene.blend"))
sc = bpy.context.scene
# the saved scene predates the lighting setup in build_rocket.py,
# so add the same sun + fill + world here
import math as _math
bpy.ops.object.light_add(type="SUN", location=(18, -14, 30))
_sun = bpy.context.object
_sun.data.energy = 3.2
_sun.rotation_euler = (_math.radians(50), 0, _math.radians(35))
bpy.ops.object.light_add(type="AREA", location=(-14, 10, 18))
_fill = bpy.context.object
_fill.data.energy = 350
_fill.data.shape = "DISK"
_fill.data.size = 14
if sc.world is None:
    sc.world = bpy.data.worlds.new("W")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = \
    (0.55, 0.6, 0.68, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
sc.render.engine = "CYCLES"
sc.cycles.samples = 48
sc.cycles.device = "CPU"
sc.cycles.use_denoising = False
sc.render.resolution_x = 720
sc.render.resolution_y = 540

rocket = bpy.data.collections["rocket"]

S2_VISIBLE = {
    "Propulsion", "PropSkirt", "Nozzle", "NozzleInner", "BodyLowerInsul",
    "Skin_Lower_P1", "Skin_Lower_P2", "Skin_Lower_P3", "SeamRing_70",
    "Frame_TankUpper", "Skin_Upper_P2",
}

def base_name(o):
    n = o.name
    return n.split(".")[0] if not n.startswith("Frame_") else n

def rocket_visible(o, stage):
    n = o.name
    if o.type == "EMPTY":
        return False
    if stage == "S1":
        return n.startswith("Frame_")
    if stage == "S2":
        return n.startswith("Frame_BodyUpper") or base_name(o) in S2_VISIBLE
    # S3 / S4: everything except skeleton
    return not n.startswith("Frame_")

def set_stage(stage):
    for o in rocket.objects:
        o.hide_render = not rocket_visible(o, stage)
    for o in sc.objects:
        if o.name.startswith("boarding-corridor"):
            o.hide_render = stage != "S4"
        elif o.name.startswith("parts-rack"):
            o.hide_render = stage not in ("S2", "S3")

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

for stage in ("S1", "S2", "S3", "S4"):
    set_stage(stage)
    shot(f"stage-{stage.lower()}-34.png", (17, -19, 13), (0, 0, 8))
set_stage("S4")
shot("stage-s4-hatch.png", (-8.2, -1.6, 18.9), (-1.6, 0, 17.1), lens=50)
print("STAGE RENDERS DONE")
