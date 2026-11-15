# Measure exported plant GLBs: triangles from accessors, nodes, materials.
import json, struct, os, sys, glob

def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    ln = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + ln]), len(data)

def tris(g):
    total = 0
    for mesh in g.get("meshes", []):
        for prim in mesh["primitives"]:
            idx = prim.get("indices")
            if idx is not None:
                total += g["accessors"][idx]["count"] // 3
            else:
                total += g["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
    return total

def node_names(g):
    return [n.get("name", "?") for n in g.get("nodes", [])]

def mat_mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]

def node_matrix(n):
    if "matrix" in n:
        m = n["matrix"]
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
    t = n.get("translation", [0, 0, 0])
    q = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = q
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + \
           [[0, 0, 0, 1]]

def world_bbox(g):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    children = {}
    roots = []
    for i, n in enumerate(g.get("nodes", [])):
        for c in n.get("children", []):
            children[c] = i
    for i in range(len(g.get("nodes", []))):
        if i not in children:
            roots.append(i)
    def walk(i, parent):
        n = g["nodes"][i]
        m = mat_mul(parent, node_matrix(n))
        if "mesh" in n:
            for prim in g["meshes"][n["mesh"]]["primitives"]:
                acc = g["accessors"][prim["attributes"]["POSITION"]]
                mn, mx = acc["min"], acc["max"]
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            p = [m[r][0] * cx + m[r][1] * cy + m[r][2] * cz + m[r][3]
                                 for r in range(3)]
                            for k in range(3):
                                lo[k] = min(lo[k], p[k])
                                hi[k] = max(hi[k], p[k])
        for c in n.get("children", []):
            walk(c, m)
    ident = [[1 if i == j else 0 for j in range(4)] for i in range(4)]
    for r in roots:
        walk(r, ident)
    # glTF is Y-up: dims = (x width, z depth, y height)
    return [round(hi[0] - lo[0], 2), round(hi[2] - lo[2], 2),
            round(hi[1] - lo[1], 2)], [round(v, 2) for v in lo]

def main():
    rows = {}
    for path in sorted(glob.glob(os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "models", "*.glb"))):
        g, size = load_glb(path)
        name = os.path.basename(path)[:-4]
        dims, lo = world_bbox(g)
        rows[name] = {
            "tris": tris(g),
            "materials": len(g.get("materials", [])),
            "bytes": size,
            "nodes": node_names(g),
            "dims_wdh": dims,
            "min_y": lo[1],
        }
    print(json.dumps(rows, indent=1))

if __name__ == "__main__":
    main()
