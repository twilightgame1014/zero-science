// 街づくり：Muse の工程別の見た目・道の素材を受け取る口の検査（2026-11-14 Claude）。
// 正本は docs/construction/construction-assets.json の museFields。今は全部 null（＝ゲームは仮表示）なので、
// 既存の完成モデル（assets/build/buildings の GLB）の本物のノード名で「届いたらこう動く」ことを確かめる。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url);
const { code } = await transform(fs.readFileSync(new URL('src/construction-stage.ts', root), 'utf8'), { loader: 'ts', format: 'esm' });
const { stageKey, stageVisible, checkStageNodes } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let n = 0; const ok = (name, c) => { assert(c, name); n++; console.log('✅ ' + name); };
const glbNodes = f => { const b = fs.readFileSync(new URL(f, root)), l = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + l).toString('utf8')).nodes; };

/* 1. 今の契約：欄は null のまま（仮表示）。届いた欄は GLB の名前と合う */
const ca = JSON.parse(fs.readFileSync(new URL('docs/construction/construction-assets.json', root), 'utf8'));
const filled = ca.buildings.filter(b => b.museFields && b.museFields.stageNodes);
ok(`契約の建物 ${ca.buildings.length} 種のうち、工程別の見た目が届いたのは ${filled.length} 種（届いていない物は仮表示のまま進める）`, ca.buildings.length === 24);
for (const b of filled) { const f = `assets/build/buildings/${b.modelId}.glb`; const names = fs.existsSync(new URL(f, root)) ? glbNodes(f).map(x => x.name) : [];
  ok(b.id + '：工程のノード名がすべて完成モデルにある', checkStageNodes(b.museFields.stageNodes, names, b.stages.length).length === 0); }

/* 2. 工程の番号の決め方（kiln：2 工程） */
const sn = { 0: ['ringStone'], 1: ['ringStone', 'log', 'Flame'] };
ok('予定地（工程 0 が終わる前）は正式の見た目を出さない（杭だけ）', stageKey(sn, 'planned', 0, 2) === null && stageKey(sn, 'supplying', 0, 2) === null);
ok('施工中はその工程の姿、搬入中は終わった工程の姿、完成は done', stageKey(sn, 'constructing', 0, 2) === '0' && stageKey(sn, 'supplying', 1, 2) === '0' && stageKey(sn, 'constructing', 1, 2) === '1' && stageKey(sn, 'completed', 2, 2) === 'done');
ok('届いていない（null）なら使わない', stageKey(null, 'constructing', 0, 2) === null);

/* 3. 本物の完成モデル（たき火の GLB）で、工程ごとの表示 */
const nodes = glbNodes('assets/build/buildings/campfire.glb'), names = nodes.map(x => x.name);
const parent = new Map(); nodes.forEach((x, i) => (x.children || []).forEach(c => parent.set(c, i)));
const chain = i => { const out = []; for (let q = i; q !== undefined; q = parent.get(q)) out.push(nodes[q].name); return out; };
const meshIdx = nodes.map((x, i) => i).filter(i => nodes[i].mesh !== undefined);
const shown = key => meshIdx.filter(i => stageVisible(chain(i), key, sn)).map(i => nodes[i].name);
ok('たき火の GLB に契約の例のノード（ringStone・log・Flame）がある', checkStageNodes(sn, names, 2).length === 0);
ok('工程 0：石の輪（と接地影）だけ', shown('0').every(nm => /^ringStone|ContactShadow/.test(nm)) && shown('0').some(nm => /^ringStone/.test(nm)));
ok('工程 1：石と薪と炎（親の名前で子孫ごと）', shown('1').some(nm => /^log/.test(nm)) && shown('1').some(nm => /^flame|^Flame/i.test(nm)));
ok('完成（done）は全部', shown('done').length === meshIdx.length);
ok('足場 Scaffold_* は一覧にある工程だけ出て、完成では必ず隠れる', stageVisible(['Scaffold_A'], '0', { 0: ['Scaffold_A'] }) && !stageVisible(['Scaffold_A'], '1', { 0: ['Scaffold_A'], 1: [] }) && !stageVisible(['Scaffold_A'], 'done', { 0: ['Scaffold_A'] }));
ok('契約の検査：ない名前・範囲外の工程を見つける', checkStageNodes({ 0: ['nope'], 5: [] }, names, 2).length === 2);

/* 4. 道の接続点（roadConnectors）：届いたらそれを使う。なければ入口の前 0.8 マス */
const D = require('../src/game/construction-data.js');
global.DATA = require('../src/game/data.js'); const CONS = require('../src/game/construction.js');
const def = CONS.connectorsOf('kiln');
ok('既定の接続点は作業点の前（ゲームの値）', def.length === 1 && !def[0].muse);
CONS.setMuse({ buildings: { kiln: { roadConnectors: [[0, -2], [1.5, 0]] } } });
const mu = CONS.connectorsOf('kiln');
ok('Muse の roadConnectors が届くと、その点を使う（複数）', mu.length === 2 && mu.every(p => p.muse) && mu[0].z === -2);
CONS.setMuse(null);
ok('setMuse(null) で既定に戻る', !CONS.connectorsOf('kiln')[0].muse);

/* 5. ビルドが埋まった欄だけを ASSETS.consMuse に入れること・間違いで止まることは scripts/build.mjs。画面側の受け取りは tests/e2e/construction.mjs */
console.log(`\n${n} 件合格`);
