#!/usr/bin/env python3
"""Build the C science equipment + spacesuit for the rocket set.

Run: blender -b -noaudio --python build_equipment.py
Exports GLBs to ../models and renders to ../previews.
Conventions match build_rocket.py (origin at ground centre, front
faces Blender -Y = +Z in Three.js, 1 unit = 1 m, Z up).
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent / "models"
PREVIEWS = HERE.parent / "previews"

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
    mat("ecru", (0.91, 0.875, 0.784), 0.85)
    mat("metal", (0.54, 0.55, 0.565), 0.55, 0.6)
    mat("metalDark", (0.33, 0.345, 0.36), 0.6, 0.5)
    mat("navy", (0.133, 0.212, 0.31), 0.7, 0.2)
    mat("teal", (0.114, 0.498, 0.482), 0.65, 0.2)
    mat("insul", (0.788, 0.659, 0.416), 0.95)
    mat("heat", (0.227, 0.216, 0.2), 0.7, 0.4)
    mat("amber", (0.765, 0.541, 0.18), 0.6, 0.2)
    mat("frame", (0.243, 0.29, 0.341), 0.6, 0.5)
    mat("glass", (0.165, 0.208, 0.259), 0.25, 0.6)
    mat("pcb", (0.05, 0.3, 0.26), 0.6, 0.1)
    mat("cell", (0.16, 0.17, 0.19), 0.5, 0.4)
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

def cyl(coll, name, loc, r, h, material, verts=20, r2=None):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r, radius2=r if r2 is None else r2,
        depth=h, location=loc)
    o = bpy.context.object
    o.name = name
    if material:
        o.data.materials.append(MAT[material])
    _link(o, coll)
    return o

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

def limb(coll, name, p0, p1, r0, r1, material):
    """Tapered tube between two points (limbs, pipes)."""
    a, b = Vector(p0), Vector(p1)
    mid = (a + b) / 2
    d = b - a
    o = cyl(coll, name, tuple(mid), r0, d.length, material, verts=14,
            r2=r1)
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return o

def loft(coll, name, rings, material, seg=16):
    """Smooth loft through elliptical rings [(z, rx, ry)], capped."""
    verts, faces = [], []
    for (z, rx, ry) in rings:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append((rx * math.cos(a), ry * math.sin(a), z))
    for r in range(len(rings) - 1):
        for i in range(seg):
            b0 = r * seg + i
            b1 = r * seg + (i + 1) % seg
            faces.append((b0, b1, b1 + seg, b0 + seg))
    bc = len(verts)
    verts.append((0, 0, rings[0][0] - 0.01))
    tc = len(verts)
    verts.append((0, 0, rings[-1][0] + 0.01))
    top0 = (len(rings) - 1) * seg
    for i in range(seg):
        faces.append((bc, (i + 1) % seg, i))
        faces.append((tc, top0 + i, top0 + (i + 1) % seg))
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

def export_glb(coll, fname):
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(MODELS / fname), export_format="GLB",
        use_selection=True, export_apply=True, export_yup=True,
        export_extras=True)
    print(f"EXPORT {fname}: {len(coll.objects)} objects")

# ---------------------------------------------------------------- equipment

def build_electronics_fab():
    c = collection("electronics-fab")  # 2.6 x 1.2 x 2.0
    box(c, "Cabinet", (0, 0, 0.5), (2.6, 1.1, 1.0), "navy")
    box(c, "WorkTop", (0, 0, 1.05), (2.6, 1.2, 0.1), "metalDark")
    # gantry frame + moving head over the bench
    for sx in (-1.2, 1.2):
        box(c, "GantryPost", (sx, 0, 1.55), (0.09, 0.09, 1.0), "frame")
    box(c, "GantryBeam", (0, 0, 2.0), (2.5, 0.12, 0.12), "frame")
    box(c, "GantryHead", (-0.4, 0, 1.82), (0.34, 0.3, 0.26), "teal")
    cyl(c, "Nozzle", (-0.4, 0, 1.62), 0.03, 0.16, "heat", verts=10,
        r2=0.012)
    # PCB on the bench with trace lines + components
    box(c, "PCB", (0.35, -0.1, 1.13), (1.1, 0.7, 0.03), "pcb")
    for i, (tx, tz) in enumerate(((-0.1, 0.0), (0.15, 0.12),
                                  (0.3, -0.1))):
        box(c, "Trace", (0.35 + tx, -0.1 + tz, 1.15), (0.34, 0.03, 0.012),
            "amber")
    for i, (cx, cy) in enumerate(((-0.2, 0.15), (0.05, -0.18),
                                  (0.28, 0.18))):
        box(c, "Chip", (0.35 + cx, -0.1 + cy, 1.17), (0.14, 0.12, 0.035),
            "cell")
    # parts spools + a bin on the left of the bench
    for i, sx in enumerate((-0.95, -0.7)):
        cyl(c, "Spool", (sx, -0.15, 1.28), 0.11, 0.16, "insul", verts=16)
    box(c, "PartsBin", (-0.85, 0.3, 1.2), (0.5, 0.35, 0.18), "teal")
    # status light stack on the cabinet end
    cyl(c, "LampBase", (1.15, 0.35, 1.2), 0.03, 0.2, "metal", verts=8)
    sph(c, "Lamp", (1.15, 0.35, 1.34), (0.075, 0.075, 0.075), "glowAmber")
    return c

def build_computer_bench():
    c = collection("computer-bench")  # 2.2 x 1.0 x 1.6
    box(c, "Desk", (0, 0, 0.78), (2.2, 1.0, 0.08), "metalDark")
    for sx in (-1.0, 1.0):
        for sy in (-0.4, 0.4):
            box(c, "Leg", (sx, sy, 0.37), (0.08, 0.08, 0.74), "frame")
    # open chassis with motherboard + fan
    box(c, "Chassis", (-0.55, 0, 1.1), (0.9, 0.55, 0.5), "metal")
    box(c, "Motherboard", (-0.55, -0.05, 1.12), (0.7, 0.4, 0.03), "pcb")
    for i in range(3):
        box(c, "SlotCard", (-0.75 + i * 0.2, -0.02, 1.22),
            (0.12, 0.3, 0.16), "teal" if i == 1 else "navy")
    cyl(c, "Fan", (-0.2, 0.29, 1.1), 0.16, 0.05, "cell", verts=20)
    # monitor on an arm, parts tray, loose module
    limb(c, "MonitorArm", (0.55, 0.35, 0.82), (0.55, 0.15, 1.35), 0.035,
         0.035, "frame")
    box(c, "Monitor", (0.55, 0.1, 1.45), (0.85, 0.05, 0.52), "metalDark",
        rot=(-0.12, 0, 0))
    box(c, "MonitorScreen", (0.55, 0.07, 1.45), (0.76, 0.02, 0.43),
        "screenGlow", rot=(-0.12, 0, 0))
    box(c, "Tray", (0.15, -0.25, 0.86), (0.5, 0.35, 0.05), "teal")
    box(c, "Module", (0.95, -0.2, 0.9), (0.3, 0.22, 0.1), "cell")
    return c

def build_test_terminal():
    c = collection("test-terminal")  # 1.4 x 0.9 x 1.7
    box(c, "Body", (0, 0, 0.75), (1.4, 0.85, 1.5), "navy")
    box(c, "ScreenPanel", (0, -0.28, 1.32), (1.15, 0.3, 0.6),
        "metalDark", rot=(-0.5, 0, 0))
    box(c, "Screen", (0, -0.36, 1.34), (1.0, 0.06, 0.46), "screenGlow",
        rot=(-0.5, 0, 0))
    # graph bars on the screen face (emissive blocks)
    for i, h in enumerate((0.1, 0.2, 0.15, 0.28, 0.22)):
        box(c, "GraphBar", (-0.36 + i * 0.18, -0.4, 1.2), (0.1, 0.02, h),
            "glowAmber", rot=(-0.5, 0, 0))
    # side rack with indicator dots + cable port row
    for r in range(3):
        for i in range(3):
            sph(c, "Dot", (0.45 + (i - 1) * 0.16, -0.44, 0.55 + r * 0.18),
                (0.035, 0.02, 0.035),
                "glowAmber" if (r + i) % 2 else "screenGlow")
    box(c, "Keyboard", (0, -0.5, 0.72), (1.0, 0.25, 0.05), "metal",
        rot=(-0.3, 0, 0))
    cyl(c, "FloorCable", (0.5, 0.3, 0.12), 0.035, 0.5, "heat", verts=8)
    return c

def build_suit_stand():
    c = collection("suit-stand")  # 1.6 x 1.2 x 2.2, suit hangs centre
    cyl(c, "Base", (0, 0, 0.05), 0.55, 0.1, "metalDark", verts=24)
    box(c, "Post", (0, 0.42, 1.1), (0.12, 0.12, 2.1), "frame")
    box(c, "CrossBar", (0, 0.32, 1.98), (1.1, 0.1, 0.1), "frame")
    limb(c, "ArmL", (-0.05, 0.38, 1.95), (-0.42, 0.1, 1.78), 0.04, 0.04,
         "frame")
    limb(c, "ArmR", (0.05, 0.38, 1.95), (0.42, 0.1, 1.78), 0.04, 0.04,
         "frame")
    # inspection panel post with lamp
    box(c, "PanelPost", (0.68, 0.3, 0.65), (0.08, 0.08, 1.3), "frame")
    box(c, "Panel", (0.68, 0.18, 1.38), (0.42, 0.06, 0.5), "metalDark",
        rot=(-0.25, 0, 0))
    box(c, "PanelScreen", (0.68, 0.14, 1.4), (0.34, 0.02, 0.3),
        "screenGlow", rot=(-0.25, 0, 0))
    limb(c, "LampArm", (0.68, 0.3, 1.32), (0.3, 0.05, 1.8), 0.025, 0.025,
         "frame")
    sph(c, "Lamp", (0.28, 0.03, 1.84), (0.07, 0.07, 0.07), "glowAmber")
    # umbilical cable coiled at the base
    bpy.ops.mesh.primitive_torus_add(major_radius=0.2, minor_radius=0.028,
                                     location=(-0.45, 0.25, 0.1))
    o = bpy.context.object
    o.name = "CableCoil"
    o.data.materials.append(MAT["heat"])
    _link(o, c)
    return c

def build_life_support():
    c = collection("life-support")  # 2.0 x 1.0 x 1.9
    box(c, "Base", (0, 0, 0.12), (2.0, 1.0, 0.24), "metalDark")
    # two capsule tanks
    for i, sx in enumerate((-0.5, 0.15)):
        cyl(c, "Tank", (sx, 0, 1.0), 0.3, 1.3, "ecru", verts=20)
        sph(c, "TankCap", (sx, 0, 1.65), (0.6, 0.6, 0.35), "ecru")
        cyl(c, "TankBand", (sx, 0, 1.0), 0.315, 0.1, "teal", verts=20)
    # manifold pipes + valve wheels + gauges on the right block
    box(c, "PumpBlock", (0.72, 0, 0.75), (0.55, 0.8, 1.05), "teal")
    limb(c, "Pipe", (-0.5, 0, 1.72), (0.72, 0, 1.72), 0.045, 0.045,
         "metal")
    limb(c, "Pipe", (0.15, 0, 1.72), (0.72, 0, 1.72), 0.045, 0.045,
         "metal")
    limb(c, "PipeLow", (-0.5, -0.2, 0.45), (0.45, -0.2, 0.45), 0.04,
         0.04, "metal")
    limb(c, "PipeDrop", (0.72, 0, 1.72), (0.72, 0, 1.3), 0.045, 0.045,
         "metal")
    for i, gx in enumerate((0.58, 0.86)):
        g = cyl(c, "Gauge", (gx, -0.42, 1.1), 0.07, 0.03, "glass",
                verts=14)
        g.rotation_euler = (math.pi / 2, 0, 0)
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.09, minor_radius=0.018,
            location=(gx, -0.44, 0.78), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.object
        o.name = "Valve"
        o.data.materials.append(MAT["amber"])
        _link(o, c)
    return c

def build_power_distribution():
    c = collection("power-distribution")  # 2.2 x 0.8 x 1.9
    # battery rack: frame + 3 shelves of cells
    for sx in (-1.05, 1.05):
        box(c, "Post", (sx, 0, 0.95), (0.08, 0.08, 1.9), "frame")
    for z in (0.15, 0.75, 1.35):
        box(c, "Shelf", (-0.35, 0, z), (1.35, 0.7, 0.06), "metalDark")
        for i in range(3):
            box(c, "Cell", (-0.85 + i * 0.45, 0, z + 0.3),
                (0.36, 0.55, 0.52), "cell")
            box(c, "CellCap", (-0.85 + i * 0.45, 0, z + 0.58),
                (0.3, 0.45, 0.04), "teal")
    box(c, "RackTop", (-0.35, 0, 1.9), (1.35, 0.7, 0.06), "metalDark")
    # distribution panel on the right with breakers + bus bar
    box(c, "Panel", (0.82, 0, 1.0), (0.62, 0.75, 1.85), "navy")
    box(c, "BusBar", (0.82, -0.4, 1.62), (0.5, 0.03, 0.08), "amber")
    for r in range(3):
        for i in range(2):
            box(c, "Breaker", (0.68 + i * 0.28, -0.4, 1.3 - r * 0.32),
                (0.16, 0.04, 0.2), "metal" if (r + i) % 2 else "heat")
    sph(c, "PanelLamp", (0.82, -0.4, 1.82), (0.04, 0.03, 0.04),
        "screenGlow")
    # thick cable duct along the floor to the left
    box(c, "Duct", (-0.35, 0.42, 0.06), (1.5, 0.14, 0.12), "heat")
    return c

# ---------------------------------------------------------------- spacesuit

def build_spacesuit():
    c = collection("spacesuit-display")  # worn height ~1.51 m
    # torso: shaped loft (hips -> waist -> chest -> shoulders -> neck)
    loft(c, "Torso", [(0.72, 0.21, 0.15), (0.88, 0.19, 0.135),
                      (1.05, 0.235, 0.16), (1.18, 0.22, 0.15),
                      (1.24, 0.09, 0.09)], "ecru")
    cyl(c, "Belt", (0, 0, 0.75), 0.2, 0.07, "navy", verts=18)
    # chest control pack with two status dots
    box(c, "ChestPack", (0, -0.165, 1.03), (0.2, 0.06, 0.17), "teal")
    sph(c, "ChestDot", (-0.05, -0.2, 1.07), (0.03, 0.015, 0.03),
        "screenGlow")
    sph(c, "ChestDot", (0.05, -0.2, 1.07), (0.03, 0.015, 0.03),
        "glowAmber")
    # legs: tapered lofts + knee joints + boots
    for side, sx in (("L", -0.11), ("R", 0.11)):
        leg = loft(c, f"Leg{side}", [(0.14, 0.078, 0.07),
                                     (0.45, 0.062, 0.058),
                                     (0.74, 0.088, 0.08)], "ecru")
        leg.location.x = sx
        sph(c, f"Knee{side}", (sx, -0.01, 0.45), (0.125, 0.125, 0.125),
            "navy")
        box(c, f"Boot{side}", (sx, -0.04, 0.055), (0.12, 0.24, 0.11),
            "navy")
        sph(c, f"Boot{side}Toe", (sx, -0.15, 0.045), (0.12, 0.13, 0.09),
            "navy")
    # arms: shoulder -> elbow -> wrist, slight outward hang
    for side, sx in (("L", -1), ("R", 1)):
        sph(c, f"Shoulder{side}", (sx * 0.25, 0, 1.13),
            (0.17, 0.17, 0.17), "ecru")
        limb(c, f"Arm{side}Upper", (sx * 0.26, 0, 1.12),
             (sx * 0.35, 0, 0.9), 0.06, 0.053, "ecru")
        sph(c, f"Elbow{side}", (sx * 0.35, 0, 0.9), (0.11, 0.11, 0.11),
            "navy")
        limb(c, f"Arm{side}Fore", (sx * 0.35, 0, 0.9),
             (sx * 0.39, 0, 0.67), 0.05, 0.043, "ecru")
        sph(c, f"Glove{side}", (sx * 0.4, 0, 0.58), (0.15, 0.15, 0.21),
            "navy")
    # backpack: life-support block + twin tanks + stripe + antenna
    box(c, "Backpack", (0, 0.2, 1.0), (0.37, 0.18, 0.52), "metal")
    box(c, "BackpackStripe", (0, 0.3, 1.12), (0.37, 0.02, 0.1), "teal")
    for sx in (-0.09, 0.09):
        cyl(c, "BackTank", (sx, 0.21, 1.02), 0.055, 0.42, "ecru",
            verts=12)
    limb(c, "Antenna", (0.14, 0.24, 1.26), (0.2, 0.28, 1.52), 0.008,
         0.008, "metalDark")
    sph(c, "AntennaTip", (0.2, 0.28, 1.53), (0.025, 0.025, 0.025),
        "glowAmber")
    # helmet + visor + neck ring
    cyl(c, "NeckRing", (0, 0, 1.25), 0.105, 0.07, "navy", verts=16)
    sph(c, "Helmet", (0, 0, 1.35), (0.33, 0.33, 0.34), "ecru")
    sph(c, "Visor", (0, -0.05, 1.36), (0.27, 0.27, 0.28), "glass")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.115,
                                     minor_radius=0.014,
                                     location=(0, -0.165, 1.36),
                                     rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.name = "VisorRim"
    o.data.materials.append(MAT["amber"])
    _link(o, c)
    # helmet side lamp
    sph(c, "HelmetLamp", (-0.15, -0.06, 1.44), (0.045, 0.045, 0.045),
        "glowAmber")
    return c

# ---------------------------------------------------------------- renders

def render_all(equip, suit, stand):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = False
    sc.render.resolution_x = 640
    sc.render.resolution_y = 480
    bpy.ops.object.light_add(type="SUN", location=(6, -5, 9))
    sun = bpy.context.object
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.ops.object.light_add(type="AREA", location=(-5, 4, 6))
    fill = bpy.context.object
    fill.data.energy = 250
    fill.data.shape = "DISK"
    fill.data.size = 8
    sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = \
        (0.55, 0.6, 0.68, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7

    def shot(name, loc, target, lens=46):
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.object
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens
        sc.camera = cam
        sc.render.filepath = str(PREVIEWS / name)
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)

    def show_only(colls):
        for c in COLL.values():
            for o in c.objects:
                o.hide_render = c not in colls

    for coll in equip:
        show_only([coll])
        shot(f"equip-{coll.name}.png", (2.6, -2.9, 1.9), (0, 0, 0.8))
    show_only([suit, stand])
    t = (0, 0, 0.82)
    shot("suit-front.png", (0, -3.3, 1.05), t, lens=52)
    shot("suit-back.png", (0, 3.3, 1.05), t, lens=52)
    shot("suit-left.png", (-3.3, 0, 1.05), t, lens=52)
    shot("suit-right.png", (3.3, 0, 1.05), t, lens=52)
    shot("suit-diag-front.png", (-2.3, -2.3, 1.5), t, lens=52)
    shot("suit-diag-back.png", (2.3, 2.3, 1.5), t, lens=52)
    print("EQUIP RENDERS DONE")

# ---------------------------------------------------------------- main

def main():
    import sys
    only = set()
    if "--" in sys.argv:
        only = set(sys.argv[sys.argv.index("--") + 1:])
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    setup_materials()
    builders = [("electronics-fab", build_electronics_fab),
                ("computer-bench", build_computer_bench),
                ("test-terminal", build_test_terminal),
                ("suit-stand", build_suit_stand),
                ("life-support", build_life_support),
                ("power-distribution", build_power_distribution)]
    equip = [fn() for name, fn in builders if not only or name in only]
    suit = None
    if not only or "spacesuit-display" in only:
        suit = build_spacesuit()
    for coll in equip:
        export_glb(coll, coll.name + ".glb")
    if suit is not None:
        export_glb(suit, "spacesuit-display.glb")
    if not only:
        render_all(equip, suit, COLL["suit-stand"])
        bpy.ops.wm.save_as_mainfile(
            filepath=str(HERE.parent / "equipment-scene.blend"))
    elif suit is None and len(equip) == 1:
        # single-equipment re-render
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.samples = 48
        sc.cycles.device = "CPU"
        sc.cycles.use_denoising = False
        sc.render.resolution_x = 640
        sc.render.resolution_y = 480
        bpy.ops.object.light_add(type="SUN", location=(6, -5, 9))
        sun = bpy.context.object
        sun.data.energy = 3.2
        sun.rotation_euler = (math.radians(50), 0, math.radians(35))
        sc.world = bpy.data.worlds.new("W")
        sc.world.use_nodes = True
        sc.world.node_tree.nodes["Background"].inputs[0].default_value = \
            (0.55, 0.6, 0.68, 1)
        sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
        bpy.ops.object.camera_add(location=(2.6, -2.9, 1.9))
        cam = bpy.context.object
        d = Vector((0, 0, 0.8)) - Vector((2.6, -2.9, 1.9))
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = 46
        sc.camera = cam
        sc.render.filepath = str(PREVIEWS / f"equip-{equip[0].name}.png")
        bpy.ops.render.render(write_still=True)
        print("SINGLE RERENDER DONE")

main()
