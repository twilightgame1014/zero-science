/* 街づくり・現地建設の現場と道の表示（2026-11-14）。完成した建物と、施工の途中の建物のノード（工程別）は描画モジュールの StructureRenderer
   （graphics-entry.ts の ensureBuildingModel・stagedBuildingType）。ここでは「現場の周り」と「道」を描く。
   Muse の正式素材（assets/construction の軽量版 ASSETS.consKit。契約は docs/construction/CONSTRUCTION-CONTRACT.md の「Muse の納品」節）：
   ・予定地キット：杭・縄・地面の輪郭（単位 1×1）を占有範囲の外 0.5 に並べる。円形は半径 r+0.5 の 8 点。
   ・資材の山 5 種：運んだ割合で 1〜6 個、現場の +X 側に並べる。種類は「まだ運んでいない資材」から（ゲームが kinds で渡す）。
   ・足場キット（Scaffold_Post/Beam/Plank/Brace/Ladder）：施工中だけ。規則は construction-stage.ts の scaffoldPlan。
   ・道：2×2 マスの板を地面に沿わせ、マスごとに UV（0〜1）でテクスチャを 1 回。外側の縁 0.18 m を頂点色で 12% 暗くする。法線テクスチャは normalScale 0.5。
   キットがまだ読めていない・読めないときは、以前の仮表示（箱の杭・縄・山・足場・仮の壁、色の板の道）。描画モジュール（src/graphics）は変えない。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareShared } from './world/natureModels';
import { scaffoldPlan, pileKind } from './construction-stage';

type Site = { id: string; x: number; z: number; rot: number; shape: 'rect' | 'circle'; w: number; d: number; r: number; phase: string; progress: number; supplied: number; tall: number;
  entrance?: [number, number] | null; formal?: boolean; stage?: number; stages?: number; height?: number; piles?: string[] };
type Cell = { i: number; j: number; kind: string };
type Data = { sites: Site[]; roads: Cell[]; pending: (Cell & { phase: string })[]; cell: number; colors: Record<string, string>; textures?: Record<string, string>; normals?: Record<string, string> };
type Entry = { root: THREE.Group; sites: Map<string, { g: THREE.Group; sig: string }>; roadSig: string; roads: THREE.Group };
const entries = new WeakMap<object, Entry>();
const mats: Record<string, THREE.Material> = {};
const mat = (key: string, color: number | string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => mats[key] || (mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o }));
const BOX = new THREE.BoxGeometry(1, 1, 1);
function box(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  const b = new THREE.Mesh(BOX, m); b.position.set(x, y + sy / 2, z); b.scale.set(sx, sy, sz); b.rotation.y = ry; b.castShadow = true; b.receiveShadow = true; parent.add(b); return b; }

/* ---------- Muse のキット（GLB を一度だけ解析して雛形に。複製はジオメトリと材質を共有する＝現場の部品は数が多く、フェードもしないため） ---------- */
type Kit = { status: 'none' | 'loading' | 'ready' | 'failed'; parts: Map<string, THREE.Object3D>; piles: Map<string, THREE.Object3D>; tris: number };
const kit: Kit = { status: 'none', parts: new Map(), piles: new Map(), tris: 0 };
let kitWaiters: (() => void)[] = [];
function b64(s: string): ArrayBuffer { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
function loadKit(onReady: () => void): void {
  if (kit.status === 'ready' || kit.status === 'failed') return;
  kitWaiters.push(onReady); if (kit.status === 'loading') return;
  const src: Record<string, string> | undefined = (window as any).ASSETS?.consKit;
  if (!src || !src['construction-site'] || !src['scaffold-kit']) { kit.status = 'failed'; return; }
  kit.status = 'loading';
  const loader = new GLTFLoader();
  Promise.all(Object.entries(src).map(([id, data]) => loader.parseAsync(b64(data), '').then((g) => [id, g.scene] as const)))
    .then((list) => {
      for (const [id, scene] of list) {
        prepareShared(scene); scene.updateMatrixWorld(true);
        scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; const pos = m.geometry.getAttribute('position'); kit.tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3; } });
        if (id.startsWith('pile-')) kit.piles.set(id.slice(5), scene);
        else scene.traverse((c) => { if (c !== scene && c.name && !kit.parts.has(c.name)) kit.parts.set(c.name, c); });   // 予定地キット（stakePP…）・足場キット（Scaffold_*）はノード名で部品を引く
      }
      kit.status = 'ready'; const w = kitWaiters; kitWaiters = []; w.forEach((f) => f());
    })
    .catch((e) => { console.warn('街づくりの素材を読めなかった（仮表示のまま）', e); kit.status = 'failed'; });
}
function part(name: string): THREE.Object3D | null { const p = kit.parts.get(name); return p ? p.clone(true) : null; }

/* 形の外周の点（ローカル座標） */
function outline(s: Site, pad = 0): [number, number][] {
  if (s.shape === 'rect') { const hw = s.w / 2 + pad, hd = s.d / 2 + pad; return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; }
  return Array.from({ length: 8 }, (_, k) => [Math.cos(k / 8 * Math.PI * 2) * (s.r + pad), Math.sin(k / 8 * Math.PI * 2) * (s.r + pad)] as [number, number]); }

/* ---------- 正式：予定地キット・資材の山・足場 ---------- */
function buildSiteFormal(s: Site, h: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group(); g.name = 'ConstructionSite:' + s.id; g.userData.formal = true;
  const co = Math.cos(s.rot), si = Math.sin(s.rot), W = (lx: number, lz: number) => ({ x: s.x + co * lx + si * lz, z: s.z - si * lx + co * lz });
  const put = (o: THREE.Object3D | null, lx: number, lz: number, ry = 0, sc?: [number, number, number], dy = 0) => {
    if (!o) return null; const p = W(lx, lz); o.position.set(p.x, h(p.x, p.z) + dy, p.z); o.rotation.y = s.rot + ry; if (sc) o.scale.set(sc[0], sc[1], sc[2]); g.add(o); return o; };
  /* 予定地キット：長方形は契約の配置式。杭は名前の P/M＝X・Z の符号 */
  if (s.shape === 'rect') {
    const ax = s.w / 2 + 0.5, az = s.d / 2 + 0.5;
    for (const [n, sx, sz] of [['stakePP', 1, 1], ['stakePM', 1, -1], ['stakeMP', -1, 1], ['stakeMM', -1, -1]] as [string, number, number][]) put(part(n), sx * ax, sz * az);
    for (const pre of ['rope', 'outline']) {
      put(part(pre + 'X_P'), 0, az, 0, [s.w + 1, 1, 1]); put(part(pre + 'X_M'), 0, -az, 0, [s.w + 1, 1, 1]);
      put(part(pre + 'Y_P'), ax, 0, 0, [1, 1, s.d + 1]); put(part(pre + 'Y_M'), -ax, 0, 0, [1, 1, s.d + 1]); }
  } else {
    /* 円形：半径 r+0.5 の 8 点に杭、点どうしを縄（ropeX を区間の長さに伸ばして向ける） */
    const pts = outline(s, 0.5);
    pts.forEach(([lx, lz], k) => { put(part('stakePP'), lx, lz);
      const [qx, qz] = pts[(k + 1) % pts.length], len = Math.hypot(qx - lx, qz - lz), ang = Math.atan2(-(qz - lz), qx - lx);
      for (const pre of ['ropeX_P', 'outlineX_P']) { const o = part(pre); if (o) { o.position.set(0, 0, 0); put(o, (lx + qx) / 2, (lz + qz) / 2, ang, [len, 1, 1]); } } });
  }
  /* 資材の山：運んだ割合で 1〜6 個、+X 側に並べる（種類はゲームが「まだ運んでいない資材」から決めた並び） */
  const n = s.phase === 'completed' ? 0 : Math.round(Math.min(1, s.supplied) * 6), kinds = s.piles && s.piles.length ? s.piles.map(pileKind) : ['crated'];
  for (let k = 0; k < n; k++) { const src = kit.piles.get(kinds[k % kinds.length]) || kit.piles.get('crated'); if (!src) break;
    const lx = (s.shape === 'rect' ? s.w / 2 : s.r) + 1.0 + Math.floor(k / 3) * 1.1, lz = -1.1 + (k % 3) * 1.1;
    put(src.clone(true), lx, lz, (k * 0.7) % 1.2); }
  /* 足場：施工中だけ */
  if (s.phase === 'constructing') {
    const N = Math.max(1, s.stages || 1), k = Math.max(0, Math.min(N - 1, s.stage || 0)), P = scaffoldPlan(s.shape, s.w, s.d, s.r, k, N, s.height || s.tall);
    const yAt = (lx: number, lz: number) => { const p = W(lx, lz); return h(p.x, p.z); };
    for (const [lx, lz] of P.posts) put(part('Scaffold_Post'), lx, lz, 0, [1, P.H / 3.0, 1]);
    for (const sg of P.segs) { const mx = (sg.a[0] + sg.b[0]) / 2, mz = (sg.a[1] + sg.b[1]) / 2, len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]), ang = Math.atan2(-(sg.b[1] - sg.a[1]), sg.b[0] - sg.a[0]);
      const base = Math.min(yAt(sg.a[0], sg.a[1]), yAt(sg.b[0], sg.b[1])) - yAt(mx, mz);
      for (const lv of P.levels) put(part('Scaffold_Beam'), mx, mz, ang, [len, 1, 1], base + lv); }
    for (const sg of P.planks) { const mx = (sg.a[0] + sg.b[0]) / 2, mz = (sg.a[1] + sg.b[1]) / 2, len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]), ang = Math.atan2(-(sg.b[1] - sg.a[1]), sg.b[0] - sg.a[0]);
      const base = Math.min(yAt(sg.a[0], sg.a[1]), yAt(sg.b[0], sg.b[1])) - yAt(mx, mz); put(part('Scaffold_Plank'), mx, mz, ang, [len, 1, 1], base + P.top + 0.08); }
    for (const sg of P.braces) { const lv = P.levels[0], mx = (sg.a[0] + sg.b[0]) / 2, mz = (sg.a[1] + sg.b[1]) / 2, len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]), ang = Math.atan2(-(sg.b[1] - sg.a[1]), sg.b[0] - sg.a[0]);
      const o = part('Scaffold_Brace'); if (!o) continue; const base = Math.min(yAt(sg.a[0], sg.a[1]), yAt(sg.b[0], sg.b[1])) - yAt(mx, mz);
      o.rotation.order = 'YZX'; put(o, mx, mz, ang, [Math.hypot(len, lv), 1, 1], base + lv / 2); o.rotation.z = Math.atan2(lv, len); }
    put(part('Scaffold_Ladder'), P.ladder[0], P.ladder[1] + 0.25, 0, [1, P.H / 3.0, 1]);
  }
  return g; }

/* 現場の部品（杭・縄・足場・山で 100 前後のメッシュ）を、材質ごとに 1 つへまとめる（描画の回数を減らす。スマホの負荷）。
   部品は動かないので、位置をジオメトリへ焼きこむ。属性の組合せが違う物は別にまとめる。まとめた形は現場を消すときに捨てる（材質は共有のまま） */
function mergeStatic(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.visible || Array.isArray(m.material)) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld), key = (m.material as THREE.Material).uuid + '|' + Object.keys(geo.attributes).sort().join(',') + '|' + (geo.index ? 'i' : 'n');
    const e = groups.get(key) || { mat: m.material as THREE.Material, geos: [], shadow: m.castShadow }; e.geos.push(geo); groups.set(key, e); });
  const out = new THREE.Group(); out.name = g.name; out.userData.formal = true;
  for (const e of groups.values()) { const merged = e.geos.length > 1 ? mergeGeometries(e.geos, false) : e.geos[0];
    if (!merged) { e.geos.forEach((x) => { const me = new THREE.Mesh(x, e.mat); me.castShadow = e.shadow; me.receiveShadow = true; out.add(me); }); continue; }
    if (merged !== e.geos[0]) e.geos.forEach((x) => x.dispose());
    const me = new THREE.Mesh(merged, e.mat); me.castShadow = e.shadow; me.receiveShadow = true; out.add(me); }
  return out; }

/* ---------- 仮表示（キットが読めないとき。以前のまま） ---------- */
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
  const piles = s.phase === 'completed' ? 0 : Math.round(Math.min(1, s.supplied) * 6);
  for (let k = 0; k < piles; k++) { const lx = (s.shape === 'rect' ? s.w / 2 : s.r) + 0.6, lz = -0.9 + k * 0.38, p = w(lx, lz); box(g, mat('pile' + (k % 3), [0x7a5636, 0x9aa1a8, 0xb24a32][k % 3]), p.x, h(p.x, p.z), p.z, 0.45, 0.28 + (k % 2) * 0.12, 0.32); }
  if (s.phase === 'constructing' && !s.formal) {
    const H = Math.max(0.25, s.progress * s.tall), y = h(s.x, s.z);
    pts.forEach(([lx, lz]) => { const p = w(lx * 1.04, lz * 1.04); box(g, wood, p.x, h(p.x, p.z), p.z, 0.1, H + 0.6, 0.1); });
    const body = new THREE.Group(); body.position.set(s.x, y, s.z); body.rotation.y = s.rot; g.add(body);
    if (s.shape === 'rect') box(body, wall, 0, 0, 0, s.w * 0.92, H, s.d * 0.92); else { const c = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.9, s.r * 0.9, H, 12), wall); c.position.y = H / 2; c.castShadow = true; body.add(c); }
  }
  return g; }

/* ---------- 道 ---------- */
const roadTex = new Map<string, THREE.Texture>();
function roadTexture(url?: string, color = true): THREE.Texture | null {
  if (!url) return null; let t = roadTex.get(url);
  if (!t) { t = new THREE.TextureLoader().load(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; roadTex.set(url, t); }
  return t; }
/* 1 マスの中の頂点の位置（0〜cell）。縁 0.18 m のフェードのため、縁の内側にも頂点を置く */
const FADE = 0.18, DARK = 0.88;
function cellStops(cell: number): number[] { return [0, FADE, cell * 0.25, cell * 0.5, cell * 0.75, cell - FADE, cell]; }
function buildRoads(d: Data, h: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group(); g.name = 'ConstructionRoads';
  const byKind: Record<string, Cell[]> = {}; d.roads.forEach(c => (byKind[c.kind] = byKind[c.kind] || []).push(c));
  const all = new Set(d.roads.map(c => c.i + ',' + c.j)), half = d.cell / 2, st = cellStops(d.cell), N = st.length - 1;
  for (const [kind, cells] of Object.entries(byKind)) {
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    cells.forEach(c => { const cx = c.i * d.cell, cz = c.j * d.cell, base = pos.length / 3;
      const open = { xm: !all.has((c.i - 1) + ',' + c.j), xp: !all.has((c.i + 1) + ',' + c.j), zm: !all.has(c.i + ',' + (c.j - 1)), zp: !all.has(c.i + ',' + (c.j + 1)) };
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) { const ox = st[a], oz = st[b], x = cx - half + ox, z = cz - half + oz;
        pos.push(x, h(x, z) + 0.05, z); uv.push(ox / d.cell, 1 - oz / d.cell);
        /* 道の外側の縁（隣が道でない辺）から 0.18 m で 12% 暗く。隣も道なら境目を作らない */
        const e = Math.min(open.xm ? ox : 9, open.xp ? d.cell - ox : 9, open.zm ? oz : 9, open.zp ? d.cell - oz : 9), k = e >= FADE ? 1 : DARK + (1 - DARK) * (e / FADE);
        col.push(k, k, k); }
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { const p = base + a * (N + 1) + b; idx.push(p, p + 1, p + N + 1, p + 1, p + N + 2, p + N + 1); } });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const map = roadTexture(d.textures && d.textures[kind]), nmap = map ? roadTexture(d.normals && d.normals[kind], false) : null;
    const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : (d.colors[kind] || '#8a6a45'), map: map || null, normalMap: nmap || null, vertexColors: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (nmap) m.normalScale.set(0.5, 0.5);
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; mesh.name = 'Road:' + kind; g.add(mesh); }
  const line = mat('roadplan', 0xc38a2e);
  d.pending.forEach(c => { const cx = c.i * d.cell, cz = c.j * d.cell;
    for (const [dx, dz, rot] of [[0, -half, Math.PI / 2], [0, half, Math.PI / 2], [-half, 0, 0], [half, 0, 0]] as [number, number, number][]) { const x = cx + dx, z = cz + dz; const b = box(g, line, x, h(x, z) + 0.04, z, 0.06, 0.04, d.cell * 0.8, rot); b.castShadow = false; } });
  return g; }

export function syncConstructionVisual(gfx: any, d: Data, heightAt: (x: number, z: number) => number): void {
  const scene: THREE.Scene | undefined = gfx && typeof gfx.getScene === 'function' ? gfx.getScene() : undefined; if (!scene) return;
  let e = entries.get(gfx);
  if (!e) { const root = new THREE.Group(); root.name = 'ConstructionVisual'; scene.add(root); e = { root, sites: new Map(), roadSig: '', roads: new THREE.Group() }; root.add(e.roads); entries.set(gfx, e); }
  const ent = e;
  if (kit.status === 'none' || kit.status === 'loading') loadKit(() => { ent.sites.forEach((c) => { c.sig = ''; }); syncConstructionVisual(gfx, d, heightAt); });
  const formal = kit.status === 'ready', seen = new Set<string>();
  for (const s of d.sites) { seen.add(s.id);
    const sig = [s.x, s.z, s.rot, s.phase, Math.round(s.progress * 20), Math.round(Math.min(1, s.supplied) * 6), s.formal ? 1 : 0, formal ? 1 : 0, s.stage ?? '', (s.piles || []).join(',')].join('|');
    const cur = e.sites.get(s.id); if (cur && cur.sig === sig) continue;
    if (cur) { e.root.remove(cur.g); dispose(cur.g); }
    const g = formal ? mergeStatic(buildSiteFormal(s, heightAt)) : buildSite(s, heightAt); e.root.add(g); e.sites.set(s.id, { g, sig }); }
  for (const [id, cur] of e.sites) if (!seen.has(id)) { e.root.remove(cur.g); dispose(cur.g); e.sites.delete(id); }
  const rsig = d.roads.map(c => c.i + ',' + c.j + c.kind).join(';') + '|' + d.pending.map(c => c.i + ',' + c.j).join(';') + '|' + Object.keys(d.textures || {}).join(',');
  if (rsig !== e.roadSig) { e.roadSig = rsig; e.root.remove(e.roads); dispose(e.roads); e.roads = buildRoads(d, heightAt); e.root.add(e.roads); }
}
/* 共有の箱と材質・キットの雛形（複製はジオメトリと材質を共有）は捨てない。道の形と材質（毎回作る）だけ捨てる */
function dispose(g: THREE.Object3D) {
  if (g.userData.formal) { g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); return; }   // まとめた形だけ捨てる（材質はキットと共有）
  const shared = new Set(Object.values(mats)); g.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.geometry !== BOX) m.geometry.dispose(); const mm = m.material as THREE.Material; if (!shared.has(mm)) mm.dispose(); }); }
export const constructionVisualStatus = () => ({ kit: kit.status, kitParts: kit.parts.size, piles: [...kit.piles.keys()], kitTris: Math.round(kit.tris), roadTextures: roadTex.size, placeholder: kit.status !== 'ready' });
