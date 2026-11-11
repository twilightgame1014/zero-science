/**
 * Verification viewer (NOT part of the module): places the player at
 * URL-given coordinates with a URL-given camera so headless screenshot
 * scripts can frame exact viewpoints (volcano round, 2026-11-11).
 *
 * Params: x, z, yaw, pitch, view (viewSize), dist, tod, char=boy|girl,
 * moving=0|1, speed, dir, facing (deg), ty (camera target height
 * override), kit=1 (place the volcano-kit GLBs at their catalogue
 * anchors), env=0 (skip environment following).
 */
import {
  areaWeights,
  initializeGraphics,
  resolveConfig,
  terrainHeight,
  type Direction,
  type GraphicsEngine,
} from '../src/graphics/index';
import boySpriteUrl from '../assets/characters/player-spritesheet-boy-8dir.png?url';
import girlSpriteUrl from '../assets/characters/player-spritesheet-girl-8dir.png?url';
import grassDetailUrl from '../assets/textures/grass-detail.png?url';
import particleUrl from '../assets/textures/particle-dot.png?url';
import shadowUrl from '../assets/textures/shadow-blob.png?url';
import kitBasaltL from '../../assets/volcano-kit/basalt-outcrop-l.glb?url';
import kitBasaltS from '../../assets/volcano-kit/basalt-outcrop-s.glb?url';
import kitFallen from '../../assets/volcano-kit/fallen-block.glb?url';
import kitScree from '../../assets/volcano-kit/scree-cluster.glb?url';
import kitShelf from '../../assets/volcano-kit/crater-rim-shelf.glb?url';
import kitLava from '../../assets/volcano-kit/cooled-lava-chunk.glb?url';
import kitOre from '../../assets/volcano-kit/ore-outcrop.glb?url';
import kitShrub from '../../assets/volcano-kit/ash-shrub.glb?url';
import kitTuft from '../../assets/volcano-kit/ash-grass-tuft.glb?url';

const KIT_URLS: Record<string, string> = {
  'basalt-outcrop-l': kitBasaltL,
  'basalt-outcrop-s': kitBasaltS,
  'fallen-block': kitFallen,
  'scree-cluster': kitScree,
  'crater-rim-shelf': kitShelf,
  'cooled-lava-chunk': kitLava,
  'ore-outcrop': kitOre,
  'ash-shrub': kitShrub,
  'ash-grass-tuft': kitTuft,
};

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(q.get(k));
  return Number.isFinite(v) && q.get(k) !== null ? v : d;
};
const px = num('x', -100);
const pz = num('z', -92);
const yaw = num('yaw', 45);
const pitch = num('pitch', 32);
const view = num('view', 16);
const dist = num('dist', 90);
const tod = num('tod', 0.44);
const moving = q.get('moving') === '1';
const speed = num('speed', 0);
const dir = (q.get('dir') ?? 'down') as Direction;
const facingDeg = q.get('facing');
const char = q.get('char') === 'girl' ? 'girl' : 'boy';

const container = document.getElementById('app')!;
const gfx: GraphicsEngine = await initializeGraphics(container, {
  playerSpriteUrl: char === 'girl' ? girlSpriteUrl : boySpriteUrl,
  grassDetailUrl,
  particleTextureUrl: particleUrl,
  shadowTextureUrl: shadowUrl,
});
(window as unknown as { gfx: GraphicsEngine }).gfx = gfx;
gfx.setWorldVisualState({ timeOfDay: tod });

const cfg = resolveConfig();
const groundY = terrainHeight(px, pz, cfg);
const ty = q.get('ty') !== null ? num('ty', groundY) : groundY;

gfx.setPlayerVisualState({
  position: { x: px, z: pz },
  direction: dir,
  moving,
  ...(speed > 0 ? { speed } : {}),
  ...(facingDeg !== null ? { facing: (Number(facingDeg) * Math.PI) / 180 } : {}),
});
gfx.setCameraTarget({ x: px, z: pz, y: ty });
gfx.setCameraView(
  { yawDegrees: yaw, pitchDegrees: pitch, viewSize: view, distance: dist },
  { transition: 0 },
);
if (q.get('env') !== '0') {
  gfx.setEnvironment({ weights: areaWeights(px, pz, cfg) });
}

/* Volcano-kit placement check: load the catalogue GLBs and set them
 * at their anchor rules (centre-relative radius/angle), grounded by
 * the module height function. Demo-side only — in the game, Claude
 * places them from the same catalogue. */
if (q.get('kit') === '1') {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const scene = gfx.getScene();
  const C = { x: -128, z: -118 };
  const anchors: Array<{ file: string; r: number; angDeg: number; sink: number; rotDeg?: number; scale?: number }> = [
    { file: 'crater-rim-shelf', r: 12.3, angDeg: 190, sink: 0.35, rotDeg: 100 },
    { file: 'crater-rim-shelf', r: 12.6, angDeg: 285, sink: 0.35, rotDeg: 15, scale: 0.8 },
    { file: 'basalt-outcrop-l', r: 21, angDeg: 128, sink: 0.3, rotDeg: 40 },
    { file: 'basalt-outcrop-l', r: 27, angDeg: 232, sink: 0.3, rotDeg: 190, scale: 0.85 },
    { file: 'basalt-outcrop-s', r: 16, angDeg: 320, sink: 0.22, rotDeg: 75 },
    { file: 'basalt-outcrop-s', r: 33, angDeg: 96, sink: 0.22, rotDeg: 260 },
    { file: 'ore-outcrop', r: 23, angDeg: 60, sink: 0.1, rotDeg: 130 },
    { file: 'cooled-lava-chunk', r: 14.5, angDeg: 160, sink: 0.15, rotDeg: 20 },
    { file: 'cooled-lava-chunk', r: 24, angDeg: 300, sink: 0.15, rotDeg: 210, scale: 1.25 },
    { file: 'fallen-block', r: 18, angDeg: 255, sink: 0.2, rotDeg: 55 },
    { file: 'fallen-block', r: 30, angDeg: 60, sink: 0.2, rotDeg: 300, scale: 0.8 },
    { file: 'scree-cluster', r: 22, angDeg: 205, sink: 0.06 },
    { file: 'scree-cluster', r: 36, angDeg: 130, sink: 0.06, scale: 1.3 },
    { file: 'ash-shrub', r: 40, angDeg: 80, sink: 0.03 },
    { file: 'ash-shrub', r: 44, angDeg: 150, sink: 0.03, scale: 0.85 },
    { file: 'ash-grass-tuft', r: 38, angDeg: 110, sink: 0.02 },
    { file: 'ash-grass-tuft', r: 42, angDeg: 200, sink: 0.02, scale: 1.2 },
  ];
  for (const a of anchors) {
    const ang = (a.angDeg * Math.PI) / 180;
    const x = C.x + Math.cos(ang) * a.r;
    const z = C.z + Math.sin(ang) * a.r;
    const url = KIT_URLS[a.file];
    const gltf = await loader.loadAsync(url);
    const obj = gltf.scene;
    obj.position.set(x, terrainHeight(x, z, cfg) - a.sink, z);
    obj.rotation.y = ((a.rotDeg ?? 0) * Math.PI) / 180;
    if (a.scale) obj.scale.setScalar(a.scale);
    scene.add(obj);
  }
  (window as unknown as { __kitReady: boolean }).__kitReady = true;
}

(window as unknown as { __ready: boolean }).__ready = true;
