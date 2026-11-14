/* 街づくり・現地建設の仮表示（2026-11-14）。完成した建物は既存の正式モデル（StructureRenderer）で出し、
   ここでは「建設中の現場」と「道」だけを描く。Muse の工程別の正式な見た目（docs/construction/CONSTRUCTION-CONTRACT.md）が届いたら差し替える。
   ・予定地：四隅の杭と縄、入口の小旗。搬入中：資材の山（運んだ割合で増える）。施工中：足場と、工程の進みに合わせて高くなる仮の壁。
   ・道：2 マスの格子のマスを、地面の高さに合わせて少し浮かせた板（種類ごとに1つのメッシュにまとめる）。予定のマスは縁の線だけ。
   描画モジュール（src/graphics）は変えない。シーンへ自分の群れを足すだけ。 */
import * as THREE from 'three';

type Site = { id: string; x: number; z: number; rot: number; shape: 'rect' | 'circle'; w: number; d: number; r: number; phase: string; progress: number; supplied: number; tall: number; entrance?: [number, number] | null };
type Cell = { i: number; j: number; kind: string };
type Data = { sites: Site[]; roads: Cell[]; pending: (Cell & { phase: string })[]; cell: number; colors: Record<string, string> };
type Entry = { root: THREE.Group; sites: Map<string, { g: THREE.Group; sig: string }>; roadSig: string; roads: THREE.Group };
const entries = new WeakMap<object, Entry>();
const mats: Record<string, THREE.Material> = {};
const mat = (key: string, color: number | string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => mats[key] || (mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o }));
const BOX = new THREE.BoxGeometry(1, 1, 1);
function box(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  const b = new THREE.Mesh(BOX, m); b.position.set(x, y + sy / 2, z); b.scale.set(sx, sy, sz); b.rotation.y = ry; b.castShadow = true; b.receiveShadow = true; parent.add(b); return b; }

/* 形の外周の点（ローカル座標） */
function outline(s: Site): [number, number][] {
  if (s.shape === 'rect') { const hw = s.w / 2, hd = s.d / 2; return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; }
  return Array.from({ length: 8 }, (_, k) => [Math.cos(k / 8 * Math.PI * 2) * s.r, Math.sin(k / 8 * Math.PI * 2) * s.r] as [number, number]); }
function buildSite(s: Site, h: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group(); g.name = 'ConstructionSite:' + s.id;
  const co = Math.cos(s.rot), si = Math.sin(s.rot), w = (lx: number, lz: number) => ({ x: s.x + co * lx + si * lz, z: s.z - si * lx + co * lz });
  const stake = mat('stake', 0x8a6a45), rope = mat('rope', 0xd8c27a), flag = mat('flag', 0xc38a2e), wood = mat('scaffold', 0xb08a5a), wall = mat('wall', 0xe8dfc8, { transparent: true, opacity: 0.75 });
  const pts = outline(s);
  pts.forEach(([lx, lz], k) => { const p = w(lx, lz), q = w(...pts[(k + 1) % pts.length]), y0 = h(p.x, p.z), y1 = h(q.x, q.z);
    box(g, stake, p.x, y0 - 0.05, p.z, 0.12, 0.75, 0.12);
    const len = Math.hypot(q.x - p.x, q.z - p.z), ang = Math.atan2(q.x - p.x, q.z - p.z);
    const r = box(g, rope, (p.x + q.x) / 2, (y0 + y1) / 2 + 0.5, (p.z + q.z) / 2, 0.04, 0.04, len, ang); r.castShadow = false; });
  if (s.entrance) { const e = w(s.entrance[0], s.entrance[1]), y = h(e.x, e.z); box(g, stake, e.x, y, e.z, 0.06, 1.1, 0.06); box(g, flag, e.x + 0.18, y + 0.8, e.z, 0.32, 0.2, 0.03); }
  /* 資材の山（運んだ割合で 1〜6 個） */
  const piles = s.phase === 'completed' ? 0 : Math.round(Math.min(1, s.supplied) * 6);
  for (let k = 0; k < piles; k++) { const lx = (s.shape === 'rect' ? s.w / 2 : s.r) + 0.6, lz = -0.9 + k * 0.38, p = w(lx, lz); box(g, mat('pile' + (k % 3), [0x7a5636, 0x9aa1a8, 0xb24a32][k % 3]), p.x, h(p.x, p.z), p.z, 0.45, 0.28 + (k % 2) * 0.12, 0.32); }
  /* 施工中：足場の柱と、進みに合わせて高くなる仮の壁 */
  if (s.phase === 'constructing') {
    const H = Math.max(0.25, s.progress * s.tall), y = h(s.x, s.z);
    pts.forEach(([lx, lz]) => { const p = w(lx * 1.04, lz * 1.04); box(g, wood, p.x, h(p.x, p.z), p.z, 0.1, H + 0.6, 0.1); });
    const body = new THREE.Group(); body.position.set(s.x, y, s.z); body.rotation.y = s.rot; g.add(body);
    if (s.shape === 'rect') box(body, wall, 0, 0, 0, s.w * 0.92, H, s.d * 0.92); else { const c = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.9, s.r * 0.9, H, 12), wall); c.position.y = H / 2; c.castShadow = true; body.add(c); }
  }
  return g; }

/* 道：種類ごとに、マスを地面に沿わせた板を1つのメッシュへまとめる。予定のマスは縁の線 */
function buildRoads(d: Data, h: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group(); g.name = 'ConstructionRoads';
  const byKind: Record<string, Cell[]> = {}; d.roads.forEach(c => (byKind[c.kind] = byKind[c.kind] || []).push(c));
  const N = 4, half = d.cell / 2;
  for (const [kind, cells] of Object.entries(byKind)) {
    const pos: number[] = [], idx: number[] = [];
    cells.forEach(c => { const cx = c.i * d.cell, cz = c.j * d.cell, base = pos.length / 3;
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) { const x = cx - half + d.cell * a / N, z = cz - half + d.cell * b / N; pos.push(x, h(x, z) + 0.05, z); }
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { const p = base + a * (N + 1) + b; idx.push(p, p + 1, p + N + 1, p + 1, p + N + 2, p + N + 1); } });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: d.colors[kind] || '#8a6a45', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; mesh.name = 'Road:' + kind; g.add(mesh); }
  const line = mat('roadplan', 0xc38a2e);
  d.pending.forEach(c => { const cx = c.i * d.cell, cz = c.j * d.cell;
    for (const [dx, dz, rot] of [[0, -half, Math.PI / 2], [0, half, Math.PI / 2], [-half, 0, 0], [half, 0, 0]] as [number, number, number][]) { const x = cx + dx, z = cz + dz; const b = box(g, line, x, h(x, z) + 0.04, z, 0.06, 0.04, d.cell * 0.8, rot); b.castShadow = false; } });
  return g; }

export function syncConstructionVisual(gfx: any, d: Data, heightAt: (x: number, z: number) => number): void {
  const scene: THREE.Scene | undefined = gfx && typeof gfx.getScene === 'function' ? gfx.getScene() : undefined; if (!scene) return;
  let e = entries.get(gfx);
  if (!e) { const root = new THREE.Group(); root.name = 'ConstructionVisual'; scene.add(root); e = { root, sites: new Map(), roadSig: '', roads: new THREE.Group() }; root.add(e.roads); entries.set(gfx, e); }
  const seen = new Set<string>();
  for (const s of d.sites) { seen.add(s.id); const sig = [s.x, s.z, s.rot, s.phase, Math.round(s.progress * 20), Math.round(Math.min(1, s.supplied) * 6)].join('|');
    const cur = e.sites.get(s.id); if (cur && cur.sig === sig) continue;
    if (cur) { e.root.remove(cur.g); dispose(cur.g); }
    const g = buildSite(s, heightAt); e.root.add(g); e.sites.set(s.id, { g, sig }); }
  for (const [id, cur] of e.sites) if (!seen.has(id)) { e.root.remove(cur.g); dispose(cur.g); e.sites.delete(id); }
  const rsig = d.roads.map(c => c.i + ',' + c.j + c.kind).join(';') + '|' + d.pending.map(c => c.i + ',' + c.j).join(';');
  if (rsig !== e.roadSig) { e.roadSig = rsig; e.root.remove(e.roads); dispose(e.roads, true); e.roads = buildRoads(d, heightAt); e.root.add(e.roads); }
}
/* 共有の箱と材質は捨てない。道の形と材質（毎回作る）だけ捨てる */
function dispose(g: THREE.Object3D, _own = false) { const shared = new Set(Object.values(mats)); g.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.geometry !== BOX) m.geometry.dispose(); const mm = m.material as THREE.Material; if (!shared.has(mm)) mm.dispose(); }); }
export const constructionVisualStatus = () => ({ placeholder: true });
