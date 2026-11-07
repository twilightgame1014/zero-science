// ブラウザでの結合テスト。Three.js を使わず、描画モジュールと同じAPIを持つ「偽モジュール」を
// 差し込んで、ゲーム側の連携（全画面マップ・HUD・パネル・入力保護・移動・採取・建物の同期・セーブ）を検証する。
// 本物の3D描画の見た目は対象外（実WebGLでの確認は別に行うこと）。
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const utils = await build({ entryPoints: [path.join(root, 'src/graphics/utils.ts')], bundle: true, format: 'cjs', write: false, logLevel: 'warning' });
const FAKE = fs.readFileSync(path.join(root, 'tests/e2e/fake-hd2d.js'), 'utf8').replace('/*UTILS*/', utils.outputFiles[0].text);
const url = pathToFileURL(path.join(root, 'dist/index.html')).href;

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name} ${cond ? '' : extra}`); if (!cond) fail++; };
const G = 'window.__GAME__';
const pos = page => page.evaluate(`({x:${G}.W3.pos.x, z:${G}.W3.pos.z})`);
const same = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 0.01;
const browser = await chromium.launch();

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
      decor:JSON.stringify(__FAKE.opts.decor), girl:__FAKE.sprite===ASSETS.girl}; })()`);
  ok('3Dフィールドが初期化され、採取地点と、画面に入る自然物（ID・状態・当たり判定つき）だけが描画モジュールに渡る', init.state === 'ready' && init.deps && init.nat > 10 && init.natSent > 10 && init.natSent === init.natView, JSON.stringify(init));
  ok('描画モジュールには、木・岩などを独自の装飾として描かないよう伝える（連携契約）', init.decor === '{"trees":false,"rocks":false,"logs":false,"pebbles":false,"shrubs":false,"stonework":false}', init.decor);
  const pre = await page.evaluate(`({stonework: __FAKE.opts.decor.stonework, structs: Object.keys(__FAKE.structures)})`);
  ok('開始時の原野に人工物がない（石の階段・石積みの壁は decor.stonework:false で描かせず、建物は1つもない）', pre.stonework === false && pre.structs.length === 0, JSON.stringify(pre));
  ok('ボタン共通のスタイルが効いている', await page.evaluate(`getComputedStyle(document.querySelector('#nav button')).cursor==='pointer' && getComputedStyle(document.createElement('div')).color!==undefined`) && await page.evaluate(`(()=>{ const b=document.createElement('button'); b.className='btn'; document.body.appendChild(b); const c=getComputedStyle(b).backgroundColor; b.remove(); return c==='rgb(62, 107, 74)'; })()`));

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

  ok('主人公の選択（女の子）がスプライトに反映される', init.girl);
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
  ok('地図ボタンで地域選択が開き、行けない地域には理由が書いてある', /が必要/.test(lockTxt), lockTxt);
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
  ok('「メニュー」に図鑑・技術・記録・設定が文字付きの大きな項目で並ぶ', items.length === 4 && items.every(i => i.h >= 48) && items.map(i => i.t).join() === '図鑑,技術,記録,設定', JSON.stringify(items));
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

  const lockGo = await page.evaluate(`${G}.goTo3D(42,-34,null)`);
  await page.evaluate(`(()=>{const W=${G}.W3; W.pos={x:42,z:-22}; W.path=[{x:42,z:-34}];})()`); await page.waitForTimeout(2500);
  ok('未開放の地域（洞窟）へは移動先にできず、無理に向かっても入れない', lockGo === false && await page.evaluate(`Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34) >= 9`));
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
  ok('PCの下部中央ドックは 研究室／工作／図鑑／技術／記録（ツールチップ付き）', navT.join() === '研究室*,工作*,図鑑*,技術*,記録*' && await page.evaluate(`[...document.querySelectorAll('#nav button')].filter(b=>getComputedStyle(b).display!=='none').every(b=>b.querySelector('img.ico'))`), JSON.stringify(navT));
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
  const lab = await page.evaluate(`(()=>{ const d=document.getElementById('dock').getBoundingClientRect(), g=getComputedStyle(document.querySelector('#dockBody .labgrid')).gridTemplateColumns.split(' ').length; return {loop:__FAKE.loop, w:d.width, cols:g, size:document.getElementById('dock').dataset.size}; })()`);
  ok('PCの研究室は、実験台と材料・操作を左右に並べる広い画面', lab.size === 'wide' && lab.cols === 2 && lab.w > 1200, JSON.stringify(lab));
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
  // 角に押し付けて進めない：歩かない（キー・クリック移動の両方）
  await page.evaluate(`${G}.W3.pos={x:56,z:56}`); await page.waitForTimeout(200);
  const kc = await keyToward(1, 1); await since(); await page.keyboard.down(kc); await page.waitForTimeout(700); await page.keyboard.up(kc);
  const corner = await track();
  ok('歩行：壁（世界の角）に向かって入力しても、進めなければ歩かない', corner.length > 10 && corner.every(r => !r.m) && corner.every(r => Math.hypot(r.x - 56, r.z - 56) < 0.01), JSON.stringify(corner.filter(r => r.m).slice(0, 3)));
  await page.evaluate(`${G}.W3.pos={x:54.5,z:54.5}`); await page.waitForTimeout(200);
  await since(); await page.keyboard.down(kc); await page.waitForTimeout(900); await page.keyboard.up(kc);
  const hit = await track(); const atWall = hit.findIndex(r => Math.hypot(r.x - 56, r.z - 56) < 0.01);
  const lastWalk = hit.reduce((a, r, i) => r.m ? i : a, -1);
  ok('歩行：歩いて壁に着いたら、押し続けていても0.15秒以内に止まる', atWall > 0 && hit[atWall - 1].m && lastWalk >= 0 && hit[lastWalk].t - hit[atWall].t <= 150 && hit.slice(-5).every(r => !r.m), JSON.stringify({ atWall, lastWalk, dt: lastWalk >= 0 && atWall >= 0 ? hit[lastWalk].t - hit[atWall].t : null }));
  await since(); await page.evaluate(`(()=>{ ${G}.W3.path=[{x:59,z:59}]; })()`); await page.waitForTimeout(700);
  ok('歩行（移動予約）：予約があっても進めなければ歩かない', (await track()).every(r => !r.m));
  await page.evaluate(`(()=>{ ${G}.W3.path=null; ${G}.W3.target=null; })()`);
  // 木の幹にかすめるように当たって外周を滑っているときは歩き続ける（キーの実際の向きの線上に幹を置く）
  const kv = await page.evaluate(`(()=>{ const T=HD2D.THREE, cam=${G}.W3.gfx.getCamera(), v=new T.Vector3(); cam.getWorldDirection(v); let fx=v.x,fz=v.z; const l=Math.hypot(fx,fz); return {x:-fz/l, z:fx/l}; })()`); // ArrowRight の向き
  const tz = await page.evaluate(`(()=>{ const W=${G}.WORLD, k=${JSON.stringify(kv)}, px=-k.z, pz=k.x;
    const ok=(x,z)=>W.free(${G}.S,x,z) && !W.objects.concat(W.statics).some(o=>W.solid(${G}.S,o) && o!==t0 && Math.hypot(o.x-x,o.z-z)<o.r+1.2);
    let t0=null; for(const t of W.objects.filter(o=>o.kind==='tree')){ t0=t; let good=true; for(let s=-3; s<=3; s+=0.25){ const x=t.x+k.x*s+px*0.25, z=t.z+k.z*s+pz*0.25; if(Math.abs(s)>t.r+0.5 && !ok(x,z)){ good=false; break; } } if(good) break; t0=null; }
    ${G}.W3.pos={x:t0.x-k.x*3+px*0.25, z:t0.z-k.z*3+pz*0.25}; return {x:t0.x, z:t0.z}; })()`);
  await page.waitForTimeout(150);
  await since(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(800);
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
  ok('既定ではゲーム側からカメラ設定を渡さない（描画モジュールの既定値を使う）', await page.evaluate(`__FAKE.opts && __FAKE.opts.config === undefined`));
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
  const after = await page.evaluate(`(()=>{ const G=${G}, S=G.S, p=G.W3.pos; return {structs:Object.keys(__FAKE.structures).sort(), left:(__FAKE.opts.decor.stonework===false?[]:['Stonework']), st:G.E.stageOf(S),
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
    disc:Object.keys(G.S.disc).length, items:Object.keys(G.D.items).length, store:c.store.length, inv:Object.keys(G.S.inv).length, structs:Object.keys(__FAKE.structures).length,
    normal:localStorage.getItem('zero-kagaku-save'), url:location.search}; })()`);
  ok('検証モード：「検証モード：全解放」の表示があり、全物質が図鑑に・保管できる全素材が在庫にある（件数はデータから）',
    v0.V && v0.badge && /検証モード：全解放/.test(v0.badgeText) && v0.disc === v0.items && v0.inv === v0.store, JSON.stringify(v0).slice(0, 300));
  ok('検証モード：原野には建物を自動で置かない', v0.structs === 0);
  ok('検証モード：通常のセーブは書き換えない', v0.normal === normalSave);
  await page.click('#vbadge'); await page.waitForTimeout(400);
  const tbl = await page.evaluate(`[...document.querySelectorAll('.vtbl tr')].map(r=>r.textContent)`);
  const wantRows = await page.evaluate(`(()=>{ const D=${G}.D; return {procs:D.procs.length, crafts:D.crafts.length, regions:D.regions.length}; })()`);
  ok('検証メニュー：件数の表はいまのデータから作られる（研究・工作・地域）', tbl.some(t => t.includes('研究（反応）') && t.endsWith(String(wantRows.procs))) && tbl.some(t => t.includes('工作') && t.endsWith(String(wantRows.crafts))) && tbl.some(t => t.startsWith('地域') && t.endsWith(String(wantRows.regions))), JSON.stringify(tbl.slice(0, 6)));
  // 鍵のバイパスを切ると洞窟へ行けない（たいまつを捨てて確かめる）→ 戻すと行ける
  await page.evaluate(`(()=>{ const S=${G}.S; delete S.inv.torch; delete S.inv.candle; })()`);
  await page.click('input[data-act="v-flag"][data-id="locks"]'); await page.waitForTimeout(150);
  await page.click('[data-act="v-warp"][data-id="cave"]'); await page.waitForTimeout(300);
  const refused = await page.evaluate(`({tab:${G}.U.tab, far:Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34) > 9, banner:document.getElementById('banner').textContent})`);
  await page.click('input[data-act="v-flag"][data-id="locks"]'); await page.waitForTimeout(150);
  await page.click('[data-act="v-warp"][data-id="cave"]'); await page.waitForTimeout(400);
  const went = await page.evaluate(`({tab:${G}.U.tab, d:Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34)})`);
  ok('検証メニュー：鍵のバイパスを切ると洞窟へは移動できず、入れると移動できる', refused.far && /鍵/.test(refused.banner) && went.tab === 'explore' && went.d < 9, JSON.stringify({ refused, went }));
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
  const st1 = await page.evaluate(`Object.entries(__FAKE.structures).map(([k,v])=>k+':'+v.type)`);
  const col1 = await page.evaluate(`(()=>{ const G=${G}, t=G.WORLD.structures(); const w=t.find(o=>o.type==='waterwheel'); return {types:t.map(o=>o.type), wallAtCenter: w ? !G.WORLD.free(G.S,w.x,w.z) : null}; })()`);
  ok('置いた建物には structures.json の占有形状の当たり判定が付く（水車）。仕様のない橋は判定なし', col1.types.includes('waterwheel') && !col1.types.includes('bridge') && col1.wallAtCenter === true, JSON.stringify(col1));
  await page.click('[data-act="v-clearst"]'); await page.waitForTimeout(150);
  const st2 = await page.evaluate(`Object.keys(__FAKE.structures).length`);
  ok('建物を撤去すると、当たり判定も消える', await page.evaluate(`${G}.WORLD.structures().length===0`));
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
  ok('範囲外の ?camera は無視する', await page.evaluate(`__FAKE.opts.config === undefined`));
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

await browser.close();
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
