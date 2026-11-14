// 街づくり・現地建設（construction.js）の検査。実際の地形（src/terrain-entry.ts）と自然物（nature.js）で、
// 予定地 → 搬入 → 施工 → 完成、複数建設、大型工場、保存と再開、未完成の設備、道、取消・解体・二重操作、旧セーブの移行を確かめる。
import { createRequire } from 'node:module';
import { loadTerrain } from './helpers/terrain.mjs';
const require = createRequire(import.meta.url);
require('../src/game/construction-data.js'); require('../src/game/space-data.js');
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), N = require('../src/game/nature.js'), C = require('../src/game/construction.js');
require('../src/game/space.js');
const T = await loadTerrain(), W = N.create(D, E, { ...T, cfg: T.DEFAULT_CONFIG });
let fail = 0, n = 0;
const ok = (name, cond, detail) => { n++; if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '：' + (detail || '')}`); };
const X = D.construction, IT = D.items;
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const fresh = () => { const s = E.newState(); s.cons.rule = 'build'; return s; };
const syncWorld = s => W.setStructures(C.colliders(s));
const opts = { player: null, npcs: [], reserved: [] };
/* 置ける場所を探す（固定の座標を使わない） */
function findSpot(s, def, from, skip, rot) {
  for (let r = 8; r <= 140; r += 4) for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, x = Math.round(from.x + Math.cos(a) * r), z = Math.round(from.z + Math.sin(a) * r);
    if (skip && skip.some(p => Math.hypot(p.x - x, p.z - z) < 12)) continue;
    if (C.checkBuilding(s, W, def, x, z, rot || 0, opts).ok) return { x, z }; }
  return null; }
const stand = (s, id) => { const v = s.cons.inst[id]; if (v.kind === 'road') { const q = v.cells[0]; return C.cellCenter(q.i, q.j); } const d = C.DEF[v.def]; const f = d.footprint, r = f.shape === 'rect' ? Math.max(f.w, f.d) / 2 : f.r; return { x: v.x, z: v.z + r + 0.8 }; };
const give = (s, items) => { for (const k in items) { s.inv[k] = (s.inv[k] || 0) + items[k]; s.disc[k] = s.disc[k] || { first: 1, made: 1, total: 1, routes: [], best: 0 }; } };
/* 予定地を最後まで建てる（運ぶ → 各工程を施工） */
function buildAll(s, id, t0) { let t = t0 || 1e6;
  const pos = stand(s, id); let r = C.deliverAll(s, W, id, pos, s.seq); if (!r.ok && !/運べる資材がない/.test(r.msg)) return r;
  for (let g = 0; g < 10 && s.cons.inst[id] && s.cons.inst[id].phase !== 'completed'; g++) { r = C.startWork(s, W, id, pos, t, s.seq); if (!r.ok) return r; t += 100000; r = C.finishWork(s, W, id, pos, t, s.seq); if (!r.ok) return r; }
  return { ok: true }; }

/* ---- 1 データ ---- */
const badId = []; X.defs.forEach(d => d.stages.forEach(st => { Object.keys(st.mat).concat(st.tools).forEach(k => { if (!IT[k]) badId.push(d.id + ':' + k); }); }));
Object.values(X.roadStages).forEach(st => Object.keys(st.mat).concat(st.tools || []).forEach(k => { if (!IT[k]) badId.push('road:' + k); }));
ok('建物と道の工程の資材・道具・設備の ID がすべて実在する', badId.length === 0, badId.join(','));
const mism = X.defs.filter(d => d.facility).filter(d => { const c = D.crafts.find(x => x.out === d.facility); if (!c) return true; const tot = C.totalMat(d);
  return JSON.stringify(Object.keys(c.inp).sort().map(k => [k, c.inp[k]])) !== JSON.stringify(Object.keys(tot).sort().map(k => [k, tot[k]])); });
ok('設備の建物の資材の合計は、以前の工作のレシピの材料と同じ（量を変えていない）', mism.length === 0, mism.map(d => d.id).join(','));
const toolLost = X.defs.filter(d => d.facility).filter(d => { const c = D.crafts.find(x => x.out === d.facility); const need = c.tools.concat(c.at ? [c.at] : []); const have = d.stages.flatMap(s => s.tools); return need.some(t => !have.includes(t)); });
ok('以前の工作の道具・場所の条件は、建物のどれかの工程の条件に入っている', toolLost.length === 0, toolLost.map(d => d.id).join(','));
ok('工程の数は建物で違う（作業台は1、大型工場は3）', C.DEF.workbench.stages.length === 1 && C.DEF.factory.stages.length === 3);
ok('返却表は工程の資材より多く返さない', X.defs.every(d => !d.salvage || Object.entries(d.salvage).every(([sid, m]) => { const st = d.stages.find(s => s.id === sid); return st && Object.entries(m).every(([k, q]) => (st.mat[k] || 0) >= q); })));
ok('すべての建物に説明がある', X.defs.every(d => d.kid && d.name));
ok('屋台と果物かごは通常のゲームで建てない（取引・食べ物の仕組みがない）', !X.defs.some(d => /stall|fruit/.test(d.model)) && Object.keys(X.notBuildable).length === 2);

/* ---- 2 ルール ---- */
const R = fresh(); give(R, { twig: 9, thread: 9, cobble: 9, knife: 1 });
const pc = E.planCraft(R, D.crafts.find(c => c.out === 'bench'));
ok('建てるルールでは、設備（作業台）は工作で作れない（建築へ案内）', !pc.ok && pc.kind === 'build');
ok('建てるルールでも、道具（石のナイフ）は工作で作れる', E.planCraft(R, D.crafts.find(c => c.id === 'c_knife')).kind !== 'build');
const L = E.newState(); L.inv = { twig: 9, thread: 9, cobble: 9, knife: 1 };
ok('エンジン単体の状態（ルールなし）は以前の工作のまま（テストのボット用）', E.planCraft(L, D.crafts.find(c => c.out === 'bench')).ok);

/* ---- 3 通常の流れ：予定地 → 搬入 → 施工 → 完成 ---- */
const S = fresh(); give(S, { twig: 8, thread: 4, cobble: 4, knife: 1 });
const base = { x: D.base.x, z: D.base.z };
const p1 = findSpot(S, 'workbench', base);
ok('作業台を置ける場所が見つかる（固定の場所を使わない）', !!p1, '');
const r1 = C.plan(S, W, 'workbench', p1.x, p1.z, 0, opts, S.seq); const id1 = r1.id; syncWorld(S);
ok('予定地を決める（資材はまだ使わない・設備はまだ使えない）', r1.ok && S.inv.twig === 8 && !E.hasTool(S, 'bench') && S.cons.inst[id1].phase === 'planned');
ok('遠くからは運べない（遠くの倉庫から吸い上げない）', !C.deliver(S, W, id1, 'twig', 4, { x: p1.x + 30, z: p1.z }, S.seq).ok && S.inv.twig === 8);
const at1 = stand(S, id1);
const d1 = C.deliver(S, W, id1, 'twig', 9, at1, S.seq);
ok('運ぶと持ち物から減り、予定地へ移る。必要数（4）を超えては受け取らない', d1.ok && d1.n === 4 && S.inv.twig === 4 && S.cons.inst[id1].delivered.twig === 4 && S.cons.inst[id1].phase === 'supplying');
const rowsBefore = C.supplyTable(S, S.cons.inst[id1]);
ok('所持数・必要数・搬入済み・不足数がわかる', rowsBefore.find(r => r.id === 'thread').missing === 2 && rowsBefore.find(r => r.id === 'twig').missing === 0 && rowsBefore.find(r => r.id === 'cobble').carried === 4);
ok('資材がそろわないと施工できない（足りない物を言う）', !C.startWork(S, W, id1, at1, 1000, S.seq).ok && /植物の糸/.test(C.startWork(S, W, id1, at1, 1000, S.seq).msg));
const tk = S.seq; const da = C.deliverAll(S, W, id1, at1, tk), db = C.deliverAll(S, W, id1, at1, tk);
ok('まとめて搬入（二重押しでも一度だけ）', da.ok && !db.ok && S.inv.thread === 2 && S.inv.cobble === 2);
const sw = C.startWork(S, W, id1, at1, 1000, S.seq);
ok('施工はゲームの中の時間（作業台は 3 秒）。その間は完成しない', sw.ok && sw.seconds === 3 && !C.finishWork(S, W, id1, at1, 2000, S.seq).ok && !E.hasTool(S, 'bench'));
ok('離れたら仕上げられない（現場に戻る）', !C.finishWork(S, W, id1, { x: p1.x + 40, z: p1.z }, 9000, S.seq).ok);
const fw = C.finishWork(S, W, id1, at1, 9000, S.seq);
ok('完成すると設備として使える（持ち物には入らない・図鑑に載る）', fw.ok && fw.done && E.hasTool(S, 'bench') && !S.inv.bench && !!S.disc.bench && S.cons.inst[id1].phase === 'completed');
ok('完成した設備で工作ができる（作業台が場所の工作）', E.planCraft(Object.assign(S, {}), D.crafts.find(c => c.id === 'c_rack')).kind !== 'at');

/* ---- 4 同じ種類を別の場所に ---- */
give(S, { twig: 4, thread: 2, cobble: 2 });
const p2 = findSpot(S, 'workbench', base, [p1]); const r2 = C.plan(S, W, 'workbench', p2.x, p2.z, Math.PI / 2, opts, S.seq); syncWorld(S);
const b2 = buildAll(S, r2.id);
ok('同じ作業台を別の場所にもう1つ建てられる（ID はそれぞれ）', b2.ok && Object.values(S.cons.inst).filter(v => v.def === 'workbench' && v.phase === 'completed').length === 2 && r2.id !== id1, JSON.stringify(b2));
ok('2つあっても設備は「使える」だけ（持ち物・生産は増えない）', !S.inv.bench && E.hasTool(S, 'bench'));

/* ---- 5 大型工場：固定の座標なし・中の高低差 ---- */
const F = fresh(); give(F, { brick: 6, wire: 4, coke: 2, generator: 1 });
const pf = findSpot(F, 'factory', { x: 40, z: 60 }, null, 0.3);
const rf = pf && C.plan(F, W, 'factory', pf.x, pf.z, 0.3, opts, F.seq); syncWorld(F);
ok('大型工場も好きな場所に置ける（探した場所 ' + (pf ? pf.x + ',' + pf.z : 'なし') + '）', !!(rf && rf.ok));
let slopeHit = null; for (let x = -160; x <= 160 && !slopeHit; x += 6) for (let z = -160; z <= 160 && !slopeHit; z += 6) { const c = C.checkBuilding(F, W, 'factory', x, z, 0, opts); if (c.reasons.some(r => /高低差/.test(r))) slopeHit = { x, z, r: c.reasons }; }
ok('大型工場は占有範囲の中の高低差も調べる（土地はならさない）', !!slopeHit, '');
ok('大型工場は資材と工程（3つ）をすべて終えるまで電気炉が使えない', !!(rf && rf.ok) && !E.hasTool(F, 'eaf') && buildAll(F, rf.id).ok && E.hasTool(F, 'eaf'));
ok('完成前の設備では、その設備の実験ができない（電気炉のない別の状態）', (() => { const s = fresh(); give(s, { quartzpowder: 2, coke: 2 }); return !E.planExperiment(s, { quartzpowder: 2, coke: 2 }, 'eaf', 'smelt').ok; })());

/* ---- 6 保存して続ける ---- */
const M = fresh(); give(M, { clay: 3, cobble: 4 });
const pm = findSpot(M, 'kiln', base); const rm = C.plan(M, W, 'kiln', pm.x, pm.z, 0, opts, M.seq); syncWorld(M);
C.deliver(M, W, rm.id, 'cobble', 4, stand(M, rm.id), M.seq); C.startWork(M, W, rm.id, stand(M, rm.id), 1000, M.seq); C.finishWork(M, W, rm.id, stand(M, rm.id), 99000, M.seq);
const M2 = E.deserialize(E.serialize(M));
ok('施工の途中で保存して読み込むと、工程・搬入・持ち物がそのまま', M2.cons.inst[rm.id].stage === 1 && M2.cons.inst[rm.id].phase === 'constructing' && M2.inv.clay === 3 && !M2.inv.cobble);
give(M2, { campfire: 1 });
ok('読み込んだあとも続けて完成できる', buildAll(M2, rm.id).ok && E.hasTool(M2, 'kiln'));

/* ---- 7 道 ---- */
const Rd = fresh(); let pr = null;
/* 木や岩・水のない場所を探す（横 9 マスと、交わる縦の道が敷ける所） */
for (let r = 0; r <= 150 && !pr; r += 6) for (let k = 0; k < 16 && !pr; k++) { const cx = Math.round((60 + Math.cos(k / 16 * 6.283) * r) / 2) * 2, cz = Math.round((100 + Math.sin(k / 16 * 6.283) * r) / 2) * 2;
  if (C.roadPlan(Rd, W, 'dirt', { x: cx - 8, z: cz }, { x: cx + 8, z: cz }, 1000).ok && C.roadPlan(Rd, W, 'dirt', { x: cx, z: cz - 6 }, { x: cx, z: cz - 2 }, 1000).ok && C.roadPlan(Rd, W, 'dirt', { x: cx - 20, z: cz + 10 }, { x: cx + 20, z: cz + 10 }, 1000).ok) pr = { x: cx, z: cz }; }
const a = { x: pr.x - 8, z: pr.z }, b = { x: pr.x + 8, z: pr.z };
const rp = C.roadPlan(Rd, W, 'dirt', a, b, 1000);
ok('土の道の予定：まっすぐなマスの列。材料はいらない（整地の手間）', rp.ok && rp.cells.length === 9 && sum(rp.cost) === 0, JSON.stringify(rp.reasons));
const pr1 = C.planRoad(Rd, W, 'dirt', a, b, 1000, Rd.seq);
const ov = C.roadPlan(Rd, W, 'dirt', a, b, 1000);
ok('同じ所に重ねて予定しても、二重に請求しない（予定があるマスはとばす）', pr1.ok && !ov.ok && ov.skip.length === 9);
const roadId = pr1.ids[0], rpos = C.cellCenter(Rd.cons.inst[roadId].cells[0].i, Rd.cons.inst[roadId].cells[0].j);
ok('道も現地で施工して完成する（9マスの整地）', buildAll(Rd, roadId).ok && Object.keys(Rd.cons.roads).length === 9 && !Rd.cons.inst[roadId]);
const up = C.roadPlan(Rd, W, 'gravel', a, b, 1000);
ok('砂利道へ変える：整地は済んでいるので、砂利の分だけ（9マス × 丸い石1・砂1）', up.ok && up.cost.cobble === 9 && up.cost.sand === 9 && up.cells.every(q => q.upgrade === 'dirt' && q.need.join() === 'gravel'));
const t1 = C.planRoad(Rd, W, 'dirt', { x: pr.x, z: pr.z - 6 }, { x: pr.x, z: pr.z }, 1000, Rd.seq);
for (const id of t1.ids || []) buildAll(Rd, id);
const mid = C.cellOf(pr.x, pr.z), shp = C.roadShape(Rd, C.cellKey(mid.i, mid.j));
ok('道の形：つながりからT字・十字・曲がり・行き止まりがわかる（交点は ' + shp.kind + '）', t1.ok && ['tee', 'cross'].includes(shp.kind));
const long = C.roadPlan(Rd, W, 'dirt', { x: pr.x - 20, z: pr.z + 10 }, { x: pr.x + 20, z: pr.z + 10 }, 1000);
ok('長い道は ' + X.SECTION_MAX + ' マスずつの区間に分ける', !long.ok || long.sections.every(s => s.length <= X.SECTION_MAX) && long.sections.length >= 2, JSON.stringify(long.reasons));
let wet = null; for (let x = -100; x <= 100 && !wet; x += 4) { const r = C.roadPlan(Rd, W, 'dirt', { x, z: 12 }, { x: x + 4, z: 12 }, 1000); if (r.bad.some(q => q.why.some(w => /川|湖|海/.test(w)))) wet = x; }
ok('川・湖・海の上には道を敷けない（橋はまだない）', wet !== null);
const tree = W.objects.find(o => o.kind === 'tree' && o.block && Math.hypot(o.x - D.base.x, o.z - D.base.z) < 60);
const tr = C.roadPlan(Rd, W, 'dirt', { x: tree.x, z: tree.z }, { x: tree.x, z: tree.z }, 1000);
ok('木のあるマスには道を敷けない（伐ってから）', !tr.ok && tr.bad.some(q => q.why.some(w => /木や岩/.test(w))));

/* ---- 8 取消・解体・二重操作で資材が増えない ---- */
const Z = fresh(); give(Z, { log: 6, thread: 2, plaster: 2, axe: 1 }); give(Z, { bench: 1 });
const pz = findSpot(Z, 'storehouse', base); const rz = C.plan(Z, W, 'storehouse', pz.x, pz.z, 0, opts, Z.seq); syncWorld(Z);
const az = stand(Z, rz.id); C.deliverAll(Z, W, rz.id, az, Z.seq);
const total = s => (s.inv.log || 0) + (s.cons.inst[rz.id] ? (s.cons.inst[rz.id].delivered.log || 0) : 0);
const before = total(Z);
C.startWork(Z, W, rz.id, az, 1000, Z.seq); C.finishWork(Z, W, rz.id, az, 99000, Z.seq);
const pv = C.removalPreview(Z, rz.id);
ok('取消の前に、戻る物と失う物がわかる（土台の丸太2のうち1が戻る）', pv.returns.log === 2 + 1 && pv.lost.log === 1, JSON.stringify(pv));
const tk2 = Z.seq; const c1 = C.remove(Z, rz.id, tk2), c2 = C.remove(Z, rz.id, tk2);
ok('取消：使っていない資材は全部、施工済みは返却表の分だけ戻る。二重押しで増えない', c1.ok && !c2.ok && Z.inv.log === before - 1 && Z.inv.plaster === 2 && Z.inv.thread === 2, JSON.stringify(Z.inv));
const Y = fresh(); give(Y, { clay: 3, brick: 4, bellows: 1, kiln: 1 });
const py = findSpot(Y, 'smelter', base); const ry = C.plan(Y, W, 'smelter', py.x, py.z, 0, opts, Y.seq); syncWorld(Y); buildAll(Y, ry.id);
const pvy = C.removalPreview(Y, ry.id), dem = C.remove(Y, ry.id, Y.seq);
ok('解体：返却表のとおり（簡易炉は粘土1だけ戻る。余っていた1と合わせて2）。設備は使えなくなる', dem.ok && Y.inv.clay === 2 && dem.returned.clay === 1 && !Y.inv.brick && !E.hasTool(Y, 'furnace') && pvy.notes.some(t => /使えなくなる/.test(t)));
const Q = fresh(); give(Q, { brick: 6 }); const pq = findSpot(Q, 'factory', { x: 40, z: 60 }); const rq = C.plan(Q, W, 'factory', pq.x, pq.z, 0, opts, Q.seq); syncWorld(Q);
C.deliver(Q, W, rq.id, 'brick', 6, stand(Q, rq.id), Q.seq);
ok('運んだあとの予定地は、そのままでは動かせない（資材を返して移す操作が要る）', !C.move(Q, W, rq.id, pq.x + 1, pq.z, 0, opts, Q.seq).ok);
const pq2 = findSpot(Q, 'factory', { x: -60, z: 100 }); const rl = C.relocate(Q, W, rq.id, pq2.x, pq2.z, 0, opts, Q.seq);
ok('資材を返して移す：運んだレンガ6が持ち物へ戻り、予定地は新しい場所で「予定」に戻る', rl.ok && Q.inv.brick === 6 && Q.cons.inst[rq.id].phase === 'planned' && Q.cons.inst[rq.id].x === pq2.x);
const done1 = Object.values(S.cons.inst).find(v => v.def === 'workbench' && v.phase === 'completed');
ok('完成した建物は瞬間移動できない', !C.move(S, W, done1.id, done1.x + 3, done1.z, 0, opts, S.seq).ok);

/* ---- 9 置けない場所 ---- */
syncWorld(S);
const over = C.checkBuilding(S, W, 'workbench', done1.x, done1.z, 0, opts);
ok('ほかの建物・予定地と重ねられない', !over.ok && over.reasons.some(r => /建物と重なる/.test(r)));
const tr2 = W.objects.find(o => o.kind === 'tree' && o.block && Math.hypot(o.x - D.base.x, o.z - D.base.z) < 80);
ok('木と重なる場所には置けない（木は自動では消さない）', C.checkBuilding(S, W, 'workbench', tr2.x, tr2.z, 0, opts).reasons.some(r => /木や岩/.test(r)) && W.objects.includes(tr2));
const rdS = Object.keys(Rd.cons.roads)[0].split(',').map(Number), rc = C.cellCenter(rdS[0], rdS[1]); W.setStructures(C.colliders(Rd));
ok('道の上には建てられない', C.checkBuilding(Rd, W, 'workbench', rc.x, rc.z, 0, opts).reasons.some(r => /道の上/.test(r)));
const pl = C.colliders(Q).find(c => c.id === rq.id);
ok('予定地は歩いて通れる（壁にならない）が、完成した建物は壁になる', pl.walk === true && C.colliders(S).filter(c => c.type === 'workbench').every(c => c.walk === false));

/* ---- 10 旧セーブの移行 ---- */
const old = { v: 5, inv: { bench: 1, campfire: 1, kiln: 1, furnace: 1, blastfurnace: 1, steel: 3, storehouse: 1 }, disc: { bench: { first: 1, made: 1, total: 1, routes: [], best: 0 } }, flags: { hero: 'girl' },
  build: { 'st-bench': { x: -15, z: 24, rot: 0.5 }, 'st-hut1': { removed: true } }, nature: { 'tree:1,2': { u: 1 } }, space: { version: 1, lessons: { switch: true }, installed: { structure: 3 } }, pos: { x: -18, z: 22 } };
const O = E.deserialize(JSON.stringify(old)); C.state(O);
const ib = Object.values(O.cons.inst);
ok('旧セーブ：置いてあった設備は、同じ場所の完成した建物になる（素材は求めない）', ib.some(v => v.def === 'workbench' && v.x === -15 && v.z === 24 && v.rot === 0.5 && v.phase === 'completed') && ib.every(v => v.phase === 'completed' && v.legacy));
ok('旧セーブ：移した設備は持ち物から消える（二重に持たない）。設備は変わらず使える', !O.inv.bench && !O.inv.campfire && E.hasTool(O, 'bench') && E.hasTool(O, 'campfire') && E.hasTool(O, 'kiln'));
ok('旧セーブ：撤去していた設備（倉庫）と、同じ建物だった高炉は持ち物のまま使える', O.inv.storehouse === 1 && O.inv.blastfurnace === 1 && E.hasTool(O, 'blastfurnace'), JSON.stringify(O.cons.legacyReport));
ok('旧セーブ：主人公・素材・採取状態・宇宙計画の状態はそのまま', O.flags.hero === 'girl' && O.inv.steel === 3 && O.nature['tree:1,2'].u === 1 && O.space.lessons.switch === true && O.space.installed.structure === 3 && O.cons.rule === 'build');
const O2 = E.deserialize(E.serialize(O)); C.state(O2);
ok('旧セーブ：2回目の読み込みで二重に移さない', Object.keys(O2.cons.inst).length === ib.length && !O2.inv.bench);

/* ---- 11 到達可能性（建てるルール）：設備は建物から。資材・工程の道具・設備がすべて天然資源からそろう ---- */
const reach = new Set(); D.regions.filter(r => !r.future).forEach(r => { r.res.forEach(x => { if (!x.need) reach.add(x.id); }); (r.rare || []).forEach(x => reach.add(x.id)); });
const facDef = Object.fromEntries(X.defs.filter(d => d.facility).map(d => [d.facility, d])); let grew = true;
while (grew) { grew = false;
  D.regions.forEach(r => r.res.forEach(x => { if (!reach.has(x.id) && x.need && x.need.some(t => reach.has(t))) { reach.add(x.id); grew = true; } }));
  D.crafts.forEach(c => { if (reach.has(c.out) || facDef[c.out] || c.space) return; if (Object.keys(c.inp).every(k => reach.has(k)) && c.tools.every(t => reach.has(t)) && (!c.at || reach.has(c.at))) { reach.add(c.out); grew = true; } });
  Object.values(facDef).forEach(d => { if (reach.has(d.facility)) return; const tot = C.totalMat(d); if (Object.keys(tot).every(k => reach.has(k)) && d.stages.every(s => s.tools.every(t => reach.has(t)))) { reach.add(d.facility); grew = true; } });
  D.procs.forEach(p => { if (Object.keys(p.inp).every(k => reach.has(k)) && p.tools.every(t => reach.has(t)) && p.at.some(f => reach.has(f))) Object.keys(p.out).forEach(o => { if (!reach.has(o)) { reach.add(o); grew = true; } }); });
}
const base174 = Object.keys(IT).filter(k => !k.startsWith('sp_') && !['rawrubber', 'rubber'].includes(k) && !reach.has(k));
ok('建てるルールでも、以前の全物質・道具・設備に天然資源から届く（設備は建物から）', base174.length === 0, base174.join(','));

console.log(`\n${n - fail}/${n} 合格`);
process.exit(fail ? 1 : 0);
