/* ===================== 街づくり・現地建設の判定（UI から独立。データは construction-data.js） =====================
   予定地 → 資材の搬入 → 工程ごとの施工 → 完成。道（2 マスの格子）も同じ流れ。
   ・資材は「現地で、手の届く所から」だけ運ぶ（遠くの倉庫から吸い上げない）。搬入した分は持ち物から減り、予定地へ移る。
   ・後の工程の資材も先に運べる（建物全体で必要な数まで）。必要数を超えては受け取らない。
   ・取消・解体：搬入して使っていない資材は全部戻す。施工済みの工程は定義の返却表（salvage）の分だけ戻す。表がなければ戻らない（返却率を作らない）。
   ・二重の操作は S.seq のトークンで一度だけ。完成して初めて設備として使える（engine の setFacilityHook）。
   ・場所の判定は nature.js（checkPlacement）を使う。木や岩を消したり、地面をならしたりしない。 */
var CONS = (function(D, E){
  const C = D.construction, IT = D.items;
  const DEF = Object.fromEntries(C.defs.map(d=>[d.id, d]));
  const fail = (msg, extra)=> Object.assign({ok:false, msg}, extra||{});
  const isObj = x=> x && typeof x==="object" && !Array.isArray(x);
  const add = (a, b, k)=>{ for(const id in b) a[id] = (a[id]||0) + b[id]*(k||1); return a; };
  const tokenOk = (S, token)=> token===undefined || token===S.seq;

  /* ---------- 状態 ---------- */
  function state(S){
    if(!isObj(S.cons)) S.cons = E.newCons();
    const c = S.cons;
    if(!isObj(c.inst)) c.inst = {}; if(!isObj(c.roads)) c.roads = {};
    if(!(Number.isSafeInteger(c.seq) && c.seq>=0)) c.seq = 0;
    for(const [k, v] of Object.entries(c.inst)){
      if(!isObj(v) || !(isFinite(v.x) && isFinite(v.z))) { delete c.inst[k]; continue; }
      if(v.kind!=="road" && !DEF[v.def]) { delete c.inst[k]; continue; }
      if(!isObj(v.delivered)) v.delivered = {}; if(!isObj(v.consumed)) v.consumed = {};
      if(!["planned","supplying","constructing","completed"].includes(v.phase)) v.phase = "planned";
      if(!(Number.isSafeInteger(v.stage) && v.stage>=0)) v.stage = 0;
      if(v.work && !(isFinite(v.work.until) && Number.isSafeInteger(v.work.stage))) v.work = null;
    }
    if(c.legacy==="pending") migrateLegacy(S);
    return c;
  }
  const rule = S=> (S.cons && S.cons.rule) || "craft";
  const stagesOf = inst=> inst.kind==="road" ? roadStagesOf(inst) : DEF[inst.def].stages;
  /* 完成した建物で設備が使えるか（engine.hasTool から呼ばれる）。複数あっても「使える」だけ（生産量は増えない） */
  function built(S, fac){ const c = S && S.cons; if(!c || !c.inst) return false;
    for(const k in c.inst){ const v = c.inst[k]; if(v.phase==="completed" && v.kind!=="road" && DEF[v.def] && DEF[v.def].facility===fac) return true; } return false; }
  E.setFacilityHook(built);

  /* ---------- 以前の版の固定の建物を、完成した建物へ移す（素材は求めない。持ち物の設備は消して二重に持たない） ---------- */
  function migrateLegacy(S){
    const c = S.cons; c.legacy = "done"; const moved = [], kept = [];
    for(const L of C.legacy){
      if(!E.has(S, L.fac)) continue;
      const b = S.build && S.build[L.plan];
      if(b && b.removed){ kept.push(L.fac); continue; }        // 撤去して持ち物にしまっていた設備は、持ち物のまま（今までどおり使える）
      const at = b && isFinite(b.x) ? {x:b.x, z:b.z, rot:b.rot} : {x:L.at.x, z:L.at.z, rot: L.rot!=null ? L.rot : Math.atan2(D.base.x-L.at.x, D.base.z-L.at.z)};
      if(Object.values(c.inst).some(v=>Math.hypot(v.x-at.x, v.z-at.z) < 1)){ kept.push(L.fac); continue; }   // 同じ場所（高炉と簡易炉は以前は同じ建物）：あとのものは持ち物のまま
      const id = newId(c);
      const d = DEF[L.def];
      c.inst[id] = {id, def:L.def, x:at.x, z:at.z, rot:+(at.rot||0), phase:"completed", stage:d.stages.length, delivered:{}, consumed:add({}, totalMat(d)), legacy:true, created:Date.now(), done:Date.now()};
      S.inv[L.fac] = E.cnt(S, L.fac) - 1; if(S.inv[L.fac]<=0) delete S.inv[L.fac];
      moved.push(L.fac);
    }
    c.legacyReport = {moved, kept, at:Date.now()};
  }
  const newId = c=> "cs-" + (++c.seq);
  const totalMat = d=> d.stages.reduce((a, st)=>add(a, st.mat), {});

  /* ---------- 必要な資材 ---------- */
  /* 残りの工程（いまの工程から後）で必要な資材の合計 */
  function remainingNeed(inst){ const st = stagesOf(inst), need = {};
    for(let i=inst.stage; i<st.length; i++) add(need, st[i].mat);
    return need; }
  /* 予定地に置いてある（使っていない）資材 */
  const onSite = (inst, id)=> (inst.delivered[id]||0) - (inst.consumed[id]||0);
  function supplyTable(S, inst){
    const need = remainingNeed(inst), rows = [];
    for(const id of Object.keys(need)){ const have = onSite(inst, id); rows.push({id, need:need[id], delivered:have, missing:Math.max(0, need[id]-have), carried:E.cnt(S,id)}); }
    return rows;
  }
  /* いまの工程の資材がそろったか */
  function stageReady(S, inst){ const st = stagesOf(inst)[inst.stage]; if(!st) return {ok:false, why:["もう完成している"]};
    const why = [];
    for(const id in st.mat){ const lack = st.mat[id] - onSite(inst, id); if(lack>0) why.push((IT[id]?IT[id].name:id)+" があと "+lack+" 個（現地へ運ぶ）"); }
    for(const t of st.tools||[]) if(!E.hasTool(S, t)) why.push((IT[t]?IT[t].name:t)+"が必要"+(E.builtByConstruction(t)?"（完成した建物）":"（道具・設備）"));
    return {ok:!why.length, why, stage:st}; }

  /* ---------- 場所の判定 ---------- */
  function spec(def, x, z, rot, id){ return {id: id||"plan", type:def.model, footprint:def.footprint, entrance:def.entrance, operate:def.operate, rule:def.rule||null,
    x, z, rot, dense:true, maxRise: isFinite(def.maxRise) ? def.maxRise : undefined}; }
  const cellKey = (i,j)=> i+","+j;
  const cellOf = (x, z)=> ({i:Math.round(x/C.CELL), j:Math.round(z/C.CELL)});
  const cellCenter = (i, j)=> ({x:i*C.CELL, z:j*C.CELL});
  /* 予定地・建物の当たりの形（UI が WORLD.setStructures へ渡す）。完成と施工中は壁、予定地と広場は歩ける（ほかの建物は置けない） */
  function colliders(S){ const out = [];
    for(const v of Object.values(state(S).inst)){ if(v.kind==="road") continue; const d = DEF[v.def];
      out.push({id:v.id, type:d.model, x:v.x, z:v.z, rot:v.rot, footprint:d.footprint, walk: d.walkable || v.phase==="planned" || v.phase==="supplying"}); }
    return out; }
  /* 道のマス（完成・予定）と建物の形が重なるか */
  function roadCellsUnder(S, shape, world){ const c = state(S), hit = [];
    const keys = new Set(Object.keys(c.roads)); for(const v of Object.values(c.inst)) if(v.kind==="road") v.cells.forEach(q=>keys.add(cellKey(q.i,q.j)));
    for(const k of keys){ const [i,j] = k.split(",").map(Number), p = cellCenter(i,j); if(world.sdist(shape, p.x, p.z) < C.CELL*0.5) hit.push(k); }
    return hit; }
  /* 建物を置けるか（nature.js の判定＋道の上かどうか）。opts は checkPlacement と同じ（player・npcs・reserved） */
  function checkBuilding(S, world, defId, x, z, rot, opts, ignoreId){
    const d = DEF[defId]; if(!d) return {ok:false, reasons:["設計図がない"]};
    const p = spec(d, x, z, rot, ignoreId);
    const r = world.checkPlacement(S, p, opts);
    const reasons = r.reasons.slice();
    if(roadCellsUnder(S, r.shape, world).length) reasons.push("道の上には建てられない（道の横へ）");
    return {ok:!reasons.length, reasons, shape:r.shape}; }

  /* ---------- 予定地を決める・動かす・取消 ---------- */
  function plan(S, world, defId, x, z, rot, opts, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const d = DEF[defId]; if(!d) return fail("設計図がない");
    const chk = checkBuilding(S, world, defId, x, z, rot, opts); if(!chk.ok) return fail("ここには建てられない："+chk.reasons.join("／"), {reasons:chk.reasons});
    const c = state(S), id = newId(c);
    c.inst[id] = {id, def:defId, x:+x.toFixed(2), z:+z.toFixed(2), rot:+norm(rot).toFixed(4), phase:"planned", stage:0, delivered:{}, consumed:{}, work:null, created:Date.now()};
    S.seq++; return {ok:true, id, inst:c.inst[id]};
  }
  const norm = a=> ((a % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  const anyDelivered = inst=> Object.values(inst.delivered).some(n=>n>0);
  /* 動かす：何も運んでいない予定地は自由に。運んだあとは relocate（資材を返して予定地を決め直す明示の操作）。施工が始まった・完成した物は動かせない */
  function move(S, world, id, x, z, rot, opts, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const inst = state(S).inst[id]; if(!inst || inst.kind==="road") return fail("予定地がない");
    if(inst.phase==="completed") return fail("完成した建物は動かせない（解体して建て直す）");
    if(inst.stage>0 || inst.work) return fail("施工が始まった建物は動かせない（取消すると施工済みの分は返却表のとおり）");
    if(anyDelivered(inst)) return fail("資材を運んだ予定地は、資材を返してから決め直す（「資材を返して移す」）", {kind:"supplied"});
    const chk = checkBuilding(S, world, inst.def, x, z, rot, opts, id); if(!chk.ok) return fail("ここには建てられない："+chk.reasons.join("／"), {reasons:chk.reasons});
    inst.x = +x.toFixed(2); inst.z = +z.toFixed(2); inst.rot = +norm(rot).toFixed(4); S.seq++; return {ok:true};
  }
  function relocate(S, world, id, x, z, rot, opts, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const inst = state(S).inst[id]; if(!inst || inst.kind==="road") return fail("予定地がない");
    if(inst.stage>0 || inst.work || inst.phase==="completed") return fail("施工が始まった建物は動かせない");
    const chk = checkBuilding(S, world, inst.def, x, z, rot, opts, id); if(!chk.ok) return fail("ここには建てられない："+chk.reasons.join("／"), {reasons:chk.reasons});
    const back = giveBack(S, inst.delivered); inst.delivered = {}; inst.consumed = {}; inst.phase = "planned";
    inst.x = +x.toFixed(2); inst.z = +z.toFixed(2); inst.rot = +norm(rot).toFixed(4); S.seq++; return {ok:true, returned:back};
  }
  /* 以前の版で作って持ち物にある設備（移行で持ち物のまま残した物）を、選んだ場所の完成した建物にする。素材は求めない。持ち物からは消す（二重に持たない） */
  function placeLegacy(S, world, fac, x, z, rot, opts, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const d = facilityBuilding(fac); if(!d) return fail("建物にできない設備");
    if(!E.has(S, fac)) return fail("持ち物にない");
    const chk = checkBuilding(S, world, d.id, x, z, rot, opts); if(!chk.ok) return fail("ここには置けない："+chk.reasons.join("／"), {reasons:chk.reasons});
    const c = state(S), id = newId(c);
    c.inst[id] = {id, def:d.id, x:+x.toFixed(2), z:+z.toFixed(2), rot:+norm(rot).toFixed(4), phase:"completed", stage:d.stages.length, delivered:{}, consumed:add({}, totalMat(d)), legacy:true, created:Date.now(), done:Date.now()};
    S.inv[fac] = E.cnt(S,fac) - 1; if(S.inv[fac]<=0) delete S.inv[fac];
    S.seq++; return {ok:true, id};
  }
  /* 持ち物にある、建物にできる設備（以前の版の物） */
  const legacyItems = S=> C.defs.filter(d=>d.facility && !d.facility.startsWith("sp_") && E.has(S, d.facility)).map(d=>d.facility);
  /* 取消・解体で戻る物と失う物（確定の前に画面へ出す） */
  function removalPreview(S, id){
    const inst = state(S).inst[id]; if(!inst) return null;
    const st = stagesOf(inst), salvage = inst.kind==="road" ? null : DEF[inst.def].salvage, returns = {}, lost = {}, notes = [];
    for(const k of Object.keys(inst.delivered)){ const n = onSite(inst, k); if(n>0) returns[k] = (returns[k]||0) + n; }
    const doneStages = inst.phase==="completed" ? st.length : inst.stage;
    for(let i=0;i<doneStages;i++){ const s = st[i];
      if(salvage && salvage[s.id]){ add(returns, salvage[s.id]); const left = add({}, s.mat); for(const k in salvage[s.id]) left[k] -= salvage[s.id][k]; for(const k in left) if(left[k]>0) lost[k]=(lost[k]||0)+left[k]; }
      else add(lost, s.mat);
    }
    if(doneStages>0 && !salvage) notes.push("この建物は返却表が決まっていないので、施工済みの部分の資材は戻らない");
    if(inst.legacy) notes.push("以前の版で作った設備から移した建物。解体すると設備も使えなくなる（持ち物には戻らない）");
    const d = inst.kind!=="road" && DEF[inst.def]; if(d && d.facility && inst.phase==="completed") notes.push("「"+IT[d.facility].name+"」が使えなくなる（ほかに完成した同じ建物があれば使える）");
    return {returns, lost, notes, phase:inst.phase, doneStages};
  }
  function giveBack(S, items){ const back = {}; for(const k in items){ const n = Math.floor(items[k]); if(n>0){ S.inv[k] = E.cnt(S,k) + n; back[k] = n; } } return back; }
  /* 取消（未完成）・解体（完成）。返す物は removalPreview と同じ。持ち物に上限はないので、戻した物は消えない */
  function remove(S, id, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const c = state(S), inst = c.inst[id]; if(!inst) return fail("予定地がない");
    const pv = removalPreview(S, id);
    if(inst.kind==="road" && inst.phase==="completed") return fail("完成した道は「道を撤去」で消す");
    const back = giveBack(S, pv.returns);
    delete c.inst[id]; S.seq++;
    S.hist.unshift({t:Date.now(), k:"build", act: inst.phase==="completed" ? "demolish" : "cancel", def:inst.def||"road", id, back}); if(S.hist.length>200) S.hist.length=200;
    return {ok:true, returned:back, lost:pv.lost};
  }

  /* ---------- 資材の搬入（現地で、手の届く所から） ---------- */
  function distTo(world, inst, pos){
    if(inst.kind==="road") return Math.min(...inst.cells.map(q=>{ const p = cellCenter(q.i,q.j); return Math.hypot(p.x-pos.x, p.z-pos.z) - C.CELL*0.5; }));
    return world.sdist(shapeOfInst(inst), pos.x, pos.z); }
  function shapeOfInst(inst){ const f = DEF[inst.def].footprint; return {x:inst.x, z:inst.z, rot:inst.rot, shape:f.shape==="rect"?"rect":"circle", w:f.w, d:f.d, r: f.shape==="rect" ? Math.hypot(f.w,f.d)/2 : f.r}; }
  function near(world, inst, pos){ return !!pos && distTo(world, inst, pos) <= C.REACH; }
  function deliver(S, world, id, item, n, pos, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const inst = state(S).inst[id]; if(!inst) return fail("予定地がない");
    if(inst.phase==="completed") return fail("もう完成している");
    if(!near(world, inst, pos)) return fail("予定地のそばまで行って運ぶ（手の届く所から "+C.REACH+" マス以内）", {kind:"far"});
    const need = remainingNeed(inst)[item] || 0, have = onSite(inst, item), space = need - have;
    if(space<=0) return fail((IT[item]?IT[item].name:item)+"はもう足りている");
    const free = E.vflag(S, "free");
    const k = Math.min(Math.floor(n)||0, space, free ? space : E.cnt(S, item));
    if(k<=0) return fail((IT[item]?IT[item].name:item)+"を持っていない");
    if(!free){ S.inv[item] = E.cnt(S,item) - k; if(S.inv[item]<=0) delete S.inv[item]; }
    inst.delivered[item] = (inst.delivered[item]||0) + k;
    if(inst.phase==="planned") inst.phase = "supplying";
    S.seq++; return {ok:true, n:k};
  }
  /* 持っている分をまとめて運ぶ（必要数まで） */
  function deliverAll(S, world, id, pos, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const inst = state(S).inst[id]; if(!inst) return fail("予定地がない");
    if(!near(world, inst, pos)) return fail("予定地のそばまで行って運ぶ（手の届く所から "+C.REACH+" マス以内）", {kind:"far"});
    const got = {}; let any = false;
    for(const row of supplyTable(S, inst)){ if(row.missing<=0) continue; const r = deliver(S, world, id, row.id, row.missing, pos, S.seq); if(r.ok){ got[row.id] = r.n; any = true; } }
    return any ? {ok:true, got} : fail("運べる資材がない（足りない物を集めよう）");
  }

  /* ---------- 施工（ゲームの中の時間。そばで作業を始め、終わったら確定） ---------- */
  function startWork(S, world, id, pos, now, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const inst = state(S).inst[id]; if(!inst) return fail("予定地がない");
    if(inst.phase==="completed") return fail("もう完成している");
    if(inst.work) return fail("いま施工中");
    if(!near(world, inst, pos)) return fail("現場のそばで施工する", {kind:"far"});
    const r = stageReady(S, inst); if(!r.ok) return fail(r.why.join("／"), {why:r.why});
    now = now||Date.now();
    const sec = r.stage.work * (inst.kind==="road" ? inst.cells.filter(q=>q.need.includes(r.stage.id)).length : 1);
    inst.work = {stage:inst.stage, started:now, until: now + (E.vflag(S,"instant") ? 0 : Math.round(sec*1000))}; inst.phase = "constructing";
    S.seq++; return {ok:true, until:inst.work.until, seconds:sec};
  }
  /* 施工を終える：時間が過ぎていて、現場のそばにいるとき。その工程の資材を使い、次の工程へ。最後なら完成 */
  function finishWork(S, world, id, pos, now, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const inst = state(S).inst[id]; if(!inst || !inst.work) return fail("施工していない");
    now = now||Date.now();
    if(now < inst.work.until) return fail("まだ作業中", {kind:"wait", left:inst.work.until-now});
    if(!near(world, inst, pos)) return fail("現場に戻って仕上げる", {kind:"far"});
    const r = stageReady(S, inst); if(!r.ok){ inst.work = null; return fail(r.why.join("／")); }
    add(inst.consumed, r.stage.mat); inst.stage++; inst.work = null;
    let done = false;
    if(inst.stage >= stagesOf(inst).length){ done = true; inst.phase = "completed"; inst.done = now;
      if(inst.kind==="road"){ const c = state(S); inst.cells.forEach(q=>{ const k = cellKey(q.i,q.j), old = c.roads[k]; if(!old || C.roads[old].rank < C.roads[inst.road].rank) c.roads[k] = inst.road; }); delete c.inst[id]; }
      else { const d = DEF[inst.def]; if(d.facility) discover(S, d.facility); }
      S.hist.unshift({t:now, k:"build", act:"complete", def:inst.def||("road-"+inst.road), id}); if(S.hist.length>200) S.hist.length=200;
    }
    S.seq++; return {ok:true, done, stage:inst.stage};
  }
  /* 完成した設備は図鑑に「発見」として載る（持ち物には入らない） */
  function discover(S, id){ if(!S.disc[id]) S.disc[id] = {first:Date.now(), made:1, total:1, routes:["build"], best:0}; }

  /* ---------- 道（2 マスの格子） ---------- */
  function roadStagesOf(inst){ const order = C.roads[inst.road].stages;
    return order.filter(sid=>inst.cells.some(q=>q.need.includes(sid))).map(sid=>{ const s = C.roadStages[sid], n = inst.cells.filter(q=>q.need.includes(sid)).length;
      return {id:sid, name:s.name+"（"+n+"マス）", mat:add({}, s.mat, n), work:s.work, tools:s.tools||[]}; }); }
  /* 始点から終点までのマス（直線。斜めは段にして必ず辺でつながる） */
  function lineCells(a, b){ const A = cellOf(a.x,a.z), B = cellOf(b.x,b.z), out = [];
    let i = A.i, j = A.j; out.push({i,j});
    while(i!==B.i || j!==B.j){ const di = B.i-i, dj = B.j-j;
      if(Math.abs(di) >= Math.abs(dj)) i += Math.sign(di); else j += Math.sign(dj);
      out.push({i,j}); if(out.length>400) break; }
    return out; }
  /* 1 マスに道を敷けるか（水・急な斜面・崖・溶岩・木と岩・建物・予定地） */
  function roadCellCheck(S, world, i, j, now){
    const p = cellCenter(i,j), h = C.CELL/2, pts = [p, {x:p.x-h*0.9,z:p.z-h*0.9}, {x:p.x+h*0.9,z:p.z-h*0.9}, {x:p.x-h*0.9,z:p.z+h*0.9}, {x:p.x+h*0.9,z:p.z+h*0.9}];
    const why = [];
    if(pts.some(q=>!world.inWorld(q.x,q.z,1))) why.push("世界の端");
    else if(pts.some(q=>world.terrainBlocked(q.x,q.z))) why.push("崖や深い水");
    else if(pts.some(q=>world.waterKind(q.x,q.z) || world.riverDist(q.x,q.z) < 4.6)) why.push("川・湖・海の上は通せない（橋はまだない）");
    else if(pts.some(q=>world.slope(q.x,q.z) > C.ROAD_SLOPE)) why.push("坂が急すぎる");
    const hs = pts.map(q=>world.height(q.x,q.z)); if(Math.max(...hs)-Math.min(...hs) > 0.9) why.push("段差が大きい");
    if(world.structures().some(o=>world.sdist(o, p.x, p.z) < h*0.7)) why.push("建物や予定地と重なる");
    if(world.around(p.x, p.z, h+1.5).some(o=>o.block && world.present(S,o,now) && Math.abs(o.x-p.x) < h+o.r && Math.abs(o.z-p.z) < h+o.r)) why.push("木や岩がある（先に伐る・割る）");
    return why; }
  /* 道の予定（プレビューと確定で同じ）：敷けるマス・足りない工程・費用・区間への分け方 */
  function roadPlan(S, world, kind, a, b, now){
    const R = C.roads[kind]; if(!R) return {ok:false, reasons:["道の種類がない"]};
    const c = state(S), pending = new Set(); Object.values(c.inst).forEach(v=>{ if(v.kind==="road") v.cells.forEach(q=>pending.add(cellKey(q.i,q.j))); });
    const cells = lineCells(a, b), out = [], bad = [], skip = [];
    for(const q of cells){ const k = cellKey(q.i,q.j);
      if(pending.has(k)){ skip.push({...q, why:"同じマスに道の予定がある"}); continue; }
      const old = c.roads[k];
      if(old && C.roads[old].rank >= R.rank){ skip.push({...q, why:"もう"+C.roads[old].name+"がある"}); continue; }
      const why = roadCellCheck(S, world, q.i, q.j, now);
      if(why.length){ bad.push({...q, why}); continue; }
      const done = old ? C.roads[old].stages : [];
      out.push({i:q.i, j:q.j, need: R.stages.filter(s=>!done.includes(s)), upgrade: old||null}); }
    const sections = []; for(let k=0;k<out.length;k+=C.SECTION_MAX) sections.push(out.slice(k, k+C.SECTION_MAX));
    const cost = {}; out.forEach(q=>q.need.forEach(s=>add(cost, C.roadStages[s].mat)));
    const reasons = bad.length ? [...new Set(bad.flatMap(q=>q.why))] : [];
    return {ok: out.length>0 && !bad.length, cells:out, bad, skip, sections, cost, reasons: out.length ? reasons : (reasons.length ? reasons : ["新しく敷くマスがない"])}; }
  /* 道の予定地を作る（長い道は SECTION_MAX マスずつの区間に分けて、それぞれ別の予定地） */
  function planRoad(S, world, kind, a, b, now, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const r = roadPlan(S, world, kind, a, b, now); if(!r.ok) return fail("ここには道を敷けない："+r.reasons.join("／"), {reasons:r.reasons, bad:r.bad});
    const c = state(S), ids = [];
    for(const sec of r.sections){ const id = newId(c), mid = sec[Math.floor(sec.length/2)], p = cellCenter(mid.i, mid.j);
      c.inst[id] = {id, kind:"road", road:kind, cells:sec, x:p.x, z:p.z, rot:0, phase:"planned", stage:0, delivered:{}, consumed:{}, work:null, created:Date.now()}; ids.push(id); }
    S.seq++; return {ok:true, ids}; }
  /* 完成した道のマスを撤去（返却表がないので資材は戻らない。歩ける地面に戻る） */
  function removeRoadCells(S, keys, token){
    if(!tokenOk(S, token)) return fail("二重の操作は取り消した", {kind:"dup"});
    const c = state(S); let n = 0; for(const k of keys) if(c.roads[k]){ delete c.roads[k]; n++; }
    if(!n) return fail("撤去する道がない"); S.seq++; return {ok:true, n}; }
  /* 道の形（見た目用）：つながっている向き（N/E/S/W）で、直線・曲がり・T 字・十字・行き止まりがわかる */
  function roadShape(S, k){ const c = state(S), [i,j] = k.split(",").map(Number);
    const n = ["0,-1","1,0","0,1","-1,0"].map(d=>{ const [di,dj] = d.split(",").map(Number); return !!c.roads[cellKey(i+di,j+dj)]; });
    const cnt = n.filter(Boolean).length;
    return {links:n, kind: cnt===4 ? "cross" : cnt===3 ? "tee" : cnt===2 ? ((n[0]&&n[2])||(n[1]&&n[3]) ? "straight" : "bend") : cnt===1 ? "end" : "single"}; }
  /* 建物の入口・作業点に道がつながっているか（入口の前 1.6 マス以内に道のマス） */
  function connected(S, id){ const c = state(S), v = c.inst[id]; if(!v || v.kind==="road") return false; const d = DEF[v.def], lp = d.entrance || d.operate; if(!lp) return null;
    const co = Math.cos(v.rot), si = Math.sin(v.rot), L = Math.hypot(lp[0],lp[1])||1, ex = lp[0]+lp[0]/L*0.8, ez = lp[1]+lp[1]/L*0.8;
    const w = {x: v.x + co*ex + si*ez, z: v.z - si*ex + co*ez};
    return Object.keys(c.roads).some(k=>{ const [i,j] = k.split(",").map(Number), p = cellCenter(i,j); return Math.abs(p.x-w.x) <= C.CELL*0.5+0.8 && Math.abs(p.z-w.z) <= C.CELL*0.5+0.8; }); }

  /* ---------- 街の発展（実際に建てた物を近さでまとめて数える。人口のシミュレーションはしない） ---------- */
  function towns(S){
    const c = state(S), list = Object.values(c.inst).filter(v=>v.kind!=="road" && v.phase==="completed");
    const parent = list.map((_,i)=>i), find = i=> parent[i]===i ? i : (parent[i] = find(parent[i]));
    for(let a=0;a<list.length;a++) for(let b=a+1;b<list.length;b++) if(Math.hypot(list[a].x-list[b].x, list[a].z-list[b].z) <= C.CLUSTER) parent[find(a)] = find(b);
    const groups = {}; list.forEach((v,i)=>{ (groups[find(i)] = groups[find(i)] || []).push(v); });
    const roadPts = Object.keys(c.roads).map(k=>{ const [i,j] = k.split(",").map(Number); return cellCenter(i,j); });
    return Object.values(groups).map(g=>{ const cnt = {housing:0, workshop:0, factory:0, storage:0, public:0, deco:0};
      g.forEach(v=>{ cnt[DEF[v.def].cat] = (cnt[DEF[v.def].cat]||0) + 1; });
      cnt.workshop += cnt.factory;    // 工場も工房の数に入れる（都市は工場も別に数える）
      const cx = g.reduce((a,v)=>a+v.x,0)/g.length, cz = g.reduce((a,v)=>a+v.z,0)/g.length;
      cnt.road = roadPts.filter(p=>g.some(v=>Math.hypot(p.x-v.x, p.z-v.z) <= C.CLUSTER*0.6)).length;
      let level = C.townLevels[0]; for(const L of C.townLevels) if(Object.entries(L.need).every(([k,n])=>(cnt[k]||0) >= n)) level = L;
      const next = C.townLevels[C.townLevels.indexOf(level)+1];
      return {x:cx, z:cz, count:cnt, members:g.map(v=>v.id), level, next, lack: next ? Object.entries(next.need).filter(([k,n])=>(cnt[k]||0) < n).map(([k,n])=>({k, need:n, have:cnt[k]||0})) : []}; })
      .sort((a,b)=>b.members.length-a.members.length); }

  /* ---------- 一覧 ---------- */
  const list = S=> Object.values(state(S).inst);
  function facilityBuilding(fac){ return C.defs.find(d=>d.facility===fac) || null; }
  /* 設計図を知っているか（工作の設計図と同じ考え方：材料のどれかを見つけた、設備の建物はその設備を見つけた） */
  function known(S, defId){ const d = DEF[defId]; if(!d) return false;
    return Object.keys(totalMat(d)).some(k=>S.disc[k]) || (d.facility && S.disc[d.facility]) || d.stages.every(s=>!Object.keys(s.mat).length); }

  return {DEF, state, rule, built, list, plan, move, relocate, remove, removalPreview, deliver, deliverAll, supplyTable, remainingNeed, stageReady, startWork, finishWork,
    checkBuilding, colliders, roadPlan, planRoad, removeRoadCells, roadShape, roadStagesOf, cellKey, cellOf, cellCenter, lineCells, connected, towns, totalMat, stagesOf,
    near, distTo, shapeOfInst, placeLegacy, legacyItems, facilityBuilding, known, migrateLegacy, spec};
})(typeof DATA!=="undefined"?DATA:(require("./construction-data.js"), require("./data.js")), typeof ENGINE!=="undefined"?ENGINE:require("./engine.js"));
if(typeof module!=="undefined") module.exports = CONS;
