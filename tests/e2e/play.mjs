// ブラウザでの結合テスト。Three.js を使わず、描画モジュールと同じAPIを持つ「偽モジュール」を
// 差し込んで、ゲーム側の連携（移動・採取・建物の同期・セーブ）を検証する。
// 本物の3D描画の見た目は対象外（手元のブラウザで確認すること）。
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
// CDN の three はテストでは読まない（偽モジュールを使う）
await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
await page.addInitScript(FAKE);
await page.goto(url); await page.waitForTimeout(300);
await page.click('.heropick[data-id="girl"]'); await page.click('#introGo');
await page.click('nav [data-tab="explore"]'); await page.waitForTimeout(600);
const G = 'window.__GAME__';
const init = await page.evaluate(`({state:${G}.W3.state, res:Object.keys(__FAKE.resources).length, nodes:${G}.NODES.length, girl:__FAKE.sprite===ASSETS.girl})`);
ok('3Dフィールドが初期化され、全資源ノードが描画モジュールに渡る', init.state === 'ready' && init.res === init.nodes && init.nodes > 0, JSON.stringify(init));
ok('主人公の選択（女の子）がスプライトに反映される', init.girl);
await page.click('.tchip[data-id="forest"]'); await page.waitForTimeout(5500);
ok('移動ボタンで森林まで歩ける', await page.evaluate(`${G}.W3.region && ${G}.W3.region.id === 'forest'`));
await page.click('.w3lab[data-n="forest:twig"]'); await page.waitForTimeout(2500);
ok('名札タップで歩いて行って採取できる', (await page.evaluate(`${G}.S.inv.twig || 0`)) > 0);
ok('発見の演出が描画モジュールに送られる', await page.evaluate(`__FAKE.effects.includes('discovery')`));
await page.evaluate(`(()=>{const W=${G}.W3; W.pos.x=42; W.pos.z=-22; W.target={x:42,z:-34};})()`); await page.waitForTimeout(2500);
ok('未開放の地域（洞窟）には入れない', await page.evaluate(`Math.hypot(${G}.W3.pos.x-42, ${G}.W3.pos.z+34) >= 9`));
await page.click('nav [data-tab="lab"]'); await page.waitForTimeout(200);
ok('探検タブを離れると描画ループが止まる', await page.evaluate(`__FAKE.loop === false`));
ok('研究室に段階の背景イラストが表示される', await page.evaluate(`document.getElementById('stagebox').style.backgroundImage.startsWith('url("data:image/webp')`));
await page.waitForTimeout(2200); await page.reload(); await page.waitForTimeout(400);
ok('プレイヤー座標と主人公がセーブされる', await page.evaluate(`!!${G}.S.pos && ${G}.S.flags.hero === 'girl'`));
ok('ページでエラーが起きていない', errors.length === 0, errors.join('\n'));
await browser.close();
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
