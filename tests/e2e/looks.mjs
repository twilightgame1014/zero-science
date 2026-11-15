// 外観違い（工房の建物・大きな倉庫）のブラウザ結合テスト（偽の描画モジュール。3D の見た目は実WebGL で別に確認）。2026-11-15 Claude。
// 画面の操作で：建築の画面に外観のボタン → 場所を決める（正式の大きさの枠）→ 予定地 → 資材を運ぶ → 施工 → 完成（建物の種類は look-*）→
// 再読み込みで外観が残る・以前の倉庫は従来の形のまま・施工中の現場には外観の工程ノードを渡す・スマホ幅で押せる大きさ。
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
/* 施工中の現場（syncConstructionVisual へ渡す内容）を記録する */
const SPY = `window.HD2D.syncConstructionVisual=(g,d)=>{window.__SITES=JSON.parse(JSON.stringify(d.sites));};`;
const html = fs.readFileSync(path.join(root, 'dist/index.html'));
const server = createServer((req, res) => { const p = new URL(req.url, 'http://localhost').pathname; if (p !== '/' && p !== '/index.html') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); });
let fail = 0; const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name} ${cond ? '' : extra}`); if (!cond) fail++; };
const ev = (page, f, a) => page.evaluate(f, a);
let browser;
try {
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
async function newPage(viewport, touch, init) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort()); await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(FAKE); await page.addInitScript(SPY); if (init) await page.addInitScript(init);
  await page.goto(url + '?verify=0'); await page.waitForTimeout(300);
  const b = await page.$('#introGo'); if (b && await b.isVisible()) await page.click('#introGo');
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready'); await page.waitForTimeout(200);
  return { page, errors, ctx };
}
const findSpot = (page, def, look, from) => ev(page, ([def, look, from]) => { const g = window.__GAME__, W = g.WORLD, S = g.S;
  for (let r = 10; r <= 140; r += 4) for (let k = 0; k < 24; k++) { const x = Math.round(from.x + Math.cos(k / 24 * 6.283) * r), z = Math.round(from.z + Math.sin(k / 24 * 6.283) * r);
    if (CONS.checkBuilding(S, W, def, x, z, 0, { player: g.W3.pos, npcs: g.W3.npcList || [], reserved: [] }, undefined, look).ok) return { x, z }; } return null; }, [def, look, from]);
const give = (page, items) => ev(page, items => { const S = window.__GAME__.S; for (const k in items) { S.inv[k] = (S.inv[k] || 0) + items[k]; S.disc[k] = S.disc[k] || { first: Date.now(), made: 1, total: 1, routes: [], best: 0 }; } window.__GAME__.render(); }, items);
const goNear = (page, id) => ev(page, id => { const g = window.__GAME__, v = g.S.cons.inst[id], d = CONS.defOf(v), lp = d.entrance || [0, d.footprint.d / 2], L = Math.hypot(lp[0], lp[1]) || 1;
  const ex = lp[0] + lp[0] / L * 0.9, ez = lp[1] + lp[1] / L * 0.9, co = Math.cos(v.rot), si = Math.sin(v.rot); g.W3.pos = { x: v.x + co * ex + si * ez, z: v.z - si * ex + co * ez }; g.W3.path = null; }, id);

async function run(label, viewport, touch) {
  const { page, errors, ctx } = await newPage(viewport, touch);
  await give(page, { twig: 12, thread: 6, cobble: 6, knife: 1, log: 6, axe: 1, plaster: 4 });
  await page.click(touch ? '#nav [data-tab="build"], #nav [data-tab="menu"]' : '#nav [data-tab="build"]').catch(() => {}); await page.waitForTimeout(200);
  if (!await page.$('[data-act="cs-cat"]')) { await ev(page, () => window.__GAME__.setTab && window.__GAME__.setTab('build')); await page.waitForTimeout(200); }
  if (!await page.$('[data-act="cs-cat"]')) await ev(page, () => { const b = document.querySelector('[data-tab="build"]'); b && b.click(); }); await page.waitForTimeout(200);
  const btn = '[data-act="cs-place"][data-id="workbench"][data-look="workshop"]';
  ok(`${label}：建築の画面の作業台に「場所を決める（工房の建物）」と外観の説明（広さ・働きは同じ）`, await ev(page, s => { const b = document.querySelector(s); return !!b && /工房の建物/.test(b.textContent) && /4\.8×3\.6マス/.test(b.closest('.card').textContent) && /働きは同じ/.test(b.closest('.card').textContent); }, btn));
  if (touch) ok(`${label}：外観のボタンは押せる大きさ（高さ 44px 以上）`, await ev(page, s => document.querySelector(s).getBoundingClientRect().height >= 44, btn), String(await ev(page, s => document.querySelector(s).getBoundingClientRect().height, btn)));
  await page.click(btn); await page.waitForTimeout(250);
  ok(`${label}：場所を決めるモードは正式の大きさ（4.8×3.6）・種類 look-workshop の候補`, await ev(page, () => { const P = window.__GAME__.W3.place; return P && P.cons.look === 'workshop' && P.type === 'look-workshop' && P.spec.footprint.w === 4.8 && P.spec.footprint.d === 3.6; }));
  const at = await findSpot(page, 'workbench', 'workshop', { x: -20, z: 20 });
  await ev(page, p => { const g = window.__GAME__; g.W3.place.x = p.x; g.W3.place.z = p.z; g.W3.place.rot = 0; }, at); await page.waitForTimeout(250);
  await page.click('#buildbar .bbok'); await page.waitForTimeout(300);
  const id = await ev(page, () => Object.keys(window.__GAME__.S.cons.inst).find(k => window.__GAME__.S.cons.inst[k].look === 'workshop'));
  ok(`${label}：予定地にすると外観（workshop）が記録される`, !!id);
  ok(`${label}：現場の画面の名前に外観が出る`, await ev(page, () => /工房の建物/.test(document.getElementById('sheet').textContent)));
  await page.click('#sheet .close').catch(() => {});
  await goNear(page, id); await page.waitForTimeout(500);
  await page.click('#consHud').catch(() => {}); await page.waitForTimeout(200);
  if (!await page.$('[data-act="cs-dlall"]')) { await ev(page, id => window.__GAME__.consOpen ? window.__GAME__.consOpen(id) : document.querySelector('[data-act="cs-open"][data-id="' + id + '"]')?.click(), id); await page.waitForTimeout(200); }
  await page.click('[data-act="cs-dlall"]'); await page.waitForTimeout(700);
  await page.click('[data-act="cs-work"]'); await page.waitForTimeout(200);
  ok(`${label}：施工中は作業台の作業ができない（未完成）`, await ev(page, () => !window.__GAME__.E.hasTool(window.__GAME__.S, 'bench')));
  ok(`${label}：施工中の現場は look-workshop・外観の工程ノードを描画へ渡す（工程 0 はまだ建物を出さない＝キットだけ）`, await ev(page, id => { const s = (window.__SITES || []).find(x => x.id === id); return !!s && s.model === 'look-workshop' && s.stageNodes && s.stageNodes['0'].length > 20 && s.stage === 0 && s.w === 4.8; }, id), JSON.stringify(await ev(page, () => (window.__SITES || []).map(s => [s.id, s.model, s.stage, s.stageNodes && Object.keys(s.stageNodes)]))));
  await page.waitForTimeout(3600); await ev(page, () => window.__GAME__.render()); await page.waitForTimeout(400);
  ok(`${label}：完成すると工房の建物（look-workshop）が建ち、作業台の作業ができる`, await ev(page, id => window.__GAME__.S.cons.inst[id].phase === 'completed' && window.__FAKE.structures['cs:' + id]?.type === 'look-workshop' && window.__GAME__.E.hasTool(window.__GAME__.S, 'bench'), id),
    JSON.stringify(await ev(page, id => [window.__GAME__.S.cons.inst[id].phase, window.__FAKE.structures['cs:' + id]], id)));
  ok(`${label}：建物の当たりは正式の大きさ（WORLD に渡した形）`, await ev(page, id => { const s = window.__GAME__.WORLD.structures().find(o => o.id === 'struct:' + id); return !!s && s.w === 4.8 && s.d === 3.6 && s.type === 'look-workshop' && s.block; }, id));
  /* 大きな倉庫：予定地 → 工程 1 の施工中（基礎のノードを渡す） */
  const at2 = await findSpot(page, 'storehouse', 'warehouse', { x: at.x - 30, z: at.z });
  const id2 = await ev(page, p => { const g = window.__GAME__, r = CONS.plan(g.S, g.WORLD, 'storehouse', p.x, p.z, 0, { player: g.W3.pos, npcs: [], reserved: [] }, g.S.seq, 'warehouse'); g.render(); return r.id; }, at2);
  await goNear(page, id2); await page.waitForTimeout(400);
  await ev(page, id => { const g = window.__GAME__, v = g.S.cons.inst[id], p = g.W3.pos; CONS.deliverAll(g.S, g.WORLD, id, p, g.S.seq); CONS.startWork(g.S, g.WORLD, id, p, Date.now() - 10000, g.S.seq); CONS.finishWork(g.S, g.WORLD, id, p, Date.now(), g.S.seq); CONS.startWork(g.S, g.WORLD, id, p, Date.now(), g.S.seq); g.render(); }, id2); await page.waitForTimeout(400);
  ok(`${label}：大きな倉庫の工程 2 の施工中は、工程 1（基礎）のノードだけを描画へ渡す（未完成の建物を完成の姿で出さない）`, await ev(page, id => { const s = (window.__SITES || []).find(x => x.id === id); return !!s && s.model === 'look-warehouse' && s.stage === 1 && s.stageNodes['0'].includes('floor') && !s.stageNodes['0'].includes('roof') && s.stageNodes['2'].includes('roof') && !window.__FAKE.structures['cs:' + id]; }, id2),
    JSON.stringify(await ev(page, id => (window.__SITES || []).find(x => x.id === id), id2)));
  await ev(page, () => window.__GAME__.save && window.__GAME__.save()); await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(300); const b = await page.$('#introGo'); if (b && await b.isVisible()) await page.click('#introGo');
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready'); await page.waitForTimeout(500);
  ok(`${label}：再読み込みで外観・位置が残り、工房の建物（look-workshop）がまた建つ`, await ev(page, ([id, id2]) => { const S = window.__GAME__.S; return S.cons.inst[id].look === 'workshop' && S.cons.inst[id2].look === 'warehouse' && window.__FAKE.structures['cs:' + id]?.type === 'look-workshop' && window.__GAME__.E.hasTool(S, 'bench'); }, [id, id2]));
  ok(`${label}：ページのエラーなし`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await run('PC', { width: 1280, height: 800 }, false);
await run('スマホ幅', { width: 390, height: 844 }, true);

/* 以前のセーブ（v5：持ち物の倉庫）を移行すると、従来の倉庫（hut）が以前の場所に建つ。新しい外観にはならない */
{ const save = JSON.stringify({ v: 5, inv: { storehouse: 1 }, disc: { storehouse: { first: 1, made: 1, total: 1, routes: [], best: 0 } }, hist: [], gathered: {}, explore: {}, auto: [], seq: 0, flags: {}, nature: {}, build: {}, camera: {}, space: { version: 1 }, worldVer: 4, created: 1 });
  const { page, errors, ctx } = await newPage({ width: 1280, height: 800 }, false, `if(!sessionStorage.getItem('s')){localStorage.setItem('zero-kagaku-save', ${JSON.stringify(save)});localStorage.setItem('zero-kagaku-mode','normal');sessionStorage.setItem('s','1');}`);
  ok('旧セーブ：移行した倉庫は従来の形（hut・3.3×2.7）・以前の場所・外観なし', await ev(page, () => { const S = window.__GAME__.S, v = Object.values(S.cons.inst).find(x => x.def === 'storehouse'); const s = v && window.__GAME__.WORLD.structures().find(o => o.id === 'struct:' + v.id);
    return !!v && !v.look && v.x === -27 && v.z === 12 && window.__FAKE.structures['cs:' + v.id]?.type === 'hut' && !!s && s.w === 3.3 && s.d === 2.7; }),
    JSON.stringify(await ev(page, () => Object.values(window.__GAME__.S.cons.inst))));
  ok('旧セーブ：ページのエラーなし', errors.length === 0, errors.join(' | '));
  await ctx.close(); }
} finally { if (browser) await browser.close(); server.close(); }
console.log(fail ? `\n${fail} 件失敗` : '\nすべて合格'); process.exit(fail ? 1 : 0);
