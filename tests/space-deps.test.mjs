// 宇宙計画の依存関係の検査（Claude 側の実装 tests/space.test.mjs〔feature/game-space-program〕の validate を Codex のデータ形式へ移植）。
// 到達可能性（採取地点の道具・工作の場所と道具・実習の知識・実習の前提も条件に入れる）、追加品の循環、用途のない部品、
// 最終装備から天然資源までの逆引き、追加の反応の元素保存、目標と段階を確かめる。
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = { console }; vm.createContext(ctx);
for (const f of ['data', 'space-data', 'engine', 'space']) vm.runInContext(fs.readFileSync(new URL('../src/game/' + f + '.js', import.meta.url), 'utf8'), ctx, { filename: f + '.js' });
const { DATA: D, ENGINE: E, SPACE: P } = ctx, IT = D.items, X = D.space;
let fail = 0, n = 0;
const ok = (name, cond, detail) => { n++; if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '：' + (detail || '')}`); };
const added = X.ids.concat(['rawrubber', 'rubber']);

/* 1 到達可能性（知識もふくめた不動点） */
const reach = new Set(), know = new Set(); let grew = true;
D.regions.filter(r => !r.future).forEach(r => { r.res.forEach(x => { if (!x.need) reach.add(x.id); }); (r.rare || []).forEach(x => reach.add(x.id)); });
while (grew) { grew = false;
  D.regions.filter(r => !r.future).forEach(r => r.res.forEach(x => { if (!reach.has(x.id) && x.need && x.need.some(t => reach.has(t))) { reach.add(x.id); grew = true; } }));
  X.lessons.forEach(l => { if (!know.has(l.id) && l.need.every(i => reach.has(i)) && l.prev.every(p => know.has(p))) { know.add(l.id); grew = true; } });
  D.crafts.forEach(c => { if (!reach.has(c.out) && Object.keys(c.inp).every(k => reach.has(k)) && c.tools.every(t => reach.has(t)) && (!c.at || reach.has(c.at)) && (!c.lesson || know.has(c.lesson))) { reach.add(c.out); grew = true; } });
  D.procs.forEach(p => { if (Object.keys(p.inp).every(k => reach.has(k)) && p.tools.every(t => reach.has(t)) && p.at.some(f => reach.has(f))) Object.keys(p.out).forEach(o => { if (!reach.has(o)) { reach.add(o); grew = true; } }); });
}
const unreach = Object.keys(IT).filter(id => !reach.has(id)).concat(X.lessons.filter(l => !know.has(l.id)).map(l => 'lesson:' + l.id));
ok(`すべての物質・部品・設備（${Object.keys(IT).length}種）と8つの実習が、天然資源から到達できる（道具・設備・実習の条件込み）`, unreach.length === 0, unreach.join(','));

/* 2 循環：追加品どうしの依存（材料・場所・道具・実習の部品）に輪がない */
const deps = id => { const c = D.crafts.find(x => x.out === id), p = D.procs.find(x => x.out[id]);
  const r = c ? [...Object.keys(c.inp), ...(c.at ? [c.at] : []), ...c.tools, ...(c.lesson ? X.lessons.find(l => l.id === c.lesson).need : [])] : p ? [...Object.keys(p.inp), ...p.at, ...p.tools] : [];
  return r.filter(k => added.includes(k) && k !== id); };
const cycles = []; const color = {};
const dfs = (id, path) => { if (color[id] === 2) return; if (color[id] === 1) { cycles.push(path.slice(path.indexOf(id)).concat(id).join('→')); return; } color[id] = 1; deps(id).forEach(k => dfs(k, path.concat(id))); color[id] = 2; };
added.forEach(id => dfs(id, []));
ok('追加品の依存関係に循環がない', cycles.length === 0, cycles.slice(0, 5).join(' / '));

/* 3 用途：追加品はどれも、何かの材料・場所・道具・実習・組込・設置・装着・試験に使う */
const used = new Set();
D.crafts.forEach(c => { Object.keys(c.inp).forEach(k => used.add(k)); c.tools.forEach(k => used.add(k)); if (c.at) used.add(c.at); });
D.procs.forEach(p => { Object.keys(p.inp).forEach(k => used.add(k)); p.tools.forEach(k => used.add(k)); p.at.forEach(k => used.add(k)); });
X.lessons.forEach(l => l.need.forEach(k => used.add(k))); X.slots.forEach(s => used.add(s.item)); X.siteItems.forEach(k => used.add(k));
const SPECIAL = { sp_suit: '宇宙服の装着（SPACE.equip）', sp_testbench: '試験の条件（SPACE.testNeeds）' };
Object.keys(SPECIAL).forEach(k => used.add(k));
const unused = added.filter(id => !used.has(id));
ok('用途のない追加品がない（装着・試験の特別な用途は ' + Object.keys(SPECIAL).join('・') + '）', unused.length === 0, unused.join(','));
ok('特別な用途の実装が実際にその品を見ている', /sp_suit/.test(P.equip.toString()) && /sp_testbench/.test(P.testNeeds.toString()));

/* 4 逆引き：最終装備から天然資源までたどれる（主な作り方を1つずつ） */
const natural = id => IT[id].tags.includes('天然資源');
const memo = new Map();
/* 原料の集合（同じ中間材料は1回だけ展開する。輪になったら null） */
const raw = (id, seen = []) => { if (natural(id)) return new Set([id]); if (memo.has(id)) return memo.get(id); if (seen.includes(id)) return null;
  const c = D.crafts.find(x => x.out === id), p = D.procs.find(x => x.out[id] && !x.inp[id]), r = c || p;
  if (!r) { const g = D.regions.some(g => g.res.some(x => x.id === id)) ? new Set([id]) : null; memo.set(id, g); return g; }
  const ks = [...Object.keys(r.inp), ...(c ? (c.at ? [c.at] : []) : [r.at[0]]), ...r.tools], out = new Set();
  for (const k of ks) { const q = raw(k, seen.concat(id)); if (q === null) { memo.set(id, null); return null; } q.forEach(x => out.add(x)); }
  memo.set(id, out); return out; };
const goals = X.slots.map(s => s.item).concat(['sp_suit', 'sp_pad', 'sp_tower', 'sp_control', 'sp_power', 'sp_flightcomputer']);
const bad = goals.filter(g => { const r = raw(g); return !r || !r.size || ![...r].every(k => natural(k) || D.regions.some(x => x.res.some(y => y.id === k))); });
ok('機体の9部分・宇宙服・地上設備は、どれも天然資源までさかのぼれる', bad.length === 0, bad.join(','));
const all = new Set(goals.flatMap(g => [...raw(g)]));
ok('鉄鉱石・銅鉱石・石英・原油・ボーキサイト・硫黄・植物の繊維を終盤まで使う', ['hematite', 'malachite', 'quartz', 'crude', 'bauxite', 'sulfur', 'vine'].every(k => all.has(k)), [...all].join(','));
ok('コンピューターは一段で作れない（砂・ケイ素・切替素子から直接は組めない）', !Object.keys(D.crafts.find(c => c.out === 'sp_computer').inp).some(k => ['sand', 'quartz', 'silicon', 'pure_si', 'sp_transistor'].includes(k)));
ok('宇宙服と機体で、生命維持ユニットがそれぞれ1つずつ要る', !!D.crafts.find(c => c.out === 'sp_suit').inp.sp_lifesupport && X.slots.some(s => s.item === 'sp_lifesupport'));

/* 5 科学：移植した反応（ゴム・CO₂ の吸収）の元素保存と説明 */
const AIR = ['O', 'N', 'C', 'H'];
const viol = D.procs.filter(p => ['make_rawrubber', 'vulcanize'].includes(p.id)).flatMap(p => { const src = new Set(); Object.keys(p.inp).forEach(k => IT[k].el.forEach(e => src.add(e))); if (p.air) AIR.forEach(e => src.add(e)); return Object.keys(p.out).flatMap(k => IT[k].el.filter(e => !src.has(e)).map(e => p.id + ':' + e)); });
ok('ゴムの反応は元素保存を守る（硫黄は加硫のときだけ入る）', viol.length === 0 && IT.rubber.el.includes('S') && !IT.rawrubber.el.includes('S'), viol.join(','));
const scr = D.crafts.find(c => c.out === 'sp_scrubber');
ok('二酸化炭素の吸収はアルカリ（消石灰・水酸化ナトリウム）で行い、説明にもそう書く', !!scr.inp.slaked && !!scr.inp.naoh && /アルカリ/.test(IT.sp_scrubber.kid));
ok('シール材はゴム（硫黄で加硫）から作る', !!D.crafts.find(c => c.out === 'sp_seal').inp.rubber);

/* 6 目標と段階 */
const S = E.newState(); const mi = D.missions.findIndex(m => m.tab === 'space');
ok('目標に宇宙計画の7段階があり、最後は終わりのない図鑑の目標', D.missions.filter(m => m.tab === 'space').length === 7 && mi > 0 && D.missions[D.missions.length - 1].done(S) === false);
P.state(S); S.space.firstClear = { at: 1 };
ok('宇宙へ到達すると、表示の段階が「宇宙へ届いた文明」（6）になる。レシピの判定には使わない', E.stageOf(S) === 6 && D.stages[6].name === '宇宙へ届いた文明');

console.log(`\n${n - fail}/${n} 合格`);
process.exit(fail ? 1 : 0);
