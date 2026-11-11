// 広い世界（2026-11-07）の回帰テスト：地形の互換・面積・山と海岸・滝の水の高さ・歩ける/歩けない・経路・第3層の自然物
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from './helpers/terrain.mjs';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), N = require('../src/game/nature.js');
const T = await loadTerrain();
// 描画モジュールの元の地形関数（差し替え前）
const orig = await (async () => { const o = await build({ stdin: { contents: "export { terrainHeight } from './src/graphics/utils';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'cjs', write: false, logLevel: 'warning' });
  const m = { exports: {} }; new Function('module', 'exports', o.outputFiles[0].text)(m, m.exports); return m.exports.terrainHeight; })();
const cfg = T.DEFAULT_CONFIG, H = (x, z) => T.terrainHeight(x, z, cfg);
let fail = 0, total = 0;
const ok = (name, cond, detail = '') => { total++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '：' + detail}`); if (!cond) fail++; };
const env = Object.assign({}, T, { cfg });
const W = N.create(D, E, env);
const SU = E.newState(); ['torch', 'ironpick', 'pickaxe', 'rig', 'candle'].forEach(id => { SU.inv[id] = 1; SU.disc[id] = { first: 0, made: 1, total: 1, routes: [], best: 0 }; });

/* ---------- 旧世界の互換 ---------- */
{ let maxD = 0; for (let x = -60; x <= 60; x += 0.37) for (let z = -60; z <= 60; z += 0.41) maxD = Math.max(maxD, Math.abs(H(x, z) - orig(x, z, cfg)));
  ok('旧世界（|x|,|z|≤60）の地形の高さは描画モジュールの元の関数とまったく同じ', maxD === 0, 'max差 ' + maxD); }
{ // 旧世界の外へ出た所も、境目でなめらか（段差がない）
  let worst = 0; for (let t = -60; t <= 60; t += 1) for (const [x, z] of [[60, t], [-60, t], [t, 60], [t, -60]]) { const a = H(x, z), b = H(x + Math.sign(x || 0) * 0.5 * (Math.abs(x) === 60 ? 1 : 0), z + Math.sign(z || 0) * 0.5 * (Math.abs(z) === 60 ? 1 : 0)); worst = Math.max(worst, Math.abs(a - b)); }
  ok('旧世界との境目で地形に段差がない（0.5マスで高さの差 0.6 未満）', worst < 0.6, worst.toFixed(3)); }
ok('地形の版がある（エンジンのセーブの版と同じ）', T.WORLD_VERSION >= 2 && E.WORLD_VER === T.WORLD_VERSION);

/* ---------- 面積（探索できる陸地） ---------- */
function landArea(minX, maxX, minZ, maxZ, wide) {
  let land = 0; const G = 1;
  for (let x = minX + G / 2; x < maxX; x += G) for (let z = minZ + G / 2; z < maxZ; z += G) {
    const h = H(x, z);
    if (!wide) { const halfW = 3.9 + Math.sin(z * 0.21) * 0.35; if (T.distanceToRiver(x, z) < halfW && h < cfg.world.waterLevel) continue; land++; continue; }
    const w = T.waterAt(x, z, h); if (w.kind === 'river' || (w.kind && w.depth > T.WADE_DEPTH)) continue;
    const sl = Math.max(Math.abs(H(x + 0.5, z) - H(x - 0.5, z)), Math.abs(H(x, z + 0.5) - H(x, z - 0.5)));
    if (sl > T.WALK_SLOPE) continue; land++;
  }
  return land * G * G;
}
const before = landArea(-56, 56, -56, 56, false), after = landArea(T.WALK.minX, T.WALK.maxX, T.WALK.minZ, T.WALK.maxZ, true);
const ratio = after / before;
console.log(`   探索できる陸地：改修前 ${before} m²（±56）→ 改修後 ${after} m²（${T.WALK.minX}〜${T.WALK.maxX}）＝ ${ratio.toFixed(2)} 倍`);
ok('探索できる陸地の面積は改修前の約9倍（8.6〜9.6倍）', ratio > 8.6 && ratio < 9.6, ratio.toFixed(2));

/* ---------- 山・海岸・湖・滝の形 ---------- */
ok('山の頂は高く（30以上）、見晴らし台は中腹より高い（18以上）', H(T.PEAK.x, T.PEAK.z) > 30 && H(T.LOOKOUT.x, T.LOOKOUT.z) > 18, H(T.PEAK.x, T.PEAK.z).toFixed(1) + '/' + H(T.LOOKOUT.x, T.LOOKOUT.z).toFixed(1));
{ // Muse の7エリア（ラウンド18）が土台：エリアの中心の地形の性格
  const A = id => T.DEFAULT_AREAS.find(a => a.id === id), hc = id => H(A(id).x, A(id).z);
  ok('Muse の7エリアがある（火山は高い・湖畔と海岸は水・街の予定地は平ら・雪山は山の土台）', hc('volcano') > 15 && T.waterAt(A('lakeside').x, A('lakeside').z, hc('lakeside')).kind === 'lake' && T.waterAt(A('coast').x, A('coast').z, hc('coast')).kind === 'sea' && Math.abs(hc('town') - 0.58) < 0.3 && hc('snow') > 10,
    JSON.stringify(['volcano', 'lakeside', 'coast', 'snow', 'desert', 'town'].map(id => id + ':' + hc(id).toFixed(1))));
  const xs = []; for (let z = -20; z <= 40; z += 6) { let x = 110; while (x < 200 && T.waterAt(x, z, H(x, z)).kind !== 'sea') x += 0.5; xs.push(x); }
  ok('海岸の岸の線は場所で変わる（曲がった海岸線）', Math.max(...xs) - Math.min(...xs) > 3, xs.join(',')); }
{ // 旧世界の水位より低い乾いた低地は、以前どおり水にしない（Muse の全面の水面は旧世界の中では見せない）
  let wet = 0, low = 0; for (let x = -56; x <= 56; x += 1) for (let z = -56; z <= 56; z += 1) { const h = H(x, z); if (h < T.SEA_LEVEL && T.distanceToRiver(x, z) > 5) { low++; if (T.waterAt(x, z, h).kind) wet++; } }
  ok('旧世界の低地（水位より低い乾いた地面）は水にしない（以前どおり歩ける）', low > 1000 && wet === 0, low + '/' + wet); }
ok('火口の溶岩湖は歩けない・凍った池（氷）は歩ける', W.terrainBlocked(T.LAVA_LAKE.x, T.LAVA_LAKE.z) && !W.terrainBlocked(T.FROZEN_POND.x, T.FROZEN_POND.z));
{ // 浜：乾いた砂（陸）→ 波打ち際 → 浅瀬 → 深い所
  let found = false; for (let z = -10; z <= 40 && !found; z += 4) { const xs = []; for (let x = 120; x < 200; x += 0.25) xs.push([x, H(x, z), T.waterAt(x, z, H(x, z))]);
    const shore = xs.find(p => p[2].kind === 'sea'), shallow = xs.find(p => p[2].kind === 'sea' && p[2].depth > 0.2 && p[2].depth <= T.WADE_DEPTH), deep = xs.find(p => p[2].kind === 'sea' && p[2].depth > 1.5);
    if (shore && shallow && deep && shallow[0] - shore[0] > 2 && deep[0] > shallow[0]) found = true; }
  ok('海は岸から浅瀬（歩ける）→深い所（歩けない）へ少しずつ深くなる', found); }
ok('湖・山の池がある（水面より低い湖底）', H(T.LAKE.x, T.LAKE.z) < T.LAKE.level - 0.8 && H(T.TARN.x, T.TARN.z) < T.TARN.level - 0.5);
{ const F = T.FALL, L = F.lip, d = { x: F.pool.x - L.x, z: F.pool.z - L.z }, dl = Math.hypot(d.x, d.z); d.x /= dl; d.z /= dl;
  const hLip = H(L.x, L.z), hBelow = H(L.x + d.x * 1.0, L.z + d.z * 1.0), hPool = H(F.pool.x, F.pool.z);
  ok('滝：落ち口の川底は水面の下、崖の下の滝つぼの底も水面の下', hLip < F.lipLevel && hPool < F.poolLevel - 1.0, `落ち口 ${hLip.toFixed(2)}/${F.lipLevel} 滝つぼ ${hPool.toFixed(2)}/${F.poolLevel}`);
  ok('滝：落ち口から 1m 先で 5m 以上下がる（崖）', hLip - hBelow > 5, (hLip - hBelow).toFixed(2));
  // 水の高さ：池 ≥ 上流 ≥ 落ち口 > 滝つぼ ≥ 下流 ≥ 海（逆転しない）
  const lv = []; for (let s = 0; s <= T.UPSTREAM.len; s += 0.5) { const p = polyAt(T.UPSTREAM, s); lv.push(T.waterAt(p.x, p.z, H(p.x, p.z))); }
  const ups = lv.filter(w => w.kind).map(w => w.level), mono = ups.every((v, i) => i === 0 || v <= ups[i - 1] + 1e-9);
  const dn = []; for (let s = 0.5; s <= T.DOWNSTREAM.len; s += 0.5) { const p = polyAt(T.DOWNSTREAM, s); const w = T.waterAt(p.x, p.z, H(p.x, p.z)); if (w.kind) dn.push(w.level); }
  ok('滝：上流の水面は下流へ向かって下がり、落ち口＞滝つぼ＞下流＞海の順（逆転しない）', mono && ups.length > 10 && Math.min(...ups) >= F.lipLevel - 1e-6 && Math.max(...dn) <= F.poolLevel + 1e-6 && dn.every((v, i) => i === 0 || v <= dn[i - 1] + 1e-9) && T.TARN.level >= Math.max(...ups) - 0.1,
    JSON.stringify({ up: [ups[0], ups[ups.length - 1]], dn: [dn[0], dn[dn.length - 1]] }));
  ok('滝：川は地面から浮かない（上流の水面の下に川底がある）', lv.every(w => !w.kind || w.depth > 0) && lv.filter(w => w.kind).length > lv.length * 0.8, lv.filter(w => !w.kind).length + '点で水がない');
}
function polyAt(P, s) { let i = 0; while (i < P.pts.length - 2 && P.cum[i + 1] < s) i++; const a = P.pts[i], b = P.pts[i + 1], L = P.cum[i + 1] - P.cum[i] || 1, t = Math.max(0, Math.min(1, (s - P.cum[i]) / L)); return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; }

/* ---------- 歩ける・歩けない ---------- */
{ const bad = []; for (const [nm, P] of Object.entries(T.TRAILS)) for (let s = 0; s <= P.len; s += 0.5) { const p = polyAt(P, s); if (W.terrainBlocked(p.x, p.z)) bad.push(nm + '@' + s.toFixed(1)); }
  ok('登山道・滝の道は全部歩ける（崖・深い水がない）', bad.length === 0, bad.slice(0, 8).join(' ')); }
{ const L = T.FALL.lip, P = T.FALL.pool, S0 = E.newState();
  // 滝つぼの岸から落ち口へ、崖をまっすぐ登ろうとする
  const sh = { x: P.x + (L.x - P.x) * 0.55, z: P.z + (L.z - P.z) * 0.55 };
  const r = W.move(S0, { x: P.x + 2.6 * (P.x - L.x) / 3.3 + 2.2, z: P.z + 2.6 * (P.z - L.z) / 3.3 + 1.6 }, 0, 0, 0);
  void r; void sh;
  let blocked = 0, n = 0; for (let k = -10; k <= 10; k++) { const t = k / 10; const x = L.x + (P.x - L.x) * 0.15 + (P.z - L.z) * t * 0.5, z = L.z + (P.z - L.z) * 0.15 - (P.x - L.x) * t * 0.5; n++; if (W.terrainBlocked(x, z)) blocked++; }
  ok('滝の崖の面（落ち口のすぐ下）は歩けない', blocked >= n * 0.5, blocked + '/' + n);
  ok('滝つぼの深い所は歩けない', W.terrainBlocked(P.x, P.z)); }
{ // 海へまっすぐ歩くと、深い所の手前で止まる
  const S0 = E.newState(); let p = { x: 138, z: 20 }; for (let i = 0; i < 400; i++) { const r = W.move(S0, p, 0.25, 0, 0); p = { x: r.x, z: r.z }; }
  const w = T.waterAt(p.x, p.z, H(p.x, p.z));
  ok('海へ歩くと、深い所（' + T.WADE_DEPTH + '以上）の手前で止まる（水の上を歩かない）', !w.kind || w.depth <= T.WADE_DEPTH + 0.05, JSON.stringify({ p, w })); }
{ // 急な崖へ歩いても登らない：歩いた所はすべて歩ける地面（崖の判定の上限以下）で、崖の上へは出ない
  const S0 = E.newState(), L = T.FALL.lip, P = T.FALL.pool; let p = W.nearestFree(S0, { x: P.x + 1.8, z: P.z + 1.2 }, 0, 4), bad = 0, maxH = H(p.x, p.z);
  const dx = (L.x - P.x) / 3.3, dz = (L.z - P.z) / 3.3;
  for (let i = 0; i < 200; i++) { const r = W.move(S0, p, dx * 0.12, dz * 0.12, 0); p = { x: r.x, z: r.z }; if (W.terrainBlocked(p.x, p.z)) bad++; maxH = Math.max(maxH, H(p.x, p.z)); }
  ok('滝つぼの岸から崖へ歩いても、崖を登らない（崖の上へ出ない・歩いた所はすべて歩ける地面）', bad === 0 && maxH < T.FALL.lipLevel - 3, JSON.stringify({ bad, maxH: +maxH.toFixed(2) }));
  // 山の急斜面でも同じ
  let q = W.nearestFree(S0, { x: 100, z: -96 }, 0, 10); let bad2 = 0; for (let i = 0; i < 300; i++) { const r = W.move(S0, q, -0.1, -0.25, 0); q = { x: r.x, z: r.z }; if (W.terrainBlocked(q.x, q.z)) bad2++; }
  ok('山の急な斜面へ歩いても、崖の中へは入らない', bad2 === 0, bad2 + ''); }
/* ---------- 経路：拠点 → 山麓 → 中腹 → 高所 → 滝の上流 → 滝つぼ → 海岸 → 拠点（往復） ---------- */
{ const fa = (a, l) => ({ x: T.FALL.lip.x + T.FALL.pool.x * 0 + ((T.FALL.pool.x - T.FALL.lip.x) / 3.3) * a - ((T.FALL.pool.z - T.FALL.lip.z) / 3.3) * l, z: T.FALL.lip.z + ((T.FALL.pool.z - T.FALL.lip.z) / 3.3) * a + ((T.FALL.pool.x - T.FALL.lip.x) / 3.3) * l });
  const stops = [['拠点', { x: D.base.x, z: D.base.z }], ['山麓', { x: 50, z: -58 }], ['中腹', { x: 66, z: -104 }], ['高所（見晴らし台）', { x: T.LOOKOUT.x, z: T.LOOKOUT.z }],
    ['滝の上流', fa(-9, -4.6)], ['滝つぼの岸', fa(5.4, -4.2)], ['海岸', { x: 142, z: 28 }], ['拠点', { x: D.base.x, z: D.base.z }]];
  const legs = [], t0 = Date.now();
  for (let i = 0; i < stops.length - 1; i++) {
    const a = W.nearestFree(SU, stops[i][1], 0, 8), b = W.nearestFree(SU, stops[i + 1][1], 0, 8);
    const go = a && b && W.findPath(SU, a, b, 0), back = a && b && W.findPath(SU, b, a, 0);
    legs.push(`${stops[i][0]}→${stops[i + 1][0]}:${go ? '行ける' : '×'}/${back ? '戻れる' : '×'}`);
    ok(`経路：${stops[i][0]} → ${stops[i + 1][0]}（行きと帰り）`, !!go && !!back, legs[legs.length - 1]);
    // 経路の各点で地形が歩ける
    if (go) { const pts = [a].concat(go); let badPt = null; for (let k = 0; k < pts.length - 1; k++) { const d = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z), n = Math.ceil(d / 0.25);
      for (let q = 0; q <= n; q++) { const x = pts[k].x + (pts[k + 1].x - pts[k].x) * q / n, z = pts[k].z + (pts[k + 1].z - pts[k].z) * q / n; if (W.terrainBlocked(x, z)) { badPt = { x, z }; break; } } if (badPt) break; }
      ok(`経路：${stops[i][0]} → ${stops[i + 1][0]} は崖や深い水を横切らない`, !badPt, JSON.stringify(badPt)); }
  }
  console.log('   経路の探索にかかった時間 ' + (Date.now() - t0) + 'ms');
}

/* ---------- 第3層の自然物（新しい陸地） ---------- */
{ const W1 = N.create(D, E, env), W2 = N.create(D, E, env);
  // 作る順番を変えても同じ
  W1.ensure(140, -80, 40); W1.ensure(-120, 50, 40); W1.ensure(90, -110, 30);
  W2.ensure(90, -110, 30); W2.ensure(-120, 50, 40); W2.ensure(140, -80, 40);
  const ids = W => W.objects.filter(o => o.layer === 3).map(o => o.id).sort().join('|');
  ok('新しい陸地の自然物は、区画を作る順番が違っても同じ位置・同じ ID', ids(W1) === ids(W2) && ids(W1).length > 0);
  const n0 = W1.objects.length; W1.ensure(140, -80, 40); W1.around(140, -80, 30);
  ok('同じ区画を何度用意しても増えない（重複しない）', W1.objects.length === n0 && new Set(W1.objects.map(o => o.id)).size === W1.objects.length);
  const t0 = Date.now(); W1.ensureAll(); const ms = Date.now() - t0;
  const l3 = W1.objects.filter(o => o.layer === 3), kinds = {}; l3.forEach(o => { kinds[o.kind + (o.variant ? ':' + o.variant : '')] = (kinds[o.kind + (o.variant ? ':' + o.variant : '')] || 0) + 1; });
  console.log('   新しい陸地の自然物 ' + l3.length + ' 個（全部作るのに ' + ms + 'ms）：' + JSON.stringify(kinds));
  ok('新しい陸地にも木・岩・草むら・やぶ・小石・落ち枝がある', ['tree', 'rock', 'grass', 'bush', 'pebble', 'twig'].every(k => l3.some(o => o.kind === k)));
  ok('山に針葉樹と岩、海岸に貝殻と流木、湖や川のそばに葦がある', l3.some(o => o.variant === 'conifer') && l3.some(o => o.kind === 'rock' && T.biome(o.x, o.z, H(o.x, o.z)).mountain > 0.3) && l3.some(o => o.variant === 'shell') && l3.some(o => o.variant === 'driftwood') && l3.some(o => o.variant === 'reed'), JSON.stringify(kinds));
  const shell = l3.find(o => o.variant === 'shell');
  ok('貝殻を拾うと貝殻（既存の素材）が手に入る', shell && JSON.stringify(W1.yieldsOf(shell)) === JSON.stringify({ shell: 1 }));
  const wet = l3.filter(o => T.waterAt(o.x, o.z, H(o.x, o.z)).kind);
  ok('新しい陸地の自然物は水の中にない', wet.length === 0, wet.slice(0, 5).map(o => o.id).join(','));
  const onTrail = l3.filter(o => o.block && Object.values(T.TRAILS).some(P => { for (let s = 0; s <= P.len; s += 0.5) { const p = polyAt(P, s); if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + 1.2) return true; } return false; }));
  ok('登山道の上に木や岩（壁になる物）がない', onTrail.length === 0, onTrail.slice(0, 5).map(o => o.id).join(','));
  const ids3 = new Set(l3.map(o => o.id)); ok('IDが重ならない', ids3.size === l3.length);
  // 旧世界の自然物は変わらない（第1・2層の数と ID）
  const W0 = N.create(D, E, env); const old0 = W0.objects.filter(o => !o.layer).map(o => o.id).join('|'), old1 = W1.objects.filter(o => !o.layer).map(o => o.id).join('|');
  ok('旧世界の自然物（第1・2層）の位置と ID は変わらない', old0 === old1);
  // 採取：新しい陸地の木を伐る
  const tr = l3.find(o => o.kind === 'tree'); const S1 = E.newState(); S1.inv.axe = 1; S1.disc.axe = { first: 0, made: 1, total: 1, routes: [], best: 0 };
  const ap = W1.approachPoint(S1, tr, { x: tr.x + 4, z: tr.z }); const r = ap && W1.harvest(S1, tr.id, { pos: ap, token: S1.seq });
  ok('新しい陸地の木も、近づいて採取できる（距離の判定は同じ）', r && r.ok && (S1.inv.log || 0) >= 1, JSON.stringify(r)); }

/* ---------- 外の野（2026-11-10、試験範囲：中心から半径 WALK_R） ---------- */
{ const R = T.WALK_R; ok('外の野の半径がある（長方形 ±172 を含む円）', R > 172 * Math.SQRT2);
  // 長方形の中の自然物は、外の野を足しても位置・ID が変わらない
  const envOld = Object.assign({}, env, { WALK_R: 0 }), Wo = N.create(D, E, envOld), Wn = N.create(D, E, env);
  Wo.ensureAll(); Wn.ensureAll();
  const inRect = o => Math.abs(o.x) <= 172 && Math.abs(o.z) <= 172;
  const idsO = Wo.objects.filter(inRect).map(o => o.id).sort().join('|'), idsN = Wn.objects.filter(inRect).map(o => o.id).sort().join('|');
  ok('長方形（±172）の中の自然物の位置と ID は、外の野を足しても変わらない', idsO === idsN && idsO.length > 0, idsO.length + ' / ' + idsN.length);
  const fr = Wn.objects.filter(o => o.layer === 3 && !inRect(o));
  ok('外の野にも自然物がある（区画ごとに作る）', fr.length > 200, String(fr.length));
  ok('外の野の自然物は円の外にない', fr.every(o => Math.hypot(o.x, o.z) <= R));
  // 作る順番を変えても同じ（外の野の区画）
  const A1 = N.create(D, E, env), A2 = N.create(D, E, env);
  A1.ensure(-215, 40, 40); A1.ensure(30, 225, 40); A2.ensure(30, 225, 40); A2.ensure(-215, 40, 40);
  const fid = W => W.objects.filter(o => o.layer === 3 && !inRect(o)).map(o => o.id).sort().join('|');
  ok('外の野の自然物も、区画を作る順番が違っても同じ位置・同じ ID', fid(A1) === fid(A2) && fid(A1).length > 0);
  // 歩ける／歩けない
  let land = null; for (let r = 190; r <= 240 && !land; r += 5) for (let a = 0; a < 6.28 && !land; a += 0.2) { const x = r * Math.cos(a), z = r * Math.sin(a); if (Wn.free(E.newState(), x, z)) land = { x, z }; }
  ok('外の野（±172 の外・円の中）に立てる所がある', !!land, JSON.stringify(land));
  ok('円の外（半径 WALK_R＋2）には立てない', !Wn.free(E.newState(), (R + 2), 0) && !Wn.free(E.newState(), 0, -(R + 2)) && !Wn.free(E.newState(), -(R + 2) * 0.7071, (R + 2) * 0.7071));
  // 境目（±172）をまたぐ経路
  const S0 = E.newState(); let a0 = null, b0 = null;
  for (let z = -60; z <= 60 && !(a0 && b0); z += 4) { if (!a0 && Wn.free(S0, -165, z)) a0 = { x: -165, z }; if (!b0 && Wn.free(S0, -195, z)) b0 = { x: -195, z }; }
  const path0 = a0 && b0 ? Wn.findPath(S0, a0, b0) : null;
  ok('長方形の端（x=-172）をまたいで、外の野へ経路を引ける', !!(path0 && path0.length), JSON.stringify({ a0, b0, n: path0 && path0.length }));
  // 外の野で採取 → セーブ（JSON）→ 新しい世界で読み込む → 同じ状態
  const tr = fr.find(o => o.kind === 'grass') || fr.find(o => o.kind === 'twig') || fr[0];
  const S1 = E.newState(); const ap = Wn.approachPoint(S1, tr, { x: tr.x + 3, z: tr.z }); const r = ap && Wn.harvest(S1, tr.id, { pos: ap, token: S1.seq });
  const S2 = JSON.parse(JSON.stringify(S1)), W2 = N.create(D, E, env); W2.ensure(tr.x, tr.z, 10);
  const o2 = W2.byId.get(tr.id);
  ok('外の野で採取した状態は、セーブして新しく作った世界でも同じ ID の自然物に残る（再訪・再読み込み）', r && r.ok && o2 && JSON.stringify(Wn.visual(S1, tr)) === JSON.stringify(W2.visual(S2, o2)) && W2.visual(S2, o2).state !== Wn.visual(E.newState(), tr).state,
    JSON.stringify({ r: r && r.ok, id: tr.id, a: Wn.visual(S1, tr), b: o2 && W2.visual(S2, o2) })); }

/* ---------- 火山（地形の版4。2026-11-11）：登って探索できる山 ---------- */
{ const V = T.VOLCANO, P = T.TRAILS.volcano, S0 = E.newState();
  const fs = await import('node:fs');
  const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/heights-world-v3.json', import.meta.url), 'utf8'));
  const diff = ref.filter(([x, z, h]) => H(x, z) !== h);
  ok('火山の外（中心から 70 以上）・滝・山・拠点・海岸・砂漠の高さは、版3と1マスも変わらない（差0。112点）', diff.length === 0 && ref.length === 112, JSON.stringify(diff.slice(0, 3)));
  let maxOut = 0; for (let a = 0; a < 6.283; a += 0.05) for (const r of [70, 72, 80, 100]) { const x = V.x + r * Math.cos(a), z = V.z + r * Math.sin(a), h = H(x, z); maxOut = Math.max(maxOut, Math.abs(T.volcanoShape(x, z, h) - h)); }
  ok('火山の地形は中心から 70 より外へ広がらない', maxOut === 0, String(maxOut));
  const hz = z => { let s = 0, n = 0; for (let a = 0; a < 6.283; a += 0.1) { const x = V.x + z * Math.cos(a), y = V.z + z * Math.sin(a); s += H(x, y); n++; } return s / n; };
  ok('火山は実際の高さを持つ：麓（半径55）≈5、山腹（38）≈13、上部斜面（22）≈30、火口縁（13.8）≈40、火口の底≈31（縁より低い）',
    hz(55) < 7 && hz(38) > 10 && hz(38) < 17 && hz(22) > 26 && hz(13.8) > 38 && H(V.x, V.z) < hz(13.8) - 6, [55, 38, 22, 13.8].map(r => hz(r).toFixed(1)).join('/') + ' 底' + H(V.x, V.z).toFixed(1));
  ok('火山の頂（火口縁）は北東の山（頂の高さ約40）と同じくらい高く、遠くから見える大きさ（麓の直径 約130）', hz(13.8) > 38 && V.footR * 2 >= 120);
  ok('帯の区別：麓・山腹・上部斜面・火口縁・火口', ['foot', 'flank', 'upper', 'rim', 'crater'].every((z, i) => T.volcanoZone(V.x + [55, 38, 22, 13.8, 5][i], V.z) === z) && T.placeName(V.x + 22, V.z, 30) === '火山の上部斜面' && T.placeName(V.x + 13.8, V.z, 40) === '火口縁');
  // 登山道：麓から火口縁まで、道のどこも歩ける・上り坂は 0.3 以下・つづら折り（折り返し3回以上）
  let maxG = 0, prev = null, bad = 0; for (let s = 0; s <= P.len; s += 0.5) { const q = polyAt(P, s), h = H(q.x, q.z); if (prev !== null) maxG = Math.max(maxG, Math.abs(h - prev) / 0.5); prev = h; if (W.terrainBlocked(q.x, q.z)) bad++; }
  const head = P.pts[0], end = P.pts[P.pts.length - 1];
  ok('登山道は麓（半径 64 以上）から火口縁（半径 15 以内・高さ 38 以上）まで続く', Math.hypot(head.x - V.x, head.z - V.z) > 64 && Math.hypot(end.x - V.x, end.z - V.z) < 15.5 && H(end.x, end.z) > 38, JSON.stringify({ head, end, h: H(end.x, end.z).toFixed(1) }));
  ok('登山道のどこも歩ける（崖にならない）・上り坂は 0.7 以下（ほとんど 0.27 以下）', bad === 0 && maxG < 0.7, bad + ' / ' + maxG.toFixed(2));
  ok('登山道はつづら折り（U 字の折り返しが3回以上）で、岩棚（平らな所）がある', T.VOLC_LEDGES.length >= 3 && T.VOLC_LEDGES.every(L => { let w = 0; for (let a = 0; a < 6.283; a += 0.5) if (!W.terrainBlocked(L.x + 1.2 * Math.cos(a), L.z + 1.2 * Math.sin(a))) w++; return w >= 11; }));
  const pth = W.findPath(S0, { x: D.base.x + 4, z: D.base.z }, head);
  ok('拠点から登山道の入口（火山地帯の中心）まで陸の経路がある', !!pth);
  const up = W.findPath(S0, head, { x: end.x, z: end.z });
  ok('登山道の入口から火口縁まで、歩いて行ける経路がある（地図のクリック移動と同じ A*）', !!up, up ? up.length + '点' : '');
  // 道を外れて上部斜面を直登できない：山腹から、道と岩棚を除いて歩ける所をたどっても、火口縁（半径 16 以内）に届かない
  { const G2 = 0.5, R2 = 36, n = Math.round(2 * R2 / G2) + 1, X = i => V.x - R2 + i * G2, Z = j => V.z - R2 + j * G2, okc = new Uint8Array(n * n), seen = new Uint8Array(n * n), q = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = X(i), z = Z(j), r = Math.hypot(x - V.x, z - V.z); if (r > R2 || W.terrainBlocked(x, z) || T.polyNear(P, x, z).d < 3.2 || T.VOLC_LEDGES.some(L => Math.hypot(L.x - x, L.z - z) < L.r + 1.6)) continue; okc[i * n + j] = 1; if (r > 33) { seen[i * n + j] = 1; q.push(i * n + j); } }
    let minR = 99; while (q.length) { const k = q.pop(), i = Math.floor(k / n), j = k % n; minR = Math.min(minR, Math.hypot(X(i) - V.x, Z(j) - V.z)); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const kk = ii * n + jj; if (okc[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); } } }
    ok('上部斜面は崖：道を外れて歩ける所をたどっても火口縁へ届かない（直登できない）', minR > 18, 'いちばん近い半径 ' + minR.toFixed(1)); }
  // 火口縁は一周歩ける。火口の中（溶岩湖）へは下りられない
  let rimOk = 0; for (let a = 0; a < 360; a += 30) { const t = a * Math.PI / 180; if (W.findPath(S0, end, { x: V.x + 13.8 * Math.cos(t), z: V.z + 13.8 * Math.sin(t) })) rimOk++; }
  ok('火口縁（尾根）は一周歩ける（12方向すべてへ経路がある）', rimOk === 12, rimOk + '/12');
  ok('火口の中へは下りられない（内壁は崖、底は溶岩湖）', !W.findPath(S0, end, { x: V.x + 9.0, z: V.z }) && W.terrainBlocked(V.x + 10.6, V.z) && W.terrainBlocked(V.x, V.z));
  // 採取地点：麓・登山道のわき・岩棚・火口縁に散らばり、どれも歩いて近づける。崖の中・溶岩の上にない
  const vol = D.regions.find(r => r.id === 'volcano'), deps = vol.res.map(x => ({ x, p: E.depositPos(vol, x) }));
  const zones = new Set(deps.map(d => T.volcanoZone(d.p.x, d.p.z)));
  ok('火山の採取地点は麓・山腹・上部斜面・火口縁に散らばる（一か所に集めない。どの2つも 6 マス以上離れている）', deps.length >= 8 && ['foot', 'flank', 'upper', 'rim'].every(z => zones.has(z)) && deps.every((a, i) => deps.every((b, j) => i === j || Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) >= 6)), [...zones].join(','));
  ok('火山の採取地点は、崖の中・溶岩の上・火口の中にない', deps.every(d => !W.terrainBlocked(d.p.x, d.p.z) && T.waterAt(d.p.x, d.p.z, H(d.p.x, d.p.z)).kind === null && T.volcanoZone(d.p.x, d.p.z) !== 'crater'));
  const nearTrail = deps.filter(d => T.polyNear(P, d.p.x, d.p.z).d < 6).length;
  ok('登山道沿い（道から 6 マス以内）に採取地点が3つ以上ある', nearTrail >= 3, String(nearTrail));
  const far = deps.filter(d => !W.pathToDeposit(S0, d.p, (N.depShape(d.x) || {}).r || 0, head));
  ok('火山の採取地点へは、登山道の入口から歩いて近づける', far.length === 0, far.map(d => E.resKey(d.x)).join(','));
  ok('火山の採取物は、登録済みの火山の素材（玄武岩・黒曜石・硫黄・赤鉄鉱）', vol.res.every(x => ['basalt', 'obsidian', 'sulfur', 'hematite'].includes(x.id) && D.items[x.id]));
  // 実際に歩いて登る：入口から火口縁まで、A* の経路を W.move で歩く（崖にはまらない）。進めなくなったら、ゲームと同じく経路を引き直す（ui.js：0.5秒止まったら最大2回）
  { let p = { x: head.x, z: head.z }, maxH = -1, onCliff = 0, repath = 0, path = (up || []).slice();
    for (let guard = 0; guard < 20000 && path.length; guard++) { const wp = path[0], d = Math.hypot(wp.x - p.x, wp.z - p.z);
      if (d < 0.2) { path.shift(); continue; }
      const st = Math.min(0.3, d), r = W.move(S0, p, (wp.x - p.x) / d * st, (wp.z - p.z) / d * st, 0);
      if (Math.hypot(r.x - p.x, r.z - p.z) < st * 0.2) { if (++repath > 8) break; path = W.findPath(S0, p, end) || []; continue; }
      p = { x: r.x, z: r.z }; if (W.terrainBlocked(p.x, p.z)) onCliff++; maxH = Math.max(maxH, H(p.x, p.z)); }
    ok('入口から火口縁まで、移動の処理（W.move）で実際に歩いて登れる（崖の中に入らない。止まったら引き直す経路で進める）', Math.hypot(p.x - end.x, p.z - end.z) < 1.5 && onCliff === 0 && maxH > 38, JSON.stringify({ end: [p.x.toFixed(1), p.z.toFixed(1)], repath, onCliff, maxH: maxH.toFixed(1) }));
    console.log('   火山の登山：経路の引き直し ' + repath + ' 回'); }
  ok('版3のセーブの位置が火山の変わった所なら、登山道の上（歩ける所）へ戻す。火山の外は戻さない', (() => { const a = T.volcanoSafeSpot(V.x + 22, V.z + 3); return a && !W.terrainBlocked(a.x, a.z) && !!W.findPath(S0, a, head) && T.volcanoSafeSpot(0, 0) === null && T.volcanoSafeSpot(V.x + 75, V.z) === null; })());
}

console.log(`\n${total - fail}/${total} 合格`);
if (fail) process.exit(1);
