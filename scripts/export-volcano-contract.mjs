// 火山（地形の版4）の共有データを書き出す：Muse が見た目を合わせるための正本の写し（2026-11-11）
// 中身：火口の位置と半径・帯の半径・登山道の点列・岩棚・採取地点・高さの格子（2マスごと）・歩けない所の格子。
// 使い方：node scripts/export-volcano-contract.mjs  → docs/handoff/volcano-contract.json
// 地形を変えたら必ず書き出し直す（高さの正本は src/world/shape.ts の worldHeight。この JSON は確認用の写し）。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadTerrain } from '../tests/helpers/terrain.mjs';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'), E = require('../src/game/engine.js'), N = require('../src/game/nature.js');
const T = await loadTerrain(), cfg = T.DEFAULT_CONFIG, H = (x, z) => T.terrainHeight(x, z, cfg);
const W = N.create(D, E, Object.assign({}, T, { cfg }));
const V = T.VOLCANO, P = T.TRAILS.volcano, r2 = v => +v.toFixed(2);
const vol = D.regions.find(r => r.id === 'volcano');
const step = 2, R = V.R0, grid = [], blocked = [];
for (let z = V.z - R; z <= V.z + R; z += step) { const row = [], brow = []; for (let x = V.x - R; x <= V.x + R; x += step) { row.push(r2(H(x, z))); brow.push(W.terrainBlocked(x, z) ? 1 : 0); } grid.push(row); blocked.push(brow.join('')); }
const out = {
  version: T.WORLD_VERSION, generated: 'scripts/export-volcano-contract.mjs', heightSource: 'src/world/shape.ts worldHeight（描画モジュールには config.world.heightAt とビルドの差し替えで同じ関数が入る）',
  crater: { x: V.x, z: V.z, lavaLake: { r: T.LAVA_LAKE.r, y: r2(H(V.x, V.z)) }, floorR: V.floorR, floorH: V.floorH, rimR: V.rimR, rimInR: V.rimInR, rimOutR: V.rimOutR },
  zones: { crater: '< ' + (V.rimInR - 0.6), rim: (V.rimInR - 0.6) + '〜' + (V.rimOutR + 0.8), upper: (V.rimOutR + 0.8) + '〜' + V.upperR + '（崖。登山道でしか登れない）', flank: V.upperR + '〜' + V.flankR, foot: V.flankR + '〜' + (V.footR + 4), unchangedBeyond: V.R0 },
  radialProfile: Array.from({ length: 37 }, (_, i) => [i * 2, r2(T.volcanoProfile(i * 2))]),
  trail: { name: '火山の登山道（つづら折り）', width: '平らな幅 ±1.4、斜面へ 2.9 まで', maxGrade: 0.27, points: P.pts.map(p => [r2(p.x), r2(p.z), r2(H(p.x, p.z))]) },
  ledges: T.VOLC_LEDGES.map(L => ({ x: L.x, z: L.z, r: L.r, y: r2(H(L.x, L.z)) })),
  deposits: vol.res.map(x => { const p = E.depositPos(vol, x); return { key: E.resKey(x), item: x.id, x: r2(p.x), z: r2(p.z), y: r2(H(p.x, p.z)), zone: x.zone, solid: (N.depShape(x) || {}).r > 0, visual: (N.depShape(x) || {}).vis }; }),
  heightGrid: { x0: V.x - R, z0: V.z - R, step, rows: grid.length, cols: grid[0].length, note: 'rows は z、cols は x。値は地面の高さ', data: grid },
  blockedGrid: { x0: V.x - R, z0: V.z - R, step, note: '1＝歩けない（崖・溶岩）。ゲームの判定は 0.5マスの格子（nature.js terrainBlocked）なので、これは目安', rows: blocked },
};
fs.writeFileSync(new URL('../docs/handoff/volcano-contract.json', import.meta.url), JSON.stringify(out));
console.log('docs/handoff/volcano-contract.json', (JSON.stringify(out).length / 1024).toFixed(0) + 'KB', 'trail', out.trail.points.length, 'deposits', out.deposits.length);
