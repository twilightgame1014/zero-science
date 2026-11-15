#!/usr/bin/env python3
"""Muse の建物モデル（assets/buildings-3d/models/*.glb、原本）から、ゲームに埋め込む軽量版を作る。
原本は変更しない。テクスチャ画像だけを縮小・再圧縮する（形・ノード名・可動部・寸法は変えない）。
  ・長辺 MAX 以下に縮小（既定 512px＝第14ラウンドの色テクスチャそのまま。法線・粗さは原本が 256px）
  ・透明な画素がない画像は JPEG（品質 82）、透明な画素がある画像は PNG のまま
出力：assets/build/buildings/<id>.glb
集落の小物（assets/gpt-expansion/models/*.glb、Muse 第17ラウンド）も同じ処理で assets/build/props/ へ。
使い方：python3 scripts/make-building-glb.py [MAX]   （Pillow が必要。両方まとめて作る）"""
import io, json, os, struct, sys, glob
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETS = [(os.path.join(ROOT, "assets/buildings-3d/models"), os.path.join(ROOT, "assets/build/buildings")),
        (os.path.join(ROOT, "assets/gpt-expansion/models"), os.path.join(ROOT, "assets/build/props"))]
MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 512

def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", b[:12])
    assert magic == 0x46546C67 and ver == 2, "GLB v2 ではない: " + path
    off, js, binc = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack("<II", b[off:off + 8]); data = b[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A: js = json.loads(data)
        elif ctype == 0x004E4942: binc = data
        off += 8 + clen
    return js, binc

def write_glb(path, js, binc):
    jb = json.dumps(js, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4); binc += b"\0" * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(binc), 0x004E4942)); f.write(binc)

def shrink(data):
    im = Image.open(io.BytesIO(data)); im.load()
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if has_alpha:
        a = im.convert("RGBA").getchannel("A")
        has_alpha = a.getextrema()[0] < 255
    w, h = im.size; s = min(1.0, MAX / max(w, h))
    if s < 1: im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    out = io.BytesIO()
    if has_alpha: im.convert("RGBA").save(out, "PNG", optimize=True); mime = "image/png"
    else: im.convert("RGB").save(out, "JPEG", quality=82, optimize=True, progressive=False); mime = "image/jpeg"
    return out.getvalue(), mime

for SRC, OUT in SETS:
  os.makedirs(OUT, exist_ok=True)
  tot0 = tot1 = 0
  for src in sorted(glob.glob(os.path.join(SRC, "*.glb"))):
      js, binc = read_glb(src)
      img_views = {im["bufferView"]: i for i, im in enumerate(js.get("images", [])) if "bufferView" in im}
      new_bin = bytearray()
      for vi, bv in enumerate(js["bufferViews"]):
          data = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
          if vi in img_views:
              data, mime = shrink(data); js["images"][img_views[vi]]["mimeType"] = mime
          while len(new_bin) % 4: new_bin.append(0)
          bv["byteOffset"] = len(new_bin); bv["byteLength"] = len(data); new_bin += data
      js["buffers"] = [{"byteLength": len(new_bin)}]
      dst = os.path.join(OUT, os.path.basename(src))
      write_glb(dst, js, bytes(new_bin))
      a, b = os.path.getsize(src), os.path.getsize(dst); tot0 += a; tot1 += b
      print(f"{os.path.basename(src):26s} {a//1024:6d} KB -> {b//1024:5d} KB")
  print(f"合計 {tot0//1024} KB -> {tot1//1024} KB（{MAX}px）")
