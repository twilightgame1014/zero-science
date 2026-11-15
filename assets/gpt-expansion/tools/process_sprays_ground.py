#!/usr/bin/env python3
"""Process GPT expansion sheets 01/02/06 (sprays, cutout) and 03/04/05
(ground textures + lava). Cutout method = the proven icons pipeline:
border flood fill + rembg isnet-general-use gate + despill, alpha
binarised. Snow sheet uses a segmentation-union mode so white snow
on a white background survives. Ground: quadrant crops, baked-light
flattening, half-roll crossfade tiling, seam metric, 2x2 previews.
Lava: albedo (cracks deepened) + emissive mask from the orange cracks.
"""
import json, sys
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "source"

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
    else:  # seg-union: keep confident segmentation foreground even where
        # the flood fill reached it (snow on white)
        union = (alpha > 0) | (seg >= 128)
        alpha = np.where(union, 255, 0).astype(np.uint8)
        stats = {"seg_union_added_px": int(((alpha > 0) & bg).sum())}
    n = despill(rgb, alpha)
    stats["despill_px"] = n
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA"), stats

def cut_quadrants(img, names, outdir, size=512, pad_frac=0.06):
    W, H = img.size
    results = {}
    for i, name in enumerate(names):
        r, c = divmod(i, 2)
        x0, x1 = round(c * W / 2), round((c + 1) * W / 2)
        y0, y1 = round(r * H / 2), round((r + 1) * H / 2)
        cell = img.crop((x0, y0, x1, y1))
        a = np.asarray(cell)[:, :, 3]
        ys, xs = np.where(a > 0)
        if len(ys) == 0:
            results[name] = "EMPTY"; continue
        pad = 4
        bx0, bx1 = max(0, xs.min() - pad), min(cell.width, xs.max() + 1 + pad)
        by0, by1 = max(0, ys.min() - pad), min(cell.height, ys.max() + 1 + pad)
        cut = cell.crop((bx0, by0, bx1, by1))
        # normalise onto a square canvas at `size` with transparent margin
        scale = (size * (1 - 2 * pad_frac)) / max(cut.width, cut.height)
        nw, nh = max(1, round(cut.width * scale)), max(1, round(cut.height * scale))
        cut = cut.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(cut, ((size - nw) // 2, (size - nh) // 2), cut)
        canvas.save(outdir / f"{name}.png")
        results[name] = {"bbox": [int(bx0), int(by0), int(bx1), int(by1)], "px": int((a > 0).sum())}
    return results

# ---------------- sprays ----------------
SPRAYS = [
    ("sheet-01-conifer-sprays.jpg", "gate", ["conifer-cedar", "conifer-pine", "conifer-young", "conifer-tip"]),
    ("sheet-02-snow-sprays.jpg", "seg-union", ["snow-conifer", "snow-broadleaf", "snow-shrub", "snow-icicle"]),
    ("sheet-06-shore-plants.jpg", "gate", ["reed", "lily", "dry-shrub", "palm-frond"]),
]
report = {"sprays": {}}
for fname, mode, names in SPRAYS:
    img, stats = sheet_alpha(fname, mode)
    res = cut_quadrants(img, names, ROOT / "sprays")
    report["sprays"][fname] = {"mode": mode, **stats, "items": res}
    print(fname, mode, {k: (v if isinstance(v, str) else v["px"]) for k, v in res.items()})

# ---------------- ground ----------------
def flatten_light(rgb, strength=0.3, blur=42):
    lum = rgb.mean(axis=2, keepdims=True)
    low = ndimage.gaussian_filter(lum, blur)
    target = low.mean()
    adj = np.clip(rgb * (1 - strength) + rgb * (target / np.maximum(low, 1)) * strength, 0, 255)
    return adj.astype(np.uint8)

def crossfade_tile(rgb):
    h, w, _ = rgb.shape
    rolled = np.roll(rgb, (h // 2, w // 2), axis=(0, 1)).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    wx = np.clip(1 - np.abs(xx - w / 2) / (w * 0.28), 0, 1) ** 2
    wy = np.clip(1 - np.abs(yy - h / 2) / (h * 0.28), 0, 1) ** 2
    wgt = np.maximum(wx, wy)[..., None]
    out = rgb.astype(np.float32) * (1 - wgt * 0.5) + rolled * (wgt * 0.5)
    return np.clip(out, 0, 255).astype(np.uint8)

def seam_ratio(rgb):
    a = rgb.astype(np.float32)
    ex = np.abs(a[:, 0] - a[:, -1]).mean()
    ey = np.abs(a[0, :] - a[-1, :]).mean()
    ix = np.abs(np.diff(a, axis=1)).mean()
    iy = np.abs(np.diff(a, axis=0)).mean()
    return round(float(max(ex / ix, ey / iy)), 2)

def ground_sheet(fname, names, inset=14, size=512):
    im = Image.open(SRC / fname).convert("RGB")
    W, H = im.size
    out = {}
    for i, name in enumerate(names):
        r, c = divmod(i, 2)
        x0 = round(c * W / 2) + inset; x1 = round((c + 1) * W / 2) - inset
        y0 = round(r * H / 2) + inset; y1 = round((r + 1) * H / 2) - inset
        crop = np.asarray(im.crop((x0, y0, x1, y1))).astype(np.uint8)
        crop = flatten_light(crop)
        crop = crossfade_tile(crop)
        img = Image.fromarray(crop).resize((size, size), Image.LANCZOS)
        img.save(ROOT / "ground" / f"{name}.png")
        tiled = Image.new("RGB", (size, size))
        q = img.resize((size // 2, size // 2))
        for yy in (0, size // 2):
            for xx in (0, size // 2):
                tiled.paste(q, (xx, yy))
        tiled.save(ROOT / "previews" / f"tiling-{name}.png")
        out[name] = {"seam_ratio": seam_ratio(np.asarray(img))}
    return out

report["ground"] = {}
report["ground"].update(ground_sheet("sheet-03-ground-a.jpg",
    ["ground-forest", "ground-mud", "ground-sand-dry", "ground-sand-wet"]))
report["ground"].update(ground_sheet("sheet-04-ground-b.jpg",
    ["ground-volcanic", "ground-snow-raw", "ground-desert", "ground-path"]))

# snow: patch out the paw prints -> ground-snow-clean
src = Image.open(ROOT / "ground" / "ground-snow-raw.png").convert("RGB")
a = np.asarray(src).astype(np.float32)
# prints: slightly darker + bluer than the surrounding snow, small blobs
blueness = a[:, :, 2] - a[:, :, 0]
dark = a.mean(axis=2)
cand = (blueness > 4) & (dark < 238)
lab, n = ndimage.label(cand)
objs = ndimage.find_objects(lab)
mask = np.zeros(cand.shape, bool)
kept = 0
for i, sl in enumerate(objs, 1):
    if sl is None: continue
    area = int((lab[sl] == i).sum())
    hh = sl[0].stop - sl[0].start; ww = sl[1].stop - sl[1].start
    if 40 <= area <= 2600 and hh < 46 and ww < 46:
        mask[sl] |= (lab[sl] == i); kept += 1
mask = ndimage.binary_dilation(mask, iterations=3)
filled = a.copy()
# diffusion inpaint
work = a.copy()
known = ~mask
for _ in range(300):
    avg = sum(np.roll(work, s, axis=ax) for ax, s in ((0, 1), (0, -1), (1, 1), (1, -1))) / 4
    work[mask] = avg[mask]
    work[known] = a[known]
rng = np.random.default_rng(7)
noise = rng.normal(0, 2.2, work.shape[:2])[..., None]
out = np.clip(work + noise * mask[..., None], 0, 255).astype(np.uint8)
Image.fromarray(out).save(ROOT / "ground" / "ground-snow-clean.png")
tiled = Image.new("RGB", (512, 512)); q = Image.fromarray(out).resize((256, 256))
for yy in (0, 256):
    for xx in (0, 256): tiled.paste(q, (xx, yy))
tiled.save(ROOT / "previews" / "tiling-ground-snow-clean.png")
report["ground"]["ground-snow-clean"] = {"prints_patched": kept, "seam_ratio": seam_ratio(out)}
print("snow prints patched:", kept)

# path-plain: soften the wheel ruts by blending a blurred copy
p = np.asarray(Image.open(ROOT / "ground" / "ground-path.png").convert("RGB")).astype(np.float32)
blur = ndimage.gaussian_filter(p, (2.2, 2.2, 0))
plain = np.clip(p * 0.45 + blur * 0.55, 0, 255).astype(np.uint8)
Image.fromarray(plain).save(ROOT / "ground" / "ground-path-plain.png")
report["ground"]["ground-path-plain"] = {"note": "ruts softened 55% blur blend"}

# ---------------- lava ----------------
im = Image.open(SRC / "sheet-05-lava.jpg").convert("RGB").resize((1024, 1024), Image.LANCZOS)
a = np.asarray(im).astype(np.float32)
crack = np.clip((a[:, :, 0] - a[:, :, 2] - 40) / 140, 0, 1) * np.clip((a[:, :, 0] - 70) / 120, 0, 1)
crack_s = ndimage.gaussian_filter(crack, 1.1)
albedo = a.copy()
albedo = albedo * (1 - crack_s[..., None] * 0.55)  # deepen cracks in albedo
albedo = crossfade_tile(flatten_light(albedo.astype(np.uint8), 0.2))
Image.fromarray(albedo).save(ROOT / "ground" / "lava-albedo.png")
mask = np.clip(crack_s ** 1.4 * 255, 0, 255).astype(np.uint8)
mask_img = Image.fromarray(mask).resize((512, 512), Image.LANCZOS)
mask_img.save(ROOT / "ground" / "lava-emissive.png")
Image.fromarray(albedo).resize((512, 512)).save(ROOT / "previews" / "lava-albedo-512.png")
report["lava"] = {"crack_coverage_pct": round(float((crack_s > 0.25).mean() * 100), 1)}
print("lava crack coverage %:", report["lava"]["crack_coverage_pct"])

(ROOT / "process-report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
print("DONE")
