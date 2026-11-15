#!/usr/bin/env python3
"""UV テンプレート画像を作る（Muse、2026-11-15、§41）。
葉は leaf_mesh のパラメトリック UV（u=葉の横、v=葉柄0→葉先1）を加工済み
テクスチャへ重ねて描く。樹皮は円柱ラップの向きを示す。
実行: python3 assets/plants/tools/make_uv_templates.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "textures")
OUT = os.path.join(TEX, "uv-templates")
os.makedirs(OUT, exist_ok=True)

# leaf_mesh の頂点 UV: 0=葉柄, 1=左縁, 2=中肋（折り）, 3=右縁, 4=葉先
PTS = [(0.5, 0.0), (0.0, 0.45), (0.5, 0.52), (1.0, 0.45), (0.5, 1.0)]
TRIS = [(0, 1, 2), (0, 2, 3), (1, 4, 2), (2, 4, 3)]


def leaf_template(name):
    img = Image.open(os.path.join(TEX, name)).convert("RGBA")
    w, h = img.size
    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    xy = [(u * w, (1 - v) * h) for u, v in PTS]  # 画像では v=1 が上
    for t in TRIS:
        d.polygon([xy[i] for i in t], outline=(255, 60, 60, 255), width=3)
    for i, (x, y) in enumerate(xy):
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 60, 60, 255))
        d.text((x + 9, y - 6), f"P{i}", fill=(255, 255, 0, 255))
    d.text((8, 8), "red = leaf_mesh UV triangles (u across, v: petiole 0 -> tip 1)", fill=(255, 255, 0, 255))
    Image.alpha_composite(img, ov).save(os.path.join(OUT, "uv-" + name))
    print("uv-" + name)


def bark_template(name):
    img = Image.open(os.path.join(TEX, name)).convert("RGB")
    w, h = img.size
    d = ImageDraw.Draw(img)
    d.line([(6, h - 6), (w - 6, h - 6)], fill=(255, 60, 60), width=3)
    d.line([(6, h - 6), (6, 6)], fill=(60, 120, 255), width=3)
    d.text((14, h - 26), "u -> around trunk (wraps)", fill=(255, 60, 60))
    d.text((14, 10), "v ^ along trunk", fill=(60, 120, 255))
    img.save(os.path.join(OUT, "uv-" + name))
    print("uv-" + name)


for n in ("leaf-broadleaf-a.png", "leaf-kouzo.png", "reed-leaf.png", "needle-pine-b.png"):
    leaf_template(n)
bark_template("bark-broadleaf.png")
print("ALL DONE")
