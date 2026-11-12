/* ===================== 自然物の 3D モデル（Muse の環境セット・GPT-DQ3 セットの GLB。2026-11-12） =====================
   描画モジュール（src/graphics）は変えない。ResourceRenderer が自然物の「群れ（group）」を作る関数 buildNode を、このファイルが
   実行時に包み、木・岩・やぶ・切り株・砕けた岩・倒木・流木・貝殻・苔むした岩・玄武岩の見た目だけを GLB に差し替える。
   - 自然物の ID・位置・向き・大きさ・残量・採取済みの状態・当たり判定はゲーム（nature.js）のまま。描画へ渡す状態も今までと同じ。
   - 差し替えは「同じ群れの中身を入れ替える」だけ。旧い手続きモデルと新しいモデルを重ねない。
   - 遮蔽フェード・採取中のゆれと光・選んだときの足もとの輪は、モジュールの既存の仕組みがそのまま動く
     （群れの材質を pulseMaterials として返すので、フェードと光はノードごとに効く）。
   - ジオメトリは種類ごとに1つを共有（userData.shared＝モジュールの破棄で消さない）。材質はノードごとに複製（フェードのため）。
     テクスチャは種類をまたいで共有（同じ画像は1枚。scripts/make-nature-glb.py が重複を除いた assets/build/nature-tex）。
   - 読み込みに失敗した種類は、旧い手続きモデルのまま表示し、原因を status() とコンソールに残す。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface NatureAssets {
  models: Record<string, string>;            // id → GLB（base64）
  manifest: { nature: Record<string, { min: number[]; max: number[]; tris: number; meshes: number }> };
  lod1?: Record<string, string>;             // id → LOD1 の GLB（base64）
}
type Tpl = { root: THREE.Object3D; norm: number; size: { w: number; h: number; d: number } };

const templates = new Map<string, Tpl>();
const lodTemplates = new Map<string, Tpl>();
const failed = new Map<string, string>();
const texCache = new Map<string, THREE.Texture>();
const lodLive: Array<{ g: THREE.Group; hi: THREE.Object3D; lo: THREE.Object3D }> = [];
let assets: NatureAssets | null = null;
let texPool: Record<string, string> = {};
/** 共有テクスチャ（hash → data URL）。建物・小物・街・自然物の GLB を読む前に渡す（ASSETS.sharedTex） */
export function setSharedTextures(pool: Record<string, string>): void { texPool = pool || {}; }
let rr: any = null;
let ready = false;
let swapped = 0;
const counts: Record<string, number> = {};
let terrain: any = null;

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function sharedTexture(key: string, like: THREE.Texture): THREE.Texture | null {
  const h = key.slice(4); if (!texPool[h]) return null;
  let t = texCache.get(h);
  if (!t) {
    const img = new Image(); img.src = texPool[h];
    t = new THREE.Texture(img); t.flipY = like.flipY; t.wrapS = like.wrapS; t.wrapT = like.wrapT; t.colorSpace = like.colorSpace;
    t.magFilter = like.magFilter; t.minFilter = like.minFilter; t.anisotropy = 4; t.name = key;
    img.onload = () => { t!.needsUpdate = true; };
    if (img.complete) t.needsUpdate = true;
    texCache.set(h, t);
  }
  return t;
}
/** 建物の読み込み（graphics-entry の ensureBuildingModel）からも使う：画像の名前が "tex:" の物だけ共有テクスチャに差し替える */
export function prepareShared(root: THREE.Object3D): void {
  root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as any[]) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
      const tx = mat[k] as THREE.Texture | null; const key = tx && (tx.name || '');
      if (tx && key && key.startsWith('tex:') && key !== 'tex:none') { const sh = sharedTexture(key, tx); if (sh) { mat[k] = sh; tx.dispose(); mat.needsUpdate = true; } } } });
}
/** 雛形を作る：画像の差し替え（共有テクスチャ）・影・ジオメトリの共有の印 */
function prepare(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.geometry.userData.shared = true;
    m.castShadow = true; m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats as any[]) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
        const tx = mat[k] as THREE.Texture | null; if (!tx) continue;
        const key = tx.name || (tx.image && (tx.image as any).name) || '';
        if (key.startsWith('tex:') && key !== 'tex:none') { const s = sharedTexture(key, tx); if (s) { mat[k] = s; tx.dispose(); } }
      }
      mat.needsUpdate = true;
    }
  });
}
function parse(id: string, b64: string, into: Map<string, Tpl>): Promise<void> {
  return new Promise((resolve) => {
    try {
      new GLTFLoader().parse(b64ToBuffer(b64), '', (gltf) => {
        prepare(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene), sz = new THREE.Vector3(); box.getSize(sz);
        into.set(id, { root: gltf.scene, norm: 1, size: { w: sz.x, h: sz.y, d: sz.z } });
        resolve();
      }, (err) => { failed.set(id, String(err && (err as any).message || err)); console.warn('自然物のモデルを読めなかった：' + id, err); resolve(); });
    } catch (e) { failed.set(id, String((e as any) && (e as any).message || e)); console.warn('自然物のモデルを読めなかった：' + id, e); resolve(); }
  });
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = <T>(arr: T[], key: string) => arr[hash(key) % arr.length];
const BROADLEAF = ['tree-broadleaf-a1', 'tree-broadleaf-a2', 'tree-broadleaf-b1', 'tree-broadleaf-b2', 'tree-broadleaf-c1', 'tree-broadleaf-c2'];
const CONIFER = ['tree-conifer-cedar', 'tree-conifer-pine'];
const ROCKS = ['rock-m-blocky', 'rock-m-round', 'rock-m-sharp', 'rock-l-blocky', 'rock-l-round', 'rock-l-sharp'];
const SHORE = ['rock-shore-1', 'rock-shore-2'];
const BASALT = ['basalt-1', 'basalt-2', 'basalt-3'];
const SHRUB = ['shrub-round', 'shrub-flower'];
const SHELL = ['shell-scallop', 'shell-conch'];
/* 大きさの合わせ方：描画モジュールの見た目の決まり（RESOURCE_VISUAL_SPECS）に合わせる。
   h＝高さを合わせる（木）、r＝地面の上の半径（幅と奥行きの平均の半分）を合わせる（岩・やぶ・切り株）、l＝長さを合わせる（倒木・流木） */
type Fit = { id: string; by: 'h' | 'r' | 'l'; v: number };
function choose(state: any): Fit | null {
  const n = state.natural || null, v = n && n.variant, key = (n && n.id) || `${state.position.x.toFixed(1)},${state.position.z.toFixed(1)}`;
  const area = () => { try { return terrain && terrain.dominantArea ? terrain.dominantArea(state.position.x, state.position.z) : ''; } catch (e) { return ''; } };
  const volc = () => { try { return !!(terrain && terrain.volcanoZone && terrain.volcanoZone(state.position.x, state.position.z)); } catch (e) { return false; } };
  switch (state.type) {
    case 'tree':
      if (state.depleted) return { id: 'stump', by: 'r', v: 0.5 };
      if (v === 'conifer') return { id: pick(CONIFER, key), by: 'h', v: 3.9 };
      if (v == null) return { id: pick(BROADLEAF, key), by: 'h', v: 3.6 };
      return null;                                   // ヤシ・雪の木などは旧い見た目（対応するモデルがない）
    case 'rock':
      if (state.depleted) return { id: 'rock-m-depleted', by: 'r', v: 0.85 };
      if (v === 'mossy') return { id: 'moss-rock', by: 'r', v: 1.0 };
      if (v === 'basalt' || v === 'volcanic' || (!n && volc())) return { id: pick(BASALT, key), by: 'r', v: 1.0 };
      if (v == null) { const a = area(); return { id: pick(a === 'coast' || a === 'lakeside' ? SHORE : ROCKS, key), by: 'r', v: 1.0 }; }
      return null;
    case 'bush':
      if (state.depleted || v === 'dry') return null;  // 刈ったあと・乾いたやぶは旧い見た目
      return { id: pick(SHRUB, key), by: 'r', v: 0.55 };
    case 'branch':
      if (v === 'log') return { id: 'log-fallen', by: 'l', v: 1.7 };
      if (v === 'driftwood') return { id: 'driftwood', by: 'l', v: 1.7 };
      return null;
    case 'pebble':
      if (v === 'shell') return { id: pick(SHELL, key), by: 'r', v: 0.2 };
      return null;
  }
  return null;
}
function cloneFor(fit: Fit, seed: number): { group: THREE.Group; mats: THREE.MeshStandardMaterial[] } | null {
  const t = templates.get(fit.id); if (!t) return null;
  const s = fit.by === 'h' ? fit.v / Math.max(0.01, t.size.h) : fit.by === 'l' ? fit.v / Math.max(0.01, Math.max(t.size.w, t.size.d))
    : fit.v / Math.max(0.01, (t.size.w + t.size.d) / 4);
  const mats: THREE.MeshStandardMaterial[] = [];
  const copy = (src: THREE.Object3D) => {
    const r = src.clone(true);
    r.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return;
      const one = (x: THREE.Material) => { const c = x.clone() as THREE.MeshStandardMaterial; if ((c as any).emissive) mats.push(c); return c; };
      m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material); });
    r.scale.setScalar(s);
    return r;
  };
  const g = new THREE.Group(); g.name = 'NatureModel:' + fit.id;
  const hi = copy(t.root); hi.rotation.y = (seed % 628) / 100; g.add(hi);
  const lt = lodTemplates.get(fit.id);
  if (lt) { const lo = copy(lt.root); lo.rotation.y = hi.rotation.y; lo.visible = false; g.add(lo); lodLive.push({ g, hi, lo }); }
  counts[fit.id] = (counts[fit.id] || 0) + 1; swapped++;
  return { group: g, mats };
}
/** 描画モジュールの ResourceRenderer に差し替えを仕込む（GLB は先に解析して雛形を持つ。解析の前に作られた群れは、解析のあと作り直す） */
export function installNatureModels(gfx: any, a: NatureAssets, terrainApi: any): Promise<void> {
  assets = a; terrain = terrainApi; rr = gfx && gfx.resources;
  if (!rr || typeof rr.buildNode !== 'function') { failed.set('*', 'ResourceRenderer.buildNode がない（描画モジュールの版が違う）'); return Promise.resolve(); }
  const origNode = rr.buildNode.bind(rr), origInst = rr.buildInstanced.bind(rr);
  rr.buildNode = (state: any, seed = 0) => {
    const fit = ready ? choose(state) : null;
    const made = fit ? cloneFor(fit, seed) : null;
    return made ? { group: made.group, pulseMaterials: made.mats } : origNode(state, seed);
  };
  /* 貝殻は描画モジュールではインスタンス描画（板の絵）。モデルがあるときだけ群れの道へ回す */
  rr.buildInstanced = (state: any, seed: number) => {
    if (ready && state.type === 'pebble' && state.natural && state.natural.variant === 'shell' && templates.has('shell-scallop')) return null;
    return origInst(state, seed);
  };
  const jobs = Object.entries(a.models).map(([id, b]) => parse(id, b, templates));
  for (const [id, b] of Object.entries(a.lod1 || {})) jobs.push(parse(id, b, lodTemplates));
  return Promise.all(jobs).then(() => {
    ready = true;
    // すでに作られている群れを、新しい見た目で作り直す（状態はモジュールが持っている最新のもの）
    const ids: string[] = []; for (const [id, e] of rr.entries) if (choose(e.state)) ids.push(id);
    for (const id of ids) { const st = rr.entries.get(id).state; rr.setResource(id, null); rr.setResource(id, st); }
  });
}
/** LOD：主人公から LOD_FAR より遠い大きな岩は、軽い形（苔の板なし）にする。正投影なのでカメラからの距離ではなく主人公からの距離で決める */
const LOD_FAR = 30;
let lodT = 0;
export function tickNatureModels(dt: number, px: number, pz: number): void {
  lodT += dt; if (lodT < 0.25) return; lodT = 0;
  for (let i = lodLive.length - 1; i >= 0; i--) {
    const e = lodLive[i]; if (!e.g.parent) { lodLive.splice(i, 1); continue; }
    const p = e.g.parent.position, far = Math.hypot(p.x - px, p.z - pz) > LOD_FAR;
    e.hi.visible = !far; e.lo.visible = far;
  }
}
export function natureModelStatus() {
  return { ready, templates: templates.size, lod1: lodTemplates.size, failed: Object.fromEntries(failed), swapped, live: counts, textures: texCache.size };
}
