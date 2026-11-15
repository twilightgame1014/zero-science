#!/usr/bin/env python3
"""GPT 原画（assets/plants/gpt-art/）を正式材質用の共有テクスチャへ加工する（Muse、2026-11-15、§41）。

方針（plants README の「不透明ジオメトリ」と依頼表の「透過葉カード」の整理）:
- 葉の輪郭はジオメトリ（leaf_mesh）が担う。テクスチャは葉面の色・葉脈を与える。
- 単葉原画（広葉樹・コウゾ・葦）は葉の外接矩形をキャンバス全面へ正規化し、
  alphaTest で「ジオメトリ輪郭 ∩ 原画輪郭」を最終輪郭にする。αを 2px 膨張させ、
  原画が僅かに痩せて葉が欠ける事故を防ぐ。RGB は最近傍被写体色で全面へ滲ませ
  （bleed）、ミップ縮小時に透明側の黒・白が縁へ漏れないようにする。
- 針葉は束の原画をそのまま単針カードへ貼らない。needleA は中核球＋カード共用の
  「針葉塊」として不透明合成（αなし）し、needleB は原画上部の縦帯切り出しで
  数本の針が読める α 付きにする。
- 樹皮と竹は不透明のまま、円柱ラップの継ぎ目（u 方向）を鏡像バンドで消す。
原画は gpt-art/ に保存したまま、加工済みだけを textures/ へ出す。
実行: python3 assets/plants/tools/process_textures.py（Pillow / numpy / scipy が必要）
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "gpt-art")
OUT = os.path.join(ROOT, "textures")
os.makedirs(OUT, exist_ok=True)
RECORD = {"note": "process_textures.py の加工記録。座標は元画像ピクセル（PIL: 左上原点）", "items": {}}


def rgb_bleed(rgb, alpha):
    """透明側へ被写体色を滑らかに滲ませる（ミップ縁対策）。
    正規化畳み込みを粗→細の順に重ね、遠方は大域色、縁際は近傍色で埋める。"""
    mask = (alpha > 8).astype(np.float32)
    if mask.all():
        return rgb
    out = rgb.copy()
    filled = mask > 0
    for sigma in (32, 12, 4):
        num = ndimage.gaussian_filter(out * mask[..., None], sigma=sigma, mode="nearest")
        den = ndimage.gaussian_filter(mask, sigma=sigma, mode="nearest")
        est = np.where(den[..., None] > 1e-4, num / np.maximum(den[..., None], 1e-4), out)
        todo = ~filled
        out[todo] = est[todo]
        # 推定で埋まった画素を次の段の種にする（縁から少しずつ広げる）
        grown = ndimage.maximum_filter(np.where(todo, den, 0), size=2 * int(sigma) + 1) > 0.05
        filled = filled | grown
    return out


def dilate_alpha(alpha, px=2):
    return ndimage.maximum_filter(alpha, size=2 * px + 1)


def normalize_leaf(img, canvas=(512, 512), fill=0.97):
    """単葉 RGBA を、葉柄が下端・葉先が上端に来るようキャンバス全面へ正規化。"""
    a = np.asarray(img.split()[-1])
    ys, xs = np.where(a > 8)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = img.crop(box)
    cw, ch = canvas
    scale = min(cw * fill / crop.width, ch * fill / crop.height)
    nw, nh = max(1, round(crop.width * scale)), max(1, round(crop.height * scale))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    canvas_img = Image.new("RGBA", canvas, (0, 0, 0, 0))
    canvas_img.alpha_composite(crop, ((cw - nw) // 2, ch - nh - round(ch * (1 - fill) / 2)))
    arr = np.asarray(canvas_img).astype(np.float32)
    rgb, al = arr[..., :3], arr[..., 3]
    al = dilate_alpha(al, 2)
    rgb = rgb_bleed(rgb, al)
    out = np.dstack([rgb, al]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), box


def mirror_seam(img, band_x=48, band_y=0):
    """右端を左端の鏡像へクロスフェードし、ラップ継ぎ目を消す（縦方向も同様）。"""
    arr = np.asarray(img).astype(np.float32)
    h, w = arr.shape[:2]
    if band_x:
        for i in range(band_x):
            a = (i + 0.5) / band_x
            x = w - band_x + i
            arr[:, x] = (1 - a) * arr[:, x] + a * arr[:, band_x - 1 - i]
    if band_y:
        for i in range(band_y):
            a = (i + 0.5) / band_y
            y = h - band_y + i
            arr[y, :] = (1 - a) * arr[y, :] + a * arr[band_y - 1 - i, :]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), img.mode)


def save(img, name, rec):
    p = os.path.join(OUT, name)
    img.save(p)
    RECORD["items"][name] = {**rec, "bytes": os.path.getsize(p), "size": list(img.size)}
    print("wrote", name, img.size, os.path.getsize(p))


def main():
    # --- 広葉樹の葉：512シートの4象限から個別に切り出す ---
    sheet = Image.open(os.path.join(ART, "tex-leaf-broadleaf.png")).convert("RGBA")
    quads = {  # 象限（左上原点）→ スロット。右下の黄葉は色調が外れるため不使用
        "leaf-broadleaf-a.png": ((0, 0, 256, 256), "leafA", "左上・中緑"),
        "leaf-broadleaf-b.png": ((256, 0, 512, 256), "leafB", "右上・黄緑"),
        "leaf-broadleaf-dark.png": ((0, 256, 256, 512), "leafDark", "左下・深緑"),
    }
    for name, (box, slot, desc) in quads.items():
        leaf, inner = normalize_leaf(sheet.crop(box))
        save(leaf, name, {"source": "tex-leaf-broadleaf.png", "slot": slot,
                          "quadrant": list(box), "leafBBoxInQuadrant": list(inner),
                          "ops": "象限切り出し→外接矩形を全面正規化→α膨張2px→RGB bleed"})
    RECORD["items"]["tex-leaf-broadleaf.png:BR"] = {
        "slot": None, "ops": "右下・黄の葉はパレット（leafA/B/Dark）の色調から外れるため不使用"}

    # --- コウゾ・葦：単葉をそのまま正規化 ---
    for src, name, slot in (("tex-leaf-kouzo.png", "leaf-kouzo.png", "kouzoLeaf"),
                            ("tex-reed-leaf.png", "reed-leaf.png", "reedLeaf")):
        leaf, bbox = normalize_leaf(Image.open(os.path.join(ART, src)).convert("RGBA"))
        save(leaf, name, {"source": src, "slot": slot, "leafBBox": list(bbox),
                          "ops": "外接矩形を全面正規化→α膨張2px→RGB bleed"})

    # --- 針葉：A は不透明合成（中核球＋カード共用）、B は縦帯切り出し ---
    fan = Image.open(os.path.join(ART, "tex-needle-pine.png")).convert("RGBA")
    arr = np.asarray(fan).astype(np.float32)
    bg = np.zeros_like(arr)
    bg[..., 0], bg[..., 1], bg[..., 2], bg[..., 3] = 30, 74, 40, 255  # needleA パレット相当の深緑
    al = (arr[..., 3:4] / 255.0)
    comp = (arr * al + bg * (1 - al)).clip(0, 255).astype(np.uint8)
    save(Image.fromarray(comp, "RGBA").convert("RGB"), "needle-pine-a.png",
         {"source": "tex-needle-pine.png", "slot": "needleA",
          "ops": "束原画を深緑へα合成して不透明化（中核球に穴を開けないため α は使わない）"})
    strip = fan.crop((205, 10, 307, 300))  # 上部中央：針がほぼ縦向きの帯
    leaf, bbox = normalize_leaf(strip, canvas=(256, 512))
    save(leaf, "needle-pine-b.png",
         {"source": "tex-needle-pine.png", "slot": "needleB",
          "stripCrop": [205, 10, 307, 300], "leafBBoxInStrip": list(bbox),
          "ops": "縦帯切り出し→正規化→α膨張2px→RGB bleed。alphaTest で針の隙間を残す"})

    # --- 樹皮3種：不透明、円柱ラップ継ぎ目を鏡像バンドで処理 ---
    for src, name, slot in (("tex-bark-broadleaf.png", "bark-broadleaf.png", "bark"),
                            ("tex-bark-pine.png", "bark-pine.png", "trunkPine"),
                            ("tex-bark-kouzo.png", "bark-kouzo.png", "barkLight")):
        im = Image.open(os.path.join(ART, src)).convert("RGB")
        ops = "u方向48px・v方向32pxの鏡像バンドで継ぎ目処理"
        if slot == "trunkPine":
            # 原画は赤みが強く、幹に貼ると赤い板に見える。パレット（0.42,0.25,0.16）
            # 寄りに彩度と明度を落とす。鱗の大きさは接続側 repeat [2,2] で詰める
            hsv = np.asarray(im.convert("HSV")).astype(np.float32)
            hsv[..., 1] *= 0.70
            hsv[..., 2] *= 0.88
            im = Image.fromarray(hsv.clip(0, 255).astype(np.uint8), "HSV").convert("RGB")
            ops += "＋彩度×0.70・明度×0.88の色調補正（原画の赤み抑制）"
        im = mirror_seam(im, 48, 32)
        save(im, name, {"source": src, "slot": slot, "ops": ops})
    dark = np.asarray(Image.open(os.path.join(OUT, "bark-broadleaf.png"))).astype(np.float32)
    save(Image.fromarray((dark * 0.66).clip(0, 255).astype(np.uint8), "RGB"),
         "bark-broadleaf-dark.png",
         {"source": "bark-broadleaf.png（加工済み）", "slot": "barkDark",
          "ops": "広葉樹樹皮の色調展開（×0.66）。依頼表の『色違いは色調展開で可』に準拠"})

    # --- 竹：節は描かれていない表面のみ。継ぎ目だけ処理 ---
    im = mirror_seam(Image.open(os.path.join(ART, "tex-bamboo-culm.png")).convert("RGB"), 32, 32)
    save(im, "bamboo-culm.png", {"source": "tex-bamboo-culm.png", "slot": "bambooCulm / bambooNode",
                                 "ops": "鏡像バンド32px。節はジオメトリ側（画像へ描き足していない）"})
    with open(os.path.join(OUT, "processing-record.json"), "w") as f:
        json.dump(RECORD, f, ensure_ascii=False, indent=1)
    print("ALL DONE")


if __name__ == "__main__":
    main()
