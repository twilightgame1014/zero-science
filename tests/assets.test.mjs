// Muse のアセット（建物の3Dモデル・道具／設備／操作のアイコン）とゲームのつなぎ込みの検査
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { loadTerrain } from './helpers/terrain.mjs';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), N = require('../src/game/nature.js');
const root = new URL('../', import.meta.url);
const rd = p => fs.readFileSync(new URL(p, root), 'utf8');
let total = 0, fail = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' ' + extra}`); };

/* ---------- アイコン（assets/buildings-icons → assets/build/tool-icons-64） ---------- */
const src = JSON.parse(rd('assets/buildings-icons/atlas.json')), built = JSON.parse(rd('assets/build/tool-icons-64.json'));
const items = Object.keys(D.items), tag = t => items.filter(k => D.items[k].tags.includes(t));
const want = [...tag('道具').map(k => 'tools/' + k), ...tag('研究設備').map(k => 'facilities/' + k), ...Object.keys(D.ops).map(k => 'ops/' + k)];
const missing = want.filter(k => !built.items[k]);
ok('道具・研究設備・操作のすべて（データから数えた ' + want.length + ' 件）に、ゲーム用アトラスのアイコンがある', missing.length === 0, missing.join(','));
ok('ゲーム用アトラスは原本のアトラスと同じキー（カテゴリ/ID）・同じ件数', Object.keys(src.entries).length === Object.keys(built.items).length && Object.keys(src.entries).every(k => built.items[k]));
ok('設備の「ろ過器」と操作の「ろ過」は別のアイコン（キーの衝突なし）', built.items['facilities/filter'] && built.items['ops/filter'] && String(built.items['facilities/filter']) !== String(built.items['ops/filter']));
ok('原本の名前とデータの名前が一致（道具・設備）', Object.entries(src.entries).filter(([k]) => !k.startsWith('ops/')).every(([k, v]) => D.items[k.split('/')[1]] && D.items[k.split('/')[1]].name === v.name),
  Object.entries(src.entries).filter(([k, v]) => !k.startsWith('ops/') && (!D.items[k.split('/')[1]] || D.items[k.split('/')[1]].name !== v.name)).map(([k]) => k).join(','));

/* ---------- 建物（assets/buildings-3d → assets/build/buildings） ---------- */
const spec = Object.fromEntries(JSON.parse(rd('assets/buildings-3d/structures.json')).structures.map(s => [s.id, s]));
const ui = rd('src/game/ui.js'), plan = ui.slice(ui.indexOf('const STRUCT_PLAN = ['), ui.indexOf('];', ui.indexOf('const STRUCT_PLAN = [')));
const rows = [...plan.matchAll(/\{id:"([^"]+)",\s*type:"([^"]+)",\s*at:\{x:([-\d.]+),z:([-\d.]+)\}(?:,\s*rot:([-\d.]+))?(?:,\s*rule:"[^"]+")?,\s*when:\(\)=>([^}\n]+)\}/g)]
  .map(m => ({ id: m[1], type: m[2], x: +m[3], z: +m[4], rot: m[5] !== undefined ? +m[5] : Math.atan2(D.base.x - (+m[3]), D.base.z - (+m[4])), when: m[6] }));
ok('STRUCT_PLAN を読めた（' + rows.length + ' 件）', rows.length >= 13);
const noModel = rows.filter(r => !spec[r.type] || !fs.existsSync(new URL('assets/build/buildings/' + r.type + '.glb', root)));
ok('拠点の建物の全種類に、Muse の正式値（structures.json）と埋め込み用の軽量 GLB がある', noModel.length === 0, noModel.map(r => r.type).join(','));
const badFac = rows.filter(r => spec[r.type] && spec[r.type].facilityId && !r.when.includes('owned("' + spec[r.type].facilityId + '")'));
ok('建物と設備の対応は structures.json の facilityId と同じ（作業台・たき火・かまど・簡易炉・蒸気機関・精留塔・水車・掘削やぐら）', badFac.length === 0, badFac.map(r => r.type + '←' + r.when).join(' / '));
ok('建物は作った設備（owned）で出る（段階 stage では出さない）', rows.every(r => /owned\("/.test(r.when) && !/stage\(\)/.test(r.when)));
// 軽量 GLB：可動部の名前が残っている
const glbNames = f => { const b = fs.readFileSync(new URL(f, root)); const L = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + L).toString('utf8')).nodes.map(n => n.name); };
const lostParts = Object.values(spec).flatMap(s => (s.movingParts || []).map(m => ({ t: s.id, n: m.name }))).filter(x => !glbNames('assets/build/buildings/' + x.t + '.glb').includes(x.n));
ok('軽量 GLB にも可動部（Flame・Wheel・Piston・DrillPipe・Winch・Bellows）が名前のまま残っている', lostParts.length === 0, JSON.stringify(lostParts));

/* ---------- 全部建てたときの配置と当たり判定 ---------- */
const T = await loadTerrain();
const W = N.create(D, E, Object.assign({}, T, { cfg: T.DEFAULT_CONFIG }));
const SV = E.makeVerifyState();
W.setStructures(rows.map(r => ({ ...r, footprint: spec[r.type].footprint })));
const st = W.structures();
const toW = (r, p) => { const c = Math.cos(r.rot), s = Math.sin(r.rot); return { x: r.x + c * p[0] + s * p[1], z: r.z - s * p[0] + c * p[1] }; };
const corners = o => o.shape === 'rect' ? [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]].map(([i, j]) => toW(o, [i * o.w / 2, j * o.d / 2])) : [{ x: o.x, z: o.z }];
const tight = [];
for (const a of st) for (const b of st) if (a.id < b.id) { const g = Math.min(...corners(a).map(p => W.sdist(b, p.x, p.z)), ...corners(b).map(p => W.sdist(a, p.x, p.z))); if (g < 1.0) tight.push(a.id + '/' + b.id + ':' + g.toFixed(2)); }
ok('全部建てても、建物どうしは重ならず、間を通れる（1マス以上あく）', tight.length === 0, tight.join(' '));
const cf = st.find(o => o.type === 'factory');
ok('建物の占有形状は壁になる（工場の中心・角の内側には立てない）', !W.free(SV, cf.x, cf.z) && !W.free(SV, toW(cf, [cf.w / 2 - 0.3, cf.d / 2 - 0.3]).x, toW(cf, [cf.w / 2 - 0.3, cf.d / 2 - 0.3]).z));
ok('屋根の張り出しの下（占有形状の外）は歩ける（小屋の屋根 w3.7 と基礎 w3.3 の間）', (() => { const h = st.find(o => o.type === 'hut'); const p = toW(h, [h.w / 2 + 0.2 + 0.36, 0]); return W.free(SV, p.x, p.z); })());
// 入口・操作位置のそば（1マス以内）に立てて、拠点から歩いて行ける
const bad = [];
for (const r of rows) for (const k of ['entrance', 'operate']) { const p0 = spec[r.type][k]; if (!p0) continue; const p = toW(r, p0); const q = W.nearestFree(SV, p, Date.now(), 1.0);
  if (!q || !W.findPath(SV, { x: D.base.x, z: D.base.z }, q)) bad.push(r.id + ':' + k); }
ok('どの建物も、入口・操作位置のすぐそば（1マス以内）に立てて、拠点から歩いて行ける', bad.length === 0, bad.join(','));
ok('全部建てても、拠点の真ん中（はじめの場所）は空いていて、すべての地域へ経路がある', W.free(SV, D.base.x, D.base.z) && D.regions.filter(r => r.w).every(r => W.findPath(SV, { x: D.base.x, z: D.base.z }, { x: r.w.x, z: r.w.z })));
// 移動：建物へ向かって歩いても中に入らない（矩形の外周に沿って滑る）
let inside = 0; for (let a = 0; a < 16; a++) { const ang = a / 16 * Math.PI * 2; let p = { x: cf.x + Math.cos(ang) * 6, z: cf.z + Math.sin(ang) * 6 };
  for (let i = 0; i < 80; i++) { const dx = cf.x - p.x, dz = cf.z - p.z, l = Math.hypot(dx, dz) || 1; p = W.move(SV, p, dx / l * 0.12, dz / l * 0.12); }
  if (W.sdist(cf, p.x, p.z) < N.PLAYER_R - 0.02) inside++; }
ok('どの向きから工場へ歩いても、壁の中に入らない', inside === 0, inside + '/16');
const cov = W.objects.filter(o => W.covered(o));
ok('建物の下になった自然物は、見えない・壁にならない・採れない（建物を取り除くと戻る）', cov.length > 0 && cov.every(o => W.visual(SV, o).state === 'gone' && !W.solid(SV, o) && !W.info(SV, o).ok)
  && (W.setStructures([]), cov.every(o => !W.covered(o))), cov.length + '件');

/* ---------- 建築モード：置けるかの判定・確定・撤去（nature.js） ---------- */
{
  const rows2 = [...plan.matchAll(/\{id:"([^"]+)",\s*type:"([^"]+)",\s*at:\{x:([-\d.]+),z:([-\d.]+)\}(?:,\s*rot:([-\d.]+))?(?:,\s*rule:"([^"]+)")?/g)]
    .map(m => ({ id: m[1], type: m[2], x: +m[3], z: +m[4], rot: m[5] !== undefined ? +m[5] : Math.atan2(D.base.x - (+m[3]), D.base.z - (+m[4])), rule: m[6] || null }));
  const P = (r, o = {}) => Object.assign({ id: r.id, type: r.type, footprint: spec[r.type].footprint, entrance: spec[r.type].entrance, operate: spec[r.type].operate, rule: r.rule, x: r.x, z: r.z, rot: r.rot }, o);
  const RES = [{ x: D.base.x, z: D.base.z, r: 1.3, why: '拠点の真ん中' }], far = { x: -200, z: -200 };
  W.setStructures(rows2.map(r => ({ ...r, footprint: spec[r.type].footprint })));
  const S2 = E.makeVerifyState();
  const badSlots = rows2.filter(r => !W.checkPlacement(S2, P(r), { player: { x: D.base.x, z: D.base.z }, reserved: RES }).ok);
  ok('建築：全部建てた状態でも、13種それぞれの決まった場所は「置ける」（自分の形は除いて判定）', badSlots.length === 0, badSlots.map(r => r.id + ':' + W.checkPlacement(S2, P(r), { reserved: RES }).reasons.join('/')).join(' '));
  const wb = rows2.find(r => r.id === 'st-bench'), ww = rows2.find(r => r.id === 'st-wheel');
  const why = (o, opt) => W.checkPlacement(S2, P(wb, o), Object.assign({ player: far, reserved: RES }, opt)).reasons.join('/');
  const tr = W.objects.find(o => o.kind === 'tree' && W.present(S2, o) && !W.covered(o));
  const steep = (() => { for (let x = 10; x < 54; x += 0.7) for (let z = -50; z < 20; z += 0.7) { const h = (a, b) => T.terrainHeight(a, b, T.DEFAULT_CONFIG); if (Math.abs(h(x + 0.6, z) - h(x - 0.6, z)) / 1.2 > 0.8 && T.distanceToRiver(x, z, T.DEFAULT_CONFIG) > 8) return { x, z }; } return null; })();
  ok('建築：川の中・水ぎわには置けない（理由つき）', /川/.test(why({ x: T.riverCenterX(0, T.DEFAULT_CONFIG), z: 0 })));
  ok('建築：木の上には置けない（先に伐る）', /木や岩/.test(why({ x: tr.x, z: tr.z })));
  ok('建築：急な斜面には置けない', steep && /傾き/.test(why({ x: steep.x, z: steep.z })), JSON.stringify(steep));
  ok('建築：ほかの建物と重ならない', /ほかの建物/.test(why({ x: rows2.find(r => r.id === 'st-kiln').x + 0.5, z: rows2.find(r => r.id === 'st-kiln').z })));
  ok('建築：主人公と重ならない・拠点の真ん中はあけておく', /主人公/.test(why({ x: -12, z: 22 }, { player: { x: -12, z: 22 } })) && /拠点の真ん中/.test(why({ x: D.base.x, z: D.base.z })));
  ok('建築：水車は川の水ぎわだけ（陸の真ん中には置けない）', /水ぎわ/.test(W.checkPlacement(S2, P(ww, { x: -12, z: 22 }), { player: far }).reasons.join('/')));
  ok('建築：開けた平らな地面なら置ける', W.checkPlacement(S2, P(wb, { x: -12, z: 22, rot: 0.3 }), { player: far, reserved: RES }).ok);
  // 確定：同じトークンでの2回目は取り消し（重複しない）
  const S3 = E.makeVerifyState(); const seq0 = S3.seq;
  const r1 = W.commitPlacement(S3, P(wb, { x: -12, z: 22, rot: 0.3 }), S3.seq - 0, { player: far, reserved: RES });
  const r2 = W.commitPlacement(S3, P(wb, { x: -12, z: 22, rot: 0.3 }), seq0, { player: far, reserved: RES });
  ok('建築：確定は一度だけ（連打しても2回目は取り消し、置き場所の記録は1つ）', r1.ok && !r2.ok && r2.kind === 'dup' && S3.seq === seq0 + 1 && Object.keys(S3.build).length === 1 && Math.abs(S3.build['st-bench'].x + 12) < 1e-9);
  const bad = W.commitPlacement(S3, P(wb, { x: tr.x, z: tr.z }), S3.seq, { player: far });
  ok('建築：置けない場所では確定しても何も変わらない', !bad.ok && S3.build['st-bench'].x === -12 && S3.seq === seq0 + 1);
  const rm = W.removePlacement(S3, 'st-bench', S3.seq);
  ok('建築：撤去すると記録は「撤去中」になり、持ち物（作業台）は残る', rm.ok && S3.build['st-bench'].removed === true && S3.inv.bench === 1);
  // 回転：矩形は向きで占有が変わる。撤去後は見えない壁が残らない
  W.setStructures([{ id: 'st-bench', type: 'workbench', x: -12, z: 22, rot: 0, footprint: spec.workbench.footprint }]);
  const in0 = !W.free(S3, -12 + 0.9, 22); W.setStructures([{ id: 'st-bench', type: 'workbench', x: -12, z: 22, rot: Math.PI / 2, footprint: spec.workbench.footprint }]);
  const in90 = !W.free(S3, -12 + 0.9, 22), along90 = !W.free(S3, -12, 22 + 0.9); W.setStructures([]);
  ok('建築：回転すると当たり判定も回る（作業台の長い辺の向きが変わる）・撤去すると壁が残らない', in0 && !in90 && along90 && W.free(S3, -12, 22));
}

/* ---------- 小さな集落（data.js の village）の配置 ---------- */
{
  const V = D.village, props = JSON.parse(rd('assets/gpt-expansion/props.json')).props;
  const pspec = Object.fromEntries(props.map(p => [p.id, p.footprint.r != null ? { shape: 'circle', r: p.footprint.r } : { shape: 'rect', w: p.footprint.w, d: p.footprint.d }]));
  const abs = p => ({ x: V.c.x + p.x, z: V.c.z + p.z });
  const items = V.huts.map(h => ({ id: h.id, type: 'hut', ...abs(h), rot: h.rot, footprint: spec.hut.footprint })).concat(V.props.map(p => ({ id: p.id, type: 'prop-' + p.type, ...abs(p), rot: p.rot, footprint: pspec[p.type] })));
  ok('集落の小物はすべて Muse の props.json にある種類（11種のうち使うもの）', V.props.every(p => pspec[p.type]) && new Set(V.props.map(p => p.type)).size >= 10);
  const W5 = N.create(D, E, Object.assign({}, T, { cfg: T.DEFAULT_CONFIG }));
  W5.setStructures(items); const st5 = W5.structures(), S5 = E.newState();
  const tight5 = []; for (const a of st5) for (const b of st5) if (a.id < b.id) { const g = Math.min(...corners(a).map(p => W5.sdist(b, p.x, p.z)), ...corners(b).map(p => W5.sdist(a, p.x, p.z))); if (g < 0.3) tight5.push(a.id + '/' + b.id + ':' + g.toFixed(2)); }
  ok('集落の小屋・小物は重ならない（0.3マス以上あく）', tight5.length === 0, tight5.join(' '));
  ok('集落の小屋・小物は、すべて集落の範囲（半径）の中に収まる', st5.every(o => corners(o).every(p => Math.hypot(p.x - V.c.x, p.z - V.c.z) <= V.r + 0.01)), '');
  ok('集落の中に自然物はない（家や通り道をふさがない）', W5.objects.every(o => Math.hypot(o.x - V.c.x, o.z - V.c.z) >= V.r + o.r - 1e-6));
  const hutBad = V.huts.filter(h => { const t = st5.find(o => o.id === 'struct:' + h.id), e = spec.hut.entrance, w = toW(t, [e[0], e[1] + 0.6]); return !W5.free(S5, w.x, w.z); });
  ok('集落の小屋の入口の前があいている', hutBad.length === 0, hutBad.map(h => h.id).join(','));
  const wBad = V.npcs.flatMap(n => n.wander.map(p => ({ n: n.id, ...abs(p) }))).filter(p => !W5.free(S5, p.x, p.z));
  ok('人（NPC）が歩く地点は、どれも立てる場所（小屋・小物に埋まらない）', wBad.length === 0, JSON.stringify(wBad));
  const goBad = V.npcs.map(n => abs(n.home)).filter(p => !W5.findPath(S5, { x: D.base.x, z: D.base.z }, { x: p.x + 1.2, z: p.z }));
  ok('拠点から集落の人のそばまで歩いて行ける', goBad.length === 0, JSON.stringify(goBad));
}
/* ---------- 自然物・街の 3D モデル（Muse の環境セット・GPT-DQ3。2026-11-12、scripts/make-nature-glb.py） ---------- */
{
  const man = JSON.parse(rd('assets/build/nature/manifest.json')), nm = rd('src/world/natureModels.ts');
  const used = [...new Set([...nm.matchAll(/'((?:tree|rock|shrub|shell|basalt)-[a-z0-9-]+|stump|log-fallen|moss-rock|driftwood|rock-m-depleted)'/g)].map(m => m[1]))];
  const lacking = used.filter(id => !man.nature[id] || !fs.existsSync(new URL('assets/build/nature/' + id + '.glb', root)));
  ok('自然物の差し替えに使う全モデル（' + used.length + ' 種）に、軽量版の GLB がある', used.length >= 20 && lacking.length === 0, lacking.join(','));
  const tex = new Set(Object.keys(man.textures)), refs = Object.values(man.nature).concat(Object.values(man.town), Object.values(man.buildings), Object.values(man.props), Object.values(man.lod1)).flatMap(v => v.textures);
  ok('軽量版の GLB が参照する共有テクスチャ（' + tex.size + ' 枚）はすべてある（"tex:<hash>"）', refs.every(h => tex.has(h) && fs.existsSync(new URL('assets/build/nature-tex/' + h + '.webp', root))));
  ok('共有テクスチャで重複がなくなった（同じ画像は1枚。元の画像の合計より小さい）', Object.values(man.textures).reduce((a, t) => a + t.bytesOut, 0) < Object.values(man.textures).reduce((a, t) => a + t.bytesIn, 0) / 4);
  const bt = Object.keys(spec), liteMiss = bt.filter(id => !fs.existsSync(new URL('assets/build/buildings-lite/' + id + '.glb', root)));
  ok('拠点の建物の全種類に、共有テクスチャ版（buildings-lite）がある', liteMiss.length === 0, liteMiss.join(','));
  ok('建物・小物の共有テクスチャ版は接地影（ContactShadow）を残す（自然物と街のモデルだけ外す）', Object.values(man.buildings).every(v => v.droppedShadowMeshes === 0) && Object.values(man.props).every(v => v.droppedShadowMeshes === 0));
  const ts = JSON.parse(rd('assets/build/town/specs.json')).town;
  ok('街の建物・小物 12 種に、占有形状（広場は歩ける＝なし、旗は竿だけ）と軽量版 GLB がある', Object.keys(ts).length === 12 && ts.plaza.footprint === null && ts['banner-red'].footprint.r <= 0.15 &&
    Object.keys(ts).every(id => fs.existsSync(new URL('assets/build/town/' + id + '.glb', root))));
  ok('LOD1 は大きな岩だけ（形と寸法が LOD0 と同じ・描画回数が減る）。木の LOD1 は形が違うので使わない',
    Object.keys(man.lod1).every(id => /^rock-l-/.test(id)) && Object.entries(man.lodReport).filter(([k]) => /^rock-l-/.test(k)).every(([, r]) => r.size0.join() === r.size1.join() && r.meshes1 < r.meshes0));
  ok('自然物のモデルは、旧い見た目と重ねない（群れの中身を入れ替えるだけ）・読めないときは旧い見た目（buildNode を包む）', /origNode\(state, seed\)/.test(nm) && /group: made\.group/.test(nm) && !/group\.add\(.*origNode/.test(nm));
  ok('ジオメトリは共有の印（モジュールの破棄で消さない）・材質はノードごとに複製（フェード）', /userData\.shared = true/.test(nm) && /x\.clone\(\)/.test(nm));
  const dist = new URL('dist/index.html', root);
  if (fs.existsSync(dist)) ok('ビルドした1ファイルの HTML は 16MB 以下（非公開ページに置ける大きさ）', fs.statSync(dist).size <= 16 * 1024 * 1024, (fs.statSync(dist).size / 1048576).toFixed(2) + 'MB');
}

console.log(`\n${total - fail}/${total} 合格`);
process.exit(fail ? 1 : 0);
