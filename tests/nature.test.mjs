// フィールドの自然物（nature.js）の回帰テスト：生成・当たり判定・経路・採取・保存・新規ゲームの進行
import { createRequire } from 'node:module';
import { loadTerrain } from './helpers/terrain.mjs';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), N = require('../src/game/nature.js');
const T = await loadTerrain();
const env = { terrainHeight: T.terrainHeight, distanceToRiver: T.distanceToRiver, cfg: T.DEFAULT_CONFIG };
const W = N.create(D, E, env);
let fail = 0, total = 0;
const ok = (name, cond, detail = '') => { total++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '：' + detail}`); if (!cond) fail++; };
const PR = N.PLAYER_R;
const solids = S => W.objects.filter(o => W.solid(S, o)).concat(W.statics);
const inside = (S, p) => solids(S).find(o => Math.hypot(p.x - o.x, p.z - o.z) < o.r + PR - 1e-3);

/* ---------- 生成 ---------- */
const W2 = N.create(D, E, env);
ok('同じ規則なら同じ配置・同じIDになる', W.objects.length === W2.objects.length && W.objects.every((o, i) => o.id === W2.objects[i].id && o.x === W2.objects[i].x));
const kinds = {}; W.objects.forEach(o => { kinds[o.kind] = (kinds[o.kind] || 0) + 1; });
ok('木・岩・小石・落ち枝・草むら・やぶがそろっている', ['tree', 'rock', 'pebble', 'twig', 'grass', 'bush'].every(k => kinds[k] >= 10), JSON.stringify(kinds));
ok('すべての自然物にID・種類・位置・向き・大きさ・当たり判定がある', W.objects.every(o => o.id && N.KINDS[o.kind] && isFinite(o.x) && isFinite(o.z) && isFinite(o.rot) && o.scale > 0 && o.r > 0 && typeof o.block === 'boolean'));
ok('IDが重ならない', new Set(W.objects.map(o => o.id)).size === W.objects.length);
// 水面は川の帯だけ（描画の buildWater：中心から約3.9マス）。川の外の低い土地は乾いた地面なので置いてよい（2026-11-07〜）
const wet = W.objects.filter(o => T.distanceToRiver(o.x, o.z, T.DEFAULT_CONFIG) < 4.0);
ok('川の水面の中には置かれていない', wet.length === 0, wet.map(o => o.id).join(','));
const locked = D.regions.filter(r => r.unlock);
/* 鍵のかかった地域を全部開けた状態（たいまつ・鉄のつるはし・掘削やぐらを持つ） */
const SU = E.newState(); ['torch', 'ironpick', 'pickaxe', 'rig', 'candle'].forEach(id => { SU.inv[id] = 1; SU.disc[id] = { first: 0, made: 1, total: 1, routes: [], best: 0 }; });
ok('鍵のかかった地域は、開放するまで中の自然物へ入れない', locked.every(r => !W.findPath(E.newState(), { x: D.base.x, z: D.base.z }, { x: r.w.x, z: r.w.z })));
const t0gen = Date.now(); N.create(D, E, env); const genMs = Date.now() - t0gen;
ok('マップ全体の自然物の生成は速い（1秒未満）', genMs < 1000, genMs + 'ms');
const L2 = W.layer2 || {};
ok('第2層（マップ全体の植生）で、木・草むら・やぶ・小石・岩・落ち枝が追加されている', L2.tree >= 80 && L2.grass >= 150 && L2.bush >= 40 && L2.pebble >= 30 && L2.rock >= 15 && L2.twig >= 40, JSON.stringify(L2));
{ let land = 0, cov = 0; for (let x = -50; x < 50; x += 8) for (let z = -50; z < 50; z += 8) {
    if (T.distanceToRiver(x + 4, z + 4, T.DEFAULT_CONFIG) < 6) continue; land++; if (W.around(x + 4, z + 4, 5.66).length) cov++; }
  ok('川以外の地面のほとんど（8マス四方の85%以上）に、何かしらの自然物がある', cov / land >= 0.85, cov + '/' + land); }
let tight = []; const bl = W.objects.filter(o => o.block);
bl.forEach((a, i) => bl.slice(i + 1).forEach(b => { if (Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + 2 * PR + 0.05) tight.push(a.id + '/' + b.id); }));
ok('木や岩のすき間は主人公が通れる幅がある', tight.length === 0, tight.slice(0, 5).join(' '));

/* ---------- 当たり判定 ---------- */
const S0 = E.newState();
const trees = W.objects.filter(o => o.kind === 'tree'), rocks = W.objects.filter(o => o.kind === 'rock');
let tunnel = [];
for (const o of trees.slice(0, 25).concat(rocks.slice(0, 25))) {
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, start = { x: o.x + Math.cos(a) * (o.r + PR + 2.5), z: o.z + Math.sin(a) * (o.r + PR + 2.5) };
    if (!W.free(S0, start.x, start.z)) continue;
    for (const step of [0.05, 0.7, 5.0]) {           // 普通の速さ・低FPS・とても大きなフレーム間隔
      let p = { ...start };
      for (let i = 0; i < Math.ceil(5 / step); i++) { const r = W.move(S0, p, -Math.cos(a) * step, -Math.sin(a) * step); p = { x: r.x, z: r.z }; }
      if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + PR - 0.01) tunnel.push(o.id + '@' + k + '/' + step);
    }
  }
}
ok('木の幹・岩を、どの方向・どんなフレーム間隔でもすり抜けない（斜めを含む8方向×3種の速さ）', tunnel.length === 0, tunnel.slice(0, 5).join(' '));
// 正面から当たったら回り込む・斜めなら滑る
const t0 = trees.find(o => { const s = { x: o.x - 3, z: o.z }; return W.free(S0, s.x, s.z) && W.free(S0, o.x + 3, o.z) && W.free(S0, o.x, o.z + 1.5) && W.free(S0, o.x, o.z - 1.5); });
let p = { x: t0.x - 3, z: t0.z };
for (let i = 0; i < 60; i++) { const r = W.move(S0, p, 0.1, 0); p = { x: r.x, z: r.z }; }
ok('木に正面からぶつかっても止まり続けず、外周に沿って回り込む', p.x > t0.x, JSON.stringify({ p, t: { x: t0.x, z: t0.z } }));
p = { x: t0.x - 3, z: t0.z - 0.3 };
for (let i = 0; i < 60; i++) { const r = W.move(S0, p, 0.1, 0.0); p = { x: r.x, z: r.z }; }
ok('少しずれて当たると、幹に沿って滑って進む', p.x > t0.x + 1 && !inside(S0, p));
ok('木の幹だけが壁になり、樹冠の下（幹の外）は歩ける', W.free(S0, t0.x + t0.r + PR + 0.05, t0.z) && !W.free(S0, t0.x + t0.r, t0.z));
const tw = W.objects.find(o => o.kind === 'twig'), gr = W.objects.find(o => o.kind === 'grass'), pb = W.objects.find(o => o.kind === 'pebble');
ok('落ち枝・草むら・小石は歩行を妨げない', [tw, gr, pb].every(o => W.free(S0, o.x, o.z) || W.objects.some(b => b.block && Math.hypot(b.x - o.x, b.z - o.z) < b.r + PR)));

/* ---------- 経路 ---------- */
let rng = 7; const rnd = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let pathFail = [], walkFail = [];
for (let i = 0; i < 40; i++) {
  const a = W.nearestFree(S0, { x: -45 + rnd() * 90, z: -45 + rnd() * 90 }), b = W.nearestFree(S0, { x: -45 + rnd() * 90, z: -45 + rnd() * 90 });
  if (!a || !b) continue;
  const path = W.findPath(S0, a, b);
  if (!path) { pathFail.push(i); continue; }
  let q = { ...a }; let bad = false;
  for (const wp of path) { for (let s = 0; s < 400; s++) { const dx = wp.x - q.x, dz = wp.z - q.z, d = Math.hypot(dx, dz); if (d < 0.2) break; const st = Math.min(d, 0.35); const r = W.move(S0, q, dx / d * st, dz / d * st); q = { x: r.x, z: r.z }; if (inside(S0, q)) bad = true; } }
  if (bad || Math.hypot(q.x - b.x, q.z - b.z) > 0.6) walkFail.push(i);
}
ok('離れた2点の間に経路が見つかる（入れない地域を除く40組）', pathFail.length <= 2, 'fail ' + pathFail.join(','));
ok('経路どおりに歩くと、障害物に埋まらず目的地に着く', walkFail.length === 0, 'fail ' + walkFail.join(','));
const rk = rocks[0];
const g = W.nearestFree(S0, { x: rk.x, z: rk.z });
ok('岩の中を目的地にすると、岩の外の立てる場所へ向かう', g && Math.hypot(g.x - rk.x, g.z - rk.z) >= rk.r + PR - 0.01);
const cave = D.regions.find(r => r.id === 'cave');
ok('入れない地域の中心へは経路がない', W.findPath(S0, { x: D.base.x, z: D.base.z }, { x: cave.w.x, z: cave.w.z }) === null);
const ap = W.approachPoint(S0, t0, { x: t0.x - 5, z: t0.z });
ok('採取対象へは中心ではなく外周の立てる位置へ向かう', ap && W.free(S0, ap.x, ap.z) && W.reachGap(t0, ap) <= E.REACH && Math.hypot(ap.x - t0.x, ap.z - t0.z) > t0.r);

/* ---------- 採取 ---------- */
const S = E.newState(); const now = 5e6;
const near = o => { const a = W.approachPoint(S, o, { x: o.x - 3, z: o.z }); return a; };
const far = W.harvest(S, tw.id, { pos: { x: tw.x + 6, z: tw.z }, token: S.seq, now });
ok('離れた場所からは採取できない', !far.ok && far.kind === 'far');
const tok = S.seq; const h1 = W.harvest(S, tw.id, { pos: near(tw), token: tok, now, rng: () => 0.99 }), h2 = W.harvest(S, tw.id, { pos: near(tw), token: tok, now, rng: () => 0.99 });
ok('落ち枝は道具なしで拾え、同じ操作の二重実行で増えない', h1.ok && !h2.ok && h2.kind === 'dup' && S.inv.twig === 2);
const h3 = W.harvest(S, tw.id, { pos: near(tw), token: S.seq, now });
ok('拾った落ち枝はなくなり、もう一度は採れない', !h3.ok && h3.kind === 'empty' && W.visual(S, tw, now).state === 'gone');
const tr = trees[3];
const noAxe = W.info(S, tr, now);
ok('道具がない木は、必要な道具と理由を示して採れない', !noAxe.ok && noAxe.kind === 'tool' && /石のおの|おの/.test(noAxe.reason));
S.inv.axe = 1;
ok('木は伐るまで幹が壁になる', W.solid(S, tr, now) && !W.free(S, tr.x, tr.z, now));
let logs = 0; for (let i = 0; i < 2; i++) { const h = W.harvest(S, tr.id, { pos: near(tr), token: S.seq, now, rng: () => 0.99 }); if (h.ok) logs += h.got.log; }
ok('おので木を伐ると丸太が得られ、最後に切り株になる', logs === 2 && W.visual(S, tr, now).state === 'stump');
ok('切り株になった木は見えない壁を残さない（中心を歩ける）', !W.solid(S, tr, now) && W.free(S, tr.x, tr.z, now) && W.visual(S, tr, now).collider.solid === false);
let q2 = { x: tr.x - 2, z: tr.z }; for (let i = 0; i < 40; i++) { const r = W.move(S, q2, 0.1, 0, now); q2 = { x: r.x, z: r.z }; }
ok('切り株の上はまっすぐ通り抜けられる', Math.abs(q2.z - tr.z) < 0.01 && q2.x > tr.x + 1.5);
const S1 = E.deserialize(E.serialize(S));
ok('保存→再読込でも、切り株・拾った落ち枝の状態が残る', W.visual(S1, tr, now).state === 'stump' && W.visual(S1, tw, now).state === 'gone' && W.free(S1, tr.x, tr.z, now));
ok('落ち枝は8分たつとまた落ちてくる（時刻を保存しているので再読込でも同じ）', W.visual(S1, tw, now + 7 * 60000).state === 'gone' && W.visual(S1, tw, now + 8 * 60000).state === 'intact');
S.inv.hammer = 1; const rk2 = rocks[2]; for (let i = 0; i < 3; i++) W.harvest(S, rk2.id, { pos: near(rk2), token: S.seq, now, rng: () => 0.99 });
ok('岩はハンマーで3回割ると残骸になり、何日たっても元に戻らない', W.visual(S, rk2, now).state === 'rubble' && W.visual(S, rk2, now + 1e10).state === 'rubble' && !W.solid(S, rk2, now));

/* ---------- 描画の寸法との照合（Muse の RESOURCE_VISUAL_SPECS） ---------- */
{
  const { build } = await import('esbuild');
  const path = (await import('node:path')).default, url = await import('node:url');
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const out = await build({ stdin: { contents: "export { RESOURCE_VISUAL_SPECS } from './src/graphics/ResourceRenderer';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const SPEC = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).RESOURCE_VISUAL_SPECS;
  const K = N.KINDS;
  ok('木の当たり判定は描画の幹の太さ以上で、幹から大きくはみ出さない（樹冠は壁にしない）', K.tree.r >= SPEC.tree.trunkRadius && K.tree.r <= SPEC.tree.trunkRadius + 0.15 && K.tree.r < SPEC.tree.footprintRadius * 0.5, JSON.stringify({ game: K.tree.r, spec: SPEC.tree }));
  ok('岩の当たり判定は描画の占有半径とほぼ同じ（±15%）', K.rock.r >= SPEC.rock.footprintRadius * 0.85 && K.rock.r <= SPEC.rock.footprintRadius * 1.15, JSON.stringify({ game: K.rock.r, spec: SPEC.rock }));
  ok('草むら・やぶの判定（歩行は妨げない）は描画の grass・bush の占有半径と一致する', Math.abs(K.grass.r - SPEC.grass.footprintRadius) < 0.01 && Math.abs(K.bush.r - SPEC.bush.footprintRadius) < 0.01 && !K.grass.block && !K.bush.block, JSON.stringify({ grass: [K.grass.r, SPEC.grass], bush: [K.bush.r, SPEC.bush] }));
  const DS = N.DEPOSIT_SHAPE, allRes = [...new Set(D.regions.flatMap(r => r.res.map(x => x.id)))];
  ok('すべての地域の採取地点に、描画の種類と当たり判定の決まりがある（描画に存在する種類）', allRes.every(id => DS[id] && SPEC[DS[id].vis]), allRes.filter(id => !DS[id] || !SPEC[DS[id].vis]).join(','));
  const solidBad = allRes.filter(id => { const d = DS[id]; const sp = SPEC[d.vis];
    if (d.vis === 'rock' || d.vis === 'ore') return !(d.r >= sp.footprintRadius * 0.85 && d.r <= sp.footprintRadius * 1.15);
    if (d.vis === 'tree') return !(d.r >= sp.trunkRadius && d.r <= sp.trunkRadius + 0.15);
    return d.r !== 0; });
  ok('岩・鉱石の姿の採取地点は占有半径の±15%、木の姿は幹の太さで壁になり、それ以外は歩行を妨げない', solidBad.length === 0, solidBad.join(','));
  const S9 = E.newState(); S9.inv.pickaxe = 1; S9.inv.ironpick = 1; S9.inv.torch = 1; S9.inv.rig = 1;
  const depBad = W.statics.filter(st => { if (W.free(S9, st.x, st.z)) return true; const ap = W.nearestFree(S9, { x: st.x, z: st.z }, undefined, 4); return !ap || Math.hypot(ap.x - st.x, ap.z - st.z) - 0.6 > E.REACH; });
  ok('壁になる採取地点は中心に入れず、外周の立てる場所から手が届く', depBad.length === 0, depBad.map(s => s.id).join(','));
  ok('描画に必要な種類（tree・rock・branch・pebble・herb・grass・bush・ore・water・oil）と採取後の形がそろっている', ['tree', 'rock', 'branch', 'pebble', 'herb', 'grass', 'bush', 'ore', 'water', 'oil'].every(t => SPEC[t]) && SPEC.tree.depletedForm === 'stump' && SPEC.rock.depletedForm === 'rubble' && SPEC.herb.depletedForm === 'cut-patch');
  const big = W.objects.filter(o => o.kind === 'tree' || o.kind === 'rock').reduce((m, o) => Math.max(m, o.scale), 0);
  const unreach = W.objects.filter(o => o.block).filter(o => { const ap = W.approachPoint(SU, o, { x: o.x + 5, z: o.z }); return !(ap && W.reachGap(o, ap) <= E.REACH); });
  ok('壁になる木・岩はすべて（いちばん大きい物も、地域を開放すれば鍵のかかった地域の中も）外周の立てる場所から手が届く', unreach.length === 0, 'max scale ' + big + ' ' + unreach.map(o => o.id).join(','));
}

/* ---------- 古いセーブ ---------- */
const oldTxt = JSON.stringify({ v: 1, inv: { twig: 3 }, disc: { twig: { first: 1, made: 1, total: 3, routes: [], best: 0 } }, pos: { x: rocks[5].x, z: rocks[5].z }, flags: { intro: 1 } });
const SO = E.deserialize(oldTxt);
const sp = W.safeSpawn(SO, SO.pos);
ok('古いセーブ（v1）を読み込める', SO.v === E.SCHEMA && SO.inv.twig === 3 && JSON.stringify(SO.nature) === '{}');
ok('古いセーブの主人公が岩に埋まっていたら、近くの安全な位置へ移す', sp.moved && W.free(SO, sp.x, sp.z) && Math.hypot(sp.x - rocks[5].x, sp.z - rocks[5].z) < 4);

/* ---------- 新規ゲーム：落ち枝と小石から最初の道具へ ---------- */
const G = E.newState(); let pos = { x: D.base.x, z: D.base.z };
function walkTo(o) {   // 経路を歩いて外周へ（当たり判定つき）
  const ap = W.approachPoint(G, o, pos); const path = ap && W.findPath(G, pos, ap); if (!path) return false;
  for (const wp of path) for (let s = 0; s < 800; s++) { const dx = wp.x - pos.x, dz = wp.z - pos.z, d = Math.hypot(dx, dz); if (d < 0.2) break; const r = W.move(G, pos, dx / d * Math.min(d, 0.35), dz / d * Math.min(d, 0.35)); pos = { x: r.x, z: r.z }; }
  return W.reachGap(o, pos) <= E.REACH;
}
function take(pred, times) {
  let n = 0;
  for (const o of W.objects.filter(pred).sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z))) {
    if (n >= times) break;
    if (!W.info(G, o).ok || !walkTo(o)) continue;
    while (n < times && W.harvest(G, o.id, { pos, token: G.seq, rng: () => 0.99 }).ok) n++;
  }
  return n;
}
take(o => o.kind === 'twig', 3); take(o => o.kind === 'pebble' && !o.variant, 2); take(o => o.variant === 'flint', 2);
const knife = E.runCraft(G, 'c_knife', G.seq);
take(o => o.kind === 'bush', 4);
const thread = E.runCraft(G, 'c_thread', G.seq);
const axe = E.runCraft(G, 'c_axe', G.seq);
const logN = take(o => o.kind === 'tree', 1);
ok('新規ゲーム：拠点の落ち枝・小石と川岸の火打ち石で「石のナイフ」が作れる', knife.ok && G.inv.knife === 1, JSON.stringify(G.inv));
ok('新規ゲーム：やぶのつるで糸、続けて「石のおの」を作り、木を伐って丸太を得られる', thread.ok && axe.ok && logN === 1 && G.inv.log >= 1, JSON.stringify(G.inv));
ok('最初の目標（木の枝）と2番目（丸い石・火打ち石）を新しい採取で達成できる', E.missionIndex(G) >= 2);


/* ---------- 開始時の原野（人工物を置かない）と拠点の建物 ---------- */
{
  const fs = await import('node:fs');
  const ui = fs.readFileSync(new URL('../src/game/ui.js', import.meta.url), 'utf8');
  const plan = ui.slice(ui.indexOf('const STRUCT_PLAN = ['), ui.indexOf('];', ui.indexOf('const STRUCT_PLAN = [')));
  const rows = plan.split('\n').filter(l => /\{id:"st-/.test(l));
  ok('拠点の建物は、プレイヤーが作った設備（owned）だけで出る（段階・研究の完了だけでは出ない）', rows.length >= 10 && rows.every(l => /when:\(\)=>owned\("/.test(l) && !/stage\(\)/.test(l)), rows.filter(l => !/owned\("/.test(l) || /stage\(\)/.test(l)).join('\n'));
  ok('描画モジュールの石の階段・石積みの壁（Stonework）は decor.stonework:false で描かせる（シーン走査はしない）', /stonework:false/.test(ui) && !/getObjectByName\("Stonework"\)|PREBUILT_SCENERY/.test(ui));
  const fn = name => { const i = ui.indexOf('function ' + name + '('); return ui.slice(i, ui.indexOf('\nfunction ', i + 10)); };
  const byStage = ['fieldSVG', 'baseArt', 'regionArt'].filter(n => /st\s*>=|st\s*===|S\.disc\.solarcell/.test(fn(n)));
  ok('地図・2D表示の道路・線路・工場・町並み・拠点の絵も、段階や研究ではなく作った設備（CIV）で決める', byStage.length === 0 && /const CIV = \(\)=>/.test(ui), byStage.join(','));
  const ww = rows.find(l => l.includes('st-wheel')), m = ww && ww.match(/at:\{x:([-\d.]+),z:([-\d.]+)\}/), site = N.SITES.find(x => x.id === 'st-wheel');
  ok('水車の場所は nature.js の SITES と一致し、水ぎわ（地面の高さが水位とほぼ同じ）にある', m && site && +m[1] === site.x && +m[2] === site.z
    && Math.abs(T.terrainHeight(site.x, site.z, T.DEFAULT_CONFIG) - T.DEFAULT_CONFIG.world.waterLevel) < 0.15 && T.distanceToRiver(site.x, site.z, T.DEFAULT_CONFIG) < 6.5, ww);
  const onSite = W.objects.filter(o => N.SITES.some(p => Math.hypot(o.x - p.x, o.z - p.z) < p.r + o.r));
  ok('拠点の外の建物の場所に自然物が重ならない', onSite.length === 0, onSite.map(o => o.id).join(','));
  const fsw = N.FORMER_STONEWORK.map(f => W.objects.filter(o => Math.hypot(o.x - f.at[0], o.z - f.at[1]) < 4).map(o => o.kind));
  ok('旧「石の階段・壁」の跡には、自然物（茂み・草・小石・不ぞろいな岩）だけがあり、跡全体が壁で埋まっていない',
    fsw.flat().length >= 4 && fsw.every(k => k.filter(x => x === 'rock' || x === 'tree').length <= 1), JSON.stringify(fsw));
  const blocked = N.FORMER_STONEWORK.filter(f => !W.findPath(S0, { x: D.base.x + 4, z: D.base.z }, { x: f.at[0], z: f.at[1] }));
  ok('旧「石の階段・壁」の跡へも拠点から歩いて行ける（階段を外しても進行不能にならない）', blocked.length === 0, JSON.stringify(blocked.map(f => f.at)));
  const open = D.regions.filter(r => r.w && !r.unlock), noWay = open.filter(r => !W.findPath(S0, { x: D.base.x + 4, z: D.base.z }, { x: r.w.x, z: r.w.z }));
  ok('開始地点（拠点）から、最初から行けるすべての地域へ経路がある', noWay.length === 0, noWay.map(r => r.id).join(','));
  const noWay2 = D.regions.filter(r => r.w).filter(r => !W.findPath(SU, { x: D.base.x + 4, z: D.base.z }, { x: r.w.x, z: r.w.z }));
  ok('鍵を開けたあとは、拠点からすべての地域（洞窟・鉱山・火山・油田も）へ経路がある', noWay2.length === 0, noWay2.map(r => r.id).join(','));
  const vm = await import('node:vm'); let synErr = '';
  for (const f of ['ui.js', 'engine.js', 'data.js', 'nature.js']) { try { new vm.Script(fs.readFileSync(new URL('../src/game/' + f, import.meta.url), 'utf8'), { filename: f }); } catch (e) { synErr += f + ': ' + e.message + ' '; } }
  ok('ゲームのスクリプトに構文エラーがない（ui.js・engine.js・data.js・nature.js）', !synErr, synErr);
}

/* ---------- 見た目の違い（Muse 第17ラウンド）と飾り・溶岩 ---------- */
{
  const S9 = E.newState(), cnt = k => W.objects.filter(o => (o.kind + ':' + o.variant) === k).length;
  ok('見た目の違い（針葉樹・葦・乾いたやぶ・苔むした岩・ヤシ）が地形に合わせて付く', cnt('tree:conifer') >= 5 && cnt('grass:reed') >= 10 && cnt('bush:dry') >= 3 && cnt('rock:mossy') >= 1 && cnt('tree:palm') >= 1,
    JSON.stringify({ c: cnt('tree:conifer'), r: cnt('grass:reed'), d: cnt('bush:dry'), m: cnt('rock:mossy'), p: cnt('tree:palm') }));
  const conif = W.objects.find(o => o.variant === 'conifer'), reed = W.objects.find(o => o.variant === 'reed');
  ok('見た目が違っても得られる素材は基本の種類と同じ（針葉樹→丸太、葦→草）。名前は見た目に合わせる', JSON.stringify(W.yieldsOf(conif)) === JSON.stringify(N.KINDS.tree.yields) && JSON.stringify(W.yieldsOf(reed)) === JSON.stringify(N.KINDS.grass.yields) && W.nameOf(conif) === '針葉樹' && W.nameOf(reed) === '葦の茂み');
  const conifRiver = W.objects.filter(o => o.variant === 'conifer' && T.distanceToRiver(o.x, o.z, T.DEFAULT_CONFIG) < 5.6);
  ok('葦は川岸だけ、針葉樹は川の中にない', W.objects.filter(o => o.variant === 'reed').every(o => T.distanceToRiver(o.x, o.z, T.DEFAULT_CONFIG) < 8.5) && conifRiver.length === 0);
  const logs = W.objects.filter(o => o.kind === 'twig' && o.variant === 'log');
  ok('倒木（branch:log）が森にあり、得られる素材は落ち枝と同じ・木や岩と重ならない', logs.length >= 5 && logs.every(o => JSON.stringify(W.yieldsOf(o)) === JSON.stringify(N.KINDS.twig.yields) && W.nameOf(o) === '倒木' && W.objects.every(q => q === o || ['grass', 'twig', 'pebble'].includes(q.kind) || Math.hypot(q.x - o.x, q.z - o.z) >= 0.85 + q.r + 0.35 - 1e-6)), logs.length + '');
  const lavas = W.decos.filter(d => d.kind === 'lava'), lilies = W.decos.filter(d => d.kind === 'lily');
  const vol = D.regions.find(r => r.id === 'volcano');
  ok('溶岩は火山地帯の中にあり、通れない（固定の障害物）', lavas.length >= 3 && lavas.every(l => Math.hypot(l.x - vol.w.x, l.z - vol.w.z) < 9.5 && !W.free(SU, l.x, l.z) && W.statics.some(s => s.id === l.id && s.kind === 'lava')), lavas.length + '');
  ok('溶岩の上・すぐそばに自然物はない', W.objects.every(o => lavas.every(l => Math.hypot(o.x - l.x, o.z - l.z) >= 0.8 * l.scale + o.r + 0.4 - 1e-6)));
  ok('溶岩は採取できる物の一覧に入らない（見た目と通行止めだけ）', lavas.every(l => !W.byId.get(l.id)) && W.objects.every(o => o.kind !== 'lava'));
  const lv = lavas[0], wbspec = { id: 't', type: 'workbench', footprint: { shape: 'rect', w: 2.2, d: 1.05 }, x: lv.x + 0.5, z: lv.z, rot: 0 };
  ok('溶岩の上・すぐそばには建物を置けない（理由つき）', /溶岩/.test(W.checkPlacement(SU, wbspec, { player: { x: -200, z: -200 } }).reasons.join('/')));
  ok('睡蓮は川の水面にあり（水位より低い所）、歩くのを妨げない', lilies.length >= 8 && lilies.every(l => T.terrainHeight(l.x, l.z, T.DEFAULT_CONFIG) < T.DEFAULT_CONFIG.world.waterLevel && T.distanceToRiver(l.x, l.z, T.DEFAULT_CONFIG) < 3.9 && W.free(S9, l.x, l.z)));
  const W3b = N.create(D, E, env);
  ok('見た目の違いと飾りは毎回同じ（位置から決める）', JSON.stringify(W3b.decos) === JSON.stringify(W.decos) && W3b.objects.every((o, i) => o.id === W.objects[i].id && o.variant === W.objects[i].variant));
}
console.log(`\n${total - fail}/${total} 合格`);
process.exit(fail ? 1 : 0);
