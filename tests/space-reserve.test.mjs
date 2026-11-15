// 発射サイト全体の予約範囲（歩けるが建てられない）の検査（2026-11-14 Claude。docs/space/REVIEW-PR4-2026-11-14.md の指摘 7）。
// 画面の当たり判定の受け渡し（ui.js の syncStructColliders）をそのまま動かし、実際の地形・自然物・街づくりの判定で確かめる。
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module'; import { loadTerrain } from './helpers/terrain.mjs';
const require = createRequire(import.meta.url); require('../src/game/construction-data.js'); require('../src/game/space-data.js');
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), C = require('../src/game/construction.js'), N = require('../src/game/nature.js');
const T = await loadTerrain(), W = N.create(D, E, { ...T, cfg: T.DEFAULT_CONFIG });
const contract = JSON.parse(fs.readFileSync(new URL('../assets/rocket/rocket-contract.json', import.meta.url)));
/* ビルド（scripts/build.mjs）と同じ置き場所の表：発射台・機体は中心、ほかは契約 v6 の equipmentPlacement */
const placement = { 'launch-pad': [0, 0], rocket: [0, 0], 'support-tower': [-4.6, 0] };
for (const q of contract.equipmentPlacement.items) placement[q.model] = [q.position[0], q.position[2]];
const source = fs.readFileSync(new URL('../src/game/ui.js', import.meta.url), 'utf8'), start = source.indexOf('function syncStructColliders(){'), end = source.indexOf('\n}', start) + 2;
function sync(S, models) { const ctx = { world: () => W, WORLD: W, W3: { structInfo: new Map(), pos: null }, S, D, SPACE: { placed: s => !!(s.build && s.build['space-site']) }, CONS: C, ASSETS: { spaceContract: models ? { ...contract, models } : contract, spacePlacement: placement }, syncNature() {} };
  vm.createContext(ctx); vm.runInContext(source.slice(start, end) + '\nsyncStructColliders();', ctx); }
let n = 0; const ok = (name, c, extra = '') => { assert(c, name + ' ' + extra); n++; console.log('✅ ' + name); };
const site = { x: -150, z: 90 };
ok('発射サイトはこの場所（実データの指摘の場所）に置ける', W.checkPlacement(E.newState(), { ...D.space.siteSpec, ...site, rot: 0 }, {}).ok);

for (const rot of [0, Math.PI / 4, Math.PI / 2]) {
  const S = E.newState(); S.cons.rule = 'build'; S.build = { 'space-site': { ...site, rot } }; sync(S);
  const w = (lx, lz) => ({ x: site.x + lx * Math.cos(rot) + lz * Math.sin(rot), z: site.z - lx * Math.sin(rot) + lz * Math.cos(rot) });
  const deg = Math.round(rot * 180 / Math.PI);
  /* 設備の隙間（指摘の (-157,87) はローカル (-7,-3) 付近）に建物を置けない */
  const gap = w(-7, -3), r = C.checkBuilding(S, W, 'workbench', gap.x, gap.z, rot, {});
  ok(`向き ${deg}°：サイトの中の設備の隙間に作業台を置けない`, !r.ok && r.reasons.some(x => /建物|重なる|予定地/.test(x)), JSON.stringify(r.reasons));
  if (rot === 0) ok('（指摘の座標そのもの）(-157,87) に作業台を置けない', !C.checkBuilding(S, W, 'workbench', -157, 87, 0, {}).ok);
  /* 範囲の外（入口側の 13 マス先）には置ける（地形が許せば）：予約はサイトの範囲だけ */
  const out = w(0, 14), ro = C.checkBuilding(S, W, 'workbench', out.x, out.z, rot, {});
  ok(`向き ${deg}°：範囲の外には予約の理由で止められない`, ro.ok || !ro.reasons.some(x => /建物や予定地と重なる|建物と重なる/.test(x)), JSON.stringify(ro.reasons));
  /* 道もサイトの中には敷けない */
  const a = w(-7, -6), b = w(-7, 2), rp = C.roadPlan(S, W, 'dirt', a, b, Date.now());
  ok(`向き ${deg}°：サイトの中に道を敷けない`, !rp.ok && rp.bad.length > 0, JSON.stringify(rp.reasons));
  /* 歩ける：設備のない所を通れる（予約は歩行・経路に入れない）。搭乗口（入口 (0,+10) の外）から中へ歩いて入れる */
  /* 行き先は、サイトの中で設備（個別の形）に重ならない所（予約範囲の中）。以前と同じく歩いて行けるか */
  let to = null; for (let lz = 8; lz >= -8 && !to; lz -= 0.5) for (const lx of [-8.7, 8.7]) { const q = w(lx, lz);
    if (!W.structures().some(o => !o.walk && W.sdist(o, q.x, q.z) < W.PLAYER_R + 0.05) && !W.terrainBlocked(q.x, q.z)) { to = q; break; } }
  ok(`向き ${deg}°：サイトの中に設備のない隙間がある（予約範囲の中）`, !!to && W.structures().some(o => o.walk && o.id === 'struct:space-site:area' && W.sdist(o, to.x, to.z) < 0));
  const from = w(0, 11), path = W.findPath(S, from, to);
  ok(`向き ${deg}°：搭乗口からサイトの中へ歩いて入れる（経路あり）`, !!path && path.length > 0);
  const p1 = path[Math.min(1, path.length - 1)], L = Math.hypot(p1.x - from.x, p1.z - from.z) || 1, m = W.move(S, from, (p1.x - from.x) / L * 0.8, (p1.z - from.z) / L * 0.8, Date.now());
  ok(`向き ${deg}°：入口の前で予約範囲に止められない`, Math.hypot(m.x - from.x, m.z - from.z) > 0.05);
  /* 発射サイト自身は、同じ場所へ置き直せる（自分の予約・設備の形は数えない） */
  ok(`向き ${deg}°：発射サイトは自分の予約と重なっても同じ場所へ置き直せる`, W.checkPlacement(S, { ...D.space.siteSpec, ...site, rot }, {}).ok);
}
/* 再読み込み：保存して読み直しても同じ予約になる（保存するのは発射サイトの位置だけで、予約は毎回そこから作る） */
{ const S = E.newState(); S.cons.rule = 'build'; S.build = { 'space-site': { ...site, rot: 0 } };
  const L = E.deserialize(E.serialize(S)); sync(L);
  ok('保存して読み直しても、サイトの中には置けない（予約はセーブに書かず位置から作る）', !C.checkBuilding(L, W, 'workbench', -157, 87, 0, {}).ok && !JSON.stringify(L).includes('space-site:area')); }
/* 設備ごとの形がない・小さいとき（契約の当たり判定が変わったとき）でも、サイト全体は予約で守られる
   （基準 34dd168 の画面では (-157,87) は発射台 16×16 と置き場所の余白で既に拒否されていて、指摘の再現はできなかった。予約はその形に頼らない保証） */
{ const S = E.newState(); S.cons.rule = 'build'; S.build = { 'space-site': { ...site, rot: 0 } }; sync(S, []);
  const r = C.checkBuilding(S, W, 'workbench', -157, 87, 0, {}), lan = C.checkBuilding(S, W, 'lantern', -144, 96, 0, {});
  ok('設備の当たり判定が無くても、サイトの中（(-157,87)・隅）に建てられない', !r.ok && !lan.ok, JSON.stringify([r.reasons, lan.reasons])); }
/* 発射サイトがなければ予約もない */
{ const S = E.newState(); S.cons.rule = 'build'; sync(S);
  ok('発射サイトを置く前は、その場所に作業台を置ける', C.checkBuilding(S, W, 'workbench', -157, 87, 0, {}).ok); }
console.log(`\n${n} 件合格`);
