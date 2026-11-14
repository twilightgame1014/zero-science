import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx={console};vm.createContext(ctx);
for(const f of ['data','space-data','engine','space'])vm.runInContext(fs.readFileSync(new URL('../src/game/'+f+'.js',import.meta.url),'utf8'),ctx,{filename:f+'.js'});
const {DATA:D,ENGINE:E,SPACE:P}=ctx;let tests=0;
function test(name,f){try{f();console.log('PASS',name);tests++;}catch(e){console.error('FAIL',name);throw e;}}
const plain=x=>JSON.parse(JSON.stringify(x));
const world={commitPlacement(S,p,token){if(token!==S.seq)return {ok:false};S.build[p.id]={x:p.x,z:p.z,rot:p.rot};S.seq++;return {ok:true};}};
const fill=()=>{const s=E.makeVerifyState();P.state(s);for(const l of D.space.lessons)s.space.lessons[l.id]=true;return s;};
function ready(s){assert(P.place(s,world,0,0,0).ok);for(const t of D.space.slots)assert(P.install(s,t.id).ok);assert(P.equip(s).ok);for(const t of D.space.tests)assert(P.test(s,t.id,t.answer).ok);}
test('既存エンジン検査を拡張データでも維持',()=>{const bad=E.runTests().filter(x=>!x.pass);assert.equal(bad.length,0,JSON.stringify(bad));});
test('全新規品に説明・数量・加工時間・モデル参照枠がある',()=>{for(const c of D.space.recipes){assert(c.seconds>0);assert(c.qty>0);assert(D.items[c.out].kid);assert(D.items[c.out].more.includes('簡略化'));assert('model'in D.items[c.out]);}});
test('通常ゲームで材料なし・未設置・未搭乗から発射不能',()=>{const s=E.newState();assert(!P.begin(s).ok);assert(!P.board(s,{x:0,z:10}).ok);assert(!P.place(s,world,0,0,0).ok);assert(!P.install(s,'structure').ok);});
test('加工時間・取消・材料消費・二重受取',()=>{const s=E.newState();s.inv={steel:3,wire:2,glass:1,bench:1,generator:1};assert(P.startCraft(s,'c_sp_machine',1,100).ok);assert(!P.finishCraft(s,101).ok);assert.equal(s.inv.steel,3);assert(P.finishCraft(s,2100).ok);assert.equal(s.inv.steel,1);assert.equal(s.inv.sp_machine,1);assert(!P.finishCraft(s,2200).ok);});
test('不正数量と既存工作経路の時間バイパスを拒否',()=>{const s=fill();assert(!P.startCraft(s,'c_sp_plate',NaN).ok);assert(!P.startCraft(s,'c_sp_plate',21).ok);assert(!E.runCraft(s,'c_sp_plate',s.seq).ok);});
test('加工中の保存復帰',()=>{const s=fill();s.verify.instant=false;assert(P.startCraft(s,'c_sp_plate',2,100).ok);const n=E.deserialize(E.serialize(s));assert(!P.finishCraft(n,200).ok);assert(P.finishCraft(n,5000).ok);});
test('回路実習は前提部品なしに合格できない',()=>{assert(!P.practice(E.newState(),'switch',{on:true}).ok);});
test('ゲートは全真理値表を確認して合格',()=>{const s=fill();delete s.space.lessons.gates;for(const gate of ['AND','OR','NOT'])for(const a of [0,1])for(const b of gate==='NOT'?[0]:[0,1]){const answer=gate==='AND'?a&b:gate==='OR'?a|b:1-a;assert(P.practice(s,'gates',{gate,a,b,answer}).ok);}assert(s.space.lessons.gates);});
test('プログラムは限定命令・上限を守る',()=>{const r=P.program('LOAD 2\nADD 3\nSTORE\nLOAD 0\nREAD\nOUT');assert(r.ok);assert.deepEqual(plain(r.output),[5]);assert(!P.program('eval alert(1)').ok);assert(!P.program('LOAD -1').ok);assert(!P.program('OUT 1').ok);assert(!P.program('LOAD 1\n'.repeat(20)).ok);});
test('記憶は保存・再読込後も保持',()=>{const s=fill();delete s.space.lessons.memory;P.practice(s,'memory',{action:'write',value:7});const n=E.deserialize(E.serialize(s));assert(P.practice(n,'memory',{action:'read',answer:7}).passed);});
test('不合格は資材を破壊しない',()=>{const s=fill();ready(s);const inv=E.serialize(s.inv);assert(!P.test(s,'power','外装').ok);assert.equal(E.serialize(s.inv),inv);assert(!P.valid(s,'final'));});
test('部品交換で依存する試験だけ失効',()=>{const s=fill();ready(s);assert(P.valid(s,'final'));assert(P.install(s,'radio',true).ok);assert(P.install(s,'radio').ok);assert(!P.valid(s,'radio'));assert(!P.valid(s,'uncrewed'));assert(P.valid(s,'computer'));assert(P.valid(s,'power'));});
test('移設は試験を失効させ、搭乗中は移設できない',()=>{const s=fill();ready(s);assert(P.place(s,world,20,20,0).ok);assert(!P.valid(s,'power'));for(const t of D.space.tests)assert(P.test(s,t.id,t.answer).ok);assert(P.board(s,{x:20,z:30}).ok);assert(!P.place(s,world,30,30,0).ok);});
test('搭乗距離・二重発射・再読込・スキップ・探索継続',()=>{const s=fill();s.flags.hero='boy';ready(s);assert(!P.board(s,{x:100,z:100}).ok);assert(P.board(s,{x:0,z:10}).ok);assert.equal(s.pos.z,10);assert.equal(s.pos.x,0);assert(P.begin(s,100).ok);assert(!P.begin(s,101).ok);let n=E.deserialize(E.serialize(s));assert(P.advance(n,8100).ok);assert.equal(n.space.phase,'ascent');const inv=JSON.stringify(n.inv);assert(P.advance(n,9000,true).ok);const clear=JSON.stringify(n.space.firstClear);assert(P.back(n).ok);assert.equal(n.flags.hero,'boy');assert.equal(JSON.stringify(n.inv),inv);assert(P.board(n,{x:0,z:10}).ok);assert(P.begin(n,10000).ok);assert(P.advance(n,10001,true).ok);assert.equal(JSON.stringify(n.space.firstClear),clear);assert.equal(JSON.stringify(n.inv),inv);});
test('全演出段階から復帰可能',()=>{for(const elapsed of [0,3500,5500,8000,12000]){const s=fill();ready(s);P.board(s,{x:0,z:10});P.begin(s,100);P.advance(s,100+elapsed);const n=E.deserialize(E.serialize(s));assert(P.advance(n,15000).ok);assert.equal(n.space.phase,'ending');assert(P.back(n).ok);}});
test('旧セーブの主人公・在庫・建築を保持して移行',()=>{for(const hero of ['boy','girl']){const s=E.deserialize(JSON.stringify({v:4,inv:{steel:4},disc:{},flags:{hero},build:{a:{x:1,z:2,rot:0}}}));assert(s.v>=5,'v5 以降へ移行（2026-11-14 街づくりで v6）');assert.equal(s.flags.hero,hero);assert.equal(s.inv.steel,4);assert.equal(s.build.a.x,1);assert.equal(P.state(s).phase,'ground');}});
test('Claude 側の試作の保存形式（space.know／inst）から移行：実習・部品・到達記録を対応先へ',()=>{const raw={v:5,inv:{r_frame:1,gateboard:2,steel:3,alplate:4},disc:{},flags:{hero:'girl'},build:{'st-bench':{x:1,z:2,rot:0}},space:{know:{circuit:1,gates:2,roles:3},inst:{frame:5,capsule:6},tests:{power:7},wear:true,board:true,launching:0,clear:{t:1234,record:{}},replays:2}};
  const s=E.deserialize(JSON.stringify(raw)),p=P.state(s);assert.deepEqual(plain(p.lessons),{switch:true,gates:true,architecture:true});assert.equal(s.inv.sp_hull,2);assert.equal(s.inv.sp_capsule,1);assert.equal(s.inv.sp_gate,2);assert.equal(s.inv.steel,3);assert.equal(s.inv.alplate,4);
  assert(!s.inv.r_frame&&!s.inv.gateboard);assert.equal(p.firstClear.at,1234);assert.equal(p.phase,'ground');assert.equal(Object.keys(p.tests).length,0);assert.equal(s.flags.hero,'girl');assert(s.build['st-bench']);assert(p.migratedFrom.kept.length===0);
  const again=E.deserialize(E.serialize(s));P.state(again);assert.equal(again.inv.sp_hull,2,'2回目の読み込みで二重に移さない');});
// 新規通常ゲームから、実際の採取/実験/製作関数だけで材料を作る。
const s=E.newState();let now=100000,operations=0;const trail=[];
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
function ensure(id,q){if(E.cnt(s,id)>=q)return;if(trail.includes(id))throw Error('cycle '+trail.join('>')+'>'+id);trail.push(id);
  while(E.cnt(s,id)<q){if(++operations>40000)throw Error('budget '+id);now+=100000;
    const sources=D.regions.flatMap(r=>r.res.filter(x=>x.id===id).map(res=>({r,res}))).sort((a,b)=>(a.res.need?1:0)-(b.res.need?1:0));
    if(sources.length){const {r,res}=sources[0];if(res.need&&!res.need.some(t=>E.has(s,t)))ensure(res.need[0],1);assert(E.harvestDeposit(s,r.id,E.resKey(res),{token:s.seq,now,rng:()=>.99}).ok);continue;}
    const c=D.crafts.find(c=>c.out===id),p=D.procs.find(p=>p.out[id]&&!Object.keys(p.inp).includes(id));if(!c&&!p)throw Error('no producer '+id);
    const recipe=c||p;if(c?.lesson)performLesson(c.lesson);
    const at=c?c.at:p.at[0];if(at)ensure(at,1);for(const k of recipe.tools)ensure(k,1);
    for(let round=0;round<100;round++){
      if(at)ensure(at,1);for(const k of recipe.tools)ensure(k,1);
      for(const [k,n]of Object.entries(recipe.inp))ensure(k,n);
      if((!at||E.has(s,at))&&recipe.tools.every(k=>E.has(s,k))&&Object.entries(recipe.inp).every(([k,n])=>E.cnt(s,k)>=n))break;
      if(round===99)throw Error("simultaneous inputs "+id);
    }
    if(c?.space){assert(P.startCraft(s,c.id,1,now).ok);assert(P.finishCraft(s,now+100000).ok);}else if(c){const r=E.runCraft(s,c.id,s.seq);assert(r.ok,JSON.stringify(r));}else{const r=E.runExperiment(s,recipe.inp,at,recipe.op,s.seq);assert(r.ok,JSON.stringify(r));}
  }trail.pop();
}
test('通常モードの天然資源から実習・全製作・試験・宇宙到達',()=>{ensure('sp_testbench',1);for(let n=0;n<20&&!D.space.siteItems.every(id=>E.has(s,id));n++)for(const id of D.space.siteItems)ensure(id,1);const placement=P.place(s,world,0,0,0);assert(placement.ok,placement.msg);for(const slot of D.space.slots){ensure(slot.item,1);assert(P.install(s,slot.id).ok);}ensure('sp_suit',1);assert(P.equip(s).ok);for(const t of D.space.tests)assert(P.test(s,t.id,t.answer).ok,t.id);assert(P.board(s,{x:0,z:10}).ok);assert(P.begin(s,now).ok);assert(P.advance(s,now+15000).ok);assert(s.space.firstClear);assert(!s.verify);for(const id of D.space.ids)assert(s.disc[id], '必須用途を通っていない '+id);});
console.log(JSON.stringify({tests,operations,items:Object.keys(D.items).length,added:D.space.ids.length,normalClear:!!s.space.firstClear,limits:'採取・製作の数量付き到達性。世界移動と設置判定は別テスト'}));
