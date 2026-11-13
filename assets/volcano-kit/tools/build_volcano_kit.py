#!/usr/bin/env python3
"""Volcano kit builder (2026-11-11 round) — Blender 4.0, headless.

Builds the volcano dressing set as GLBs with real-metre dimensions,
origin at ground centre, +Z front (rocks read from any side).
Style contract: big form first, medium cracks second, restrained
surface last; flat materials (ash / ash-brown / charcoal family),
no brick joints, no photo noise, no gloss. Lava glow exists ONLY
as the emissive crack faces of the cooled-lava chunk.

Run: blender -b -noaudio --python build_volcano_kit.py
Output: ../ (GLBs), ../previews/ (workbench contact renders),
        ../metadata.json is written by measure step in this script.
"""
import bpy
import math
import os
import random
from mathutils import Vector, noise as mnoise

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PREV = os.path.join(OUT, "previews")
os.makedirs(PREV, exist_ok=True)

# ------------------------------------------------------------------
# materials (flat, matte; colours in linear-ish hex chosen for the
# module's golden-hour grade)
# ------------------------------------------------------------------
def mat(name, rgb, rough=0.96, emissive=None, ei=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
        bsdf.inputs["Emission Strength"].default_value = ei
    return m

M_ROCK_MID   = mat("vk_rock_mid",   (0.105, 0.093, 0.086))
M_ROCK_DARK  = mat("vk_rock_dark",  (0.052, 0.047, 0.045))
M_ASH_DUST   = mat("vk_ash_dust",   (0.19, 0.165, 0.14))
M_ASH_BROWN  = mat("vk_ash_brown",  (0.135, 0.11, 0.088))
M_SCREE      = mat("vk_scree",      (0.15, 0.133, 0.12))
M_LAVA_CRACK = mat("vk_lava_crack", (0.05, 0.03, 0.025), emissive=(1.0, 0.30, 0.06), ei=1.6)
M_ORE_RUST   = mat("vk_ore_rust",   (0.26, 0.135, 0.05), rough=0.62)
M_ORE_QUARTZ = mat("vk_ore_quartz", (0.38, 0.35, 0.285), rough=0.5)
M_LEAF_ASH   = mat("vk_leaf_ash",   (0.095, 0.107, 0.06))
M_BARK_ASH   = mat("vk_bark_ash",   (0.10, 0.082, 0.067))
M_GRASS_ASH  = mat("vk_grass_ash",  (0.18, 0.162, 0.092))
M_GRASS_OLIVE= mat("vk_grass_olive",(0.12, 0.13, 0.068))

ALL_MATS = [M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST, M_ASH_BROWN, M_SCREE,
            M_LAVA_CRACK, M_ORE_RUST, M_ORE_QUARTZ, M_LEAF_ASH,
            M_BARK_ASH, M_GRASS_ASH, M_GRASS_OLIVE]

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # materials survive read_factory_settings? No — recreate guard:
    for m in ALL_MATS:
        if m.name not in bpy.data.materials:
            bpy.data.materials.new(m.name)  # placeholder, replaced below

def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # re-link our material objects (they live in bpy.data already if
    # created after startup; on first call they are created above).
    return

def ensure_mats():
    # (Re)build the shared materials in the current file.
    global M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST, M_ASH_BROWN, M_SCREE
    global M_LAVA_CRACK, M_ORE_RUST, M_ORE_QUARTZ, M_LEAF_ASH
    global M_BARK_ASH, M_GRASS_ASH, M_GRASS_OLIVE, ALL_MATS
    M_ROCK_MID   = mat("vk_rock_mid",   (0.105, 0.093, 0.086))
    M_ROCK_DARK  = mat("vk_rock_dark",  (0.052, 0.047, 0.045))
    M_ASH_DUST   = mat("vk_ash_dust",   (0.19, 0.165, 0.14))
    M_ASH_BROWN  = mat("vk_ash_brown",  (0.135, 0.11, 0.088))
    M_SCREE      = mat("vk_scree",      (0.15, 0.133, 0.12))
    M_LAVA_CRACK = mat("vk_lava_crack", (0.05, 0.03, 0.025), emissive=(1.0, 0.30, 0.06), ei=1.6)
    M_ORE_RUST   = mat("vk_ore_rust",   (0.26, 0.135, 0.05), rough=0.62)
    M_ORE_QUARTZ = mat("vk_ore_quartz", (0.38, 0.35, 0.285), rough=0.5)
    M_LEAF_ASH   = mat("vk_leaf_ash",   (0.095, 0.107, 0.06))
    M_BARK_ASH   = mat("vk_bark_ash",   (0.10, 0.082, 0.067))
    M_GRASS_ASH  = mat("vk_grass_ash",  (0.18, 0.162, 0.092))
    M_GRASS_OLIVE= mat("vk_grass_olive",(0.12, 0.13, 0.068))
    ALL_MATS = [M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST, M_ASH_BROWN, M_SCREE,
                M_LAVA_CRACK, M_ORE_RUST, M_ORE_QUARTZ, M_LEAF_ASH,
                M_BARK_ASH, M_GRASS_ASH, M_GRASS_OLIVE]

def set_mats(obj, mats):
    for m in mats:
        obj.data.materials.append(m)
    return {m.name: i for i, m in enumerate(mats)}

def displace(obj, seed, amp, freq=1.6, squash_top=False):
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-10, 10), rnd.uniform(-10, 10), rnd.uniform(-10, 10)))
    for v in obj.data.vertices:
        n = mnoise.noise(v.co * freq + off)
        n2 = mnoise.noise(v.co * freq * 3.1 + off * 1.7)
        d = n * amp + n2 * amp * 0.35
        dirv = v.co.normalized() if v.co.length > 1e-6 else Vector((0, 0, 1))
        v.co += dirv * d
    obj.data.update()

def paint_rock(obj, idx, seed, dust_thresh=0.72, crack_freq=2.6, crack_amt=0.35):
    """Face-material painting: up faces get ash dust, a noise band of
    faces gets the dark crack material, the rest mid rock."""
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-5, 5), rnd.uniform(-5, 5), rnd.uniform(-5, 5)))
    for p in obj.data.polygons:
        c = p.center
        if p.normal.z > dust_thresh:
            p.material_index = idx[M_ASH_DUST.name]
        elif abs(mnoise.noise(c * crack_freq + off)) < crack_amt * 0.28:
            p.material_index = idx[M_ROCK_DARK.name]
        else:
            p.material_index = idx[M_ROCK_MID.name]

def finish(obj, name):
    obj.name = name
    for p in obj.data.polygons:
        p.use_smooth = False
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj

def export(obj, filename, lod_of=None):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              use_selection=True, export_yup=True,
                              export_apply=True)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    bb = [tuple(round(float(v), 3) for v in c) for c in obj.bound_box]
    xs = [c[0] for c in bb]; ys = [c[1] for c in bb]; zs = [c[2] for c in bb]
    return {"file": filename, "tris": tris,
            "size_m": [round(max(xs) - min(xs), 2), round(max(zs) - min(zs), 2), round(max(ys) - min(ys), 2)]}

def make_lod(obj, name, ratio=0.45):
    bpy.ops.object.select_all(action="DESELECT")
    dup = obj.copy()
    dup.data = obj.data.copy()
    bpy.context.collection.objects.link(dup)
    dup.select_set(True)
    bpy.context.view_layer.objects.active = dup
    mod = dup.modifiers.new("dec", "DECIMATE")
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier="dec")
    dup.name = name
    return dup

def cube(name, loc, scale, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bev = o.modifiers.new("bev", "BEVEL")
    bev.width = min(scale) * 0.07
    bev.segments = 1
    bpy.ops.object.modifier_apply(modifier="bev")
    sub = o.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    bpy.ops.object.modifier_apply(modifier="sub")
    return o

def join_objs(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.active_object
    j.name = name
    return j

RESULTS = {}

# ------------------------------------------------------------------
# 1. basalt outcrop L — three tilted columnar blocks in a cluster
# ------------------------------------------------------------------
def build_outcrop_l():
    fresh_scene(); ensure_mats()
    parts = []
    specs = [
        ((0.0, 0.0, 1.05), (0.62, 0.55, 1.05), (0.06, 0.03, 0.2)),
        ((0.95, 0.25, 0.8), (0.5, 0.48, 0.8), (-0.05, 0.08, -0.3)),
        ((-0.85, 0.3, 0.62), (0.46, 0.42, 0.62), (0.09, -0.05, 0.5)),
        ((0.35, -0.55, 0.45), (0.42, 0.4, 0.45), (0.0, 0.1, 1.1)),
    ]
    for i, (loc, sc, rot) in enumerate(specs):
        o = cube(f"blk{i}", loc, sc, rot)
        displace(o, 100 + i, 0.17)
        parts.append(o)
    j = join_objs(parts, "basalt-outcrop-l")
    idx = set_mats(j, [M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST])
    paint_rock(j, idx, 7)
    finish(j, "basalt-outcrop-l")
    RESULTS["basalt-outcrop-l"] = export(j, "basalt-outcrop-l.glb")
    lod = make_lod(j, "basalt-outcrop-l_lod1")
    RESULTS["basalt-outcrop-l_lod1"] = export(lod, "basalt-outcrop-l_lod1.glb")

# ------------------------------------------------------------------
# 2. basalt outcrop S — one blocky outcrop
# ------------------------------------------------------------------
def build_outcrop_s():
    fresh_scene(); ensure_mats()
    o = cube("basalt-outcrop-s", (0, 0, 0.5), (0.72, 0.6, 0.5), (0.04, 0.07, 0.4))
    displace(o, 55, 0.15)
    idx = set_mats(o, [M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST])
    paint_rock(o, idx, 21)
    finish(o, "basalt-outcrop-s")
    RESULTS["basalt-outcrop-s"] = export(o, "basalt-outcrop-s.glb")

# ------------------------------------------------------------------
# 3. fallen block — tumbled angular block
# ------------------------------------------------------------------
def build_fallen():
    fresh_scene(); ensure_mats()
    o = cube("fallen-block", (0, 0, 0.34), (0.58, 0.45, 0.42), (0.22, 0.13, 0.7))
    displace(o, 77, 0.11)
    idx = set_mats(o, [M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST])
    paint_rock(o, idx, 33, dust_thresh=0.35)
    finish(o, "fallen-block")
    RESULTS["fallen-block"] = export(o, "fallen-block.glb")

# ------------------------------------------------------------------
# 4. scree cluster — low mound of small rocks
# ------------------------------------------------------------------
def build_scree():
    fresh_scene(); ensure_mats()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=(0, 0, 0.02))
    mound = bpy.context.active_object
    mound.scale = (0.95, 0.8, 0.22)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    displace(mound, 91, 0.08)
    parts = [mound]
    rnd = random.Random(5)
    for i in range(9):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.15, 0.75)
        s = rnd.uniform(0.09, 0.2)
        o = cube(f"sc{i}", (math.cos(a) * r, math.sin(a) * r, 0.16 + rnd.uniform(-0.03, 0.05)),
                 (s, s * 0.85, s * 0.7), (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3)))
        displace(o, 200 + i, 0.045)
        parts.append(o)
    j = join_objs(parts, "scree-cluster")
    idx = set_mats(j, [M_SCREE, M_ROCK_DARK, M_ASH_DUST])
    for p in j.data.polygons:
        p.material_index = idx[M_SCREE.name] if mnoise.noise(p.center * 3.0) > -0.25 else idx[M_ROCK_DARK.name]
        if p.normal.z > 0.7:
            p.material_index = idx[M_ASH_DUST.name]
    finish(j, "scree-cluster")
    RESULTS["scree-cluster"] = export(j, "scree-cluster.glb")

# ------------------------------------------------------------------
# 5. crater rim shelf — flat-topped ledge slab
# ------------------------------------------------------------------
def build_shelf():
    fresh_scene(); ensure_mats()
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0.22))
    o = bpy.context.active_object
    o.name = "crater-rim-shelf"
    o.scale = (1.3, 0.85, 0.22)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # taper the underside: pull bottom-front/back verts inward
    for v in o.data.vertices:
        if v.co.z < 0.05:
            v.co.x *= 0.78
            v.co.y *= 0.8
    bev = o.modifiers.new("bev", "BEVEL")
    bev.width = 0.05; bev.segments = 1
    bpy.ops.object.modifier_apply(modifier="bev")
    sub = o.modifiers.new("sub", "SUBSURF"); sub.levels = 1
    bpy.ops.object.modifier_apply(modifier="sub")
    displace(o, 300, 0.05)
    # keep the top walkable-flat: re-flatten verts near the top
    zmax = max(v.co.z for v in o.data.vertices)
    for v in o.data.vertices:
        if v.co.z > zmax - 0.05:
            v.co.z = zmax
    idx = set_mats(o, [M_ROCK_MID, M_ROCK_DARK, M_ASH_DUST])
    paint_rock(o, idx, 44, dust_thresh=0.8, crack_amt=0.5)
    finish(o, "crater-rim-shelf")
    RESULTS["crater-rim-shelf"] = export(o, "crater-rim-shelf.glb")
    lod = make_lod(o, "crater-rim-shelf_lod1")
    RESULTS["crater-rim-shelf_lod1"] = export(lod, "crater-rim-shelf_lod1.glb")

# ------------------------------------------------------------------
# 6. cooled lava chunk — dark crust, emissive crack faces only
# ------------------------------------------------------------------
def build_lava():
    fresh_scene(); ensure_mats()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.62, location=(0, 0, 0.3))
    o = bpy.context.active_object
    o.name = "cooled-lava-chunk"
    o.scale = (1.05, 0.85, 0.58)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    displace(o, 400, 0.09, freq=2.2)
    idx = set_mats(o, [M_ROCK_DARK, M_LAVA_CRACK, M_ASH_DUST])
    rnd = random.Random(9)
    off = Vector((rnd.uniform(-5, 5), rnd.uniform(-5, 5), rnd.uniform(-5, 5)))
    for p in o.data.polygons:
        n = mnoise.noise(p.center * 5.2 + off)
        if abs(n) < 0.055 and p.center.z > 0.12:
            p.material_index = idx[M_LAVA_CRACK.name]
        elif p.normal.z > 0.75:
            p.material_index = idx[M_ASH_DUST.name]
        else:
            p.material_index = idx[M_ROCK_DARK.name]
    finish(o, "cooled-lava-chunk")
    RESULTS["cooled-lava-chunk"] = export(o, "cooled-lava-chunk.glb")
    lod = make_lod(o, "cooled-lava-chunk_lod1", 0.5)
    RESULTS["cooled-lava-chunk_lod1"] = export(lod, "cooled-lava-chunk_lod1.glb")

# ------------------------------------------------------------------
# 7. ore outcrop — rock base + rust/quartz nodules (no glow)
# ------------------------------------------------------------------
def build_ore():
    fresh_scene(); ensure_mats()
    # Low slab base; the crystal nodules grow OUT of its top face and
    # front face so they read at gameplay distance (v1 buried them
    # inside a tall loaf base — only the tips showed).
    base = cube("orebase", (0, 0, 0.2), (0.62, 0.52, 0.2), (0.03, 0.06, 0.3))
    displace(base, 500, 0.07)
    idxb = set_mats(base, [M_ASH_BROWN, M_ROCK_DARK, M_ASH_DUST])
    for p in base.data.polygons:
        p.material_index = idxb[M_ASH_BROWN.name]
        if p.normal.z > 0.6:
            p.material_index = idxb[M_ASH_DUST.name]
    parts = [base]
    rnd = random.Random(12)
    # (x, y, lean_x, lean_y) on the top face; z sits on the slab top.
    top_spots = [(0.3, 0.16, 0.35, -0.3), (-0.28, 0.24, 0.3, 0.35),
                 (0.08, -0.3, -0.4, -0.1), (-0.05, 0.02, 0.15, 0.1),
                 (0.42, -0.12, 0.2, -0.5), (-0.44, -0.06, 0.1, 0.5)]
    for i, (x, y, lx, ly) in enumerate(top_spots):
        depth = rnd.uniform(0.45, 0.7)
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=rnd.uniform(0.15, 0.22),
                                        depth=depth, location=(x, y, 0.36 + depth / 2),
                                        rotation=(lx, ly, rnd.uniform(0, 3)))
        c = bpy.context.active_object
        set_mats(c, [M_ORE_RUST if i % 3 else M_ORE_QUARTZ])
        parts.append(c)
    # Two nodules jutting from the front face.
    for i, (x, z) in enumerate([(0.25, 0.22), (-0.3, 0.18)]):
        depth = rnd.uniform(0.35, 0.5)
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=rnd.uniform(0.13, 0.18),
                                        depth=depth, location=(x, -0.48, z),
                                        rotation=(-1.15, 0, rnd.uniform(0, 3)))
        c = bpy.context.active_object
        set_mats(c, [M_ORE_QUARTZ if i % 2 else M_ORE_RUST])
        parts.append(c)
    j = join_objs(parts, "ore-outcrop")
    finish(j, "ore-outcrop")
    RESULTS["ore-outcrop"] = export(j, "ore-outcrop.glb")
    lod = make_lod(j, "ore-outcrop_lod1", 0.5)
    RESULTS["ore-outcrop_lod1"] = export(lod, "ore-outcrop_lod1.glb")

# ------------------------------------------------------------------
# 8. ash shrub — sparse branches + ash-dusted leaf blobs
# ------------------------------------------------------------------
def build_shrub():
    fresh_scene(); ensure_mats()
    parts = []
    rnd = random.Random(15)
    for i in range(6):
        a = rnd.uniform(0, math.tau)
        tilt = rnd.uniform(0.25, 0.55)
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.035, radius2=0.012,
                                        depth=0.62, location=(math.cos(a) * 0.1, math.sin(a) * 0.1, 0.28),
                                        rotation=(math.sin(a) * tilt, -math.cos(a) * tilt, 0))
        b = bpy.context.active_object
        set_mats(b, [M_BARK_ASH])
        parts.append(b)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rnd.uniform(0.16, 0.24),
                                              location=(math.cos(a) * 0.3, math.sin(a) * 0.3, rnd.uniform(0.45, 0.62)))
        leaf = bpy.context.active_object
        leaf.scale = (1.15, 1.0, 0.62)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        displace(leaf, 600 + i, 0.03)
        idx = set_mats(leaf, [M_LEAF_ASH, M_ASH_DUST])
        for p in leaf.data.polygons:
            p.material_index = idx[M_ASH_DUST.name] if p.normal.z > 0.45 else idx[M_LEAF_ASH.name]
        parts.append(leaf)
    j = join_objs(parts, "ash-shrub")
    finish(j, "ash-shrub")
    RESULTS["ash-shrub"] = export(j, "ash-shrub.glb")

# ------------------------------------------------------------------
# 9. ash grass tuft — dry blades
# ------------------------------------------------------------------
def build_tuft():
    fresh_scene(); ensure_mats()
    parts = []
    rnd = random.Random(18)
    for i in range(12):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.0, 0.16)
        h = rnd.uniform(0.3, 0.48)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.022, radius2=0.002,
                                        depth=h, location=(math.cos(a) * r, math.sin(a) * r, h / 2),
                                        rotation=(rnd.uniform(-0.28, 0.28), rnd.uniform(-0.28, 0.28), rnd.uniform(0, 3)))
        b = bpy.context.active_object
        set_mats(b, [M_GRASS_ASH if i % 3 else M_GRASS_OLIVE])
        parts.append(b)
    j = join_objs(parts, "ash-grass-tuft")
    finish(j, "ash-grass-tuft")
    RESULTS["ash-grass-tuft"] = export(j, "ash-grass-tuft.glb")

for fn in (build_outcrop_l, build_outcrop_s, build_fallen, build_scree,
           build_shelf, build_lava, build_ore, build_shrub, build_tuft):
    fn()
    print("BUILT", fn.__name__)

import json
with open(os.path.join(OUT, "build-results.json"), "w") as f:
    json.dump(RESULTS, f, indent=1)
print(json.dumps(RESULTS, indent=1))
print("ALL DONE")
