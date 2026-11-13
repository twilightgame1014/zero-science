#!/usr/bin/env python3
"""Render animation end poses from rocket-scene.blend for verification:
hatch_open (frame 20) and tower_retract (frame 60).
Run: blender -b -noaudio --python render_poses.py
"""
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

# hide the un-assembled originals of the duplicated models
for cname in ("support-tower", "boarding-corridor", "control-terminal",
              "parts-rack"):
    for o in bpy.data.collections[cname].objects:
        o.hide_render = True

def only_clip(name):
    for o in sc.objects:
        if o.animation_data:
            for t in o.animation_data.nla_tracks:
                t.mute = t.name != name

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

only_clip("hatch_open")
sc.frame_set(20)
shot("pose-hatch-open.png", (-6.8, -3.4, 18.6), (-1.2, 0, 17.2), lens=55)

only_clip("tower_retract")
sc.frame_set(60)
shot("pose-tower-retract.png", (15, -17, 10), (-2.5, 0, 7))
print("POSE RENDERS DONE")
