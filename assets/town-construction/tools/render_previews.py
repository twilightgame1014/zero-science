#!/usr/bin/env python3
"""Cycles previews for town-construction: stage strips (0..4),
factory 4-view, slope + scale checks. Run with blender -b."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent / "models"
OUT = HERE.parent / "previews"
OUT.mkdir(parents=True, exist_ok=True)

FOOTPRINTS = {  # (w, d) metres, three.js space == Blender (x, y)
    "hut-staged": (3.3, 2.7), "house-staged": (3.4, 3.4),
    "warehouse": (5.4, 4.2), "workshop": (4.8, 3.6),
    "factory-staged": (5.2, 4.2),
}
PILES = {  # stage -> piles shown beside the delivery point
    "hut-staged": {2: ["pile-lumber"], 3: ["pile-lumber", "pile-stone"]},
    "house-staged": {2: ["pile-lumber"], 3: ["pile-lumber", "pile-stone"]},
    "warehouse": {2: ["pile-lumber"], 3: ["pile-lumber", "pile-sacks"]},
    "workshop": {2: ["pile-lumber"], 3: ["pile-lumber", "pile-stone"]},
    "factory-staged": {2: ["pile-stone"], 3: ["pile-metal", "pile-crated"]},
}


def clean():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.resolution_x = 560
    sc.render.resolution_y = 420
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.68, 0.75, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sc.world = w
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    sc.collection.objects.link(sun)
    m = bpy.data.materials.new("Ground")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.42, 0.47, 0.33, 1)
    g = bpy.data.objects.new("Ground", bpy.data.meshes.new("Ground"))
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -0.01))
    g = bpy.context.active_object
    g.data.materials.append(m)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def frame(cam, centre, dist, az_deg, el_deg, look_h):
    az, el = math.radians(az_deg), math.radians(el_deg)
    cam.location = centre + Vector((dist * math.cos(el) * math.sin(az),
                                    -dist * math.cos(el) * math.cos(az),
                                    dist * math.sin(el)))
    tgt = centre + Vector((0, 0, look_h))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()


def load(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{name}.glb"))
    return [o for o in bpy.data.objects if o not in before]


def set_stage(objs, stage):
    for o in objs:
        for i in range(1, 5):
            if o.name.startswith(f"stage{i}_"):
                hide = i > stage
                o.hide_render = hide
                for ch in o.children_recursive:
                    ch.hide_render = hide


def place_site(site_objs, w, d):
    for o in site_objs:
        n = o.name
        if n.startswith("stake"):
            o.location = (math.copysign(w / 2 + 0.5, o.location.x),
                          math.copysign(d / 2 + 0.5, o.location.y), o.location.z)
        elif n.startswith(("ropeX", "outlineX")):
            o.scale.x = w + 1.0
            o.location.y = math.copysign(d / 2 + 0.5, o.location.y)
        elif n.startswith(("ropeY", "outlineY")):
            o.scale.y = d + 1.0
            o.location.x = math.copysign(w / 2 + 0.5, o.location.x)


def bounds(objs):
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        if o.type == "MESH":
            for c in o.bound_box:
                v = o.matrix_world @ Vector(c)
                mn = Vector(map(min, mn, v))
                mx = Vector(map(max, mx, v))
    return mn, mx


def shot(cam, name):
    bpy.context.scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("shot", name)


def add_figure(x, y):
    # ~1.33 m figure (the protagonists' visible height) for scale
    m = bpy.data.materials.new("Fig")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.75, 0.3, 0.25, 1)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.17, depth=1.05,
                                        location=(x, y, 0.55))
    body = bpy.context.active_object
    body.name = "Figure133"
    body.data.materials.append(m)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(x, y, 1.22))
    head = bpy.context.active_object
    head.name = "Figure133Head"
    head.data.materials.append(m)
    grp = bpy.data.objects.new("Figure", None)
    bpy.context.scene.collection.objects.link(grp)
    body.parent = grp
    head.parent = grp
    return grp


def main():
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for name, (w, d) in FOOTPRINTS.items():
        if only and name not in only:
            continue
        clean()
        cam = setup_scene()
        objs = load(name)
        mn, mx = bounds(objs)
        size = mx - mn
        print(f"BOUNDS {name}: size=({size.x:.2f},{size.y:.2f},{size.z:.2f}) "
              f"min=({mn.x:.2f},{mn.y:.2f},{mn.z:.2f})")
        centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 0))
        dist = max(size.x, size.y) * 1.9 + 3
        site = load("construction-site")
        place_site(site, w, d)
        fig = add_figure(centre.x + w / 2 + 1.2, centre.y - d / 2 - 0.6)
        for stage in range(5):
            set_stage(objs, stage)
            for o in site:
                o.hide_render = stage != 0
            fig.hide_render = stage != 4
            for ch in fig.children_recursive: ch.hide_render = stage != 4
            pile_objs = []
            for pn in PILES.get(name, {}).get(stage, []):
                po = load(pn)
                for o in po:
                    o.location.x += centre.x - w / 2 - 1.4
                    o.location.y += centre.y - d / 2 - 1.2
                pile_objs += po
            frame(cam, centre, dist, 38, 30, size.z * 0.32)
            shot(cam, f"{name}-stage{stage}")
            for o in pile_objs:
                bpy.data.objects.remove(o, do_unlink=True)
    # factory four views at complete stage, low camera
    clean()
    cam = setup_scene()
    objs = load("factory-staged")
    set_stage(objs, 4)
    mn, mx = bounds(objs)
    size = mx - mn
    centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 0))
    for label, az in (("front", 0), ("right", 90), ("back", 180), ("left", 270)):
        frame(cam, centre, 11.5, az, 12, 1.6)
        shot(cam, f"factory-view-{label}")
    print("previews done")


if __name__ == "__main__":
    main()
