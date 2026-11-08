// 本物のゲーム・WebGLで高さ追随とインスタンスフェードを確認する。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(import.meta.url), E=require('../../src/game/engine.js');
const save=E.newState(); save.flags={intro:1,hero:'girl'}; save.pos={x:58,z:-66};
  // 希望角は保存設定で12度。既存camNeedは平地でも約20.56度へ上げるので、実角も記録する。
save.camera={yaw:45,pitch:12,zoom:13};
const html=await fs.readFile(path.join(root,'dist/index.html'));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
let browser;
try {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:640,height:360},hasTouch:true});
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.180.0/**',async route=>{
    const base=path.join(root,'node_modules/three');
    const file=path.resolve(base,new URL(route.request().url()).pathname.slice('/npm/three@0.180.0/'.length));
    assert.ok(file.startsWith(base+path.sep)); await route.fulfill({path:file,contentType:'text/javascript'});
  });
  await ctx.route('https://fonts.googleapis.com/**',r=>r.abort());
  const page=await ctx.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text());});
  page.setDefaultTimeout(120000);
  await page.addInitScript(save=>localStorage.setItem('zero-kagaku-save',JSON.stringify(save)),save);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>__GAME__.W3.state==='ready');
  await page.waitForFunction(()=>{
    const w=__GAME__.W3, o=w.gfx.cameraOverride, r=w.gfx.cameraRig;
    return o && Math.abs(o.y-TERRAIN.terrainHeight(w.pos.x,w.pos.z,w.cfg))<0.0001 && r.current.distanceTo(r.target)<0.05;
  });
  console.log('PASS actual game camera override uses worldHeight');
  await page.evaluate(()=>{
    const samples=[]; window.__focusRun={samples,active:true};
    const tick=ts=>{
      if(!__focusRun.active) return;
      const w=__GAME__.W3, gfx=w.gfx, o=gfx.cameraOverride, p=gfx.character.getRenderedPosition();
      const screen=p.clone().project(gfx.getCamera());
      samples.push({ts,x:w.pos.x,z:w.pos.z,y:TERRAIN.terrainHeight(w.pos.x,w.pos.z,w.cfg),
        overrideError:Math.abs(o.y-TERRAIN.terrainHeight(o.x,o.z,w.cfg)),
        heightLag:Math.abs(gfx.cameraRig.target.y-gfx.cameraRig.current.y),
        screenX:screen.x,screenY:screen.y,pitch:gfx.getCameraView().pitchDegrees});
      requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
  for(const [x,z] of [[56,-76],[58,-66]]){
    assert.equal(await page.evaluate(([x,z])=>__GAME__.goTo3D(x,z,null),[x,z]),true);
    await page.waitForFunction(([x,z])=>{
      const w=__GAME__.W3; return !w.path && Math.hypot(w.pos.x-x,w.pos.z-z)<0.8;
    },[x,z]);
    console.log(`PASS actual uphill/downhill travel ${x},${z}`);
  }
  await page.waitForFunction(()=>{
    const r=__GAME__.W3.gfx.cameraRig; return r.current.distanceTo(r.target)<0.02;
  });
  const metrics=await page.evaluate(()=>{
    __focusRun.active=false; const s=__focusRun.samples;
    return {frames:s.length,observedFps:(s.length-1)*1000/(s.at(-1).ts-s[0].ts),
      maxHeightLag:Math.max(...s.map(p=>p.heightLag)),maxOverrideError:Math.max(...s.map(p=>p.overrideError)),
      heightRange:Math.max(...s.map(p=>p.y))-Math.min(...s.map(p=>p.y)),
      pitchRange:[Math.min(...s.map(p=>p.pitch)),Math.max(...s.map(p=>p.pitch))],
      outside:s.filter(p=>Math.abs(p.screenX)>1||Math.abs(p.screenY)>1).length};
  });
  assert.equal(metrics.maxOverrideError,0); assert.equal(metrics.outside,0); assert.ok(metrics.heightRange>1);
  console.log('ACTUAL RAF METRICS',JSON.stringify(metrics));

  // 坂の地面による遮蔽と植生フェードを混同しないよう、平らな拠点で植生を確認する。
  await page.evaluate(()=>{
    const g=__GAME__, w=g.W3, p=g.WORLD.safeSpawn(g.S,g.D.base);
    w.keys={}; w.joy=null; w.path=null; w.target=null; w.intent=null;
    w.pos={x:p.x,z:p.z};
    if(w.world?.afterWarp) w.world.afterWarp(p.x,p.z);
  });
  await page.waitForFunction(()=>{
    const w=__GAME__.W3, r=w.gfx.cameraRig, p=w.gfx.character.getRenderedPosition();
    return Math.hypot(p.x-w.pos.x,p.z-w.pos.z)<0.03 && r.current.distanceTo(r.target)<0.03
      && w.gfx.getCameraView().pitchDegrees<=21;
  });
  const vegetationPitch=await page.evaluate(()=>__GAME__.W3.gfx.getCameraView().pitchDegrees);
  assert.ok(vegetationPitch>=20.5 && vegetationPitch<=21);
  console.log('VEGETATION PITCH',vegetationPitch,'(requested 12; existing terrain clearance raises it)');
  await page.evaluate(()=>{
    const w=__GAME__.W3, cam=w.gfx.getCamera(), p=w.gfx.character.getRenderedPosition();
    const dx=cam.position.x-p.x,dz=cam.position.z-p.z,l=Math.hypot(dx,dz);
    window.__fadePoint={x:p.x+dx/l*0.5,z:p.z+dz/l*0.5};
    for(const type of ['grass','herb','flowers']) w.gfx.updateResourceVisual('focus-test-'+type,
      {position:__fadePoint,type,scale:1,visible:true});
  });
  await page.waitForFunction(()=>['grass','herb','flowers'].every(type=>{
    const e=__GAME__.W3.gfx.resources.entries.get('focus-test-'+type);
    return e && e.slots.length>0 && e.fade<=0.23;
  }));
  const fades=()=>page.evaluate(()=>Object.fromEntries(['grass','herb','flowers'].map(type=>{
    const e=__GAME__.W3.gfx.resources.entries.get('focus-test-'+type);
    return [type,{fade:e.fade,instanceFades:e.slots.map(s=>s.pool.fadeAttr.getX(s.index)),group:!!e.group}];
  })));
  const normal=await fades();
  for(const f of Object.values(normal)) assert.ok(f.instanceFades.every(v=>Math.abs(v-0.22)<0.01));
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/camera-focus-fade-normal.png')});
  await page.evaluate(()=>{
    for(const type of ['grass','herb','flowers']) __GAME__.W3.gfx.updateResourceVisual('focus-test-'+type,
      {position:__fadePoint,type,scale:1,visible:true,highlighted:true});
  });
  await page.waitForFunction(()=>['grass','herb','flowers'].every(type=>
    Math.abs(__GAME__.W3.gfx.resources.entries.get('focus-test-'+type).fade-0.85)<0.01));
  const active=await fades();
  for(const f of Object.values(active)) assert.ok(f.instanceFades.every(v=>Math.abs(v-0.85)<0.01));
  await page.screenshot({path:path.join(root,'test-results/camera-focus-fade-active.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS actual low-angle instanced grass/herb/flowers: fade 0.22 / active 0.85 / shaders compile');
  await fs.writeFile(path.join(root,'test-results/camera-focus-webgl.json'),JSON.stringify({metrics,vegetationPitch,normal,active},null,2));
  await ctx.close();
} finally {
  try {await browser?.close();} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
