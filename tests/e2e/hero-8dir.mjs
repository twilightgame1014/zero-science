// npm run build の後に実行。本物のWebGL・シート・移動処理を使う。
// CHROMIUM_EXECUTABLE_PATH で既存Chromiumも指定できる。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selectedHero = process.argv.find(a => a.startsWith('--hero='))?.slice(7);
assert.ok(selectedHero === undefined || ['boy', 'girl'].includes(selectedHero), 'invalid --hero');
const motionOnly = process.argv.includes('--motion-only');
const suited = process.argv.includes('--suit');
const html = await fs.readFile(path.join(root, 'dist/index.html'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  for (const hero of selectedHero ? [selectedHero] : ['boy', 'girl']) {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 360 }, hasTouch: true });
    try {
      // 同じ固定版のThree.jsをローカル依存から配信する。描画自体は差し替えない。
      await ctx.route('https://cdn.jsdelivr.net/npm/three@0.180.0/**', async route => {
        const prefix = '/npm/three@0.180.0/';
        const relative = new URL(route.request().url()).pathname.slice(prefix.length);
        const base = path.join(root, 'node_modules/three');
        const file = path.resolve(base, relative);
        assert.ok(file.startsWith(base + path.sep));
        await route.fulfill({ path: file, contentType: 'text/javascript' });
      });
      await ctx.route('https://fonts.googleapis.com/**', route => route.abort());
      const page = await ctx.newPage();
      page.setDefaultTimeout(60000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.click(`.heropick[data-id="${hero}"]`);
      await page.click('#introGo');
      await page.waitForFunction(() => __GAME__.W3.state === 'ready');
      if(suited){
        await page.evaluate(()=>{__GAME__.S.space.suit=true;});
        await page.waitForFunction(()=>/Suit$/.test(__GAME__.W3.spaceHeroKey));
        await page.waitForFunction(hero=>__GAME__.W3.gfx.character.player.texture.image.src===ASSETS[hero+'Suit'],hero);
      }
      const initial = await page.evaluate(() => {
        const g = __GAME__, p = g.W3.gfx.character.player;
        return { diag: HD2D.diag8Check(), dirs: g.hero.dirs(), rows: p.sheetRows,
          size: [p.texture.image.width, p.texture.image.height], facing: p.state.facing };
      });
      assert.equal(initial.diag.ok, true);
      assert.deepEqual(initial.diag.stuck, []);
      assert.equal(initial.dirs, 8);
      assert.equal(initial.rows, 8);
      assert.deepEqual(initial.size, [1024, 2048]);
      assert.equal(typeof initial.facing, 'number');
      console.log(`${hero}${suited?' suit':''}: diag8Check PASS / 1024×2048 / 8 rows / continuous facing`);

      // 実描画に渡った状態・UVを読む。privateメンバー参照は検証専用。
      const state = () => page.evaluate(() => {
        const w = __GAME__.W3, p = w.gfx.character.player;
        return { row: p.currentRow, facing: p.state.facing, face: w.face, moving: p.state.moving,
          speed: p.state.speed, x: w.pos.x, z: w.pos.z, frame: p.texture.offset.x * 4 };
      });
      const place = async () => page.evaluate(() => {
        const g = __GAME__, w = g.W3;
        w.keys = {}; w.joy = null; w.path = null; w.target = null; w.intent = null;
        w.pos = { x: -12, z: 24 }; w.walk = { on: false, slow: 0 }; w.walkSpeed = 0;
      });
      const camera = async yaw => {
        await page.evaluate(yaw => { const c = __GAME__.W3.cam; c.yaw = c.cy + (((yaw - c.cy) % 360 + 540) % 360 - 180); }, yaw);
        await page.waitForFunction(yaw => {
          const c = __GAME__.W3.cam;
          return Math.abs(((c.cy - yaw) % 360 + 540) % 360 - 180) < 0.5;
        }, yaw);
      };
      const inputs = [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
      for (const yaw of motionOnly ? [] : [20, 45, 200]) {
        await camera(yaw);
        const rows = [];
        for (const [x,y] of inputs) {
          await place();
          await page.evaluate(([x,y]) => { __GAME__.W3.joy = { x, y }; }, [x,y]);
          await page.waitForFunction(([x,y]) => {
            const w = __GAME__.W3, p = w.gfx.character.player;
            const v = new HD2D.THREE.Vector3(); w.gfx.getCamera().getWorldDirection(v);
            let rel = Math.atan2(x,y); if(rel<0) rel+=Math.PI*2;
            const row = [0,4,2,6,3,7,1,5][Math.round(rel/(Math.PI/4))%8];
            const diff = w.face-Math.atan2(-v.x,-v.z)-Math.atan2(x,y);
            return p.state.moving && p.state.facing===w.face && Math.abs(Math.atan2(Math.sin(diff),Math.cos(diff)))<0.03 && p.currentRow===row;
          }, [x,y], { timeout: 15000 }).catch(async error => {
            console.error('direction diagnostics', { hero, yaw, x, y, state: await state(),
              field: await page.evaluate(() => ({ joy: __GAME__.W3.joy, tab: __GAME__.U.tab, cam: __GAME__.W3.cam })) });
            throw error;
          });
          const walking = await state();
          assert.equal(walking.moving, true);
          assert.ok(walking.speed > 0);
          assert.equal(walking.facing, walking.face);
          rows.push(walking.row);
          await page.evaluate(() => { __GAME__.W3.joy = null; });
          await page.waitForFunction(() => {
            const p = __GAME__.W3.gfx.character.player;
            return !p.state.moving && p.texture.offset.x === 0;
          });
          const stopped = await state();
          assert.ok(Math.abs(Math.atan2(Math.sin(stopped.face-walking.face),Math.cos(stopped.face-walking.face)))<1e-6,'stopping preserves direction within floating-point precision');
          assert.equal(stopped.speed, 0);
          assert.equal(stopped.frame, 0);
        }
        assert.equal(new Set(rows).size, 8, `${hero}: yaw=${yaw}, rows=${rows}`);
        console.log(`${hero}: yaw ${yaw}° / 8 directions + stop PASS (${rows})`);
      }
      // 衝突処理へ渡る移動要求の速度で正規化を確認する（壁への押し出し量は速度に数えない）。
      await camera(45);
      await page.evaluate(() => {
        const w = __GAME__.W3, world = __GAME__.WORLD;
        const oldMove = world.move;
        // 同じmoveへ委譲し、ゲームが使ったdtと実移動量だけを計測する。
        const runs = [];
        window.__measure8 = { runs, active: null };
        world.move = function(...args) {
          const result = oldMove.apply(this, args), run = window.__measure8.active;
          if (run && args[1] === w.pos) {
            run.distance += Math.hypot(result.x - args[1].x, result.z - args[1].z);
            run.requested += Math.hypot(args[2], args[3]);
            run.seconds += Math.min(__GAME__.walk.maxDt, (w.lastTs-run.lastTs)/1000); run.lastTs=w.lastTs; run.frames++;
          }
          return result;
        };
      });
      for (const joy of [{x:0,y:1},{x:1,y:1}]) {
        await place();
        await page.evaluate(joy => {
          const m = window.__measure8; m.active = { distance: 0, requested: 0, frames: 0, seconds: 0, lastTs: __GAME__.W3.lastTs };
          m.runs.push(m.active); __GAME__.W3.joy = joy;
        }, joy);
        await page.waitForFunction(() => __measure8.active.frames >= 8);
        await page.evaluate(() => { __measure8.active = null; __GAME__.W3.joy = null; });
      }
      const runs = await page.evaluate(() => __measure8.runs);
      const rates = runs.map(r => r.requested / r.seconds), WS = await page.evaluate(() => __GAME__.walk.speed);
      assert.ok(rates.every(r => Math.abs(r-WS) < 0.1) && Math.abs(rates[1]/rates[0]-1)<0.01, JSON.stringify(runs));
      console.log(`${hero}: diagonal speed normalized PASS`);

      // 行き止まり（崖・岩・水に正面から当たり、横にも滑れない所）へ押し続ける（実際の衝突判定）。動けない間は最後の向きを保つ。
      // 2026-11-11：地域の鍵を廃止したので、以前の「未開放地域の壁」の代わりに、移動の処理で進めない所を探す
      await page.evaluate(() => {
        const g = __GAME__, w = g.W3, world = g.WORLD;
        for (let x = -40; x <= 40; x += 1.3) for (let z = -40; z <= 40; z += 1.3) { if (!world.free(g.S, x, z)) continue;
          for (let a = 0; a < Math.PI*2; a += Math.PI/8) {
            const mx = Math.cos(a), mz = Math.sin(a); let from = { x, z };
            for (let i = 0; i < 12; i++) { const r = world.move(g.S, from, mx*0.3, mz*0.3); from = { x: r.x, z: r.z }; }
            const q = world.move(g.S, from, mx*0.1, mz*0.1);
            if (Math.hypot(q.x-from.x, q.z-from.z) < 0.000001) {
              w.pos = from; w.face = 1.234; w.keys = {}; w.path = null;
              // 入力はカメラ基準なので、ワールドの向き (mx,mz) を逆変換する。
              const v = new HD2D.THREE.Vector3(); w.gfx.getCamera().getWorldDirection(v);
              const l = Math.hypot(v.x, v.z); const fx = v.x/l, fz = v.z/l;
              w.joy = { x: mx*-fz+mz*fx, y: -(mx*fx+mz*fz) };
            // 最初の数コマで壁に寄り切ってから（ここでは少し進むので向きが変わってよい）、向きを決まった値にして押し続ける
            setTimeout(() => { w.face = 1.234; }, 600); return;
            }
          } }
        throw new Error('wall test position not found');
      });
      await page.waitForFunction(() => {
        const p = __GAME__.W3.gfx.character.player;
        return !p.state.moving && p.state.speed === 0 && p.state.facing === 1.234;
      }, null, { timeout: 60000 }).catch(async e => { console.log('blocked-state', JSON.stringify(await page.evaluate(() => { const w = __GAME__.W3, p = w.gfx.character.player; return { pos: w.pos, joy: w.joy, face: w.face, st: { m: p.state.moving, s: p.state.speed, f: p.state.facing }, tab: __GAME__.U.tab, act: !!w.work }; }))); throw e; });
      const blocked = await state();
      assert.equal(blocked.moving, false);
      assert.equal(blocked.speed, 0);
      assert.equal(blocked.face, 1.234);
      await page.evaluate(() => { __GAME__.W3.joy = null; });
      console.log(`${hero}: blocked / moving=false / facing retained PASS`);
      await place();
      await page.evaluate(() => { __GAME__.W3.face = 0; });
      const cameraRows = [];
      for (let i = 0; i < 8; i++) {
        await camera(i * 45);
        await page.waitForFunction(() => {
          const w = __GAME__.W3, p = w.gfx.character.player, v = new HD2D.THREE.Vector3();
          w.gfx.getCamera().getWorldDirection(v);
          let rel = -Math.atan2(-v.x,-v.z); if(rel<0) rel+=Math.PI*2;
          return !p.state.moving && p.currentRow===[0,4,2,6,3,7,1,5][Math.round(rel/(Math.PI/4))%8];
        });
        const s = await state();
        assert.equal(s.face, 0);
        assert.equal(s.moving, false);
        cameraRows.push(s.row);
      }
      assert.equal(new Set(cameraRows).size, 8, JSON.stringify(cameraRows));
      assert.deepEqual(errors, []);
      console.log(`${hero}: stationary camera orbit / 8 rows PASS (${cameraRows})`);
      await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
      await page.screenshot({ path: path.join(root, `test-results/hero-8dir-${hero}.png`) });
    } finally { await ctx.close(); }
  }
  console.log(motionOnly ? 'ALL SELECTED MOTION CHECKS PASS (direction sweep not run)' : 'ALL SELECTED REAL WEBGL 8DIR CHECKS PASS');
} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
