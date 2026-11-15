#!/usr/bin/env python3
"""Cut the 9 GPT item-icon sheets (+ crucible replacement) into individual
transparent PNGs named by game item ID.

Method (same as the round-4 UI icons / round-6 sprite pipeline):
- white-background JPGs: background = border flood fill over near-white
  (min channel >= 243); white flowers / pale powders survive because they are
  not connected to the border.
- transparent PNGs: binarize the generator alpha at >=128 (drops the haze).
- Icons are recovered as connected components of the alpha mask and grouped
  into grid cells by component centroid, so multi-part icons (cobble piles,
  sand heaps) stay one icon and nothing is blind-grid-sliced.
- Sheet 6's moltenglass cell (a bottle) is skipped: the owner specified the
  separate crucible image instead.
- Fringe cleanup for the transparent sheets: opaque pixels in the 2px edge
  band whose saturation is extreme are pulled toward the nearest interior
  colour (removes the red/yellow/blue chroma bleed the generator leaves).
- Every icon is normalised onto a 256x256 canvas: bounding box scaled so its
  longer side is 208px, centred. Output: ../icons/<id>.png + process-log.json.
"""
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source"
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

SHEETS = {
    1: ("sheet1-nature.jpg", "jpg", 4),
    2: ("sheet2-sea-minerals.png", "png", 4),
    3: ("sheet3-elements.jpg", "jpg", 4),
    4: ("sheet4-salts.jpg", "jpg", 4),
    5: ("sheet5-compounds.png", "png", 4),
    6: ("sheet6-ceramics-metals.jpg", "jpg", 4),
    7: ("sheet7-metals.jpg", "jpg", 4),
    8: ("sheet8-organic.jpg", "jpg", 4),
    9: ("sheet9-modern.jpg", "jpg", 3),
}
IDS = {
    1: "twig leaves vine resin seed log wax grass grape ochre rain river clay sand cobble flint",
    2: "bark seawater shell seaweed limestone granite basalt quartz spring coal rocksalt hematite malachite cassiterite sphalerite bauxite",
    3: "sulfur obsidian crude amber meteorite gold fossil crystal supernatant mud water steam co2 so2 hydrogen oxygen",
    4: "chlorine crudesalt saltpowder brine cleanbrine salt nigari ash lye potash seaash seajuice soda naoh quicklime slaked",
    5: "plaster stronglye caco3 cement concrete crushedseed oil soap glycerinwater charcoal woodvinegar coke coaltar greenware driedware pot",
    6: "greenbrick sunbrick brick greencrucible crucible quartzpowder cleansand moltenglass glass oremalachite orehematite orecass orezinc zno copper iron",
    7: "tin zinc bronze slag copperplate wire ironrod rust pigiron steel electromagnet crushedgrape wine ethanol vinegar turpentine",
    8: "rosin redpigment blackpigment redpaint pulp paper gasoline kerosene naphtha heavyoil ethylene pe plasticbox orebauxite aluminate redmud",
    9: "aloh alumina aluminum silicon pure_si bulb solarcell thread cloth",
}
SKIP = {(6, "moltenglass")}  # replaced by the crucible image
CANVAS = 256
FIT = 208  # longer bbox side after scaling


def flood_bg(mask):
    """mask: True where pixel is background-coloured. Returns True where the
    pixel is connected to the image border through background-coloured pixels."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    return seen


def sheet_alpha(im, kind):
    if kind == "png":
        a = np.asarray(im.split()[3])
        return a >= 128
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    near_white = rgb.min(axis=2) >= 243
    bg = flood_bg(near_white)
    return ~bg


def despill_edge(rgba, fg):
    """Pull extreme-saturation colours in the 2px silhouette band toward the
    nearest interior colour. Returns number of corrected pixels."""
    rgb = rgba[:, :, :3].astype(np.float32)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    interior = ndimage.binary_erosion(fg, iterations=2)
    band = fg & ~interior
    bad = band & (sat > 0.82)
    count = int(bad.sum())
    if count == 0:
        return 0
    # nearest interior pixel indices
    _, inds = ndimage.distance_transform_edt(~interior, return_indices=True)
    ys, xs = np.where(bad)
    src_y = inds[0][ys, xs]
    src_x = inds[1][ys, xs]
    rgba[ys, xs, :3] = rgba[src_y, src_x, :3]
    return count


def normalise(rgba_img):
    """rgba_img: PIL RGBA cropped icon. Returns 256x256 canvas image."""
    bbox = rgba_img.split()[3].getbbox()
    if bbox is None:
        return None
    icon = rgba_img.crop(bbox)
    w, h = icon.size
    scale = FIT / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    icon = icon.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((CANVAS - nw) // 2, (CANVAS - nh) // 2))
    return canvas


def main():
    log = {"sheets": {}, "icons": {}, "corrections": []}
    for sheet_no, (fname, kind, grid) in SHEETS.items():
        im = Image.open(SRC / fname)
        fg = sheet_alpha(im, kind)
        rgba = np.asarray(im.convert("RGBA")).copy()
        lab, n = ndimage.label(fg)
        objects = ndimage.find_objects(lab)
        h, w = fg.shape
        cell_w, cell_h = w / grid, h / grid
        ids = IDS[sheet_no].split()
        cells = {}
        for idx, sl in enumerate(objects, start=1):
            if sl is None:
                continue
            area = int((lab[sl] == idx).sum())
            if area < 40:  # dust / haze speck
                continue
            ys, xs = np.where(lab[sl] == idx)
            cy, cx = ys.mean() + sl[0].start, xs.mean() + sl[1].start
            col = min(grid - 1, int(cx / cell_w))
            row = min(grid - 1, int(cy / cell_h))
            cells.setdefault((row, col), []).append(idx)
        fringe_fixed = 0
        if kind == "png":
            fringe_fixed = despill_edge(rgba, fg)
            rgba[:, :, 3] = np.where(fg, 255, 0)
        else:
            rgba[:, :, 3] = np.where(fg, 255, 0)
        sheet_img = Image.fromarray(rgba, "RGBA")
        for row in range(grid):
            for col in range(grid):
                iid = ids[row * grid + col]
                if (sheet_no, iid) in SKIP:
                    log["corrections"].append(
                        f"sheet{sheet_no} {iid}: bottle icon skipped (replaced by crucible image per owner spec)")
                    continue
                comp_ids = cells.get((row, col), [])
                if not comp_ids:
                    log["corrections"].append(f"sheet{sheet_no} {iid}: NO component found - CHECK")
                    continue
                mask = np.isin(lab, comp_ids)
                ys, xs = np.where(mask)
                y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
                pad = 3
                y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
                y1, x1 = min(h, y1 + pad), min(w, x1 + pad)
                crop = sheet_img.crop((x0, y0, x1, y1))
                # keep only this cell's components inside the crop
                cmask = mask[y0:y1, x0:x1]
                ca = np.asarray(crop.split()[3]).copy()
                ca[~cmask] = 0
                crop.putalpha(Image.fromarray(ca))
                out = normalise(crop)
                if out is None:
                    log["corrections"].append(f"sheet{sheet_no} {iid}: empty after crop - CHECK")
                    continue
                out.save(OUT / f"{iid}.png")
                log["icons"][iid] = {"sheet": sheet_no, "row": row, "col": col,
                                     "components": len(comp_ids)}
        log["sheets"][sheet_no] = {"file": fname, "kind": kind,
                                   "fringe_pixels_fixed": fringe_fixed,
                                   "components_total": int(n)}
        print(f"sheet {sheet_no}: done (fringe fixed: {fringe_fixed})")

    # moltenglass from the crucible image
    im = Image.open(SRC / "moltenglass-crucible.png")
    a = np.asarray(im.split()[3])
    fg = a >= 128
    rgba = np.asarray(im.convert("RGBA")).copy()
    fixed = despill_edge(rgba, fg)
    rgba[:, :, 3] = np.where(fg, 255, 0)
    out = normalise(Image.fromarray(rgba, "RGBA"))
    out.save(OUT / "moltenglass.png")
    log["icons"]["moltenglass"] = {"sheet": "separate crucible image", "fringe_pixels_fixed": fixed}
    log["corrections"].append("moltenglass: separate crucible image used (owner spec), haze binarized at alpha>=128")
    print("moltenglass: done (fringe fixed:", fixed, ")")

    (ROOT / "process-log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print("icons written:", len(list(OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
