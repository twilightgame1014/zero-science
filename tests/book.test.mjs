// 図鑑（レシピ図鑑）の検査（2026-11-14 Claude）：スキーマ・正本からの組み立て・検索と発見のきまり・逆引き（数量・複数の出力・循環・道具）・
// 設備の未完成・監修の状態（捏造しない）・資源の台帳（到達・元素の出どころ）・保存の互換。
import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'); globalThis.DATA = D; require('../src/game/space-data.js'); require('../src/game/space-science.js'); require('../src/game/construction-data.js'); require('../src/game/book-data.js'); delete globalThis.DATA;
const E = require('../src/game/engine.js'); globalThis.CONS = require('../src/game/construction.js'); const B = require('../src/game/book.js');
let n = 0; const ok = (name, c, extra = '') => { assert(c, name + ' ' + extra); n++; console.log('✅ ' + name); };
const ids = Object.keys(D.items), S = E.newState(); S.cons.rule = 'build';

/* 1. スキーマ：登録されている全件を収容 */
const KEYS = ['id', 'name', 'yomi', 'cat', 'catName', 'kid', 'nature', 'natural', 'obtain', 'uses', 'principle', 'simplification', 'sources', 'review'];
const entries = ids.map(id => B.entry(S, id));
ok(`全 ${ids.length} 品目が図鑑の形になる（ID・名称・読み・分類・説明・自然界・入手方法・用途・原理・簡略化・出典・監修）`, entries.every(e => e && KEYS.every(k => k in e) && e.id && e.name && e.yomi && e.kid));
ok('分類は 6 種（設備・道具・鉱石・天然の素材・製品・材料）のどれか', entries.every(e => D.book.cats.some(c => c.id === e.cat)));
ok('入手方法のない品目はない（採る・作る・建てるのどれか）', entries.every(e => e.obtain.length > 0), entries.filter(e => !e.obtain.length).map(e => e.id).join(','));

/* 2. 数量・設備は実装のデータから（手で書いた値を持たない） */
const steel = B.recipesOf('steel', S), proc = D.procs.find(p => p.out.steel);
ok('作り方の材料と数量・設備は data.js の procs そのまま', steel.some(r => r.key === proc.id && JSON.stringify(r.inputs) === JSON.stringify(proc.inp) && JSON.stringify(r.at) === JSON.stringify(proc.at)));
const sp = D.crafts.find(c => c.space);
ok('宇宙計画の部品は D.crafts（space）から：秒数・実習・出来上がりの数', B.recipesOf(sp.out, S).some(r => r.kind === 'space' && r.time === sp.seconds && r.outputs[sp.out] === sp.qty));
ok('建設の決まりでは、建物の設備（作業台）は「現地に建てる」（工作の作り方は出さない）', B.recipesOf('bench', S).every(r => r.kind !== 'craft') && B.recipesOf('bench', S).some(r => r.kind === 'build' && r.inputs.twig === 4));
const legacy = E.newState();
ok('建設の決まりでない状態（以前の工作）では、作業台は工作で作る', B.recipesOf('bench', legacy).some(r => r.kind === 'craft'));
ok('採集は地域と道具（どれか 1 つ）', B.recipesOf('log', S).some(r => r.kind === 'gather' && r.need.length > 0));

/* 3. 監修・出典は捏造しない */
ok('台帳に書いていない品目は「未確認」（今は全件）', entries.every(e => e.review.status === 'unchecked' && e.review.name === '未確認'));
ok('出典は品目に書いてある物だけ（無い物は空）', entries.every(e => Array.isArray(e.sources.urls)) && entries.filter(e => e.sources.urls.length).every(e => (D.items[e.id].scienceSources || []).length === e.sources.urls.length));

/* 4. 検索と発見のきまり */
const fresh = E.newState(); fresh.cons.rule = 'build';
ok('新しいゲーム：未発見の物は名前で探せない（「てつ」で 0 件）', B.search(fresh, 'てつ', null, false).length === 0);
ok('学習用の全件閲覧では名前・読みで探せる（鉄）', B.search(fresh, 'てつ', null, true).some(r => r.id === 'iron') && B.search(fresh, 'テツ', null, true).some(r => r.id === 'iron'));
ok('全件閲覧は発見の記録を変えない（S.disc はそのまま）', Object.keys(fresh.disc).length === 0);
ok('検索：分類（道具）でしぼれる', B.search(fresh, '', 'tool', true).every(r => B.catOf(r.id).id === 'tool') && B.search(fresh, '', 'tool', true).length > 5);
ok('検索：用途の文や作れる物の名前でも探せる（全件）', B.search(fresh, 'ゴム', null, true).length > 1);
const hinted = B.search(fresh, '', null, false);
ok('新しいゲームで見えるのは、ヒントのある物（？？？）と発見した物だけ（隠れた物は出さない）', hinted.every(r => r.vis !== 'hidden') && hinted.length < ids.length);

/* 5. 原料までの逆引き */
const t = B.expand(fresh, 'steel', 2, {}, { all: true }), T = B.totals(t);
ok('鋼 2 つ：1 回の出来上がりの数で割って回数を出し、材料は回数×数量', t.runs === Math.ceil(2 / (t.recipe.outputs.steel || 1)) && t.children.every(c => c.need === t.recipe.inputs[c.id] * t.runs));
ok('道具・設備は数えない（使ってもなくならない）。設備は未完成なら使えない扱い', t.at.every(f => !f.ok && typeof f.label === 'string'));
ok('合計は自然から採る原料（鉱石・石炭など）', Object.keys(T.raw).length > 0 && Object.keys(T.raw).every(k => B.isRaw(k)));
const multi = D.procs.find(p => Object.keys(p.out).length > 1), mo = Object.keys(multi.out)[0];
const tm = B.expand(fresh, mo, 3, { [mo]: multi.id }, { all: true });
ok(`複数の出力：${multi.id} で ${mo} を作ると、ほかの出力は副産物として回数分`, Object.keys(tm.byproducts).length === Object.keys(multi.out).length - 1 && Object.entries(tm.byproducts).every(([k, q]) => q === multi.out[k] * tm.runs));
const qmulti = D.procs.find(p => Object.values(p.out).some(v => v > 1)), qk = Object.keys(qmulti.out).find(k => qmulti.out[k] > 1);
const tq = B.expand(fresh, qk, 3, { [qk]: qmulti.id }, { all: true });
ok(`1 回で ${qmulti.out[qk]} 個できる作り方：3 個に必要な回数は切り上げ、余りを示す`, tq.runs === Math.ceil(3 / qmulti.out[qk]) && (tq.surplus || 0) === qmulti.out[qk] * tq.runs - 3);
/* 循環：わざと出力→入力が戻る製法を選ぶと止まる */
const ch = {}; for (const k of ids) { const o = B.options(S, k).filter(x => x.kind !== 'gather' && x.kind !== 'rare'); if (o.length) ch[k] = o[o.length - 1].key; }
let cyc = 0, max = 0; for (const id of ids) { const x = B.expand(fresh, id, 1, ch, { all: true }); const tt = B.totals(x); if (tt.cycles.length) cyc++; let c = 0; (function w(y) { c++; y.children.forEach(w); })(x); max = Math.max(max, c); }
ok(`循環する製法を選んでも止まる（${cyc} 品目で循環を検出、最大 ${max} ノード）`, cyc > 0 && max < 5000);
ok('在庫を引く：持っている分は作らない', (() => { const s2 = E.newState(); s2.cons.rule = 'build'; s2.inv.steel = 5; const x = B.expand(s2, 'steel', 3, {}, { all: true }); return x.make === 0 && x.runs === 0 && x.short === 0; })());
ok('製法を選ぶと必要量が変わる（別の製法の材料になる）', (() => { const o = B.options(S, 'iron').filter(x => x.kind === 'lab'); if (o.length < 2) return true; const a = B.expand(fresh, 'iron', 1, { iron: o[0].key }, { all: true }), b = B.expand(fresh, 'iron', 1, { iron: o[1].key }, { all: true }); return JSON.stringify(a.children.map(c => c.id)) !== JSON.stringify(b.children.map(c => c.id)); })());

/* 6. 設備の未完成は使えない（持っているだけ・施工中） */
{ const s3 = E.newState(); s3.cons.rule = 'build'; s3.inv.bench = 1;
  ok('作業台を持っているだけ（建物がない）では使えない扱い', !B.facilityState(s3, 'bench').ok && /建物がない/.test(B.facilityState(s3, 'bench').label));
  s3.cons.inst['cs-1'] = { id: 'cs-1', def: 'workbench', x: 0, z: 0, rot: 0, phase: 'constructing', stage: 0, delivered: {}, consumed: {}, work: null };
  ok('施工中の作業台は使えない扱い（工程を表示）', !B.facilityState(s3, 'bench').ok && /施工中・工程 0\/1/.test(B.facilityState(s3, 'bench').label));
  s3.cons.inst['cs-1'].phase = 'completed'; s3.cons.inst['cs-1'].stage = 1; E.setFacilityHook && E.setFacilityHook(CONS.built);
  ok('完成した作業台は使える', B.facilityState(s3, 'bench').ok); }

/* 7. 資源の台帳（M1） */
const A = B.audit();
ok(`天然の原料 ${A.raws.length} 種の採集地域・原料処理・使用先`, A.raws.length > 30 && A.raws.every(r => r.regions.length > 0));
ok('すべての品目に、天然の原料から実際に作れる経路がある（到達不能 0）', A.unreachable.length === 0, A.unreachable.join(','));
ok('品目に出てくる元素は、どれも鉱石・水・空気・植物などの採れる原料に含まれる', A.noSource.length === 0, JSON.stringify(A.noSource));
console.log(`  記録：用途の文があるのに作り方に使われていない ${A.usesTextOnly.length} 件（${A.usesTextOnly.join('・')}）`);

/* 8. 保存の互換：図鑑は形式を変えない（全件閲覧は S.flags の 1 つだけ。セーブ v6 のまま） */
{ const s4 = E.newState(); s4.flags.bookAll = true; const L = E.deserialize(E.serialize(s4)); ok('全件閲覧の設定は保存しても残り、セーブの版は 6 のまま', L.flags.bookAll === true && L.v === 6); }
console.log(`\n${n} 件合格`);
