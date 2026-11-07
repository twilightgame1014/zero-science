#!/usr/bin/env python3
"""Build the 11 village props as GLB models, from the GPT reference
sheet (assets/gpt-expansion/props/*.png are the cutouts used as the
design reference). Reuses the buildings pipeline helpers/materials so
the props share the game's material language. Conventions match the
buildings: origin at ground centre, front +Z in three.js terms
(Blender -Y), ContactShadow plane included, no text on the signboard,
no metal parts (wood/stone/clay/rope only)."""
import importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "bb", HERE.parents[1] / "buildings-3d" / "tools" / "build_buildings.py")
bb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bb)
M = bb.M
box, cyl, cone, dome, torus, pipe = bb.box, bb.cyl, bb.cone, bb.dome, bb.torus, bb.pipe
root, contact_shadow, _finish = bb.root, bb.contact_shadow, bb._finish

def extra_materials():
    if "linen" not in M:
        M["linen"] = bb.mat("linen", color=(0.87, 0.82, 0.70), rough=1.0)
        M["fish"] = bb.mat("fish", color=(0.60, 0.61, 0.58), rough=0.5, metal=0.15)
        M["clayPot"] = bb.mat("clayPot", "clay.png", nrm="clay_n.png", rgh="clay_r.png",
                              tint=(0.92, 0.62, 0.45), tile=0.7)

def sph(name, loc, r, material, scale=(1, 1, 1), parent=None):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=2, location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    _finish(o, material, 0, parent)
    return o

def build_fence():
    g = root("fence")
    for x in (-1.1, 0.0, 1.1):
        cyl("post", (x, 0, 0.52), 0.055, 1.05, M["bark"], verts=10, parent=g)
        for z in (0.72, 0.34):
            torus("lash", (x, 0, z), 0.062, 0.018, M["rope"], parent=g)
    for z in (0.72, 0.34):
        cyl("rail", (0, 0, z), 0.042, 2.45, M["bark"], verts=9,
            rot=(0, math.radians(90), 0), parent=g)
    contact_shadow(g, 2.8, 0.7)
    return g

def _pot(name, s):
    g = root(name)
    sph("belly", (0, 0, 0.30 * s), 0.34 * s, M["clayPot"], scale=(1, 1, 0.88), parent=g)
    cyl("neck", (0, 0, 0.56 * s), 0.205 * s, 0.12 * s, M["clayPot"], verts=16, parent=g)
    torus("rim", (0, 0, 0.63 * s), 0.205 * s, 0.028 * s, M["clayPot"], parent=g)
    cyl("mouthDark", (0, 0, 0.60 * s), 0.185 * s, 0.02, M["dark"], verts=16, parent=g)
    contact_shadow(g, 0.95 * s, 0.95 * s)
    return g

def build_pot_large(): return _pot("pot-large", 1.0)
def build_pot_small(): return _pot("pot-small", 0.62)

def build_bucket():
    g = root("bucket")
    cyl("body", (0, 0, 0.26), 0.30, 0.52, M["planksV"], verts=14, r2=0.265, parent=g)
    cyl("innerDark", (0, 0, 0.47), 0.245, 0.02, M["dark"], verts=14, parent=g)
    torus("bandLo", (0, 0, 0.13), 0.298, 0.02, M["rope"], parent=g)
    torus("bandHi", (0, 0, 0.40), 0.272, 0.02, M["rope"], parent=g)
    contact_shadow(g, 0.85, 0.85)
    return g

def build_drying_rack():
    g = root("drying-rack")
    for sx in (-0.62, 0.62):
        for sz in (-1, 1):
            cyl("leg", (sx, sz * 0.16, 0.42), 0.032, 0.92, M["bark"], verts=8,
                rot=(math.radians(22 * sz), 0, 0), parent=g)
        torus("lash", (sx, 0, 0.78), 0.045, 0.016, M["rope"], parent=g)
    cyl("bar", (0, 0, 0.84), 0.032, 1.45, M["bark"], verts=9,
        rot=(0, math.radians(90), 0), parent=g)
    box("clothF", (0, 0.10, 0.52), (1.05, 0.015, 0.60), M["linen"],
        rot=(math.radians(9), 0, 0), bevel=0.005, parent=g)
    box("clothB", (0, -0.10, 0.52), (1.05, 0.015, 0.60), M["linen"],
        rot=(math.radians(-9), 0, 0), bevel=0.005, parent=g)
    contact_shadow(g, 1.8, 0.9)
    return g

def build_dried_fish():
    g = root("dried-fish")
    for sx in (-0.55, 0.55):
        cyl("post", (sx, 0, 0.5), 0.035, 1.0, M["bark"], verts=8, parent=g)
    cyl("line", (0, 0, 0.97), 0.012, 1.14, M["rope"], verts=6,
        rot=(0, math.radians(90), 0), parent=g)
    for i, x in enumerate((-0.3, 0.0, 0.3)):
        cyl("drop", (x, 0, 0.90), 0.008, 0.12, M["rope"], verts=5, parent=g)
        cone("fishBody", (x, 0, 0.66), 0.055, 0.34, M["fish"], verts=10,
             rot=(math.pi, 0, 0), parent=g).scale = (1, 0.45, 1)
        box("fishTail", (x, 0, 0.86), (0.09, 0.015, 0.07), M["fish"], bevel=0.005, parent=g)
    contact_shadow(g, 1.5, 0.6)
    return g

def build_firewood():
    g = root("firewood")
    rows = [(0.10, -0.14), (0.10, 0.0), (0.10, 0.14), (0.245, -0.07), (0.245, 0.07), (0.38, 0.0)]
    for z, y in rows:
        cyl("log", (0, y, z), 0.072, 0.95, M["bark"], verts=9,
            rot=(0, math.radians(90), 0), parent=g, caps=M["logEnd"])
    for x in (-0.27, 0.27):
        torus("wrap", (x, 0, 0.22), 0.215, 0.02, M["rope"],
              rot=(0, math.radians(90), 0), parent=g).scale = (1, 1, 1.12)
    contact_shadow(g, 1.3, 0.75)
    return g

def build_well():
    g = root("well")
    rocks = [M["rock1"], M["rock2"], M["rock3"]]
    for course, (z, n, r) in enumerate(((0.14, 9, 0.44), (0.38, 8, 0.43))):
        for i in range(n):
            a = (i / n) * math.tau + course * 0.35
            b = box("block", (r * math.cos(a), r * math.sin(a), z),
                    (0.30, 0.17, 0.235), rocks[(i + course) % 3],
                    rot=(0, 0, -a + math.pi / 2), bevel=0.03, parent=g)
    cyl("innerDark", (0, 0, 0.30), 0.335, 0.55, M["dark"], verts=18, parent=g)
    cyl("water", (0, 0, 0.20), 0.33, 0.02, M["water"], verts=18, parent=g)
    contact_shadow(g, 1.35, 1.35)
    return g

def build_rope_basket():
    g = root("rope-basket")
    cyl("body", (0, 0, 0.21), 0.29, 0.42, M["rope"], verts=14, r2=0.335, parent=g)
    torus("rim", (0, 0, 0.43), 0.335, 0.026, M["rope"], parent=g)
    cyl("innerDark", (0, 0, 0.40), 0.30, 0.02, M["dark"], verts=14, parent=g)
    for sx in (-1, 1):
        torus("handle", (sx * 0.335, 0, 0.47), 0.075, 0.018, M["rope"],
              rot=(0, 0, 0), parent=g).rotation_euler = (0, 0, 0)
    contact_shadow(g, 0.95, 0.95)
    return g

def build_tool_stand():
    g = root("tool-stand")
    for sx in (-0.5, 0.5):
        cyl("post", (sx, 0, 0.45), 0.04, 0.9, M["bark"], verts=8, parent=g)
    cyl("barTop", (0, 0, 0.88), 0.035, 1.15, M["bark"], verts=8,
        rot=(0, math.radians(90), 0), parent=g)
    cyl("barLow", (0, 0, 0.12), 0.035, 1.15, M["bark"], verts=8,
        rot=(0, math.radians(90), 0), parent=g)
    for sx in (-0.5, 0.5):
        cyl("foot", (sx, 0, 0.05), 0.035, 0.55, M["bark"], verts=8,
            rot=(math.radians(90), 0, 0), parent=g)
    # stone axe leaning in the stand
    cyl("axeHandle", (-0.22, 0.03, 0.52), 0.026, 0.78, M["bark"], verts=8,
        rot=(math.radians(6), 0, math.radians(-4)), parent=g)
    box("axeHead", (-0.25, 0.03, 0.86), (0.07, 0.10, 0.20), M["darkStone"],
        rot=(0, 0, math.radians(-4)), bevel=0.02, parent=g)
    torus("axeLash", (-0.235, 0.03, 0.78), 0.034, 0.012, M["rope"], parent=g)
    # stone pick
    cyl("pickHandle", (0.24, 0.03, 0.52), 0.026, 0.78, M["bark"], verts=8,
        rot=(math.radians(-6), 0, math.radians(4)), parent=g)
    cone("pickTipL", (0.14, 0.03, 0.90), 0.028, 0.22, M["darkStone"], verts=8,
         rot=(0, 0, math.radians(115)), parent=g)
    cone("pickTipR", (0.34, 0.03, 0.90), 0.028, 0.22, M["darkStone"], verts=8,
         rot=(0, 0, math.radians(-115)), parent=g)
    contact_shadow(g, 1.5, 0.85)
    return g

def build_signboard():
    g = root("signboard")
    cyl("post", (0, 0, 0.55), 0.05, 1.1, M["bark"], verts=9, parent=g)
    box("board", (0, 0, 0.92), (0.98, 0.055, 0.44), M["planksH"],
        rot=(math.radians(-3), 0, math.radians(1)), bevel=0.012, parent=g)
    contact_shadow(g, 1.3, 0.7)
    return g

BUILDERS = {
    "fence": build_fence, "pot-large": build_pot_large, "pot-small": build_pot_small,
    "bucket": build_bucket, "drying-rack": build_drying_rack,
    "dried-fish": build_dried_fish, "firewood": build_firewood, "well": build_well,
    "rope-basket": build_rope_basket, "tool-stand": build_tool_stand,
    "signboard": build_signboard,
}

def bbox_of(g):
    xs, ys, zs = [], [], []
    for o in g.children_recursive:
        if o.type != "MESH" or o.name == "ContactShadow":
            continue
        for v in o.bound_box:
            w = o.matrix_world @ bb.Vector(v)
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

def main():
    outdir = HERE.parent / "models"
    outdir.mkdir(parents=True, exist_ok=True)
    bb.setup_materials(); extra_materials()
    meta = {}
    for name, builder in BUILDERS.items():
        bb.clean(); bb.setup_materials(); extra_materials()
        g = builder()
        w, d, h = bbox_of(g)
        meta[name] = {"size": {"w": round(w, 2), "h": round(h, 2), "d": round(d, 2)}}
        bpy.ops.object.select_all(action="DESELECT")
        g.select_set(True)
        for ch in g.children_recursive: ch.select_set(True)
        bpy.context.view_layer.objects.active = g
        path = outdir / f"{name}.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                                  use_selection=True, export_apply=True, export_yup=True)
        print("exported", name, meta[name]["size"])
    (HERE.parent / "props-measured.json").write_text(json.dumps(meta, indent=1))
    print("DONE")

main()
