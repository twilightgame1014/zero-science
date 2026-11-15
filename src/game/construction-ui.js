/* ===================== 街づくり・現地建設の画面（ui.js のクロージャの中へビルドで差しこむ。判定は construction.js＝CONS） =====================
   建築の画面（設計図・道・現場・建物・街）、置き場所を決めるモード（建物は既存の W3.place を使い、道は始点と終点）、
   現場の画面（搬入・施工・取消・解体・移す）、近くの現場への近道、3D（完成・工程・道＝Muse正式素材）。 */
var CX = D.construction;
U.cons = {cat:"workshop", open:null};
const CAT_NAME = {workshop:"工房", storage:"倉庫", housing:"住宅", public:"公共", factory:"工場・大型", deco:"飾り", road:"道"};
const PHASE_NAME = {planned:"予定地", supplying:"資材の搬入中", constructing:"施工中", completed:"完成"};
const matList = (m, mul)=> Object.entries(m).map(([k,q])=>`${ic(k)}${nm(k)}×${q*(mul||1)}`).join("・") || "材料なし（手間だけ）";
function consAdopt(s){ if(s && s.cons && !s.cons.rule) s.cons.rule = "build"; if(s) CONS.state(s); return s; }

/* ---------- 置き場所の保護（集落の家・小物・人の通り道・拠点の真ん中だけ。広い円まるごとは禁止にしない） ---------- */
function consReserved(){
  const out = [{x:D.base.x, z:D.base.z, r:1.3, why:"拠点の真ん中（はじめの場所）はあけておく"}];
  const v = D.village; if(v){ const c = v.c;
    v.huts.forEach(h=>out.push({x:c.x+h.x, z:c.z+h.z, r:2.6, why:"集落の家と入口の前には建てられない"}));
    v.props.forEach(p=>out.push({x:c.x+p.x, z:c.z+p.z, r:p.type==="well"?1.6:0.8, why:"集落の井戸・小物の場所には建てられない"}));
    (v.npcs||[]).forEach(n=>(n.wander||[]).forEach(w=>out.push({x:c.x+w.x, z:c.z+w.z, r:0.9, why:"集落の人の通り道には建てられない"}))); }
  return out.concat(W3.reserved||[]); }
const consOpts = ()=> ({player:W3.pos, npcs:(W3.npcList||[]), reserved:consReserved()});

/* ---------- 建築の画面 ---------- */
function consView(){
  const c = CONS.state(S), cat = U.cons.cat, sites = CONS.list(S).filter(v=>v.phase!=="completed"), done = CONS.list(S).filter(v=>v.phase==="completed" && v.kind!=="road");
  const towns = CONS.towns(S), legacy = CONS.legacyItems(S);
  const defCard = d=>{ const kn = CONS.known(S, d.id), tot = CONS.totalMat(d), tools = [...new Set(d.stages.flatMap(s=>s.tools))];
    const have = Object.entries(tot).map(([k,q])=>`<span class="${E.cnt(S,k)>=q?"ok":"ng"}">${S.disc[k]?ic(k)+nm(k):"❔？？？"} ${E.cnt(S,k)}/${q}</span>`).join("");
    const tl = tools.map(t=>`<span class="${E.hasTool(S,t)?"ok":"ng"}">${E.builtByConstruction(t)?"建物":"道具"}：${S.disc[t]?nm(t):"？？？"}</span>`).join("");
    const n = done.filter(v=>v.def===d.id).length;
    return `<div class="card cscard ${kn?"":"locked"}"><h3><span class="i">${d.facility?ic(d.facility):"🏠"}</span>${kn?d.name:"？？？"}${n?` <span class="tag">完成 ${n}</span>`:""}</h3>
      <div class="kid">${kn?d.kid:"材料のどれかを見つけると、設計図がわかる。"}</div>
      ${kn?`<div class="need">${have}${tl}</div><div class="how">工程 ${d.stages.length}：${d.stages.map(s=>s.name).join(" → ")}${d.facility?`。完成すると「${nm(d.facility)}」が使える`:""}</div>
      <div class="row mt"><button class="btn small act" data-act="cs-place" data-id="${d.id}">場所を決める</button><span class="desc" style="margin:0">資材は、予定地を決めてから現地へ運ぶ</span></div>`:""}</div>`; };
  const cats = [...new Set(CX.defs.map(d=>d.cat))].concat(["road"]);
  const body = cat==="road" ? Object.values(CX.roads).map(r=>{ const per = r.stages.reduce((a,s)=>{ for(const k in CX.roadStages[s].mat) a[k]=(a[k]||0)+CX.roadStages[s].mat[k]; return a; }, {});
      return `<div class="card cscard"><h3><span class="i" style="color:${r.color}">■</span>${r.name}</h3><div class="kid">${r.kid}</div><div class="how">1マス（2×2）あたり：${matList(per)}。工程：${r.stages.map(s=>CX.roadStages[s].name).join(" → ")}</div>
        <div class="row mt"><button class="btn small act" data-act="cs-road" data-id="${r.id}">道を敷く</button><span class="desc" style="margin:0">施工時に草を自動で刈り、通常の採取量を受け取る。始点と終点を選ぶ。長い道は${CX.SECTION_MAX}マスずつの区間に分ける</span></div></div>`; }).join("")
    : CX.defs.filter(d=>d.cat===cat).map(defCard).join("");
  return `<p class="desc" style="margin-top:0">建てる場所と向きはあなたが決める。予定地を決めたら資材を現地へ運び、工程ごとに施工する。完成して初めて設備として使える。</p>
  <div class="sp-tabs cstabs">${cats.map(k=>`<button class="btn small ${k===cat?"":"sub"}" data-act="cs-cat" data-id="${k}" aria-pressed="${k===cat}">${CAT_NAME[k]||k}</button>`).join("")}</div>
  <div class="grid2">${body}</div>
  ${sites.length?`<div class="sec">建設中の現場 <small>${sites.length}か所</small></div><div class="blist">${sites.map(v=>{ const name = v.kind==="road" ? CX.roads[v.road].name+"（"+v.cells.length+"マス）" : CONS.DEF[v.def].name, st = CONS.stagesOf(v);
      return `<div class="bit"><span class="i">🏗️</span><span class="n">${name}<small>${PHASE_NAME[v.phase]}・工程 ${v.stage}/${st.length}${v.work?"（作業中）":""}</small></span><button class="btn small" data-act="cs-open" data-id="${v.id}">開く</button><button class="btn small sub" data-act="cs-go" data-id="${v.id}">現場へ行く</button></div>`; }).join("")}</div>`:""}
  ${done.length?`<div class="sec">建物 <small>${done.length}</small></div><div class="blist">${done.map(v=>{ const d = CONS.DEF[v.def], con = CONS.connected(S, v.id);
      return `<div class="bit"><span class="i">${d.facility?ic(d.facility):"🏠"}</span><span class="n">${d.name}<small>${d.facility?"設備："+nm(d.facility):"設備の働きなし"}${con===true?"・道につながっている":con===false?"・道はまだ":""}${v.legacy?"・以前の版から移した":""}</small></span><button class="btn small sub" data-act="cs-open" data-id="${v.id}">開く</button></div>`; }).join("")}</div>`:""}
  ${legacy.length?`<div class="sec">持ち物にある設備（以前の版） <small>置くと、資材なしで完成した建物になる（持ち物からは消える）</small></div><div class="blist">${legacy.map(f=>`<div class="bit"><span class="i">${ic(f)}</span><span class="n">${nm(f)}</span><button class="btn small" data-act="cs-legacy" data-id="${f}">置く</button></div>`).join("")}</div>`:""}
  <div class="sec">街 <small>実際に建てた住宅・工房・公共の建物と道から決まる（近い建物どうしで1つの街）</small></div>
  ${towns.length?towns.map((t,i)=>`<div class="card"><h3>${t.level.name} <small class="desc" style="margin:0">（${Math.round(t.x)}, ${Math.round(t.z)}）</small></h3>
      <div class="need"><span>住宅 ${t.count.housing}</span><span>工房 ${t.count.workshop}</span><span>工場 ${t.count.factory}</span><span>公共 ${t.count.public}</span><span>倉庫 ${t.count.storage}</span><span>道 ${t.count.road}マス</span></div>
      ${t.next?`<p class="desc">次の「${t.next.name}」まで：${t.lack.map(l=>({housing:"住宅",workshop:"工房",factory:"工場",public:"公共",road:"道"}[l.k]||l.k)+" "+l.have+"/"+l.need).join("・")}</p>`:""}</div>`).join(""):`<p class="desc">まだ完成した建物がない。</p>`}`;
}

/* ---------- 置き場所を決める（建物：既存の W3.place。道：始点→終点） ---------- */
function consStartPlace(o){
  if(!W3.pos || W3.state!=="ready"){ banner("3Dの画面で場所を決める"); return; }
  if(W3.place) endPlace();
  const B = camBasis(), d = o.def ? CONS.DEF[o.def] : o.legacy ? CONS.facilityBuilding(o.legacy) : null;
  if(o.road){ W3.place = {road:{kind:o.road, a:null}, cons:{road:o.road}, grid:true, x:placeSnapCell(W3.pos.x + B.f.x*4), z:placeSnapCell(W3.pos.z + B.f.z*4), rot:0, token:S.seq, ghostSig:""}; }
  else { const glb = (ASSETS.buildings && ASSETS.buildings[d.model]) || (ASSETS.town && ASSETS.town[d.model]); if(glb && window.HD2D && HD2D.ensureBuildingModel) HD2D.ensureBuildingModel(W3.gfx, d.model, glb);
    const cur = o.move ? CONS.state(S).inst[o.move] : null;
    W3.place = {id:"cs-ghost", type:d.model, cons:{def:d.id, move:o.move||null, relocate:!!o.relocate, legacy:o.legacy||null, label:d.name}, spec:CONS.spec(d, 0, 0, 0), grid: W3.lastGrid!==false, x:0, z:0, rot:0, token:S.seq, ghostSig:""};
    if(cur){ W3.place.x=cur.x; W3.place.z=cur.z; W3.place.rot=cur.rot; }
    else { const r = d.footprint.shape==="rect" ? Math.max(d.footprint.w, d.footprint.d)/2 : d.footprint.r; W3.place.x = placeSnap(W3.pos.x + B.f.x*(r+3)); W3.place.z = placeSnap(W3.pos.z + B.f.z*(r+3)); W3.place.rot = Math.round(Math.atan2(-B.f.x, -B.f.z)/(Math.PI/12))*(Math.PI/12); } }
  $("#app").classList.add("placing"); setTab("explore"); placeUpdate(true);
  const bb=$("#buildbar"); bb.hidden=false; bb.classList.toggle("road", !!o.road); const g=$("#bbGrid"); if(g) g.checked=W3.place.grid;
  banner(o.road ? "🛤️ 道の始点を地面のタップ（クリック）で選び「始点にする」→ 終点を選んで「ここまで敷く」" : "🏗️ 予定地を決める：地面をタップ（クリック）して動かし、回転して「予定地にする」");
}
const placeSnapCell = v=> Math.round(v/CX.CELL)*CX.CELL;
/* placeUpdate から呼ぶ：置けるかと、表示の文 */
function consCheck(P){
  if(P.road){ const a = P.road.a || {x:P.x, z:P.z}, b = {x:P.x, z:P.z}; const r = CONS.roadPlan(S, WORLD, P.road.kind, a, b, Date.now()); P.roadPlan = r;
    return {ok: P.road.a ? r.ok : !r.bad.length || r.cells.length>0, reasons:r.reasons, shape:null}; }
  const C2 = P.cons, opts = consOpts();
  return CONS.checkBuilding(S, WORLD, C2.def, P.x, P.z, P.rot, opts, C2.move ? C2.move : undefined); }
function consTitle(P){
  if(P.road){ const r = P.roadPlan || {cells:[], cost:{}, sections:[]}, R = CX.roads[P.road.kind];
    return P.road.a ? `🛤️ ${R.name}：${r.cells.length}マス・${r.sections.length}区間・${matList(r.cost)}${r.skip&&r.skip.length?`（${r.skip.length}マスはもうある・予定あり＝請求しない）`:""}` : `🛤️ ${R.name}：始点を選ぶ`; }
  return "🏗️ "+P.cons.label+"の予定地（向き "+Math.round(((P.rot*180/Math.PI)%360+360)%360)+"°）"; }
function consPlaceConfirm(P){
  if(P.road){
    if(!P.road.a){ P.road.a = {x:P.x, z:P.z}; placeUpdate(true); banner("始点を決めた。終点を選んで「ここまで敷く」"); return; }
    const r = CONS.planRoad(S, WORLD, P.road.kind, P.road.a, {x:P.x, z:P.z}, Date.now(), P.token);
    if(!r.ok){ banner("❌ "+r.msg); placeUpdate(true); return; }
    save(); endPlace(); banner("🛤️ 道の予定地を "+r.ids.length+" 区間つくった（資材を運んで施工する）"); consSync(); return; }
  const C2 = P.cons, opts = consOpts(); let r;
  if(C2.legacy) r = CONS.placeLegacy(S, WORLD, C2.legacy, P.x, P.z, P.rot, opts, P.token);
  else if(C2.move && C2.relocate) r = CONS.relocate(S, WORLD, C2.move, P.x, P.z, P.rot, opts, P.token);
  else if(C2.move) r = CONS.move(S, WORLD, C2.move, P.x, P.z, P.rot, opts, P.token);
  else r = CONS.plan(S, WORLD, C2.def, P.x, P.z, P.rot, opts, P.token);
  if(!r.ok){ banner("❌ "+r.msg); P.busy=false; placeUpdate(true); return; }
  save(); endPlace(); consSync();
  banner(C2.legacy ? "🏗️ "+C2.label+"を置いた（以前の設備から）" : C2.move ? "🏗️ 予定地を移した"+(r.returned&&Object.keys(r.returned).length?"（資材は持ち物へ戻した）":"") : "🏗️ "+C2.label+"の予定地を決めた。資材を現地へ運ぼう");
  if(!C2.legacy && !C2.move) consOpen(r.id);
}
/* 道の予定のマス（画面に重ねる線） */
function consRoadOverlay(sv, P){
  const r = P.roadPlan; if(!r){ sv.innerHTML=""; return; }
  const poly = (i,j,col,dash)=>{ const c = CONS.cellCenter(i,j), h = CX.CELL/2; const pts = [[-h,-h],[h,-h],[h,h],[-h,h]].map(([dx,dz])=>toScreen(c.x+dx, groundY(c.x+dx,c.z+dz)+0.05, c.z+dz));
    return `<polygon points="${pts.map(q=>q.x.toFixed(1)+","+q.y.toFixed(1)).join(" ")}" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="2" ${dash?'stroke-dasharray="6 4"':""}/>`; };
  const a = P.road.a; const start = a ? toScreen(a.x, groundY(a.x,a.z)+0.1, a.z) : null;
  sv.innerHTML = r.cells.map(q=>poly(q.i,q.j,"#3fbf62")).join("") + r.bad.map(q=>poly(q.i,q.j,"#e0434f",true)).join("") + (r.skip||[]).map(q=>poly(q.i,q.j,"#9aa1a8",true)).join("")
    + (start?`<circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="7" fill="#fff" stroke="#c38a2e" stroke-width="3"/>`:"");
}

/* ---------- 現場の画面（搬入・施工・取消・解体・移す） ---------- */
const consStand = v=>{ if(v.kind==="road"){ let best=null; v.cells.forEach(q=>{ const c=CONS.cellCenter(q.i,q.j), d=W3.pos?Math.hypot(c.x-W3.pos.x,c.z-W3.pos.z):0; if(!best||d<best.d) best={x:c.x,z:c.z,d}; }); return best; }
  const d = CONS.DEF[v.def], lp = d.entrance || d.operate || [0, (d.footprint.shape==="rect"?d.footprint.d/2:d.footprint.r)+0.8];
  const co=Math.cos(v.rot), si=Math.sin(v.rot), L=Math.hypot(lp[0],lp[1])||1, ex=lp[0]+lp[0]/L*0.9, ez=lp[1]+lp[1]/L*0.9; return {x:v.x+co*ex+si*ez, z:v.z-si*ex+co*ez}; };
function consOpen(id){ U.cons.open=id; consRenderSheet(); openModal(); }
function consRenderSheet(){
  const id = U.cons.open, v = CONS.state(S).inst[id], sh = $("#sheet"); if(!v){ closeModal(); return; }
  const road = v.kind==="road", d = road ? null : CONS.DEF[v.def], st = CONS.stagesOf(v), near = CONS.near(WORLD, v, W3.pos), rows = CONS.supplyTable(S, v), now = Date.now();
  const name = road ? CX.roads[v.road].name+"（"+v.cells.length+"マス）" : d.name, ready = v.phase!=="completed" ? CONS.stageReady(S, v) : null, pv = CONS.removalPreview(S, id);
  const work = v.work ? Math.max(0, v.work.until-now) : 0, keep = sh.scrollTop;
  sh.innerHTML = `<button class="close" data-act="close">閉じる</button><div class="hd"><span class="bigi">${road?"🛤️":d.facility?ic(d.facility):"🏠"}</span><div><h2>${name}</h2><div class="yomi">${PHASE_NAME[v.phase]}・工程 ${Math.min(v.stage,st.length)}/${st.length}</div></div></div>
    ${!road?`<div class="kidbox">${d.kid}</div>`:""}
    <ol class="csstages">${st.map((s,i)=>`<li class="${i<v.stage||v.phase==="completed"?"ok":i===v.stage?"cur":""}"><b aria-hidden="true">${i<v.stage||v.phase==="completed"?"✓":i===v.stage?"▶":"・"}</b> ${s.name}<small>${matList(s.mat)}${(s.tools||[]).length?"・要："+s.tools.map(nm).join("・"):""}・${Math.round(s.work*(road?v.cells.filter(q=>q.need.includes(s.id)).length:1))}秒</small></li>`).join("")}</ol>
    ${v.phase!=="completed"?`
      <div class="sec">資材 <small>現地で運ぶ（${near?"そばにいる":"現場から遠い："+CX.REACH+"マス以内へ"}）。後の工程の分も先に運べる（必要数まで）</small></div>
      <table class="vtbl cstbl"><tr><th>資材</th><th>所持</th><th>必要</th><th>搬入済み</th><th>不足</th><th></th></tr>${rows.map(r=>`<tr><td>${ic(r.id)}${nm(r.id)}</td><td>${E.vflag(S,"free")?"∞":r.carried}</td><td>${r.need}</td><td>${r.delivered}</td><td class="${r.missing?"ng":"ok"}">${r.missing?"✕ "+r.missing:"✓"}</td>
        <td>${r.missing?`<button class="btn small sub" data-act="cs-dl" data-id="${id}" data-item="${r.id}" ${near&&(r.carried>0||E.vflag(S,"free"))?"":"disabled"}>運ぶ</button>`:""}</td></tr>`).join("")||`<tr><td colspan="6">材料はいらない（手間だけ）</td></tr>`}</table>
      <div class="row mt">${rows.some(r=>r.missing)?`<button class="btn small" data-act="cs-dlall" data-id="${id}" ${near?"":"disabled"}>所持分をまとめて運ぶ</button>`:""}
        ${v.work?`<span class="csbar"><i style="width:${Math.round(100*(1-work/Math.max(1,(v.work.until-(v.work.started||now)))))}%"></i></span><span class="desc" style="margin:0">施工中：あと ${Math.ceil(work/1000)} 秒${near?"":"（現場に戻ると仕上がる）"}</span>`
          :`<button class="btn small act" data-act="cs-work" data-id="${id}" ${ready&&ready.ok&&near?"":"disabled"}>施工する：${st[v.stage]?st[v.stage].name:""}</button>`}
        ${near?"":`<button class="btn small sub" data-act="cs-go" data-id="${id}">現場へ行く</button>`}</div>
      ${ready&&!ready.ok&&!v.work?`<p class="desc">施工できない理由：${ready.why.join("／")}</p>`:""}`:""}
    ${!road&&v.phase==="completed"?`<p class="desc">${d.facility?"設備「"+nm(d.facility)+"」が使える。":"設備の働きはない。"}${CONS.connected(S,id)===true?"入口は道につながっている。":CONS.connected(S,id)===false?"入口の前に道を敷くと、街の道につながる。":""}</p>${d.facility?consNextHtml(d.facility):""}`:""}
    <div class="sec">変更・取消・解体</div>
    <div class="row">${!road&&v.phase!=="completed"&&v.stage===0&&!v.work?(Object.values(v.delivered).some(n=>n>0)?`<button class="btn small sub" data-act="cs-move" data-id="${id}" data-relocate="1">資材を返して移す</button>`:`<button class="btn small sub" data-act="cs-move" data-id="${id}">移す・回す</button>`):""}
      <button class="btn small sub" data-act="cs-remove" data-id="${id}">${v.phase==="completed"?"解体する":"取消す"}</button></div>
    <p class="desc">${v.phase==="completed"?"解体":"取消"}すると戻る物：${matList(pv.returns)}${Object.keys(pv.lost).length?`。失う物（施工で使った分）：${matList(pv.lost)}`:""}${pv.notes.length?"。"+pv.notes.join("。"):""}</p>`;
  sh.scrollTop = keep;
}

/* ---------- 3D：完成した建物は正式モデル、建設中と道もMuse正式素材。当たり判定 ---------- */
function consSync(){
  if(!W3.gfx || !W3.structs) return;
  const want = new Map(); CONS.list(S).forEach(v=>{ if(v.kind!=="road" && v.phase==="completed") want.set("cs:"+v.id, v); });
  [...W3.structs].forEach(k=>{ if(k.startsWith("cs:")){ const v = want.get(k), info = W3.structInfo && W3.structInfo.get(k);
    if(!v || !info || Math.abs(info.x-v.x)>1e-3 || Math.abs(info.z-v.z)>1e-3 || Math.abs(info.rot-v.rot)>1e-4) structRemove(k); } });
  want.forEach((v,k)=>{ if(!W3.structs.has(k)){ structAdd(k, CONS.DEF[v.def].model, {x:v.x, z:v.z}, v.rot); if(W3.state==="ready" && !(W3.consSeen||(W3.consSeen=new Set())).has(k)){ W3.consSeen.add(k); if(v.done && Date.now()-v.done<3000) W3.gfx.playVisualEffect("levelup", {x:v.x, z:v.z}); } } });
  consVisual(); syncStructColliders();
}
/* 資材の山の形（Muse の契約：木材→lumber・石材→stone・袋物→sacks・金属→metal・その他→crated）。名前の一部の一致ではなく ID の表で決める
   （以前の正規表現では丸太 log・糸・落ち葉が「箱詰め」になっていた。2026-11-14 Claude、a81e63d の pileKind から回収） */
const PILE_OF = Object.fromEntries([["lumber","twig log plank charcoal bark"],["stone","cobble granite brick flint limestone marble basalt firebrick"],
  ["sacks","sand clay thread cloth redpigment plaster cement lime quicklime ash leaves grass salt soda coke gravel"],
  ["metal","iron steel copper copperplate wire tin bronze aluminum electromagnet ironrod pipe bellows generator"]].flatMap(([k,ids])=>ids.split(" ").map(id=>[id,k])));
function consVisual(){
  const H = window.HD2D; if(!H || !H.syncConstructionVisual || !W3.gfx) return;
  const c = CONS.state(S), now = Date.now(), sites = [], pending = [];
  CONS.list(S).forEach(v=>{ if(v.kind==="road"){ v.cells.forEach(q=>pending.push({i:q.i, j:q.j, kind:v.road, phase:v.phase})); return; } if(v.phase==="completed") return;
    const d = CONS.DEF[v.def], f = d.footprint, st = d.stages, need = CONS.totalMat(d), tot = Object.values(need).reduce((a,b)=>a+b,0)||1, got = Object.keys(need).reduce((a,k)=>a+Math.min(need[k], v.delivered[k]||0),0);
    const part = v.work ? Math.min(1, Math.max(0, 1-(v.work.until-now)/Math.max(1, v.work.until-(v.work.started||now)))) : 0;
    const assetDef = ASSETS.construction && ASSETS.construction.contract.buildings.find(b=>b.id===d.id);
    const pileKinds=Object.keys(need).filter(k=>(v.delivered[k]||0)<need[k]).map(k=>PILE_OF[k]||"crated");
    sites.push({id:v.id, def:d.id, model:d.model, stage:v.stage, stages:st.length, pileKinds:[...new Set(pileKinds)], x:v.x, z:v.z, rot:v.rot, shape:f.shape==="rect"?"rect":"circle", w:f.w||0, d:f.d||0, r:f.r||0, phase:v.phase, progress:(v.stage+part)/st.length, supplied:got/tot,
      tall: assetDef?.size?.h || (d.cat==="factory"||d.cat==="housing"||d.cat==="storage" ? 3 : 1.2), entrance:d.entrance||d.operate||null}); });
  const roads = Object.entries(c.roads).map(([k,kind])=>{ const [i,j] = k.split(",").map(Number); return {i, j, kind}; });
  H.syncConstructionVisual(W3.gfx, {sites, roads, pending, cell:CX.CELL, colors:Object.fromEntries(Object.values(CX.roads).map(r=>[r.id, r.color]))}, (x,z)=>groundY(x,z), ASSETS.construction, Object.assign({},ASSETS.buildings,ASSETS.town));
}
/* 施工の時間：終わったら、そばにいれば仕上げる。現場が近いときは右上に近道 */
let consTickN = 0;
function consFrame(){
  if((consTickN++ % 15)!==0 || !W3.pos) return;
  const now = Date.now(); let changed = false;
  for(const v of CONS.list(S)){ if(!v.work || now < v.work.until) continue;
    if(CONS.near(WORLD, v, W3.pos)){ const r = CONS.finishWork(S, WORLD, v.id, W3.pos, now, S.seq); if(r.ok){ changed = true; if(Object.keys(r.cleared||{}).length)banner("🌾 道の草を刈った："+Object.entries(r.cleared).map(([id,n])=>nm(id)+" ×"+n).join("・")); const nm2 = v.kind==="road" ? CX.roads[v.road].name : CONS.DEF[v.def].name; banner(r.done ? "🏗️ "+nm2+"が完成した！" : "🔨 "+nm2+"：工程 "+r.stage+" が終わった"); if(r.done) afterChange([]); } }
    else if(!v.farNote){ v.farNote = true; banner("🔨 施工の時間が終わった。現場に戻ると仕上がる"); } }
  if(changed){ save(); consSync(); if(U.tab==="build") renderPanel(); }
  if(modalOpen() && U.cons.open && $("#sheet .csstages")) consRenderSheet();
  else if(!changed) consVisual();
  let el = $("#consHud"); const near = CONS.list(S).filter(v=>v.phase!=="completed").map(v=>({v, d:CONS.distTo(WORLD, v, W3.pos)})).filter(o=>o.d < 7).sort((a,b)=>a.d-b.d)[0];
  if(!el){ const h=$("#hud"); if(!h) return; h.insertAdjacentHTML("beforeend", `<button id="consHud" class="cshud" hidden></button>`); el=$("#consHud"); }
  el.hidden = !(near && U.tab==="explore" && !W3.place);
  if(near){ el.dataset.act="cs-open"; el.dataset.id=near.v.id; el.textContent = "🏗️ "+(near.v.kind==="road" ? CX.roads[near.v.road].name : CONS.DEF[near.v.def].name)+"の現場"; }
}

/* ---------- 入力 ---------- */
document.addEventListener("click", ev=>{ const b = ev.target.closest && ev.target.closest("[data-act^='cs-']"); if(!b || b.disabled) return; ev.preventDefault();
  const a = b.dataset.act, id = b.dataset.id, now = performance.now();
  /* 二重押しの防止：直前の操作から 0.6 秒以内の「施工する」「取消・解体」は受け付けない（まとめて運んだあと、同じ所に施工のボタンが出るため） */
  if((a==="cs-work" || a==="cs-remove") && now - (U.cons.lastAct||0) < 600) return;
  U.cons.lastAct = now;
  if(a==="cs-cat"){ U.cons.cat = id; renderPanel(); return; }
  if(a==="cs-place"){ consStartPlace({def:id}); return; }
  if(a==="cs-road"){ consStartPlace({road:id}); return; }
  if(a==="cs-legacy"){ consStartPlace({legacy:id}); return; }
  if(a==="cs-open"){ consOpen(id); return; }
  if(a==="cs-next"){ closeModal(); if(id==="space" && typeof spaceUI==="function") spaceUI().section="製作"; setTab(id); return; }
  if(a==="cs-go"){ const v = CONS.state(S).inst[id]; if(!v) return; closeModal(); setTab("explore"); const p = consStand(v); if(p && W3.state==="ready"){ goTo3D(p.x, p.z, null); banner("🧭 現場へ向かう"); } return; }
  if(a==="cs-move"){ closeModal(); consStartPlace({def:CONS.state(S).inst[id].def, move:id, relocate:!!b.dataset.relocate}); return; }
  if(a==="cs-remove"){ const v = CONS.state(S).inst[id], pv = CONS.removalPreview(S, id); if(!v) return;
    const txt = (v.phase==="completed"?"解体":"取消")+"する？\n戻る物："+(Object.entries(pv.returns).map(([k,q])=>nm(k)+"×"+q).join("・")||"なし")+(Object.keys(pv.lost).length?"\n失う物："+Object.entries(pv.lost).map(([k,q])=>nm(k)+"×"+q).join("・"):"")+(pv.notes.length?"\n"+pv.notes.join("\n"):"");
    if(!confirm(txt)) return; const r = CONS.remove(S, id, S.seq); if(r.ok){ closeModal(); save(); consSync(); afterChange([]); renderPanel(); banner("🏗️ "+(v.phase==="completed"?"解体":"取消")+"した"); } else banner("❌ "+r.msg); return; }
  let r = null;
  if(a==="cs-dl") r = CONS.deliver(S, WORLD, id, b.dataset.item, 999, W3.pos, S.seq);
  if(a==="cs-dlall") r = CONS.deliverAll(S, WORLD, id, W3.pos, S.seq);
  if(a==="cs-work"){ r = CONS.startWork(S, WORLD, id, W3.pos, Date.now(), S.seq); if(r.ok){ const v = CONS.state(S).inst[id]; v.work.started = Date.now(); v.farNote = false; } }
  if(r){ if(!r.ok) banner("❌ "+r.msg); else { save(); consSync(); } consRenderSheet(); }
});

/* ---------- 工作の画面からの導線（設備は建てて作る／必要な設備がまだ完成していない） ---------- */
function consSiteOf(fac){ const d = CONS.facilityBuilding(fac); return d ? CONS.list(S).find(v=>v.def===d.id && v.phase!=="completed") : null; }
function consCraftLink(fac){ const d = CONS.facilityBuilding(fac), site = consSiteOf(fac);
  return `<div class="row mt"><span class="desc" style="margin:0">この設備は現地に建てる（予定地 → 資材を運ぶ → 施工）</span>${site?`<button class="btn small" data-act="cs-open" data-id="${site.id}">現場を開く（${consSiteLabel(site)}）</button>`:""}<button class="btn small sub" data-act="cs-place" data-id="${d.id}">${site?"もう1つ建てる":"建設する"}</button></div>`; }
/* 完成した設備の「次にどこで使うか」（研究室の装置・工作・宇宙計画の製作）。表示と画面の移動だけ（2026-11-14 Claude、2ad10e2 から回収） */
function consNextHtml(fac){
  const lab = !!(IT[fac] && IT[fac].ops && IT[fac].ops.length), craft = D.crafts.some(c=>!c.space && (c.at===fac || c.tools.includes(fac)));
  const space = D.space && D.space.recipes.some(c=>c.at===fac || (c.tools||[]).includes(fac));
  if(!lab && !craft && !space) return "";
  return `<div class="row mt"><span class="desc" style="margin:0">次に使う所：</span>${lab?`<button class="btn small" data-act="cs-next" data-id="lab">研究室で使う</button>`:""}${craft?`<button class="btn small" data-act="cs-next" data-id="craft">工作で使う</button>`:""}${space?`<button class="btn small" data-act="cs-next" data-id="space">宇宙計画の製作で使う</button>`:""}</div>`; }
const consSiteLabel = site=>{ const st = CONS.stagesOf(site); return PHASE_NAME[site.phase]+"・工程 "+Math.min(site.stage,st.length)+"/"+st.length; };
function consNeedLink(c){ const miss = c.tools.concat(c.at?[c.at]:[]).filter(t=>!E.hasTool(S,t) && CONS.facilityBuilding(t));
  return miss.map(t=>{ const site = consSiteOf(t), d = CONS.facilityBuilding(t);
    return site ? `<button class="btn small sub" data-act="cs-open" data-id="${site.id}">「${nm(t)}」の現場を開く（${consSiteLabel(site)}）</button>` : `<button class="btn small sub" data-act="cs-place" data-id="${d.id}">「${nm(t)}」を建設する</button>`; }).join(""); }
