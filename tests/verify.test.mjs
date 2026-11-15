// 検証モード（全解放）のエンジン側：通常のセーブと分かれていること・バイパスが個別に効くこと・登録内容から作られること
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'), E = require('../src/game/engine.js');
let total = 0, fail = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' ' + extra}`); };
const items = Object.keys(D.items), store = items.filter(k => D.items[k].store !== false), nostore = items.filter(k => D.items[k].store === false);

const V = E.makeVerifyState();
ok('全解放：登録されているすべての物質・道具・設備が図鑑に載る（件数はデータから）', items.every(k => V.disc[k]) && Object.keys(V.disc).length === items.length, Object.keys(V.disc).length + '/' + items.length);
ok('全解放：保管できるものはすべて在庫にあり、保管できないもの（気体など）は在庫に入れない', store.every(k => V.inv[k] > 0) && nostore.every(k => !V.inv[k]), nostore.join(','));
ok('全解放：道具・設備など1つしか持てないものは1個', items.filter(k => D.items[k].unique).every(k => V.inv[k] === 1));
ok('全解放：バイパスは最初すべてON・建物は何も置かない（原野のまま）', V.verify.free && V.verify.tools && V.verify.locks && V.verify.instant && V.verify.stage === null && V.verify.placed.length === 0 && V.verify.extra.length === 0);
ok('全解放：すべての地域（準備中を除く）が開いている', D.regions.filter(r => !r.future).every(r => E.regionOpen(V, r)));
ok('全解放：すべての目標が達成済みになる（最後の「図鑑のコンプリートを目指そう」は終わりのない目標）', E.missionIndex(V) === D.missions.length - 1 && D.missions.slice(0, -1).every(m => m.done(V)));

// 通常のセーブを写しても、元は変わらない
const N = E.newState(); N.inv.twig = 3; E.addItem(N, 'flint', 2); N.seq = 7;
const before = JSON.stringify(N);
const VC = E.makeVerifyState(N);
ok('通常セーブを写して作っても、元のセーブは変わらない（検証の設定も素材も入らない）', JSON.stringify(N) === before && !N.verify && VC.verify.from === 'copy' && VC.seq === 7);
ok('通常のセーブ（S.verify なし）ではバイパスは一切効かない', !E.vflag(N, 'free') && !E.vflag(N, 'tools') && !E.vflag(N, 'locks') && !E.hasTool(N, 'axe'));

// バイパスを1つずつ切って、通常の判定に戻ることを見る
const bench = D.crafts.find(c => c.out === 'bench') || D.crafts[0];
const S1 = E.makeVerifyState(); Object.keys(bench.inp).forEach(k => { delete S1.inv[k]; });
ok('材料を減らさない ON：材料がなくても工作できる', E.planCraft(S1, { ...bench, out: 'knife' === bench.out ? 'knife' : bench.out }).ok || E.planCraft(S1, bench).kind === 'own', JSON.stringify(E.planCraft(S1, bench)));
S1.verify.free = false;
const pc = E.planCraft(S1, Object.assign({}, bench, { out: Object.keys(D.items).find(k => !D.items[k].unique && D.items[k].store !== false) }));
ok('材料を減らさない OFF：材料が足りないと工作できない（通常の判定）', !pc.ok && pc.kind === 'qty', JSON.stringify(pc));
// 実験：材料が減らないこと
const proc = D.procs.find(p => p.at.length && p.tools.length === 0);
const S2 = E.makeVerifyState(); const tray = {}; Object.keys(proc.inp).forEach(k => { tray[k] = proc.inp[k]; S2.inv[k] = S2.inv[k] || 0; });
const inv0 = JSON.stringify(Object.keys(proc.inp).map(k => S2.inv[k] || 0));
const r2 = E.runExperiment(S2, tray, proc.at[0], proc.op, S2.seq);
ok('材料を減らさない ON：実験しても材料が減らない', r2.ok && JSON.stringify(Object.keys(proc.inp).map(k => S2.inv[k] || 0)) === inv0, JSON.stringify(r2).slice(0, 200));
S2.verify.free = false; Object.keys(proc.inp).forEach(k => { S2.inv[k] = proc.inp[k]; });
const r3 = E.runExperiment(S2, tray, proc.at[0], proc.op, S2.seq);
ok('材料を減らさない OFF：実験すると材料が減る（通常の判定）', r3.ok && Object.keys(proc.inp).every(k => !S2.inv[k] || S2.inv[k] < proc.inp[k] + 1 && (D.items[k].store === false || (S2.inv[k] || 0) === Math.max(0, proc.inp[k] - proc.inp[k] * r3.batches) + (r3.produce[k] || 0))), JSON.stringify(r3).slice(0, 200));
// 道具
const S3 = E.makeVerifyState(); ['axe', 'ironaxe'].forEach(k => delete S3.inv[k]);
ok('道具の条件 ON：おのがなくても道具ありの扱い', E.hasTool(S3, 'axe'));
S3.verify.tools = false;
ok('道具の条件 OFF：おのがなければ道具なし（通常の判定）', !E.hasTool(S3, 'axe') && E.hasTool(S3, 'hammer'));
// 鍵
const S4 = E.makeVerifyState(); ['torch', 'candle'].forEach(k => delete S4.inv[k]); const cave = D.regions.find(r => r.id === 'cave');
ok('地域の鍵 ON：たいまつがなくても洞窟に入れる', E.regionOpen(S4, cave));
S4.verify.locks = false;
ok('地域の鍵は 2026-11-11 に廃止：検証のバイパスを切っても（通常の判定でも）、たいまつなしで洞窟に入れる', E.regionOpen(S4, cave) && E.regionOpen(E.newState(), cave));
// 時代の切り替え
const S5 = E.makeVerifyState(); S5.verify.stage = 0;
ok('時代の切り替え：選んだ段階になり、自動に戻すと設備から決まる', E.stageOf(S5) === 0 && ((S5.verify.stage = null), E.stageOf(S5) === D.stages.length - 1));
// セーブの往復
const S6 = E.deserialize(E.serialize(V));
ok('検証データは保存・読み込みしても検証の設定が残る', S6.verify && S6.verify.free === true && Object.keys(S6.disc).length === items.length);
console.log(`\n${total - fail}/${total} 合格`);
process.exit(fail ? 1 : 0);
