#!/usr/bin/env python3
"""Bundle the processed GPT nature assets into a TypeScript module
(src/graphics/gptTextures.ts) as data URIs, so the graphics module
stays self-contained (the game ships as a single HTML file).

Opaque textures are stored as JPEG, alpha sprites as PNG.
Run process_assets.py first.
"""
import base64
import io
import os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(ROOT, '..', 'textures')
SPR = os.path.join(ROOT, '..', 'sprites')
REPO = os.path.abspath(os.path.join(ROOT, '..', '..', '..'))
OUTS = [
    os.path.join(REPO, 'src', 'graphics', 'gptTextures.ts'),
    os.path.join(REPO, 'threejs-hd2d-graphics', 'src', 'graphics', 'gptTextures.ts'),
]

OPAQUE = [
    'ground_grass_base', 'ground_dirt', 'ground_leaves', 'ground_gravel',
    'bark_deep', 'bark_birch', 'bark_moss',
    'rock_layered', 'rock_moss', 'rock_slate',
]
ALPHA = [
    'leaf_oak', 'leaf_birch', 'leaf_shrub', 'leaf_fern',
    'grass_short', 'grass_wide', 'grass_dry', 'fern_frond',
    'flower_white', 'flower_yellow', 'flower_purple', 'herb_patch',
    'prop_branch', 'prop_pebbles', 'prop_stump', 'prop_rubble',
    'prop_cut_patch', 'prop_leaves_pile',
]


def data_uri(img: Image.Image, fmt: str) -> str:
    buf = io.BytesIO()
    if fmt == 'JPEG':
        img.convert('RGB').save(buf, 'JPEG', quality=80)
        mime = 'image/jpeg'
    else:
        img.save(buf, 'PNG', optimize=True)
        mime = 'image/png'
    return f'data:{mime};base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    entries = {}
    total = 0
    for name in OPAQUE:
        img = Image.open(os.path.join(TEX, name + '.png'))
        entries[name] = data_uri(img, 'JPEG')
    for name in ALPHA:
        img = Image.open(os.path.join(SPR, name + '.png'))
        entries[name] = data_uri(img, 'PNG')
    lines = [
        '/**',
        ' * GPT-generated nature textures/sprites, processed by Muse',
        ' * (assets/gpt-nature/: sources, processing tools, mapping).',
        ' * Data URIs keep the module self-contained; textures upgrade',
        ' * in place once decoded (see AssetManager.imageTexture).',
        ' * Regenerate with assets/gpt-nature/tools/bundle_textures.py.',
        ' */',
        'export const GPT_TEXTURES: Record<string, string> = {',
    ]
    for name, uri in entries.items():
        total += len(uri)
        lines.append(f'  {name}:')
        lines.append(f'    "{uri}",')
    lines.append('};')
    lines.append('')
    text = '\n'.join(lines)
    for out in OUTS:
        with open(out, 'w') as f:
            f.write(text)
        print('wrote', out, f'({total // 1024} KB of data URIs)')


if __name__ == '__main__':
    main()
