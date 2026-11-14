// 実WebGL＋通常のUIイベント。検証モードの在庫はテスト用fixture。
// 数量付き新規通常ゲームの到達性はspace.test、経路はspace-world.testで別途確認。
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const root=path.resolve(new URL('../..',import.meta.url).pathname),html=fs.readFileSync(path.join(root,'dist/index.html'));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}/`;
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||(fs.existsSync(chrome)?chrome:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const results=[];
const screenshots=process.env.SPACE_E2E_SCREENSHOTS==='1'; // Manual high-quality evidence is tracked in docs/space/evidence-finish-20261114.
try{
for(const mobile of [false,true]){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
 const page=await ctx.newPage(),errors=[];
 const cdp=await ctx.newCDPSession(page);
 const screenshot=async name=>{if(!screenshots)return;let timer;try{const shot=await Promise.race([cdp.send('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('screenshot timeout '+name)),90000);})]);fs.writeFileSync(path.join(root,'test-results',name),Buffer.from(shot.data,'base64'));}finally{clearTimeout(timer);}};page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE ERROR',String(e));});
 await page.route('https://cdn.jsdelivr.net/npm/three@0.180.0/**',async route=>{
  const rel=new URL(route.request().url()).pathname.split('three@0.180.0/')[1];
  const p=path.resolve(root,'node_modules/three',rel||'');
  if(!p.startsWith(path.join(root,'node_modules/three')+'/'))return route.abort();
  await route.fulfill({body:fs.readFileSync(p),contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});
 });
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.goto(url+'?verify=1');
 await page.waitForFunction(()=>!!window.__GAME__,null,{timeout:30000});
 if(await page.locator('#introGo').isVisible()){await page.locator(`.heropick[data-id="${mobile?'girl':'boy'}"]`).click();await page.locator('#introGo').click();}
 await page.waitForFunction(()=>__GAME__.W3.state==='ready',null,{timeout:60000});
 // Real renderer and formal models, low-quality public preset for deterministic CPU-only CI.
 // High-quality PC visuals are reviewed separately in the manual game screenshots.
 await page.evaluate(()=>__GAME__.W3.gfx.setQuality('low'));
 await page.locator('#hud [data-tab="settings"]').click();await page.locator(`.heropick[data-id="${mobile?'girl':'boy'}"]`).click();await page.locator('button[data-act="closepanel"]').click();
 const section=async id=>{await page.locator(`[data-sp="section"][data-id="${id}"]`).click();await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());};
 await page.locator('[data-act="tab"][data-tab="space"]:visible').first().click();
 await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());
 await page.locator('[data-sp="select"][data-id="sp_plate"]').click();
 assert(await page.locator('.sp-card .sic').first().evaluate(e=>getComputedStyle(e).backgroundImage.startsWith('url(')),'space atlas visible, no safe-area CSS variable collision');
 await page.locator('#sp-count').fill('2');
 await page.locator('[data-sp="craft"][data-id="c_sp_plate"]').click();
 await page.locator('[data-sp="finish"]').click();
 assert(await page.evaluate(()=>!__GAME__.S.space.job));
 await section('実習');await page.locator('#sp-gap').selectOption('rubber');await page.locator('#sp-on').check();await page.locator('[data-sp="practice"]').click();
 assert(await page.evaluate(()=>!__GAME__.S.space.lessons.switch),'絶縁体だけでは合格しない');
 await page.locator('#sp-gap').selectOption('copper');await page.locator('#sp-on').check();await page.locator('[data-sp="practice"]').click();
 assert(await page.evaluate(()=>__GAME__.S.space.lessons.switch));
 const lesson=async id=>page.locator('#sp-lesson').selectOption(id);
 const practice=async()=>page.locator('[data-sp="practice"]').click();
 await lesson('transistor');await page.locator('#sp-on').check();await practice();
 await lesson('gates');
 for(const gate of ['AND','OR','NOT'])for(const a of [0,1])for(const b of gate==='NOT'?[0]:[0,1]){
  await page.locator('#sp-gate').selectOption(gate);await page.locator('#sp-a').fill(String(a));await page.locator('#sp-b').fill(String(b));
  await page.locator('#sp-answer').fill(String(gate==='AND'?a&b:gate==='OR'?a|b:1-a));await practice();
 }
 await lesson('adder');await page.locator('#sp-answer').fill('5');await practice();
 await lesson('memory');await page.locator('[data-sp="memory-write"]').click();await page.locator('#sp-answer').fill('7');await practice();
 await lesson('architecture');for(const [k,v]of Object.entries({compute:'演算',sequence:'制御',store:'記憶',interface:'入出力'}))await page.locator('#sp-'+k).selectOption(v);await practice();
 await lesson('program');await practice();await lesson('sensors');await page.locator('#sp-answer').selectOption('空気再生');await practice();
 assert(await page.evaluate(()=>__GAME__.D.space.lessons.every(l=>__GAME__.S.space.lessons[l.id])),'8実習をUIから完了');
 await section('発射サイト');await page.locator('[data-sp="find-site"]').click();
 await page.waitForFunction(()=>!!__GAME__.U.space.site);
 await page.locator('[data-sp="check-site"]').click();
 assert((await page.locator('#sp-message').textContent()).includes('設置できます'));
 await page.locator('[data-sp="place-site"]').click();
 assert(await page.evaluate(()=>__GAME__.SPACE.placed(__GAME__.S)));
 const capture=async name=>{
  await page.evaluate(()=>{__GAME__.W3.gfx.resumeGraphics();__GAME__.U.space.overview=true;__GAME__.setTab('explore');});
  await page.waitForFunction(()=>window.HD2D.spaceModelStatus(__GAME__.W3.gfx)==='ready');
  await page.waitForTimeout(2000);
  console.log('capture',mobile?'mobile':'pc',name);
  // Preserve a real rendered frame while avoiding saturation of CI software rasterization during readback.
  await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());
  try{await screenshot(`${mobile?'mobile':'pc'}-${name}.png`);}
  finally{await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());}
  await page.locator('[data-act="tab"][data-tab="space"]:visible').first().click();await section('組立');
 };
 await capture('S0');
 const slots=await page.evaluate(()=>__GAME__.D.space.slots.map(x=>x.id));
 let previousStage=0;
 for(const id of slots){await page.locator(`[data-sp="install"][data-id="${id}"]`).click();const stage=await page.evaluate(()=>__GAME__.SPACE.stage(__GAME__.S));if(stage!==previousStage){await capture('S'+stage);previousStage=stage;}}
 await page.evaluate(()=>__GAME__.U.space.lowAngle=true);await capture('low-angle');await page.evaluate(()=>__GAME__.U.space.lowAngle=false);
 await page.locator('[data-sp="equip"]').click();
 await section('試験');
 const tests=await page.evaluate(()=>__GAME__.D.space.tests.map(x=>({id:x.id,answer:x.answer})));
 for(const t of tests){await page.locator('#sp-test-'+t.id).selectOption(t.answer);await page.locator(`[data-sp="test"][data-id="${t.id}"]`).click();}
 assert(await page.evaluate(()=>__GAME__.SPACE.conditions(__GAME__.S).every(x=>x.ok)));
 await page.evaluate(()=>{const g=__GAME__,b=g.S.build['space-site'];g.W3.gfx.resumeGraphics();g.W3.pos={x:b.x,z:b.z+11};g.S.pos={...g.W3.pos};g.setTab('explore');});
 await page.waitForTimeout(600);
 await page.waitForFunction(()=>window.HD2D.spaceModelStatus(__GAME__.W3.gfx)==='ready');
 const visual=await page.evaluate(()=>{const r=__GAME__.W3.gfx.getScene().getObjectByName('SpaceSiteModels');return {visible:r?.visible,rocket:r?.children.some(o=>o.name==='space-model:rocket'&&o.visible)};});
 assert(visual.visible&&visual.rocket,JSON.stringify(visual));
 await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());await screenshot(`space-${mobile?'mobile':'desktop'}-site.png`);await page.evaluate(()=>__GAME__.W3.gfx.resumeGraphics());
 await page.evaluate(()=>{__GAME__.U.space.section='打ち上げ';__GAME__.setTab('space');});
 await page.locator('[data-sp="board"]').click();
 assert.equal(await page.evaluate(()=>__GAME__.S.space.phase),'boarded');
 await page.locator('[data-sp="launch"]').click();
 assert(await page.evaluate(()=>!!__GAME__.S.space.runId));
 // Hold a deterministic instant of the real game renderer, not a standalone model demo.
 await page.evaluate(()=>{window.__RealDate=Date;const now=Date.now();window.Date=class extends window.__RealDate{static now(){return now;}};__GAME__.S.space.launchAt=now-9100;__GAME__.SPACE.advance(__GAME__.S);__GAME__.setTab('explore');});
 await page.waitForTimeout(2000);await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());
 await screenshot(`${mobile?'mobile':'pc'}-ignition.png`);
 await page.evaluate(()=>{window.Date=window.__RealDate;__GAME__.W3.gfx.resumeGraphics();});
 await page.reload({waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>!!window.__GAME__,null,{timeout:120000});
 await page.waitForFunction(()=>__GAME__.W3.state==='ready' && !!__GAME__.W3.gfx, null, {timeout:120000});
 await page.evaluate(()=>__GAME__.W3.gfx.setQuality('low'));
 await page.waitForFunction(()=>__GAME__.S.space.phase!=='boarded');
 // 演出の時刻は保存した発射時刻からの実時間。ソフトウェア描画では再読み込みの間に終わっていることがあるので、まだ飛んでいるときだけスキップを押す
 const skipped=await page.evaluate(()=>{const b=document.querySelector('[data-sp="skip"]');if(b&&__GAME__.SPACE.active.includes(__GAME__.S.space.phase)){b.click();return true;}return false;});
 console.log('skip clicked:',skipped,'phase:',await page.evaluate(()=>__GAME__.S.space.phase));
 await page.waitForFunction(()=>__GAME__.S.space.phase==='ending');
 await page.evaluate(()=>__GAME__.W3.gfx.pauseGraphics());await screenshot(`space-${mobile?'mobile':'desktop'}-ending.png`);await page.evaluate(()=>__GAME__.W3.gfx.resumeGraphics());
 const first=await page.evaluate(()=>JSON.stringify(__GAME__.S.space.firstClear));
 await page.locator('[data-sp="back"]').click();
 assert.equal(await page.evaluate(()=>__GAME__.S.space.phase),'ground');
 assert.equal(await page.evaluate(()=>JSON.stringify(__GAME__.S.space.firstClear)),first);
 assert.equal(await page.evaluate(()=>__GAME__.S.flags.hero),mobile?'girl':'boy');
 assert.equal(await page.evaluate(()=>localStorage.getItem('zero-kagaku-save')),null,'通常セーブに検証データを書かない');
 assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth),'ページの横はみ出しなし');
 assert.deepEqual(errors,[]);
 results.push({viewport:mobile?'mobile390x844':'desktop1280x800',realWebGL:true,graphicsQuality:'low (public preset, CPU-only CI)',screenshots,passed:true});console.log('PASS',results.at(-1));
 await ctx.close();
}
}finally{await browser.close();server.close();fs.writeFileSync(path.join(root,'test-results/space-e2e.json'),JSON.stringify(results,null,2));}
