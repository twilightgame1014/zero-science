/**
 * Walk-cycle stride measurement (round 28, Claude §25.3).
 * Bundles the real CharacterRenderer headlessly and drives it the
 * way the game does (setPlayerVisualState with moving + speed):
 *  - distance travelled per full 4-frame cycle must equal
 *    4 × walkStride (1.4 units at the default 0.35) at ANY speed,
 *    i.e. the feet cannot slide by construction; this measures
 *    the actual rendered frame sequence, not the formula.
 *  - cycle duration at the game's new speed 4.55 u/s ≈ 0.308 s.
 * Frame index is read from the sprite texture offset the renderer
 * itself writes. Not a real-device check: 60 Hz fixed steps.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({
  stdin: {
    contents: `
      export * as THREE from 'three';
      export { CharacterRenderer } from './src/graphics/CharacterRenderer';
      export { resolveConfig } from './src/graphics/config';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'cjs', write: false, logLevel: 'warning',
});
const mod = { exports: {} };
new Function('module', 'exports', out.outputFiles[0].text)(mod, mod.exports);
const { THREE: T, CharacterRenderer, resolveConfig } = mod.exports;

const cfg = resolveConfig();
const tex = new T.Texture();
tex.image = { width: 1024, height: 2048 };
const camera = new T.OrthographicCamera(-8, 8, 8, -8, 0.1, 500);
camera.position.set(30, 30, 30);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

function run(speed, seconds = 12) {
  const ch = new CharacterRenderer(tex, new T.Texture(), cfg.character, () => 0);
  ch.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: false });
  ch.update(0, camera);
  const dt = 1 / 60;
  let dist = 0;
  let prevFrame = 0;
  let cycles = 0;
  let cycleStartDist = 0;
  const cycleLengths = [];
  const framesSeen = new Set();
  for (let n = 0; n < seconds * 60; n++) {
    dist += speed * dt;
    ch.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true, speed });
    ch.update(dt, camera);
    // Read the frame the renderer selected via its texture offset
    // (player CharSprite internals: texture offset x = frame / 4).
    const sprite = ch.player;
    const frame = Math.round(sprite.texture.offset.x * 4) % 4;
    framesSeen.add(frame);
    if (frame === 0 && prevFrame === 3) {
      cycles++;
      cycleLengths.push(dist - cycleStartDist);
      cycleStartDist = dist;
    }
    prevFrame = frame;
  }
  return { speed, cycles, cycleLengths, framesSeen: [...framesSeen].sort() };
}

let fail = 0;
for (const speed of [4.55, 7.0, 2.2]) {
  const r = run(speed);
  const avg = r.cycleLengths.reduce((a, b) => a + b, 0) / r.cycleLengths.length;
  const period = avg / speed;
  const okDist = Math.abs(avg - 1.4) < 0.02;
  const okFrames = r.framesSeen.length === 4;
  if (!okDist || !okFrames) fail++;
  console.log(
    `speed ${speed}: cycles ${r.cycles}, distance/cycle ${avg.toFixed(4)} units ` +
    `(target 1.4, ${okDist ? 'OK' : 'FAIL'}), period ${period.toFixed(3)}s, frames ${r.framesSeen.join(',')}`,
  );
}
// Standing still must freeze on frame 0.
{
  const ch = new CharacterRenderer(tex, new T.Texture(), cfg.character, () => 0);
  ch.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true, speed: 4.55 });
  for (let n = 0; n < 30; n++) ch.update(1 / 60, camera);
  ch.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: false, speed: 0 });
  ch.update(1 / 60, camera);
  const frame = Math.round(ch.player.texture.offset.x * 4) % 4;
  console.log(`stop: frame ${frame} (target 0, ${frame === 0 ? 'OK' : 'FAIL'})`);
  if (frame !== 0) fail++;
}
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
