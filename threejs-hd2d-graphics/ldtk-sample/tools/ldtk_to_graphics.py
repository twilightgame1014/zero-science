#!/usr/bin/env python3
"""Convert an LDtk project (sample-plot.ldtk) into the JSON shape the
HD-2D graphics module consumes:

  clearings      -> GraphicsOptions.decor.clearings  [{x, z, r}]
  naturalObjects -> GraphicsEngine.setNaturalObjects(list) entries
                    {id, position:{x,z}, type, scale?, depleted?,
                     highlighted?, natural?: {kind, variant}}
  ground         -> the IntGrid painting (legend + csv), exported for
                    future use; the current renderer does not read it.

The coordinate mapping is read from the level's own fields
(originX / originZ / pxPerMeter), so the .ldtk file is self-describing.
Entity instance `px` is the entity centre (all defs use pivot 0.5/0.5);
LDtk +y (down) maps to world +z. Node ids follow the nature.js format
"kind:x,z" with coordinates in 0.1-unit units.

Usage:
  python3 ldtk_to_graphics.py [in.ldtk] [--out out.json] [--check]
--check compares the output against the round-9 demo plot
(demo/main.ts) and exits non-zero on any mismatch.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_IN = os.path.normpath(os.path.join(HERE, "..", "sample-plot.ldtk"))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "out", "sample-plot.graphics.json"))

# The round-9 demo plot (demo/main.ts) — the reference for --check.
EXPECTED_NODES = [
    {"id": "tree:-425,260", "position": {"x": -42.5, "z": 26.0}, "type": "tree", "scale": 1.15},
    {"id": "tree:-340,255", "position": {"x": -34.0, "z": 25.5}, "type": "tree", "scale": 0.95},
    {"id": "rock:-435,340", "position": {"x": -43.5, "z": 34.0}, "type": "rock"},
    {"id": "ore:-330,335", "position": {"x": -33.0, "z": 33.5}, "type": "ore"},
    {"id": "bush:-385,350", "position": {"x": -38.5, "z": 35.0}, "type": "bush"},
    {"id": "grass:-405,300", "position": {"x": -40.5, "z": 30.0}, "type": "grass"},
    {"id": "grass:-360,290", "position": {"x": -36.0, "z": 29.0}, "type": "grass"},
    {"id": "grass:-395,325", "position": {"x": -39.5, "z": 32.5}, "type": "grass", "depleted": True},
    {"id": "herb:-380,265", "position": {"x": -38.0, "z": 26.5}, "type": "herb", "highlighted": True},
    {"id": "flowers:-365,320", "position": {"x": -36.5, "z": 32.0}, "type": "flowers"},
    {"id": "branch:-410,330", "position": {"x": -41.0, "z": 33.0}, "type": "branch"},
    {"id": "pebble:-345,305", "position": {"x": -34.5, "z": 30.5}, "type": "pebble",
     "natural": {"kind": "pebble", "variant": "flint"}},
    {"id": "water:-430,295", "position": {"x": -43.0, "z": 29.5}, "type": "water"},
    {"id": "oil:-335,270", "position": {"x": -33.5, "z": 27.0}, "type": "oil"},
]
EXPECTED_CLEARINGS = [{"x": -38.0, "z": 30.0, "r": 9.0}]


def fields_of(instances):
    return {f["__identifier"]: f["__value"] for f in instances}


def convert(proj):
    level = proj["levels"][0]
    lf = fields_of(level.get("fieldInstances", []))
    origin_x = float(lf.get("originX", -50.0))
    origin_z = float(lf.get("originZ", 18.0))
    px_m = float(lf.get("pxPerMeter", 32.0))

    def to_world(px):
        return (round(origin_x + px[0] / px_m, 3), round(origin_z + px[1] / px_m, 3))

    clearings, nodes, spawn = [], [], None
    ground = None
    for li in level["layerInstances"]:
        if li["__type"] == "Entities":
            for e in li["entityInstances"]:
                ident = e["__identifier"]
                f = fields_of(e.get("fieldInstances", []))
                wx, wz = to_world(e["px"])
                if ident == "Clearing":
                    clearings.append({"x": wx, "z": wz, "r": float(f.get("radius", 9.0))})
                elif ident == "Spawn":
                    spawn = {"x": wx, "z": wz}
                else:
                    kind = ident.lower()
                    entry = {
                        "id": f"{kind}:{round(wx * 10)},{round(wz * 10)}",
                        "position": {"x": wx, "z": wz},
                        "type": kind,
                    }
                    scale = float(f.get("scale", 1.0))
                    if scale != 1.0:
                        entry["scale"] = scale
                    if f.get("state") == "depleted":
                        entry["depleted"] = True
                    if f.get("highlighted"):
                        entry["highlighted"] = True
                    variant = f.get("variant") or ""
                    if variant:
                        entry["natural"] = {"kind": kind, "variant": variant}
                    nodes.append(entry)
        elif li["__type"] == "IntGrid":
            ldef = next(l for l in proj["defs"]["layers"] if l["uid"] == li["layerDefUid"])
            legend = {str(v["value"]): v["identifier"] for v in ldef["intGridValues"]}
            ground = {
                "cellMeters": ldef["gridSize"] / px_m,
                "cols": li["__cWid"],
                "rows": li["__cHei"],
                "originX": origin_x,
                "originZ": origin_z,
                "legend": legend,
                "csv": li["intGridCsv"],
            }
    return {
        "source": "sample-plot.ldtk",
        "level": level["identifier"],
        "mapping": {"originX": origin_x, "originZ": origin_z, "pxPerMeter": px_m},
        "clearings": clearings,
        "spawn": spawn,
        "naturalObjects": nodes,
        "ground": ground,
    }


def check(out):
    ok = True

    def norm(n):
        return {
            "position": n["position"], "type": n["type"],
            "scale": n.get("scale", 1.0), "depleted": n.get("depleted", False),
            "highlighted": n.get("highlighted", False), "natural": n.get("natural"),
        }

    got = {n["id"]: n for n in out["naturalObjects"]}
    for exp in EXPECTED_NODES:
        g = got.pop(exp["id"], None)
        if g is None:
            print(f"  MISSING {exp['id']}")
            ok = False
        elif norm(g) != norm(exp):
            print(f"  DIFF {exp['id']}: got {norm(g)} expected {norm(exp)}")
            ok = False
        else:
            print(f"  OK {exp['id']}")
    for extra in got:
        print(f"  EXTRA {extra}")
        ok = False
    if out["clearings"] != EXPECTED_CLEARINGS:
        print(f"  DIFF clearings: got {out['clearings']} expected {EXPECTED_CLEARINGS}")
        ok = False
    else:
        print(f"  OK clearings {out['clearings']}")
    print("CHECK:", "PASS" if ok else "FAIL")
    return ok


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    in_path = args[0] if args else DEFAULT_IN
    out_path = DEFAULT_OUT
    if "--out" in sys.argv:
        out_path = sys.argv[sys.argv.index("--out") + 1]
    proj = json.load(open(in_path))
    out = convert(proj)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print(f"wrote {out_path}: {len(out['naturalObjects'])} nodes, "
          f"{len(out['clearings'])} clearing(s), spawn {out['spawn']}, "
          f"ground {out['ground']['cols']}x{out['ground']['rows']}")
    if "--check" in sys.argv:
        sys.exit(0 if check(out) else 1)


if __name__ == "__main__":
    main()
