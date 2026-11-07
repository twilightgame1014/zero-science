#!/usr/bin/env python3
"""Environment asset set builder (round 20, owner spec §4-§6).

Self-contained Blender script: builds the forest / mountain /
coast environment models as GLBs plus placement metadata
(metadata.json). Conventions match the project: origin at
ground centre, front +Z, metres, named LOD1 files alongside.

Run: blender -b --python build_env.py
"""
import bpy, bmesh, math, random, os, json
from mathutils import Vector

BASE = '/home/hatch/workspace/your_files/science-civilization-game/assets'
ROOT = os.path.join(BASE, 'environment-set')
MODELS = os.path.join(ROOT, 'models')
BTEX = os.path.join(BASE, 'buildings-3d', 'textures')
DQ3G = os.path.join(BASE, 'gpt-dq3', 'ground')
DQ3S = os.path.join(BASE, 'gpt-dq3', 'sprays')
EXPS = os.path.join(BASE, 'gpt-expansion', 'sprays')
os.makedirs(MODELS, exist_ok=True)

REGISTRY = []   # metadata entries (§6)
MEASURED = {}   # id -> {w,h,d,tris}

# ----------------------------------------------------------------
# scene / material helpers
# ----------------------------------------------------------------

def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def _img(path):
    return bpy.data.images.load(path, check_existing=True)

def mat_tex(name, albedo, tint=(1, 1, 1, 1), rough=0.95, vcol=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = _img(albedo)
    tex.extension = 'REPEAT'
    if vcol:
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
        mix = m.node_tree.nodes.new('ShaderNodeMixRGB')
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        m.node_tree.links.new(tex.outputs['Color'], mix.inputs[1])
        m.node_tree.links.new(vc.outputs['Color'], mix.inputs[2])
        m.node_tree.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
    elif tint != (1, 1, 1, 1):
        mix = m.node_tree.nodes.new('ShaderNodeMixRGB')
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        mix.inputs[2].default_value = (*tint[:3], 1.0)
        m.node_tree.links.new(tex.outputs['Color'], mix.inputs[1])
        m.node_tree.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return m

def mat_color(name, rgba, rough=0.95):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    return m

def mat_alpha(name, path, clip=0.45):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.blend_method = 'CLIP'
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Alpha'].default_value = 1.0
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = _img(path)
    m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    m.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    if hasattr(m, 'alpha_threshold'):
        m.alpha_threshold = clip
    return m

BARK = lambda: mat_tex('envBark', os.path.join(BTEX, 'bark.png'))
ROCKM = lambda: mat_tex('envRock', os.path.join(BTEX, 'stone.png'), tint=(0.8, 0.8, 0.84, 1))
ROCKVC = lambda: mat_tex('envRockVC', os.path.join(BTEX, 'stone.png'), vcol=True)
CLIFFM = lambda: mat_tex('envCliff', os.path.join(DQ3G, 'stone-wall.png'), tint=(0.72, 0.72, 0.74, 1))
EARTH = lambda: mat_tex('envEarth', os.path.join(BTEX, 'earth.png'))
RINGS = lambda: mat_tex('envRings', os.path.join(DQ3G, 'rings.png'))
LEAF = {
    'deep': lambda: mat_alpha('envLeafDeep', os.path.join(DQ3S, 'broadleaf-deep.png')),
    'bright': lambda: mat_alpha('envLeafBright', os.path.join(DQ3S, 'broadleaf-bright.png')),
    'droop': lambda: mat_alpha('envLeafDroop', os.path.join(DQ3S, 'broadleaf-droop.png')),
    'light': lambda: mat_alpha('envLeafLight', os.path.join(DQ3S, 'broadleaf-light.png')),
    'flower': lambda: mat_alpha('envFlowerBr', os.path.join(DQ3S, 'flower-branch.png')),
    'berry': lambda: mat_alpha('envBerryBr', os.path.join(DQ3S, 'berry-branch.png')),
    'cedar': lambda: mat_alpha('envCedar', os.path.join(EXPS, 'conifer-cedar.png')),
    'pine': lambda: mat_alpha('envPine', os.path.join(EXPS, 'conifer-pine.png')),
    'snowconifer': lambda: mat_alpha('envSnowConifer', os.path.join(EXPS, 'snow-conifer.png')),
}

def new_obj(name, mesh):
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return o

def finish_obj(o, mat=None, smooth=False):
    if mat:
        o.data.materials.append(mat)
    if not smooth:
        for p in o.data.polygons:
            p.use_smooth = False
    return o

# ----------------------------------------------------------------
# geometry helpers
# ----------------------------------------------------------------

def tube(name, paths, mat):
    """paths: list of (points[Vector], r0, r1); one merged mesh."""
    verts, faces = [], []
    RAD = 7
    for pts, r0, r1 in paths:
        n = len(pts)
        base = len(verts)
        for i, p in enumerate(pts):
            t = i / (n - 1) if n > 1 else 0
            r = r0 + (r1 - r0) * t
            # frame from direction
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
            if d.length < 1e-6:
                d = Vector((0, 1, 0))
            d.normalize()
            up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            side = d.cross(up).normalized()
            up2 = side.cross(d).normalized()
            for k in range(RAD):
                a = 2 * math.pi * k / RAD
                off = side * math.cos(a) * r + up2 * math.sin(a) * r
                verts.append(tuple(p + off))
        for i in range(n - 1):
            for k in range(RAD):
                k2 = (k + 1) % RAD
                a = base + i * RAD + k
                b = base + i * RAD + k2
                c = base + (i + 1) * RAD + k2
                dd = base + (i + 1) * RAD + k
                faces.append((a, b, c, dd))
        # cap the tip
        tip_i = base + (n - 1) * RAD
        centre = len(verts)
        verts.append(tuple(pts[-1] + Vector((0, 0.02, 0))))
        for k in range(RAD):
            faces.append((tip_i + k, tip_i + (k + 1) % RAD, centre))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return finish_obj(new_obj(name, mesh), mat, smooth=True)

def cards_obj(name, cards, mats):
    """cards: list of (centre(x,y,z), w, h, yaw, role). Each card
    becomes two crossed quads. Blender coords: z is up. Cards are
    grouped by role so each role gets its own material/object."""
    by_role = {}
    for c in cards:
        by_role.setdefault(c[4], []).append(c)
    objs = []
    for role, cs in by_role.items():
        verts, faces, uvlist = [], [], []
        for c, w, h, yaw, _r in cs:
            for cross in (0.0, math.pi / 2.3):
                a = yaw + cross
                dx, dy = math.sin(a) * w / 2, math.cos(a) * w / 2
                base = len(verts)
                verts += [
                    (c[0] - dx, c[1] - dy, c[2]),
                    (c[0] + dx, c[1] + dy, c[2]),
                    (c[0] + dx * 0.85, c[1] + dy * 0.85, c[2] + h),
                    (c[0] - dx * 0.85, c[1] - dy * 0.85, c[2] + h),
                ]
                faces.append((base, base + 1, base + 2, base + 3))
                uvlist += [(0, 0), (1, 0), (1, 1), (0, 1)]
        mesh = bpy.data.meshes.new(name + '_' + role)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        uv = mesh.uv_layers.new(name='UVMap')
        for li, loop in enumerate(mesh.loops):
            uv.data[li].uv = uvlist[li]
        o = new_obj(name + '_' + role, mesh)
        o.data.materials.append(mats[role])
        objs.append(o)
    return objs

def fractured(name, kind, radius, seed, squash=0.82, vc_wet=None):
    """Rock solid: ico or cube base displaced by planar cuts +
    mild jitter, flat shaded. Origin ends at ground level with
    ~18% of the radius embedded below z=0. vc_wet: if set, paint
    vertex colours dark below that height (shore wet band)."""
    rng = random.Random(seed)
    if kind == 'blocky':
        bpy.ops.mesh.primitive_cube_add(size=2)
        o = bpy.context.active_object
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.subdivide(number_cuts=2)
        bpy.ops.object.mode_set(mode='OBJECT')
    else:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
        o = bpy.context.active_object
    o.name = name
    planes = []
    for _ in range(4):
        n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        n.normalize()
        planes.append((n, radius * rng.uniform(0.55, 0.9)))
    stretch = 1.35 if kind == 'sharp' else 1.0
    for v in o.data.vertices:
        p = v.co * radius
        p.x *= stretch
        p = p * (1 + rng.uniform(-0.11, 0.11))
        for n, c in planes:
            d = p.dot(n) - c
            if d > 0:
                p = p - n * d
        v.co = Vector((p.x, p.y, p.z * squash))
    minz = min(v.co.z for v in o.data.vertices)
    for v in o.data.vertices:
        v.co.z -= minz + radius * 0.18
    for p in o.data.polygons:
        p.use_smooth = False
    if vc_wet is not None:
        ca = o.data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
        for i, v in enumerate(o.data.vertices):
            t = max(0.0, min(1.0, (v.co.z - vc_wet * 0.4) / (vc_wet * 0.8)))
            dark = 0.32 + 0.68 * t
            ca.data[i].color = (dark, dark * 1.02, dark * 0.98, 1.0)
    o.data.update()
    return o

def box(name, sx, sy, sz, loc, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (sx, sy, sz)
    o.location = loc
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = False
    return o

# ----------------------------------------------------------------
# export + registry
# ----------------------------------------------------------------

def export_model(tid, objs, meta, lod=False):
    fname = tid + ('_lod1.glb' if lod else '.glb')
    tris = 0
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for o in objs:
        if o.type == 'MESH':
            o.data.transform(o.matrix_world)
            o.matrix_world = bpy.data.objects.new('tmp', None).matrix_world if False else o.matrix_world
            o.location = (0, 0, 0)
            o.rotation_euler = (0, 0, 0)
            o.scale = (1, 1, 1)
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
            for v in o.data.vertices:
                co = v.co
                mn[0] = min(mn[0], co.x); mx[0] = max(mx[0], co.x)
                mn[1] = min(mn[1], co.y); mx[1] = max(mx[1], co.y)
                mn[2] = min(mn[2], co.z); mx[2] = max(mx[2], co.z)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, fname),
                              export_format='GLB', use_selection=True,
                              export_apply=True)
    size = {'w': round(mx[0] - mn[0], 2), 'd': round(mx[1] - mn[1], 2),
            'h': round(mx[2] - mn[2], 2)}
    MEASURED[tid + ('_lod1' if lod else '')] = {**size, 'tris': tris}
    if not lod:
        e = dict(meta)
        e['assetId'] = tid
        e['file'] = 'models/' + fname
        e['sizeM'] = size
        e['triangles'] = tris
        REGISTRY.append(e)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return fname

def M(kind='model', area=('forest',), stage='primitive', scale=(0.85, 1.2),
      rotation='free-y', slope=25, clearance=0.6, embed=0.05,
      align='upright', cond=None, collision=None, harvest=None):
    return {
        'kind': kind, 'areas': list(area), 'stage': stage,
        'origin': 'ground-centre', 'groundContactY': 0,
        'scaleRange': list(scale), 'rotation': rotation,
        'maxSlopeDeg': slope, 'clearanceM': clearance, 'embedM': embed,
        'slopeAlign': align,
        'conditions': cond or {},
        'lod': [{'level': 0, 'distance': [0, 30]}, {'level': 1, 'distance': [30, 90]}],
        'collision': collision or {'shape': 'none'},
        'harvest': harvest or {'role': 'decor'},
    }

# ----------------------------------------------------------------
# trees
# ----------------------------------------------------------------

def build_tree(tid, height, spread, lean, seed, lod=False):
    rng = random.Random(seed)
    n = 3 if lod else 4
    pts = []
    x = y = 0.0
    for i in range(n + 1):
        t = i / n
        pts.append(Vector((x, y, -0.15 + (height * 0.6 + 0.15) * t)))
        x += lean * 0.22 * rng.uniform(0.6, 1.3)
        y += lean * 0.08 * rng.uniform(-1, 1)
    paths = [(pts, 0.3, 0.09)]
    for k in range(4):
        a = k * math.pi / 2 + rng.uniform(-0.3, 0.3)
        paths.append(([Vector((0, 0, 0.14)),
                       Vector((math.cos(a) * 0.36, math.sin(a) * 0.36, -0.14))],
                      0.12, 0.04))
    tops = []
    for k in range(3 if lod else 4):
        si = 2 + (k % 2)
        bp = pts[min(si, len(pts) - 1)]
        a = rng.uniform(0, math.pi * 2)
        up = rng.uniform(0.5, 0.95)
        L = spread * rng.uniform(0.55, 0.85)
        mid = bp + Vector((math.cos(a) * L * 0.5, math.sin(a) * L * 0.5, up * L * 0.45))
        end = bp + Vector((math.cos(a) * L, math.sin(a) * L, up * L))
        paths.append(([bp, mid, end], 0.1, 0.03))
        tops += [mid, end]
    tops.append(pts[-1] + Vector((0, 0, 0.3)))
    trunk = tube(tid + '_trunk', paths, BARK())
    cards = []
    per = 3 if lod else 5
    for top in tops:
        for i in range(per):
            off = Vector((rng.uniform(-0.5, 0.5) * spread * 0.42,
                          rng.uniform(-0.5, 0.5) * spread * 0.42,
                          rng.uniform(-0.2, 0.45)))
            role = 'deep' if i == 0 else ('droop' if off.z < 0.02 else
                    ('light' if rng.random() < 0.3 else 'bright'))
            cards.append((tuple(top + off), rng.uniform(0.85, 1.25) * spread * 0.4,
                          rng.uniform(0.65, 0.95), rng.uniform(0, 3.1), role))
    leaf = cards_obj(tid + '_leaf', cards,
                     {'deep': LEAF['deep'](), 'bright': LEAF['bright'](),
                      'droop': LEAF['droop'](), 'light': LEAF['light']()})
    return [trunk] + leaf

def build_conifer(tid, species, seed, lod=False):
    rng = random.Random(seed)
    H = 3.5 if species == 'cedar' else 4.1
    trunk = tube(tid + '_trunk',
                 [([Vector((0, 0, -0.15)), Vector((0.03, 0, H * 0.94))], 0.16, 0.05)],
                 BARK())
    objs = [trunk]
    cards = []
    tiers = 4 if lod else (5 if species == 'cedar' else 6)
    # Tiers are crossed spray-card clusters, NOT solid cones —
    # stacked frustums read as plates at scene distance (owner
    # spec section 3 bans cone-stack foliage). A short solid
    # spike closes the top.
    for i in range(tiers):
        t = i / (tiers - 1) if tiers > 1 else 0
        z = H * (0.3 + 0.62 * t)
        R = (1.25 if species == 'cedar' else 1.0) * (1 - t * 0.62)
        per = 2 if lod else 4
        for k in range(per):
            a = rng.uniform(0, math.pi * 2)
            cards.append(((math.cos(a) * R * 0.3, math.sin(a) * R * 0.3,
                           z - 0.35), R * 1.9, 0.78, rng.uniform(0, 3.1), species))
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.3, radius2=0.02,
                                    depth=0.8, location=(0, 0, H * 0.97))
    spike = bpy.context.active_object
    spike.name = tid + '_spike'
    for p in spike.data.polygons:
        p.use_smooth = False
    spike.data.materials.append(mat_color('envConiferSolid',
        (0.09, 0.2, 0.08, 1) if species == 'cedar' else (0.07, 0.17, 0.1, 1)))
    objs.append(spike)
    if cards:
        objs += cards_obj(tid + '_spray', cards,
                          {'cedar': LEAF['cedar'](), 'pine': LEAF['pine']()})
    return objs

def build_shrub(tid, style, seed, lod=False):
    rng = random.Random(seed)
    paths = []
    for k in range(3):
        a = k * 2.1 + rng.uniform(-0.3, 0.3)
        paths.append(([Vector((0, 0, -0.05)),
                       Vector((math.cos(a) * 0.22, math.sin(a) * 0.22, 0.42))],
                      0.05, 0.02))
    stems = tube(tid + '_stems', paths, BARK())
    cards = []
    roles = {'round': ['bright', 'deep'], 'flower': ['flower', 'bright'],
             'berry': ['berry', 'bright']}[style]
    for i in range(4 if lod else 7):
        a = rng.uniform(0, math.pi * 2)
        r = rng.uniform(0, 0.3)
        cards.append(((math.cos(a) * r, math.sin(a) * r, rng.uniform(0.3, 0.62)),
                      rng.uniform(0.55, 0.8), rng.uniform(0.45, 0.65),
                      rng.uniform(0, 3.1), roles[i % 2]))
    mats = {'bright': LEAF['bright'](), 'deep': LEAF['deep'](),
            'flower': LEAF['flower'](), 'berry': LEAF['berry']()}
    return [stems] + cards_obj(tid + '_leaf', cards, mats)

# ----------------------------------------------------------------
# cliffs
# ----------------------------------------------------------------

def build_cliff(tid, kind):
    W, H = 4.0, 3.0
    if kind == 'top':
        H = 0.8
    if kind == 'bottom':
        H = 1.4
    COLS, ROWS = 12, 8
    rng = random.Random(hash(tid) & 0xffff)
    verts, faces, uvs = [], [], []
    for j in range(ROWS + 1):
        z = H * j / ROWS
        for i in range(COLS + 1):
            x = -W / 2 + W * i / COLS
            y = 0.12 * math.sin(x * 1.35) + 0.05 * math.sin(x * 3.7 + 1.3)
            y += (int(z / 0.75) % 2) * 0.025  # strata steps
            if kind == 'concave':
                y -= 0.55 * (1 - (x / (W / 2)) ** 2)
            if kind == 'convex':
                y += 0.5 * (1 - (x / (W / 2)) ** 2)
            if kind == 'bottom':
                y += (1 - z / H) * 0.85  # talus flare
            if kind == 'top':
                y += z * 0.15
            verts.append((x, y, z))
            uvs.append(((x + W / 2) / 1.25, z / 1.25))
    for j in range(ROWS):
        for i in range(COLS):
            a = j * (COLS + 1) + i
            faces.append((a, a + 1, a + COLS + 2, a + COLS + 1))
    mesh = bpy.data.meshes.new(tid)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    for li, loop in enumerate(mesh.loops):
        uv.data[li].uv = uvs[loop.vertex_index]
    o = new_obj(tid, mesh)
    o.data.materials.append(CLIFFM())
    # solidify for thickness
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    mod = o.modifiers.new('sol', 'SOLIDIFY')
    mod.thickness = 1.1
    mod.offset = 1.0
    bpy.ops.object.modifier_apply(modifier='sol')
    o.select_set(False)
    for p in o.data.polygons:
        p.use_smooth = False
    return [o]

# ----------------------------------------------------------------
# coast smalls + waterfall frame
# ----------------------------------------------------------------

def build_pebbles(seed):
    rng = random.Random(seed)
    objs = []
    for i in range(5):
        r = fractured(f'peb{i}', 'round', rng.uniform(0.07, 0.14), seed + i)
        # offset via vertex translation
        cx, cy = rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)
        for v in r.data.vertices:
            v.co.x += cx
            v.co.y += cy
        r.data.materials.append(ROCKM())
        objs.append(r)
    return objs

def build_shell_scallop(seed):
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.17, radius2=0.02,
                                    depth=0.07, location=(0, 0, 0.035))
    o = bpy.context.active_object
    o.name = 'shell'
    for v in o.data.vertices:
        a = math.atan2(v.co.y, v.co.x)
        v.co.z += abs(math.sin(a * 7)) * 0.012
    for p in o.data.polygons:
        p.use_smooth = False
    o.data.materials.append(mat_color('envShell', (0.92, 0.85, 0.78, 1), 0.7))
    return [o]

def build_shell_conch(seed):
    pts = []
    for i in range(14):
        t = i / 13
        a = t * math.pi * 3.4
        r = 0.16 * (1 - t * 0.75)
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r, 0.05 + t * 0.13)))
    o = tube('conch', [(pts, 0.085, 0.015)], mat_color('envConch', (0.88, 0.76, 0.66, 1), 0.65))
    return [o]

def build_driftwood(seed):
    rng = random.Random(seed)
    pts = [Vector((-1.1, 0, 0.16)), Vector((-0.4, 0.12, 0.2)),
           Vector((0.35, -0.06, 0.17)), Vector((1.05, 0.05, 0.13))]
    o = tube('driftwood', [(pts, 0.15, 0.09)],
             mat_color('envDrift', (0.72, 0.68, 0.6, 1), 1.0))
    return [o]

def build_waterfall_frame(seed):
    left = fractured('wfL', 'blocky', 1.05, seed)
    for v in left.data.vertices:
        v.co.x -= 1.55
        v.co.z += 0.9
    left.data.materials.append(ROCKM())
    right = fractured('wfR', 'blocky', 0.95, seed + 1)
    for v in right.data.vertices:
        v.co.x += 1.5
        v.co.z += 0.85
    right.data.materials.append(ROCKM())
    lintel = fractured('wfT', 'sharp', 0.8, seed + 2)
    for v in lintel.data.vertices:
        v.co.z += 2.35
        v.co.x *= 1.9
    lintel.data.materials.append(ROCKM())
    return [left, right, lintel]

# ----------------------------------------------------------------
# main
# ----------------------------------------------------------------

def main():
    wipe()
    tree_meta = M(area=('forest',), clearance=1.4, embed=0.12,
                  collision={'shape': 'circle', 'radius': 0.3, 'height': 3.5},
                  harvest={'role': 'target', 'depletedAssetId': 'stump'})
    # broadleaf: 3 archetypes x 2 variations
    for tid, h, sp, lean, seed in [
            ('tree-broadleaf-a1', 4.3, 2.6, 0.10, 101), ('tree-broadleaf-a2', 4.5, 2.8, -0.16, 202),
            ('tree-broadleaf-b1', 5.2, 2.2, 0.06, 303), ('tree-broadleaf-b2', 5.0, 2.3, 0.2, 404),
            ('tree-broadleaf-c1', 3.0, 1.7, 0.12, 505), ('tree-broadleaf-c2', 3.2, 1.8, -0.08, 606)]:
        export_model(tid, build_tree(tid, h, sp, lean, seed), tree_meta)
        export_model(tid, build_tree(tid, h, sp, lean, seed, lod=True), tree_meta, lod=True)
    # conifers x2
    for tid, sp_, seed in [('tree-conifer-cedar', 'cedar', 707), ('tree-conifer-pine', 'pine', 808)]:
        export_model(tid, build_conifer(tid, sp_, seed),
                     M(area=('forest', 'snow'), clearance=1.1, embed=0.12,
                       collision={'shape': 'circle', 'radius': 0.24, 'height': 3.4},
                       harvest={'role': 'target', 'depletedAssetId': 'stump'}))
        export_model(tid, build_conifer(tid, sp_, seed, lod=True), {}, lod=True)
    # shrubs x3
    for tid, style, seed in [('shrub-round', 'round', 909), ('shrub-flower', 'flower', 1010),
                             ('shrub-berry', 'berry', 1111)]:
        export_model(tid, build_shrub(tid, style, seed),
                     M(area=('forest',), clearance=0.5, slope=35,
                       collision={'shape': 'circle', 'radius': 0.4, 'height': 0.7},
                       harvest={'role': 'target', 'depletedAssetId': None}))
        export_model(tid, build_shrub(tid, style, seed, lod=True), {}, lod=True)
    # rocks: 3 families x S/M/L
    rock_meta = M(area=('forest', 'mountain'), clearance=0.7, embed=0.15,
                  collision={'shape': 'circle', 'radius': 0.7, 'height': 0.9},
                  harvest={'role': 'target', 'depletedAssetId': 'rock-m-depleted'})
    for fam in ('blocky', 'round', 'sharp'):
        for sz, r in (('s', 0.45), ('m', 0.95), ('l', 1.7)):
            tid = f'rock-{sz}-{fam}'
            o = fractured(tid, fam, r, hash(tid) & 0xffff)
            o.data.materials.append(ROCKM())
            m = dict(rock_meta)
            m['clearanceM'] = round(r * 1.1, 2)
            m['collision'] = {'shape': 'circle', 'radius': round(r * 0.72, 2),
                              'height': round(r * 1.1, 2)}
            export_model(tid, [o], m)
            if sz in ('m', 'l'):
                o2 = fractured(tid, fam, r, hash(tid) & 0xffff)
                o2.data.materials.append(ROCKM())
                export_model(tid, [o2], {}, lod=True)
    # depleted rock (after-state for M rocks)
    dep = fractured('rock-m-depleted', 'round', 0.95, 4242, squash=0.42)
    dep.data.materials.append(ROCKM())
    export_model('rock-m-depleted', [dep],
                 M(area=('forest', 'mountain'), clearance=0.7, embed=0.1,
                   harvest={'role': 'depleted'}))
    # shore rocks x2 (vertex-colour wet band)
    for tid, fam, seed in [('rock-shore-1', 'round', 3131), ('rock-shore-2', 'sharp', 3232)]:
        o = fractured(tid, fam, 1.05, seed, vc_wet=0.34)
        o.data.materials.append(ROCKVC())
        export_model(tid, [o],
                     M(area=('coast', 'lakeside'), clearance=0.8, embed=0.2,
                       cond={'placement': 'shoreline', 'waterlineM': 0.34},
                       collision={'shape': 'circle', 'radius': 0.75, 'height': 1.0},
                       harvest={'role': 'target', 'depletedAssetId': 'rock-m-depleted'}))
    # cliffs x5
    for kind in ('straight', 'concave', 'convex', 'top', 'bottom'):
        tid = 'cliff-' + kind
        objs = build_cliff(tid, kind)
        meta = M(area=('mountain',), clearance=0.3, embed=0.25, slope=90,
                 scale=(0.75, 2.0), align='terrain',
                 collision={'shape': 'box', 'size': [4.0, 1.2, 3.0]})
        export_model(tid, objs, meta)
        REGISTRY[-1]['lod'] = [{'level': 0, 'distance': [0, 120]}]
    # coast smalls
    export_model('pebble-cluster', build_pebbles(5151),
                 M(area=('coast', 'forest'), clearance=0.25, slope=45, align='terrain'))
    export_model('shell-scallop', build_shell_scallop(5252),
                 M(area=('coast',), clearance=0.12, slope=40, align='terrain', scale=(0.7, 1.6)))
    export_model('shell-conch', build_shell_conch(5353),
                 M(area=('coast',), clearance=0.12, slope=40, align='terrain', scale=(0.7, 1.6)))
    export_model('driftwood', build_driftwood(5454),
                 M(area=('coast', 'lakeside'), clearance=0.9, slope=30, align='terrain',
                   cond={'placement': 'shoreline'}))
    export_model('waterfall-rock-frame', build_waterfall_frame(5555),
                 M(area=('mountain', 'forest'), clearance=1.2, embed=0.2,
                   cond={'placement': 'waterfall-lip'}))

    # ---- hand entries: pre-existing assets reused as-is (§8) ----
    dq3m = {}
    try:
        dq3m = json.load(open(os.path.join(BASE, 'gpt-dq3', 'models-measured.json')))
    except Exception:
        pass
    def hand(tid, file, size, meta):
        e = dict(meta)
        e['assetId'] = tid
        e['file'] = file
        e['sizeM'] = size
        REGISTRY.append(e)
    sz = lambda k, d: dq3m.get(k, d)
    hand('stump', 'gpt-dq3/models/stump.glb', sz('stump', {'w': 0.7, 'h': 0.55, 'd': 0.7}),
         M(area=('forest',), clearance=0.4, harvest={'role': 'depleted', 'ofAssetId': 'tree-broadleaf-a1'}))
    hand('log-fallen', 'gpt-dq3/models/log-fallen.glb', sz('log-fallen', {'w': 2.4, 'h': 0.5, 'd': 0.6}),
         M(area=('forest', 'coast'), clearance=0.9, align='terrain'))
    hand('moss-rock', 'gpt-dq3/models/moss-rock.glb', sz('moss-rock', {'w': 1.1, 'h': 0.8, 'd': 1.0}),
         M(area=('forest',), clearance=0.7,
           collision={'shape': 'circle', 'radius': 0.6, 'height': 0.7},
           harvest={'role': 'target', 'depletedAssetId': 'rock-m-depleted'}))
    for i in (1, 2, 3):
        hand(f'basalt-{i}', f'gpt-dq3/models/basalt-{i}.glb',
             sz(f'basalt-{i}', {'w': 1.6, 'h': 0.9, 'd': 1.2}),
             M(area=('volcano',), clearance=0.8, embed=0.15,
               collision={'shape': 'circle', 'radius': 0.8, 'height': 0.9}))
    spr = M(kind='sprite', slope=50, align='terrain', scale=(0.8, 1.3))
    def sprite(tid, file, size, area, cond=None):
        e = dict(spr)
        e['areas'] = list(area)
        if cond:
            e['conditions'] = cond
        hand(tid, file, size, e)
    sprite('grass-short', 'module:AssetManager.createGrassTuftTexture',
           {'w': 0.5, 'h': 0.35, 'd': 0.5}, ('forest',))
    sprite('grass-mid', 'gpt-dq3/sprays/grass-wide.png', {'w': 0.7, 'h': 0.5, 'd': 0.7}, ('forest',))
    sprite('grass-tall', 'gpt-dq3/sprays/grass-tall.png', {'w': 0.8, 'h': 0.95, 'd': 0.8}, ('forest',))
    sprite('flower-white', 'gpt-dq3/sprays/flower-white.png', {'w': 0.4, 'h': 0.4, 'd': 0.4}, ('forest',))
    sprite('flower-yellow', 'gpt-dq3/sprays/flower-yellow.png', {'w': 0.4, 'h': 0.4, 'd': 0.4}, ('forest',))
    sprite('flower-pink', 'gpt-dq3/sprays/flower-pink.png', {'w': 0.4, 'h': 0.4, 'd': 0.4}, ('forest',))
    sprite('leaf-litter', 'gpt-dq3/sprays/leaf-pile.png', {'w': 0.9, 'h': 0.06, 'd': 0.9}, ('forest',))
    sprite('fallen-branch', 'branch-cards/branch-1.png', {'w': 0.9, 'h': 0.3, 'd': 0.4}, ('forest',))
    sprite('reed', 'gpt-expansion/sprays/reed.png', {'w': 0.7, 'h': 1.2, 'd': 0.7},
           ('lakeside', 'coast'), {'placement': 'shoreline', 'waterDepthM': [0.0, 0.35]})
    sprite('lily', 'gpt-expansion/sprays/lily.png', {'w': 0.8, 'h': 0.08, 'd': 0.8},
           ('lakeside',), {'placement': 'on-water'})
    sprite('floating-plants', 'gpt-dq3/sprays/floating-plants.png', {'w': 0.7, 'h': 0.06, 'd': 0.7},
           ('lakeside', 'coast'), {'placement': 'on-water'})
    hand('waterfall-kit', 'threejs-hd2d-graphics/src/graphics/WaterfallKit.ts',
         {'w': 2.4, 'h': 5.6, 'd': 5.6},
         M(kind='runtime', area=('forest', 'mountain'), clearance=1.6,
           cond={'placement': 'terrain-step', 'dropM': [1.5, 14], 'widthM': [1.2, 3.5],
                 'anchors': 'assets/environment-set/waterfall.json'}))
    hand('ground-forest', 'gpt-expansion/ground/ground-forest.png',
         {'w': 7, 'h': 0, 'd': 7},
         M(kind='ground', area=('forest',), slope=90, align='terrain',
           cond={'tileM': 7, 'splatChannel': 'splat.r'}))

    for e in REGISTRY:
        if not e['file'].startswith(('gpt-', 'branch-', 'module:', 'threejs-')):
            e['file'] = 'environment-set/' + e['file']
    doc = {
        'version': 1, 'generated': '2026-11-07', 'root': 'assets/',
        'conventions': 'origin ground-centre; front +Z (three.js); metres; '
                       'lod1 files sit next to their level-0 file with _lod1 suffix',
        'assets': REGISTRY,
    }
    with open(os.path.join(ROOT, 'metadata.json'), 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    with open(os.path.join(ROOT, 'models-measured.json'), 'w') as f:
        json.dump(MEASURED, f, indent=1)
    print(f'ENV-SET DONE: {len(REGISTRY)} registry entries, '
          f'{len(MEASURED)} measured models')

main()
