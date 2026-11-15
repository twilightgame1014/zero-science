#!/usr/bin/env python3
"""Pack the 137 individual icon PNGs into atlas images + a JSON manifest.
Order = the game's data.js item order. Cell 256px (and a 128px compact
variant). Manifest records x/y/w/h per item id plus the Japanese name."""
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
DATA = Path("/tmp/data-latest.js").read_text(encoding="utf-8")
ITEMS = re.findall(r'I\("([a-z0-9_]+)",\[[^\]]*\],"[^"]*","([^"]*)"', DATA)
LOG = json.loads((ROOT / "process-log.json").read_text(encoding="utf-8"))

COLS = 12


def build(cell):
    rows = (len(ITEMS) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * cell, rows * cell), (0, 0, 0, 0))
    entries = {}
    for i, (iid, name) in enumerate(ITEMS):
        icon = Image.open(ICONS / f"{iid}.png")
        if cell != 256:
            icon = icon.resize((cell, cell), Image.LANCZOS)
        x, y = (i % COLS) * cell, (i // COLS) * cell
        atlas.alpha_composite(icon, (x, y))
        src = LOG["icons"].get(iid, {})
        entries[iid] = {"x": x, "y": y, "w": cell, "h": cell, "name": name,
                        "sheet": src.get("sheet"), "row": src.get("row"), "col": src.get("col")}
    return atlas, entries


atlas, entries = build(256)
atlas.save(ROOT / "atlas.png")
atlas.save(ROOT / "atlas.webp", lossless=True)
manifest = {"cell": 256, "cols": COLS, "count": len(ITEMS),
            "files": {"png": "atlas.png", "webp": "atlas.webp", "compact": "atlas-128.png"},
            "items": entries}
(ROOT / "atlas.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
atlas128, _ = build(128)
atlas128.save(ROOT / "atlas-128.png")
for f in ("atlas.png", "atlas.webp", "atlas-128.png", "atlas.json"):
    print(f, (ROOT / f).stat().st_size // 1024, "KB")
