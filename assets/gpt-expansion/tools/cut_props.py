#!/usr/bin/env python3
"""Cut the free-layout village props sheet into individual items by
connected components on the gated alpha (flood + seg gate + despill).
Nearby fragments (e.g. tools resting in their stand) are clustered.
Prints component stats so items can be named by position."""
import numpy as np
from PIL import Image
from pathlib import Path
from scipy import ndimage
import importlib

src = open("tools/process_sprays_ground.py").read()
head = src.split("# ---------------- sprays ----------------")[0]
g = {"__file__": str(Path("tools/process_sprays_ground.py").resolve())}
exec(head, g)
flood_background, despill, seg_alpha = g["flood_background"], g["despill"], g["seg_alpha"]

im = Image.open("source/sheet-07-village-props.jpg").convert("RGB")
rgb = np.asarray(im).astype(np.uint8)
bg = flood_background(rgb)
alpha = np.where(bg, 0, 255).astype(np.uint8)
seg = seg_alpha("sheet-07-village-props.jpg")
gated = (alpha > 0) & (seg < 32)
alpha = np.where(gated, 0, alpha).astype(np.uint8)
print("seg gated:", int(gated.sum()), "despill:", despill(rgb, alpha))
mask = alpha > 0
mask = ndimage.binary_opening(mask, iterations=1)
lab, n = ndimage.label(mask)
objs = []
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    if sl is None: continue
    area = int((lab[sl] == i).sum())
    if area < 900: continue
    cy = (sl[0].start + sl[0].stop) / 2 / mask.shape[0]
    cx = (sl[1].start + sl[1].stop) / 2 / mask.shape[1]
    objs.append({"id": i, "area": area, "cx": round(cx, 3), "cy": round(cy, 3),
                 "bbox": [int(sl[1].start), int(sl[0].start), int(sl[1].stop), int(sl[0].stop)]})
objs.sort(key=lambda o: (round(o["cy"] * 3), o["cx"]))
for o in objs: print(o)
img = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
import json
Path("/tmp/props-components.json").write_text(json.dumps(objs))
img.save("/tmp/props-alpha.png")
print("components:", len(objs))
