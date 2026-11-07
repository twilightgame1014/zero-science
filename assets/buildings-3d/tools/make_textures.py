#!/usr/bin/env python3
"""Procedural 512px PBR-ish albedo textures for the building models.

Structure first, noise second: plank seams, brick courses, mortar
lines, tile rows and panel seams carry the read; per-pixel noise is
kept subtle so the textures do not turn into static at game distance.
Outputs PNGs into ../textures/.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "textures"
OUT.mkdir(parents=True, exist_ok=True)
S = 512
rng = np.random.default_rng(20261107)


def base(color, jitter=7):
    arr = np.zeros((S, S, 3), float)
    arr[:] = color
    arr += rng.normal(0, jitter, (S, S, 1))
    return arr


def save(arr, name):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(OUT / name)
    print(name)


def speckle(arr, n, color, rmax=2.2, alpha=0.5):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im, "RGBA")
    for _ in range(n):
        x, y = rng.uniform(0, S, 2)
        r = rng.uniform(0.6, rmax)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(*color, int(255 * alpha)))
    return np.asarray(im).astype(float)


def wood_planks():
    arr = base((122, 88, 55), 6)
    rows = 6
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for r in range(rows):
        y0 = r * S // rows
        tone = rng.uniform(-14, 14)
        d.rectangle([0, y0, S, y0 + S // rows], fill=(int(122 + tone), int(88 + tone * 0.8), int(55 + tone * 0.6)))
        # grain: wavy horizontal streaks
        for _ in range(26):
            gy = y0 + rng.uniform(4, S // rows - 4)
            dark = rng.random() < 0.6
            col = (96, 66, 38) if dark else (146, 110, 70)
            pts = [(x, gy + 2.2 * np.sin(x / rng.uniform(40, 90) + rng.uniform(0, 6))) for x in range(0, S, 16)]
            d.line(pts, fill=col, width=1)
        d.line([0, y0, S, y0], fill=(52, 36, 20), width=3)
        # plank end seam + nails
        ex = int(rng.uniform(0, S))
        d.line([ex, y0, ex, y0 + S // rows], fill=(52, 36, 20), width=2)
        for nx in (ex + 14, ex - 14):
            d.ellipse([nx - 2, y0 + 8, nx + 2, y0 + 12], fill=(40, 32, 26))
    arr = np.asarray(im).astype(float)
    arr = speckle(arr, 260, (70, 48, 28), 1.6, 0.35)
    save(arr, "wood_planks.png")


def bark():
    arr = base((96, 70, 46), 7)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for _ in range(210):
        x = rng.uniform(0, S)
        ln = rng.uniform(30, 150)
        y = rng.uniform(0, S)
        col = (64, 44, 26) if rng.random() < 0.65 else (128, 98, 64)
        d.line([x, y, x + rng.uniform(-4, 4), y + ln], fill=col, width=int(rng.uniform(1, 3)))
    save(np.asarray(im).astype(float), "bark.png")


def blocks(name, rows, cols_list, base_col, mortar, jitter=13):
    arr = base(base_col, 5)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    rh = S // rows
    for r in range(rows):
        off = (r % 2) * 0.5
        cols = cols_list
        bw = S / cols
        for c in range(-1, cols + 1):
            x0 = int((c + off) * bw)
            tone = rng.uniform(-jitter, jitter)
            col = tuple(int(v + tone) for v in base_col)
            d.rectangle([x0 + 2, r * rh + 2, x0 + bw - 2, (r + 1) * rh - 2], fill=col)
            for _ in range(12):
                sx, sy = rng.uniform(x0 + 4, x0 + bw - 4), rng.uniform(r * rh + 4, (r + 1) * rh - 4)
                d.point((sx, sy), fill=tuple(int(v - 22) for v in base_col))
        d.line([0, r * rh, S, r * rh], fill=mortar, width=3)
    save(np.asarray(im).astype(float), name)


def bricks(name, base_col):
    blocks(name, 10, 4, base_col, (74, 52, 40), jitter=16)


def earth():
    arr = base((168, 128, 92), 8)
    arr = speckle(arr, 500, (140, 104, 70), 2.4, 0.3)
    arr = speckle(arr, 260, (190, 156, 116), 2.0, 0.3)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for _ in range(7):  # hairline cracks
        x, y = rng.uniform(0, S, 2)
        for _ in range(14):
            nx, ny = x + rng.uniform(-16, 16), y + rng.uniform(4, 18)
            d.line([x, y, nx, ny], fill=(120, 88, 58), width=1)
            x, y = nx, ny
    save(np.asarray(im).astype(float), "earth_clay.png")


def thatch():
    arr = base((168, 138, 84), 6)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for _ in range(1500):
        x = rng.uniform(0, S)
        y = rng.uniform(0, S)
        ln = rng.uniform(18, 60)
        tone = rng.uniform(-30, 30)
        col = (int(168 + tone), int(138 + tone * 0.85), int(84 + tone * 0.5))
        d.line([x, y, x + rng.uniform(-3, 3), y + ln], fill=col, width=1)
    for r in range(4):  # bundle banding
        y = r * S // 4 + S // 8
        d.line([0, y, S, y], fill=(120, 94, 52), width=3)
    save(np.asarray(im).astype(float), "thatch.png")


def roof_tile():
    arr = base((156, 84, 58), 6)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    rows, cols = 6, 8
    rh, bw = S // rows, S // cols
    for r in range(rows):
        for c in range(cols):
            tone = rng.uniform(-13, 13)
            x0 = c * bw
            d.rectangle([x0 + 1, r * rh + 1, x0 + bw - 1, (r + 1) * rh - 1],
                        fill=(int(156 + tone), int(84 + tone * 0.7), int(58 + tone * 0.5)))
            d.line([x0 + bw // 2, r * rh, x0 + bw // 2, (r + 1) * rh], fill=(120, 60, 40), width=2)
        d.line([0, r * rh, S, r * rh], fill=(96, 48, 32), width=3)
    save(np.asarray(im).astype(float), "roof_tile.png")


def metal(name, base_col, seams=(2, 2), rivets=True):
    arr = base(base_col, 4)
    # brushed: faint vertical streaks
    for x in range(S):
        arr[:, x] += rng.normal(0, 2.2)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    dark = tuple(int(v * 0.55) for v in base_col)
    for i in range(1, seams[0]):
        d.line([i * S // seams[0], 0, i * S // seams[0], S], fill=dark, width=2)
    for i in range(1, seams[1]):
        d.line([0, i * S // seams[1], S, i * S // seams[1]], fill=dark, width=2)
    if rivets:
        for gx in range(seams[0]):
            for gy in range(seams[1]):
                for dx, dy in ((10, 10), (S // seams[0] - 10, 10), (10, S // seams[1] - 10), (S // seams[0] - 10, S // seams[1] - 10)):
                    x, y = gx * S // seams[0] + dx, gy * S // seams[1] + dy
                    d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=dark)
    save(np.asarray(im).astype(float), name)


def main():
    wood_planks()
    bark()
    blocks("stone_blocks.png", 4, 3, (128, 122, 112), (84, 78, 70))
    blocks("stone_dark.png", 4, 3, (108, 102, 96), (66, 62, 56))
    bricks("clay_brick.png", (148, 92, 66))
    bricks("red_brick.png", (142, 74, 58))
    earth()
    thatch()
    roof_tile()
    metal("steel.png", (158, 164, 168))
    metal("iron_dark.png", (94, 96, 100))
    metal("copper.png", (150, 92, 58))
    metal("roof_panel.png", (124, 132, 126), seams=(3, 2))
    blocks("tile_wall.png", 5, 4, (196, 188, 172), (150, 142, 128), jitter=7)


if __name__ == "__main__":
    main()
