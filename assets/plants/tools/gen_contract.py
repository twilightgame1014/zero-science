# Generate plants-contract.json from measured GLB data + static species data.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure_glb import load_glb, tris, world_bbox

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "models")

SPECIES = {
    "broadleaf": {
        "name": "広葉樹", "classification": "落葉広葉樹",
        "productionUse": "木材（制作上の分類。ゲーム内の採集物は未確定）",
        "states": ["state_standing", "state_stump"],
        "gatherPoint": [0, 1.0, 0.68],
        "collider": {"shape": "cylinder", "radius": 0.34, "height": 3.2,
                     "blocksMovement": True, "canopyBlocks": False},
        "windSway": {"maxDeg": 1.2, "frequencyHz": 0.5, "pivot": "crownBase",
                     "rootFixed": True},
    },
    "pine": {
        "name": "松", "classification": "常緑針葉樹",
        "productionUse": "木材・樹脂（制作上の分類）",
        "states": ["state_standing", "state_stump"],
        "gatherPoint": [0, 1.0, 0.62],
        "collider": {"shape": "cylinder", "radius": 0.28, "height": 3.4,
                     "blocksMovement": True, "canopyBlocks": False},
        "windSway": {"maxDeg": 1.0, "frequencyHz": 0.45, "pivot": "crownBase",
                     "rootFixed": True},
    },
    "kouzo": {
        "name": "コウゾ", "classification": "落葉低木（クワ科）",
        "productionUse": "樹皮繊維（制作上の分類）",
        "states": ["state_standing", "state_stump"],
        "gatherPoint": [0, 0.9, 0.60],
        "collider": {"shape": "cylinder", "radius": 0.28, "height": 2.6,
                     "blocksMovement": True, "canopyBlocks": False},
        "windSway": {"maxDeg": 1.4, "frequencyHz": 0.55, "pivot": "crownBase",
                     "rootFixed": True},
    },
    "bamboo": {
        "name": "竹", "classification": "イネ科タケ亜科（群生）",
        "productionUse": "茎材・繊維（制作上の分類）",
        "states": ["state_full", "state_cut"],
        "gatherPoint": [0, 1.0, 1.15],
        "collider": {"shape": "cylinder", "radius": 0.50, "height": 2.0,
                     "blocksMovement": True, "canopyBlocks": False,
                     "note": "群生中心のみ。稈と稈の間は通行可とする前提"},
        "windSway": {"maxDeg": 1.8, "frequencyHz": 0.7, "pivot": "culmMid",
                     "rootFixed": True},
    },
    "flax": {
        "name": "亜麻", "classification": "一年草（アマ科）",
        "productionUse": "繊維・油料（制作上の分類）",
        "states": ["state_full", "parts_fruit", "state_low"],
        "gatherPoint": [0, 0.45, 0],
        "collider": {"shape": "none", "radius": 0, "blocksMovement": False},
        "windSway": {"maxDeg": 2.5, "frequencyHz": 1.1, "pivot": "base",
                     "rootFixed": True},
    },
    "cotton": {
        "name": "綿", "classification": "一年草（アオイ科）",
        "productionUse": "繊維（制作上の分類）",
        "states": ["state_full", "parts_fruit", "state_low"],
        "gatherPoint": [0, 0.5, 0],
        "collider": {"shape": "none", "radius": 0, "blocksMovement": False},
        "windSway": {"maxDeg": 2.2, "frequencyHz": 1.0, "pivot": "base",
                     "rootFixed": True},
    },
    "rapeseed": {
        "name": "菜種", "classification": "一年草（アブラナ科）",
        "productionUse": "油料・食料（制作上の分類）",
        "states": ["state_full", "parts_fruit", "state_low"],
        "gatherPoint": [0, 0.5, 0],
        "collider": {"shape": "none", "radius": 0, "blocksMovement": False},
        "windSway": {"maxDeg": 2.5, "frequencyHz": 1.1, "pivot": "base",
                     "rootFixed": True},
    },
    "reed": {
        "name": "葦", "classification": "多年草（イネ科・水辺）",
        "productionUse": "水辺の繊維（制作上の分類）",
        "states": ["state_full", "state_cut"],
        "gatherPoint": [0, 0.8, 0.8],
        "collider": {"shape": "cylinder", "radius": 0.35, "height": 1.2,
                     "blocksMovement": False, "canopyBlocks": False},
        "windSway": {"maxDeg": 3.5, "frequencyHz": 0.9, "pivot": "base",
                     "rootFixed": True},
    },
}

def entry(asset):
    sp = asset.replace("plant-", "").rsplit("-", 1)[0]
    meta = SPECIES[sp]
    g0, size0 = load_glb(os.path.join(MODELS, asset + ".glb"))
    g1, size1 = load_glb(os.path.join(MODELS, asset + "_lod1.glb"))
    dims, lo = world_bbox(g0)
    mats = sorted({m.get("name", "?") for m in g0.get("materials", [])})
    return {
        "assetId": asset,
        "species": sp,
        "name": meta["name"],
        "classification": meta["classification"],
        "productionUse": meta["productionUse"],
        "dimensions_m": {"width": dims[0], "depth": dims[1], "height": dims[2]},
        "origin": "base centre at (0,0,0); +Y up in glTF",
        "groundContact": "y=0 plane; root flare sinks to y=%.2f so the base never floats on flat ground" % lo[1],
        "states": meta["states"],
        "stateSwitching": "toggle visibility of the named state groups; parts_fruit is a child of state_full (hide it for the no-flower/no-fruit form)",
        "lod": {
            "lod0": {"file": "models/%s.glb" % asset, "tris": tris(g0), "bytes": size0},
            "lod1": {"file": "models/%s_lod1.glb" % asset, "tris": tris(g1), "bytes": size1},
            "recommendedSwitchDistance_m": 27,
        },
        "materials": mats,
        "materialNote": "no texture embedded in any GLB. Shared processed textures attach by material name via plant-materials.json (+ plant-materials.mjs); slots not listed there stay on the flat shared palette",
        "texturesEmbedded": [],
        "alphaMethod": "geometry is opaque; single-leaf textures are cut by alphaTest against the geometry silhouette (intersection), no transparent blending and no sorting issues. needleA is composited opaque so the pine core mass never gets holes. See plant-materials.json alphaPolicy",
        "windSway": meta["windSway"],
        "gatherPoint": meta["gatherPoint"],
        "recommendedCollider": meta["collider"],
        "respawnControl": "whole-asset visibility + state groups are externally switchable, so the game can suppress display on buildings/roads",
    }

def main():
    assets = []
    for fn in sorted(os.listdir(MODELS)):
        if fn.endswith(".glb") and not fn.endswith("_lod1.glb"):
            assets.append(entry(fn[:-4]))
    total0 = sum(a["lod"]["lod0"]["bytes"] for a in assets)
    total1 = sum(a["lod"]["lod1"]["bytes"] for a in assets)
    doc = {
        "contract": "M3-02 plants v2 (Muse, 2026-11-15) — UV completed for all textured slots; GPT textures applied via plant-materials.json",
        "scope": "models / UV / materials / LOD / display states only. Spawning, gathering yields and conditions, regrowth and saves are game-side (Claude). Alien in-game names and recipes are NOT decided here; names below are production classifications based on Earth plants.",
        "materialsManifest": "plant-materials.json",
        "totals": {"assets": len(assets), "lod0Bytes": total0, "lod1Bytes": total1,
                   "allBytes": total0 + total1},
        "plants": assets,
    }
    with open(os.path.join(ROOT, "plants-contract.json"), "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print("contract written:", len(assets), "assets, total MB",
          round((total0 + total1) / 1048576, 2))

if __name__ == "__main__":
    main()
