// ブラウザでの結合テスト。Three.js を使わず、描画モジュールと同じAPIを持つ「偽モジュール」を
// 差し込んで、ゲーム側の連携（全画面マップ・HUD・パネル・入力保護・移動・採取・建物の同期・セーブ）を検証する。
// 本物の3D描画の見た目は対象外（実WebGLでの確認は別に行うこと）。
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

async function newPage(viewport, touch, { fake = true, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  // CDN の three とフォントはテストでは読まない（偽モジュールを使う）
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  if (fake) await page.addInitScript(FAKE);
  await page.goto(url + query); await page.waitForTimeout(300);
  return { page, errors, ctx };
}
/* 画面全体がマップで、ページがスクロールしないこと */
const fullCheck = page => page.evaluate(() => { const v = document.getElementById('view').getBoundingClientRect(), se = document.scrollingElement;
  return { full: v.left === 0 && v.top === 0 && Math.round(v.width) === innerWidth && Math.round(v.height) === innerHeight,
    noScroll: se.scrollHeight <= innerHeight && se.scrollWidth <= innerWidth, ui: document.getElementById('app').dataset.ui }; });
const rect = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, shown: getComputedStyle(document.querySelector(s)).display !== 'none' && r.width > 0 }; }, sel);
const overlap = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
/* 合成の PointerEvent（指を区別するテスト用） */
const ptr = (page, sel, type, id, dx = 0, dy = 0) => page.evaluate(([s, type, id, dx, dy]) => { const el = document.querySelector(s), r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy })); }, [sel, type, id, dx, dy]);

/* ---------------- スマホ縦（390×844・タッチ） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 390, height: 844 }, true);
  ok('初回の案内（タイトル）がいちばん前に出て、背面は操作できない', await page.evaluate(`document.getElementById('modal').classList.contains('open') && document.getElementById('app').inert === true`));
  await page.click('.heropick[data-id="girl"]'); await page.click('#introGo'); await page.waitForTimeout(600);
  const home = await page.evaluate(`({tab:${G}.U.tab, dock:document.getElementById('dock').hidden, w3:!!document.getElementById('w3'), inert:document.getElementById('app').inert})`);
  ok('起動直後は探索（パネルは閉じている）', home.tab === 'explore' && home.dock && home.w3 && !home.inert, JSON.stringify(home));
  const fc = await fullCheck(page);
  ok('スマホ：表示領域の端から端までマップで、ページがスクロールしない', fc.full && fc.noScroll && fc.ui === 'touch', JSON.stringify(fc));
  const init = await page.evaluate(`(()=>{ const W=${G}.WORLD, p=${G}.W3.pos, near=W.objects.filter(o=>Math.hypot(o.x-p.x,o.z-p.z)<30);
    return {state:${G}.W3.state, deps:${G}.NODES.every(n=>__FAKE.resources[n.vid]), nat:near.length, natSent:near.filter(o=>__FAKE.resources[o.id]&&__FAKE.resources[o.id].natural&&__FAKE.resources[o.id].natural.id===o.id).length, natView:near.filter(o=>${G}.onScreenish(o.x,o.z,o.kind==='tree'?2*o.scale:0.3,0.22)).length, natAll:Object.keys(__FAKE.resources).filter(k=>__FAKE.resources[k].natural).length,
      decor:JSON.stringify(__FAKE.opts.decor), girl:null}; })()`);
  ok('3Dフィールドが初期化され、採取地点と、画面に入る自然物（ID・状態・当たり判定つき）だけが描画モジュールに渡る', init.state === 'ready' && init.deps && init.nat > 10 && init.natSent > 10 && init.natSent === init.natView, JSON.stringify(init));
  ok('描画モジュールには、木・岩などを独自の装飾として描かないよう伝える（連携契約）', init.decor === '{"trees":false,"rocks":false,"logs":false,"pebbles":false,"shrubs":false,"stonework":false,"waterfall":false}', init.decor);
  ok('描画モジュールの開水面（湖・海・オアシスを描く）は切らない（統合後の世界。旧世界の低地は render.ts が深さ0にする）', !JSON.parse(init.decor).hasOwnProperty('openWater'), init.decor);
  const pre = await page.evaluate(`({stonework: __FAKE.opts.decor.stonework, structs: Object.keys(__FAKE.structures).filter(k=>!/^v[hp]:/.test(k))})`);
  ok('開始時の拠点まわりに人工物がない（石の階段・石積みの壁は decor.stonework:false で描かせず、プレイヤーの建物は1つもない。集落は別）', pre.stonework === false && pre.structs.length === 0, JSON.stringify(pre));
  ok('ボタン共通のスタイルが効いている', await page.evaluate(`getComputedStyle(document.querySelector('#nav button')).cursor==='pointer' && getComputedStyle(document.createElement('div')).color!==undefined`) && await page.evaluate(`(()=>{ const b=document.createElement('button'); b.className='btn'; document.body.appendChild(b); const c=getComputedStyle(b).backgroundColor; b.remove(); return c==='rgb(32, 45, 59)'; })()`));   // 2026-11-11 のデザイン：ふつうのボタンは濃紺（--navy2）

  // 見えている自然物（拠点のまわりの小石）を選んで、近づいて採取する。連打しても1回だけ
  const peb = await page.evaluate(`(()=>{ const W=${G}.WORLD, p=${G}.W3.pos; const o=W.objects.filter(o=>o.kind==='pebble'&&!o.variant).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0]; ${G}.selectAndGo({o}); return o.id; })()`);
  await page.waitForFunction(`!${G}.W3.path`, null, { timeout: 15000 });
  const seq0 = await page.evaluate(`${G}.S.seq`);
  for (let i = 0; i < 6; i++) { await page.evaluate(`${G}.pressAction()`); await page.waitForTimeout(40); }
  await page.waitForTimeout(900);
  const pr = await page.evaluate(`({cobble:${G}.S.inv.cobble||0, seq:${G}.S.seq, vis:__FAKE.resources['${peb}'], st:${G}.S.nature['${peb}']})`);
  ok('見えている小石を選ぶと近づいて拾え、連打しても1回だけ確定する', pr.cobble >= 1 && pr.cobble <= 2 && pr.seq === seq0 + 1 && pr.st && pr.st.u === 1, JSON.stringify(pr));
  ok('拾った小石は見た目から消え、状態がセーブに入る', pr.vis && pr.vis.visible === false && pr.vis.natural.state === 'gone');
  // 木を選ぶと、道具がないので理由を表示して採取しない
  await page.evaluate(`(()=>{ const W=${G}.WORLD, p=${G}.W3.pos; const o=W.objects.filter(o=>o.kind==='tree').sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0]; window.__T=o.id; ${G}.selectAndGo({o}); })()`);
  await page.waitForFunction(`!${G}.W3.path`, null, { timeout: 30000 }); await page.waitForTimeout(300);
  const trr0 = await page.evaluate(`({txt:document.getElementById('w3act').textContent, mode:document.getElementById('w3act').dataset.mode, log:${G}.S.inv.log||0, gap:${G}.WORLD.reachGap(${G}.WORLD.byId.get(window.__T), ${G}.W3.pos)})`);
  ok('木に近づくと外周で止まり、道具がない理由（おのが必要）を表示して採取しない', trr0.mode === 'lock' && /おの/.test(trr0.txt) && trr0.log === 0 && trr0.gap <= 1.6 && trr0.gap > 0, JSON.stringify(trr0));
  // キー移動で木の幹をすり抜けない
  const trapped = await page.evaluate(`window.__samples=[]`);
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'a', 'w']) {
    await page.keyboard.down(key);
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(100); await page.evaluate(`(()=>{ const W=${G}.WORLD, p=${G}.W3.pos; const bad=W.objects.concat(W.statics).find(o=>W.solid(${G}.S,o) && Math.hypot(p.x-o.x,p.z-o.z) < o.r+W.PLAYER_R-0.02); if(bad) window.__samples.push(bad.id); })()`); }
    await page.keyboard.up(key);
  }
  const inside = await page.evaluate(`window.__samples`);
  ok('キー移動（上下左右・WASD）で木の幹や岩の中に入らない', inside.length === 0, inside.join(','));

  const girl = await page.evaluate(async () => { const G = window.__GAME__, want = await G.hero.sheet('girl'); const im = new Image(); im.src = __FAKE.sprite; await im.decode();
    return { same: __FAKE.sprite === want, w: im.width, h: im.height, dirs: G.hero.dirs(), rows: ASSETS.heroRows }; });
  ok('主人公の選択（女の子）がスプライトに反映される（8方向の絵を使わないときは、8行のシートの上4行＝1024×1024 を渡す）', girl.same && girl.rows === 8 && (girl.dirs === 8 ? girl.h === 2048 : girl.w === 1024 && girl.h === 1024), JSON.stringify(girl));
  const nav = await rect(page, '#nav'), joy = await rect(page, '#joy'), act = await rect(page, '#w3act');
  const navBtns = await page.evaluate(`[...document.querySelectorAll('#nav button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>({t:b.textContent.trim(), h:b.getBoundingClientRect().height}))`);
  ok('スマホの下部ナビは「研究室・工作・メニュー」の3つで、高さ48px以上', navBtns.map(b => b.t).join() === '研究室,工作,☰メニュー' && navBtns.every(b => b.h >= 48), JSON.stringify(navBtns));
  ok('スティックは左下・採取ボタンは右下にあり、どちらも下部ナビの上で重ならない', joy.shown && act.shown && joy.b <= nav.t && act.b <= nav.t && !overlap(joy, act) && joy.l < 195 && act.r > 195 && act.w >= 48 && act.h >= 48, JSON.stringify({ joy, act, nav }));
  const tr = await page.evaluate(`[...document.querySelectorAll('.hud-tr button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>({t:b.textContent.trim(), w:b.getBoundingClientRect().width, h:b.getBoundingClientRect().height}))`);
  ok('右上は「地図・設定」の2つで、文字付き・48px以上', tr.map(b => b.t).join() === '地図,設定' && tr.every(b => b.w >= 48 && b.h >= 48), JSON.stringify(tr));
  ok('HUDの空いた所はマップへの入力を妨げない', await page.evaluate(`!!document.elementFromPoint(innerWidth*0.5, innerHeight*0.5).closest('#view')`));
  await page.evaluate(`(()=>{ ${G}.W3.pos={x:-20,z:20}; ${G}.W3.sel=null; })()`); await page.waitForTimeout(300);
  ok('近くに資源がないとき、右下のボタンは「調べる」', await page.evaluate(`document.getElementById('w3act').dataset.mode==='look' && /調べる/.test(document.getElementById('w3act').textContent)`));

  await page.click('.hud-tr [data-tab="world"]'); await page.waitForTimeout(200);
  const lockTxt = await page.evaluate(`document.querySelector('.tchip[data-id="cave"]').textContent`);
  ok('地図ボタンで地域選択が開き、すべての地域を選べる（2026-11-11 地域の鍵を廃止。洞窟にも鍵の印・条件がない）', !/が必要|🔒/.test(lockTxt) && /洞窟/.test(lockTxt) && await page.evaluate(`document.querySelectorAll('.tchip').length === ${G}.D.regions.filter(r=>!r.future).length`), lockTxt);
  await page.click('.tchip[data-id="forest"]'); await page.waitForTimeout(5500);
  ok('地域を選ぶとパネルが閉じ、森林まで歩ける', await page.evaluate(`${G}.U.tab==='explore' && ${G}.W3.region && ${G}.W3.region.id === 'forest'`));
  await page.click('.w3lab[data-n="forest:twig"]'); await page.waitForFunction(`(${G}.S.inv.twig||0)>0`, null, { timeout: 15000 }).catch(()=>{}); await page.waitForTimeout(200);
  ok('名札タップで歩いて行って採取できる', (await page.evaluate(`${G}.S.inv.twig || 0`)) > 0);
  ok('発見の演出が描画モジュールに送られる', await page.evaluate(`__FAKE.effects.includes('discovery')`));
  ok('資源の近くでは、右下のボタンが「〜を採る」になる', await page.evaluate(`document.getElementById('w3act').dataset.mode==='gather' && /採る/.test(document.getElementById('w3act').textContent)`));

  // 指を区別する：スティックを押さえたまま、別の指で採取ボタン
  const t0 = await page.evaluate(`${G}.S.inv.twig||0`);
  await ptr(page, '#joy', 'pointerdown', 11); await ptr(page, '#joy', 'pointermove', 11, 0, -30); await page.waitForTimeout(80);
  const moving = await page.evaluate(`!!${G}.W3.joy`);
  await ptr(page, '#w3act', 'pointerdown', 12); await ptr(page, '#w3act', 'pointerup', 12); await page.waitForTimeout(700);
  const stillJoy = await page.evaluate(`!!${G}.W3.joy`);
  ok('スティックで歩きながら、別の指で採取ボタンを押せる', moving && stillJoy && (await page.evaluate(`${G}.S.inv.twig||0`)) > t0, JSON.stringify({ moving, stillJoy }));
  await ptr(page, '#joy', 'pointercancel', 11); await page.waitForTimeout(50);
  await page.waitForTimeout(150); await page.evaluate(`window.__t0=performance.now()`); await page.waitForTimeout(250);
  ok('歩行（スティック）：タッチがキャンセルされると歩行も止まる', (await page.evaluate(`__FAKE.track.filter(r=>r.t>=window.__t0)`)).every(r => !r.m));
  await ptr(page, '#joy', 'pointerdown', 21); await ptr(page, '#joy', 'pointermove', 21, 30, 0); await page.waitForTimeout(400);
  const jOn = await page.evaluate(`__FAKE.track.slice(-4).every(r=>r.m)`);
  await ptr(page, '#joy', 'pointerup', 21); await page.waitForTimeout(150); await page.evaluate(`window.__t0=performance.now()`); await page.waitForTimeout(250);
  ok('歩行（スティック）：倒している間は歩き、離すと止まる', jOn && (await page.evaluate(`__FAKE.track.filter(r=>r.t>=window.__t0)`)).every(r => !r.m));
  ok('タッチがキャンセルされると、スティックの移動が止まる', await page.evaluate(`!${G}.W3.joy && document.querySelector('#joy .knob').style.transform===''`));

  // パネルを開くと入力が止まる
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400);
  await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(100);
  const p1 = await pos(page); await page.waitForTimeout(600);
  ok('キーを押したままメニューを開くと、その場で止まる', same(p1, await pos(page)));
  ok('スマホで全高の研究室を開くと描画ループが止まる', await page.evaluate(`__FAKE.loop === false`));
  const dk = await rect(page, '#dock');
  ok('研究室はマップの上に重なる（マップは縮まない）', (await fullCheck(page)).full && dk.t < 60 && Math.round(dk.b) <= Math.round(nav.t) + 1, JSON.stringify(dk));
  ok('研究室は画像を使わず、SVGで描いた実験台と手順を表示する（研究室の画像は埋め込まない）', await page.evaluate(`!!document.querySelector('#stagebox svg#scene') && !document.getElementById('stagebox').style.backgroundImage.includes('url') && !Object.keys(ASSETS).some(k=>/^lab\\d/.test(k)) && Object.keys(ASSETS.labApp||{}).length>=10 && document.querySelectorAll('#labSteps li').length===5`));
  const iic = await page.evaluate(`(()=>{ const e=document.querySelector('#dock .shelf .mat .iic'); if(!e) return null; const cs=getComputedStyle(e), r=e.getBoundingClientRect(); return {bg:cs.backgroundImage.slice(0,12), w:r.width, h:r.height, n:Object.keys((ASSETS.items||{}).pos||{}).length, emo:document.querySelector('#dock .shelf .mat .i').textContent}; })()`);
  ok('研究室の材料棚は、物質アイコン（アトラスの画像）で表示される', iic && /url\("(blob|data):/.test(iic.bg) && iic.w >= 14 && iic.h >= 14 && iic.n === 137 && iic.emo === '', JSON.stringify(iic));
  const needBg = await page.evaluate(`(()=>{ const d=document.createElement('div'); d.className='need'; const p=ASSETS.items.pos.flint; d.innerHTML='<span class="ok"><span class="iic" style="--c:'+p[0]+';--r:'+p[1]+'"></span>火打ち石</span>'; document.getElementById('dockBody').appendChild(d); const cs=getComputedStyle(d.querySelector('.iic')); const r={bg:cs.backgroundImage.slice(0,10), pad:cs.paddingLeft, tool:!!ASSETS.items.pos.axe}; d.remove(); return r; })()`);
  ok('工作の材料欄（span の汎用スタイルの中）でもアイコンが消えない。道具は絵文字のまま', /url/.test(needBg.bg) && needBg.pad === '0px' && needBg.tool === false, JSON.stringify(needBg));
  ok('パネル表示中は、マップとHUDが操作できない（inert）', await page.evaluate(`document.getElementById('view').inert && document.getElementById('hud').inert`));
  ok('スクロールはメニューの中だけ', await page.evaluate(`getComputedStyle(document.getElementById('dockBody')).overflowY==='auto' && document.scrollingElement.scrollHeight<=innerHeight`));
  await page.click('#dock .dockx'); await page.waitForTimeout(700);
  ok('閉じた瞬間に勝手に歩き出さない（押しっぱなしのキーは解除）', same(p1, await pos(page)));
  await page.keyboard.up('ArrowLeft');
  ok('閉じると描画ループが再開する', await page.evaluate(`__FAKE.loop === true`));

  // メニュー（シート）と大きな項目
  await page.click('nav [data-tab="menu"]'); await page.waitForTimeout(150);
  const items = await page.evaluate(`[...document.querySelectorAll('#dockBody .bigitem')].map(b=>({t:b.querySelector('span:last-child').firstChild.textContent.trim(), h:b.getBoundingClientRect().height}))`);
  ok('「メニュー」に図鑑・技術・記録・建築・設定が文字付きの大きな項目で並ぶ', items.length === 5 && items.every(i => i.h >= 48) && items.map(i => i.t).join() === '図鑑,技術,記録,建築,設定', JSON.stringify(items));
  ok('メニューのシートを開いている間も、後ろのマップは描画を続ける（入力は止まる）', await page.evaluate(`__FAKE.loop === true && document.getElementById('view').inert`));
  await page.click('#dockBody .bigitem[data-tab="book"]'); await page.waitForTimeout(150);
  ok('メニューから図鑑に切り替わる（重ねずに1つだけ）', await page.evaluate(`${G}.U.tab==='book' && document.querySelectorAll('.dock:not([hidden])').length===1 && document.querySelector('nav [data-tab="menu"]').getAttribute('aria-current')==='page'`));
  // 図鑑の詳細モーダルはパネルの前面。Escape はモーダル → パネルの順
  await page.click('.dx[data-id="twig"]'); await page.waitForTimeout(100);
  const m1 = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), inert:document.getElementById('app').inert})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  const m2 = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), tab:${G}.U.tab, focus:document.activeElement.dataset.id})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok('図鑑の詳細はいちばん前に出て、Escapeはモーダル→パネルの順に閉じる', m1.open && m1.inert && !m2.open && m2.tab === 'book' && m2.focus === 'twig' && (await page.evaluate(`${G}.U.tab`)) === 'explore', JSON.stringify({ m1, m2 }));
  ok('閉じると、開いたボタン（メニュー）にフォーカスが戻る', await page.evaluate(`document.activeElement.dataset.tab==='menu'`));

  // 移動予約の解除
  await page.mouse.click(80, 600); await page.waitForTimeout(60);
  const hadTarget = await page.evaluate(`!!${G}.W3.target`);
  await page.click('nav [data-tab="craft"]'); await page.waitForTimeout(50);
  const p2 = await pos(page); await page.click('#dock .dockx'); await page.waitForTimeout(800);
  ok('マップのタップでできた移動予約は、メニューを開くと取り消される', hadTarget && same(p2, await pos(page)) && !(await page.evaluate(`${G}.W3.target`)));
  // 同じボタンをもう一度押すと閉じる
  await page.click('nav [data-tab="craft"]'); await page.click('nav [data-tab="craft"]'); await page.waitForTimeout(100);
  ok('開いているメニューのボタンをもう一度押すと閉じる', (await page.evaluate(`${G}.U.tab`)) === 'explore');

  // 目標（1行・押すと詳細・リンク）
  await page.evaluate(`(()=>{ const S=${G}.S, now=Date.now(); ['twig','flint','cobble'].forEach(k=>{ S.disc[k]=S.disc[k]||{first:now,made:1,total:1,routes:[],best:0}; }); ${G}.render(); })()`);
  const mh = await rect(page, '#missionBox');
  await page.click('#missionBox summary'); await page.waitForTimeout(100);
  const go = await page.$('#missionBox .go');
  if (go) await go.click(); await page.waitForTimeout(150);
  ok('目標は1行で、押すと詳細と「工作を開く」が出て、工作が開く', mh.h <= 52 && !!go && (await page.evaluate(`${G}.U.tab`)) === 'craft', JSON.stringify(mh));
  await page.click('#dock .dockx');

  // パネル開閉20回
  const before = await page.evaluate(`(()=>{ window.__C0=document.querySelector('#w3slot canvas'); return {inits:__FAKE.inits, canvases:document.querySelectorAll('canvas').length, labels:document.getElementById('w3labels').children.length, pos:{x:${G}.W3.pos.x,z:${G}.W3.pos.z}}; })()`);
  for (let i = 0; i < 20; i++) { await page.click(`nav [data-tab="${['lab', 'craft', 'menu'][i % 3]}"]`); await page.click('#dock .dockx'); }
  await page.waitForTimeout(400);
  const after = await page.evaluate(`({inits:__FAKE.inits, canvases:document.querySelectorAll('canvas').length, w3:document.querySelectorAll('#w3').length, labels:document.getElementById('w3labels').children.length, same:document.querySelector('#w3slot canvas')===window.__C0, loop:__FAKE.loop, raf:${G}.W3.raf>0, pos:{x:${G}.W3.pos.x,z:${G}.W3.pos.z}, starts:__FAKE.starts, stops:__FAKE.stops})`);
  ok('メニュー開閉20回でもキャンバス・初期化・名札が増えず、同じ場所・同じキャンバスに戻る',
    after.inits === 1 && after.canvases === before.canvases && after.w3 === 1 && after.labels === before.labels && after.same && after.loop && after.raf && same(before.pos, after.pos), JSON.stringify({ before, after }));
  ok('描画ループの開始と停止が対になっている', after.starts === after.stops || after.starts === after.stops + 1, JSON.stringify(after));

  // 「もう一度」
  await page.evaluate(`(()=>{ const S=${G}.S, E=${G}.E, now=Date.now(); S.inv.campfire=1; S.inv.notebook=1; ['campfire','notebook'].forEach(k=>{ S.disc[k]=S.disc[k]||{first:now,made:1,total:1,routes:[],best:0}; }); S.inv.twig=10; E.runExperiment(S,{twig:2},'campfire','burn',S.seq); })()`);
  const ash0 = await page.evaluate(`${G}.S.inv.ash||0`);
  await page.click('nav [data-tab="menu"]'); await page.click('#dockBody .bigitem[data-tab="log"]'); await page.waitForTimeout(100);
  await page.click('#dockBody [data-act="again"]'); await page.waitForTimeout(2600);
  ok('記録の「もう一度」で研究室が開き、実験が行われる', (await page.evaluate(`${G}.U.tab`)) === 'lab' && (await page.evaluate(`${G}.S.inv.ash||0`)) > ash0);
  await page.click('#dock .dockx');

  // 画面の回転
  await ptr(page, '#joy', 'pointerdown', 11); await ptr(page, '#joy', 'pointermove', 11, 30, 0); await page.waitForTimeout(60);
  const heldBefore = await page.evaluate(`!!${G}.W3.joy`);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(400);
  const rot = await page.evaluate(`({joy:!!${G}.W3.joy, keys:Object.keys(${G}.W3.keys).length})`);
  ok('画面を回転すると移動が止まる', heldBefore && !rot.joy && rot.keys === 0, JSON.stringify(rot));
  const fc2 = await fullCheck(page);
  ok('回転後（844×390）もマップは画面いっぱいでスクロールしない', fc2.full && fc2.noScroll && fc2.ui === 'touch', JSON.stringify(fc2));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);

  await page.evaluate(`(()=>{ const x=document.querySelector('.dockx'); if(x && x.offsetParent) x.click(); const W=${G}.W3; W.pos=${G}.WORLD.nearestFree(${G}.S,{x:42,z:-20},Date.now(),8); W.keys={}; W.joy=null; })()`); await page.waitForTimeout(300);
  const lockGo = await page.evaluate(`${G}.goTo3D(42,-34,null)`); await page.waitForTimeout(4500);
  ok('以前は鍵があった洞窟へも、新しいゲームのまま歩いて入れる（地域の鍵の廃止）', lockGo === true && await page.evaluate(`Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34) < 9`), await page.evaluate(`JSON.stringify({pos:${G}.W3.pos, tab:${G}.U.tab, modal:document.getElementById('modal').className, lockGo:${JSON.stringify(lockGo)}})`));
  await page.waitForTimeout(2200); await page.reload(); await page.waitForTimeout(600);
  const rl = await page.evaluate(`({pos:!!${G}.S.pos, hero:${G}.S.flags.hero, tab:${G}.U.tab, dock:document.getElementById('dock').hidden, at:${G}.W3.pos && Math.hypot(${G}.W3.pos.x-${G}.S.pos.x, ${G}.W3.pos.z-${G}.S.pos.z)})`);
  ok('再読込直後（ロード時の位置補正を含む）は歩かない', await page.evaluate(`(__FAKE.track||[]).every(r=>!r.m)`));
  ok('再読込後も探索から始まり、プレイヤー座標と主人公が復元される', rl.pos && rl.hero === 'girl' && rl.tab === 'explore' && rl.dock && rl.at < 0.05, JSON.stringify(rl));
  const keep = await page.evaluate(`({st:${G}.S.nature['${peb}'], left:${G}.WORLD.stock(${G}.S, ${G}.WORLD.byId.get('${peb}')).left})`);
  ok('再読込後も、拾った小石はなくなったまま（採取状態がセーブに残る）', keep.st && keep.left === 0, JSON.stringify(keep));
  ok('ページでエラーが起きていない（スマホ縦）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- スマホ（360×800）・横（844×390）の配置 ---------------- */
for (const vp of [{ width: 360, height: 800 }, { width: 844, height: 390 }]) {
  const { page, errors, ctx } = await newPage(vp, true);
  await page.click('#introGo'); await page.waitForTimeout(500);
  const fc = await fullCheck(page);
  const nav = await rect(page, '#nav'), joy = await rect(page, '#joy'), act = await rect(page, '#w3act'), tl = await rect(page, '.hud-tl'), trr = await rect(page, '.hud-tr');
  const inView = r => r.l >= 0 && r.t >= 0 && r.r <= vp.width && r.b <= vp.height;
  ok(`${vp.width}×${vp.height}：画面いっぱいのマップで、操作がすべて画面内にあり重ならない`, fc.full && fc.noScroll && fc.ui === 'touch' && [nav, joy, act, tl, trr].every(inView)
    && !overlap(joy, nav) && !overlap(act, nav) && !overlap(joy, act) && !overlap(tl, trr), JSON.stringify({ fc, nav, joy, act, tl, trr }));
  await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(200);
  const dk = await rect(page, '#dock');
  ok(`${vp.width}×${vp.height}：研究室パネルが画面内に収まる`, inView(dk) && dk.h > 200, JSON.stringify(dk));
  ok(`ページでエラーが起きていない（${vp.width}×${vp.height}）`, errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- PC（1366×768・マウスとキーボード） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.click('#introGo'); await page.waitForTimeout(600);
  const fc = await fullCheck(page);
  ok('PC：表示領域の端から端までマップで、ページがスクロールしない', fc.full && fc.noScroll && fc.ui === 'pc', JSON.stringify(fc));
  const navT = await page.evaluate(`[...document.querySelectorAll('#nav button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>b.textContent.trim()+(b.title?'*':''))`);
  ok('PCの下部中央ドックは 研究室／工作／図鑑／技術／記録／建築（ツールチップ付き）', navT.join() === '研究室*,工作*,図鑑*,技術*,記録*,建築*' && await page.evaluate(`[...document.querySelectorAll('#nav button')].filter(b=>getComputedStyle(b).display!=='none').every(b=>b.querySelector('img.ico'))`), JSON.stringify(navT));
  const dockR = await rect(page, '#nav');
  ok('ドックは画面下部の中央にある', Math.abs((dockR.l + dockR.r) / 2 - 683) < 4 && dockR.b <= 768 && dockR.b > 700, JSON.stringify(dockR));
  ok('PCでは仮想スティックを表示しない', !(await rect(page, '#joy')).shown);
  const tr = await page.evaluate(`[...document.querySelectorAll('.hud-tr button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>b.textContent.trim())`);
  ok('PCの右上は 地図・拠点・設定', tr.join() === '地図,拠点,設定' && await page.evaluate(`[...document.querySelectorAll('.hud-tr button')].filter(b=>getComputedStyle(b).display!=='none').every(b=>b.querySelector('img.ico'))`), JSON.stringify(tr));
  ok('採取対象が近くにないときは、採取の表示を出さない', !(await rect(page, '#w3act')).shown);
  await page.evaluate(`(()=>{ const n=${G}.NODES.find(n=>n.key==='forest:twig'); ${G}.W3.pos={x:n.pos.x+1, z:n.pos.z+1}; })()`); await page.waitForTimeout(400);
  const near = await page.evaluate(`({txt:document.getElementById('w3act').textContent, kbd:!!document.querySelector('#w3act .kbd')})`);
  ok('採取対象に近づくと、対象名と「E」キーの採取操作を表示する', (await rect(page, '#w3act')).shown && /採る/.test(near.txt) && near.kbd, JSON.stringify(near));
  const tw0 = await page.evaluate(`${G}.S.inv.twig||0`);
  await page.keyboard.press('e'); await page.waitForTimeout(800);
  ok('Eキーで採取できる', (await page.evaluate(`${G}.S.inv.twig||0`)) > tw0);
  await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(200);
  const lab = await page.evaluate(`(()=>{ const d=document.getElementById('dock').getBoundingClientRect(), g=getComputedStyle(document.querySelector('#dockBody .labgrid')).gridTemplateColumns.split(' ').length; return {loop:__FAKE.loop, w:d.width, left:d.left, cols:g, size:document.getElementById('dock').dataset.size}; })()`);
  ok('PCの研究室は右側の広いパネル（実験台と材料・操作を左右に並べ、左に探索のマップが見えたまま）', lab.size === 'side-l' && lab.cols === 2 && lab.w > 800 && lab.left > 300, JSON.stringify(lab));
  await page.click('nav [data-tab="craft"]'); await page.waitForTimeout(200);
  const cr = await page.evaluate(`(()=>{ const d=document.getElementById('dock').getBoundingClientRect(); return {loop:__FAKE.loop, w:d.width, left:d.left, size:document.getElementById('dock').dataset.size}; })()`);
  ok('PCの工作は右側のパネルで、後ろのマップは描画を続ける', cr.loop && cr.size === 'side' && cr.left > 683 && cr.w <= 600, JSON.stringify(cr));
  await page.click('nav [data-tab="map"]'); await page.waitForTimeout(200);
  const mp = await page.evaluate(`(()=>{ const d=document.getElementById('dock').getBoundingClientRect(); return {w:d.width, size:document.getElementById('dock').dataset.size, n:document.querySelectorAll('.dock:not([hidden])').length}; })()`);
  ok('技術マップは大きなオーバーレイに切り替わる（重ねない）', mp.size === 'wide' && mp.w > 1200 && mp.n === 1, JSON.stringify(mp));
  await page.click('nav [data-tab="log"]'); await page.waitForTimeout(200);
  const p0 = await pos(page);
  await page.click('#importBox'); await page.keyboard.type('wasd e');
  ok('入力欄で文字を打っても移動・採取しない', (await page.evaluate(`document.getElementById('importBox').value`)) === 'wasd e' && same(p0, await pos(page)));
  await page.evaluate(`document.getElementById('dockBody').focus()`);
  await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
  ok('PCでもメニュー表示中はキーで動かない', same(p0, await pos(page)));
  await page.mouse.click(200, 400); await page.waitForTimeout(300);
  ok('背景（マップ側）をクリックするとメニューが閉じ、そのクリックで歩き出さない', (await page.evaluate(`${G}.U.tab`)) === 'explore' && !(await page.evaluate(`${G}.W3.target`)) && same(p0, await pos(page)));
  await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
  ok('メニューを閉じるとWASDで移動できる', !same(p0, await pos(page)));
  await page.evaluate(`document.getElementById('toasts').innerHTML=''`);   // 新発見の通知（押すと図鑑が開く）が積み上がっていると、画面上部の中央を覆うことがあるので片付けてから
  await page.mouse.click(683, 300); await page.waitForTimeout(60);
  ok('マップのクリックで移動先（地面、または近くの自然物）が決まる', await page.evaluate(`!!(${G}.W3.target || ${G}.W3.sel)`));
  await page.click('.hud-tr [data-tab="settings"]'); await page.waitForTimeout(150);
  ok('設定にタイトル・説明・主人公・表示・遊び方がまとまっている', await page.evaluate(`(()=>{ const t=document.getElementById('dockBody').textContent; return /ゼロからの科学/.test(t) && /主人公/.test(t) && /遊び方/.test(t) && !!document.querySelector('#dockBody [data-act="view2d"]'); })()`));
  /* ---------- 歩行状態（描画へ渡す moving）：実際に進んだときだけ歩く ---------- */
  await page.click('#dock .dockx').catch(()=>{}); await page.evaluate(`(()=>{ ${G}.W3.pos={x:-20,z:20}; ${G}.W3.sel=null; })()`); await page.waitForTimeout(400);
  const since = () => page.evaluate(`window.__t0=performance.now()`);
  const track = () => page.evaluate(`__FAKE.track.filter(r=>r.t>=window.__t0)`);
  const keyToward = (vx, vz) => page.evaluate(`(()=>{ const T=HD2D.THREE, cam=${G}.W3.gfx.getCamera(), v=new T.Vector3(); cam.getWorldDirection(v); let fx=v.x,fz=v.z; const l=Math.hypot(fx,fz); fx/=l; fz/=l;
    const c={ArrowRight:{x:-fz,z:fx},ArrowLeft:{x:fz,z:-fx},ArrowUp:{x:fx,z:fz},ArrowDown:{x:-fx,z:-fz}}; let b=null,bd=-9; for(const k in c){ const d=c[k].x*${vx}+c[k].z*${vz}; if(d>bd){bd=d;b=k;} } return b; })()`);
  await since(); await page.waitForTimeout(400);
  ok('歩行：入力がないときは歩かない', (await track()).every(r => !r.m));
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(500);
  const walkOn = (await track()).slice(-5).every(r => r.m);
  const dir0 = await page.evaluate(`__FAKE.player.direction`);
  await page.keyboard.up('ArrowDown'); await since(); await page.waitForTimeout(300);
  const afterUp = await track();
  ok('歩行（キー）：押している間は歩き、離すとすぐ止まる・向きは保つ', walkOn && afterUp.slice(2).every(r => !r.m) && afterUp.slice(-1)[0].d === dir0, JSON.stringify({ walkOn, n: afterUp.length, first: afterUp.slice(0, 3) }));
  ok('左上の表示：止まっているときは「移動中」と出さない', !(await page.evaluate(`document.getElementById('hudLoc').textContent`)).includes('移動中'));
  await since(); await page.evaluate(`${G}.goTo3D(${G}.W3.pos.x+4, ${G}.W3.pos.z-3, null)`); await page.waitForTimeout(250);
  const midClick = (await track()).slice(-3).every(r => r.m);
  await page.waitForFunction(`!${G}.W3.path`, null, { timeout: 15000 }); await since(); await page.waitForTimeout(300);
  ok('歩行（クリック移動）：移動中は歩き、到着すると止まる', midClick && (await track()).every(r => !r.m) && !(await page.evaluate(`${G}.W3.target`)));
  // 角に押し付けて進めない：歩かない（キー・クリック移動の両方）。広い世界（2026-11-07）では北西の角（歩ける範囲の端）
  // 外の野（2026-11-10）：歩ける範囲は円（半径 walkR）。円の南西の端（斜め45°の所）を「角」として使う
  const WB = await page.evaluate(`({...${G}.WORLD.bounds, r:${G}.WORLD.walkR||0})`), CX = WB.r ? -(WB.r - 0.01) / Math.SQRT2 : WB.minX, CZ = WB.r ? -(WB.r - 0.01) / Math.SQRT2 : WB.minZ;
  await page.evaluate(`${G}.W3.pos={x:${CX},z:${CZ}}`); await page.waitForTimeout(200);
  const kc = await keyToward(-1, -1); await since(); await page.keyboard.down(kc); await page.waitForTimeout(700); await page.keyboard.up(kc);
  const corner = await track();
  ok('歩行：壁（世界の角）に向かって入力しても、進めなければ歩かない', corner.length > 10 && corner.every(r => !r.m) && corner.every(r => Math.hypot(r.x - CX, r.z - CZ) < 0.01), JSON.stringify(corner.filter(r => r.m).slice(0, 3)));
  await page.evaluate(`${G}.W3.pos={x:${CX + 1.5},z:${CZ + 1.5}}`); await page.waitForTimeout(200);
  await since(); await page.keyboard.down(kc); await page.waitForTimeout(900); await page.keyboard.up(kc);
  const hit = await track(); const atWall = hit.findIndex(r => Math.hypot(r.x - CX, r.z - CZ) < 0.01);
  const lastWalk = hit.reduce((a, r, i) => r.m ? i : a, -1);
  ok('歩行：歩いて壁に着いたら、押し続けていても0.15秒以内に止まる', atWall > 0 && hit[atWall - 1].m && lastWalk >= 0 && hit[lastWalk].t - hit[atWall].t <= 150 && hit.slice(-5).every(r => !r.m), JSON.stringify({ atWall, lastWalk, dt: lastWalk >= 0 && atWall >= 0 ? hit[lastWalk].t - hit[atWall].t : null }));
  await since(); await page.evaluate(`(()=>{ ${G}.W3.path=[{x:${CX - 3},z:${CZ - 3}}]; })()`); await page.waitForTimeout(700);
  ok('歩行（移動予約）：予約があっても進めなければ歩かない', (await track()).every(r => !r.m));
  await page.evaluate(`(()=>{ ${G}.W3.path=null; ${G}.W3.target=null; })()`);
  // 木の幹にかすめるように当たって外周を滑っているときは歩き続ける（キーの実際の向きの線上に幹を置く）
  const kv = await page.evaluate(`(()=>{ const T=HD2D.THREE, cam=${G}.W3.gfx.getCamera(), v=new T.Vector3(); cam.getWorldDirection(v); let fx=v.x,fz=v.z; const l=Math.hypot(fx,fz); return {x:-fz/l, z:fx/l}; })()`); // ArrowRight の向き
  const tz = await page.evaluate(`(()=>{ const W=${G}.WORLD, k=${JSON.stringify(kv)}, px=-k.z, pz=k.x;
    const ok=(x,z)=>W.free(${G}.S,x,z) && !W.objects.concat(W.statics).some(o=>W.solid(${G}.S,o) && o!==t0 && Math.hypot(o.x-x,o.z-z)<o.r+1.2);
    let t0=null; for(const t of W.objects.filter(o=>o.kind==='tree')){ t0=t; let good=true; for(let s=-3; s<=3; s+=0.25){ const x=t.x+k.x*s+px*0.25, z=t.z+k.z*s+pz*0.25; if(Math.abs(s)>t.r+0.5 && !ok(x,z)){ good=false; break; } } if(good) break; t0=null; }
    ${G}.W3.pos={x:t0.x-k.x*3+px*0.25, z:t0.z-k.z*3+pz*0.25}; return {x:t0.x, z:t0.z}; })()`);
  await page.waitForTimeout(150);
  await since(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1300);   // 2026-11-11：歩く速さを約65%にしたので長めに押す
  const tUp = await page.evaluate(`performance.now()`); await page.keyboard.up('ArrowRight');
  const slide = (await track()).filter(r => r.t < tUp - 20);
  const moving = slide.filter((r, i) => i > 0 && Math.hypot(r.x - slide[i - 1].x, r.z - slide[i - 1].z) > 0.02);
  const proj = r => (r.x - tz.x) * kv.x + (r.z - tz.z) * kv.z;
  const touched = slide.some(r => Math.abs(proj(r)) < 0.4);
  ok('歩行：木の幹に沿って滑って実際に進んでいるときは歩き続ける', touched && moving.length > 10 && moving.every(r => r.m) && proj(slide.slice(-1)[0]) > 0.5,
    JSON.stringify({ tz, last: proj(slide.slice(-1)[0]).toFixed(2), frames: slide.map(r => (r.m ? 'W' : '.') + proj(r).toFixed(2)).join(' ') }));
  // メニューを閉じた後・ワープ・ロード時の補正で歩かない
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(250); await page.click('nav [data-tab="craft"]'); await page.waitForTimeout(150);
  await since(); await page.click('#dock .dockx'); await page.keyboard.up('ArrowLeft'); await page.waitForTimeout(400);
  ok('歩行：メニューを閉じた後に勝手に歩かない', (await track()).every(r => !r.m));
  await since(); await page.evaluate(`${G}.W3.pos={x:-20,z:20}`); await page.waitForTimeout(400);
  ok('歩行：ワープ（位置の書き換え）では歩かない', (await track()).every(r => !r.m));
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(400); const resumed = (await track()).slice(-4).every(r => r.m); await page.keyboard.up('ArrowRight');
  ok('歩行：移動を再開すると自然に歩行へ戻る', resumed);
  ok('既定ではゲーム側からカメラ設定を渡さない（描画モジュールの既定値を使う）', await page.evaluate(`__FAKE.opts && (!__FAKE.opts.config || __FAKE.opts.config.camera === undefined)`));
  ok('地形の高さの公開口 config.world.heightAt にゲームの地形（worldHeight）を渡す', await page.evaluate(`(()=>{ const h=__FAKE.opts.config && __FAKE.opts.config.world && __FAKE.opts.config.world.heightAt; if(typeof h!=='function') return false;
    return [[0,0],[-20,20],[100,-132],[120.5,-97],[-128,118],[150,40]].every(([x,z])=>Math.abs(h(x,z)-TERRAIN.terrainHeight(x,z,TERRAIN.DEFAULT_CONFIG))<1e-9); })()`));
  ok('ページでエラーが起きていない（PC）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 既存セーブ（旧版で段階に応じて建物が自動で出ていたセーブ） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.click('#introGo'); await page.waitForTimeout(600);
  // 第3段階相当（たき火・かまど・作業台・簡易炉・土器・ガラス）で、倉庫・蒸留器は持っていないセーブ。旧版では小屋・研究所・石の家が自動で出ていた。
  // 位置は、旧「石積みの壁」の跡に新しく置いた岩の中心（ロード時に近くの空いた所へ補正されるはず）
  const prep = await page.evaluate(`(()=>{ const G=${G}, S=G.S, E=G.E; const rock=G.WORLD.objects.find(o=>o.kind==='rock' && Math.hypot(o.x-10.2,o.z-15.1)<4);
    ['bench','campfire','kiln','furnace','pot','glass','twig'].forEach((id,i)=>{ S.inv[id]=(id==='twig'?7:id==='glass'?3:1); if(!S.disc[id]) S.disc[id]={first:Date.now(),made:1,total:1,routes:[],best:0}; });
    S.pos={x:rock.x, z:rock.z}; localStorage.setItem('zero-kagaku-save', E.serialize(S)); return {rock:{id:rock.id,x:rock.x,z:rock.z,r:rock.r}, st:E.stageOf(S)}; })()`);
  await page.reload(); await page.waitForTimeout(900);
  const after = await page.evaluate(`(()=>{ const G=${G}, S=G.S, p=G.W3.pos; return {structs:Object.keys(__FAKE.structures).filter(k=>!/^v[hp]:/.test(k)).sort(), left:(__FAKE.opts.decor.stonework===false?[]:['Stonework']), st:G.E.stageOf(S),
    inv:{twig:S.inv.twig, glass:S.inv.glass, bench:S.inv.bench}, d:Math.hypot(p.x-(${prep.rock.x}), p.z-(${prep.rock.z}))}; })()`);
  ok('既存セーブ：段階だけで自動に出ていた小屋・研究所・石の家は出ず、作った設備（作業台・たき火・かまど・簡易炉）は残る',
    prep.st === 3 && after.structs.join() === 'st-bench,st-fire,st-kiln,st-smelter', JSON.stringify({ prep, after }));
  ok('既存セーブ：再読込しても石の階段・石積みの壁は出ない', after.left.length === 0, JSON.stringify(after.left));
  ok('既存セーブ：所持品・段階は初期化されない', after.st === 3 && after.inv.twig === 7 && after.inv.glass === 3 && after.inv.bench === 1, JSON.stringify(after.inv));
  ok('既存セーブ：新しく置いた岩の上にいたプレイヤーは、岩の外へ補正される', after.d >= prep.rock.r + 0.3, JSON.stringify({ d: after.d, r: prep.rock.r }));
  await page.evaluate(`(()=>{ const S=${G}.S; S.inv.storehouse=1; S.disc.storehouse=S.disc.storehouse||{first:Date.now(),made:1,total:1,routes:[],best:0}; ${G}.render(); })()`); await page.waitForTimeout(300);
  ok('倉庫を作ると、拠点に小屋が建つ（作った設備に1対1で対応）', await page.evaluate(`!!__FAKE.structures['st-hut1'] && __FAKE.structures['st-hut1'].type==='hut'`));
  ok('ページでエラーが起きていない（既存セーブ）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 文字選択・長押しメニュー・指の離脱（スマホ縦） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 390, height: 844 }, true);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const us = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return { us: c.userSelect || c.webkitUserSelect, co: c.webkitTouchCallout || '' }; }, sel);
  const modalUs = await us('#sheet');
  await page.click('#introGo'); await page.waitForTimeout(600);
  const sels = ['#mission', '#hudLoc', '#w3act', '#joy', '#nav button', '.hud-tr button', '#view'];
  const st = {}; for (const q of sels) st[q] = await us(q);
  ok('ゲームの表示（目標文・現在地・行動ボタン・スティック・下部タブ・右上ボタン・マップ・案内）は文字選択も長押しメニューも出ない',
    [modalUs, ...Object.values(st)].every(v => v && v.us === 'none' && (v.co === '' || v.co === 'none')), JSON.stringify({ modalUs, st }));
  const guard = await page.evaluate(`(()=>{ const fire=(el,t)=>{ const e=new Event(t,{bubbles:true,cancelable:true}); el.dispatchEvent(e); return e.defaultPrevented; };
    const img=document.querySelector('img'); return {sel:fire(document.getElementById('mission'),'selectstart'), menu:fire(document.getElementById('w3act'),'contextmenu'),
      drag: img ? fire(img,'dragstart') : null, imgUs: img ? getComputedStyle(img).webkitUserDrag : null}; })()`);
  ok('選択の開始・長押しメニュー・画像のドラッグは、ゲームの表示の上では起きない', guard.sel && guard.menu && guard.drag === true, JSON.stringify(guard));
  // ゲームの表示に残った選択範囲は、次に操作を始めたときに消える
  const cleared = await page.evaluate(`(()=>{ const r=document.createRange(); r.selectNodeContents(document.getElementById('mission')); const s=getSelection(); s.removeAllRanges(); s.addRange(r);
    const before=!s.isCollapsed; const v=document.getElementById('view'); v.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:90,pointerType:'touch',clientX:200,clientY:300}));
    v.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:90,pointerType:'touch',clientX:200,clientY:300})); return {before, after:!getSelection().isCollapsed}; })()`);
  ok('ゲームの表示に残った選択範囲は、次の操作の開始で消える', cleared.before && !cleared.after, JSON.stringify(cleared));

  // 本物のタッチ（CDP）：スティックを押してから、指をスティックの外へ大きく動かし、外で離す
  const jr = await rect(page, '#joy'), jx = jr.l + jr.w / 2, jy = jr.t + jr.h / 2;
  await touch('touchStart', [{ x: jx, y: jy, id: 1 }]);
  for (let i = 1; i <= 15; i++) { await touch('touchMove', [{ x: jx + i * 8, y: jy - i * 14, id: 1 }]); await page.waitForTimeout(100); }
  const mid = await page.evaluate(`({joy:!!${G}.W3.joy, sel:String(getSelection()).length})`);
  await touch('touchEnd', []); await page.waitForTimeout(200);
  const endOut = await page.evaluate(`({joy:!!${G}.W3.joy, knob:document.querySelector('#joy .knob').style.transform, sel:String(getSelection()).length, moving:${G}.W3.moving})`);
  ok('タッチ：スティックを押したまま外へ指を動かしても動き続け、外で離すと止まってつまみが中央に戻る（文字選択なし）',
    mid.joy && mid.sel === 0 && !endOut.joy && endOut.knob === '' && endOut.sel === 0, JSON.stringify({ mid, endOut }));
  // 2本指：左でスティック、右で行動ボタン。右の指をボタンの外で離しても、左の移動は続く
  const ar = await rect(page, '#w3act');
  await touch('touchStart', [{ x: jx, y: jy, id: 1 }]); await touch('touchMove', [{ x: jx, y: jy - 40, id: 1 }]);
  await touch('touchStart', [{ x: jx, y: jy - 40, id: 1 }, { x: ar.l + ar.w / 2, y: ar.t + ar.h / 2, id: 2 }]);
  await touch('touchMove', [{ x: jx, y: jy - 40, id: 1 }, { x: ar.l - 60, y: ar.t - 80, id: 2 }]);
  await touch('touchEnd', [{ x: ar.l - 60, y: ar.t - 80, id: 2 }]); await page.waitForTimeout(150);   // CDP の touchEnd は「離す指」を渡す
  const two = await page.evaluate(`!!${G}.W3.joy`);
  await touch('touchEnd', []); await page.waitForTimeout(150);
  ok('タッチ：右の指を離しても左の指の移動は続き、左を離すと止まる', two && !(await page.evaluate(`!!${G}.W3.joy`)));
  // アプリ切り替え（blur・pagehide）で止まり、次の操作で戻る
  await touch('touchStart', [{ x: jx, y: jy, id: 1 }]); await touch('touchMove', [{ x: jx + 40, y: jy, id: 1 }]); await page.waitForTimeout(100);
  const on1 = await page.evaluate(`!!${G}.W3.joy`);
  await page.evaluate(`dispatchEvent(new Event('blur'))`); await page.waitForTimeout(100);
  const off1 = await page.evaluate(`({joy:!!${G}.W3.joy, knob:document.querySelector('#joy .knob').style.transform})`);
  await touch('touchEnd', []); await page.waitForTimeout(100);
  await touch('touchStart', [{ x: jx, y: jy, id: 3 }]); await touch('touchMove', [{ x: jx, y: jy + 40, id: 3 }]); await page.waitForTimeout(100);
  const on2 = await page.evaluate(`!!${G}.W3.joy`);
  await page.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide'))`); await page.waitForTimeout(100);
  const off2 = await page.evaluate(`!!${G}.W3.joy`);
  await touch('touchEnd', []); await page.waitForTimeout(100);
  ok('アプリ切り替え（blur・pagehide）で移動が止まり、次のタッチでまた動かせる', on1 && !off1.joy && off1.knob === '' && on2 && !off2, JSON.stringify({ on1, off1, on2, off2 }));

  // メニュー → 図鑑：タッチでスクロールできる
  await page.click('#nav [data-tab="menu"]'); await page.waitForTimeout(300);
  await page.click('#dockBody [data-tab="book"]'); await page.waitForTimeout(500);
  const scrollEl = await page.evaluate(`(()=>{ const c=[...document.querySelectorAll('#dockBody,.sheet,#dock *')].find(e=>e.scrollHeight>e.clientHeight+20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)); if(!c) return null; c.id=c.id||'__scr'; const r=c.getBoundingClientRect(); return {id:c.id, x:r.left+r.width/2, y:r.top+r.height*0.7, top:c.scrollTop}; })()`);
  if (scrollEl) { await touch('touchStart', [{ x: scrollEl.x, y: scrollEl.y, id: 5 }]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: scrollEl.x, y: scrollEl.y - i * 25, id: 5 }]);
    await touch('touchEnd', [{ x: scrollEl.x, y: scrollEl.y - 250, id: 5 }]); }
  await page.waitForTimeout(300);
  const top2 = scrollEl ? await page.evaluate(`document.getElementById('${scrollEl.id}').scrollTop`) : -1;
  ok('図鑑はタッチの縦スクロールができる（ボタンの上から始めても）', scrollEl && top2 > scrollEl.top + 50, JSON.stringify({ scrollEl, top2 }));
  // 記録の入力欄：文字の入力・選択（入力欄は例外）
  await page.click('#dock .dockx'); await page.waitForTimeout(300);
  await page.click('#nav [data-tab="menu"]'); await page.waitForTimeout(300);
  await page.click('#dockBody [data-tab="log"]'); await page.waitForTimeout(400);   // セーブの書き出し・読み込み欄は「記録」にある
  await page.click('#importBox'); await page.keyboard.type('abc123'); await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowLeft');
  await page.keyboard.insertText('X');
  const ta = await page.evaluate(`(()=>{ const t=document.getElementById('importBox'); const c=getComputedStyle(t); const e=new Event('selectstart',{bubbles:true,cancelable:true}); t.dispatchEvent(e);
    t.setSelectionRange(0,3); const v=t.value, ss=t.selectionStart, se=t.selectionEnd; const ex=document.getElementById('exportBox');
    return {v, ss, se, us:c.userSelect||c.webkitUserSelect, blocked:e.defaultPrevented, exUs: ex ? (getComputedStyle(ex).userSelect||getComputedStyle(ex).webkitUserSelect) : null}; })()`);
  ok('既存の入力欄（読み込み欄・書き出し欄）は文字の入力・削除・カーソル移動・選択ができる', ta.v === 'abc1X2' && ta.ss === 0 && ta.se === 3 && ta.us === 'text' && !ta.blocked && ta.exUs === 'text', JSON.stringify(ta));
  ok('ページでエラーが起きていない（文字選択の確認）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 地域の外（マップ全体）の自然物を採る ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.click('#introGo'); await page.waitForTimeout(700);
  // どの地域の中心からも離れた草むら（第2層）を選び、そばへ移ってから採る
  const tgt = await page.evaluate(`(()=>{ const G=${G}, R=G.D.regions.filter(r=>r.w);
    const o=G.WORLD.objects.find(o=>o.kind==='grass' && R.every(r=>Math.hypot(o.x-r.w.x,o.z-r.w.z)>14) && Math.hypot(o.x-G.D.base.x,o.z-G.D.base.z)>16 && G.E.regionOpen(G.S, R[0]));
    const q=G.WORLD.safeSpawn(G.S,{x:o.x+1.2,z:o.z}); G.W3.pos={x:q.x,z:q.z}; return {id:o.id, x:o.x, z:o.z}; })()`);
  await page.waitForTimeout(500);
  const g0 = await page.evaluate(`${G}.S.inv.grass||0`);
  await page.evaluate(`(()=>{ const G=${G}; G.selectAndGo({o:G.WORLD.byId.get('${tgt.id}')}); })()`); await page.waitForTimeout(1500);
  await page.evaluate(`${G}.pressAction()`); await page.waitForTimeout(1300);
  const g1 = await page.evaluate(`({grass:${G}.S.inv.grass||0, st:${G}.S.nature['${tgt.id}'], vis:__FAKE.resources['${tgt.id}'] && __FAKE.resources['${tgt.id}'].natural.state})`);
  ok('地域の外（マップのどこか）の草むらも、選んで近づいて刈れる。刈り跡になる', g1.grass > g0 && g1.st && g1.vis === 'cut', JSON.stringify({ tgt, g0, g1 }));
  await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(800);
  ok('再読み込みしても、刈った草むらは刈り跡のまま（同じIDの状態がセーブに残る）', await page.evaluate(`(()=>{ const G=${G}, o=G.WORLD.byId.get('${tgt.id}'); return !!o && G.WORLD.visual(G.S,o).state==='cut'; })()`));
  ok('ページでエラーが起きていない（地域の外の採取）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- カメラ（ドラッグで回転・上下、ホイール／ピンチで距離。2026-11-08） ---------------- */
const camState = page => page.evaluate(`(()=>{ const c=${G}.W3.cam; return c ? {yaw:c.yaw, pitch:c.pitch, zoom:c.zoom, cy:c.cy, cp:c.cp, cz:c.cz, sent:${G}.W3.camSent, ptrs:${G}.W3.ptrs?${G}.W3.ptrs.size:-1, pinch:!!${G}.W3.pinch, target:!!${G}.W3.target, saved:${G}.S.camera} : null; })()`);
const settle = page => page.waitForTimeout(450);
/* マップの何もない所（名札・ボタンの上ではない点）を (x,y) の近くで探す */
const empty = (page, x, y) => page.evaluate(([x, y]) => { for (let r = 0; r < 200; r += 12) for (let a = 0; a < 6.28; a += 0.5) { const px = Math.round(x + r * Math.cos(a)), py = Math.round(y + r * Math.sin(a)); const e = document.elementFromPoint(px, py); if (e && e.tagName === 'CANVAS') return { x: px, y: py }; } return { x, y }; }, [x, y]);
const mdrag = async (page, x0, y0, dx, dy, opts = {}) => { const p = await empty(page, x0, y0); await page.mouse.move(p.x, p.y); await page.mouse.down(opts); await page.mouse.move(p.x + dx, p.y + dy, { steps: opts.steps || 8 }); await page.mouse.up(opts); };
/* 画面上で「主人公の手前（カメラ側）5マスの地面」がどこに見えるか（回転の向きの確認用） */
const frontPoint = page => page.evaluate(`(()=>{ const G=${G}, c=G.W3.cam, y=c.cy*Math.PI/180; return {x:G.W3.pos.x+Math.sin(y)*5+Math.cos(y)*0.01, z:G.W3.pos.z+Math.cos(y)*5}; })()`);
const screenOf = (page, q) => page.evaluate(([q]) => { const G = window.__GAME__; return G.toScreen(q.x, HD2D.terrainHeight(q.x, q.z, G.W3.cfg), q.z); }, [q]);
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.click('#introGo'); await page.waitForTimeout(700);
  await page.evaluate(`(()=>{ ${G}.W3.pos={x:-12,z:24}; })()`); await page.waitForTimeout(300);
  const ui = await page.evaluate(`({hidden:document.getElementById('camctl').hidden, btns:[...document.querySelectorAll('#camctl button')].map(b=>b.dataset.id), shown:[...document.querySelectorAll('#camctl button')].filter(b=>!b.hidden).map(b=>b.dataset.id), slider:!!document.getElementById('camZoom')})`);
  ok('カメラの操作ボタン（上下左右・近づく・離れる・距離）は撤去し、「視点を戻す」だけを小さく残す（「主人公に合わせる」は主人公が中央から大きく外れたときだけ出る）', !ui.hidden && ui.shown.length === 1 && ui.shown[0] === 'reset' && ui.btns.every(b => b === 'reset' || b === 'recenter') && !ui.slider, JSON.stringify(ui));
  ok('初回だけ「ドラッグで視点変更／ホイールでズーム」の案内を出す（出したことを保存）', await page.evaluate(`${G}.S.flags.camHint===1`));
  const c0 = await camState(page), fp = await frontPoint(page), f0 = await screenOf(page, fp);
  // 左ボタンで右へドラッグ：回転（移動先は決まらない）。景色を引っ張る向き＝主人公の手前の地面が右へ動く
  await mdrag(page, 700, 420, 120, 0); await settle(page);
  const c1 = await camState(page), f1 = await screenOf(page, fp);
  ok('PC：左ボタンのドラッグで回る（クリック移動にならない）', Math.abs(c1.cy - c0.cy) > 10 && !c1.target && c1.ptrs === 0, JSON.stringify({ c0, c1 }));
  ok('右へドラッグすると、景色が指（マウス）に付いて右へ回る（主人公の手前の地面が右へ動く）', f1.x > f0.x + 20, JSON.stringify({ f0, f1 }));
  ok('ドラッグを離したら回り続けない（慣性なし。希望の角度に追いついて止まる）', Math.abs(c1.cy - c1.yaw) < 0.05 && c1.sent && Math.abs(c1.sent.y - ((c1.yaw % 360) + 360) % 360) < 0.05);
  // 7px は動いてもタップ（クリック移動）。8px 以上はドラッグ
  await page.evaluate(`document.getElementById('toasts').innerHTML=''`);
  const goal = await page.evaluate(`(()=>{ const G=${G}; let g=null; for(const [ox,oz] of [[3,-2],[-3,2],[3,2],[-3,-2],[4,0],[0,4],[-4,0],[0,-4]]){ const c={x:G.W3.pos.x+ox, z:G.W3.pos.z+oz}; if(G.WORLD.free(G.S,c.x,c.z) && !G.WORLD.around(c.x,c.z,1.6).length){ const s=G.toScreen(c.x, HD2D.terrainHeight(c.x,c.z,G.W3.cfg), c.z), r=document.getElementById('w3').getBoundingClientRect(), e=document.elementFromPoint(r.left+s.x, r.top+s.y); if(e && e.tagName==='CANVAS'){ g={c, sx:r.left+s.x, sy:r.top+s.y}; break; } } } return g; })()`);
  await page.mouse.move(goal.sx, goal.sy); await page.mouse.down(); await page.mouse.move(goal.sx + 6, goal.sy + 2); await page.mouse.up(); await page.waitForTimeout(120);
  const tapped = await camState(page);
  const tgt = await page.evaluate(`${G}.W3.target`);
  ok('PC：短いクリック（判定距離8px未満の小さなぶれ）は今までどおり移動先になる（回したあとでもクリックした地面の座標）', tapped.target && tgt && Math.hypot(tgt.x - goal.c.x, tgt.z - goal.c.z) < 0.9, JSON.stringify({ tgt, goal }));
  await page.evaluate(`${G}.W3.target=null; ${G}.W3.path=null;`);
  // 右ボタンのドラッグも回転
  const c2 = await camState(page);
  await mdrag(page, 700, 420, -60, 0, { button: 'right', steps: 6 }); await settle(page);
  const c3 = await camState(page);
  ok('PC：右ボタンのドラッグでも回り、移動・採取は起きない', c3.cy - c2.cy > 10 && !c3.target, JSON.stringify({ c2, c3 }));
  // 何周しても連続：大きく右へ4周ぶんドラッグし、モジュールへ渡した角度が毎回同じ向きに少しずつ変わる（359→0 で逆回りしない）
  const n0 = await page.evaluate(`(__FAKE.camCalls||[]).length`);
  for (let i = 0; i < 12; i++) { await mdrag(page, 300, 420, 800, 0, { steps: 10 }); await page.waitForTimeout(60); }
  await settle(page);
  const seq = await page.evaluate(`(__FAKE.camCalls||[]).slice(${n0}).map(c=>c.v.yawDegrees).filter(v=>v!=null)`);
  const steps = seq.slice(1).map((v, i) => ((v - seq[i] + 540) % 360) - 180);
  const c4 = await camState(page);
  ok('左右に何周も回せて、どの1歩も同じ向き・大回りしない（0°/360°を何度もまたぐ）', steps.length > 20 && steps.every(s => s <= 0.001 && s > -60) && (c2.cy - c4.cy) > 720, JSON.stringify({ n: steps.length, min: Math.min(...steps), max: Math.max(...steps), turns: (c2.cy - c4.cy) / 360 }));
  // 上下：下へ大きくドラッグ → 70°で止まる。上へ → 下限で止まる。限界で行き過ぎない
  await mdrag(page, 700, 200, 0, 560, { steps: 12 }); await settle(page);
  const top = await camState(page);
  await mdrag(page, 700, 740, 0, -730, { steps: 16 }); await settle(page);
  const low = await camState(page);
  const lim = await page.evaluate(`[${G}.W3.camPitchMin||0, 70]`);
  ok('下へドラッグで上から見る（見下ろし角は70°で止まる）。上へドラッグで水平に近づく（下限で止まる）。行き過ぎ・跳ね返りなし', Math.abs(top.pitch - 70) < 1e-6 && Math.abs(top.cp - 70) < 0.05 && Math.abs(low.pitch - lim[0]) < 1e-6 && low.cp >= lim[0] - 1e-6, JSON.stringify({ top, low, lim }));
  // ホイールでズーム（近づく・離れる）。範囲で止まる
  const z0 = (await camState(page)).zoom; await page.mouse.move(700, 400); await page.mouse.wheel(0, -300); await page.waitForTimeout(500);
  const z1 = await camState(page);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400); await page.waitForTimeout(500);
  const z2 = await camState(page), zl = await page.evaluate(`(()=>{ const z=${G}.W3.cfg.camera.viewSize; return [z*0.55, z*1.9]; })()`);
  ok('ホイールで近づく・離れる（最大距離で止まる）。設定に保存される', z1.zoom < z0 && Math.abs(z2.zoom - +zl[1].toFixed(2)) < 0.02 && Math.abs(z2.saved.zoom - z2.zoom) < 0.01, JSON.stringify({ z0, z1: z1.zoom, z2: z2.zoom, zl }));
  // 主人公の向き：回したあとも ↑キーで画面の奥へ進み、絵は背中（行2）。カメラを回しても主人公のワールドの向きは変わらない
  await page.evaluate(`(()=>{ const c=${G}.W3.cam; c.pitch=40; c.yaw=c.cy+90; })()`); await settle(page);
  const p0 = await pos(page);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(600); await page.keyboard.up('ArrowUp'); await page.waitForTimeout(200);
  const mv = await page.evaluate(`(()=>{ const G=${G}, T=HD2D.THREE, v=new T.Vector3(); G.W3.gfx.getCamera().getWorldDirection(v); const l=Math.hypot(v.x,v.z); return {fx:v.x/l, fz:v.z/l, sec:G.W3.faceSec, dir:G.W3.dir, face:G.W3.face, x:G.W3.pos.x, z:G.W3.pos.z}; })()`);
  const dx = mv.x - p0.x, dz = mv.z - p0.z, dl = Math.hypot(dx, dz);
  ok('カメラを回したあとも、↑キーで画面の奥へ進み、主人公は背中の絵（行：up）になる', dl > 0.5 && (dx * mv.fx + dz * mv.fz) / dl > 0.9 && mv.sec === 2 && mv.dir === 'up', JSON.stringify({ dx, dz, mv }));
  /* 描画モジュールが選ぶ行（CharacterRenderer.rowForDirection と同じ計算）を、渡した向きと今のカメラから求める */
  const rowSeen = () => page.evaluate(`(()=>{ const A={down:0,right:Math.PI/2,up:Math.PI,left:-Math.PI/2}, T=HD2D.THREE, v=new T.Vector3(); ${G}.W3.gfx.getCamera().getWorldDirection(v);
    const sd=Math.atan2(-v.x,-v.z); let rel=(A[__FAKE.player.direction]-sd)%(Math.PI*2); if(rel<0) rel+=Math.PI*2; return Math.round(rel/(Math.PI/2))%4; })()`);
  ok('描画モジュールが選ぶ絵の行も背中（セクター2）', (await rowSeen()) === 2);
  // 静止したままカメラを180°回す：ワールドの向きは変わらず、カメラから見える絵が正面に変わる
  await page.evaluate(`(()=>{ const c=${G}.W3.cam; c.yaw=c.cy+180; })()`); await page.waitForTimeout(700);
  const st = await page.evaluate(`({face:${G}.W3.face, sec:${G}.W3.faceSec, moving:__FAKE.player.moving})`);
  ok('静止中にカメラを180°回すと、主人公のワールドの向きは変わらず、絵は正面（セクター0）に切り替わる', Math.abs(st.face - mv.face) < 1e-9 && st.sec === 0 && (await rowSeen()) === 0 && !st.moving, JSON.stringify({ st, face0: mv.face }));
  // 境界での行き来：相対角が境界（45°）の±5°で揺れても、絵の行は変わらない
  const hy = await page.evaluate(`(()=>{ const G=${G}, c=G.W3.cam, base=c.cy, out=[]; G.W3.faceSec=null;
    const sd=()=>{ const T=HD2D.THREE, v=new T.Vector3(); G.W3.gfx.getCamera().getWorldDirection(v); return Math.atan2(-v.x,-v.z); };
    G.W3.face = sd() + 40*Math.PI/180; G.W3.gfx.setCameraOrbit({yawDegrees:((base%360)+360)%360}); out.push(G.cam.faceSector());
    for(const d of [50,40,52,44,53,41]){ G.W3.face = sd() + d*Math.PI/180; out.push(G.cam.faceSector()); }
    G.W3.face = sd() + 58*Math.PI/180; out.push(G.cam.faceSector()); return out; })()`).catch(e => String(e));
  ok('方向の境界（45°）の前後で絵が細かく入れ替わらない（±10°のヒステリシス。境界を十分越えたら切り替わる）', Array.isArray(hy) && hy.slice(0, 7).every(v => v === 0) && hy[7] === 1, JSON.stringify(hy));
  // 視点を戻す：なめらかに標準へ（途中の値がある）。感度は残る
  await page.evaluate(`${G}.S.camera.sx=1.7; ${G}.save();`);
  await page.click('#camctl [data-id="reset"]'); await page.waitForTimeout(120);
  const r1 = await camState(page); await page.waitForTimeout(1500); const r2 = await camState(page);
  const d = await page.evaluate(`({yaw:${G}.W3.cfg.camera.yawDegrees, pitch:${G}.W3.cfg.camera.pitchDegrees, zoom:${G}.W3.cfg.camera.viewSize})`);
  const ang = v => ((v % 360) + 360) % 360;
  ok('「視点を戻す」で標準の角度と距離へなめらかに戻る（途中を通り、短い向きに回る）。感度の設定は残る', Math.abs(r1.cp - d.pitch) > 0.5 && Math.abs(ang(r2.cy) - d.yaw) < 0.05 && Math.abs(r2.cp - d.pitch) < 0.05 && Math.abs(r2.cz - d.zoom) < 0.01 && Math.abs(r2.yaw - r1.cy) <= 180.01 && r2.saved.sx === 1.7 && r2.saved.yaw === undefined, JSON.stringify({ r1, r2, d }));
  // 保存と復元
  await mdrag(page, 700, 420, 60, 50, { steps: 6 }); await page.waitForTimeout(600);
  const before = await camState(page); await page.reload(); await page.waitForTimeout(900);
  const after = await camState(page);
  ok('視点（角度・見下ろし角・距離）と感度は保存され、再読み込みで同じになる', Math.abs(ang(after.cy) - before.saved.yaw) < 0.01 && Math.abs(after.cp - before.saved.pitch) < 0.01 && Math.abs(after.cz - before.saved.zoom) < 0.01 && after.saved.sx === 1.7, JSON.stringify({ saved: before.saved, after }));
  // 不正な保存値は安全な範囲へ
  await page.evaluate(`(()=>{ ${G}.S.camera={yaw:"abc", pitch:999, zoom:-5, sx:99, sy:null}; ${G}.save(); })()`);
  await page.reload(); await page.waitForTimeout(900);
  const bad = await camState(page), u = await page.evaluate(`${G}.cam.user()`).catch(() => null);
  ok('壊れた保存値（文字・範囲外・負の距離・極端な感度）は安全な範囲に補正される', bad && Math.abs(ang(bad.cy) - d.yaw) < 0.01 && bad.cp === 70 && Math.abs(bad.cz - +(d.zoom * 0.55).toFixed(2)) < 0.01 && (!u || (u.sx === 2.5 && u.sy === 1)), JSON.stringify({ bad, u }));
  // 設定画面の感度
  await page.click('[data-tab="settings"]'); await page.waitForTimeout(250);
  const sens = await page.evaluate(`(()=>{ const a=document.getElementById('camSens-sx'), b=document.getElementById('camSens-sy'); if(!a||!b) return null; a.value='0.6'; a.dispatchEvent(new Event('input',{bubbles:true})); a.dispatchEvent(new Event('change',{bubbles:true})); return {sx:${G}.S.camera.sx, out:document.getElementById('camSensOut-sx').textContent, min:a.min, max:a.max}; })()`);
  ok('設定画面に横・縦の感度があり、変えると保存される', sens && sens.sx === 0.6 && sens.out === '0.6' && sens.min === '0.3' && sens.max === '2.5', JSON.stringify(sens));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // パネル表示中はマップをドラッグしても回らない
  await page.click('[data-tab="lab"]'); await page.waitForTimeout(250);
  const l0 = await camState(page); await page.mouse.move(300, 420); await page.mouse.down(); await page.mouse.move(500, 420, { steps: 6 }); await page.mouse.up(); await settle(page);
  const l1 = await camState(page);
  ok('研究室などのパネルを開いている間は、ドラッグしてもカメラは動かない', Math.abs(l1.cy - l0.cy) < 1e-6 && l1.ptrs === 0, JSON.stringify({ l0: l0.cy, l1: l1.cy }));
  // 建物の陰（2026-11-08 改訂）：主人公とカメラの間に小屋を置いて低い角度にしても、見下ろし角を勝手に上げない（希望の角度のまま渡す）
  const bh = await page.evaluate(`(async()=>{ const G=${G}, c=G.W3.cam; c.pitch=G.W3.camPitchMin||0; c.yaw=c.cy; const y=c.cy*Math.PI/180, p=G.W3.pos;
    const prev=G.WORLD.structures(); G.WORLD.setStructures(prev.concat([{id:'t-hut', type:'hut', x:p.x+Math.sin(y)*4, z:p.z+Math.cos(y)*4, rot:0, footprint:{shape:'rect', w:3.8, d:3.4}}]));
    await new Promise(r=>setTimeout(r,900)); const a={sent:G.W3.camSent.p, pitch:c.pitch}; G.WORLD.setStructures(prev); return a; })()`);
  ok('主人公とカメラの間に建物があっても、見下ろし角を勝手に上げない（送る角度＝ユーザーの希望の角度）', Math.abs(bh.sent - bh.pitch) < 0.01, JSON.stringify(bh));
  ok('ページでエラーが起きていない（カメラ・PC）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}
{
  const { page, errors, ctx } = await newPage({ width: 390, height: 844 }, true);
  await page.click('#introGo'); await page.waitForTimeout(700);
  await page.evaluate(`(()=>{ ${G}.W3.pos={x:-12,z:24}; })()`); await page.waitForTimeout(200);
  const cdp = await ctx.newCDPSession(page); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const jr = await rect(page, '#joy'), jx = jr.l + jr.w / 2, jy = jr.t + jr.h / 2;
  /* 名札（ボタン＝UI）の上で始まった指はカメラにならないので、このブロックでは名札を隠して地面の上の指だけを試す（UI 由来の指は下で別に確かめる） */
  await page.addStyleTag({ content: '#w3labels{visibility:hidden}' });
  // 1本指のドラッグで回転（タップにならない）
  const a0 = await camState(page), A = await empty(page, 200, 330);
  await touch('touchStart', [{ x: A.x, y: A.y, id: 1 }]); for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: A.x + i * 12, y: A.y + i * 4, id: 1 }]); await page.waitForTimeout(20); }
  await touch('touchEnd', [{ x: A.x + 96, y: A.y + 32, id: 1 }]); await settle(page);
  const a1 = await camState(page);
  ok('スマホ：マップを1本指でドラッグすると回転と見下ろし角が変わる（タップ移動・採取にならない）', a1.cy < a0.cy - 10 && a1.cp > a0.cp && !a1.target && a1.ptrs === 0, JSON.stringify({ a0, a1 }));
  // 画面サイズで感度を決める（CSSピクセル基準。端末の解像度に依らない）：短い辺の長さのドラッグで 240°×感度
  const k = (a0.cy - a1.cy) / 96;
  ok('回転の速さは画面の短い辺（CSSピクセル）で決まる（390px幅で約0.6°/px）', Math.abs(k - 240 / 390) < 0.05, JSON.stringify({ k }));
  // タップは今までどおり移動
  const T = await empty(page, 230, 470); await touch('touchStart', [{ x: T.x, y: T.y, id: 2 }]); await touch('touchMove', [{ x: T.x + 3, y: T.y + 2, id: 2 }]); await touch('touchEnd', [{ x: T.x + 3, y: T.y + 2, id: 2 }]); await page.waitForTimeout(120);
  ok('スマホ：短いタップは今までどおり移動先になる（判定距離8px未満のぶれは許す）', (await camState(page)).target);
  await page.evaluate(`${G}.W3.target=null; ${G}.W3.path=null; ${G}.W3.sel=null;`);
  // ピンチ：広げる＝近づく、すぼめる＝離れる。ピンチの指からタップは出ない
  const b0 = await camState(page);
  await touch('touchStart', [{ x: 160, y: 330, id: 3 }]); await touch('touchStart', [{ x: 160, y: 330, id: 3 }, { x: 240, y: 330, id: 4 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: 160 - i * 10, y: 330, id: 3 }, { x: 240 + i * 10, y: 330, id: 4 }]); await page.waitForTimeout(20); }
  await page.waitForTimeout(300); const b1 = await camState(page);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [{ x: 100 + i * 7, y: 330, id: 3 }, { x: 300 - i * 7, y: 330, id: 4 }]); await page.waitForTimeout(20); }
  await page.waitForTimeout(300); const b2 = await camState(page);
  // 2本→1本：残った指の基準を取り直す（離した瞬間に回らない）
  await touch('touchEnd', [{ x: 216, y: 330, id: 4 }]); await page.waitForTimeout(80);
  const b3 = await camState(page);
  await touch('touchMove', [{ x: 154, y: 330, id: 3 }]); await page.waitForTimeout(80); const b4 = await camState(page);   // 残った指（x=184）を左へ30px
  await touch('touchEnd', [{ x: 154, y: 330, id: 3 }]); await settle(page);
  const b5 = await camState(page);
  ok('ピンチアウトで近づき、ピンチインで離れる（表示範囲が小さく／大きくなる）', b1.zoom < b0.zoom && b2.zoom > b1.zoom && b1.pinch, JSON.stringify({ b0: b0.zoom, b1: b1.zoom, b2: b2.zoom }));
  ok('2本指→1本指：指を1本離した瞬間は回らず（基準を取り直す）、残った指で続けて回せる。ピンチからタップは出ない', Math.abs(b3.yaw - b2.yaw) < 1e-6 && !b3.pinch && b4.yaw > b3.yaw + 10 && b4.yaw < b3.yaw + 25 && !b5.target && b5.ptrs === 0, JSON.stringify({ b2: b2.yaw, b3: b3.yaw, b4: b4.yaw }));
  // 1本→2本→1本：途中でピンチに変わっても回転が飛ばない
  const e0 = await camState(page);
  await touch('touchStart', [{ x: 200, y: 400, id: 5 }]); await touch('touchMove', [{ x: 230, y: 400, id: 5 }]);
  await touch('touchStart', [{ x: 230, y: 400, id: 5 }, { x: 300, y: 420, id: 6 }]); const e1 = await camState(page);
  await touch('touchMove', [{ x: 230, y: 400, id: 5 }, { x: 320, y: 430, id: 6 }]);
  await touch('touchEnd', [{ x: 320, y: 430, id: 6 }]); const e2 = await camState(page);
  await touch('touchEnd', [{ x: 230, y: 400, id: 5 }]); await settle(page);
  ok('1本指→2本指→1本指：切り替えで急に回らない（ピンチ中は回転しない）', Math.abs(e2.yaw - e1.yaw) < 1e-6 && e1.yaw < e0.yaw, JSON.stringify({ e0: e0.yaw, e1: e1.yaw, e2: e2.yaw }));
  // 左手でスティック、右手でマップを回す（スティックの指とマップの指はピンチにならない）
  const p0 = await pos(page), j0 = await camState(page);
  await touch('touchStart', [{ x: jx, y: jy, id: 7 }]); await touch('touchMove', [{ x: jx, y: jy - 40, id: 7 }]);
  await touch('touchStart', [{ x: jx, y: jy - 40, id: 7 }, { x: 250, y: 330, id: 8 }]);
  let pinchSeen = false;
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: jx, y: jy - 40, id: 7 }, { x: 250 + i * 8, y: 330, id: 8 }]); await page.waitForTimeout(40); if ((await camState(page)).pinch) pinchSeen = true; }
  const j1 = await camState(page), walking = await page.evaluate(`!!${G}.W3.joy`);
  await touch('touchEnd', [{ x: 330, y: 330, id: 8 }]); await page.waitForTimeout(100);
  const stillJoy = await page.evaluate(`!!${G}.W3.joy`); await touch('touchEnd', [{ x: jx, y: jy - 40, id: 7 }]); await page.waitForTimeout(200);
  const p1 = await pos(page);
  ok('左手のスティックで歩きながら、右手でマップをドラッグして回せる（ピンチ扱いにならない・右手を離しても歩き続ける）', j1.cy < j0.cy - 5 && walking && !pinchSeen && stillJoy && !j1.target && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, JSON.stringify({ j0: j0.cy, j1: j1.cy, walking, pinchSeen, stillJoy }));
  // UI から始まった指（下部のタブ・行動ボタン）がマップの上へ動いても、カメラは動かない
  const navb = await rect(page, '#nav button'), u0 = await camState(page);
  await touch('touchStart', [{ x: navb.l + 10, y: navb.t + 10, id: 9 }]); for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: navb.l + 10 + i * 6, y: navb.t + 10 - i * 40, id: 9 }]);
  await touch('touchCancel', []); await page.waitForTimeout(100);
  const u1 = await camState(page);
  ok('UI（下部のタブ）から始まった指がマップの上へ動いても、カメラは動かない', Math.abs(u1.cy - u0.cy) < 1e-6 && Math.abs(u1.cp - u0.cp) < 1e-6 && u1.ptrs === 0, JSON.stringify({ u0: u0.cy, u1: u1.cy }));
  // マップで始まった指は、途中で UI（右上のボタン）の上へ行ってもカメラの担当のまま。離してもボタンは押されない
  const hb = await rect(page, '.hud-tr button'), m0 = await camState(page);
  await touch('touchStart', [{ x: 150, y: 420, id: 10 }]); for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: 150 + (hb.l + 5 - 150) * i / 8, y: 420 + (hb.t + 5 - 420) * i / 8, id: 10 }]);
  const m1 = await camState(page); await touch('touchEnd', [{ x: hb.l + 5, y: hb.t + 5, id: 10 }]); await page.waitForTimeout(200);
  const tab = await page.evaluate(`${G}.U ? ${G}.U.tab : null`);
  ok('マップで始まった指が UI の上へ移っても回転が続き、離してもその UI は押されない', Math.abs(m1.cy - m0.cy) > 5 && tab === 'explore', JSON.stringify({ m0: m0.cy, m1: m1.cy, tab }));
  // 解除：pointercancel・フォーカス喪失・画面の非表示で指の状態を残さない
  await touch('touchStart', [{ x: 200, y: 330, id: 11 }]); await touch('touchMove', [{ x: 240, y: 330, id: 11 }]);
  await page.evaluate(`window.dispatchEvent(new Event('blur'))`); const h1 = await camState(page);
  await touch('touchMove', [{ x: 300, y: 330, id: 11 }]); await page.waitForTimeout(100); const h2 = await camState(page);
  await touch('touchEnd', [{ x: 300, y: 330, id: 11 }]); await settle(page); const h3 = await camState(page);
  ok('フォーカスを失ったら指を手放し、その後の指の動き・離しでは回らない・移動しない', h1.ptrs === 0 && Math.abs(h2.yaw - h1.yaw) < 1e-6 && Math.abs(h3.yaw - h1.yaw) < 1e-6 && !h3.target, JSON.stringify({ h1, h2: h2.yaw, h3: h3.yaw }));
  await touch('touchStart', [{ x: 200, y: 330, id: 12 }]); await touch('touchMove', [{ x: 240, y: 330, id: 12 }]); await touch('touchCancel', []); await page.waitForTimeout(80);
  const cc = await camState(page);
  ok('pointercancel（指の取り消し）で操作の状態が残らない', cc.ptrs === 0 && !cc.pinch && !cc.target, JSON.stringify(cc));
  ok('スマホ：「視点を戻す」は小さなボタン1つ（指が届く大きさ）', (await rect(page, '#camctl [data-id="reset"]')).w >= 36 && (await page.evaluate(`[...document.querySelectorAll('#camctl button')].filter(b=>!b.hidden).length`)) === 1);
  const ta = await page.evaluate(`({stage:getComputedStyle(document.getElementById('view')).touchAction, dock:getComputedStyle(document.getElementById('dock')).touchAction})`);
  ok('マップの上はブラウザのスクロール・ピンチ拡大と競合しない（touch-action:none）。パネルはスクロールできるまま', ta.stage === 'none' && ta.dock !== 'none', JSON.stringify(ta));
  ok('ページでエラーが起きていない（カメラ・スマホ）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}
/* ---------------- 8方向の主人公（Muse 第23ラウンド） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  /* 偽モジュールで8行の分岐を検証。本物の自己点検・表示行は hero-8dir.mjs と test:8dir で別に確認する。 */
  await page.addInitScript(() => { window.addEventListener('hd2d-ready', () => {}); const t = setInterval(() => { if (window.HD2D) { window.HD2D.diag8Check = () => ({ ok: true, available: true, stuck: [] }); clearInterval(t); } }, 1); });
  await page.reload(); await page.waitForTimeout(500); { const ig = await page.$('#introGo'); if (ig && await ig.isVisible()) await ig.click(); } await page.waitForTimeout(700);
  await page.evaluate(`(()=>{ ${G}.W3.pos={x:-12,z:24}; })()`); await page.waitForTimeout(200);
  const d8 = await page.evaluate(async () => { const G = window.__GAME__, im = new Image(); im.src = __FAKE.sprite; await im.decode(); return { dirs: G.hero.dirs(), h: im.height }; });
  ok('8方向：自己点検に通ると、8行のシートをそのまま渡し、8方向で向きを選ぶ', d8.dirs === 8 && d8.h === 2048, JSON.stringify(d8));
  /* Muse §31 と同じ優先順：連続 facing があれば direction より優先。セクター中心で検証する。 */
  const sector8 = () => page.evaluate(`(()=>{ const A={down:0,'down-right':Math.PI/4,right:Math.PI/2,'up-right':Math.PI*3/4,up:Math.PI,'up-left':-Math.PI*3/4,left:-Math.PI/2,'down-left':-Math.PI/4}, T=HD2D.THREE, v=new T.Vector3(); ${G}.W3.gfx.getCamera().getWorldDirection(v);
    const sd=Math.atan2(-v.x,-v.z), face=typeof __FAKE.player.facing==='number'?__FAKE.player.facing:A[__FAKE.player.direction]; let rel=(face-sd)%(Math.PI*2); if(rel<0) rel+=Math.PI*2; return Math.round(rel/(Math.PI/4))%8; })()`);
  // 画面の右上へ斜めに歩く（↑＋→）：画面で見た向きは「右奥」＝相対角135°（セクター3）。カメラの角度を変えても同じ
  const res = [];
  for (const yaw of [45, 20, 200]) {
    await page.evaluate(`(()=>{ const c=${G}.W3.cam; c.yaw=c.cy+(((${yaw}-c.cy)%360+540)%360-180); })()`); await page.waitForTimeout(500);
    const p0 = await pos(page); await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500);
    const mid = await page.evaluate(`({facing:__FAKE.player.facing, moving:__FAKE.player.moving, sec:${G}.W3.faceSec})`);
    mid.renderSector = await sector8();
    await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowRight');
    // 2つのキーを離す間に1フレーム進むことがある。最後の実移動の向きを基準にする。
    const releasedFace = await page.evaluate(`${G}.W3.face`);
    await page.waitForTimeout(250);
    const p1 = await pos(page), st = await page.evaluate(`({facing:__FAKE.player.facing, moving:__FAKE.player.moving})`);
    res.push({ yaw, mid, releasedFace, stopFacing: st.facing, stopMoving: st.moving, d: Math.hypot(p1.x - p0.x, p1.z - p0.z) });
  }
  ok('8方向：両キー入力中は右奥（セクター3）の絵。止まると moving=false でキーを離した直後のワールド角を保つ', res.every(r => r.mid.renderSector === 3 && r.mid.sec === 3 && r.mid.moving && !r.stopMoving && Number.isFinite(r.mid.facing) && r.stopFacing===r.releasedFace), JSON.stringify(res));
  // 斜めは縦横より速くならない（同じ時間押して進む距離）
  const dist = async (keys) => { await page.evaluate(`${G}.W3.pos={x:-12,z:24}`); await page.waitForTimeout(200); const a = await pos(page); for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(700); for (const k of keys) await page.keyboard.up(k); await page.waitForTimeout(150); const b = await pos(page); return Math.hypot(b.x - a.x, b.z - a.z); };
  const dStraight = await dist(['ArrowDown']), dDiag = await dist(['ArrowDown', 'ArrowLeft']);
  await page.evaluate(`${G}.W3.pos={x:-12,z:24}`); await page.waitForTimeout(200); await page.keyboard.down('ArrowDown'); await page.waitForTimeout(500);
  const spW = await page.evaluate(`__FAKE.player.speed`); await page.keyboard.up('ArrowDown'); await page.waitForTimeout(300); const spS = await page.evaluate(`({s:__FAKE.player.speed, m:__FAKE.player.moving})`);
  ok('歩く速さ（実際に進んだ量）を speed として渡す（歩行中はおよそ毎秒4.55マス＝以前の約65%、止まると0・moving=false）', spW > 3.6 && spW < 5.2 && spS.s === 0 && !spS.m, JSON.stringify({ spW, spS }));
  ok('斜めの入力は正規化され、縦横より速くならない（同じ時間で進む距離の差が1割未満）', dDiag > 1 && dDiag <= dStraight * 1.1, JSON.stringify({ dStraight, dDiag }));
  // 静止中にカメラを回すと、8方向の絵が45°ごとに替わる（ワールドの向きは変わらない）
  await page.evaluate(`(()=>{ const G=${G}; G.W3.face=0; G.W3.faceSec=null; const c=G.W3.cam; c.yaw=c.cy+(((0-c.cy)%360+540)%360-180); })()`); await page.waitForTimeout(500);
  const seen = []; for (let k = 0; k < 8; k++) { await page.evaluate(`(()=>{ const c=${G}.W3.cam; c.yaw=c.cy+45; })()`); await page.waitForTimeout(450); seen.push(await sector8()); }
  ok('8方向：静止中にカメラを45°ずつ一周回すと、8つの絵を順に通る（主人公のワールドの向きはそのまま）', new Set(seen).size === 8 && (await page.evaluate(`${G}.W3.face`)) === 0, JSON.stringify(seen));
  ok('ページでエラーが起きていない（8方向）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}
{
  // 描画側に API がない版：カメラの部品を出さない（押しても動かないボタンを見せない）
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.addInitScript(() => { window.__FAKE_NO_CAMVIEW = true; }); await page.reload(); await page.waitForTimeout(400);
  if (await page.evaluate(`document.getElementById('modal').classList.contains('open')`)) await page.click('#introGo'); await page.waitForTimeout(700);
  ok('描画モジュールにカメラの API がない版では、カメラの部品は出ない', await page.evaluate(`document.getElementById('camctl').hidden && !${G}.W3.camView`));
  ok('ページでエラーが起きていない（カメラ API なし）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 古い形式（v2）のセーブ：移行前のバックアップ・向きの復元 ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  const v2 = JSON.stringify({ v: 2, inv: { twig: 4 }, disc: { twig: { first: 1, made: 1, total: 4, routes: [], best: 0 } }, hist: [], gathered: {}, explore: {}, auto: [], seq: 3, flags: { intro: 1, hero: 'girl' }, nature: {}, pos: { x: -14, z: 25, dir: 'left' }, created: 1 });
  // 前のページが閉じるときの保存で上書きされないよう、次のページの読み込み前に置く
  await page.addInitScript(s => { if (!sessionStorage.getItem('seed-v2')) { localStorage.clear(); localStorage.setItem('zero-kagaku-save', s); sessionStorage.setItem('seed-v2', '1'); } }, v2);
  await page.reload(); await page.waitForTimeout(900);
  const r = await page.evaluate(`({bk:localStorage.getItem('zero-kagaku-save-backup-v2'), v:${G}.S.v, twig:${G}.S.inv.twig, build:JSON.stringify(${G}.S.build), pos:${G}.W3.pos, dir:${G}.W3.dir, player:__FAKE.player&&__FAKE.player.direction})`);
  ok('古い形式（v2）のセーブは、移行する前に元のまま別のキーへ控える。移行後も持ち物・位置は同じ', r.bk === v2 && r.v === 6 && r.twig === 4 && r.build === '{}' && Math.abs(r.pos.x + 14) < 0.05 && Math.abs(r.pos.z - 25) < 0.05, JSON.stringify(r).slice(0, 200));
  ok('保存した向き（左）で復元される', r.dir === 'left' && r.player === 'left', JSON.stringify({ dir: r.dir, player: r.player }));
  ok('ページでエラーが起きていない（v2 の移行）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 小さな集落と人（NPC）・会話 ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.click('#introGo'); await page.waitForTimeout(700);
  const v = await page.evaluate(`(()=>{ const G=${G}, V=G.D.village; const ids=Object.keys(__FAKE.structures).filter(k=>/^v[hp]:/.test(k));
    const inside=ids.every(k=>{ const p=__FAKE.structures[k].pos; return Math.hypot(p.x-V.c.x,p.z-V.c.z) < V.r; });
    const well=G.WORLD.structures().find(t=>t.id==='struct:vp:well');
    return {n:ids.length, want:V.huts.length+V.props.length, inside, huts:ids.filter(k=>__FAKE.structures[k].type==='hut').length, wellCol: !!well && !G.WORLD.free(G.S, well.x, well.z), npcs:(G.W3.npcs||[]).length}; })()`);
  ok('集落に草ぶきの小屋2つと生活の小物（Muse の11種）があり、集落の範囲の中だけ・当たり判定つき', v.n === v.want && v.inside && v.huts === 2 && v.wellCol && v.npcs === 3, JSON.stringify(v));
  // 近づく：案内役の前へ
  await page.evaluate(`(()=>{ const G=${G}; const n=G.W3.npcs.find(x=>x.id==='guide'); n.wait=999; G.W3.pos={x:n.x+1.2, z:n.z}; })()`); await page.waitForTimeout(500);
  const near = await page.evaluate(`({mode:document.getElementById('w3act').dataset.mode, txt:document.getElementById('w3act').textContent, label:!!document.querySelector('.w3lab[data-npc="guide"]'), wall:(()=>{ const n=${G}.W3.npcs.find(x=>x.id==='guide'); return !${G}.WORLD.free(${G}.S, n.x, n.z); })()})`);
  ok('人に近づくと名札が出て、行動ボタンが「〜と話す」になる。人の位置には立てない（すり抜けない）', near.mode === 'talk' && /ミナと話す/.test(near.txt) && near.label && near.wall, JSON.stringify(near));
  await page.keyboard.press('e'); await page.waitForTimeout(250);
  const t1 = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), name:(document.querySelector('#sheet .tname')||{}).textContent, line:(document.querySelector('#sheet .tline')||{}).textContent, talking:${G}.W3.npcs.find(x=>x.id==='guide').talking, active:${G}.fieldInputActive ? null : null, trade:/買う|売る|取引|交換/.test(document.getElementById('sheet').textContent)})`);
  ok('E キーで会話が開く（名前・役割・セリフ）。取引のボタンや言葉はない', t1.open && /ミナ/.test(t1.name) && /案内役/.test(t1.name) && t1.line.length > 5 && t1.talking && !t1.trade, JSON.stringify(t1));
  const p0 = await pos(page); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(400); await page.keyboard.up('ArrowUp');
  ok('会話中は移動入力を受け付けない', same(p0, await pos(page)));
  let pages = 1; while (pages < 8 && await page.evaluate(`!!document.querySelector('#sheet [data-act="t-next"]')`)) { await page.click('#sheet [data-act="t-next"]'); await page.waitForTimeout(80); pages++; }
  const lastLine = await page.evaluate(`document.querySelector('#sheet .tline').textContent`);
  ok('「つぎへ」でセリフが進み、案内役は最後に今の目標を教えてくれる', pages >= 3 && /今の目標/.test(lastLine), JSON.stringify({ pages, lastLine }));
  await page.click('#sheet .row [data-act="close"]'); await page.waitForTimeout(200);
  const back = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), talking:${G}.W3.npcs.find(x=>x.id==='guide').talking})`);
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(400); await page.keyboard.up('ArrowDown');
  ok('「とじる」で会話が終わり、操作に戻れる（また歩ける）', !back.open && !back.talking && !same(p0, await pos(page)), JSON.stringify(back));
  // 人は集落の中を歩き回る（集落の外へ出ない）
  const w0 = await page.evaluate(`${G}.W3.npcs.map(n=>({x:n.x,z:n.z}))`); await page.evaluate(`(()=>{ const G=${G}; G.W3.npcs.forEach(n=>{ n.wait=0; }); G.W3.pos={x:G.D.village.c.x-12, z:G.D.village.c.z-10}; })()`); await page.waitForTimeout(3500);
  const w1 = await page.evaluate(`(()=>{ const G=${G}, V=G.D.village; return G.W3.npcs.map(n=>({x:n.x,z:n.z,inV:Math.hypot(n.x-V.c.x,n.z-V.c.z)<V.r})); })()`);
  ok('人は集落の中を歩き回る（外へ出ない）', w1.some((p, i) => Math.hypot(p.x - w0[i].x, p.z - w0[i].z) > 0.5) && w1.every(p => p.inV), JSON.stringify(w1));
  // 集落の中には建物を置けない
  const vr = await page.evaluate(`(()=>{ const G=${G}, V=G.D.village; return G.WORLD.checkPlacement(G.S, {id:'t', type:'workbench', footprint:{shape:'rect',w:2.2,d:1.05}, x:V.c.x+2, z:V.c.z+5.5, rot:0}, {player:{x:-200,z:-200}, reserved:[{x:V.c.x,z:V.c.z,r:V.r,why:'集落の中（人の家や通り道）には置けない'}]}).reasons.join('/'); })()`);
  ok('集落の中（人の家や通り道）には建物を置けない', /集落/.test(vr), vr);
  ok('ページでエラーが起きていない（集落）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 広い世界（山・海岸・滝・地図・瞬間移動） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.click('#introGo'); await page.waitForTimeout(700);
  const W0 = await page.evaluate(`(()=>{ const G=${G}; return {b:G.WORLD.bounds, wide:G.WORLD.wide, ver:G.S.worldVer, tver:TERRAIN.WORLD_VERSION}; })()`);
  ok('広い世界：歩ける範囲が旧世界（±56）の3倍の辺になり、セーブに地形の版がある', W0.wide && W0.b.maxX - W0.b.minX > 330 && W0.ver === W0.tver, JSON.stringify(W0));
  // 海岸：地名が出る。海へ歩いても深い所の手前で止まる
  await page.evaluate(`${G}.W3.pos={x:134,z:24}`); await page.waitForTimeout(1100);
  const loc = await page.evaluate(`document.getElementById('hudLoc').textContent`);
  ok('海岸に立つと、左上に地名（海岸）が出る', /海岸/.test(loc), loc);
  const kc = await page.evaluate(`(()=>{ const T=HD2D.THREE, cam=${G}.W3.gfx.getCamera(), v=new T.Vector3(); cam.getWorldDirection(v); let fx=v.x,fz=v.z; const l=Math.hypot(fx,fz); fx/=l; fz/=l;
    const r={x:-fz,z:fx}; const c=[['ArrowRight',r.x],['ArrowLeft',-r.x],['ArrowUp',fx],['ArrowDown',-fx]]; c.sort((a,b)=>b[1]-a[1]); return c[0][0]; })()`);
  await page.keyboard.down(kc); await page.waitForTimeout(6000); await page.keyboard.up(kc); await page.waitForTimeout(200);
  const sea = await page.evaluate(`(()=>{ const p=${G}.W3.pos, h=TERRAIN.terrainHeight(p.x,p.z,TERRAIN.DEFAULT_CONFIG), w=TERRAIN.waterAt(p.x,p.z,h); return {p, w, moved:p.x-134}; })()`);
  ok('海へ向かって歩くと浅瀬までは進み、深い所（泳ぐ機能はない）の手前で止まる', sea.moved > 3 && (!sea.w.kind || sea.w.depth <= 0.6), JSON.stringify(sea));
  // 地図：世界全体が描かれ、今いる所の印がある
  await page.click('[data-tab="world"]'); await page.waitForTimeout(400);
  const map = await page.evaluate(`(()=>{ const c=document.getElementById('wmap'); if(!c) return null; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let blue=0, red=0; for(let i=0;i<d.length;i+=4){ if(d[i+2]>120 && d[i]<90) blue++; if(d[i]>200 && d[i+1]<90 && d[i+2]<100) red++; } return {w:c.width, blue, red}; })()`);
  // 外の野（2026-11-10）で地図の範囲が ±180 から ±256 に広がったので、同じ海でも画素は約 (180/256)²≒0.49 倍になる（しきい値 2000 → 900）
  ok('地図（世界）に山・海・湖と今いる所が描かれる', map && map.blue > 900 && map.red > 5, JSON.stringify(map));
  // 瞬間移動で拠点へ戻る（動けなくなったとき用）
  await page.click('[data-act="rescue"]'); await page.waitForTimeout(400);
  const back = await page.evaluate(`({p:${G}.W3.pos, s:${G}.S.pos, base:${G}.D.base})`);
  ok('「拠点へ瞬間移動」で拠点の近くの安全な場所へ戻り、保存される', Math.hypot(back.p.x - back.base.x, back.p.z - back.base.z) < 4 && Math.abs(back.s.x - back.p.x) < 0.05, JSON.stringify(back));
  // 滝つぼへタップ移動しても崖を直進しない（経路は崖を避ける）
  const path = await page.evaluate(`(()=>{ const G=${G}, F=TERRAIN.FALL; const from=G.WORLD.nearestFree(G.S,{x:F.pool.x+6,z:F.pool.z+5},0,6); const to={x:F.lip.x-2,z:F.lip.z-1.5};
    const p=G.WORLD.findPath(G.S, from, to); if(!p) return {none:true}; const pts=[from].concat(p); let bad=0;
    for(let k=0;k<pts.length-1;k++){ const n=Math.ceil(Math.hypot(pts[k+1].x-pts[k].x, pts[k+1].z-pts[k].z)/0.25); for(let q=0;q<=n;q++){ const x=pts[k].x+(pts[k+1].x-pts[k].x)*q/n, z=pts[k].z+(pts[k+1].z-pts[k].z)*q/n; if(G.WORLD.terrainBlocked(x,z)) bad++; } }
    return {n:pts.length, bad, len:pts.reduce((a,p,i)=>i?a+Math.hypot(p.x-pts[i-1].x,p.z-pts[i-1].z):0,0)}; })()`);
  ok('滝つぼから落ち口の上へのタップ移動は、崖をまっすぐ登らず道を回る', !path.none && path.bad === 0 && path.len > 20, JSON.stringify(path));
  ok('ページでエラーが起きていない（広い世界）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 建築モード（家・設備の自由設置） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1366, height: 768 }, false);
  await page.goto(url + '?verify=1'); await page.waitForTimeout(900);
  page.on('dialog', d => d.accept());
  // 作業台を「建てた」状態にして、拠点から少し離れた開けた所へ
  await page.evaluate(`(()=>{ const G=${G}; G.S.verify.placed=['st-bench']; G.render(); G.W3.pos={x:-13,z:25}; })()`); await page.waitForTimeout(400);
  await page.click('#nav [data-tab="build"]'); await page.waitForTimeout(300);
  const list = await page.evaluate(`[...document.querySelectorAll('#dockBody .bit')].map(b=>b.textContent.replace(/\\s+/g,' ').trim())`);
  ok('建築一覧に、建てた（作った）家・設備だけが並び、素材の決まり（使わない・戻らない）が書いてある', list.length === 1 && /作業台/.test(list[0]) && await page.evaluate(`/素材は使わず、戻りもしません/.test(document.getElementById('dockBody').textContent)`), JSON.stringify(list));
  await page.click('#dockBody [data-act="b-start"][data-id="st-bench"]'); await page.waitForTimeout(300);
  const st0 = await page.evaluate(`({place:!!${G}.W3.place, bar:!document.getElementById('buildbar').hidden, ghost:!!__FAKE.structures['ghost:place'], orig:!!__FAKE.structures['st-bench'], tab:${G}.U.tab, inv:JSON.stringify(${G}.S.inv).length})`);
  ok('「移動・回転」で置き場所を決めるモードになり、候補が出る（元の建物はいったん隠れ、パネルは閉じる）', st0.place && st0.bar && st0.ghost && !st0.orig && st0.tab === 'explore', JSON.stringify(st0));
  // 置けない所（川）→ 赤と理由、ボタンは押せない
  await page.evaluate(`(()=>{ const G=${G}; const P=G.W3.place; P.x=T_RIVER_X; P.z=0; })()`.replace('T_RIVER_X', '16.9')); await page.waitForTimeout(200);
  const ng = await page.evaluate(`({msg:document.getElementById('bbMsg').textContent, cls:document.getElementById('bbMsg').className, dis:document.querySelector('#buildbar .bbok').disabled, poly:(document.querySelector('#buildov polygon')||{getAttribute:()=>''}).getAttribute('stroke')})`);
  ok('置けない所では赤い枠と理由が出て、「ここに置く」は押せない', /川/.test(ng.msg) && /ng/.test(ng.cls) && ng.dis && ng.poly === '#e0434f', JSON.stringify(ng));
  // マウスを動かすと候補が付いてくる（グリッド吸着ONなら0.5マス刻み）
  await page.mouse.move(700, 420); await page.mouse.move(705, 424); await page.waitForTimeout(150);
  const snap = await page.evaluate(`(()=>{ const P=${G}.W3.place; return {x:P.x, z:P.z, gx:Math.abs(P.x*2-Math.round(P.x*2))<1e-9, gz:Math.abs(P.z*2-Math.round(P.z*2))<1e-9}; })()`);
  ok('マウスを動かすと候補が付いてきて、グリッド吸着で0.5マス刻みになる', snap.gx && snap.gz && Math.abs(snap.x - 16.9) > 1, JSON.stringify(snap));
  // 開けた所へ動かし、15度・90度回転、グリッド吸着
  await page.evaluate(`(()=>{ const G=${G}; G.W3.place.x=-10.26; G.W3.place.z=21.73; })()`); await page.click('[data-act="b-rot"][data-id="15"]'); await page.click('[data-act="b-rot"][data-id="90"]'); await page.waitForTimeout(200);
  const okst = await page.evaluate(`({msg:document.getElementById('bbMsg').textContent, dis:document.querySelector('#buildbar .bbok').disabled, rot:${G}.W3.place.rot, poly:document.querySelector('#buildov polygon').getAttribute('stroke'), title:document.getElementById('bbTitle').textContent})`);
  ok('置ける所では緑の枠。回転は15度・90度の刻みで、向きが表示される', /置ける/.test(okst.msg) && !okst.dis && okst.poly === '#3fbf62' && /向き/.test(okst.title), JSON.stringify(okst));
  const seq0 = await page.evaluate(`${G}.S.seq`), inv0 = await page.evaluate(`JSON.stringify(${G}.S.inv)`);
  await page.evaluate(`(()=>{ const b=document.querySelector('#buildbar .bbok'); b.click(); b.click(); b.click(); })()`); await page.waitForTimeout(300);
  const placed = await page.evaluate(`(()=>{ const G=${G}; const b=G.S.build['st-bench'], c=G.WORLD.structures().filter(t=>t.id==='struct:st-bench'); return {b, seq:G.S.seq, n:Object.keys(__FAKE.structures).filter(k=>!/^v[hp]:/.test(k)).filter(k=>k==='st-bench'||k.startsWith('ghost')).length, col:c.length, cx:c[0]&&c[0].x, inv:JSON.stringify(G.S.inv), place:!!G.W3.place}; })()`);
  ok('「ここに置く」を連打しても、置くのは1回だけ（記録1つ・建物1つ・当たり判定1つ）。素材は変わらない', placed.b && Math.abs(placed.b.x + 10.26) < 1e-6 && placed.seq === seq0 + 1 && placed.n === 1 && placed.col === 1 && Math.abs(placed.cx + 10.26) < 1e-6 && placed.inv === inv0 && !placed.place, JSON.stringify(placed));
  // やめる：何も変わらない
  await page.click('#nav [data-tab="build"]'); await page.waitForTimeout(200); await page.click('#dockBody [data-act="b-start"][data-id="st-bench"]'); await page.waitForTimeout(200);
  await page.evaluate(`(()=>{ const G=${G}; G.W3.place.x=-14; G.W3.place.z=28; })()`); await page.click('[data-act="b-cancel"]'); await page.waitForTimeout(200);
  const cancel = await page.evaluate(`({b:${G}.S.build['st-bench'], seq:${G}.S.seq, shown:!!__FAKE.structures['st-bench'], ghost:!!__FAKE.structures['ghost:place']})`);
  ok('「やめる」と置き場所は元のまま（素材も記録も変わらない・候補は消える）', Math.abs(cancel.b.x + 10.26) < 1e-6 && cancel.seq === seq0 + 1 && cancel.shown && !cancel.ghost, JSON.stringify(cancel));
  // 再読み込み：同じ場所・向きで復元、当たり判定も
  await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(900);
  const rl = await page.evaluate(`(()=>{ const G=${G}; const f=__FAKE.structures['st-bench']; const c=G.WORLD.structures().find(t=>t.id==='struct:st-bench'); return {fx:f&&f.pos.x, frot:f&&f.rot, brot:G.S.build['st-bench'].rot, cx:c&&c.x, wall:!G.WORLD.free(G.S,-10.5,21.5)}; })()`);
  ok('再読み込みしても、同じ場所・同じ向きで建ち、当たり判定も同じ場所', Math.abs(rl.fx + 10.26) < 1e-6 && Math.abs(rl.frot - rl.brot) < 1e-6 && Math.abs(rl.cx + 10.26) < 1e-6 && rl.wall, JSON.stringify(rl));
  // 撤去：見えない壁が残らない・持ち物に残る
  await page.click('#nav [data-tab="build"]'); await page.waitForTimeout(200); await page.click('#dockBody [data-act="b-remove"][data-id="st-bench"]'); await page.waitForTimeout(300);
  const rm = await page.evaluate(`({b:${G}.S.build['st-bench'], shown:!!__FAKE.structures['st-bench'], col:${G}.WORLD.structures().filter(t=>!/^struct:v[hp]:/.test(t.id)).length, free:${G}.WORLD.free(${G}.S,-10.5,21.5), own:${G}.S.inv.bench, btn:!!document.querySelector('#dockBody [data-act="b-start"][data-id="st-bench"]')})`);
  ok('撤去すると建物も当たり判定も消え（見えない壁が残らない）、作業台は持ち物に残り、また「置く」ができる', rm.b.removed && !rm.shown && rm.col === 0 && rm.free && rm.own === 1 && rm.btn, JSON.stringify(rm));
  ok('ページでエラーが起きていない（建築モード）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 検証モード（全解放・別セーブ） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 390, height: 844 }, true);
  // 通常のセーブ（木の枝3本・目標の途中）を先に置いておく
  const normalSave = JSON.stringify({ v: 2, inv: { twig: 3 }, disc: { twig: { first: 1, made: 1, total: 3, routes: [], best: 0 } }, hist: [], gathered: {}, explore: {}, auto: [], seq: 5, flags: { intro: 1, hero: 'boy' }, nature: {}, created: 1 });
  // 先に検証モードで開いてから通常のセーブを置き、再読み込み（前のページが閉じるときの保存で上書きされないように）
  await page.goto(url + '?verify=1'); await page.waitForTimeout(600);
  await page.evaluate(s => { localStorage.removeItem('zero-kagaku-verify'); localStorage.setItem('zero-kagaku-save', s); }, normalSave);
  await page.reload(); await page.waitForTimeout(900);
  const v0 = await page.evaluate(`(()=>{ const G=${G}; const c=G.verifyCatalog(); return {V:G.VERIFY, badge:!document.getElementById('vbadge').hidden, badgeText:document.getElementById('vbadge').textContent,
    disc:Object.keys(G.S.disc).length, items:Object.keys(G.D.items).length, store:c.store.length, inv:Object.keys(G.S.inv).length, structs:Object.keys(__FAKE.structures).filter(k=>!/^v[hp]:/.test(k)).length,
    normal:localStorage.getItem('zero-kagaku-save'), url:location.search}; })()`);
  ok('検証モード：「検証モード：全解放」の表示があり、全物質が図鑑に・保管できる全素材が在庫にある（件数はデータから）',
    v0.V && v0.badge && /検証モード：全解放/.test(v0.badgeText) && v0.disc === v0.items && v0.inv === v0.store, JSON.stringify(v0).slice(0, 300));
  ok('検証モード：原野には建物を自動で置かない', v0.structs === 0);
  ok('検証モード：通常のセーブは書き換えない', v0.normal === normalSave);
  await page.click('#vbadge'); await page.waitForTimeout(400);
  const tbl = await page.evaluate(`[...document.querySelectorAll('.vtbl tr')].map(r=>r.textContent)`);
  const wantRows = await page.evaluate(`(()=>{ const D=${G}.D; return {procs:D.procs.length, crafts:D.crafts.length, regions:D.regions.length}; })()`);
  ok('検証メニュー：件数の表はいまのデータから作られる（研究・工作・地域）', tbl.some(t => t.includes('研究（反応）') && t.endsWith(String(wantRows.procs))) && tbl.some(t => t.includes('工作') && t.endsWith(String(wantRows.crafts))) && tbl.some(t => t.startsWith('地域') && t.endsWith(String(wantRows.regions))), JSON.stringify(tbl.slice(0, 6)));
  // 2026-11-11：地域の鍵を廃止したので、検証メニューに鍵の切り替えはない。たいまつがなくても洞窟へ瞬間移動できる
  await page.evaluate(`(()=>{ const S=${G}.S; delete S.inv.torch; delete S.inv.candle; })()`);
  const noLockToggle = await page.evaluate(`!document.querySelector('input[data-act="v-flag"][data-id="locks"]')`);
  await page.click('[data-act="v-warp"][data-id="cave"]'); await page.waitForTimeout(400);
  const went = await page.evaluate(`({tab:${G}.U.tab, d:Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34)})`);
  ok('検証メニュー：地域の鍵の切り替えはなく、たいまつがなくても洞窟へ移動できる', noLockToggle && went.tab === 'explore' && went.d < 9, JSON.stringify({ noLockToggle, went }));
  // 素材の検索と追加・保管できない物はトレイへ
  await page.click('#vbadge'); await page.waitForTimeout(300);
  await page.fill('#vq', 'flint'); await page.fill('#vn', '5'); await page.waitForTimeout(100);
  const f0 = await page.evaluate(`${G}.S.inv.flint`);
  await page.click('#vres [data-act="v-add"][data-id="flint"]'); await page.waitForTimeout(150);
  ok('検証メニュー：素材を検索して、指定した数を追加できる', (await page.evaluate(`${G}.S.inv.flint`)) === f0 + 5);
  await page.fill('#vq', 'hydrogen'); await page.waitForTimeout(100);
  const h = await page.evaluate(`({add:!!document.querySelector('#vres [data-act="v-add"][data-id="hydrogen"]'), tray:!!document.querySelector('#vres [data-act="v-tray"][data-id="hydrogen"]')})`);
  await page.click('#vres [data-act="v-tray"][data-id="hydrogen"]'); await page.waitForTimeout(400);
  const t2 = await page.evaluate(`({tab:${G}.U.tab, tray:${G}.U.tray.hydrogen||0, inv:${G}.S.inv.hydrogen||0, shown:/水素/.test(document.querySelector('#dockBody .tray').textContent)})`);
  ok('検証メニュー：保管できない物（水素）は在庫に入れず、研究室のトレイに入れて使える', !h.add && h.tray && t2.tab === 'lab' && t2.tray === 1 && t2.inv === 0 && t2.shown, JSON.stringify({ h, t2 }));
  // 建物の配置と撤去・採取済みの復元（スマホの研究室は全高なので、閉じてからバッジを押す）
  await page.click('#dock .dockx'); await page.waitForTimeout(300);
  await page.click('#vbadge'); await page.waitForTimeout(300);
  await page.click('[data-act="v-place"][data-id="st-wheel"]'); await page.waitForTimeout(150);
  await page.click('[data-act="v-extra"][data-id="bridge"]'); await page.waitForTimeout(150);
  const st1 = await page.evaluate(`Object.entries(__FAKE.structures).filter(([k])=>!/^v[hp]:/.test(k)).map(([k,v])=>k+':'+v.type)`);
  const col1 = await page.evaluate(`(()=>{ const G=${G}, t=G.WORLD.structures(); const w=t.find(o=>o.type==='waterwheel'); return {types:t.map(o=>o.type), wallAtCenter: w ? !G.WORLD.free(G.S,w.x,w.z) : null}; })()`);
  ok('置いた建物には structures.json の占有形状の当たり判定が付く（水車）。仕様のない橋は判定なし', col1.types.includes('waterwheel') && !col1.types.includes('bridge') && col1.wallAtCenter === true, JSON.stringify(col1));
  await page.click('[data-act="v-clearst"]'); await page.waitForTimeout(150);
  const st2 = await page.evaluate(`Object.keys(__FAKE.structures).filter(k=>!/^v[hp]:/.test(k)).length`);
  ok('建物を撤去すると、当たり判定も消える', await page.evaluate(`${G}.WORLD.structures().filter(t=>!/^struct:v[hp]:/.test(t.id)).length===0`));
  ok('検証メニュー：建物を選んで置き（決まりにない橋も足もとに置ける）、全部撤去できる', st1.includes('st-wheel:waterwheel') && st1.some(x => /:bridge$/.test(x)) && st2 === 0, JSON.stringify(st1));
  await page.evaluate(`(()=>{ const G=${G}; const o=G.WORLD.objects.find(o=>o.kind==='twig'); G.S.nature[o.id]={u:1,t:Date.now()}; window.__tw=o.id; })()`);
  await page.evaluate(`${G}.render()`); await page.waitForTimeout(150);       // 検証パネルは開いたまま（全高なのでバッジは隠れている）
  await page.click('[data-act="v-restore"]'); await page.waitForTimeout(150);
  ok('検証メニュー：採取済みの資源を元に戻せる', await page.evaluate(`Object.keys(${G}.S.nature).length===0`));
  // アセット一覧（別の画面）とプレビュー
  await page.click('#dockBody [data-act="v-assets"][data-id="ui"]'); await page.waitForTimeout(300);
  const a1 = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), imgs:document.querySelectorAll('#sheet .vgal img').length, want:Object.keys(ASSETS.icons).length+Object.keys(ASSETS.icons32).length})`);
  await page.click('#sheet [data-act="v-assets"][data-id="items"]'); await page.waitForTimeout(200);
  const a2 = await page.evaluate(`({figs:document.querySelectorAll('#sheet .vgal figure').length, want:Object.keys(${G}.D.items).length})`);
  await page.click('#sheet [data-act="v-assets"][data-id="d3"]'); await page.waitForTimeout(200);
  await page.click('#sheet [data-act="v-prev"][data-id="res:tree"]'); await page.waitForTimeout(200);
  const a3 = await page.evaluate(`Object.keys(__FAKE.resources).filter(k=>k.startsWith('vpr:tree')).length`);
  ok('アセット一覧：別の画面で開き、UIアイコン・全物質のアイコンを表示し、3Dの見た目を主人公のそばに置ける', a1.open && a1.imgs === a1.want && a2.figs === a2.want && a3 === 1, JSON.stringify({ a1, a2, a3 }));
  // 道具・設備・操作のアイコン（Muse の62点）：工作カードと研究室の操作ボタン
  await page.click('#nav [data-tab="craft"]'); await page.waitForTimeout(400);
  const ci = await page.evaluate(`({tic:document.querySelectorAll('#dockBody .card h3 .tic').length, iic:document.querySelectorAll('#dockBody .card h3 .iic').length, toolCards:[...document.querySelectorAll('#dockBody .card h3')].length, cards:document.querySelectorAll('#dockBody .card h3').length, emoji:[...document.querySelectorAll('#dockBody .card h3 .i')].filter(e=>!e.querySelector('.tic,.iic')).length})`);
  await page.click('#nav [data-tab="lab"]'); await page.waitForTimeout(400);
  await page.click('#dockBody [data-act="fac"]'); await page.waitForTimeout(300);
  const oi = await page.evaluate(`({ops:document.querySelectorAll('#dockBody .opt[data-act="op"]').length, tic:document.querySelectorAll('#dockBody .opt[data-act="op"] .tic').length, facTic:document.querySelectorAll('#dockBody [data-act="fac"] .tic').length, bg:getComputedStyle(document.querySelector('#dockBody .opt .tic')||document.body).backgroundImage.slice(0,8)})`);
  ok('道具・設備のアイコン（Muse の62点）：工作カードの見出しはすべて画像（道具・設備は新しいアイコン、材料は物質アイコン）', ci.cards > 3 && ci.tic > 0 && ci.tic + ci.iic === ci.cards && ci.emoji === 0, JSON.stringify(ci));
  ok('操作のアイコン：研究室の操作ボタンと設備ボタンも画像', oi.ops > 0 && oi.tic === oi.ops && oi.facTic > 0 && /url/.test(oi.bg), JSON.stringify(oi));
  await page.click('#dock .dockx'); await page.waitForTimeout(300);
  // 通常のセーブに戻る → 混入しない → 再読み込みしても通常 → もう一度入ると前の検証データの続き
  await page.click('#vbadge'); await page.waitForTimeout(250); await page.click('[data-act="v-exit"]'); await page.waitForTimeout(400);
  const back = await page.evaluate(`({V:${G}.VERIFY, badge:!document.getElementById('vbadge').hidden, inv:JSON.stringify(${G}.S.inv), verify:!!${G}.S.verify, prev:Object.keys(__FAKE.resources).filter(k=>k.startsWith('vpr:')).length, url:location.search, saved:localStorage.getItem('zero-kagaku-save')})`);
  ok('通常のセーブに戻ると、検証で増やした素材・設定・プレビューは入っていない', !back.V && !back.badge && back.inv === '{"twig":3}' && !back.verify && back.prev === 0 && !/verify/.test(back.url), JSON.stringify(back).slice(0, 300));
  ok('通常のセーブの中身も、検証前と同じまま', JSON.parse(back.saved).inv.twig === 3 && !JSON.parse(back.saved).verify && !JSON.parse(back.saved).inv.flint);
  await page.reload(); await page.waitForTimeout(900);
  ok('再読み込みしても通常のセーブのまま（最後に選んだモード）', await page.evaluate(`!${G}.VERIFY && ${G}.S.inv.twig===3 && !${G}.S.inv.flint`));
  await page.click('.hud-tr [data-tab="settings"]'); await page.waitForTimeout(300);
  await page.click('#dockBody [data-act="v-enter"][data-id="keep"]'); await page.waitForTimeout(500);
  ok('設定から検証モードに入り直すと、前の検証データ（追加した火打ち石）の続きになる', await page.evaluate(`${G}.VERIFY && ${G}.S.inv.flint===${f0 + 5}`));
  ok('検証モードの表示も文字選択されない（長押し対策を維持）', await page.evaluate(`getComputedStyle(document.getElementById('vbadge')).userSelect==='none' && getComputedStyle(document.querySelector('#dockBody .vsec')).userSelect==='none' && getComputedStyle(document.getElementById('vq')).userSelect!=='none'`));
  ok('ページでエラーが起きていない（検証モード）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- PC（1920×1080） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1920, height: 1080 }, false);
  await page.click('#introGo'); await page.waitForTimeout(400);
  const fc = await fullCheck(page);
  await page.setViewportSize({ width: 960, height: 600 }); await page.waitForTimeout(300);
  ok('狭いPC画面（960×600）でも下部ドックの文字が折り返さない', await page.evaluate(`[...document.querySelectorAll('#nav button')].filter(b=>getComputedStyle(b).display!=='none').every(b=>b.getBoundingClientRect().height<=50) && document.getElementById('nav').getBoundingClientRect().width<=960`));
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(300);
  ok('1920×1080：画面いっぱいのマップで、PC配置になる', fc.full && fc.noScroll && fc.ui === 'pc', JSON.stringify(fc));
  ok('ページでエラーが起きていない（1920×1080）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- 確認用カメラ（?camera=俯角,viewSize） ---------------- */
{
  const { page, ctx } = await newPage({ width: 844, height: 390 }, false, { query: '?camera=32,16' });
  await page.click('#introGo'); await page.waitForTimeout(500);
  const c = await page.evaluate(`({opt:__FAKE.opts.config && __FAKE.opts.config.camera, cfg:${G}.W3.cfg.camera})`);
  ok('?camera=32,16 のときだけ確認用カメラを公開オプション config.camera で渡す', c.opt && c.opt.pitchDegrees === 32 && c.opt.viewSize === 16 && c.cfg.pitchDegrees === 32 && c.cfg.yawDegrees === 45, JSON.stringify(c));
  await page.goto(url + '?camera=90,2'); await page.waitForTimeout(800);
  ok('範囲外の ?camera は無視する', await page.evaluate(`!__FAKE.opts.config || __FAKE.opts.config.camera === undefined`));
  await ctx.close();
}

/* ---------------- 3Dが使えないとき（2D） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 390, height: 844 }, true, { fake: false });
  await page.click('#introGo');
  await page.waitForFunction(`${G}.W3.state==='failed'`, null, { timeout: 20000 }); await page.waitForTimeout(300);
  const fc = await fullCheck(page);
  ok('3Dが読めないときは2Dの場面が画面いっぱいに出る', fc.full && fc.noScroll && await page.evaluate(`!!document.getElementById('rscene') && ${G}.U.tab==='explore'`), JSON.stringify(fc));
  await page.click('nav [data-tab="craft"]'); await page.click('#dock .dockx');
  await page.click('.node[data-id="twig"]'); await page.waitForTimeout(200);
  ok('2Dでもメニュー開閉後に採取できる', (await page.evaluate(`${G}.S.inv.twig||0`)) > 0);
  await page.click('.hud-tr [data-tab="world"]'); await page.waitForTimeout(150);
  await page.click('.pin[data-id="river"]'); await page.waitForTimeout(300);
  ok('2Dでは地図のピンで地域を移動できる', await page.evaluate(`${G}.U.region==='river' && ${G}.U.tab==='explore' && !!document.querySelector('#rscene .node[data-id="flint"]')`));
  ok('ページでエラーが起きていない（2D）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
