#!/usr/bin/env python3
"""
Process the GPT icon sheets for buildings/tools/facilities/ops into
individual transparent PNGs keyed by the game's data.js IDs.

Sheets (in ../source/):
  tool-icons.jpg       4x5  -> tools (data.js T() ids)
  facility-icons.jpg   4x5  -> facilities (data.js F() ids; last row 3)
  op-icons-1.jpg       4x3  -> ops part 1 (data.js ops keys)
  op-icons-2.jpg       4x3  -> ops part 2 (last row 3)
  op-icons-revised.jpg 2x1  -> grind / cool (owner: these REPLACE the
                               mortar / plain-bowl versions in sheet 1)
  buildings-1.jpg      4x2  -> only used for the facility "bench" icon:
                               the facility sheet's workbench carries
                               modern tools (saw / plane / vise) that do
                               not fit the primitive starting era, so the
                               bench icon is taken from the building
                               sheet's workbench (stone tools, rope,
                               baskets) instead.

Method (same family as assets/item-icons):
  - background = near-white connected to the sheet border (flood fill),
    so enclosed whites inside glassware survive;
  - pale low-saturation fringe pixels next to the new alpha edge are
    recoloured from the nearest clean interior pixel (despill);
  - each grid cell is cut by its own alpha bbox (never a blind slice
    of the whole sheet into the output), centred on a square canvas
    with margin; masters at 256px, plus a 128px version;
  - alpha is binarised to {0,255} so no semi-transparent haze remains.

Outputs:
  ../icons/<cat>/<id>.png      256px masters
  ../icons128/<cat>/<id>.png   128px versions
  ../atlas.png / ../atlas.json combined atlas (256px cells, 8 cols)
  ../previews/contact-{32,48,64}-{light,dark}.png
  ../process-log.json
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

# ---------------------------------------------------------------- sheets
# (file, cols, rows, category, ids row-major; None = empty cell)
SHEETS = [
    ("tool-icons.jpg", 4, 5, "tools", [
        "pot", "crucible", "knife", "axe",
        "hammer", "pickaxe", "firedrill", "torch",
        "candle", "basket", "notebook", "ironpick",
        "ironaxe", "balance", "thermometer", "bottle",
        "bellows", "battery", "cylinder", "rig",
    ]),
    ("facility-icons.jpg", 4, 5, "facilities", [
        "bench", "campfire", "rack", "filter",
        "mill", "kiln", "charkiln", "fermenter",
        "furnace", "still", "storehouse", "electrolyzer",
        "waterwheel", "generator", "blastfurnace", "steamengine",
        "refinery", "reactor", "eaf", None,
    ]),
    ("op-icons-1.jpg", 4, 3, "ops", [
        "crush", "grind_old", "mix", "wash",
        "filter", "settle", "heat", "cool_old",
        "evaporate", "crystallize", "dry", "dissolve",
    ]),
    ("op-icons-2.jpg", 4, 3, "ops", [
        "burn", "fire", "char", "shape",
        "smelt", "melt", "ferment", "distill",
        "electrolyze", "crack", "polymerize", None,
    ]),
    ("op-icons-revised.jpg", 2, 1, "ops", [
        "grind", "cool",
    ]),
]

NAMES = {
    # tools (data.js)
    "pot": "土器", "crucible": "るつぼ", "knife": "石のナイフ", "axe": "石のおの",
    "hammer": "石のハンマー", "pickaxe": "石のつるはし", "firedrill": "火おこし棒",
    "torch": "たいまつ", "candle": "ろうそく", "basket": "採集かご",
    "notebook": "研究ノート", "ironpick": "鉄のつるはし", "ironaxe": "鉄のおの",
    "balance": "てんびん", "thermometer": "温度計", "bottle": "ガラスのびん",
    "bellows": "ふいご", "battery": "ボルタ電池", "cylinder": "鋼のボンベ",
    "rig": "掘削やぐら",
    # facilities (data.js)
    "bench": "作業台", "campfire": "たき火", "rack": "乾燥台", "filter": "ろ過器",
    "mill": "石臼", "kiln": "かまど", "charkiln": "炭焼き窯", "fermenter": "発酵つぼ",
    "furnace": "簡易炉", "still": "蒸留器", "storehouse": "倉庫",
    "electrolyzer": "電気分解装置", "waterwheel": "水車", "generator": "水力発電機",
    "blastfurnace": "高炉", "steamengine": "蒸気機関", "refinery": "精留塔",
    "reactor": "化学反応装置", "eaf": "電気炉",
    # ops (data.js)
    "crush": "破砕", "grind": "粉砕", "mix": "混合", "wash": "水洗",
    "settle": "沈降", "heat": "加熱", "cool": "冷却", "evaporate": "蒸発",
    "crystallize": "結晶化", "dry": "乾燥", "dissolve": "溶解", "burn": "燃焼",
    "fire": "焼成", "char": "炭化", "shape": "成形", "smelt": "製錬",
    "melt": "溶融", "ferment": "発酵", "distill": "蒸留",
    "electrolyze": "電気分解", "crack": "熱分解", "polymerize": "重合",
}


def flood_background(rgb: np.ndarray, thresh: int = 238) -> np.ndarray:
    """Boolean mask of background pixels: near-white AND reachable from
    the border through near-white pixels."""
    near_white = rgb.min(axis=2) >= thresh
    h, w = near_white.shape
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))
    return bg


def despill(rgb: np.ndarray, alpha: np.ndarray) -> int:
    """Recolour pale, low-saturation pixels that touch the transparent
    edge (JPG haze / colour bleed) from the nearest clean interior
    pixel. Returns how many pixels were fixed."""
    opaque = alpha > 0
    if not opaque.any():
        return 0
    mx = rgb.max(axis=2).astype(int)
    mn = rgb.min(axis=2).astype(int)
    pale = opaque & (mn > 185) & ((mx - mn) < 48)
    near_edge = pale & ndimage.binary_dilation(~opaque, iterations=2)
    clean = opaque & ~pale
    if not clean.any() or not near_edge.any():
        return 0
    _, inds = ndimage.distance_transform_edt(~clean, return_indices=True)
    fixed = rgb.copy()
    ys, xs = np.where(near_edge)
    fixed[ys, xs] = rgb[inds[0][ys, xs], inds[1][ys, xs]]
    rgb[:] = fixed
    return int(len(ys))


def cut_sheet(fname, cols, rows):
    """Return {(row, col): RGBA PIL image cropped to the cell content}."""
    im = Image.open(SRC / fname).convert("RGB")
    rgb = np.asarray(im).astype(np.uint8)
    bg = flood_background(rgb)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    n_fixed = despill(rgb, alpha)
    rgba = np.dstack([rgb, alpha])
    img = Image.fromarray(rgba, "RGBA")
    W, H = im.size
    out = {}
    for r in range(rows):
        for c in range(cols):
            x0 = round(c * W / cols)
            x1 = round((c + 1) * W / cols)
            y0 = round(r * H / rows)
            y1 = round((r + 1) * H / rows)
            cell_alpha = alpha[y0:y1, x0:x1]
            ys, xs = np.where(cell_alpha > 0)
            if len(ys) == 0:
                out[(r, c)] = None
                continue
            pad = 3
            bx0 = max(0, xs.min() - pad)
            bx1 = min(x1 - x0, xs.max() + 1 + pad)
            by0 = max(0, ys.min() - pad)
            by1 = min(y1 - y0, ys.max() + 1 + pad)
            out[(r, c)] = img.crop((x0 + bx0, y0 + by0, x0 + bx1, y0 + by1))
    return out, n_fixed


def cream_cut(fname, cols, rows, want):
    """Cut one cell from a cream-background building sheet by colour
    distance to the corner-sampled background, flood-filled."""
    im = Image.open(SRC / fname).convert("RGB")
    rgb = np.asarray(im).astype(int)
    corners = np.concatenate([
        rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3),
        rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
    bgc = corners.mean(axis=0)
    dist = np.abs(rgb - bgc).max(axis=2)
    near_bg = dist < 30
    h, w = near_bg.shape
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_bg[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_bg[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near_bg[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    rgba = np.dstack([np.asarray(im), alpha])
    img = Image.fromarray(rgba, "RGBA")
    r, c = want
    x0 = round(c * w / cols)
    x1 = round((c + 1) * w / cols)
    y0 = round(r * h / rows)
    y1 = round((r + 1) * h / rows)
    cell_alpha = alpha[y0:y1, x0:x1]
    ys, xs = np.where(cell_alpha > 0)
    pad = 3
    return img.crop((x0 + max(0, xs.min() - pad), y0 + max(0, ys.min() - pad),
                      x0 + min(x1 - x0, xs.max() + 1 + pad),
                      y0 + min(y1 - y0, ys.max() + 1 + pad)))


def binarize_alpha(img: Image.Image) -> Image.Image:
    """Snap alpha to {0,255} (threshold 128) so no semi-transparent
    haze survives the resize — the sheets are pixel art and the game
    renders these at 32-64px where soft alpha reads as dirt."""
    arr = np.asarray(img).copy()
    arr[:, :, 3] = np.where(arr[:, :, 3] >= 128, 255, 0)
    return Image.fromarray(arr, "RGBA")


def place_on_canvas(cut: Image.Image, size: int, fill: int = 208) -> Image.Image:
    """Centre the cut on a transparent square canvas; long side = fill."""
    w, h = cut.size
    scale = fill / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = cut.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return binarize_alpha(canvas)


def main():
    log = {"sheets": {}, "icons": []}
    masters = {}  # (category, id) -> 256px PIL

    for fname, cols, rows, cat, ids in SHEETS:
        cuts, n_fixed = cut_sheet(fname, cols, rows)
        log["sheets"][fname] = {"despill_px": n_fixed}
        for idx, icon_id in enumerate(ids):
            if icon_id is None:
                continue
            r, c = divmod(idx, cols)
            cut = cuts[(r, c)]
            assert cut is not None, f"{fname} cell {icon_id} empty"
            if icon_id.endswith("_old"):
                # superseded by the revised sheet; kept out of the set
                log["icons"].append({"id": icon_id, "sheet": fname,
                                     "status": "superseded-by-revised"})
                continue
            masters[(cat, icon_id)] = place_on_canvas(cut, 256)
            log["icons"].append({"id": icon_id, "category": cat, "sheet": fname,
                                 "cell": [r, c], "status": "ok"})

    # --- bench fix: facility sheet workbench has modern tools; use the
    # building sheet's primitive workbench instead.
    bench_cut = cream_cut("buildings-1.jpg", 4, 2, (0, 0))
    masters[("facilities", "bench")] = place_on_canvas(bench_cut, 256)
    for e in log["icons"]:
        if e["id"] == "bench":
            e["status"] = "replaced: buildings-1 workbench (stone tools); " \
                          "facility-sheet version had modern saw/plane/vise"

    # --- write masters + 128px versions
    for (cat, icon_id), img in sorted(masters.items()):
        img.save(ROOT / "icons" / cat / f"{icon_id}.png")
        binarize_alpha(img.resize((128, 128), Image.LANCZOS)).save(
            ROOT / "icons128" / cat / f"{icon_id}.png")

    # --- combined atlas (256px cells, 8 columns, order: tools,
    # facilities, ops — each in data.js order as listed above)
    OPS_ORDER = ["crush", "grind", "mix", "wash", "filter", "settle",
                 "heat", "cool", "evaporate", "crystallize", "dry",
                 "dissolve", "burn", "fire", "char", "shape", "smelt",
                 "melt", "ferment", "distill", "electrolyze", "crack",
                 "polymerize"]
    CAT_IDS = {
        "tools": SHEETS[0][4],
        "facilities": [i for i in SHEETS[1][4] if i],
        "ops": OPS_ORDER,
    }
    order = []
    for cat in ("tools", "facilities", "ops"):
        for icon_id in CAT_IDS[cat]:
            if (cat, icon_id) in masters:
                order.append((cat, icon_id))
    assert len(order) == len(masters), (len(order), len(masters))
    cell, acol = 256, 8
    arows = (len(order) + acol - 1) // acol
    atlas = Image.new("RGBA", (acol * cell, arows * cell), (0, 0, 0, 0))
    manifest = {"cell": cell, "columns": acol, "entries": {}}
    for i, (cat, icon_id) in enumerate(order):
        x = (i % acol) * cell
        y = (i // acol) * cell
        atlas.paste(masters[(cat, icon_id)], (x, y))
        manifest["entries"][icon_id] = {
            "category": cat, "name": NAMES[icon_id],
            "x": x, "y": y, "w": cell, "h": cell,
            "file": f"icons/{cat}/{icon_id}.png",
            "file128": f"icons128/{cat}/{icon_id}.png",
        }
    atlas.save(ROOT / "atlas.png")
    (ROOT / "atlas.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- contact previews at real display sizes, light + dark
    for size in (32, 48, 64):
        for bg_name, bg_col in (("light", (245, 242, 234, 255)),
                                ("dark", (38, 41, 48, 255))):
            cols_p = 8
            rows_p = (len(order) + cols_p - 1) // cols_p
            sheet = Image.new("RGBA", (cols_p * size, rows_p * size), bg_col)
            for i, key in enumerate(order):
                small = masters[key].resize((size, size), Image.NEAREST)
                sheet.paste(small, ((i % cols_p) * size, (i // cols_p) * size),
                            small)
            sheet.convert("RGB").save(
                ROOT / "previews" / f"contact-{size}-{bg_name}.png")

    (ROOT / "process-log.json").write_text(
        json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"icons: {len(masters)}  atlas entries: {len(order)}")
    cats = {}
    for cat, _ in masters:
        cats[cat] = cats.get(cat, 0) + 1
    print(cats)


if __name__ == "__main__":
    main()
