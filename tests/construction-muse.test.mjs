// 街づくり：Muse の正式素材（feature/graphics-city-construction-final、2026-11-14）の受け取りの検査（Claude）。
// 正本は docs/construction/CONSTRUCTION-CONTRACT.md の「Muse の納品」節と construction-assets.json の museFields。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url);
const { code } = await transform(fs.readFileSync(new URL('src/construction-stage.ts', root), 'utf8'), { loader: 'ts', format: 'esm' });
const { stageKey, stageVisible, checkStageNodes, normName, scaffoldPlan, pileKind } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let n = 0; const ok = (name, c, extra = '') => { assert(c, name + ' ' + extra); n++; console.log('✅ ' + name); };
const readGlb = f => { const b = fs.readFileSync(new URL(f, root)), l = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + l).toString('utf8')); };
const ca = JSON.parse(fs.readFileSync(new URL('docs/construction/construction-assets.json', root), 'utf8'));
const glbOf = id => [`assets/build/buildings/${id}.glb`, `assets/build/town/${id.replace(/^town-/, '')}.glb`].find(f => fs.existsSync(new URL(f, root)));

/* 1. 納品の範囲：24 建物すべてに stageNodes・roadConnectors、道 3 種に色と法線のテクスチャ */
ok('24 建物すべてに工程の一覧（工程の数と同じ）', ca.buildings.length === 24 && ca.buildings.every(b => b.museFields.stageNodes && Object.keys(b.museFields.stageNodes).length === b.stages.length));
const deco = ca.buildings.filter(b => !b.museFields.roadConnectors).map(b => b.id);
ok(`道の接続点：入口か作業点のある建物と広場 ${24 - deco.length} 種は確定、小さな飾り ${deco.length} 種（${deco.join('・')}）は無し（道につながらない）`, ca.buildings.every(b => b.museFields.roadConnectors ? b.museFields.roadConnectors.length > 0 : (!b.entrance && !b.operate && b.category !== 'public' || ['lantern'].includes(b.id))));
ok('道 3 種に色・法線のテクスチャがあり、ファイルが実在する', ca.roads.length === 3 && ca.roads.every(r => r.museFields.tileTexture && fs.existsSync(new URL(r.museFields.tileTexture, root)) && fs.existsSync(new URL(r.museFields.normalTexture, root))));

/* 2. 全 24 モデル：名前は GLB と一致（正規化後）、正規化でぶつからない、累積、ContactShadow は最後だけ、
      親が隠れて子が見えなくなる組合せがない（three.js は隠れた親の子を描かない） */
let checked = 0;
for (const b of ca.buildings) {
  const f = glbOf(b.modelId); assert(f, b.id + ' の完成モデル'); const js = readGlb(f), names = js.nodes.map(x => x.name), sn = b.museFields.stageNodes, N = b.stages.length;
  const errs = checkStageNodes(sn, names, N); assert.deepEqual(errs, [], b.id);
  for (let k = 1; k < N; k++) assert(sn[k - 1].every(x => sn[k].includes(x)), b.id + '：一覧は累積');
  for (let k = 0; k < N - 1; k++) assert(!sn[k].includes('ContactShadow'), b.id + '：途中に接地影がない');
  const parent = new Map(); js.nodes.forEach((x, i) => (x.children || []).forEach(c => parent.set(c, i)));
  for (let k = 0; k < N; k++) js.nodes.forEach((x, i) => { if (x.mesh === undefined || !stageVisible(normName(x.name), String(k), sn)) return;
    for (let q = parent.get(i); q !== undefined; q = parent.get(q)) if (js.nodes[q].mesh !== undefined) assert(stageVisible(normName(js.nodes[q].name), String(k), sn), `${b.id} 工程${k}：${x.name} の親 ${js.nodes[q].name}（メッシュ）が隠れる`); });
  /* 最後の一覧＝完成した姿（メッシュのノードを全部含む） */
  const meshNodes = js.nodes.filter(x => x.mesh !== undefined).map(x => normName(x.name));
  assert(meshNodes.every(m => stageVisible(m, String(N - 1), sn)), b.id + '：最後の一覧は完成した姿');
  checked++;
}
ok(`全 ${checked} モデル：ノード名が GLB と一致（正規化後）・ぶつからない・累積・接地影は最後だけ・親が隠れる組合せなし・最後の一覧が完成形`, checked === 24);

/* 3. 工程の番号の決め方（契約：工程 k の施工中は一覧 k−1。予定地・工程 0 の施工中は建物なし） */
const sn = { 0: ['a'], 1: ['a', 'b'], 2: ['a', 'b', 'c'] };
ok('予定地・搬入中（工程 0 の前）・工程 0 の施工中は建物のノードを出さない', stageKey(sn, 'planned', 0, 3) === null && stageKey(sn, 'supplying', 0, 3) === null && stageKey(sn, 'constructing', 0, 3) === null);
ok('工程 1 の施工中は一覧 0、工程 2 の施工中は一覧 1、工程 1 が終わって搬入中は一覧 0、完成は done', stageKey(sn, 'constructing', 1, 3) === '0' && stageKey(sn, 'constructing', 2, 3) === '1' && stageKey(sn, 'supplying', 1, 3) === '0' && stageKey(sn, 'completed', 3, 3) === 'done');
ok('名前の正規化は GLTFLoader と同じ（post.001 → post001、空白 → _）', normName('post.001') === 'post001' && normName('a b') === 'a_b' && stageVisible('post001', '0', { 0: ['post.001'] }));
ok('完成（done）は全部・足場は常に隠す（足場は共有キットから別に置く）', stageVisible('x', 'done', sn) && !stageVisible('Scaffold_Post', 'done', sn));

/* 4. 足場の配置（契約の規則） */
const P = scaffoldPlan('rect', 3.3, 2.2, 0, 1, 3, 2.4);
ok('足場の高さは (k+1)/N ×（建物の高さ＋0.6）', Math.abs(P.H - 2 / 3 * 3.0) < 1e-9);
const segLen = P.segs.map(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]));
ok('柱は外周（占有範囲＋0.45）の角と 2.2 以下の間隔', segLen.every(l => l <= 2.2 + 1e-9) && P.posts.some(p => Math.abs(p[0] - (3.3 / 2 + 0.45)) < 1e-9 && Math.abs(p[1] - (2.2 / 2 + 0.45)) < 1e-9));
const P2 = scaffoldPlan('rect', 12, 12, 0, 2, 3, 6);
ok('横木は 2.2 ごとの段と最上段、足場板は最上段の入口側ともう 1 面、筋交いは 1 つおき', P2.levels.length === 3 && P2.levels[0] === 2.2 && Math.abs(P2.levels[1] - 4.4) < 1e-9 && Math.abs(P2.top - 6.6) < 1e-9 && P2.planks.every(s => s.side === '+z' || s.side === '+x') && P2.braces.length === Math.ceil(P2.segs.length / 2));
ok('円形の建物も 8 点の外周に足場', scaffoldPlan('circle', 0, 0, 1.15, 0, 2, 1.6).posts.length >= 8);

/* 5. 資材の山の種類（木材→lumber・石材→stone・袋物→sacks・金属→metal・その他→crated） */
ok('資材の種類から山の形を選ぶ', pileKind('log') === 'lumber' && pileKind('brick') === 'stone' && pileKind('plaster') === 'sacks' && pileKind('steel') === 'metal' && pileKind('pot') === 'crated');
const C = require('../src/game/construction-data.js'); const mats = new Set(); C.defs.forEach(d => d.stages.forEach(s => Object.keys(s.mat).forEach(k => mats.add(k))));
ok('建物の資材はすべて山の形に割り当たる（その他は箱詰め）', [...mats].every(m => ['lumber', 'stone', 'sacks', 'metal', 'crated'].includes(pileKind(m))));

/* 6. 道の接続点：契約の roadConnectors を使う（広場は 4 方向） */
global.DATA = require('../src/game/data.js'); const CONS = require('../src/game/construction.js');
ok('契約がないときは以前の近似（入口・作業点の前 0.8）', CONS.connectorsOf('kiln').length === 1 && !CONS.connectorsOf('kiln')[0].muse);
const muse = { buildings: Object.fromEntries(ca.buildings.map(b => [b.id, { roadConnectors: b.museFields.roadConnectors }])), roads: {} };
CONS.setMuse(muse);
ok('納品の roadConnectors を使う（かまどは (0,1.95)、広場は 4 方向）', CONS.connectorsOf('kiln')[0].muse && CONS.connectorsOf('kiln')[0].z === 1.95 && CONS.connectorsOf('plaza').length === 4);
CONS.setMuse(null);

/* 7. 軽量版（scripts/make-construction-glb.py）：ノード名・三角形の数は原本と同じ、画像は共有テクスチャ */
const man = JSON.parse(fs.readFileSync(new URL('assets/build/construction/manifest.json', root), 'utf8'));
for (const id of ['construction-site', 'scaffold-kit', 'pile-lumber', 'pile-stone', 'pile-sacks', 'pile-metal', 'pile-crated']) {
  const a = readGlb(`assets/construction/models/${id}.glb`), b = readGlb(`assets/build/construction/${id}.glb`);
  assert.deepEqual(a.nodes.map(x => x.name), b.nodes.map(x => x.name), id); assert(man.models[id], id);
  for (const h of man.models[id].textures) assert(fs.existsSync(new URL(`assets/build/nature-tex/${h}.webp`, root)), id + ' ' + h); }
ok('予定地・足場・資材の山 7 点の軽量版：ノード名は原本どおり、画像は共有テクスチャにある', true);
const site = readGlb('assets/build/construction/construction-site.glb').nodes.map(x => x.name), sc = readGlb('assets/build/construction/scaffold-kit.glb').nodes.map(x => x.name);
ok('予定地キットに杭・縄・輪郭、足場キットに 5 部品', ['stakePP', 'stakePM', 'stakeMP', 'stakeMM', 'ropeX_P', 'ropeX_M', 'ropeY_P', 'ropeY_M', 'outlineX_P', 'outlineY_M'].every(x => site.includes(x)) && ['Scaffold_Post', 'Scaffold_Beam', 'Scaffold_Plank', 'Scaffold_Brace', 'Scaffold_Ladder'].every(x => sc.includes(x)));
ok('道のテクスチャの軽量版（WebP）がある', ['dirt', 'gravel', 'stone'].every(k => fs.existsSync(new URL(`assets/build/construction/road-${k}.webp`, root)) && fs.existsSync(new URL(`assets/build/construction/road-${k}_n.webp`, root))));
console.log(`\n${n} 件合格`);
