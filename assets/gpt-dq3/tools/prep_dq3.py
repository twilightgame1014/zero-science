#!/usr/bin/env python3
"""Prep textures for the DQ3 Blender builds: end-grain rings and
structure-derived normal maps for the roof / stone-wall tiles.
Normals come from STRUCTURE (tile grooves, mortar) via a high-pass
height, never from broad colour variation (round-14 rule)."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
GROUND = ROOT / "ground"

# ---- end-grain rings (stump tops, log ends) ----
S = 256
img = Image.new("RGB", (S, S), (196, 158, 108))
d = ImageDraw.Draw(img)
cx = cy = S / 2
rng = np.random.default_rng(7)
for r in range(118, 6, -7):
    tone = int(168 + rng.integers(-16, 17))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(tone - 42, tone - 74, tone - 104), width=2)
for _ in range(7):  # radial checks
    a = rng.uniform(0, 2 * np.pi)
    r0, r1 = rng.uniform(18, 40), rng.uniform(78, 120)
    d.line([cx + r0 * np.cos(a), cy + r0 * np.sin(a), cx + r1 * np.cos(a), cy + r1 * np.sin(a)],
           fill=(146, 110, 66), width=1)
from PIL import ImageFilter
img = img.filter(ImageFilter.GaussianBlur(0.6))
img.save(GROUND / "rings.png")
print("rings.png")

# ---- normals from structure ----
def normal_from_height(h, strength=2.0):
    gx = ndimage.sobel(h, axis=1) / 255.0 * strength
    gy = ndimage.sobel(h, axis=0) / 255.0 * strength
    n = np.dstack([-gx, gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)

def highpass(rgb, blur=9):
    lum = rgb.mean(axis=2)
    return lum - ndimage.gaussian_filter(lum, blur)

roof = np.asarray(Image.open(GROUND / "roof-orange.png").convert("RGB")).astype(np.float32)
Image.fromarray(normal_from_height(highpass(roof), 1.6)).save(GROUND / "roof-orange_n.png")
stone = np.asarray(Image.open(GROUND / "stone-wall.png").convert("RGB")).astype(np.float32)
# mortar = dark lines -> height low; faces -> height from gentle high-pass
lum = stone.mean(axis=2)
mortar = np.clip((118 - lum) / 60, 0, 1) * -38
height = highpass(stone, 7) * 0.5 + mortar
Image.fromarray(normal_from_height(height, 1.8)).save(GROUND / "stone-wall_n.png")
cobble = np.asarray(Image.open(GROUND / "town-cobble.png").convert("RGB")).astype(np.float32)
Image.fromarray(normal_from_height(highpass(cobble, 6), 1.5)).save(GROUND / "town-cobble_n.png")
print("normals done")
