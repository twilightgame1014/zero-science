/* 宇宙計画の判定と保存状態。描画やDOMには依存しない。 */
var SPACE=(function(D,E){
  const C=D.space, active=['countdown','retract','ignition','ascent','space'];
  const phases=['countdown','retract','ignition','ascent','space','ending'];
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
  const fail=msg=>({ok:false,msg});
  /* Claude 側の試作（feature/game-space-program、2026-11-13。公開版には入っていない）のセーブ形式からの移行。
     その形式は space.know／inst／tests／wear／clear を持つ。実習は対応する実習へ、機体に付けた部品と持ち物は対応する ID へ戻す。
     対応のない ID は消さずに残す（engine の方針どおり）。古い試験の合格は形式が違うので引き継がない（やり直し） */
  const CLAUDE_ITEMS={computer:'sp_computer',shipcomputer:'sp_flightcomputer',radio:'sp_radio',shipradio:'sp_radio',spacesuit:'sp_suit',lifesupport:'sp_lifesupport',cabinlife:'sp_lifesupport',
    r_frame:'sp_hull',r_skin:'sp_skin',r_engine:'sp_propulsion',r_capsule:'sp_capsule',powerunit:'sp_power',launchpad:'sp_pad',tower:'sp_tower',control:'sp_control',assembly:'sp_assembly',
    switch:'sp_switch',transistor:'sp_transistor',gateboard:'sp_gate',adderboard:'sp_adder',memboard:'sp_memory',cpuboard:'sp_cpu',iounit:'sp_io',sensorunit:'sp_sensor',seal:'sp_seal',
    helmet:'sp_helmet',gloves:'sp_gloves',pressurelayer:'sp_pressurelayer',outerlayer:'sp_protectlayer',innerwear:'sp_liner',ceramic:'sp_ceramic',semifab:'sp_fab',
    airtank:'sp_air',co2scrubber:'sp_scrubber',coolingunit:'sp_cooling',propcell:'sp_charge'};
  const CLAUDE_LESSONS={circuit:'switch',switching:'transistor',gates:'gates',adder:'adder',memory:'memory',roles:'architecture',program:'program',sensors:'sensors'};
  const CLAUDE_SLOTS={frame:'r_frame',engine:'r_engine',power:'powerunit',computer:'shipcomputer',radio:'shipradio',capsule:'r_capsule',life:'cabinlife',skin:'r_skin'};
  function fromClaude(S,old){
    const lessons={},moved={},kept=[];
    for(const k of Object.keys(object(old.know)))if(CLAUDE_LESSONS[k])lessons[CLAUDE_LESSONS[k]]=true;
    const give=(id,q)=>{const to=CLAUDE_ITEMS[id];if(!to||!D.items[to]){kept.push(id);return;}S.inv[to]=(S.inv[to]||0)+q;if(D.items[to].unique)S.inv[to]=Math.min(S.inv[to],1);moved[id]=to;if(!S.disc[to])S.disc[to]={first:Date.now(),made:1,total:q,routes:['migrate:claude'],best:0};};
    for(const [slot,item] of Object.entries(CLAUDE_SLOTS))if(object(old.inst)[slot])give(item,1);           // 機体に付けていた部品は持ち物へ戻す
    for(const id of Object.keys(S.inv||{}))if(CLAUDE_ITEMS[id]){const q=S.inv[id];delete S.inv[id];give(id,q);}
    const n={version:1,lessons,migratedFrom:{format:'claude-2026-11-13',at:Date.now(),moved,kept:[...new Set(kept)],clear:old.clear&&isFinite(old.clear.t)?old.clear.t:null}};
    if(n.migratedFrom.clear)n.firstClear={at:n.migratedFrom.clear,runId:'claude-legacy',discoveries:Object.keys(S.disc||{}).length,crafts:0};
    return n;
  }
  function state(S){
    if(S.space&&typeof S.space==='object'&&S.space.know&&typeof S.space.know==='object'&&!S.space.lessons)S.space=fromClaude(S,S.space);
    const p=S.space=object(S.space);p.version=1;p.rev=Number.isSafeInteger(p.rev)&&p.rev>=0?p.rev:0;
    p.lessons=object(p.lessons);p.installed=object(p.installed);p.tests=object(p.tests);p.practice=object(p.practice);
    for(const k of Object.keys(p.installed))if(!C.slots.some(s=>s.id===k)||!Number.isSafeInteger(p.installed[k])||p.installed[k]<=0)delete p.installed[k];
    if(!['ground','boarded',...phases].includes(p.phase))p.phase='ground';
    p.history=Array.isArray(p.history)?p.history.slice(-200):[];
    if(p.job&&(!C.recipes.some(c=>c.id===p.job.id)||!Number.isSafeInteger(p.job.batches)||p.job.batches<1||p.job.batches>20||!Number.isFinite(p.job.readyAt)))delete p.job;
    if(active.includes(p.phase)&&(!Number.isFinite(p.launchAt)||typeof p.runId!=='string'))p.phase='ground';
    return p;
  }
  function log(S,kind,text){const p=state(S);p.history.push({t:Date.now(),kind,text});p.history=p.history.slice(-200);}
  const locked=S=>state(S).phase!=='ground';
  const placed=S=>{const b=S.build&&S.build['space-site'];return !!b&&!b.removed&&Number.isFinite(b.x)&&Number.isFinite(b.z)&&Number.isFinite(b.rot);};
  /* 段階は契約 v6（Muse ラウンド30）の組込枠の組合せ：S1＝骨組み、S2＝＋推進、S3＝＋搭乗区画＋外装、S4＝全部（完成形） */
  const stage=S=>{const i=state(S).installed;return !i.structure?0:C.slots.every(s=>i[s.id])?4:i.capsule&&i.skin?3:i.propulsion?2:i.structure?1:0;};
  function owned(S,id){const p=state(S);return E.has(S,id)||(id==='sp_suit'&&!!p.suit)||(!!p.ground&&['sp_pad','sp_tower','sp_control','sp_power'].includes(id))||C.slots.some(slot=>slot.item===id&&!!p.installed[slot.id]);}
  function cancelCraft(S){const p=state(S);if(locked(S))return fail('演出中です');if(!p.job)return fail('製作中ではありません');delete p.job;S.seq++;return {ok:true};}
  function needs(S,c,batches){
    const p=state(S),n=batches||1,r=[];
    if(c.at&&!E.hasTool(S,c.at))r.push({kind:'equipment',id:c.at,text:'設備：'+D.items[c.at].name});
    for(const id of c.tools)if(!E.hasTool(S,id))r.push({kind:'equipment',id,text:'道具・設備：'+D.items[id].name});
    if(c.lesson&&!p.lessons[c.lesson])r.push({kind:'lesson',id:c.lesson,text:'実習：'+C.lessons.find(l=>l.id===c.lesson).name});
    if(!E.vflag(S,'free'))for(const [id,q]of Object.entries(c.inp))if(E.cnt(S,id)<q*n)r.push({kind:'material',id,missing:q*n-E.cnt(S,id),text:D.items[id].name+' ×'+(q*n-E.cnt(S,id))+'不足'});
    if(D.items[c.out].unique&&owned(S,c.out))r.push({kind:'owned',id:c.out,text:'完成済み'});
    return r;
  }
  function startCraft(S,id,batches,now){
    const p=state(S),c=C.recipes.find(c=>c.id===id);now=now??Date.now();
    if(!c||locked(S))return fail('地上で製作してください');if(p.job)return fail('製作中の工程を先に完了または取消してください');
    if(!Number.isSafeInteger(batches)||batches<1||batches>20||(D.items[c.out].unique&&batches!==1))return fail('数量は1〜20。設備は1台ずつです');
    const n=needs(S,c,batches);if(n.length)return {ok:false,msg:n.map(x=>x.text).join('／'),needs:n};
    p.job={id,batches,readyAt:now+(E.vflag(S,'instant')?0:c.seconds*1000*batches)};S.seq++;return {ok:true};
  }
  function finishCraft(S,now){
    const p=state(S),j=p.job;if(!j)return fail('製作中ではありません');if(locked(S))return fail('演出中です');
    if((now??Date.now())<j.readyAt)return fail('加工中です');const c=C.recipes.find(c=>c.id===j.id),n=needs(S,c,j.batches);
    if(n.length)return {ok:false,msg:n.map(x=>x.text).join('／'),needs:n};
    if(!E.vflag(S,'free'))for(const [id,q]of Object.entries(c.inp)){S.inv[id]-=q*j.batches;if(!S.inv[id])delete S.inv[id];}
    const qty=c.qty*j.batches;const news=E.addItem(S,c.out,qty,c.id)?[c.out]:[];
    S.hist.unshift({t:Date.now(),k:'craft',craft:c.id,inp:Object.fromEntries(Object.entries(c.inp).map(([k,v])=>[k,v*j.batches])),out:{[c.out]:qty}});S.hist=S.hist.slice(0,200);
    log(S,'craft',D.items[c.out].name+' ×'+qty);delete p.job;S.seq++;return {ok:true,news};
  }
  function lessonNeeds(S,id){const l=C.lessons.find(x=>x.id===id);if(!l)return ['実習がありません'];const p=state(S);return [...l.need.filter(i=>!E.hasTool(S,i)).map(i=>D.items[i].name+'が必要'),...l.prev.filter(i=>!p.lessons[i]).map(i=>'前の実習：'+C.lessons.find(l=>l.id===i).name)];}
  // 汎用の学習用CPU。ホワイトリストの整数命令だけを実行し、evalや飛行制御は持たない。
  function program(lines){let acc=0,mem=0,output=[];const trace=[];
    if(typeof lines!=='string'||lines.length>300)return fail('命令は300文字以内');const cmds=lines.trim().split(/\n/);if(cmds.length>16)return fail('命令は16行以内');
    for(const raw of cmds){const m=raw.trim().match(/^(LOAD|ADD|STORE|READ|OUT)(?:\s+(-?\d+))?$/i);if(!m)return fail('使える命令：LOAD 数、ADD 数、STORE、READ、OUT');const op=m[1].toUpperCase(),v=m[2]===undefined?null:Number(m[2]);
      if(['LOAD','ADD'].includes(op)?v===null||v<0||v>15:v!==null)return fail('LOAD/ADDは0〜15、その他の命令に数は付けません');
      if(op==='LOAD')acc=v;if(op==='ADD')acc+=v;if(acc>255)return fail('学習用の値は255以下です');if(op==='STORE')mem=acc;if(op==='READ')acc=mem;if(op==='OUT')output.push(acc);trace.push({op,acc,mem});}
    return {ok:true,acc,mem,output,trace};
  }
  function practice(S,id,arg){const p=state(S),n=lessonNeeds(S,id);if(n.length)return fail(n.join('／'));arg=object(arg);let output,passed=false;
    if(id==='switch'){if(arg.gap!=null&&!(arg.gap in CONDUCT))return fail('はさむ物を選んでください');const tried=Array.isArray(arg.tried)?arg.tried.filter(k=>k in CONDUCT):[];
      output=arg.on===true&&CONDUCT[arg.gap]===true?1:0;passed=output===1&&tried.some(k=>CONDUCT[k]===false);}
    if(id==='transistor'){output=arg.on===true?1:0;passed=output===1;}
    if(id==='gates'){if(!['AND','OR','NOT'].includes(arg.gate)||![0,1].includes(arg.a)||![0,1].includes(arg.b))return fail('入力は0か1です');output=arg.gate==='AND'?(arg.a&arg.b):arg.gate==='OR'?(arg.a|arg.b):1-arg.a;
      if(arg.answer===output){p.practice.gates=object(p.practice.gates);p.practice.gates[arg.gate+arg.a+(arg.gate==='NOT'?'':arg.b)]=true;}passed=['AND00','AND01','AND10','AND11','OR00','OR01','OR10','OR11','NOT0','NOT1'].every(k=>p.practice.gates&&p.practice.gates[k]);}
    if(id==='adder'){if(!Number.isInteger(arg.a)||!Number.isInteger(arg.b)||arg.a<0||arg.a>15||arg.b<0||arg.b>15)return fail('0〜15の整数を入力');output=arg.a+arg.b;passed=arg.a===3&&arg.b===2&&arg.answer===5;}
    if(id==='memory'){if(arg.action==='write'){if(!Number.isInteger(arg.value)||arg.value<0||arg.value>15)return fail('値は0〜15');p.practice.memory=arg.value;output='保存しました';}else{output=p.practice.memory??0;passed=arg.action==='read'&&p.practice.memory===7&&arg.answer===7;}}
    if(id==='architecture'){output='演算＝計算、制御＝順番、記憶＝保存、入出力＝外との窓口';passed=arg.compute==='演算'&&arg.sequence==='制御'&&arg.store==='記憶'&&arg.interface==='入出力';}
    if(id==='program'){const r=program(arg.code);if(!r.ok)return r;output=r;passed=r.output.length===1&&r.output[0]===5&&r.mem===5&&r.trace.some(x=>x.op==='STORE');}
    if(id==='sensors'){output={air:'正常',co2:'要点検',temperature:'正常',power:'正常',unit:'架空状態値'};passed=arg.answer==='空気再生';}
    if(passed&&!p.lessons[id]){p.lessons[id]=true;log(S,'lesson',C.lessons.find(l=>l.id===id).name);}S.seq++;return {ok:true,output,passed};
  }
  /* 実習①ではさむ物（Claude 側の実装から移植）：true＝電気を通す（導体）、false＝通さない（絶縁体） */
  const CONDUCT={copper:true,ironrod:true,rubber:false,glass:false,cloth:false};
  function consume(S,id){if(!E.vflag(S,'free')){S.inv[id]--;if(S.inv[id]<=0)delete S.inv[id];}}
  function install(S,id,remove){const p=state(S),slot=C.slots.find(x=>x.id===id);if(!slot||locked(S))return fail('地上で組立してください');if(!placed(S))return fail('発射台をマップに設置してください');
    if(remove){if(id==='structure'&&Object.keys(p.installed).some(k=>k!=='structure'))return fail('ほかの部品を取り外してから構造を外してください');if(!p.installed[id])return fail('未組込です');E.addItem(S,slot.item,1,'space:remove');delete p.installed[id];}
    else{if(p.installed[id])return fail('組込済みです');if(id!=='structure'&&!p.installed.structure)return fail('機体構造を先に組み込んでください');if(!E.has(S,slot.item))return fail(D.items[slot.item].name+'が不足');consume(S,slot.item);p.installed[id]=++p.rev;}
    S.seq++;log(S,'assembly',slot.name+(remove?'を取り外した':'を組み込んだ'));return {ok:true};
  }
  function equip(S){const p=state(S);if(locked(S))return fail('地上で装備してください');if(p.suit)return {ok:true};if(!E.has(S,'sp_suit'))return fail('組立済み宇宙服が必要');consume(S,'sp_suit');p.suit=++p.rev;S.seq++;log(S,'suit','宇宙服を装着');return {ok:true};}
  function place(S,world,x,z,rot,opts){const p=state(S);if(locked(S))return fail('搭乗を取り消してから移設してください');if(!world||![x,z,rot].every(Number.isFinite))return fail('設置座標が不正です');
    const goods=['sp_pad','sp_tower','sp_control','sp_power'];const need=[...(p.ground?[]:goods),...['generator','sp_assembly']].filter(id=>!E.hasTool(S,id));if(need.length)return fail(need.map(id=>D.items[id].name).join('・')+'が必要');
    const r=world.commitPlacement(S,{...C.siteSpec,x,z,rot},S.seq,opts);if(!r.ok)return fail((r.reasons||['設置できません']).join('／'));
    if(!p.ground)goods.forEach(id=>consume(S,id));p.ground=true;p.siteRev=++p.rev;log(S,'site','発射サイトを設置');return {ok:true};
  }
  function signature(S,t){const p=state(S);return JSON.stringify([p.siteRev,S.build&&S.build['space-site'],t.slots.map(k=>[k,p.installed[k]||0]),t.id==='suit'?p.suit:0,t.prior.map(k=>p.tests[k]&&p.tests[k].signature)]);}
  function valid(S,id,seen){const t=C.tests.find(x=>x.id===id);if(!t)return false;seen=seen||new Set();if(seen.has(id))return false;seen.add(id);const p=state(S),r=p.tests[id];return placed(S)&&!!r&&r.pass===true&&r.signature===signature(S,t)&&t.prior.every(k=>valid(S,k,new Set(seen)));}
  function testNeeds(S,id){const p=state(S),t=C.tests.find(x=>x.id===id);if(!t)return ['試験がありません'];const n=[];
    if(!placed(S))n.push('発射サイトを設置');if(!E.hasTool(S,'sp_testbench'))n.push('総合試験端末を製作');if(!E.hasTool(S,'generator'))n.push('発電機を用意');
    for(const k of t.slots)if(!p.installed[k])n.push(C.slots.find(x=>x.id===k).name+'を組込');for(const k of t.prior)if(!valid(S,k))n.push(C.tests.find(x=>x.id===k).name+'に合格');
    if(id==='suit'&&!p.suit)n.push('宇宙服を装着');if(id==='computer'&&!p.lessons.sensors)n.push('船内センサー実習を完了');return n;
  }
  function test(S,id,answer){const p=state(S);if(locked(S))return fail('地上で試験してください');const n=testNeeds(S,id);if(n.length)return fail(n.join('／'));const t=C.tests.find(x=>x.id===id);const pass=answer===t.answer;
    p.tests[id]={pass,signature:signature(S,t),at:Date.now(),reason:pass?'合格':t.answer+'の工程を確認してください'};S.seq++;log(S,'test',t.name+'：'+(pass?'合格':'要改善'));return {ok:pass,msg:p.tests[id].reason};
  }
  function conditions(S){const p=state(S);return [{id:'site',name:'発射台設置済み',ok:placed(S)&&!!p.ground},...C.slots.map(s=>({id:s.id,name:s.name+'組込済み',ok:!!p.installed[s.id]})),{id:'generator',name:'発電機準備完了',ok:E.hasTool(S,'generator')},{id:'suit-equipped',name:'宇宙服装着済み',ok:!!p.suit},...C.tests.map(t=>({id:'test:'+t.id,name:t.name+'合格',ok:valid(S,t.id)}))];}
  function board(S,pos){const p=state(S);if(p.phase!=='ground')return fail('すでに搭乗または演出中です');const n=conditions(S).filter(x=>!x.ok);if(n.length)return fail(n.map(x=>x.name).join('／'));
    const b=S.build['space-site'],entry={x:b.x+Math.sin(b.rot)*10,z:b.z+Math.cos(b.rot)*10};if(!pos||Math.hypot(pos.x-entry.x,pos.z-entry.z)>4)return fail('搭乗口の近くへ移動してください');
    p.phase='boarded';p.returnPos={...pos};S.pos={...(S.pos||{}),...pos};S.seq++;log(S,'board','主人公が搭乗');return {ok:true};
  }
  function begin(S,now){const p=state(S);if(p.phase!=='boarded')return fail('主人公がまだ搭乗していません');if(conditions(S).some(x=>!x.ok))return fail('構成が変わりました。搭乗を取り消して再点検してください');
    p.runId=String(++p.rev)+':'+String(S.seq);p.launchAt=now??Date.now();p.phase='countdown';S.seq++;log(S,'launch','打ち上げ開始');return {ok:true};
  }
  function advance(S,now,skip){const p=state(S);if(!active.includes(p.phase))return fail('再生中ではありません');const elapsed=Math.max(0,(now??Date.now())-p.launchAt);p.phase=skip?'ending':elapsed<3000?'countdown':elapsed<8400?'retract':elapsed<10000?'ignition':elapsed<14000?'ascent':elapsed<18000?'space':'ending';
    if(p.phase==='ending'){if(!p.firstClear){p.firstClear={at:Date.now(),runId:p.runId,discoveries:Object.keys(S.disc).length,crafts:S.hist.filter(h=>h.k==='craft').length};log(S,'clear','初めて宇宙へ到達');}p.lastCompleted=p.runId;}return {ok:true,phase:p.phase};
  }
  function back(S){const p=state(S);if(p.phase!=='ending'&&p.phase!=='boarded')return fail('演出を完了またはスキップしてください');p.phase='ground';delete p.launchAt;if(p.returnPos)S.pos={...(S.pos||{}),...p.returnPos};S.seq++;return {ok:true,pos:p.returnPos};}
  // 一階層ずつ返す。UIは選んだ材料だけ展開し、共有部品の指数的な再帰を避ける。
  function dependency(id){const r=E.producers(id);return {id,name:D.items[id]?.name||id,natural:r.regions.map(x=>x.name),recipes:[...r.crafts.map(c=>({id:c.id,qty:c.qty,materials:Object.entries(c.inp).map(([id,qty])=>({id,qty})),equipment:[...(c.at?[c.at]:[]),...c.tools]})),...r.procs.map(c=>({id:c.id,qty:c.out[id],materials:Object.entries(c.inp).map(([id,qty])=>({id,qty})),equipment:c.at,tools:c.tools}))]};}

  return {CONDUCT,state,owned,needs,startCraft,finishCraft,cancelCraft,lessonNeeds,practice,program,install,equip,place,placed,stage,valid,testNeeds,test,conditions,board,begin,advance,back,dependency,locked,active};
})(typeof DATA!=='undefined'?DATA:require('./data.js'),typeof ENGINE!=='undefined'?ENGINE:require('./engine.js'));
if(typeof module!=='undefined')module.exports=SPACE;
