#!/usr/bin/env python3
"""Normalise the three GPT NPC sheets (4 cols x 4 rows) into the
module's sprite-sheet contract: 1024x1024 sheet of 256px cells,
feet baseline 29px above the cell bottom (SPRITE_BOTTOM_INSET
0.113), one uniform scale per character (median frame height ->
205px, matching the protagonists' ~78% visible height), per-frame
horizontal centring. Cutout = flood + seg gate + despill, alpha
binarised. Also emits individual frames and walk-cycle GIFs."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

src = open(Path(__file__).parent / "process_sprays_ground.py").read()
head = src.split("# ---------------- sprays ----------------")[0]
g = {"__file__": str((Path(__file__).parent / "process_sprays_ground.py").resolve())}
exec(head, g)
flood_background, despill, seg_alpha = g["flood_background"], g["despill"], g["seg_alpha"]

ROOT = Path(__file__).resolve().parent.parent
CELL = 256
BASELINE = CELL - 29  # feet y (bottom of the character bbox)
TARGET_H = 205

NPCS = [("sheet-08-npc-guide.jpg", "guide"), ("sheet-09-npc-resident.jpg", "resident"),
        ("sheet-10-npc-craftsman.jpg", "craftsman")]
report = {}
for fname, name in NPCS:
    im = Image.open(ROOT / "source" / fname).convert("RGB")
    rgb = np.asarray(im).astype(np.uint8)
    bg = flood_background(rgb)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    seg = seg_alpha(fname)
    gated = (alpha > 0) & (seg < 32)
    alpha = np.where(gated, 0, alpha).astype(np.uint8)
    despill(rgb, alpha)
    rgba = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    W, H = im.size
    cells = {}
    heights = []
    for r in range(4):
        for c in range(4):
            x0, x1 = round(c * W / 4), round((c + 1) * W / 4)
            y0, y1 = round(r * H / 4), round((r + 1) * H / 4)
            cell = rgba.crop((x0, y0, x1, y1))
            a = np.asarray(cell)[:, :, 3]
            ys, xs = np.where(a > 0)
            if len(ys) == 0:
                cells[(r, c)] = None; continue
            cut = cell.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            cells[(r, c)] = cut
            heights.append(cut.height)
    med = float(np.median(heights))
    scale = TARGET_H / med
    sheet = Image.new("RGBA", (CELL * 4, CELL * 4), (0, 0, 0, 0))
    outdir = ROOT / "npc" / name
    outdir.mkdir(parents=True, exist_ok=True)
    legdiff = {}
    for (r, c), cut in cells.items():
        if cut is None: continue
        nw, nh = max(1, round(cut.width * scale)), max(1, round(cut.height * scale))
        cut = cut.resize((nw, nh), Image.LANCZOS)
        frame = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        frame.paste(cut, ((CELL - nw) // 2, BASELINE - nh), cut)
        sheet.paste(frame, (c * CELL, r * CELL))
        frame.save(outdir / f"frame-r{r}c{c}.png")
    sheet.save(ROOT / "npc" / f"{name}.png")
    # walk alternation check: lower-third alpha diff between stride frames
    def lowthird(rc):
        f = Image.open(outdir / f"frame-r{rc[0]}c{rc[1]}.png")
        a = np.asarray(f)[:, :, 3] > 0
        return a[int(CELL * 0.68):, :]
    for r in range(4):
        d13 = float((lowthird((r, 1)) ^ lowthird((r, 3))).mean())
        d02 = float((lowthird((r, 0)) ^ lowthird((r, 2))).mean())
        legdiff[f"row{r}"] = {"stride1_vs_stride2": round(d13, 3), "stand_vs_passing": round(d02, 3)}
    # walk GIF (front row): stand, w1, passing, w2, passing, w1 at 7fps
    seq = [0, 1, 2, 3, 2, 1]
    frames = []
    for c in seq:
        f = Image.open(outdir / f"frame-r0c{c}.png").resize((256, 256))
        bgim = Image.new("RGBA", (256, 256), (122, 143, 87, 255))
        bgim.paste(f, (0, 0), f)
        frames.append(bgim.convert("P"))
    frames[0].save(ROOT / "npc" / f"{name}-walk.gif", save_all=True,
                   append_images=frames[1:], duration=140, loop=0)
    report[name] = {"median_frame_h_src": med, "scale": round(scale, 3),
                    "seg_gated_px": int(gated.sum()), "legdiff": legdiff}
    print(name, report[name])
(ROOT / "npc" / "npc-report.json").write_text(json.dumps(report, indent=1))
print("DONE")
