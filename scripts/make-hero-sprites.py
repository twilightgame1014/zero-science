#!/usr/bin/env python3
"""主人公の8方向シート（Muse 第23ラウンドの原本）をビルド用の WebP にする。

原本：threejs-hd2d-graphics/assets/characters/player-spritesheet-{boy,girl}-8dir.png
  1024×2048（セル256px・4列×8行）。行0-3＝下・左・右・上（従来）、行4＝右手前、行5＝左手前、行6＝右奥、行7＝左奥。
出力：assets/build/hero/{boy,girl}-8dir.webp（寸法・配置はそのまま。品質90）
原本を差し替えたら再実行する。
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'threejs-hd2d-graphics', 'assets', 'characters')
OUT = os.path.join(ROOT, 'assets', 'build', 'hero')
os.makedirs(OUT, exist_ok=True)
for g in ('boy', 'girl'):
    src = os.path.join(SRC, f'player-spritesheet-{g}-8dir.png')
    im = Image.open(src).convert('RGBA')
    if im.size != (1024, 2048):
        sys.exit(f'{src}: 1024×2048 ではない（{im.size}）')
    dst = os.path.join(OUT, f'{g}-8dir.webp')
    im.save(dst, 'WEBP', quality=90, method=6)
    print(dst, os.path.getsize(dst), 'bytes')
