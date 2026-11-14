// 宇宙計画のブラウザ結合テスト（偽の描画モジュール）。プロジェクト画面・実習・設置・組立・試験・搭乗・
// 打ち上げ（二重クリック・スキップ・中断と再読み込み）・エンディング・セーブの移行・スマホの配置を確かめる。
// 3D の見た目（仮モデル・演出の絵）は対象外（実WebGL での確認は別）。
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
  return { page, errors, ctx };
}
const start = async page => { const b = await page.$('#introGo'); if (b && await b.isVisible()) { await page.click('#introGo'); } await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready'); await page.waitForTimeout(300); };
const ev = (page, f, a) => page.evaluate(f, a);
const warp = (page, x, z) => ev(page, ([x, z]) => { const g = window.__GAME__; g.W3.pos = { x, z }; g.W3.path = null; }, [x, z]);
const give = (page, items) => ev(page, items => { const g = window.__GAME__, S = g.S; for (const k in items) { S.inv[k] = items[k]; S.disc[k] = S.disc[k] || { first: Date.now(), made: 1, total: 1, routes: [], best: 0 }; } g.render(); }, items);

/* ---------------- PC：最初から最後まで ---------------- */
{
  const { page, errors } = await newPage({ width: 1280, height: 720 }, false); await start(page);
  ok('PC：下のメニューに「宇宙へ」があり、押すとプロジェクト画面が開く', await page.isVisible('#nav [data-tab="space"]') && (await page.click('#nav [data-tab="space"]'), await page.waitForTimeout(200), await ev(page, () => window.__GAME__.U.tab === 'space' && /最終目標/.test(document.getElementById('dockBody').textContent))));
  const home = await ev(page, () => ({ cards: document.querySelectorAll('.spcard').length, later: document.querySelectorAll('.splater li').length, cond: document.querySelector('.spgoal').textContent, next: document.querySelector('.spnext').textContent }));
  ok('新しいゲーム：最終目標と進み（0%・条件 0/10）が見え、先の分野は「この先」にたたまれている（全部は押し付けない）', /0%/.test(home.cond) && /0\/10/.test(home.cond) && home.later >= 6 && home.cards <= 4 && home.next.length > 10, JSON.stringify(home));
  ok('開始地点に発射場の建物・機体は置かれていない', await ev(page, () => !Object.keys(window.__FAKE.structures).some(k => k.startsWith('sp-'))));

  /* 実習① */
  await give(page, { switch: 1, bulb: 1, insulwire: 2, battery: 1, bench: 1, solderiron: 1, board: 1, transistor: 4, resistor: 2, tin: 1 });
  await ev(page, () => window.__GAME__.space.go('field', 'computer')); await page.waitForTimeout(150);
  await page.click('[data-act="sp-trial"][data-id="circuit"]'); await page.waitForTimeout(150);
  await page.click('[data-act="sp-t-sw"]'); await page.click('[data-act="sp-t-gap"][data-id="copper"]'); await page.click('[data-act="sp-t-submit"]'); await page.waitForTimeout(100);
  ok('実習①：導体だけ試して終えようとすると、理由を言って終わらせない', await ev(page, () => /絶縁体/.test(document.getElementById('sheet').textContent) && !window.__GAME__.S.space.know.circuit));
  await page.click('[data-act="sp-t-gap"][data-id="rubber"]');
  ok('実習①：ゴムをはさむとランプは消える', await ev(page, () => !document.querySelector('#sheet .lamp').classList.contains('on')));
  await page.click('[data-act="sp-t-gap"][data-id="copper"]'); await page.click('[data-act="sp-t-submit"]'); await page.waitForTimeout(150);
  ok('実習①：導体と絶縁体を確かめてランプをつけると、知識として記録される', await ev(page, () => !!window.__GAME__.S.space.know.circuit && /実習を終えた/.test(document.getElementById('sheet').textContent)));
  await page.click('#sheet .close');
  /* 知識がいる工作 */
  await page.click('#nav [data-tab="craft"]'); await page.waitForTimeout(200);
  const gate = await ev(page, () => { const b = document.querySelector('[data-act="craft"][data-id="c_gateboard"]'); return { dis: b && b.disabled, txt: b && b.closest('.card').textContent }; });
  ok('工作：論理回路の基板は、実習②を済ませるまで作れず、理由と「なぜこの材料？」が出る', gate.dis && /実習/.test(gate.txt) && /なぜこの材料/.test(gate.txt), JSON.stringify(gate).slice(0, 200));
  /* まとめて作る */
  await give(page, { wire: 10, pe: 5 }); await page.click('#nav [data-tab="craft"]'); await page.waitForTimeout(100); await page.click('#nav [data-tab="craft"]'); await page.waitForTimeout(200);
  await page.click('[data-act="craft"][data-id="c_insulwire"][data-n]'); await page.waitForTimeout(150);
  ok('工作：まとめて作る（×5）で、5回分の材料を使って5回分できる', await ev(page, () => { const S = window.__GAME__.S; return S.inv.insulwire === 22 && !S.inv.wire && !S.inv.pe; }), JSON.stringify(await ev(page, () => window.__GAME__.S.inv)));

  /* 設置：発射台は建築モードで自分で置く。残りは同じ判定で候補地へ */
  await give(page, { substation: 1, assembly: 1, launchpad: 1, tower: 1, control: 1, generator: 1, steamengine: 1, r_frame: 1, r_engine: 1, powerunit: 1, shipcomputer: 1, shipradio: 1, r_capsule: 1, cabinlife: 1, r_skin: 1, spacesuit: 1 });
  ok('設備を持っているだけでは建たない（置くまでマップに出ない・設置済みにもならない）', await ev(page, () => !window.__FAKE.structures['sp-pad'] && !SPACE.placed(window.__GAME__.S, 'launchpad')));
  await warp(page, -64, 143); await page.waitForTimeout(300);
  await ev(page, () => window.__GAME__.space.go('field', 'ground')); await page.waitForTimeout(150);
  await page.click('[data-act="b-start"][data-id="sp-pad"]'); await page.waitForTimeout(300);
  await ev(page, () => { const g = window.__GAME__; g.W3.place.x = -64; g.W3.place.z = 136; g.W3.place.rot = 0; g.placeUpdate ? g.placeUpdate(true) : 0; });
  await page.waitForTimeout(250);
  const pc = await ev(page, () => { const P = window.__GAME__.W3.place; return P && { ok: P.check && P.check.ok, why: P.check && P.check.reasons, x: P.x, z: P.z }; });
  await page.click('[data-act="b-ok"]'); await page.waitForTimeout(400);
  ok('建築モードで発射台を候補地に置ける（傾き・重なりの判定に通る）', await ev(page, () => { const b = window.__GAME__.S.build['sp-pad']; return !!b && !b.removed && window.__FAKE.structures['sp-pad'] && window.__FAKE.structures['sp-pad'].type === 'space-pad'; }), JSON.stringify(pc));
  const bad = await ev(page, () => window.__GAME__.space.sitePlace());
  ok('候補地の配置（5つの設備）が、建築の判定（傾き・水・ほかの建物・自然物）にすべて通る', Array.isArray(bad) && bad.length === 0, JSON.stringify(bad));
  ok('支持塔は近く・管制は安全な距離の決まりを満たしている', await ev(page, () => SPACE.siteIssues(window.__GAME__.S).length === 0 && ['sp-pad', 'sp-tower', 'sp-assembly', 'sp-control', 'sp-substation'].every(k => window.__FAKE.structures[k])));

  /* 組立：段階的に完成していく */
  await ev(page, () => window.__GAME__.space.go('field', 'rocket')); await page.waitForTimeout(150);
  ok('組立：骨組みより先に外装は取りつけられない（ボタンが出ない）', await ev(page, () => !document.querySelector('[data-act="sp-install"][data-id="skin"]') && !!document.querySelector('[data-act="sp-install"][data-id="frame"]')));
  await page.click('[data-act="sp-install"][data-id="frame"]'); await page.waitForTimeout(250);
  ok('組立：機体構造を取りつけると、発射台の上に機体（第1段階）が現れ、部品は在庫から機体へ移る', await ev(page, () => window.__FAKE.structures['sp-rocket'] && window.__FAKE.structures['sp-rocket'].type === 'space-rocket-1' && !window.__GAME__.S.inv.r_frame));
  for (const s of ['engine', 'power', 'computer', 'radio', 'capsule', 'life', 'skin']) { await page.click(`[data-act="sp-install"][data-id="${s}"]`); await page.waitForTimeout(120); }
  ok('組立：8つの部分を取りつけると機体が完成する（見た目も最終段階）', await ev(page, () => SPACE.rocketDone(window.__GAME__.S) && window.__FAKE.structures['sp-rocket'].type === 'space-rocket-15'));

  /* 試験 */
  await ev(page, () => { const k = window.__GAME__.S.space.know; ['switching', 'gates', 'adder', 'memory', 'roles', 'program', 'sensors'].forEach(x => k[x] = 1); window.__GAME__.space.go('field', 'launch'); }); await page.waitForTimeout(150);
  ok('打ち上げボタンは、条件がそろうまで押せない', await ev(page, () => document.querySelector('[data-act="sp-launch"]').disabled && document.querySelector('[data-act="sp-board"]').disabled));
  await page.click('[data-act="sp-test"][data-id="unmanned"]'); await page.waitForTimeout(150);
  ok('試験：前提が足りないと受けられず、足りないものと行き先が出る（無人試験には電源・コンピューター・通信の合格が要る）', await ev(page, () => /まだ試験できない/.test(document.getElementById('sheet').textContent) && document.querySelectorAll('#sheet [data-act="sp-test"]').length >= 3));
  await page.click('#sheet .close');
  await page.click('[data-act="sp-test"][data-id="power"]'); await page.waitForTimeout(120);
  for (const s of ['generator', 'steamengine', 'substation', 'power']) await page.click(`[data-act="sp-x-src"][data-id="${s}"]`);
  await page.click('[data-act="sp-x-submit"]'); await page.waitForTimeout(100);
  ok('電源の試験：全部つなぐと流しすぎで不合格（理由が出る・やり直せる）', await ev(page, () => /流しすぎ/.test(document.getElementById('sheet').textContent) && !window.__GAME__.S.space.tests.power));
  await page.click('[data-act="sp-x-src"][data-id="substation"]'); await page.click('[data-act="sp-x-submit"]'); await page.waitForTimeout(120);
  ok('電源の試験：必要より多く・限界より少なくで合格', await ev(page, () => !!window.__GAME__.S.space.tests.power)); await page.click('#sheet .close');
  await page.click('[data-act="sp-test"][data-id="computer"]'); await page.waitForTimeout(120);
  for (const [i, v] of [[0, 11], [1, 12]]) for (let b = 0; b < 5; b++) if ((v >> b) & 1) await page.click(`[data-act="sp-x-ans${i}"][data-id="${b}"]`);
  await page.click('[data-act="sp-x-submit"]'); await page.waitForTimeout(120);
  ok('コンピューターの自己診断：2進数の答えを入れて合格', await ev(page, () => !!window.__GAME__.S.space.tests.computer)); await page.click('#sheet .close');
  await page.click('[data-act="sp-test"][data-id="comm"]'); await page.waitForTimeout(120);
  const task = await ev(page, () => SPACE.testTask(window.__GAME__.S, 'comm'));
  await page.click(`[data-act="sp-x-ch"][data-id="${task.channel}"]`); await page.click(`[data-act="sp-x-echo"][data-id="${task.pattern}"]`); await page.click('[data-act="sp-x-submit"]'); await page.waitForTimeout(120);
  ok('通信確認：周波数を合わせて合図を返すと合格', await ev(page, () => !!window.__GAME__.S.space.tests.comm)); await page.click('#sheet .close');
  for (const t of ['suit', 'life', 'unmanned', 'final']) {
    await page.click(`[data-act="sp-test"][data-id="${t}"]`); await page.waitForTimeout(120);
    for (;;) { const b = await page.$('#sheet [data-act="sp-x-chk"]'); if (!b) break; await b.click(); }
    await page.click('[data-act="sp-x-submit"]'); await page.waitForTimeout(120); await page.click('#sheet .close');
  }
  ok('残りの試験（宇宙服・生命維持・無人・総合点検）に合格できる', await ev(page, () => ['suit', 'life', 'unmanned', 'final'].every(t => window.__GAME__.S.space.tests[t])));

  /* 搭乗と打ち上げ */
  await warp(page, -20, 20); await page.waitForTimeout(200); await ev(page, () => window.__GAME__.render());
  ok('支持塔からはなれていると搭乗できない（理由が出る）', await ev(page, () => document.querySelector('[data-act="sp-board"]').disabled && /支持塔のそば|宇宙服を着る/.test(document.querySelector('.sp').textContent)));
  await page.click('[data-act="sp-wear"]'); await page.waitForTimeout(100);
  const hero0 = await ev(page, () => window.__GAME__.S.flags.hero);
  ok('宇宙服を着ても、主人公の選択は変わらない', await ev(page, h => window.__GAME__.S.space.wear && window.__GAME__.S.flags.hero === h, hero0));
  const tw = await ev(page, () => SPACE.placedAt(window.__GAME__.S, 'tower')); await warp(page, tw.x, tw.z + 2.6); await page.waitForTimeout(200); await ev(page, () => window.__GAME__.render());
  await page.click('[data-act="sp-board"]'); await page.waitForTimeout(150);
  ok('支持塔のそばで搭乗でき、打ち上げの条件が 10/10 になる', await ev(page, () => window.__GAME__.S.space.board && SPACE.launchReady(window.__GAME__.S) && !document.querySelector('[data-act="sp-launch"]').disabled));
  const invBefore = await ev(page, () => JSON.stringify(window.__GAME__.S.inv));
  await page.click('[data-act="sp-launch"]'); await page.waitForTimeout(150);
  ok('最終確認の画面が出る（10項目）', await ev(page, () => document.querySelectorAll('#sheet .spchk li.ok').length === 10));
  await page.dblclick('[data-act="sp-go"]').catch(() => {}); await page.waitForTimeout(300);
  const c1 = await ev(page, () => ({ n: document.querySelectorAll('.spcine').length, launching: window.__GAME__.S.space.launching > 0, saved: JSON.parse(localStorage.getItem('zero-kagaku-save')).space.launching > 0, input: window.__GAME__.fieldInputActive ? window.__GAME__.fieldInputActive() : null }));
  ok('二重クリックでも打ち上げは1回だけ始まり、発射前にセーブされている', c1.n === 1 && c1.launching && c1.saved, JSON.stringify(c1));
  await page.keyboard.down('d'); await page.waitForTimeout(300); await page.keyboard.up('d');
  ok('演出の間は、スキップのボタンが出ている', await page.isVisible('.spcine .skip'));
  await page.click('.spcine .skip'); await page.waitForTimeout(400);
  const end = await ev(page, () => { const s = window.__GAME__.S.space; return { clear: !!s.clear, launching: s.launching, board: s.board, modal: document.getElementById('modal').classList.contains('open'), txt: document.getElementById('sheet').textContent, cine: document.querySelectorAll('.spcine').length, stage: window.__GAME__.stage ? window.__GAME__.stage() : null }; });
  ok('スキップすると宇宙到達が記録され、エンディング（歩みの記録・実績）が出る', end.clear && !end.launching && !end.board && end.modal && end.cine === 0 && /宇宙に、届いた/.test(end.txt) && /歩み/.test(end.txt) && /実績/.test(end.txt), JSON.stringify(end).slice(0, 300));
  ok('エンディングに「時間を打ち上げ前に戻して続ける」ことが書いてある', /時間を打ち上げの前に戻して/.test(end.txt) && /増えることはありません/.test(end.txt));
  await page.click('#sheet .btn.act'); await page.waitForTimeout(250);
  ok('「打ち上げ前の世界で探索を続ける」：地上に戻り、機体と設備は残り、持ち物は増えも減りもしない', await ev(page, inv => { const g = window.__GAME__; return !document.getElementById('modal').classList.contains('open') && JSON.stringify(g.S.inv) === inv && SPACE.rocketDone(g.S) && window.__FAKE.structures['sp-rocket'] && window.__FAKE.structures['sp-pad'] && !g.S.space.board; }, invBefore));
  /* 再演出 */
  const t1 = await ev(page, () => window.__GAME__.S.space.clear.t);
  await ev(page, () => window.__GAME__.space.go('field', 'launch')); await page.waitForTimeout(120);
  await page.click('[data-act="sp-board"]'); await page.waitForTimeout(100); await page.click('[data-act="sp-launch"]'); await page.waitForTimeout(100);
  ok('2回目は「再演出」と表示される', await ev(page, () => /再演出/.test(document.getElementById('sheet').textContent)));
  await page.click('[data-act="sp-go"]'); await page.waitForTimeout(300);
  /* 演出の途中で再読み込み */
  await page.reload(); await page.waitForFunction(() => window.__GAME__ && document.getElementById('modal').classList.contains('open')); await page.waitForTimeout(300);
  ok('演出の途中で再読み込みすると、「続きから見る／打ち上げ前に戻る」を選べる（進行不能にならない）', await ev(page, () => /打ち上げの途中/.test(document.getElementById('sheet').textContent) && !!document.querySelector('[data-act="sp-abort"]') && !!document.querySelector('[data-act="sp-resume"]')));
  await page.click('[data-act="sp-abort"]'); await page.waitForTimeout(300);
  ok('「打ち上げ前に戻る」：初回の記録はそのまま・再演出の回数は増えない・地上で操作できる', await ev(page, t => { const s = window.__GAME__.S.space; return s.clear.t === t && s.replays === 0 && !s.launching && !s.board && !document.getElementById('modal').classList.contains('open'); }, t1));
  await page.waitForFunction(() => window.__GAME__.W3.state === 'ready'); await ev(page, () => window.__GAME__.space.go('home')); await page.waitForTimeout(150);
  ok('到達後のプロジェクト画面：100%・到達の記録を見られる', await ev(page, () => /100%/.test(document.querySelector('.spgoal').textContent) && !!document.querySelector('[data-act="sp-ending"]')));
  ok('ページでエラーが起きていない（PC）', errors.length === 0, errors.join('\n'));
  await page.context().close();
}

/* ---------------- スマホ縦：メニューから開く・押せる大きさ ---------------- */
{
  const { page, errors } = await newPage({ width: 390, height: 844 }, true); await start(page);
  await page.click('#nav [data-tab="menu"]'); await page.waitForTimeout(200);
  ok('スマホ：メニューの中に「宇宙へ」がある', await page.isVisible('.bigitem[data-tab="space"]'));
  await page.click('.bigitem[data-tab="space"]'); await page.waitForTimeout(250);
  const m = await ev(page, () => { const d = document.getElementById('dock'), se = document.scrollingElement; const small = [...document.querySelectorAll('#dockBody button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5).map(b => b.textContent.trim().slice(0, 12));
    return { size: d.dataset.size, tab: window.__GAME__.U.tab, noScroll: se.scrollWidth <= innerWidth, wide: document.getElementById('dockBody').scrollWidth <= document.getElementById('dockBody').clientWidth + 1, small }; });
  ok('スマホ：プロジェクト画面は下からの大きなシートで開き、横にはみ出さない', m.tab === 'space' && m.size === 'tall' && m.noScroll && m.wide, JSON.stringify(m));
  ok('スマホ：押せる所は 44px 以上', m.small.length === 0, m.small.join(' / '));
  await ev(page, () => { const S = window.__GAME__.S; ['adderboard'].forEach(k => { S.inv[k] = 1; S.disc[k] = { first: 1, made: 1, total: 1, routes: [], best: 0 }; }); window.__GAME__.space.trial('adder'); }); await page.waitForTimeout(200);
  const tr = await ev(page, () => { const sh = document.getElementById('sheet'); const small = [...sh.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5).map(b => b.textContent.trim().slice(0, 10)); return { wide: sh.scrollWidth <= sh.clientWidth + 1, small }; });
  ok('スマホ：実習の画面も横にはみ出さず、ボタンは 44px 以上', tr.wide && tr.small.length === 0, JSON.stringify(tr));
  for (const [a, b] of [[1, 2], [2, 3], [3, 3]]) { await ev(page, ([a, b]) => { const T = window.__GAME__.U.tr; T.a = 0; T.b = 0; }, [a, b]);
    for (let i = 0; i < 2; i++) { if ((a >> i) & 1) await page.click(`[data-act="sp-t-a"][data-id="${i}"]`); if ((b >> i) & 1) await page.click(`[data-act="sp-t-b"][data-id="${i}"]`); } }
  await page.click('[data-act="sp-t-submit"]'); await page.waitForTimeout(150);
  ok('スマホ：実習④（2進数の足し算）をタップだけで終えられる', await ev(page, () => !!window.__GAME__.S.space.know.adder));
  ok('ページでエラーが起きていない（スマホ）', errors.length === 0, errors.join('\n'));
  await page.context().close();
}

/* ---------------- 以前のセーブ（v4）の移行 ---------------- */
{
  const old = JSON.stringify({ v: 4, inv: { steel: 3, bench: 1, campfire: 1 }, disc: { steel: { first: 5, made: 1, total: 3, routes: [], best: 0 }, bench: { first: 1, made: 1, total: 1, routes: [], best: 0 } }, hist: [], gathered: {}, explore: {}, auto: [], seq: 7, flags: { hero: 'girl', intro: 1 }, nature: {}, build: { 'st-bench': { x: -15, z: 24, rot: 0.5 } }, camera: {}, worldVer: 4, pos: { x: -18, z: 22 }, created: 1000 });
  const { page, errors } = await newPage({ width: 1280, height: 720 }, false, `try{ if(!localStorage.getItem('zero-kagaku-save')) localStorage.setItem('zero-kagaku-save', ${JSON.stringify(old)}); }catch(e){}`); await start(page);
  const r = await ev(page, () => { const g = window.__GAME__, S = g.S; return { v: S.v, steel: S.inv.steel, hero: S.flags.hero, bench: S.build['st-bench'], space: S.space, backup: !!localStorage.getItem('zero-kagaku-save-backup-v4'), structs: Object.keys(window.__FAKE.structures) }; });
  ok('以前のセーブ（v4）を読みこめる：持ち物・建物・主人公はそのまま、宇宙計画は未着手、元のセーブは控えてある', r.v === 5 && r.steel === 3 && r.hero === 'girl' && r.bench && r.bench.rot === 0.5 && r.space && !r.space.clear && r.backup && r.structs.includes('st-bench') && !r.structs.some(k => k.startsWith('sp-')), JSON.stringify(r).slice(0, 300));
  ok('ページでエラーが起きていない（移行）', errors.length === 0, errors.join('\n'));
  await page.context().close();
}
} finally { try { await browser?.close(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
