#!/usr/bin/env python3
"""Process the 6 GPT environment sheets (round 21) into game
assets. Originals stay in ../source/; outputs land in ../ and
../moss, ../foam. Writes process-report.json with inspection
and seam metrics."""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'source')
REPORT = {}

def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGB')

def seam_ratio(a):
    """Mean |diff| across the wrap seam vs typical interior diff."""
    x = np.abs(a[:, 0].astype(int) - a[:, -1].astype(int)).mean()
    xi = np.abs(np.diff(a, axis=1).astype(int)).mean()
    y = np.abs(a[0, :].astype(int) - a[-1, :].astype(int)).mean()
    yi = np.abs(np.diff(a, axis=0).astype(int)).mean()
    return {'x': round(float(x / max(xi, 1e-6)), 2), 'y': round(float(y / max(yi, 1e-6)), 2)}

def crossfade(a, width, axis):
    """Force wrap-seamlessness: blend edge bands toward their
    mirrored counterparts with a smooth ramp, so the outermost
    rows/columns become identical and the transition inland is
    gradual. Works on RGB and RGBA float arrays."""
    a = a.copy()
    a = np.moveaxis(a, axis, 0)
    n = a.shape[0]
    for i in range(width):
        wl = (width - i) / width * 0.5
        li, ri = i, n - 1 - i
        l = a[li].copy()
        r = a[ri].copy()
        a[li] = l * (1 - wl) + r * wl
        a[ri] = r * (1 - wl) + l * wl
    return np.moveaxis(a, 0, axis)

def flatten_light(im, strength=0.35, blur=42):
    a = np.asarray(im).astype(np.float32)
    lum = a.mean(axis=2, keepdims=True)
    soft = np.asarray(Image.fromarray(
        np.clip(lum[:, :, 0], 0, 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(blur))).astype(np.float32)[:, :, None]
    ratio = (lum.mean() / np.maximum(soft, 1.0)) ** strength
    return Image.fromarray(np.clip(a * ratio, 0, 255).astype(np.uint8))

def black_to_alpha(im, lo=10, hi=110, gamma=0.9):
    """RGBA from a black-background image: alpha from luminance,
    colours un-premultiplied so no black fringe survives."""
    a = np.asarray(im).astype(np.float32)
    lum = a.max(axis=2)
    alpha = np.clip((lum - lo) / (hi - lo), 0, 1) ** gamma
    safe = np.clip(alpha, 0.16, 1.0)[:, :, None]
    rgb = np.clip(a / safe, 0, 255)
    rgb[alpha <= 0.001] = 0
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

def soft_alpha_rgba(im, alpha_u8):
    """Edge colours are EXTENDED from the patch interior (nearest
    fully-opaque pixel), so semi-transparent edge pixels carry
    pure moss colour instead of the white background blend that
    causes a pale halo."""
    a = np.asarray(im).astype(np.float32)
    solid = alpha_u8 >= 250
    if not solid.all():
        _, inds = ndimage.distance_transform_edt(~solid, return_indices=True)
        a = a[inds[0], inds[1]]
    a[alpha_u8 <= 2] = 0
    return Image.fromarray(np.dstack([a, alpha_u8]).astype(np.uint8), 'RGBA')

def components(mask, min_px):
    lab, n = ndimage.label(mask)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(xs) >= min_px:
            out.append({'id': i, 'px': len(xs), 'bbox': (xs.min(), ys.min(), xs.max(), ys.max()),
                        'cx': xs.mean(), 'cy': ys.mean()})
    return lab, out

def attach_satellites(lab, big, all_ids, pad=34):
    """Assign small component ids to the big component whose
    padded bbox contains their centroid."""
    owner = {b['id']: [] for b in big}
    cents = {}
    for i in all_ids:
        ys, xs = np.where(lab == i)
        cents[i] = (xs.mean(), ys.mean())
    for i in all_ids:
        if i in owner:
            continue
        cx, cy = cents[i]
        best, bd = None, 1e18
        for b in big:
            x0, y0, x1, y1 = b['bbox']
            if x0 - pad <= cx <= x1 + pad and y0 - pad <= cy <= y1 + pad:
                d = (cx - b['cx']) ** 2 + (cy - b['cy']) ** 2
                if d < bd:
                    best, bd = b['id'], d
        if best is not None:
            owner[best].append(i)
    return owner

# ----------------------------------------------------------------
# 1. cliff face
# ----------------------------------------------------------------
def do_cliff():
    im = load('sheet-01-cliff.jpg')
    src_size = im.size
    im = im.resize((1024, 1024), Image.LANCZOS)
    im = flatten_light(im, 0.35)
    a = np.asarray(im).astype(np.float32)
    before = seam_ratio(a[:, :, 0])
    a = crossfade(a, 110, 1)
    a = crossfade(a, 110, 0)
    after = seam_ratio(a[:, :, 0])
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    out.save(os.path.join(BASE, 'cliff-face.png'))
    # structure-only normal: low-frequency luminance, mild strength
    g = np.asarray(out.convert('L').filter(ImageFilter.GaussianBlur(5))).astype(np.float32)
    gx = ndimage.sobel(g, axis=1) / 255.0 * 1.15
    gy = ndimage.sobel(g, axis=0) / 255.0 * 1.15
    n = np.dstack([-gx, -gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    nrm = Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
    nrm.save(os.path.join(BASE, 'cliff-face_n.png'))
    prev = Image.new('RGB', (1024, 1024))
    tile = out.resize((256, 256), Image.LANCZOS)
    for i in range(4):
        for j in range(4):
            prev.paste(tile, (i * 256, j * 256))
    prev.save(os.path.join(BASE, 'cliff-face-preview4x4.png'))
    REPORT['cliff'] = {'source': src_size, 'bg': 'full-bleed', 'seamBefore': before,
                       'seamAfter': after, 'scale': '1024px = 2 m; strata 20-40 cm'}

# ----------------------------------------------------------------
# 2. scree ground (3x3 flip mosaic halves the rock scale twice)
# ----------------------------------------------------------------
def do_scree():
    im = load('sheet-02-scree.jpg').resize((1024, 1024), Image.LANCZOS)
    cell = im.resize((342, 342), Image.LANCZOS)
    flips = [[0, 1, 0], [2, 3, 2], [0, 1, 0]]
    mosaic = Image.new('RGB', (1026, 1026))
    for r in range(3):
        for c in range(3):
            t = cell
            if flips[r][c] & 1:
                t = t.transpose(Image.FLIP_LEFT_RIGHT)
            if flips[r][c] & 2:
                t = t.transpose(Image.FLIP_TOP_BOTTOM)
            mosaic.paste(t, (c * 342, r * 342))
    mosaic = mosaic.crop((0, 0, 1024, 1024))
    a = np.asarray(mosaic).astype(np.float32)
    before = seam_ratio(a[:, :, 0])
    a = crossfade(a, 90, 1)
    a = crossfade(a, 90, 0)
    after = seam_ratio(a[:, :, 0])
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    out.save(os.path.join(BASE, 'ground-scree.png'))
    prev = Image.new('RGB', (1024, 1024))
    tile = out.resize((256, 256), Image.LANCZOS)
    for i in range(4):
        for j in range(4):
            prev.paste(tile, (i * 256, j * 256))
    prev.save(os.path.join(BASE, 'ground-scree-preview4x4.png'))
    REPORT['scree'] = {'source': (1206, 1206), 'seamBefore': before, 'seamAfter': after,
                       'scale': 'tile 6 m; 3x3 mosaic -> pattern cell 2 m; drawn rocks ~5-33 cm'}

# ----------------------------------------------------------------
# 3. moss patches
# ----------------------------------------------------------------
def do_moss():
    im = load('sheet-03-moss.jpg')
    a = np.asarray(im).astype(np.int16)
    sat = a.max(axis=2) - a.min(axis=2)
    mask = (a.min(axis=2) < 242) | (sat > 26)
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    big = []
    for i, s in enumerate(sizes, start=1):
        if s >= 4000:
            ys, xs = np.where(lab == i)
            big.append({'id': i, 'px': int(s), 'bbox': (xs.min(), ys.min(), xs.max(), ys.max()),
                        'cx': xs.mean(), 'cy': ys.mean()})
    big.sort(key=lambda b: (round(b['cy'] / 400), b['cx']))
    owner = attach_satellites(lab, big, list(range(1, n + 1)))
    os.makedirs(os.path.join(BASE, 'moss'), exist_ok=True)
    infos = []
    full = np.asarray(im).astype(np.float32)
    for k, b in enumerate(big, start=1):
        keep = np.isin(lab, [b['id']] + owner[b['id']])
        # White-unmix alpha: coverage estimated per pixel against
        # the patch's own interior colours (extended from an
        # eroded core), so pale bg-blended edge pixels get partial
        # alpha AND pure moss colour — no white halo.
        core = ndimage.binary_erosion(keep, iterations=3)
        if not core.any():
            core = keep
        _, inds = ndimage.distance_transform_edt(~core, return_indices=True)
        fg = full[inds[0], inds[1]]
        t = ((254.0 - full) / np.clip(254.0 - fg, 25, None)).max(axis=2)
        alpha = np.clip(t, 0, 1)
        alpha[~keep & (alpha < 0.35)] *= 0.4  # suppress JPEG bleed outside
        alpha = np.asarray(Image.fromarray(
            (alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)))
        x0, y0, x1, y1 = b['bbox']
        pad = 12
        x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
        x1, y1 = min(im.width - 1, x1 + pad), min(im.height - 1, y1 + pad)
        acrop = alpha[y0:y1 + 1, x0:x1 + 1]
        fgcrop = fg[y0:y1 + 1, x0:x1 + 1].copy()
        fgcrop[acrop <= 2] = 0
        out = Image.fromarray(np.dstack([fgcrop, acrop]).astype(np.uint8), 'RGBA')
        out.save(os.path.join(BASE, 'moss', f'moss-{k}.png'))
        infos.append({'id': f'moss-{k}', 'size': out.size, 'px': b['px']})
    # QA composites: all patches on dark slate and on magenta
    for bgname, bgcol in [('dark', (58, 62, 58)), ('magenta', (255, 0, 255))]:
        qa = Image.new('RGB', (1020, 700), bgcol)
        for k in range(1, len(big) + 1):
            p = Image.open(os.path.join(BASE, 'moss', f'moss-{k}.png'))
            p.thumbnail((330, 330))
            qa.paste(p, ((k - 1) % 3 * 340 + 5, (k - 1) // 3 * 350 + 5), p)
        qa.save(os.path.join(BASE, f'qa-moss-{bgname}.png'))
    REPORT['moss'] = {'source': im.size, 'bgCorner': 254, 'patches': infos}

# ----------------------------------------------------------------
# 4. waterfall streaks
# ----------------------------------------------------------------
def do_streaks():
    im = load('sheet-04-streaks.jpg').resize((1024, 1024), Image.LANCZOS)
    out = black_to_alpha(im, lo=10, hi=115, gamma=0.9)
    a = np.asarray(out).astype(np.float32)
    a = crossfade(a, 110, 0)  # vertical wrap only; x edges are transparent
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    out.save(os.path.join(BASE, 'waterfall-streaks.png'))
    # 3-high stack on dark slate for the seam check
    stack = Image.new('RGB', (512, 768), (38, 48, 56))
    t = out.resize((256, 256), Image.LANCZOS)
    for j in range(3):
        stack.paste(t, (128, j * 256), t)
    stack.save(os.path.join(BASE, 'waterfall-streaks-stack3.png'))
    edge_alpha = np.asarray(out)[:, :, 3]
    REPORT['streaks'] = {'source': (1206, 1206), 'bgCorner': 0,
                         'leftEdgeAlphaMean': round(float(edge_alpha[:, :6].mean()), 1),
                         'rightEdgeAlphaMean': round(float(edge_alpha[:, -6:].mean()), 1),
                         'coverage': round(float((edge_alpha > 8).mean()), 3)}

# ----------------------------------------------------------------
# 5. foam clusters + rings
# ----------------------------------------------------------------
def do_foam():
    im = load('sheet-05-foam.jpg')
    a = np.asarray(im).astype(np.float32)
    lum = a.max(axis=2)
    mask = lum > 14
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    big = []
    for i, s in enumerate(sizes, start=1):
        if s >= 6000:
            ys, xs = np.where(lab == i)
            big.append({'id': i, 'px': int(s), 'bbox': (xs.min(), ys.min(), xs.max(), ys.max()),
                        'cx': xs.mean(), 'cy': ys.mean()})
    owner = attach_satellites(lab, big, list(range(1, n + 1)), pad=30)
    os.makedirs(os.path.join(BASE, 'foam'), exist_ok=True)
    alpha_full = np.clip((lum - 8) / 70 * 255, 0, 255)
    alpha_full = np.asarray(Image.fromarray(alpha_full.astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.8)))
    infos = []
    clusters, rings = [], []
    for b in big:
        keep = np.isin(lab, [b['id']] + owner[b['id']])
        x0, y0, x1, y1 = b['bbox']
        pad = 14
        x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
        x1, y1 = min(im.width - 1, x1 + pad), min(im.height - 1, y1 + pad)
        acrop = np.where(keep, alpha_full, 0)[y0:y1 + 1, x0:x1 + 1].astype(np.uint8)
        # ring test: centre of the crop is transparent
        ch, cw = acrop.shape[0] // 2, acrop.shape[1] // 2
        centre_hole = acrop[ch - 8:ch + 8, cw - 8:cw + 8].mean() < 24
        aspect = acrop.shape[1] / max(acrop.shape[0], 1)
        centre_hole = centre_hole and 0.7 < aspect < 1.4
        crop = im.crop((x0, y0, x1 + 1, y1 + 1))
        out = Image.fromarray(np.dstack([np.asarray(crop), acrop]).astype(np.uint8), 'RGBA')
        (rings if centre_hole else clusters).append((out, b))
    for k, (out, b) in enumerate(sorted(clusters, key=lambda t: (round(t[1]['cy'] / 300), t[1]['cx'])), start=1):
        out.save(os.path.join(BASE, 'foam', f'foam-cluster-{k}.png'))
        infos.append({'id': f'foam-cluster-{k}', 'size': out.size})
    for k, (out, b) in enumerate(sorted(rings, key=lambda t: t[1]['cx']), start=1):
        out.save(os.path.join(BASE, 'foam', f'foam-ring-{k}.png'))
        infos.append({'id': f'foam-ring-{k}', 'size': out.size})
    qa = Image.new('RGB', (1020, 700), (47, 110, 140))
    files = [f'foam-cluster-{i}' for i in range(1, len(clusters) + 1)] + \
            [f'foam-ring-{i}' for i in range(1, len(rings) + 1)]
    for k, f in enumerate(files):
        p = Image.open(os.path.join(BASE, 'foam', f + '.png'))
        p.thumbnail((330, 330))
        qa.paste(p, (k % 3 * 340 + 5, k // 3 * 350 + 5), p)
    qa.save(os.path.join(BASE, 'qa-foam-blue.png'))
    REPORT['foam'] = {'source': im.size, 'bgCorner': 0, 'items': infos}

# ----------------------------------------------------------------
# 6. shore foam strip -> 1024x256 without distorting bubbles
# ----------------------------------------------------------------
def do_shore():
    im = load('sheet-06-shore-foam.jpg')
    src = im.size
    crop_h = round(im.width / 4)  # 302 rows = 4:1 from the bottom band
    im = im.crop((0, im.height - crop_h, im.width, im.height))
    im = im.resize((1024, 256), Image.LANCZOS)
    out = black_to_alpha(im, lo=8, hi=100, gamma=0.9)
    a = np.asarray(out).astype(np.float32)
    before = seam_ratio(a[:, :, 3])
    a = crossfade(a, 72, 1)
    after = seam_ratio(a[:, :, 3])
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    out.save(os.path.join(BASE, 'shore-foam.png'))
    prev = Image.new('RGB', (1024, 256), (47, 110, 140))
    for i in range(4):
        t = out.resize((256, 64), Image.LANCZOS)
        prev.paste(t, (i * 256, 96), t)
    prev.save(os.path.join(BASE, 'shore-foam-preview4x.png'))
    alpha = np.asarray(out)[:, :, 3]
    REPORT['shore'] = {'source': src, 'crop': f'bottom {crop_h} rows (4:1, uniform scale only)',
                       'topCoverage': round(float((alpha[:102] > 8).mean()), 4),
                       'seamBefore': before, 'seamAfter': after}

do_cliff()
do_scree()
do_moss()
do_streaks()
do_foam()
do_shore()
with open(os.path.join(BASE, 'process-report.json'), 'w') as f:
    json.dump(REPORT, f, indent=1, ensure_ascii=False, default=str)
print(json.dumps(REPORT, indent=1, ensure_ascii=False, default=str)[:1600])
print('PROCESS ENV DONE')
