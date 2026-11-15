# M3-02 plant assets builder (Muse, 2026-11-15)
# Builds 8 species x 2 silhouette variants, each with display-state node
# groups (standing/stump, full/low, fruit subgroup), LOD0 + LOD1 GLBs and
# editable .blend sources. Flat shared materials only: no texture is
# embedded in any GLB (GPT textures attach later via material slots).
import bpy, math, random, os, json
from mathutils import Vector, Quaternion, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "models")
SOURCE = os.path.join(ROOT, "source")

PALETTE = {
    "bark":        (0.32, 0.22, 0.14, 1),
    "barkDark":    (0.22, 0.15, 0.10, 1),
    "barkLight":   (0.55, 0.42, 0.28, 1),
    "stumpTop":    (0.78, 0.64, 0.44, 1),
    "trunkPine":   (0.42, 0.25, 0.16, 1),
    "leafA":       (0.20, 0.42, 0.16, 1),
    "leafB":       (0.32, 0.55, 0.22, 1),
    "leafDark":    (0.13, 0.30, 0.12, 1),
    "needleA":     (0.14, 0.33, 0.18, 1),
    "needleB":     (0.20, 0.42, 0.22, 1),
    "bambooCulm":  (0.45, 0.58, 0.28, 1),
    "bambooNode":  (0.62, 0.68, 0.40, 1),
    "bambooDry":   (0.72, 0.64, 0.42, 1),
    "bambooLeaf":  (0.24, 0.48, 0.20, 1),
    "stemGreen":   (0.30, 0.48, 0.22, 1),
    "stemDry":     (0.60, 0.52, 0.34, 1),
    "flaxFlower":  (0.55, 0.65, 0.95, 1),
    "podBrown":    (0.45, 0.34, 0.20, 1),
    "cottonWhite": (0.96, 0.95, 0.92, 1),
    "cottonBract": (0.50, 0.38, 0.22, 1),
    "rapeFlower":  (0.98, 0.80, 0.15, 1),
    "rapePod":     (0.42, 0.55, 0.26, 1),
    "reedLeaf":    (0.26, 0.50, 0.24, 1),
    "reedHead":    (0.55, 0.42, 0.26, 1),
    "kouzoLeaf":   (0.24, 0.46, 0.18, 1),
}
M = {}

def setup_materials():
    M.clear()
    for name, col in PALETTE.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.diffuse_color = col
        m.use_nodes = False
        M[name] = m

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    LEAF.clear()
    setup_materials()

def seg(p1, p2, r1, r2, mat, verts=7):
    """Tapered cylinder between two points."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    L = d.length
    if L < 1e-5:
        return None
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2,
                                    depth=L, location=(p1 + p2) / 2)
    o = bpy.context.active_object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.data.materials.append(M[mat])
    return o

def ball(p, r, mat, detail=1, squash=1.0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=detail, radius=r, location=p)
    o = bpy.context.active_object
    o.scale = (1, 1, squash)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(M[mat])
    return o

def leaf_mesh(w=0.055, L=0.30, fold=0.035):
    """One bent leaf: 4 triangles, grows along +Y from origin.
    UVs follow the leaf's own parametrisation (added 2026-11-15, §41):
    u = across the blade (0 at the left edge, 0.5 on the midrib, 1 at the
    right edge), v = along the blade (0 at the petiole, 1 at the tip), so a
    single-leaf texture whose petiole sits at the image bottom maps onto
    every leaf instance unchanged through baking and joining."""
    me = bpy.data.meshes.new("leafGeo")
    hw = w
    verts = [(0, 0, 0), (-hw, L * 0.45, -fold * 0.5), (0, L * 0.52, fold),
             (hw, L * 0.45, -fold * 0.5), (0, L, 0)]
    faces = [(0, 1, 2), (0, 2, 3), (1, 4, 2), (2, 4, 3)]
    me.from_pydata(verts, [], faces)
    me.update()
    vuv = [(0.5, 0.0), (0.0, 0.45), (0.5, 0.52), (1.0, 0.45), (0.5, 1.0)]
    layer = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        layer.data[loop.index].uv = vuv[loop.vertex_index]
    return me

LEAF = {}

def get_leaf(kind, w, L, mat):
    key = (kind, round(w, 3), round(L, 3), mat)
    if key not in LEAF:
        me = leaf_mesh(w, L)
        me.materials.append(M[mat])
        LEAF[key] = me
    return LEAF[key]

def place_leaf(pos, direction, scale, mat, rng, kind="leaf", w=0.055, L=0.30):
    o = bpy.data.objects.new("leaf", get_leaf(kind, w, L, mat))
    bpy.context.collection.objects.link(o)
    d = Vector(direction).normalized()
    q = Vector((0, 1, 0)).rotation_difference(d)
    spin = Quaternion(Vector((0, 1, 0)), rng.uniform(0, math.tau))
    o.matrix_world = Matrix.LocRotScale(Vector(pos), q @ spin,
                                        Vector((scale, scale, scale)))
    return o

def group_root(name, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e

def bake_transform(o):
    """Bake an object's world transform into a private copy of its mesh,
    then reset the transform. Joining pre-baked geometry is exact, unlike
    joining objects whose transforms were assigned via matrix_world."""
    if o.type != 'MESH':
        return
    bpy.context.view_layer.update()
    o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

def finish_group(objs, group, prefix):
    """Join objects of one state group per material, parent under group."""
    for o in objs:
        if o is not None:
            bake_transform(o)
    by_mat = {}
    for o in objs:
        if o is None:
            continue
        key = o.data.materials[0].name if o.data.materials else "none"
        by_mat.setdefault(key, []).append(o)
    out = []
    for mat, lst in by_mat.items():
        if len(lst) > 1:
            bpy.ops.object.select_all(action='DESELECT')
            for o in lst:
                o.select_set(True)
            bpy.context.view_layer.objects.active = lst[0]
            bpy.ops.object.join()
            mesh = lst[0]
        else:
            mesh = lst[0]
        mesh.name = prefix + "_" + mat
        mesh.parent = group
        out.append(mesh)
    return out

def leaf_cluster(objs, center, radius, count, mats, rng, leaf_kw=None,
                 spread=0.85):
    kw = leaf_kw or {}
    for _ in range(count):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1),
                    rng.uniform(-0.4, 1))).normalized()
        pos = Vector(center) + d * radius * rng.uniform(0.25, 1.0)
        out = (pos - Vector(center)).normalized()
        out.z = abs(out.z) * 0.4 + rng.uniform(-0.2, 0.5)
        objs.append(place_leaf(pos, out, rng.uniform(0.8, 1.25),
                               rng.choice(mats), rng, **kw))

def grow_branch(objs, clusters, start, direction, length, radius, depth,
                rng, lod, leaf_mats, branch_mat, leaf_kw=None, droop=0.12):
    """Recursive tapered branch; terminal points collect leaf clusters."""
    d = Vector(direction).normalized()
    mid = Vector(start) + d * (length * 0.55)
    mid.z -= length * droop * 0.4
    end = Vector(start) + d * length
    end.z -= length * droop
    objs.append(seg(start, mid, radius, radius * 0.72, branch_mat,
                    verts=5 if lod else 7))
    objs.append(seg(mid, end, radius * 0.72, radius * 0.45, branch_mat,
                    verts=5 if lod else 7))
    if depth <= 0:
        clusters.append((end, length * 0.75))
        return
    n = 2 if lod else rng.choice((2, 2, 3))
    for _ in range(n):
        nd = d.copy()
        nd.x += rng.uniform(-0.75, 0.75)
        nd.y += rng.uniform(-0.75, 0.75)
        nd.z += rng.uniform(0.05, 0.55)
        grow_branch(objs, clusters, end, nd, length * rng.uniform(0.58, 0.72),
                    radius * 0.55, depth - 1, rng, lod, leaf_mats,
                    branch_mat, leaf_kw, droop)
    if rng.random() < 0.85:
        clusters.append((end, length * 0.55))

def make_stump(rng, radius=0.30, height=0.38, bark="bark"):
    objs = []
    objs.append(seg((0, 0, 0), (0.02, 0, height), radius, radius * 0.88, bark,
                    verts=9))
    bpy.ops.mesh.primitive_cylinder_add(vertices=9, radius=radius * 0.86,
                                        depth=0.03, location=(0.02, 0, height + 0.005))
    top = bpy.context.active_object
    top.data.materials.append(M["stumpTop"])
    objs.append(top)
    for i in range(5):
        a = i / 5 * math.tau + rng.uniform(-0.2, 0.2)
        p = Vector((math.cos(a), math.sin(a), 0))
        objs.append(seg(p * radius * 0.6 + Vector((0, 0, 0.10)),
                        p * (radius + 0.22) + Vector((0, 0, -0.02)),
                        radius * 0.34, radius * 0.10, bark, verts=5))
    return objs

def build_tree(rng, lod, height, spread, trunk_r, leaf_mats, bark="bark",
               leaf_kw=None, fibre=False, lean=0.0):
    """Branching broadleaf-type tree. Returns (standing_objs, params)."""
    objs, clusters = [], []
    base = Vector((0, 0, 0))
    d = Vector((lean, 0, 1)).normalized()
    p1 = base + d * (height * 0.46)
    p1b = base + d * (height * 0.38)
    p2 = base + d * (height * 0.62) + Vector((rng.uniform(-0.15, 0.15),
                                              rng.uniform(-0.15, 0.15), 0))
    objs.append(seg(base, p1, trunk_r, trunk_r * 0.74, bark, verts=7 if not lod else 6))
    objs.append(seg(p1b, p2, trunk_r * 0.76, trunk_r * 0.5, bark, verts=7 if not lod else 6))
    for i in range(5):  # root flare so the base never floats
        a = i / 5 * math.tau + rng.uniform(-0.25, 0.25)
        pv = Vector((math.cos(a), math.sin(a), 0))
        objs.append(seg(pv * trunk_r * 0.55 + Vector((0, 0, 0.14)),
                        pv * (trunk_r + 0.26) + Vector((0, 0, -0.02)),
                        trunk_r * 0.36, trunk_r * 0.10, bark, verts=5))
    if fibre:  # kouzo: pale fibrous strips running up the trunk
        for i in range(6):
            a = i / 6 * math.tau + 0.3
            off = Vector((math.cos(a), math.sin(a), 0)) * (trunk_r + 0.008)
            objs.append(seg(base + off + Vector((0, 0, 0.05)),
                            p1 + off * 0.72, 0.016, 0.012, "barkLight", verts=4))
    n_main = 4 if lod else 5
    for i in range(n_main):
        a = i / n_main * math.tau + rng.uniform(-0.4, 0.4)
        bd = Vector((math.cos(a) * spread, math.sin(a) * spread,
                     rng.uniform(0.55, 0.95))).normalized()
        grow_branch(objs, clusters, p2, bd,
                    height * rng.uniform(0.30, 0.40), trunk_r * 0.42,
                    1 if lod else 2, rng, lod, leaf_mats, bark, leaf_kw)
    # one leader continuing upward
    grow_branch(objs, clusters, p2, Vector((rng.uniform(-0.2, 0.2),
                                            rng.uniform(-0.2, 0.2), 1)),
                height * 0.34, trunk_r * 0.40, 1 if lod else 2, rng, lod,
                leaf_mats, bark, leaf_kw)
    per = 14 if lod else 36
    for c, r in clusters:
        leaf_cluster(objs, c, max(0.38, r * 0.60), per, leaf_mats, rng, leaf_kw)
    return objs

def needle_cluster(objs, center, radius, count, rng):
    """Pine foliage: a dark core mass plus many thin drooping needle cards."""
    objs.append(ball(Vector(center), radius * 0.52, "needleA", detail=0,
                     squash=0.55))
    for _ in range(count):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1),
                    rng.uniform(-0.85, -0.15))).normalized()
        pos = Vector(center) + Vector((rng.uniform(-radius, radius) * 0.8,
                                       rng.uniform(-radius, radius) * 0.8,
                                       rng.uniform(-radius * 0.3, radius * 0.3)))
        objs.append(place_leaf(pos, d, rng.uniform(0.85, 1.2),
                               rng.choice(("needleA", "needleB")), rng,
                               w=0.016, L=0.46))

def build_pine(rng, lod, height=5.6, trunk_r=0.24, lean=0.06, bare_side=False):
    objs = []
    d = Vector((lean, 0, 1)).normalized()
    top = d * height
    mid = d * (height * 0.5)
    objs.append(seg((0, 0, 0), mid, trunk_r, trunk_r * 0.62, "trunkPine", verts=7))
    objs.append(seg(mid, top, trunk_r * 0.62, trunk_r * 0.16, "trunkPine", verts=7))
    for i in range(5):
        a = i / 5 * math.tau + rng.uniform(-0.25, 0.25)
        pv = Vector((math.cos(a), math.sin(a), 0))
        objs.append(seg(pv * trunk_r * 0.55 + Vector((0, 0, 0.13)),
                        pv * (trunk_r + 0.24) + Vector((0, 0, -0.02)),
                        trunk_r * 0.34, trunk_r * 0.09, "trunkPine", verts=5))
    levels = 4 if lod else 6
    for li in range(levels):
        t = 0.30 + 0.68 * li / max(1, levels - 1)
        c = d * (height * t)
        blen = (1 - t * 0.72) * height * 0.30
        nb = 3 if lod else rng.choice((3, 4))
        for bi in range(nb):
            a = li * 1.7 + bi / nb * math.tau + rng.uniform(-0.3, 0.3)
            if bare_side and math.cos(a) > 0.55 and li < levels - 1:
                continue  # irregular bare side (wind-shaped silhouette)
            bd = Vector((math.cos(a), math.sin(a), rng.uniform(-0.30, -0.08)))
            end = c + bd.normalized() * blen
            objs.append(seg(c, end, 0.065, 0.024, "barkDark", verts=5))
            needle_cluster(objs, end + Vector((0, 0, -0.05)),
                           blen * 0.34, 7 if lod else 13, rng)
            if rng.random() < 0.6:
                needle_cluster(objs, c + bd.normalized() * blen * 0.55,
                               blen * 0.22, 5 if lod else 8, rng)
    if rng.random() < 0.9:  # broken stub for silhouette irregularity
        c = d * (height * 0.45)
        objs.append(seg(c, c + Vector((0.5, 0.15, -0.05)), 0.045, 0.012,
                        "barkDark", verts=5))
    needle_cluster(objs, top, 0.34, 8 if lod else 14, rng)
    return objs

def build_bamboo(rng, lod, height=6.2, culms=7, cut=False):
    full, cut_objs = [], []
    positions = []
    for i in range(culms):
        a = i / culms * math.tau + rng.uniform(-0.3, 0.3)
        rr = 0.18 if i == 0 else rng.uniform(0.35, 0.95)
        positions.append(Vector((math.cos(a) * rr, math.sin(a) * rr, 0)))
    for idx, base in enumerate(positions):
        h = height * rng.uniform(0.82, 1.05)
        lean = Vector((base.x, base.y, 0)) * rng.uniform(0.05, 0.16)
        r = rng.uniform(0.045, 0.068)
        mat = "bambooDry" if (idx == culms - 1 and culms > 5) else "bambooCulm"
        if cut:
            cut_objs.append(seg(base, base + Vector((0, 0, rng.uniform(0.5, 0.9))),
                                r, r * 0.92, mat, verts=7))
            continue
        seg_h, y = 0.55, 0.0
        while y < h:
            p1 = base + lean * (y / h) + Vector((0, 0, y))
            p2 = base + lean * ((y + seg_h) / h) + Vector((0, 0, y + seg_h))
            full.append(seg(p1, p2, r, r * 0.96, mat, verts=7))
            full.append(seg(p2 + Vector((0, 0, -0.02)), p2 + Vector((0, 0, 0.02)),
                            r * 1.14, r * 1.14, "bambooNode", verts=7))
            y += seg_h
        top = base + lean + Vector((0, 0, h))
        nb = 3 if lod else 4
        for b in range(nb + 1):
            a = rng.uniform(0, math.tau)
            bd = Vector((math.cos(a), math.sin(a), rng.uniform(0.1, 0.5)))
            bp = top - Vector((0, 0, b * 0.55))
            bend = bp + bd.normalized() * rng.uniform(0.5, 0.8)
            full.append(seg(bp, bend, 0.016, 0.008, "bambooCulm", verts=5))
            nl = 7 if lod else 12
            for _ in range(nl):
                lp = bend + Vector((rng.uniform(-0.3, 0.3),
                                    rng.uniform(-0.3, 0.3), rng.uniform(-0.15, 0.2)))
                ld = bd + Vector((0, 0, rng.uniform(-0.55, -0.1)))
                full.append(place_leaf(lp, ld, rng.uniform(0.9, 1.3),
                                       "bambooLeaf", rng, w=0.020, L=0.52))
    if cut:
        for _ in range(5 if lod else 10):
            p = Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0.02))
            full.append(place_leaf(p, (rng.uniform(-1, 1), rng.uniform(-1, 1), 0.5),
                                   0.7, "bambooLeaf", rng, w=0.020, L=0.52))
    return (cut_objs + full) if cut else full

def build_reed(rng, lod, height=1.8, cut=False):
    objs = []
    n = 7 if lod else 13
    for i in range(n):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.05, 0.55)
        base = Vector((math.cos(a) * rr, math.sin(a) * rr, 0))
        h = height * rng.uniform(0.8, 1.1) * (0.25 if cut else 1.0)
        tip = base + Vector((rng.uniform(-0.22, 0.22), rng.uniform(-0.22, 0.22), h))
        mid = base + (tip - base) * 0.5 + Vector((0, 0, 0.02))
        objs.append(seg(base, mid, 0.016, 0.010, "stemGreen", verts=5))
        objs.append(seg(mid, tip, 0.010, 0.004, "stemGreen", verts=5))
        for s in (-1, 1):
            ld = Vector((tip.x - base.x, tip.y - base.y, 0)).normalized()
            side = Vector((-ld.y, ld.x, 0)) * s
            objs.append(place_leaf(base + Vector((0, 0, 0.03)),
                                   side + Vector((0, 0, 0.95)), rng.uniform(0.85, 1.15),
                                   "reedLeaf", rng, w=0.026, L=0.72))
        if not cut and i % 2 == 0:
            hp = tip + Vector((0, 0, 0.10))
            objs.append(seg(tip, hp + Vector((0, 0, 0.16)), 0.030, 0.012,
                            "reedHead", verts=6))
    return objs

def herb_low(rng, lod, leaf_mat, leaf_kw, spread=0.4):
    objs = []
    for _ in range(4 if lod else 7):
        p = Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread), 0))
        objs.append(seg(p, p + Vector((0, 0, rng.uniform(0.10, 0.22))), 0.012,
                        0.008, "stemDry", verts=5))
        objs.append(place_leaf(p + Vector((0, 0, 0.02)),
                               (rng.uniform(-1, 1), rng.uniform(-1, 1), 0.6),
                               0.75, leaf_mat, rng, **leaf_kw))
    return objs

def build_herb(rng, lod, species, height, stems, leaf_mat, leaf_kw, spread=0.42):
    full, fruit = [], []
    for s in range(stems):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.0, spread)
        base = Vector((math.cos(a) * rr, math.sin(a) * rr, 0))
        h = height * rng.uniform(0.85, 1.1)
        sway = Vector((rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09), 0))
        mid = base + sway * 0.5 + Vector((0, 0, h * 0.55))
        top = base + sway + Vector((0, 0, h))
        full.append(seg(base, mid, 0.017, 0.012, "stemGreen", verts=5))
        full.append(seg(mid, top, 0.012, 0.006, "stemGreen", verts=5))
        nl = 3 if lod else 5
        for li in range(nl):
            t = 0.20 + 0.75 * li / max(1, nl)
            lp = base + (top - base) * t
            full.append(place_leaf(lp, (rng.uniform(-1, 1), rng.uniform(-1, 1), 0.35),
                                   rng.uniform(0.8, 1.1), leaf_mat, rng, **leaf_kw))
        if species == "flax":
            for k in range(5):  # small 5-petal flower at the tip
                pa = k / 5 * math.tau
                fruit.append(place_leaf(top, (math.cos(pa), math.sin(pa), 0.55),
                                        0.55, "flaxFlower", rng, w=0.032, L=0.13))
            fruit.append(ball(top + Vector((0, 0, 0.015)), 0.017, "flaxFlower", detail=0))
            fruit.append(ball(top + Vector((0, 0, -0.05)), 0.020, "podBrown", detail=0))
            fruit.append(ball(mid + Vector((0.03, 0, 0.05)), 0.018, "podBrown", detail=0))
        elif species == "cotton":
            if s % 2 == 0:
                bp = mid + Vector((rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0.04))
                fruit.append(ball(bp, 0.062, "cottonWhite", detail=1, squash=0.85))
                for k in range(3):
                    pa = k / 3 * math.tau
                    fruit.append(seg(bp + Vector((0, 0, -0.03)),
                                     bp + Vector((math.cos(pa) * 0.05, math.sin(pa) * 0.05, -0.055)),
                                     0.012, 0.002, "cottonBract", verts=4))
            else:
                fruit.append(ball(top + Vector((0, 0, -0.03)), 0.030, "cottonBract",
                                  detail=0, squash=0.8))  # unopened bud
        elif species == "rapeseed":
            for _ in range(3 if lod else 6):
                fp = top + Vector((rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09),
                                   rng.uniform(-0.05, 0.09)))
                fruit.append(ball(fp, 0.021, "rapeFlower", detail=0))
            for _ in range(2 if lod else 3):
                pp = mid + Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0.02))
                fruit.append(seg(pp, pp + Vector((0.02, 0, -0.13)), 0.011, 0.003,
                                 "rapePod", verts=5))
    return full, fruit

SUMMARY = {}

def export_glb(root, path):
    bpy.ops.object.select_all(action='DESELECT')
    def rec(o):
        o.select_set(True)
        for c in o.children:
            rec(c)
    rec(root)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True)

def measure_dims():
    xs, ys, zs = [], [], []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                xs.append(w.x); ys.append(w.y); zs.append(w.z)
    if not xs:
        return (0, 0, 0)
    return (round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2),
            round(max(zs) - min(zs), 2))

def assemble(asset, lod, kind, build):
    bpy.context.view_layer.update()
    root = group_root(asset)
    if kind == "tree":
        st = group_root("state_standing", root)
        finish_group(build["standing"], st, asset + "_standing")
        sp = group_root("state_stump", root)
        finish_group(build["stump"], sp, asset + "_stump")
    elif kind == "herb":
        fu = group_root("state_full", root)
        finish_group(build["full"], fu, asset + "_full")
        fr = group_root("parts_fruit", fu)
        finish_group(build["fruit"], fr, asset + "_fruit")
        lo = group_root("state_low", root)
        finish_group(build["low"], lo, asset + "_low")
    else:  # clump: bamboo / reed
        fu = group_root("state_full", root)
        finish_group(build["full"], fu, asset + "_full")
        cu = group_root("state_cut", root)
        finish_group(build["cut"], cu, asset + "_cut")
    return root

def run_variant(asset, kind, seed, make):
    for lod in (0, 1):
        clear_scene()
        rng = random.Random(seed)
        build = make(rng, lod)
        root = assemble(asset, lod, kind, build)
        if lod == 0:
            SUMMARY[asset] = {"dims": measure_dims()}
            bpy.ops.wm.save_as_mainfile(
                filepath=os.path.join(SOURCE, asset + ".blend"))
            export_glb(root, os.path.join(MODELS, asset + ".glb"))
        else:
            export_glb(root, os.path.join(MODELS, asset + "_lod1.glb"))
    print("built", asset)

def make_tree(height, spread, trunk_r, leaf_mats, bark="bark", leaf_kw=None,
              fibre=False, lean=0.0, stump_r=0.30):
    def make(rng, lod):
        standing = build_tree(rng, lod, height=height, spread=spread,
                              trunk_r=trunk_r, leaf_mats=leaf_mats, bark=bark,
                              leaf_kw=leaf_kw, fibre=fibre, lean=lean)
        stump = make_stump(rng, radius=stump_r, bark=bark)
        return {"standing": standing, "stump": stump}
    return make

def make_pine(height, lean, bare):
    def make(rng, lod):
        standing = build_pine(rng, lod, height=height, lean=lean, bare_side=bare)
        stump = make_stump(rng, radius=0.24, bark="trunkPine")
        return {"standing": standing, "stump": stump}
    return make

def make_bamboo(height, culms):
    def make(rng, lod):
        return {"full": build_bamboo(rng, lod, height=height, culms=culms),
                "cut": build_bamboo(rng, lod, height=height, culms=culms, cut=True)}
    return make

def make_reed(height):
    def make(rng, lod):
        return {"full": build_reed(rng, lod, height=height),
                "cut": build_reed(rng, lod, height=height, cut=True)}
    return make

def make_herb(species, height, stems, leaf_mat, leaf_kw):
    def make(rng, lod):
        full, fruit = build_herb(rng, lod, species, height, stems, leaf_mat, leaf_kw)
        low = herb_low(rng, lod, leaf_mat, leaf_kw)
        return {"full": full, "fruit": fruit, "low": low}
    return make

LEAF_STD = {"w": 0.070, "L": 0.38}
VARIANTS = [
    ("plant-broadleaf-a", "tree", 1101, make_tree(5.2, 1.00, 0.30, ["leafA", "leafB", "leafDark"], leaf_kw=LEAF_STD)),
    ("plant-broadleaf-b", "tree", 1102, make_tree(5.9, 0.60, 0.27, ["leafA", "leafB"], leaf_kw=LEAF_STD, lean=0.05)),
    ("plant-pine-a", "tree", 1201, make_pine(5.6, 0.05, False)),
    ("plant-pine-b", "tree", 1202, make_pine(6.4, 0.13, True)),
    ("plant-kouzo-a", "tree", 1301, make_tree(4.2, 1.05, 0.24, ["kouzoLeaf", "leafA"], leaf_kw={"w": 0.098, "L": 0.42}, fibre=True, stump_r=0.24)),
    ("plant-kouzo-b", "tree", 1302, make_tree(3.7, 0.78, 0.21, ["kouzoLeaf", "leafB"], leaf_kw={"w": 0.098, "L": 0.42}, fibre=True, lean=0.07, stump_r=0.21)),
    ("plant-bamboo-a", "clump", 1401, make_bamboo(6.4, 8)),
    ("plant-bamboo-b", "clump", 1402, make_bamboo(5.1, 5)),
    ("plant-flax-a", "herb", 1501, make_herb("flax", 0.95, 7, "leafA", {"w": 0.028, "L": 0.20})),
    ("plant-flax-b", "herb", 1502, make_herb("flax", 1.08, 6, "leafB", {"w": 0.028, "L": 0.20})),
    ("plant-cotton-a", "herb", 1601, make_herb("cotton", 1.05, 6, "leafA", {"w": 0.095, "L": 0.24})),
    ("plant-cotton-b", "herb", 1602, make_herb("cotton", 0.92, 7, "leafB", {"w": 0.095, "L": 0.24})),
    ("plant-rapeseed-a", "herb", 1701, make_herb("rapeseed", 1.22, 6, "leafB", {"w": 0.05, "L": 0.26})),
    ("plant-rapeseed-b", "herb", 1702, make_herb("rapeseed", 1.05, 7, "leafA", {"w": 0.05, "L": 0.26})),
    ("plant-reed-a", "clump", 1801, make_reed(1.95)),
    ("plant-reed-b", "clump", 1802, make_reed(1.55)),
]

def main():
    only = os.environ.get("PLANTS_ONLY", "")
    variants = VARIANTS
    if only:
        keys = only.split(",")
        variants = [v for v in VARIANTS if any(k in v[0] for k in keys)]
    for asset, kind, seed, make in variants:
        run_variant(asset, kind, seed, make)
    if not only:
        with open(os.path.join(ROOT, "tools", "build-summary.json"), "w") as f:
            json.dump(SUMMARY, f, indent=1)
    print("ALL DONE", len(variants))

if __name__ == "__main__":
    main()
