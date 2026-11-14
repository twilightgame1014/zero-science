// 宇宙計画：依存関係（天然資源までの逆引き・循環・使い道）、実習、組立、試験、打ち上げの条件、
// 「最初から宇宙到達まで」をボットが通せること、順序の飛び越し、二重実行、セーブの移行と中断
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), SP = require('../src/game/space.js');
let fail = 0, n = 0;
const ok = (name, cond, detail) => { n++; if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '：' + (detail || '')}`); };
const IT = D.items, X = D.space;

/* ---- 1 データ ---- */
const v = SP.validate();
ok('宇宙計画の参照（分野・実習・組立・設備・試験の ID）が正しい', v.badRef.length === 0, v.badRef.join(' '));
ok('すべての物質・部品・設備と実習の知識が、天然資源から到達できる（道具・設備・知識の条件を入れて）', v.unreachable.length === 0, v.unreachable.join(','));
ok('依存関係に循環がない（どの物の「作り方の木」にも自分自身が出てこない）', v.cycles.length === 0, v.cycles.slice(0, 8).join(' '));
ok('用途のない部品がない（宇宙計画の物は、材料・道具・設備・実習・組立・設置のどれかに使う）', v.unused.length === 0, v.unused.join(','));
const goals = X.modules.map(m => m.item).concat(X.ground.map(g => g.item), ['spacesuit']);
const natural = id => IT[id].tags.includes('天然資源');
const rawBad = goals.filter(g => { const t = SP.rawTotals(E.newState(), g, 1); return !Object.keys(t).length || !Object.keys(t).every(natural); });
ok('最終装備（機体の8部分・地上設備5つ・宇宙服）は、どれも天然資源までさかのぼれる', rawBad.length === 0, rawBad.join(','));
const rawAll = {}; goals.forEach(g => Object.entries(SP.rawTotals(E.newState(), g, 1)).forEach(([k, q]) => rawAll[k] = (rawAll[k] || 0) + q));
ok('鉄鉱石・銅鉱石・石英・原油・ボーキサイト・植物の繊維を、終盤まで使う', ['hematite', 'malachite', 'quartz', 'crude', 'bauxite', 'vine', 'sphalerite', 'cassiterite'].every(k => rawAll[k] > 0), JSON.stringify(rawAll));
const direct = D.crafts.filter(c => ['computer', 'shipcomputer'].includes(c.out)).map(c => Object.keys(c.inp)).flat();
ok('コンピューターは一段では作れない（砂・ケイ素・トランジスタから直接は組めない。演算制御装置と入出力装置を経る）', !direct.some(k => ['sand', 'quartz', 'silicon', 'pure_si', 'wafer', 'transistor'].includes(k)) && direct.includes('cpuboard') && direct.includes('iounit'));
ok('半導体から電子部品への加工は専用設備（半導体工房）だけ', D.procs.filter(p => p.out.transistor || p.out.chip || p.out.wafer).every(p => p.at.length === 1 && p.at[0] === 'semifab'));
const depthOf = id => { let d = 0; (function w(nn, k) { d = Math.max(d, k); nn.kids.forEach(c => w(c, k + 1)); })(SP.tree(E.newState(), id, 1, 40), 0); return d; };
ok('コンピューターは原料から10段以上の工程を経る', depthOf('computer') >= 10, String(depthOf('computer')));
ok('推進・誘導は架空の部品（説明に「架空」と書き、簡略化の印がある）', ['r_engine', 'propcell', 'nozzle'].every(id => /架空/.test(IT[id].name + IT[id].kid + IT[id].more) && IT[id].simp) && IT.shipcomputer.simp);
ok('宇宙計画の工作には「なぜこの材料か」がある', D.crafts.filter(c => X.fields.some(f => f.items.includes(c.out)) || IT[c.out].tags.includes('宇宙開発') || IT[c.out].tags.includes('電子部品')).every(c => c.why && c.why.length > 5));
ok('実習は8段階（回路→切り替え素子→論理→加算→記憶→役割→命令→センサー）', X.trials.length === 8 && X.trials.map(t => t.n).join('') === '12345678');

/* ---- 2 実習の模擬（純粋な関数） ---- */
ok('回路：導体をはさんでスイッチを入れたときだけ点灯', SP.circuitLamp('copper', true) && !SP.circuitLamp('rubber', true) && !SP.circuitLamp('copper', false));
ok('論理回路：AND・OR・NOT', [[0, 0], [0, 1], [1, 0], [1, 1]].every(([a, b]) => SP.GATE.and(a, b) === (a & b) && SP.GATE.or(a, b) === (a | b)) && SP.GATE.not(0) === 1 && SP.GATE.not(1) === 0);
let addOk = true; for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) if (SP.adder(a, b, 4) !== a + b) addOk = false;
ok('加算器：論理回路だけで作った4けたの足し算が、全部の組み合わせで正しい', addOk);
ok('記憶回路：書きこんだ値を、入力を変えても保つ', SP.memRun([['in', 11], ['write'], ['in', 4], ['read']]).reads[0].out === 11);
ok('命令の実行：足し算と表示', JSON.stringify(SP.vmRun([['set', 3], ['add', 4], ['out']]).out) === '[7]');
ok('命令の実行：くり返し（0 でなければ戻る）', JSON.stringify(SP.vmRun([['set', 3], ['out'], ['sub', 1], ['jnz', 1]]).out) === '[3,2,1]');
ok('命令の実行：終わらないプログラムは途中で止める', SP.vmRun([['set', 1], ['jnz', 0]]).halted === false);
const ANS = {
  circuit: { tried: ['rubber', 'copper'], gap: 'copper', sw: true }, switching: { seen: { on: true, off: true }, q: 'off' },
  gates: { rows: { and: [1, 1, 1, 1], or: [1, 1, 1, 1], not: [1, 1] }, q: 'or' }, adder: { sums: [[1, 2], [2, 3], [3, 3]] },
  memory: { ops: [['in', 11], ['write'], ['in', 4], ['read']] }, roles: { map: { 0: 'calc', 1: 'ctrl', 2: 'mem', 3: 'io' } },
  program: { progs: { g1: [['set', 3], ['add', 4], ['out']], g2: [['set', 3], ['out'], ['sub', 1], ['jnz', 1]] } }, sensors: { pick: 'co2' },
};
ok('実習の答え合わせ：正しい答えは合格、まちがいは理由つきで不合格', X.trials.every(t => SP.trialCheck(t.id, ANS[t.id]).pass) && !SP.trialCheck('gates', { rows: ANS.gates.rows, q: 'and' }).pass && /絶縁体/.test(SP.trialCheck('circuit', { tried: ['copper'], gap: 'copper', sw: true }).msg) && !SP.trialCheck('sensors', { pick: 'temp' }).pass);
const N0 = E.newState();
ok('実習は中間の成果物を持っていないと試せない（足りない物を言う）', !SP.trialPass(N0, 'gates', ANS.gates).ok && /論理回路の基板/.test(SP.trialPass(N0, 'gates', ANS.gates).msg) && !N0.space.know.gates);

/* ---- 3 最初から宇宙到達まで（ボット。エンジンの公開関数だけを使う） ---- */
const answerFor = (S, id) => { const t = SP.testTask(S, id);
  if (id === 'power') { const on = []; let sum = 0; for (const s of t.sources) if (sum + s.kw <= t.limit) { on.push(s.id); sum += s.kw; } return { on }; }
  if (id === 'computer') return { ans: t.sums.map(p => p[0] + p[1]) };
  if (id === 'comm') return { ch: t.channel, echo: t.pattern };
  return { checked: t.checks.map(c => c.id) }; };
const SITE = { 'sp-substation': { x: -52, z: 150 }, 'sp-assembly': { x: -76, z: 140 }, 'sp-pad': { x: -64, z: 136 }, 'sp-tower': { x: -59, z: 136 }, 'sp-control': { x: -64, z: 156 } };
function bot(S, opt = {}) {
  const log = {}; let round = 0;
  const mark = k => { if (log[k] === undefined) log[k] = round; };
  for (round = 0; round < 1500; round++) {
    for (const r of D.regions) { if (!E.regionOpen(S, r)) continue; for (const x of r.res) for (let i = 0; i < 3; i++) E.gather(S, r.id, E.resKey(x), { rng: Math.random }); }
    for (const c of D.crafts) { const it = IT[c.out]; if (it.unique && SP.owns(S, c.out)) continue; if (!it.unique && E.cnt(S, c.out) >= 12) continue; E.runCraft(S, c.id, S.seq); }
    for (const p of D.procs) {
      if (Object.keys(p.out).every(o => S.disc[o]) && Object.keys(p.out).every(o => IT[o].store === false || E.cnt(S, o) >= 14)) continue;
      const fac = p.at.find(f => E.has(S, f)); if (!fac) continue; E.runExperiment(S, Object.assign({}, p.inp), fac, p.op, S.seq);
    }
    for (const t of X.trials) if (!S.space.know[t.id] && SP.trialPass(S, t.id, ANS[t.id]).ok) mark('know:' + t.id);
    for (const g of X.ground) if (E.has(S, g.item) && !S.build[g.plan]) { S.build[g.plan] = { x: SITE[g.plan].x, z: SITE[g.plan].z, rot: 0 }; mark('place:' + g.item); }
    for (const m of X.modules) if (!SP.installed(S, m.slot) && SP.install(S, m.slot, S.seq).ok) mark('install:' + m.slot);
    for (const t of X.tests) if (!S.space.tests[t.id] && SP.runTest(S, t.id, answerFor(S, t.id), S.seq).ok) mark('test:' + t.id);
    if (E.has(S, 'spacesuit') && !S.space.wear) SP.wear(S, true);
    if (S.space.tests.final && S.space.wear && !S.space.board && SP.board(S, SITE['sp-tower']).ok) mark('board');
    if (SP.launchReady(S)) { mark('ready'); if (opt.stopAtReady) break; const st = SP.launchStart(S, S.seq); if (st.ok) { mark('launch'); const ar = SP.launchArrive(S); if (ar.ok) { mark('space'); break; } } }
  }
  return { log, round };
}
const S = E.newState(); const run = bot(S);
ok(`新しい通常のゲームから、採集・研究・工作・設置・組立・試験・搭乗を経て宇宙へ到達できる（${run.round}ラウンド）`, !!S.space.clear && run.log.space !== undefined, JSON.stringify(run.log));
ok('到達までに、8つの実習・8つの取りつけ・7つの試験をすべて通っている', X.trials.every(t => S.space.know[t.id]) && X.modules.every(m => S.space.inst[m.slot]) && X.tests.every(t => S.space.tests[t.id]));
ok('文明の段階は「宇宙へ届いた文明」（表示）', E.stageOf(S) === 6 && D.stages[6]);
ok('取りつけた部分は在庫から機体へ移る（在庫に残らない・もう一度は作れない）', X.modules.every(m => !E.cnt(S, m.item)) && !E.planCraft(S, D.crafts.find(c => c.out === 'r_frame')).ok);
const rec = S.space.clear.record;
ok('到達の記録に、最初の採集からの歩みが入る', rec.steps.length >= 15 && rec.found > 200 && rec.trials === 8 && rec.tests === 7 && rec.steps[0].t <= rec.steps[rec.steps.length - 1].t, JSON.stringify(rec).slice(0, 200));
/* 再演出：記録は初回のまま、資材は増えない */
const invBefore = JSON.stringify(S.inv), clearT = S.space.clear.t;
SP.board(S, SITE['sp-tower']); const st2 = SP.launchStart(S, S.seq); const ar2 = SP.launchArrive(S, clearT + 5000);
ok('2回目の打ち上げは再演出：初回の記録は変わらず、資材・報酬は増えない', st2.ok && !st2.first && ar2.ok && !ar2.first && S.space.clear.t === clearT && S.space.replays === 1 && JSON.stringify(S.inv) === invBefore);
ok('到達のあとは地上に戻っている（搭乗中でも打ち上げ中でもない。機体・設備・試験の記録はそのまま）', !S.space.board && !S.space.launching && SP.rocketDone(S) && SP.placed(S, 'launchpad') && S.space.tests.final);

/* ---- 4 条件不足では打ち上げられない ---- */
const R = E.newState(); bot(R, { stopAtReady: true });
ok('準備が全部そろうと打ち上げできる状態になる', SP.launchReady(R) && SP.launchChecks(R).length === 10);
const clone = () => E.deserialize(E.serialize(R));
const cases = {
  '搭乗していない': s => { s.space.board = false; }, '宇宙服を着ていない': s => { s.space.wear = false; },
  '発射台を撤去した': s => { s.build['sp-pad'] = { removed: true }; }, '外装を取りつけていない': s => { delete s.space.inst.skin; },
  '電源の試験がまだ': s => { delete s.space.tests.power; }, 'コンピューターの試験がまだ': s => { delete s.space.tests.computer; }, '通信の試験がまだ': s => { delete s.space.tests.comm; },
  '宇宙服の試験がまだ': s => { delete s.space.tests.suit; }, '生命維持の試験がまだ': s => { delete s.space.tests.life; }, '無人試験がまだ': s => { delete s.space.tests.unmanned; },
  '総合点検がまだ': s => { delete s.space.tests.final; }, '支持塔が遠い': s => { s.build['sp-tower'] = { x: -30, z: 136, rot: 0 }; }, '管制が近すぎる': s => { s.build['sp-control'] = { x: -60, z: 140, rot: 0 }; },
};
const loaded = clone(); ok('読み込むと搭乗は解除される（地上から再開）。もう一度乗れば打ち上げできる', !loaded.space.board && !SP.launchReady(loaded) && SP.board(loaded, SITE['sp-tower']).ok && SP.launchReady(loaded));
const leaks = [];
for (const [name, f] of Object.entries(cases)) { const s = clone(); SP.board(s, SITE['sp-tower']); f(s); const r = SP.launchStart(s, s.seq); if (r.ok || s.space.launching || !/（.+）/.test(r.msg)) leaks.push(name); }
ok('条件が1つでも欠けると有人打ち上げはできず、足りない物を具体的に言う（13通り）', leaks.length === 0, leaks.join(','));
const empty = E.newState(); const le = SP.launchStart(empty, empty.seq);
ok('何もない状態では打ち上げられない（10項目すべてが未達）', !le.ok && SP.launchChecks(empty).every(c => !c.ok && c.why));
empty.inv.r_frame = 1; ok('在庫に部品があるだけでは組立にならない（発射台と組立棟の設置が先）', !SP.install(empty, 'frame', empty.seq).ok && /発射台/.test(SP.install(empty, 'frame', empty.seq).msg) && !!empty.inv.r_frame);
empty.inv.launchpad = 1; ok('設備を作って持っているだけでは「設置済み」にならない', !SP.placed(empty, 'launchpad') && !SP.launchChecks(empty)[0].ok);
const far = clone(); ok('支持塔からはなれていると搭乗できない', !SP.board(far, { x: 0, z: 0 }).ok && /支持塔のそば/.test(SP.board(far, { x: 0, z: 0 }).msg));
const tf = clone(); delete tf.space.inst.skin; delete tf.space.tests.unmanned;
const ti = SP.testInfo(tf, 'unmanned');
ok('試験の結果から、不足する部品と行き先が分かる（外装がないと無人試験は受けられない）', !ti.ok && ti.lacks.some(l => /外装/.test(l.text) && l.go === 'slot' && l.item === 'r_skin') && !SP.runTest(tf, 'unmanned', answerFor(tf, 'unmanned'), tf.seq).ok);
const pw = clone(); delete pw.space.tests.power; const t0 = SP.testTask(pw, 'power');
ok('電源の試験：足りない・流しすぎは不合格（何度でもやり直せる・物は失わない）', !SP.runTest(pw, 'power', { on: [] }, pw.seq).ok && !SP.runTest(pw, 'power', { on: t0.sources.map(s => s.id) }, pw.seq).ok && JSON.stringify(pw.inv) === JSON.stringify(clone().inv) && SP.runTest(pw, 'power', answerFor(pw, 'power'), pw.seq).ok);

/* ---- 5 二重実行・中断・再読み込み ---- */
const d1 = clone(); SP.board(d1, SITE['sp-tower']); const tk = d1.seq; const a1 = SP.launchStart(d1, tk), a2 = SP.launchStart(d1, tk), a3 = SP.launchStart(d1, d1.seq);
ok('二重クリックで打ち上げが2回始まらない', a1.ok && !a2.ok && a2.kind === 'dup' && !a3.ok && a3.kind === 'dup');
const mid = E.deserialize(E.serialize(d1));
ok('演出の途中で再読み込みしても、中断が分かり（launching）、搭乗は解除されている', mid.space.launching > 0 && !mid.space.board && !mid.space.clear);
const cont = E.deserialize(E.serialize(mid)); const arr = SP.launchArrive(cont);
ok('中断から「続きを見る」で到達を記録できる', arr.ok && arr.first && !!cont.space.clear && !cont.space.launching);
const back = E.deserialize(E.serialize(mid)); SP.launchAbort(back);
ok('中断から「打ち上げ前に戻る」でも進行不能にならない（もう一度搭乗して打ち上げできる）', !back.space.launching && !back.space.clear && SP.board(back, SITE['sp-tower']).ok && SP.launchStart(back, back.seq).ok);
ok('到達していないのに到達の記録は作れない', !SP.launchArrive(clone()).ok);
const i1 = E.newState(); i1.inv = { launchpad: 1, assembly: 1, r_frame: 1 }; i1.build['sp-pad'] = { x: 0, z: 0, rot: 0 }; i1.build['sp-assembly'] = { x: 9, z: 0, rot: 0 };
const itk = i1.seq, x1 = SP.install(i1, 'frame', itk), x2 = SP.install(i1, 'frame', itk);
ok('取りつけの二重実行で部品が増減しない', x1.ok && !x2.ok && SP.rocketCount(i1) === 1 && !i1.inv.r_frame);

/* ---- 6 順序の飛び越し ---- */
const J = E.newState(); const cc = D.crafts.find(c => c.id === 'c_synfabric'); J.inv = { synfiber: 3, loom: 1 };
ok('文明の段階が低くても、材料と設備があれば宇宙計画の部品を作れる（段階0で合成繊維の布）', E.stageOf(J) === 0 && E.runCraft(J, 'c_synfabric', J.seq).ok && J.inv.synfabric === 1 && !!cc);
const J2 = E.newState(); J2.inv = { spacesuit: 1 }; J2.disc.spacesuit = { first: 1, made: 1, total: 1, routes: [], best: 0 };
ok('宇宙服を先に完成させて試験に合格してから、機体に取りかかってもよい', SP.runTest(J2, 'suit', answerFor(J2, 'suit'), J2.seq).ok && J2.space.tests.suit && SP.rocketCount(J2) === 0);
const J3 = E.newState(); J3.inv = { launchpad: 1, assembly: 1, r_frame: 1, r_capsule: 1, cabinlife: 1, r_skin: 1 }; J3.build['sp-pad'] = { x: 0, z: 0, rot: 0 }; J3.build['sp-assembly'] = { x: 9, z: 0, rot: 0 };
ok('機体は骨組みが先。あとは好きな順（カプセル→生命維持を先に）で取りつけられる。外装は最後', !SP.install(J3, 'capsule', J3.seq).ok && SP.install(J3, 'frame', J3.seq).ok && SP.install(J3, 'capsule', J3.seq).ok && SP.install(J3, 'life', J3.seq).ok && !SP.install(J3, 'skin', J3.seq).ok && SP.rocketCode(J3) === 5);
const J4 = E.newState(); J4.inv.bauxite = 5; ok('先に高度な原料（ボーキサイト）を見つけて保管しておける', E.cnt(J4, 'bauxite') === 5 && E.processBlock(J4, 'bauxite') !== null);

/* ---- 7 検証モード ---- */
const V = E.makeVerifyState(null);
ok('検証モード：知識の条件を通して全段階を試せる（通常のセーブとは別の状態）', !!V.verify && E.knows(V, 'gates') && E.planCraft(V, D.crafts.find(c => c.id === 'c_gateboard')).ok && Object.keys(V.space.know).length === 0);
ok('検証モードでも、設備を置かなければ打ち上げ条件は満たさない（全解放でも勝手にクリアにならない）', !SP.launchReady(V) && !V.space.clear);

/* ---- 8 主人公 ---- */
const H = clone(); H.flags = { hero: 'boy' }; SP.wear(H, true); const H2 = E.deserialize(E.serialize(H));
ok('宇宙服を着ても主人公の選択は変わらず、保存される', H2.flags.hero === 'boy' && H2.space.wear === true);

console.log(`\n${n - fail}/${n} 合格`);
process.exit(fail ? 1 : 0);
