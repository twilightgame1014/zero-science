#!/usr/bin/env python3
"""Inspect exported GLBs: sizes, triangle counts, animation clips.
Run: python3 inspect_glb.py [models-dir]"""
import json
import struct
import sys
from pathlib import Path

def read_glb(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF", path
    (chunk_len,) = struct.unpack_from("<I", data, 12)  # JSON chunk length
    js = json.loads(data[20:20 + chunk_len])
    return js

def main():
    models = Path(sys.argv[1]) if len(sys.argv) > 1 else \
        Path(__file__).resolve().parent.parent / "models"
    for path in sorted(models.glob("*.glb")):
        js = read_glb(path)
        tris = 0
        mats = set()
        for mesh in js.get("meshes", []):
            for prim in mesh["primitives"]:
                acc = js["accessors"][prim["indices"]]
                tris += acc["count"] // 3
                if "material" in prim:
                    mats.add(prim["material"])
        nodes = [n.get("name", "?") for n in js.get("nodes", [])]
        print(f"{path.name}: {path.stat().st_size/1024:.0f} KiB, "
              f"{tris} tris, {len(mats)} materials, {len(nodes)} nodes")
        for anim in js.get("animations", []):
            targets = sorted({
                nodes[ch["target"]["node"]]
                for ch in anim["channels"] if "node" in ch["target"]})
            print(f"  clip {anim.get('name')}: "
                  f"{len(anim['channels'])} ch -> {targets}")

main()
