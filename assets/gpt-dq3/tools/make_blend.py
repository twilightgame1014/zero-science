#!/usr/bin/env python3
"""Assemble all DQ3 GLBs into one .blend (grid layout) for manual
editing / inspection. The parametric source of truth remains
build_dq3.py; this .blend is the baked assembly."""
import math
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
names = sorted(p.stem for p in MODELS.glob("*.glb"))
cols = 5
for i, name in enumerate(names):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{name}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    gx = (i % cols) * 7 - 14
    gy = (i // cols) * 7 - 7
    for r in roots:
        r.location.x += gx
        r.location.y += gy
    print("placed", name)
bpy.ops.wm.save_as_mainfile(filepath=str(MODELS / "dq3-assets.blend"))
print("SAVED", MODELS / "dq3-assets.blend")
