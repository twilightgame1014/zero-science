#!/usr/bin/env python3
"""Muse の道具・設備・操作アイコン（assets/buildings-icons、原本・62点）から、ゲームに埋め込む 64px のアトラスを作る。
原本は変更しない。キーは原本の atlas.json と同じ「カテゴリ/ID」（facilities/filter と ops/filter は別物）。
出力：assets/build/tool-icons-64.webp と tool-icons-64.json（キー → [列, 行]）。
使い方：python3 scripts/make-tool-atlas.py   （Pillow が必要）"""
import json, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/buildings-icons")
OUT = os.path.join(ROOT, "assets/build")
CELL = 64
meta = json.load(open(os.path.join(SRC, "atlas.json"), encoding="utf-8"))
ent = meta["entries"]; cols = meta["columns"]; src_cell = meta["cell"]
big = Image.open(os.path.join(SRC, "atlas.png")).convert("RGBA")
rows = max(v["y"] for v in ent.values()) // src_cell + 1
out = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0)); pos = {}
for key, v in ent.items():
    c, r = v["x"] // src_cell, v["y"] // src_cell
    tile = big.crop((v["x"], v["y"], v["x"] + v["w"], v["y"] + v["h"])).resize((CELL, CELL), Image.LANCZOS)
    out.paste(tile, (c * CELL, r * CELL)); pos[key] = [c, r]
os.makedirs(OUT, exist_ok=True)
out.save(os.path.join(OUT, "tool-icons-64.webp"), "WEBP", quality=90, method=6)
json.dump({"cell": CELL, "cols": cols, "rows": rows, "items": pos}, open(os.path.join(OUT, "tool-icons-64.json"), "w", encoding="utf-8"), separators=(",", ":"))
print("icons", len(pos), "size", out.size, "bytes", os.path.getsize(os.path.join(OUT, "tool-icons-64.webp")))
