#!/usr/bin/env python3
"""Muse のアイテムアイコン（assets/item-icons、原本）から、ゲームに埋め込む軽量アトラスを作る。
原本は変更しない。出力：assets/build/item-icons-64.webp と item-icons-64.json（ID → [列, 行]）。
使い方：python3 scripts/make-item-atlas.py   （Pillow が必要）"""
import json, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/item-icons")
OUT = os.path.join(ROOT, "assets/build")
CELL = 64
meta = json.load(open(os.path.join(SRC, "atlas.json"), encoding="utf-8"))
src_cell = meta["cell"]
items = meta["items"]
cols = meta["cols"]
rows = max(v["y"] for v in items.values()) // src_cell + 1
big = Image.open(os.path.join(SRC, meta["files"]["png"])).convert("RGBA")
out = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
pos = {}
for iid, v in items.items():
    c, r = v["x"] // src_cell, v["y"] // src_cell
    tile = big.crop((v["x"], v["y"], v["x"] + v["w"], v["y"] + v["h"])).resize((CELL, CELL), Image.LANCZOS)
    out.paste(tile, (c * CELL, r * CELL))
    pos[iid] = [c, r]
os.makedirs(OUT, exist_ok=True)
out.save(os.path.join(OUT, "item-icons-64.webp"), "WEBP", quality=90, method=6)
json.dump({"cell": CELL, "cols": cols, "rows": rows, "items": pos}, open(os.path.join(OUT, "item-icons-64.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("items", len(pos), "size", out.size, "bytes", os.path.getsize(os.path.join(OUT, "item-icons-64.webp")))
