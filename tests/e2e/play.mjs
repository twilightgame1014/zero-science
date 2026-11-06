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
    return {state:${G}.W3.state, deps:${G}.NODES.every(n=>__FAKE.resources[n.vid]), nat:near.length, natSent:near.filter(o=>__FAKE.resources[o.id]&&__FAKE.resources[o.id].natural&&__FAKE.resources[o.id].natural.id===o.id).length,
      decor:JSON.stringify(__FAKE.opts.decor), girl:__FAKE.sprite===ASSETS.girl}; })()`);
  ok('3Dフィールドが初期化され、採取地点と周りの自然物（ID・状態・当たり判定つき）が描画モジュールに渡る', init.state === 'ready' && init.deps && init.nat > 10 && init.natSent === init.nat, JSON.stringify(init));
  ok('描画モジュールには、木・岩などを独自の装飾として描かないよう伝える（連携契約）', init.decor === '{"trees":false,"rocks":false,"logs":false,"pebbles":false,"shrubs":false}', init.decor);
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
  ok('スマホの下部ナビは「研究室・工作・メニュー」の3つで、高さ48px以上', navBtns.map(b => b.t).join() === '🧪研究室,🔨工作,☰メニュー' && navBtns.every(b => b.h >= 48), JSON.stringify(navBtns));
  ok('スティックは左下・採取ボタンは右下にあり、どちらも下部ナビの上で重ならない', joy.shown && act.shown && joy.b <= nav.t && act.b <= nav.t && !overlap(joy, act) && joy.l < 195 && act.r > 195 && act.w >= 48 && act.h >= 48, JSON.stringify({ joy, act, nav }));
  const tr = await page.evaluate(`[...document.querySelectorAll('.hud-tr button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>({t:b.textContent.trim(), w:b.getBoundingClientRect().width, h:b.getBoundingClientRect().height}))`);
  ok('右上は「地図・設定」の2つで、文字付き・48px以上', tr.map(b => b.t).join() === '🗺️地図,⚙️設定' && tr.every(b => b.w >= 48 && b.h >= 48), JSON.stringify(tr));
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
  ok('タッチがキャンセルされると、スティックの移動が止まる', await page.evaluate(`!${G}.W3.joy && document.querySelector('#joy .knob').style.transform===''`));

  // パネルを開くと入力が止まる
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400);
  await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(100);
  const p1 = await pos(page); await page.waitForTimeout(600);
  ok('キーを押したままメニューを開くと、その場で止まる', same(p1, await pos(page)));
  ok('スマホで全高の研究室を開くと描画ループが止まる', await page.evaluate(`__FAKE.loop === false`));
  const dk = await rect(page, '#dock');
  ok('研究室はマップの上に重なる（マップは縮まない）', (await fullCheck(page)).full && dk.t < 60 && Math.round(dk.b) <= Math.round(nav.t) + 1, JSON.stringify(dk));
  ok('研究室は画像を使わず、SVGで描いた実験台と手順を表示する（研究室の画像は埋め込まない）', await page.evaluate(`!!document.querySelector('#stagebox svg#scene') && !document.getElementById('stagebox').style.backgroundImage.includes('url') && !Object.keys(ASSETS).some(k=>/^lab/.test(k)) && document.querySelectorAll('#labSteps li').length===5`));
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
  ok('PCの下部中央ドックは 研究室／工作／図鑑／技術／記録（ツールチップ付き）', navT.join() === '🧪研究室*,🔨工作*,📖図鑑*,🕸️技術*,📓記録*', JSON.stringify(navT));
  const dockR = await rect(page, '#nav');
  ok('ドックは画面下部の中央にある', Math.abs((dockR.l + dockR.r) / 2 - 683) < 4 && dockR.b <= 768 && dockR.b > 700, JSON.stringify(dockR));
  ok('PCでは仮想スティックを表示しない', !(await rect(page, '#joy')).shown);
  const tr = await page.evaluate(`[...document.querySelectorAll('.hud-tr button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>b.textContent.trim())`);
  ok('PCの右上は 地図・拠点・設定', tr.join() === '🗺️地図,🏠拠点,⚙️設定', JSON.stringify(tr));
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
  await page.mouse.click(683, 300); await page.waitForTimeout(60);
  ok('マップのクリックで移動先が決まる', await page.evaluate(`!!${G}.W3.target`));
  await page.click('.hud-tr [data-tab="settings"]'); await page.waitForTimeout(150);
  ok('設定にタイトル・説明・主人公・表示・遊び方がまとまっている', await page.evaluate(`(()=>{ const t=document.getElementById('dockBody').textContent; return /ゼロからの科学/.test(t) && /主人公/.test(t) && /遊び方/.test(t) && !!document.querySelector('#dockBody [data-act="view2d"]'); })()`));
  ok('既定ではゲーム側からカメラ設定を渡さない（描画モジュールの既定値を使う）', await page.evaluate(`__FAKE.opts && __FAKE.opts.config === undefined`));
  ok('ページでエラーが起きていない（PC）', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ---------------- PC（1920×1080） ---------------- */
{
  const { page, errors, ctx } = await newPage({ width: 1920, height: 1080 }, false);
  await page.click('#introGo'); await page.waitForTimeout(400);
  const fc = await fullCheck(page);
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
