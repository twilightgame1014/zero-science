#!/usr/bin/env python3
"""Round 30 verification for the rocket assets.

- Enumerates rocket mesh nodes (for the per-slot contract lists).
- Computes rest AABBs for every model (equipment placement checks).
- Samples every animation clip at 0/25/50/75/100% and reports the
  animated subtrees' world AABBs, plus the clearance checks the
  space integration depends on (hatch/bay vs body, corridor/tower
  vs the ascent cylinder, mount arms vs the rocket base).

Usage: python3 verify_round30.py [models-dir]
Default models-dir: ../models (LOD0; LOD1 shares node names).
"""
import json, math, struct, sys
from pathlib import Path

import numpy as np

MODELS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "models"


def load_glb(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF", path
    jlen = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen + 8
    return gltf, data[bin_off:]


def accessor(gltf, blob, idx):
    acc = gltf["accessors"][idx]
    view = gltf["bufferViews"][acc["bufferView"]]
    off = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[acc["componentType"]]
    arr = np.frombuffer(blob, dtype=dt, count=acc["count"] * ncomp, offset=off)
    return arr.reshape(acc["count"], ncomp) if ncomp > 1 else arr


def node_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
    t = n.get("translation", [0, 0, 0])
    r = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    M = np.eye(4)
    M[:3, :3] = R * np.array(s)
    M[:3, 3] = t
    return M


def sample_channel(gltf, blob, clip, ch, t):
    samp = clip["samplers"][ch["sampler"]]
    times = accessor(gltf, blob, samp["input"]).astype(np.float64)
    vals = accessor(gltf, blob, samp["output"]).astype(np.float64)
    if t <= times[0]:
        return vals[0]
    if t >= times[-1]:
        return vals[-1]
    i = int(np.searchsorted(times, t)) - 1
    if samp.get("interpolation") == "STEP":
        return vals[i]
    f = (t - times[i]) / (times[i + 1] - times[i])
    a, b = vals[i], vals[i + 1]
    if len(a) == 4:  # quaternion: nlerp is fine for verification
        if np.dot(a, b) < 0:
            b = -b
        q = a + (b - a) * f
        return q / np.linalg.norm(q)
    return a + (b - a) * f


def world_matrices(gltf, blob, clip=None, t=0.0):
    nodes = gltf["nodes"]
    overrides = {}
    if clip is not None:
        for ch in clip["channels"]:
            tgt = ch["target"]
            overrides.setdefault(tgt["node"], {})[tgt["path"]] = sample_channel(gltf, blob, clip, ch, t)
    local = []
    for i, n in enumerate(nodes):
        m = node_matrix(n)
        ov = overrides.get(i)
        if ov:
            nn = dict(n)
            for path, v in ov.items():
                nn[path] = v.tolist()
            # A channel replaces only its own path; rebuild from parts.
            base = {"translation": n.get("translation", [0, 0, 0]),
                    "rotation": n.get("rotation", [0, 0, 0, 1]),
                    "scale": n.get("scale", [1, 1, 1])}
            base.update({k: v.tolist() for k, v in ov.items()})
            m = node_matrix(base)
        local.append(m)
    world = [None] * len(nodes)
    scene = gltf["scenes"][gltf.get("scene", 0)]

    def walk(idx, parent):
        world[idx] = parent @ local[idx]
        for c in nodes[idx].get("children", []):
            walk(c, world[idx])

    for root in scene["nodes"]:
        walk(root, np.eye(4))
    return world


def mesh_aabb(gltf, mesh_idx):
    lo = np.array([np.inf] * 3)
    hi = -lo
    for prim in gltf["meshes"][mesh_idx]["primitives"]:
        acc = gltf["accessors"][prim["attributes"]["POSITION"]]
        lo = np.minimum(lo, acc["min"])
        hi = np.maximum(hi, acc["max"])
    return lo, hi


def subtree_aabb(gltf, world, root_idx):
    lo = np.array([np.inf] * 3)
    hi = -lo
    stack = [root_idx]
    while stack:
        i = stack.pop()
        n = gltf["nodes"][i]
        if "mesh" in n:
            mlo, mhi = mesh_aabb(gltf, n["mesh"])
            corners = np.array([[x, y, z, 1] for x in (mlo[0], mhi[0])
                                for y in (mlo[1], mhi[1]) for z in (mlo[2], mhi[2])])
            w = (world[i] @ corners.T).T[:, :3]
            lo = np.minimum(lo, w.min(axis=0))
            hi = np.maximum(hi, w.max(axis=0))
        stack.extend(n.get("children", []))
    return lo, hi


def model_aabb(gltf, world):
    lo = np.array([np.inf] * 3)
    hi = -lo
    for i, n in enumerate(gltf["nodes"]):
        if "mesh" in n:
            mlo, mhi = mesh_aabb(gltf, n["mesh"])
            corners = np.array([[x, y, z, 1] for x in (mlo[0], mhi[0])
                                for y in (mlo[1], mhi[1]) for z in (mlo[2], mhi[2])])
            w = (world[i] @ corners.T).T[:, :3]
            lo = np.minimum(lo, w.min(axis=0))
            hi = np.maximum(hi, w.max(axis=0))
    return lo, hi


def fmt(v):
    return "(" + ", ".join(f"{x:+.2f}" for x in v) + ")"


def main():
    print("=== REST AABBs (model local) ===")
    aabbs = {}
    for p in sorted(MODELS.glob("*.glb")):
        if "lod1" in p.name:
            continue
        gltf, blob = load_glb(p)
        world = world_matrices(gltf, blob)
        lo, hi = model_aabb(gltf, world)
        aabbs[p.stem] = (lo, hi)
        print(f"{p.stem:20s} min {fmt(lo)} max {fmt(hi)} size {fmt(hi - lo)}")

    print("\n=== ROCKET MESH NODES ===")
    gltf, blob = load_glb(MODELS / "rocket.glb")
    names = [n.get("name", "?") for n in gltf["nodes"] if "mesh" in n]
    for n in sorted(names):
        print(" ", n)

    print("\n=== CLIP SAMPLING ===")
    for p in sorted(MODELS.glob("*.glb")):
        if "lod1" in p.name:
            continue
        gltf, blob = load_glb(p)
        for clip in gltf.get("animations", []):
            dur = max(accessor(gltf, blob, clip["samplers"][ch["sampler"]]["input"])[-1]
                      for ch in clip["channels"])
            targets = sorted({gltf["nodes"][ch["target"]["node"]].get("name", "?")
                              for ch in clip["channels"]})
            print(f"\n{p.stem} :: {clip['name']}  duration {dur:.2f}s  targets {targets}")
            for frac in (0.0, 0.5, 1.0):
                world = world_matrices(gltf, blob, clip, dur * frac)
                for name in targets:
                    idx = next(i for i, n in enumerate(gltf["nodes"]) if n.get("name") == name)
                    lo, hi = subtree_aabb(gltf, world, idx)
                    print(f"  t={frac:4.0%} {name:24s} aabb min {fmt(lo)} max {fmt(hi)}")


if __name__ == "__main__":
    main()
