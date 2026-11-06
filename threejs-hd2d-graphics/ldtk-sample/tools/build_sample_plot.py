#!/usr/bin/env python3
"""Build sample-plot.ldtk — an LDtk 1.5.3 project describing the HD-2D
sample plot (見本区画) so the layout can be authored as data instead of
being hard-coded in the demo (INTEGRATION §18).

The JSON skeleton (every boilerplate key LDtk requires) is cloned from
LDtk's own bundled sample `Entities.ldtk`, which ships with the editor
under extraFiles/samples/. Only defs/levels are replaced.

Coordinate mapping (also stored inside the file as level fields):
  level covers world x in [-50, -26], z in [18, 42]  (24 m x 24 m)
  32 px = 1 m, grid 16 px = 0.5 m, LDtk +y (down) -> world +z
  every entity def uses pivot (0.5, 0.5), so instance `px` is the
  entity CENTRE in level pixels.

Node placement is identical to the demo plot of round 9
(demo/main.ts setNaturalObjects list), so the converter output can be
checked 1:1 against it.

Usage: python3 build_sample_plot.py [template.ldtk]
"""
import copy
import json
import math
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.expanduser(
    "~/workspace/tools/ldtk/squashfs-root/extraFiles/samples/Entities.ldtk"
)
OUT = os.path.normpath(os.path.join(HERE, "..", "sample-plot.ldtk"))

ORIGIN_X, ORIGIN_Z, PX_M = -50.0, 18.0, 32.0
LEVEL_M = 24.0
GRID = 16
CELLS = int(LEVEL_M * PX_M / GRID)  # 48
LEVEL_PX = int(LEVEL_M * PX_M)  # 768

_uid = [500]


def nid():
    _uid[0] += 1
    return _uid[0]


def new_iid():
    return str(uuid.uuid4())


# ---------------------------------------------------------------- fields
def make_field(tpl, identifier, ftype, default, doc=None):
    """Clone a fieldDef template and retarget it. ftype: Float|Bool|String."""
    vid = {"Float": "V_Float", "Bool": "V_Bool", "String": "V_String"}[ftype]
    f = copy.deepcopy(tpl)
    f["identifier"] = identifier
    f["uid"] = nid()
    f["__type"] = ftype
    f["type"] = "F_" + ftype
    f["isArray"] = False
    f["canBeNull"] = False
    f["min"] = None
    f["max"] = None
    f["regex"] = None
    f["editorTextSuffix"] = None
    f["editorShowInWorld"] = False  # keep the map view readable; values show in the inspector
    f["editorAlwaysShow"] = False
    f["defaultOverride"] = {"id": vid, "params": [default]}
    f["doc"] = doc
    return f


def field_instance(fdef, value):
    vid = {"Float": "V_Float", "Bool": "V_Bool", "String": "V_String"}[fdef["__type"]]
    return {
        "__identifier": fdef["identifier"],
        "__type": fdef["__type"],
        "__value": value,
        "__tile": None,
        "defUid": fdef["uid"],
        "realEditorValues": [{"id": vid, "params": [value]}],
    }


def node_fields(tpl_float, tpl_bool, tpl_str):
    return [
        make_field(tpl_float, "scale", "Float", 1.0, "Graphics scale (1 = default size)"),
        make_field(tpl_str, "variant", "String", "", "Appearance variant: flint, basalt... (empty = none)"),
        make_field(tpl_str, "state", "String", "available", "available | depleted"),
        make_field(tpl_bool, "highlighted", "Bool", False, "Show the selection highlight ring"),
    ]


# ---------------------------------------------------------------- entities
def make_entity_def(base, identifier, w, h, color, fields, render="Rectangle",
                    resizable=False, hollow=False, fill_opacity=0.3,
                    max_count=0, scope="PerLevel", behavior="DiscardOldOnes",
                    doc=None):
    e = copy.deepcopy(base)
    e.update(
        identifier=identifier, uid=nid(), width=w, height=h, color=color,
        renderMode=render, tilesetId=None, tileRect=None, uiTileRect=None,
        pivotX=0.5, pivotY=0.5, tags=[], exportToToc=False, doc=doc,
        resizableX=resizable, resizableY=resizable, hollow=hollow,
        fillOpacity=fill_opacity, lineOpacity=0.6 if hollow else 0.44,
        maxCount=max_count, limitScope=scope, limitBehavior=behavior,
        fieldDefs=fields, showName=True,
        minWidth=None, maxWidth=None, minHeight=None, maxHeight=None,
    )
    return e


def entity_instance(tpl, ent_def, wx, wz, values, w=None, h=None):
    px = [round((wx - ORIGIN_X) * PX_M), round((wz - ORIGIN_Z) * PX_M)]
    inst = copy.deepcopy(tpl)
    inst.update(
        __identifier=ent_def["identifier"],
        __grid=[px[0] // GRID, px[1] // GRID],
        __pivot=[0.5, 0.5],
        __smartColor=ent_def["color"],
        __tags=[],
        __tile=None,
        defUid=ent_def["uid"],
        width=w if w is not None else ent_def["width"],
        height=h if h is not None else ent_def["height"],
        iid=new_iid(),
        px=px,
        fieldInstances=[field_instance(fd, v) for fd, v in values],
    )
    return inst


# ------------------------------------------------------------------- main
def main():
    tpl_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEMPLATE
    tpl = json.load(open(tpl_path))
    tpl_defs = {e["identifier"]: e for e in tpl["defs"]["entities"]}
    tpl_fields = {}
    for e in tpl["defs"]["entities"]:
        for f in e.get("fieldDefs", []):
            tpl_fields.setdefault(f["__type"], f)
    tpl_layer_defs = {l["identifier"]: l for l in tpl["defs"]["layers"]}
    tpl_level = tpl["levels"][0]
    tpl_inst = {}
    for li in tpl_level["layerInstances"]:
        tpl_inst[li["__type"]] = li

    base_ent = tpl_defs["PlayerStart"]

    # ---- entity defs -------------------------------------------------
    kinds = [  # identifier, w, h, editor color
        ("Tree", 32, 48, "#4E9B47"), ("Rock", 32, 28, "#8D99AE"),
        ("Ore", 32, 30, "#B08968"), ("Bush", 28, 24, "#588157"),
        ("Grass", 20, 20, "#A7C957"), ("Herb", 18, 18, "#6A994E"),
        ("Flowers", 18, 18, "#E5989B"), ("Branch", 22, 10, "#99582A"),
        ("Pebble", 14, 12, "#ADB5BD"), ("Water", 26, 26, "#4CC9F0"),
        ("Oil", 26, 26, "#7B2CBF"),
    ]
    ent_defs, def_by_id = [], {}
    for ident, w, h, color in kinds:
        d = make_entity_def(
            base_ent, ident, w, h, color,
            node_fields(tpl_fields["Float"], tpl_fields["Bool"], tpl_fields["Int"]),
            doc="Gatherable natural object (game-owned; graphics renders it)",
        )
        ent_defs.append(d)
        def_by_id[ident] = d
    clearing_def = make_entity_def(
        base_ent, "Clearing", 576, 576, "#FFD166",
        [make_field(tpl_fields["Float"], "radius", "Float", 9.0,
                    "Scenery-free radius in meters -> decor.clearings")],
        render="Ellipse", resizable=True, hollow=True, fill_opacity=0.08,
        doc="Area kept free of scenery scatter (owner: graphics decor)",
    )
    ent_defs.append(clearing_def)
    def_by_id["Clearing"] = clearing_def
    spawn_def = make_entity_def(
        base_ent, "Spawn", 20, 20, "#FF5964", [],
        max_count=1, scope="PerWorld", behavior="MoveLastOne",
        doc="Player spawn / teleport target for checks",
    )
    ent_defs.append(spawn_def)
    def_by_id["Spawn"] = spawn_def

    # ---- layer defs --------------------------------------------------
    ground_def = copy.deepcopy(tpl_layer_defs["Collisions"])
    ground_def.update(
        identifier="Ground", uid=nid(), gridSize=GRID,
        intGridValues=[
            {"value": 1, "identifier": "grass", "color": "#7FB069", "tile": None, "groupUid": 0},
            {"value": 2, "identifier": "dirt", "color": "#9C6644", "tile": None, "groupUid": 0},
            {"value": 3, "identifier": "path", "color": "#C2A878", "tile": None, "groupUid": 0},
            {"value": 4, "identifier": "gravel", "color": "#9A9A92", "tile": None, "groupUid": 0},
        ],
        intGridValuesGroups=[], autoRuleGroups=[],
    )
    nat_layer_def = copy.deepcopy(tpl_layer_defs["GameEntities"])
    nat_layer_def.update(identifier="NaturalObjects", uid=nid(), gridSize=GRID)

    # ---- level fields -------------------------------------------------
    level_field_defs = [
        make_field(tpl_fields["Float"], "originX", "Float", ORIGIN_X,
                   "World x of the level top-left corner (meters)"),
        make_field(tpl_fields["Float"], "originZ", "Float", ORIGIN_Z,
                   "World z of the level top-left corner (meters); LDtk +y maps to +z"),
        make_field(tpl_fields["Float"], "pxPerMeter", "Float", PX_M,
                   "Pixels per meter in this project"),
    ]

    # ---- ground painting (IntGrid csv, row-major) ---------------------
    csv = [1] * (CELLS * CELLS)

    def setc(cx, cy, v):
        if 0 <= cx < CELLS and 0 <= cy < CELLS:
            csv[cy * CELLS + cx] = v

    for cy in range(CELLS):  # worn dirt ellipse around the plot centre
        for cx in range(CELLS):
            dx, dz = (cx - 23.5) / 9.5, (cy - 23.5) / 7.5
            q = dx * dx + dz * dz
            if q <= 1.0:
                if q > 0.62 and ((cx * 73856093) ^ (cy * 19349663)) % 5 == 0:
                    continue  # ragged rim
                setc(cx, cy, 2)
    for cy in range(CELLS):  # gravel patch under the pebble cluster
        for cx in range(CELLS):
            if (cx - 31) ** 2 + (cy - 25) ** 2 <= 2.6 ** 2:
                setc(cx, cy, 4)
    for cy in range(29, CELLS):  # foot path entering from the south edge
        cxc = 24 + round(2.2 * math.sin(cy * 0.13))
        for cx in (cxc - 1, cxc, cxc + 1):
            setc(cx, cy, 3)

    # ---- entity instances ---------------------------------------------
    # ident, world x, world z, {field overrides}
    nodes = [
        ("Tree", -42.5, 26.0, {"scale": 1.15}),
        ("Tree", -34.0, 25.5, {"scale": 0.95}),
        ("Rock", -43.5, 34.0, {}),
        ("Ore", -33.0, 33.5, {}),
        ("Bush", -38.5, 35.0, {}),
        ("Grass", -40.5, 30.0, {}),
        ("Grass", -36.0, 29.0, {}),
        ("Grass", -39.5, 32.5, {"state": "depleted"}),
        ("Herb", -38.0, 26.5, {"highlighted": True}),
        ("Flowers", -36.5, 32.0, {}),
        ("Branch", -41.0, 33.0, {}),
        ("Pebble", -34.5, 30.5, {"variant": "flint"}),
        ("Water", -43.0, 29.5, {}),
        ("Oil", -33.5, 27.0, {}),
    ]
    instances = []
    for ident, wx, wz, over in nodes:
        d = def_by_id[ident]
        by_name = {f["identifier"]: f for f in d["fieldDefs"]}
        vals = {"scale": 1.0, "variant": "", "state": "available", "highlighted": False}
        vals.update(over)
        instances.append(entity_instance(
            tpl_inst["Entities"], d, wx, wz,
            [(by_name[k], vals[k]) for k in ("scale", "variant", "state", "highlighted")],
        ))
    instances.append(entity_instance(
        tpl_inst["Entities"], clearing_def, -38.0, 30.0,
        [(clearing_def["fieldDefs"][0], 9.0)], w=576, h=576,
    ))
    instances.append(entity_instance(tpl_inst["Entities"], spawn_def, -38.0, 31.5, []))

    # ---- layer instances ----------------------------------------------
    def layer_instance(tpl_li, layer_def, is_entities):
        li = copy.deepcopy(tpl_li)
        li.update(
            __identifier=layer_def["identifier"], __type=layer_def["__type"],
            __cWid=CELLS, __cHei=CELLS, __gridSize=GRID,
            __tilesetDefUid=None, __tilesetRelPath=None,
            iid=new_iid(), levelId=0, layerDefUid=layer_def["uid"],
            pxOffsetX=0, pxOffsetY=0, visible=True, optionalRules=[],
            autoLayerTiles=[], gridTiles=[],
            intGridCsv=[], entityInstances=[],
        )
        if "overrideTilesetUid" in li:
            li["overrideTilesetUid"] = None
        li["seed"] = 424242
        return li

    nat_inst = layer_instance(tpl_inst["Entities"], nat_layer_def, True)
    nat_inst["entityInstances"] = instances
    ground_inst = layer_instance(tpl_inst["IntGrid"], ground_def, False)
    ground_inst["intGridCsv"] = csv

    # ---- level ----------------------------------------------------------
    level = copy.deepcopy(tpl_level)
    level.update(
        identifier="Sample_Plot", uid=0, iid=new_iid(),
        worldX=0, worldY=0, worldDepth=0,
        pxWid=LEVEL_PX, pxHei=LEVEL_PX, bgColor=None,
        externalRelPath=None,
        fieldInstances=[
            field_instance(level_field_defs[0], ORIGIN_X),
            field_instance(level_field_defs[1], ORIGIN_Z),
            field_instance(level_field_defs[2], PX_M),
        ],
        layerInstances=[nat_inst, ground_inst],
    )

    # ---- project --------------------------------------------------------
    proj = copy.deepcopy(tpl)
    proj["iid"] = new_iid()
    proj["levels"] = [level]
    proj["worlds"] = []
    proj["defs"] = {
        "layers": [nat_layer_def, ground_def],
        "entities": ent_defs,
        "enums": [],
        "externalEnums": [],
        "tilesets": [],
        "levelFields": level_field_defs,
    }
    proj["toc"] = []
    proj["externalLevels"] = False
    proj["defaultGridSize"] = GRID
    proj["minifyJson"] = False
    proj["nextUid"] = _uid[0] + 1

    with open(OUT, "w") as fh:
        json.dump(proj, fh, indent="\t", ensure_ascii=False)
    print("wrote", OUT, os.path.getsize(OUT), "bytes;",
          len(instances), "entity instances;",
          "ground csv", len(csv), "cells; nextUid", proj["nextUid"])


if __name__ == "__main__":
    main()
