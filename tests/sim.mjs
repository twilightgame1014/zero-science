// ボットに最初からプレイさせ、自然資源だけで全物質を発見し、現代の科学都市に到達できるか確かめる
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'), E = require('../src/game/engine.js');
const S = E.newState(); const stageAt = {};
let done = false;
for (let round = 0; round < 600; round++) {
  for (const r of D.regions) { if (!E.regionOpen(S, r)) continue; for (const x of r.res) for (let i = 0; i < 3; i++) E.gather(S, r.id, x.id, { rng: Math.random }); }
  for (const c of D.crafts) { const it = D.items[c.out]; if (it.unique && E.has(S, c.out)) continue; if (S.disc[c.out] && !it.unique && E.cnt(S, c.out) >= 3) continue; E.runCraft(S, c.id, S.seq); }
  for (const p of D.procs) {
    if (Object.keys(p.out).every(o => S.disc[o]) && Object.keys(p.out).every(o => D.items[o].store === false || E.cnt(S, o) >= 10)) continue;
    const fac = p.at.find(f => E.has(S, f)); if (!fac) continue; E.runExperiment(S, Object.assign({}, p.inp), fac, p.op, S.seq);
  }
  const st = E.stageOf(S); if (stageAt[st] === undefined) stageAt[st] = round;
  if (Object.keys(D.items).every(id => S.disc[id])) { console.log(`✅ ${round}ラウンドで全${Object.keys(D.items).length}種を発見`); done = true; break; }
}
const missing = Object.keys(D.items).filter(id => !S.disc[id]);
console.log('文明段階に到達したラウンド:', JSON.stringify(stageAt));
if (!done) { console.log('❌ 未発見:', missing.join(',')); process.exit(1); }
if (E.stageOf(S) < 5) { console.log('❌ 第5段階（現代の科学都市）に到達できなかった'); process.exit(1); }
