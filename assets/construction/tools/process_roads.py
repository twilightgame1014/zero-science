#!/usr/bin/env python3
"""GPT 道路原画（assets/construction/gpt-art/）を正式テクスチャへ仕上げる（Muse、2026-11-15、§41）。

継ぎ目:
- 画像を半分ロールして元の継ぎ目を中央へ移し、帯（48〜64px）の中で両側を
  クロスディゾルブする。新しい端は元画像の内側同士になるため元々連続している。
  全面鏡像ベイクは対称模様が目立つため採用しなかった（石敷きで検品して差し替え）。
- 石敷きは横目地の周期が命。暗さプロファイルから横目地を検出し、目地が
  y=0 と y=512 にちょうど来る区間を切り出して 512 へ引き伸ばす（上下は目地同士が
  接する）。左右は上記のクロスディゾルブで処理する。
法線:
- 色をそのまま変換しない。素材の構造から高さを作る:
  土 = 輝度の低周波（踏み固めの緩やかな起伏）／砂利 = 輝度の高周波（小石の粒）／
  石敷き = 目地（暗線）からの距離変換（石が膨らみ目地が沈む）。
- 接空間法線は three.js の規約（OpenGL 形式、緑 = +V）。既知ドームでの実測で
  確定した（生成版は手前<奥で凹面、緑反転版が正しい凸面）。--no-flip-y で旧方式。
実行: python3 assets/construction/tools/process_roads.py [--flip-y]
出力: assets/construction/textures/road-{dirt,gravel,stone}.png と *_n.png、
      記録 processing-record.json、検品画像は ~/workspace/scg-uvroads-check/ へ。
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "gpt-art")
OUT = os.path.join(ROOT, "textures")
CHECK = os.path.expanduser("~/workspace/scg-uvroads-check")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CHECK, exist_ok=True)
FLIP_Y = "--no-flip-y" not in sys.argv  # 既定は three.js の OpenGL 規約（緑=+V）。ドームテスト（probe-dome2）で実測検証済み：反転なし版は near<far で凹面に見えた
RECORD = {"note": "process_roads.py の加工記録", "flipY": FLIP_Y, "items": {}}


def heal_axis(a, axis, band=56):
    """元の継ぎ目を内側へ移し、帯の中で両側をクロスディゾルブする。
    ロール量は「最も滑らかな内側境界が新しい端になる」よう選ぶ（端の段差 =
    その境界の段差そのものになる）。継ぎ目の移動先も帯の中心に合わせる。"""
    n = a.shape[axis]
    diff = np.abs(np.diff(a, axis=axis)).mean(axis=tuple(i for i in range(a.ndim) if i != axis))
    lo, hi = n // 3, 2 * n // 3  # 境界候補（端から遠い内側）
    b = lo + int(np.argmin(diff[lo - 1:hi])) + 1  # 境界 b はスライス b-1 と b の間
    o = n - b  # ロール量。元の継ぎ目は位置 o に来る
    a = np.roll(a, o, axis=axis)
    c = o
    h = band // 2
    src = a.copy()
    for x in range(c - h, c + h):
        d = (x - c) / h
        w = (1 + np.cos(np.pi * d)) / 4.0  # 中心 0.5 → 帯端 0
        sl = [slice(None)] * a.ndim
        sl[axis] = x
        sm = [slice(None)] * a.ndim
        sm[axis] = 2 * c - x
        a[tuple(sl)] = (1 - w) * src[tuple(sl)] + w * src[tuple(sm)]
    return a


def equalize_edges(a, axis, band):
    """両端のスライスを鏡像ペアの平均へ寄せ、端同士の段差を消す（帯の内側で減衰）。"""
    n = a.shape[axis]
    src = a.copy()
    for i in range(band):
        w = 1.0 - i / band
        s1 = [slice(None)] * a.ndim
        s1[axis] = i
        s2 = [slice(None)] * a.ndim
        s2[axis] = n - 1 - i
        m = (src[tuple(s1)] + src[tuple(s2)]) / 2.0
        a[tuple(s1)] = (1 - w) * src[tuple(s1)] + w * m
        a[tuple(s2)] = (1 - w) * src[tuple(s2)] + w * m
    return a


def make_tileable(img, band=56, axes=(1, 0), equalize=()):
    a = np.asarray(img).astype(np.float32)
    for axis in axes:
        a = heal_axis(a, axis=axis, band=band)
    for axis, eb in equalize:
        a = equalize_edges(a, axis=axis, band=eb)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGB")


def fix_stone(img):
    """横目地を検出し、目地→目地の区間を 512 に合わせて上下端を目地にする。"""
    lum = np.asarray(img.convert("L")).astype(np.float32)
    dark = 255.0 - ndimage.gaussian_filter(lum, sigma=(1.5, 6))
    prof = dark.mean(axis=1)
    from scipy.signal import find_peaks
    pk, _ = find_peaks(prof, distance=40, prominence=1.2)
    centers = [float(v) for v in pk]
    # 端そのものにある目地は find_peaks が拾えないので、端の暗さで補う
    if prof[:8].max() > prof.mean() + 2:
        centers = [float(np.argmax(prof[:8]))] + centers
    if prof[-8:].max() > prof.mean() + 2:
        centers = centers + [float(504 + np.argmax(prof[-8:]))]
    centers = sorted(set(centers))
    # 最も外側の目地同士の区間（上下端がともに目地の中心に来る）を使う
    if len(centers) >= 7 and 470 <= centers[-1] - centers[0] <= 512:
        best = (centers[0], centers[-1])
    else:  # 検出失敗時は全体を使う（記録に残す）
        best = (0.0, 512.0)
    y0, y1 = best
    strip = img.crop((0, int(round(y0)), 512, int(round(y1)))).resize((512, 512), Image.LANCZOS)
    return strip, {"jointCenters": [round(c, 1) for c in centers],
                   "chosenSpan": [round(y0, 1), round(y1, 1)],
                   "note": "上下端は目地同士が接する。左右は make_tileable で処理"}


def height_map(kind, img):
    lum = np.asarray(img.convert("L")).astype(np.float32) / 255.0
    if kind == "dirt":
        low = ndimage.gaussian_filter(lum, 3.0)
        micro = (lum - ndimage.gaussian_filter(lum, 9.0)) * 0.25
        h = low + micro
    elif kind == "gravel":
        bumps = ndimage.gaussian_filter(lum, 1.1) - ndimage.gaussian_filter(lum, 6.0)
        h = bumps + 0.25 * ndimage.gaussian_filter(lum, 5.0)
    else:  # stone: 目地（暗線）からの距離で石を膨らませる
        smooth = ndimage.gaussian_filter(lum, 1.2)
        joint = smooth < (smooth.mean() - 0.10)
        dist = ndimage.distance_transform_edt(~joint)
        h = np.minimum(dist, 16.0) / 16.0
        h = ndimage.gaussian_filter(h, 1.6) + 0.10 * ndimage.gaussian_filter(lum, 6.0)
    h = (h - h.min()) / max(1e-6, h.max() - h.min())
    return h


def normal_from_height(h, strength):
    gx = ndimage.sobel(h, axis=1) / 8.0
    gy_img = ndimage.sobel(h, axis=0) / 8.0  # 画像下向き
    # three.js（OpenGL 形式）: 緑は +V（画像上向き）。画像下向き勾配は符号を返す
    ny = gy_img if FLIP_Y else -gy_img
    nx, nz = -gx * strength, np.ones_like(h)
    n = np.dstack([nx, ny * strength, nz])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8), "RGB")


def edge_metrics(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    dx = np.abs(a[:, 0] - a[:, -1]).mean()
    dy = np.abs(a[0, :] - a[-1, :]).mean()
    inner = np.abs(np.diff(a, axis=1)).mean()
    return {"edgeX": round(float(dx), 2), "edgeY": round(float(dy), 2),
            "innerStep": round(float(inner), 2)}


def tile_check(img, name):
    t = Image.new("RGB", (768, 768))
    small = img.resize((256, 256), Image.LANCZOS)
    for i in range(3):
        for j in range(3):
            t.paste(small, (i * 256, j * 256))
    t.save(os.path.join(CHECK, name))


STRENGTH = {"dirt": 1.1, "gravel": 2.0, "stone": 2.4}

def main():
    for kind in ("dirt", "gravel", "stone"):
        src = Image.open(os.path.join(ART, f"road-{kind}.png")).convert("RGB")
        before = edge_metrics(src)
        if kind == "stone":
            fixed, info = fix_stone(src)
            fixed = make_tileable(fixed, band=48, axes=(1,), equalize=((0, 20),))
        elif kind == "gravel":
            fixed, info = make_tileable(src, band=64, equalize=((0, 16),)), \
                {"method": "roll+cross-dissolve band + edge equalize Y"}
        else:
            fixed, info = make_tileable(src, band=48), \
                {"method": "roll+cross-dissolve band"}
        fixed.save(os.path.join(OUT, f"road-{kind}.png"))
        tile_check(fixed, f"tile3x3-{kind}.png")
        tile_check(src, f"tile3x3-{kind}-before.png")
        h = height_map(kind, fixed)
        Image.fromarray((h * 255).astype(np.uint8), "L").save(
            os.path.join(CHECK, f"height-{kind}.png"))
        n = normal_from_height(h, STRENGTH[kind])
        n.save(os.path.join(OUT, f"road-{kind}_n.png"))
        RECORD["items"][kind] = {"seam": info, "edgeBefore": before,
                                 "edgeAfter": edge_metrics(fixed),
                                 "normalStrength": STRENGTH[kind],
                                 "bytes": os.path.getsize(os.path.join(OUT, f"road-{kind}.png")),
                                 "normalBytes": os.path.getsize(os.path.join(OUT, f"road-{kind}_n.png"))}
        print(kind, RECORD["items"][kind])
    with open(os.path.join(OUT, "processing-record.json"), "w") as f:
        json.dump(RECORD, f, ensure_ascii=False, indent=1)
    print("ALL DONE flipY =", FLIP_Y)


if __name__ == "__main__":
    main()
