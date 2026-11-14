/* ===================== 宇宙計画のロジック（UI から独立。データは data.js の DATA.space） =====================
   依存関係の逆引き・実習（知識）・機体の組立・試験・打ち上げの条件と記録。
   ここにあるのはゲームの進行の判定だけで、推進・誘導などの現実の計算は扱わない（模擬の表示と記録だけ）。 */
var SPACE = (function(D, E){
  const IT = D.items, SP = D.space;
  const sp = S => S.space || (S.space = E.newSpace());
  const slotOf = item => { const m = SP.modules.find(x=>x.item===item); return m ? m.slot : null; };
  const installed = (S, slot) => !!sp(S).inst[slot];
  /* 持っている（在庫）か、機体に取りつけてある */
  const owns = (S, id) => E.hasTool(S, id) || (slotOf(id) && installed(S, slotOf(id)));
  const everMade = (S, id) => owns(S,id) || !!(S.disc[id] && S.disc[id].made>0 && !IT[id].tags.includes("天然資源"));
  const ground = item => SP.ground.find(g=>g.item===item);
  /* 地上設備がマップに置いてあるか（工作で作っただけ・在庫にあるだけでは置いたことにならない） */
  function placedAt(S, item){ const g = ground(item); if(!g) return null; const b = (S.build||{})[g.plan];
    return (b && !b.removed && isFinite(b.x) && isFinite(b.z) && E.hasTool(S,item)) ? {x:b.x, z:b.z, rot:b.rot||0} : null; }
  const placed = (S, item) => !!placedAt(S, item);
  const dist = (a,b) => Math.hypot(a.x-b.x, a.z-b.z);

  /* ---------- 依存関係（逆引き） ---------- */
  function recipes(id){ return {crafts:D.crafts.filter(c=>c.out===id), procs:D.procs.filter(p=>p.out[id]), regions:D.regions.filter(r=>!r.future && (r.res.some(x=>x.id===id) || (r.rare||[]).some(x=>x.id===id)))}; }
  /* いちばんふつうの作り方を1つ選ぶ（採れる物は採取、次に工作、次に実験。今すぐできる作り方があればそれを優先） */
  function mainRecipe(S, id){
    const r = recipes(id);
    if(r.regions.length && !r.crafts.length && !r.procs.length) return {kind:"gather", region:r.regions[0]};
    const cs = r.crafts.map(c=>({kind:"craft", craft:c, st:craftState(S,c)})), ps = r.procs.map(p=>({kind:"proc", proc:p, st:procState(S,p)}));
    const all = cs.concat(ps); if(!all.length) return r.regions.length ? {kind:"gather", region:r.regions[0]} : null;
    const rank = {ready:0, mat:1, know:2, fac:3};
    return all.slice().sort((a,b)=>rank[a.st.s]-rank[b.st.s])[0];
  }
  function craftState(S, c){ const pl = E.planCraft(S, c);
    if(pl.ok) return {s:"ready"}; if(pl.kind==="qty") return {s:"mat", msg:pl.msg}; if(pl.kind==="know") return {s:"know", msg:pl.msg, know:pl.know};
    if(pl.kind==="own") return {s:"ready"}; return {s:"fac", msg:pl.msg}; }
  function procState(S, p){
    if(!p.at.some(f=>E.hasTool(S,f))) return {s:"fac", msg:"設備「"+p.at.map(f=>IT[f].name).join("」か「")+"」が必要"};
    const t = p.tools.find(x=>!E.hasTool(S,x)); if(t) return {s:"fac", msg:"道具「"+IT[t].name+"」が必要"};
    const short = Object.keys(p.inp).filter(k=>E.cnt(S,k)<p.inp[k]); if(short.length && !E.vflag(S,"free")) return {s:"mat", msg:"材料が足りない："+short.map(k=>IT[k].name).join("、")};
    return {s:"ready"}; }
  /* 部品の状態：done（完成済み）／ready（製作可能）／mat（材料不足）／fac（設備・道具不足）／know（実習待ち）／gather（採取）／none */
  function itemStatus(S, id){
    if(everMade(S,id)) return {s:"done"};
    const m = mainRecipe(S, id); if(!m) return {s:"none"};
    if(m.kind==="gather") return {s: E.cnt(S,id)>0 ? "done" : "gather", region:m.region};
    return Object.assign({via:m}, m.st);
  }
  /* 原料までさかのぼる木。need：必要な数。seen で循環を止める。depth で深さを制限（画面は少しずつ開く） */
  function tree(S, id, need, depth, seen){
    need = need||1; depth = depth==null ? 12 : depth; seen = seen||[];
    const node = {id, need, have:E.cnt(S,id), st:itemStatus(S,id), kids:[], tools:[]};
    if(seen.includes(id)){ node.loop = true; return node; }
    const m = mainRecipe(S, id); node.via = m;
    if(!m || m.kind==="gather" || depth<=0) return node;
    const inp = m.kind==="craft" ? m.craft.inp : m.proc.inp, outN = m.kind==="craft" ? m.craft.qty : m.proc.out[id];
    const times = Math.ceil(need/outN); node.times = times;
    node.tools = m.kind==="craft" ? m.craft.tools.concat(m.craft.at?[m.craft.at]:[]) : m.proc.tools.concat([m.proc.at.find(f=>E.hasTool(S,f))||m.proc.at[0]]);
    node.know = m.kind==="craft" ? (m.craft.know||[]) : [];
    for(const k in inp) node.kids.push(tree(S, k, inp[k]*times, depth-1, seen.concat(id)));
    return node;
  }
  /* 原料（天然資源）の合計。同じ中間材料を何度も数えないよう、木をそのままたどって足す */
  function rawTotals(S, id, need){
    const tot = {}; (function walk(n){ if(!n.kids.length){ if(n.via && n.via.kind==="gather") tot[n.id]=(tot[n.id]||0)+n.need; return; } n.kids.forEach(walk); })(tree(S,id,need||1,30));
    return tot;
  }

  /* ---------- データの検査（到達可能性・循環・使い道） ---------- */
  function validate(){
    const out = {unreachable:[], cycles:[], unused:[], badRef:[]};
    /* 参照 */
    SP.fields.forEach(f=>f.items.concat(f.show||[]).forEach(id=>{ if(!IT[id]) out.badRef.push("field:"+f.id+":"+id); }));
    SP.trials.forEach(t=>t.need.forEach(id=>{ if(!IT[id]) out.badRef.push("trial:"+t.id+":"+id); }));
    SP.modules.forEach(m=>{ if(!IT[m.item]) out.badRef.push("module:"+m.item); (m.after||[]).forEach(a=>{ if(!SP.modules.some(x=>x.slot===a)) out.badRef.push("after:"+a); }); });
    SP.ground.forEach(g=>{ if(!IT[g.item]) out.badRef.push("ground:"+g.item); });
    SP.tests.forEach(t=>{ (t.placed||[]).forEach(i=>{ if(!ground(i)) out.badRef.push("test:"+t.id+":placed:"+i); }); (t.slots||[]).forEach(s=>{ if(!SP.modules.some(m=>m.slot===s)) out.badRef.push("test:"+t.id+":slot:"+s); });
      (t.tests||[]).forEach(x=>{ if(!SP.tests.some(y=>y.id===x)) out.badRef.push("test:"+t.id+":test:"+x); }); (t.know||[]).forEach(k=>{ if(!SP.trials.some(y=>y.id===k)) out.badRef.push("test:"+t.id+":know:"+k); }); (t.have||[]).forEach(i=>{ if(!IT[i]) out.badRef.push("test:"+t.id+":have:"+i); }); });
    D.crafts.forEach(c=>(c.know||[]).forEach(k=>{ if(!SP.trials.some(t=>t.id===k)) out.badRef.push("craft:"+c.id+":know:"+k); }));
    /* 到達可能性（採取地点の道具・工作の道具と場所・実習の知識も条件に入れる） */
    const reach = new Set(), know = new Set(); let grew = true;
    D.regions.filter(r=>!r.future).forEach(r=>{ r.res.forEach(x=>{ if(!x.need) reach.add(x.id); }); (r.rare||[]).forEach(x=>reach.add(x.id)); });
    while(grew){ grew = false;
      D.regions.filter(r=>!r.future).forEach(r=>r.res.forEach(x=>{ if(!reach.has(x.id) && x.need && x.need.some(t=>reach.has(t))){ reach.add(x.id); grew=true; } }));
      SP.trials.forEach(t=>{ if(!know.has(t.id) && t.need.every(i=>reach.has(i)) && (!t.power || reach.has("battery") || reach.has("generator"))){ know.add(t.id); grew=true; } });
      D.crafts.forEach(c=>{ if(!reach.has(c.out) && Object.keys(c.inp).every(k=>reach.has(k)) && c.tools.every(t=>reach.has(t)) && (!c.at||reach.has(c.at)) && (c.know||[]).every(k=>know.has(k))){ reach.add(c.out); grew=true; } });
      D.procs.forEach(p=>{ if(Object.keys(p.inp).every(k=>reach.has(k)) && p.tools.every(t=>reach.has(t)) && p.at.some(f=>reach.has(f))) Object.keys(p.out).forEach(o=>{ if(!reach.has(o)){ reach.add(o); grew=true; } }); });
    }
    out.unreachable = Object.keys(IT).filter(id=>!reach.has(id)).concat(SP.trials.filter(t=>!know.has(t.id)).map(t=>"know:"+t.id));
    /* 循環：ある物を作るすべての作り方が、その物自身を（道具・場所・知識もふくめて）必要とする → 上の到達可能性で必ず見つかる。
       ここでは「主な作り方の木」に自分自身が出てくる物を列挙する（表示の木が無限にならないことの確認） */
    const S0 = E.newState();
    Object.keys(IT).forEach(id=>{ (function walk(n){ if(n.loop) out.cycles.push(id+"→"+n.id); n.kids.forEach(walk); })(tree(S0,id,1,40)); });
    /* 使い道：宇宙計画の物（電子部品・宇宙開発の分類と、宇宙計画の工作で作る物）は、何かの材料・道具・設備・実習・組立・設置のどれかに使う */
    const used = new Set();
    D.crafts.forEach(c=>{ Object.keys(c.inp).forEach(k=>used.add(k)); c.tools.forEach(k=>used.add(k)); if(c.at) used.add(c.at); });
    D.procs.forEach(p=>{ Object.keys(p.inp).forEach(k=>used.add(k)); p.tools.forEach(k=>used.add(k)); p.at.forEach(k=>used.add(k)); });
    SP.trials.forEach(t=>t.need.forEach(k=>used.add(k))); SP.modules.forEach(m=>used.add(m.item)); SP.ground.forEach(g=>used.add(g.item));
    SP.tests.forEach(t=>(t.have||[]).forEach(k=>used.add(k))); D.regions.forEach(r=>r.res.forEach(x=>(x.need||[]).forEach(k=>used.add(k))));
    used.add("powerdrill");
    const mine = new Set(); SP.fields.forEach(f=>f.items.forEach(i=>mine.add(i)));
    Object.values(IT).forEach(it=>{ if(it.tags.includes("電子部品")||it.tags.includes("宇宙開発")) mine.add(it.id); });
    out.unused = [...mine].filter(id=>!used.has(id));
    return out;
  }

  /* ---------- 分野の進み ---------- */
  function fieldInfo(S, f){
    const items = f.items.map(id=>({id, st:itemStatus(S,id)}));
    const done = items.filter(x=>x.st.s==="done").length;
    const open = (f.show||[]).some(id=>S.disc[id]) || items.some(x=>S.disc[x.id]) || !!(S.verify);
    let extra = null;
    if(f.id==="launch"){ const ts = SP.tests.map(t=>!!sp(S).tests[t.id]); extra = {done:ts.filter(Boolean).length + (sp(S).clear?1:0), total:ts.length+1}; }
    if(f.id==="rocket"){ const n = SP.modules.filter(m=>installed(S,m.slot)).length; extra = {done:n, total:SP.modules.length, label:"取りつけ"}; }
    if(f.id==="ground"){ const n = SP.ground.filter(g=>placed(S,g.item)).length; extra = {done:n, total:SP.ground.length, label:"設置"}; }
    return {id:f.id, name:f.name, kid:f.kid, items, done, total:items.length, open, extra};
  }
  function overview(S){ return SP.fields.map(f=>fieldInfo(S,f)); }

  /* ---------- 実習（知識） ---------- */
  const trialOf = id => SP.trials.find(t=>t.id===id);
  function trialInfo(S, id){
    const t = trialOf(id); if(!t) return {ok:false, lacks:[]};
    const lacks = t.need.filter(i=>!owns(S,i)).map(i=>({item:i, text:"「"+IT[i].name+"」を作る"}));
    if(t.power && !E.hasTool(S,"battery") && !E.hasTool(S,"generator")) lacks.push({item:"battery", text:"電源（「ボルタ電池」か「水力発電機」）を用意する"});
    return {ok:!lacks.length, lacks, done:E.knows(S,id) && !!sp(S).know[id], trial:t};
  }
  /* 実習の中身の模擬（純粋な関数。UI はこれを呼んで表示する） */
  const CONDUCT = {copper:true, iron:true, rubber:false, glass:false, cloth:false};
  const circuitLamp = (gap, sw) => !!(sw && CONDUCT[gap]);
  const GATE = {and:(a,b)=>a&b, or:(a,b)=>a|b, not:a=>a?0:1};
  const xor = (a,b) => GATE.or(GATE.and(a, GATE.not(b)), GATE.and(GATE.not(a), b));   // AND・OR・NOT だけで作る
  /* 1けたの全加算器 → けたをつなぐ。bits けたの a+b を、論理回路だけで計算する（答えは bits+1 けた） */
  function adder(a, b, bits){ bits = bits||2; let c = 0, out = 0;
    for(let i=0;i<bits;i++){ const x=(a>>i)&1, y=(b>>i)&1, s=xor(xor(x,y),c); c = GATE.or(GATE.and(x,y), GATE.and(c, xor(x,y))); out |= s<<i; }
    return out | (c<<bits); }
  /* 記憶回路：["in",値]（入力を変える）・["write"]（書きこむ）・["read"]（読み出す）を順に行う */
  function memRun(ops){ let inp=0, mem=0; const reads=[]; (ops||[]).slice(0,40).forEach(o=>{ if(o[0]==="in") inp = (o[1]|0)&15; else if(o[0]==="write") mem = inp; else if(o[0]==="read") reads.push({out:mem, inp}); }); return {mem, inp, reads}; }
  /* かんたんな命令を実行する機械（このゲーム専用。レジスタ1つ）。命令：set n／add n／sub n／out／jnz 行（0 でなければその行へ） */
  function vmRun(prog){ let acc=0, pc=0, steps=0; const out=[], trace=[];
    prog = (prog||[]).slice(0,8);
    while(pc>=0 && pc<prog.length && steps<200){ const [op, n] = prog[pc]; steps++; trace.push(pc);
      if(op==="set") acc = n|0; else if(op==="add") acc += n|0; else if(op==="sub") acc -= n|0; else if(op==="out") out.push(acc);
      if(op==="jnz" && acc!==0) pc = (n|0); else pc++;
      if(out.length>12) break; }
    return {out, acc, steps, halted: steps<200 && out.length<=12, trace}; }
  const ROLES = {calc:"演算", ctrl:"制御", mem:"記憶", io:"入出力"};
  const ROLE_Q = [{q:"足し算をする", a:"calc"}, {q:"命令を1つずつ順番に進める", a:"ctrl"}, {q:"値や命令を覚えておく", a:"mem"}, {q:"スイッチの値を読み、ランプに結果を出す", a:"io"}];
  /* 模擬の船内センサー（このゲーム専用の作り物の値） */
  const SENSORS = [{id:"press", name:"船内の気圧", v:101, lo:95, hi:105, unit:"kPa"}, {id:"temp", name:"船内の温度", v:22, lo:18, hi:26, unit:"℃"}, {id:"co2", name:"二酸化炭素", v:0.9, lo:0, hi:0.5, unit:"%"}, {id:"volt", name:"電源の電圧", v:27, lo:24, hi:30, unit:"V"}];
  const PROG_GOALS = [{id:"g1", text:"3 と 4 を足して、答えを表示する", want:[7]}, {id:"g2", text:"3、2、1 と順に表示する（くり返しを使う）", want:[3,2,1]}];
  const ADD_GOALS = [3, 5, 6];
  function trialCheck(id, a){
    a = a||{};
    if(id==="circuit"){ const tried = a.tried||[]; if(!tried.some(m=>CONDUCT[m]===false)) return {pass:false, msg:"電気を通さない物（絶縁体）もはさんで、ランプがつかないことを確かめよう。"};
      if(!circuitLamp(a.gap, a.sw)) return {pass:false, msg:"ランプがついていない。電気を通す物をはさんで、スイッチを入れよう。"}; return {pass:true}; }
    if(id==="switching"){ if(!(a.seen && a.seen.on && a.seen.off)) return {pass:false, msg:"合図を入れたときと切ったときの、両方のランプを見よう。"}; if(a.q!=="off") return {pass:false, msg:"合図の電気を切ると、電磁石がはなれて、ランプの回路も切れるよ。"}; return {pass:true}; }
    if(id==="gates"){ const r = a.rows||{}; if(!((r.and||[]).filter(Boolean).length>=4 && (r.or||[]).filter(Boolean).length>=4 && (r.not||[]).filter(Boolean).length>=2)) return {pass:false, msg:"3種類の回路で、入力の組み合わせを全部ためそう。"};
      if(a.q!=="or") return {pass:false, msg:"A=1、B=0 のとき：AND は両方 1 でないと 0。OR はどちらかが 1 なら 1。"}; return {pass:true}; }
    if(id==="adder"){ const an = a.sums||[]; for(let i=0;i<ADD_GOALS.length;i++){ const p = an[i]; if(!p || !(p[0]>=0&&p[0]<=3&&p[1]>=0&&p[1]<=3) || adder(p[0],p[1],2)!==ADD_GOALS[i]) return {pass:false, msg:"答えが "+ADD_GOALS[i]+"（2進数で "+ADD_GOALS[i].toString(2)+"）になる組み合わせを作ろう。"}; } return {pass:true}; }
    if(id==="memory"){ const r = memRun(a.ops); if(!r.reads.some(x=>x.out===11 && x.inp!==11)) return {pass:false, msg:"1011 を書きこんでから入力を別の値に変え、読み出しても 1011 のままなのを確かめよう。"}; return {pass:true}; }
    if(id==="roles"){ const m = a.map||{}; const bad = ROLE_Q.findIndex((q,i)=>m[i]!==q.a); if(bad>=0) return {pass:false, msg:"「"+ROLE_Q[bad].q+"」の役割をもう一度考えよう。"}; return {pass:true}; }
    if(id==="program"){ for(const g of PROG_GOALS){ const r = vmRun((a.progs||{})[g.id]); if(!r.halted || JSON.stringify(r.out)!==JSON.stringify(g.want)) return {pass:false, msg:"「"+g.text+"」の表示が "+JSON.stringify(g.want)+" にならない（今は "+JSON.stringify(r.out)+"）。"}; } return {pass:true}; }
    if(id==="sensors"){ const bad = SENSORS.find(s=>s.v<s.lo||s.v>s.hi); if(a.pick!==bad.id) return {pass:false, msg:"決まった範囲から外れている値はどれかな？"}; return {pass:true}; }
    return {pass:false, msg:"実習がない"};
  }
  function trialPass(S, id, answer){
    const inf = trialInfo(S,id); if(!inf.ok) return {ok:false, kind:"lack", lacks:inf.lacks, msg:"まだ試せない："+inf.lacks.map(l=>l.text).join("、")};
    const c = trialCheck(id, answer); if(!c.pass) return {ok:false, kind:"wrong", msg:c.msg};
    const first = !sp(S).know[id]; sp(S).know[id] = Date.now(); return {ok:true, first, learn:inf.trial.learn};
  }

  /* ---------- 機体の組立（発射台の上で、部分を順に取りつける） ---------- */
  function installInfo(S, slot){
    const m = SP.modules.find(x=>x.slot===slot); if(!m) return {ok:false, lacks:[{text:"部分がない"}]};
    if(installed(S,slot)) return {ok:false, done:true, lacks:[]};
    const lacks = [];
    if(!placed(S,"launchpad")) lacks.push({text:"「発射台」をマップに置く", go:"ground", item:"launchpad"});
    if(!placed(S,"assembly")) lacks.push({text:"「組立棟」をマップに置く", go:"ground", item:"assembly"});
    if(!E.hasTool(S,m.item)) lacks.push({text:"「"+IT[m.item].name+"」を作る", go:"item", item:m.item});
    (m.after||[]).filter(a=>!installed(S,a)).forEach(a=>lacks.push({text:"先に「"+SP.modules.find(x=>x.slot===a).name+"」を取りつける", go:"slot", slot:a}));
    return {ok:!lacks.length, lacks, module:m};
  }
  function install(S, slot, token){
    if(token!==undefined && token!==S.seq) return {ok:false, kind:"dup", msg:"二重に実行されたので取り消したよ"};
    const inf = installInfo(S,slot); if(!inf.ok) return Object.assign({msg: inf.done ? "もう取りつけてある" : "まだ取りつけられない："+inf.lacks.map(l=>l.text).join("、")}, inf);
    if(!E.vflag(S,"free")){ S.inv[inf.module.item] = E.cnt(S,inf.module.item)-1; if(S.inv[inf.module.item]<=0) delete S.inv[inf.module.item]; }
    sp(S).inst[slot] = Date.now(); S.seq++;
    S.hist.unshift({t:Date.now(), k:"install", slot, item:inf.module.item}); if(S.hist.length>200) S.hist.length=200;
    return {ok:true, module:inf.module, count:SP.modules.filter(x=>installed(S,x.slot)).length};
  }
  const rocketCount = S => SP.modules.filter(m=>installed(S,m.slot)).length;
  const rocketDone = S => rocketCount(S)===SP.modules.length;
  /* 描画に渡す機体の段階（見える部分だけ）：frame・engine・capsule・skin のビット */
  function rocketCode(S){ return (installed(S,"frame")?1:0) | (installed(S,"engine")?2:0) | (installed(S,"capsule")?4:0) | (installed(S,"skin")?8:0); }

  /* ---------- 発射場の配置の決まり ---------- */
  function siteIssues(S){
    const out = [], pad = placedAt(S,"launchpad"), tw = placedAt(S,"tower"), ct = placedAt(S,"control");
    if(pad && tw && dist(pad,tw) > SP.towerNear) out.push({text:"「支持塔」が発射台から遠い（"+SP.towerNear+"マス以内に置き直す。今は"+dist(pad,tw).toFixed(0)+"マス）", go:"ground", item:"tower"});
    if(pad && ct && dist(pad,ct) < SP.controlFar) out.push({text:"「地上管制端末」が発射台に近すぎる（安全のため"+SP.controlFar+"マス以上はなす。今は"+dist(pad,ct).toFixed(0)+"マス）", go:"ground", item:"control"});
    return out;
  }

  /* ---------- 試験 ---------- */
  const testOf = id => SP.tests.find(t=>t.id===id);
  function testInfo(S, id){
    const t = testOf(id); if(!t) return {ok:false, lacks:[]};
    const lacks = [];
    (t.placed||[]).forEach(i=>{ if(!E.hasTool(S,i)) lacks.push({text:"「"+IT[i].name+"」を作る", go:"item", item:i}); else if(!placed(S,i)) lacks.push({text:"「"+IT[i].name+"」をマップに置く", go:"ground", item:i}); });
    (t.slots||[]).forEach(s=>{ if(!installed(S,s)){ const m = SP.modules.find(x=>x.slot===s); lacks.push({text:"機体に「"+m.name+"」を取りつける", go:"slot", slot:s, item:m.item}); } });
    (t.have||[]).forEach(i=>{ if(!owns(S,i)) lacks.push({text:"「"+IT[i].name+"」を作る", go:"item", item:i}); });
    (t.know||[]).forEach(k=>{ if(!E.knows(S,k)) lacks.push({text:"実習「"+trialOf(k).name+"」を済ませる", go:"trial", trial:k}); });
    (t.tests||[]).forEach(x=>{ if(!sp(S).tests[x]) lacks.push({text:"試験「"+testOf(x).name+"」に合格する", go:"test", test:x}); });
    if(id==="unmanned" || id==="final") siteIssues(S).forEach(x=>lacks.push(x));
    return {ok:!lacks.length, lacks, passed:!!sp(S).tests[id], test:t};
  }
  /* 試験の課題（セーブごとに決まる。乱数の失敗はない） */
  const seedOf = S => Math.abs(Math.floor((S.created||1)/1000)) || 1;
  const PATTERNS = ["・－・", "－・・", "・・－", "－－・", "・－－"];
  function testTask(S, id){
    if(id==="power"){ const src = [];
      if(E.hasTool(S,"generator")) src.push({id:"generator", name:"水力発電機", kw:3});
      if(E.hasTool(S,"steamengine")) src.push({id:"steamengine", name:"蒸気機関の発電", kw:3});
      if(placed(S,"substation")) src.push({id:"substation", name:"電力供給設備の蓄電池", kw:2});
      if(installed(S,"power")) src.push({id:"power", name:"船の電源ユニット", kw:1});
      return {demand:6, limit:7, sources:src, max:src.reduce((a,x)=>a+x.kw,0)}; }
    if(id==="computer") return {sums:[[5,6],[9,3]], bits:4};
    if(id==="comm"){ const k = seedOf(S); return {channel:(k%5)+1, channels:5, pattern:PATTERNS[k%PATTERNS.length], patterns:PATTERNS}; }
    if(id==="suit") return {checks:[{id:"seal", name:"気密（空気がもれない）", part:"pressurelayer"}, {id:"air", name:"呼吸用の空気の供給", part:"lifesupport"}, {id:"co2", name:"二酸化炭素の除去", part:"lifesupport"}, {id:"temp", name:"温度の管理", part:"innerwear"}, {id:"radio", name:"通信", part:"radio"}, {id:"watch", name:"電源と状態の監視", part:"lifesupport"}]};
    if(id==="life") return {checks:[{id:"hatch", name:"カプセルの気密（ハッチを閉める）", part:"r_capsule"}, {id:"air", name:"船内の空気の供給", part:"cabinlife"}, {id:"co2", name:"二酸化炭素の除去", part:"cabinlife"}, {id:"temp", name:"船内の温度", part:"cabinlife"}, {id:"watch", name:"状態の監視", part:"cabinlife"}]};
    if(id==="unmanned") return {checks:[{id:"p1", name:"電源を船内に切り替える", part:"powerunit"}, {id:"p2", name:"船内コンピューターの自己診断", part:"shipcomputer"}, {id:"p3", name:"地上との通信を保つ", part:"shipradio"}, {id:"p4", name:"推進モジュールの模擬の始動と停止", part:"r_engine"}, {id:"p5", name:"上昇中の熱と振動の模擬（外装）", part:"r_skin"}, {id:"p6", name:"カプセル内の空気と温度の記録", part:"cabinlife"}]};
    if(id==="final") return {checks:SP.tests.filter(t=>t.id!=="final").map(t=>({id:t.id, name:t.name+"の記録"})).concat([{id:"site", name:"発射場の配置（支持塔は近く・管制は安全な距離）"}, {id:"suit2", name:"宇宙服の準備"}])};
    return null;
  }
  function testCheck(S, id, a){
    a = a||{}; const task = testTask(S,id);
    if(id==="power"){ const sum = task.sources.filter(s=>(a.on||[]).includes(s.id)).reduce((x,s)=>x+s.kw,0);
      if(task.max < task.demand) return {pass:false, msg:"電源を全部つないでも "+task.max+" しかなく、必要な "+task.demand+" に足りない。", lacks:[!E.hasTool(S,"steamengine")?{text:"「蒸気機関」を作ると +3", go:"item", item:"steamengine"}:null, !installed(S,"power")?{text:"機体に「電源」を取りつけると +1", go:"slot", slot:"power"}:null].filter(Boolean)};
      if(sum < task.demand) return {pass:false, msg:"電気が足りない（今 "+sum+"、必要 "+task.demand+"）。電源を足そう。"};
      if(sum > task.limit) return {pass:false, msg:"電気を流しすぎ（今 "+sum+"、配線の限界 "+task.limit+"）。電線が熱くなる。電源を1つ外そう。"};
      return {pass:true}; }
    if(id==="computer"){ const ok = task.sums.every((p,i)=>(a.ans||[])[i]===adder(p[0],p[1],task.bits)); return ok ? {pass:true} : {pass:false, msg:"答えが合っていない所がある。2進数の足し算を、1けたずつ確かめよう。"}; }
    if(id==="comm"){ if(a.ch!==task.channel) return {pass:false, msg:"周波数が合っていないので、信号が届かない。地上と同じ番号に合わせよう。"}; if(a.echo!==task.pattern) return {pass:false, msg:"返した合図が、地上から届いた合図とちがう。"}; return {pass:true}; }
    const miss = task.checks.filter(c=>!(a.checked||[]).includes(c.id)); if(miss.length) return {pass:false, msg:"まだ確かめていない項目がある："+miss.map(c=>c.name).join("、")};
    return {pass:true};
  }
  function runTest(S, id, answer, token){
    if(token!==undefined && token!==S.seq) return {ok:false, kind:"dup", msg:"二重に実行されたので取り消したよ"};
    const inf = testInfo(S,id); if(!inf.ok) return {ok:false, kind:"lack", lacks:inf.lacks, msg:"まだ試験できない。足りないもの："+inf.lacks.map(l=>l.text).join("／")};
    const c = testCheck(S,id,answer); if(!c.pass) return {ok:false, kind:"fail", msg:c.msg, lacks:c.lacks||[]};
    const first = !sp(S).tests[id]; sp(S).tests[id] = Date.now(); S.seq++;
    if(first){ S.hist.unshift({t:Date.now(), k:"test", test:id}); if(S.hist.length>200) S.hist.length=200; }
    return {ok:true, first};
  }

  /* ---------- 宇宙服・搭乗・打ち上げ ---------- */
  function wear(S, on){ if(on && !E.hasTool(S,"spacesuit")) return {ok:false, msg:"「宇宙服」を組み立てよう"}; sp(S).wear = !!on; if(!on) sp(S).board = false; return {ok:true, wear:sp(S).wear}; }
  const BOARD_REACH = 5.5;
  function boardInfo(S, pos){
    const lacks = [];
    if(!sp(S).tests.final) lacks.push({text:"「総合点検」に合格する", go:"test", test:"final"});
    if(!E.hasTool(S,"spacesuit")) lacks.push({text:"「宇宙服」を組み立てる", go:"item", item:"spacesuit"}); else if(!sp(S).wear) lacks.push({text:"宇宙服を着る", go:"wear"});
    const tw = placedAt(S,"tower");
    if(!tw) lacks.push({text:"「支持塔と搭乗通路」をマップに置く", go:"ground", item:"tower"});
    else if(pos && dist(pos,tw) > BOARD_REACH) lacks.push({text:"支持塔のそばへ行く（今は"+dist(pos,tw).toFixed(0)+"マスはなれている）", go:"walk", at:tw});
    siteIssues(S).forEach(x=>lacks.push(x));
    return {ok:!lacks.length, lacks};
  }
  function board(S, pos){ const b = boardInfo(S,pos); if(!b.ok) return Object.assign({msg:"まだ乗れない："+b.lacks.map(l=>l.text).join("／")}, b); sp(S).board = true; return {ok:true}; }
  function unboard(S){ sp(S).board = false; return {ok:true}; }
  /* 打ち上げの条件の一覧（足りないものを具体的に。go は移動先の手がかり） */
  function launchChecks(S){
    const T = sp(S).tests, miss = SP.modules.filter(m=>!installed(S,m.slot));
    const row = (id,name,ok,why,go)=>({id,name,ok:!!ok,why:ok?"":why,go:ok?null:go});
    const padOk = placed(S,"launchpad") && placed(S,"tower") && placed(S,"control") && placed(S,"substation") && !siteIssues(S).length;
    const padWhy = SP.ground.filter(g=>g.item!=="assembly" && !placed(S,g.item)).map(g=>"「"+g.name+"」がまだ置かれていない").concat(siteIssues(S).map(x=>x.text)).join("／");
    return [
      row("pad","発射台と地上設備が設置済み", padOk, padWhy, {go:"ground"}),
      row("rocket","ロケットの組立が完了", !miss.length, "まだ取りつけていない："+miss.map(m=>m.name).join("、"), {go:"rocket"}),
      row("power","電力の準備が完了", T.power, "試験「電源と配線の確認」がまだ", {go:"test", test:"power"}),
      row("computer","コンピューター試験に合格", T.computer, "試験「コンピューターの自己診断」がまだ", {go:"test", test:"computer"}),
      row("comm","通信試験に合格", T.comm, "試験「通信確認」がまだ", {go:"test", test:"comm"}),
      row("suit","宇宙服試験に合格", T.suit && E.hasTool(S,"spacesuit"), "試験「宇宙服の機能確認」がまだ", {go:"test", test:"suit"}),
      row("life","生命維持試験に合格", T.life, "試験「カプセルと生命維持の機能確認」がまだ", {go:"test", test:"life"}),
      row("unmanned","無人試験に合格", T.unmanned, "試験「無人の模擬飛行試験」がまだ", {go:"test", test:"unmanned"}),
      row("final","総合点検に合格", T.final, "「総合点検」がまだ", {go:"test", test:"final"}),
      row("board","主人公が搭乗済み", sp(S).board && sp(S).wear, sp(S).wear ? "支持塔のそばから搭乗する" : "宇宙服を着て、支持塔のそばから搭乗する", {go:"board"}),
    ];
  }
  const launchReady = S => launchChecks(S).every(c=>c.ok);
  /* 打ち上げの開始：条件をもう一度すべて確かめ、一度だけ始める（token）。演出の中断は launching の時刻で見分ける */
  function launchStart(S, token, now){
    if(token!==undefined && token!==S.seq) return {ok:false, kind:"dup", msg:"もう打ち上げは始まっている"};
    if(sp(S).launching) return {ok:false, kind:"dup", msg:"もう打ち上げは始まっている"};
    const cs = launchChecks(S), bad = cs.filter(c=>!c.ok);
    if(bad.length) return {ok:false, kind:"lack", checks:cs, msg:"まだ打ち上げられない："+bad.map(c=>c.name+"（"+c.why+"）").join("／")};
    sp(S).launching = now||Date.now(); S.seq++;
    return {ok:true, first:!sp(S).clear};
  }
  /* 宇宙へ到達：初回だけ記録を作る（2回目からは再演出として数えるだけ。資材・報酬は増えない） */
  function launchArrive(S, now){
    if(!sp(S).launching) return {ok:false, msg:"打ち上げが始まっていない"};
    now = now||Date.now(); const first = !sp(S).clear;
    if(first) sp(S).clear = {t:now, record:record(S, now)}; else sp(S).replays = (sp(S).replays||0)+1;
    sp(S).launching = 0; sp(S).board = false;
    if(first){ S.hist.unshift({t:now, k:"space"}); if(S.hist.length>200) S.hist.length=200; }
    return {ok:true, first, record:sp(S).clear.record, replays:sp(S).replays};
  }
  /* 演出の中断・「打ち上げ前の世界で続ける」：打ち上げ前の地上へ戻す（機体・設備・持ち物は打ち上げ前のまま。記録は消さない） */
  function launchAbort(S){ sp(S).launching = 0; sp(S).board = false; return {ok:true}; }
  /* エンディングの記録：最初の採集から宇宙到達までの歩み */
  function record(S, now){
    now = now||Date.now(); const d = S.disc||{};
    const steps = SP.milestones.filter(id=>d[id]).map(id=>({id, t:d[id].first||0})).sort((a,b)=>a.t-b.t);
    const first = Math.min(...Object.values(d).map(x=>x.first||now).concat([S.created||now]));
    return {start:first, end:now, ms:Math.max(0, now-first), found:Object.keys(d).length, total:Object.keys(IT).length,
      made:Object.values(d).reduce((a,x)=>a+(x.made||0),0), gathered:Object.values(S.gathered||{}).reduce((a,x)=>a+x,0),
      trials:SP.trials.filter(t=>sp(S).know[t.id]).length, tests:SP.tests.filter(t=>sp(S).tests[t.id]).length, steps};
  }

  return {owns, everMade, placed, placedAt, installed, slotOf, recipes, mainRecipe, itemStatus, tree, rawTotals, validate, fieldInfo, overview,
    trialOf, trialInfo, trialCheck, trialPass, circuitLamp, CONDUCT, GATE, xor, adder, memRun, vmRun, ROLES, ROLE_Q, SENSORS, PROG_GOALS, ADD_GOALS,
    installInfo, install, rocketCount, rocketDone, rocketCode, siteIssues, testOf, testInfo, testTask, testCheck, runTest, PATTERNS,
    wear, boardInfo, board, unboard, BOARD_REACH, launchChecks, launchReady, launchStart, launchArrive, launchAbort, record};
})(typeof DATA!=="undefined"?DATA:require("./data.js"), typeof ENGINE!=="undefined"?ENGINE:require("./engine.js"));
if (typeof module!=="undefined") module.exports = SPACE;
