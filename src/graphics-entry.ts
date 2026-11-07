// ゲーム側から描画モジュールを使うための入口（src/graphics 本体は改変しない）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initializeGraphics, terrainHeight, DEFAULT_CONFIG, resolveConfig, RESOURCE_VISUAL_SPECS, CharacterRenderer } from './graphics';
// 検証モードのアセット一覧用（登録済みのテクスチャ。すでに同梱されているものを参照するだけ）
import { GPT_TEXTURES } from './graphics/gptTextures';
import { BRANCH_TEXTURES } from './graphics/branchTextures';
import { attachWorld } from './world/render';
/* ---------- 建物の3Dモデル（Muse の GLB。assets/buildings-3d、2026-11-07） ----------
   描画モジュールは StructureRenderer.registerFactory で建物の作り方を差し替えられる（呼び出し側はそのまま）。
   add() はファクトリが返した物をその場でたどって炎・車輪・フェード用の材質を登録するので、
   GLB は先に解析して雛形を持ち、ファクトリは雛形の「複製」を同期で返す。解析が済むまでは従来の手続きモデルのまま。
   複製はジオメトリと材質を建物ごとに作る（取り除くときの破棄・フェードが、ほかの建物や雛形に及ばないように）。 */
type Parts = { root: THREE.Object3D; wheel?: THREE.Object3D; piston?: THREE.Object3D; pistonX: number; drill?: THREE.Object3D; winch?: THREE.Object3D; bellows?: THREE.Object3D; bellowsY: number };
const templates = new Map<string, THREE.Object3D>();
const loading = new Map<string, Promise<boolean>>();
const failed = new Set<string>();
const live: Parts[] = [];
function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function cloneBuilding(type: string): THREE.Group {
  const src = templates.get(type)!;
  const root = src.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry = m.geometry.clone();
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    m.castShadow = true; m.receiveShadow = true;
  });
  const g = new THREE.Group(); g.name = 'Building:' + type; g.add(root);
  const find = (n: string) => root.getObjectByName(n) || undefined;
  const p: Parts = { root: g, wheel: find('Wheel'), piston: find('Piston'), pistonX: 0, drill: find('DrillPipe'), winch: find('Winch'), bellows: find('Bellows'), bellowsY: 0 };
  if (p.piston) p.pistonX = p.piston.position.x;
  if (p.bellows) p.bellowsY = p.bellows.scale.y;
  if (p.piston || p.drill || p.winch || p.bellows) live.push(p);
  return g;
}
/** 種類の GLB を解析して、描画モジュールに登録する（済んでいれば何もしない）。結果：true＝GLB を使う */
function ensureBuildingModel(gfx: any, type: string, b64: string | undefined): Promise<boolean> {
  if (templates.has(type)) return Promise.resolve(true);
  if (!b64 || failed.has(type)) return Promise.resolve(false);
  if (loading.has(type)) return loading.get(type)!;
  const pr = new Promise<boolean>((resolve) => {
    try {
      new GLTFLoader().parse(b64ToBuffer(b64), '', (gltf) => {
        templates.set(type, gltf.scene);
        const sr = gfx && gfx.structures;          // 描画モジュールの StructureRenderer（公開の registerFactory を使う）
        if (sr && typeof sr.registerFactory === 'function') sr.registerFactory(type, () => cloneBuilding(type));
        resolve(true);
      }, (err) => { console.warn('建物モデルを読めなかった：' + type, err); failed.add(type); resolve(false); });
    } catch (e) { console.warn('建物モデルを読めなかった：' + type, e); failed.add(type); resolve(false); }
  });
  loading.set(type, pr);
  return pr;
}
/** 描画モジュールが動かさない可動部（ピストン・掘削軸・巻き上げドラム・ふいご）を動かす。車輪・炎はモジュールの既存のアニメーション */
function tickBuildingParts(time: number): void {
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i];
    if (!p.root.parent) { live.splice(i, 1); continue; }          // 取り除かれた建物
    const phase = p.wheel ? p.wheel.rotation.z : time * 0.6;
    if (p.piston) p.piston.position.x = p.pistonX + Math.sin(phase) * 0.18;
    if (p.drill) p.drill.rotation.y = time * 1.6;
    if (p.winch) p.winch.rotation.z = time * 0.7;
    if (p.bellows) p.bellows.scale.y = p.bellowsY * (0.96 + 0.04 * Math.sin(time * 3));
  }
}
/* ---------- 集落の人（NPC。Muse 第17ラウンドのシートは主人公と同じ 4×4） ----------
   描画モジュールに NPC 用の API はないので、主人公と同じ CharacterRenderer をここで作ってシーンに加える（Muse の案内：同じスプライト機構で使える）。
   向きはワールドの軸（down＝+Z）で渡す。行はモジュールがカメラから見た向きで選ぶ。絵を読み終えてから作る（読み込み前に作ると絵のない複製になる）。 */
type NpcState = { position: { x: number; z: number }; direction: 'down' | 'up' | 'left' | 'right'; moving: boolean };
const npcs = new Map<string, { r?: CharacterRenderer; state: NpcState; loading: boolean }>();
let npcShadow: THREE.Texture | null = null;
function npcSet(gfx: any, id: string, sheetUrl: string, shadowUrl: string, state: NpcState): void {
  let e = npcs.get(id);
  if (!e) { e = { state, loading: true }; npcs.set(id, e); const entry = e;
    const loader = new THREE.TextureLoader();
    if (!npcShadow) npcShadow = loader.load(shadowUrl);
    loader.load(sheetUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const cfg = (gfx.cfg && gfx.cfg.character) || DEFAULT_CONFIG.character, wcfg = gfx.cfg || DEFAULT_CONFIG;
      const r = new CharacterRenderer(tex, npcShadow!, cfg, (x: number, z: number) => terrainHeight(x, z, wcfg));
      r.setState(entry.state as any); entry.r = r; entry.loading = false;
      if (npcs.get(id) === entry) gfx.getScene().add(r.group); else { /* 読み込み中に取り除かれた */ }
    }, undefined, () => { entry.loading = false; console.warn('NPC の絵を読めなかった：' + id); });
  }
  e.state = state; if (e.r) e.r.setState(state as any);
}
function npcRemove(gfx: any, id: string): void { const e = npcs.get(id); if (!e) return; npcs.delete(id); if (e.r) gfx.getScene().remove(e.r.group); }
function npcTick(gfx: any, dt: number): void { const cam = gfx.getCamera(); npcs.forEach((e) => { if (e.r) e.r.update(dt, cam); }); }
const npcStatus = () => [...npcs.entries()].map(([id, e]) => ({ id, ready: !!e.r, x: e.r ? e.r.getRenderedPosition().x : null }));
const buildingModelStatus = () => ({ ready: [...templates.keys()], failed: [...failed], loading: [...loading.keys()].filter((k) => !templates.has(k) && !failed.has(k)) });
(window as any).HD2D = { attachWorld, initializeGraphics, terrainHeight, DEFAULT_CONFIG, resolveConfig, THREE, RESOURCE_VISUAL_SPECS, GPT_TEXTURES, BRANCH_TEXTURES,
  ensureBuildingModel, tickBuildingParts, buildingModelStatus, npcSet, npcRemove, npcTick, npcStatus };
window.dispatchEvent(new Event('hd2d-ready'));
