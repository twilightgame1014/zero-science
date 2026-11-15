#!/usr/bin/env python3
"""Build light/dark contact-sheet previews of all item icons at 64px and 48px
display size (QA + delivery preview), in data.js item order."""
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
OUT = ROOT / "previews"
OUT.mkdir(exist_ok=True)

# item order + Japanese names from the game's data.js (walk-and-assets branch)
DATA = Path("/tmp/data-latest.js").read_text(encoding="utf-8")
ITEMS = re.findall(r'I\("([a-z0-9_]+)",\[[^\]]*\],"[^"]*","([^"]*)"', DATA)


def sheet(size, bg, label):
    cols = 12
    cell = size + 10
    rows = (len(ITEMS) + cols - 1) // cols
    img = Image.new("RGB", (cols * cell + 10, rows * cell + 30), bg)
    d = ImageDraw.Draw(img)
    d.text((10, 8), label, fill=(128, 128, 128))
    for i, (iid, _name) in enumerate(ITEMS):
        icon = Image.open(ICONS / f"{iid}.png").resize((size, size), Image.LANCZOS)
        x = 10 + (i % cols) * cell
        y = 30 + (i // cols) * cell
        img.paste(icon, (x, y), icon)
    return img


for size in (64, 48):
    sheet(size, (245, 242, 235), f"item icons @{size}px on light").save(OUT / f"icons-light-{size}.png")
    sheet(size, (24, 26, 30), f"item icons @{size}px on dark").save(OUT / f"icons-dark-{size}.png")
print("previews written for", len(ITEMS), "items")
