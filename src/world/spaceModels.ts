/* 宇宙計画の仮モデル（2026-11-13）。
   地上設備（電力供給設備・組立棟・発射台・支持塔・管制端末）と、組立の段階ごとの機体、宇宙服の印を、
   かんたんな立体で作って描画モジュールの StructureRenderer.registerFactory に登録する（描画モジュールのファイルは変えない）。
   正式なモデルは Muse の納品待ち（契約は docs/handoff/MUSE-SPACE-MODEL-CONTRACT.md）。同じ種類名（space-*）で GLB を
   登録し直せば、ゲーム側の ID・セーブ・当たり判定はそのままで差し替わる。 */
import * as THREE from 'three';

const M = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...o });
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);
const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 16) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z);

/* 鉄骨の塔（4本の柱と横の桟） */
function lattice(w: number, h: number, mat: THREE.Material, step = 1.4): THREE.Group {
  const g = new THREE.Group(), r = w / 2, t = 0.12;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(t, h, t, mat, sx * r, 0, sz * r));
  for (let y = step; y <= h; y += step) { g.add(box(w, t * 0.8, t * 0.8, mat, 0, y, -r), box(w, t * 0.8, t * 0.8, mat, 0, y, r), box(t * 0.8, t * 0.8, w, mat, -r, y, 0), box(t * 0.8, t * 0.8, w, mat, r, y, 0)); }
  return g;
}

export const PAD_TOP = 0.5;        // 発射台の上面の高さ（機体はこの上に立つ）
export const ROCKET_H = 10.2;      // 機体の高さ（外装まで付けたとき）
function makePad(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Space:pad';
  const conc = M(0x9a968c), dark = M(0x4a4f57, { metalness: 0.4 }), warn = M(0xd8a534);
  g.add(cyl(3.2, 3.4, PAD_TOP, conc, 0, 0, 0, 28));
  g.add(cyl(1.15, 1.15, 0.06, dark, 0, PAD_TOP, 0, 20));                        // 噴射の受け口
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.add(box(0.3, 1.1, 0.3, dark, Math.cos(a) * 1.25, PAD_TOP, Math.sin(a) * 1.25)); }   // 支え
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.add(box(0.5, 0.03, 0.16, warn, Math.cos(a) * 2.9, PAD_TOP, Math.sin(a) * 2.9)); }
  return g;
}
function makeTower(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Space:tower';
  const steel = M(0xb5482f, { metalness: 0.3 }), deck = M(0x6b727b, { metalness: 0.4 });
  g.add(lattice(1.9, 11, steel));
  g.add(box(2.2, 0.14, 2.2, deck, 0, 8.6, 0), box(2.3, 0.3, 2.3, M(0x8d8a82), 0, 0, 0));
  /* 搭乗通路（Arm）：+Z へのびる。向きと長さはゲームが機体の位置から決める（spaceTowerAim）。縮めると退避 */
  const arm = new THREE.Group(); arm.name = 'SpaceArm'; arm.position.y = 8.6;
  const walk = box(0.9, 0.12, 1, deck, 0, 0, 0.5), rail1 = box(0.06, 0.5, 1, steel, -0.45, 0.1, 0.5), rail2 = box(0.06, 0.5, 1, steel, 0.45, 0.1, 0.5);
  arm.add(walk, rail1, rail2); arm.userData.len = 4; arm.scale.z = 4; g.add(arm);
  g.add(cyl(0.05, 0.05, 1.6, deck, 0, 11, 0, 6));
  return g;
}
function makeAssembly(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Space:assembly';
  const wall = M(0xd6d2c4), roof = M(0x5d6670, { metalness: 0.3 }), door = M(0x3a4654), crane = M(0xd8a534, { metalness: 0.3 });
  g.add(box(7, 4.6, 5.4, wall), box(7.3, 0.35, 5.7, roof, 0, 4.6, 0));
  g.add(box(2.6, 3.6, 0.1, door, 0, 0, 2.72));                                  // 大きな扉（+Z が正面）
  g.add(box(6.4, 0.3, 0.3, crane, 0, 4.95, 1.2), box(0.5, 0.5, 0.5, crane, 1.2, 5.2, 1.2));
  for (const x of [-3.5, 3.5]) g.add(box(0.2, 4.6, 0.2, roof, x, 0, 2.7));
  return g;
}
function makeControl(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Space:control';
  const body = M(0x4a5560, { metalness: 0.3 }), scr = M(0x7fd0ff, { emissive: 0x1d5f7f, roughness: 0.3 }), dish = M(0xe6e8ea, { metalness: 0.4 });
  g.add(box(2.6, 0.9, 1.3, body, 0, 0, -0.2), box(2.2, 0.9, 0.12, body, 0, 0.9, -0.75), box(1.8, 0.6, 0.04, scr, 0, 1.05, -0.67));
  for (let i = 0; i < 5; i++) g.add(box(0.16, 0.05, 0.16, M(i % 2 ? 0x3fbf62 : 0xd8a534, { emissive: 0x223300 }), -0.8 + i * 0.4, 0.9, 0.05));
  g.add(cyl(0.05, 0.05, 2.2, body, 1.05, 0, -0.6, 6));
  const d = mesh(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), dish, 1.05, 2.3, -0.6); d.rotation.x = Math.PI * 0.72; g.add(d);
  return g;
}
function makeSubstation(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Space:substation';
  const base = M(0x9a968c), tr = M(0x566271, { metalness: 0.4 }), ins = M(0xe9e2d1), pole = M(0x6b4a2f);
  g.add(box(3.2, 0.2, 2.6, base));
  for (const x of [-0.8, 0.8]) { g.add(box(1.0, 1.3, 0.9, tr, x, 0.2, 0)); for (const z of [-0.25, 0.25]) g.add(cyl(0.07, 0.1, 0.45, ins, x, 1.5, z, 8)); }
  g.add(box(0.8, 0.8, 0.5, M(0x3f8f4a), 0, 0.2, 0.9));                           // 蓄電池の箱
  for (const x of [-1.45, 1.45]) { g.add(cyl(0.08, 0.1, 4.2, pole, x, 0, -1.1, 8)); g.add(box(0.9, 0.08, 0.08, pole, x, 3.9, -1.1)); }
  return g;
}
/* 機体：code のビット（1＝機体構造、2＝推進モジュール、4＝搭乗カプセル、8＝外装）で、取りつけた部分だけを出す */
function makeRocket(code: number): THREE.Group {
  const g = new THREE.Group(); g.name = 'Space:rocket';
  const body = new THREE.Group(); body.name = 'SpaceRocketBody'; body.position.y = PAD_TOP; g.add(body);
  const steel = M(0x8a949e, { metalness: 0.5 }), white = M(0xeef1f4, { roughness: 0.5 }), orange = M(0xd9792b), dark = M(0x3a4654, { metalness: 0.4 });
  const R = 0.85;
  if (code & 1) {                                                               // 骨組み（外装がなければ中が見える）
    const f = lattice(R * 1.5, 6.2, steel, 1.0); f.position.y = 1.6; body.add(f);
    for (const y of [1.6, 4.6, 7.8]) body.add(cyl(R, R, 0.1, steel, 0, y, 0, 16));
  }
  if (code & 2) {                                                               // 推進モジュール（架空）：タンク2つとノズル
    body.add(cyl(0.6, 0.6, 1.6, M(0xc9ced4, { metalness: 0.5 }), 0, 1.9, 0), cyl(0.6, 0.6, 1.5, M(0xc9ced4, { metalness: 0.5 }), 0, 3.7, 0));
    body.add(cyl(0.3, 0.62, 1.2, dark, 0, 0.3, 0, 14), cyl(0.5, 0.5, 0.35, dark, 0, 1.5, 0, 14));
  }
  if (code & 4) {                                                               // 搭乗カプセル
    body.add(cyl(0.45, R, 1.5, M(0xd8dde2, { metalness: 0.3 }), 0, 7.9, 0));
    body.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), M(0x7fd0ff, { emissive: 0x1d5f7f }), 0, 8.5, 0.62));
  }
  if (code & 8) {                                                               // 外装と先たん
    body.add(cyl(R + 0.03, R + 0.03, 6.3, white, 0, 1.55, 0, 20), cyl(R + 0.03, 0.7, 0.4, dark, 0, 1.15, 0, 20));
    body.add(cyl(0.05, R + 0.03, 1.55, white, 0, 7.85, 0, 20), cyl(0.02, 0.2, 0.5, orange, 0, 9.3, 0, 10));
    body.add(box(R * 2.1, 0.5, 0.04, orange, 0, 5.4, 0));
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3, fin = box(0.06, 1.4, 0.8, orange, Math.cos(a) * (R + 0.35), 1.2, Math.sin(a) * (R + 0.35)); fin.rotation.y = -a + Math.PI / 2; body.add(fin); }
  }
  /* 噴射（打ち上げ演出のときだけ見せる） */
  const flame = mesh(new THREE.ConeGeometry(0.55, 3.4, 14), new THREE.MeshBasicMaterial({ color: 0xffc061, transparent: true, opacity: 0.9, depthWrite: false }), 0, -1.5, 0);
  flame.rotation.x = Math.PI; flame.name = 'SpaceFlame'; flame.visible = false; flame.castShadow = false; body.add(flame);
  return g;
}

let installed = false;
/** 仮モデルを登録する（同じ種類名で GLB を後から登録すれば差し替わる） */
export function installSpaceModels(gfx: any): boolean {
  const sr = gfx && gfx.structures; if (!sr || typeof sr.registerFactory !== 'function') return false;
  if (installed) return true; installed = true;
  sr.registerFactory('space-pad', makePad); sr.registerFactory('space-tower', makeTower); sr.registerFactory('space-assembly', makeAssembly);
  sr.registerFactory('space-control', makeControl); sr.registerFactory('space-substation', makeSubstation);
  for (let c = 1; c < 16; c++) sr.registerFactory('space-rocket-' + c, () => makeRocket(c));
  return true;
}
const inst = (gfx: any, id: string): THREE.Object3D | undefined => { const sr = gfx && gfx.structures; return sr && sr.instances ? sr.instances.get(id) : undefined; };
/** 支持塔の通路を、機体（発射台）のほうへ向ける。長さは機体の手前まで */
export function spaceTowerAim(gfx: any, towerId: string, x: number, z: number): void {
  const t = inst(gfx, towerId); if (!t) return; const arm = t.getObjectByName('SpaceArm'); if (!arm) return;
  const dx = x - t.position.x, dz = z - t.position.z, d = Math.hypot(dx, dz);
  arm.rotation.y = Math.atan2(dx, dz) - t.rotation.y;
  arm.userData.len = Math.max(1.2, Math.min(8, d - 1.9)); arm.scale.z = arm.userData.len;
}
/** 打ち上げ演出：機体の上昇（lift）・噴射（flame）・通路の退避（arm 0〜1） */
export function spaceAnim(gfx: any, o: { rocket: string; tower: string; lift: number; flame: boolean; arm: number; time: number }): void {
  const r = inst(gfx, o.rocket);
  if (r) { const b = r.getObjectByName('SpaceRocketBody'); if (b) b.position.y = PAD_TOP + (o.lift || 0);
    const f = r.getObjectByName('SpaceFlame'); if (f) { f.visible = !!o.flame; if (o.flame) { const k = 1 + Math.sin(o.time * 40) * 0.12; f.scale.set(k, 1 + Math.sin(o.time * 31) * 0.18, k); } } }
  const t = inst(gfx, o.tower), arm = t && t.getObjectByName('SpaceArm');
  if (arm) arm.scale.z = Math.max(0.25, (arm.userData.len || 4) * (1 - 0.85 * Math.max(0, Math.min(1, o.arm || 0))));
}
/* 宇宙服の仮の印：頭のまわりの透明なヘルメットと、背中の生命維持ユニット。主人公の絵（男女どちらでも）に重ねるだけで、絵そのものは変えない */
let suit: THREE.Group | null = null;
export function spaceSuit(gfx: any, on: boolean, x: number, y: number, z: number, time: number): void {
  const scene: THREE.Scene | undefined = gfx && typeof gfx.getScene === 'function' ? gfx.getScene() : undefined; if (!scene) return;
  if (!on) { if (suit) suit.visible = false; return; }
  if (!suit) {
    suit = new THREE.Group(); suit.name = 'SpaceSuitMark';
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, roughness: 0.15, metalness: 0.1, depthWrite: false }));
    helm.position.y = 1.18; helm.renderOrder = 6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 20), new THREE.MeshStandardMaterial({ color: 0xd9792b })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.95;
    suit.add(helm, ring); scene.add(suit);
  }
  suit.visible = true; suit.position.set(x, y + Math.sin(time * 2) * 0.005, z);
}
export function spaceModelStatus(): { installed: boolean; placeholder: true } { return { installed, placeholder: true }; }
