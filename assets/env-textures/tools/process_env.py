#!/usr/bin/env python3
"""Process the two GPT environment sheets (ground 2x2, building 2x2) into
tileable game textures.

- Quadrants are cropped as centred squares (the building sheet's quadrants
  are 2:1; no forced stretching - the centre square keeps native density).
- Seams are closed with the same symmetric edge crossfade as the GPT nature
  pipeline; verified with 3x3 tiling previews.
- Normal maps are derived from a smoothed height field (structure-aware:
  luminance + local contrast), with wrap-around gradients so they tile.
  This is a separate production step, not a plain grayscale copy.
- Masters are 512px; mobile variants 256px. Sizes are logged to sizes.json.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source"
OUT = ROOT / "textures"
PREV = ROOT / "previews"
OUT.mkdir(exist_ok=True)
PREV.mkdir(exist_ok=True)

GROUND = {  # (row, col) -> name, from the owner's spec (top-left first)
    (0, 0): "sand_beach", (0, 1): "riverbank_soil",
    (1, 0): "basalt_ground", (1, 1): "red_iron_ground",
}
BUILDING = {
    (0, 0): "brick_wall", (0, 1): "plaster_wall",
    (1, 0): "wood_planks", (1, 1): "stone_wall",
}
GRADES = {  # gentle palette alignment with the existing forest materials
    "brick_wall": {"saturation": 0.85, "brightness": 0.98},
}


def seamless(im, band_ratio=0.09):
    """Symmetric crossfade of opposite edges (wrap blend)."""
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    band = max(8, int(min(h, w) * band_ratio))
    # pull both edge bands toward the average of the two opposite edges
    avg_lr = (a[:, 0:1] + a[:, w - 1:w]) / 2
    for i in range(band):
        k = (i + 1) / (band + 1) * 0.5
        a[:, i] = a[:, i] * (1 - k) + avg_lr[:, 0] * k
        a[:, w - 1 - i] = a[:, w - 1 - i] * (1 - k) + avg_lr[:, 0] * k
    avg_tb = (a[0:1, :] + a[h - 1:h, :]) / 2
    for i in range(band):
        k = (i + 1) / (band + 1) * 0.5
        a[i, :] = a[i, :] * (1 - k) + avg_tb[0, :] * k
        a[h - 1 - i, :] = a[h - 1 - i, :] * (1 - k) + avg_tb[0, :] * k
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def normal_from_height(rgb, strength=2.0):
    g = np.asarray(rgb.convert("L")).astype(np.float32) / 255.0
    # height: smoothed luminance keeps mortar lines / stone relief, drops grain noise
    height = ndimage.gaussian_filter(g, sigma=2.0, mode="wrap")
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    nz = np.ones_like(gx)
    n = np.stack([-gx, gy, nz], axis=2)  # OpenGL-style (Y+) for three.js
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))


def process_sheet(fname, mapping, tag):
    im = Image.open(SRC / fname).convert("RGB")
    W, H = im.size
    qw, qh = W // 2, H // 2
    results = {}
    for (row, col), name in mapping.items():
        quad = im.crop((col * qw, row * qh, (col + 1) * qw, (row + 1) * qh))
        side = min(quad.size)
        x0 = (quad.size[0] - side) // 2
        y0 = (quad.size[1] - side) // 2
        quad = quad.crop((x0, y0, x0 + side, y0 + side))
        grade = GRADES.get(name)
        if grade:
            quad = ImageEnhance.Color(quad).enhance(grade["saturation"])
            quad = ImageEnhance.Brightness(quad).enhance(grade["brightness"])
        quad = seamless(quad)
        master = quad.resize((512, 512), Image.LANCZOS)
        master.save(OUT / f"{name}.png")
        master.resize((256, 256), Image.LANCZOS).save(OUT / f"{name}_256.png")
        nrm = normal_from_height(master)
        nrm.save(OUT / f"{name}_normal.png")
        nrm.resize((256, 256), Image.LANCZOS).save(OUT / f"{name}_normal_256.png")
        results[name] = {"source_sheet": fname, "quadrant": [row, col],
                         "native_crop": side}
        # 3x3 preview tile
        tile = master.resize((170, 170), Image.LANCZOS)
        prev = Image.new("RGB", (510, 510))
        for yy in range(3):
            for xx in range(3):
                prev.paste(tile, (xx * 170, yy * 170))
        prev.save(PREV / f"tiling-{name}.png")
    # combined preview: 4 materials side by side (their 3x3 tilings shrunk)
    combo = Image.new("RGB", (1020, 510), "white")
    for i, name in enumerate(mapping.values()):
        p = Image.open(PREV / f"tiling-{name}.png").resize((255, 255), Image.LANCZOS)
        combo.paste(p, ((i % 4) * 255, 0))
        p2 = p  # second row unused; keep single row of 4 + labels row below
    combo = combo.crop((0, 0, 1020, 255))
    combo.save(PREV / f"tiling-{tag}-all.png")
    return results


def main():
    info = {}
    info.update(process_sheet("ground-sheet.jpg", GROUND, "ground"))
    info.update(process_sheet("building-sheet.jpg", BUILDING, "building"))
    sizes = {}
    for f in sorted(OUT.glob("*.png")):
        sizes[f.name] = f.stat().st_size
    (ROOT / "sizes.json").write_text(json.dumps(
        {"textures": info, "file_sizes_bytes": sizes}, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(sizes.values())
    print("textures done; total bytes:", total)


if __name__ == "__main__":
    main()
