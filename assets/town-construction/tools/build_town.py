#!/usr/bin/env python3
"""Town-construction assets for M4-02 (free placement, staged building).

Reuses the buildings-3d builders/materials (imported as a module)
so the staged variants are the SAME models, regrouped into
construction-stage node groups:

  stage1_foundation / stage2_frame / stage3_shell / stage4_complete

Display rule (cumulative): stage N shows groups 1..N; stage 0 is
the site kit alone. Front = Blender -Y -> three.js +Z, origin at
the ground contact centre, 1 unit = 1 m (same convention as
assets/buildings-3d/structures.json).

Run: blender -b -noaudio --python build_town.py -- <only...>
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "assets/buildings-3d/tools"))
import build_buildings as bb  # noqa: E402

M = bb.M
OUT = HERE.parent / "models"
STAGES = ["stage1_foundation", "stage2_frame", "stage3_shell", "stage4_complete"]
REPORT = {}


def stage_groups(root_obj):
    groups = {}
    for nm in STAGES:
        e = bb.root(nm)
        e.parent = root_obj
        groups[nm] = e
    return groups


def regroup(root_obj, assign):
    """assign(name) -> one of STAGES. ContactShadow is dropped
    (the module draws real shadows; a baked plate would float
    on slopes and must not appear mid-construction)."""
    groups = stage_groups(root_obj)
    lists = {nm: [] for nm in STAGES}
    for obj in list(root_obj.children):
        if obj in groups.values():
            continue
        if obj.name.startswith("ContactShadow"):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        key = assign(obj.name)
        obj.parent = groups[key]
        lists[key].append(obj.name)
    return lists


def export_model(root_obj, name, lod1=True):
    bpy.ops.object.select_all(action="DESELECT")
    root_obj.select_set(True)
    for ch in root_obj.children_recursive:
        ch.select_set(True)
    bpy.context.view_layer.objects.active = root_obj
    path = OUT / f"{name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                              use_selection=True, export_apply=True,
                              export_yup=True)
    tris = sum(len(o.data.polygons) for o in root_obj.children_recursive
               if o.type == "MESH")
    print("exported", path, "tris~", tris)
    if lod1:
        # Far LOD: merge each stage group into ONE mesh (stage
        # switching still works; per-part nodes are a near-field
        # feature), then decimate. These buildings are 2-3k tris,
        # so the win is draw calls (4 per building), not tris.
        # Apply live modifiers first: joining objects that still
        # carry bevels corrupts the merged mesh.
        for o in root_obj.children_recursive:
            if o.type == "MESH":
                bpy.context.view_layer.objects.active = o
                for mod in list(o.modifiers):
                    bpy.ops.object.modifier_apply(modifier=mod.name)
        for grp in [c for c in root_obj.children if c.name in STAGES]:
            meshes = [o for o in grp.children if o.type == "MESH"]
            if len(meshes) > 1:
                bpy.ops.object.select_all(action="DESELECT")
                for o in meshes:
                    o.select_set(True)
                bpy.context.view_layer.objects.active = meshes[0]
                bpy.ops.object.join()
                meshes[0].name = grp.name + "_merged"
        for o in root_obj.children_recursive:
            if o.type == "MESH" and len(o.data.polygons) > 200:
                mod = o.modifiers.new("lod", "DECIMATE")
                mod.ratio = 0.6
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.select_all(action="DESELECT")
        root_obj.select_set(True)
        for ch in root_obj.children_recursive:
            ch.select_set(True)
        bpy.context.view_layer.objects.active = root_obj
        path1 = OUT / f"{name}_lod1.glb"
        bpy.ops.export_scene.gltf(filepath=str(path1), export_format="GLB",
                                  use_selection=True, export_apply=True,
                                  export_yup=True)
        print("exported", path1)
    return tris


def bounds_of(root_obj):
    import mathutils
    mn = mathutils.Vector((1e9, 1e9, 1e9))
    mx = mathutils.Vector((-1e9, -1e9, -1e9))
    for o in root_obj.children_recursive:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector(map(min, mn, w))
            mx = mathutils.Vector(map(max, mx, w))
    return mn, mx


def gable_prism(name, x, half_w, z_base, z_apex, thick, material, parent):
    """Triangular gable infill at a side wall (x = const plane)."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = []
    for dx in (-thick / 2, thick / 2):
        vs.append(bm.verts.new((x + dx, -half_w, z_base)))
        vs.append(bm.verts.new((x + dx, half_w, z_base)))
        vs.append(bm.verts.new((x + dx, 0, z_apex)))
    bm.faces.new((vs[0], vs[1], vs[2]))
    bm.faces.new((vs[5], vs[4], vs[3]))
    for a, b, c, d in ((0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)):
        bm.faces.new((vs[a], vs[b], vs[c], vs[d]))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    # simple planar UVs from the YZ projection
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        v = me.vertices[loop.vertex_index].co
        loop_uv = uv.data[loop.index]
        loop_uv.uv = ((v.y + half_w) / (2 * half_w) * 1.6,
                      (v.z - z_base) / max(z_apex - z_base, 0.01) * 0.5)
    if parent is not None:
        obj.parent = parent
    return obj


# ---------------------------------------------------------------- staged hut
def staged_hut():
    bb.clean()
    bb.setup_materials()
    g = bb.build_hut()

    def assign(n):
        if n in ("footing", "step"):
            return "stage1_foundation"
        if n.startswith("post") or n in ("beamF", "beamB"):
            return "stage2_frame"
        # ridge + ties + lintel are seated on the raised earth
        # walls, so they arrive with the shell, not the frame
        if n in ("walls", "roof", "winFrame", "lintel") or n.startswith("ridge"):
            return "stage3_shell"
        return "stage4_complete"  # roof.001, eave*, door, winBar*, winDark

    lists = regroup(g, assign)
    mn, mx = bounds_of(g)
    tris = export_model(g, "hut-staged")
    REPORT["hut"] = {"stageNodes": lists, "tris": tris,
                     "bounds": [list(mn), list(mx)]}


# ---------------------------------------------------------------- staged factory
def split_walls(obj):
    import bmesh
    # A plain box wall has full-height side faces whose centroid
    # sits mid-wall; subdivide the vertical edges into bands first
    # so the centroid split produces a real rising wall course.
    bm0 = bmesh.new()
    bm0.from_mesh(obj.data)
    vedges = [e for e in bm0.edges
              if abs((e.verts[0].co - e.verts[1].co).x) < 1e-6
              and abs((e.verts[0].co - e.verts[1].co).y) < 1e-6
              and abs((e.verts[0].co - e.verts[1].co).z) > 0.5]
    if vedges:
        bmesh.ops.subdivide_edges(bm0, edges=vedges, cuts=4)
    bm0.to_mesh(obj.data)
    bm0.free()
    zs = [(obj.matrix_world @ v.co).z for v in obj.data.vertices]
    z_split = min(zs) + (max(zs) - min(zs)) * 0.45
    parts = []
    for keep_below, new_name in ((True, "wallsLower"), (False, "wallsUpper")):
        dup = obj.copy()
        dup.data = obj.data.copy()
        dup.name = new_name
        bpy.context.collection.objects.link(dup)
        dup.parent = obj.parent
        bm = bmesh.new()
        bm.from_mesh(dup.data)
        mw = dup.matrix_world
        kill = [f for f in bm.faces
                if ((mw @ f.calc_center_median()).z < z_split) != keep_below]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(dup.data)
        bm.free()
        parts.append(dup)
    bpy.data.objects.remove(obj, do_unlink=True)
    return parts


def staged_factory():
    bb.clean()
    bb.setup_materials()
    g = bb.build_factory()
    split_walls(bpy.data.objects["walls"])
    groups = stage_groups(g)
    # additions for the finished plant: two roof vent stacks and a
    # pipe run down the back wall (structure, not texture detail)
    grp = groups["stage4_complete"]
    bb.box("ventStack", (-1.6, 0.4, 3.5), (0.55, 0.55, 0.8), M["ironT"],
           parent=grp)
    bb.box("ventStack", (1.7, 0.4, 3.5), (0.55, 0.55, 0.8), M["ironT"],
           parent=grp)
    bb.box("ventCap", (-1.6, 0.4, 3.97), (0.7, 0.7, 0.12), M["roofM"],
           parent=grp)
    bb.box("ventCap", (1.7, 0.4, 3.97), (0.7, 0.7, 0.12), M["roofM"],
           parent=grp)
    bb.pipe("pipeRun", (-2.2, 1.76, 2.6), (-2.2, 1.76, 0.4), 0.055,
            M["copper"], parent=grp)
    bb.pipe("pipeRunElbow", (-2.2, 1.76, 2.6), (-2.2, 1.55, 2.6), 0.055,
            M["copper"], parent=grp)

    def assign(n):
        if n in ("footing", "steps", "dock"):
            return "stage1_foundation"
        if n == "wallsLower":
            return "stage2_frame"
        if n in ("wallsUpper", "chimney", "chimneyCap") or n.startswith("roofTooth"):
            return "stage3_shell"
        if n in ("crate1", "crate2"):
            return "REMOVE"  # crates are delivery props, not the building
        return "stage4_complete"

    lists = {nm: [] for nm in STAGES}
    lists["stage4_complete"] += ["ventStack", "ventStack.001", "ventCap",
                                 "ventCap.001", "pipeRun", "pipeRunElbow"]
    for obj in list(g.children):
        if obj in groups.values():
            continue
        if obj.name.startswith("ContactShadow"):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        key = assign(obj.name)
        if key == "REMOVE":
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        obj.parent = groups[key]
        lists[key].append(obj.name)
    mn, mx = bounds_of(g)
    tris = export_model(g, "factory-staged")
    REPORT["factory"] = {"stageNodes": lists, "tris": tris,
                         "bounds": [list(mn), list(mx)]}


# ---------------------------------------------------------------- staged house (hut-town)
def staged_house():
    bb.clean()
    src = REPO / "assets/gpt-dq3/models/hut-town.glb"
    bpy.ops.import_scene.gltf(filepath=str(src))
    g = bpy.data.objects.get("hut-town")
    if g is None:
        g = max(bpy.data.objects, key=lambda o: len(o.children))
    print("house root:", g.name, "children:", len(g.children))

    def assign(n):
        if n.startswith(("step", "footing", "floor", "found")):
            return "stage1_foundation"
        if n.startswith(("stud", "rail", "post")) or n == "ridge":
            return "stage2_frame"
        if n in ("walls", "roof") or n.startswith(("gable", "plate")):
            return "stage3_shell"
        return "stage4_complete"  # roof.001, eavetile*, door, win*

    lists = regroup(g, assign)
    mn, mx = bounds_of(g)
    tris = export_model(g, "house-staged")
    REPORT["house"] = {"stageNodes": lists, "tris": tris,
                       "bounds": [list(mn), list(mx)]}


BUILDERS = {
    "hut": staged_hut,
    "factory": staged_factory,
    "house": staged_house,
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in BUILDERS.items():
        if argv and name not in argv:
            continue
        fn()
        print("== done", name)
    rp = HERE.parent / "build-report.json"
    rp.write_text(json.dumps(REPORT, indent=1, ensure_ascii=False))
    print("report:", rp)



# ---------------------------------------------------------------- new: warehouse
def build_warehouse():
    bb.clean()
    bb.setup_materials()
    g = bb.root("warehouse")
    gr = stage_groups(g)
    F, FR, SH, CO = (gr[s] for s in STAGES)
    # foundation: stone footing + plank floor
    bb.box("footing", (0, 0, 0.13), (5.4, 4.2, 0.26), M["stoneTrim"], parent=F)
    bb.box("floor", (0, 0, 0.29), (5.0, 3.8, 0.06), M["planksH"], parent=F)
    # frame: six posts, wall beams, ridge, rafters
    for sx in (-2.55, 0, 2.55):
        for sy in (-1.95, 1.95):
            bb.cyl("post", (sx, sy, 1.6), 0.09, 2.7, M["bark"], verts=9, parent=FR)
    for sy in (-1.95, 1.95):
        bb.box("beam", (0, sy, 2.72), (5.4, 0.13, 0.15), M["bark"], parent=FR)
    bb.box("ridge", (0, 0, 3.6), (5.5, 0.14, 0.14), M["bark"], parent=FR)
    for sx in (-2.4, -0.8, 0.8, 2.4):
        for s in (-1, 1):
            bb.box("rafter", (sx, s * 0.95, 3.13), (0.09, 2.0, 0.09),
                   M["bark"], rot=(-s * math.radians(20), 0, 0), parent=FR)
    # shell: plank walls (back + sides), gables, metal roof
    bb.box("wallB", (0, 2.02, 1.6), (5.3, 0.1, 2.7), M["planksV"], parent=SH)
    for sx in (-2.65, 2.65):
        bb.box("wallS", (sx, 0, 1.6), (0.1, 4.0, 2.7), M["planksV"], parent=SH)
    bb.box("wallF", (-1.95, -2.02, 1.6), (1.5, 0.1, 2.7), M["planksV"], parent=SH)
    bb.box("wallF", (1.95, -2.02, 1.6), (1.5, 0.1, 2.7), M["planksV"], parent=SH)
    bb.box("wallFtop", (0, -2.02, 2.72), (2.4, 0.1, 0.5), M["planksV"], parent=SH)
    for sx in (-2.62, 2.62):
        gable_prism("gable", sx, 1.95, 2.9, 3.6, 0.1, M["planksH"], SH)
    for s in (-1, 1):
        bb.box("roof", (0, s * 1.05, 3.22), (5.9, 2.5, 0.09), M["roofM"],
               rot=(-s * math.radians(20), 0, 0), bevel=0.02, parent=SH)
    # complete: sliding double doors, rail, side windows, brackets
    bb.box("doorL", (-0.78, -2.14, 1.5), (1.5, 0.07, 2.3), M["planksV"], parent=CO)
    bb.box("doorR", (0.78, -2.2, 1.5), (1.5, 0.07, 2.3), M["planksV"], parent=CO)
    bb.box("doorRail", (0, -2.18, 2.78), (3.4, 0.06, 0.09), M["ironT"], parent=CO)
    for sx in (-2.72, 2.72):
        bb.box("winFrame", (sx, 0.6, 2.2), (0.06, 0.8, 0.6), M["planksV"], parent=CO)
        bb.box("winDark", (sx * 1.005, 0.6, 2.2), (0.05, 0.68, 0.48),
               M["darkGlass"], parent=CO)
    for sx in (-2.55, 2.55):
        for sy in (-1.95, 1.95):
            bb.box("bracket", (sx, sy, 2.9), (0.2, 0.2, 0.3), M["ironT"], parent=CO)
    lists = {s: [o.name for o in gr[s].children] for s in STAGES}
    mn, mx = bounds_of(g)
    tris = export_model(g, "warehouse")
    REPORT["warehouse"] = {"stageNodes": lists, "tris": tris,
                           "bounds": [list(mn), list(mx)]}


# ---------------------------------------------------------------- new: workshop
def build_workshop():
    bb.clean()
    bb.setup_materials()
    g = bb.root("workshop")
    gr = stage_groups(g)
    F, FR, SH, CO = (gr[s] for s in STAGES)
    bb.box("footing", (0, 0, 0.13), (4.8, 3.6, 0.26), M["stoneTrim"], parent=F)
    bb.box("floor", (0, 0, 0.29), (4.4, 3.2, 0.06), M["planksH"], parent=F)
    for sx in (-2.25, 2.25):
        for sy in (-1.65, 1.65):
            bb.cyl("post", (sx, sy, 1.55), 0.085, 2.6, M["bark"], verts=9, parent=FR)
    for sy in (-1.65, 1.65):
        bb.box("beam", (0, sy, 2.72), (4.8, 0.12, 0.14), M["bark"], parent=FR)
    bb.box("ridge", (0, 0, 3.5), (4.9, 0.13, 0.13), M["bark"], parent=FR)
    for sx in (-2.0, 0, 2.0):
        for s in (-1, 1):
            bb.box("rafter", (sx, s * 0.82, 3.08), (0.08, 1.75, 0.08),
                   M["bark"], rot=(-s * math.radians(20), 0, 0), parent=FR)
    # shell: back + side walls only (front stays open), tile roof
    bb.box("wallB", (0, 1.72, 1.55), (4.7, 0.1, 2.6), M["planksV"], parent=SH)
    for sx in (-2.35, 2.35):
        bb.box("wallS", (sx, 0, 1.55), (0.1, 3.4, 2.6), M["planksV"], parent=SH)
    for sx in (-2.32, 2.32):
        gable_prism("gable", sx, 1.65, 2.85, 3.5, 0.1, M["planksH"], SH)
    for s in (-1, 1):
        bb.box("roof", (0, s * 0.9, 3.14), (5.3, 2.2, 0.1), M["tile"],
               rot=(-s * math.radians(20), 0, 0), bevel=0.02, parent=SH)
    # complete: workbench, shelf, window, crate stack, sign board
    bb.box("benchTop", (0, 1.15, 1.05), (2.4, 0.7, 0.09), M["planksH"], parent=CO)
    for sx in (-1.05, 1.05):
        bb.box("benchLeg", (sx, 1.15, 0.5), (0.12, 0.6, 1.0), M["bark"], parent=CO)
    bb.box("shelf", (-1.5, 1.6, 1.9), (1.6, 0.3, 0.06), M["planksH"], parent=CO)
    bb.box("winFrame", (2.42, -0.5, 1.8), (0.06, 0.9, 0.7), M["planksV"], parent=CO)
    bb.box("winDark", (2.44, -0.5, 1.8), (0.05, 0.76, 0.56), M["darkGlass"], parent=CO)
    bb.box("crateS", (1.75, 1.25, 0.62), (0.62, 0.62, 0.62), M["planksV"], parent=CO)
    bb.box("crateS", (1.75, 1.25, 1.24), (0.55, 0.55, 0.55), M["planksV"], parent=CO)
    bb.box("sign", (0, -1.78, 2.45), (1.1, 0.05, 0.4), M["planksH"], parent=CO)
    lists = {s: [o.name for o in gr[s].children] for s in STAGES}
    mn, mx = bounds_of(g)
    tris = export_model(g, "workshop")
    REPORT["workshop"] = {"stageNodes": lists, "tris": tris,
                          "bounds": [list(mn), list(mx)]}


# ---------------------------------------------------------------- new: site kit
def build_site():
    bb.clean()
    bb.setup_materials()
    g = bb.root("construction-site")
    line = bb.mat("siteLine", color=(0.85, 0.79, 0.58), rough=1.0)
    # Node suffixes are three.js-space signs (x, z): Blender -Y is
    # three +Z (the front), so a part at Blender y=-0.5 is "P" in z.
    for sx, nx in ((-0.5, "M"), (0.5, "P")):
        for sy, nz in ((-0.5, "P"), (0.5, "M")):
            bb.cyl(f"stake{nx}{nz}", (sx, sy, 0.2), 0.035, 0.45, M["bark"],
                   verts=7, rot=(0.05 * sx, 0.05 * sy, 0), parent=g)
    bb.box("ropeX_P", (0, -0.5, 0.34), (1.0, 0.025, 0.025), M["rope"], parent=g)
    bb.box("ropeX_M", (0, 0.5, 0.34), (1.0, 0.025, 0.025), M["rope"], parent=g)
    bb.box("ropeY_M", (-0.5, 0, 0.34), (0.025, 1.0, 0.025), M["rope"], parent=g)
    bb.box("ropeY_P", (0.5, 0, 0.34), (0.025, 1.0, 0.025), M["rope"], parent=g)
    bb.box("outlineX_P", (0, -0.5, 0.012), (1.0, 0.07, 0.02), line, parent=g)
    bb.box("outlineX_M", (0, 0.5, 0.012), (1.0, 0.07, 0.02), line, parent=g)
    bb.box("outlineY_M", (-0.5, 0, 0.012), (0.07, 1.0, 0.02), line, parent=g)
    bb.box("outlineY_P", (0.5, 0, 0.012), (0.07, 1.0, 0.02), line, parent=g)
    # The exporter bakes object transforms into the geometry; the
    # game positions/scales these nodes at runtime, so recentre
    # every part: geometry centred on the node origin, node
    # translation = the part centre.
    import mathutils
    for o in g.children:
        cs = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        centre = sum(cs, mathutils.Vector()) / 8
        local = o.matrix_world.inverted() @ centre
        o.data.transform(mathutils.Matrix.Translation(-local))
        o.location = centre
    tris = export_model(g, "construction-site", lod1=False)
    REPORT["site"] = {"tris": tris}


# ---------------------------------------------------------------- new: material piles
def _pile_root(name):
    bb.clean()
    bb.setup_materials()
    return bb.root(name)


def build_piles():
    # lumber: stacked planks on cross battens
    g = _pile_root("pile-lumber")
    for sx in (-0.55, 0.55):
        bb.box("batten", (sx, 0, 0.05), (0.12, 0.9, 0.1), M["bark"], parent=g)
    for i in range(5):
        bb.box("plank", (0, -0.28 + (i % 2) * 0.0, 0.16 + i * 0.055),
               (1.7, 0.62, 0.05), M["planksH"], parent=g)
        bb.box("plank", (0, 0.3, 0.16 + i * 0.055), (1.7, 0.5, 0.05),
               M["planksH"], parent=g)
    REPORT["pile-lumber"] = {"tris": export_model(g, "pile-lumber", lod1=False)}
    # stone: cut blocks, two layers
    g = _pile_root("pile-stone")
    import random as _r
    rf = _r.Random(7)
    for layer, (n, z) in enumerate(((3, 0.21), (2, 0.62))):
        for i in range(n):
            bb.box("block", (-0.42 + i * 0.44 + rf.uniform(-0.02, 0.02),
                             rf.uniform(-0.08, 0.08), z),
                   (0.4, 0.55, 0.4), M["stone"],
                   rot=(0, 0, rf.uniform(-0.12, 0.12)), bevel=0.02, parent=g)
    REPORT["pile-stone"] = {"tris": export_model(g, "pile-stone", lod1=False)}
    # sacks: squashed domes with tied tops
    g = _pile_root("pile-sacks")
    for (x, y, z, r) in ((-0.3, -0.15, 0, 0.34), (0.32, -0.1, 0, 0.32),
                         (0.0, 0.3, 0, 0.33), (0.02, 0.02, 0.42, 0.3)):
        d = bb.dome("sack", (x, y, z), r, M["canvas"], sy=0.78, parent=g)
        bb.cyl("knot", (x, y, z + r * 0.78), 0.05, 0.09, M["rope"],
               verts=7, parent=g)
    REPORT["pile-sacks"] = {"tris": export_model(g, "pile-sacks", lod1=False)}
    # metal: bundled steel bars with straps (industrial era)
    g = _pile_root("pile-metal")
    for i in range(3):
        y = -0.18 + i * 0.18
        bb.box("web", (0, y, 0.16), (1.8, 0.05, 0.2), M["steel"], parent=g)
        bb.box("flange", (0, y, 0.05), (1.8, 0.17, 0.03), M["steel"], parent=g)
        bb.box("flange", (0, y, 0.27), (1.8, 0.17, 0.03), M["steel"], parent=g)
    for sx in (-0.6, 0.6):
        bb.box("strap", (sx, 0, 0.16), (0.06, 0.5, 0.36), M["dark"], parent=g)
    REPORT["pile-metal"] = {"tris": export_model(g, "pile-metal", lod1=False)}
    # crated equipment parts (industrial era)
    g = _pile_root("pile-crated")
    bb.box("crate", (0, 0, 0.55), (1.1, 1.1, 1.1), M["planksV"], bevel=0.02,
           parent=g)
    for sx in (-0.52, 0.52):
        for sy in (-0.52, 0.52):
            bb.box("batten", (sx, sy, 0.55), (0.1, 0.1, 1.14), M["planksH"],
                   parent=g)
    for sx in (-0.3, 0.3):
        bb.box("strap", (sx, 0, 0.56), (0.05, 1.14, 1.14), M["ironT"], parent=g)
    REPORT["pile-crated"] = {"tris": export_model(g, "pile-crated", lod1=False)}


BUILDERS.update({
    "warehouse": build_warehouse,
    "workshop": build_workshop,
    "site": build_site,
    "piles": build_piles,
})

if __name__ == "__main__":
    main()
