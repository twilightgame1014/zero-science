// ブラウザでの結合テスト。Three.js を使わず、描画モジュールと同じAPIを持つ「偽モジュール」を
// 差し込んで、ゲーム側の連携（探索ホーム・パネル・入力保護・移動・採取・建物の同期・セーブ）を検証する。
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

async function newPage(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  // CDN の three はテストでは読まない（偽モジュールを使う）
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(FAKE);
  await page.goto(url); await page.waitForTimeout(300);
  return { page, errors };
}

/* ---------------- スマホ縦（390×844） ---------------- */
{
  const { page, errors } = await newPage({ width: 390, height: 844 });
  ok('初回の案内がパネルより前に出て、背面は操作できない', await page.evaluate(`document.getElementById('modal').classList.contains('open') && document.getElementById('app').inert === true`));
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300);
  await page.click('.heropick[data-id="girl"]'); await page.click('#introGo'); await page.waitForTimeout(600);
  const home = await page.evaluate(`({tab:${G}.U.tab, dock:document.getElementById('dock').hidden, w3:!!document.getElementById('w3'), inert:document.getElementById('app').inert})`);
  ok('起動直後は探索ホーム（パネルは閉じている）', home.tab === 'explore' && home.dock && home.w3 && !home.inert, JSON.stringify(home));
  const init = await page.evaluate(`({state:${G}.W3.state, res:Object.keys(__FAKE.resources).length, nodes:${G}.NODES.length, girl:__FAKE.sprite===ASSETS.girl})`);
  ok('3Dフィールドが初期化され、全資源ノードが描画モジュールに渡る', init.state === 'ready' && init.res === init.nodes && init.nodes > 0, JSON.stringify(init));
  ok('主人公の選択（女の子）がスプライトに反映される', init.girl);
  const box = await page.evaluate(`(()=>{ const w=document.getElementById('w3').getBoundingClientRect(), n=document.getElementById('nav').getBoundingClientRect(), j=document.getElementById('joy').getBoundingClientRect();
    return {w3h:w.height, sep: w.bottom <= n.top + 0.5 && j.bottom <= n.top, navBtn: Math.min(...[...document.querySelectorAll('#nav button')].map(b=>b.getBoundingClientRect().height))}; })()`);
  ok('フィールドと下部タブが重ならず、スティックもタブの上にある', box.sep, JSON.stringify(box));
  ok('下部タブのボタンは高さ44px以上', box.navBtn >= 44, JSON.stringify(box));

  await page.click('.tchip[data-id="forest"]'); await page.waitForTimeout(5500);
  ok('移動ボタンで森林まで歩ける', await page.evaluate(`${G}.W3.region && ${G}.W3.region.id === 'forest'`));
  await page.click('.w3lab[data-n="forest:twig"]'); await page.waitForTimeout(2500);
  ok('名札タップで歩いて行って採取できる', (await page.evaluate(`${G}.S.inv.twig || 0`)) > 0);
  ok('発見の演出が描画モジュールに送られる', await page.evaluate(`__FAKE.effects.includes('discovery')`));

  // パネルを開くと入力が止まる
  await page.evaluate(`document.querySelector('#nav [data-tab="explore"]').focus()`);
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400);
  const p0 = await pos(page);
  await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(100);
  const p1 = await pos(page);
  await page.waitForTimeout(600);
  ok('キーを押したままパネルを開くと、その場で止まる', same(p1, await pos(page)) && !same(p0, { x: -20, z: 20 }));
  ok('スマホでパネルを開くと描画ループが止まる', await page.evaluate(`__FAKE.loop === false`));
  ok('研究室パネルに段階の背景イラストが表示される', await page.evaluate(`document.getElementById('stagebox').style.backgroundImage.startsWith('url("data:image/webp')`));
  ok('パネル表示中はフィールドが操作できない（inert）', await page.evaluate(`document.getElementById('view').inert === true`));
  await page.click('#dock .dockx'); await page.waitForTimeout(700);
  ok('閉じた瞬間に勝手に歩き出さない（押しっぱなしのキーは解除）', same(p1, await pos(page)));
  await page.keyboard.up('ArrowLeft');
  ok('閉じると描画ループが再開する', await page.evaluate(`__FAKE.loop === true`));

  // 移動予約の解除
  const wr = await page.evaluate(`(()=>{ const r=document.getElementById('w3').getBoundingClientRect(); return {x:r.left+r.width*0.2, y:r.top+r.height*0.75}; })()`);
  await page.mouse.click(wr.x, wr.y); await page.waitForTimeout(60);
  const hadTarget = await page.evaluate(`!!${G}.W3.target`);
  await page.click('nav [data-tab="craft"]'); await page.waitForTimeout(50);
  const p2 = await pos(page); await page.click('nav [data-tab="explore"]'); await page.waitForTimeout(800);
  ok('タップの移動予約は、パネルを開くと取り消される', hadTarget && same(p2, await pos(page)) && !(await page.evaluate(`${G}.W3.target`)));

  // Escape とフォーカス
  await page.click('nav [data-tab="craft"]'); await page.waitForTimeout(100);
  const f1 = await page.evaluate(`document.activeElement.id`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  const f2 = await page.evaluate(`({tab:${G}.U.tab, focus:document.activeElement.dataset.tab})`);
  ok('パネルを開くと見出しにフォーカスし、Escapeで閉じると開いたボタンに戻る', f1 === 'dockTitle' && f2.tab === 'explore' && f2.focus === 'craft', JSON.stringify({ f1, f2 }));

  // 図鑑の詳細モーダルはパネルの前面。Escape はモーダル → パネルの順
  await page.click('nav [data-tab="book"]'); await page.waitForTimeout(100);
  await page.click('.dx[data-id="twig"]'); await page.waitForTimeout(100);
  const m1 = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), z:+getComputedStyle(document.getElementById('modal')).zIndex > +getComputedStyle(document.getElementById('dock')).zIndex, inert:document.getElementById('app').inert})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  const m2 = await page.evaluate(`({open:document.getElementById('modal').classList.contains('open'), tab:${G}.U.tab, focus:document.activeElement.dataset.id})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok('図鑑の詳細はパネルの前に出て、Escapeはモーダル→パネルの順に閉じる', m1.open && m1.z && m1.inert && !m2.open && m2.tab === 'book' && m2.focus === 'twig' && (await page.evaluate(`${G}.U.tab`)) === 'explore', JSON.stringify({ m1, m2 }));

  // 目標リンク
  await page.click('nav [data-tab="map"]'); await page.waitForTimeout(100);
  const goBtn = await page.$('#mission .go[data-tab="explore"]');
  if (goBtn) await goBtn.click(); await page.waitForTimeout(100);
  ok('目標のボタンでパネルから探索に戻れる', !!goBtn && (await page.evaluate(`${G}.U.tab`)) === 'explore');

  // パネル開閉20回
  const before = await page.evaluate(`(()=>{ window.__C0=document.querySelector('#w3slot canvas'); return {inits:__FAKE.inits, canvases:document.querySelectorAll('canvas').length, w3:document.querySelectorAll('#w3').length, labels:document.getElementById('w3labels').children.length, pos:{x:${G}.W3.pos.x,z:${G}.W3.pos.z}}; })()`);
  for (let i = 0; i < 20; i++) { await page.click(`nav [data-tab="${['lab', 'craft', 'book', 'map', 'log'][i % 5]}"]`); await page.click('#dock .dockx'); }
  await page.waitForTimeout(400);
  const after = await page.evaluate(`({inits:__FAKE.inits, canvases:document.querySelectorAll('canvas').length, w3:document.querySelectorAll('#w3').length, labels:document.getElementById('w3labels').children.length, same:document.querySelector('#w3slot canvas')===window.__C0, loop:__FAKE.loop, raf:${G}.W3.raf>0, pos:{x:${G}.W3.pos.x,z:${G}.W3.pos.z}, starts:__FAKE.starts, stops:__FAKE.stops})`);
  ok('パネル開閉20回でもキャンバス・初期化・名札が増えず、同じ場所・同じキャンバスに戻る',
    after.inits === 1 && after.canvases === before.canvases && after.w3 === 1 && after.labels === before.labels && after.same && after.loop && after.raf && same(before.pos, after.pos), JSON.stringify({ before, after }));
  ok('描画ループの開始と停止が対になっている', after.starts === after.stops || after.starts === after.stops + 1, JSON.stringify(after));

  // 「もう一度」
  await page.evaluate(`(()=>{ const S=${G}.S, E=${G}.E; S.inv.campfire=1; S.inv.notebook=1; S.disc.campfire=S.disc.campfire||{first:Date.now(),made:1,total:1,routes:[],best:0}; S.disc.notebook=S.disc.notebook||{first:Date.now(),made:1,total:1,routes:[],best:0}; S.inv.twig=10; E.runExperiment(S,{twig:2},'campfire','burn',S.seq); })()`);
  const ash0 = await page.evaluate(`${G}.S.inv.ash||0`);
  await page.click('nav [data-tab="log"]'); await page.waitForTimeout(100);
  await page.click('#dockBody [data-act="again"]'); await page.waitForTimeout(2600);
  ok('記録の「もう一度」で研究室パネルが開き、実験が行われる', (await page.evaluate(`${G}.U.tab`)) === 'lab' && (await page.evaluate(`${G}.S.inv.ash||0`)) > ash0);
  await page.click('#dock .dockx');

  await page.evaluate(`(()=>{const W=${G}.W3; W.pos.x=42; W.pos.z=-22; W.target={x:42,z:-34};})()`); await page.waitForTimeout(2500);
  ok('未開放の地域（洞窟）には入れない', await page.evaluate(`Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34) >= 9`));
  await page.waitForTimeout(2200); await page.reload(); await page.waitForTimeout(600);
  const rl = await page.evaluate(`({pos:!!${G}.S.pos, hero:${G}.S.flags.hero, tab:${G}.U.tab, dock:document.getElementById('dock').hidden, at:${G}.W3.pos && Math.hypot(${G}.W3.pos.x-${G}.S.pos.x, ${G}.W3.pos.z-${G}.S.pos.z)})`);
  ok('再読込後も探索ホームから始まり、プレイヤー座標と主人公が復元される', rl.pos && rl.hero === 'girl' && rl.tab === 'explore' && rl.dock && rl.at < 0.05, JSON.stringify(rl));
  ok('ページでエラーが起きていない（スマホ）', errors.length === 0, errors.join('\n'));
  await page.close();
}

/* ---------------- PC（1366×768） ---------------- */
{
  const { page, errors } = await newPage({ width: 1366, height: 768 });
  await page.click('#introGo'); await page.waitForTimeout(600);
  await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(200);
  const pc = await page.evaluate(`(()=>{ const d=document.getElementById('dock').getBoundingClientRect(); return {loop:__FAKE.loop, dockW:d.width, left:d.left}; })()`);
  ok('PCではパネルが右側に開き、左にフィールドが見えたまま描画を続ける', pc.loop && pc.left > 500, JSON.stringify(pc));
  const p0 = await pos(page);
  await page.evaluate(`document.getElementById('dockBody').focus()`);
  await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
  ok('PCでもパネル表示中はキーで動かない', same(p0, await pos(page)));
  await page.mouse.click(200, 400); await page.waitForTimeout(300);
  ok('PCで背景（フィールド側）をクリックするとパネルが閉じ、そのクリックで歩き出さない', (await page.evaluate(`${G}.U.tab`)) === 'explore' && !(await page.evaluate(`${G}.W3.target`)) && same(p0, await pos(page)));
  await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
  ok('パネルを閉じるとキーで移動できる', !same(p0, await pos(page)));
  ok('ページでエラーが起きていない（PC）', errors.length === 0, errors.join('\n'));
  await page.close();
}

/* ---------------- 3Dが使えないとき（2D地図） ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.goto(url); await page.waitForTimeout(300); await page.click('#introGo');
  await page.waitForFunction(`${G}.W3.state==='failed'`, null, { timeout: 20000 }); await page.waitForTimeout(300);
  ok('3Dが読めないときは探索ホームが2Dの地図になる', await page.evaluate(`!!document.getElementById('field') && !!document.getElementById('rscene') && ${G}.U.tab==='explore'`));
  await page.click('nav [data-tab="craft"]'); await page.click('#dock .dockx');
  await page.click('.node[data-id="twig"]'); await page.waitForTimeout(200);
  ok('2Dの地図でもパネル開閉後に採取できる', (await page.evaluate(`${G}.S.inv.twig||0`)) > 0);
  ok('ページでエラーが起きていない（2D）', errors.length === 0, errors.join('\n'));
  await page.close();
}

await browser.close();
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
