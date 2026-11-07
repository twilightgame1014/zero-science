/**
 * Demo harness — NOT part of the graphics module.
 *
 * It feeds the graphics engine with fake state so the rendering can be
 * verified standalone. The keyboard driver below exists only here;
 * the real game logic (Claude's side) will call the same public API
 * from its own state instead.
 */
import {
  initializeGraphics,
  type Direction,
  type GraphicsEngine,
  type PlayerVisualState,
} from '../src/graphics/index';
import { buildVillage } from './village';
import boySpriteUrl from '../assets/characters/player-spritesheet-boy.png?url';
import girlSpriteUrl from '../assets/characters/player-spritesheet-girl.png?url';
import grassDetailUrl from '../assets/textures/grass-detail.png?url';
import particleUrl from '../assets/textures/particle-dot.png?url';
import shadowUrl from '../assets/textures/shadow-blob.png?url';

const container = document.getElementById('app')!;
const status = document.getElementById('status')!;

const gfx: GraphicsEngine = await initializeGraphics(container, {
  playerSpriteUrl: boySpriteUrl,
  grassDetailUrl,
  particleTextureUrl: particleUrl,
  shadowTextureUrl: shadowUrl,
  // Sample plot (see PLOT_NODES below): a 12 m square kept free of
  // scenery so game-owned natural objects stand there alone.
  decor: { clearings: [{ x: -38, z: 30, r: 9 }] },
  onContextLost: () => {
    status.textContent = 'WebGLコンテキストが失われました（復旧を試みます）';
  },
  onContextRestored: () => {
    status.textContent = 'WebGLコンテキストが復旧しました';
  },
});

// Verification hook: lets headless screenshot scripts inspect the
// scene graph (draw items, instancing) — demo only, not the module.
(window as unknown as { gfx: GraphicsEngine }).gfx = gfx;

// Demo-only village set dressing on the plateau (not part of the
// module; in production these arrive via addStructureVisual instead).
buildVillage(gfx.getScene());
// Golden-hour light to show the HD-2D look.
gfx.setWorldVisualState({ timeOfDay: 0.44 });

/* ---------------- fake game state (demo only) ---------------- */
const player = {
  x: -20,
  z: 20,
  direction: 'down' as Direction,
  moving: false,
};
const SPEED = 5.2;
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) e.preventDefault();
  keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// A few logic-owned resource nodes, mirrored into the renderer.
gfx.updateResourceVisual('demo-tree-1', {
  position: { x: -31.5, z: 21 },
  type: 'tree',
  scale: 1.15,
});
gfx.updateResourceVisual('demo-rock-1', {
  position: { x: -10.5, z: 15.5 },
  type: 'rock',
});
gfx.updateResourceVisual('demo-herb-1', {
  position: { x: -14.5, z: 21.5 },
  type: 'herb',
  highlighted: true,
});
gfx.updateResourceVisual('demo-clay-1', {
  position: { x: 6, z: 30 },
  type: 'clay',
});

/* -------- sample plot （見本区画） --------
 * A 12 m × 12 m plot centred on (-38, 30), kept scenery-free via
 * decor.clearings above and populated ONLY through setNaturalObjects
 * with nature.js-format ids ("kind:x,z" in 0.1-unit coordinates).
 * This is the reference layout for re-wiring movement / collision /
 * harvest / save checks against known objects (INTEGRATION §18). */
gfx.setNaturalObjects([
  { id: 'tree:-425,260', position: { x: -42.5, z: 26 }, type: 'tree', scale: 1.15 },
  { id: 'tree:-340,255', position: { x: -34, z: 25.5 }, type: 'tree', scale: 0.95 },
  { id: 'rock:-435,340', position: { x: -43.5, z: 34 }, type: 'rock' },
  { id: 'ore:-330,335', position: { x: -33, z: 33.5 }, type: 'ore' },
  { id: 'bush:-385,350', position: { x: -38.5, z: 35 }, type: 'bush' },
  { id: 'grass:-405,300', position: { x: -40.5, z: 30 }, type: 'grass' },
  { id: 'grass:-360,290', position: { x: -36, z: 29 }, type: 'grass' },
  { id: 'grass:-395,325', position: { x: -39.5, z: 32.5 }, type: 'grass', depleted: true },
  { id: 'herb:-380,265', position: { x: -38, z: 26.5 }, type: 'herb', highlighted: true },
  { id: 'flowers:-365,320', position: { x: -36.5, z: 32 }, type: 'flowers' },
  { id: 'branch:-410,330', position: { x: -41, z: 33 }, type: 'branch' },
  { id: 'pebble:-345,305', position: { x: -34.5, z: 30.5 }, type: 'pebble', natural: { kind: 'pebble', variant: 'flint' } },
  { id: 'water:-430,295', position: { x: -43, z: 29.5 }, type: 'water' },
  { id: 'oil:-335,270', position: { x: -33.5, z: 27 }, type: 'oil' },
]);
gfx.addStructureVisual('demo-campfire-0', 'campfire', { x: -14.8, z: 18.6 });

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Screen-relative movement: camera yaw is 45°, so screen-up on the
  // ground plane is (-0.707, -0.707) and screen-right is (0.707, -0.707).
  let ix = 0;
  let iz = 0;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (keys.has('w') || keys.has('arrowup')) iz += 1;
  if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
  const len = Math.hypot(ix, iz);
  player.moving = len > 0;
  if (player.moving) {
    const nx = ix / len;
    const nz = iz / len;
    const mx = nx * 0.707 + nz * -0.707;
    const mz = nx * -0.707 + nz * -0.707;
    player.x += mx * SPEED * dt;
    player.z += mz * SPEED * dt;
    player.x = Math.max(-56, Math.min(56, player.x));
    player.z = Math.max(-56, Math.min(56, player.z));
    player.direction =
      Math.abs(mx) > Math.abs(mz)
        ? mx > 0
          ? 'right'
          : 'left'
        : mz > 0
          ? 'down'
          : 'up';
  }

  const state: PlayerVisualState = {
    position: { x: player.x, z: player.z },
    direction: player.direction,
    moving: player.moving,
  };
  gfx.setPlayerVisualState(state);
}
requestAnimationFrame(frame);

/* ---------------- HUD wiring (demo only) ---------------- */
let counter = 1;
const place = (type: string) => () => {
  const id = `demo-${type}-${counter++}`;
  gfx.addStructureVisual(id, type, {
    x: player.x + 2.2,
    z: player.z + 0.5,
  });
  gfx.playVisualEffect('sparkle', { x: player.x + 2.2, z: player.z + 0.5 });
};
document.getElementById('btn-campfire')!.addEventListener('click', place('campfire'));
document.getElementById('btn-workbench')!.addEventListener('click', place('workbench'));
document.getElementById('btn-kiln')!.addEventListener('click', place('kiln'));
document.getElementById('btn-effect')!.addEventListener('click', () => {
  gfx.playVisualEffect('discovery', { x: player.x, z: player.z });
});
let treeDepleted = false;
document.getElementById('btn-deplete')!.addEventListener('click', (e) => {
  treeDepleted = !treeDepleted;
  gfx.updateResourceVisual('demo-tree-1', {
    position: { x: -31.5, z: 21 },
    type: 'tree',
    scale: 1.15,
    depleted: treeDepleted,
  });
  (e.target as HTMLButtonElement).textContent = treeDepleted
    ? '木を元に戻す'
    : '木を採取済みにする';
});
let currentChara: 'boy' | 'girl' = 'boy';
document.getElementById('btn-chara')!.addEventListener('click', async (e) => {
  currentChara = currentChara === 'boy' ? 'girl' : 'boy';
  await gfx.setPlayerSpriteSheet(currentChara === 'boy' ? boySpriteUrl : girlSpriteUrl);
  (e.target as HTMLButtonElement).textContent =
    currentChara === 'boy' ? '主人公を女の子に切替' : '主人公を男の子に切替';
  gfx.playVisualEffect('sparkle', { x: player.x, z: player.z });
});
// Water sample viewpoint: stand on the west bank at z=6, where the
// channel bends — shallows, bed pebbles, foam edge and deep water all
// fit in one frame (2026-11-06 water pass verification).
document.getElementById('btn-river')!.addEventListener('click', () => {
  player.x = 15.4;
  player.z = 6;
  player.moving = false;
});
document.getElementById('btn-plot')!.addEventListener('click', () => {
  player.x = -38;
  player.z = 31.5;
  player.moving = false;
});
// World-expansion verification (2026-11-07): forest kit variants and
// the 360° orbit camera. The kit nodes are placed at fixed spots SW of
// the village; the player is moved next to them for inspection.
let kitPlaced = false;
document.getElementById('btn-forest-kit')!.addEventListener('click', (e) => {
  kitPlaced = !kitPlaced;
  const put = (id: string, st: object | null) => gfx.updateResourceVisual(id, st as never);
  if (kitPlaced) {
    put('demo-conifer-1', { position: { x: -26, z: 26 }, type: 'tree', scale: 1.1, natural: { kind: 'tree', variant: 'conifer' } });
    put('demo-conifer-2', { position: { x: -28.6, z: 23.4 }, type: 'tree', scale: 0.8, natural: { kind: 'tree', variant: 'conifer' } });
    put('demo-log-1', { position: { x: -24, z: 21.5 }, type: 'branch', scale: 1, natural: { kind: 'branch', variant: 'log' } });
    put('demo-mossy-1', { position: { x: -22.4, z: 24.8 }, type: 'rock', scale: 1.1, natural: { kind: 'rock', variant: 'mossy' } });
    player.x = -24.6;
    player.z = 27.8;
    player.moving = false;
  } else {
    for (const id of ['demo-conifer-1', 'demo-conifer-2', 'demo-log-1', 'demo-mossy-1']) put(id, null);
  }
  (e.target as HTMLButtonElement).textContent = kitPlaced ? '森林キットを消す' : '森林キットを置く';
});
// GPT expansion kit (2026-11-07 round 17): conifer species, snow
// set, palm, shore plants and the lava pool, placed around the
// forest-kit plot and the river sample for inspection.
let expKitPlaced = false;
const EXP_KIT_IDS = [
  'demo-exp-cedar', 'demo-exp-pine', 'demo-exp-young', 'demo-exp-snowconifer',
  'demo-exp-winter', 'demo-exp-palm', 'demo-exp-snowbush', 'demo-exp-drybush',
  'demo-exp-lava', 'demo-exp-reed', 'demo-exp-lily',
];
document.getElementById('btn-expansion-kit')!.addEventListener('click', (e) => {
  expKitPlaced = !expKitPlaced;
  const put = (id: string, st: object | null) => gfx.updateResourceVisual(id, st as never);
  if (expKitPlaced) {
    put('demo-exp-cedar', { position: { x: -30.5, z: 28.5 }, type: 'tree', scale: 1.05, natural: { kind: 'tree', variant: 'conifer' } });
    put('demo-exp-pine', { position: { x: -33.5, z: 25.5 }, type: 'tree', scale: 1.1, natural: { kind: 'tree', variant: 'conifer' } });
    put('demo-exp-young', { position: { x: -28.2, z: 30.5 }, type: 'tree', scale: 0.9, natural: { kind: 'tree', variant: 'conifer' } });
    put('demo-exp-snowconifer', { position: { x: -35.5, z: 29 }, type: 'tree', scale: 1.05, natural: { kind: 'tree', variant: 'conifer-snow' } });
    put('demo-exp-winter', { position: { x: -31, z: 32.5 }, type: 'tree', scale: 1, natural: { kind: 'tree', variant: 'winter' } });
    put('demo-exp-palm', { position: { x: -25.5, z: 31 }, type: 'tree', scale: 1, natural: { kind: 'tree', variant: 'palm' } });
    put('demo-exp-snowbush', { position: { x: -33.8, z: 31.8 }, type: 'bush', scale: 1.1, natural: { kind: 'bush', variant: 'snow' } });
    put('demo-exp-drybush', { position: { x: -27, z: 33.2 }, type: 'bush', scale: 1, natural: { kind: 'bush', variant: 'dry' } });
    put('demo-exp-lava', { position: { x: -36.5, z: 24 }, type: 'lava', scale: 1.2, natural: { kind: 'lava' } });
    put('demo-exp-reed', { position: { x: 14.9, z: 4.6 }, type: 'grass', scale: 1.1, natural: { kind: 'grass', variant: 'reed' } });
    put('demo-exp-lily', { position: { x: 18.6, z: 6.4 }, type: 'lily', scale: 1, natural: { kind: 'lily' } });
    player.x = -30;
    player.z = 34.5;
    player.moving = false;
  } else {
    for (const id of EXP_KIT_IDS) put(id, null);
  }
  (e.target as HTMLButtonElement).textContent = expKitPlaced ? '拡張キットを消す' : '拡張キットを置く';
});
let orbitYaw = 45;
document.getElementById('btn-orbit')!.addEventListener('click', (e) => {
  orbitYaw = (orbitYaw + 90) % 360;
  gfx.setCameraOrbit({ yawDegrees: orbitYaw });
  (e.target as HTMLButtonElement).textContent = `カメラを90°回す（現在${orbitYaw}°）`;
});
document.getElementById('tod')!.addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value) / 100;
  gfx.setWorldVisualState({ timeOfDay: v });
});
document.getElementById('weather')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value as 'clear' | 'cloudy' | 'rain' | 'fog';
  gfx.setWorldVisualState({ weather: v });
});

status.textContent = '描画モジュール初期化OK — 地形・川・森林・キャラクター表示中';
