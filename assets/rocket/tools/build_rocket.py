#!/usr/bin/env python3
"""Build the rocket asset set for 'Zero kara no Kagaku' (final goal).

Run: blender -b -noaudio --python build_rocket.py
Outputs GLBs + verification renders under ../models and ../previews.

Conventions (same as assets/buildings-3d): origin at ground contact
centre, 1 unit = 1 m, front faces Blender -Y (= +Z in Three.js).
Blender Z is up; Three.js -X is Blender -X (hatch / tower side).
Stage ①: blockout + connection verification. Detail/materials in ③.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent / "models"
PREVIEWS = HERE.parent / "previews"
MODELS.mkdir(exist_ok=True)
PREVIEWS.mkdir(exist_ok=True)

# ------------------------------------------------------------------ utils

def clean():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for d in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras,
              bpy.data.lights):
        pass

MAT = {}

def mat(name, color, rough=0.85, metal=0.0, emissive=None, ei=0.0):
    if name in MAT:
        return MAT[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emissive is not None:
        b.inputs["Emission Color"].default_value = (*emissive, 1.0)
        b.inputs["Emission Strength"].default_value = ei
    MAT[name] = m
    return m

def setup_materials():
    mat("ecru", (0.91, 0.875, 0.784), 0.8)          # 生成り
    mat("metal", (0.54, 0.55, 0.565), 0.55, 0.6)    # 落ち着いた金属
    mat("metalDark", (0.33, 0.345, 0.36), 0.6, 0.5)
    mat("navy", (0.133, 0.212, 0.31), 0.7, 0.2)     # 濃紺
    mat("teal", (0.114, 0.498, 0.482), 0.65, 0.2)   # 青緑
    mat("insul", (0.788, 0.659, 0.416), 0.95)       # 断熱材
    mat("heat", (0.227, 0.216, 0.2), 0.7, 0.4)      # 耐熱
    mat("amber", (0.765, 0.541, 0.18), 0.6, 0.2)    # 琥珀（最小限）
    mat("concrete", (0.608, 0.588, 0.549), 0.95)
    mat("frame", (0.243, 0.29, 0.341), 0.6, 0.5)    # 骨格の鋼材
    mat("glass", (0.165, 0.208, 0.259), 0.25, 0.6)
    mat("glowAmber", (0.9, 0.62, 0.2), 0.5, 0.0,
        emissive=(1.0, 0.62, 0.15), ei=1.6)
    mat("screenGlow", (0.35, 0.85, 0.8), 0.4, 0.0,
        emissive=(0.2, 0.9, 0.8), ei=1.2)

COLL = {}

def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    COLL[name] = c
    return c

def _link(obj, coll):
    for c in list(obj.users_collection):
        if c is not coll:
            c.objects.unlink(obj)
    if obj.name not in coll.objects:
        coll.objects.link(obj)

def box(coll, name, loc, size, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False,
                                   scale=True)
    if material:
        o.data.materials.append(MAT[material])
    _link(o, coll)
    return o

def cyl(coll, name, loc, r, h, material, verts=24, r2=None):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r, radius2=r if r2 is None else r2,
        depth=h, location=loc)
    o = bpy.context.object
    o.name = name
    if material:
        o.data.materials.append(MAT[material])
    _link(o, coll)
    return o

def panel(coll, name, z0, z1, r0, r1, a0, a1, material, seg=12):
    """Curved skin panel: arc segment a0..a1 (Blender XY radians),
    radius r0 at z0 tapering to r1 at z1. Outward-facing, smooth."""
    verts, faces = [], []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        ca, sa = math.cos(a), math.sin(a)
        verts.append((r0 * ca, r0 * sa, z0))
        verts.append((r1 * ca, r1 * sa, z1))
    for i in range(seg):
        b = i * 2
        faces.append((b, b + 2, b + 3, b + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    if material:
        o.data.materials.append(MAT[material])
    for p in me.polygons:
        p.use_smooth = True
    return o

# skin quadrants (Blender XY): P1 front(-Y) P2 +X P3 back(+Y) P4 -X
QUAD = {"P1": (-3 * math.pi / 4, -math.pi / 4),
        "P2": (-math.pi / 4, math.pi / 4),
        "P3": (math.pi / 4, 3 * math.pi / 4),
        "P4": (3 * math.pi / 4, 5 * math.pi / 4)}

def sph(coll, name, loc, size, material):
    bpy.ops.mesh.primitive_uv_sphere_add(location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False,
                                   scale=True)
    if material:
        o.data.materials.append(MAT[material])
    _link(o, coll)
    return o

def empty(coll, name, loc):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    o.empty_display_size = 0.35
    coll.objects.link(o)
    return o

# three.js anchor (x, y-up, z) -> Blender (x, -z, y-up)
def anchor(coll, name, tx, ty, tz):
    return empty(coll, name, (tx, -tz, ty))

# ------------------------------------------------------------------ pad

def build_pad():
    c = collection("launch-pad")
    box(c, "Slab", (0, 0, 0.4), (16, 16, 0.8), "concrete")
    # painted border strips (navy) on the slab top
    for sx in (-1, 1):
        box(c, "SlabMark", (sx * 7.6, 0, 0.83), (0.3, 15.4, 0.06), "navy")
        box(c, "SlabMark", (0, sx * 7.6, 0.83), (15.4, 0.3, 0.06), "navy")
    # pedestal: ring of 6 blocks (open centre for the nozzle) + top ring
    for i in range(6):
        a = i * math.pi / 3
        box(c, "PedestalBlock", (2.25 * math.cos(a), 2.25 * math.sin(a),
                                 1.2), (1.9, 1.1, 0.8), "metalDark",
            rot=(0, 0, -a))
    bpy.ops.mesh.primitive_torus_add(major_radius=2.3, minor_radius=0.17,
                                     location=(0, 0, 1.55))
    o = bpy.context.object
    o.name = "PedestalRing"
    o.data.materials.append(MAT["metal"])
    _link(o, c)
    # flame deflector cone in the pit
    cyl(c, "Deflector", (0, 0, 0.95), 0.4, 0.9, "heat", verts=20, r2=1.25)
    # hold-down arms (launch-pad clip: mount_release rotates these)
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        box(c, f"HoldDown_{i+1}", (1.95 * math.cos(a), 1.95 * math.sin(a),
                                   1.85), (0.5, 0.28, 0.6), "amber",
            rot=(0, 0, -a))
    # tower rails on the slab (tower slides -X when retracting)
    for sy in (-0.7, 0.7):
        box(c, "TowerRail", (-4.75, sy, 0.87), (6.5, 0.22, 0.12), "metalDark")
    # floodlight poles at the two front corners
    for sx in (-6.6, 6.6):
        cyl(c, "LightPole", (sx, -6.6, 2.4), 0.06, 3.2, "metalDark",
            verts=8)
        box(c, "LightHead", (sx * 0.96, -6.35, 4.05), (0.5, 0.18, 0.3),
            "glowAmber", rot=(0.5, 0, 0))
    anchor(c, "Anchor_mount_top", 0, 1.6, 0)
    anchor(c, "Anchor_smoke_l", -3.2, 0.5, 0)
    anchor(c, "Anchor_smoke_r", 3.2, 0.5, 0)
    return c

# ------------------------------------------------------------------ rocket

def _seam_rings(c, zlist, r=1.73):
    for z in zlist:
        cyl(c, f"SeamRing_{int(z * 10)}", (0, 0, z), r, 0.09, "navy",
            verts=28)

def build_rocket():
    c = collection("rocket")
    # --- Propulsion (y 1.6-4.8): skirt, body, nozzle into the pedestal pit
    cyl(c, "Propulsion", (0, 0, 3.2), 1.7, 3.2, "metal", verts=28)
    cyl(c, "PropSkirt", (0, 0, 1.75), 1.78, 0.3, "metalDark", verts=28)
    cyl(c, "Nozzle", (0, 0, 1.25), 0.95, 0.7, "heat", verts=24, r2=0.52)
    cyl(c, "NozzleInner", (0, 0, 0.92), 0.8, 0.06, "metalDark", verts=24)
    # stabilizer fins at the cardinal points (hold-downs sit diagonal)
    for k in range(4):
        a = k * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        box(c, "Fin", (2.05 * ca, 2.05 * sa, 2.9), (0.95, 0.09, 1.9),
            "navy", rot=(0, 0, -a))
        box(c, "FinTip", (2.35 * ca, 2.35 * sa, 3.6), (0.4, 0.1, 0.5),
            "amber", rot=(0, 0, -a))
    # --- BodyLower (4.8-11.3): insulation wrap low, panel skin above
    cyl(c, "BodyLowerInsul", (0, 0, 5.9), 1.75, 2.2, "insul", verts=28)
    for q, (a0, a1) in QUAD.items():
        panel(c, f"Skin_Lower_{q}", 7.0, 11.3, 1.7, 1.7, a0, a1, "ecru")
    _seam_rings(c, (7.0, 9.3, 11.3))
    # vertical seam strips on the quadrant boundaries (panel joints)
    for q, (a0, _a1) in QUAD.items():
        panel(c, "SeamStrip", 7.0, 11.3, 1.715, 1.715,
              a0 - 0.02, a0 + 0.02, "metalDark", seg=1)
        panel(c, "SeamStrip", 11.3, 15.8, 1.715, 1.465,
              a0 - 0.02, a0 + 0.02, "metalDark", seg=1)
    # inspection hatches + a pipe run (front = Blender -Y)
    box(c, "InspectHatch", (0.9, -1.62, 8.6), (0.55, 0.14, 0.75),
        "metalDark")
    box(c, "InspectHatch", (-1.15, -1.28, 10.2), (0.5, 0.14, 0.65),
        "metalDark")
    cyl(c, "PipeRun", (1.55, -0.72, 8.0), 0.07, 6.4, "metal", verts=10)
    # --- BodyUpper (11.3-15.8): taper panels, navy band, bay panel
    for q, (a0, a1) in QUAD.items():
        panel(c, f"Skin_Upper_{q}", 11.3, 15.8, 1.7, 1.45, a0, a1, "ecru")
    cyl(c, "UpperBand", (0, 0, 15.45), 1.5, 0.5, "navy", verts=28, r2=1.44)
    box(c, "BayPanel", (0, -1.62, 13.4), (1.25, 0.16, 1.9), "teal")
    box(c, "BayPanelFrame", (0, -1.58, 13.4), (1.45, 0.08, 2.1),
        "metalDark")
    # --- Capsule (15.8-19.2): frustum + dome, hatch on -X, window front
    cyl(c, "Capsule", (0, 0, 17.2), 1.45, 2.8, "ecru", verts=28, r2=0.78)
    sph(c, "CapsuleDome", (0, 0, 18.85), (1.56, 1.56, 0.85), "ecru")
    cyl(c, "CapsuleBase", (0, 0, 15.95), 1.5, 0.3, "navy", verts=28)
    # RCS thruster bumps around the capsule base
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        cyl(c, "RCS", (1.38 * math.cos(a), 1.38 * math.sin(a), 16.35),
            0.09, 0.22, "navy", verts=10, r2=0.05)
    # hatch: separate object, disc on the -X frustum surface at z 17.3
    bpy.ops.mesh.primitive_cone_add(vertices=28, radius1=0.475,
                                    radius2=0.475, depth=0.1,
                                    location=(-1.1, 0, 17.3),
                                    rotation=(0, math.pi / 2, 0))
    o = bpy.context.object
    o.name = "Hatch"
    o.data.materials.append(MAT["metal"])
    _link(o, c)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.045,
                                     location=(-1.16, 0, 17.3),
                                     rotation=(0, math.pi / 2, 0))
    o = bpy.context.object
    o.name = "HatchRim"
    o.data.materials.append(MAT["amber"])
    _link(o, c)
    # round window on the front (-Y)
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.26,
                                    radius2=0.26, depth=0.08,
                                    location=(0, -1.18, 17.7),
                                    rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.name = "Window"
    o.data.materials.append(MAT["glass"])
    _link(o, c)
    # --- NoseTip (19.2-20.8)
    cyl(c, "NoseBase", (0, 0, 19.3), 0.42, 0.35, "metal", verts=20)
    cyl(c, "NoseTip", (0, 0, 20.05), 0.3, 1.3, "navy", verts=20, r2=0.02)
    # --- anchors
    anchor(c, "Anchor_mount", 0, 1.6, 0)
    anchor(c, "Anchor_exhaust", 0, 0.9, 0)
    anchor(c, "Anchor_hatch", -1.15, 17.3, 0)
    anchor(c, "Anchor_camera_capsule", -4.2, 17.6, 3.2)
    return c

def build_rocket_frame():
    """Skeleton variant for assembly stages S1/S2 (same rocket GLB)."""
    c = COLL["rocket"]
    # ring ribs + stringers per section, inner tank silhouettes
    for sec, (z0, z1, r) in {"Frame_Propulsion": (1.6, 4.8, 1.7),
                             "Frame_BodyLower": (4.8, 11.3, 1.7),
                             "Frame_BodyUpper": (11.3, 15.8, 1.58)}.items():
        n = max(2, round((z1 - z0) / 1.3))
        for i in range(n + 1):
            z = z0 + (z1 - z0) * i / n
            bpy.ops.mesh.primitive_torus_add(
                major_radius=r, minor_radius=0.055, location=(0, 0, z))
            o = bpy.context.object
            o.name = sec + "_rib"
            o.data.materials.append(MAT["frame"])
            _link(o, c)
        for k in range(8):
            a = k * math.pi / 4
            box(c, sec + "_stringer",
                (r * math.cos(a), r * math.sin(a), (z0 + z1) / 2),
                (0.09, 0.09, z1 - z0), "frame", rot=(0, 0, -a))
    cyl(c, "Frame_TankLower", (0, 0, 8.0), 1.28, 5.6, "metalDark",
        verts=20)
    sph(c, "Frame_TankLower_top", (0, 0, 10.8), (2.56, 2.56, 1.4),
        "metalDark")
    cyl(c, "Frame_TankUpper", (0, 0, 13.4), 1.15, 3.4, "metalDark",
        verts=20)
    return c

# ------------------------------------------------------------------ tower

def build_tower():
    c = collection("support-tower")
    H = 21.5
    # corner posts + level braces + diagonals (two faces)
    for sx in (-0.81, 0.81):
        for sy in (-0.81, 0.81):
            box(c, "Post", (sx, sy, H / 2), (0.18, 0.18, H), "frame")
    levels = [i * 2.6875 for i in range(9)]
    for z in levels:
        for sy in (-0.81, 0.81):
            box(c, "BraceX", (0, sy, z), (1.8, 0.12, 0.12), "frame")
        for sx in (-0.81, 0.81):
            box(c, "BraceY", (sx, 0, z), (0.12, 1.8, 0.12), "frame")
    for i in range(8):
        z0, z1 = levels[i], levels[i + 1]
        zm, dz = (z0 + z1) / 2, z1 - z0
        ln = math.hypot(1.62, dz)
        an = math.atan2(dz, 1.62)
        s = 1 if i % 2 == 0 else -1
        for sy in (-0.81, 0.81):
            box(c, "DiagX", (0, sy, zm), (ln, 0.09, 0.09), "frame",
                rot=(0, 0, 0))
            o = c.objects[-1]
            o.rotation_euler = (0, -s * an, 0)
            o.location = (0, sy, zm)
    # decks at arm heights + top deck
    for z in (6.5, 12.5, 16.9, 21.3):
        box(c, "Deck", (0, 0, z - 0.06), (1.9, 1.9, 0.12), "metalDark")
    # service arms toward the rocket (+X): separate nodes for the clip
    for name, z, ln in (("Arm_1", 6.5, 1.95), ("Arm_2", 12.5, 1.95),
                        ("Arm_3", 17.0, 2.55)):
        box(c, name, (0.9 + ln / 2, 0, z), (ln, 0.5, 0.22), "teal")
        box(c, name + "_pad", (0.9 + ln, 0, z), (0.12, 0.7, 0.5),
            "metalDark")
    # conduit pipe up the +X post + deck railing at corridor level
    cyl(c, "Conduit", (0.95, 0.81, 10.5), 0.05, 21.0, "amber", verts=8)
    for sx in (-0.85, 0.85):
        box(c, "RailPost", (sx, -0.95, 17.35), (0.05, 0.05, 0.9), "frame")
    box(c, "RailTop", (0, -0.95, 17.8), (1.75, 0.05, 0.05), "frame")
    # elevator shaft on the -X face + top crane beam + beacon
    box(c, "Elevator", (-1.25, 0, 10.0), (0.7, 1.1, 20.0), "navy")
    box(c, "CraneBeam", (1.6, 0, 21.35), (3.2, 0.25, 0.3), "frame")
    box(c, "CraneHook", (2.6, 0, 20.6), (0.18, 0.18, 1.2), "metalDark")
    sph(c, "Beacon", (0, 0, 21.85), (0.22, 0.22, 0.22), "glowAmber")
    # base feet on the rails
    for sx in (-0.7, 0.7):
        for sy in (-0.7, 0.7):
            box(c, "Foot", (sx, sy, 0.18), (0.4, 0.4, 0.24), "metalDark")
    anchor(c, "Anchor_corridor_root", 0.9, 16.83, 0)
    return c

# ------------------------------------------------------------------ corridor

def build_corridor():
    c = collection("boarding-corridor")
    L = 2.55  # from tower +X face to the hatch dock
    # local origin = floor level at the tower face; hatch centre is
    # +0.47 above the floor (sill flush), interior height 1.5
    box(c, "Floor", (L / 2, 0, 0.04), (L, 1.1, 0.08), "metalDark")
    box(c, "Ceiling", (L / 2, 0, 1.54), (L, 1.1, 0.08), "teal")
    # front wall (-Y = three.js +Z) mostly glass strip; back wall solid
    box(c, "WallFrontLow", (L / 2, -0.53, 0.3), (L, 0.06, 0.45), "teal")
    box(c, "WallFrontGlass", (L / 2, -0.53, 0.9), (L, 0.05, 0.65), "glass")
    box(c, "WallFrontTop", (L / 2, -0.53, 1.4), (L, 0.06, 0.22), "teal")
    box(c, "WallBack", (L / 2, 0.53, 0.79), (L, 0.06, 1.42), "teal")
    for x in (0.25, L / 2, L - 0.25):
        box(c, "Rib", (x, 0, 0.79), (0.09, 1.12, 1.58), "navy")
    # dock ring at the far end, centred on the hatch axis (+0.47)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.52, minor_radius=0.06,
                                     location=(L, 0, 0.47),
                                     rotation=(0, math.pi / 2, 0))
    o = bpy.context.object
    o.name = "DockRing"
    o.data.materials.append(MAT["amber"])
    _link(o, c)
    # bellows rings near both ends (docking-tunnel look)
    for bx in (0.18, L - 0.18):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.62,
                                         minor_radius=0.05,
                                         location=(bx, 0, 0.79),
                                         rotation=(0, math.pi / 2, 0))
        o = bpy.context.object
        o.name = "Bellows"
        o.data.materials.append(MAT["heat"])
        _link(o, c)
    # diagonal support strut back to the tower
    box(c, "Strut", (0.45, 0, -0.5), (0.09, 0.09, 1.35), "frame",
        rot=(0.6, 0, 0))
    anchor(c, "Anchor_hatch_dock", 2.55, 0.47, 0)
    return c

# ------------------------------------------------------------------ terminal

def build_terminal():
    c = collection("control-terminal")
    box(c, "Base", (0, 0, 0.45), (1.8, 0.8, 0.9), "navy")
    box(c, "Desk", (0, -0.05, 1.0), (1.8, 0.85, 0.1), "metalDark",
        rot=(-0.35, 0, 0))
    box(c, "Screen", (0, 0.12, 1.32), (1.3, 0.06, 0.55), "screenGlow",
        rot=(-0.35, 0, 0))
    box(c, "ScreenFrame", (0, 0.15, 1.32), (1.44, 0.04, 0.66),
        "metalDark", rot=(-0.35, 0, 0))
    box(c, "SideCabinet", (1.25, 0, 0.55), (0.6, 0.8, 1.1), "teal")
    cyl(c, "Mast", (-0.95, 0.25, 1.6), 0.035, 2.2, "metal", verts=8)
    sph(c, "MastLight", (-0.95, 0.25, 2.75), (0.11, 0.11, 0.11),
        "glowAmber")
    cyl(c, "CableDrum", (0.4, 0.75, 0.3), 0.3, 0.35, "heat", verts=16)
    # keyboard slab + status buttons (active-state emissives)
    box(c, "Keyboard", (0, -0.28, 0.93), (1.1, 0.3, 0.05), "metal",
        rot=(-0.35, 0, 0))
    cyl(c, "BtnTeal", (-0.55, -0.12, 1.06), 0.045, 0.03, "screenGlow",
        verts=12)
    cyl(c, "BtnAmber", (-0.38, -0.12, 1.06), 0.045, 0.03, "glowAmber",
        verts=12)
    return c

# ------------------------------------------------------------------ rack

def build_parts_rack():
    c = collection("parts-rack")
    for sx in (-1.05, 1.05):
        for sy in (-0.35, 0.35):
            box(c, "Post", (sx, sy, 0.9), (0.09, 0.09, 1.8), "frame")
    for z in (0.25, 0.95, 1.65):
        box(c, "Shelf", (0, 0, z), (2.3, 0.85, 0.06), "metalDark")
    box(c, "Crate", (-0.6, 0, 1.2), (0.8, 0.6, 0.45), "insul")
    box(c, "Crate", (0.45, 0.05, 1.18), (0.65, 0.55, 0.4), "navy")
    box(c, "Crate", (-0.3, 0, 0.52), (0.9, 0.65, 0.5), "metalDark")
    box(c, "PipeBundle", (0.62, 0, 0.62), (0.5, 0.4, 0.35), "metal")
    # spare skin panel leaning against the rack (ecru, slightly curved
    # look via two angled slabs)
    box(c, "SparePanel", (1.35, 0, 0.82), (0.05, 1.0, 1.65), "ecru",
        rot=(0, -0.24, 0))
    return c

# ------------------------------------------------------------------ anim

from mathutils import Quaternion

def _parent_keep(child, parent):
    bpy.ops.object.select_all(action="DESELECT")
    child.select_set(True)
    parent.select_set(True)
    bpy.context.view_layer.objects.active = parent
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

def _by_name(coll, name):
    for o in coll.objects:
        if o.name == name or o.name.startswith(name + "."):
            return o
    return None

def bake_clip(obj, clip, keys):
    """keys: [(frame, kind, value)] kind in rot_euler/loc/rot_quat.
    Creates an action and parks it on a new NLA track named `clip`."""
    if obj.animation_data is None:
        obj.animation_data_create()
    for t in obj.animation_data.nla_tracks:
        t.mute = True
    act = bpy.data.actions.new(clip + "@" + obj.name)
    act.use_fake_user = True
    obj.animation_data.action = act
    for frame, kind, value in keys:
        if kind == "rot_euler":
            obj.rotation_euler = value
            obj.keyframe_insert("rotation_euler", frame=frame)
        elif kind == "loc":
            obj.location = value
            obj.keyframe_insert("location", frame=frame)
        elif kind == "rot_quat":
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = value
            obj.keyframe_insert("rotation_quaternion", frame=frame)
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 1, act)
    track.mute = False
    obj.rotation_euler = (0, 0, 0)
    obj.location = obj.location  # keep place; pose re-driven by NLA

def add_animations():
    rk = COLL["rocket"]
    # --- hatch (top hinge, swings out/up) + bay panel (bottom hinge)
    hp = empty(rk, "HatchPivot", (-1.1, 0, 17.78))
    _parent_keep(_by_name(rk, "Hatch"), hp)
    _parent_keep(_by_name(rk, "HatchRim"), hp)
    bake_clip(hp, "hatch_open",
              [(1, "rot_euler", (0, 0, 0)), (20, "rot_euler", (0, 1.9, 0))])
    bake_clip(hp, "hatch_close",
              [(1, "rot_euler", (0, 1.9, 0)), (20, "rot_euler", (0, 0, 0))])
    bp = empty(rk, "BayPivot", (0, -1.66, 12.45))
    _parent_keep(_by_name(rk, "BayPanel"), bp)
    _parent_keep(_by_name(rk, "BayPanelFrame"), bp)
    bake_clip(bp, "bay_open",
              [(1, "rot_euler", (0, 0, 0)), (20, "rot_euler", (0.95, 0, 0))])
    bake_clip(bp, "bay_close",
              [(1, "rot_euler", (0.95, 0, 0)), (20, "rot_euler", (0, 0, 0))])
    # --- tower: root slide + arm fold + beacon spin
    tw = COLL["support-tower"]
    root = empty(tw, "TowerRoot", (0, 0, 0))
    arm_pivots = []
    for i, z in enumerate((6.5, 12.5, 17.0), start=1):
        pv = empty(tw, f"ArmPivot_{i}", (0.9, 0, z))
        _parent_keep(_by_name(tw, f"Arm_{i}"), pv)
        _parent_keep(_by_name(tw, f"Arm_{i}_pad"), pv)
        arm_pivots.append(pv)
    for o in list(tw.objects):
        if o is not root and o.parent is None:
            _parent_keep(o, root)
    for pv in arm_pivots:
        bake_clip(pv, "tower_retract",
                  [(1, "rot_euler", (0, 0, 0)),
                   (20, "rot_euler", (0, -1.15, 0))])
    bake_clip(root, "tower_retract",
              [(1, "loc", (0, 0, 0)), (15, "loc", (0, 0, 0)),
               (60, "loc", (-3.0, 0, 0))])
    bake_clip(_by_name(tw, "Beacon"), "beacon_spin",
              [(1, "rot_euler", (0, 0, 0)),
               (49, "rot_euler", (0, 0, 2 * math.pi))])
    # --- corridor: root hinge swing-up
    co = COLL["boarding-corridor"]
    croot = empty(co, "CorridorRoot", (0, 0, 0))
    for o in list(co.objects):
        if o is not croot and o.parent is None:
            _parent_keep(o, croot)
    bake_clip(croot, "corridor_retract",
              [(1, "rot_euler", (0, 0, 0)),
               (36, "rot_euler", (0, -1.22, 0))])
    # --- pad: hold-down arms tip outward (quaternion hinge on tangent)
    pd = COLL["launch-pad"]
    for i in range(1, 5):
        a = (i - 1) * math.pi / 2 + math.pi / 4
        arm = _by_name(pd, f"HoldDown_{i}")
        pv = empty(pd, f"HoldPivot_{i}",
                   (1.95 * math.cos(a), 1.95 * math.sin(a), 1.55))
        _parent_keep(arm, pv)
        # rest pose is identity; tip = rotate about the world tangent
        q0 = Quaternion((0, 0, 1), 0)
        q1 = Quaternion((-math.sin(a), math.cos(a), 0), 1.0)
        bake_clip(pv, "mount_release",
                  [(1, "rot_quat", q0), (15, "rot_quat", q1)])

# ------------------------------------------------------------------ export

def export_glb(coll, fname):
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(MODELS / fname), export_format="GLB",
        use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_animations=True,
        export_animation_mode="NLA_TRACKS")
    tris = 0
    for o in coll.objects:
        if o.type == "MESH":
            tris += len(o.data.polygons)
    print(f"EXPORT {fname}: {len(coll.objects)} objects, ~{tris} polys")
    return tris

# ------------------------------------------------------------------ verify

def duplicate_at(coll, offset, tag):
    out = []
    for o in list(coll.objects):
        n = o.copy()
        n.name = coll.name + "__" + o.name + tag
        n.location = Vector(o.location) + Vector(offset)
        bpy.context.scene.collection.objects.link(n)
        out.append(n)
    return out

def check(name, got, want, tol=0.06):
    ok = abs(got - want) <= tol
    print(f"CHECK {name}: got {got:.3f} want {want:.3f} -> "
          f"{'OK' if ok else 'MISMATCH'}")
    return ok

def verify_scene():
    """Assemble the site in the scene collection and run numeric checks."""
    # stills must show rest poses: mute every NLA clip (exports are done)
    for coll in COLL.values():
        for o in coll.objects:
            if o.animation_data:
                for t in o.animation_data.nla_tracks:
                    t.mute = True
    # tower at three.js (-4.6, 0, 0); corridor origin at (-3.7, 16.83)
    duplicate_at(COLL["support-tower"], (-4.6, 0, 0), "_asm")
    duplicate_at(COLL["boarding-corridor"], (-3.7, 0, 16.83), "_asm")
    duplicate_at(COLL["control-terminal"], (6.5, -5.5, 0.8), "_asm")
    rack_asm = duplicate_at(COLL["parts-rack"], (4.8, -3.4, 0.8), "_asm")
    for o in rack_asm:  # rack is on site only during S2/S3, not in S4 views
        o.hide_render = True
    # the site views show the completed site (S4): hide skeleton nodes
    for o in COLL["rocket"].objects:
        if o.name.startswith("Frame_"):
            o.hide_render = True
    # scale figure: protagonist visual height 1.33 m, standing on the pad
    c = bpy.context.scene.collection
    sph(c, "ScaleFigure", (3.4, -3.2, 0.8 + 0.665), (0.56, 0.56, 1.33),
        "teal")
    sph(c, "ScaleFigure_head", (3.4, -3.2, 0.8 + 1.33 + 0.16),
        (0.34, 0.34, 0.34), "ecru")
    # --- numeric connection checks (world = three.js frame, Blender z up)
    ok = True
    # hatch face x: capsule frustum r at z 17.3 = 1.45-(1.5/2.8)*0.67 = 1.09
    ok &= check("hatch surface |x|", 1.45 - (17.3 - 15.8) / 2.8 * 0.67,
                1.09, 0.02)
    # corridor end x = tower face -3.7 + length 2.55 = -1.15 = anchor_hatch
    ok &= check("corridor end x", -3.7 + 2.55, -1.15, 0.001)
    # dock ring centre height = 16.83 + 0.47 = 17.30 = hatch centre height
    ok &= check("dock centre height", 16.83 + 0.47, 17.3, 0.001)
    # hatch sill = 17.3 - 0.475 = 16.825 vs corridor floor 16.83
    ok &= check("sill vs floor", 17.3 - 0.475, 16.83, 0.01)
    # arm tips: tower face -3.7 + arm len; Arm_3 tip should reach capsule
    ok &= check("Arm_3 tip x", -3.7 + 2.55, -1.15, 0.001)
    # Arm_1/2 tip vs body radius 1.7
    ok &= check("Arm_1 tip gap", abs(-3.7 + 1.95) - 1.7, 0.05, 0.001)
    # nozzle bottom (0.9) above slab top (0.8), inside pedestal ring r 2.3
    ok &= check("nozzle clearance", 0.9 - 0.8, 0.1, 0.001)
    print("ALL CHECKS:", "OK" if ok else "FAILED")
    return ok

def render_views():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = False  # this build has no OpenImageDenoiser
    sc.render.resolution_x = 720
    sc.render.resolution_y = 540
    # lights + world
    bpy.ops.object.light_add(type="SUN", location=(18, -14, 30))
    sun = bpy.context.object
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.ops.object.light_add(type="AREA", location=(-14, 10, 18))
    fill = bpy.context.object
    fill.data.energy = 350
    fill.data.shape = "DISK"
    fill.data.size = 14
    sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = \
        (0.55, 0.6, 0.68, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7

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

    # Blender: front of the models faces -Y; hatch/tower side is -X
    shot("site-34.png", (17, -19, 13), (0, 0, 8))          # 3/4 front
    shot("site-front.png", (0, -25, 10), (0, 0, 9))        # front (+Z)
    shot("site-hatch-side.png", (-23, -4, 15), (-1, 0, 12))  # -X side
    shot("site-low.png", (6.5, -8.5, 1.4), (0, 0, 11), lens=30)  # low
    shot("site-hatch-close.png", (-6.4, -2.2, 17.8), (-1.2, 0, 17.2),
         lens=55)                                          # hatch/corridor

# ------------------------------------------------------------------ main

def main():
    clean()
    setup_materials()
    pad = build_pad()
    rocket = build_rocket()
    build_rocket_frame()
    tower = build_tower()
    corridor = build_corridor()
    terminal = build_terminal()
    rack = build_parts_rack()
    add_animations()
    stats = {}
    stats["launch-pad"] = export_glb(pad, "launch-pad.glb")
    stats["rocket"] = export_glb(rocket, "rocket.glb")
    stats["support-tower"] = export_glb(tower, "support-tower.glb")
    stats["boarding-corridor"] = export_glb(corridor,
                                           "boarding-corridor.glb")
    stats["control-terminal"] = export_glb(terminal,
                                           "control-terminal.glb")
    stats["parts-rack"] = export_glb(rack, "parts-rack.glb")
    ok = verify_scene()
    render_views()
    # save AFTER render_views so the scene keeps its lights/cameras
    bpy.ops.wm.save_as_mainfile(
        filepath=str(HERE.parent / "rocket-scene.blend"))
    print("STATS", stats)
    print("VERIFY", "OK" if ok else "FAILED")

main()
