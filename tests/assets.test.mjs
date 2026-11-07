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
const rows = [...plan.matchAll(/\{id:"([^"]+)",\s*type:"([^"]+)",\s*at:\{x:([-\d.]+),z:([-\d.]+)\}(?:,\s*rot:([-\d.]+))?,\s*when:\(\)=>([^}\n]+)\}/g)]
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
const W = N.create(D, E, { terrainHeight: T.terrainHeight, distanceToRiver: T.distanceToRiver, cfg: T.DEFAULT_CONFIG });
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
console.log(`\n${total - fail}/${total} 合格`);
process.exit(fail ? 1 : 0);
