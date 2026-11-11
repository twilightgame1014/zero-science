/**
 * Walk-cycle period measurement (volcano/walk/UI round, 2026-11-11):
 * drives the real CharacterRenderer with a fixed game speed and
 * counts full 4-frame cycles over simulated time, so the report to
 * Claude can state exact before/after periods instead of estimates.
 *
 * Run from threejs-hd2d-graphics/:  node tools/test-walk-cycle.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'testwalk-'));
const nm = fs.existsSync(path.join(root, 'node_modules'))
  ? path.join(root, 'node_modules')
  : path.join(root, '..', 'node_modules');
fs.symlinkSync(nm, path.join(tmp, 'node_modules'), 'dir');
execFileSync(path.join(nm, '.bin', 'tsc'), [
  'src/graphics/CharacterRenderer.ts', 'src/graphics/types.ts',
  'src/graphics/utils.ts', 'src/graphics/config.ts',
  '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--outDir', tmp,
], { cwd: root, stdio: 'inherit' });

const req = createRequire(path.join(tmp, 'x.js'));
const THREE = req('three');
const CR = req('./CharacterRenderer.js');
const CFG = req('./config.js');

const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
cam.position.set(7, 6, 7);
cam.lookAt(0, 0, 0);
cam.updateMatrixWorld();

const cfg = CFG.resolveConfig().character;
console.log(`config: walkFps=${cfg.walkFps} walkStride=${cfg.walkStride ?? '(unset → code default 0.35)'}`);

function measure(label, state, seconds = 20) {
  const tex = new THREE.Texture();
  tex.image = { width: 1024, height: 2048 };
  tex.needsUpdate = true;
  const r = new CR.CharacterRenderer(tex, new THREE.Texture(), cfg, () => 0);
  r.setState({ position: { x: 0, z: 0 }, direction: 'down', ...state });
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  let cycles = 0;
  let prev = 0;
  let bobMin = Infinity, bobMax = -Infinity;
  for (let i = 0; i < steps; i++) {
    r.update(dt, cam);
    const f = Math.round(r.player.texture.offset.x * 4) % 4;
    if (prev === 3 && f === 0) cycles++;
    prev = f;
    const y = r.player.sprite.position.y;
    if (i > 30) { bobMin = Math.min(bobMin, y); bobMax = Math.max(bobMax, y); }
  }
  const period = cycles > 0 ? seconds / cycles : Infinity;
  console.log(
    `${label}: cycles=${cycles} in ${seconds}s → period=${period.toFixed(3)}s ` +
    `(${(1 / period).toFixed(2)} cycles/s, ${(2 / period).toFixed(1)} steps/s), bob range=${(bobMax - bobMin).toFixed(3)} units`,
  );
  return period;
}

const p70 = measure('speed 7.00 (current game speed)', { moving: true, speed: 7.0 });
const p455 = measure('speed 4.55 (65% — Claude adjustment)', { moving: true, speed: 4.55 });
measure('speed 3.50 (50%)', { moving: true, speed: 3.5 });
measure('legacy (no speed; walkFps time base)', { moving: true });
console.log(`period ratio 4.55 vs 7.00: ${(p455 / p70).toFixed(3)}x (target ≈1.5x)`);

// Standing still must hold frame 0 (wall-press contract: game sends moving=false).
{
  const tex = new THREE.Texture();
  tex.image = { width: 1024, height: 2048 };
  tex.needsUpdate = true;
  const r = new CR.CharacterRenderer(tex, new THREE.Texture(), cfg, () => 0);
  r.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true, speed: 7 });
  for (let i = 0; i < 30; i++) r.update(1 / 60, cam);
  r.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: false, speed: 7 });
  r.update(1 / 60, cam);
  const f = Math.round(r.player.texture.offset.x * 4) % 4;
  console.log(`after stop: frame=${f} (must be 0)`, f === 0 ? 'OK' : 'FAIL');
}
