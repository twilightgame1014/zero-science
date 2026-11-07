/**
 * Demo harness — NOT part of the graphics module.
 *
 * It feeds the graphics engine with fake state so the rendering can be
 * verified standalone. The keyboard driver below exists only here;
 * the real game logic (Claude's side) will call the same public API
 * from its own state instead.
 */
import * as THREE from 'three';
import {
  areaWeights,
  initializeGraphics,
  resolveConfig,
  terrainHeight,
  type Direction,
  type GraphicsEngine,
  type PlayerVisualState,
} from '../src/graphics/index';
import { buildVillage } from './village';
import boySpriteUrl from '../assets/characters/player-spritesheet-boy.png?url';
import girlSpriteUrl from '../assets/characters/player-spritesheet-girl.png?url';
import girl8SpriteUrl from '../assets/characters/player-spritesheet-girl-8dir.png?url';
import boy8SpriteUrl from '../assets/characters/player-spritesheet-boy-8dir.png?url';
import npcGuideUrl from '../../assets/gpt-expansion/npc/guide.png?url';
import npcResidentUrl from '../../assets/gpt-expansion/npc/resident.png?url';
import npcCraftsmanUrl from '../../assets/gpt-expansion/npc/craftsman.png?url';
import grassDetailUrl from '../assets/textures/grass-detail.png?url';
import shoreFoamUrl from '../../assets/gpt-env/shore-foam.png?url';
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
let use8Dir = false;
document.getElementById('btn-chara')!.addEventListener('click', async (e) => {
  currentChara = currentChara === 'boy' ? 'girl' : 'boy';
  await gfx.setPlayerSpriteSheet(
    currentChara === 'boy'
      ? use8Dir ? boy8SpriteUrl : boySpriteUrl
      : use8Dir ? girl8SpriteUrl : girlSpriteUrl,
  );
  (e.target as HTMLButtonElement).textContent =
    currentChara === 'boy' ? '主人公を女の子に切替' : '主人公を男の子に切替';
  gfx.playVisualEffect('sparkle', { x: player.x, z: player.z });
});
document.getElementById('btn-chara-8dir')!.addEventListener('click', async (e) => {
  use8Dir = !use8Dir;
  await gfx.setPlayerSpriteSheet(
    currentChara === 'boy'
      ? use8Dir ? boy8SpriteUrl : boySpriteUrl
      : use8Dir ? girl8SpriteUrl : girlSpriteUrl,
  );
  (e.target as HTMLButtonElement).textContent = use8Dir
    ? '4方向シートに戻す'
    : '8方向シートにする';
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

/* -------- world-expansion areas (2026-11-07, spec §1/§3/§4/§5) --------
 * Area tour: move the demo player to a stand point in each new area
 * and frame its landmark. A few area-appropriate harvest nodes are
 * placed with the tour so the §6 visuals read in context. The
 * environment blend follows the player automatically (interval
 * below), exactly as the game will drive it from its own loop. */
const demoCfg = resolveConfig();
const AREA_TOURS: Record<string, { x: number; z: number; yaw: number; viewSize?: number; nodes: Array<[string, object]> }> = {
  lakeside: {
    x: 82, z: 2, yaw: 270,
    nodes: [
      ['demo-tour-reed', { position: { x: 86.5, z: -1 }, type: 'grass', scale: 1.15, natural: { kind: 'grass', variant: 'reed' } }],
      ['demo-tour-lily', { position: { x: 94, z: -4 }, type: 'lily', scale: 1.1, natural: { kind: 'lily' } }],
    ],
  },
  coast: {
    // Stand picked from a terrainHeight probe (2026-11-07): the
    // dry sand band is narrow — (136,14) is h≈0.54, coast-weight
    // dominant, with the sea in frame looking east (yaw 270).
    x: 136, z: 14, yaw: 270,
    nodes: [
      ['demo-tour-drift', { position: { x: 142, z: 16 }, type: 'branch', scale: 1.1, natural: { kind: 'branch', variant: 'driftwood' } }],
    ],
  },
  volcano: {
    // (-100,-92): h≈6.7 and volcano weight 0.94 (the old stand at
    // (-92,-84) probed forest-dominant 0.58 — wrong light entirely).
    x: -100, z: -92, yaw: 45,
    nodes: [
      ['demo-tour-vrock', { position: { x: -103.5, z: -95.5 }, type: 'rock', scale: 1.2, natural: { kind: 'rock', variant: 'volcanic' } }],
      ['demo-tour-lava', { position: { x: -97, z: -89 }, type: 'lava', scale: 1.3, natural: { kind: 'lava' } }],
    ],
  },
  snow: {
    x: 92, z: -98, yaw: 45,
    nodes: [
      ['demo-tour-snowconifer', { position: { x: 88.5, z: -101.5 }, type: 'tree', scale: 1.1, natural: { kind: 'tree', variant: 'conifer-snow' } }],
      ['demo-tour-winter', { position: { x: 95.5, z: -95 }, type: 'tree', scale: 1, natural: { kind: 'tree', variant: 'winter' } }],
    ],
  },
  desert: {
    x: -100, z: 106, yaw: 45,
    nodes: [
      ['demo-tour-drygrass', { position: { x: -97.5, z: 103.5 }, type: 'grass', scale: 1.1, natural: { kind: 'grass', variant: 'dry' } }],
      ['demo-tour-drybush', { position: { x: -103, z: 109 }, type: 'bush', scale: 1.05, natural: { kind: 'bush', variant: 'dry' } }],
    ],
  },
  town: { x: 100, z: 100, yaw: 45, nodes: [] },
  // Round 20: the rebuilt waterfall kit at the legacy highland
  // (base (26.5,-15.5), lip toward (30.5,-20.5)). Stand is on the
  // downstream bank looking back NE at the fall.
  waterfall: { x: 24.2, z: -12.2, yaw: 315, viewSize: 11, nodes: [] },
};
const tourNodeIds = new Set<string>();
for (const area of ['lakeside', 'coast', 'volcano', 'snow', 'desert', 'town', 'waterfall']) {
  document.getElementById(`btn-tour-${area}`)!.addEventListener('click', () => {
    const tour = AREA_TOURS[area];
    for (const id of tourNodeIds) gfx.updateResourceVisual(id, null);
    tourNodeIds.clear();
    for (const [id, st] of tour.nodes) {
      gfx.updateResourceVisual(id, st as never);
      tourNodeIds.add(id);
    }
    player.x = tour.x;
    player.z = tour.z;
    player.moving = false;
    orbitYaw = tour.yaw;
    gfx.setCameraView({ yawDegrees: tour.yaw, pitchDegrees: 32, viewSize: tour.viewSize ?? 16 }, { transition: 0.8 });
  });
}
// The environment follows the player's area weights (spec §5).
setInterval(() => {
  gfx.setEnvironment({ weights: areaWeights(player.x, player.z, demoCfg) });
}, 600);

/* NPCs (spec §3): the guide idles by the village, the resident walks
 * a small loop (demo-driven; real movement logic is the game's), the
 * craftsman stands at his work spot. */
let npcsShown = false;
let residentT = 0;
document.getElementById('btn-npcs')!.addEventListener('click', (e) => {
  npcsShown = !npcsShown;
  if (npcsShown) {
    gfx.setNpcVisualState('demo-npc-guide', {
      position: { x: -16.5, z: 24.5 }, direction: 'down', moving: false, spriteUrl: npcGuideUrl,
    });
    gfx.setNpcVisualState('demo-npc-craftsman', {
      position: { x: -29.5, z: 17.5 }, direction: 'left', moving: false, spriteUrl: npcCraftsmanUrl,
    });
    gfx.setNpcVisualState('demo-npc-resident', {
      position: { x: -24, z: 14 }, direction: 'right', moving: true, spriteUrl: npcResidentUrl,
    });
  } else {
    for (const id of ['demo-npc-guide', 'demo-npc-craftsman', 'demo-npc-resident']) {
      gfx.setNpcVisualState(id, null);
    }
  }
  (e.target as HTMLButtonElement).textContent = npcsShown ? 'NPCを消す' : 'NPCを出す';
});
// Resident's demo patrol: a slow rectangle south of the plateau.
setInterval(() => {
  if (!npcsShown) return;
  residentT += 0.12;
  const path: Array<[number, number, Direction]> = [
    [-24, 14, 'right'], [-19, 14, 'down'], [-19, 18.5, 'left'], [-24, 18.5, 'up'],
  ];
  const seg = Math.floor(residentT) % 4;
  const f = residentT - Math.floor(residentT);
  const [ax, az, dir] = path[seg];
  const [bx, bz] = path[(seg + 1) % 4];
  gfx.setNpcVisualState('demo-npc-resident', {
    position: { x: ax + (bx - ax) * f, z: az + (bz - az) * f },
    direction: dir, moving: true, spriteUrl: npcResidentUrl,
  });
}, 120);

/* Building preview ghost (spec §4): cycles off → valid → invalid. */
let previewStage = 0;
document.getElementById('btn-preview')!.addEventListener('click', (e) => {
  previewStage = (previewStage + 1) % 3;
  if (previewStage === 0) {
    gfx.setStructurePreview(null);
    (e.target as HTMLButtonElement).textContent = '建築プレビュー（オフ）';
  } else {
    gfx.setStructurePreview({
      type: 'hut',
      position: { x: player.x + 3, z: player.z + 1 },
      rotationY: 0.4,
      valid: previewStage === 1,
    });
    (e.target as HTMLButtonElement).textContent =
      previewStage === 1 ? '建築プレビュー（有効・緑）' : '建築プレビュー（無効・赤）';
  }
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

/* Shore foam (round 22): the module builder (src/graphics/
 * ShoreFoam.ts) — the same code Claude's chunk shorelines use.
 * u = arc length / 3 m world-anchored; phase from a shared
 * clock (performance.now here; the engine clock in-game). */
import { createShoreFoam, sampleWaterline } from '../src/graphics/ShoreFoam';
let shoreFoamShown = false;
let shoreFoam: ReturnType<typeof createShoreFoam> | null = null;
document.getElementById('btn-shore-foam')!.addEventListener('click', (e) => {
  shoreFoamShown = !shoreFoamShown;
  if (shoreFoamShown && !shoreFoam) {
    const wl = demoCfg.world.waterLevel;
    const tex = new THREE.TextureLoader().load(shoreFoamUrl);
    const line = sampleWaterline(
      (x, z) => terrainHeight(x, z, demoCfg), wl, 78, 122, -14, 4);
    shoreFoam = createShoreFoam(
      (x, z) => terrainHeight(x, z, demoCfg), wl, line, { texture: tex });
    gfx.getScene().add(shoreFoam.group);
    (window as any).__shoreFoam = shoreFoam.group;
  }
  if (shoreFoam) shoreFoam.group.visible = shoreFoamShown;
  (e.target as HTMLButtonElement).textContent = shoreFoamShown ? '水際の泡を消す' : '水際の泡を出す';
});
setInterval(() => {
  if (shoreFoamShown && shoreFoam) shoreFoam.update(performance.now() / 1000);
}, 60);
