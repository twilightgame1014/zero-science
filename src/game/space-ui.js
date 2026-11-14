/* ===================== 宇宙計画の画面（ui.js の中に、ビルドで差しこむ。判定は space.js＝SPACE） =====================
   「宇宙へ」のプロジェクト画面（分野・部品の逆引き）・実習・機体の組立・地上設備の設置・試験・搭乗・打ち上げ演出・エンディング。
   ここには表示と入力だけを書く（合否や条件は SPACE に聞く）。 */
var SPX = D.space;
U.sp = {view:"home", id:null, reveal:false, open:{}};
function spS(){ return S.space || (S.space = E.newSpace()); }
const ST_LABEL = {done:["✓","完成済み","ok"], ready:["🔨","製作可能","go"], mat:["✕","材料不足","ng"], fac:["🧰","設備不足","ng"], know:["📘","実習待ち","wait"], gather:["⛏","採取できる","go"], none:["？","—","wait"]};
const spChip = (st, extra)=>{ const L=ST_LABEL[st.s]||ST_LABEL.none; return `<span class="spst ${L[2]}"><b aria-hidden="true">${L[0]}</b>${L[1]}${extra||""}</span>`; };
const spKnown = id => !!S.disc[id] || U.sp.reveal || E.status(S,id)!=="hidden";
const spName = id => S.disc[id] || U.sp.reveal ? ic(id)+" "+nm(id) : (E.status(S,id)==="hinted" ? "❔ ？？？（ヒントあり）" : "❔ ？？？");
const simpTag = o => o && o.simp ? ` <span class="tag sptag">ゲーム内で簡略化</span>` : "";
function spGo(view, id){ U.sp.view=view; U.sp.id=id||null; if(U.tab!=="space") setTab("space"); else renderPanel(); const b=$("#dockBody"); if(b) b.scrollTop=0; }

/* ---------- プロジェクト画面 ---------- */
function spProgress(){
  const sp=spS(), parts=[SPX.trials.filter(t=>sp.know[t.id]).length/SPX.trials.length, SPX.ground.filter(g=>SPACE.placed(S,g.item)).length/SPX.ground.length,
    SPACE.rocketCount(S)/SPX.modules.length, SPX.tests.filter(t=>sp.tests[t.id]).length/SPX.tests.length, SPACE.owns(S,"spacesuit")?1:0];
  return sp.clear ? 1 : parts.reduce((a,b)=>a+b,0)/parts.length*0.98;
}
function spNext(){
  const sp=spS(); if(sp.clear) return {t:"宇宙へ到達した。地上の探検と研究は、これからも続けられる。", go:["launch"]};
  const cs=SPACE.launchChecks(S); if(cs.slice(0,9).every(c=>c.ok)) return {t:"準備はすべて整った。宇宙服を着て、支持塔のそばから乗りこもう。", go:["launch"]};
  for(const f of SPACE.overview(S)){ if(!f.open) continue; const it=f.items.find(x=>x.st.s==="ready"); if(it) return {t:"「"+nm(it.id)+"」が作れる（"+f.name+"）", go:["item",it.id]}; }
  const tr=SPX.trials.find(t=>!sp.know[t.id] && SPACE.trialInfo(S,t.id).ok); if(tr) return {t:"実習「"+tr.name+"」を試せる", go:["field","computer"]};
  const m=SPX.modules.find(x=>SPACE.installInfo(S,x.slot).ok); if(m) return {t:"機体に「"+m.name+"」を取りつけられる", go:["field","rocket"]};
  const g=SPX.ground.find(x=>E.hasTool(S,x.item) && !SPACE.placed(S,x.item)); if(g && !S.verify) return {t:"「"+g.name+"」をマップに置こう", go:["field","ground"]};
  const te=SPX.tests.find(t=>!sp.tests[t.id] && SPACE.testInfo(S,t.id).ok); if(te) return {t:"試験「"+te.name+"」を受けられる", go:["field","launch"]};
  const f0=SPACE.overview(S).find(f=>f.open && f.done<f.total); if(f0){ const it=f0.items.find(x=>x.st.s!=="done"); return {t:"次は「"+f0.name+"」："+(S.disc[it.id]?nm(it.id):"新しい部品")+"を目指そう", go:["item",it.id]}; }
  return {t:"まずは鋼と蒸気機関を作ろう。そこから「圧延機」と「旋盤」へ進める。", go:["field","mining"]};
}
function viewSpace(){
  const v=U.sp.view;
  const body = v==="field" ? spField(U.sp.id) : v==="item" ? spItem(U.sp.id) : spHome();
  return `<div class="sp">${v==="home"?"":`<div class="row spnav"><button class="btn small sub" data-act="sp-home">← 宇宙へ（全体）</button>${v==="item"&&U.sp.from?`<button class="btn small sub" data-act="sp-field" data-id="${U.sp.from}">← ${SPX.fields.find(f=>f.id===U.sp.from).name}</button>`:""}</div>`}${body}</div>`;
}
function spHome(){
  const sp=spS(), ov=SPACE.overview(S), cs=SPACE.launchChecks(S), nx=spNext(), pct=Math.round(spProgress()*100);
  const open=ov.filter(f=>f.open), later=ov.filter(f=>!f.open);
  const card=f=>{ const n=f.extra?f.extra.done:f.done, t=f.extra?f.extra.total:f.total, all=n>=t && f.done>=f.total;
    const can=f.items.filter(x=>x.st.s==="ready").length, wait=f.items.filter(x=>x.st.s==="know").length;
    return `<button class="spcard ${all?"done":""}" data-act="sp-field" data-id="${f.id}"><span class="h">${all?'<b class="ck" aria-hidden="true">✓</b>':""}${f.name}</span><span class="k">${f.kid}</span>
      <span class="m"><i style="width:${Math.round((f.total?f.done/f.total:n/t)*100)}%"></i></span>
      <span class="s">${f.total?`部品 ${f.done}/${f.total}`:""}${f.extra?`${f.total?"・":""}${f.extra.label||"試験"} ${f.extra.done}/${f.extra.total}`:""}${can?`・<b>製作可能 ${can}</b>`:""}${wait?`・実習待ち ${wait}`:""}</span></button>`; };
  return `<div class="spgoal"><div class="t">最終目標：自分で作ったロケットで、宇宙へ</div>
    <p>発射台と有人ロケットを建て、宇宙服と生命維持装置を整えて、主人公が飛び立つ。必要な物は、どれも石・水・木などの原料から自分で作る。</p>
    <div class="spbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    <div class="row"><span class="chip">進み <b>${pct}%</b></span><span class="chip">打ち上げの条件 <b>${cs.filter(c=>c.ok).length}/${cs.length}</b></span>${sp.clear?`<span class="chip">🏅 宇宙到達 <b>${new Date(sp.clear.t).toLocaleDateString("ja-JP")}</b></span>`:""}</div></div>
  <div class="note good spnext"><h4>次にやること</h4><p style="margin:0">${nx.t}</p><div class="row mt"><button class="btn small" data-act="sp-${nx.go[0]==="item"?"item":nx.go[0]==="field"?"field":"field"}" data-id="${nx.go[1]||"launch"}">ひらく</button>${sp.clear?`<button class="btn small sub" data-act="sp-ending">🏅 到達の記録を見る</button>`:""}</div></div>
  <div class="sec">10の分野 <small>分野をひらくと、部品と作り方が分かる。部品をえらぶと、原料までさかのぼれる</small></div>
  <div class="spgrid">${open.map(card).join("")}</div>
  ${later.length?`<div class="sec">この先 <small>材料が見つかると、ひらけるようになる</small></div><ul class="splater">${later.map(f=>`<li><b>${f.name}</b>：${f.kid}</li>`).join("")}</ul>`:""}
  <p class="desc">推進・誘導などの部品は、仕組みの考え方だけを扱うゲーム専用の架空の部品です。「ゲーム内で簡略化」の印がある工程は、実際の工業の工程を大きくまとめています。</p>
  ${VERIFY?spVerifyBox():""}`;
}
function spItemRow(x, from){ const known=spKnown(x.id);
  return `<button class="sprow" data-act="sp-item" data-id="${x.id}" data-from="${from||""}"><span class="n">${known?ic(x.id)+" "+nm(x.id):"❔ ？？？"}</span>${spChip(x.st, x.st.s==="done"&&!IT[x.id].unique&&E.cnt(S,x.id)?` ×${E.cnt(S,x.id)}`:"")}</button>`; }
function spField(fid){
  const f=SPX.fields.find(x=>x.id===fid)||SPX.fields[0], inf=SPACE.fieldInfo(S,f); U.sp.id=f.id;
  let extra="";
  if(f.id==="computer") extra = spTrialsHTML();
  if(f.id==="rocket") extra = spRocketHTML();
  if(f.id==="ground") extra = spGroundHTML();
  if(f.id==="launch") extra = spLaunchHTML();
  if(f.id==="suit") extra = spSuitHTML();
  return `<div class="sec" style="margin-top:6px">${f.name} <small>${f.kid}</small></div>
    ${extra}
    ${inf.items.length?`<div class="sec">部品 <small>${inf.done}/${inf.total}　えらぶと作り方と原料までの道が見える</small></div><div class="splist">${inf.items.map(x=>spItemRow(x,f.id)).join("")}</div>`:""}`;
}
/* 部品の画面：状態・作り方・なぜこの材料か・原料までの木 */
function spTreeNode(n, top){
  const known=spKnown(n.id), via=n.via, leaf=!n.kids.length;
  const have = n.st.s==="done" && IT[n.id].unique ? "✓" : `${n.have}/${n.need}`;
  const how = !via ? "" : via.kind==="gather" ? `⛏ ${via.region.name}で採る` : via.kind==="craft" ? "🔨 工作" : `🧪 ${D.ops[via.proc.op].name}`;
  const tools = n.tools.filter(Boolean).map(t=>`<span class="${E.hasTool(S,t)?"ok":"ng"}">${S.disc[t]||U.sp.reveal?nm(t):"？？？"}</span>`).join("") + (n.know||[]).map(k=>`<span class="${E.knows(S,k)?"ok":"ng"}">実習：${SPACE.trialOf(k).name}</span>`).join("");
  const head = `<span class="tn">${known?ic(n.id)+" "+nm(n.id):"❔ ？？？"}</span><span class="tq ${n.have>=n.need||n.st.s==="done"&&IT[n.id].unique?"ok":"ng"}">${have}</span><span class="th">${how}</span>`;
  if(leaf || n.loop) return `<div class="tleaf">${head}</div>`;
  return `<details class="tnode" ${top?"open":""}><summary>${head}</summary>${tools?`<div class="need ttools">${tools}</div>`:""}<div class="tkids">${n.kids.map(k=>spTreeNode(k,false)).join("")}</div></details>`;
}
function spItem(id){
  const it=IT[id]; if(!it) return spHome();
  const st=SPACE.itemStatus(S,id), known=spKnown(id), via=st.via||SPACE.mainRecipe(S,id), c=via&&via.kind==="craft"?via.craft:null, p=via&&via.kind==="proc"?via.proc:null;
  if(!known) return `<div class="card"><h3><span class="i">❔</span>？？？</h3><div class="kidbox">🦉 ${E.hint(S,id)||"まだ手がかりがない。手前の部品から作っていこう。"}</div>
    <div class="row mt"><button class="btn small sub" data-act="sp-reveal">くわしく見る（名前と作り方を表示）</button></div></div>`;
  const raw=SPACE.rawTotals(S,id,1), rawL=Object.keys(raw).sort((a,b)=>raw[b]-raw[a]);
  const mx=c?E.craftMax(S,c):0;
  const act = st.s==="done" && it.unique ? "" : c ? `<div class="row mt"><button class="btn small act" data-act="craft" data-id="${c.id}" ${E.planCraft(S,c).ok?"":"disabled"}>🔨 作る</button>${mx>=2?`<button class="btn small sub" data-act="craft" data-id="${c.id}" data-n="${Math.min(mx,5)}">×${Math.min(mx,5)} まとめて作る</button>`:""}<button class="btn small sub" data-tab="craft">工作をひらく</button></div>`
    : p ? `<div class="row mt"><button class="btn small act" data-act="sp-lab" data-id="${p.id}">🧪 研究室で準備する</button></div>` : "";
  const slot=SPACE.slotOf(id), gr=SPX.ground.find(g=>g.item===id);
  return `<div class="card spitem"><h3><span class="i">${ic(id)}</span>${it.name}${simpTag(it)}</h3><div class="kid">${it.kid}</div>
    <div class="row">${spChip(st)}${st.msg?`<span class="desc" style="margin:0">${st.msg}</span>`:""}</div>
    ${c&&c.why?`<p class="spwhy"><b>なぜこの材料？</b> ${c.why}</p>`:""}${c?`<p class="desc">作り方：${c.how}</p>`:""}${p?`<p class="desc">${D.ops[p.op].name}：${p.why}${simpTag(p)}</p>`:""}
    ${act}
    ${slot?`<div class="row mt"><button class="btn small sub" data-act="sp-field" data-id="rocket">機体の組立を見る</button></div>`:""}${gr?`<div class="row mt"><button class="btn small sub" data-act="sp-field" data-id="ground">地上設備の設置を見る</button></div>`:""}
    <div class="row mt"><button class="btn small sub" data-act="item" data-id="${id}">📖 図鑑で読む</button>${U.sp.reveal?"":`<button class="btn small sub" data-act="sp-reveal">まだ見つけていない物の名前も表示</button>`}</div></div>
  <div class="sec">原料までの道 <small>持っている数／必要な数。▶ をひらくと、その材料の作り方が出る</small></div>
  <div class="sptree">${spTreeNode(SPACE.tree(S,id,1,14), true)}</div>
  ${rawL.length?`<div class="sec">もとになる原料 <small>この部品1つ分の目安（途中の材料を持っていれば、その分は少なくてすむ）</small></div><div class="need">${rawL.map(k=>`<span>${spName(k)} ${raw[k]}</span>`).join("")}</div>`:""}`;
}

/* ---------- 実習（電子部品とコンピューター） ---------- */
const NUMC = "①②③④⑤⑥⑦⑧";
function spTrialsHTML(){
  const sp=spS();
  return `<div class="sec">実習 <small>作った物を実際に動かして確かめる。済ませると、次の段階の部品が作れる</small></div><div class="splist">${SPX.trials.map(t=>{ const inf=SPACE.trialInfo(S,t.id), done=!!sp.know[t.id];
    const hide = !done && !inf.ok && !t.need.some(i=>S.disc[i]) && !U.sp.reveal && t.n>1 && !sp.know[SPX.trials[t.n-2].id];
    return `<div class="sprow tr"><span class="n">${NUMC[t.n-1]} ${hide?"？？？（前の段階を進めると分かる）":t.name}<small>${hide?"":done?t.learn:inf.ok?t.kid:"必要："+inf.lacks.map(l=>l.text).join("、")}</small></span>
      ${done?`<span class="spst ok"><b aria-hidden="true">✓</b>済み</span>`:""}${inf.ok?`<button class="btn small ${done?"sub":"act"}" data-act="sp-trial" data-id="${t.id}">${done?"もう一度":"試す"}</button>`:hide?"":`<span class="spst ng"><b aria-hidden="true">🧰</b>準備中</span>`}</div>`; }).join("")}</div>`;
}
function trialOpen(id){ U.tr = {id, tried:[], gap:null, sw:false, seen:{}, sig:false, q:null, rows:{and:[0,0,0,0],or:[0,0,0,0],not:[0,0]}, a:0, b:0, na:0, sums:[], inp:0, ops:[], map:{}, progs:{g1:[["set",0],["out",0]], g2:[["set",0],["out",0]]}, pick:null, msg:""}; trialRender(); openModal(); }
const bits = (v,n)=>{ let s=""; for(let i=n-1;i>=0;i--) s+=(v>>i)&1; return s; };
const bitBtns = (act, v, n, lab)=>`<span class="bitrow"><em>${lab}</em>${Array.from({length:n},(_,k)=>{ const i=n-1-k; return `<button class="bit ${((v>>i)&1)?"on":""}" data-act="${act}" data-id="${i}" aria-pressed="${!!((v>>i)&1)}">${(v>>i)&1}</button>`; }).join("")}<i>＝${v}</i></span>`;
const lampHTML = on=>`<span class="lamp ${on?"on":""}" role="img" aria-label="${on?"ランプがついている":"ランプは消えている"}">💡<b>${on?"ついた":"消えている"}</b></span>`;
const VM_OPS = [["set","入れる"],["add","足す"],["sub","引く"],["out","表示する"],["jnz","0でなければ行へ"],["nop","（なし）"]];
function trialBody(){
  const T=U.tr, t=SPACE.trialOf(T.id);
  if(T.id==="circuit"){ const on=SPACE.circuitLamp(T.gap,T.sw), M=[["copper","銅線"],["iron","鉄の棒"],["rubber","ゴム"],["glass","ガラス"],["cloth","かわいた布"]];
    return `<p>電源 → スイッチ → <b>すき間</b> → ランプ → 電源、と輪につなぐ。すき間にはさむ物を変えて、ランプを見よう。</p>
      <div class="trbox"><div class="circ"><span>🔋 電源</span><span class="w ${T.sw?"on":""}">${T.sw?"━ スイッチ入 ━":"━ ╱ スイッチ切 ━"}</span><span class="gap">${T.gap?M.find(m=>m[0]===T.gap)[1]:"（すき間）"}</span>${lampHTML(on)}</div>
      <div class="row">${M.map(m=>`<button class="opt ${T.gap===m[0]?"sel":""}" data-act="sp-t-gap" data-id="${m[0]}" aria-pressed="${T.gap===m[0]}">${T.tried.includes(m[0])?(SPACE.CONDUCT[m[0]]?"○ ":"× "):""}${m[1]}</button>`).join("")}</div>
      <div class="row mt"><button class="btn small sub" data-act="sp-t-sw">スイッチを${T.sw?"切る":"入れる"}</button></div></div>
      <p class="desc">○＝電気を通した（導体）、×＝通さなかった（絶縁体）。通す物と通さない物の両方を確かめてから、ランプをつけて終わろう。</p>`; }
  if(T.id==="switching"){ const on=T.sig;
    return `<p>左の回路（合図）に電気を流すと、電磁石が鉄の接点を引きよせて、右の回路（ランプ）がつながる。</p>
      <div class="trbox"><div class="circ"><span>合図：<b>${on?"入":"切"}</b></span><span>🧲 電磁石${on?"が引きよせる":"ははなれている"}</span><span class="w ${on?"on":""}">${on?"━ 接点がつく ━":"━ ╱ 接点がはなれる ━"}</span>${lampHTML(on)}</div>
      <div class="row"><button class="btn small sub" data-act="sp-t-sig">合図の電気を${on?"切る":"入れる"}</button></div></div>
      <p><b>問い：</b>合図の電気を切ると、ランプはどうなる？</p><div class="row">${[["on","ついたまま"],["off","消える"]].map(o=>`<button class="opt ${T.q===o[0]?"sel":""}" data-act="sp-t-q" data-id="${o[0]}" aria-pressed="${T.q===o[0]}">${o[1]}</button>`).join("")}</div>
      <p class="desc">トランジスタも同じ働きをする。動く部分がないので、ずっと小さく、速く切り替えられる。</p>`; }
  if(T.id==="gates"){ const g=(k,two)=>{ const out = k==="not" ? SPACE.GATE.not(T["A"+k]|0) : SPACE.GATE[k](T["A"+k]|0, T["B"+k]|0);
      const rows = two ? [[0,0],[0,1],[1,0],[1,1]] : [[0],[1]];
      return `<div class="gate"><h5>${k.toUpperCase()}</h5><div class="row"><button class="bit ${T["A"+k]?"on":""}" data-act="sp-t-gate" data-id="A${k}">A=${T["A"+k]|0}</button>${two?`<button class="bit ${T["B"+k]?"on":""}" data-act="sp-t-gate" data-id="B${k}">B=${T["B"+k]|0}</button>`:""}<span>→ 出力 <b>${out}</b></span>${lampHTML(!!out)}</div>
        <table class="tt"><tr><th>A</th>${two?"<th>B</th>":""}<th>出力</th></tr>${rows.map((r,i)=>`<tr><td>${r[0]}</td>${two?`<td>${r[1]}</td>`:""}<td>${T.rows[k][i]?(k==="not"?SPACE.GATE.not(r[0]):SPACE.GATE[k](r[0],r[1])):"？"}</td></tr>`).join("")}</table></div>`; };
    return `<p>入力のボタンを押して 0 と 1 を切り替え、出力の表を全部うめよう。</p><div class="gates">${g("and",true)}${g("or",true)}${g("not",false)}</div>
      <p><b>問い：</b>A=1、B=0 のとき、出力が 1 になるのはどっち？</p><div class="row">${[["and","AND"],["or","OR"]].map(o=>`<button class="opt ${T.q===o[0]?"sel":""}" data-act="sp-t-q" data-id="${o[0]}" aria-pressed="${T.q===o[0]}">${o[1]}</button>`).join("")}</div>`; }
  if(T.id==="adder"){ const sum=SPACE.adder(T.a,T.b,2);
    return `<p>2進数は、右から 1・2・4 の位。スイッチで A と B を入れると、加算器が答えを出す。</p>
      <div class="trbox">${bitBtns("sp-t-a",T.a,2,"A")}${bitBtns("sp-t-b",T.b,2,"B")}<div class="sumrow">A＋B＝<b class="bin">${bits(sum,3)}</b>（10進数で ${sum}）</div></div>
      <p>答えが次の数になる組み合わせを、3つとも作ろう：</p><div class="row">${SPACE.ADD_GOALS.map((g,i)=>`<span class="spst ${T.sums[i]?"ok":"wait"}"><b aria-hidden="true">${T.sums[i]?"✓":"・"}</b>${g}（${bits(g,3)}）</span>`).join("")}</div>
      <p class="desc">1＋1 は 2進数で「10」。1けたで表せないので、となりの位にくり上がる。</p>`; }
  if(T.id==="memory"){ const r=SPACE.memRun(T.ops), last=r.reads[r.reads.length-1];
    return `<p><b>1011</b> を書きこみ、入力を別の値に変えてから読み出して、値が保たれているのを確かめよう。</p>
      <div class="trbox">${bitBtns("sp-t-in",T.inp,4,"入力")}<div class="row mt"><button class="btn small sub" data-act="sp-t-write">書きこむ</button><button class="btn small sub" data-act="sp-t-read">読み出す</button></div>
      <div class="sumrow">覚えている値：<b class="bin">${T.ops.some(o=>o[0]==="write")?bits(r.mem,4):"----"}</b>　読み出した値：<b class="bin">${last?bits(last.out,4):"----"}</b></div></div>
      <p class="desc">「書きこむ」を押したときだけ、入力の値が中に取りこまれる。</p>`; }
  if(T.id==="roles"){ return `<p>コンピューターの4つの役割を、仕事に当てはめよう。</p>${SPACE.ROLE_Q.map((q,i)=>`<div class="roleq"><span>${q.q}</span><span class="row">${Object.keys(SPACE.ROLES).map(k=>`<button class="opt ${T.map[i]===k?"sel":""}" data-act="sp-t-role" data-id="${i}:${k}" aria-pressed="${T.map[i]===k}">${SPACE.ROLES[k]}</button>`).join("")}</span></div>`).join("")}`; }
  if(T.id==="program"){ return `<p>命令は上から順に1つずつ実行される。行の番号は 0 から数える。</p>${SPACE.PROG_GOALS.map(g=>{ const pr=T.progs[g.id], r=SPACE.vmRun(pr.filter(x=>x[0]!=="nop")), okk=r.halted && JSON.stringify(r.out)===JSON.stringify(g.want);
      return `<div class="trbox prog"><h5>${g.text} ${okk?'<span class="spst ok"><b aria-hidden="true">✓</b>できた</span>':""}</h5>
        ${pr.map((ln,i)=>`<div class="pl"><em>${i}</em><select data-act="sp-t-op" data-id="${g.id}:${i}" aria-label="${i}行目の命令">${VM_OPS.map(o=>`<option value="${o[0]}" ${ln[0]===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select>
          ${["set","add","sub","jnz"].includes(ln[0])?`<select data-act="sp-t-n" data-id="${g.id}:${i}" aria-label="${i}行目の数">${[0,1,2,3,4,5,6,7].map(n=>`<option ${ln[1]===n?"selected":""}>${n}</option>`).join("")}</select>`:""}</div>`).join("")}
        <div class="row"><button class="btn small sub" data-act="sp-t-addln" data-id="${g.id}" ${pr.length>=6?"disabled":""}>＋ 行を足す</button><button class="btn small sub" data-act="sp-t-delln" data-id="${g.id}" ${pr.length<=1?"disabled":""}>－ 行をへらす</button></div>
        <div class="sumrow">表示：<b class="bin">${r.out.length?r.out.join("、"):"（なし）"}</b>${r.halted?"":"　⚠ 終わらないので止めた"}　ねらい：${g.want.join("、")}</div></div>`; }).join("")}
      <p class="desc">「0でなければ行へ」は、いまの値が 0 でないとき、書いた番号の行へ戻る。くり返しに使う。</p>`; }
  if(T.id==="sensors"){ return `<p>船内コンピューターが、模擬の船内センサーを読んでいる。決まった範囲から外れている値を見つけよう。</p>
      <table class="tt wide"><tr><th>はかる物</th><th>今の値</th><th>正しい範囲</th><th></th></tr>${SPACE.SENSORS.map(s=>`<tr><td>${s.name}</td><td><b>${s.v}${s.unit}</b></td><td>${s.lo}〜${s.hi}${s.unit}</td><td><button class="opt ${T.pick===s.id?"sel":""}" data-act="sp-t-pick" data-id="${s.id}" aria-pressed="${T.pick===s.id}">これが異常</button></td></tr>`).join("")}</table>
      <p class="desc">この表示は、このゲーム専用の模擬機能です。実際の飛行の制御は行いません。</p>`; }
  return "";
}
function trialRender(){
  const T=U.tr, t=SPACE.trialOf(T.id), sh=$("#sheet"), keep=sh.scrollTop;
  sh.innerHTML = `<button class="close" data-act="close">閉じる</button><div class="hd"><span class="bigi">${NUMC[t.n-1]}</span><div><h2>${t.name}</h2><div class="yomi">実習 ${t.n}/8</div></div></div>
    <div class="sptrial">${trialBody()}</div>
    ${T.done?`<div class="note good"><h4>✓ 実習を終えた</h4><p style="margin:0">${t.learn}</p></div><div class="row mt"><button class="btn" data-act="close">とじる</button></div>`
      :`${T.msg?`<div class="note bad"><p style="margin:0">${T.msg}</p></div>`:""}<div class="row mt"><button class="btn act" data-act="sp-t-submit">確かめた（実習を終える）</button></div>`}`;
  sh.scrollTop = keep;
}
function trialAnswer(){ const T=U.tr;
  return {circuit:{tried:T.tried, gap:T.gap, sw:T.sw}, switching:{seen:T.seen, q:T.q}, gates:{rows:T.rows, q:T.q}, adder:{sums:T.sums}, memory:{ops:T.ops}, roles:{map:T.map},
    program:{progs:{g1:T.progs.g1.filter(x=>x[0]!=="nop"), g2:T.progs.g2.filter(x=>x[0]!=="nop")}}, sensors:{pick:T.pick}}[T.id]; }
function trialAct(a, id, el){
  const T=U.tr; if(!T) return; T.msg="";
  if(a==="sp-t-gap"){ T.gap=id; if(T.sw && !T.tried.includes(id)) T.tried.push(id); }
  else if(a==="sp-t-sw"){ T.sw=!T.sw; if(T.sw && T.gap && !T.tried.includes(T.gap)) T.tried.push(T.gap); }
  else if(a==="sp-t-sig"){ T.sig=!T.sig; T.seen[T.sig?"on":"off"]=true; }
  else if(a==="sp-t-q") T.q=id;
  else if(a==="sp-t-gate"){ T[id]=T[id]?0:1; ["and","or","not"].forEach(k=>{ const A=T["A"+k]|0, B=T["B"+k]|0; T.rows[k][k==="not"?A:A*2+B]=1; }); }
  else if(a==="sp-t-a"||a==="sp-t-b"){ const k=a==="sp-t-a"?"a":"b"; T[k]^=(1<<(+id)); const s=SPACE.adder(T.a,T.b,2); SPACE.ADD_GOALS.forEach((g,i)=>{ if(s===g) T.sums[i]=[T.a,T.b]; }); }
  else if(a==="sp-t-in"){ T.inp^=(1<<(+id)); T.ops.push(["in",T.inp]); }
  else if(a==="sp-t-write") T.ops.push(["in",T.inp],["write"]);
  else if(a==="sp-t-read") T.ops.push(["in",T.inp],["read"]);
  else if(a==="sp-t-role"){ const [i,k]=id.split(":"); T.map[+i]=k; }
  else if(a==="sp-t-op"||a==="sp-t-n"){ const [g,i]=id.split(":"); const ln=T.progs[g][+i]; if(a==="sp-t-op") ln[0]=el.value; else ln[1]=+el.value; if(ln[1]==null) ln[1]=0; }
  else if(a==="sp-t-addln") T.progs[id].push(["nop",0]);
  else if(a==="sp-t-delln") T.progs[id].pop();
  else if(a==="sp-t-pick") T.pick=id;
  else if(a==="sp-t-submit"){ const r=SPACE.trialPass(S, T.id, trialAnswer());
    if(r.ok){ T.done=true; if(r.first) banner("📘 実習「"+SPACE.trialOf(T.id).name+"」を終えた"); afterChange([]); renderPanel(); } else T.msg=r.msg; }
  if(T.ops && T.ops.length>36) T.ops = T.ops.slice(-36);
  trialRender();
}

/* ---------- 宇宙服 ---------- */
function spSuitHTML(){
  const sp=spS(), has=E.hasTool(S,"spacesuit");
  return `<div class="note ${has?"good":""}"><h4>宇宙服</h4><p style="margin:0">${has?(sp.wear?"いま着ている。":"組み立て済み。")+(sp.tests.suit?"機能確認に合格している。":"まだ機能確認をしていない（「試験と打ち上げ」で確かめる）。"):"7つの部分（内側の衣服・気密層・保護層・ヘルメット・手袋とブーツ・通信機・生命維持ユニット）を作り、工作で1着に組み立てる。"}</p>
    ${has?`<div class="row mt"><button class="btn small ${sp.wear?"sub":"act"}" data-act="sp-wear">${sp.wear?"宇宙服をぬぐ":"宇宙服を着る"}</button><span class="desc" style="margin:0">着ても主人公（男の子・女の子）の選択は変わらない。見た目は仮の表示（正式な絵は制作待ち）。</span></div>`:""}</div>`;
}

/* ---------- 機体の組立 ---------- */
function spRocketHTML(){
  const n=SPACE.rocketCount(S);
  return `<div class="note"><h4>発射台の上の機体　${n}/${SPX.modules.length}</h4><p style="margin:0">作った部分を、発射台の上で1つずつ取りつける。骨組み（機体構造）が最初、外装が最後。ほかは好きな順でよい。取りつけた部分は、マップの機体にも現れる。</p></div>
  <div class="splist">${SPX.modules.map(m=>{ const done=SPACE.installed(S,m.slot), inf=SPACE.installInfo(S,m.slot);
    return `<div class="sprow tr"><span class="n">${ic(m.item)} ${m.name}<small>${done?"取りつけ済み":inf.ok?"取りつけられる":inf.lacks.map(l=>l.text).join("、")}</small></span>
      ${done?`<span class="spst ok"><b aria-hidden="true">✓</b>取りつけ済み</span>`:inf.ok?`<button class="btn small act" data-act="sp-install" data-id="${m.slot}">取りつける</button>`:`<button class="btn small sub" data-act="sp-item" data-id="${m.item}" data-from="rocket">作り方</button>`}</div>`; }).join("")}</div>`;
}
/* ---------- 地上設備 ---------- */
function spGroundHTML(){
  const iss=SPACE.siteIssues(S), site=SPX.site;
  return `<div class="note"><h4>発射場をマップに建てる</h4><p style="margin:0">工作で作った設備を、平らで広い場所に置く（持っているだけでは使えない）。支持塔は発射台から${SPX.towerNear}マス以内、管制端末は安全のため${SPX.controlFar}マス以上はなす。</p>
    <div class="row mt"><button class="btn small sub" data-act="sp-site">🧭 候補地「${site.name}」へ行く</button></div></div>
  ${iss.length?`<div class="note bad"><p style="margin:0">${iss.map(x=>x.text).join("<br>")}</p></div>`:""}
  <div class="splist">${SPX.ground.map(g=>{ const has=E.hasTool(S,g.item), pl=SPACE.placed(S,g.item);
    return `<div class="sprow tr"><span class="n">${ic(g.item)} ${g.name}<small>${pl?"マップに置いてある":has?"作ってある。まだ置いていない":"まだ作っていない"}</small></span>
      ${pl?`<span class="spst ok"><b aria-hidden="true">✓</b>設置済み</span><button class="btn small sub" data-act="b-start" data-id="${g.plan}">動かす</button>`:has?`<button class="btn small act" data-act="b-start" data-id="${g.plan}">ここに置く場所を決める</button>`:`<button class="btn small sub" data-act="sp-item" data-id="${g.item}" data-from="ground">作り方</button>`}</div>`; }).join("")}</div>`;
}
/* ---------- 試験と打ち上げ ---------- */
function spLaunchHTML(){
  const sp=spS(), cs=SPACE.launchChecks(S), ready=cs.every(c=>c.ok), pre=cs.slice(0,9).every(c=>c.ok), bi=SPACE.boardInfo(S, W3.pos);
  const goBtn=c=>{ const g=c.go; if(!g) return ""; if(g.go==="test") return `<button class="btn small sub" data-act="sp-test" data-id="${g.test}">試験へ</button>`; if(g.go==="ground"||g.go==="rocket") return `<button class="btn small sub" data-act="sp-field" data-id="${g.go}">ひらく</button>`; return ""; };
  return `<div class="sec">試験 <small>短い課題で1つずつ確かめる。失敗しても物は失わない。何度でもやり直せる</small></div>
  <div class="splist">${SPX.tests.map(t=>{ const inf=SPACE.testInfo(S,t.id);
    return `<div class="sprow tr"><span class="n">${t.name}<small>${inf.passed?"合格":inf.ok?t.kid:"足りないもの："+inf.lacks.slice(0,3).map(l=>l.text).join("、")+(inf.lacks.length>3?" ほか"+(inf.lacks.length-3)+"件":"")}</small></span>
      ${inf.passed?`<span class="spst ok"><b aria-hidden="true">✓</b>合格</span>`:""}<button class="btn small ${inf.ok&&!inf.passed?"act":"sub"}" data-act="sp-test" data-id="${t.id}">${inf.passed?"もう一度":inf.ok?"試験する":"くわしく"}</button></div>`; }).join("")}</div>
  <div class="sec">打ち上げの条件 <small>${cs.filter(c=>c.ok).length}/${cs.length}</small></div>
  <ul class="spchk">${cs.map(c=>`<li class="${c.ok?"ok":"ng"}"><b aria-hidden="true">${c.ok?"✓":"✕"}</b><span>${c.name}${c.ok?"":`<small>${c.why}</small>`}</span>${goBtn(c)}</li>`).join("")}</ul>
  <div class="note ${ready?"good":""}"><h4>搭乗と打ち上げ</h4>
    ${sp.board?`<p style="margin:0">搭乗カプセルに乗りこんだ。最終確認をして、カウントダウンを始めよう。</p>`:pre?(bi.ok?`<p style="margin:0">準備は整った。支持塔の通路から乗りこめる。</p>`:`<p style="margin:0">あと少し：${bi.lacks.map(l=>l.text).join("／")}</p>`):`<p style="margin:0">上の条件がそろうと、乗りこめるようになる。</p>`}
    <div class="row mt">${E.hasTool(S,"spacesuit")?`<button class="btn small sub" data-act="sp-wear">${sp.wear?"宇宙服をぬぐ":"宇宙服を着る"}</button>`:""}
      ${SPACE.placed(S,"tower")?`<button class="btn small sub" data-act="sp-totower">🧭 支持塔へ行く</button>`:""}
      ${sp.board?`<button class="btn small sub" data-act="sp-unboard">降りる</button>`:`<button class="btn small ${pre&&bi.ok?"act":"sub"}" data-act="sp-board" ${pre&&bi.ok?"":"disabled"}>搭乗する</button>`}
      <button class="btn act" data-act="sp-launch" ${ready?"":"disabled"}>🚀 最終確認して打ち上げる</button></div>
    <p class="desc">打ち上げの前に自動でセーブします。演出は「スキップ」できます。${sp.clear?"（宇宙へは到達済み。もう一度の打ち上げは「再演出」で、記録や持ち物は変わりません）":""}</p></div>
  ${sp.clear?`<div class="row mt"><button class="btn small sub" data-act="sp-ending">🏅 到達の記録を見る</button></div>`:""}`;
}

/* ---------- 試験の課題 ---------- */
function testOpen(id){ const task=SPACE.testTask(S,id); U.tt={id, on:[], ans:[0,0], ch:0, echo:null, checked:[], msg:"", lacks:[], token:S.seq}; testRender(); openModal(); }
function testBody(){
  const X=U.tt, task=SPACE.testTask(S,X.id), inf=SPACE.testInfo(S,X.id);
  if(!inf.ok) return `<div class="note bad"><h4>まだ試験できない</h4><p style="margin:0">足りないもの：</p><ul class="spchk">${inf.lacks.map(l=>`<li class="ng"><b aria-hidden="true">✕</b><span>${l.text}</span>${spLackBtn(l)}</li>`).join("")}</ul></div>`;
  if(X.id==="power"){ const sum=task.sources.filter(s=>X.on.includes(s.id)).reduce((a,s)=>a+s.kw,0);
    return `<p>機体と設備が使う電気は <b>${task.demand}</b>。配線が安全に流せるのは <b>${task.limit}</b> まで。つなぐ電源をえらぼう。</p>
      <div class="row">${task.sources.map(s=>`<button class="opt ${X.on.includes(s.id)?"sel":""}" data-act="sp-x-src" data-id="${s.id}" aria-pressed="${X.on.includes(s.id)}">${s.name}　＋${s.kw}</button>`).join("")}</div>
      <div class="pbar"><i class="${sum>task.limit?"over":sum>=task.demand?"okk":""}" style="width:${Math.min(100,sum/(task.limit+2)*100)}%"></i><em style="left:${task.demand/(task.limit+2)*100}%">必要 ${task.demand}</em><em style="left:${task.limit/(task.limit+2)*100}%">限界 ${task.limit}</em></div>
      <div class="sumrow">今つないだ電気：<b class="bin">${sum}</b></div>`; }
  if(X.id==="computer"){ return `<p>船内コンピューターに足し算をさせる。答えを自分でも計算して、スイッチで入れよう（右から 1・2・4・8・16 の位）。</p>
      ${task.sums.map((p,i)=>`<div class="trbox"><div class="sumrow"><b class="bin">${bits(p[0],4)}</b> ＋ <b class="bin">${bits(p[1],4)}</b>　（${p[0]} ＋ ${p[1]}）</div>${bitBtns("sp-x-ans"+i, X.ans[i], 5, "答え")}</div>`).join("")}`; }
  if(X.id==="comm"){ return `<p>地上管制は <b>チャンネル ${task.channel}</b> で呼びかけている。船の通信機を同じチャンネルに合わせよう。</p>
      <div class="row">${Array.from({length:task.channels},(_,i)=>`<button class="opt ${X.ch===i+1?"sel":""}" data-act="sp-x-ch" data-id="${i+1}" aria-pressed="${X.ch===i+1}">チャンネル ${i+1}</button>`).join("")}</div>
      <p>${X.ch===task.channel?`届いた合図：<b class="bin">${task.pattern}</b>　同じ合図を送り返そう。`:"（周波数が合うと、地上からの合図が聞こえる）"}</p>
      ${X.ch===task.channel?`<div class="row">${task.patterns.map(p=>`<button class="opt ${X.echo===p?"sel":""}" data-act="sp-x-echo" data-id="${p}" aria-pressed="${X.echo===p}">${p}</button>`).join("")}</div>`:""}`; }
  return `<p>${inf.test.kid}</p><ul class="spchk">${task.checks.map(c=>{ const okk=X.checked.includes(c.id); return `<li class="${okk?"ok":"wait"}"><b aria-hidden="true">${okk?"✓":"・"}</b><span>${c.name}${c.part&&okk?`<small>${nm(c.part)}：正常</small>`:""}</span>${okk?"":`<button class="btn small sub" data-act="sp-x-chk" data-id="${c.id}" ${X.auto?"disabled":""}>確かめる</button>`}</li>`; }).join("")}</ul>
    ${X.id==="unmanned"&&!X.auto&&X.checked.length<task.checks.length?`<div class="row"><button class="btn small sub" data-act="sp-x-auto">模擬飛行を通しで流す</button></div>`:""}
    ${X.id==="unmanned"?`<p class="desc">船内コンピューターが飛行の流れを順に模擬して、記録を取る（ゲーム専用の模擬機能）。</p>`:""}`;
}
function spLackBtn(l){
  if(l.go==="item") return `<button class="btn small sub" data-act="sp-item" data-id="${l.item}">作り方</button>`;
  if(l.go==="ground") return `<button class="btn small sub" data-act="sp-field" data-id="ground">設置</button>`;
  if(l.go==="slot") return `<button class="btn small sub" data-act="sp-field" data-id="rocket">組立</button>`;
  if(l.go==="trial") return `<button class="btn small sub" data-act="sp-field" data-id="computer">実習</button>`;
  if(l.go==="test") return `<button class="btn small sub" data-act="sp-test" data-id="${l.test}">試験</button>`;
  return "";
}
function testRender(){
  const X=U.tt, t=SPACE.testOf(X.id), sh=$("#sheet"), inf=SPACE.testInfo(S,X.id), keep=sh.scrollTop;
  sh.innerHTML = `<button class="close" data-act="close">閉じる</button><div class="hd"><span class="bigi">🧪</span><div><h2>${t.name}</h2><div class="yomi">試験${inf.passed?"・合格済み":""}</div></div></div>
    <div class="sptrial">${testBody()}</div>
    ${X.done?`<div class="note good"><h4>✓ 合格</h4><p style="margin:0">記録した。${X.id==="final"?"あとは宇宙服を着て、支持塔から乗りこむだけ。":""}</p></div><div class="row mt"><button class="btn" data-act="close">とじる</button></div>`
      :`${X.msg?`<div class="note bad"><h4>不合格（やり直せる）</h4><p style="margin:0">${X.msg}</p>${X.lacks.length?`<ul class="spchk">${X.lacks.map(l=>`<li class="ng"><b aria-hidden="true">✕</b><span>${l.text}</span>${spLackBtn(l)}</li>`).join("")}</ul>`:""}</div>`:""}
        ${inf.ok?`<div class="row mt"><button class="btn act" data-act="sp-x-submit">結果を記録する</button></div>`:""}`}`;
  sh.scrollTop = keep;
}
function testAnswer(){ const X=U.tt; return {on:X.on, ans:X.ans, ch:X.ch, echo:X.echo, checked:X.checked}; }
function testAct(a, id){
  const X=U.tt; if(!X) return; X.msg=""; X.lacks=[];
  if(a==="sp-x-src"){ const i=X.on.indexOf(id); if(i>=0) X.on.splice(i,1); else X.on.push(id); }
  else if(a.startsWith("sp-x-ans")){ const i=+a.slice(8); X.ans[i]^=(1<<(+id)); }
  else if(a==="sp-x-ch"){ X.ch=+id; X.echo=null; }
  else if(a==="sp-x-echo") X.echo=id;
  else if(a==="sp-x-chk"){ if(!X.checked.includes(id)) X.checked.push(id); }
  else if(a==="sp-x-auto"){ const task=SPACE.testTask(S,X.id); X.auto=true; const step=()=>{ if(U.tt!==X || !modalOpen()) return; const nx=task.checks.find(c=>!X.checked.includes(c.id)); if(!nx){ X.auto=false; testRender(); return; } X.checked.push(nx.id); testRender(); setTimeout(step, E.vflag(S,"instant")||RM?120:700); }; step(); return; }
  else if(a==="sp-x-submit"){ const r=SPACE.runTest(S, X.id, testAnswer(), S.seq);
    if(r.ok){ X.done=true; banner("🧪 試験「"+SPACE.testOf(X.id).name+"」に合格"); afterChange([]); renderPanel(); } else { X.msg=r.msg; X.lacks=r.lacks||[]; } }
  testRender();
}

/* ---------- 3D：地上設備・機体・宇宙服（見た目は仮モデル。正式なモデルは Muse の納品待ち） ---------- */
SPX.ground.forEach(g=>{ STRUCT_PLAN.push({id:g.plan, type:g.type, at:{x:SPX.site.x, z:SPX.site.z}, manual:true, item:g.item, when:()=>E.hasTool(S,g.item)}); STRUCT_FAC[g.plan]=[g.item];
  (ASSETS.buildingSpecs||(ASSETS.buildingSpecs={}))[g.type] = {name:g.name, footprint:g.footprint, entrance:g.entrance, operate:g.operate}; });
function spaceSync3D(){
  if(!W3.gfx || !W3.structs) return;
  const pad=SPACE.placedAt(S,"launchpad"), code=SPACE.rocketCode(S), want = pad && code>0 && !(W3.place && W3.place.id==="sp-pad") ? "space-rocket-"+code : null;
  const cur=W3.structInfo && W3.structInfo.get("sp-rocket");
  if(cur && (!want || cur.type!==want || Math.abs(cur.x-pad.x)>1e-3 || Math.abs(cur.z-pad.z)>1e-3)) structRemove("sp-rocket");
  if(want && !W3.structs.has("sp-rocket")) structAdd("sp-rocket", want, {x:pad.x, z:pad.z}, pad.rot||0);
  const H=window.HD2D; if(pad && H && H.spaceTowerAim && W3.structs.has("sp-tower")){ try{ H.spaceTowerAim(W3.gfx, "sp-tower", pad.x, pad.z); }catch(e){} }
}
function spaceInit3D(){ const H=window.HD2D; if(H && H.installSpaceModels && W3.gfx){ try{ H.installSpaceModels(W3.gfx); W3.spaceModels=true; }catch(e){ console.warn("宇宙計画の仮モデルを登録できなかった", e); } } }
let spTickN=0;
function spaceTick(dt){
  const H=window.HD2D, sp=spS();
  if(H && H.spaceSuit && W3.gfx && W3.pos){ try{ H.spaceSuit(W3.gfx, !!sp.wear && !sp.board && !(U.cine&&U.cine.hideHero), W3.pos.x, groundY(W3.pos.x,W3.pos.z), W3.pos.z, performance.now()/1000); }catch(e){} }
  if((spTickN++ % 20)!==0) return;
  /* 発射場のそばに来たら、右上に近道のボタンを出す */
  let el=$("#spHud"); const pad=SPACE.placedAt(S,"launchpad"), tw=SPACE.placedAt(S,"tower");
  const near = W3.pos && [pad,tw].some(p=>p && Math.hypot(p.x-W3.pos.x, p.z-W3.pos.z) < 9);
  if(!el){ const h=$("#hud"); if(!h) return; h.insertAdjacentHTML("beforeend", `<button id="spHud" class="sphud" data-act="sp-field" data-id="launch" hidden>🚀 発射場</button>`); el=$("#spHud"); }
  el.hidden = !(near && U.tab==="explore" && !W3.place && !U.cine);
  if(sp.board && !SPACE.boardInfo(S, W3.pos).ok && !U.cine){ SPACE.unboard(S); save(); banner("支持塔からはなれたので、搭乗を取り消した"); if(U.tab==="space") renderPanel(); }
}

/* ---------- 搭乗・打ち上げ・演出・エンディング ---------- */
function spWear(){ const sp=spS(), r=SPACE.wear(S, !sp.wear); if(!r.ok){ banner(r.msg); return; } save(); banner(r.wear?"🧑‍🚀 宇宙服を着た":"宇宙服をぬいだ"); renderPanel(); }
function spBoard(){ const r=SPACE.board(S, W3.pos); if(!r.ok){ banner("まだ乗れない："+r.lacks[0].text); renderPanel(); return; } haltField(); save(); banner("🚀 搭乗カプセルに乗りこんだ"); renderPanel(); }
function spLaunchConfirm(){
  const cs=SPACE.launchChecks(S); if(!cs.every(c=>c.ok)){ renderPanel(); return; }
  const sh=$("#sheet"), first=!spS().clear;
  sh.innerHTML = `<button class="close" data-act="close">やめる</button><div class="hd"><span class="bigi">🚀</span><div><h2>最終確認</h2><div class="yomi">${first?"はじめての打ち上げ":"再演出（記録と持ち物は変わらない）"}</div></div></div>
    <ul class="spchk">${cs.map(c=>`<li class="ok"><b aria-hidden="true">✓</b><span>${c.name}</span></li>`).join("")}</ul>
    <p class="desc">ここでセーブしてから、カウントダウンを始めます。演出はいつでもスキップできます。</p>
    <div class="row mt"><button class="btn act big" data-act="sp-go" data-token="${S.seq}">カウントダウンを始める</button><button class="btn sub" data-act="close">まだやめておく</button></div>`;
  openModal();
}
function spLaunchGo(token){
  if(U.cine) return;                                  // 二重クリック
  writeNow();                                         // 発射前にセーブ
  const r=SPACE.launchStart(S, token); if(!r.ok){ closeModal(); banner(r.kind==="dup"?"打ち上げはもう始まっている":"まだ打ち上げられない"); renderPanel(); return; }
  writeNow();                                         // 「打ち上げ中」を記録（中断しても分かる）
  closeModal(); setTab("explore"); cineStart({first:r.first, from:"count"});
}
const CINE = [
  {id:"count", t:7.0}, {id:"ignite", t:2.2}, {id:"lift", t:4.2}, {id:"sky", t:9.0}, {id:"space", t:4.5},
];
function cineStart(o){
  haltField();
  const fast = RM || E.vflag(S,"instant");
  const el=document.createElement("div"); el.id="spcine"; el.className="spcine"; el.setAttribute("role","dialog"); el.setAttribute("aria-label","打ち上げ");
  el.innerHTML = `<canvas></canvas><div class="cap" aria-live="polite"></div><div class="big"></div><button class="btn sub skip" data-act="sp-skip">スキップ ▶▶</button>`;
  document.body.appendChild(el);
  const C=U.cine={el, cv:el.querySelector("canvas"), cap:el.querySelector(".cap"), big:el.querySelector(".big"), first:o.first, t0:performance.now(), k: o.from==="sky"?3:0, kt:0, last:performance.now(), speed:fast?3:1, done:false, stars:Array.from({length:140},()=>[Math.random(),Math.random(),Math.random()*1.6+0.4]), clouds:Array.from({length:9},()=>[Math.random(),Math.random(),0.5+Math.random()])};
  const pad=SPACE.placedAt(S,"launchpad");
  if(pad && W3.gfx && W3.state==="ready"){ try{ W3.pos={x:pad.x, z:pad.z}; W3.path=null; W3.target=null; camRebase(); W3.cam.snap=true; }catch(e){} }   /* 主人公は機体の中（カメラは発射台を映す） */
  C.hideHero=true; if(W3.gfx){ try{ W3.gfx.setPlayerVisualState(playerVisual({position:{x:W3.pos.x, z:W3.pos.z}, direction:W3.dir, moving:false})); }catch(e){} }
  C.raf=requestAnimationFrame(cineFrame);
  setTimeout(()=>{ const s=el.querySelector(".skip"); if(s) s.focus({preventScroll:true}); }, 50);
}
function cine3D(lift, flame, arm){ const H=window.HD2D; if(H && H.spaceAnim && W3.gfx){ try{ H.spaceAnim(W3.gfx, {rocket:"sp-rocket", tower:"sp-tower", lift, flame, arm, time:performance.now()/1000}); }catch(e){} } }
function cineFrame(now){
  const C=U.cine; if(!C || C.done) return;
  const dt=Math.min(0.1,(now-C.last)/1000)*C.speed; C.last=now; C.kt+=dt;
  let ph=CINE[C.k]; while(ph && C.kt>=ph.t){ C.kt-=ph.t; C.k++; ph=CINE[C.k]; }
  if(!ph){ cineEnd(); return; }
  const u=C.kt/ph.t, cv=C.cv, W=cv.width=cv.clientWidth, Hh=cv.height=cv.clientHeight, g=cv.getContext("2d");
  g.clearRect(0,0,W,Hh);
  if(ph.id==="count"){ const n=Math.max(1,10-Math.floor(u*10)); C.big.textContent=String(n); C.cap.textContent = u<0.55 ? "カウントダウン" : "支持塔の通路がはなれる";
    cine3D(0, false, Math.max(0,(u-0.55)/0.45)); el3DAlpha(C,0); }
  else if(ph.id==="ignite"){ C.big.textContent = u<0.5?"0":""; C.cap.textContent="噴射開始"; cine3D(0, true, 1); if(u>0.2 && !C.smoke && W3.gfx){ C.smoke=1; const p=SPACE.placedAt(S,"launchpad"); try{ W3.gfx.playVisualEffect("smoke",{x:p.x,z:p.z}); }catch(e){} } }
  else if(ph.id==="lift"){ C.big.textContent=""; C.cap.textContent="上昇"; cine3D(u*u*26, true, 1); el3DAlpha(C, Math.max(0,(u-0.6)/0.4)); }
  else { /* 空 → 宇宙（画面全体の絵。地上のマップを無限に動かすかわりに、ここから先は連続した絵でつなぐ） */
    const a = ph.id==="sky" ? u : 1; el3DAlpha(C,1); cine3D(40, false, 1);
    const mix=(c1,c2,t)=>c1.map((v,i)=>Math.round(v+(c2[i]-v)*t)), top=a<0.5?mix([92,164,232],[18,40,92],a*2):mix([18,40,92],[2,4,12],(a-0.5)*2), bot=a<0.5?mix([180,220,246],[70,120,190],a*2):mix([70,120,190],[6,12,34],(a-0.5)*2);
    const gr=g.createLinearGradient(0,0,0,Hh); gr.addColorStop(0,`rgb(${top})`); gr.addColorStop(1,`rgb(${bot})`); g.fillStyle=gr; g.fillRect(0,0,W,Hh);
    const sa=Math.max(0,(a-0.45)/0.55); if(sa>0){ g.fillStyle="#fff"; C.stars.forEach(s=>{ g.globalAlpha=sa*(0.4+0.6*s[2]/2); g.fillRect(s[0]*W, ((s[1]+now/90000)%1)*Hh, s[2], s[2]); }); g.globalAlpha=1; }
    if(a<0.6){ g.fillStyle="rgba(255,255,255,.75)"; C.clouds.forEach(c=>{ const y=((c[1]+now/1000*0.35*c[2])%1.3)*Hh-40; g.globalAlpha=(1-a/0.6)*0.8; g.beginPath(); g.ellipse(c[0]*W, y, 70*c[2], 16*c[2], 0, 0, 7); g.fill(); }); g.globalAlpha=1; }
    if(ph.id==="space"){ const r=W*1.5; g.fillStyle="#1c5fa8"; g.beginPath(); g.arc(W/2, Hh+r-Hh*0.2*Math.min(1,u*1.4), r, 0, 7); g.fill(); g.strokeStyle="rgba(140,200,255,.7)"; g.lineWidth=5; g.stroke(); }
    /* 機体（仮の絵） */
    const x=W/2, y=Hh*(ph.id==="sky"?0.62-0.14*u:0.48), sc=Math.min(W,Hh)/520;
    g.save(); g.translate(x,y); g.scale(sc,sc);
    if(ph.id==="sky" || u<0.35){ const fl=30+Math.random()*16; const fg=g.createLinearGradient(0,60,0,60+fl*2.4); fg.addColorStop(0,"#fff6c8"); fg.addColorStop(0.4,"#ffb347"); fg.addColorStop(1,"rgba(255,90,40,0)"); g.fillStyle=fg; g.beginPath(); g.moveTo(-13,60); g.lineTo(13,60); g.lineTo(0,60+fl*2.4); g.fill(); }
    g.fillStyle="#e9edf1"; g.fillRect(-15,-50,30,110); g.fillStyle="#d9792b"; g.beginPath(); g.moveTo(-15,-50); g.lineTo(0,-92); g.lineTo(15,-50); g.fill();
    g.fillStyle="#3a4654"; g.fillRect(-15,-8,30,7); g.fillStyle="#7fd0ff"; g.beginPath(); g.arc(0,-34,6,0,7); g.fill(); g.fillStyle="#8a949e"; g.beginPath(); g.moveTo(-15,60); g.lineTo(-30,74); g.lineTo(-15,34); g.fill(); g.beginPath(); g.moveTo(15,60); g.lineTo(30,74); g.lineTo(15,34); g.fill();
    g.restore();
    C.big.textContent=""; C.cap.textContent = ph.id==="space" ? "宇宙に到達" : a<0.3 ? "雲をぬける" : a<0.6 ? "空の色がこくなる（空気がうすくなる）" : "空が暗くなり、星が見える";
  }
  C.raf=requestAnimationFrame(cineFrame);
}
function el3DAlpha(C, a){ C.cv.style.opacity = a; }
/* 演出の終わり：検証の「見るだけ」は記録せずに元へ戻す。本番は到達を記録してエンディングへ */
function cineEnd(){ const C=U.cine; if(!C) return; if(C.preview){ S.space=JSON.parse(C.preview); cancelAnimationFrame(C.raf); C.done=true; cine3D(0,false,0); C.el.remove(); U.cine=null; render(); banner("演出を見終えた（記録はしていない）"); } else cineArrive(); }
function cineArrive(){
  const C=U.cine; if(!C || C.done) return; C.done=true; cancelAnimationFrame(C.raf);
  const r=SPACE.launchArrive(S); writeNow();
  cine3D(0,false,0); C.hideHero=false;
  C.el.remove(); U.cine=null;
  const tw=SPACE.placedAt(S,"tower"); if(tw && W3.state==="ready"){ const q=WORLD.nearestFree(S,{x:tw.x, z:tw.z+2.5},Date.now(),8); if(q){ W3.pos={x:q.x,z:q.z}; try{ camRebase(); W3.cam.snap=true; }catch(e){} } }
  afterChange([]); render();
  endingOpen(r.ok ? r.first : false);
}
function endingOpen(first){
  const sp=spS(); if(!sp.clear) return; const R=sp.clear.record, sh=$("#sheet");
  const days=Math.floor(R.ms/86400000), hrs=Math.floor(R.ms%86400000/3600000), mins=Math.floor(R.ms%3600000/60000);
  const ach=[["宇宙へ到達した",true],["8つの実習をすべて終えた",R.trials>=8],["7つの試験にすべて合格した",R.tests>=7],["図鑑を "+R.found+" 種うめた",true],["図鑑をすべてうめた",R.found>=R.total]];
  sh.innerHTML = `<div class="spend"><div class="stars" aria-hidden="true">✦ ✧ ✦ ✧ ✦</div><h2>${first?"宇宙に、届いた。":"宇宙へ（再演出）"}</h2>
    <p>${first?"石と水と木から始めて、火をおこし、金属を取り出し、電気を作り、0 と 1 で考える機械を組み立て、自分の手で作ったロケットで、空のいちばん上まで来た。":"はじめて到達したときの記録です。再演出では、記録・持ち物・報酬は変わりません。"}</p>
    <div class="row" style="justify-content:center"><span class="chip">最初の採集から <b>${days?days+"日 ":""}${hrs}時間${mins}分</b></span><span class="chip">発見 <b>${R.found}/${R.total}</b></span><span class="chip">作った・拾った <b>${R.made}回</b></span>${sp.replays?`<span class="chip">再演出 <b>${sp.replays}回</b></span>`:""}</div>
    <h5>実績</h5><ul class="spchk">${ach.map(a=>`<li class="${a[1]?"ok":"wait"}"><b aria-hidden="true">${a[1]?"✓":"・"}</b><span>${a[0]}</span></li>`).join("")}</ul>
    <h5>最初の採集から宇宙到達までの歩み</h5><ol class="spsteps">${R.steps.map(s=>`<li>${ic(s.id)} <b>${nm(s.id)}</b><small>${new Date(s.t).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</small></li>`).join("")}<li>🚀 <b>宇宙へ到達</b><small>${new Date(sp.clear.t).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</small></li></ol>
    <div class="note"><p style="margin:0"><b>打ち上げ前の世界で探索を続ける</b>：時間を打ち上げの前に戻して、地上の世界で続けます。ロケットと設備は地上に残り、到達の記録は消えません。資材や報酬が増えることはありません。</p></div>
    <div class="row mt" style="justify-content:center"><button class="btn act big" data-act="close">打ち上げ前の世界で探索を続ける</button></div></div>`;
  sh.scrollTop=0; openModal(sh.querySelector(".btn.act"));
}
/* 演出の途中で閉じた・再読み込みした：続きから見るか、打ち上げ前に戻るかを選ぶ（どちらでも進行不能にならない） */
function spResumeCheck(){
  const sp=spS(); if(!sp.launching || U.cine) return;
  const sh=$("#sheet");
  sh.innerHTML = `<div class="hd"><span class="bigi">🚀</span><div><h2>打ち上げの途中でした</h2><div class="yomi">演出が中断されています</div></div></div>
    <p>カウントダウンのあとで、ゲームが閉じられました。続きから見るか、打ち上げの前に戻るかを選べます。</p>
    <div class="row mt"><button class="btn act" data-act="sp-resume">続きから見る</button><button class="btn sub" data-act="sp-abort">打ち上げ前に戻る</button></div>`;
  openModal();
}

/* ---------- 検証モード：宇宙計画の全段階へ飛ぶ ---------- */
function spVerifyBox(){
  return `<div class="vsec"><h4 style="margin:0 0 6px">検証：宇宙計画</h4><p class="desc" style="margin-top:0">検証データだけを書きかえる（通常のセーブはそのまま）。地上設備と機体は仮モデル。</p>
    <div class="vgrid">${[["know","実習を全部済ませる"],["site","地上設備を候補地に置く"],["inst","機体を全部取りつける"],["tests","試験を全部合格にする"],["ready","搭乗の直前へ"],["cine","打ち上げ演出を見る（記録しない）"],["end","エンディングの例を見る（記録しない）"],["reset","宇宙計画を最初に戻す"]]
      .map(([k,n])=>`<button class="btn small sub" data-act="sp-v" data-id="${k}">${n}</button>`).join("")}</div></div>`;
}
const SITE_LAYOUT = {"sp-pad":[0,0], "sp-tower":[5.5,0], "sp-assembly":[-13,2], "sp-substation":[11,13], "sp-control":[-2,19]};
function spSitePlace(){
  const c=SPX.site, bad=[];
  SPX.ground.forEach(g=>{ const o=SITE_LAYOUT[g.plan], p={id:g.plan, type:g.type, footprint:g.footprint, entrance:g.entrance, operate:g.operate, x:c.x+o[0], z:c.z+o[1], rot:0};
    const ck=WORLD.checkPlacement(S, p, {npcs:[], reserved:[]}); if(!ck.ok) bad.push(g.name+"："+ck.reasons.join("／"));
    S.build[g.plan]={x:p.x, z:p.z, rot:0}; if(W3.state==="ready"){ syncStructures(); } });
  return bad;
}
function spVerifyAct(k){
  const sp=spS(), now=Date.now();
  const know=()=>SPX.trials.forEach(t=>{ sp.know[t.id]=sp.know[t.id]||now; });
  const inst=()=>SPX.modules.forEach(m=>{ sp.inst[m.slot]=sp.inst[m.slot]||now; });
  const tests=()=>SPX.tests.forEach(t=>{ sp.tests[t.id]=sp.tests[t.id]||now; });
  let msg="";
  if(k==="know"){ know(); msg="実習を全部済ませた"; }
  else if(k==="site"){ const bad=spSitePlace(); msg = bad.length ? "置いたが、置き場所の判定に通らない物がある："+bad.join("　") : "地上設備を候補地に置いた（置き場所の判定に全部通った）"; }
  else if(k==="inst"){ if(!SPACE.placed(S,"launchpad")) spSitePlace(); inst(); msg="機体を全部取りつけた"; }
  else if(k==="tests"){ tests(); msg="試験を全部合格にした"; }
  else if(k==="ready"){ know(); spSitePlace(); inst(); tests(); sp.wear=true; const tw=SPACE.placedAt(S,"tower");
    if(W3.state==="ready"){ const q=WORLD.nearestFree(S,{x:tw.x, z:tw.z+2.4},now,8)||{x:tw.x,z:tw.z+2.4}; W3.pos={x:q.x,z:q.z}; W3.path=null; try{ W3.world.afterWarp(q.x,q.z); camRebase(); W3.cam.snap=true; }catch(e){} }
    msg="搭乗の直前へ移った（「搭乗する」→「打ち上げる」を試せる）"; }
  else if(k==="cine"){ setTab("explore"); const keep=JSON.stringify(S.space); S.space.launching=now; cineStart({first:false, from:"count"}); U.cine.preview=keep; return; }
  else if(k==="end"){ const keep=sp.clear; sp.clear={t:now, record:SPACE.record(S,now)}; endingOpen(true); sp.clear=keep; return; }
  else if(k==="reset"){ S.space=E.newSpace(); SPX.ground.forEach(g=>{ delete S.build[g.plan]; }); msg="宇宙計画を最初に戻した"; }
  save(); if(W3.state==="ready") syncStructures(); afterChange([]); renderPanel(); banner("🧪 "+msg);
}

/* ---------- 入力 ---------- */
document.addEventListener("click", ev=>{ const b=ev.target.closest && ev.target.closest("[data-act^='sp-']"); if(!b || b.disabled || b.tagName==="SELECT") return;
  const a=b.dataset.act, id=b.dataset.id; ev.preventDefault();
  if(a==="sp-home"){ closeModal(); spGo("home"); }
  else if(a==="sp-field"){ closeModal(); spGo("field", id); }
  else if(a==="sp-item"){ closeModal(); U.sp.from = b.dataset.from || (U.sp.view==="field"?U.sp.id:U.sp.from) || null; spGo("item", id); }
  else if(a==="sp-reveal"){ U.sp.reveal=true; renderPanel(); }
  else if(a==="sp-lab"){ const p=D.procs.find(x=>x.id===id); if(p){ U.tray={}; Object.keys(p.inp).forEach(k=>{ const n=Math.min(E.vflag(S,"free")?p.inp[k]:E.cnt(S,k), p.inp[k]); if(n>0) U.tray[k]=n; }); U.fac=p.at.find(f=>E.hasTool(S,f))||null; U.op=U.fac?p.op:null; U.last=null; setTab("lab"); } }
  else if(a==="sp-trial") trialOpen(id);
  else if(a.startsWith("sp-t-")) trialAct(a, id, b);
  else if(a==="sp-test") testOpen(id);
  else if(a.startsWith("sp-x-")) testAct(a, id);
  else if(a==="sp-install"){ const r=SPACE.install(S, id, S.seq); if(r.ok){ banner("🔧 機体に「"+r.module.name+"」を取りつけた（"+r.count+"/"+SPX.modules.length+"）"); afterChange([]); const p=SPACE.placedAt(S,"launchpad"); if(p && W3.gfx && W3.state==="ready"){ try{ W3.gfx.playVisualEffect("levelup",{x:p.x,z:p.z}); }catch(e){} } } else banner(r.msg); renderPanel(); }
  else if(a==="sp-wear") spWear();
  else if(a==="sp-board") spBoard();
  else if(a==="sp-unboard"){ SPACE.unboard(S); save(); renderPanel(); }
  else if(a==="sp-site"){ setTab("explore"); if(W3.state==="ready"){ goTo3D(SPX.site.x, SPX.site.z+6, null); banner("🧭 発射場の候補地「"+SPX.site.name+"」へ向かう"); } }
  else if(a==="sp-totower"){ const tw=SPACE.placedAt(S,"tower"); setTab("explore"); if(tw && W3.state==="ready"){ goTo3D(tw.x, tw.z+2.6, null); banner("🧭 支持塔へ向かう"); } }
  else if(a==="sp-launch") spLaunchConfirm();
  else if(a==="sp-go") spLaunchGo(+b.dataset.token);
  else if(a==="sp-skip") cineEnd();
  else if(a==="sp-resume"){ closeModal(); setTab("explore"); cineStart({first:!spS().clear, from:"sky"}); }
  else if(a==="sp-abort"){ SPACE.launchAbort(S); writeNow(); closeModal(); render(); banner("打ち上げ前に戻った（機体・設備・持ち物はそのまま）"); }
  else if(a==="sp-ending") endingOpen(false);
  else if(a==="sp-v") spVerifyAct(id);
});
document.addEventListener("change", ev=>{ const b=ev.target; if(b && b.dataset && (b.dataset.act==="sp-t-op" || b.dataset.act==="sp-t-n")) trialAct(b.dataset.act, b.dataset.id, b); });

spResumeCheck();
