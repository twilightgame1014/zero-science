// 図鑑（レシピ図鑑）のブラウザ結合テスト（偽の描画モジュール。2026-11-14 Claude）。
// 検索・発見のきまり・学習用の全件閲覧・PC の左右の並び・スマホの切り替えと「戻る」で検索条件と位置が戻る・逆引き（製法の選択・数・循環・副産物・設備の未完成）・入口・保存の互換・横スクロールなし。
import { chromium } from 'playwright'; import { build } from 'esbuild'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createServer } from 'node:http'; import { once } from 'node:events';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const utils = await build({ entryPoints: [path.join(root, 'src/graphics/utils.ts')], bundle: true, format: 'cjs', write: false, logLevel: 'warning' });
const FAKE = fs.readFileSync(path.join(root, 'tests/e2e/fake-hd2d.js'), 'utf8').replace('/*UTILS*/', utils.outputFiles[0].text);
const html = fs.readFileSync(path.join(root, 'dist/index.html'));
const server = createServer((req, res) => { const p = new URL(req.url, 'http://localhost').pathname; if (p !== '/' && p !== '/index.html') { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); });
let fail = 0; const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name} ${cond ? '' : extra}`); if (!cond) fail++; };
const OUT = process.env.BOOK_OUT || path.join(root, 'test-results/book'); fs.mkdirSync(OUT, { recursive: true });
let browser;
try {
server.listen(0, '127.0.0.1'); await once(server, 'listening'); const url = `http://127.0.0.1:${server.address().port}/`;
browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
async function newPage(vp, touch) { const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort()); await page.route('https://fonts.googleapis.com/**', r => r.abort()); await page.addInitScript(FAKE);
  await page.goto(url + '?verify=0'); await page.waitForTimeout(300); const b = await page.$('#introGo'); if (b && await b.isVisible()) await page.click('#introGo');
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready'); await page.waitForTimeout(200); return { page, errors, ctx }; }
const ev = (page, f, a) => page.evaluate(f, a);
const openBook = async (page, touch) => { if (touch) { await page.click('#nav [data-tab="menu"]'); await page.waitForTimeout(150); await page.click('.bigitem[data-tab="book"]'); } else await page.click('#nav [data-tab="book"]'); await page.waitForTimeout(250); };
const typeQ = async (page, q) => { await page.fill('#bkq', q); await page.waitForTimeout(200); };
const listIds = page => ev(page, () => [...document.querySelectorAll('#bkList .bk-it')].map(b => b.dataset.id));

for (const [label, vp, touch] of [['PC', { width: 1366, height: 800 }, false], ['スマホ', { width: 390, height: 844 }, true]]) {
  const { page, errors, ctx } = await newPage(vp, touch);
  await openBook(page, touch);
  ok(`${label}：図鑑に検索の欄・分類・一覧がある`, await ev(page, () => !!document.querySelector('#bkq') && document.querySelectorAll('[data-act="bk-cat"]').length === 8 && document.querySelectorAll('#bkList .bk-it').length > 0));
  const hinted = await ev(page, () => [...document.querySelectorAll('#bkList .bk-it.hint')].map(b => b.textContent));
  ok(`${label}：新しいゲームでは、まだ見つけていない物は ？？？（名前を出さない）`, hinted.length > 0 && hinted.every(t => /？？？/.test(t)));
  await typeQ(page, 'てつ');
  ok(`${label}：未発見の物は名前で探せない（「てつ」→ 0 件と説明）`, (await listIds(page)).length === 0 && await ev(page, () => /名前では探せない/.test(document.querySelector('#bkList').textContent)));
  ok(`${label}：検索の文字を打っても、入力欄から外れない（一覧だけを描き直す）`, await ev(page, () => document.activeElement && document.activeElement.id === 'bkq'));
  /* 学習用の全件閲覧（発見の記録は変えない） */
  const disc0 = await ev(page, () => Object.keys(window.__GAME__.S.disc).length);
  await page.click('#bkall'); await page.waitForTimeout(250); await typeQ(page, 'てつ');
  ok(`${label}：「学習用：全部を見る」で読み（てつ）から探せる。発見の記録は変わらない`, (await listIds(page)).includes('iron') && await ev(page, n => Object.keys(window.__GAME__.S.disc).length === n, disc0));
  /* 一覧のスクロール位置と検索条件を覚えて詳細へ → 戻る */
  await typeQ(page, ''); await page.click('[data-act="bk-cat"][data-id="material"]'); await page.waitForTimeout(250);
  const sc = touch ? '#dockBody' : '#bkList';
  await ev(page, sc => { const el = document.querySelector(sc); el.scrollTop = 400; }, sc); await page.waitForTimeout(100);
  const sc0 = await ev(page, sc => document.querySelector(sc).scrollTop, sc);
  await ev(page, () => document.querySelector('#bkList .bk-it[data-id="steel"]').scrollIntoView({ block: 'nearest' })); const sc0b = await ev(page, sc => document.querySelector(sc).scrollTop, sc);
  await page.click('#bkList .bk-it[data-id="steel"]'); await page.waitForTimeout(300);
  const det = await ev(page, () => document.querySelector('#bkDetail').innerText);
  ok(`${label}：詳細に、説明・自然界・入手方法（材料と数量・設備）・用途・現実の科学・簡略化・出典と確認日・監修の状態がある`, ['入手方法', '自然界では', '主な用途', '現実の科学', '簡略化', '出典と確認日', '監修', '未確認', '×'].every(w => det.includes(w)), det.slice(0, 300));
  ok(`${label}：監修していない文に「確認済み」を出さない`, !/確認済み/.test(det));
  ok(`${label}：未完成の設備は使える扱いにしない（未建設・持っていない）`, /✕ [^\n]*(未建設|持っていない)/.test(det));
  if (touch) {
    ok('スマホ：詳細に切り替わり、一覧と検索は隠れ、「一覧へ戻る」がある', await ev(page, () => getComputedStyle(document.querySelector('#bkList')).display === 'none' && !!document.querySelector('.bk-back') && getComputedStyle(document.querySelector('.bk-back')).display !== 'none'));
    ok('スマホ：横スクロールしない（パネル・詳細）', await ev(page, () => { const b = document.querySelector('#dockBody'); return b.scrollWidth <= b.clientWidth + 1 && document.scrollingElement.scrollWidth <= window.innerWidth + 1; }));
    await page.screenshot({ path: `${OUT}/phone-detail.png` });
    await page.click('.bk-back'); await page.waitForTimeout(300);
    ok('スマホ：戻ると、分類（材料）と全件閲覧とスクロールの位置が戻る', await ev(page, ([sc, y]) => window.__GAME__.U.book.cat === 'material' && document.querySelector('#bkall').checked && Math.abs(document.querySelector(sc).scrollTop - y) < 40, [sc, sc0b]));
    await page.screenshot({ path: `${OUT}/phone-list.png` });
    await page.click('#bkList .bk-it[data-id="steel"]'); await page.waitForTimeout(300);
  } else {
    ok('PC：一覧と詳細が左右に並び、選ぶと一覧のスクロールの位置はそのまま', await ev(page, ([sc, y]) => { const l = document.querySelector('#bkList').getBoundingClientRect(), d = document.querySelector('#bkDetail').getBoundingClientRect(); return l.right <= d.left + 2 && d.width > 300 && Math.abs(document.querySelector(sc).scrollTop - y) < 2; }, [sc, sc0b]));
    await page.screenshot({ path: `${OUT}/pc-detail.png` });
  }
  /* 逆引き：数・製法の選択・副産物・循環 */
  const tree0 = await ev(page, () => document.querySelector('.bk-tree').innerText);
  await page.fill('#bkn', '3'); await page.dispatchEvent('#bkn', 'change'); await page.waitForTimeout(200);
  const tree3 = await ev(page, () => document.querySelector('.bk-tree').innerText);
  ok(`${label}：作る数を変えると必要量が変わる（鋼 ×1 → ×3）`, /×1/.test(tree0) && /×3/.test(tree3) && tree0 !== tree3);
  /* 製法の選択：作り方が何通りもある物（鉄：研究室で 2 通り以上）で、いちばん上の製法を変える（深い段の製法は、開くと選べる） */
  await ev(page, () => { const g = window.__GAME__; g.U.book.sel = 'iron'; g.render(); g.setTab('book'); }); await page.waitForTimeout(300);
  const sel = await ev(page, () => { const s = document.querySelector('.bk-route[data-id="iron"]'); return s ? { id: 'iron', n: s.options.length, v: s.value, kids: document.querySelector('.bk-tree').innerText } : null; });
  if (sel && sel.n > 1) { await page.locator('.bk-route[data-id="iron"]').first().selectOption({ index: sel.n - 1 }); await page.waitForTimeout(250); }
  ok(`${label}：製法を選ぶと、その製法の材料で必要量を出し直す（選んだ製法を覚える）`, !!sel && sel.n > 1 && await ev(page, s => window.__GAME__.U.book.route.iron && window.__GAME__.U.book.route.iron !== s.v && document.querySelector('.bk-tree').innerText !== s.kids, sel));
  ok(`${label}：合計に自然から採る原料と、要る設備・道具（使えるか）が出る`, await ev(page, () => /自然から採る原料/.test(document.querySelector('.bk-treewrap').innerText)));
  /* 循環：ソーダ灰をソーダ灰を使う製法で作ろうとすると止める */
  await ev(page, () => { const B = BOOK, S = window.__GAME__.S; const o = B.options(S, 'soda').filter(x => x.kind === 'lab'); window.__GAME__.U.book.route = { soda: o[o.length - 1].key }; });
  if (touch && await ev(page, () => window.__GAME__.U.book.sel)) { await page.click('.bk-back'); await page.waitForTimeout(250); }
  await typeQ(page, ''); await page.click('[data-act="bk-cat"][data-id="all"]'); await page.waitForTimeout(150); await typeQ(page, 'そーだ');
  const ids = await listIds(page); const soda = ids.find(x => x === 'soda');
  if (soda) { await page.click('#bkList .bk-it[data-id="soda"]'); await page.waitForTimeout(300); }
  ok(`${label}：循環する製法を選ぶと「循環（ここで止める）」と出して止まる`, !!soda && await ev(page, () => /循環/.test(document.querySelector('.bk-tree').innerText)), JSON.stringify(ids.slice(0, 5)));
  /* 副産物（1 回で 2 種類できる作り方）：枝を燃やすと灰と… */
  const multi = await ev(page, () => { const p = window.__GAME__.D.procs.find(p => Object.keys(p.out).length > 1); return { out: Object.keys(p.out)[0], id: p.id }; });
  await ev(page, m => { window.__GAME__.U.book.sel = m.out; window.__GAME__.U.book.route = { [m.out]: m.id }; window.__GAME__.render(); window.__GAME__.setTab('book'); }, multi); await page.waitForTimeout(300);
  ok(`${label}：複数の物ができる作り方は「副産物」として出す`, await ev(page, () => /副産物/.test(document.querySelector('#bkDetail').innerText)));
  /* 入口：研究室へ */
  const lab = await page.$('#bkDetail [data-act="bk-go"][data-id="lab"]');
  if (lab) { await lab.click(); await page.waitForTimeout(250); }
  ok(`${label}：作り方から研究室への入口`, !!lab && await ev(page, () => window.__GAME__.U.tab === 'lab'));
  /* 保存の互換：全件閲覧の設定は残り、セーブは v6 */
  await ev(page, () => window.__GAME__.save()); await page.waitForTimeout(300); await page.reload(); await page.waitForTimeout(400);
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.W3.state === 'ready');
  ok(`${label}：読み込み直しても全件閲覧の設定が残り、セーブは v6・発見は増えない`, await ev(page, n => window.__GAME__.S.flags.bookAll === true && window.__GAME__.S.v === 6 && Object.keys(window.__GAME__.S.disc).length === n, disc0));
  /* ほかの画面から開く案内の枠も同じ中身（工作のカードの図鑑ボタンと同じ openItem） */
  await ev(page, () => { window.__GAME__.S.flags.bookAll = false; }); await ev(page, () => { const b = document.createElement('button'); b.dataset.act = 'item'; b.dataset.id = 'twig'; document.body.appendChild(b); b.click(); b.remove(); }); await page.waitForTimeout(300);
  const modal = await ev(page, () => document.querySelector('#sheet').innerText);
  ok(`${label}：ほかの画面から開く図鑑の枠も同じ中身（未発見なら ？？？ とヒントだけ）`, /？？？/.test(modal) && !/木の枝/.test(modal), modal.slice(0, 120));
  ok(`${label}：ページでエラーが起きていない`, errors.length === 0, errors.join('\n'));
  await ctx.close();
}
} finally { try { await browser?.close(); } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); } }
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格'); process.exit(fail ? 1 : 0);
