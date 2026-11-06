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
  onContextLost: () => {
    status.textContent = 'WebGLコンテキストが失われました（復旧を試みます）';
  },
  onContextRestored: () => {
    status.textContent = 'WebGLコンテキストが復旧しました';
  },
});

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
document.getElementById('tod')!.addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value) / 100;
  gfx.setWorldVisualState({ timeOfDay: v });
});
document.getElementById('weather')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value as 'clear' | 'cloudy' | 'rain' | 'fog';
  gfx.setWorldVisualState({ weather: v });
});

status.textContent = '描画モジュール初期化OK — 地形・川・森林・キャラクター表示中';
