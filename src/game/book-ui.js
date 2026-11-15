/* ===================== 図鑑の画面（ui.js のクロージャの中へビルドで差しこむ。判定・組み立ては book.js＝BOOK） =====================
   検索（名前・読み・分類・用途）→ 一覧 → 詳細。PC は一覧と詳細を左右に並べる。スマホは詳細へ切り替え、「戻る」で一覧の検索条件とスクロールの位置に戻る。
   詳細：説明・自然界での姿・入手方法（作り方の一覧。材料と数量・生成物・設備・道具・時間）・用途・科学・簡略化・出典・監修の状態・研究記録・原料までの逆引き。
   未発見は発見のきまりのまま（？？？）。学習用の「全部を見る」は進行（発見・持ち物・解放）とは別の閲覧の設定（S.flags.bookAll）。 */
U.book = U.book || {q:"", cat:"all", sel:null, scroll:0, n:1, stock:true, route:{}};
const BKC = D.book;
const bkAll = ()=> !!S.flags.bookAll;
const bkVis = id => BOOK.visibility(S, id, bkAll());
const bkName = id => bkVis(id)==="known" ? nm(id) : "？？？";
const bkIc = id => bkVis(id)==="known" ? ic(id) : "❔";
const bkEsc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* 専門の言葉には短い説明を添える（見出しで 1 回） */
const bkTerm = w => BKC.glossary[w] ? `${w}<small class="bk-gl">（${BKC.glossary[w]}）</small>` : w;
const BK_KIND = {gather:"🗺️ 採集", rare:"✨ 珍しい発見", lab:"🔬 研究室", craft:"🔨 工作", space:"🚀 宇宙計画の製作", build:"🏗️ 現地に建てる"};

function bookView(){
  const res = BOOK.search(S, U.book.q, U.book.cat, bkAll()), total = Object.keys(IT).length, got = Object.keys(IT).filter(k=>S.disc[k]).length;
  const cats = [{id:"all", name:"すべて", icon:"📚"}, ...BKC.cats, BKC.opCat];
  const detail = U.book.sel ? bookDetailHTML(U.book.sel, "pane") : `<p class="desc">左の一覧から選ぶと、ここに詳しい説明と作り方が出ます。</p>`;
  return `<div class="bk" data-sel="${U.book.sel?1:0}">
    <div class="bk-head">
      <label class="bk-search"><span class="bk-si">🔎</span><input id="bkq" type="search" inputmode="search" autocomplete="off" placeholder="名前・読み・分類・用途で探す" value="${bkEsc(U.book.q)}" aria-label="図鑑を検索"></label>
      <div class="bk-cats" role="group" aria-label="分類">${cats.map(c=>`<button class="btn small ${U.book.cat===c.id?"":"sub"}" data-act="bk-cat" data-id="${c.id}" aria-pressed="${U.book.cat===c.id}">${U.book.cat===c.id?"✓ ":""}${c.icon} ${c.name}</button>`).join("")}</div>
      <div class="bk-meta"><span>発見 ${got}／収録 ${total}</span>
        <label class="bk-all"><input type="checkbox" id="bkall" ${bkAll()?"checked":""}> 学習用：全部を見る <small>（ゲームの発見・持ち物・解放とは別の見え方。進み方は変わらない）</small></label></div>
    </div>
    <div class="bk-split">
      <div class="bk-list" id="bkList">${bookListHTML(res)}</div>
      <div class="bk-detail" id="bkDetail">${U.book.sel?`<button class="btn small sub bk-back" data-act="bk-back">← 一覧へ戻る</button>`:""}${detail}</div>
    </div></div>`;
}
function bookListHTML(res){
  if(U.book.cat==="op") return bookOpsHTML();
  if(!res.length) return `<p class="desc">見つからなかった。${bkAll()?"":"まだ発見していない物は、名前では探せない（分類で探すと ？？？ として出る）。"}</p>`;
  return `<p class="desc bk-count">${res.length} 件</p><div class="bk-items">${res.map(r=>{ const k = r.vis==="known", c = BOOK.catOf(r.id), rv = BOOK.reviewOf(r.id);
    return `<button class="bk-it ${k?"":"hint"} ${U.book.sel===r.id?"on":""}" data-act="bk-open" data-id="${r.id}" aria-pressed="${U.book.sel===r.id}">
      <span class="i">${k?ic(r.id):"❔"}</span><span class="n">${k?IT[r.id].name:"？？？"}<small>${k?bkEsc(IT[r.id].yomi)+"・":""}${c.name}${k?` ・監修：${rv.icon} ${rv.name}`:""}</small></span></button>`; }).join("")}</div>`;
}
function bookOpsHTML(){
  return `<div class="bk-items">${Object.keys(OPS).map(o=>{ const fs = Object.keys(IT).filter(f=>IT[f].facility && IT[f].ops.includes(o)), can = fs.some(f=>E.hasTool(S,f));
    return `<div class="card bk-op"><b>${opIc(o)} ${OPS[o].name}</b>（${OPS[o].yomi}）${can?" ✓ 使える":" ・まだ使えない"}<br>${OPS[o].kid}<br><small class="desc">使う装置：${fs.map(bkName).join("・")}</small></div>`; }).join("")}</div>`;
}

/* ---------- 詳細（図鑑の画面と、ほかの画面から開く案内の枠で同じ物を使う） ---------- */
function bookDetailHTML(id, mode){
  const it = IT[id]; if(!it) return "";
  const v = bkVis(id), c = BOOK.catOf(id);
  if(v!=="known") return `<div class="hd"><span class="bigi" style="filter:grayscale(1);opacity:.5">❔</span><div><h2>？？？</h2><div class="yomi">分類：${c.name}</div></div></div>
    <div class="kidbox">🦉 ${v==="hinted"?"ヒント：":""}${E.hint(S,id)}</div>`;
  const e = BOOK.entry(S, id), r = S.disc[id], rv = e.review;
  const waiting = "<span class=\"bk-wait\">原稿待ち</span>";
  const obtain = e.obtain.map(o=>bookRecipeHTML(id, o)).join("");
  const uses = {input:[], tool:[], facility:[]}; e.uses.forEach(u=>u.outputs.forEach(x=>{ if(!uses[u.role].includes(x)) uses[u.role].push(x); }));
  const usesHTML = ["input","tool","facility"].filter(k=>uses[k].length).map(k=>`<li><b>${({input:"材料として",tool:"道具として",facility:"設備として"})[k]}：</b>${uses[k].map(x=>`<button class="lnk" data-act="bk-open" data-id="${x}">${bkIc(x)} ${bkName(x)}</button>`).join(" ")}</li>`).join("");
  const builds = e.uses.filter(u=>u.kind==="build").map(u=>u.buildingName);
  return `<div class="hd"><span class="bigi">${ic(id)}</span><div><h2>${it.name}</h2><div class="yomi">${bkEsc(it.yomi)}${it.en?"・"+bkEsc(it.en):""}・分類：${c.name}</div>
      <div class="bk-badges"><span class="bk-rv ${rv.status}">${bkTerm("監修")}：${rv.icon} ${rv.name}</span>${e.natural?`<span class="bk-badge">🌿 自然から採れる</span>`:""}</div></div></div>
    <div class="kidbox">${it.kid}</div>
    <h5>🌍 自然界では</h5><p class="bk-p">${e.nature ? bkEsc(e.nature) : e.natural ? waiting : "自然の中にはそのままの形ではほとんどない（作り方は下）。"}</p>
    <h5>🧭 入手方法 <small>（${bkTerm("製法")}が何通りかある物は、どれでも作れる）</small></h5>${obtain || `<p class="bk-p">登録された入手方法がない。</p>`}
    <h5>🔗 主な用途</h5>${usesHTML?`<ul class="bk-ul">${usesHTML}</ul>`:""}${builds.length?`<p class="bk-p">建物の資材：${builds.map(bkEsc).join("・")}</p>`:""}${e.usesText?`<p class="bk-p"><small>図鑑の文：${bkEsc(e.usesText)}</small></p>`:""}${!usesHTML&&!builds.length&&!e.usesText?`<p class="bk-p">今のところなし</p>`:""}
    <h5>🔬 現実の科学</h5><p class="bk-p">${e.principle?bkEsc(e.principle)+"<br>":""}${bkEsc(it.more)}</p>
    <dl class="kv">${e.formula?`<dt>${bkTerm("化学式")}</dt><dd>${bkEsc(e.formula)}</dd>`:""}${e.elements.length?`<dt>${bkTerm("元素")}</dt><dd>${e.elements.join(" ")}</dd>`:""}
      ${e.mp?`<dt>${bkTerm("融点")}</dt><dd>${bkEsc(e.mp)}</dd>`:""}${e.bp?`<dt>${bkTerm("沸点")}</dt><dd>${bkEsc(e.bp)}</dd>`:""}</dl>
    <h5>🎮 ゲーム上の${bkTerm("簡略化")}</h5><p class="bk-p">${e.simplification?bkEsc(e.simplification):waiting}</p>
    <h5>📎 出典と確認日</h5><p class="bk-p">${e.sources.urls.length?e.sources.urls.map(u=>`<a href="${bkEsc(u)}" target="_blank" rel="noopener noreferrer">${bkEsc(u.replace(/^https?:\/\//,"").slice(0,48))}</a>`).join("<br>")+`<br><small>記載日：${e.sources.checkedOn||"未記録"}${e.sources.note?"・"+bkEsc(e.sources.note):""}</small>`:"出典：未登録（原稿待ち）"}</p>
    <p class="bk-p"><small>監修：${rv.icon} ${rv.name}${rv.on?"（"+bkEsc(rv.on)+"）":""}${rv.status!=="checked"?"。説明は監修前の原稿。":""}</small></p>
    ${r?`<h5>📓 あなたの研究記録</h5><dl class="kv"><dt>初発見</dt><dd>${new Date(r.first).toLocaleString("ja-JP")}</dd><dt>作った・拾った回数</dt><dd>${r.made}回（合計${r.total}個）</dd>
      ${it.store===false?`<dt>保管</dt><dd>気体なので集められない（記録のみ）</dd>`:`<dt>今持っている</dt><dd>${E.cnt(S,id)}個</dd>`}</dl>`:""}
    ${typeof procNeedsHTML==="function"?procNeedsHTML(id):""}
    <div class="bk-treewrap">${bookTreeHTML(id)}</div>
    <div class="row mt"><button class="btn small sub" data-act="target" data-id="${id}">🕸️ 技術マップで見る</button></div>`;
}
/* 作り方 1 つ：材料と数量・生成物（副産物）・設備と道具（使えるか）・時間・理由。下に、その作業をする画面への入口 */
function bookRecipeHTML(id, o){
  const amt = m => Object.entries(m).map(([k,q])=>`${bkIc(k)} ${bkName(k)} ×${q}`).join("・");
  const outs = Object.entries(o.outputs).map(([k,q])=>`${bkIc(k)} ${bkName(k)} ×${q}${k!==id?` <small>(${bkTerm("副産物")})</small>`:""}`).join("・");
  const st = f => { const s = BOOK.facilityState(S, f); return `<span class="${s.ok?"ok":"ng"}">${s.ok?"✓":"✕"} ${bkName(f)}：${s.label}</span>`; };
  const time = o.kind==="build" ? `施工 ${o.time} 秒（${o.stages.length} 工程）` : o.time ? `${o.time} 秒／回` : o.kind==="gather"||o.kind==="rare" ? "" : "すぐ";
  let head = BK_KIND[o.kind]||o.kind, go = "";
  if(o.kind==="gather"){ head += `：${bkEsc(o.regionName)}`; go = `<button class="btn small sub" data-act="bk-travel" data-id="${o.region}">${bkEsc(o.regionName)}へ行く</button>`; }
  if(o.kind==="rare"){ head += `：${bkEsc(o.regionName)}（たまに見つかる）`; }
  if(o.kind==="lab"){ head += `：${opIc(o.op)}${bkEsc(o.opName)}`; go = `<button class="btn small sub" data-act="bk-go" data-id="lab">研究室へ</button>`; }
  if(o.kind==="craft") go = `<button class="btn small sub" data-act="bk-go" data-id="craft">工作へ</button>`;
  if(o.kind==="space") go = `<button class="btn small sub" data-act="bk-go" data-id="space" data-item="${id}">宇宙計画の製作へ</button>`;
  if(o.kind==="build"){ const site = typeof consSiteOf==="function" ? consSiteOf(id) : null; head += `：${bkEsc(o.buildingName)}`;
    go = site ? `<button class="btn small sub" data-act="cs-open" data-id="${site.id}">現場を開く（${consSiteLabel(site)}）</button>` : `<button class="btn small sub" data-act="cs-place" data-id="${o.building}">建設する</button>`; }
  const need = o.kind==="gather" && o.need.length ? `<div>道具：${o.need.map(t=>`<span class="${E.hasTool(S,t)?"ok":"ng"}">${E.hasTool(S,t)?"✓":"✕"} ${bkName(t)}</span>`).join(" か ")}</div>` : "";
  return `<div class="card bk-rec"><b>${head}</b>${time?` <small class="desc">${time}</small>`:""}
    ${Object.keys(o.inputs).length?`<div>材料（${bkTerm("消費")}）：${amt(o.inputs)}</div>`:""}
    <div>できる物：${outs}</div>
    ${o.at.length?`<div>設備（${o.atAny?"どれか 1 つ":"必要"}）：${o.at.map(st).join(" ")}</div>`:""}
    ${o.tools.length && o.kind!=="gather"?`<div>道具（なくならない）：${o.tools.map(st).join(" ")}</div>`:""}${need}
    ${o.lesson?`<div>実習：${bkEsc(o.lesson)}</div>`:""}
    ${o.why||o.how?`<div class="desc">${bkEsc(o.why||o.how)}</div>`:""}
    ${go?`<div class="row">${go}</div>`:""}</div>`;
}
/* 原料までの逆引き：作る数・在庫を引くか・ノードごとの製法の選択。合計（天然の原料・要る道具と設備） */
function bookTreeHTML(id){
  const n = Math.max(1, Math.min(999, U.book.n|0||1)), t = BOOK.expand(S, id, n, U.book.route, {useStock:U.book.stock, all:bkAll()}), T = BOOK.totals(t);
  const node = (x, depth) => {
    const nameH = `${bkIc(x.id)} ${bkName(x.id)}`, st = x.short>0 ? `<span class="ng">✕ 不足 ${x.short}</span>` : `<span class="ok">✓ 足りる</span>`;
    const opts = x.options.length>1 ? `<select class="bk-route" data-id="${x.id}" aria-label="${bkName(x.id)}の製法">${x.options.map(o=>`<option value="${o.key}" ${o.key===x.choice?"selected":""}>${BK_KIND[o.kind]||o.kind}${o.kind==="lab"||o.kind==="craft"||o.kind==="space"?"："+bkEsc(bookOptLabel(x.id,o.key)):""}</option>`).join("")}</select>` : "";
    const leaf = x.leaf==="cycle" ? `<span class="bk-note">↺ 循環（同じ物にもどるので、ここで止める）</span>` : x.leaf==="gather" ? `<span class="bk-note">🗺️ 採る（${bkEsc(x.recipe.regionName)}）</span>` : x.leaf==="rare" ? `<span class="bk-note">✨ たまに見つかる</span>` : x.leaf==="none" ? `<span class="bk-note">入手方法なし</span>` : x.leaf==="depth" ? `<span class="bk-note">…（深いので省略）</span>` : "";
    const meta = [x.runs?`${x.runs} 回作る${x.recipe&&x.recipe.outputs[x.id]>1?`（1 回で ${x.recipe.outputs[x.id]} 個）`:""}`:"", Object.keys(x.byproducts).length?`${bkTerm("副産物")}：`+Object.entries(x.byproducts).map(([k,q])=>bkName(k)+"×"+q).join("・"):"", x.surplus?`余り ${x.surplus}`:"",
      x.at.length?"設備："+x.at.map(f=>`<span class="${f.ok?"ok":"ng"}">${f.ok?"✓":"✕"}${bkName(f.id)}（${f.label}）</span>`).join(x.atAny?" か ":" "):"",
      x.tools.length?"道具："+x.tools.map(f=>`<span class="${f.ok?"ok":"ng"}">${f.ok?"✓":"✕"}${bkName(f.id)}</span>`).join(x.toolsAny?" か ":" "):""].filter(Boolean).join(" ／ ");
    const kids = x.children.map(k=>node(k, depth+1)).join("");
    const body = `<span class="bk-nd">${nameH} <b>×${x.need}</b> <small>（在庫 ${x.have}）</small> ${st}</span> ${opts} ${leaf}${meta?`<div class="bk-meta2">${meta}</div>`:""}`;
    return kids ? `<li><details ${depth<1?"open":""}><summary>${body}</summary><ul>${kids}</ul></details></li>` : `<li>${body}</li>`; };
  const raw = Object.entries(T.raw);
  return `<h5>🧪 ${bkTerm("原料")}までたどる</h5>
    <div class="row bk-ctl"><label>作る数 <input id="bkn" type="number" min="1" max="999" value="${n}"></label><label><input type="checkbox" id="bkstock" ${U.book.stock?"checked":""}> 在庫を引いた残りだけ作る</label></div>
    <p class="desc">数は、選んだ製法での必要量（1 回の出来上がりの数で割って切り上げ）。製法を変えると必要量も変わる。道具・設備は使ってもなくならないので数えない。</p>
    <div class="bk-tree"><ul>${node(t,0)}</ul></div>
    <div class="card"><b>合計：自然から採る原料</b><div class="need">${raw.length?raw.map(([k,q])=>`<span class="${E.cnt(S,k)>=q?"ok":"ng"}">${bkIc(k)} ${bkName(k)} ${E.cnt(S,k)}/${q}</span>`).join(""):"<span>（在庫で足りる）</span>"}</div>
      ${T.at.length||T.tools.length?`<div class="need">${T.at.concat(T.tools).map(f=>`<span class="${f.ok?"ok":"ng"}">${f.ok?"✓":"✕"} ${bkName(f.id)}：${f.label||""}</span>`).join("")}</div>`:""}
      ${T.cycles.length?`<p class="desc">↺ 循環して止めた所：${T.cycles.map(bkName).join("・")}</p>`:""}</div>`;
}
function bookOptLabel(id, key){ const o = BOOK.options(S, id).find(x=>x.key===key); if(!o) return key; return Object.keys(o.inputs).map(bkName).join("＋") || key; }

/* ---------- 操作 ---------- */
function bookRenderList(){ const el = $("#bkList"); if(el) el.innerHTML = bookListHTML(BOOK.search(S, U.book.q, U.book.cat, bkAll())); }
function bookRenderDetail(){ const el = $("#bkDetail"); if(!el){ renderPanel(); return; } el.innerHTML = (U.book.sel?`<button class="btn small sub bk-back" data-act="bk-back">← 一覧へ戻る</button>`:"") + (U.book.sel ? bookDetailHTML(U.book.sel, "pane") : ""); el.scrollTop = 0;
  const bk = document.querySelector(".bk"); if(bk) bk.dataset.sel = U.book.sel ? 1 : 0; }
const bkListScroller = ()=> uiMode()==="pc" ? $("#bkList") : $("#dockBody");
document.addEventListener("click", ev=>{ const b = ev.target.closest && ev.target.closest("[data-act^='bk-']"); if(!b) return; ev.preventDefault();
  const a = b.dataset.act, id = b.dataset.id;
  if(a==="bk-cat"){ U.book.cat = id; renderPanel(); return; }
  if(a==="bk-open"){ if(U.tab!=="book"){ closeModal(); U.book.sel = id; setTab("book"); return; }
    if(!U.book.sel){ const sc = bkListScroller(); U.book.scroll = sc ? sc.scrollTop : 0; }
    U.book.sel = id; if(uiMode()==="pc"){ bookRenderDetail(); document.querySelectorAll(".bk-it").forEach(x=>{ const on = x.dataset.id===id; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); }); }
    else { renderPanel(); const d = $("#dockBody"); if(d) d.scrollTop = 0; } return; }
  if(a==="bk-back"){ bookBack(); return; }
  if(a==="bk-travel"){ const r = D.regions.find(x=>x.id===id); if(!r) return; closeModal(); setTab("explore"); if(W3.state==="ready"){ goTo3D(r.w.x, r.w.z+REGION_R*0.2, null); banner(r.icon+" "+r.name+"へ向かう"); } return; }
  if(a==="bk-go"){ closeModal(); if(id==="space" && typeof spaceUI==="function"){ const u = spaceUI(); u.section = "製作"; if(b.dataset.item){ u.item = b.dataset.item; if(IT[b.dataset.item].group) u.group = IT[b.dataset.item].group; } } setTab(id); return; }
});
document.addEventListener("input", ev=>{ if(ev.target.id==="bkq"){ U.book.q = ev.target.value; bookRenderList(); } });
document.addEventListener("change", ev=>{ const t = ev.target;
  if(t.id==="bkall"){ S.flags.bookAll = t.checked; save(); renderPanel(); return; }
  if(t.id==="bkn"){ U.book.n = Math.max(1, Math.min(999, parseInt(t.value,10)||1)); bookRerenderTree(); return; }
  if(t.id==="bkstock"){ U.book.stock = t.checked; bookRerenderTree(); return; }
  if(t.classList && t.classList.contains("bk-route")){ U.book.route[t.dataset.id] = t.value; bookRerenderTree(); return; } });
/* 逆引きだけを描き直す（どこで開いていても：図鑑の詳細・案内の枠） */
function bookRerenderTree(){ const host = (U.tab==="book" && $("#bkDetail")) || $("#sheet"); const id = U.tab==="book" && U.book.sel ? U.book.sel : U.book.modal; if(!host || !id) return;
  const keep = host.scrollTop, old = host.querySelector(".bk-treewrap"); if(old) old.innerHTML = bookTreeHTML(id); host.scrollTop = keep; }
/* ほかの画面（工作・研究室・通知など）から開く案内の枠：図鑑の詳細と同じ中身 */
function bookOpenModal(id){ U.book.modal = id; const sh = $("#sheet");
  sh.innerHTML = `<button class="close" data-act="close">閉じる</button>${bookDetailHTML(id, "modal")}${bkVis(id)==="known"?`<div class="row mt"><button class="btn small" data-act="bk-open" data-id="${id}">📖 図鑑で開く</button></div>`:""}`;
  sh.scrollTop = 0; openModal(sh.querySelector(".close")); }
/* 一覧へ戻る：検索条件・分類・スクロールの位置をそのまま。開いていた項目へ焦点を戻す */
function bookBack(){ const was = U.book.sel; U.book.sel = null; renderPanel(); const sc = bkListScroller(); if(sc) sc.scrollTop = U.book.scroll || 0;
  const b = was && document.querySelector(`#bkList .bk-it[data-id="${was}"]`); if(b) b.focus({preventScroll:true}); }
/* スマホの詳細で Escape：まず一覧へ戻る（パネルを閉じるのは次の Escape） */
document.addEventListener("keydown", ev=>{ if(ev.key!=="Escape" || U.tab!=="book" || !U.book.sel || modalOpen() || uiMode()==="pc") return;
  ev.preventDefault(); ev.stopImmediatePropagation(); bookBack(); }, true);
