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
{ const xs = []; for (let z = -150; z <= 140; z += 10) { let x = 120; while (x < 200 && T.seaDist(x, z) < 0) x += 0.5; xs.push(x); }
  ok('海岸線は曲がっている（入り江と岬で 10 マス以上ずれる）', Math.max(...xs) - Math.min(...xs) > 10, xs.join(',')); }
{ // 浜：乾いた砂（陸）→ 波打ち際 → 浅瀬 → 深い所
  let found = false; for (let z = -40; z <= 120 && !found; z += 4) { const xs = []; for (let x = 120; x < 200; x += 0.25) xs.push([x, H(x, z), T.waterAt(x, z, H(x, z))]);
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
  const S0 = E.newState(); let p = { x: 138, z: 40 }; for (let i = 0; i < 400; i++) { const r = W.move(S0, p, 0.25, 0, 0); p = { x: r.x, z: r.z }; }
  const w = T.waterAt(p.x, p.z, H(p.x, p.z));
  ok('海へ歩くと、深い所（' + T.WADE_DEPTH + '以上）の手前で止まる（水の上を歩かない）', !w.kind || w.depth <= T.WADE_DEPTH + 0.05, JSON.stringify({ p, w })); }
{ // 急な崖へ歩いても登らない：歩いた所はすべて歩ける地面（崖の判定の上限以下）で、崖の上へは出ない
  const S0 = E.newState(), L = T.FALL.lip, P = T.FALL.pool; let p = W.nearestFree(S0, { x: P.x + 1.8, z: P.z + 1.2 }, 0, 4), bad = 0, maxH = H(p.x, p.z);
  const dx = (L.x - P.x) / 3.3, dz = (L.z - P.z) / 3.3;
  for (let i = 0; i < 200; i++) { const r = W.move(S0, p, dx * 0.12, dz * 0.12, 0); p = { x: r.x, z: r.z }; if (W.terrainBlocked(p.x, p.z)) bad++; maxH = Math.max(maxH, H(p.x, p.z)); }
  ok('滝つぼの岸から崖へ歩いても、崖を登らない（崖の上へ出ない・歩いた所はすべて歩ける地面）', bad === 0 && maxH < T.FALL.lipLevel - 3, JSON.stringify({ bad, maxH: +maxH.toFixed(2) }));
  // 山の急斜面でも同じ
  let q = { x: 100, z: -96 }; let bad2 = 0; for (let i = 0; i < 300; i++) { const r = W.move(S0, q, -0.1, -0.25, 0); q = { x: r.x, z: r.z }; if (W.terrainBlocked(q.x, q.z)) bad2++; }
  ok('山の急な斜面へ歩いても、崖の中へは入らない', bad2 === 0, bad2 + ''); }
/* ---------- 経路：拠点 → 山麓 → 中腹 → 高所 → 滝の上流 → 滝つぼ → 海岸 → 拠点（往復） ---------- */
{ const fa = (a, l) => ({ x: T.FALL.lip.x + T.FALL.pool.x * 0 + ((T.FALL.pool.x - T.FALL.lip.x) / 3.3) * a - ((T.FALL.pool.z - T.FALL.lip.z) / 3.3) * l, z: T.FALL.lip.z + ((T.FALL.pool.z - T.FALL.lip.z) / 3.3) * a + ((T.FALL.pool.x - T.FALL.lip.x) / 3.3) * l });
  const stops = [['拠点', { x: D.base.x, z: D.base.z }], ['山麓', { x: 50, z: -58 }], ['中腹', { x: 80, z: -88 }], ['高所（見晴らし台）', { x: T.LOOKOUT.x, z: T.LOOKOUT.z }],
    ['滝の上流', fa(-10, 4.0)], ['滝つぼの岸', fa(5.4, 4.2)], ['海岸', { x: 147, z: -40 }], ['拠点', { x: D.base.x, z: D.base.z }]];
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

console.log(`\n${total - fail}/${total} 合格`);
if (fail) process.exit(1);
