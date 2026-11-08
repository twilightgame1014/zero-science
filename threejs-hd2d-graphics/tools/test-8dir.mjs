/**
 * Round-25 unit sweep for the 8-direction sprite rows (Claude §22.1
 * verification method): for every camera yaw 0–359°, cycling the 8
 * discrete directions must produce all 8 sheet rows — from ANY
 * starting row — and the continuous `facing` path must stay within
 * one sector of the true camera-relative sector. Also checks the
 * speed-driven walk phase (Claude §22.2).
 *
 * Run from threejs-hd2d-graphics/:  node tools/test-8dir.mjs
 * Compiles the real TS sources to a temp dir and drives them with
 * the real three.js. Exits non-zero on any failure.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test8dir-'));
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

let failures = 0;
const check = (ok, label) => { if (!ok) { failures++; console.log('FAIL', label); } };

function cameraAtYaw(yawDeg) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const y = (yawDeg * Math.PI) / 180;
  cam.position.set(Math.sin(y) * 10, 6, Math.cos(y) * 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}
const DIRS = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'];
const ROW_SECTOR = [0, 6, 2, 4, 1, 7, 3, 5]; // row -> sector (mirror of module table)

// 1. diag8Check equivalent: all 8 rows appear at every yaw, any start row.
for (let yaw = 0; yaw < 360; yaw++) {
  const cam = cameraAtYaw(yaw);
  for (const start of [-1, 0, 1, 2, 3, 4, 5, 6, 7]) {
    let row = start;
    const seen = new Set();
    for (const d of DIRS) { row = CR.rowForDirection8(d, cam, row); seen.add(row); }
    check(seen.size === 8, `discrete yaw=${yaw} start=${start} rows=${[...seen].join(',')}`);
  }
}
// 2. Continuous facing: displayed sector within 1 of the true sector.
for (let yaw = 0; yaw < 360; yaw += 3) {
  const cam = cameraAtYaw(yaw);
  let row = -1;
  for (let f = 0; f < 360; f += 3) {
    row = CR.rowForFacing8((f * Math.PI) / 180, cam, row);
    const rel = (((f - yaw) % 360) + 360) % 360;
    const trueSector = Math.round(rel / 45) % 8;
    const shown = ROW_SECTOR[row];
    const dist = Math.min(Math.abs(shown - trueSector), 8 - Math.abs(shown - trueSector));
    check(dist <= 1, `facing yaw=${yaw} f=${f} shown sector ${shown} vs true ${trueSector}`);
  }
}
// 3. Speed-driven walk phase via the real renderer.
{
  const cfg = CFG.resolveConfig().character;
  const tex = new THREE.Texture();
  tex.image = { width: 1024, height: 2048 };
  tex.needsUpdate = true;
  const shadow = new THREE.Texture();
  const cam = cameraAtYaw(45);
  const mk = () => new CR.CharacterRenderer(tex, shadow, cfg, () => 0);
  const frameOf = (r) => Math.round(r.player.texture.offset.x * 4) % 4;

  const r1 = mk();
  r1.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true, speed: 1.4 });
  const seq = [];
  for (let i = 0; i < 4; i++) { r1.update(0.25, cam); seq.push(frameOf(r1)); }
  check(seq.join(',') === '1,2,3,0', `speed 1.4 frames ${seq.join(',')}`);

  const r2 = mk();
  r2.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true, speed: 0.7 });
  for (let i = 0; i < 4; i++) r2.update(0.25, cam);
  check(frameOf(r2) === 2, `speed 0.7 end frame ${frameOf(r2)}`);

  const r3 = mk();
  r3.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true, speed: 0 });
  r3.update(0.5, cam);
  check(frameOf(r3) === 0, `speed 0 frame ${frameOf(r3)}`);

  const r4 = mk();
  r4.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: true });
  r4.update(0.5, cam);
  check(frameOf(r4) === Math.floor(0.5 * cfg.walkFps) % 4, `legacy time-based frame ${frameOf(r4)}`);

  // Facing precedence: direction 'down' but facing = up (pi) at yaw 45.
  const r5 = mk();
  r5.setState({ position: { x: 0, z: 0 }, direction: 'down', moving: false, facing: Math.PI });
  r5.update(0.1, cam);
  const rowShown = Math.round((1 - r5.player.texture.offset.y) * 8 - 1);
  check(rowShown === CR.rowForFacing8(Math.PI, cam, -1), `facing precedence row ${rowShown}`);
}
console.log(failures === 0 ? 'ALL 8DIR CHECKS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
