import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from './helpers/terrain.mjs';

const out = await build({ stdin: { contents: `
  export * as THREE from 'three';
  export { GraphicsEngine } from './src/graphics/GraphicsEngine';
  export { CameraController } from './src/graphics/CameraController';
  export { CharacterRenderer } from './src/graphics/CharacterRenderer';
  export { ResourceRenderer } from './src/graphics/ResourceRenderer';
  export { EnvironmentRenderer } from './src/graphics/EnvironmentRenderer';
  export { resolveConfig } from './src/graphics/config';`,
  resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'cjs', write: false, logLevel: 'warning' });
const mod = { exports: {} };
new Function('module', 'exports', out.outputFiles[0].text)(mod, mod.exports);
const { THREE: T, GraphicsEngine, CameraController, CharacterRenderer, ResourceRenderer, EnvironmentRenderer, resolveConfig } = mod.exports;

// 実APIをコンストラクターのWebGL起動だけ省いて呼ぶ。座標変換・null・非有限yも検査。
const api = Object.create(GraphicsEngine.prototype);
api.cfg = resolveConfig({ coordinates: { scale: 2, origin: { x: 1, y: 3, z: 2 } } });
api.setCameraTarget({ x: 5, z: 6, y: 13 });
assert.deepEqual(api.cameraOverride, { x: 8, z: 8, y: 20 });
api.setCameraTarget({ x: 5, z: 6, y: NaN });
assert.deepEqual(api.cameraOverride, { x: 8, z: 8 });
api.setCameraTarget({ x: NaN, z: 6, y: 7 });
assert.deepEqual(api.cameraOverride, { x: 8, z: 8 });
api.setCameraTarget(null);
assert.equal(api.cameraOverride, null);
console.log('PASS focus-height API: explicit y / omitted or invalid y / coordinates / null');
const partitioned = [30,60,120].map(hz=>{
  const rig=new CameraController(resolveConfig().camera);
  rig.setTarget(0,0,0); rig.snapToTarget(); rig.setTarget(10,20,15);
  for(let n=0;n<hz;n++) rig.update(1/hz);
  return rig.current.clone();
});
assert.ok(partitioned.every(p=>p.distanceTo(partitioned[0])<1e-10));
console.log('PASS damping is frame-partition independent at 30/60/120 Hz');

// 実ゲームの登山道を7マス/秒で再生する。60Hz固定刻みであり実機60fpsの測定ではない。
const terrain = await loadTerrain();
const cfg = resolveConfig(), trail = terrain.TRAILS.main;
const pointAt = s => {
  s = Math.min(s, trail.len);
  let i = 1; while (i < trail.cum.length - 1 && trail.cum[i] < s) i++;
  const f = (s-trail.cum[i-1])/(trail.cum[i]-trail.cum[i-1]);
  const a = trail.pts[i-1], b = trail.pts[i];
  const x=a.x+(b.x-a.x)*f, z=a.z+(b.z-a.z)*f;
  return new T.Vector3(x, terrain.terrainHeight(x,z,cfg), z);
};
const stats = [];
for (const hz of [30,60,120]) for (const pitch of [12,32]) for(const direction of ['up','down']) {
  const rig = new CameraController({ ...cfg.camera, pitchDegrees: pitch });
  rig.resize(1280,720);
  const start=pointAt(direction==='up'?0:trail.len); rig.setTarget(start.x,start.z,start.y); rig.snapToTarget();
  const tex=new T.Texture(); tex.image={width:1024,height:2048};
  const character=new CharacterRenderer(tex,new T.Texture(),cfg.character,(x,z)=>terrain.terrainHeight(x,z,cfg));
  character.setState({position:start,direction:'down',moving:false}); character.update(0,rig.camera);
  let maxLag=0, maxY=0, maxPx=0, maxSpritePx=0, outside=0;
  const steps=Math.ceil(trail.len/7*hz);
  for(let n=1;n<=steps;n++) {
    const p=pointAt(direction==='up'?n/hz*7:Math.max(0,trail.len-n/hz*7));
    character.setState({position:p,direction:'down',moving:true,speed:7}); character.update(1/hz,rig.camera);
    rig.setTarget(p.x,p.z,p.y); rig.update(1/hz);
    maxLag=Math.max(maxLag,p.distanceTo(rig.current));
    maxY=Math.max(maxY,Math.abs(p.y-rig.current.y));
    const a=p.clone().project(rig.camera), b=rig.current.clone().project(rig.camera);
    maxPx=Math.max(maxPx,Math.hypot((a.x-b.x)*640,(a.y-b.y)*360));
    const sprite=character.getRenderedPosition().clone().project(rig.camera);
    maxSpritePx=Math.max(maxSpritePx,Math.hypot((sprite.x-b.x)*640,(sprite.y-b.y)*360));
    if(Math.abs(sprite.x)>1 || Math.abs(sprite.y)>1) outside++;
  }
  const last=pointAt(direction==='up'?trail.len:0);
  for(let n=0;n<hz*2;n++) rig.update(1/hz);
  const settled=last.distanceTo(rig.current);
  assert.equal(outside,0);
  assert.ok(settled<0.001);
  stats.push({ mode:'fixed-step replay, not actual rendering FPS', hz, pitch, direction, speed:7,
    maxWorldLag:maxLag, maxHeightLag:maxY, maxScreenLagPxAt720:maxPx, maxSpriteLagPxAt720:maxSpritePx, settledAfter2s:settled, outside });
}
console.log('PASS uphill/downhill terrain focus: 30/60/120 Hz; no offscreen samples; settles in 2s');
console.log(JSON.stringify(stats.filter(s=>s.hz===60),null,2));

// 実フェード処理を、各インスタンスの出力へ接続して検証する。
const res = Object.create(ResourceRenderer.prototype);
const player=new T.Vector3(0,1,0), camera=new T.Vector3(0,5,30);
for (const type of ['grass','herb','flowers']) {
  let fade=1;
  const entry={ group:null, slots:[{ index:0, pool:{setFade(i,v){fade=v;} } }],
    state:{type}, pos:new T.Vector3(0,0,0.5), baseScale:1, fade:1 };
  res.entries=new Map([['test',entry]]);
  for(let n=0;n<120;n++) res.updateOcclusion(camera,player,1/60);
  assert.equal(fade,0.22);
  entry.state.highlighted=true;
  for(let n=0;n<120;n++) res.updateOcclusion(camera,player,1/60);
  assert.equal(fade,0.85);
  entry.state.highlighted=false; entry.pos.set(20,0,20);
  for(let n=0;n<120;n++) res.updateOcclusion(camera,player,1/60);
  assert.equal(fade,1);
}
const env=Object.create(EnvironmentRenderer.prototype);
const fades=new Float32Array([1]);
env.canopy=[]; env.vegFadeSets=[{centers:new Float32Array([0,0,0.5]),radii:new Float32Array([0.8]),fades,attr:new T.InstancedBufferAttribute(fades,1)}];
env.lodTimer=Infinity;
for(let n=0;n<120;n++) env.updateOcclusion(camera,player,1/60);
assert.ok(Math.abs(fades[0]-0.13)<0.0001);
console.log('PASS low vegetation: grass/herb/flowers 0.22; active 0.85; clear 1; scenery 0.13');
await fs.mkdir(new URL('../test-results/', import.meta.url), {recursive:true});
await fs.writeFile(new URL('../test-results/camera-focus-replay.json', import.meta.url),JSON.stringify(stats,null,2));
