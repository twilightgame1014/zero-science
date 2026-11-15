#!/usr/bin/env python3
"""Muse の環境セット（assets/environment-set/models）と GPT-DQ3 セット（assets/gpt-dq3/models）の GLB（原本）から、
ゲームに埋め込む軽量版を作る（2026-11-12）。原本は変更しない。

軽量化のやり方：
  ・テクスチャ画像を GLB から取り出し、中身が同じ画像は1枚にまとめる（同じ石・樹皮・葉の画像が 20 個以上の GLB に重複していた）。
    まとめた画像は assets/build/nature-tex/<hash>.webp（色は長辺 COLOR_MAX、法線・粗さは長辺 AUX_MAX）。
    GLB の中の画像は 1×1 の透明 PNG に置き換え、画像の名前を "tex:<hash>" にする（読み込むときにゲーム側で共有のテクスチャへ差し替える）。
  ・地面の影の板（"shadow" の画像を使う ContactShadow）は外す（自然物は描画モジュールの本物の影を使う。斜面で板が浮くため）。
  ・頂点・面・ノード名・寸法は変えない。
出力：assets/build/nature/<id>.glb・assets/build/town/<id>.glb・assets/build/nature-tex/<hash>.webp・assets/build/nature/manifest.json
使い方：python3 scripts/make-nature-glb.py   （Pillow が必要）"""
import io, json, os, struct, glob, hashlib
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, "assets/environment-set/models")
DQ3 = os.path.join(ROOT, "assets/gpt-dq3/models")
OUT_N = os.path.join(ROOT, "assets/build/nature")
OUT_T = os.path.join(ROOT, "assets/build/town")
OUT_X = os.path.join(ROOT, "assets/build/nature-tex")
COLOR_MAX, AUX_MAX = 512, 256
# 採用する自然物（基本モデル）。LOD1 は測った結果、採用しない（manifest の lodReport）
NATURE = {
  ENV: ["tree-broadleaf-a1", "tree-broadleaf-a2", "tree-broadleaf-b1", "tree-broadleaf-b2", "tree-broadleaf-c1", "tree-broadleaf-c2",
        "tree-conifer-cedar", "tree-conifer-pine", "shrub-round", "shrub-flower",
        "rock-m-blocky", "rock-l-blocky", "rock-m-round", "rock-l-round", "rock-m-sharp", "rock-l-sharp",
        "rock-m-depleted", "rock-shore-1", "rock-shore-2", "driftwood", "shell-scallop", "shell-conch"],
  DQ3: ["stump", "log-fallen", "moss-rock", "basalt-1", "basalt-2", "basalt-3"],
}
TOWN = ["hut-town", "plaza", "banner-red", "banner-green", "planter-large", "planter-small", "crates", "barrel", "bucket-rope", "stall", "fruit-basket", "stone-lantern"]
PLACEHOLDER = None

def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", b[:12]); assert magic == 0x46546C67 and ver == 2
    off, js, binc = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack("<II", b[off:off + 8]); data = b[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A: js = json.loads(data)
        elif ctype == 0x004E4942: binc = data
        off += 8 + clen
    return js, binc

def write_glb(path, js, binc):
    jb = json.dumps(js, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4); binc = bytes(binc) + b"\0" * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(binc), 0x004E4942)); f.write(binc)

def placeholder():
    global PLACEHOLDER
    if PLACEHOLDER is None:
        o = io.BytesIO(); Image.new("RGBA", (1, 1), (128, 128, 128, 255)).save(o, "PNG"); PLACEHOLDER = o.getvalue()
    return PLACEHOLDER

def aux_names(js):
    """法線・粗さに使われている画像の番号（色より小さくする）"""
    aux = set()
    for m in js.get("materials", []):
        for key in ("normalTexture", "occlusionTexture"):
            if key in m: aux.add(js["textures"][m[key]["index"]]["source"])
        pbr = m.get("pbrMetallicRoughness", {})
        if "metallicRoughnessTexture" in pbr: aux.add(js["textures"][pbr["metallicRoughnessTexture"]["index"]]["source"])
    return aux

texinfo = {}
def store_texture(data, aux):
    h = hashlib.md5(data).hexdigest()[:10]
    if h in texinfo: return h
    im = Image.open(io.BytesIO(data)); im.load(); im = im.convert("RGBA")
    a = im.getchannel("A"); alpha = a.getextrema()[0] < 255
    w, hh = im.size; lim = AUX_MAX if aux else COLOR_MAX; s = min(1.0, lim / max(w, hh))
    if s < 1: im = im.resize((max(1, round(w * s)), max(1, round(hh * s))), Image.LANCZOS)
    o = io.BytesIO()
    if alpha: im.save(o, "WEBP", quality=82, method=6)
    else: im.convert("RGB").save(o, "WEBP", quality=80, method=6)
    open(os.path.join(OUT_X, h + ".webp"), "wb").write(o.getvalue())
    texinfo[h] = {"bytesIn": len(data), "bytesOut": len(o.getvalue()), "size": list(im.size), "alpha": alpha, "aux": aux}
    return h

def bbox(js, binc, skip_mesh):
    """ノードの変換を入れた、見える部分（影の板を除く）の外接箱と三角形数・メッシュ数"""
    import math
    def mat_of(node):
        t = node.get("translation", [0, 0, 0]); r = node.get("rotation", [0, 0, 0, 1]); s = node.get("scale", [1, 1, 1])
        if "matrix" in node: return node["matrix"]
        x, y, z, w = r
        R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        M = [0.0] * 16
        for c in range(3):
            for rr in range(3): M[c * 4 + rr] = R[rr][c] * s[c]
        M[12], M[13], M[14], M[15] = t[0], t[1], t[2], 1.0
        return M
    def mul(A, B):
        C = [0.0] * 16
        for c in range(4):
            for rr in range(4): C[c * 4 + rr] = sum(A[k * 4 + rr] * B[c * 4 + k] for k in range(4))
        return C
    lo = [1e9] * 3; hi = [-1e9] * 3; tris = 0; meshes = 0
    nodes = js.get("nodes", [])
    def visit(i, P):
        nonlocal tris, meshes
        n = nodes[i]; M = mul(P, mat_of(n))
        if "mesh" in n and n["mesh"] not in skip_mesh:
            meshes += 1
            for p in js["meshes"][n["mesh"]]["primitives"]:
                acc = js["accessors"][p["attributes"]["POSITION"]]
                tris += (js["accessors"][p["indices"]]["count"] if "indices" in p else acc["count"]) // 3
                mn, mx = acc["min"], acc["max"]
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            v = [M[0] * cx + M[4] * cy + M[8] * cz + M[12], M[1] * cx + M[5] * cy + M[9] * cz + M[13], M[2] * cx + M[6] * cy + M[10] * cz + M[14]]
                            for k in range(3): lo[k] = min(lo[k], v[k]); hi[k] = max(hi[k], v[k])
        for c in n.get("children", []): visit(c, M)
    I = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]
    for sc in js.get("scenes", [{"nodes": list(range(len(nodes)))}]):
        for i in sc["nodes"]: visit(i, I)
    return {"min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi], "tris": tris, "meshes": meshes}

def convert(src, out_dir, drop_shadow=True):
    js, binc = read_glb(src); name = os.path.basename(src)[:-4]
    aux = aux_names(js)
    # 影の板：shadow の画像を色に使う材質のメッシュ
    shadow_imgs = {i for i, im in enumerate(js.get("images", [])) if (im.get("name") or "").lower().startswith("shadow")}
    shadow_tex = {i for i, t in enumerate(js.get("textures", [])) if t.get("source") in shadow_imgs}
    shadow_mat = {i for i, m in enumerate(js.get("materials", [])) if m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index") in shadow_tex}
    skip_mesh = {i for i, me in enumerate(js.get("meshes", [])) if all(p.get("material") in shadow_mat for p in me["primitives"])} if drop_shadow else set()
    for n in js.get("nodes", []):
        if n.get("mesh") in skip_mesh: del n["mesh"]
    used = []
    img_views = {im["bufferView"]: i for i, im in enumerate(js.get("images", [])) if "bufferView" in im}
    new_bin = bytearray()
    for vi, bv in enumerate(js["bufferViews"]):
        data = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        if vi in img_views:
            ii = img_views[vi]
            if ii in shadow_imgs and drop_shadow: h = None
            else: h = store_texture(data, ii in aux); used.append(h)
            js["images"][ii]["name"] = "tex:" + h if h else "tex:none"; js["images"][ii]["mimeType"] = "image/png"
            data = placeholder()
        while len(new_bin) % 4: new_bin += b"\0"
        bv["byteOffset"] = len(new_bin); bv["byteLength"] = len(data); new_bin += data
    js["buffers"][0]["byteLength"] = len(new_bin)
    # テクスチャの名前も画像と同じ鍵に（GLTFLoader は texture.name に入れる）
    for t in js.get("textures", []):
        if "source" in t: t["name"] = js["images"][t["source"]]["name"]
    out = os.path.join(out_dir, name + ".glb"); write_glb(out, js, new_bin)
    bb = bbox(js, binc, skip_mesh)
    return name, {"bytesIn": os.path.getsize(src), "bytesOut": os.path.getsize(out), "textures": sorted(set(used)), "droppedShadowMeshes": len(skip_mesh), **bb}

for d in (OUT_N, OUT_T, OUT_X): os.makedirs(d, exist_ok=True)
man = {"note": "scripts/make-nature-glb.py が作る。bytesIn＝原本の GLB、bytesOut＝画像を抜いた軽量版（画像は nature-tex に共有）", "nature": {}, "town": {}, "textures": texinfo, "lodReport": {}}
for base, ids in NATURE.items():
    for i in ids: n, info = convert(os.path.join(base, i + ".glb"), OUT_N); man["nature"][n] = info
for i in TOWN: n, info = convert(os.path.join(DQ3, i + ".glb"), OUT_T); man["town"][n] = info
# 拠点の建物と集落の小物（scripts/make-building-glb.py の軽量版）も、画像を共有テクスチャへ移す（同じ板・樹皮・石・影の画像が最大 13 個の GLB に重複していた）。
# 接地影（ContactShadow）は建物の決まりどおり残す
man["buildings"] = {}; man["props"] = {}
for grp, src_dir in (("buildings", "assets/build/buildings"), ("props", "assets/build/props")):
    out_dir = os.path.join(ROOT, "assets/build", grp + "-lite"); os.makedirs(out_dir, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(ROOT, src_dir, "*.glb"))):
        n, info = convert(f, out_dir, drop_shadow=False); man[grp][n] = info
# LOD1：大きな岩だけ使う（苔の板が外れて描画回数 3→1、形と寸法は同じ）。木の LOD1 は形と寸法が LOD0 と違う（幅が最大 40% 違う）ので使わない
man["lod1"] = {}
for i in ["rock-l-blocky", "rock-l-round", "rock-l-sharp"]:
    n, info = convert(os.path.join(ENV, i + "_lod1.glb"), OUT_N); man["lod1"][i] = info
# LOD1 の測定（採用はしない：三角形の差・描画回数・寸法の差を残す）
for f in sorted(glob.glob(os.path.join(ENV, "*_lod1.glb"))):
    base = os.path.basename(f)[:-9]; js0, b0 = read_glb(os.path.join(ENV, base + ".glb")); js1, b1 = read_glb(f)
    a, b = bbox(js0, b0, set()), bbox(js1, b1, set())
    size = lambda x: [round(x["max"][k] - x["min"][k], 2) for k in range(3)]
    man["lodReport"][base] = {"tris0": a["tris"], "tris1": b["tris"], "meshes0": a["meshes"], "meshes1": b["meshes"], "size0": size(a), "size1": size(b)}
json.dump(man, open(os.path.join(OUT_N, "manifest.json"), "w"), ensure_ascii=False, indent=1)
# 街の建物・小物の占有形状（当たり判定）。外接箱で一律に通せんぼにしない：広場の床は歩ける（なし）、旗は竿だけ、屋台は台だけ、小屋は壁の内側
TOWN_INFO = {
  "hut-town": ("町の家", "rect", 0.82), "plaza": ("石畳の広場", None, 0), "banner-red": ("旗（赤）", "pole", 0.12), "banner-green": ("旗（緑）", "pole", 0.12),
  "planter-large": ("植木鉢（大）", "circle", 0.46), "planter-small": ("植木鉢（小）", "circle", 0.46), "crates": ("木箱", "rect", 0.92),
  "barrel": ("たる", "circle", 0.5), "bucket-rope": ("おけと縄", "circle", 0.3), "stall": ("屋台", "rect", 0.85),
  "fruit-basket": ("果物かご", "circle", 0.48), "stone-lantern": ("石どうろう", "circle", 0.42)}
specs = {"note": "街の建物・小物（発展した街の素材。検証モードで置ける。通常のゲームの開始地点には置かない）。footprint は scripts/make-nature-glb.py が実寸から決める", "town": {}}
for i, info in man["town"].items():
    nm, shape, k = TOWN_INFO[i]; w = info["max"][0] - info["min"][0]; d = info["max"][2] - info["min"][2]; h = info["max"][1] - info["min"][1]
    fp = None
    if shape == "rect": fp = {"shape": "rect", "w": round(w * k, 2), "d": round(d * k, 2)}
    elif shape == "circle": fp = {"shape": "circle", "r": round(max(w, d) * k, 2)}
    elif shape == "pole": fp = {"shape": "circle", "r": k}
    specs["town"][i] = {"name": nm, "stage": "town", "footprint": fp, "size": {"w": round(w, 2), "h": round(h, 2), "d": round(d, 2)}, "tris": info["tris"], "meshes": info["meshes"]}
json.dump(specs, open(os.path.join(OUT_T, "specs.json"), "w"), ensure_ascii=False, indent=1)
tin = sum(v["bytesIn"] for g in ("nature", "town", "buildings", "props", "lod1") for v in man[g].values()); tout = sum(v["bytesOut"] for g in ("nature", "town", "buildings", "props", "lod1") for v in man[g].values())
xin = sum(v["bytesIn"] for v in texinfo.values()); xout = sum(v["bytesOut"] for v in texinfo.values())
for g in ("nature", "town", "buildings", "props", "lod1"):
    print(g, len(man[g]), "点", round(sum(v["bytesIn"] for v in man[g].values()) / 1048576, 2), "MB →", round(sum(v["bytesOut"] for v in man[g].values()) / 1048576, 2), "MB（形だけ）")
print(f"GLB 原本 {tin/1048576:.1f} MB → 形だけ {tout/1048576:.2f} MB ＋ 共有テクスチャ {len(texinfo)} 枚 {xout/1048576:.2f} MB（取り出した画像の元 {xin/1048576:.1f} MB・重複を除いた後）")
