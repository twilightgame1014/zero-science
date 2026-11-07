#!/usr/bin/env python3
"""Muse の NPC スプライト（assets/gpt-expansion/npc/{guide,resident,craftsman}.png、原本）を、ゲームに埋め込む WebP にする。
原本は変更しない。主人公と同じ 4×4（行＝正面／左／右／背面、列＝静止／歩行1／中間／歩行2）。
色は WebP 品質 90、αは劣化させない（alpha_quality=100。二値のまま）。
出力：assets/build/npc/<id>.webp
使い方：python3 scripts/make-npc-sprites.py   （Pillow が必要）"""
import os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/gpt-expansion/npc"); OUT = os.path.join(ROOT, "assets/build/npc")
os.makedirs(OUT, exist_ok=True)
for n in ["guide", "resident", "craftsman"]:
    im = Image.open(os.path.join(SRC, n + ".png")).convert("RGBA")
    dst = os.path.join(OUT, n + ".webp"); im.save(dst, "WEBP", quality=90, alpha_quality=100, method=6)
    print(n, im.size, os.path.getsize(os.path.join(SRC, n + ".png")) // 1024, "KB ->", os.path.getsize(dst) // 1024, "KB")
