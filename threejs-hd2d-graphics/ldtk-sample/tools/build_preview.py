#!/usr/bin/env python3
"""Render a top-down preview PNG of sample-plot.ldtk (ground painting,
clearing circle, entity markers with labels). For humans: the LDtk
editor is not required to review a layout.

Usage: python3 build_preview.py [in.ldtk] [out.png]
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_IN = os.path.normpath(os.path.join(HERE, "..", "sample-plot.ldtk"))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "out", "preview.png"))

GROUND_COLORS = {"grass": (127, 176, 105), "dirt": (156, 102, 68),
                 "path": (194, 168, 120), "gravel": (154, 154, 146)}
SHORT = {"Tree": "Tr", "Rock": "Rk", "Ore": "Or", "Bush": "Bu", "Grass": "Gr",
         "Herb": "He", "Flowers": "Fl", "Branch": "Br", "Pebble": "Pe",
         "Water": "Wa", "Oil": "Oi", "Spawn": "SP"}


def hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def main():
    in_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IN
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    proj = json.load(open(in_path))
    level = proj["levels"][0]
    lf = {f["__identifier"]: f["__value"] for f in level.get("fieldInstances", [])}
    ox, oz, px_m = lf.get("originX", -50.0), lf.get("originZ", 18.0), lf.get("pxPerMeter", 32.0)
    defs = {e["uid"]: e for e in proj["defs"]["entities"]}

    W = level["pxWid"]
    img = Image.new("RGB", (W, W + 92), (24, 26, 30))
    dr = ImageDraw.Draw(img, "RGBA")
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 17)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except OSError:
        font = small = ImageFont.load_default()

    # layerInstances[0] is the TOP layer in LDtk: paint bottom-up.
    for li in reversed(level["layerInstances"]):
        if li["__type"] == "IntGrid":
            ldef = next(l for l in proj["defs"]["layers"] if l["uid"] == li["layerDefUid"])
            legend = {v["value"]: v["identifier"] for v in ldef["intGridValues"]}
            gs, cw = li["__gridSize"], li["__cWid"]
            for i, v in enumerate(li["intGridCsv"]):
                cx, cy = i % cw, i // cw
                dr.rectangle([cx * gs, cy * gs, cx * gs + gs - 1, cy * gs + gs - 1],
                             fill=GROUND_COLORS[legend[v]])
        elif li["__type"] == "Entities":
            for e in li["entityInstances"]:
                ident = e["__identifier"]
                f = {x["__identifier"]: x["__value"] for x in e.get("fieldInstances", [])}
                cx, cy = e["px"]
                if ident == "Clearing":
                    r = f.get("radius", 9.0) * px_m
                    dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 209, 102, 255), width=3)
                    dr.text((cx - 30, cy - r - 22), "Clearing", fill=(255, 209, 102), font=small)
                    continue
                color = hex2rgb(defs[e["defUid"]]["color"])
                w, h = e["width"], e["height"]
                if ident == "Spawn":
                    dr.line([cx - 10, cy, cx + 10, cy], fill=(255, 89, 100), width=3)
                    dr.line([cx, cy - 10, cx, cy + 10], fill=(255, 89, 100), width=3)
                else:
                    dr.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
                                 fill=color + (235,), outline=(20, 20, 20))
                label = SHORT.get(ident, ident[:2])
                if f.get("state") == "depleted":
                    label += "✕"
                dr.text((cx + w / 2 + 3, cy - 9), label, fill=(255, 255, 255), font=small)
                if f.get("highlighted"):
                    dr.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], outline=(255, 215, 94), width=3)

    dr.text((12, W + 10), "LDtk sample plot — Sample_Plot: 24 m x 24 m, centre (-38, 30), 1 cell = 0.5 m", fill=(235, 235, 235), font=font)
    dr.text((12, W + 38), "Tr=tree Rk=rock Or=ore Bu=bush Gr=grass He=herb Fl=flowers Br=branch Pe=pebble Wa=water Oi=oil SP=spawn ✕=depleted", fill=(190, 190, 190), font=small)
    dr.text((12, W + 62), "gold circle = Clearing (decor.clearings r=9 m)   gold ring = highlighted node   up = -z (north)", fill=(190, 190, 190), font=small)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path)
    print("wrote", out_path, img.size)


if __name__ == "__main__":
    main()
