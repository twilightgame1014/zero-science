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
const wet = W.objects.filter(o => T.terrainHeight(o.x, o.z, T.DEFAULT_CONFIG) < T.DEFAULT_CONFIG.world.waterLevel + 0.1);
ok('水の中に置かれていない', wet.length === 0, wet.map(o => o.id).join(','));
const locked = D.regions.filter(r => r.unlock);
ok('まだ入れない地域の中には置かれていない', !W.objects.some(o => locked.some(r => Math.hypot(o.x - r.w.x, o.z - r.w.z) < 9)));
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

console.log(`\n${total - fail}/${total} 合格`);
process.exit(fail ? 1 : 0);
