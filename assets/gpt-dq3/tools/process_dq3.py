#!/usr/bin/env python3
"""Process the GPT 'DQ3 density' sheets (round 19) in assets/gpt-dq3.

Cutouts: border flood fill + rembg isnet-general-use gate + despill
(the proven icons pipeline; no blanket white/black/green deletion).
Smoke uses a segmentation-union SOFT alpha (white smoke on white).
Tiles: baked-light flattening, half-roll crossfade, seam metric,
4x4 previews. Special cases: roof period-crop, plaster cell extract,
plank window separation, dirt rut inpaint (dirt-plain), plaza strip,
lava-flow albedo + emissive split.
"""
import json
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "source"
SPRAYS = ROOT / "sprays"
GROUND = ROOT / "ground"
PROPS = ROOT / "props"
for d in (SPRAYS, GROUND, PROPS):
    d.mkdir(exist_ok=True)

# ---------------- shared helpers (round-17 proven) ----------------

def flood_background(rgb, thresh=238):
    near_white = rgb.min(axis=2) >= thresh
    h, w = near_white.shape
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; dq.append((ny, nx))
    return bg

def despill(rgb, alpha):
    opaque = alpha > 0
    if not opaque.any(): return 0
    mx = rgb.max(axis=2).astype(int); mn = rgb.min(axis=2).astype(int)
    pale = opaque & (mn > 185) & ((mx - mn) < 48)
    near_edge = pale & ndimage.binary_dilation(~opaque, iterations=2)
    clean = opaque & ~pale
    if not clean.any() or not near_edge.any(): return 0
    _, inds = ndimage.distance_transform_edt(~clean, return_indices=True)
    fixed = rgb.copy(); ys, xs = np.where(near_edge)
    fixed[ys, xs] = rgb[inds[0][ys, xs], inds[1][ys, xs]]
    rgb[:] = fixed
    return int(len(ys))

_SEG = {}
def seg_alpha(fname):
    if fname not in _SEG:
        from rembg import new_session, remove
        if "session" not in _SEG: _SEG["session"] = new_session("isnet-general-use")
        im = Image.open(SRC / fname).convert("RGB")
        out = remove(im, session=_SEG["session"])
        _SEG[fname] = np.asarray(out)[:, :, 3]
    return _SEG[fname]

def sheet_alpha(fname, mode="gate"):
    im = Image.open(SRC / fname).convert("RGB")
    rgb = np.asarray(im).astype(np.uint8)
    bg = flood_background(rgb)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    seg = seg_alpha(fname)
    if mode == "gate":
        gated = (alpha > 0) & (seg < 32)
        alpha = np.where(gated, 0, alpha).astype(np.uint8)
        stats = {"seg_gated_px": int(gated.sum())}
    else:
        union = (alpha > 0) | (seg >= 128)
        alpha = np.where(union, 255, 0).astype(np.uint8)
        stats = {"seg_union_added_px": int(((alpha > 0) & bg).sum())}
    n = despill(rgb, alpha)
    stats["despill_px"] = n
    return rgb, alpha, stats

def remove_white_pockets(rgb, alpha):
    """Transparent-out enclosed uniform-white regions inside a cutout
    (e.g. background seen through a bucket handle). Strict criteria so
    shaded white petals/cloth survive: near-pure white, near-zero
    saturation, near-uniform, and not touching the crop border."""
    cand = (alpha > 0) & (rgb.min(axis=2) >= 243) & ((rgb.max(axis=2).astype(int) - rgb.min(axis=2).astype(int)) <= 8)
    if not cand.any(): return alpha, 0
    lab, n = ndimage.label(cand)
    removed = 0
    out = alpha.copy()
    H, W = alpha.shape
    for i in range(1, n + 1):
        m = lab == i
        ys, xs = np.where(m)
        if ys.min() == 0 or xs.min() == 0 or ys.max() == H - 1 or xs.max() == W - 1:
            continue
        if float(rgb[:, :, 0][m].std()) <= 5.0:
            out[m] = 0; removed += int(m.sum())
    return out, removed

def save_cutout(rgb, alpha, box, outpath, size=512, pad_frac=0.06):
    x0, y0, x1, y1 = box
    sub_rgb = rgb[y0:y1, x0:x1]
    sub_a = alpha[y0:y1, x0:x1]
    sub_a, _pockets = remove_white_pockets(sub_rgb, sub_a)
    cut = Image.fromarray(np.dstack([sub_rgb, sub_a]), "RGBA")
    scale = (size * (1 - 2 * pad_frac)) / max(cut.width, cut.height)
    nw, nh = max(1, round(cut.width * scale)), max(1, round(cut.height * scale))
    cut = cut.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(cut, ((size - nw) // 2, (size - nh) // 2), cut)
    canvas.save(outpath)
    return {"bbox": [int(x0), int(y0), int(x1), int(y1)], "px": int((sub_a > 0).sum())}

def alpha_bbox(alpha, region=None):
    a = alpha if region is None else alpha[region[1]:region[3], region[0]:region[2]]
    ys, xs = np.where(a > 0)
    if len(ys) == 0: return None
    ox, oy = (region[0], region[1]) if region else (0, 0)
    return (int(xs.min()) + ox, int(ys.min()) + oy, int(xs.max()) + 1 + ox, int(ys.max()) + 1 + oy)

def keep_main_mass(alpha, region, dilate=20):
    x0, y0, x1, y1 = region
    sub = alpha[y0:y1, x0:x1] > 0
    lab, n = ndimage.label(sub)
    if n <= 1: return alpha
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    main = lab == (int(np.argmax(sizes)) + 1)
    near = ndimage.binary_dilation(main, iterations=dilate)
    keep = main | (sub & near)
    out = alpha.copy()
    out[y0:y1, x0:x1] = np.where(keep, alpha[y0:y1, x0:x1], 0)
    return out

def cut_quadrants(rgb, alpha, names, outdir, size=512):
    H, W = alpha.shape
    results = {}
    for i, name in enumerate(names):
        r, c = divmod(i, 2)
        region = (round(c * W / 2), round(r * H / 2), round((c + 1) * W / 2), round((r + 1) * H / 2))
        alpha = keep_main_mass(alpha, region)
        box = alpha_bbox(alpha, region)
        if box is None:
            results[name] = "EMPTY"; continue
        pad = 4
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(W, box[2] + pad), min(H, box[3] + pad))
        results[name] = save_cutout(rgb, alpha, box, outdir / f"{name}.png", size)
    return results

def cut_components(rgb, alpha, expected, outdir, size=512, min_px=700):
    """Free-layout sheets: each item is already one connected component.
    Assign components to expected items by centroid distance; attach
    small fragments that fall inside the item's dilated bbox and are
    closer to this item than to any other expected item."""
    lab, n = ndimage.label(alpha > 0)
    H, W = alpha.shape
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None: continue
        px = int((lab[sl] == i + 1).sum())
        comps.append({"id": i + 1, "px": px,
                      "box": (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop),
                      "cen": ((sl[1].start + sl[1].stop) / 2, (sl[0].start + sl[0].stop) / 2)})
    big = [c for c in comps if c["px"] >= min_px]
    results = {}
    used = set()
    for name, fx, fy in expected:
        tx, ty = fx * W, fy * H
        best, bestd = None, 1e18
        for c in big:
            if c["id"] in used: continue
            d = (c["cen"][0] - tx) ** 2 + (c["cen"][1] - ty) ** 2
            if d < bestd: best, bestd = c, d
        if best is None:
            results[name] = "MISSING"; continue
        used.add(best["id"])
        bx = (max(0, best["box"][0] - 24), max(0, best["box"][1] - 24),
              min(W, best["box"][2] + 24), min(H, best["box"][3] + 24))
        keep_ids = {best["id"]}
        for c in comps:
            if c["id"] == best["id"]: continue
            if c["box"][0] < bx[2] and c["box"][2] > bx[0] and c["box"][1] < bx[3] and c["box"][3] > bx[1]:
                d_me = (c["cen"][0] - tx) ** 2 + (c["cen"][1] - ty) ** 2
                d_other = min(((c["cen"][0] - ex * W) ** 2 + (c["cen"][1] - ey * H) ** 2)
                              for _, ex, ey in expected if _ != name)
                if d_me < d_other: keep_ids.add(c["id"])
        sub_alpha = np.where(np.isin(lab, list(keep_ids)), 255, 0).astype(np.uint8)
        ys, xs = np.where(sub_alpha > 0)
        box = (max(0, int(xs.min()) - 5), max(0, int(ys.min()) - 5),
               min(W, int(xs.max()) + 6), min(H, int(ys.max()) + 6))
        results[name] = save_cutout(rgb, sub_alpha, box, outdir / f"{name}.png", size)
    results["_components"] = len(big)
    return results

# ---------------- tiles ----------------

def flatten_light(rgb, strength=0.3, blur=42):
    lum = rgb.mean(axis=2, keepdims=True)
    low = ndimage.gaussian_filter(lum, blur)
    target = low.mean()
    adj = np.clip(rgb * (1 - strength) + rgb * (target / np.maximum(low, 1)) * strength, 0, 255)
    return adj.astype(np.uint8)

def crossfade_tile(rgb, axes=(0, 1)):
    out = rgb.astype(np.float32)
    h, w, _ = out.shape
    if 0 in axes:
        rolled = np.roll(out, h // 2, axis=0)
        yy = np.mgrid[0:h, 0:w][0]
        wy = np.clip(1 - np.abs(yy - h / 2) / (h * 0.28), 0, 1) ** 2
        out = out * (1 - wy[..., None] * 0.5) + rolled * (wy[..., None] * 0.5)
    if 1 in axes:
        rolled = np.roll(out, w // 2, axis=1)
        xx = np.mgrid[0:h, 0:w][1]
        wx = np.clip(1 - np.abs(xx - w / 2) / (w * 0.28), 0, 1) ** 2
        out = out * (1 - wx[..., None] * 0.5) + rolled * (wx[..., None] * 0.5)
    return np.clip(out, 0, 255).astype(np.uint8)

def seam_ratio(rgb):
    a = rgb.astype(np.float32)
    ex = np.abs(a[:, 0] - a[:, -1]).mean(); ey = np.abs(a[0, :] - a[-1, :]).mean()
    ix = np.abs(np.diff(a, axis=1)).mean(); iy = np.abs(np.diff(a, axis=0)).mean()
    return round(float(max(ex / max(ix, 1e-6), ey / max(iy, 1e-6))), 2)

def quadrant(im, idx, inset=14):
    W, H = im.size
    r, c = divmod(idx, 2)
    return im.crop((round(c * W / 2) + inset, round(r * H / 2) + inset,
                    round((c + 1) * W / 2) - inset, round((r + 1) * H / 2) - inset))

def save_tile(rgb, name, size=512):
    Image.fromarray(rgb).resize((size, size), Image.LANCZOS).save(GROUND / f"{name}.png")
    tile = Image.fromarray(rgb).resize((size, size), Image.LANCZOS)
    prev = Image.new("RGB", (size * 2, size * 2))
    for i in range(2):
        for j in range(2):
            prev.paste(tile, (j * size, i * size))
    prev.save(GROUND / f"{name}-preview4x4.png")
    return {"seam": seam_ratio(rgb)}

report = {}

# ---------------- cutout quadrant sheets ----------------
QUAD_CUTOUTS = [
    ("sheet-03-broadleaf.jpg", ["broadleaf-bright", "broadleaf-droop", "broadleaf-deep", "broadleaf-light"]),
    ("sheet-04-flowers-vines.jpg", ["flower-branch", "berry-branch", "vine", "roundleaf-bush"]),
    ("sheet-08-waterside.jpg", ["lily-flower", "reed-cattail", "floating-plants", "waterside-bush"]),
]
report["cutouts"] = {}
for fname, names in QUAD_CUTOUTS:
    rgb, alpha, stats = sheet_alpha(fname, "gate")
    res = cut_quadrants(rgb, alpha, names, SPRAYS)
    report["cutouts"][fname] = {**stats, "items": res}
    print(fname, {k: (v if isinstance(v, str) else v["px"]) for k, v in res.items()})

# ---------------- free-layout sheets ----------------
SCATTER_EXPECTED = [
    ("grass-wide", 0.50, 0.17), ("grass-pampas", 0.83, 0.17),
    ("flower-white", 0.17, 0.44), ("flower-yellow", 0.50, 0.44), ("flower-pink", 0.83, 0.44),
    ("pebbles", 0.28, 0.60), ("leaf-pile", 0.62, 0.60),
    ("stump", 0.15, 0.85), ("log-fallen", 0.50, 0.85), ("moss-rock", 0.85, 0.85),
]
rgb, alpha, stats = sheet_alpha("sheet-05-scatter.jpg", "gate")
res = cut_components(rgb, alpha, SCATTER_EXPECTED, SPRAYS)
report["cutouts"]["sheet-05-scatter.jpg"] = {**stats, "items": res}
print("scatter", {k: (v if isinstance(v, str) else v["px"]) for k, v in res.items() if not k.startswith("_")})
# grass-tall: the isnet gate fragments its thin blades, so extract it
# from the flood-fill alpha alone, restricted to the top-left region.
_im = Image.open(SRC / "sheet-05-scatter.jpg").convert("RGB")
_rgb5 = np.asarray(_im).astype(np.uint8)
_bg5 = flood_background(_rgb5)
_a5 = np.where(_bg5, 0, 255).astype(np.uint8)
despill(_rgb5, _a5)
_reg = np.zeros_like(_a5); _reg[40:480, 40:440] = 255
_a5 = np.where(_reg > 0, _a5, 0).astype(np.uint8)
_lab5, _n5 = ndimage.label(_a5 > 0)
if _n5:
    _sizes = ndimage.sum(np.ones_like(_lab5), _lab5, range(1, _n5 + 1))
    _main = _lab5 == (int(np.argmax(_sizes)) + 1)
    _near = ndimage.binary_dilation(_main, iterations=26)
    _a5 = np.where(_main | ((_a5 > 0) & _near), 255, 0).astype(np.uint8)
    _box = alpha_bbox(_a5)
    res_gt = save_cutout(_rgb5, _a5, _box, SPRAYS / "grass-tall.png")
    report["cutouts"]["sheet-05-scatter.jpg"]["items"]["grass-tall"] = res_gt
    print("grass-tall (flood-only)", res_gt["px"])

PROPS_EXPECTED = [
    ("banner-red", 0.14, 0.20), ("banner-green", 0.36, 0.20),
    ("planter-large", 0.66, 0.24), ("planter-small", 0.88, 0.27),
    ("fruit-basket", 0.14, 0.53), ("crates", 0.47, 0.50), ("canopy-cloth", 0.79, 0.50),
    ("stone-lantern", 0.14, 0.82), ("barrel", 0.47, 0.82), ("bucket-rope", 0.79, 0.82),
]
rgb, alpha, stats = sheet_alpha("sheet-06-town-props.jpg", "gate")
res = cut_components(rgb, alpha, PROPS_EXPECTED, PROPS)
report["cutouts"]["sheet-06-town-props.jpg"] = {**stats, "items": res}
print("props", {k: (v if isinstance(v, str) else v["px"]) for k, v in res.items() if not k.startswith("_")})

# ---------------- volcano sheet ----------------
im7 = Image.open(SRC / "sheet-07-volcano.jpg").convert("RGB")
W7, H7 = im7.size
# smoke (BL): soft alpha = seg-union probability shaded by greyness
seg7 = seg_alpha("sheet-07-volcano.jpg").astype(np.float32) / 255.0
rgb7 = np.asarray(im7).astype(np.uint8)
grey = 1.0 - rgb7.mean(axis=2) / 255.0  # smoke is light grey: 0.05..0.35
smoke_alpha = np.clip(seg7 * np.clip(grey * 3.2, 0, 1), 0, 1)
bl_region = (0, H7 // 2, W7 // 2, H7)
a_bl = (smoke_alpha * 255).astype(np.uint8)
lab, n = ndimage.label(a_bl[bl_region[1]:bl_region[3], bl_region[0]:bl_region[2]] > 40)
smoke_res = {}
if n >= 3:
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    order = np.argsort(sizes)[::-1][:3]
    for rank, idx in enumerate(sorted(order, key=lambda i: ndimage.center_of_mass(lab == i + 1)[1])):
        mask = (lab == idx + 1)
        ys, xs = np.where(mask)
        box = (int(xs.min()), int(ys.min()) + bl_region[1], int(xs.max()) + 1, int(ys.max()) + 1 + bl_region[1])
        sub_a = np.where(mask, a_bl[bl_region[1]:bl_region[3], bl_region[0]:bl_region[2]], 0)
        full_a = np.zeros_like(a_bl); full_a[bl_region[1]:bl_region[3], bl_region[0]:bl_region[2]] = sub_a
        smoke_res[f"smoke-{rank + 1}"] = save_cutout(rgb7, full_a, box, SPRAYS / f"smoke-{rank + 1}.png")
report["smoke"] = smoke_res
print("smoke", list(smoke_res.keys()))
# basalt (BR): hard cutout via gate on the whole sheet alpha restricted to BR
rgb7b, alpha7, stats7 = sheet_alpha("sheet-07-volcano.jpg", "gate")
br = (W7 // 2, H7 // 2, W7, H7)
a_br = np.zeros_like(alpha7); a_br[br[1]:br[3], br[0]:br[2]] = alpha7[br[1]:br[3], br[0]:br[2]]
lab, n = ndimage.label(a_br > 0)
basalt_res = {}
if n >= 3:
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    order = np.argsort(sizes)[::-1][:3]
    coms = [ndimage.center_of_mass(lab == i + 1) for i in order]
    for rank, idx in enumerate([i for _, i in sorted(zip(coms, order))]):
        mask = lab == idx + 1
        ys, xs = np.where(mask)
        box = (max(0, int(xs.min()) - 4), max(0, int(ys.min()) - 4), min(W7, int(xs.max()) + 5), min(H7, int(ys.max()) + 5))
        sub = np.where(mask, 255, 0).astype(np.uint8)
        basalt_res[f"basalt-{rank + 1}"] = save_cutout(rgb7b, sub, box, SPRAYS / f"basalt-{rank + 1}.png")
report["basalt"] = basalt_res
print("basalt", list(basalt_res.keys()))

# ---------------- tiles: sheet-01 town ground ----------------
report["tiles"] = {}
im1 = Image.open(SRC / "sheet-01-town-ground.jpg").convert("RGB")
cobble = crossfade_tile(flatten_light(np.asarray(quadrant(im1, 0))))
report["tiles"]["town-cobble"] = save_tile(cobble, "town-cobble")
grass = crossfade_tile(flatten_light(np.asarray(quadrant(im1, 2)), strength=0.22))
report["tiles"]["town-grass"] = save_tile(grass, "town-grass")
dirt = np.asarray(quadrant(im1, 3))
report["tiles"]["town-dirt"] = save_tile(crossfade_tile(flatten_light(dirt)), "town-dirt")

def diffusion_inpaint(rgb, mask, iters=260):
    """Fill masked pixels by iterative neighbour diffusion."""
    img = rgb.astype(np.float32)
    known = ~mask
    img[mask] = 0
    w = known.astype(np.float32)
    for _ in range(iters):
        for c in range(3):
            num = ndimage.uniform_filter(img[:, :, c] * w, size=3)
            den = ndimage.uniform_filter(w, size=3)
            upd = mask & (den > 0)
            img[:, :, c] = np.where(upd, num / np.maximum(den, 1e-6), img[:, :, c])
        w = np.where(mask & (ndimage.uniform_filter(w, size=3) > 0), 1.0, w)
        if (w[mask] > 0).all():
            # one more smoothing pass over filled area
            for c in range(3):
                img[:, :, c] = np.where(mask, ndimage.gaussian_filter(img[:, :, c], 1.2), img[:, :, c])
            break
    return np.clip(img, 0, 255).astype(np.uint8)

# dirt-plain: suppress the baked wheel rut (darker curved band)
lum = dirt.mean(axis=2)
low = ndimage.gaussian_filter(lum, 18)
sat = dirt.max(axis=2).astype(int) - dirt.min(axis=2).astype(int)
rut_mask = (low - lum > 9) & (sat < 78)
rut_mask = ndimage.binary_dilation(rut_mask, iterations=2)
plain = diffusion_inpaint(dirt, rut_mask)
report["tiles"]["town-dirt-plain"] = save_tile(crossfade_tile(flatten_light(plain)), "town-dirt-plain")
report["tiles"]["town-dirt-plain"]["rut_px"] = int(rut_mask.sum())

# plaza strip: a horizontal band of arc slabs from TR, x-tileable
plaza_q = np.asarray(quadrant(im1, 1, inset=6))
ph = plaza_q.shape[0]
band = plaza_q[int(ph * 0.30):int(ph * 0.62)]
band = flatten_light(band, strength=0.2)
band = crossfade_tile(band, axes=(1,))
Image.fromarray(band).resize((1024, 256), Image.LANCZOS).save(GROUND / "town-plaza-strip.png")
report["tiles"]["town-plaza-strip"] = {"seam_x": seam_ratio(band)}

# ---------------- tiles: sheet-02 walls & roof ----------------
im2 = Image.open(SRC / "sheet-02-walls-roof.jpg").convert("RGB")
# roof: period-crop via autocorrelation of the row profile
roof_q = np.asarray(quadrant(im2, 0, inset=4)).astype(np.float32)
prof = roof_q.mean(axis=(1, 2))
prof = prof - prof.mean()
best_p, best_v = 0, -1
for p in range(60, 220):
    v = float(np.corrcoef(prof[:-p], prof[p:])[0, 1])
    if v > best_v: best_v, best_p = v, p
rows = max(1, int(roof_q.shape[0] // best_p))
roof_crop = roof_q[:rows * best_p].astype(np.uint8)
roof_crop = crossfade_tile(roof_crop, axes=(1,))
report["tiles"]["roof-orange"] = save_tile(roof_crop, "roof-orange")
report["tiles"]["roof-orange"]["row_period_px"] = int(best_p)
# plaster-timber: full quadrant tile (distant/fallback use)
pt = crossfade_tile(flatten_light(np.asarray(quadrant(im2, 1)), strength=0.18))
report["tiles"]["wall-plaster-timber"] = save_tile(pt, "wall-plaster-timber")
# plaster-only: largest beam-free cell interior of the same quadrant
ptq = np.asarray(quadrant(im2, 1, inset=4))
dark = (ptq.mean(axis=2) < 120) & (np.abs(ptq[:, :, 0].astype(int) - ptq[:, :, 2].astype(int)) > 18)
col_beam = dark.mean(axis=0) > 0.55
row_beam = dark.mean(axis=1) > 0.55
def largest_gap(flags):
    best, cur, start = (0, 0), 0, 0
    for i, f in enumerate(flags):
        if f: cur = 0; start = i + 1
        else:
            cur += 1
            if cur > best[1] - best[0]: best = (start, i)
    return best
gx, gy = largest_gap(col_beam), largest_gap(row_beam)
cell = ptq[gy[0] + 6:gy[1] - 6, gx[0] + 6:gx[1] - 6]
if cell.size:
    plaster = crossfade_tile(flatten_light(cell, strength=0.15))
    report["tiles"]["wall-plaster"] = save_tile(plaster, "wall-plaster")
    report["tiles"]["wall-plaster"]["cell"] = [int(gx[0]), int(gy[0]), int(gx[1]), int(gy[1])]
# stone wall
stone = crossfade_tile(flatten_light(np.asarray(quadrant(im2, 2))))
report["tiles"]["stone-wall"] = save_tile(stone, "stone-wall")
# plank: windowless tile from the left strip of BR; window as its own unit
plq = np.asarray(quadrant(im2, 3, inset=4))
strip = plq[:, :int(plq.shape[1] * 0.40)]
plank = np.concatenate([strip, strip[:, ::-1]], axis=1)
plank = crossfade_tile(flatten_light(plank, strength=0.2))
report["tiles"]["plank"] = save_tile(plank, "plank")
win = plq[int(plq.shape[0] * 0.30):int(plq.shape[0] * 0.72), int(plq.shape[1] * 0.36):int(plq.shape[1] * 0.66)]
Image.fromarray(win).save(GROUND / "window-unit.png")

# ---------------- tiles: sheet-07 ash + lava flow ----------------
ash = crossfade_tile(flatten_light(np.asarray(quadrant(im7, 0)), strength=0.25))
report["tiles"]["ash"] = save_tile(ash, "ash")
lava_q = np.asarray(quadrant(im7, 1, inset=6)).astype(np.float32)
# deepen the crust, keep the core
lum_l = lava_q.mean(axis=2, keepdims=True)
crust = lum_l < 90
lava_q = np.where(crust, lava_q * 0.82, lava_q)
lava_alb = np.clip(lava_q, 0, 255).astype(np.uint8)
Image.fromarray(lava_alb).resize((1024, 1024), Image.LANCZOS).save(GROUND / "lava-flow.png")
R = lava_alb[:, :, 0].astype(float); G = lava_alb[:, :, 1].astype(float); B = lava_alb[:, :, 2].astype(float)
core = np.clip((R - B - 70) / 120, 0, 1) * np.clip((R - 110) / 110, 0, 1)
core = ndimage.gaussian_filter(core, 1.6)
emis = np.zeros_like(lava_alb)
emis[:, :, 0] = np.clip(core * 255, 0, 255)
emis[:, :, 1] = np.clip(core ** 1.6 * 165, 0, 255)
emis[:, :, 2] = np.clip(core ** 3.0 * 60, 0, 255)
Image.fromarray(emis).resize((512, 512), Image.LANCZOS).save(GROUND / "lava-flow-emissive.png")
report["tiles"]["lava-flow"] = {"core_coverage": round(float((core > 0.25).mean()), 3)}

# ---------------- QA composites ----------------
def magenta_sheet(paths, out, cols=4, cell=256):
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (255, 0, 255))
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGBA")
        im.thumbnail((cell - 8, cell - 8))
        sheet.paste(im, ((i % cols) * cell + 4, (i // cols) * cell + 4), im)
    sheet.save(out)

magenta_sheet(sorted(SPRAYS.glob("*.png")), ROOT / "qa-sprays-magenta.png")
magenta_sheet(sorted(PROPS.glob("*.png")), ROOT / "qa-props-magenta.png")
with open(ROOT / "process-report.json", "w") as f:
    json.dump(report, f, indent=1, ensure_ascii=False)
print("DONE", json.dumps({k: len(v) for k, v in report.items()}))
