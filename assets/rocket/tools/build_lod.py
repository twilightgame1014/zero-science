#!/usr/bin/env python3
"""Generate LOD1 variants of every rocket-set GLB.

Imports each LOD0 GLB, decimates meshes >= 40 polys at ratio 0.5,
re-exports as <id>-lod1.glb. Nodes, anchors, pivots and animation
clips are preserved (decimation only edits mesh data).
Run: blender -b -noaudio --python build_lod.py
"""
from pathlib import Path

import bpy

MODELS = Path(__file__).resolve().parent.parent / "models"
RATIO = 0.5
MIN_POLYS = 40

def clean():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

for src in sorted(MODELS.glob("*.glb")):
    if "-lod1" in src.name:
        continue
    clean()
    bpy.ops.import_scene.gltf(filepath=str(src))
    done = 0
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or len(o.data.polygons) < MIN_POLYS:
            continue
        mod = o.modifiers.new("lod", "DECIMATE")
        mod.ratio = RATIO
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier="lod")
        done += 1
    out = MODELS / (src.stem + "-lod1.glb")
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", export_apply=True,
        export_animations=True, export_animation_mode="NLA_TRACKS")
    print(f"LOD1 {out.name}: decimated {done} meshes")
print("LOD DONE")
