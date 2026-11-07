#!/usr/bin/env python3
"""Diagonal (8-dir) sheet processor — girl first (2026-11-08).

Slices a 4x4 GPT diagonal sheet (white bg), cuts each character out
with rembg isnet-anime (the anime-protagonist model; white hair and
white coat are preserved by the segmentation, never by colour-keying),
normalises every frame to the existing protagonist contract measured
from the shipped 4-dir sheets:
  cell 256x256, visible height 200 px, feet baseline 29 px above the
  cell bottom, bbox centre x = 127.5.
Then composes the extended 8-row sheet: rows 0-3 = the existing
down/left/right/up rows verbatim, rows 4-7 = down-right / down-left /
up-right / up-left (source rows 1-4 in the GPT layout
right-front / left-front / right-back / left-back).
"""
import sys
import numpy as np
from PIL import Image
from rembg import remove, new_session
from scipy import ndimage

SRC = sys.argv[1]           # source sheet (white bg)
EXISTING = sys.argv[2]      # existing 4-dir sheet (1024x1024 RGBA)
OUT = sys.argv[3]           # composed 8-dir sheet (1024x2048 RGBA)
QA_PREFIX = sys.argv[4]     # prefix for per-frame cutouts

CELL = 256
TARGET_H = 200
BASE_FROM_BOTTOM = 29
session = new_session('isnet-anime')

src = Image.open(SRC).convert('RGB')
W, H = src.size
cw, ch = W / 4, H / 4
PAD = 26

frames = {}   # (r, c) -> RGBA image normalised into a 256 cell
report = []
for r in range(4):
    for c in range(4):
        x0 = max(0, int(c * cw) - PAD); x1 = min(W, int((c + 1) * cw) + PAD)
        y0 = max(0, int(r * ch) - PAD); y1 = min(H, int((r + 1) * ch) + PAD)
        window = src.crop((x0, y0, x1, y1))
        out = remove(window, session=session)
        a = np.asarray(out)[:, :, 3]
        # largest connected component = the character of this cell
        lab, n = ndimage.label(a > 32)
        if n == 0:
            raise SystemExit(f'no component in cell {r},{c}')
        sizes = ndimage.sum(a > 32, lab, range(1, n + 1))
        keep = 1 + int(np.argmax(sizes))
        mask = lab == keep
        ys, xs = np.where(mask)
        bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
        # drop any other components' pixels inside the bbox (neighbours)
        rgba = np.asarray(out).copy()
        rgba[:, :, 3] = np.where(mask, rgba[:, :, 3], 0)
        char = Image.fromarray(rgba[by0:by1 + 1, bx0:bx1 + 1])
        # premultiplied resize to visible height 200
        scale = TARGET_H / char.size[1]
        nw = max(1, round(char.size[0] * scale))
        arr = np.asarray(char).astype(np.float32)
        alpha = arr[:, :, 3:4] / 255.0
        prem = np.concatenate([arr[:, :, :3] * alpha, arr[:, :, 3:4]], axis=2)
        prem_im = Image.fromarray(np.clip(prem, 0, 255).astype(np.uint8))
        prem_im = prem_im.resize((nw, TARGET_H), Image.LANCZOS)
        parr = np.asarray(prem_im).astype(np.float32)
        pa = np.clip(parr[:, :, 3:4], 1.0, None)
        rgb = np.clip(parr[:, :, :3] * 255.0 / pa, 0, 255)
        char2 = Image.fromarray(np.concatenate([rgb, parr[:, :, 3:4]], axis=2).astype(np.uint8))
        # re-measure after resize (rounding) and place exactly
        a2 = np.asarray(char2)[:, :, 3]
        ys2, xs2 = np.where(a2 > 16)
        h2 = ys2.max() - ys2.min() + 1
        cx2 = (xs2.min() + xs2.max()) / 2
        cell_im = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        dx = round(127.5 - cx2 - xs2.min()) + xs2.min() - xs2.min()  # place by bbox
        dx = round(127.5 - cx2)
        dy = (CELL - BASE_FROM_BOTTOM - 1) - ys2.max()
        cell_im.paste(char2, (dx, dy), char2)
        frames[(r, c)] = cell_im
        report.append(f'cell {r},{c}: src bbox {bx1-bx0+1}x{by1-by0+1} -> h2={h2}')
        char2.save(f'{QA_PREFIX}-r{r}c{c}.png')

existing = Image.open(EXISTING).convert('RGBA')
sheet = Image.new('RGBA', (1024, 2048), (0, 0, 0, 0))
sheet.paste(existing, (0, 0))
# source row -> target row: 0->4 (down-right), 1->5 (down-left),
# 2->6 (up-right), 3->7 (up-left)
for sr in range(4):
    tr = 4 + sr
    for c in range(4):
        sheet.paste(frames[(sr, c)], (c * CELL, tr * CELL))
sheet.save(OUT)
print('\n'.join(report))
print('saved', OUT, sheet.size)
