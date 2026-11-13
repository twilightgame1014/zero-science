#!/usr/bin/env python3
"""Render assembly-stage views from rocket-scene.blend.

S4 = complete (frame/skeleton nodes hidden), S1 = skeleton only
(skin hidden). Run: blender -b -noaudio --python render_stages.py
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
PREVIEWS = HERE.parent / "previews"

bpy.ops.wm.open_mainfile(filepath=str(HERE.parent / "rocket-scene.blend"))
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 48
sc.cycles.device = "CPU"
sc.cycles.use_denoising = False
sc.render.resolution_x = 720
sc.render.resolution_y = 540

rocket = bpy.data.collections["rocket"]
SKIN = ("Propulsion", "PropSkirt", "Nozzle", "BodyLower", "SeamRing",
        "InspectHatch", "PipeRun", "BodyUpper", "UpperBand", "BayPanel",
        "Capsule", "Hatch", "Window", "Nose")

def is_frame(o):
    return o.name.startswith("Frame_")

def is_skin(o):
    return any(o.name.startswith(s) for s in SKIN)

def set_stage(stage):
    for o in rocket.objects:
        if o.type == "EMPTY":
            continue
        if stage == "S4":
            o.hide_render = is_frame(o)
        elif stage == "S1":
            o.hide_render = is_skin(o)
    for o in sc.objects:
        if o.name.startswith("boarding-corridor"):
            o.hide_render = stage == "S1"

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

set_stage("S4")
shot("stage-s4-34.png", (17, -19, 13), (0, 0, 8))
# profile of the corridor <-> hatch junction, from the -X axis
shot("stage-s4-hatch.png", (-8.2, -1.6, 18.9), (-1.6, 0, 17.1), lens=50)
set_stage("S1")
shot("stage-s1-34.png", (17, -19, 13), (0, 0, 8))
print("STAGE RENDERS DONE")
