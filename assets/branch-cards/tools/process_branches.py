#!/usr/bin/env python3
"""Process the owner's 2x2 branch/leaf sheet into 4 transparent branch
sprites for the HD-2D tree overhaul (2026-11-07).

Pipeline per quadrant (reading order TL, TR, BL, BR -> branch-1..4):
  1. content mask = min(R,G,B) < 243 (near-white is background)
  2. border flood fill marks the outer background; enclosed near-white
     components are leaf-gap sky and also become transparent
  3. dust removal: tiny isolated components are dropped
  4. dehalo: pale fringe pixels at the alpha edge take the colour of
     the nearest true-interior pixels (kills the yellow-green JPG haze)
  5. alpha binarized to {0, 255} (the renderer uses alphaTest cutout)
  6. gentle olive grade; trim to content bbox; save a full-size master
     and a 512px runtime sprite
Also builds branch-cluster.png (3 sprites composited) for the far LOD,
and preview contact sheets (light/dark background, display-size check).

The original sheet is kept untouched in ../source/.
"""
import json
import os
from collections import deque

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SRC = os.path.join(ROOT, "source", "branch-sheet.jpg")
NEAR_WHITE = 243
NAMES = {1: "branch-1", 2: "branch-2", 3: "branch-3", 4: "branch-4"}


def flood_from_border(bg_candidate):
    """Boolean mask of background-candidate pixels reachable from the
    border (4-connectivity) — the true outer background."""
    h, w = bg_candidate.shape
    seen = np.zeros_like(bg_candidate)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg_candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg_candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and bg_candidate[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    return seen


def process_quadrant(rgb, qi):
    """rgb: HxWx3 uint8 of one quadrant. Returns (RGBA image, stats)."""
    content = rgb.min(axis=2) < NEAR_WHITE
    outer_bg = flood_from_border(~content)
    alpha = content & ~outer_bg  # enclosed near-white pockets stay False here? no:
    # content already excludes ALL near-white pixels, so enclosed gaps are
    # transparent by construction. outer_bg is only diagnostic.
    pockets = (~content) & (~outer_bg)
    # dust removal on the content mask
    lab, n = ndimage.label(alpha)
    sizes = ndimage.sum(alpha, lab, range(1, n + 1))
    keep = np.zeros_like(alpha)
    kept = dropped = 0
    for i, s in enumerate(sizes, start=1):
        if s >= 12:
            keep[lab == i] = True
            kept += 1
        else:
            dropped += 1
    alpha = keep
    # dehalo + despeckle: pale low-saturation pixels (the JPG haze at the
    # outline AND the generator's white sparkle dots on leaves/stems,
    # invisible on the white source background but glaring on dark
    # in-game backgrounds) take the colour of the nearest clean
    # interior pixel. Leaf bodies are yellow-green (channel spread
    # >= ~60), so they are not touched.
    out = rgb.astype(np.float32)
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    pale = alpha & (
        ((rgb.min(axis=2) > 200) & (spread < 60))
        | ((rgb.min(axis=2) > 185) & (spread < 40))
    )
    clean = alpha & ~pale
    interior = ndimage.binary_erosion(clean, iterations=1)
    if interior.any() and pale.any():
        # nearest interior pixel colour via distance transform indices
        _, inds = ndimage.distance_transform_edt(
            ~interior, return_indices=True
        )
        py, px = np.where(pale)
        out[py, px] = rgb[inds[0][py, px], inds[1][py, px]]
    dehaloed = int(pale.sum())
    # gentle olive grade: rein in the brightest yellow-greens
    mx = out.max(axis=2, keepdims=True)
    mn = out.min(axis=2, keepdims=True)
    bright_yellow = (out[..., 0] > 165) & (out[..., 1] > 175) & (out[..., 2] < 150)
    out[bright_yellow, 0] *= 0.92
    out[bright_yellow, 2] *= 1.05
    img = np.dstack([out, np.where(alpha, 255, 0)]).astype(np.uint8)
    rgba = Image.fromarray(img, "RGBA")
    bbox = rgba.getbbox()
    rgba = rgba.crop(bbox)
    stats = {
        "quadrant": qi,
        "gap_pocket_px": int(pockets.sum()),
        "components_kept": kept,
        "components_dropped": dropped,
        "dehaloed_px": dehaloed,
        "trimmed_size": list(rgba.size),
        "opaque_pct": round(100.0 * float(alpha.mean()), 1),
    }
    return rgba, stats


def main():
    sheet = Image.open(SRC).convert("RGB")
    W, H = sheet.size
    arr = np.asarray(sheet)
    quads = {
        1: arr[0:H // 2, 0:W // 2],
        2: arr[0:H // 2, W // 2:W],
        3: arr[H // 2:H, 0:W // 2],
        4: arr[H // 2:H, W // 2:W],
    }
    log = []
    masters = {}
    for qi in (1, 2, 3, 4):
        rgba, stats = process_quadrant(quads[qi], qi)
        masters[qi] = rgba
        rgba.save(os.path.join(ROOT, "sprites", f"{NAMES[qi]}-master.png"))
        rt = rgba.copy()
        rt.thumbnail((512, 512), Image.LANCZOS)
        rt.save(os.path.join(ROOT, "sprites", f"{NAMES[qi]}.png"))
        stats["runtime_size"] = list(rt.size)
        log.append(stats)
        print(NAMES[qi], stats)
    # far-LOD cluster: three sprays composited into one canopy puff
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    combo = [
        (masters[1], (300, 260), -12, (28, 120)),
        (masters[4], (320, 250), 9, (170, 210)),
        (masters[2], (280, 240), -38, (110, 60)),
    ]
    for src, size, ang, pos in combo:
        s = src.copy()
        s.thumbnail(size, Image.LANCZOS)
        s = s.rotate(ang, expand=True, resample=Image.BICUBIC)
        canvas.alpha_composite(s, pos)
    bbox = canvas.getbbox()
    canvas = canvas.crop(bbox)
    canvas.save(os.path.join(ROOT, "sprites", "branch-cluster.png"))
    print("branch-cluster", canvas.size)
    # previews: contact sheet on light + dark, and display-size check
    for bg_name, bg in (("light", (238, 240, 235)), ("dark", (38, 48, 34))):
        contact = Image.new("RGB", (1040, 560), bg)
        for qi in (1, 2, 3, 4):
            s = masters[qi].copy()
            s.thumbnail((500, 260), Image.LANCZOS)
            x = 10 + (qi - 1) % 2 * 520
            y = 10 + (qi - 1) // 2 * 275
            contact.paste(s, (x, y), s)
        contact.save(os.path.join(ROOT, "previews", f"contact-{bg_name}.png"))
    small = Image.new("RGB", (1040, 300), (52, 66, 44))
    for qi in (1, 2, 3, 4):
        s = masters[qi].copy()
        # in-game cards are ~1.6 m wide on a 1366px screen at viewSize 13
        s.thumbnail((150, 150), Image.LANCZOS)
        small.paste(s, (10 + (qi - 1) * 260, 60), s)
    small.save(os.path.join(ROOT, "previews", "display-size.png"))
    with open(os.path.join(ROOT, "process-log.json"), "w") as fh:
        json.dump(log, fh, indent=2)


if __name__ == "__main__":
    main()
