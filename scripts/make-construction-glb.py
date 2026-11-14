#!/usr/bin/env python3
"""街づくりの正式素材（Muse、assets/construction。原本は変えない）から、ゲームに埋め込む軽量版を作る（2026-11-14 Claude）。

  ・予定地キット・足場キット・資材の山 5 種の GLB：画像を取り出して共有テクスチャ（assets/build/nature-tex/<hash>.webp）へ移す。
    やり方は scripts/make-nature-glb.py とまったく同じ（その関数をそのまま使う）。足場・資材は拠点の建物と同じ材質の画像を使うので、
    多くは既にある共有テクスチャと同じ鍵になる（重複して埋め込まない）。頂点・面・ノード名・寸法は変えない。
  ・道 3 種のテクスチャ（色・法線、512×512 の PNG）：WebP にする（色は長辺 512、法線は 256）。
出力：assets/build/construction/<id>.glb・road-<kind>.webp・road-<kind>_n.webp・manifest.json
使い方：python3 scripts/make-construction-glb.py   （Pillow が必要）"""
import io, json, os, glob
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/construction")
OUT = os.path.join(ROOT, "assets/build/construction")
# make-nature-glb.py の関数（read_glb・write_glb・placeholder・aux_names・store_texture・bbox・convert）だけを読み込む（処理の本体は実行しない）
_src = open(os.path.join(ROOT, "scripts/make-nature-glb.py"), encoding="utf-8").read()
g = {"__file__": os.path.join(ROOT, "scripts/make-nature-glb.py"), "__name__": "make_nature_glb"}
exec(_src[:_src.index("for d in (OUT_N, OUT_T, OUT_X)")], g)
os.makedirs(OUT, exist_ok=True); os.makedirs(g["OUT_X"], exist_ok=True)
man = {"note": "scripts/make-construction-glb.py が作る。GLB の画像は assets/build/nature-tex の共有テクスチャ（tex:<hash>）", "models": {}, "roads": {}, "textures": {}}
for f in sorted(glob.glob(os.path.join(SRC, "models", "*.glb"))):
    n, info = g["convert"](f, OUT, drop_shadow=False); man["models"][n] = info
    for h in info["textures"]: man["textures"][h] = True
for kind in ("dirt", "gravel", "stone"):
    e = {}
    for suf, mx in (("", 512), ("_n", 256)):
        p = os.path.join(SRC, "textures", f"road-{kind}{suf}.png")
        if not os.path.exists(p): continue
        im = Image.open(p); im = im.convert("RGB")
        if max(im.size) > mx: im.thumbnail((mx, mx), Image.LANCZOS)
        o = os.path.join(OUT, f"road-{kind}{suf}.webp"); im.save(o, "WEBP", quality=86 if suf == "" else 92, method=6)
        e["normal" if suf else "color"] = {"file": os.path.relpath(o, ROOT), "bytesIn": os.path.getsize(p), "bytesOut": os.path.getsize(o), "size": im.size}
    man["roads"][kind] = e
json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=1)
tin = sum(v["bytesIn"] for v in man["models"].values()) + sum(x["bytesIn"] for r in man["roads"].values() for x in r.values())
tout = sum(v["bytesOut"] for v in man["models"].values()) + sum(x["bytesOut"] for r in man["roads"].values() for x in r.values())
print(f"原本 {tin/1e6:.2f}MB → 軽量版 {tout/1e6:.2f}MB（共有テクスチャ {len(man['textures'])} 枚は nature-tex）")
for n, v in man["models"].items(): print(f"  {n}: {v['bytesIn']//1024}KB → {v['bytesOut']//1024}KB tris={v['tris']} tex={len(v['textures'])}")
