// M3-02 植物の共有テクスチャ接続（Muse、2026-11-15、§41）
// GLB にはテクスチャを同梱せず、材質名（スロット）経由で共有画像を後付けする
// 既存方式のための再利用可能な接続コード。採集システムへの割り当ては行わない。
//
// 使い方（three.js）:
//   import { loadPlantMaterials, applyPlantMaterials } from "./plant-materials.mjs";
//   const mats = await loadPlantMaterials(THREE, manifestJson, textureBaseUrl);
//   applyPlantMaterials(gltf.scene, mats);
//
// manifestJson は plant-materials.json の内容（fetch 済みオブジェクトでも、
// その URL 文字列でも可）。textureBaseUrl は plant-materials.json の置き場所
// （image はそこからの相対パス）。

export async function loadPlantMaterials(THREE, manifestOrUrl, baseUrl = "") {
  const manifest = typeof manifestOrUrl === "string"
    ? await (await fetch(manifestOrUrl)).json()
    : manifestOrUrl;
  const loader = new THREE.TextureLoader();
  const bySlot = {};
  const cache = {};
  const loadTex = (rel) => {
    if (!cache[rel]) {
      const tex = loader.load(baseUrl + rel);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      cache[rel] = tex;
    }
    return cache[rel];
  };
  for (const [slot, spec] of Object.entries(manifest.slots)) {
    const tex = loadTex(spec.image);
    tex.wrapS = tex.wrapT = THREE[spec.wrap] ?? THREE.ClampToEdgeWrapping;
    if (spec.repeat) tex.repeat.set(spec.repeat[0], spec.repeat[1]); // 注：画像を共有するスロット間では同じ repeat を使うこと
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: spec.roughness ?? 0.9,
      metalness: 0,
      side: THREE[spec.side] ?? THREE.FrontSide,
    });
    if (spec.alphaMode === "alphaTest") {
      mat.alphaTest = spec.alphaTest ?? 0.45;
      mat.transparent = false; // alphaTest 方式（半透明ソートを使わない）
    }
    if (spec.tint) mat.color.fromArray(spec.tint);
    mat.name = slot;
    bySlot[slot] = mat;
  }
  return bySlot;
}

export function applyPlantMaterials(root, bySlot) {
  let replaced = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => (m && bySlot[m.name]) ? (replaced++, bySlot[m.name]) : m;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return replaced;
}
