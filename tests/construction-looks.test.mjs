// 外観違い（倉庫→大きな倉庫・作業台→工房の建物）の検査（2026-11-15 Claude）。
// 正式寸法での設置判定・以前のセーブは従来のまま・保存と再読込み・移動・撤去で外観が残る・未完成は使えない・
// 完成後は同じ設備の働き（レシピの条件は変えない・数をふやしても作れる量は同じ）・工程の見た目のノード・配信用モデルの寸法と原点。
import fs from 'node:fs'; import { createRequire } from 'node:module';
import { loadTerrain } from './helpers/terrain.mjs';
const require = createRequire(import.meta.url);
require('../src/game/construction-data.js'); require('../src/game/space-data.js');
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), N = require('../src/game/nature.js'), C = require('../src/game/construction.js');
const T = await loadTerrain(), W = N.create(D, E, { ...T, cfg: T.DEFAULT_CONFIG });
let fail = 0, n = 0;
const ok = (name, cond, detail) => { n++; if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '：' + (detail || '')}`); };
const opts = { player: null, npcs: [], reserved: [] };
const fresh = () => { const s = E.newState(); s.cons.rule = 'build'; return s; };
const TC = JSON.parse(fs.readFileSync(new URL('../assets/town-construction/town-construction.json', import.meta.url)));
const MAN = JSON.parse(fs.readFileSync(new URL('../assets/build/construction/manifest.json', import.meta.url)));
const PAIRS = [['storehouse', 'warehouse'], ['workbench', 'workshop']];
function findSpot(s, def, look, from) {
  for (let r = 10; r <= 160; r += 4) for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, x = Math.round(from.x + Math.cos(a) * r), z = Math.round(from.z + Math.sin(a) * r);
    if (C.checkBuilding(s, W, def, x, z, 0, opts, undefined, look).ok) return { x, z }; }
  return null; }
const standOf = (s, id) => { const v = s.cons.inst[id], d = C.defOf(v), lp = d.entrance || d.operate || [0, d.footprint.d / 2 + 0.8], L = Math.hypot(lp[0], lp[1]) || 1;
  const ex = lp[0] + lp[0] / L * 0.9, ez = lp[1] + lp[1] / L * 0.9, co = Math.cos(v.rot), si = Math.sin(v.rot); return { x: v.x + co * ex + si * ez, z: v.z - si * ex + co * ez }; };
function fill(s, def) { for (const [k, q] of Object.entries(C.totalMat(C.DEF[def]))) { s.inv[k] = (s.inv[k] || 0) + q; s.disc[k] = s.disc[k] || { first: 1, made: 1, total: 1, routes: [], best: 0 }; }
  for (const st of C.DEF[def].stages) for (const t of st.tools) { s.disc[t] = s.disc[t] || { first: 1, made: 1, total: 1, routes: [], best: 0 };
    const bd = D.construction.defs.find(d => d.facility === t); if (bd) s.cons.inst['cs-tool-' + t] = { id: 'cs-tool-' + t, def: bd.id, x: 900, z: 900 + Object.keys(s.cons.inst).length * 30, rot: 0, phase: 'completed', stage: bd.stages.length, delivered: {}, consumed: {}, work: null, done: 1 }; else s.inv[t] = 1; } }
function buildAll(s, id) { let t = 1e6; const pos = standOf(s, id); let r = C.deliverAll(s, W, id, pos, s.seq); if (!r.ok && !/運べる資材がない/.test(r.msg)) return r;
  for (let g = 0; g < 10 && s.cons.inst[id].phase !== 'completed'; g++) { r = C.startWork(s, W, id, pos, t, s.seq); if (!r.ok) return r; t += 100000; r = C.finishWork(s, W, id, pos, t, s.seq); if (!r.ok) return r; }
  return { ok: true }; }

/* ---- 1 データ：Muse の正式値の写しと、工程の見た目 ---- */
for (const [def, look] of PAIRS) {
  const L = C.lookOf(C.DEF[def], look), M = TC.buildings.find(b => b.assetId === look);
  ok(`${look}：占有形状・入口・道の接続点・高さは town-construction.json の正式値`, JSON.stringify(L.footprint) === JSON.stringify(M.footprint) && JSON.stringify(L.entrance) === JSON.stringify(M.entrance) && JSON.stringify(L.roadLink) === JSON.stringify(M.roadLink) && L.tall === M.size.h,
    JSON.stringify({ L: [L.footprint, L.entrance, L.roadLink, L.tall], M: [M.footprint, M.entrance, M.roadLink, M.size.h] }));
  ok(`${look}：工程の見た目は設計図の工程の数に対応し、最後の工程で全部のノード`, Object.keys(L.stageGroups).length === C.DEF[def].stages.length && L.stageGroups[String(C.DEF[def].stages.length - 1)].length === Object.keys(M.stageNodes).length && Object.values(L.stageGroups).flat().every(g => M.stageNodes[g]));
  const info = MAN.looks[look];
  ok(`${look}：配信用モデル（LOD0 の軽量版）は寸法 ${M.size.w}×${M.size.d}×${M.size.h}・原点は底面の中心のまま`, info && Math.abs((info.max[0] - info.min[0]) - M.size.w) < 0.02 && Math.abs((info.max[2] - info.min[2]) - M.size.d) < 0.02 && Math.abs(info.max[1] - M.size.h) < 0.02 && Math.abs(info.min[1]) < 1e-3 && Math.abs(info.min[0] + info.max[0]) < 0.02,
    JSON.stringify(info && [info.min, info.max]));
  const glb = fs.readFileSync(new URL(`../assets/build/construction/looks/${look}.glb`, import.meta.url)), jl = glb.readUInt32LE(12), names = new Set(JSON.parse(glb.slice(20, 20 + jl).toString()).nodes.map(x => x.name));
  ok(`${look}：工程のノード名がすべて配信用モデルにある`, Object.values(M.stageNodes).flat().every(x => names.has(x)), Object.values(M.stageNodes).flat().filter(x => !names.has(x)).join(','));
  const base = C.DEF[def];
  ok(`${look}：設備の働き・工程・資材・返却は元の設計図（${def}）のまま`, C.view(def, look).facility === base.facility && C.view(def, look).stages === base.stages && C.view(def, look).salvage === base.salvage && C.view(def, look).cat === base.cat);
}

/* ---- 2 以前のセーブ：外観のない建物は従来のモデル・位置・向き・当たり判定のまま ---- */
{ const s = fresh(); s.cons.inst['cs-1'] = { id: 'cs-1', def: 'storehouse', x: -27, z: 12, rot: 0.7, phase: 'completed', stage: 3, delivered: {}, consumed: {}, work: null, legacy: true, done: 1 };
  s.cons.inst['cs-2'] = { id: 'cs-2', def: 'workbench', x: -17, z: 23, rot: 1.1, phase: 'completed', stage: 1, delivered: {}, consumed: {}, work: null, done: 1 }; s.cons.seq = 2;
  const before = JSON.stringify(C.colliders(s)), L = E.deserialize(E.serialize(s)), after = JSON.stringify(C.colliders(L));
  ok('以前のセーブの倉庫・作業台は読み込み後も従来のモデル（hut・workbench）・位置・向き・形のまま（新しい外観へ自動で置き換えない）', before === after && C.colliders(L).map(c => c.type).join() === 'hut,workbench' && !('look' in L.cons.inst['cs-1']) && L.v === 6, after);
  const s2 = fresh(); s2.cons.inst['cs-1'] = { id: 'cs-1', def: 'storehouse', look: 'unknown', x: 0, z: 0, rot: 0, phase: 'completed', stage: 3, delivered: {}, consumed: {}, work: null };
  C.state(s2); ok('知らない外観は標準の外観に戻す（形の決まりがないまま使わない）', !('look' in s2.cons.inst['cs-1']) && C.colliders(s2)[0].type === 'hut'); }

/* ---- 3 新しい外観は正式寸法で設置判定 ---- */
for (const [def, look] of PAIRS) {
  const s = fresh(), at = findSpot(s, def, look, { x: D.base.x + 20, z: D.base.z });
  ok(`${look}：置ける場所がある`, !!at);
  const chk = C.checkBuilding(s, W, def, at.x, at.z, 0, opts, undefined, look), M = TC.buildings.find(b => b.assetId === look);
  ok(`${look}：判定の形は正式の占有範囲（${M.footprint.w}×${M.footprint.d}）`, chk.shape.shape === 'rect' && chk.shape.w === M.footprint.w && chk.shape.d === M.footprint.d, JSON.stringify(chk.shape));
  /* 標準の形なら入るが、正式の大きな形だと既存の建物に重なる場所 */
  s.cons.inst['cs-9'] = { id: 'cs-9', def: 'kiln', x: at.x + M.footprint.w / 2 + 1.0, z: at.z, rot: 0, phase: 'completed', stage: 1, delivered: {}, consumed: {}, work: null, done: 1 }; s.cons.seq = 9; W.setStructures(C.colliders(s));
  const big = C.checkBuilding(s, W, def, at.x, at.z, 0, opts, undefined, look), small = C.checkBuilding(s, W, def, at.x - 0.8, at.z, 0, opts);
  ok(`${look}：正式の大きさで重なる場所は「置けない」と理由つきで止まる（標準の小さな形なら置ける所）`, !big.ok && big.reasons.length > 0 && small.ok, JSON.stringify([big.reasons, small.reasons]));
  W.setStructures([]);
  ok(`${look}：設計図にない外観は予定地にできない`, !C.plan(s, W, def, at.x, at.z, 0, opts, s.seq, 'nolook').ok);
}

/* ---- 4 予定地 → 完成・保存と再読込み・移動・撤去・設備の働き ---- */
{ const s = fresh(), at = findSpot(s, 'workbench', 'workshop', { x: D.base.x + 20, z: D.base.z + 10 });
  const p = C.plan(s, W, 'workbench', at.x, at.z, 0, opts, s.seq, 'workshop'); ok('工房の建物の予定地を決めると外観が記録される', p.ok && s.cons.inst[p.id].look === 'workshop', p.msg);
  W.setStructures(C.colliders(s));
  ok('当たりの形（予定地）は正式の大きさ・種類は look-workshop', (() => { const c = C.colliders(s).find(x => x.id === p.id); return c.type === 'look-workshop' && c.footprint.w === 4.8 && c.footprint.d === 3.6 && c.walk === true; })());
  const to = findSpot(s, 'workbench', 'workshop', { x: at.x + 30, z: at.z });
  const mv = C.move(s, W, p.id, to.x, to.z, Math.PI / 2, opts, s.seq); ok('移しても外観は残り、移した先も正式の大きさで判定する', mv.ok && s.cons.inst[p.id].look === 'workshop' && s.cons.inst[p.id].x === to.x, mv.msg);
  W.setStructures(C.colliders(s));
  const L1 = E.deserialize(E.serialize(s)); ok('保存して読み込んでも外観は残る（セーブ v6 のまま）', L1.cons.inst[p.id].look === 'workshop' && L1.v === 6);
  ok('予定地（未完成）の工房の建物では作業台の作業はできない', !E.hasTool(s, 'bench'));
  fill(s, 'workbench'); const r = buildAll(s, p.id); W.setStructures(C.colliders(s));
  ok('工房の建物を完成させられる（工程は作業台と同じ 1 つ）', r.ok && s.cons.inst[p.id].phase === 'completed', r.msg);
  ok('完成すると作業台と同じ設備（bench）が使える', E.hasTool(s, 'bench'));
  const craft = D.crafts.find(c => c.at === 'bench' && !c.space);
  const s1 = JSON.parse(JSON.stringify(s)); for (const [k, q] of Object.entries(craft.inp)) { s1.inv[k] = q; s1.disc[k] = s1.disc[k] || { first: 1, made: 1, total: 1, routes: [], best: 0 }; }
  const s2 = JSON.parse(JSON.stringify(s1)); s2.cons.inst['cs-extra'] = { id: 'cs-extra', def: 'workbench', x: 950, z: 950, rot: 0, phase: 'completed', stage: 1, delivered: {}, consumed: {}, work: null, done: 1 };
  const r1 = E.runCraft(s1, craft.id, s1.seq), r2 = E.runCraft(s2, craft.id, s2.seq);
  ok(`作業台の工作（${craft.id}）の条件は変わらず、工房の建物があればできる。作業台をもう 1 つ建てても作れる量は同じ`, r1.ok && r2.ok && (s1.inv[craft.out] || 0) === (s2.inv[craft.out] || 0) && (s1.inv[craft.out] || 0) === craft.qty, JSON.stringify([r1.reason || r1.msg, r2.reason || r2.msg, s1.inv[craft.out], s2.inv[craft.out]]));
  ok('完成した建物の当たりは正式の大きさ（歩けない）', (() => { const c = C.colliders(s).find(x => x.id === p.id); return c.footprint.w === 4.8 && c.walk === false; })());
  const L2 = E.deserialize(E.serialize(s)); ok('完成後も保存と読み込みで外観・位置・向きが残る', L2.cons.inst[p.id].look === 'workshop' && L2.cons.inst[p.id].rot === s.cons.inst[p.id].rot && JSON.stringify(C.colliders(L2)) === JSON.stringify(C.colliders(s)));
  const pv = C.removalPreview(s, p.id), rm = C.remove(s, p.id, s.seq);
  ok('解体は作業台の返却表のとおり（外観で増減しない）', rm.ok && JSON.stringify(rm.returned) === JSON.stringify(C.DEF.workbench.salvage.assemble), JSON.stringify(rm.returned));
  ok('解体すると作業台の作業はできなくなる（ほかに作業台がなければ）', !E.hasTool(s, 'bench'));
}
{ const s = fresh(), at = findSpot(s, 'storehouse', 'warehouse', { x: D.base.x - 25, z: D.base.z - 10 });
  const p = C.plan(s, W, 'storehouse', at.x, at.z, 0, opts, s.seq, 'warehouse'); fill(s, 'storehouse'); W.setStructures(C.colliders(s));
  const pos = standOf(s, p.id); C.deliverAll(s, W, p.id, pos, s.seq); const w = C.startWork(s, W, p.id, pos, 1e6, s.seq); C.finishWork(s, W, p.id, pos, 1e6 + 1e5, s.seq);
  ok('大きな倉庫：施工中（工程 1/3）は未完成で、倉庫の設備は使えない', w.ok && s.cons.inst[p.id].phase === 'constructing' && s.cons.inst[p.id].stage === 1 && !E.hasTool(s, 'storehouse'), w.msg);
  const r = buildAll(s, p.id); ok('大きな倉庫を完成すると、ふつうの倉庫と同じ設備（storehouse）が使える', r.ok && E.hasTool(s, 'storehouse'), r.msg);
  ok('大きな倉庫の道の接続は正式の接続点（入口の前）で判定する', C.connected(s, p.id) === false); }

W.setStructures([]);
console.log(`\n${n - fail}/${n} 件合格`); if (fail) process.exit(1);
