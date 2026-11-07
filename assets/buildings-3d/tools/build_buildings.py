#!/usr/bin/env python3
"""Build the 13 placeable structures of 'Zero kara no Kagaku' as GLB.

Run:  blender -b -noaudio --python build_buildings.py -- <outdir>
      (add --render to also write a 3/4-view PNG per model; needs a
      display, e.g. Xvfb, for EEVEE)

Conventions (match the game's StructureRenderer):
  - origin at the ground contact centre, 1 unit = 1 m;
  - the model's front faces Blender -Y, which the glTF exporter maps
    to +Z in Three.js — the side the game's doors/mouths already use;
  - moving parts are separate nodes: 'Wheel' (waterwheel / flywheel,
    spins on its local Z in Three.js, same convention as the current
    procedural models), 'Piston' (slides), 'DrillPipe' (turns),
    'Flame' (flickers, kept apart from the body);
  - flames / glow are their own objects with emissive materials;
    smoke is NOT modelled (the game plays its smoke effect).
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
TEX = HERE.parent / "textures"

# ------------------------------------------------------------------ utils

def clean():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.curves):
        pass


def mat(name, tex=None, color=None, sx=1.0, sy=1.0, rough=0.92,
        metal=0.0, emissive=None, ei=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if color:
        bsdf.inputs["Base Color"].default_value = (*color, 1)
    if tex:
        img = bpy.data.images.load(str(TEX / tex))
        img.colorspace_settings.name = "sRGB"
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        tc = m.node_tree.nodes.new("ShaderNodeTexCoord")
        mp = m.node_tree.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (sx, sy, 1)
        m.node_tree.links.new(tc.outputs["UV"], mp.inputs["Vector"])
        m.node_tree.links.new(mp.outputs["Vector"], node.inputs["Vector"])
        m.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1)
        bsdf.inputs["Emission Strength"].default_value = ei
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "DITHERED"  # Blender >= 4.2
        except Exception:
            m.blend_method = "BLEND"  # Blender 4.0
    return m


M = {}


def setup_materials():
    M.update(
        wood=mat("wood", "wood_planks.png", sx=1.4, sy=1.4),
        wood1=mat("wood1", "wood_planks.png", sx=0.7, sy=0.7),
        bark=mat("bark", "bark.png", sx=1.2, sy=1.2),
        stone=mat("stone", "stone_blocks.png", sx=1.5, sy=1.5),
        stone1=mat("stone1", "stone_blocks.png", sx=0.8, sy=0.8),
        stone_dark=mat("stoneDark", "stone_dark.png", sx=1.2, sy=1.2),
        claybrick=mat("clayBrick", "clay_brick.png", sx=1.6, sy=1.6),
        redbrick=mat("redBrick", "red_brick.png", sx=3.0, sy=2.6),
        earth=mat("earth", "earth_clay.png", sx=1.3, sy=1.3),
        thatch=mat("thatch", "thatch.png", sx=1.6, sy=1.6),
        tile=mat("tile", "roof_tile.png", sx=2.0, sy=1.4),
        steel=mat("steel", "steel.png", sx=1.0, sy=1.0, rough=0.5, metal=0.35),
        iron=mat("iron", "iron_dark.png", sx=1.0, sy=1.0, rough=0.55, metal=0.35),
        copper=mat("copper", "copper.png", sx=1.0, sy=1.0, rough=0.45, metal=0.45),
        panel=mat("roofPanel", "roof_panel.png", sx=1.6, sy=1.6, rough=0.6, metal=0.15),
        tilewall=mat("tileWall", "tile_wall.png", sx=1.8, sy=1.8),
        brass=mat("brass", color=(0.62, 0.45, 0.2), rough=0.4, metal=0.55),
        dark=mat("dark", color=(0.13, 0.12, 0.11), rough=1.0),
        soot=mat("soot", color=(0.13, 0.12, 0.11), rough=1.0),
        ash=mat("ash", color=(0.35, 0.33, 0.3), rough=1.0),
        rockgray=mat("rockGray", color=(0.45, 0.43, 0.4), rough=1.0),
        rope=mat("rope", color=(0.62, 0.52, 0.34), rough=1.0),
        canvas=mat("canvas", color=(0.45, 0.34, 0.2), rough=1.0),
        glass=mat("glass", color=(0.62, 0.8, 0.85), rough=0.15, metal=0.1, alpha=0.45),
        liquid=mat("liquid", color=(0.8, 0.42, 0.08), rough=0.25,
                   emissive=(1.0, 0.45, 0.1), ei=0.35),
        glow=mat("glow", color=(1.0, 0.55, 0.12), emissive=(1.0, 0.5, 0.08), ei=1.1),
        flame=mat("flame", color=(0.2, 0.05, 0.005), emissive=(1.0, 0.22, 0.02), ei=1.2),
        flame_core=mat("flameCore", color=(0.25, 0.12, 0.02), emissive=(1.0, 0.5, 0.08), ei=1.25),
        winlit=mat("winLit", color=(0.95, 0.68, 0.32), emissive=(1.0, 0.62, 0.25), ei=0.85),
        water=mat("water", color=(0.25, 0.5, 0.62), rough=0.2, alpha=0.8),
        white=mat("white", color=(0.92, 0.91, 0.88), rough=0.7),
        leaf=mat("leaf", color=(0.35, 0.45, 0.22), rough=1.0),
    )


def root(name):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    return e


def _finish(obj, material, bevel=0.0, parent=None):
    if material:
        obj.data.materials.append(material)
    obj.rotation_mode = "XYZ"
    if bevel > 0 and obj.type == "MESH":
        mod = obj.modifiers.new("soft", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    if parent:
        obj.parent = parent
    return obj


def box(name, loc, scale, material, rot=(0, 0, 0), bevel=0.015, parent=None):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.dimensions = scale
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, material, bevel, parent)


def cyl(name, loc, r, h, material, verts=14, r2=None, rot=(0, 0, 0), bevel=0.0, parent=None):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r, radius2=r if r2 is None else r2,
        depth=h, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return _finish(o, material, bevel, parent)


def cone(name, loc, r, h, material, verts=14, rot=(0, 0, 0), parent=None):
    return cyl(name, loc, r, h, material, verts=verts, r2=0.0, rot=rot, parent=parent)


def dome(name, loc, r, material, sy=1.0, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=12, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = (1, 1, sy)
    bpy.ops.object.transform_apply(scale=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    faces = [f for f in bm.faces if sum(v.co.z for v in f.verts) / len(f.verts) < -0.01]
    bmesh.ops.delete(bm, geom=faces, context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    return _finish(o, material, 0, parent)


def torus(name, loc, R, r, material, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r,
                                     major_segments=20, minor_segments=8,
                                     location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return _finish(o, material, 0, parent)


def pipe(name, p1, p2, r, material, parent=None, verts=10):
    p1, p2 = Vector(p1), Vector(p2)
    mid = (p1 + p2) / 2
    d = p2 - p1
    o = cyl(name, tuple(mid), r, d.length, material, verts=verts, parent=parent)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return o


def flame_group(parent, loc, s=1.0):
    g = root("Flame")
    g.location = loc
    g.parent = parent
    cone("flameOuter", (0, 0, 0.3 * s), 0.2 * s, 0.62 * s, M["flame"], verts=9, parent=g)
    cone("flameInner", (0.03, 0.02, 0.2 * s), 0.11 * s, 0.4 * s, M["flame_core"], verts=8, parent=g)
    side = cone("flameSide", (0.1 * s, 0.05 * s, 0.2 * s), 0.09 * s, 0.38 * s,
                M["flame"], verts=7, parent=g)
    side.rotation_euler = (0.16, 0, -0.14)
    return g


# ------------------------------------------------------------------ models
# Front = -Y. All heights are +Z from the ground origin.

def build_workbench():
    g = root("workbench")
    # thick plank top on log legs, rope lashings (image: rustic bench
    # with stone tools, hide, baskets — no modern tools)
    box("top", (0, 0, 0.86), (2.2, 1.05, 0.11), M["wood"], bevel=0.02, parent=g)
    for sx in (-0.95, 0.95):
        for sy in (-0.38, 0.38):
            cyl("leg", (sx, sy, 0.42), 0.085, 0.84, M["bark"], verts=10, parent=g)
            torus("lash", (sx, sy, 0.72), 0.095, 0.022, M["rope"],
                  rot=(0, 0, 0), parent=g).rotation_euler = (0, 0, 0)
    box("shelf", (0, 0, 0.3), (1.9, 0.8, 0.07), M["wood1"], parent=g)
    # stone tools on top: hammer, two blades, a stone block
    cyl("hammerHandle", (-0.55, -0.15, 0.95), 0.03, 0.42, M["bark"], verts=8,
        rot=(math.radians(90), 0, 0.5), parent=g)
    box("hammerHead", (-0.72, -0.28, 0.97), (0.2, 0.13, 0.13), M["stone1"], bevel=0.03, parent=g)
    for i, dx in enumerate((0.05, 0.28)):
        b = box("blade", (dx, -0.2 + i * 0.05, 0.94), (0.3, 0.09, 0.03), M["stone_dark"],
                rot=(0, 0, 0.4 + i * 0.3), bevel=0.01, parent=g)
    box("hide", (0.62, 0.12, 0.93), (0.62, 0.5, 0.02), M["canvas"], rot=(0, 0, 0.15), parent=g)
    # basket of stones (simple lathe-ish cylinder) + logs under shelf
    cyl("basket", (-0.78, 0.28, 1.06), 0.17, 0.24, M["rope"], verts=10, r2=0.13, parent=g)
    for i in range(3):
        a = i * 2.1
        sph = bpy.ops.mesh.primitive_ico_sphere_add(radius=0.055, location=(-0.78 + 0.06 * math.cos(a), 0.28 + 0.06 * math.sin(a), 1.18))
        o = bpy.context.object
        o.name = "basketStone"
        _finish(o, M["stone_dark"], 0, g)
    for i in range(3):
        cyl("logStore", (-0.5 + i * 0.16, 0.1, 0.12), 0.07, 0.7, M["bark"], verts=9,
            rot=(math.radians(90), 0, 0), parent=g)
    return g


def build_campfire():
    g = root("campfire")
    import random
    rnd = random.Random(7)
    for i in range(9):  # irregular stone ring
        a = i / 9 * math.tau + rnd.uniform(-0.1, 0.1)
        r = 0.62 + rnd.uniform(-0.05, 0.06)
        bpy.ops.mesh.primitive_ico_sphere_add(
            radius=rnd.uniform(0.13, 0.19), subdivisions=1,
            location=(r * math.cos(a), r * math.sin(a), 0.09))
        o = bpy.context.object
        o.name = "ringStone"
        o.scale = (1, 0.85, 0.7)
        bpy.ops.object.transform_apply(scale=True)
        _finish(o, M["rockgray"], 0, g)
    # ash bed + charred logs
    cyl("ash", (0, 0, 0.03), 0.52, 0.06, M["ash"], verts=16, parent=g)
    for i in range(3):
        a = i * 1.1 + 0.4
        cyl("log", (0.08 * math.cos(a), 0.08 * math.sin(a), 0.14), 0.055, 0.78, M["soot"],
            verts=8, rot=(math.radians(90), 0, a), parent=g)
    flame_group(g, (0, 0, 0.1), 1.0)
    return g


def build_kiln():
    g = root("kiln")
    # clay-brick dome kiln on a stone base ring, wooden brace poles,
    # arched fire mouth with glow, top vent (image-faithful)
    cyl("base", (0, 0, 0.16), 1.08, 0.32, M["stone"], verts=18, parent=g)
    dome("dome", (0, 0, 0.3), 0.98, M["claybrick"], sy=1.12, parent=g)
    cyl("vent", (0, 0, 1.48), 0.13, 0.22, M["claybrick"], verts=12, parent=g)
    # fire mouth: dark arch inset + glow + logs, on the front (-Y)
    box("mouth", (0, -0.97, 0.45), (0.52, 0.18, 0.68), M["dark"], bevel=0.05, parent=g)
    box("mouthGlow", (0, -1.05, 0.42), (0.38, 0.06, 0.42), M["glow"], parent=g)
    for i in range(2):
        cyl("mouthLog", (-0.08 + i * 0.16, -1.0, 0.22), 0.045, 0.4, M["soot"], verts=7,
            rot=(math.radians(90), 0, 0.3 * i), parent=g)
    # brace poles lashed with rope, leaning on the dome
    for sx in (-1, 1):
        p = pipe("brace", (sx * 1.18, 0.3, 0.02), (sx * 0.8, 0.18, 1.02), 0.05, M["bark"], parent=g, verts=8)
        pipe("braceB", (sx * 1.18, -0.35, 0.02), (sx * 0.82, -0.2, 0.95), 0.05, M["bark"], parent=g, verts=8)
        torus("braceLash", (sx * 0.82, 0.02, 0.55), 0.09, 0.02, M["rope"], parent=g)
    return g


def build_hut():
    g = root("hut")
    # stone footing, earth walls with timber posts, thatch roof,
    # doorway on the front, small barred window
    box("footing", (0, 0, 0.14), (3.3, 2.7, 0.28), M["stone"], parent=g)
    box("walls", (0, 0, 1.12), (3.1, 2.5, 1.7), M["earth"], bevel=0.03, parent=g)
    for sx in (-1.5, 1.5):
        for sy in (-1.2, 1.2):
            cyl("post", (sx, sy, 1.05), 0.075, 2.1, M["bark"], verts=9, parent=g)
    box("beamF", (0, -1.28, 1.98), (3.3, 0.12, 0.12), M["bark"], parent=g)
    box("beamB", (0, 1.28, 1.98), (3.3, 0.12, 0.12), M["bark"], parent=g)
    # thatch roof: two slabs + ridge logs
    for s in (-1, 1):
        r = box("roof", (0, s * 0.78, 2.5), (3.7, 1.95, 0.14), M["thatch"],
                rot=(-s * math.radians(38), 0, 0), bevel=0.03, parent=g)
    cyl("ridge", (0, 0, 3.06), 0.07, 3.8, M["bark"], verts=9,
        rot=(0, math.radians(90), 0), parent=g)
    for dx in (-1.4, 0, 1.4):
        cyl("ridgeTie", (dx, 0, 3.12), 0.045, 0.5, M["bark"], verts=7,
            rot=(math.radians(90), 0, 0), parent=g)
    # doorway (front, -Y): dark opening + lintel + step stone
    box("door", (0.45, -1.26, 0.95), (0.78, 0.06, 1.55), M["dark"], parent=g)
    box("lintel", (0.45, -1.3, 1.78), (1.0, 0.12, 0.14), M["bark"], parent=g)
    box("step", (0.45, -1.55, 0.06), (0.95, 0.5, 0.12), M["stone1"], parent=g)
    # small window with wooden bars on the front-left
    box("winFrame", (-0.85, -1.27, 1.25), (0.55, 0.07, 0.55), M["wood1"], parent=g)
    box("winDark", (-0.85, -1.29, 1.25), (0.44, 0.05, 0.44), M["dark"], parent=g)
    for dx in (-0.12, 0.12):
        box("winBar", (-0.85 + dx, -1.32, 1.25), (0.05, 0.04, 0.46), M["bark"], parent=g)
    return g


def build_smelter():
    g = root("smelter")
    # refractory furnace: stone base course, tapered clay shaft with
    # soot-blackened top, fire mouth with glow at the front, a big
    # wooden bellows on a frame at the side, tap channel, coal basket
    cyl("base", (0, 0, 0.3), 1.15, 0.6, M["stone"], verts=16, parent=g)
    cyl("shaft", (0, 0, 1.35), 0.95, 1.6, M["claybrick"], verts=14, r2=0.6, parent=g)
    cyl("shaftTop", (0, 0, 2.2), 0.6, 0.18, M["soot"], verts=14, parent=g)
    cyl("mouthRing", (0, -0.88, 0.62), 0.3, 0.25, M["stone_dark"], verts=12,
        rot=(math.radians(90), 0, 0), parent=g)
    box("mouthGlow", (0, -0.97, 0.62), (0.36, 0.08, 0.3), M["glow"], parent=g)
    # tap channel running out of the mouth
    box("tap", (0, -1.25, 0.1), (0.22, 0.7, 0.08), M["stone_dark"], parent=g)
    box("tapGlow", (0, -1.3, 0.15), (0.1, 0.55, 0.03), M["liquid"], parent=g)
    # bellows: two tapered boards + leather middle, nozzle into shaft
    bg = root("Bellows")
    bg.location = (1.55, -0.2, 0)
    bg.rotation_euler = (0, 0, math.radians(-18))
    bg.parent = g
    box("belTop", (0, 0, 0.78), (0.85, 0.62, 0.07), M["wood1"], rot=(0, math.radians(-9), 0), parent=bg)
    box("belMid", (0, 0, 0.62), (0.8, 0.56, 0.24), M["canvas"], parent=bg)
    box("belBot", (0, 0, 0.46), (0.85, 0.62, 0.07), M["wood1"], rot=(0, math.radians(9), 0), parent=bg)
    cyl("nozzle", (-0.55, 0, 0.6), 0.05, 0.5, M["iron"], verts=9,
        rot=(0, math.radians(90), 0), parent=bg)
    for sx in (-0.55, 0.55):  # support frame
        box("belPost", (sx + 1.55, -0.2, 0.35), (0.09, 0.09, 0.7), M["bark"], parent=g)
    box("belBeam", (1.55, -0.2, 0.72), (1.3, 0.09, 0.09), M["bark"], parent=g)
    # coal pile + basket
    cyl("basket", (-1.15, -0.75, 0.16), 0.3, 0.32, M["rope"], verts=11, r2=0.24, parent=g)
    import random
    rnd = random.Random(3)
    for i in range(6):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.09, subdivisions=1,
                                              location=(-1.15 + rnd.uniform(-0.14, 0.14),
                                                        -0.75 + rnd.uniform(-0.14, 0.14), 0.34))
        o = bpy.context.object
        o.name = "coal"
        _finish(o, M["soot"], 0, g)
    return g


def build_laboratory():
    g = root("laboratory")
    # half-timbered lab house, open front lined with shelves, flasks
    # and a copper still over a small hearth (image: cutaway lab)
    box("floor", (0, 0, 0.09), (4.3, 3.1, 0.18), M["stone1"], parent=g)
    box("backWall", (0, 1.45, 1.35), (4.2, 0.14, 2.5), M["earth"], parent=g)
    for sx in (-2.05, 2.05):
        box("sideWall", (sx, 0.4, 1.35), (0.14, 2.2, 2.5), M["earth"], parent=g)
        cyl("cornerPost", (sx, -0.6, 1.35), 0.08, 2.7, M["bark"], verts=9, parent=g)
        cyl("cornerPostB", (sx, 1.42, 1.35), 0.08, 2.7, M["bark"], verts=9, parent=g)
    box("beamTop", (0, -0.62, 2.62), (4.3, 0.14, 0.16), M["bark"], parent=g)
    for s in (-1, 1):  # tile roof; front slope is a short cutaway
        if s < 0:
            box("roof", (0, -0.3, 3.45), (4.6, 1.15, 0.1), M["tile"],
                rot=(math.radians(34), 0, 0), bevel=0.02, parent=g)
        else:
            box("roof", (0, 0.82, 3.15), (4.6, 2.0, 0.1), M["tile"],
                rot=(-math.radians(34), 0, 0), bevel=0.02, parent=g)
    cyl("chimney", (-1.6, 1.1, 3.3), 0.16, 0.8, M["stone1"], verts=10, parent=g)
    # work table with flasks
    box("table", (-0.5, -0.15, 0.95), (2.4, 0.85, 0.09), M["wood"], parent=g)
    for sx in (-1.55, 0.6):
        for sy in (-0.45, 0.15):
            box("tableLeg", (sx, sy, 0.48), (0.1, 0.1, 0.9), M["bark"], parent=g)
    for i, (fx, fz, fm) in enumerate(((-1.3, 1.25, "liquid"), (-0.85, 1.2, "glass"), (-0.2, 1.28, "copper"))):
        if fm == "copper":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.17,
                                                 location=(fx, 0.05, fz))
            o = bpy.context.object
            o.name = "stillPot"
            _finish(o, M["copper"], 0, g)
            pipe("stillNeck", (fx, 0.05, fz + 0.15), (fx + 0.3, 0.05, fz + 0.42), 0.035, M["copper"], parent=g)
        else:
            cone("flask", (fx, 0.05, fz - 0.12), 0.13, 0.3, M["glass"], verts=10, parent=g)
            cyl("flaskNeck", (fx, 0.05, fz + 0.12), 0.045, 0.14, M["glass"], verts=8, parent=g)
            if fm == "liquid":
                cone("flaskLiquid", (fx, 0.05, fz - 0.16), 0.1, 0.18, M["liquid"], verts=10, parent=g)
    # back shelves with jars/bottles
    for lvl, lz in enumerate((1.5, 2.05)):
        box("shelf", (0.9, 1.32, lz), (2.2, 0.08, 0.07), M["wood1"], parent=g)
        for i in range(4):
            jx = 0.1 + i * 0.5 + lvl * 0.12
            cyl("jar", (jx, 1.32, lz + 0.16), 0.09, 0.24, M["glass"] if i % 2 else M["earth"],
                verts=9, r2=0.07, parent=g)
    # small hearth at the right end
    box("hearth", (1.55, 0.75, 0.3), (0.9, 0.8, 0.6), M["stone1"], parent=g)
    box("hearthGlow", (1.55, 0.42, 0.32), (0.4, 0.06, 0.3), M["glow"], parent=g)
    box("barrel", (-1.8, 0.9, 0.32), (0.5, 0.5, 0.64), M["wood1"], bevel=0.06, parent=g)
    return g


def _spoked_wheel(parent, loc, R, rim_mat, spoke_mat, n_spokes=6,
                  paddle_w=0.0, name="Wheel"):
    """Wheel lying in the XZ plane in Blender space (axle along Y),
    which exports to the XY plane in glTF/Three.js with the spin axis
    on local Z — the module's existing 'Wheel' convention."""
    w = root(name)
    w.location = loc
    w.parent = parent
    torus("rim", (0, 0, 0), R, R * 0.075, rim_mat, rot=(math.radians(90), 0, 0), parent=w)
    torus("rimIn", (0, 0, 0), R * 0.58, R * 0.05, rim_mat, rot=(math.radians(90), 0, 0), parent=w)
    for k in range(n_spokes):
        a = k * math.pi / n_spokes
        s = box("spoke", (0, 0, 0), (R * 0.07, 0.05, R * 1.92), spoke_mat, parent=w)
        s.rotation_euler = (0, a, 0)
    cyl("hub", (0, 0, 0), R * 0.16, 0.16, spoke_mat, verts=10,
        rot=(math.radians(90), 0, 0), parent=w)
    if paddle_w > 0:
        for k in range(n_spokes * 2):
            a = k * math.tau / (n_spokes * 2)
            p = box("paddle", (math.sin(a) * R, 0, math.cos(a) * R),
                    (0.14, paddle_w, 0.34), rim_mat, parent=w)
            p.rotation_euler = (0, a, 0)
    return w


def build_steam_engine():
    g = root("steam-engine")
    # stationary engine: stone base, horizontal boiler with brass
    # bands, tall chimney, cylinder + sliding piston rod, big spoked
    # flywheel on a pedestal (image-faithful; NOT a locomotive)
    box("base", (0, 0, 0.14), (2.7, 1.35, 0.28), M["stone"], parent=g)
    cyl("boiler", (-0.45, 0, 1.0), 0.46, 1.5, M["iron"], verts=16,
        rot=(0, math.radians(90), 0), parent=g)
    for dx in (-0.95, -0.45, 0.05):
        torus("boilerBand", (dx, 0, 1.0), 0.47, 0.03, M["brass"],
              rot=(0, math.radians(90), 0), parent=g)
    cyl("smokestack", (-0.95, 0, 1.85), 0.09, 0.85, M["iron"], verts=10, r2=0.12, parent=g)
    cyl("dome", (-0.2, 0, 1.5), 0.14, 0.22, M["brass"], verts=10, parent=g)
    box("firebox", (-1.15, 0, 0.55), (0.4, 0.7, 0.55), M["iron"], parent=g)
    box("fireGlow", (-1.15, -0.36, 0.5), (0.2, 0.03, 0.22), M["glow"], parent=g)
    # cylinder block + piston group (slides along X)
    box("cylBlock", (0.62, 0, 0.62), (0.62, 0.5, 0.5), M["iron"], parent=g)
    pg = root("Piston")
    pg.location = (0.95, 0, 0)
    pg.parent = g
    cyl("rod", (0.18, 0, 0.62), 0.045, 0.5, M["steel"], verts=9,
        rot=(0, math.radians(90), 0), parent=pg)
    box("crosshead", (0.42, 0, 0.62), (0.16, 0.2, 0.2), M["brass"], parent=pg)
    # flywheel on the front side, axle along Y
    box("flyPost", (1.02, -0.52, 0.35), (0.18, 0.14, 0.7), M["iron"], parent=g)
    _spoked_wheel(g, (1.02, -0.62, 0.78), 0.52, M["iron"], M["iron"], n_spokes=6)
    # connecting rod from crosshead area to the wheel crank
    pipe("conRod", (1.3, -0.3, 0.62), (1.02, -0.6, 1.05), 0.035, M["steel"], parent=g)
    # pressure gauge + pipes
    cyl("gauge", (-0.45, -0.3, 1.62), 0.07, 0.05, M["brass"], verts=10,
        rot=(math.radians(90), 0, 0), parent=g)
    pipe("pipeTop", (-0.45, 0.2, 1.42), (0.62, 0.2, 0.9), 0.04, M["copper"], parent=g)
    return g


def build_distillation_tower():
    g = root("distillation-tower")
    # vertical column with tray rings + brass bands, ladder and
    # railed platforms (separate thin boxes), side condenser barrel
    # and a receiving tank (image-faithful; NOT a radio tower)
    box("base", (0, 0, 0.12), (1.5, 1.3, 0.24), M["stone"], parent=g)
    cyl("column", (-0.25, 0, 1.85), 0.34, 3.2, M["steel"], verts=16, parent=g)
    for i, lz in enumerate((0.9, 1.5, 2.1, 2.7)):
        torus("trayRing", (-0.25, 0, lz), 0.35, 0.028, M["brass"] if i % 2 else M["iron"],
              rot=(0, 0, 0), parent=g)
    cone("cap", (-0.25, 0, 3.6), 0.3, 0.34, M["steel"], verts=14, parent=g)
    cyl("ventPipe", (-0.25, 0, 3.85), 0.05, 0.25, M["iron"], verts=8, parent=g)
    # platforms + rails on the front-left of the column
    for lz in (1.45, 2.45):
        box("platform", (-0.25, -0.52, lz), (0.95, 0.55, 0.05), M["iron"], parent=g)
        for px in (-0.68, 0.18):
            box("railPost", (px, -0.76, lz + 0.25), (0.04, 0.04, 0.5), M["brass"], parent=g)
        box("railTop", (-0.25, -0.76, lz + 0.5), (0.95, 0.04, 0.04), M["brass"], parent=g)
    for i in range(5):  # ladder rungs up the front
        box("rung", (-0.62, -0.42, 0.6 + i * 0.42), (0.3, 0.04, 0.04), M["iron"], parent=g)
    for lx in (-0.78, -0.46):
        box("ladderRail", (lx, -0.42, 1.45), (0.045, 0.045, 2.2), M["iron"], parent=g)
    # vapour pipe over to the condenser barrel, then down to a tank
    pipe("vapPipe", (-0.25, 0, 3.35), (0.55, 0, 3.0), 0.05, M["copper"], parent=g)
    cyl("condenser", (0.62, 0, 2.2), 0.24, 1.3, M["copper"], verts=14, parent=g)
    cyl("condLeg", (0.62, 0.25, 0.75), 0.05, 1.5, M["iron"], verts=8, parent=g)
    cyl("condLeg2", (0.62, -0.25, 0.75), 0.05, 1.5, M["iron"], verts=8, parent=g)
    pipe("outPipe", (0.62, 0, 1.5), (0.62, -0.1, 0.75), 0.04, M["copper"], parent=g)
    cyl("tank", (0.62, 0, 0.45), 0.3, 0.65, M["steel"], verts=14, parent=g)
    return g


def build_factory():
    g = root("factory")
    # red-brick factory: sawtooth roof, tall chimney, loading dock
    # with doors and crates on the front (image-faithful)
    box("walls", (0, 0, 1.25), (5.0, 3.4, 2.5), M["redbrick"], bevel=0.03, parent=g)
    box("footing", (0, 0, 0.15), (5.2, 3.6, 0.3), M["stone"], parent=g)
    for i, dx in enumerate((-1.6, 0, 1.6)):  # sawtooth roof ridges
        r = box("roofTooth", (dx, 0, 2.85), (1.55, 3.6, 0.14), M["panel"],
                rot=(0, math.radians(32), 0), bevel=0.02, parent=g)
        box("roofGlass", (dx - 0.42, 0, 2.98), (0.7, 3.5, 0.05), M["glass"],
            rot=(0, math.radians(-58), 0), parent=g)
    cyl("chimney", (1.9, 1.0, 3.6), 0.42, 2.6, M["redbrick"], verts=14, r2=0.33, parent=g)
    cyl("chimneyCap", (1.9, 1.0, 4.95), 0.4, 0.18, M["stone_dark"], verts=14, parent=g)
    # arched windows on the front
    for dx in (-1.9, -1.0, 1.75):
        box("winFrame", (dx, -1.71, 1.45), (0.68, 0.04, 1.08), M["iron"], parent=g)
        box("win", (dx, -1.72, 1.45), (0.56, 0.06, 0.96), M["winlit"], parent=g)
        box("winBar", (dx, -1.73, 1.45), (0.58, 0.03, 0.05), M["iron"], parent=g)
    # loading dock: platform, canopy, double door, crates
    box("dock", (0.35, -2.05, 0.3), (1.9, 0.8, 0.6), M["stone1"], parent=g)
    box("doorL", (0.05, -1.72, 1.0), (0.55, 0.06, 1.4), M["wood"], parent=g)
    box("doorR", (0.68, -1.72, 1.0), (0.55, 0.06, 1.4), M["wood"], parent=g)
    box("canopy", (0.35, -2.0, 2.05), (2.0, 0.9, 0.06), M["panel"],
        rot=(math.radians(14), 0, 0), parent=g)
    box("crate1", (0.0, -2.1, 0.85), (0.5, 0.5, 0.5), M["wood1"], bevel=0.03, parent=g)
    box("crate2", (0.55, -2.05, 0.78), (0.4, 0.4, 0.36), M["wood1"], bevel=0.03, parent=g)
    box("steps", (1.45, -2.1, 0.12), (0.6, 0.7, 0.24), M["stone1"], parent=g)
    return g


def build_power_plant():
    g = root("power-plant")
    # turbine hall with a big arched window wall, boiler house with
    # a striped chimney, transformer yard with insulators and pipes
    # (image-faithful thermal plant; generation kit lives inside the
    # hall — no parts are scattered into the field)
    box("hall", (-0.9, 0, 1.3), (3.6, 3.2, 2.6), M["tilewall"], bevel=0.03, parent=g)
    # arched roof: full cylinder whose lower half stays inside the
    # hall volume (radius/depth chosen so only a thin eaves lip shows)
    cyl("hallRoof", (-0.9, 0, 2.6), 1.62, 3.5, M["panel"], verts=16,
        rot=(0, math.radians(90), 0), parent=g)
    # big arched window on the front with the turbine silhouette
    box("bigWin", (-0.9, -1.64, 1.45), (1.7, 0.07, 1.6), M["glass"], parent=g)
    box("bigWinBarV", (-0.9, -1.65, 1.45), (0.06, 0.05, 1.6), M["iron"], parent=g)
    box("bigWinBarH", (-0.9, -1.65, 1.45), (1.7, 0.05, 0.06), M["iron"], parent=g)
    cyl("turbine", (-0.9, -1.05, 1.15), 0.5, 1.1, M["steel"], verts=14,
        rot=(0, math.radians(90), 0), parent=g)
    box("door", (-2.2, -1.64, 0.75), (0.7, 0.06, 1.5), M["iron"], parent=g)
    cyl("gableWin", (0.88, 0, 2.95), 0.5, 0.08, M["winlit"], verts=18,
        rot=(0, math.radians(90), 0), parent=g)
    # boiler house + striped chimney behind-right
    box("boilerHouse", (1.85, 0.5, 1.0), (1.9, 2.2, 2.0), M["redbrick"], parent=g)
    cyl("chimneyLow", (2.4, 1.2, 3.4), 0.44, 2.9, M["redbrick"], verts=14, r2=0.35, parent=g)
    cyl("chimneyBand", (2.4, 1.2, 4.35), 0.36, 0.5, M["white"], verts=14, parent=g)
    cyl("chimneyTop", (2.4, 1.2, 4.95), 0.35, 0.75, M["redbrick"], verts=14, r2=0.32, parent=g)
    # transformer in front-right: tank, fins, 3 bushings
    box("xfmr", (1.7, -1.35, 0.55), (1.15, 0.8, 1.05), M["steel"], bevel=0.03, parent=g)
    for i in range(4):
        box("fin", (1.25 + i * 0.3, -1.79, 0.55), (0.06, 0.06, 0.9), M["iron"], parent=g)
    for i, dx in enumerate((1.4, 1.7, 2.0)):
        cyl("bushing", (dx, -1.35, 1.3), 0.05, 0.45, M["copper"], verts=8, parent=g)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.07,
                                             location=(dx, -1.35, 1.55))
        o = bpy.context.object
        o.name = "bushingTop"
        _finish(o, M["white"], 0, g)
    pipe("feedPipe", (0.9, 0.6, 1.9), (1.85, 0.6, 1.9), 0.09, M["steel"], parent=g)
    pipe("feedPipe2", (0.9, 0.6, 1.9), (0.9, -0.6, 1.2), 0.09, M["steel"], parent=g)
    return g


def build_research_institute():
    g = root("research-institute")
    # two-storey modern institute: light tile walls, ribbon glass
    # showing benches + flasks inside (emissive-simple), entrance
    # steps, roof plant (image-faithful)
    box("base", (0, 0, 0.12), (5.4, 3.6, 0.24), M["stone1"], parent=g)
    box("floor1", (0, 0, 1.15), (5.2, 3.4, 1.85), M["tilewall"], bevel=0.02, parent=g)
    box("floor2", (0.2, 0, 3.05), (5.2, 3.4, 1.85), M["tilewall"], bevel=0.02, parent=g)
    box("roofSlab", (0.2, 0, 4.05), (5.5, 3.7, 0.16), M["panel"], parent=g)
    for fl, fz in enumerate((1.25, 3.15)):
        # glass band across the front with lab bench silhouettes
        box("glassBand", (-0.6, -1.72, fz), (3.6, 0.06, 1.15), M["glass"], parent=g)
        box("benchIn", (-0.6, -1.45, fz - 0.35), (3.3, 0.4, 0.5), M["wood1"], parent=g)
        for i in range(4):
            cone("flaskIn", (-2.0 + i * 0.9, -1.45, fz - 0.02), 0.09, 0.24,
                 M["winlit"] if i % 2 else M["glass"], verts=8, parent=g)
    # entrance: double door + steps + canopy at front-right
    box("door", (1.85, -1.72, 0.85), (0.95, 0.07, 1.45), M["iron"], parent=g)
    box("doorGlass", (1.85, -1.74, 1.0), (0.8, 0.04, 0.8), M["glass"], parent=g)
    box("canopy", (1.85, -1.95, 1.75), (1.4, 0.7, 0.07), M["panel"], parent=g)
    box("steps", (1.85, -2.05, 0.1), (1.5, 0.6, 0.2), M["stone1"], parent=g)
    # roof plant: AC box + ducts
    box("acUnit", (-1.2, 0.6, 4.35), (1.1, 0.9, 0.45), M["steel"], bevel=0.03, parent=g)
    cyl("duct", (0.6, 0.6, 4.3), 0.16, 1.4, M["steel"], verts=10,
        rot=(0, math.radians(90), 0), parent=g)
    cyl("ventStack", (1.9, 0.9, 4.4), 0.14, 0.55, M["steel"], verts=10, parent=g)
    # planter boxes with green blobs at the front corners
    for dx in (-2.3, 2.6):
        box("planter", (dx, -1.95, 0.25), (0.7, 0.5, 0.5), M["tilewall"], parent=g)
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.3, subdivisions=1,
                                              location=(dx, -1.95, 0.62))
        o = bpy.context.object
        o.name = "shrub"
        o.scale = (1, 0.8, 0.75)
        bpy.ops.object.transform_apply(scale=True)
        _finish(o, M["leaf"], 0, g)
    return g


def build_waterwheel():
    g = root("waterwheel")
    # standalone undershot wheel on stone piers + timber A-frame
    # (the mill house in the reference image is NOT part of the
    # game's waterwheel — see structures.json notes)
    for sy in (-0.62, 0.62):
        box("pier", (0, sy, 0.3), (0.5, 0.34, 0.6), M["stone1"], bevel=0.03, parent=g)
        p = pipe("framePost", (-0.3, sy, 0.45), (0, sy, 1.32), 0.07, M["bark"], parent=g, verts=9)
        p2 = pipe("framePostB", (0.3, sy, 0.45), (0, sy, 1.32), 0.07, M["bark"], parent=g, verts=9)
    cyl("axle", (0, 0, 1.3), 0.08, 1.5, M["bark"], verts=10,
        rot=(math.radians(90), 0, 0), parent=g)
    _spoked_wheel(g, (0, 0, 1.3), 0.98, M["wood"], M["bark"], n_spokes=4, paddle_w=0.62)
    # sluice board above the wheel (water comes from the back-top)
    box("sluice", (0, 0.55, 2.25), (0.7, 0.9, 0.08), M["wood1"],
        rot=(math.radians(38), 0, 0), parent=g)
    return g


def build_drilling_rig():
    g = root("drilling-rig")
    # timber derrick with iron bands, crown sheave, winch drum with
    # cable, rotating drill pipe, small engine shed at the side
    # (image-faithful; the shed is part of the rig's own footprint)
    box("deck", (0, 0, 0.14), (2.6, 2.2, 0.28), M["wood"], parent=g)
    lean = 0.16
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = pipe("leg", (sx * 0.85, sy * 0.7, 0.25), (sx * 0.28, sy * 0.22, 3.3),
                     0.075, M["bark"], parent=g, verts=9)
    for lz, w in ((1.2, 1.5), (2.1, 1.05), (2.9, 0.68)):
        for sy in (-1, 1):
            box("brace", (0, sy * (w / 2 * 0.62 + 0.1), lz), (w, 0.07, 0.09), M["wood1"], parent=g)
        torus("band", (0, 0, lz), 0.0, 0.0, M["iron"], parent=g) if False else None
        box("bandF", (0, -(w / 2 * 0.62 + 0.12), lz + 0.12), (w * 0.8, 0.05, 0.1), M["iron"], parent=g)
    box("crown", (0, 0, 3.42), (0.5, 0.4, 0.22), M["iron"], parent=g)
    cyl("sheave", (0, 0, 3.42), 0.14, 0.08, M["iron"], verts=12,
        rot=(math.radians(90), 0, 0), parent=g)
    # drill pipe (turns) hanging from the crown to the deck hole
    dp = root("DrillPipe")
    dp.location = (0, 0, 0)
    dp.parent = g
    cyl("pipeMain", (0, 0, 1.8), 0.055, 3.0, M["iron"], verts=10, parent=dp)
    cyl("pipeJoint", (0, 0, 2.2), 0.09, 0.3, M["iron"], verts=10, parent=dp)
    cyl("bit", (0, 0, 0.32), 0.02, 0.35, M["steel"], verts=8, r2=0.1, parent=dp)
    cyl("hole", (0, 0, 0.3), 0.16, 0.06, M["dark"], verts=12, parent=g)
    # winch: drum (turns) + frame + cable to the crown
    wg = root("Winch")
    wg.location = (-0.95, -0.55, 0.55)
    wg.parent = g
    cyl("drum", (0, 0, 0), 0.17, 0.55, M["iron"], verts=12,
        rot=(math.radians(90), 0, 0), parent=wg)
    for sy in (-0.32, 0.32):
        box("winchPost", (-0.95, -0.55 + sy, 0.42), (0.09, 0.07, 0.5), M["bark"], parent=g)
    pipe("cable", (-0.95, -0.55, 0.72), (0, 0, 3.35), 0.018, M["dark"], parent=g, verts=6)
    # engine shed
    box("shed", (1.05, 0.55, 0.65), (0.95, 0.85, 0.95), M["wood1"], bevel=0.02, parent=g)
    box("shedRoof", (1.05, 0.55, 1.28), (1.1, 1.0, 0.07), M["panel"],
        rot=(math.radians(10), 0, 0), parent=g)
    cyl("shedStack", (1.3, 0.75, 1.55), 0.05, 0.4, M["iron"], verts=8, parent=g)
    box("steps", (0.35, -1.25, 0.1), (0.7, 0.4, 0.2), M["wood1"], parent=g)
    return g


BUILDERS = {
    "workbench": build_workbench,
    "campfire": build_campfire,
    "kiln": build_kiln,
    "hut": build_hut,
    "smelter": build_smelter,
    "laboratory": build_laboratory,
    "steam-engine": build_steam_engine,
    "distillation-tower": build_distillation_tower,
    "factory": build_factory,
    "power-plant": build_power_plant,
    "research-institute": build_research_institute,
    "waterwheel": build_waterwheel,
    "drilling-rig": build_drilling_rig,
}


def render_preview(obj_root, out_png):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.film_transparent = True
    scene.render.filepath = str(out_png)
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.83, 0.8, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # game-like 3/4 view: from front-right, pitch ~32 degrees
    import mathutils
    deps = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in obj_root.children_recursive:
        if o.type == "MESH":
            for v in o.bound_box:
                w = o.matrix_world @ mathutils.Vector(v)
                xs.append(w.x); ys.append(w.y); zs.append(w.z)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cz = (min(zs) + max(zs)) / 2
    size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    d = size * 1.9
    cam.location = (cx + d * 0.62, cy - d * 0.72, cz + d * 0.55)
    direction = mathutils.Vector((cx, cy, cz)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = 100
    bpy.ops.render.render(write_still=True)
    scene.collection.objects.unlink(cam)
    scene.collection.objects.unlink(sun)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    outdir = Path(argv[0]) if argv else HERE.parent / "models"
    outdir.mkdir(parents=True, exist_ok=True)
    do_render = "--render" in argv
    setup_materials()
    for name, builder in BUILDERS.items():
        clean()
        setup_materials()
        obj = builder()
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        for ch in obj.children_recursive:
            ch.select_set(True)
        bpy.context.view_layer.objects.active = obj
        path = outdir / f"{name}.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                                  use_selection=True, export_apply=True,
                                  export_yup=True)
        print("exported", path)
        if do_render:
            render_preview(obj, HERE.parent / "renders" / f"{name}.png")
            print("rendered", name)


if __name__ == "__main__":
    main()
