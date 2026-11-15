// 建設ルールを有効にし、通常採取から設備の現地施工と宇宙到達を接続する数量テスト。
// 主人公の全移動経路と発射サイト設置は別の世界/E2E検査で確認する。
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {loadTerrain} from './helpers/terrain.mjs';
const ctx={console};vm.createContext(ctx);
for(const f of ['data','space-data','construction-data','engine','space','construction','nature'])vm.runInContext(fs.readFileSync(new URL('../src/game/'+f+'.js',import.meta.url),'utf8'),ctx,{filename:f+'.js'});
const {DATA:D,ENGINE:E,SPACE:P,CONS:C,NATURE:N}=ctx;
const terrain=await loadTerrain(),W=N.create(D,E,{...terrain,cfg:terrain.DEFAULT_CONFIG});let tests=0;
const world={commitPlacement(S,p,token){if(token!==S.seq)return {ok:false};S.build[p.id]={x:p.x,z:p.z,rot:p.rot};S.seq++;return {ok:true};}};
function test(name,f){f();tests++;console.log('PASS construction-enabled',name);}
const count=(s,id)=>E.cnt(s,id)+(C.built(s,id)?1:0);
function buildFacility(s,def){
 W.setStructures(C.colliders(s));let spot;
 for(let radius=8;radius<180&&!spot;radius+=4)for(let k=0;k<40;k++){
  const x=Math.round(D.base.x+Math.cos(k*Math.PI/20)*radius),z=Math.round(D.base.z+Math.sin(k*Math.PI/20)*radius);
  if(C.checkBuilding(s,W,def.id,x,z,0,{player:null,npcs:[],reserved:[]}).ok){spot={x,z};break;}
 }
 assert(spot,'site exists for '+def.id);
 const plan=C.plan(s,W,def.id,spot.x,spot.z,0,{},s.seq);assert(plan.ok,plan.msg);
 const inst=s.cons.inst[plan.id],f=def.footprint,pos={x:spot.x,z:spot.z+(f.shape==='rect'?f.d/2:f.r)+.5};
 assert(C.deliverAll(s,W,plan.id,pos,s.seq).ok);
 while(inst.phase!=='completed'){now+=100000;const a=C.startWork(s,W,plan.id,pos,now,s.seq);assert(a.ok,a.msg);now+=100000;const b=C.finishWork(s,W,plan.id,pos,now,s.seq);assert(b.ok,b.msg);}
 assert(E.hasTool(s,def.facility));assert.equal(E.cnt(s,def.facility),0,'completed facility is not duplicated in inventory');
}
// 新規通常ゲームから、実際の採取/実験/製作関数だけで材料を作る。
const s=E.newState();s.cons.rule="build";let now=100000,operations=0;const trail=[];
function performLesson(id){if(P.state(s).lessons[id])return;const l=D.space.lessons.find(x=>x.id===id);for(const k of l.prev)performLesson(k);for(const k of l.need)ensure(k,1);
  if(id==='switch'){assert(!P.practice(s,id,{on:true,gap:'copper',tried:['copper']}).passed);assert(P.practice(s,id,{on:true,gap:'copper',tried:['rubber','copper']}).passed);}
  if(id==='transistor')assert(P.practice(s,id,{on:true}).passed);
  if(id==='gates')for(const gate of ['AND','OR','NOT'])for(const a of [0,1])for(const b of gate==='NOT'?[0]:[0,1])P.practice(s,id,{gate,a,b,answer:gate==='AND'?a&b:gate==='OR'?a|b:1-a});
  if(id==='adder')assert(P.practice(s,id,{a:3,b:2,answer:5}).passed);
  if(id==='memory'){P.practice(s,id,{action:'write',value:7});assert(P.practice(s,id,{action:'read',answer:7}).passed);}
  if(id==='architecture')assert(P.practice(s,id,{compute:'演算',sequence:'制御',store:'記憶',interface:'入出力'}).passed);
  if(id==='program')assert(P.practice(s,id,{code:'LOAD 2\nADD 3\nSTORE\nOUT'}).passed);
  if(id==='sensors')assert(P.practice(s,id,{answer:'空気再生'}).passed);
}
function ensure(id,q){if(count(s,id)>=q)return;if(trail.includes(id))throw Error('cycle '+trail.join('>')+'>'+id);trail.push(id);
  while(count(s,id)<q){if(++operations>40000)throw Error('budget '+id);now+=100000;
    const sources=D.regions.flatMap(r=>r.res.filter(x=>x.id===id).map(res=>({r,res}))).sort((a,b)=>(a.res.need?1:0)-(b.res.need?1:0));
    if(sources.length){const {r,res}=sources[0];if(res.need&&!res.need.some(t=>E.hasTool(s,t)))ensure(res.need[0],1);assert(E.harvestDeposit(s,r.id,E.resKey(res),{token:s.seq,now,rng:()=>.99}).ok);continue;}
    const c=D.crafts.find(c=>c.out===id),p=D.procs.find(p=>p.out[id]&&!Object.keys(p.inp).includes(id));if(!c&&!p)throw Error('no producer '+id);
    const recipe=c||p;if(c?.lesson)performLesson(c.lesson);
    const at=c?c.at:p.at[0];if(at)ensure(at,1);for(const k of recipe.tools)ensure(k,1);
    for(let round=0;round<100;round++){
      if(at)ensure(at,1);for(const k of recipe.tools)ensure(k,1);
      for(const [k,n]of Object.entries(recipe.inp))ensure(k,n);
      if((!at||E.hasTool(s,at))&&recipe.tools.every(k=>E.hasTool(s,k))&&Object.entries(recipe.inp).every(([k,n])=>E.cnt(s,k)>=n))break;
      if(round===99)throw Error("simultaneous inputs "+id);
    }
    if(c?.space){assert(P.startCraft(s,c.id,1,now).ok);assert(P.finishCraft(s,now+100000).ok);}else if(c&&C.facilityBuilding(id)){buildFacility(s,C.facilityBuilding(id));}else if(c){const r=E.runCraft(s,c.id,s.seq);assert(r.ok,JSON.stringify(r));}else{const r=E.runExperiment(s,recipe.inp,at,recipe.op,s.seq);assert(r.ok,JSON.stringify(r));}
  }trail.pop();
}
test('通常モードの天然資源から実習・全製作・試験・宇宙到達',()=>{ensure('sp_testbench',1);for(let n=0;n<20&&!D.space.siteItems.every(id=>E.hasTool(s,id));n++)for(const id of D.space.siteItems)ensure(id,1);const placement=P.place(s,world,0,0,0);assert(placement.ok,placement.msg);for(const slot of D.space.slots){ensure(slot.item,1);assert(P.install(s,slot.id).ok);}ensure('sp_suit',1);assert(P.equip(s).ok);for(const t of D.space.tests)assert(P.test(s,t.id,t.answer).ok,t.id);assert(P.board(s,{x:0,z:10}).ok);assert(P.begin(s,now).ok);assert(P.advance(s,now+20000).ok);assert(s.space.firstClear);assert(!s.verify);for(const id of D.space.ids)assert(s.disc[id], '必須用途を通っていない '+id);});
console.log(JSON.stringify({tests,operations,items:Object.keys(D.items).length,added:D.space.ids.length,normalClear:!!s.space.firstClear,buildings:C.list(s).filter(x=>x.phase==='completed').length,limits:'建設ルール有効。天然資源の数量と実地形上の設備施工。全移動経路と射点設置は別テスト'}));
