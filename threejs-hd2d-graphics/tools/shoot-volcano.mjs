/**
 * Volcano-round screenshot driver: opens demo/verify.html at exact
 * viewpoints and saves PNGs. Usage:
 *   node tools/shoot-volcano.mjs <tag> [shot,shot,...]
 * tag = before | after (output folder). Server must already run on
 * 127.0.0.1:5173 (vite dev, module root).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const req = createRequire('/home/hatch/workspace/your_files/science-civilization-game/package.json');
const { chromium } = req('playwright');

const tag = process.argv[2] ?? 'before';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const OUT = `/home/hatch/workspace/your_files/science-civilization-game-verification/volcano-2026-11-11/${tag}`;
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ['far',        { x: -100, z: -92, yaw: 45, pitch: 32, view: 34 }],
  ['foot',       { x: -106, z: -98, yaw: 45, pitch: 26, view: 16 }],
  ['flank',      { x: -113.3, z: -104.5, yaw: 45, pitch: 32, view: 13 }],
  ['rim',        { x: -119.5, z: -110.2, yaw: 45, pitch: 32, view: 13 }],
  ['low-45',     { x: -113.3, z: -104.5, yaw: 45, pitch: 6, view: 13 }],
  ['low-135',    { x: -113.3, z: -104.5, yaw: 135, pitch: 6, view: 13 }],
  ['low-225',    { x: -113.3, z: -104.5, yaw: 225, pitch: 6, view: 13 }],
  ['low-315',    { x: -113.3, z: -104.5, yaw: 315, pitch: 6, view: 13 }],
  ['silhouette', { x: -113, z: -104, yaw: 45, pitch: 5, view: 26, dist: 200, ty: 20 }],
  ['kit-flank',  { x: -113.3, z: -104.5, yaw: 45, pitch: 32, view: 13, kit: 1 }],
  ['kit-rim',    { x: -119.5, z: -110.2, yaw: 45, pitch: 32, view: 13, kit: 1 }],
];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  proxy: process.env.https_proxy ? { server: process.env.https_proxy, bypass: '127.0.0.1,localhost' } : undefined,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

for (const [name, p] of SHOTS) {
  if (only && !only.includes(name)) continue;
  const qs = new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]));
  const url = `http://127.0.0.1:${process.env.PORT ?? 5173}/verify.html?${qs}`;
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => (window).__ready === true, null, { timeout: 60000 });
  if (p.kit) await page.waitForFunction(() => (window).__kitReady === true, null, { timeout: 60000 });
  // Camera settle: poll the view until two consecutive reads agree.
  let last = '';
  let stable = 0;
  for (let i = 0; i < 40 && stable < 2; i++) {
    const v = await page.evaluate(() => {
      const c = (window).gfx.getCameraView();
      return [c.yawDegrees.toFixed(1), c.pitchDegrees.toFixed(1), c.viewSize.toFixed(2)].join('/');
    });
    stable = v === last ? stable + 1 : 0;
    last = v;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2600); // chunk build + texture upload at SwiftShader fps
  await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 600000 });
  console.log('shot', name, last);
}
await browser.close();
console.log('DONE', tag);
