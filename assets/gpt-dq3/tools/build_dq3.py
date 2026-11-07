#!/usr/bin/env python3
"""Build the DQ3-density asset set as GLB models (round 19).

Reuses the buildings pipeline helpers/materials (build_buildings.py)
so models share the game's material language and conventions:
origin at ground centre, front = three.js +Z (Blender -Y),
ContactShadow plane included, per-face world-scale UVs.

Deliverables (models/): 3 broadleaf tree archetypes built from real
branch structure + role-assigned leaf cards (bright top / deep inner /
droop edge / light tips — never a ball canopy with cards pasted on),
a town hut (3D timber over separated plaster, shaped tile roof with
ridge + eave tile row, geometry window), a circular plaza whose ring
UVs follow the arc-slab strip texture, town props, nature models and
3 basalt shapes from the GPT references.
"""
import importlib.util, json, math, random, sys
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location(
    "bb", ROOT.parent / "buildings-3d" / "tools" / "build_buildings.py")
bb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bb)
M = bb.M
box, cyl, cone, dome, torus, pipe = bb.box, bb.cyl, bb.cone, bb.dome, bb.torus, bb.pipe
root, contact_shadow, _finish = bb.root, bb.contact_shadow, bb._finish
ORIG_TEX = bb.TEX
GROUND_DIR = ROOT / "ground"
SPRAYS_DIR = ROOT / "sprays"

# ---------------- materials ----------------

def dq_materials():
    if "dqRoof" in M:
        return
    bb.TEX = GROUND_DIR
    M["dqRoof"] = bb.mat("dqRoof", "roof-orange.png", nrm="roof-orange_n.png", tile=2.6, rough=0.9)
    M["dqPlaster"] = bb.mat("dqPlaster", "wall-plaster.png", tile=1.5, rough=0.95)
    M["dqStone"] = bb.mat("dqStone", "stone-wall.png", nrm="stone-wall_n.png", tile=2.3, rough=0.95)
    M["dqPlank"] = bb.mat("dqPlank", "plank.png", tile=1.9, rough=0.92)
    M["dqCobble"] = bb.mat("dqCobble", "town-cobble.png", nrm="town-cobble_n.png", tile=3.4, rough=0.95)
    M["dqPlaza"] = bb.mat("dqPlaza", "town-plaza-strip.png", rough=0.95)
    M["dqRings"] = bb.mat("dqRings", "rings.png", rough=0.9)
    M["dqTimber"] = bb.mat("dqTimber", color=(0.30, 0.20, 0.12), rough=0.95)
    M["dqBasalt"] = bb.mat("dqBasalt", color=(0.055, 0.050, 0.052), rough=1.0)
    M["dqRockGrey"] = bb.mat("dqRockGrey", color=(0.46, 0.45, 0.42), rough=1.0)
    M["dqIron"] = bb.mat("dqIron", color=(0.16, 0.15, 0.15), rough=0.55, metal=0.6)
    M["dqGlass"] = bb.mat("dqGlass", color=(0.10, 0.17, 0.19), rough=0.25, metal=0.1)
    M["dqClothRed"] = bb.mat("dqClothRed", color=(0.60, 0.15, 0.11), rough=1.0)
    M["dqClothGreen"] = bb.mat("dqClothGreen", color=(0.24, 0.44, 0.17), rough=1.0)
    M["dqClothCream"] = bb.mat("dqClothCream", color=(0.88, 0.83, 0.70), rough=1.0)
    M["dqFruit"] = bb.mat("dqFruit", color=(0.86, 0.46, 0.08), rough=0.55)
    M["dqSoil"] = bb.mat("dqSoil", color=(0.23, 0.16, 0.10), rough=1.0)
    M["dqClay"] = bb.mat("dqClay", "plank.png", tint=(1.15, 0.62, 0.42), tile=0.9, rough=0.9)
    bb.TEX = SPRAYS_DIR
    M["cardBright"] = bb.alpha_mat("cardBright", "broadleaf-bright.png", clip=0.45)
    M["cardDroop"] = bb.alpha_mat("cardDroop", "broadleaf-droop.png", clip=0.45)
    M["cardDeep"] = bb.alpha_mat("cardDeep", "broadleaf-deep.png", clip=0.45)
    M["cardLight"] = bb.alpha_mat("cardLight", "broadleaf-light.png", clip=0.45)
    M["cardFlower"] = bb.alpha_mat("cardFlower", "flower-branch.png", clip=0.45)
    M["cardRound"] = bb.alpha_mat("cardRound", "roundleaf-bush.png", clip=0.45)
    M["cardVine"] = bb.alpha_mat("cardVine", "vine.png", clip=0.45)
    M["cardWhite"] = bb.alpha_mat("cardWhite", "flower-white.png", clip=0.45)
    M["cardPink"] = bb.alpha_mat("cardPink", "flower-pink.png", clip=0.45)
    bb.TEX = ORIG_TEX

# ---------------- small helpers ----------------

def sph(name, loc, r, material, scale=(1, 1, 1), parent=None):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=2, location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    _finish(o, material, 0, parent)
    return o

def card(parent, loc, w, h, material, rot=(0, 0, 0)):
    """A leaf card: two crossed planes so the cluster reads from
    every azimuth (360-degree camera)."""
    g = bpy.data.objects.new("card", None)
    bpy.context.collection.objects.link(g)
    g.parent = parent
    g.location = loc
    g.rotation_euler = rot
    for i, yaw in enumerate((0.0, 1.15)):
        bpy.ops.mesh.primitive_plane_add(size=1)
        o = bpy.context.object
        o.name = "leafcard"
        o.scale = (w, h, 1)
        o.rotation_euler = (0, 0, yaw)
        # plane's local +Z is its normal; tilt the pair slightly
        o.rotation_euler = (math.radians(90), 0, yaw)
        _finish(o, material, 0, g)
        o.location = (0, 0, 0)
    return g

def lathe(name, profile, material, parent=None, segments=16, uv_tile=None):
    """profile: list of (radius, z). Builds a surface of revolution
    with per-profile UVs (u around, v along the profile)."""
    import mathutils
    verts, faces, uvs = [], [], []
    n = len(profile)
    for j, (r, z) in enumerate(profile):
        for i in range(segments):
            a = 2 * math.pi * i / segments
            verts.append((r * math.cos(a), r * math.sin(a), z))
            uvs.append((i / segments * (uv_tile or 1), j / (n - 1)))
    for j in range(n - 1):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            c = a + segments
            d = b + segments
            faces.append((a, b, d, c))  # outward winding
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UV")
    for loop, uvco in zip(mesh.loops, [uvs[f] for f in
                                       [idx for face in faces for idx in face]]):
        pass
    # simpler: rebuild loop UVs from vertex order per face
    k = 0
    for face in faces:
        for vi in face:
            uv.data[k].uv = uvs[vi]
            k += 1
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for p in mesh.polygons:
        p.use_smooth = True
    _finish(obj, material, 0, parent)
    return obj

def jitter(obj, amp, seed):
    rng = random.Random(seed)
    for v in obj.data.vertices:
        v.co.x += rng.uniform(-amp, amp)
        v.co.y += rng.uniform(-amp, amp)
        v.co.z += rng.uniform(-amp, amp) * 0.7
    for p in obj.data.polygons:
        p.use_smooth = False

# ---------------- broadleaf trees ----------------

def build_tree(kind):
    """kind: 'round' | 'tall' | 'young'. Trunk spine with natural
    taper, main branches as pipes, leaf cards assigned by role:
    deep inside/under, bright on top, droop at the low rim, light
    small cards at the tips. Canopy keeps real gaps."""
    rng = random.Random({"round": 11, "tall": 23, "young": 37}[kind])
    g = root(f"tree-broadleaf-{kind}")
    if kind == "round":
        spine = [(0, 0, 0, 0.37), (0.05, 0.01, 0.9, 0.28), (-0.05, 0.03, 1.7, 0.20), (0.04, 0, 2.25, 0.12)]
        anchors = [(-1.15, 0.3, 2.6), (1.05, -0.5, 2.75), (0.2, 1.05, 2.9), (-0.6, -1.0, 2.65),
                   (0.75, 0.75, 3.15), (-0.25, -0.2, 3.45), (0, 0.1, 2.35)]
        card_w, card_n = 1.55, 3
    elif kind == "tall":
        spine = [(0, 0, 0, 0.33), (-0.04, 0.02, 1.1, 0.25), (0.05, -0.02, 2.2, 0.17), (0, 0.03, 3.0, 0.11)]
        anchors = [(-0.8, 0.2, 3.3), (0.85, -0.3, 3.45), (0.1, 0.8, 3.7), (-0.4, -0.75, 3.35),
                   (0.45, 0.45, 4.0), (0, 0, 4.35), (0.1, -0.1, 3.05)]
        card_w, card_n = 1.35, 3
    else:
        spine = [(0, 0, 0, 0.20), (0.03, 0, 0.7, 0.15), (-0.02, 0.02, 1.3, 0.10)]
        anchors = [(-0.6, 0.25, 1.75), (0.6, -0.2, 1.85), (0, 0.55, 2.0), (-0.15, -0.5, 1.7), (0.1, 0, 2.25)]
        card_w, card_n = 1.0, 2
    # root flare
    cone("flare", (0, 0, 0.16), 0.55, 0.34, M["bark"], verts=10, parent=g)
    # trunk from spine rings
    verts, faces = [], []
    SEG = 9
    for (x, y, z, r) in spine:
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            jr = r * (1 + rng.uniform(-0.07, 0.07))
            verts.append((x + jr * math.cos(a), y + jr * math.sin(a), z))
    for j in range(len(spine) - 1):
        for i in range(SEG):
            a = j * SEG + i; b = j * SEG + (i + 1) % SEG
            faces.append((a, b, b + SEG, a + SEG))
    mesh = bpy.data.meshes.new("trunk")
    mesh.from_pydata(verts, [], faces); mesh.update()
    uv = mesh.uv_layers.new(name="UV")
    k = 0
    for face in faces:
        for vi in face:
            ring = vi // SEG
            uv.data[k].uv = ((vi % SEG) / SEG * 2.2, spine[ring][2] / 2.2)
            k += 1
    trunk = bpy.data.objects.new("trunk", mesh)
    bpy.context.collection.objects.link(trunk)
    _finish(trunk, M["bark"], 0, g)
    # branches + cards
    top = spine[-1]
    for idx, (ax, ay, az) in enumerate(anchors):
        base = spine[min(len(spine) - 1, 1 + idx % (len(spine) - 1))]
        pipe("branch", (base[0], base[1], base[2] + 0.25), (ax * 0.82, ay * 0.82, az - 0.28),
             0.055 if kind != "young" else 0.04, M["bark"], parent=g, verts=8)
        rel_y = az - (top[2] + 0.6)
        for c in range(card_n):
            t = c / max(card_n - 1, 1)
            px = ax * (0.55 + 0.45 * t) + rng.uniform(-0.14, 0.14)
            py = ay * (0.55 + 0.45 * t) + rng.uniform(-0.14, 0.14)
            pz = az - 0.25 + 0.5 * t + rng.uniform(-0.1, 0.12)
            rim = math.hypot(px, py) > (1.05 if kind != "young" else 0.55)
            if c == 0:
                mat_c = M["cardDeep"]
            elif rim and t > 0.6:
                mat_c = M["cardDroop"]
            elif c == card_n - 1 and rng.random() < 0.6:
                mat_c = M["cardLight"]
            else:
                mat_c = M["cardBright"]
            w = card_w * rng.uniform(0.8, 1.12) * (0.8 if mat_c is M["cardLight"] else 1)
            card(g, (px, py, pz), w, w * 0.82, mat_c,
                 rot=(rng.uniform(-0.25, 0.25), rng.uniform(-0.2, 0.2), rng.uniform(0, 3.1)))
    contact_shadow(g, 3.4 if kind != "young" else 2.2, 3.4 if kind != "young" else 2.2)
    return g

# ---------------- town hut ----------------

def build_hut_town():
    """Developed-town hut: stone foundation, plaster walls with REAL
    3D timber (posts/beams proud of the wall, plaster texture itself
    carries no beams), plank gables, shaped tile roof (thick slabs,
    ridge roll, eave tile-end row), geometry door and window."""
    g = root("hut-town")
    # foundation + floor step
    box("found", (0, 0, 0.24), (3.8, 3.2, 0.48), M["dqStone"], parent=g, uv="face", bevel=0.02)
    box("step", (0, -1.85, 0.12), (1.1, 0.5, 0.24), M["dqStone"], parent=g, uv="face")
    # walls (plaster only)
    box("walls", (0, 0, 1.42), (3.3, 2.7, 1.9), M["dqPlaster"], parent=g, uv="face", bevel=0.01)
    # timber frame: corner posts, plates, mid rails, front studs
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("post", (sx * 1.58, sy * 1.28, 1.42), (0.2, 0.2, 1.94), M["dqTimber"], parent=g, bevel=0.01)
    for sy in (-1, 1):
        box("plate", (0, sy * 1.30, 2.38), (3.42, 0.18, 0.2), M["dqTimber"], parent=g)
        box("rail", (0, sy * 1.31, 1.40), (3.42, 0.15, 0.16), M["dqTimber"], parent=g)
    for sx in (-1, 1):
        box("plateS", (sx * 1.60, 0, 2.38), (0.18, 2.74, 0.2), M["dqTimber"], parent=g)
    for x in (-0.55, 0.62):
        box("stud", (x, -1.315, 1.42), (0.15, 0.1, 1.9), M["dqTimber"], parent=g)
    # door (front, -Y) with frame
    box("door", (0.05, -1.36, 1.28), (0.92, 0.07, 1.56), M["dqPlank"], parent=g, uv="face")
    box("lintel", (0.05, -1.38, 2.12), (1.1, 0.1, 0.16), M["dqTimber"], parent=g)
    sph("knob", (0.38, -1.42, 1.28), 0.045, M["dqIron"], parent=g)
    # window: frame + recessed glass + mullions (front-right bay)
    wx, wy = -1.02, -1.36
    box("winframe", (wx, wy, 1.62), (0.78, 0.09, 0.86), M["dqTimber"], parent=g)
    box("winglass", (wx, wy - 0.01, 1.62), (0.62, 0.05, 0.70), M["dqGlass"], parent=g)
    box("mullV", (wx, wy - 0.045, 1.62), (0.05, 0.03, 0.70), M["dqTimber"], parent=g)
    box("mullH", (wx, wy - 0.045, 1.62), (0.62, 0.03, 0.05), M["dqTimber"], parent=g)
    # gables (plank triangles)
    for sy in (-1, 1):
        verts = [(-1.65, sy * 1.35, 2.37), (1.65, sy * 1.35, 2.37), (0, sy * 1.35, 3.34)]
        mesh = bpy.data.meshes.new("gable")
        mesh.from_pydata(verts, [], [(0, 1, 2)]); mesh.update()
        uv = mesh.uv_layers.new(name="UV")
        for i, l in enumerate(uv.data):
            l.uv = ((verts[i][0] + 1.65) / 3.3 * 1.7, (verts[i][2] - 2.37) / 1.9)
        tri = bpy.data.objects.new("gable", mesh)
        bpy.context.collection.objects.link(tri)
        _finish(tri, M["dqPlank"], 0, g)
        # give the gable thickness with a slightly inset twin
        verts2 = [(x, sy * 1.35 - sy * 0.07, z) for (x, _, z) in verts]
        mesh2 = bpy.data.meshes.new("gable2")
        mesh2.from_pydata(verts2, [], [(0, 2, 1)]); mesh2.update()
        tri2 = bpy.data.objects.new("gable", mesh2)
        bpy.context.collection.objects.link(tri2)
        _finish(tri2, M["dqPlank"], 0, g)
    # roof: two thick slabs, tile rows running down-slope
    for s in (-1, 1):
        slab = box("roof", (0, s * 0.925, 2.885), (4.15, 2.15, 0.13), M["dqRoof"],
                   rot=(s * 0.524, 0, 0), parent=g, uv="face", bevel=0.01)
    # ridge roll
    cyl("ridge", (0, 0, 3.42), 0.10, 4.2, M["dqRoof"], verts=10, rot=(0, math.radians(90), 0), parent=g)
    # eave tile ends: a row of half-round tile tips along both eaves
    for s in (-1, 1):
        for i in range(13):
            x = -1.92 + i * 0.32
            cyl("eavetile", (x, s * 1.88, 2.36), 0.075, 0.30, M["dqRoof"], verts=8,
                rot=(math.radians(90) - s * 0.524, 0, 0), parent=g)
    contact_shadow(g, 4.6, 4.0)
    return g

# ---------------- circular plaza ----------------

def _ring(name, r_in, r_out, y, u_rep, material, parent, seg=56):
    verts, faces, uvs = [], [], []
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        for r, v in ((r_in, 0.0), (r_out, 1.0)):
            verts.append((r * math.cos(a), r * math.sin(a), y))
            uvs.append((i / seg * u_rep, v))
    for i in range(seg):
        a = i * 2; b = a + 1; c = a + 2; d = a + 3
        faces.append((a, b, d, c))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces); mesh.update()
    uv = mesh.uv_layers.new(name="UV")
    k = 0
    for face in faces:
        for vi in face:
            uv.data[k].uv = uvs[vi]; k += 1
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    _finish(obj, material, 0, parent)
    return obj

def build_plaza():
    """Concentric plaza: centre medallion + 3 arc-slab rings whose
    U wraps the strip texture around the circle (u = angle), so the
    slabs follow the rings instead of repeating as a flat grid."""
    g = root("plaza")
    # centre disc with radial UV into the strip's mid band
    seg = 48
    verts = [(0, 0, 0.055)]
    uvs = [(0.5, 0.5)]
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        verts.append((1.25 * math.cos(a), 1.25 * math.sin(a), 0.055))
        uvs.append((0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a)))
    faces = [(0, i + 1, i + 2) for i in range(seg)]
    mesh = bpy.data.meshes.new("plaza-centre")
    mesh.from_pydata(verts, [], faces); mesh.update()
    uv = mesh.uv_layers.new(name="UV")
    k = 0
    for face in faces:
        for vi in face:
            uv.data[k].uv = uvs[vi]; k += 1
    centre = bpy.data.objects.new("plaza-centre", mesh)
    bpy.context.collection.objects.link(centre)
    _finish(centre, M["dqCobble"], 0, g)
    _ring("ring1", 1.25, 2.7, 0.05, 10, M["dqPlaza"], g)
    _ring("ring2", 2.7, 4.3, 0.045, 16, M["dqPlaza"], g)
    _ring("ring3", 4.3, 6.0, 0.04, 22, M["dqPlaza"], g)
    _ring("rim", 6.0, 6.3, 0.03, 24, M["dqStone"], g)
    return g

# ---------------- town props ----------------

def build_planter(kind):
    s = 1.0 if kind == "large" else 0.62
    g = root(f"planter-{kind}")
    prof = [(0.02, 0), (0.30, 0), (0.35, 0.05), (0.31, 0.40), (0.37, 0.48), (0.39, 0.56), (0.34, 0.58), (0.30, 0.50)]
    lathe("pot", [(r * s, z * s) for r, z in prof], M["dqClay"], parent=g, uv_tile=2)
    cyl("soil", (0, 0, 0.50 * s), 0.29 * s, 0.04, M["dqSoil"], verts=14, parent=g)
    rng = random.Random(5 if kind == "large" else 9)
    mats = [M["cardRound"], M["cardFlower"] if kind == "large" else M["cardPink"], M["cardWhite"]]
    for i in range(5 if kind == "large" else 3):
        a = rng.uniform(0, 6.28); rr = rng.uniform(0.02, 0.17) * s
        card(g, (rr * math.cos(a), rr * math.sin(a), (0.62 + rng.uniform(0, 0.14)) * s),
             0.52 * s, 0.46 * s, mats[i % len(mats)], rot=(0, 0, rng.uniform(0, 3.1)))
    contact_shadow(g, 0.95 * s, 0.95 * s)
    return g

def build_crates():
    g = root("crates")
    def crate(x, y, z, s, yaw):
        c = bpy.data.objects.new("crate", None)
        bpy.context.collection.objects.link(c); c.parent = g
        c.location = (x, y, z); c.rotation_euler = (0, 0, yaw)
        box("body", (0, 0, s / 2), (s, s, s), M["dqPlank"], parent=c, uv="face", bevel=0.01)
        for sx in (-1, 1):
            for sz in (0.12, 0.88):
                box("batten", (sx * (s / 2 - 0.05), 0, s * sz), (0.09, s + 0.03, 0.1), M["dqTimber"], parent=c)
        box("lid", (0, 0, s + 0.015), (s * 0.96, s * 0.96, 0.04), M["dqPlank"], parent=c, uv="face")
        return c
    crate(-0.34, 0, 0, 0.62, 0.06); crate(0.34, 0.05, 0, 0.62, -0.05); crate(0, -0.02, 0.64, 0.58, 0.28)
    contact_shadow(g, 1.6, 1.2)
    return g

def build_barrel():
    g = root("barrel")
    prof = [(0.02, 0), (0.27, 0), (0.33, 0.10), (0.365, 0.45), (0.33, 0.82), (0.28, 0.92), (0.28, 0.95)]
    lathe("body", prof, M["dqPlank"], parent=g, uv_tile=3)
    for z, r in ((0.18, 0.345), (0.74, 0.345)):
        torus("band", (0, 0, z), r, 0.022, M["dqIron"], rot=(0, 0, 0), parent=g)
    cyl("top", (0, 0, 0.945), 0.275, 0.02, M["dqRings"], verts=16, parent=g)
    contact_shadow(g, 0.85, 0.85)
    return g

def build_bucket():
    g = root("bucket-rope")
    prof = [(0.20, 0.02), (0.26, 0.02), (0.30, 0.10), (0.315, 0.44), (0.33, 0.50),
            (0.30, 0.50), (0.285, 0.42), (0.27, 0.12), (0.20, 0.10)]
    lathe("bucket", prof, M["dqPlank"], parent=g, uv_tile=3)
    for z, r in ((0.14, 0.315), (0.40, 0.325)):
        torus("band", (0, 0, z), r, 0.018, M["dqIron"], parent=g)
    torus("handle", (0, 0, 0.52), 0.27, 0.024, M["dqTimber"], rot=(math.radians(90), 0, 0), parent=g)
    for i in range(3):
        torus("coil", (0.62, 0.1, 0.05 + i * 0.085), 0.20, 0.042, M["rope"], parent=g)
    pipe("ropefall", (0.05, 0, 0.78), (0.58, 0.08, 0.30), 0.035, M["rope"], parent=g, verts=8)
    contact_shadow(g, 1.15, 0.8)
    return g

def build_lantern():
    g = root("stone-lantern")
    box("base", (0, 0, 0.09), (0.4, 0.4, 0.18), M["dqStone"], parent=g, uv="face", bevel=0.015)
    cyl("pillar", (0, 0, 0.5), 0.085, 0.62, M["dqStone"], verts=10, parent=g)
    box("shelf", (0, 0, 0.85), (0.36, 0.36, 0.07), M["dqStone"], parent=g, uv="face")
    box("firecore", (0, 0, 1.06), (0.20, 0.20, 0.30), M["dqGlass"], parent=g)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("post", (sx * 0.145, sy * 0.145, 1.06), (0.06, 0.06, 0.34), M["dqStone"], parent=g)
    box("roofslab", (0, 0, 1.26), (0.4, 0.4, 0.06), M["dqStone"], parent=g, uv="face")
    cone("roof", (0, 0, 1.44), 0.33, 0.24, M["dqStone"], verts=4, rot=(0, 0, math.radians(45)), parent=g)
    sph("jewel", (0, 0, 1.62), 0.055, M["dqStone"], parent=g)
    contact_shadow(g, 0.6, 0.6)
    return g

def build_banner(color):
    g = root(f"banner-{color}")
    cyl("pole", (-0.52, 0, 1.3), 0.05, 2.6, M["dqTimber"], verts=10, parent=g)
    box("base", (-0.52, 0, 0.10), (0.3, 0.3, 0.2), M["dqStone"], parent=g, uv="face")
    cyl("bar", (0, 0, 2.42), 0.035, 1.15, M["dqTimber"], verts=8, rot=(0, math.radians(90), 0), parent=g)
    # cloth: subdivided plane with a hanging drape + swallowtail notch
    import mathutils
    W, H, NX, NY = 0.98, 1.45, 8, 10
    verts, faces, uvs = [], [], []
    for j in range(NY + 1):
        v = j / NY
        for i in range(NX + 1):
            u = i / NX
            x = -W / 2 + u * W
            z = 2.38 - v * H
            y = 0.10 * math.sin(u * math.pi) * v + 0.05 * math.sin(u * 5.1 + 1) * v
            if v > 0.86 and abs(u - 0.5) < 0.14:
                z += (v - 0.86) / 0.14 * 0.34  # notch rises at the centre
            verts.append((x, y, z)); uvs.append((u, 1 - v))
    for j in range(NY):
        for i in range(NX):
            a = j * (NX + 1) + i; b = a + 1; c = a + NX + 1; d = c + 1
            faces.append((a, c, d, b))
    mesh = bpy.data.meshes.new("cloth")
    mesh.from_pydata(verts, [], faces); mesh.update()
    uv = mesh.uv_layers.new(name="UV")
    k = 0
    for face in faces:
        for vi in face:
            uv.data[k].uv = uvs[vi]; k += 1
    cloth = bpy.data.objects.new("cloth", mesh)
    bpy.context.collection.objects.link(cloth)
    _finish(cloth, M["dqClothRed" if color == "red" else "dqClothGreen"], 0, g)
    contact_shadow(g, 1.5, 0.7)
    return g

def build_stall():
    g = root("stall")
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl("post", (sx * 0.95, sy * 0.42, 0.95), 0.05, 1.9, M["dqTimber"], verts=8, parent=g)
    box("counter", (0, 0, 0.45), (2.0, 0.8, 0.9), M["dqPlank"], parent=g, uv="face", bevel=0.01)
    # canopy: gently draped cloth plane
    W, D, NX, NY = 2.35, 1.35, 10, 6
    verts, faces, uvs = [], [], []
    for j in range(NY + 1):
        v = j / NY
        for i in range(NX + 1):
            u = i / NX
            x = -W / 2 + u * W; y = -D / 2 + v * D
            z = 2.14 - 0.16 * v - 0.07 * math.sin(u * math.pi) * math.sin(v * math.pi)
            verts.append((x, y, z)); uvs.append((u, v))
    for j in range(NY):
        for i in range(NX):
            a = j * (NX + 1) + i; b = a + 1; c = a + NX + 1; d = c + 1
            faces.append((a, b, d, c))
    mesh = bpy.data.meshes.new("canopy")
    mesh.from_pydata(verts, [], faces); mesh.update()
    uv = mesh.uv_layers.new(name="UV")
    k = 0
    for face in faces:
        for vi in face:
            uv.data[k].uv = uvs[vi]; k += 1
    canopy = bpy.data.objects.new("canopy", mesh)
    bpy.context.collection.objects.link(canopy)
    _finish(canopy, M["dqClothCream"], 0, g)
    contact_shadow(g, 2.3, 1.3)
    return g

def build_fruit_basket():
    g = root("fruit-basket")
    prof = [(0.05, 0), (0.30, 0.01), (0.40, 0.10), (0.44, 0.26), (0.42, 0.30), (0.38, 0.27)]
    lathe("basket", prof, M["dqClay"], parent=g, uv_tile=3)
    rng = random.Random(4)
    for (x, y, z) in ((-0.16, 0.05, 0.33), (0.14, -0.08, 0.34), (0.02, 0.14, 0.36), (-0.05, -0.15, 0.35), (0.0, 0.0, 0.43)):
        sph("fruit", (x, y, z), 0.105, M["dqFruit"], parent=g)
    card(g, (0.1, 0.05, 0.5), 0.3, 0.26, M["cardRound"], rot=(0.4, 0, 0.7))
    contact_shadow(g, 0.95, 0.95)
    return g

# ---------------- nature models ----------------

def build_stump():
    g = root("stump")
    cyl("body", (0, 0, 0.26), 0.36, 0.52, M["bark"], verts=12, r2=0.46, parent=g)
    cyl("top", (0, 0, 0.53), 0.355, 0.02, M["dqRings"], verts=12, parent=g)
    rng = random.Random(8)
    for i in range(5):
        a = i / 5 * 6.28 + 0.4
        cone("root", (0.42 * math.cos(a), 0.42 * math.sin(a), 0.08), 0.13, 0.22, M["bark"],
             verts=7, rot=(math.radians(64) * math.sin(a), -math.radians(64) * math.cos(a), 0), parent=g)
    contact_shadow(g, 1.1, 1.1)
    return g

def build_log():
    g = root("log-fallen")
    cyl("body", (0, 0, 0.30), 0.30, 1.7, M["bark"], verts=12, rot=(0, math.radians(90), 0), parent=g)
    for sx in (-1, 1):
        cyl("end", (sx * 0.86, 0, 0.30), 0.295, 0.03, M["dqRings"], verts=12,
            rot=(0, math.radians(90), 0), parent=g)
    card(g, (-0.3, 0, 0.62), 0.55, 0.3, M["cardRound"], rot=(0.5, 0, 0.4))
    card(g, (0.35, 0.05, 0.60), 0.45, 0.26, M["cardRound"], rot=(0.6, 0, 2.2))
    contact_shadow(g, 2.0, 0.9)
    return g

def build_moss_rock():
    g = root("moss-rock")
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.62, subdivisions=2, location=(0, 0, 0.34))
    o = bpy.context.object; o.name = "rock"; o.scale = (1.35, 1.0, 0.72)
    jitter(o, 0.05, 21)
    _finish(o, M["dqRockGrey"], 0, g)
    card(g, (-0.25, 0.05, 0.72), 0.7, 0.34, M["cardRound"], rot=(0.7, 0, 0.3))
    card(g, (0.3, -0.08, 0.68), 0.55, 0.28, M["cardRound"], rot=(0.8, 0, 2.4))
    contact_shadow(g, 1.7, 1.3)
    return g

def build_basalt(kind):
    g = root(f"basalt-{kind}")
    if kind == 1:
        parts = [((0, 0, 0.21), (0.78, 0.48, 0.42), 31)]
    elif kind == 2:
        parts = [((0, 0, 0.15), (0.70, 0.52, 0.30), 47)]
    else:
        parts = [((0, 0, 0.22), (0.50, 0.48, 0.45), 59), ((0.30, 0.14, 0.13), (0.32, 0.30, 0.27), 67)]
    for (loc, scale, seed) in parts:
        bpy.ops.mesh.primitive_cube_add(location=loc)
        o = bpy.context.object; o.name = "basalt"
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        mod = o.modifiers.new("sub", "SUBSURF")
        mod.subdivision_type = "SIMPLE"; mod.levels = 2
        bpy.ops.object.modifier_apply(modifier="sub")
        jitter(o, 0.085, seed)
        _finish(o, M["dqBasalt"], 0.03, g)
    contact_shadow(g, 1.8, 1.4)
    return g

# ---------------- main ----------------

BUILDERS = {
    "tree-broadleaf-round": lambda: build_tree("round"),
    "tree-broadleaf-tall": lambda: build_tree("tall"),
    "tree-broadleaf-young": lambda: build_tree("young"),
    "hut-town": build_hut_town,
    "plaza": build_plaza,
    "planter-large": lambda: build_planter("large"),
    "planter-small": lambda: build_planter("small"),
    "crates": build_crates,
    "barrel": build_barrel,
    "bucket-rope": build_bucket,
    "stone-lantern": build_lantern,
    "banner-red": lambda: build_banner("red"),
    "banner-green": lambda: build_banner("green"),
    "stall": build_stall,
    "fruit-basket": build_fruit_basket,
    "stump": build_stump,
    "log-fallen": build_log,
    "moss-rock": build_moss_rock,
    "basalt-1": lambda: build_basalt(1),
    "basalt-2": lambda: build_basalt(2),
    "basalt-3": lambda: build_basalt(3),
}

def bbox_of(obj):
    import mathutils
    xs, ys, zs = [], [], []
    for o in obj.children_recursive:
        if o.type == "MESH":
            for v in o.bound_box:
                w = o.matrix_world @ mathutils.Vector(v)
                xs.append(w.x); ys.append(w.y); zs.append(w.z)
    if not xs: return (0, 0, 0)
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    outdir = ROOT / "models"
    outdir.mkdir(parents=True, exist_ok=True)
    only = [a for a in argv if not a.startswith("--")]
    meta = {}
    for name, builder in BUILDERS.items():
        if only and name not in only: continue
        bb.clean(); bb.setup_materials(); dq_materials()
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
    (ROOT / "models-measured.json").write_text(json.dumps(meta, indent=1))
    print("DONE")

main()
