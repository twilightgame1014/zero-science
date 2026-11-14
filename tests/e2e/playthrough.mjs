// 新しい通常ゲームを、プレイヤーと同じ入口だけで遊ぶ通し確認（2026-11-14 Claude）：対象をタップして近づく・採取ボタン・パネルのボタン。
// 採集 → 石のナイフ → 作業台（予定地 → 現場へ → 搬入 → 施工）→ 火おこし棒 → たき火（2 工程）→ 研究室で燃焼 → 粘土 → かまど（2 工程）まで。
// 偽の描画モジュール（3D の見た目は対象外）。操作の回数・歩いた直線距離・施工の待ちを記録する（ボットや検証モードの到達とは別の確認）。PT_PHONE=1 でスマホ幅。
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const utils = await build({ entryPoints: [path.join(root, 'src/graphics/utils.ts')], bundle: true, format: 'cjs', write: false, logLevel: 'warning' });
const FAKE = fs.readFileSync(path.join(root, 'tests/e2e/fake-hd2d.js'), 'utf8').replace('/*UTILS*/', utils.outputFiles[0].text);
// file:を禁止する管理ブラウザでも、通常のHTTPと同じ保存・再読込を検証する。
const html = fs.readFileSync(path.join(root, 'dist/index.html'));
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/' && pathname !== '/index.html') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name} ${cond ? '' : extra}`); if (!cond) fail++; };
const G = 'window.__GAME__';
const pos = page => page.evaluate(`({x:${G}.W3.pos.x, z:${G}.W3.pos.z})`);
const same = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 0.01;
let browser;
try {
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });

const OUT = process.env.PT_OUT || path.join(root, 'test-results/playthrough'); fs.mkdirSync(OUT, { recursive: true });
const vp = process.env.PT_PHONE ? { width: 390, height: 844 } : { width: 1366, height: 768 }, touch = !!process.env.PT_PHONE;
const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch }); const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.route('https://cdn.jsdelivr.net/**', r => r.abort()); await page.route('https://fonts.googleapis.com/**', r => r.abort());
await page.addInitScript(FAKE); await page.goto(url); await page.waitForTimeout(400);
await page.click('#introGo'); await page.waitForTimeout(500);
const T0 = Date.now(); let ops = { tap: 0, action: 0, ui: 0 }, walk = 0, shotN = 0; const notes = [];
const note = (s) => { notes.push(s); console.log('📝', s); };
const ev = (f, a) => page.evaluate(f, a);
const shot = async (nm) => page.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${nm}.png` });
const state = () => ev(() => { const G = __GAME__; return { m: G.E.missionIndex(G.S), mt: G.D.missions[G.E.missionIndex(G.S)]?.t, inv: { ...G.S.inv }, pos: { ...G.W3.pos }, banner: (document.querySelector('#banner')||{}).textContent || '' }; });
/* プレイヤーと同じ入口：対象を選んで（タップ）近づき、採取ボタンを押す */
async function gather(kind, variant, item, want) {
  const tried = new Set();
  for (let guard = 0; guard < 60; guard++) {
    const have = await ev(i => __GAME__.S.inv[i] || 0, item); if (have >= want) return have;
    const t = await ev(([k, v, tried]) => { const G = __GAME__, W = G.WORLD, p = G.W3.pos;
      const c = W.objects.filter(o => o.kind === k && (v ? o.variant === v : !o.variant) && !tried.includes(o.id) && W.present(G.S, o))
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (!c) return null; const from = { ...p }; G.selectAndGo({ o: c }); return { id: c.id, d: Math.hypot(c.x - from.x, c.z - from.z) }; }, [kind, variant, [...tried]]);
    if (!t) { note(`採れる ${kind}${variant ? ':' + variant : ''} が見つからない`); return -1; }
    ops.tap++; walk += t.d;
    await page.waitForFunction(() => !__GAME__.W3.path, null, { timeout: 120000 }); await page.waitForTimeout(150);
    await page.waitForFunction(() => !__GAME__.W3.work, null, { timeout: 20000 });
    /* 同じ物を続けて採る（残っていれば採取ボタン） */
    for (let k = 0; k < 4; k++) { const now = await ev(i => __GAME__.S.inv[i] || 0, item); if (now >= want) break;
      const sameSel = await ev(id => { const G = __GAME__; return !!(G.W3.near && G.W3.near.o && G.W3.near.o.id === id); }, t.id); if (!sameSel) break;
      await ev(() => __GAME__.pressAction()); ops.action++; await page.waitForTimeout(150); await page.waitForFunction(() => !__GAME__.W3.work, null, { timeout: 20000 }); }
    if (await ev(i => __GAME__.S.inv[i] || 0, item) === have && tried.size < 6) console.log('   ✗', t.id, Math.round(t.d), JSON.stringify(await ev(id => { const G = __GAME__, o = G.WORLD.byId.get(id); return { gap: G.WORLD.reachGap(o, G.W3.pos), act: document.getElementById('w3act').textContent, banner: (document.querySelector('#banner')||{}).textContent, st: G.S.nature[id] }; }, t.id)));
    tried.add(t.id);
  }
}
const click = async (sel) => { if (/#nav|#consHud/.test(sel) && await page.locator('#sheet .close:visible').count()) { await page.locator('#sheet .close').first().click(); ops.ui++; await page.waitForTimeout(200); } if (touch && /#nav \[data-tab="(build|book|map|log)"\]/.test(sel)) { const t = sel.match(/data-tab="(\w+)"/)[1]; await page.locator('#nav [data-tab="menu"]').first().click(); ops.ui++; await page.waitForTimeout(200); sel = `.bigitem[data-tab="${t}"]`; } await page.locator(sel).first().click(); ops.ui++; await page.waitForTimeout(250); };
const panel = () => ev(() => (document.querySelector('#dockBody') || {}).innerText || '');
const report = async (label) => { const s = await state(); console.log(`— ${label}: 目標${s.m + 1}「${s.mt}」 ops=${JSON.stringify(ops)} 歩いた直線距離≈${Math.round(walk)} 経過${Math.round((Date.now() - T0) / 1000)}s inv=${JSON.stringify(s.inv)}`); return s; };

/* 1. 枝・小石・火打ち石 */
await report('開始'); await shot('start');
await gather('twig', null, 'twig', 10); await report('枝');
await gather('pebble', null, 'cobble', 8); await report('小石');
await gather('pebble', 'flint', 'flint', 1); await report('火打ち石');
/* 2. 工作：石のナイフ（ナビの「工作」→ カード） */
await click(touch ? '#nav [data-tab="craft"]' : '#nav [data-tab="craft"]');
await shot('craft');
const knife = await page.locator('[data-act="craft"][data-id="c_knife"]').count(); if (!knife) note('工作に石のナイフの「作る」がない');
else { await click('[data-act="craft"][data-id="c_knife"]'); }
await click('#dock .dockx'); await report('ナイフ');
/* 3. つる→糸、草 */
await gather('bush', null, 'vine', 4); await gather('grass', null, 'grass', 2); await report('つる・草');
await click('#nav [data-tab="craft"]');
for (let i = 0; i < 2; i++) { if (await page.locator('[data-act="craft"][data-id="c_thread"]:not([disabled])').count()) await click('[data-act="craft"][data-id="c_thread"]'); }
const bench = await panel(); console.log('工作の画面（作業台のカード周辺）:', bench.split('\n').filter(l => /作業台|建築|予定地/.test(l)).slice(0, 6).join(' | '));
await shot('craft-bench-link');
/* 4. 作業台：工作のカードの案内から建築へ */
const link = await page.locator('#dockBody [data-act^="cs-"]').evaluateAll(b => b.map(x => x.dataset.act + ':' + (x.dataset.id || '') + ':' + x.textContent.trim()));
console.log('工作から建築への入口:', JSON.stringify(link));
await click('#dock .dockx');
await click('#nav [data-tab="build"]'); await shot('build');
await click('[data-act="cs-place"][data-id="workbench"]'); await shot('placing');
const bb = await ev(() => ({ msg: document.getElementById('bbMsg').textContent, dis: document.querySelector('#buildbar .bbok').disabled }));
console.log('置き場所:', JSON.stringify(bb));
if (bb.dis) note('最初の候補位置で置けない：' + bb.msg);
await click('#buildbar .bbok'); await page.waitForTimeout(300); await shot('site-panel');
console.log('現場の画面:', (await panel()).slice(0, 600).replace(/\n/g, ' | '));
const acts = async () => page.locator('#sheet [data-act^="cs-"]').evaluateAll(b => b.map(x => x.dataset.act + (x.disabled ? '(off)' : '')));
console.log('現場の操作:', JSON.stringify(await acts()));
/* 搬入 → 施工 */
if (await page.locator('#sheet [data-act="cs-go"]').count()) { await click('#sheet [data-act="cs-go"]'); await page.waitForFunction(() => !__GAME__.W3.path, null, { timeout: 60000 }); await page.waitForTimeout(500); }
const open = async () => { if (!(await page.locator('#sheet [data-act="cs-dlall"]:visible').count())) { const vis = await page.locator('#consHud:visible').count(); if (vis) await click('#consHud'); else note('現場のそばで #consHud が出ない'); } };
await open(); console.log('搬入前の操作:', JSON.stringify(await acts()));
if (await page.locator('[data-act="cs-dlall"]:not([disabled])').count()) await click('[data-act="cs-dlall"]'); else note('「持っている分を全部運ぶ」が押せない');
await page.waitForTimeout(700);
if (await page.locator('[data-act="cs-work"]:not([disabled])').count()) await click('[data-act="cs-work"]'); else note('「施工する」が押せない：' + (await panel()).slice(0, 300));
const w0 = Date.now(); await page.waitForFunction(() => Object.values(__GAME__.S.cons.inst).some(v => v.def === 'workbench' && v.phase === 'completed'), null, { timeout: 60000 }).catch(() => note('作業台が完成しない'));
console.log('施工の待ち', Math.round((Date.now() - w0) / 100) / 10, '秒'); await shot('bench-done'); await report('作業台');
console.log('作業台が使えるか', await ev(() => __GAME__.E.hasTool(__GAME__.S, 'bench')));

/* 汎用：建築の画面から建てる（予定地 → 現場へ → 搬入 → 施工を工程の数だけ） */
async function buildIt(def) {
  if (await page.locator('#sheet:visible .close').count()) await click('#sheet .close');
  await click('#nav [data-tab="build"]');
  const cat = await ev(d => __GAME__.D.construction.defs.find(x => x.id === d).cat, def); await click(`[data-act="cs-cat"][data-id="${cat}"]`);
  if (!(await page.locator(`[data-act="cs-place"][data-id="${def}"]`).count())) { note(def + '：建築の一覧に「場所を決める」がない'); return false; }
  await click(`[data-act="cs-place"][data-id="${def}"]`);
  let bb = await ev(() => ({ msg: document.getElementById('bbMsg').textContent, dis: document.querySelector('#buildbar .bbok').disabled }));
  for (let k = 0; bb.dis && k < 8; k++) { await ev(k => { const P = __GAME__.W3.place; P.x += 3 * Math.cos(k); P.z += 3 * Math.sin(k); }, k); await page.keyboard.press('r'); await page.waitForTimeout(150); ops.ui++;
    bb = await ev(() => ({ msg: document.getElementById('bbMsg').textContent, dis: document.querySelector('#buildbar .bbok').disabled })); }
  if (bb.dis) { note(def + '：置ける場所が見つからない ' + bb.msg); return false; }
  await click('#buildbar .bbok');
  const id = await ev(() => Object.keys(__GAME__.S.cons.inst).pop());
  for (let st = 0; st < 6; st++) {
    const ph = await ev(id => __GAME__.S.cons.inst[id].phase, id); if (ph === 'completed') break;
    if (!(await page.locator('#sheet:visible').count())) { await open(); }
    if (await page.locator('#sheet [data-act="cs-go"]').count()) { await click('#sheet [data-act="cs-go"]'); await page.waitForFunction(() => !__GAME__.W3.path, null, { timeout: 90000 }); await page.waitForTimeout(500); await open(); }
    if (await page.locator('#sheet [data-act="cs-dlall"]:not([disabled])').count()) { await click('#sheet [data-act="cs-dlall"]'); await page.waitForTimeout(700); }
    if (!(await page.locator('#sheet [data-act="cs-work"]:not([disabled])').count())) { note(def + '：施工できない：' + (await ev(() => (document.querySelector('#sheet') || {}).innerText.split('\n').filter(l => /理由|不足|道具/.test(l)).join(' / ')))); return false; }
    await click('#sheet [data-act="cs-work"]'); const w0 = Date.now(); const stage0 = await ev(id => __GAME__.S.cons.inst[id].stage, id);
    await page.waitForFunction(([id, s0]) => { const v = __GAME__.S.cons.inst[id]; return v.phase === 'completed' || v.stage > s0; }, [id, stage0], { timeout: 60000 }).catch(() => note(def + '：工程が進まない'));
    console.log(`  ${def} 工程${stage0 + 1} 施工の待ち ${Math.round((Date.now() - w0) / 100) / 10}秒`);
  }
  const done = await ev(id => __GAME__.S.cons.inst[id].phase, id); console.log(`  ${def}: ${done}`); if (await page.locator('#sheet .close:visible').count()) await click('#sheet .close'); return done === 'completed';
}
await shot('after-bench');
await click('#nav [data-tab="craft"]'); if (await page.locator('[data-act="craft"][data-id="c_firedrill"]:not([disabled])').count()) await click('[data-act="craft"][data-id="c_firedrill"]'); else note('火おこし棒を作れない');
await click('#dock .dockx'); await report('火おこし棒');
await buildIt('campfire'); await report('たき火');
/* 研究室：枝2本・たき火・燃焼（施工で枝を使い切っていたら拾い足す） */
await gather('twig', null, 'twig', 4);
if (await page.locator('#sheet:visible .close').count()) await click('#sheet .close');
await click('#nav [data-tab="lab"]'); await shot('lab');
for (let i = 0; i < 2; i++) await click('[data-act="add"][data-id="twig"]');
if (await page.locator('[data-act="fac"][data-id="campfire"]').count()) await click('[data-act="fac"][data-id="campfire"]'); else note('研究室にたき火の装置が出ない');
const opsList = await page.locator('[data-act="op"]').evaluateAll(b => b.map(x => x.dataset.id)); console.log('操作', opsList.join());
await click(`[data-act="op"][data-id="${opsList.includes('burn') ? 'burn' : opsList[0]}"]`); await click('[data-act="run"]'); await page.waitForTimeout(3500); await shot('lab-run'); if (await page.locator('#sheet .close:visible').count()) await click('#sheet .close'); if (await page.locator('#dock .dockx:visible').count()) await click('#dock .dockx');
await report('燃焼');

/* 地域の採取地点（地図の名札をタップするのと同じ：選んで近づき、採取ボタン） */
async function gatherNode(res, item, want) {
  for (let g = 0; g < 30; g++) {
    if (await ev(i => (__GAME__.S.inv[i] || 0), item) >= want) return true;
    const t = await ev(r => { const G = __GAME__, p = G.W3.pos; const n = G.NODES.filter(n => n.res.id === r && G.E.depositInfo(G.S, n.r.id, n.rk).left > 0).sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z))[0];
      if (!n) return null; const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z); G.selectAndGo({ n }); return { key: n.key, d }; }, res);
    if (!t) { note(res + ' の採取地点が見つからない（残量なし？）'); return false; }
    ops.tap++; walk += t.d; const b = await ev(i => __GAME__.S.inv[i] || 0, item); await page.waitForTimeout(400);
    await page.waitForFunction(() => !__GAME__.W3.path, null, { timeout: 180000 }); await page.waitForTimeout(150); await page.waitForFunction(() => !__GAME__.W3.work, null, { timeout: 30000 });
    if (await ev(i => __GAME__.S.inv[i] || 0, item) === b) { await ev(() => __GAME__.pressAction()); ops.action++; await page.waitForTimeout(200); await page.waitForFunction(() => !__GAME__.W3.work, null, { timeout: 30000 }); }
    if (await ev(i => __GAME__.S.inv[i] || 0, item) === b) { note(res + ' を採れなかった：' + await ev(() => document.getElementById('w3act').textContent)); return false; }
  }
}
await gatherNode('clay', 'clay', 4); await report('粘土');
await gather('pebble', null, 'cobble', 5);
await buildIt('kiln'); await report('かまど'); await shot('kiln');
fs.writeFileSync(OUT + '/notes.json', JSON.stringify({ notes, ops, walk, errors }, null, 1));
const fin = await ev(() => { const G = __GAME__, S = G.S; const done = d => Object.values(S.cons.inst).some(v => v.def === d && v.phase === 'completed'); return { bench: done('workbench') && G.E.hasTool(S, 'bench'), fire: done('campfire') && G.E.hasTool(S, 'campfire'), kiln: done('kiln') && G.E.hasTool(S, 'kiln'), ash: (S.inv.ash || 0) > 0, m: G.E.missionIndex(S) }; });
const pass = fin.bench && fin.fire && fin.kiln && fin.ash && fin.m >= 6 && !notes.length && !errors.length;
console.log(`${pass ? '✅' : '❌'} 通常ゲームを画面の操作だけで、作業台・たき火・かまどの完成と最初の実験まで進める`, JSON.stringify({ fin, notes, errors, ops, walk: Math.round(walk) }));
if (!pass) process.exitCode = 1;
} finally { await browser?.close(); server.close(); }
