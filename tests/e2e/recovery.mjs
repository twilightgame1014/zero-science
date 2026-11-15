// Real game/WebGL with explicitly seeded construction states; normal rule progression is tested separately.
import {chromium} from 'playwright';import fs from 'node:fs';import path from 'node:path';import {createServer} from 'node:http';import {once} from 'node:events';import assert from 'node:assert/strict';
const root=process.cwd(),html=fs.readFileSync('dist/index.html');const server=createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(html);});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
fs.mkdirSync('docs/integration/evidence-recovery-20261115',{recursive:true});
const evidence=[];
try{for(const mobile of [false,true]){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://cdn.jsdelivr.net/npm/three@0.180.0/**',async r=>{const rel=new URL(r.request().url()).pathname.split('three@0.180.0/')[1];await r.fulfill({body:fs.readFileSync(path.join(root,'node_modules/three',rel)),contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/?verify=1`);
 await page.waitForFunction(()=>!!window.__GAME__);if(await page.locator('#introGo').isVisible())await page.locator('#introGo').click();
 await page.waitForFunction(()=>__GAME__.W3.state==='ready',null,{timeout:60000});
 await page.evaluate(()=>__GAME__.W3.gfx.setQuality('low'));
 await page.waitForFunction(()=>{const v=__GAME__.W3.world.status().volcanoKit;return v.placed>0&&v.placed===v.spots;},null,{timeout:60000});
 const status=await page.evaluate(()=>__GAME__.W3.world.status());
 assert.deepEqual(status.volcanoKit.failed,[]);assert(status.volcanoKit.lodPairs>0);
 await page.evaluate(()=>__GAME__.W3.world.setQuality('low'));
 const lod=await page.evaluate(()=>__GAME__.W3.world.status().volcanoKit);assert.equal(lod.lod1Used,lod.lodPairs);
 await page.evaluate(()=>__GAME__.W3.world.setQuality('high'));
 assert(status.waterfallArt.streaks);assert.equal(status.waterfallArt.foamPlanes,2);assert(status.shoreFoam>3);
 const visual=await page.evaluate(()=>{const scene=__GAME__.W3.gfx.getScene(),water=scene.getObjectByName('Waterfall2'),ring=scene.getObjectByName('FallFoamRing');let falls=0;scene.traverse(o=>{if(o.name==='Waterfall2')falls++;});return {falls,streakLoaded:!!water?.material?.uniforms?.uStreaks?.value?.image,ringLoaded:!!ring?.material?.map?.image,ringVisible:ring?.visible};});
 assert.equal(visual.falls,1);assert(visual.streakLoaded&&visual.ringLoaded&&visual.ringVisible);
 for(const [name,x,z]of [['volcano',-112,-103],['waterfall',121,-92],['shore',null,null]]){
  await page.evaluate(([name,x,z])=>{const g=__GAME__,t=window.TERRAIN;if(name==='shore'){x=t.LAKE.x-t.LAKE.r+2;z=t.LAKE.z;}g.W3.pos={x,z};g.W3.path=null;g.W3.target=null;g.S.camera={yaw:0,pitch:35,zoom:25};g.cam.rebase();g.W3.world.afterWarp(x,z);g.render();},[name,x,z]);
  await page.waitForTimeout(2000);
  if(name==='volcano')await page.evaluate(()=>{const g=__GAME__,gfx=g.W3.gfx,kit=gfx.getScene().getObjectByName('VolcanoKit'),target=kit.children.find(o=>o.name==='VolcanoKit:basalt-outcrop-l'),p=target.position;g.W3.pos={x:p.x,z:p.z};g.W3.world.afterWarp(p.x,p.z);gfx.pauseGraphics();const cam=gfx.getCamera();const dx=p.x-TERRAIN.VOLCANO.x,dz=p.z-TERRAIN.VOLCANO.z,r=Math.hypot(dx,dz);cam.position.set(p.x+dx/r*12,p.y+8,p.z+dz/r*12);cam.lookAt(p.x,p.y+1,p.z);cam.top=5;cam.bottom=-5;cam.left=-5*innerWidth/innerHeight;cam.right=5*innerWidth/innerHeight;cam.updateProjectionMatrix();cam.updateMatrixWorld();gfx.getRenderer().render(gfx.getScene(),cam);});
  const file=`docs/integration/evidence-recovery-20261115/${mobile?'phone':'pc'}-${name}.png`;
  await page.screenshot({path:file,timeout:60000});
  await page.evaluate(()=>__GAME__.W3.gfx.resumeGraphics());
 }
 await page.evaluate(()=>{const g=__GAME__;g.S.cons.rule='build';g.W3.pos={x:-10,z:36};g.W3.path=null;g.W3.target=null;g.S.cons.inst['recovery-factory']={id:'recovery-factory',kind:'building',def:'factory',x:-10,z:30,rot:0,phase:'constructing',stage:2,delivered:{},work:null};g.W3.world.afterWarp(-10,30);g.render();});
 await page.waitForFunction(()=>!!__GAME__.W3.gfx.getScene().getObjectByName('ConstructionSite:recovery-factory')?.getObjectByName('CompletedConstructionStages'));
 const factory=await page.evaluate(()=>{const site=__GAME__.W3.gfx.getScene().getObjectByName('ConstructionSite:recovery-factory'),names=[];site.getObjectByName('CompletedConstructionStages').traverse(o=>{if(o.isMesh&&o.visible)names.push(o.name);});return names;});
 assert(factory.some(n=>n.includes('wallsLower'))&&factory.some(n=>n.includes('wallsUpper')),'recovered staged factory is the rendered template');
 await page.waitForTimeout(2000);
 await page.screenshot({path:`docs/integration/evidence-recovery-20261115/${mobile?'phone':'pc'}-factory-stage2.png`,timeout:60000});
 evidence.push({mobile,status,visual,factory,errors});assert.deepEqual(errors,[]);await ctx.close();
 console.log('PASS real game recovered volcano / waterfall / shore '+(mobile?'phone':'PC'));
}fs.writeFileSync('docs/integration/evidence-recovery-20261115/runtime.json',JSON.stringify(evidence,null,2));
}finally{await browser.close();server.close();}
