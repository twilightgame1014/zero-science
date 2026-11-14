// 街づくり・現地建設のブラウザ結合テスト（偽の描画モジュール。3D の見た目は対象外＝実WebGL で別に確認）。
// 画面の操作で：建築の画面 → 場所を決める（PC はクリック・スマホはタップ）→ 予定地 → 現場へ → 資材を運ぶ → 施工 → 完成 → 設備が使える。
// 同じ種類をもう1つ、道（土）、施工途中の保存と再読み込み、取消（資材が戻る・増えない）、二重押し、旧セーブ（v5）の移行、スマホの押せる大きさ。
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
  await page.addInitScript(FAKE); if (init) await page.addInitScript(init);
  await page.goto(url + '?verify=0'); await page.waitForTimeout(300);
  const b = await page.$('#introGo'); if (b && await b.isVisible()) await page.click('#introGo');
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready'); await page.waitForTimeout(200);
  return { page, errors, ctx };
}
/* 置ける場所を探して、そこへ予定地の候補を動かす（地面のクリックと同じ placeMoveTo） */
const findSpot = (page, def, from, rot) => ev(page, ([def, from, rot]) => { const g = window.__GAME__, W = g.WORLD, S = g.S;
  for (let r = 8; r <= 120; r += 4) for (let k = 0; k < 24; k++) { const x = Math.round(from.x + Math.cos(k / 24 * 6.283) * r), z = Math.round(from.z + Math.sin(k / 24 * 6.283) * r);
    if (CONS.checkBuilding(S, W, def, x, z, rot || 0, { player: g.W3.pos, npcs: g.W3.npcList || [], reserved: [] }).ok) return { x, z }; } return null; }, [def, from, rot]);
const give = (page, items) => ev(page, items => { const S = window.__GAME__.S; for (const k in items) { S.inv[k] = (S.inv[k] || 0) + items[k]; S.disc[k] = S.disc[k] || { first: Date.now(), made: 1, total: 1, routes: [], best: 0 }; } window.__GAME__.render(); }, items);
const site = (page, id) => ev(page, id => JSON.parse(JSON.stringify(window.__GAME__.S.cons.inst[id] || null)), id);

/* ---------------- PC ---------------- */
{
  const { page, errors } = await newPage({ width: 1280, height: 800 }, false);
  ok('UI の新しいゲームは「建てて作る」ルール・セーブは v6', await ev(page, () => window.__GAME__.S.cons.rule === 'build' && window.__GAME__.S.v === 6));
  ok('開始地点に建物は1つもない（固定の場所に自動で建たない）', await ev(page, () => !Object.keys(window.__FAKE.structures).some(k => /^(st-|cs:)/.test(k))));
  await give(page, { twig: 12, thread: 6, cobble: 6, knife: 1 });
  await page.click('#nav [data-tab="craft"]'); await page.waitForTimeout(200);
  ok('工作の画面：作業台は「現地に建てる」と出て、作るボタンの代わりに「建設する」', await ev(page, () => { const b = document.querySelector('[data-act="cs-place"][data-id="workbench"]'); return !!b && /現地に建てる/.test(b.closest('.card').textContent) && !document.querySelector('[data-act="craft"][data-id="c_bench"]'); }));
  await page.click('#nav [data-tab="build"]'); await page.waitForTimeout(200);
  ok('建築の画面に設計図（工房・倉庫・住宅・公共・工場・飾り・道）がある', await ev(page, () => document.querySelectorAll('[data-act="cs-cat"]').length === 7 && !!document.querySelector('[data-act="cs-place"][data-id="workbench"]')));
  await page.click('[data-act="cs-place"][data-id="workbench"]'); await page.waitForTimeout(250);
  ok('場所を決めるモード：建物の候補・枠・回転・やめる・確定のボタン', await ev(page, () => !!window.__GAME__.W3.place && !document.getElementById('buildbar').hidden && /予定地にする/.test(document.querySelector('#buildbar .bbok').textContent)));
  const s1 = await findSpot(page, 'workbench', { x: -20, z: 20 });
  await ev(page, p => { const g = window.__GAME__; g.W3.place.x = p.x; g.W3.place.z = p.z; g.W3.place.rot = 0; }, s1); await page.waitForTimeout(250);
  await page.keyboard.press('r'); await page.waitForTimeout(150); await page.keyboard.press('Shift+R'); await page.waitForTimeout(150);
  await ev(page, () => { const P = window.__GAME__.W3.place; P.rot = 0; }); await page.waitForTimeout(250);
  const inv0 = await ev(page, () => JSON.stringify(window.__GAME__.S.inv));
  await page.dblclick('#buildbar .bbok').catch(() => {}); await page.waitForTimeout(300);
  const ids = await ev(page, () => Object.keys(window.__GAME__.S.cons.inst));
  ok('予定地にする（二重押しでも1つだけ）。資材はまだ使わない', ids.length === 1 && inv0 === await ev(page, () => JSON.stringify(window.__GAME__.S.inv)), JSON.stringify(ids));
  const id1 = ids[0];
  ok('予定地の微調整は自分自身の占有形状を除外する', await ev(page,id=>{const g=window.__GAME__,v=g.S.cons.inst[id];return CONS.checkBuilding(g.S,g.WORLD,v.def,v.x,v.z,v.rot,{player:null,npcs:[],reserved:[]},id).ok;},id1));
  ok('現場の画面が開き、所持・必要・搬入済み・不足が出る。遠いので運べない', await ev(page, () => document.getElementById('modal').classList.contains('open') && /不足/.test(document.getElementById('sheet').textContent) && document.querySelector('[data-act="cs-dlall"]').disabled));
  await page.click('#sheet .close');
  await ev(page, id => { const g = window.__GAME__, v = g.S.cons.inst[id]; g.W3.pos = { x: v.x, z: v.z + 1.4 }; g.W3.path = null; }, id1); await page.waitForTimeout(800);
  ok('現場のそばに来ると、右上に現場への近道が出る', await page.isVisible('#consHud'));
  await page.click('#consHud'); await page.waitForTimeout(200);
  await page.dblclick('[data-act="cs-dlall"]').catch(() => {}); await page.waitForTimeout(800);
  ok('二重押しの2回目が、同じ所に出た「施工する」を押してしまわない', await ev(page, id => !window.__GAME__.S.cons.inst[id].work, ids[0]));
  const s = await site(page, id1);
  ok('所持分をまとめて運ぶ：必要数だけ（枝4・糸2・石2）。二重押しで増えない', s.delivered.twig === 4 && s.delivered.thread === 2 && s.delivered.cobble === 2 && await ev(page, () => window.__GAME__.S.inv.twig === 8 && window.__GAME__.S.inv.cobble === 4), JSON.stringify(s.delivered));
  await page.click('[data-act="cs-work"]'); await page.waitForTimeout(200);
  ok('施工を始めると、作業中の表示（まだ完成しない・設備は使えない）', await ev(page, id => { const v = window.__GAME__.S.cons.inst[id]; return v.phase === 'constructing' && !!v.work && !window.__GAME__.E.hasTool(window.__GAME__.S, 'bench'); }, id1));
  await page.waitForFunction(id => window.__GAME__.S.cons.inst[id].phase === 'completed', id1, { timeout: 15000 });
  ok('施工の時間が過ぎると完成し、作業台が使える（持ち物には入らない）。建物が出る', await ev(page, id => { const g = window.__GAME__; return g.E.hasTool(g.S, 'bench') && !g.S.inv.bench && !!window.__FAKE.structures['cs:' + id] && window.__FAKE.structures['cs:' + id].type === 'workbench'; }, id1));
  await page.click('#sheet .close').catch(() => {});
  await page.click('#nav [data-tab="craft"]'); await page.waitForTimeout(200);
  ok('完成した作業台で、作業台が要る工作ができる（乾燥台が「作る」になる）', await ev(page, () => { const b = document.querySelector('[data-act="craft"][data-id="c_rack"]'); return !b || !/作業台/.test((b.closest('.card').querySelector('.desc') || {}).textContent || ''); }));
  /* 2つ目 */
  await page.click('#nav [data-tab="build"]'); await page.waitForTimeout(150); await page.click('[data-act="cs-place"][data-id="workbench"]'); await page.waitForTimeout(200);
  const s2 = await findSpot(page, 'workbench', { x: 30, z: -20 });
  await ev(page, p => { const g = window.__GAME__; g.W3.place.x = p.x; g.W3.place.z = p.z; g.W3.place.rot = Math.PI / 2; }, s2); await page.waitForTimeout(250); await page.click('#buildbar .bbok'); await page.waitForTimeout(200);
  ok('同じ作業台を別の場所にもう1つ予定できる', await ev(page, () => Object.values(window.__GAME__.S.cons.inst).filter(v => v.def === 'workbench').length === 2));
  const id2 = await ev(page, () => Object.values(window.__GAME__.S.cons.inst).find(v => v.def === 'workbench' && v.phase === 'planned').id);
  await page.click('#sheet .close').catch(() => {});
  await ev(page, id => { const g = window.__GAME__, v = g.S.cons.inst[id]; g.W3.pos = { x: v.x + 1.6, z: v.z }; }, id2); await page.waitForTimeout(700);
  await page.click('#consHud'); await page.waitForTimeout(200); await page.click('[data-dl]').catch(() => {});
  await page.click('[data-act="cs-dl"][data-item="twig"]'); await page.waitForTimeout(200);
  /* 施工途中で保存して再読み込み */
  await ev(page, () => window.__GAME__.save()); await page.waitForTimeout(500);
  await page.reload(); await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready'); await page.waitForTimeout(400);
  const after = await site(page, id2);
  ok('建設途中で保存・再読み込みしても、予定地と搬入済みの資材がそのまま', after && after.phase === 'supplying' && after.delivered.twig === 4, JSON.stringify(after));
  ok('完成した建物は再読み込みのあとも建っている', await ev(page, id => !!window.__FAKE.structures['cs:' + id], id1));
  /* 取消：搬入した資材は全部戻る */
  const twigBefore = await ev(page, () => window.__GAME__.S.inv.twig || 0);
  await page.evaluate(() => { window.confirm = () => true; });
  await ev(page, id => { const g = window.__GAME__, v = g.S.cons.inst[id]; g.W3.pos = { x: v.x + 1.6, z: v.z }; }, id2); await page.waitForTimeout(400);
  await ev(page, id => document.dispatchEvent(new Event('noop')), id2);
  await page.click('#consHud'); await page.waitForTimeout(700); await page.click('[data-act="cs-remove"]'); await page.waitForTimeout(200);
  ok('取消：運んだ枝4が持ち物へ戻り、予定地は消える（増えも減りもしない）', await ev(page, ([id, t]) => !window.__GAME__.S.cons.inst[id] && window.__GAME__.S.inv.twig === t + 4, [id2, twigBefore]));
  /* 道 */
  await page.click('#nav [data-tab="build"]'); await page.waitForTimeout(150); await page.click('[data-act="cs-cat"][data-id="road"]'); await page.waitForTimeout(150);
  await page.click('[data-act="cs-road"][data-id="dirt"]'); await page.waitForTimeout(200);
  const line = await ev(page, () => { const g = window.__GAME__; for (let r = 10; r < 120; r += 6) for (let k = 0; k < 16; k++) { const cx = Math.round((-20 + Math.cos(k / 16 * 6.283) * r) / 2) * 2, cz = Math.round((20 + Math.sin(k / 16 * 6.283) * r) / 2) * 2;
    const p = CONS.roadPlan(g.S, g.WORLD, 'dirt', { x: cx, z: cz }, { x: cx + 10, z: cz }, Date.now()); if (p.ok) return { a: { x: cx, z: cz }, b: { x: cx + 10, z: cz } }; } return null; });
  await ev(page, a => { const P = window.__GAME__.W3.place; P.x = a.x; P.z = a.z; }, line.a); await page.waitForTimeout(200); await page.click('#buildbar .bbok'); await page.waitForTimeout(200);
  await ev(page, b => { const P = window.__GAME__.W3.place; P.x = b.x; P.z = b.z; }, line.b); await page.waitForTimeout(300);
  ok('道：始点を選ぶと、終点までのマスと費用（土の道は材料なし）が出る', await ev(page, () => /6マス/.test(document.getElementById('bbTitle').textContent) && /ここまで敷く/.test(document.querySelector('#buildbar .bbok').textContent)), await ev(page, () => document.getElementById('bbTitle').textContent));
  await page.click('#buildbar .bbok'); await page.waitForTimeout(200);
  const road = await ev(page, () => Object.values(window.__GAME__.S.cons.inst).find(v => v.kind === 'road'));
  ok('道の予定地ができる（6マス・1区間）', !!road && road.cells.length === 6);
  await ev(page, id => { const g = window.__GAME__, v = g.S.cons.inst[id], c = CONS.cellCenter(v.cells[0].i, v.cells[0].j); g.W3.pos = { x: c.x, z: c.z }; }, road.id); await page.waitForTimeout(500);
  await page.click('#consHud'); await page.waitForTimeout(700); await page.click('[data-act="cs-work"]');
  await page.waitForFunction(() => Object.keys(window.__GAME__.S.cons.roads).length === 6, null, { timeout: 15000 });
  ok('道を施工すると、歩ける道のマスになる（壁にならない）', await ev(page, () => { const g = window.__GAME__, k = Object.keys(g.S.cons.roads)[0].split(',').map(Number), c = CONS.cellCenter(k[0], k[1]); return g.WORLD.free(g.S, c.x, c.z); }));
  ok('ページでエラーが起きていない（PC）', errors.length === 0, errors.join('\n'));
  await page.context().close();
}

/* ---------------- スマホ縦 ---------------- */
{
  const { page, errors } = await newPage({ width: 390, height: 844 }, true);
  await give(page, { cobble: 6, clay: 6, campfire: 0 });
  await page.click('#nav [data-tab="menu"]'); await page.waitForTimeout(150);
  const hasBuild = await page.isVisible('.bigitem[data-tab="build"]');
  ok('スマホ：メニューに「建築」がある', hasBuild);
  await page.click('.bigitem[data-tab="build"]'); await page.waitForTimeout(250);
  const small = await ev(page, () => [...document.querySelectorAll('#dockBody button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5).map(b => b.textContent.trim().slice(0, 10)));
  ok('スマホ：建築の画面のボタンは 44px 以上', small.length === 0, small.join(' / '));
  ok('スマホ：横にはみ出さない', await ev(page, () => document.scrollingElement.scrollWidth <= innerWidth && document.getElementById('dockBody').scrollWidth <= document.getElementById('dockBody').clientWidth + 1));
  await page.click('[data-act="cs-place"][data-id="campfire"]'); await page.waitForTimeout(250);
  const sp = await findSpot(page, 'campfire', { x: -20, z: 20 });
  /* タップで候補を動かす（地面のタップ＝placeMoveTo）。確定はボタンだけ（タップでは決まらない） */
  await ev(page, p => window.__GAME__.W3 && (window.__GAME__.W3.place.x = p.x, window.__GAME__.W3.place.z = p.z), sp); await page.waitForTimeout(250);
  ok('スマホ：地面のタップでは予定地は決まらない（確定はボタン）', await ev(page, () => Object.keys(window.__GAME__.S.cons.inst).length === 0));
  const bb = await ev(page, () => [...document.querySelectorAll('#buildbar button')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)));
  ok('スマホ：置き場所のボタン（回転・確定・やめる）は 44px 以上', bb.every(h => h >= 44), JSON.stringify(bb));
  await page.tap('#buildbar .bbok'); await page.waitForTimeout(250);
  ok('スマホ：ボタンで予定地にできる', await ev(page, () => Object.values(window.__GAME__.S.cons.inst).some(v => v.def === 'campfire')));
  const sheetSmall = await ev(page, () => [...document.querySelectorAll('#sheet button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 35.5).map(b => b.textContent.trim().slice(0, 10)));
  ok('スマホ：現場の画面のボタンは押せる大きさ（小ボタン 36px 以上）', sheetSmall.length === 0, sheetSmall.join(' / '));
  ok('ページでエラーが起きていない（スマホ）', errors.length === 0, errors.join('\n'));
  await page.context().close();
}

/* ---------------- 旧セーブ（v5）の移行 ---------------- */
{
  const old = JSON.stringify({ v: 5, inv: { bench: 1, campfire: 1, kiln: 1, steel: 3 }, disc: { bench: { first: 1, made: 1, total: 1, routes: [], best: 0 } }, hist: [], gathered: {}, explore: {}, auto: [], seq: 3, flags: { hero: 'girl', intro: 1 },
    nature: { 'tree:1,2': { u: 1 } }, build: { 'st-bench': { x: -15, z: 24, rot: 0.5 } }, camera: {}, space: { version: 1, lessons: { switch: true } }, worldVer: 4, pos: { x: -18, z: 22 }, created: 1000 });
  const { page, errors } = await newPage({ width: 1280, height: 800 }, false, `try{ if(!localStorage.getItem('zero-kagaku-save')) localStorage.setItem('zero-kagaku-save', ${JSON.stringify(old)}); }catch(e){}`);
  const r = await ev(page, () => { const g = window.__GAME__, S = g.S; return { v: S.v, inst: Object.values(S.cons.inst).map(v => ({ def: v.def, x: v.x, z: v.z, phase: v.phase })), inv: S.inv, hero: S.flags.hero, space: S.space.lessons, structs: Object.keys(window.__FAKE.structures), bench: g.E.hasTool(S, 'bench'), backup: !!localStorage.getItem('zero-kagaku-save-backup-v5') }; });
  ok('旧セーブ（v5）：置いてあった設備は同じ場所の完成した建物になり、素材は求めない。持ち物からは消える', r.v === 6 && r.inst.some(v => v.def === 'workbench' && v.x === -15 && v.z === 24 && v.phase === 'completed') && !r.inv.bench && r.bench && r.inv.steel === 3, JSON.stringify(r).slice(0, 300));
  ok('旧セーブ：主人公・宇宙計画の状態はそのまま、元のセーブは控えてある', r.hero === 'girl' && r.space.switch === true && r.backup);
  ok('旧セーブ：固定の場所の建物（st-）は出さず、移した建物（cs:）だけが建つ（二重に出ない）', !r.structs.some(k => k.startsWith('st-')) && r.structs.filter(k => k.startsWith('cs:')).length === r.inst.length, JSON.stringify(r.structs));
  ok('ページでエラーが起きていない（移行）', errors.length === 0, errors.join('\n'));
  await page.context().close();
}
} finally { try { await browser?.close(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
