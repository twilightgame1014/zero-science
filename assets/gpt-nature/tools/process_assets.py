#!/usr/bin/env python3
"""Process the GPT-generated nature sheets (A-F) into game-ready assets.

- Texture sheets (A ground / B bark / C rock): quadrant cut, resize,
  symmetric edge crossfade so they tile seamlessly.
- Sprite sheets (D leaves / E grass+flowers / F props): individual
  cut-outs by alpha connected components (never a blind grid split),
  background matting cleaned, trimmed, resized with NEAREST so the
  pixel look survives.

Originals live in ../source/. Outputs: ../textures/, ../sprites/.
"""
from PIL import Image, ImageEnhance
import numpy as np
import os
from scipy import ndimage

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, '..', 'source')
TEX = os.path.join(ROOT, '..', 'textures')
SPR = os.path.join(ROOT, '..', 'sprites')
os.makedirs(TEX, exist_ok=True)
os.makedirs(SPR, exist_ok=True)


def seamless(img: Image.Image, band: int = 28) -> Image.Image:
    """Symmetric edge crossfade: both edges converge to the average of
    the two ends, so the tile wraps without a visible seam."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    for x in range(band):
        t = (1 - x / band) * 0.5
        a[:, x] = a[:, x] * (1 - t) + a[:, w - 1 - x] * t
        a[:, w - 1 - x] = a[:, w - 1 - x] * (1 - t) + a[:, x] * t
    for y in range(band):
        t = (1 - y / band) * 0.5
        a[y, :] = a[y, :] * (1 - t) + a[h - 1 - y, :] * t
        a[h - 1 - y, :] = a[h - 1 - y, :] * (1 - t) + a[y, :] * t
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def quadrant(img: Image.Image, col: int, row: int) -> Image.Image:
    w, h = img.size
    return img.crop((col * w // 2, row * h // 2, (col + 1) * w // 2, (row + 1) * h // 2))


def texture_sheet(fname, names, size=256):
    img = Image.open(os.path.join(SRC, fname)).convert('RGB')
    out = {}
    for (col, row), name in names.items():
        tile = quadrant(img, col, row).resize((size, size), Image.LANCZOS)
        tile = seamless(tile)
        tile.save(os.path.join(TEX, name + '.png'))
        out[name] = tile
        print('texture', name)
    return out


def dilate_alpha(rgba: np.ndarray, px: int = 1) -> np.ndarray:
    """Thicken thin blades/leaves by one pixel so alpha-tested
    cutouts survive mipmap minification at game scale."""
    alpha = rgba[..., 3]
    grown = ndimage.maximum_filter(alpha, size=2 * px + 1)
    out = rgba.copy()
    new_area = (alpha == 0) & (grown > 0)
    # Colour for newly covered pixels: nearest opaque neighbour's.
    idx = ndimage.distance_transform_edt(
        alpha == 0, return_distances=False, return_indices=True)
    out[new_area] = rgba[tuple(idx[:, new_area])]
    out[..., 3] = np.maximum(alpha, grown)
    return out


# Per-sprite colour grades (r, g, b multipliers + saturation factor).
# The E-sheet grass is pale sage/straw; under the game's bright
# daylight it clips to silver-white, so grass-family sprites are
# deepened here (texture-side fix, lighting untouched).
GRADES = {
    'grass_short': (0.78, 0.9, 0.74, 1.35),
    'grass_wide': (0.78, 0.9, 0.74, 1.35),
    'grass_dry': (0.86, 0.82, 0.68, 1.2),
    'fern_frond': (0.86, 0.92, 0.84, 1.18),
    'herb_patch': (0.88, 0.94, 0.86, 1.12),
}


def grade(rgba: np.ndarray, name: str) -> np.ndarray:
    g = GRADES.get(name)
    if not g:
        return rgba
    img = Image.fromarray(rgba, 'RGBA')
    rgb = img.convert('RGB')
    rgb = ImageEnhance.Color(rgb).enhance(g[3])
    arr = np.asarray(rgb).astype(np.float32)
    arr[..., 0] *= g[0]
    arr[..., 1] *= g[1]
    arr[..., 2] *= g[2]
    out = np.dstack([np.clip(arr, 0, 255).astype(np.uint8), rgba[..., 3]])
    return out


def finish_sprite(rgba: np.ndarray, name: str, target: int):
    """Trim to the alpha bbox, pad, NEAREST-resize, save."""
    alpha = rgba[..., 3]
    ys, xs = np.nonzero(alpha > 0)
    if len(xs) == 0:
        print('EMPTY', name)
        return
    crop = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray(crop, 'RGBA')
    img = Image.alpha_composite(
        Image.new('RGBA', (img.width + 4, img.height + 4), (0, 0, 0, 0)),
        img) if False else img
    canvas = Image.new('RGBA', (img.width + 4, img.height + 4), (0, 0, 0, 0))
    canvas.alpha_composite(img, (2, 2))
    s = target / max(canvas.size)
    canvas = canvas.resize(
        (max(1, round(canvas.width * s)), max(1, round(canvas.height * s))),
        Image.NEAREST)
    canvas.save(os.path.join(SPR, name + '.png'))
    print('sprite', name, canvas.size)


def components_from_alpha(alpha: np.ndarray, min_area=400):
    lab, n = ndimage.label(alpha > 32)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if (lab[sl] == i).sum() >= min_area:
            out.append(sl)
    out.sort(key=lambda s: (s[0].start // 300, s[1].start))
    return out


def sheet_alpha_binarized(fname):
    img = Image.open(os.path.join(SRC, fname))
    arr = np.array(img.convert('RGBA'))
    arr[..., 3] = np.where(arr[..., 3] >= 128, 255, 0)
    return arr


def sheet_white_flood(fname, thresh=243, dehalo_iters=1, dehalo_thresh=212):
    """Remove a white background by border flood fill (keeps enclosed
    light details that are not connected to the border), then eat the
    bright JPEG halo along the matte edge."""
    img = Image.open(os.path.join(SRC, fname)).convert('RGB')
    arr = np.array(img).astype(int)
    near_white = (arr.min(axis=2) > thresh)
    lab, _ = ndimage.label(near_white)
    border = set(np.unique(np.concatenate([
        lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    for _ in range(dehalo_iters):
        edge = ndimage.binary_dilation(alpha == 0) & (alpha > 0)
        kill = edge & (arr.min(axis=2) > dehalo_thresh)
        alpha = np.where(kill, 0, alpha)
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    return rgba


def cut_sheet(rgba, names, target, cols, min_area=200, dilate=0):
    """Group alpha components into grid cells by their centres (some
    props are multi-part: pebbles = 3 stones, leaves pile = 3 leaves),
    then cut each cell's union. Never a blind pixel-grid slice: the
    final trim uses the real alpha bbox of the grouped parts."""
    rows = len(names) // cols
    H, W = rgba.shape[:2]
    lab, _ = ndimage.label(rgba[..., 3] > 32)
    cells = {}
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if (lab[sl] == i).sum() < min_area:
            continue
        cy = (sl[0].start + sl[0].stop) / 2 / H
        cx = (sl[1].start + sl[1].stop) / 2 / W
        key = (min(rows - 1, int(cy * rows)), min(cols - 1, int(cx * cols)))
        cells.setdefault(key, []).append(i)
    ordered = [names[r * cols + c] for r in range(rows) for c in range(cols)]
    found = {}
    for (r, c), ids in cells.items():
        found[ordered[r * cols + c]] = ids
    assert set(found) == set(names), f'cells found: {sorted(found)} vs {sorted(names)}'
    for name in names:
        mask = np.isin(lab, found[name])
        ys, xs = np.nonzero(mask)
        part = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
        sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        part[..., 3] = np.where(sub, part[..., 3], 0)
        if dilate:
            part = dilate_alpha(part, dilate)
        finish_sprite(grade(part, name), name, target)


def main():
    # ---- textures A / B / C ----
    tex = texture_sheet('sheet-A-ground.png', {
        (0, 0): 'ground_grass', (1, 0): 'ground_dirt',
        (0, 1): 'ground_leaves', (1, 1): 'ground_gravel'})
    base = tex['ground_grass'].copy()
    base = ImageEnhance.Color(base).enhance(0.68)
    base = ImageEnhance.Contrast(base).enhance(0.92)
    base = ImageEnhance.Brightness(base).enhance(1.18)
    base.save(os.path.join(TEX, 'ground_grass_base.png'))
    print('texture ground_grass_base (toned down)')
    texture_sheet('sheet-B-bark.jpg', {
        (0, 0): 'bark_deep', (1, 0): 'bark_birch',
        (0, 1): 'wood_grain', (1, 1): 'bark_moss'})
    texture_sheet('sheet-C-rock.jpg', {
        (0, 0): 'rock_layered', (1, 0): 'rock_slate',
        (0, 1): 'rock_moss', (1, 1): 'cliff_dirt'})

    # ---- sprites F (real alpha) ----
    cut_sheet(sheet_alpha_binarized('sheet-F-props.png'),
              ['prop_branch', 'prop_bundle', 'prop_pebbles', 'prop_flint',
               'prop_stump', 'prop_rubble', 'prop_cut_patch', 'prop_leaves_pile'],
              target=192, cols=4)

    # ---- sprites D (white bg, green subjects) ----
    cut_sheet(sheet_white_flood('sheet-D-leaves.jpg', dehalo_iters=2, dehalo_thresh=205),
              ['leaf_oak', 'leaf_birch', 'leaf_shrub', 'leaf_fern'],
              target=256, cols=2)

    # ---- sprites E (white bg; flood fill protects enclosed petals) ----
    cut_sheet(sheet_white_flood('sheet-E-grass-flowers.jpg'),
              ['grass_short', 'grass_wide', 'grass_dry', 'fern_frond',
               'flower_white', 'flower_yellow', 'flower_purple', 'herb_patch'],
              target=160, cols=4, dilate=1)


if __name__ == '__main__':
    main()
