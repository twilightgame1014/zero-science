#!/usr/bin/env python3
"""Draw the UV template guides for the GPT texture requests.

Cylindrical wrap convention (applied by Muse in the texture pass):
panels laid side by side [P4 | P3 | P2 | P1], v grows upward with
real height. Templates are painter guides only - the final textures
must not contain the guide lines or any text.
Run: python3 make_uv_templates.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "textures"
OUT.mkdir(exist_ok=True)

BG = (232, 223, 200)
GRID = (120, 120, 120)
MARK = (200, 60, 60)
INK = (30, 30, 30)

def body_template():
    W, H = 2048, 1024  # y 4.8 .. 15.8 m (11 m)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    def Y(m):
        return H - (m - 4.8) / 11.0 * H

    names = ["P4 tower side (-X)", "P3 back", "P2 (+X)", "P1 front (+Z)"]
    for i in range(5):
        x = i * W // 4
        d.line([(x, 0), (x, H)], fill=MARK, width=4)
        if i < 4:
            d.text((x + 16, 12), names[i], fill=INK)
    for m, label in ((4.8, "y4.8"), (7.0, "y7.0 insulation top"),
                     (9.3, "y9.3 seam"), (11.3, "y11.3 section joint"),
                     (15.8, "y15.8 top")):
        d.line([(0, Y(m)), (W, Y(m))], fill=GRID, width=2)
        d.text((10, Y(m) - 16), label, fill=INK)
    # insulation band shading (bottom 2.2 m)
    d.rectangle([0, Y(7.0), W, H], fill=(201, 168, 106))
    d.text((16, Y(6.0)), "INSULATION BAND ZONE (separate texture ok)",
           fill=INK)
    # bay panel marker on P1 (front), y 12.45..14.35, centred
    x0 = 3 * W // 4 + W // 8 - 90
    d.rectangle([x0, Y(14.35), x0 + 180, Y(12.45)], outline=MARK, width=5)
    d.text((x0 - 30, Y(14.35) - 20), "BAY PANEL (separate part)",
           fill=MARK)
    d.text((16, H - 26),
           "rocket skin wrap: u = panels P4|P3|P2|P1, v = height. "
           "Paint base colour only, no text, no baked light.",
           fill=INK)
    img.save(OUT / "uv-template-rocket-body.png")
    print("body template done")

def capsule_template():
    W, H = 1024, 512  # y 15.8 .. 19.2 m
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    def Y(m):
        return H - (m - 15.8) / 3.4 * H

    for i in range(5):
        x = i * W // 4
        d.line([(x, 0), (x, H)], fill=MARK, width=3)
    d.text((8, 8), "capsule wrap: same panel order P4|P3|P2|P1",
           fill=INK)
    # hatch on P4 centre (u ~ W/8), centre y 17.3, diameter 0.95
    hx, hy, hr = W // 8, Y(17.3), int(0.475 / 3.4 * H)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], outline=MARK, width=5)
    d.text((hx - hr, hy - hr - 18), "HATCH (separate part)", fill=MARK)
    # window on P1 centre (u ~ 7W/8), centre y 17.7, diameter 0.52
    wx, wy, wr = 7 * W // 8, Y(17.7), int(0.26 / 3.4 * H)
    d.ellipse([wx - wr, wy - wr, wx + wr, wy + wr], outline=MARK, width=5)
    d.text((wx - wr - 10, wy - wr - 18), "WINDOW (separate part)",
           fill=MARK)
    # navy base band y 15.8..16.1
    d.rectangle([0, Y(16.1), W, H], fill=(34, 54, 79))
    d.text((8, H - 22), "base band zone (navy)", fill=(240, 240, 240))
    img.save(OUT / "uv-template-capsule.png")
    print("capsule template done")

body_template()
capsule_template()
