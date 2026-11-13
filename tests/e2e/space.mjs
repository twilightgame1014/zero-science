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
try{
for(const mobile of [false,true]){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE ERROR',String(e));});
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
 await page.locator('#hud [data-tab="settings"]').click();await page.locator(`.heropick[data-id="${mobile?'girl':'boy'}"]`).click();await page.locator('button[data-act="closepanel"]').click();
 const section=async id=>{await page.locator(`[data-sp="section"][data-id="${id}"]`).click();};
 await page.locator('[data-act="tab"][data-tab="space"]').first().click();
 await page.locator('[data-sp="select"][data-id="sp_plate"]').click();
 await page.locator('#sp-count').fill('2');
 await page.locator('[data-sp="craft"][data-id="c_sp_plate"]').click();
 await page.locator('[data-sp="finish"]').click();
 assert(await page.evaluate(()=>!__GAME__.S.space.job));
 await section('実習');await page.locator('#sp-on').check();await page.locator('[data-sp="practice"]').click();
 assert(await page.evaluate(()=>__GAME__.S.space.lessons.switch));
 await page.evaluate(()=>{for(const l of __GAME__.D.space.lessons)__GAME__.S.space.lessons[l.id]=true;__GAME__.writeNow();});
 await section('発射サイト');await page.locator('[data-sp="find-site"]').click();
 await page.waitForFunction(()=>!!__GAME__.U.space.site);
 await page.locator('[data-sp="check-site"]').click();
 assert((await page.locator('#sp-message').textContent()).includes('設置できます'));
 await page.locator('[data-sp="place-site"]').click();
 assert(await page.evaluate(()=>__GAME__.SPACE.placed(__GAME__.S)));
 await section('組立');
 const slots=await page.evaluate(()=>__GAME__.D.space.slots.map(x=>x.id));
 for(const id of slots)await page.locator(`[data-sp="install"][data-id="${id}"]`).click();
 await page.locator('[data-sp="equip"]').click();
 await section('試験');
 const tests=await page.evaluate(()=>__GAME__.D.space.tests.map(x=>({id:x.id,answer:x.answer})));
 for(const t of tests){await page.locator('#sp-test-'+t.id).selectOption(t.answer);await page.locator(`[data-sp="test"][data-id="${t.id}"]`).click();}
 assert(await page.evaluate(()=>__GAME__.SPACE.conditions(__GAME__.S).every(x=>x.ok)));
 await page.evaluate(()=>{const g=__GAME__,b=g.S.build['space-site'];g.W3.pos={x:b.x,z:b.z+11};g.S.pos={...g.W3.pos};g.setTab('explore');});
 await page.waitForTimeout(600);
 await page.waitForFunction(()=>window.HD2D.spaceModelStatus(__GAME__.W3.gfx)==='ready');
 const visual=await page.evaluate(()=>{const r=__GAME__.W3.gfx.getScene().getObjectByName('SpaceSiteModels');return {visible:r?.visible,rocket:r?.getObjectByName('space-model:rocket')?.visible};});
 assert(visual.visible&&visual.rocket,JSON.stringify(visual));
 await page.screenshot({path:path.join(root,`test-results/space-${mobile?'mobile':'desktop'}-site.png`)});
 await page.evaluate(()=>{__GAME__.U.space.section='打ち上げ';__GAME__.setTab('space');});
 await page.locator('[data-sp="board"]').click();
 assert.equal(await page.evaluate(()=>__GAME__.S.space.phase),'boarded');
 await page.locator('[data-sp="launch"]').click();
 assert(await page.evaluate(()=>!!__GAME__.S.space.runId));
 await page.reload();await page.waitForFunction(()=>!!window.__GAME__);
 await page.waitForFunction(()=>__GAME__.S.space.phase!=='boarded');
 if(await page.locator('[data-sp="skip"]').isVisible())await page.locator('[data-sp="skip"]').click();
 await page.waitForFunction(()=>__GAME__.S.space.phase==='ending');
 await page.screenshot({path:path.join(root,`test-results/space-${mobile?'mobile':'desktop'}-ending.png`)});
 const first=await page.evaluate(()=>JSON.stringify(__GAME__.S.space.firstClear));
 await page.locator('[data-sp="back"]').click();
 assert.equal(await page.evaluate(()=>__GAME__.S.space.phase),'ground');
 assert.equal(await page.evaluate(()=>JSON.stringify(__GAME__.S.space.firstClear)),first);
 assert.equal(await page.evaluate(()=>__GAME__.S.flags.hero),mobile?'girl':'boy');
 assert.equal(await page.evaluate(()=>localStorage.getItem('zero-kagaku-save')),null,'通常セーブに検証データを書かない');
 assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth),'ページの横はみ出しなし');
 assert.deepEqual(errors,[]);
 results.push({viewport:mobile?'mobile390x844':'desktop1280x800',realWebGL:true,passed:true});console.log('PASS',results.at(-1));
 await ctx.close();
}
}finally{await browser.close();server.close();fs.writeFileSync(path.join(root,'test-results/space-e2e.json'),JSON.stringify(results,null,2));}
