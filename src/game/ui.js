/* ===================== 画面（UI） ===================== */
(function(D,E){
const IT=D.items, OPS=D.ops;
const SAVE_KEY="zero-kagaku-save";
/* 検証モード（全解放）：通常のセーブ（SAVE_KEY）とは別のキーに保存し、通常のセーブには書き込まない。
   どちらで始めるか：URL の ?verify=1 / ?verify=0 → 最後に選んだモード（MODE_KEY）→ ビルドの既定（dist/verify.html は検証モード） */
const VERIFY_KEY="zero-kagaku-verify", MODE_KEY="zero-kagaku-mode";
let VERIFY = (()=>{ try{ const q=new URLSearchParams(location.search).get("verify");
    if(q==="1"||q==="0"){ localStorage.setItem(MODE_KEY, q==="1"?"verify":"normal"); return q==="1"; }
    const m=localStorage.getItem(MODE_KEY); if(m) return m==="verify"; }catch(e){} return !!window.VERIFY_DEFAULT; })();
const curKey = ()=> VERIFY ? VERIFY_KEY : SAVE_KEY;
let SWITCHING = false;   // モードを切り替えている間は保存しない（古い状態で上書きしないため）
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
let S = load(); if(S && S.cons && !S.cons.rule) S.cons.rule = "build";   /* UI の新しいゲームは「建てて作る」ルール（エンジン単体のテストは以前の工作） */
const U = {tab:"explore", opener:null, dockTab:null, missionOpen:false, tray:{}, fac:null, op:null, busy:false, filter:"すべて", target:null, last:null,
           region:"forest", nodes:{}, combo:0, lastGather:0, walking:false};
const $ = s=>document.querySelector(s);
const nm = id=>IT[id]?IT[id].name:id;
/* 物質アイコン（Muse の assets/item-icons から作った 64px アトラス。ないもの・道具・設備は絵文字） */
/* アイコンのアトラス（Muse の原本から作った 64px 版）。画像は blob URL にして CSS 変数で配る。
   物質：assets/item-icons（キーは ID）。道具・設備・操作：assets/buildings-icons（キーは「tools/ID」「facilities/ID」「ops/ID」） */
function makeAtlas(a, v){ if(!a || !a.src) return null;
  let url = a.src;
  try{ const b = atob(a.src.slice(a.src.indexOf(",")+1)), u = new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); url = URL.createObjectURL(new Blob([u],{type:"image/webp"})); }catch(e){}
  const r=document.documentElement.style; r.setProperty("--"+v, `url("${url}")`); r.setProperty("--"+v+"-c", a.cols); r.setProperty("--"+v+"-r", a.rows);
  return {url, cols:a.cols, rows:a.rows, pos:a.pos||{}}; }
const ITEM_ICO = makeAtlas(window.ASSETS && ASSETS.items, "iat");
const SPACE_ICO = makeAtlas(window.ASSETS && ASSETS.spaceIcons, "sp-atlas");
const TOOL_ICO = makeAtlas(window.ASSETS && ASSETS.tools, "tat");
/* 道具・設備のアイコンの位置（新しい62点を優先）。なければ null */
const toolKey = id=> IT[id] ? (IT[id].tags.includes("研究設備") ? "facilities/"+id : IT[id].tags.includes("道具") ? "tools/"+id : null) : null;
function icoPos(id){ if(SPACE_ICO?.pos[id])return {a:SPACE_ICO,p:SPACE_ICO.pos[id],cls:"sic"};const k=toolKey(id); if(k && TOOL_ICO && TOOL_ICO.pos[k]) return {a:TOOL_ICO, p:TOOL_ICO.pos[k], cls:"tic"};
  const p = ITEM_ICO && ITEM_ICO.pos[id]; return p ? {a:ITEM_ICO, p, cls:"iic"} : null; }
const icT = id=>IT[id]?IT[id].icon:"❔";   // 文字だけの場所（バナー・選択肢・SVGの代替）
const ic = id=>{ const q = icoPos(id); return q ? `<span class="${q.cls}" style="--c:${q.p[0]};--r:${q.p[1]}" aria-hidden="true"></span>` : icT(id); };
/* 実験の操作（加熱・ろ過など）のアイコン。なければ絵文字 */
const opIc = o=>{ const p = TOOL_ICO && TOOL_ICO.pos["ops/"+o]; return p ? `<span class="tic" style="--c:${p[0]};--r:${p[1]}" aria-hidden="true"></span>` : (OPS[o] ? OPS[o].icon : ""); };
const svgIc = (id, x, y, sz)=>{ const q = icoPos(id), p = q && q.p;
  return p ? `<svg x="${x}" y="${y}" width="${sz}" height="${sz}" viewBox="${p[0]*64} ${p[1]*64} 64 64" aria-hidden="true"><image href="${q.a.url}" width="${q.a.cols*64}" height="${q.a.rows*64}"/></svg>`
           : `<text text-anchor="middle" x="${x+sz/2}" y="${y+sz*0.78}" font-size="${sz*0.75}">${icT(id)}</text>`; };
const isMat = id=>IT[id] && !IT[id].tags.includes("道具") && !IT[id].tags.includes("研究設備");
const owned = id=>E.hasFacility(S,id);   /* 持ち物（以前の方式）か、完成した建物（街づくり） */
const stage = ()=>E.stageOf(S);
/* 地図・2D表示の文明の痕跡は、段階（stage）ではなく、プレイヤーが作った設備（owned）から決める。3D の STRUCT_PLAN と同じ対応 */
const placedSet = ()=> new Set((S.verify && S.verify.placed) || []);
const CIV = ()=> S.verify ? (p=>({fire:p.has("st-fire"), bench:p.has("st-bench"), kiln:p.has("st-kiln"), hut:p.has("st-hut1"), smelt:p.has("st-smelter"),
  mill:p.has("st-smelter"), rail:p.has("st-steam"), power:p.has("st-power"), factory:p.has("st-factory"), inst:p.has("st-inst"),
  wheel:p.has("st-wheel"), rig:p.has("st-rig"), lights:p.has("st-power")}))(placedSet()) : ({fire:owned("campfire"), bench:owned("bench"), kiln:owned("kiln"), hut:owned("storehouse"), smelt:owned("furnace")||owned("blastfurnace"),
  mill:owned("blastfurnace"), rail:owned("steamengine"), power:owned("generator"), factory:owned("eaf"), inst:owned("reactor"),
  wheel:owned("waterwheel"), rig:owned("rig"), lights:!!S.disc.bulb && owned("generator")});
const civSig = ()=>Object.values(CIV()).map(v=>v?1:0).join("");

/* ---------- 保存 ---------- */
function readKey(k){ try{ const t = localStorage.getItem(k); if(t){
    /* 形式が古いセーブは、移行する前に元のまま別のキーへ控える（一度だけ。戻したいときに使える） */
    try{ const v = JSON.parse(t).v; if(typeof v==="number" && v < E.SCHEMA){ const bk = k+"-backup-v"+v; if(!localStorage.getItem(bk)) localStorage.setItem(bk, t); } }catch(e){}
    return E.deserialize(t); } }catch(e){} return null; }
function load(){
  const s = readKey(curKey());
  if(VERIFY) return s && s.verify ? s : E.makeVerifyState();
  if(s && s.verify) delete s.verify;      // 念のため：通常のセーブに検証の設定を持ち込まない
  return s || E.newState();
}
let saveTimer=null;
function writeNow(){ if(SWITCHING) return; try{ localStorage.setItem(curKey(),E.serialize(S)); }catch(e){} }
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(writeNow,250); }
document.addEventListener("visibilitychange",()=>{ if(document.hidden){ clearTimeout(saveTimer); writeNow(); } });

/* ---------- 通知 ---------- */
function toast(id, kind){
  const box = $("#toasts"); const el = document.createElement("div"); el.className="toast"+(kind?" small":"");
  if(kind==="mission") el.innerHTML=`<div class="i">🦉</div><div><div class="k">目標達成！</div><div class="nm">${id}</div></div>`;
  else if(kind==="stage") el.innerHTML=`<div class="i">🏙️</div><div><div class="k">文明が進化した！</div><div class="nm">${id}</div><p>研究室の見た目が変わったよ。設備を作ると、拠点に建物が増えていくよ。</p></div>`;
  else { const it=IT[id]; el.innerHTML=`<div class="i">${ic(id)}</div><div><div class="k">${it.tags.includes("珍しい発見")?"珍しい発見！":"新発見！"} 図鑑に登録したよ</div><div class="nm">${it.name}</div><p>${it.kid}</p></div>`; el.onclick=()=>{ openItem(id); el.remove(); }; }
  box.prepend(el); const maxN = uiMode()==="touch" ? 2 : 3; while(box.children.length>maxN) box.lastChild.remove();
  setTimeout(()=>el.remove(), kind?4000:6500);
}
let lastMission = E.missionIndex(S), lastStage = stage();
function afterChange(news){
  (news||[]).forEach(id=>toast(id));
  const m = E.missionIndex(S);
  if(m>lastMission){ toast(D.missions[m-1].t,"mission"); lastMission=m; }
  const st = stage();
  if(st>lastStage){ toast(D.stages[st].era+"「"+D.stages[st].name+"」","stage"); lastStage=st; fieldSig=""; sceneSig=""; }
  if(W3.state==="ready") syncStructures();
  save(); renderChrome();
}

/* ---------- 共通 ---------- */
/* 探索フィールドがホーム。ほかの画面は下部タブから「パネル」として上に重ねて開く。
   U.tab==="explore" はパネルが閉じている状態を表す。フィールドのDOMと3D描画は保ったまま。 */
const TABS = {explore:"探索", lab:"研究室", craft:"工作", book:"図鑑", map:"技術マップ", log:"記録",
  world:"地図・地域", menu:"メニュー", settings:"設定・ヘルプ", verify:"検証モード", build:"建築", space:"宇宙へ"};
/* パネルの見出しのアイコン（Muse の UI アイコン。ないものは絵文字。必ず文字と組み合わせる。2026-11-11） */
const TAB_ICON = {lab:"lab", craft:"craft", book:"book", map:"tech", log:"log", world:"map", menu:"menu", settings:"settings", build:"home"};
/* パネルの大きさ。PC：右側のパネル（side）か大きなオーバーレイ（wide）。スマホ：下からのシート（sheet）か全高近く（tall） */
/* 2026-11-11：PC の研究室は、探索のマップを左に見せたまま右側の広いパネル（side-l）で、材料・操作と実験台を並べる。図鑑・技術は大きなオーバーレイ */
const PC_SIZE = {space:"wide",book:"wide", map:"wide", lab:"side-l"};
const TOUCH_SIZE = {space:"tall",lab:"tall", craft:"tall", book:"tall", map:"tall", log:"tall", verify:"tall", build:"tall"};
const MENU_TABS = ["space","menu","book","map","log","settings","verify","build"];   /* スマホでは「メニュー」の中にある画面 */
/* 画面幅だけでなく入力方法（タッチかマウスか）も見て、PC用とスマホ用の配置を切り替える */
const MQ_COARSE = matchMedia("(pointer:coarse)");
const uiMode = ()=>{ const a=$("#app"); return a ? a.dataset.ui : "pc"; };
function detectUi(){
  const short = Math.min(innerWidth, innerHeight);
  return (MQ_COARSE.matches && short < 820) || innerWidth < 600 ? "touch" : "pc";
}
function applyUiMode(){
  const app=$("#app"), m=detectUi();
  document.documentElement.dataset.ui=m;
  if(app.dataset.ui!==m){ app.dataset.ui=m; haltField(); renderChrome(); if(U.tab!=="explore") renderPanel(); updateAction3D(); updateFieldActivity(); }
  layout();
}
/* UIアイコン（Muse 仕上げの assets/ui-icons）。タブ・メニューは 48px 版、右上の小さなボタンは 32px 版。
   画像がない名前（メニュー）は絵文字。どれも必ず文字ラベルと組み合わせる */
const ICON_EMOJI = {lab:"🧪", craft:"🔨", book:"📖", tech:"🕸️", log:"📓", map:"🗺️", home:"🏠", settings:"⚙️", menu:"☰"};
/* 2026-11-12：Muse ラウンド28 の線のアイコン（ASSETS.iconsLine）を優先。生成り（ico-c：濃紺の帯・HUD の上）と青緑（ico-t：選択中・紙の上）の2枚を出し、CSS で切り替える */
function iconHTML(name, small){
  const ln = window.ASSETS && ASSETS.iconsLine && ASSETS.iconsLine[name];
  if(ln) return `<img class="ico line ico-c" src="${ln.c}" alt="" aria-hidden="true"><img class="ico line ico-t" src="${ln.t}" alt="" aria-hidden="true">`;
  const box = window.ASSETS && (small ? ASSETS.icons32 : ASSETS.icons), src = box && box[name];
  return src ? `<img class="ico" src="${src}" alt="" aria-hidden="true">` : `<span class="ico emo" aria-hidden="true">${ICON_EMOJI[name]||""}</span>`; }
/* 状態の印（未発見・加工できない・材料不足・選択中）を CSS 変数へ（::before の画像。文字の印も残す） */
(function stateIconVars(){ const st = window.ASSETS && ASSETS.stateIcons; if(!st) return; const r=document.documentElement.style;
  for(const k of Object.keys(st)) for(const c of Object.keys(st[k])) r.setProperty(`--st-${k}-${c}`, `url("${st[k][c]}")`); })();
function applyIcons(){ document.querySelectorAll("[data-icon]").forEach(el=>{ el.querySelectorAll(".ico").forEach((sp,i)=>{ if(i) sp.remove(); else sp.outerHTML = iconHTML(el.dataset.icon, el.classList.contains("hbtn")); }); }); }
function renderChrome(){
  const i = E.missionIndex(S), m = D.missions[i], touch = uiMode()==="touch";
  const vb=$("#vbadge"); if(vb) vb.hidden = !VERIFY;
  updateLoc();
  document.querySelectorAll("#nav [data-tab],.hud-tr [data-tab]").forEach(b=>{
    const t=b.dataset.tab, on = t===U.tab || (t==="menu" && touch && MENU_TABS.includes(U.tab));
    if(b.closest("#nav")) b.setAttribute("aria-current", on?"page":"false");
    b.setAttribute("aria-expanded", on?"true":"false"); });
  $("#mission").innerHTML = `<details class="mission" id="missionBox" ${U.missionOpen?"open":""}><summary title="目標の詳細を開く・閉じる"><span class="owl" aria-hidden="true">🦉</span>
    <span class="mtx"><span class="lab">目標 ${i+1}/${D.missions.length}</span><span class="t">${m.t}</span></span><span class="more" aria-hidden="true"></span></summary>
    <div class="how">${m.how}</div>
    ${m.tab!=="explore" && U.tab!==m.tab?`<button class="btn small sub go" data-act="tab" data-tab="${m.tab}">${TABS[m.tab]}を開く</button>`:""}</details>`;
  $("#mission").insertAdjacentHTML("beforeend", `<button class="btn small" data-act="tab" data-tab="space">宇宙へ — 最終目標</button>`);
  if(U.space?.overview)$("#mission").insertAdjacentHTML("beforeend",`<button class="btn small" data-sp="exit-overview">見学を終える</button>`);
  layout();
}
document.addEventListener("toggle", e=>{ if(e.target.id==="missionBox"){ U.missionOpen=e.target.open; } }, true);
/* 下部ナビが実際に占める高さを CSS 変数へ（スティック・採取ボタン・パネルをその上に置く） */
function layout(){
  const app=$("#app"), n=$("#nav"); if(!app || !n) return;
  const a=app.getBoundingClientRect(), r=n.getBoundingClientRect();
  app.style.setProperty("--navh", Math.max(0, Math.round(a.bottom - r.top))+"px");
  /* HUD に隠れない範囲を描画モジュールへ伝える（公開API setViewportInsets がある場合だけ） */
  /* カメラの高さを固定しているときは、カメラ（camFrame）がずらしと合わせて渡す。それ以外はここで渡す */
  if(typeof W3!=="undefined"){ W3.camHudIns = hudInsets(); if(W3.gfx && typeof W3.gfx.setViewportInsets==="function"){ try{ W3.gfx.setViewportInsets(W3.camHudIns); }catch(e){} } }
}
function hudInsets(){
  const app=$("#app"), tl=$(".hud-tl"), n=$("#nav"); if(!app||!tl||!n) return {top:0,bottom:0,left:0,right:0};
  const a=app.getBoundingClientRect(), cs=getComputedStyle(app);
  let bottomTop = n.getBoundingClientRect().top;
  if(app.dataset.ui==="touch") ["#joy","#w3act"].forEach(sel=>{ const e=$(sel); if(e && !e.hidden && e.offsetParent!==null){ const r=e.getBoundingClientRect(); if(r.height>0) bottomTop=Math.min(bottomTop, r.top); } });
  const px = v=>parseFloat(v)||0;
  return {top: Math.round(tl.getBoundingClientRect().bottom - a.top), bottom: Math.round(a.bottom - bottomTop),
          left: Math.round(px(cs.getPropertyValue("--sal"))), right: Math.round(px(cs.getPropertyValue("--sar")))};
}
addEventListener("resize", ()=>applyUiMode());
if(window.visualViewport) visualViewport.addEventListener("resize", layout);
MQ_COARSE.addEventListener("change", ()=>applyUiMode());
/* 画面の回転では、移動を止める */
matchMedia("(orientation: portrait)").addEventListener("change", ()=>{ haltField(); applyUiMode(); });
/* 指で触ったら、PC配置でもスティックを出す（タッチ対応のノートPCなど） */
document.addEventListener("pointerdown", e=>{ if(e.pointerType==="touch") $("#app").classList.add("touched"); clearStraySelection(e.target); }, true);
/* ---------- 文字選択・画像ドラッグ・長押しメニューの抑止（CSS の user-select / touch-callout の補助） ----------
   編集できる入力欄（読み込み・書き出し欄、選択肢）の中では何もしない。タッチの標準動作（スクロール・クリック）には触れない */
const EDITABLE = "input,textarea,select,[contenteditable],[contenteditable] *,[role=textbox]";
const inEditable = t => !!(t && t.closest && t.closest(EDITABLE));
const elOf = n => n && (n.nodeType===1 ? n : n.parentElement);
["selectstart","dragstart","contextmenu"].forEach(type=>document.addEventListener(type, e=>{ if(!inEditable(elOf(e.target)) && e.cancelable) e.preventDefault(); }));
/* 操作を始めたときだけ、ゲームの表示に残った選択範囲を消す（毎フレームは見ない。入力欄の中の選択は消さない） */
function clearStraySelection(target){
  if(inEditable(elOf(target)) || inEditable(document.activeElement)) return;
  const sel = window.getSelection && window.getSelection(); if(!sel || !sel.rangeCount || sel.isCollapsed) return;
  if(!inEditable(elOf(sel.anchorNode))) sel.removeAllRanges();
}
function setTab(t, opener){
  if(SPACE.locked(S))t="space";
  if(!TABS[t]) t="explore";
  const was = U.tab;
  if(t===was){
    /* 開いている画面のボタンをもう一度押したら閉じる */
    if(t!=="explore" && opener && opener.dataset && opener.dataset.tab===t && !opener.dataset.act) t="explore";
    else { if(t!=="explore") renderPanel(); return; }
  }
  U.tab = t;
  if(was==="explore") U.opener = opener || document.activeElement;
  if(t!=="explore") haltField();
  renderChrome(); renderPanel(); updateFieldActivity();
  if(t!=="explore" && was==="explore"){ const h=$("#dockTitle"); if(h) h.focus({preventScroll:true}); }
  if(t==="explore"){ const o=U.opener; U.opener=null;
    const back = o && o.isConnected && !o.closest("[inert],[hidden]") && o.offsetParent!==null ? o : null;
    if(back) back.focus({preventScroll:true}); else if(document.activeElement && $("#dock").contains(document.activeElement)) document.activeElement.blur(); }
}
function render(){ renderField(); renderPanel(); }
function renderField(){ renderExplore($("#view")); }
function renderPanel(){
  const dock=$("#dock"), body=$("#dockBody"), open = U.tab!=="explore";
  dock.hidden = !open; $("#scrim").hidden = !open; $("#view").inert = open; $("#hud").inert = open; $("#app").classList.toggle("docked", open);
  if(!open){ delete $("#app").dataset.dock; return; }
  dock.dataset.size = uiMode()==="pc" ? (PC_SIZE[U.tab]||"side") : (TOUCH_SIZE[U.tab]||"sheet");
  /* 打ち上げの演出（カウントダウン〜上昇）の間は、パネルを上の細い帯にして 3D の発射台と機体を見せる（2026-11-14 統合。以前は大きなパネルが画面を覆っていた） */
  if(U.tab==="space" && ["boarded","countdown","retract","ignition","ascent"].includes(SPACE.state(S).phase)) dock.dataset.size="flight";
  /* 大きさが変わったら 3D の一時停止をやり直す（スマホの全高パネル＝止める／演出の帯＝動かす。以前は搭乗で止まったまま演出が動かなかった） */
  if(dock.dataset.size!==U.dockSize){ U.dockSize=dock.dataset.size; setTimeout(()=>{ if(W3.state!=="ready" || S.flags.view==="2d") return; const want=fieldShown() && !document.hidden; if(want && !W3.raf) resume3D(); else if(!want && W3.raf) pause3D(); },0); }   /* 止める・動かすのは状態が変わるときだけ（描画ループの開始と停止を対にする） */
  $("#app").dataset.dock = dock.dataset.size;
  if(U.dockTab!==U.tab){ body.innerHTML=""; body.scrollTop=0; U.dockTab=U.tab; sceneSig=""; }
  $("#dockTitle").innerHTML = (TAB_ICON[U.tab] ? iconHTML(TAB_ICON[U.tab]) : "")+`<span>${TABS[U.tab]}</span>`;
  if(U.tab==="lab") renderLab(body);
  else if(U.tab==="space") body.innerHTML = spaceProject();
  else if(U.tab==="craft") body.innerHTML = viewCraft();
  else if(U.tab==="book") body.innerHTML = viewBook();
  else if(U.tab==="map") body.innerHTML = viewMap();
  else if(U.tab==="log") body.innerHTML = viewLog();
  else if(U.tab==="verify") body.innerHTML = viewVerify();
  else if(U.tab==="build") body.innerHTML = viewBuild();
  else if(U.tab==="world"){ body.innerHTML = viewWorld(); drawRegion(); drawWorldMap(); }
  else if(U.tab==="menu") body.innerHTML = viewMenu();
  else if(U.tab==="settings") body.innerHTML = viewSettings();
}
function stageSummary(){
  const st=stage(), got=Object.keys(S.disc).filter(k=>IT[k]).length;
  return `<div class="summary"><span class="chip">🏛️ <b>${D.stages[st].era}</b>・${D.stages[st].name}</span><span class="chip">📖 図鑑 <b>${got}</b>/${Object.keys(IT).length}</span></div>
    <p class="desc" style="margin-top:0">次の文明の進化：${D.stages[st].need}</p>`;
}
function viewMenu(){
  return stageSummary()+`<div class="bigmenu">${[["book","book","図鑑","見つけたものの説明"],["map","tech","技術","技術と物質のつながり"],["log","log","記録","実験の記録・セーブ"],["build","home","建築",E.buildRule(S)&&!S.verify?"設計図を選び、現地に建てる（予定地→資材を運ぶ→施工）":"作った家や設備を好きな場所に置く"],...(VERIFY?[["verify","settings","検証モード","全解放・素材・移動・アセット"]]:[]),["settings","settings","設定","主人公・表示・遊び方"]]
    .map(([t,i,n,d])=>`<button class="bigitem" data-tab="${t}">${iconHTML(i)}<span>${n}<small>${d}</small></span></button>`).join("")}</div>`;
}
function viewSettings(){
  const touch = uiMode()==="touch", failed = W3.state==="failed";
  return `<div class="sec" style="font-size:1.15rem">ゼロからの科学 〜石と水と木から〜</div>
  <p class="desc" style="margin-top:0">石・水・木といった自然の資源だけから、実験と工作を積み重ねて、文明を作り直していくゲーム。</p>
  ${stageSummary()}
  <div class="sec">主人公</div>
  <div class="row">${["boy","girl"].map(h=>`<button class="heropick" data-act="pickhero" data-id="${h}" aria-pressed="${(S.flags.hero||"boy")===h}"><span class="hero big" style="background-image:url(${ASSETS[h]})"></span>${h==="boy"?"男の子":"女の子"}</button>`).join("")}</div>
  <div class="sec">フィールドの表示</div>
  ${failed?`<p class="desc">3D表示が使えないため、2Dで表示しています。${W3.err||""}</p>`:
    `<div class="row"><button class="opt" data-act="view3d" aria-pressed="${S.flags.view!=="2d"}">🌄 3D</button><button class="opt" data-act="view2d" aria-pressed="${S.flags.view==="2d"}">🗺️ 2D（軽い）</button></div>`}
  ${camSupported()?(()=>{ const u=camUser(); return `<div class="sec">カメラ（視点）</div>
  <p class="desc" style="margin-top:0">${touch?"マップの何もない所を1本指でドラッグすると回る（左右で一周、上下で見下ろす角度）。2本指を広げると近づき、すぼめると離れる。":"マップを左ボタンでドラッグすると回る（左右で一周、上下で見下ろす角度）。ホイールで近づく・離れる。短いクリックは今までどおり移動・採取。"}</p>
  <div class="camsens">${[["sx","横の感度（回転）"],["sy","縦の感度（見下ろす角度）"]].map(([k,l])=>`<label for="camSens-${k}">${l}</label><input type="range" id="camSens-${k}" data-camsens="${k}" min="${CAM.sens[0]}" max="${CAM.sens[1]}" step="0.1" value="${u[k]}"><output id="camSensOut-${k}">${u[k].toFixed(1)}</output>`).join("")}</div>
  <div class="row mt"><button class="btn small sub" data-act="cam" data-id="reset">🎥 視点を標準に戻す</button></div>`; })():""}
  <div class="sec">遊び方</div>
  <ul class="helplist">${touch?
    `<li>左下のスティックで歩く。地面をタップすると、そこへ歩く</li><li>資源の名札をタップすると、歩いて行って採取する</li><li>近くに資源があると、右下のボタンが「採る」に変わる</li><li>地域の移動は右上の「地図」、研究と工作は下のボタンから</li>`:
    `<li><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span> か矢印キーで歩く。地面をクリックすると、そこへ歩く</li><li>資源に近づいて <span class="kbd">E</span> かスペースで採取。名札をクリックすると歩いて行って採取する</li><li><span class="kbd">Esc</span> で開いているメニューを閉じる</li><li>地域の移動は右上の「地図」、研究・工作・図鑑などは下のメニューから</li>`}</ul>
  <div class="row mt"><button class="btn small sub" data-act="introagain">🦉 はじめの説明をもう一度見る</button></div>
  <div class="sec">検証モード（全解放）</div>
  ${VERIFY ? `<p class="desc" style="margin-top:0">いまは検証モードです（通常のセーブとは別のデータ）。</p><div class="row"><button class="btn small" data-tab="verify">検証メニューを開く</button><button class="btn small sub" data-act="v-exit">通常のセーブに戻る</button></div>`
    : `<p class="desc" style="margin-top:0">動作の確認用に、すべての物質・道具・設備・地域・アセットを使える別のデータで遊べます。通常のセーブは書き換えません。</p>
       <div class="row"><button class="btn small sub" data-act="v-enter" data-id="keep">検証モードを始める</button><button class="btn small sub" data-act="v-enter" data-id="copy">今のセーブを写して始める</button></div>`}
  <p class="desc">セーブは自動でこのブラウザに保存されます。別の端末へ移すときは「記録」から。</p>`;
}
function travelChips(){
  /* 地域の鍵は 2026-11-11 に廃止：すべての地域へ最初から行ける（準備中の地域だけ押せない） */
  return D.regions.filter(r=>!r.future).map(r=>{ const here=in3D()? W3.region===r : U.region===r.id;
    return `<button class="chip tchip ${here?"here":""}" data-act="travel" data-id="${r.id}" aria-pressed="${here}">${r.icon} ${r.name}${here?"（今ここ）":""}</button>`; }).join("");
}
function viewWorld(){
  const st=stage(), r=D.regions.find(x=>x.id===U.region)||D.regions[0];
  if(in3D()) return `<div class="sec">世界の地図 <small>山・海岸・滝・湖（●が今いる所）</small></div>
    <div class="wmapbox"><canvas id="wmap" width="240" height="240" aria-label="世界の地図"></canvas>
      <ul class="wmapkey"><li><i style="background:#3f88b8"></i>海・湖（深い所は入れない）</li><li><i style="background:#9c8f7e"></i>山の岩場・崖（登れない）</li><li><i style="background:#c9a25a"></i>登山道・滝の道</li><li><i style="background:#e4d4a5"></i>砂浜</li><li><i style="background:#ffffff;border:1px solid #888"></i>旧世界（拠点のある所）</li></ul></div>
    <div class="sec">地域を選んで移動 <small>選ぶと、その地域まで歩いて行く</small></div>
    <div class="row"><button class="btn small sub" data-act="home">🏠 拠点へ戻る</button><button class="btn small sub" data-act="rescue" title="動けなくなったときに使う">🛟 拠点へ瞬間移動</button></div>
    <div class="travel">${travelChips()}</div><div id="regionBox"></div>`;
  return `<div class="sec">地域を選んで移動 <small>地図のピンを選ぶと、その地域へ移動する</small></div>
    <div class="field" id="field">${fieldSVG(st)}
      ${D.regions.filter(x=>!x.future).map(x=>`<button class="pin ${x.id===U.region?"here":""}" style="left:${x.x}%;top:${x.y}%" data-act="go" data-id="${x.id}" aria-label="${x.name}"><span class="pi">${x.icon}</span><span class="pn">${x.name}</span></button>`).join("")}
      <div class="avatar hero" id="avatar" style="left:${r.x}%;top:${r.y}%;background-image:url(${heroUrl()})" aria-hidden="true"></div>
    </div><div id="regionBox"></div>`;
}

/* ===================== 研究室の背景と設備の絵 ===================== */
function facArt(id){
  switch(id){
    case "campfire": return `<ellipse cx="0" cy="0" rx="24" ry="6" style="fill:var(--stone2)"/>${[-16,-8,0,8,16].map(x=>`<ellipse cx="${x}" cy="-2" rx="5" ry="3.5" style="fill:var(--stone)"/>`).join("")}<path d="M-16 -3 L16 -10 M-16 -10 L16 -3" stroke="var(--wood2)" stroke-width="4" stroke-linecap="round"/><path class="idle-flame" d="M0 -6 Q-11 -18 -2 -34 Q2 -22 7 -26 Q12 -14 0 -6Z" fill="#ff9a3c"/><path class="idle-flame" d="M0 -6 Q-5 -14 0 -24 Q5 -14 0 -6Z" fill="#ffd25a"/>`;
    case "rack": return `<g stroke="var(--wood)" stroke-width="3"><path d="M-20 0 V-56 M20 0 V-56 M-20 -44 H20 M-20 -26 H20"/></g><rect x="-14" y="-50" width="10" height="6" fill="#cdbf8e"/><rect x="2" y="-32" width="12" height="6" fill="#b8926d"/>`;
    case "filter": return `<path d="M-16 0 Q-18 -16 -12 -22 L12 -22 Q18 -16 16 0Z" style="fill:var(--clay)"/><path d="M-16 -22 H16" stroke="#b7a77a" stroke-width="4"/>`;
    case "mill": return `<ellipse cx="0" cy="-4" rx="22" ry="6" style="fill:var(--stone2)"/><rect x="-22" y="-12" width="44" height="8" style="fill:var(--stone2)"/><ellipse cx="0" cy="-12" rx="22" ry="6" style="fill:var(--stone)"/><rect x="12" y="-26" width="4" height="14" style="fill:var(--wood)"/>`;
    case "kiln": return `<path d="M-30 0 Q-30 -52 0 -54 Q30 -52 30 0Z" style="fill:var(--clay)"/><ellipse cx="0" cy="-8" rx="12" ry="8" fill="#ffb347" class="idle-flame"/>`;
    case "charkiln": return `<path d="M-30 0 Q-26 -38 0 -40 Q26 -38 30 0Z" fill="#8a6a50"/><circle cx="0" cy="-46" r="5" fill="#bbb" opacity=".6"/>`;
    case "fermenter": return `<path d="M-12 0 Q-22 -18 -10 -30 L10 -30 Q22 -18 12 0Z" style="fill:var(--clay)"/><ellipse cx="0" cy="-30" rx="10" ry="3" style="fill:var(--wood)"/>`;
    case "furnace": return `<rect x="-22" y="-72" width="44" height="72" fill="#a54e33"/>${[-60,-46,-32,-18].map(y=>`<path d="M-22 ${y} H22" stroke="rgba(0,0,0,.2)"/>`).join("")}<rect x="-9" y="-22" width="18" height="16" rx="3" fill="#ffb347" class="idle-flame"/><path d="M22 -14 L38 -22 L40 -4Z" fill="#9a8a5a"/>`;
    case "still": return `<path d="M-18 0 Q-24 -20 -12 -30 L8 -30 Q20 -20 14 0Z" fill="#c97a43"/><path d="M-8 -30 Q-2 -44 6 -30Z" fill="#d98a52"/><path d="M2 -40 Q26 -48 28 -16" fill="none" stroke="#c97a43" stroke-width="3"/><rect x="22" y="-16" width="12" height="16" rx="2" style="fill:var(--sky1)" opacity=".8"/>`;
    case "electrolyzer": return `<rect x="-18" y="-30" width="30" height="30" rx="3" fill="#cfeef2" opacity=".85" stroke="#8fb9c6"/><rect x="-18" y="-16" width="30" height="16" fill="#9fd4e8" opacity=".7"/><path d="M-10 -40 V-6 M4 -40 V-6" stroke="#555" stroke-width="3"/><rect x="18" y="-22" width="16" height="22" rx="2" fill="#d98a52"/><path d="M-10 -40 Q8 -56 26 -22 M4 -40 Q14 -48 26 -22" fill="none" stroke="#d27b45" stroke-width="1.5"/>`;
    case "generator": return `<rect x="-24" y="-36" width="48" height="36" rx="6" fill="#5b6470"/>${[-16,-8,0,8,16].map(x=>`<rect x="${x-2}" y="-34" width="4" height="32" fill="#d27b45"/>`).join("")}<path d="M-4 -52 L4 -44 L-2 -44 L6 -36" fill="none" stroke="#f2b632" stroke-width="3"/>`;
    case "blastfurnace": return `<path d="M-26 0 L-18 -90 L18 -90 L26 0Z" fill="#7a3a2a"/><rect x="-22" y="-96" width="44" height="8" fill="#5a2a1e"/><rect x="-10" y="-20" width="20" height="16" rx="3" fill="#ffb347" class="idle-flame"/><circle cx="6" cy="-104" r="8" fill="#9a9a9a" opacity=".5"/>`;
    case "steamengine": return `<rect x="-30" y="-30" width="44" height="24" rx="12" fill="#3d4650"/><rect x="-22" y="-52" width="8" height="24" fill="#2c333b"/><circle cx="22" cy="-16" r="14" fill="none" stroke="#3d4650" stroke-width="4"/><path d="M14 -18 H30" stroke="#b58b3e" stroke-width="3"/><circle cx="-18" cy="-60" r="6" fill="#ddd" opacity=".7"/>`;
    case "refinery": return `<rect x="-10" y="-110" width="20" height="110" fill="#9aa3ad"/>${[-96,-78,-60,-42,-24].map(y=>`<rect x="-14" y="${y}" width="28" height="4" fill="#6f7a86"/>`).join("")}<path d="M10 -90 H26 V0" fill="none" stroke="#6f7a86" stroke-width="3"/>`;
    case "reactor": return `<rect x="-22" y="-58" width="44" height="54" rx="18" fill="#aab3bd"/><rect x="-6" y="-70" width="12" height="14" fill="#7d8792"/><circle cx="0" cy="-32" r="9" fill="#fff" stroke="#555"/><path d="M0 -32 L5 -37" stroke="#c0392b" stroke-width="2"/><rect x="-26" y="-6" width="52" height="6" fill="#6f7a86"/>`;
    case "eaf": return `<rect x="-28" y="-36" width="56" height="36" rx="6" fill="#5a5f66"/><path d="M-12 -60 V-30 M0 -64 V-30 M12 -60 V-30" stroke="#2a2a2a" stroke-width="5"/><ellipse cx="0" cy="-30" rx="20" ry="5" fill="#ffcf5a" class="idle-flame"/>`;
    default: return "";
  }
}
const LAB_FAC = ["campfire","kiln","charkiln","furnace","blastfurnace","still","refinery","reactor","eaf","electrolyzer","generator","steamengine","mill","fermenter","filter","rack"];
const SLOTS = [[46,222,1],[96,222,.9],[310,222,.9],[360,222,1],[36,172,.75],[84,172,.75],[128,172,.75],[272,172,.75],[316,172,.75],[364,172,.75],[60,140,.55],[110,140,.55],[290,140,.55],[340,140,.55],[170,140,.5],[230,140,.5]];
function labBackground(st){
  if(st<3) return `<rect width="400" height="230" fill="url(#sky)"/>
    <circle cx="345" cy="40" r="17" fill="#f6cf5c"/>
    <path d="M0 150 Q70 100 140 138 T280 128 T400 140 V230 H0Z" style="fill:var(--hill)"/>
    <path d="M0 165 Q90 135 190 160 T400 158 V230 H0Z" style="fill:var(--hill2)"/>
    ${[[22,150],[46,140],[372,146],[392,156]].map(([x,y])=>`<rect x="${x-2}" y="${y}" width="4" height="16" style="fill:var(--trunk)"/><path d="M${x-14} ${y+4} L${x} ${y-30} L${x+14} ${y+4}Z" style="fill:var(--tree)"/>`).join("")}
    <rect y="178" width="400" height="52" style="fill:var(--ground)"/>
    ${st===2?`<rect x="8" y="44" width="7" height="140" style="fill:var(--wood2)"/><rect x="385" y="44" width="7" height="140" style="fill:var(--wood2)"/>
      <path d="M-6 56 L200 8 L406 56 L392 62 L200 20 L8 62Z" style="fill:#b8943f"/>`:""}`;
  /* 屋内（段階3以上）：Muse ラウンド28 の生成り＋濃紺の背景（棚 y=96・作業台 y=186 は同じ）。なければ従来の絵 */
  if(window.ASSETS && ASSETS.labBg) return `<rect width="400" height="230" fill="#f3eee2"/><image href="${ASSETS.labBg}" x="0" y="0" width="400" height="225" preserveAspectRatio="none"/>`;
  if(st===3) return `<rect width="400" height="230" style="fill:var(--wall)"/>
    <rect y="120" width="400" height="70" style="fill:var(--wall2)"/>
    <rect x="160" y="22" width="80" height="60" rx="4" fill="url(#sky)" stroke="var(--wood)" stroke-width="5"/><path d="M200 22 V82 M160 52 H240" stroke="var(--wood)" stroke-width="3"/>
    <rect x="250" y="96" width="140" height="4" style="fill:var(--wood)"/>
    ${[258,280,302,326,350,372].map((x,i)=>`<rect x="${x}" y="${80-(i%3)*4}" width="11" height="${16+(i%3)*4}" rx="3" fill="${["#cfeef2","#e8c15a","#bfe3f2","#d98a52","#e9f1f4","#a8321f"][i]}" opacity=".85"/>`).join("")}
    <rect y="188" width="400" height="42" style="fill:var(--floor)"/>`;
  if(st===4) return `<rect width="400" height="230" fill="#8a4a36"/>
    ${[0,1,2,3,4,5,6,7,8,9].map(r=>`<path d="M0 ${r*20} H400" stroke="rgba(0,0,0,.15)"/>`).join("")}
    <rect x="150" y="20" width="100" height="70" fill="#a9b8c4" stroke="#3d4650" stroke-width="5"/><path d="M200 20 V90 M150 55 H250" stroke="#3d4650" stroke-width="3"/>
    <path d="M160 88 V62 H172 V88 M180 88 V50 H190 V88 M206 88 V66 H230 V88" fill="#5b6470"/><circle cx="186" cy="44" r="5" fill="#ccc" opacity=".7"/>
    <path d="M0 108 H400" stroke="#6f7a86" stroke-width="6"/><path d="M0 116 H400" stroke="#b58b3e" stroke-width="3"/>
    ${S.disc.bulb?`<path d="M100 0 V24 M300 0 V24" stroke="#333" stroke-width="1.5"/><circle cx="100" cy="30" r="7" fill="#ffe27a"/><circle cx="300" cy="30" r="7" fill="#ffe27a"/>`:`<rect x="94" y="22" width="12" height="16" rx="3" fill="#e8c15a" opacity=".8"/><rect x="294" y="22" width="12" height="16" rx="3" fill="#e8c15a" opacity=".8"/>`}
    <rect y="188" width="400" height="42" fill="#4a3a2a"/>`;
  return `<rect width="400" height="230" fill="#eef2f4"/>
    <rect x="120" y="6" width="160" height="8" rx="3" fill="#fff" stroke="#cfd6dc"/><rect x="128" y="8" width="144" height="4" fill="#e9f6ff"/>
    <rect x="148" y="26" width="104" height="64" rx="5" fill="#1f2b3a"/><path d="M156 76 L176 60 L196 66 L216 44 L244 50" fill="none" stroke="#5fd38d" stroke-width="2.5"/><rect x="194" y="90" width="12" height="10" fill="#9aa3ad"/>
    <rect x="18" y="30" width="70" height="60" rx="4" fill="#cfe9f5" stroke="#9aa3ad" stroke-width="3"/><path d="M24 80 H82" stroke="#9aa3ad" stroke-width="2"/>
    <rect x="312" y="30" width="70" height="60" rx="4" fill="#cfe9f5" stroke="#9aa3ad" stroke-width="3"/>
    ${S.disc.solarcell?`<path d="M318 70 L340 50 L376 50 L354 70Z" fill="#2b4a7a"/>`:""}
    <rect y="188" width="400" height="42" fill="#d7dde2"/>${[0,1,2,3,4,5,6,7].map(i=>`<path d="M${i*50} 188 V230" stroke="rgba(0,0,0,.08)"/>`).join("")}`;
}

/* ===================== 研究室 ===================== */
let sceneSig="";
function renderLab(v){
  if(!v.querySelector(".labgrid")){ v.innerHTML = `<div class="labgrid"><div class="benchcol"><ol class="steps" id="labSteps" aria-label="実験の手順"></ol><div class="stagebox" id="stagebox"></div></div><div id="labctl"></div></div>`; sceneSig=""; }
  drawScene(); drawLabCtl();
}
function vesselFor(fac, op, proc){
  if(!fac) return null;
  if(["furnace","blastfurnace","eaf"].includes(fac)) return fac==="eaf"&&op==="electrolyze" ? "cell" : "crucible";
  if(fac==="still"||fac==="refinery") return "still";
  if(fac==="electrolyzer") return "cell";
  if(fac==="reactor") return "reactor";
  if(fac==="filter") return "funnel";
  if(fac==="mill") return "mill";
  if(fac==="fermenter") return "jar";
  if(fac==="bench"||fac==="rack") return (proc && proc.tools.includes("pot")) || ["dissolve","wash","settle","mix"].includes(op) ? "pot" : "slab";
  return "pot";
}
function vesselSVG(shape){
  const clip = {pot:"M-30 -42 Q-34 -10 -22 0 L22 0 Q34 -10 30 -42 Z", jar:"M-20 -50 Q-36 -25 -24 0 L24 0 Q36 -25 20 -50 Z",
    crucible:"M-18 -36 L18 -36 L12 0 L-12 0 Z", cell:"M-30 -48 L30 -48 L30 0 L-30 0 Z", reactor:"M-30 -56 Q-30 -64 -18 -64 L18 -64 Q30 -64 30 -56 L30 -8 Q30 0 18 0 L-18 0 Q-30 0 -30 -8 Z"};
  if(shape==="slab") return `<rect x="-44" y="-8" width="88" height="8" rx="3" style="fill:var(--stone)"/><ellipse class="cnt" id="cnt" cx="0" cy="-14" rx="26" ry="9" fill="#ccc"/>`;
  if(shape==="mill") return `<ellipse cx="0" cy="-6" rx="36" ry="9" style="fill:var(--stone2)"/><rect x="-36" y="-14" width="72" height="8" style="fill:var(--stone2)"/><ellipse cx="0" cy="-14" rx="36" ry="9" style="fill:var(--stone)"/>
    <g class="fx x-grind"><g><ellipse cx="0" cy="-24" rx="30" ry="8" style="fill:var(--stone)"/><rect x="-3" y="-44" width="6" height="18" rx="2" style="fill:var(--wood)"/></g></g><ellipse class="cnt" id="cnt" cx="40" cy="-4" rx="12" ry="4" fill="#ccc"/>`;
  if(shape==="funnel") return `<path d="${clip.pot}" transform="scale(.8)" style="fill:var(--clay)" opacity=".9"/><path d="M-34 -78 L34 -78 L7 -44 L-7 -44 Z" style="fill:var(--card)" stroke="#b7a77a" stroke-width="2"/>
    <path class="cnt" id="cnt" d="M-28 -74 L28 -74 L14 -58 L-14 -58 Z" fill="#ccc"/><path d="M-34 -78 L34 -78" stroke="#9a8a5a" stroke-width="3" stroke-dasharray="3 3"/>`;
  if(shape==="still") return `<path d="${clip.pot}" transform="translate(-14,0) scale(.85)" style="fill:#c97a43"/><path d="M-40 -36 Q-14 -64 12 -36 Z" style="fill:#d98a52"/>
    <path d="M-14 -56 Q20 -70 40 -30" fill="none" stroke="#c97a43" stroke-width="5" stroke-linecap="round"/><path d="M32 -22 L48 -22 L50 0 L30 0 Z" style="fill:var(--sky1)" opacity=".8" stroke="#8fb9c6"/>
    <rect class="cnt" id="cnt" x="31" y="-10" width="18" height="10" fill="#ccc"/><g class="fx x-ddrip"><circle cx="40" cy="-28" r="2.4" fill="#8fc6e0"/><circle cx="40" cy="-28" r="2.4" fill="#8fc6e0"/></g>`;
  const d = clip[shape]||clip.pot;
  const fill = shape==="crucible"?"#c9b7a6": shape==="jar"?"var(--clay)": shape==="cell"?"rgba(190,230,240,.55)": shape==="reactor"?"#aab3bd":"#b46a44";
  const extra = shape==="cell" ? `<path d="M-12 -62 V-6 M12 -62 V-6" stroke="#444" stroke-width="4"/><path d="M-12 -62 Q0 -76 12 -62" fill="none" stroke="#d27b45" stroke-width="2"/>
      <g class="fx x-bubbles"><circle cx="-12" cy="-8" r="2.5" fill="#fff"/><circle cx="12" cy="-10" r="2.5" fill="#fff"/><circle cx="-12" cy="-14" r="2" fill="#fff"/><circle cx="12" cy="-6" r="2" fill="#fff"/></g>`
    : shape==="reactor" ? `<circle cx="0" cy="-30" r="12" fill="rgba(255,255,255,.6)" stroke="#555"/><rect x="-6" y="-76" width="12" height="12" fill="#7d8792"/>` : "";
  return `<clipPath id="vclip"><path d="${d}"/></clipPath><path d="${d}" fill="${fill}" ${shape==="cell"?'stroke="#8fb9c6" stroke-width="2"':""}/>
    <g clip-path="url(#vclip)"><rect class="cnt" id="cnt" x="-40" y="${shape==="reactor"?-40:-30}" width="80" height="${shape==="reactor"?44:34}" fill="#ccc" ${shape==="reactor"?'opacity=".7"':""}/>
      ${shape==="cell"?"":`<g class="fx x-bubbles"><circle cx="-10" cy="-6" r="3" fill="#fff" opacity=".8"/><circle cx="6" cy="-4" r="2.5" fill="#fff" opacity=".8"/><circle cx="14" cy="-8" r="2" fill="#fff" opacity=".8"/><circle cx="-2" cy="-10" r="2" fill="#fff" opacity=".8"/></g>`}
      <g class="fx x-sink"><circle cx="-8" cy="-4" r="2.4" fill="#6e5a44"/><circle cx="4" cy="-4" r="2.4" fill="#6e5a44"/><circle cx="12" cy="-4" r="2" fill="#6e5a44"/></g></g>
    ${extra}${shape==="jar"?`<ellipse cx="0" cy="-50" rx="22" ry="5" style="fill:var(--wood)"/>`: shape==="pot"?`<ellipse cx="0" cy="-42" rx="30" ry="4" fill="rgba(0,0,0,.18)"/>`:""}`;
}
/* 実験台：AI画像ではなく SVG で描く。中央に選んだ装置と容器、棚に解放済みの設備、台の端に解放済みの器具 */
const TALL_FAC = ["furnace","blastfurnace","refinery","reactor","still","kiln","charkiln","steamengine","generator","electrolyzer","eaf"];
/* 器具スプライト（Muse）。256×256・底面中心が (128,234)。w は表示の幅（SVG の単位） */
function spr(name, cx, base, w, cls){ const src = window.ASSETS && ASSETS.labApp && ASSETS.labApp[name];
  return src ? `<image href="${src}" x="${(cx-w/2).toFixed(1)}" y="${(base-w*234/256).toFixed(1)}" width="${w}" height="${w}" class="${cls||""}" preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated"/>` : ""; }
const hasSpr = name => !!(window.ASSETS && ASSETS.labApp && ASSETS.labApp[name]);
/* 選んだ装置を中央に置く。器具スプライトがある装置はスプライト、ないものは今までの絵。
   炎のレイヤーは演出（x-flame）として、加熱の実験中だけ見える。液体は材料が入っているときだけ */
const CENTER_APP = {
  campfire:  (cx,b,liq)=> spr("brazier",cx,b,118)+spr("brazier_coals",cx,b,118)+spr("brazier_flame",cx,b,118,"fx x-flame"),
  still:     (cx,b,liq)=> spr("heater",cx,b,96)+spr("heater_flame",cx,b,96,"fx x-flame")+spr("flask",cx,b-32,104)+(liq?spr("flask_liquid",cx,b-32,104):""),
  reactor:   (cx,b,liq)=> spr("flask",cx,b,120)+(liq?spr("flask_liquid",cx,b,120):""),
  fermenter: (cx,b,liq)=> spr("jar",cx,b,112)+(liq?spr("jar_contents",cx,b,112):"")+spr("jar_lid",cx,b,112),
  mill:      (cx,b,liq)=> spr("mortar",cx,b,112),
  rack:      (cx,b,liq)=> spr("testtubes",cx,b,120)+spr("testtubes_glass",cx,b,120)+(liq?spr("testtubes_liquid",cx,b,120):""),
};
/* 装置自体が容器になっているもの（別の容器の絵を重ねない） */
const SELF_VESSEL = ["still","reactor","fermenter","mill","rack"];
/* 台の端の飾り：解放済みの器具だけ（操作できる設備としては表示しない） */
function benchProps(st){
  const out=[], glass = S.disc.glass || S.disc.bottle, modern = st>=4 || owned("generator");
  const left=[], right=[];
  if(owned("bench") && U.fac!=="mill") left.push(["mortar",62]);
  if(S.disc.pot && U.fac!=="fermenter") left.push(["jar",62]);
  if(glass){ if(U.fac!=="reactor" && U.fac!=="still") right.push(["flask",66]); right.push(["beaker",60]); if(U.fac!=="rack") right.push(["testtubes_set",66]); if(U.fac!=="still") right.push(["heater",54]); }
  if(modern) right.push(["heater_modern",64]);
  left.slice(0,2).forEach(([n,w],i)=>out.push(spr(n,40+i*58,186,w)));
  right.slice(0,4).reverse().forEach(([n,w],i)=>{ const name = n==="testtubes_set" ? null : n;
    if(n==="testtubes_set") out.push(spr("testtubes",372-i*50,186,w)+spr("testtubes_glass",372-i*50,186,w));
    else out.push(spr(name,372-i*50,186,w)); });
  return `<g aria-hidden="true">${out.join("")}</g>`;
}
function drawScene(){
  const box=$("#stagebox"); if(!box) return;
  const st = stage();
  const facs = LAB_FAC.filter(f=>owned(f) && f!==U.fac).slice(0,7);
  const plan = U.fac ? E.planExperiment(S,U.tray,U.fac,U.op) : null;
  const shape = (U.fac && SELF_VESSEL.includes(U.fac) && CENTER_APP[U.fac] && hasSpr("flask")) ? null : vesselFor(U.fac, U.op, plan&&plan.ok?plan.proc:null);
  const tray = Object.keys(U.tray).filter(k=>U.tray[k]>0);
  const step = !tray.length ? 1 : !U.fac ? 2 : !U.op ? 3 : 4;
  const steps=$("#labSteps"); if(steps) steps.innerHTML = ["材料を選ぶ","装置を選ぶ","操作を選ぶ","実験する","結果を見る"].map((t,i)=>`<li class="${i+1<step?"done":i+1===step?"now":""}">${t}</li>`).join("");
  const sig = [st, facs.join(","), owned("bench"), shape, U.fac, U.op, tray.map(k=>k+U.tray[k]).join(","), S.disc.pot?1:0, (S.disc.glass||S.disc.bottle)?1:0, S.disc.bulb?1:0, S.disc.solarcell?1:0].join("|");
  if(sig===sceneSig || U.busy) return;
  sceneSig = sig;
  const tall = U.fac && TALL_FAC.includes(U.fac), baseY = 186;
  /* 作業台を作るまでは、地面と平たい石だけ（加工した木の台や棚はまだない） */
  const bench = owned("bench");
  box.style.backgroundImage = "none";
  box.innerHTML = `<svg class="scene" id="scene" viewBox="0 0 400 225" role="img" aria-label="実験台：${U.fac?nm(U.fac)+"を使う":"装置はまだ選んでいない"}${tray.length?"・材料 "+tray.map(nm).join("、"):""}">
  <defs><radialGradient id="glowG"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".95"/><stop offset=".6" stop-color="#ff8a2a" stop-opacity=".35"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
    <radialGradient id="spotG" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".7" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3f2"/><stop offset="1" stop-color="#eef8f1"/></linearGradient></defs>
  <g opacity=".85">${labBackground(st)}</g>
  ${bench?`<rect x="0" y="96" width="400" height="5" fill="${st<3?"#8a643f":"#7d8792"}"/>`:""}
  ${facs.map((f,i)=>`<g transform="translate(${36+i*54},${bench?96:170}) scale(.36)" opacity=".9"><title>${nm(f)}（持っている設備）</title>${facArt(f)}</g>`).join("")}
  ${bench ? `<rect x="0" y="${baseY}" width="400" height="10" fill="${st<3?"#8a643f":"#5b6470"}"/><rect x="0" y="${baseY+10}" width="400" height="30" fill="${st<3?"#6e4e30":"#3d4650"}"/>`
    : `<rect x="0" y="${baseY}" width="400" height="40" fill="#7a6248"/><path d="M0 ${baseY} Q60 ${baseY-3} 120 ${baseY} T260 ${baseY+1} T400 ${baseY}" fill="none" stroke="#5f4b37" stroke-width="2"/>
       <path d="M120 ${baseY+2} Q130 ${baseY-9} 168 ${baseY-8} Q230 ${baseY-10} 262 ${baseY-4} Q276 ${baseY+1} 272 ${baseY+4} Z" fill="#8f8a7e" stroke="#6c675d" stroke-width="2"/>
       ${[[30,baseY+14,5],[78,baseY+24,4],[318,baseY+18,6],[360,baseY+28,4]].map(([x,y,r])=>`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*0.6}" fill="#8f8a7e"/>`).join("")}`}
  ${benchProps(st)}
  ${tray.map((k,i)=>`<g transform="translate(${26+i*30},${baseY+28})"><circle r="12" fill="rgba(255,255,255,.9)"/>${svgIc(k,-10,-10,20)}</g>`).join("")}
  ${U.fac && CENTER_APP[U.fac] && hasSpr("flask") ? `${CENTER_APP[U.fac](200, baseY+4, tray.length>0)}
    <text x="200" y="${baseY+36}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${nm(U.fac)}</text>`
  : U.fac?`<g transform="translate(${tall?300:200},${baseY+2}) scale(${tall?.85:1.15})">${facArt(U.fac)}</g>
    <text x="${tall?300:200}" y="${baseY+36}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${nm(U.fac)}</text>`
    : `<rect x="110" y="128" width="180" height="26" rx="10" fill="rgba(255,255,255,.88)"/><text x="200" y="146" text-anchor="middle" font-size="12" font-weight="700" fill="#22305a">${owned("bench")||LAB_FAC.some(owned)?"② 装置を選ぶと、ここに置かれる":"まだ装置がない。工作で作ろう"}</text>`}
  ${shape?`<ellipse cx="${tall?170:200}" cy="${baseY-40}" rx="70" ry="56" fill="url(#spotG)"/>`:""}
  <g id="vessel" transform="translate(${tall?170:200},${baseY-(U.fac==="campfire"?(hasSpr("brazier")?30:12):0)})">
    <g class="fx x-glow"><circle cx="0" cy="-26" r="54" fill="url(#glowG)"/></g>
    <g class="fx x-flame" transform="translate(0,8)"><path d="M-16 0 Q-26 -14 -16 -28 Q-12 -14 -6 -16 Q-4 -6 -16 0Z" fill="#ff8a2a"/><path d="M0 0 Q-12 -18 0 -36 Q12 -18 0 0Z" fill="#ffb347"/><path d="M16 0 Q26 -14 16 -28 Q12 -14 6 -16 Q4 -6 16 0Z" fill="#ff8a2a"/></g>
    ${shape?vesselSVG(shape):""}
    <g class="fx x-steam"><circle cx="-8" cy="-48" r="6" fill="#fff" opacity=".8"/><circle cx="6" cy="-50" r="7" fill="#fff" opacity=".8"/><circle cx="0" cy="-46" r="5" fill="#fff" opacity=".8"/></g>
    <g class="fx x-smoke"><circle cx="-6" cy="-50" r="7" fill="#8d8d8d" opacity=".7"/><circle cx="8" cy="-52" r="8" fill="#9a9a9a" opacity=".7"/><circle cx="0" cy="-48" r="6" fill="#7d7d7d" opacity=".7"/></g>
    <g class="fx x-crystal">${[[-12,-30],[0,-34],[12,-29],[5,-26]].map(([x,y])=>`<path d="M${x} ${y-6} L${x+5} ${y} L${x} ${y+6} L${x-5} ${y}Z" fill="#fff" stroke="#9fc6d8"/>`).join("")}</g>
    <g class="fx x-drip"><circle cx="0" cy="-42" r="2.6" fill="#8fc6e0"/><circle cx="0" cy="-42" r="2.6" fill="#8fc6e0"/></g>
    <g class="fx x-sparks"><text x="28" y="-48" font-size="22">🔨</text>${[[-20,-30],[22,-28],[-10,-44],[14,-46]].map(([x,y])=>`<line x1="${x*.5}" y1="${y*.5-8}" x2="${x}" y2="${y}" stroke="#f2b632" stroke-width="2.5" stroke-linecap="round"/>`).join("")}</g>
    <g class="fx x-electric"><path d="M-34 -70 L-24 -56 L-30 -56 L-18 -40" fill="none" stroke="#f2d43a" stroke-width="3"/><path d="M34 -70 L24 -56 L30 -56 L18 -40" fill="none" stroke="#f2d43a" stroke-width="3"/></g>
    <g class="fx x-swirl"><g><ellipse cx="0" cy="-24" rx="18" ry="5" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 5"/></g><text x="16" y="-40" font-size="20">🥄</text></g>
    <g class="fx x-frost"><text x="-46" y="-30" font-size="18">❄️</text><text x="30" y="-40" font-size="16">❄️</text></g>
    <g class="fx x-shape"><text x="20" y="-34" font-size="24">✋</text></g>
    <g class="fx x-chain"><text x="-44" y="-40" font-size="16">🔗</text><text x="-10" y="-70" font-size="16">🔗</text><text x="26" y="-44" font-size="16">🔗</text></g>
    <g class="fx x-dry"><text x="30" y="-48" font-size="22">☀️</text><path d="M-20 -50 q5 -6 10 0 t10 0 M-4 -60 q5 -6 10 0 t10 0" fill="none" stroke="#f2b632" stroke-width="2"/></g>
    <g class="fx x-ferment"><text x="-40" y="-36" font-size="16">🦠</text><text x="26" y="-44" font-size="14">🦠</text></g>
    <g class="fx x-sparkle"><text x="-44" y="-50" font-size="18">✨</text><text x="30" y="-62" font-size="20">✨</text><text x="-6" y="-72" font-size="16">✨</text></g>
  </g></svg>
  <div class="stagelabel">${D.stages[st].era}：${D.stages[st].name}</div><div class="temp" id="temp"></div>`;
}
const FX = {sparks:["sparks"],grind:["grind"],swirl:["swirl"],drip:["drip"],sink:["sink"],heat:["flame","bubbles"],frost:["frost"],
  evap:["flame","steam"],crystal:["flame","crystal","steam"],dry:["dry"],burn:["flame","smoke","glow"],fire:["flame","glow"],char:["smoke","glow"],
  shape:["shape"],smelt:["flame","glow","sparks"],melt:["glow","flame"],ferment:["ferment","bubbles"],distill:["flame","ddrip","steam"],
  electric:["electric","bubbles"],chain:["chain","glow"]};
function blend(cs){ const v=cs.map(c=>{c=(c||"#cccccc").replace("#","");return [0,2,4].map(i=>parseInt(c.slice(i,i+2),16));});
  return "#"+[0,1,2].map(j=>Math.round(v.reduce((a,x)=>a+x[j],0)/v.length).toString(16).padStart(2,"0")).join(""); }

function drawLabCtl(){
  const box = $("#labctl"); if(!box) return;
  const facs = Object.keys(IT).filter(id=>IT[id].facility && IT[id].ops.length && owned(id));
  if(U.fac && !owned(U.fac)) U.fac=null;
  if(!U.fac) U.op=null;
  if(U.fac && U.op && !IT[U.fac].ops.includes(U.op)) U.op=null;
  const order = Object.keys(IT);
  const mats = Object.keys(S.inv).filter(id=>isMat(id) && S.inv[id]>0).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  const trayIds = Object.keys(U.tray).filter(k=>U.tray[k]>0);
  const op = U.op && OPS[U.op];
  const canRun = trayIds.length && U.fac && U.op && !U.busy;
  box.innerHTML = `
  <div class="panel">
    <h3><span class="n">1</span>材料を選ぶ <small style="font-weight:700;color:var(--muted)">（タップで1つずつ入る）</small></h3>
    <div class="tray">${trayIds.length? trayIds.map(id=>`<button class="mat intray" data-act="sub" data-id="${id}" aria-label="${nm(id)}を減らす"><span class="i">${ic(id)}</span>${nm(id)} <span class="q">×${U.tray[id]}</span></button>`).join("") : `<span class="ph">ここに材料が入るよ</span>`}</div>
    ${trayIds.map(id=>E.processBlock(S,id)).filter(Boolean).map(b=>`<p class="needline" role="note">🧰 ${b.text}</p>`).join("")}
    <div class="shelf">${mats.length? mats.map(id=>{ const left=S.inv[id]-(U.tray[id]||0); const blk = E.processBlock(S,id); return `<button class="mat${blk?" noproc":""}" data-act="add" data-id="${id}" ${(left<=0&&!E.vflag(S,"free"))||U.busy?"disabled":""} ${blk?`title="${blk.text}"`:""}><span class="i">${ic(id)}</span>${nm(id)} <span class="q">${left}</span>${blk?`<span class="np" aria-label="まだ加工できない">🧰</span>`:""}</button>`; }).join("") : `<span class="desc">材料がない。探索フィールドで集めよう。</span>`}</div>
  </div>
  <div class="panel mt">
    <h3><span class="n">2</span>装置を選ぶ</h3>
    <div class="opts">${facs.length? facs.map(f=>`<button class="opt" data-act="fac" data-id="${f}" aria-pressed="${U.fac===f}">${ic(f)} ${nm(f)}</button>`).join("") : `<span class="desc">まだ装置がない。「工作」で作業台やたき火を作ろう。</span>`}</div>
    ${U.fac?`<p class="desc">${IT[U.fac].kid}</p>`:""}
    <h3 class="mt"><span class="n">3</span>操作を選ぶ</h3>
    <div class="opts">${U.fac? IT[U.fac].ops.map(o=>`<button class="opt" data-act="op" data-id="${o}" aria-pressed="${U.op===o}">${opIc(o)} ${OPS[o].name}</button>`).join("") : `<span class="desc">先に装置を選んでね。</span>`}</div>
    <p class="desc">${op?`<b>${op.name}（${op.yomi}）</b>：${op.kid}`:""}</p>
    <div class="runbar"><button class="btn big" data-act="run" ${canRun?"":"disabled"}>🧪 実験スタート</button><button class="btn sub" data-act="hint">💡 ヒント</button></div>
  </div>
  <div id="labResult" aria-live="polite">${U.last||""}</div>`;
}
/* 加工の条件（2026-11-11）：この素材を使う反応ごとに、設備・道具がそろっているか、足りない物は何か。
   色だけに頼らず、記号と文字（✅そろっている／🧰足りない：〜）で示す。できる物は発見済みのものだけ名前を出す */
function procNeedsHTML(id){
  const ns = E.processNeeds(S,id); if(!ns.length) return "";
  const row = n => { const fac = D.procs.find(p=>p.id===n.proc).at.map(f=>nm(f)).join("／"), outs = n.out.map(k=>S.disc[k]?nm(k):"？？？").join("・");
    return `<li class="need ${n.ready?"ok":"ng"}"><span class="nst">${n.ready?"✅ そろっている":"🧰 足りない"}</span> ${opIc(n.op)}${OPS[n.op].name}（${fac}${n.tools.length||D.procs.find(p=>p.id===n.proc).tools.length?"・道具："+D.procs.find(p=>p.id===n.proc).tools.map(nm).join("と"):""}）→ ${outs}
      ${n.ready?"":`<small>必要：${[n.at.length?"設備「"+n.at.map(nm).join("」か「")+"」":"", n.tools.length?"道具「"+n.tools.map(nm).join("」と「")+"」":""].filter(Boolean).join("と")}</small>`}</li>`; };
  return `<h5>🧰 加工の条件 <small style="font-weight:600">（採れても、設備と道具がないと加工できない）</small></h5><ul class="needs">${ns.slice(0,6).map(row).join("")}</ul>`;
}
function runLab(){
  if(U.busy) return;
  const token = S.seq;
  const plan = E.planExperiment(S, U.tray, U.fac, U.op);
  if(!plan.ok){ U.last = `<div class="note bad"><h4>🦉 うーん…</h4><p style="margin:0">${plan.msg}</p></div>`; animate(null); drawLabCtl(); showResult(); return; }
  /* 結果を先に確定する（二重実行はトークンで防ぐ）。成功していないのに成功の演出は出さない */
  const tray = U.tray, fac = U.fac;
  const res = E.runExperiment(S, tray, fac, U.op, token);
  if(!res.ok){ U.last=`<div class="note bad"><h4>🦉 あれ？</h4><p style="margin:0">${res.msg}</p></div>`; animate(null); drawLabCtl(); showResult(); return; }
  U.busy = true; U.tray = {}; $("#toasts").innerHTML="";
  U.last = `<div class="note"><h4>🔬 観察中…</h4><p style="margin:0">よく見ていてね。</p></div>`;
  drawLabCtl();
  const sb=$("#stagebox"); if(sb) sb.scrollIntoView({block:"nearest",behavior:RM?"auto":"smooth"});
  animate(res.proc, ()=>{
    U.busy=false; U.last = resultNote(res);
    afterChange(res.news);
    sceneSig=""; drawScene(); drawLabCtl();
    const sc=$("#scene"); if(sc && res.news.length){ sc.classList.add("f-sparkle"); setTimeout(()=>sc&&sc.classList.remove("f-sparkle"),1400); }
    showResult();
  });
}
function showResult(){ const r=$("#labResult"); if(r) r.scrollIntoView({block:"nearest",behavior:RM?"auto":"smooth"}); }
function animate(p, done){
  const sc = $("#scene"), cnt = sc && sc.querySelector("#cnt"), temp=$("#temp");
  if(!sc){ done&&done(); return; }
  if(!p){ sc.classList.add("f-smoke"); setTimeout(()=>sc.classList.remove("f-smoke"),700); return; }
  const fx = FX[OPS[p.op].fx]||[];
  if(cnt) cnt.setAttribute("fill", blend(Object.keys(p.inp).map(k=>IT[k].color)));
  fx.forEach(f=>sc.classList.add("f-"+f));
  if(temp){
    if(owned("thermometer")){ temp.classList.add("on"); let t=20; const goal=p.temp; const stp=Math.max(1,Math.round((goal-20)/20));
      const iv=setInterval(()=>{ t=Math.min(goal,t+stp); temp.textContent="🌡️ "+t+"℃"; if(t>=goal) clearInterval(iv); },50); }
    else if(p.temp>=60){ temp.classList.add("on"); temp.textContent = p.temp>=800?"🔥 ものすごく熱い！":p.temp>=300?"🔥 とても熱い！":"♨️ 熱い"; }
    else if(p.op==="electrolyze"){ temp.classList.add("on"); temp.textContent="⚡ 電気を流している"; }
  }
  const quick = RM || E.vflag(S,"instant");
  setTimeout(()=>{ const outs=Object.keys(p.out).filter(k=>IT[k].store!==false); if(cnt&&outs.length) cnt.setAttribute("fill", IT[outs[0]].color); }, quick?100:1100);
  setTimeout(()=>{ fx.forEach(f=>sc.classList.remove("f-"+f)); temp&&temp.classList.remove("on"); done&&done(); }, quick?300:1900);
}
function resultNote(res){
  const p=res.proc, isNew = res.news.length>0, showP = owned("balance"), outs = Object.keys(res.produce);
  return `<div class="note ${isNew?"new":"good"}">
    <h4>${isNew?"✨ 新しい発見！":"✅ 実験成功！"} <small style="font-weight:700;color:var(--muted)">${opIc(p.op)}${OPS[p.op].name} × ${res.batches}回</small></h4>
    <div class="eq">${Object.keys(res.consume).map(k=>ic(k)+nm(k)+"×"+res.consume[k]).join(" ＋ ")} → ${outs.map(k=>ic(k)+nm(k)+"×"+res.produce[k]).join(" ＋ ")}</div>
    <div class="why"><b>何が起きたの？</b><br>${p.why}</div>
    ${outs.map(k=>{ const it=IT[k]; return `<div class="prod"><span class="i">${ic(k)}</span><p><b>${it.name}</b>${res.news.includes(k)?'<span class="tag">NEW</span>':""}${it.f?` <small style="color:var(--muted)">${it.f}</small>`:""}<br>${it.kid}
      ${it.store===false?`<br><span class="gasnote">（気体なので集められず、発生の記録だけが図鑑に残る）</span>`:""}
      ${it.purity?`<br><span class="gasnote">純度：${showP?"約"+(it.purity>=0.999?"99.99":Math.round(it.purity*100))+"%":"？（てんびんがあればわかる）"}</span>`:""}</p></div>`; }).join("")}
    ${owned("notebook")?`<div class="row mt"><button class="btn small sub" data-act="again" data-proc="${p.id}" data-fac="${U.fac}">📓 同じ実験をもう一度</button></div>`:""}
  </div>`;
}

/* ===================== 探検（フィールド） ===================== */
let fieldSig="";
function fieldSVG(st){
  const sea = "var(--sea)", cv = CIV();
  const rail = (d)=>`<path d="${d}" fill="none" stroke="#5b5048" stroke-width="5"/><path d="${d}" fill="none" stroke="#c9b88c" stroke-width="5" stroke-dasharray="1.5 4"/>`;
  const road = (d)=>`<path d="${d}" fill="none" stroke="#6f7a86" stroke-width="7" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="5 5"/>`;
  const trees = (pts)=>pts.map(([x,y,s])=>`<path d="M${x-7*s} ${y} L${x} ${y-18*s} L${x+7*s} ${y}Z" style="fill:var(--tree)"/>`).join("");
  return `<svg viewBox="0 0 400 300" class="fieldsvg" aria-hidden="true">
  <rect width="400" height="300" style="fill:var(--land)"/>
  <path d="M0 0 H400 V60 Q300 40 200 70 T0 60Z" style="fill:var(--land2)"/>
  <path d="M250 300 Q260 232 330 214 Q380 204 400 188 V300Z" fill="${sea}"/>
  <path d="M250 300 Q260 232 330 214 Q380 204 400 188" fill="none" stroke="#e8d9b0" stroke-width="7"/>
  <path d="M230 18 Q200 70 170 120 Q140 170 150 215 Q170 258 250 290" fill="none" stroke="${sea}" stroke-width="9" stroke-linecap="round"/>
  <path d="M10 70 L48 18 L86 70Z" fill="#6a4034"/><path d="M40 28 L48 18 L56 28 Q48 34 40 28Z" fill="#e2572a"/>
  <g class="fsmoke"><circle cx="50" cy="10" r="6" fill="#bbb" opacity=".6"/><circle cx="56" cy="4" r="5" fill="#ccc" opacity=".5"/></g>
  <path d="M120 70 Q160 20 200 70Z" fill="#8a6a4a"/><rect x="152" y="54" width="14" height="14" rx="3" fill="#3a2c22"/>
  <path d="M210 96 L256 34 L300 96Z" fill="#7f8a8c"/><path d="M244 50 L256 34 L268 50 Q256 56 244 50Z" fill="#fff"/>
  <path d="M296 124 L336 70 L380 124Z" fill="#5f6668"/><path d="M328 124 Q336 108 344 124Z" fill="#1b1b1f"/>
  ${trees([[56,110,1],[70,100,1.2],[86,112,1],[100,104,1.1],[64,128,1],[80,132,1.2],[98,126,1],[46,124,.9],[112,120,.9]])}
  ${[[178,150],[196,160],[210,146],[186,170],[220,166]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="2" fill="#f2b632"/>`).join("")}
  ${owned("rig")?`<g><rect x="352" y="186" width="18" height="4" fill="#6f7a86"/><path d="M356 186 L361 162 L366 186" fill="none" stroke="#3d4650" stroke-width="2"/><circle cx="361" cy="160" r="2" fill="#e2572a"/></g>`:`<ellipse cx="361" cy="182" rx="10" ry="4" fill="#1f1810" opacity=".5"/>`}
  ${cv.hut?`<path d="M112 176 Q140 140 188 156 M112 176 Q120 200 144 210 M112 176 Q90 140 80 118 M188 156 Q240 120 256 80" fill="none" stroke="#a88a5a" stroke-width="3" stroke-dasharray="5 4"/>`:""}
  ${cv.rail?rail("M112 178 Q150 110 160 66")+rail("M112 178 Q220 150 256 84 Q300 100 336 112"):""}
  ${cv.factory?road("M112 178 Q200 200 312 234")+road("M112 178 Q60 200 0 210"):""}
  ${cv.power?[[130,150],[170,110],[220,120],[270,160],[300,200]].map(([x,y])=>`<path d="M${x} ${y} V${y-18} M${x-5} ${y-15} H${x+5}" stroke="#5b5048" stroke-width="1.5"/>`).join("")+`<path d="M130 135 Q150 128 170 95 Q195 98 220 105 Q245 132 270 145 Q285 170 300 185" fill="none" stroke="#333" stroke-width=".8"/>`:""}
  ${cv.rail?`<g ${RM?'transform="translate(200,130)"':""}><rect x="-9" y="-6" width="18" height="10" rx="2" fill="#3d4650"/><rect x="-9" y="-12" width="7" height="7" fill="#5b6470"/><circle cx="-5" cy="5" r="2.2" fill="#222"/><circle cx="5" cy="5" r="2.2" fill="#222"/><circle cx="6" cy="-12" r="3.5" fill="#ddd" opacity=".75"/>${RM?"":`<animateMotion dur="10s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;.5;1" calcMode="linear" path="M112 178 Q220 150 256 84 Q300 100 336 112"/>`}</g>`:""}
  ${cv.mill?[[176,96],[204,90]].map(([x,y])=>`<g transform="translate(${x},${y})"><rect x="-8" y="-10" width="16" height="12" fill="#7a3a2a"/><rect x="2" y="-24" width="4" height="16" fill="#5a2a1e"/><circle class="fsmoke" cx="4" cy="-28" r="4" fill="#999" opacity=".6"/></g>`).join(""):""}
  ${cv.inst?`${[[36,210],[64,226],[88,240],[130,232],[150,250]].map(([x,y],i)=>`<g transform="translate(${x},${y})"><rect x="-7" y="${-14-i%3*8}" width="14" height="${14+i%3*8}" fill="${["#8fa3b5","#a9bccb","#7f95a8"][i%3]}"/>${[0,1,2].map(j=>`<rect x="-4" y="${-11-i%3*8+j*5}" width="3" height="2.5" fill="#ffe27a"/><rect x="1" y="${-11-i%3*8+j*5}" width="3" height="2.5" fill="#ffe27a"/>`).join("")}</g>`).join("")}
    ${[[282,170],[300,160]].map(([x,y])=>`<g transform="translate(${x},${y})"><path d="M0 0 V-22" stroke="#eee" stroke-width="2"/><g transform="translate(0,-22)"><g class="spin"><path d="M0 0 L0 -10 M0 0 L9 5 M0 0 L-9 5" stroke="#fff" stroke-width="2"/></g></g></g>`).join("")}`:""}
  ${owned("waterwheel")?`<g transform="translate(160,140)"><g class="spin"><circle r="9" fill="none" stroke="#7a5636" stroke-width="3"/><path d="M-9 0 H9 M0 -9 V9" stroke="#7a5636" stroke-width="2"/></g></g>`:""}
  <g transform="translate(112,180) scale(1.3)">${baseArt(cv)}</g>
  </svg>`;
}
/* 拠点の絵：作った設備だけを並べる（何もなければ草地の空き地） */
function baseArt(cv){
  const parts = [`<ellipse cx="0" cy="4" rx="26" ry="7" fill="#b9a678" opacity=".55"/>`];
  if(cv.bench) parts.push(`<rect x="-24" y="-2" width="12" height="3" fill="#8a643f"/><path d="M-22 1 V6 M-14 1 V6" stroke="#6e4e30" stroke-width="1.5"/>`);
  if(cv.fire) parts.push(`<path d="M-6 6 L-2 2 L2 6Z" fill="#7a5636"/><path class="idle-flame" d="M-2 4 Q-5 -1 -2 -6 Q1 -1 -2 4Z" fill="#ff9a3c"/><circle class="fsmoke" cx="-1" cy="-11" r="3" fill="#bbb" opacity=".6"/>`);
  if(cv.kiln) parts.push(`<path d="M6 6 Q6 -6 12 -6 Q18 -6 18 6Z" fill="#b4483b"/>`);
  if(cv.hut) parts.push(`<rect x="-36" y="-8" width="12" height="9" fill="#b8926d"/><path d="M-39 -7 L-30 -16 L-21 -7Z" fill="#b8943f"/>`);
  if(cv.smelt) parts.push(`<rect x="22" y="-10" width="8" height="16" fill="#7a3a2a"/><circle class="fsmoke" cx="26" cy="-15" r="4" fill="#999" opacity=".6"/>`);
  if(cv.factory) parts.push(`<rect x="-30" y="-26" width="24" height="14" fill="#7a3a2a"/><path d="M-30 -26 l6 -5 v5 l6 -5 v5 l6 -5 v5 l6 -5 v5" fill="#5a2a1e"/>`);
  if(cv.inst) parts.push(`<rect x="2" y="-34" width="12" height="26" fill="#a9bccb"/>${[-30,-24,-18].map(y=>`<rect x="5" y="${y}" width="3" height="3" fill="#ffe27a"/>`).join("")}`);
  return parts.join("");
}
function regionArt(r, st){
  const cv = CIV();
  const sky = `<rect width="320" height="180" fill="url(#rsky)"/>`;
  const ground = c=>`<rect y="128" width="320" height="52" fill="${c}"/>`;
  switch(r.scene){
    case "forest": return sky+`<path d="M0 110 Q80 80 160 104 T320 100 V180 H0Z" style="fill:var(--hill2)"/>`+ground("#6b8f4e")+
      [[20,128,1.6],[60,124,2],[110,130,1.5],[150,122,2.2],[200,128,1.7],[250,124,2],[296,130,1.6],[86,138,1.2],[230,140,1.2]].map(([x,y,s])=>`<rect x="${x-2*s}" y="${y-6*s}" width="${4*s}" height="${10*s}" style="fill:var(--trunk)"/><path d="M${x-12*s} ${y-4*s} L${x} ${y-34*s} L${x+12*s} ${y-4*s}Z" style="fill:var(--tree)"/>`).join("")+
      (cv.rail?`<path d="M0 166 Q160 150 320 168" stroke="#a88a5a" stroke-width="8" fill="none"/>`:"");
    case "grass": return sky+`<path d="M0 112 Q90 90 180 110 T320 104 V180 H0Z" fill="#9cc49a"/>`+ground("#8fb96e")+
      [[30,150],[70,160],[120,146],[180,162],[240,150],[290,160]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3" fill="#f2b632"/><circle cx="${x+8}" cy="${y+4}" r="2.5" fill="#e889a8"/>`).join("")+
      (cv.rail?`<path d="M0 140 H320" stroke="#5b5048" stroke-width="4"/><path d="M0 140 H320" stroke="#c9b88c" stroke-width="4" stroke-dasharray="1.5 5"/>`:"")+
""
    case "river": return sky+`<path d="M0 100 Q80 86 160 98 T320 94 V180 H0Z" fill="#9cc49a"/>`+ground("#c9b88c")+`<path d="M0 118 Q160 104 320 122 V140 Q160 126 0 140Z" style="fill:var(--sea)"/>`+
      `<g class="waves"><path d="M20 128 q10 -4 20 0 M140 120 q10 -4 20 0 M250 128 q10 -4 20 0" stroke="#fff" fill="none" opacity=".7"/></g>`+
      (owned("waterwheel")?`<g transform="translate(270,118)"><g class="spin"><circle r="20" fill="none" stroke="#7a5636" stroke-width="4"/><path d="M-20 0 H20 M0 -20 V20 M-14 -14 L14 14 M14 -14 L-14 14" stroke="#7a5636" stroke-width="3"/></g></g>`:"");
    case "coast": return sky+`<rect y="96" width="320" height="50" style="fill:var(--sea)"/><g class="waves"><path d="M0 120 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#fff" fill="none" opacity=".7"/></g>`+
      `<path d="M0 140 Q160 126 320 142 V180 H0Z" fill="#e8d9b0"/>`+(cv.power?`<g transform="translate(270,70)"><path d="M0 0 V40" stroke="#ddd" stroke-width="3"/><g class="spin"><path d="M0 0 L0 -18 M0 0 L15 9 M0 0 L-15 9" stroke="#fff" stroke-width="3"/></g></g>`:cv.rail?`<path d="M240 98 h40 l-6 8 h-28z" fill="#3d4650"/><rect x="254" y="86" width="5" height="12" fill="#3d4650"/><circle class="fsmoke" cx="256" cy="80" r="4" fill="#999"/>`:"");
    case "mountain": return sky+`<path d="M-10 140 L80 40 L170 140Z" fill="#7f8a8c"/><path d="M110 140 L220 20 L330 140Z" fill="#6f7a7c"/><path d="M200 42 L220 20 L240 42 Q220 50 200 42Z" fill="#fff"/>`+ground("#9a9c98")+
      (cv.rail?`<path d="M0 160 Q160 140 320 158" stroke="#5b5048" stroke-width="4" fill="none"/>`:"");
    case "cave": return `<rect width="320" height="180" fill="#2a221c"/><radialGradient id="torch" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <rect width="320" height="180" fill="url(#torch)"/>${[20,60,110,170,230,280].map((x,i)=>`<path d="M${x} 0 L${x+8} ${20+i%3*10} L${x+16} 0Z" fill="#4a3a2e"/>`).join("")}<rect y="146" width="320" height="34" fill="#3a2e24"/>`+
      (cv.lights?`<path d="M0 30 H320" stroke="#333"/>${[60,160,260].map(x=>`<circle cx="${x}" cy="34" r="4" fill="#ffe27a"/>`).join("")}`:"");
    case "mine": return sky+`<path d="M0 120 Q60 50 140 80 T320 70 V180 H0Z" fill="#8a6a4a"/><path d="M126 132 Q124 104 140 94 Q152 86 164 95 Q178 106 174 132Z" fill="#2a1e16"/><path d="M118 134 Q130 120 126 108 M176 108 Q182 122 184 134" fill="none" stroke="#6a4f37" stroke-width="4" stroke-linecap="round"/>`+ground("#7a5a3e")+
      (cv.rail?`<path d="M0 158 H320" stroke="#5b5048" stroke-width="4"/><path d="M0 158 H320" stroke="#c9b88c" stroke-width="4" stroke-dasharray="1.5 5"/><rect x="200" y="142" width="26" height="12" fill="#5b6470"/><circle cx="206" cy="156" r="3" fill="#333"/><circle cx="220" cy="156" r="3" fill="#333"/>`:"");
    case "volcano": return `<rect width="320" height="180" fill="#6a3a3a"/><path d="M40 160 L150 30 L260 160Z" fill="#4a2a24"/><path d="M130 50 L150 30 L170 50 Q150 60 130 50Z" fill="#ff7a2a" class="idle-flame"/>
      <g class="fsmoke"><circle cx="150" cy="20" r="12" fill="#999" opacity=".5"/><circle cx="166" cy="10" r="9" fill="#aaa" opacity=".4"/></g><path d="M150 50 Q140 100 120 160" stroke="#ff7a2a" stroke-width="4" fill="none" opacity=".8"/>`+ground("#3a2a24")+
      (cv.power?`<rect x="250" y="116" width="40" height="28" fill="#cfd6dc"/><rect x="258" y="100" width="8" height="18" fill="#cfd6dc"/><circle class="fsmoke" cx="262" cy="94" r="6" fill="#fff" opacity=".6"/>`:"");
    case "oil": return sky+`<rect y="100" width="320" height="80" style="fill:var(--sea)"/><g class="waves"><path d="M0 130 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#fff" fill="none" opacity=".6"/></g>
      <g transform="translate(160,60)"><rect x="-40" y="60" width="80" height="10" fill="#6f7a86"/><path d="M-20 60 L0 -10 L20 60 M-14 36 H14 M-8 14 H8" fill="none" stroke="#3d4650" stroke-width="3"/><rect x="-36" y="70" width="6" height="40" fill="#6f7a86"/><rect x="30" y="70" width="6" height="40" fill="#6f7a86"/><circle cx="0" cy="-14" r="3" fill="#e2572a"/></g>`;
  }
  return sky;
}
/* 地域の資源（採取地点）の残量と再生はエンジンで管理し、セーブに残す */
const depInfo = (rid,id)=>E.depositInfo(S,rid,id);
function renderExplore(v){
  if(S.flags.view!=="2d"){ ensure3D(); if(W3.state!=="failed"){ renderExplore3D(v); return; } }
  renderExplore2D(v);
}
/* 2D表示（3Dが使えないとき・軽い表示を選んだとき）：今いる地域の場面を画面全体に出す */
function renderExplore2D(v){
  const st = stage();
  let r = D.regions.find(x=>x.id===U.region) || D.regions[0];
  if(!E.regionOpen(S,r)){ U.region="forest"; r=D.regions[0]; }
  const sig = "2d|"+st+"|"+r.id+"|"+E.exploreLv(S,r.id)+"|"+W3.state+"|"+civSig();
  if(!v.querySelector(".rscene") || sig!==fieldSig){
    fieldSig = sig;
    v.innerHTML = `<div class="rscene" id="rscene">
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="rsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky1)"/><stop offset="1" style="stop-color:var(--sky2)"/></linearGradient></defs>${regionArt(r,st)}</svg>
      <div class="rnodes" id="rnodes">${r.res.map(x=>nodeHTML(r,x)).join("")}</div></div>
      <div class="note2d">${W3.state==="failed"?"3D表示が使えないため、2Dで表示中。":""}光っている資源をタップして採取。地域の移動は右上の「地図」から。</div>`;
  }
  updateLoc(); updateAction3D();
}
function in3D(){ return S.flags.view!=="2d" && W3.state!=="failed"; }
/* ---------- 世界の地図（広い世界。地形関数から一度だけ描いて覚える。今いる所・地域・登山道を重ねる） ---------- */
let WMAP = null;
function worldMapImage(){
  if(WMAP) return WMAP; if(!window.TERRAIN || !TERRAIN.waterAt) return null;
  /* 外の野（試験範囲・半径 WALK_R）まで描く */
  const N=240, R=TERRAIN.WALK_R ? TERRAIN.WALK_R+6 : 180, c=document.createElement("canvas"); c.width=N; c.height=N; const g=c.getContext("2d"), img=g.createImageData(N,N), cfg=TERRAIN.DEFAULT_CONFIG;
  const H=(x,z)=>TERRAIN.terrainHeight(x,z,cfg);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const x=-R+(i+0.5)*2*R/N, z=-R+(j+0.5)*2*R/N, h=H(x,z), w=TERRAIN.waterAt(x,z,h), k=(j*N+i)*4;
    const sl=Math.max(Math.abs(H(x+0.75,z)-H(x-0.75,z)), Math.abs(H(x,z+0.75)-H(x,z-0.75)))/1.5, shade=0.82+Math.max(-0.2,Math.min(0.2,(H(x-1,z-1)-h)*0.25));
    let col;
    if(w.kind && w.kind!=="river" && w.depth > TERRAIN.WADE_DEPTH) col=[46,108,150];
    else if(w.kind) col=[96,170,200];
    else if(TERRAIN.dominantArea(x,z)==="coast" && h < 2.2) col=[228,212,165];
    else if(TERRAIN.dominantArea(x,z)==="desert") col=[214,186,128];
    else if(TERRAIN.dominantArea(x,z)==="volcano") col=[120+Math.min(40,h*2),88,76];
    else if(TERRAIN.dominantArea(x,z)==="snow" && h > 6) col=[228,232,238];
    else if(sl > TERRAIN.WALK_SLOPE) col=[132,122,110];
    else if(h > 30) col=[232,236,240];
    else if(h > 16) col=[150,150,128];
    else col=[110+Math.min(40,h*3),160-Math.min(30,h*1.5),90];
    const outside = TERRAIN.WALK_R ? Math.hypot(x,z) > TERRAIN.WALK_R : (x < TERRAIN.WALK.minX || x > TERRAIN.WALK.maxX || z < TERRAIN.WALK.minZ || z > TERRAIN.WALK.maxZ);
    if(outside) col=col.map(v=>v*0.62+70);
    img.data[k]=col[0]*shade; img.data[k+1]=col[1]*shade; img.data[k+2]=col[2]*shade; img.data[k+3]=255;
  }
  g.putImageData(img,0,0);
  const P=(x,z)=>[(x+R)/(2*R)*N, (z+R)/(2*R)*N];
  g.strokeStyle="#c9a25a"; g.lineWidth=1.6; Object.values(TERRAIN.TRAILS).forEach(t=>{ g.beginPath(); t.pts.forEach((p,i)=>{ const q=P(p.x,p.z); i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]); }); g.stroke(); });
  g.strokeStyle="rgba(255,255,255,.85)"; g.lineWidth=1; const a=P(-60,-60), b=P(60,60); g.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
  WMAP={canvas:c, P, N}; return WMAP;
}
function drawWorldMap(){
  const cv=$("#wmap"); if(!cv) return; const m=worldMapImage(); if(!m) return; const g=cv.getContext("2d");
  g.drawImage(m.canvas,0,0);
  g.font="bold 10px sans-serif"; g.textAlign="center";
  const lab=(x,z,t)=>{ const q=m.P(x,z); g.fillStyle="rgba(0,0,0,.55)"; g.fillText(t,q[0]+0.8,q[1]+0.8); g.fillStyle="#fff"; g.fillText(t,q[0],q[1]); };
  lab(TERRAIN.PEAK.x, TERRAIN.PEAK.z-6, "⛰ 雪山"); lab(TERRAIN.FALL.pool.x+7, TERRAIN.FALL.pool.z+4, "滝"); lab(TERRAIN.LAKE.x, TERRAIN.LAKE.z+3, "湖畔"); lab(166, 30, "海岸");
  lab(-128, -110, "火山"); lab(-128, 125, "砂漠"); lab(108, 112, "平地"); lab(D.base.x, D.base.z-5, "拠点");
  if(W3.pos){ const q=m.P(W3.pos.x,W3.pos.z); g.fillStyle="#e0434f"; g.strokeStyle="#fff"; g.lineWidth=2; g.beginPath(); g.arc(q[0],q[1],4.5,0,Math.PI*2); g.fill(); g.stroke(); }
}
/* 動けなくなったとき：拠点（安全な場所）へ瞬間移動する */
function rescue(){
  if(!world() || !W3.gfx) return;
  haltField();
  const q = WORLD.safeSpawn(S, {x:D.base.x, z:D.base.z});
  W3.pos = {x:q.x, z:q.z}; S.pos = {x:+q.x.toFixed(2), z:+q.z.toFixed(2), dir:W3.dir}; save();
  W3.gfx.setPlayerVisualState(playerVisual({position:W3.pos, direction:W3.dir, moving:false}));
  try{ if(W3.gfx.cameraRig && W3.gfx.cameraRig.snapToTarget) W3.gfx.cameraRig.snapToTarget(); }catch(e){}
  if(W3.world && W3.world.afterWarp) W3.world.afterWarp(W3.pos.x, W3.pos.z);     // 足もとの地形の区画を今すぐ用意（読み込み待ちで地面が抜けないように）
  camRebase();     // カメラの高さの基準を新しい場所の足もとへ
  syncAll3D(); banner("🛟 拠点へ瞬間移動した");
}
/* 広い世界の地名（山麓・中腹・海岸・滝つぼ など。旧世界の中は null） */
function placeHere(){ if(!W3.pos || !window.TERRAIN || !TERRAIN.placeName) return null; return TERRAIN.placeName(W3.pos.x, W3.pos.z, groundY(W3.pos.x, W3.pos.z)); }
function updateLoc(){
  const el=$("#hudLoc"); if(!el) return;
  const r = in3D() ? W3.region : D.regions.find(x=>x.id===U.region);
  el.innerHTML = r ? `${r.icon} <b>${r.name}</b><small>探索Lv${E.exploreLv(S,r.id)}</small>`
    : in3D() && W3.state!=="ready" ? `🌄 <b>準備中</b>` : in3D() && W3.moving ? `🧭 <b>移動中</b><small>${placeHere()||"地域の外"}</small>` : `🧭 <b>地域の外</b><small>${placeHere()||"野原"}</small>`;
}
function drawRegion(){
  const r = (in3D() && W3.region) || D.regions.find(x=>x.id===U.region); const box=$("#regionBox"); if(!box || !r) return;
  const lv = E.exploreLv(S,r.id), nx = E.nextLv(S,r.id), slots=E.autoSlots(S), base=E.LV[lv]||0;
  const lvText = ["珍しい発見が出やすくなった","採取量＋1・珍しい発見を1つ見つけた","珍しい発見がさらに出やすくなった"];
  box.innerHTML = `<div class="regioncard">
    <div class="rhead"><span class="ri">${r.icon}</span><div style="flex:1;min-width:0"><h3>${r.name}${in3D()&&W3.region!==r?' <small style="font-weight:700;color:var(--muted);font-size:.75rem">（最後にいた地域）</small>':""}</h3><div class="kid">${r.kid}</div></div>
      <div class="lv"><b>探索Lv${lv}</b><div class="m"><i style="width:${nx?Math.min(100,(nx.now-base)/(nx.need-base)*100):100}%"></i></div><small>${nx?nx.now+"/"+nx.need:"最大"}</small></div></div>
    <p class="desc" style="margin:0 0 6px">${lv?"⭐ "+lvText.slice(0,lv).join("／"):"たくさん採取すると探索Lvが上がり、ごほうびがあるよ。"}</p>
    <div class="reslist">${r.res.map(x=>{ const g=E.gatherInfo(S,r,x), k=S.disc[x.id], au=S.auto.some(a=>a.r===r.id&&a.id===x.id);
      return `<div class="res"><span class="i">${k?ic(x.id):"❔"}</span><span class="nm">${k?nm(x.id):"何かありそう…"} ${k?`<small>${IT[x.id].kid}</small>`:""}${!g.ok?`<small style="color:var(--clay)">🛠️ ${g.reason}</small>`:`<small>1回で${g.n}個・所持${E.cnt(S,x.id)}個</small>`}</span>
      ${k&&slots&&g.ok?`<button class="auto" data-act="auto" data-r="${r.id}" data-id="${x.id}" aria-pressed="${au}">🧺 自動</button>`:""}</div>`; }).join("")}
    ${(r.rare||[]).length?`<div class="res"><span class="i">✨</span><span class="nm">珍しい発見 <small>${r.rare.map(x=>S.disc[x.id]?ic(x.id)+nm(x.id):"❔？？？").join("・")}</small></span></div>`:""}
    ${slots?`<p class="desc">🧺 自動採取：${S.auto.length}/${slots}枠（ページを開いている間、10秒ごとに集める）</p>`:""}
    </div></div>`;
}
function nodeHTML(r,x){
  const key = E.resKey(x), g = E.gatherInfo(S,r,x), k=S.disc[x.id], n=depInfo(r.id,key), regrow = g.ok && n.left<=0;
  const rule = E.depositRule(S,r.id,key), pct = regrow && n.until ? Math.max(0,Math.min(100,100-(n.until-Date.now())/rule.regrow*100)) : 100;
  return `<button class="node ${g.ok?"":"nlock"} ${regrow?"regrow":""}" id="n-${key}" style="left:${x.p[0]}%;top:${x.p[1]}%;--p:${pct}" data-act="gather" data-r="${r.id}" data-id="${key}" aria-label="${k?nm(x.id):"未発見の資源"}${g.ok?"":"（"+g.reason+"）"}">
    <span class="ni">${g.ok?(k?ic(x.id):"❔"):"🛠️"}</span><span class="nl">${k?nm(x.id):"？"}</span><span class="pips">${regrow||!isFinite(n.left)?"":"●".repeat(Math.min(n.left,8))}</span></button>`;
}
function floatText(el, text, cls){
  const sc=$("#rnodes"); if(!sc||!el) return;
  const f=document.createElement("span"); f.className="float "+(cls||""); f.innerHTML=text;
  f.style.left=el.style.left; f.style.top=el.style.top; sc.appendChild(f); setTimeout(()=>f.remove(), RM?600:1100);
}
function banner(text){ const b=$("#banner"); if(!b) return; b.textContent=text; b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); }
const TOOLFX = {forest:"🪓",mountain:"⛏️",mine:"⛏️",cave:"⛏️",volcano:"⛏️",river:"✋",coast:"✋",grassland:"✋",oilfield:"🛢️"};
/* 2D表示での採取（地域の採取地点。残量・二重取得防止はエンジン） */
function doGather(rid, id){
  if(U.tab!=="explore" || modalOpen()) return;
  const r = D.regions.find(x=>x.id===rid), res=r.res.find(x=>E.resKey(x)===id), el=$("#n-"+id), item=res?res.id:id;
  const inf = depInfo(rid,id);
  if(!inf.ok){ floatText(el, inf.kind==="empty"?"もうすぐ戻る…":inf.reason, "ng"); return; }
  const now=Date.now(); U.combo = (now-U.lastGather<1600) ? U.combo+1 : 1; U.lastGather=now;
  const lvBefore = E.exploreLv(S,rid);
  const out = E.harvestDeposit(S,rid,id,{combo:U.combo, token:S.seq});
  if(!out.ok){ floatText(el,out.reason,"ng"); return; }
  const sc=$("#rnodes");
  const sw=document.createElement("span"); sw.className="swing"; sw.textContent=owned("steamengine")&&["mine","mountain"].includes(rid)?"⚙️":TOOLFX[rid]||"✋";
  if(el&&sc){ sw.style.left=el.style.left; sw.style.top=el.style.top; sc.appendChild(sw); setTimeout(()=>sw.remove(),500); }
  floatText(el, (out.crit?"会心！ ":"")+ic(item)+"＋"+out.n, out.crit?"crit":"");
  const cb=$("#combo"); if(cb){ cb.textContent = U.combo>=2 ? "コンボ×"+U.combo+(U.combo%5===0?"　おまけ＋1！":"") : ""; cb.classList.toggle("on",U.combo>=2); }
  afterChange(out.news);
  if(E.exploreLv(S,rid)!==lvBefore || out.news.length){ fieldSig=""; renderField(); drawRegion(); }
  else { const ne=$("#n-"+id); if(ne){ ne.outerHTML = nodeHTML(r,res); const nn=$("#n-"+id); if(nn&&!RM) nn.classList.add("hit"); } }
  if(out.rares.length) banner("✨ 珍しい発見！ "+out.rares.map(nm).join("・"));
  else if(out.lvUp) banner("⭐ 探索Lv"+out.lvUp+"に上がった！");
  else processHint(out.news);
}
/* 新しく見つけた素材を、まだ加工できないとき：足りない設備・道具を具体的に知らせる（採れる＝加工できる、ではない） */
function processHint(news){
  const id = (news||[]).find(k=>IT[k] && IT[k].tags.includes("天然資源") && E.processBlock(S,k)); if(!id) return false;
  banner("🧰 "+E.processBlock(S,id).text+"（"+nm(id)+"は持ち物に保管した）"); return true;
}
function travel(rid){
  const r = D.regions.find(x=>x.id===rid);
  if(!E.regionOpen(S,r)) return;     // 準備中の地域だけ（地域の鍵は 2026-11-11 に廃止）
  U.region=rid; U.combo=0; fieldSig="";
  setTab("explore"); renderField(); banner(r.icon+" "+r.name+"に着いた");
}
setInterval(()=>{ if(!$("#rscene")) return; const r=D.regions.find(x=>x.id===U.region); if(!r) return;
  r.res.forEach(x=>{ const key=E.resKey(x), el=$("#n-"+key); if(!el) return; const html=nodeHTML(r,x); if(el._h!==html){ el.outerHTML=html; const ne=$("#n-"+key); if(ne) ne._h=html; } });
}, 1000);

/* ===================== 3Dフィールド（HD-2D描画モジュールとの連携） =====================
   座標・移動・採取・建築の判定はすべてこちら（ゲーム側）が正本。
   描画モジュールには setPlayerVisualState / updateResourceVisual / addStructureVisual などで
   結果だけを渡す。座標系：ゲーム座標＝シーン座標（右手系・Y上・1単位＝1マス）。 */
const W3 = { state:"idle", err:"", gfx:null, host:null, cfg:null, pos:null, dir:"down", moving:false,
  target:null, autoGather:null, keys:{}, joy:null, near:null, region:null, lastTs:0, raf:0,
  structs:new Set(), visSig:{}, lastSave:0, blockAt:-1e9, tick:0, labelEls:{} };
const WORLD_R = 56,  /* 地形は120×120の正方形。端の丘の手前で止める */ REGION_R = 9, NEAR_R = 2.6;
const MOBILE = matchMedia("(pointer:coarse)").matches || innerWidth < 900;
const RES_VIS = {twig:"branch",cobble:"pebble",flint:"pebble",log:"tree",resin:"tree",wax:"tree",bark:"tree",seed:"tree",
  leaves:"herb",vine:"herb",grass:"herb",seaweed:"herb",grape:"flowers",clay:"clay",ochre:"clay",sand:"clay",
  rain:"water",river:"water",spring:"water",seawater:"water",crude:"oil"};
const PLANT = ["tree","herb","flowers"];
const heroAssetKey = ()=> (S.flags.hero==="girl"?"girl":"boy")+(SPACE.state(S).suit?"Suit":"");
const heroUrl = ()=> ASSETS[heroAssetKey()] || (S.flags.hero==="girl"?ASSETS.girl:ASSETS.boy);
let NODES = null;
/* 地域の採取地点（3D上の位置はエンジンの depositPos） */
function buildNodes(){
  NODES = [];
  D.regions.forEach(r=>{ if(!r.w) return;
    r.res.forEach((res,i)=>{
      const pos = E.depositPos(r,res), key = E.resKey(res), sh = NATURE.depShape(res)||{};
      NODES.push({key:r.id+":"+key, rk:key, vid:E.depositId(r.id,key), r, res, pos,
        type:sh.vis||RES_VIS[res.id]||"rock", rot:(i*1.7)%6.28, scale: res.loose ? 0.7 : sh.vis==="tree"?1.1:1});
    }); });
}
function nodeVisual(n){
  const inf = depInfo(n.r.id, n.rk);
  const t={n}; return {position:n.pos, type:n.type, rotationY:n.rot, scale:n.scale, depleted: inf.left<=0, highlighted: tSame(W3.near,t) || tSame(W3.sel,t), visible:true,
    phase: W3.work && tSame(W3.work.t,t) ? "reacting" : "idle"};
}
function syncNode(n, force){
  if(!W3.gfx) return;
  const v = nodeVisual(n), sig = v.depleted+"|"+v.highlighted+"|"+v.phase;
  if(!force && W3.visSig[n.vid]===sig) return;
  W3.visSig[n.vid]=sig; W3.gfx.updateResourceVisual(n.vid, v);
}
/* ---------- フィールドの自然物（正本は nature.js。描画には状態だけを渡す） ---------- */
let WORLD = null;
function world(){
  /* 広い世界（2026-11-07）：地形・水・歩ける範囲・地方の性格・登山道は TERRAIN（src/world/shape.ts。描画と同じ関数） */
  if(!WORLD && window.TERRAIN && window.NATURE) WORLD = NATURE.create(D, E, Object.assign({}, TERRAIN, {cfg:TERRAIN.DEFAULT_CONFIG,
    riverCenterX: TERRAIN.riverCenterX ? (z=>TERRAIN.riverCenterX(z, TERRAIN.DEFAULT_CONFIG)) : null}));
  return WORLD;
}
/* 描画モジュールの資源タイプ（INTEGRATION.md §13）。落ち枝は branch、小石は pebble。
   寸法は getResourceVisualSpecs と照合した（当たり判定の正本は nature.js） */
const NAT_VIS = {tree:o=>["tree",o.scale], rock:o=>["rock",o.scale], pebble:o=>["pebble",0.75*o.scale], twig:o=>["branch",0.8*o.scale], grass:o=>["grass",o.scale], bush:o=>["bush",o.scale]};
const NAT_SHOW_R = 32, NAT_HIDE_R = 38;
function natVisual(o){
  const v = WORLD.visual(S,o), [type,scale] = NAT_VIS[o.kind](o);
  return {position:v.position, type, rotationY:o.rot, scale, depleted: v.state!=="intact", visible: v.state!=="gone",
    highlighted: (W3.sel&&W3.sel.o===o) || (W3.near&&W3.near.o===o), phase: W3.work && W3.work.t.o===o ? "reacting" : "idle",
    natural:{id:o.id, kind:o.kind, variant:o.variant, state:v.state, collider:v.collider, left:v.left, uses:v.uses}};
}
/* 自然物を描画モジュールへ渡すのは、近くの格子（WORLD.around）にあって画面の中（＋余白）に入るものだけ。
   全件を毎回走査しない・画面外の木を描かない（スマホの負荷対策）。出し入れには余白の差（ヒステリシス）を付ける */
function onScreenish(x, z, h, margin){
  const s=toScreen(x, groundY(x,z)+h, z); if(!s.ok) return false;
  const r=$("#w3").getBoundingClientRect(), mx=r.width*margin, my=r.height*margin;
  return s.x>-mx && s.x<r.width+mx && s.y>-my && s.y<r.height+my*1.6;   // 下側は背の高い木の樹冠が入るので広め
}
function syncNature(force){
  if(!W3.gfx || !world() || !W3.pos) return;
  const shown = W3.natShown || (W3.natShown = new Set());
  const hide = o=>{ W3.gfx.updateResourceVisual(o.id, null); shown.delete(o.id); delete W3.visSig[o.id]; };
  const near = WORLD.around(W3.pos.x, W3.pos.z, NAT_HIDE_R), seen = new Set();
  near.forEach(o=>{
    seen.add(o.id);
    const h = o.kind==="tree" ? 2*o.scale : 0.3, keep = W3.sel&&W3.sel.o===o || W3.near&&W3.near.o===o;
    const inView = keep || onScreenish(o.x, o.z, h, shown.has(o.id) ? 0.45 : 0.22);
    if(!inView){ if(shown.has(o.id)) hide(o); return; }
    const v = natVisual(o), sig = v.natural.state+"|"+v.highlighted+"|"+v.phase;
    if(!force && shown.has(o.id) && W3.visSig[o.id]===sig) return;
    W3.visSig[o.id]=sig; shown.add(o.id); W3.gfx.updateResourceVisual(o.id, v);
  });
  /* 飾り（睡蓮・溶岩）：採れない・選べない。画面に入るものだけ描く */
  (WORLD.decos||[]).forEach(d=>{ if(Math.abs(d.x-W3.pos.x)>NAT_HIDE_R || Math.abs(d.z-W3.pos.z)>NAT_HIDE_R) return;
    const inView = onScreenish(d.x, d.z, 0.2, shown.has(d.id) ? 0.45 : 0.22); seen.add(d.id);
    if(!inView){ if(shown.has(d.id)){ W3.gfx.updateResourceVisual(d.id, null); shown.delete(d.id); } return; }
    if(!shown.has(d.id)){ W3.gfx.updateResourceVisual(d.id, {position:{x:d.x, z:d.z}, type:d.type, rotationY:d.rot, scale:d.scale, visible:true}); shown.add(d.id); } });
  [...shown].forEach(id=>{ if(!seen.has(id)){ const o=WORLD.byId.get(id); if(o) hide(o); else { W3.gfx.updateResourceVisual(id, null); shown.delete(id); } } });
}
/* 文明の段階に合わせて拠点の建物が増えていく（フィールドの進化） */
/* 拠点の建物：プレイヤーが工作で作った設備（E.has＝所持）に1対1で対応させる。
   段階（stage）や研究の完了だけでは建物を出さない（開始時の原野に人工物を置かない）。
   セーブには建物を保存せず、毎回ここから決める（旧版で段階によって自動で出ていた小屋・石の家なども、読み込み時に消える）。 */
const STRUCT_PLAN = [
  {id:"st-bench",   type:"workbench",  at:{x:-17,z:23},   when:()=>owned("bench")},
  {id:"st-fire",    type:"campfire",   at:{x:-21.5,z:25.5}, when:()=>owned("campfire")},
  {id:"st-kiln",    type:"kiln",       at:{x:-25.5,z:19.5}, when:()=>owned("kiln")},
  {id:"st-hut1",    type:"hut",        at:{x:-27,z:12},   when:()=>owned("storehouse")},
  {id:"st-smelter", type:"smelter",    at:{x:-13.5,z:15}, when:()=>owned("furnace")||owned("blastfurnace")},
  {id:"st-lab",     type:"laboratory", at:{x:-21,z:9},    when:()=>owned("still")},
  {id:"st-steam",   type:"steam-engine", at:{x:-31,z:21}, when:()=>owned("steamengine")},
  {id:"st-tower",   type:"distillation-tower", at:{x:-27,z:28}, when:()=>owned("refinery")},
  {id:"st-factory", type:"factory",    at:{x:-10,z:30},   when:()=>owned("eaf")},
  /* 発電所のモデルは火力型（オーナー決定 2026-11-07：段階建物として扱う）。火力発電＝蒸気機関で発電機を回すので、
     暫定で「蒸気機関」と「水力発電機」の両方を作ったときに建てる（水力だけなら水車が表す）。登場段階・位置づけは GPT・オーナーと確認中 */
  {id:"st-power",   type:"power-plant",at:{x:-7,z:13},    when:()=>owned("steamengine") && owned("generator")},
  {id:"st-inst",    type:"research-institute", at:{x:-30,z:31}, when:()=>owned("reactor")},
  /* 拠点の外：水車は川岸（nature.js の SITES で自然物を置かない）、掘削やぐらは油田の原油のそば */
  {id:"st-wheel",   type:"waterwheel", at:{x:15.2,z:3.8}, rot:2.17, rule:"waterside", when:()=>owned("waterwheel")},
  {id:"st-rig",     type:"drilling-rig", at:{x:3.2,z:48}, when:()=>owned("rig")},
];
/* 建物を置く・取り除く（描画・GLB の読み込み・当たり判定をまとめて扱う）。W3.structInfo：id → {type,x,z,rot} */
function structAdd(id, type, at, rot){
  (W3.structInfo || (W3.structInfo = new Map())).set(id, {type, x:at.x, z:at.z, rot:rot||0});
  W3.gfx.addStructureVisual(id, type, at, rot||0); W3.structs.add(id);
  /* Muse の GLB（assets/buildings-3d）。読み終えたら、その種類の建物を置き直して GLB の見た目にする（それまでは従来の手続きモデル） */
  const H=window.HD2D;
  const glb = (ASSETS.buildings && ASSETS.buildings[type]) || (ASSETS.props && ASSETS.props[type]) || (ASSETS.town && ASSETS.town[type]);
  if(H && H.ensureBuildingModel && glb){
    H.ensureBuildingModel(W3.gfx, type, glb).then(ok=>{ const done=(W3.modelReady||(W3.modelReady=new Set()));
      if(!ok || done.has(type)) return; done.add(type);
      W3.structInfo.forEach((v,k)=>{ if(v.type===type && W3.structs.has(k)){ W3.gfx.removeStructureVisual(k); W3.gfx.addStructureVisual(k, v.type, {x:v.x, z:v.z}, v.rot); } }); });
  }
}
function structRemove(id){ W3.gfx.removeStructureVisual(id); W3.structs.delete(id); if(W3.structInfo) W3.structInfo.delete(id); }
/* 当たり判定：建物の占有形状（structures.json の footprint）を自然物の世界へ渡す。プレビュー（vps:）は判定なし */
function syncStructColliders(){
  if(!world()) return;
  const list=[]; (W3.structInfo||new Map()).forEach((v,id)=>{ if(id.startsWith("vps:") || id.startsWith("ghost:") || id.startsWith("cs:")) return; const sp=(ASSETS.buildingSpecs && ASSETS.buildingSpecs[v.type]) || (ASSETS.propSpecs && ASSETS.propSpecs[v.type]) || (ASSETS.townSpecs && ASSETS.townSpecs[v.type]);
    if(sp && sp.footprint) list.push({id, type:v.type, x:v.x, z:v.z, rot:v.rot, footprint:sp.footprint}); });
  if(SPACE.placed(S)){
    const b=S.build['space-site'];
    /* 発射サイト全体（18×18）は「歩けるが建てられない」予約範囲（walk）。個別の設備の形（下）だけだと、その隙間に建物や道を置けてしまっていた
       （docs/space/REVIEW-PR4-2026-11-14.md の指摘 7）。歩く・押し出し・経路には使わないので、搭乗口への道筋は個別の形のまま */
    list.push({id:'space-site:area',type:'space-site',x:b.x,z:b.z,rot:b.rot,footprint:D.space.siteSpec.footprint,walk:true});
    for(const model of ASSETS.spaceContract.models){
      const pos=ASSETS.spacePlacement[model.id], c=model.collision;if(!pos||!c||!['box','cylinder'].includes(c.shape))continue;
      const x=b.x+pos[0]*Math.cos(b.rot)+pos[1]*Math.sin(b.rot), z=b.z-pos[0]*Math.sin(b.rot)+pos[1]*Math.cos(b.rot);
      list.push({id:'space-site:'+model.id,type:'space-site',x,z,rot:b.rot,footprint:c.shape==='box'?{shape:'rect',w:c.w,d:c.d}:{shape:'circle',r:c.radius}});
    }
  }
  CONS.colliders(S).forEach(c=>list.push(c));   /* 街づくり：完成・施工中は壁、予定地と広場は歩ける（ほかの建物は置けない） */
  const sig=JSON.stringify(list); if(sig===W3.colSig) return; W3.colSig=sig;
  WORLD.setStructures(list);
  /* 建物の中に入ってしまったら、近くの立てる場所へ（歩行にはしない） */
  if(W3.pos && !WORLD.free(S, W3.pos.x, W3.pos.z)){ const q=WORLD.nearestFree(S, W3.pos, Date.now(), 8); if(q){ W3.pos={x:q.x, z:q.z}; W3.path=null; W3.target=null;
    W3.gfx.setPlayerVisualState(playerVisual({position:W3.pos, direction:W3.dir, moving:false})); } }
  syncNature(true);      // 建物の下になった自然物を隠す・戻す
}
/* 建物の置き場所：S.build の記録（自由設置）を優先し、なければ決まった場所。撤去したもの・移動中のものは出さない */
const buildRec = id=> (S.build||{})[id];
function planPos(p){ const b=buildRec(p.id); if(b && !b.removed) return {x:b.x, z:b.z, rot:b.rot};
  return {x:p.at.x, z:p.at.z, rot: p.rot!=null ? p.rot : Math.atan2(D.base.x-p.at.x, D.base.z-p.at.z)}; }
function planOwned(p){ return S.verify ? placedSet().has(p.id) : p.when(); }
function planWanted(p){ const b=buildRec(p.id); if(b && b.removed) return false; if(W3.place && W3.place.id===p.id) return false; return planOwned(p); }
function syncStructures(){
  if(!W3.gfx) return;
  /* 検証モードでは「全部持っている」ので、設備の所持ではなく、検証メニューで置いた物だけを建てる（原野を保つ） */
  /* 街づくりのルールでは、固定の場所の建物（STRUCT_PLAN）は出さない（検証メニューで置いた物だけ）。建物は CONS の完成した物 */
  const fixed = !E.buildRule(S) || !!S.verify;
  STRUCT_PLAN.forEach(p=>{ const want=fixed && planWanted(p), pos=planPos(p); let has=W3.structs.has(p.id);
    const info = has && W3.structInfo && W3.structInfo.get(p.id);
    if(want && has && info && (Math.abs(info.x-pos.x)>1e-3 || Math.abs(info.z-pos.z)>1e-3 || Math.abs(info.rot-pos.rot)>1e-4)){ structRemove(p.id); has=false; }   // 移動・回転した
    if(want && !has){ structAdd(p.id, p.type, {x:pos.x, z:pos.z}, pos.rot);
      const seen = W3.everShown || (W3.everShown = new Set());
      if(W3.state==="ready" && !seen.has(p.id)) W3.gfx.playVisualEffect("levelup", {x:pos.x, z:pos.z}); seen.add(p.id); }
    else if(!want && has) structRemove(p.id); });
  /* 検証メニューで足もとに置いた建物（STRUCT_PLAN にない種類も試せる） */
  const extra = (S.verify && S.verify.extra) || [], ids = new Set(extra.map(x=>x.id));
  extra.forEach(x=>{ if(!W3.structs.has(x.id)) structAdd(x.id, x.type, {x:x.x, z:x.z}, x.rot||0); });
  [...W3.structs].forEach(id=>{ if(id.startsWith("vx:") && !ids.has(id)) structRemove(id); });
  syncVillage();
  consSync();
  syncStructColliders();
}
function syncAll3D(){ if(!NODES) buildNodes(); NODES.forEach(n=>syncNode(n,true)); syncNature(true); syncStructures(); }

(function(){ const m=document.getElementById("gfxmod"); if(m) m.addEventListener("error", ()=>{ W3.modErr=true; if(W3.state==="loading" && !window.HD2D){ W3.state="failed"; W3.err="3D描画モジュール（Three.js）を読み込めませんでした。通信環境かブラウザの制限が原因かもしれません。"; renderField(); } }); })();
function ensure3D(){
  if(W3.state!=="idle") return;
  W3.state="loading";
  const go=()=>{ if(W3.state==="loading") start3D(); };
  if(window.HD2D) go();
  else if(W3.modErr){ W3.state="failed"; W3.err="3D描画モジュール（Three.js）を読み込めませんでした。通信環境かブラウザの制限が原因かもしれません。"; }
  else { window.addEventListener("hd2d-ready", go, {once:true});
    setTimeout(()=>{ if(W3.state==="loading" && !window.HD2D){ W3.state="failed"; W3.err="3D描画モジュール（Three.js）を読み込めませんでした。通信環境かブラウザの制限が原因かもしれません。"; renderField(); } }, 15000); }
}
/* カメラの値は描画モジュール（Muse）の既定値を正とし、ゲーム側からは上書きしない。
   確認用に限り、URL に ?camera=俯角,viewSize（例：?camera=32,16）を付けたときだけ
   既存の公開オプション config.camera で渡す。 */
function cameraPreview(){
  try{ const q=new URLSearchParams(location.search).get("camera"); if(!q) return null;
    const [p,v]=q.split(",").map(Number);
    return (p>=20 && p<=60 && v>=10 && v<=40) ? {pitchDegrees:p, viewSize:v} : null; }catch(e){ return null; }
}
/* 開始時の景観は手つかずの自然にする。描画モジュールが独自に置く石の階段・石積みの壁（Stonework）は
   decor.stonework:false で描かせない（Muse §19。以前のシーン走査で取り除く処理はこれに置き換えた）。
   建物はゲームの STRUCT_PLAN（プレイヤーが作った設備）だけから置く。 */
async function start3D(){
  try{
    W3.host = document.createElement("div"); W3.host.className="w3canvas";
    const slot=$("#w3slot"); if(slot) slot.appendChild(W3.host);
    const cam = cameraPreview();
    /* 地形の高さの公開口（Muse ラウンド22 config.world.heightAt）：モジュールの地形・接地・水深をゲームの worldHeight に従わせる。
       ビルドの差し替え（terrain-shim）も残す：モジュールの EnvironmentRenderer はまだ import した terrainHeight を直接使うため（Muse §20） */
    const hcfg = HD2D.resolveConfig(), heightAt = (x,z)=>TERRAIN.terrainHeight(x,z,hcfg);
    /* 登山道の見た目（Muse ラウンド28、§25.2.1）：地形 v4 が平らにした踏み跡を、描画モジュールの
       config.world.paths 口へ渡す。色はモジュール側（踏み固めた土・砂利）。歩行判定は従来どおりゲーム側 */
    const cover = {...(cam?{camera:cam}:{}), world:{heightAt,
      paths:[{points:TERRAIN.TRAILS.volcano.pts, width:1.4}]}};
    W3.cfg = HD2D.resolveConfig(cover);
    W3.gfx = await HD2D.initializeGraphics(W3.host, { config:cover,
      playerSpriteUrl: await heroSheet3D(), grassDetailUrl: ASSETS.grass, rockDetailUrl: ASSETS.rock,
      particleTextureUrl: ASSETS.particle, shadowTextureUrl: ASSETS.shadow,
      quality: MOBILE ? "low" : "high", postEffects: !MOBILE,
      /* 連携契約（docs/handoff/NATURAL-OBJECTS-CONTRACT.md）：木・岩・倒木・小石はゲーム側の自然物として渡すので、
         描画モジュール独自の装飾としては描かない。未対応の版では無視される */
      decor: {trees:false, rocks:false, logs:false, pebbles:false, shrubs:false, stonework:false, waterfall:false},
      /* openWater は切らない（Muse 追補21 の openWater:false は統合前の世界での話）。統合後の世界では湖・海・オアシスの水面は
         このプレーンだけが描く。旧世界の乾いた低地の水面は src/world/render.ts が深さ0にして見せない（docs/world/WIDE-WORLD.md §4） */
      viewportInsets: hudInsets(),
      onContextLost: ()=>{ W3.lost=true; }, onContextRestored: ()=>{ W3.lost=false; } });
    W3.gfx.setWorldVisualState({timeOfDay:0.44, weather:"clear", ambientParticles:true});
    if(HD2D.setSharedTextures) HD2D.setSharedTextures(ASSETS.sharedTex||{});   // 共有テクスチャ（建物・小物・自然物の GLB が参照。建物を読む前に渡す）
    /* 自然物の 3D モデル（Muse の環境セット・GPT-DQ3。2026-11-12、src/world/natureModels.ts）：木・岩・やぶ・切り株などの見た目だけを GLB にする。
       ID・位置・残量・当たり判定はゲームのまま。読めなかった種類は旧い見た目のまま（原因は HD2D.natureModelStatus() とコンソール） */
    if(HD2D.installNatureModels && ASSETS.nature) HD2D.installNatureModels(W3.gfx, ASSETS.nature, TERRAIN).then(()=>{
      const st=HD2D.natureModelStatus(); W3.natModels=st; if(Object.keys(st.failed).length) console.warn("自然物のモデルの読み込みに失敗：", st.failed); });
    /* 広い世界の外側（地形の区画・海・湖・山の川・滝）を、モジュールのシーンに足して描く（src/world/render.ts） */
    if(HD2D.attachWorld){ try{ W3.world = HD2D.attachWorld(W3.gfx, {cfg:W3.cfg, quality: MOBILE ? "low" : "high",
      images:{particle:ASSETS.particle}, volcanoKit:ASSETS.volcanoKit}); }catch(e){ console.error("広い世界の描画を始められなかった", e); } }
    camInit();      // 保存した視点を先に（古いセーブの画面基準の向きを、その視点でワールドの向きへ換算するため）
    W3.pos = spawnPos();
    if(W3.spawnMoved) camRebase();     // 安全な場所へ移したときは、その場の足もとを基準の高さに
    if(W3.cam) W3.cam.snap = true;     // 起動：カメラは主人公の所から始める
    syncAll3D();
    W3.state = "ready";
    npcInit();
    { const g=gfxStatus(); if(g.ok===false) console.warn("木の枝葉カードのテクスチャを "+g.branch+"/"+g.want+" しか読み込めなかった（描画モジュールが旧来の球体の樹冠に戻っている可能性）"); }
    W3.gfx.setPlayerVisualState(playerVisual({position:W3.pos, direction:W3.dir, moving:false}));
    renderField(); updateFieldActivity();
  }catch(e){ console.error(e); W3.state="failed"; W3.err="3D表示を開始できませんでした："+((e&&e.message)||e); renderField(); }
}
/* セーブの位置から始める。新しい当たり判定で木や岩に埋まっていたら、近くの立てる場所へ移す */
function spawnPos(){
  const p = (S.pos && isFinite(S.pos.x) && isFinite(S.pos.z)) ? {x:S.pos.x, z:S.pos.z} : {x:D.base.x, z:D.base.z};
  if(S.pos && ["down","up","left","right"].includes(S.pos.dir)) W3.dir = S.pos.dir;      // 向きも元どおりに
  /* ワールドの向き（2026-11-08〜 S.pos.face）。古いセーブは画面基準の dir から今のカメラで換算する */
  W3.face = (S.pos && finite(S.pos.face)) ? wrapPi(S.pos.face) : faceFromScreen(W3.dir||"down"); W3.faceSec = null;
  if(!world()) return p;
  /* 地形の版が古いセーブ（広い世界より前）：旧世界の地形は変わっていないので位置も建物もそのまま。
     念のため、位置が崖・深い水・木や岩の中なら近くの安全な場所へ移す（建物は消さない）。版を記録して保存する */
  const oldWorld = window.TERRAIN && TERRAIN.WORLD_VERSION && (S.worldVer||1) < TERRAIN.WORLD_VERSION;
  /* 地形の版4（2026-11-11）：南西の火山を登れる山にした。版3以前のセーブの位置が火山の変わった所なら、登山道の近い所（歩ける・つながっている）へ移す */
  let volcMoved = false;
  if(oldWorld && (S.worldVer||1) < 4 && TERRAIN.volcanoSafeSpot){ const v = TERRAIN.volcanoSafeSpot(p.x, p.z); if(v){ p.x=v.x; p.z=v.z; volcMoved=true; } }
  const q0 = WORLD.safeSpawn(S, p), q = volcMoved ? Object.assign({}, q0, {moved:true}) : q0;
  W3.spawnMoved = !!q.moved;
  if(q.moved){ S.pos={x:+q.x.toFixed(2), z:+q.z.toFixed(2), dir:W3.dir}; save(); setTimeout(()=>banner(volcMoved ? "🌋 火山の形が変わったので、近くの登山道へ移動した" : "🧭 歩ける安全な場所へ移動した（木や岩・崖・深い水と重ならない所）"), 600); }
  if(oldWorld){ const was=S.worldVer||1; S.worldVer = TERRAIN.WORLD_VERSION; save();
    setTimeout(()=>banner(was < 3 ? "🗺️ 世界が広くなった！ 北東の山・東と南の海岸・山の滝へ行ける（地図で見られる）" : "🌋 南西の火山に登山道ができた！ 麓から火口の縁まで歩いて登れる（地図で見られる）"), q.moved ? 3600 : 900); }
  return {x:q.x, z:q.z};
}
function applySavedPos(){
  if(!W3.pos) return;
  W3.pos = spawnPos();
  haltField();
  if(W3.gfx) W3.gfx.setPlayerVisualState(playerVisual({position:W3.pos, direction:W3.dir, moving:false}));
  if(W3.world && W3.world.afterWarp) W3.world.afterWarp(W3.pos.x, W3.pos.z);
  if(W3.cam && (!finite(W3.cam.base) || W3.spawnMoved)) camRebase();     // 読み込み：保存した基準の高さを使う。無い・安全な場所へ移したときだけその場の足もとへ
  if(W3.cam) W3.cam.snap = true;      // どちらでも、カメラは読み込んだ位置へすぐ合わせる
  if(W3.gfx) syncAll3D();
}
/* 描画の一時停止：Muse の公開API pauseGraphics / resumeGraphics があれば使い、なければ従来の内部メソッド */
function pause3D(){ if(W3.raf) cancelAnimationFrame(W3.raf); W3.raf=0; haltField();
  try{ if(!W3.gfx) return; if(typeof W3.gfx.pauseGraphics==="function") W3.gfx.pauseGraphics(); else if(typeof W3.gfx.stopLoop==="function") W3.gfx.stopLoop(); }catch(e){} }
function resume3D(){ if(W3.state!=="ready" || W3.raf) return;
  try{ if(typeof W3.gfx.resumeGraphics==="function") W3.gfx.resumeGraphics(); else if(typeof W3.gfx.startLoop==="function") W3.gfx.startLoop(); }catch(e){}
  W3.lastTs=0; W3.raf=requestAnimationFrame(loop3D); }

/* パネルの後ろにマップが見えている間は描画を続ける。スマホで全高近くのシートを開いたときだけ止める */
function fieldShown(){ return U.tab==="explore" || !(uiMode()==="touch" && $("#dock").dataset.size==="tall"); }
const modalOpen = ()=> $("#modal").classList.contains("open");
/* フィールドが入力を受け付けるのは、パネルも案内（モーダル）も開いていないときだけ */
function fieldInputActive(){ return !SPACE.locked(S) && !U.space?.overview && U.tab==="explore" && !modalOpen() && W3.state==="ready" && S.flags.view!=="2d" && !document.hidden; }
/* 押しっぱなしのキー・スティック・タップ中の指・移動予約をすべて解除する（閉じた瞬間に勝手に歩かないように） */
function haltField(){
  W3.keys={}; W3.joy=null; W3.down=null; W3.target=null; W3.path=null; W3.intent=null;
  if(W3.work) cancelWork(null);
  if(W3.joyReset) W3.joyReset();
  if(W3.actReset) W3.actReset();
  if(W3.ptrReset) W3.ptrReset(); else W3.pinch=null;      // マップの指（カメラ・タップ候補）を手放す。カメラは今の希望の角度で止まる（慣性なし）
  if(W3.cam){ W3.cam.yaw=W3.cam.cy; W3.cam.pitch=W3.cam.cp; W3.cam.zoom=W3.cam.cz; W3.cam.rate=CAM.smooth; }
  if(W3.walk){ W3.walk.on=false; W3.walk.slow=0; }
  if(W3.moving && W3.gfx && W3.pos){ W3.moving=false; W3.gfx.setPlayerVisualState(playerVisual({position:{x:W3.pos.x, z:W3.pos.z}, direction:W3.dir, moving:false})); updateLoc(); }
}
document.addEventListener("visibilitychange", ()=>{ if(document.hidden) haltField(); updateFieldActivity(); });
/* アプリ切り替え・ページの一時退避（bfcache）から戻ったときも、押しっぱなしの状態を残さない */
addEventListener("pagehide", haltField);
addEventListener("pageshow", e=>{ if(e.persisted) haltField(); });
function updateFieldActivity(){
  if(W3.state!=="ready" || S.flags.view==="2d") return;
  if(fieldShown() && !document.hidden) resume3D(); else pause3D();
}
/* 実際の描画領域の寸法を描画モジュールの公開API resizeGraphics へ渡す（モバイルのアドレスバー伸縮も含む） */
if(window.ResizeObserver) new ResizeObserver(()=>{ const v=$("#view"); if(W3.gfx && v && v.clientWidth>0 && v.clientHeight>0 && typeof W3.gfx.resizeGraphics==="function") W3.gfx.resizeGraphics(v.clientWidth, v.clientHeight); }).observe(document.getElementById("view"));

/* ---------- カメラ基準の向き・画面座標 ---------- */
function camBasis(){
  const T=HD2D.THREE, cam=W3.gfx.getCamera(), v=new T.Vector3(); cam.getWorldDirection(v);
  let fx=v.x, fz=v.z; const l=Math.hypot(fx,fz)||1; fx/=l; fz/=l;
  return {f:{x:fx,z:fz}, r:{x:-fz,z:fx}};
}
function groundY(x,z){ return HD2D.terrainHeight(x,z,W3.cfg); }
function toScreen(x,y,z){
  const T=HD2D.THREE, v=new T.Vector3(x,y,z); v.project(W3.gfx.getCamera());
  const rect=$("#w3").getBoundingClientRect();
  return {x:(v.x+1)/2*rect.width, y:(1-v.y)/2*rect.height, ok: v.z<1 && v.x>-1.2 && v.x<1.2 && v.y>-1.2 && v.y<1.2};
}
/* タップ地点の地表は、描画モジュールの地形メッシュと同じ terrainHeight でたどる。
   実WebGLの地形メッシュとの差は、俯角28〜50度・3種類の画面で最大0.26マス（2026-11-06 測定）。
   水面は今は描かれていない（Muse に修正依頼中）ため、水面の高さでは判定しない。 */
function screenToGround(cx, cy){
  const rect=$("#w3").getBoundingClientRect();
  /* 広い世界（2026-11-07）：モジュールの pickGround は旧世界の地形の形しか知らないので、旧世界の中で当たったときだけ使う。
     それ以外は、世界の地形関数（描画と同じ）を光線でたどる */
  /* 2026-11-10：モジュールの pickGround は使わない。旧世界の乾いた低地（水位より低い地面）では、見えないようにした全面の水面（深さ0）に当たって、
     地面から 1〜7 マスずれた点を返していた（低い角度ほど大きい）。ゲームと同じ地形関数を光線でたどる */
  const T=HD2D.THREE, cam=W3.gfx.getCamera();
  const ndc=new T.Vector2((cx-rect.left)/rect.width*2-1, -((cy-rect.top)/rect.height)*2+1);
  const rc=new T.Raycaster(); rc.setFromCamera(ndc, cam);
  const o=rc.ray.origin, d=rc.ray.direction; let lo=0, prev=o.y-groundY(o.x,o.z);
  for(let t=0.25; t<600; t+=0.25){
    const x=o.x+d.x*t, y=o.y+d.y*t, z=o.z+d.z*t, diff=y-groundY(x,z);
    if(diff<=0 && prev>0){ let a=lo, b=t; for(let i=0;i<20;i++){ const m=(a+b)/2; const mx=o.x+d.x*m, my=o.y+d.y*m, mz=o.z+d.z*m; if(my-groundY(mx,mz)>0) a=m; else b=m; }
      return {x:o.x+d.x*b, z:o.z+d.z*b}; }
    prev=diff; lo=t; }
  return null;
}

/* ---------- 採取できるもの（フィールドの自然物 {o} と地域の採取地点 {n}）を同じ形で扱う ---------- */
function tPos(t){ return t.o ? {x:t.o.x, z:t.o.z} : t.n.pos; }
function tGap(t,p){ return t.o ? WORLD.reachGap(t.o,p) : Math.max(0, Math.hypot(p.x-t.n.pos.x, p.z-t.n.pos.z)-0.6); }
function tSame(a,b){ return !!a && !!b && (a.o ? a.o===b.o : a.n===b.n); }
function tInfo(t){
  if(t.o) return WORLD.info(S,t.o);
  const n=t.n, inf=depInfo(n.r.id,n.rk), k=S.disc[n.res.id];
  return {ok:inf.ok, kind:inf.kind, reason:inf.kind==="empty"?"取り尽くした（少し待つと戻る）":inf.reason, name:k?nm(n.res.id):"何か", icon:k?ic(n.res.id):"❔", verb:"採る",
    yields:{[n.res.id]:inf.n||n.res.n}, left:inf.left, until:inf.until};
}
const tWork = t => E.vflag(S,"instant") ? 80 : t.o ? NATURE.KINDS[t.o.kind].work : 450;
const yieldText = (y, plain) => Object.keys(y).map(id=>(plain?"":S.disc[id]?ic(id):"❔")+nm(id)+"×"+y[id]).join("・");   // plain：読み上げ用（記号なし）

/* ---------- 毎フレームの更新（移動・地域判定・近くの資源） ---------- */
function regionAt(x,z){ let best=null, bd=1e9; D.regions.forEach(r=>{ if(!r.w) return; const d=Math.hypot(x-r.w.x,z-r.w.z); if(d<bd){bd=d;best=r;} }); return bd<=REGION_R+3?best:null; }
function loop3D(ts){
  W3.raf = requestAnimationFrame(loop3D);
  if(W3.state!=="ready" || W3.lost) return;
  if(window.HD2D && HD2D.tickBuildingParts) HD2D.tickBuildingParts(ts/1000);   // 建物の可動部（ピストン・掘削軸など）
  if(window.HD2D && HD2D.tickNatureModels && W3.pos) HD2D.tickNatureModels(Math.min(0.2,(ts-(W3.lastTs||ts))/1000), W3.pos.x, W3.pos.z);   // 大きな岩の LOD（主人公からの距離）
  if(W3.place || $("#buildov")) drawPlaceOverlay();
  /* 大きなフレーム間隔でも進む距離を保つ（すり抜けは nature.move が細かく分けて防ぐ）。毎秒5コマまでは、進む速さがフレームレートに依らない */
  const dt = W3.lastTs ? Math.max(0, Math.min(MAX_DT,(ts-W3.lastTs)/1000)) : 0; W3.lastTs=ts;   // 時刻が戻ったとき（試験の偽の時計など）は進めない
  if(W3.world && W3.pos) W3.world.update(dt, W3.pos, W3.gfx.getCamera());   // 外側の地形の区画（近いほど細かく・少しずつ作る）と水・滝の動き
  /* 地名（山麓・海岸など）が変わったら左上の表示を更新、エリアの照明・空・霧・粒子を Muse の setEnvironment へ（0.5秒ごと） */
  W3.plT=(W3.plT||0)+dt; if(W3.plT>0.5 && W3.pos){ W3.plT=0; camRecenterUI(); const pn=placeHere(); if(pn!==W3.placeName){ W3.placeName=pn; updateLoc(); }
    if(typeof W3.gfx.setEnvironment==="function" && TERRAIN.areaWeights){ try{ W3.gfx.setEnvironment({weights: TERRAIN.areaWeights(W3.pos.x, W3.pos.z, W3.cfg)}); }catch(e){} } }
  let ix=0, iy=0;
  const active = fieldInputActive();
  if(!active && (W3.path || W3.joy || W3.work || Object.keys(W3.keys).length)) haltField();
  const k=W3.keys; if(k.ArrowLeft||k.a) ix-=1; if(k.ArrowRight||k.d) ix+=1; if(k.ArrowUp||k.w) iy-=1; if(k.ArrowDown||k.s) iy+=1;
  if(W3.joy){ ix=W3.joy.x; iy=W3.joy.y; }
  /* 採取の作業中（1秒弱）はその場にとどまる。スティックを倒したまま採取ボタンを押しても、作業が終われば歩き出す */
  if(W3.work){ ix=0; iy=0; }
  const B = camBasis(); let mx=0, mz=0;
  if(ix||iy){ W3.path=null; W3.target=null; W3.intent=null; const l=Math.hypot(ix,iy); if(l>1){ix/=l; iy/=l;}
    mx = B.r.x*ix - B.f.x*iy; mz = B.r.z*ix - B.f.z*iy; }
  /* クリック移動：1コマで進む距離は、次の通過点までの距離を超えない（遅い端末で1コマの歩幅が 0.2 マスより大きいと、
     通過点のまわりを行ったり来たりして着かなかった。2026-11-10 SwiftShader で再現） */
  let stepCap = Infinity;
  if(!(ix||iy) && W3.path && W3.path.length && !W3.work){ const wp=W3.path[0], dx=wp.x-W3.pos.x, dz=wp.z-W3.pos.z, d=Math.hypot(dx,dz);
    if(d<0.2){ W3.path.shift(); if(!W3.path.length) arrive(); }
    else { mx=dx/d; mz=dz/d; stepCap=d; } }
  const len=Math.hypot(mx,mz); let got=0;
  if(len>0.01 && dt>0){
    const sp = WALK_SPEED*(owned("steamengine")?1.6:1)*Math.min(1,len), step = Math.min(sp*dt, stepCap);
    const before = {x:W3.pos.x, z:W3.pos.z};
    const res = WORLD.move(S, W3.pos, mx/len*step, mz/len*step);
    W3.pos.x=res.x; W3.pos.z=res.z;
    got = Math.hypot(res.x-before.x, res.z-before.z);
    /* クリック移動で進めなくなったら、経路を引き直す。それでも進めなければ止める */
    if(W3.path){ W3.stuck = got < step*0.2 ? (W3.stuck||0)+dt : 0;
      if(W3.stuck>0.5){ W3.stuck=0; const goal=W3.path[W3.path.length-1]; const p=(W3.repath=(W3.repath||0)+1)<=2 ? WORLD.findPath(S,W3.pos,goal) : null;
        if(p) W3.path=p; else { W3.path=null; W3.target=null; W3.intent=null; W3.repath=0; banner("🚫 ここから先へは進めない"); } } }
    /* 向き：進もうとしている向き（スティック・キーはカメラ基準の入力、クリック移動は次の通過点。ワールドの角度）。
       壁や木に当たって横へ滑っても、押している向きのまま（滑った分で絵が横を向かない）。カメラを回しても変わらない。
       絵の行は playerVisual がカメラから見て選ぶ。止まったら最後の向きのまま */
    if(got>0.0001) W3.face = Math.atan2(mx, mz);     // 実際に進まないコマ（壁に押し付けているだけ等）では向きを変えない（Codex 58f2b0b）
  }
  /* 歩行状態：入力や移動予約の有無ではなく、衝突処理のあとに実際に進んだ量と経過時間で決める。
     ワープ・ロード時の補正・初期配置は W3.pos を直接書くので、ここでは数えない（歩行にならない） */
  const moving = updateWalk(dt, got, (ix||iy) || !!(W3.path && W3.path.length));
  /* speed：実際に進んだ速さ（マス/秒、少しならした値）。Muse §31 の歩行位相（進んだ距離 ÷ 0.35 マスで1コマ）へ渡す。止まっているときは 0 */
  W3.walkSpeed = moving ? (W3.walkSpeed||0) + ((dt>0?got/dt:0) - (W3.walkSpeed||0)) * damp(12, dt) : 0;
  W3.gfx.setPlayerVisualState(playerVisual({position:{x:W3.pos.x, z:W3.pos.z}, direction:W3.dir, moving, speed:+W3.walkSpeed.toFixed(2), action: W3.work ? "gather" : undefined}));
  spaceVisualFrame();
  consFrame();
  camFrame(dt);     // カメラは主人公の位置を渡したあと（モジュールが次のコマで使う位置で、注視点の高さの変化を打ち消す）
  tickWork(ts);
  // 地域の判定
  const reg = regionAt(W3.pos.x, W3.pos.z);
  if(reg!==W3.region){ W3.region=reg; if(reg){ U.region=reg.id; U.combo=0; } updateLoc(); drawRegion(); }
  // 手の届く採取対象（選んだものを優先）
  const near = findNear();
  if(!tSame(near,W3.near) || (!near && W3.near)){ const old=W3.near; W3.near=near; if(old&&old.n) syncNode(old.n); if(near&&near.n) syncNode(near.n); syncNature(); updateAction3D(); }
  // 資源の再生・表示範囲
  if(++W3.tick%20===0){ NODES.forEach(n=>syncNode(n)); syncNature(); updateAction3D(); }
  updateLabels3D(); npcUpdate(dt); npcLabels();
  if(ts-W3.lastSave>2000 && (!S.pos || Math.abs(S.pos.x-W3.pos.x)>0.01 || Math.abs(S.pos.z-W3.pos.z)>0.01 || Math.abs((S.pos.face||0)-(W3.face||0))>0.01)){ W3.lastSave=ts; S.pos={x:+W3.pos.x.toFixed(2), z:+W3.pos.z.toFixed(2), dir:W3.dir, face:+(W3.face||0).toFixed(3)}; save(); }
}
/* 歩く速さ（マス/秒）。キー・スティック（倒しきったとき）・タップ移動で同じ。斜めは入力を長さ1にそろえるので速くならない。
   2026-11-11：毎秒7 → 4.55（約65%）。歩く絵の足の動きは描画モジュールが「実際に進んだ距離」で進める（Muse §31：0.35マスで1コマ、4コマ＝1.4マスで一周）ので、
   速さを下げるだけで一周の時間も 0.20秒 → 0.31秒（約1.54倍）になる。足の動きに別の倍率は重ねない（重ねると足がすべって見える）。
   ゲーム全体の時間や描画のコマ数は変えない。採取の作業時間・集落の人の速さ（NPC_SPEED）も変えない */
const WALK_SPEED = 4.55, MAX_DT = 0.2;
/* 歩き始め：毎秒0.9マス以上。止まる：毎秒0.35マス未満が0.12秒続く（小さな揺れでちらつかない）。
   入力も移動予約もなければ、その場で止まる。止まっても向き（W3.dir）は変えない */
const WALK_START = 0.9, WALK_STOP = 0.35, WALK_STOP_HOLD = 0.12;
function updateWalk(dt, got, intent){
  const w = W3.walk || (W3.walk = {on:false, slow:0});
  const speed = dt>0 ? got/dt : 0;
  if(!intent){ w.on=false; w.slow=0; }
  else if(!w.on){ if(speed >= WALK_START){ w.on=true; w.slow=0; } }
  else if(speed < WALK_STOP){ w.slow += dt; if(w.slow >= WALK_STOP_HOLD){ w.on=false; w.slow=0; } }
  else w.slow = 0;
  if(W3.moving !== w.on){ W3.moving = w.on; updateLoc(); }
  return w.on;
}
function findNear(){
  const p=W3.pos, R=E.REACH;
  if(W3.sel && tGap(W3.sel,p)<=R) return W3.sel;
  let best=null, bd=1e9;
  WORLD.around(p.x,p.z,R+2).forEach(o=>{ if(!WORLD.present(S,o)) return; const g=WORLD.reachGap(o,p); if(g<=R && g<bd){ bd=g; best={o}; } });
  NODES.forEach(n=>{ const g=tGap({n},p); if(g<=R && g<bd){ bd=g; best={n}; } });
  return best;
}
/* 移動先を決める。t があれば、その採取対象の外周（立てる場所）へ向かい、着いたら採取する */
function goTo3D(x,z,t){
  if(W3.work) cancelWork("別の場所へ向かうので、採取をやめた");
  W3.intent = t||null; W3.repath=0; W3.stuck=0;
  if(t && tGap(t,W3.pos)<=E.REACH){ W3.path=null; W3.target=null; arrive(); return true; }
  let path;
  if(t && t.n){ const sh=NATURE.depShape(t.n.res)||{}; path = WORLD.pathToDeposit(S, t.n.pos, sh.r||0, W3.pos); }    // 採取地点：まわりの、歩いて行ける立てる場所へ
  else { const dest = t ? WORLD.approachPoint(S,t.o,W3.pos) : WORLD.nearestFree(S,{x,z},undefined,6); path = dest && WORLD.findPath(S,W3.pos,dest); }
  if(!path){ banner("🚫 そこへは行けない（道がない）"); W3.path=null; W3.target=null; W3.intent=null; return false; }
  W3.path=path; W3.target=path[path.length-1];
  return true;
}
function arrive(){
  W3.path=null; W3.target=null;
  const t=W3.intent; W3.intent=null; if(!t) return;
  if(tGap(t,W3.pos)<=E.REACH) startWork(t); else banner("🚫 近づけなかった");
}
/* 採取の流れ：近づく → 条件確認 → 作業（短い時間）→ 一度だけ確定。作業中に動く・メニューを開くと中断（何も減らない） */
function startWork(t){
  if(W3.work) return;                         // 作業中の連打・長押しは受け付けない
  if(tGap(t,W3.pos) > E.REACH){ banner("遠すぎる。もっと近づこう"); return; }
  const inf=tInfo(t);
  if(!inf.ok){ banner((inf.kind==="tool"?"🛠️ ":"")+inf.name+"："+inf.reason); return; }
  W3.sel=t; W3.path=null; W3.target=null; W3.intent=null;
  W3.work={t, start:performance.now(), dur:RM?150:tWork(t), token:S.seq, pos:{x:W3.pos.x, z:W3.pos.z}};
  syncWorkVisual(t); updateAction3D();
}
function syncWorkVisual(t){ if(!t) return; if(t.n) syncNode(t.n); else syncNature(); }
function cancelWork(msg){ if(!W3.work) return; const t=W3.work.t; W3.work=null; syncWorkVisual(t); const b=$("#w3act"); if(b) b.style.removeProperty("--p"); if(msg) banner(msg); updateAction3D(); }
function tickWork(ts){
  const w=W3.work; if(!w) return;
  if(Math.hypot(W3.pos.x-w.pos.x, W3.pos.z-w.pos.z) > 0.05){ cancelWork("採取を中断した（何も減っていない）"); return; }
  const p=Math.min(1,(performance.now()-w.start)/w.dur); const b=$("#w3act"); if(b) b.style.setProperty("--p", Math.round(p*100)+"%");
  if(p>=1) finishWork();
}
function finishWork(){
  const w=W3.work; W3.work=null; const b=$("#w3act"); if(b) b.style.removeProperty("--p");
  syncWorkVisual(w.t);
  const t=w.t, now=Date.now(); U.combo=(now-U.lastGather<2500)?U.combo+1:1; U.lastGather=now;
  const out = t.o ? WORLD.harvest(S, t.o.id, {pos:W3.pos, token:w.token, combo:U.combo})
                  : E.harvestDeposit(S, t.n.r.id, t.n.rk, {pos:W3.pos, token:w.token, combo:U.combo});
  if(!out.ok){ banner(out.reason||"採れなかった"); updateAction3D(); return; }
  const got = out.got || {[t.n.res.id]:out.n};
  const pos = tPos(t), kind = t.o ? t.o.kind : t.n.type;
  W3.gfx.playVisualEffect(out.news.length?"discovery": ["tree","bush","grass","herb","flowers"].includes(kind)?"leaves": kind==="water"?"splash": (kind==="rock"||kind==="ore")?"smoke":"sparkle", pos);
  if(out.lvUp) W3.gfx.playVisualEffect("levelup", W3.pos);
  float3D(pos,(out.crit?"会心！ ":"")+Object.keys(got).map(id=>ic(id)+"＋"+got[id]).join(" "), out.crit?"crit":"");
  if(t.o && out.depleted) banner(out.after==="stump" ? "🪵 切り株になった" : out.after==="rubble" ? "🪨 岩が砕けた" : "✋ "+out.name+"をとった");
  const cb=$("#combo"); if(cb){ cb.textContent = U.combo>=2 ? "コンボ×"+U.combo+(U.combo%5===0?"　おまけ＋1！":"") : ""; cb.classList.toggle("on",U.combo>=2); }
  if(out.rares && out.rares.length) banner("✨ 珍しい発見！ "+out.rares.map(nm).join("・"));
  else if(out.lvUp) banner("⭐ 探索Lv"+out.lvUp+"に上がった！");
  else if(!(t.o && out.depleted)) processHint(out.news);
  if(t.n) syncNode(t.n); syncNature(true);
  if(t.o && out.depleted){ W3.sel=null; }
  afterChange(out.news); updateAction3D(); updateLoc(); drawRegion();
}
/* 行動ボタン：手の届く対象の名前・得られる素材・必要な道具・採れない理由を出す */
function updateAction3D(){
  const b=$("#w3act"); if(!b) return;
  if(!in3D() || W3.state!=="ready" || !WORLD){ b.hidden=true; return; }
  const t=W3.near, pc=uiMode()==="pc";
  let mode, html;
  if(W3.work){ const inf=tInfo(W3.work.t); mode="work"; html=`<span class="ai">${inf.icon}</span><span>${inf.name}を${inf.verb==="採る"?"採って":inf.verb.replace(/る$/,"って")}いる…</span>`; }
  else if(W3.npcNear && (!t || Math.hypot(W3.npcNear.x-W3.pos.x, W3.npcNear.z-W3.pos.z) < 1.4)){ const n=W3.npcNear; mode="talk"; html=`${pc?'<span class="kbd">E</span>':""}<span class="ai">💬</span><span>${n.def.name}と話す</span>`; }
  else if(!t){ const sel=W3.sel; mode="look"; html = pc ? "" : `<span class="ai">🔍</span><span>調べる</span>`;
    if(sel && W3.path){ const inf=tInfo(sel); mode="go"; html=`<span class="ai">${inf.icon}</span><span>${inf.name}へ移動中</span>`; } }
  else { const inf=tInfo(t);
    if(!inf.ok){ mode="lock"; html=`<span class="ai">${inf.kind==="tool"?"🛠️":inf.kind==="empty"?"⏳":"🚫"}</span><span>${inf.name}：${inf.reason}</span>`; }
    else { mode="gather"; html=`${pc?'<span class="kbd">E</span>':""}<span class="ai">${inf.icon}</span><span>${inf.name}を${inf.verb} <small>→ ${yieldText(inf.yields)}</small></span>`; } }
  const sig=mode+"|"+html; if(b._sig===sig && !b.hidden) return; b._sig=sig;
  b.hidden=false; b.dataset.mode=mode; b.className="w3act"+(mode==="look"?" idle":mode==="gather"||mode==="talk"?"":mode==="work"||mode==="go"?" busy":" lock"); b.innerHTML=html;
  b.title = mode==="gather" ? "採取する（E キーかスペース）" : mode==="look" ? "近くを調べる" : "";
}
/* 行動ボタン・E キー */
function pressAction(){
  if(!fieldInputActive() || W3.work) return;
  if(W3.npcNear && (!W3.near || Math.hypot(W3.npcNear.x-W3.pos.x, W3.npcNear.z-W3.pos.z) < 1.4)){ openTalk(W3.npcNear); return; }
  const t=W3.near;
  if(!t){ banner("🔍 手の届く所に採れるものはない。木や石を選んで近づこう"); return; }
  startWork(t);
}
const updateArea3D = updateLoc;
/* 名札：地域の採取地点と、選んだ・手の届く自然物に出す */
function labelFor(key, act, data, x, y, z, html, cls, aria){
  const box=$("#w3labels"); let el=W3.labelEls[key];
  const s=toScreen(x,y,z);
  if(!s.ok){ if(el) el.style.display="none"; return; }
  if(!el || !el.isConnected){ el=document.createElement("button"); el.className="w3lab"; el.dataset.act=act; Object.assign(el.dataset, data); box.appendChild(el); W3.labelEls[key]=el; el._sig=""; }
  const sig=html+"|"+cls; if(sig!==el._sig){ el._sig=sig; el.className="w3lab"+cls; el.innerHTML=html; el.setAttribute("aria-label", aria); }
  /* 名札で主人公が隠れないように：主人公の絵（頭の上〜足もと）に重なる名札は、主人公の頭の上へずらす */
  let ly=s.y;
  if(W3.pos){ const p=toScreen(W3.pos.x, groundY(W3.pos.x,W3.pos.z), W3.pos.z), ph=W3.heroPx||56;
    if(p.ok && Math.abs(s.x-p.x)<90 && ly>p.y-ph-6 && ly-34<p.y) ly = p.y-ph-8; }
  el.style.display=""; el.style.transform=`translate(${s.x}px,${ly}px) translate(-50%,-100%)`;
}
function updateLabels3D(){
  const box=$("#w3labels"); if(!box) return;
  NODES.forEach(n=>{
    const d=Math.hypot(n.pos.x-W3.pos.x, n.pos.z-W3.pos.z), isNear=W3.near&&W3.near.n===n, isSel=W3.sel&&W3.sel.n===n;
    /* 名札は、近い（6マス以内）・手が届く・選んだ・技術画面で目標にした素材のときだけ（遠くの採取地点に常に名札を出さない） */
    const wanted = isNear || isSel || d<6 || (U.target===n.res.id && d<17);
    if(!wanted){ const el=W3.labelEls[n.key]; if(el) el.style.display="none"; return; }
    const g=E.gatherInfo(S,n.r,n.res), k=S.disc[n.res.id], inf=depInfo(n.r.id,n.rk);
    labelFor(n.key, "w3go", {n:n.key}, n.pos.x, groundY(n.pos.x,n.pos.z)+(n.type==="tree"?2.6:1.5), n.pos.z,
      `<span>${g.ok?(k?ic(n.res.id):"❔"):"🛠️"}</span>${k?nm(n.res.id):"？"}${inf.left>0&&g.ok&&isFinite(inf.left)?`<i>${"●".repeat(Math.min(inf.left,8))}</i>`:""}`,
      (g.ok?"":" lock")+(g.ok&&inf.left<=0?" regrow":"")+(isNear?" near":""), (k?nm(n.res.id):"未発見の資源")+"へ行って採取する");
  });
  const want = new Set();
  [W3.sel, W3.near].forEach(t=>{ if(!t || !t.o) return; const o=t.o; want.add("o:"+o.id);
    const inf=WORLD.info(S,o), K=NATURE.KINDS[o.kind], h = o.kind==="tree" ? 3.2*o.scale : o.kind==="rock" ? 1.4*o.scale : 0.9;
    labelFor("o:"+o.id, "w3pick", {o:o.id}, o.x, groundY(o.x,o.z)+h, o.z,
      `<span>${inf.ok?inf.icon:"🛠️"}</span>${inf.name}<small style="font-weight:700;margin-left:4px">${inf.ok?"→ "+yieldText(inf.yields):inf.reason}</small>`,
      (inf.ok?"":" lock")+(W3.near&&W3.near.o===o?" near":""), inf.name+"："+(inf.ok?K.verb+"と"+yieldText(inf.yields,true):inf.reason)); });
  Object.keys(W3.labelEls).forEach(k=>{ if(k.startsWith("o:") && !want.has(k)){ W3.labelEls[k].remove(); delete W3.labelEls[k]; } });
}
function float3D(p, text, cls){
  const box=$("#w3labels"); if(!box) return;
  const s=toScreen(p.x, groundY(p.x,p.z)+1.2, p.z);
  const f=document.createElement("span"); f.className="float "+(cls||""); f.innerHTML=text;
  f.style.left=s.x+"px"; f.style.top=s.y+"px"; box.appendChild(f); setTimeout(()=>f.remove(), RM?600:1100);
}
/* 画面上の点にある採取対象を選ぶ（木は幹から樹冠まで、小さなものは周りも少し広めに当てる） */
function pickAt(cx, cy){
  const rect=$("#w3").getBoundingClientRect(), cam=W3.gfx.getCamera();
  const ppu = cam.top!==undefined ? rect.height / ((cam.top-cam.bottom)/(cam.zoom||1)) : 30;
  const px=cx-rect.left, py=cy-rect.top; let best=null, bs=1e9;
  const test=(t, h, wr)=>{ const p=tPos(t), s=toScreen(p.x, groundY(p.x,p.z)+h, p.z); if(!s.ok) return;
    const rad=Math.max(22, wr*ppu), d=Math.hypot(s.x-px, s.y-py)/rad; if(d<1 && d<bs){ bs=d; best=t; } };
  WORLD.around(W3.pos.x, W3.pos.z, 34).forEach(o=>{
    if(o.kind==="tree"){ test({o}, 0.8*o.scale, 0.55*o.scale); test({o}, 2.4*o.scale, 1.15*o.scale); }
    else test({o}, o.kind==="rock" ? 0.45*o.scale : 0.12, o.r+0.25);
  });
  NODES.forEach(n=>{ if(Math.hypot(n.pos.x-W3.pos.x,n.pos.z-W3.pos.z)<34) test({n}, n.type==="tree"?1.4:0.4, 0.8); });
  return best;
}
function selectAndGo(t){
  W3.sel=t; syncNature(); if(t.n) syncNode(t.n);
  const inf=tInfo(t);
  if(!inf.ok && inf.kind==="tool"){ banner("🛠️ "+inf.name+"："+inf.reason); }
  goTo3D(0,0,t); updateAction3D();
}

/* ---------- 入力：タップ・クリックで選択と移動 ---------- */
function bind3DInput(){
  const w=$("#w3"); if(!w || w._bound) return; w._bound=true;
  /* ---- 指・マウスの担当（pointerId ごと）。2026-11-08 ----
     マップ（#w3）の何もない所で始まった指だけをカメラ・タップの担当にする。スティック・行動ボタン・パネル・名札などの UI で始まった指は
     #w3 に届かないか、ここで除外するので、途中でマップの上へ動いてもカメラは動かない。マップで始まった指は捕捉（setPointerCapture）するので、
     途中で UI の上へ動いても、離すまでカメラの担当のまま。スティックの指はここに入らないので、左手で歩きながら右手で回せる。
     押した直後は「タップ候補」。CAM.tapSlop（CSSピクセル）以上動いたらドラッグ（回転）。ドラッグかピンチをした操作からはタップを出さない。
     ピンチは、マップで始まった2本の指だけで判定する（3本目以降は無視）。2本→1本に戻ったら、残った指の基準位置を取り直す（急に回らない）。 */
  const P = W3.ptrs = new Map();
  let used = false;          // 今の一連の操作でドラッグかピンチをした（離し終わるまでタップにしない）
  const UI_SEL = ".joy,.w3lab,button,a,input,select,textarea,label,.camctl,.buildbar,.w3act";
  const perPx = ()=>{ const r=w.getBoundingClientRect(), sh=Math.max(240, Math.min(r.width, r.height)), u=camUser(); return {yaw:CAM.yawPerShort/sh*u.sx, pitch:CAM.pitchPerShort/sh*u.sy}; };
  const pinchDist = ()=>{ const [a,b]=[...P.values()]; return Math.max(1, Math.hypot(b.x-a.x, b.y-a.y)); };
  W3.ptrReset = ()=>{ for(const id of P.keys()){ try{ w.releasePointerCapture(id); }catch(err){} } P.clear(); W3.pinch=null; used=false; };
  w.addEventListener("pointerdown", e=>{
    if(!fieldInputActive() || (e.target.closest && e.target.closest(UI_SEL))) return;
    if(e.pointerType==="mouse" && e.button!==0 && e.button!==2) return;
    if(P.size >= 2 || P.has(e.pointerId)) return;
    const p = {id:e.pointerId, type:e.pointerType, btn:e.button, sx:e.clientX, sy:e.clientY, x:e.clientX, y:e.clientY, lx:e.clientX, ly:e.clientY, t:Date.now(), mode:"tap"};
    if(e.pointerType==="mouse" && e.button===2){ p.mode="drag"; used=true; }      // 右ドラッグも回転（クリック操作にはしない）
    P.set(e.pointerId, p);
    try{ w.setPointerCapture(e.pointerId); }catch(err){}
    if(e.pointerType==="mouse") e.preventDefault();      // 文字選択・フォーカス移動を起こさない
    if(P.size===2){ if(camSupported()){ W3.pinch={d0:pinchDist(), z0:W3.cam?W3.cam.zoom:0}; } used=true; for(const q of P.values()) q.mode="pinch"; }
  });
  w.addEventListener("pointermove", e=>{
    const p=P.get(e.pointerId); if(!p) return;
    p.x=e.clientX; p.y=e.clientY;
    if(!fieldInputActive()){ W3.ptrReset(); return; }
    if(p.mode==="pinch"){ if(W3.pinch && P.size===2 && W3.cam) camZoomTo(W3.pinch.z0 * W3.pinch.d0 / pinchDist()); return; }   // 広げる＝近づく（表示範囲が小さくなる）
    if(p.mode==="tap"){ if(Math.hypot(p.x-p.sx, p.y-p.sy) < CAM.tapSlop) return; p.mode="drag"; used=true; p.lx=p.sx; p.ly=p.sy; }
    if(p.mode==="drag" && camSupported()){ const k=perPx(), dx=p.x-p.lx, dy=p.y-p.ly; p.lx=p.x; p.ly=p.y;
      /* 景色を指で引っ張る向き：右へドラッグ→景色が右へ回る（カメラの水平角は減る）。下へドラッグ→上から見る（見下ろし角が増える） */
      camRotate(-dx*k.yaw, dy*k.pitch); }
  });
  const ptrEnd = e=>{
    const p=P.get(e.pointerId); if(!p) return;
    P.delete(e.pointerId); try{ w.releasePointerCapture(e.pointerId); }catch(err){}
    const tap = e.type==="pointerup" && p.mode==="tap" && !used && Date.now()-p.t < CAM.tapTime && (p.type!=="mouse" || p.btn===0);
    if(W3.pinch && P.size<2){ W3.pinch=null; for(const q of P.values()){ q.mode="drag"; q.lx=q.x; q.ly=q.y; } }   // 残った指は今の位置から回す
    if(P.size===0){ used=false; camStore(true); }
    if(tap && fieldInputActive()) tapAt(e.clientX, e.clientY);
  };
  ["pointerup","pointercancel","lostpointercapture"].forEach(t=>w.addEventListener(t, ptrEnd));
  w.addEventListener("wheel", e=>{ if(!camSupported() || !fieldInputActive() || !W3.cam) return; e.preventDefault();
    W3.camWheelAt = performance.now();      // ホイールも「操作中」（カメラの高さの基準を変えてよい間）
    const n = Math.max(-4, Math.min(4, (e.deltaMode===1 ? e.deltaY/3 : e.deltaY/100))) || Math.sign(e.deltaY);
    camZoomTo(W3.cam.zoom * Math.pow(CAM.wheelStep, n)); clearTimeout(W3.wheelT); W3.wheelT=setTimeout(()=>camStore(true),300); }, {passive:false});
  /* iOS Safari のページのピンチ拡大（gesture* イベント）をマップの上だけ止める */
  ["gesturestart","gesturechange"].forEach(t=>w.addEventListener(t, e=>e.preventDefault()));
  /* 建築モード：マウスを動かすと候補が付いてくる（ボタンを押していないとき）。タップ・クリックはその場所へ候補を動かす（歩かない） */
  w.addEventListener("pointermove", e=>{ if(!W3.place || e.pointerType!=="mouse" || e.buttons || !fieldInputActive()) return; const h=screenToGround(e.clientX,e.clientY); if(h) placeMoveTo(h.x,h.z); });
}
/* マップを短くタップ（クリック）した：建築の候補を動かす・人と話す・採取対象を選んで向かう・その地点へ歩く */
function tapAt(cx, cy){
  const e={clientX:cx, clientY:cy};
    if(W3.place){ const h=screenToGround(e.clientX,e.clientY); if(h) placeMoveTo(h.x,h.z); return; }
    /* 人をタップ（クリック）したら、近づいて話す */
    if(W3.npcs){ const rect=$("#w3").getBoundingClientRect(); const hit=W3.npcs.find(n=>{ const sc=toScreen(n.x, groundY(n.x,n.z)+0.9, n.z); return sc.ok && Math.hypot(sc.x-(e.clientX-rect.left), sc.y-(e.clientY-rect.top)) < 34; });
      if(hit){ talkTo(hit.id); return; } }
    const t = pickAt(e.clientX, e.clientY);
    if(t){ selectAndGo(t); W3.gfx.playVisualEffect("sparkle", tPos(t)); return; }
    const hit=screenToGround(e.clientX,e.clientY); if(!hit) return;
    W3.sel=null; syncNature();
    if(goTo3D(hit.x,hit.z,null)) W3.gfx.playVisualEffect("sparkle", hit);
}
/* HUD のスティックと行動ボタン。指ごと（pointerId）に区別するので、歩きながら採取ボタンを押せる */
function bindHudInput(){
  const joy=$("#joy"), knob=joy&&joy.querySelector(".knob");
  const act=$("#w3act");
  if(act){ let aid=null;
    act.addEventListener("pointerdown", e=>{ if(e.pointerType==="mouse") return; aid=e.pointerId; });
    act.addEventListener("pointerup", e=>{ if(e.pointerId!==aid) return; aid=null; W3.actTouchAt=performance.now(); pressAction(); });
    /* 指がボタンの外へ出て離れた・取り消された：押していないことにする（採取はしない。ほかの指には触れない） */
    const drop = e=>{ if(e.pointerId===aid) aid=null; };
    act.addEventListener("pointercancel", drop);
    addEventListener("pointerup", drop); addEventListener("pointercancel", drop);
    W3.actReset = ()=>{ aid=null; }; }
  if(joy){ let id=null, cx=0, cy=0; const R=42;
    W3.joyReset = ()=>{ if(id!==null){ try{ joy.releasePointerCapture(id); }catch(err){} } id=null; W3.joy=null; knob.style.transform=""; };
    joy.addEventListener("pointerdown", e=>{ if(!fieldInputActive() || id!==null) return; id=e.pointerId; try{ joy.setPointerCapture(id); }catch(err){} const r=joy.getBoundingClientRect(); cx=r.left+r.width/2; cy=r.top+r.height/2; mv(e); e.preventDefault(); });
    const mv=e=>{ if(e.pointerId!==id) return; if(!fieldInputActive()){ W3.joyReset(); return; } let dx=e.clientX-cx, dy=e.clientY-cy; const l=Math.hypot(dx,dy); if(l>R){dx*=R/l;dy*=R/l;} knob.style.transform=`translate(${dx}px,${dy}px)`; const m=Math.hypot(dx,dy)/R; W3.joy = m<0.18?null:{x:dx/R, y:dy/R}; };
    joy.addEventListener("pointermove", mv);
    const end=e=>{ if(e.pointerId!==id) return; id=null; W3.joy=null; knob.style.transform=""; };
    joy.addEventListener("pointerup", end); joy.addEventListener("pointercancel", end); joy.addEventListener("lostpointercapture", end);
    /* 捕捉できなかった・外れた場合の保険：同じ指が画面のどこで離れても止める（別の指は id が違うので影響しない） */
    addEventListener("pointerup", end); addEventListener("pointercancel", end); }
}
const TYPING = EDITABLE;
document.addEventListener("keydown", e=>{
  if(!fieldInputActive() || e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest(TYPING))) return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","w","a","s","d"].includes(k)){ W3.keys[k]=true; e.preventDefault(); }
  /* ボタンにフォーカスがあるときのスペースは、そのボタンを押す操作なので採取しない */
  if(k===" " && e.target.closest && e.target.closest("button,a,summary,[role=button]")) return;
  if(W3.place){ if(k==="r"){ e.preventDefault(); placeRotate(e.shiftKey?90:ROT_STEP); return; } if(k==="Enter"){ e.preventDefault(); placeConfirm(); return; } }
  if((k===" "||k==="e")){ e.preventDefault(); if(!e.repeat) pressAction(); } });
document.addEventListener("keyup", e=>{ const k=e.key.length===1?e.key.toLowerCase():e.key; delete W3.keys[k]; });
window.addEventListener("blur", haltField);

/* ---------- 探索ホーム（3D版） ---------- */
function renderExplore3D(v){
  let built = false;
  if(!v.querySelector(".w3")){
    built = true;
    v.innerHTML = `<div class="w3" id="w3"><div class="w3slot" id="w3slot"></div><div class="w3labels" id="w3labels"></div>
      <div class="w3loading"><div>🌄 3Dフィールドを準備中…</div><small>初回は少し時間がかかります</small></div></div>`;
    W3.labelEls = {}; W3.synced = false;
    if(W3.host) $("#w3slot").appendChild(W3.host);
    bind3DInput();
  }
  if(W3.state==="ready"){
    const ld=v.querySelector(".w3loading"); if(ld) ld.remove();
    if(built || !W3.synced){ syncAll3D(); W3.region=undefined; W3.synced=true; } else syncStructures();
    updateFieldActivity();
  }
  updateLoc(); updateAction3D();
}

/* ===================== 工作 ===================== */
function craftCard(c){
  const it = IT[c.out], pl = E.planCraft(S,c), own = it.unique && owned(c.out);
  const reqs = Object.keys(c.inp).map(id=>{ const k=S.disc[id]; const okk=E.cnt(S,id)>=c.inp[id]; return `<span class="${okk?"ok":"ng"}">${k?ic(id)+nm(id):"❔？？？"} ${E.cnt(S,id)}/${c.inp[id]}</span>`; }).join("");
  const tl = c.tools.concat(c.at?[c.at]:[]).map(id=>`<span class="${owned(id)?"ok":"ng"}">${c.at===id?"場所：":"道具："}${S.disc[id]?ic(id)+nm(id):"❔？？？"}</span>`).join("");
  return `<div class="card"><h3><span class="i">${ic(c.out)}</span>${it.name}${own?' <span class="tag" style="background:var(--meadow);color:var(--meadow-ink)">持っている</span>':""}</h3>
    <div class="kid">${it.kid}</div><div class="need">${reqs}${tl}</div><div class="how">作り方：${c.how}</div>
    ${own?"":pl.kind==="build"?consCraftLink(c.out):`<div class="row mt"><button class="btn small" data-act="craft" data-id="${c.id}" ${pl.ok?"":"disabled"}>🔨 作る</button>${pl.ok?"":`<span class="desc" style="margin:0">${pl.msg}</span>`}${consNeedLink(c)}</div>`}</div>`;
}
function viewCraft(){
  const vis = D.crafts.filter(c=>!c.space && (S.disc[c.out] || Object.keys(c.inp).some(k=>S.disc[k]) || ["c_knife","c_thread"].includes(c.id)));
  const todo = vis.filter(c=>!(IT[c.out].unique&&owned(c.out))).sort((a,b)=>(E.planCraft(S,b).ok?1:0)-(E.planCraft(S,a).ok?1:0));
  const done = vis.filter(c=>IT[c.out].unique&&owned(c.out)).filter((c,i,a)=>a.findIndex(x=>x.out===c.out)===i);
  const hidden = D.crafts.length - vis.length;
  return `<div class="sec">工作 <small>材料を組み立てて道具や設備を作る（化学変化ではない作業）</small></div>
  <div class="grid2">${todo.map(craftCard).join("")||`<p class="desc">今作れるものはないよ。</p>`}</div>
  ${hidden?`<p class="desc mt">🔒 まだ${hidden}個の設計図が隠れている。新しい材料を見つけると現れるよ。</p>`:""}
  ${done.length?`<div class="sec">持っている道具・設備</div><div class="grid2">${done.map(craftCard).join("")}</div>`:""}`;
}

/* ===================== 図鑑 ===================== */
function viewBook(){
  const prog = E.tagProgress(S), all = Object.keys(IT), total = all.length, got = all.filter(k=>S.disc[k]).length;
  const list = U.filter==="すべて"? all : all.filter(k=>IT[k].tags.includes(U.filter));
  return `<div class="sec">物質・製品図鑑 <small>発見${got}／収録${total}</small></div>
  <div class="bars"><button class="bar" data-act="filter" data-id="すべて" aria-pressed="${U.filter==="すべて"}">すべて ${got}/${total}<div class="m"><i style="width:${got/total*100}%"></i></div></button>
    ${prog.map(p=>`<button class="bar" data-act="filter" data-id="${p.tag}" aria-pressed="${U.filter===p.tag}">${p.tag} ${p.got}/${p.total}<div class="m"><i style="width:${p.got/p.total*100}%"></i></div></button>`).join("")}</div>
  <p class="desc">点線の❔はヒントが見られるよ。分類は重なることがある（例：銅は「元素」と「金属・合金」の両方）。</p>
  <div class="dex">${list.map(k=>{ const st=E.status(S,k); return `<button class="dx ${st}" data-act="item" data-id="${k}"><span class="i">${st==="known"?ic(k):"❔"}</span><span class="n">${st==="known"?IT[k].name:"？？？"}</span></button>`; }).join("")}</div>
  <div class="sec">実験操作の図鑑 <small>どんな操作があるのか</small></div>
  <div class="oplist">${Object.keys(OPS).map(o=>{ const fs=Object.keys(IT).filter(f=>IT[f].facility&&IT[f].ops.includes(o)); const can=fs.some(owned);
    return `<div class="opc"><b>${opIc(o)} ${OPS[o].name}</b>（${OPS[o].yomi}）${can?"":' <span class="tag" style="background:var(--line);color:var(--muted)">未解放</span>'}<br>${OPS[o].kid}<br><small style="color:var(--muted)">使える装置：${fs.map(f=>S.disc[f]?nm(f):"？？？").join("・")}</small></div>`; }).join("")}</div>`;
}
function openItem(id){
  const it = IT[id], st = E.status(S,id), r = S.disc[id], sh = $("#sheet");
  if(st!=="known"){
    sh.innerHTML = `<button class="close" data-act="close">閉じる</button><div class="hd"><span class="bigi" style="filter:grayscale(1);opacity:.5">❔</span><div><h2>？？？</h2><div class="yomi">分類：${it.tags.join("・")}</div></div></div>
      <div class="kidbox">🦉 ${st==="hinted"?"ヒント：":""}${E.hint(S,id)}</div>`;
  } else {
    const pr = E.producers(id), us = E.usesOf(id);
    const fmtP = p => `${opIc(p.op)}${OPS[p.op].name}（${p.at.map(f=>S.disc[f]?nm(f):"？？？").join("／")}）：${Object.keys(p.inp).map(k=>S.disc[k]?nm(k):"？？？").join("＋")}`;
    const knownRoutes = r.routes.map(rt=>{ const p=D.procs.find(x=>x.id===rt), c=D.crafts.find(x=>x.id===rt);
      if(p) return fmtP(p); if(c) return "🔨工作："+Object.keys(c.inp).map(nm).join("＋");
      if(rt.startsWith("gather:")) return "🗺️ "+(D.regions.find(x=>x.id===rt.slice(7))||{}).name+"で採取";
      if(rt.startsWith("rare:")) return "✨ "+(D.regions.find(x=>x.id===rt.slice(5))||{}).name+"で珍しい発見"; return rt; });
    const otherRoutes = pr.procs.filter(p=>!r.routes.includes(p.id)).length + pr.crafts.filter(c=>!r.routes.includes(c.id)).length;
    const usesL = us.procs.map(p=>Object.keys(p.out)).flat().concat(us.crafts.map(c=>c.out)).filter((v,i,a)=>a.indexOf(v)===i);
    const showP = owned("balance"), why = pr.procs.find(p=>r.routes.includes(p.id));
    sh.innerHTML = `<button class="close" data-act="close">閉じる</button>
    <div class="hd"><span class="bigi">${ic(id)}</span><div><h2>${it.name}</h2><div class="yomi">${it.yomi}・${it.en}</div></div></div>
    <div class="kidbox">${it.kid}</div>
    <h5>📘 くわしく</h5><p style="margin:0;font-size:.9rem">${it.more}</p>
    ${why?`<h5>🔬 何が起きてできたの？</h5><p style="margin:0;font-size:.9rem">${why.why}</p>`:""}
    <dl class="kv">${it.f?`<dt>化学式</dt><dd>${it.f}</dd>`:""}<dt>分類</dt><dd>${it.tags.join("・")}</dd>
      ${it.el&&it.el.length?`<dt>含む元素</dt><dd>${it.el.join(" ")}</dd>`:""}
      ${it.mp?`<dt>融点（溶ける温度）</dt><dd>${it.mp}</dd>`:""}${it.bp?`<dt>沸点（沸騰する温度）</dt><dd>${it.bp}</dd>`:""}
      ${it.nature?`<dt>自然の中では</dt><dd>${it.nature}</dd>`:""}${it.uses?`<dt>主な使い道</dt><dd>${it.uses}</dd>`:""}
      ${it.facility?`<dt>できる操作</dt><dd>${it.ops.map(o=>OPS[o].name).join("・")||"（特別な効果がある設備）"}</dd>`:""}
      <dt>情報の出典</dt><dd>一般的な化学・地学・歴史の知識にもとづくゲーム用の解説</dd></dl>
    <h5>📓 あなたの研究記録</h5>
    <dl class="kv"><dt>初発見</dt><dd>${new Date(r.first).toLocaleString("ja-JP")}</dd><dt>作った・拾った回数</dt><dd>${r.made}回（合計${r.total}個）</dd>
      ${it.purity?`<dt>最高純度</dt><dd>${showP?"約"+(r.best>=0.999?"99.99":Math.round(r.best*100))+"%":"？（てんびんでわかる）"}</dd>`:""}
      ${it.store===false?`<dt>保管</dt><dd>気体なので集められない（記録のみ）</dd>`:`<dt>今持っている</dt><dd>${E.cnt(S,id)}個</dd>`}</dl>
    <h5>🧭 見つけた作り方</h5><ul>${knownRoutes.map(x=>`<li>${x}</li>`).join("")}</ul>
    ${otherRoutes?`<p class="desc">ほかにも${otherRoutes}通りの作り方があるみたい…</p>`:""}
    <h5>🔗 これを使うとできるもの</h5><ul>${usesL.length?usesL.map(k=>`<li>${S.disc[k]?ic(k)+" "+nm(k):"❔ ？？？"}</li>`).join(""):"<li>今のところなし</li>"}</ul>
    ${procNeedsHTML(id)}
    <div class="row mt"><button class="btn small sub" data-act="target" data-id="${id}">🕸️ 技術マップで見る</button></div>`;
  }
  sh.scrollTop=0; openModal(sh.querySelector(".close"));
}

/* ===================== 技術マップ ===================== */
function techStatus(id){
  if(S.disc[id]) return "done";
  const pr = E.producers(id);
  if(pr.crafts.some(c=>E.planCraft(S,c).ok)) return "can";
  if(pr.procs.some(p=>p.at.some(owned) && p.tools.every(owned) && Object.keys(p.inp).every(k=>E.cnt(S,k)>=p.inp[k]))) return "can";
  if(E.status(S,id)==="hinted") return "hint";
  return "none";
}
function r_known(rt){ return Object.values(S.disc).some(d=>d.routes&&d.routes.includes(rt)); }
function tree(id, depth, seen){
  const k = S.disc[id], st = E.status(S,id);
  const label = `<span class="nd ${k?"k":""}">${k?ic(id)+" "+nm(id):"❔ ？？？"}</span>`;
  if(depth>5 || seen.has(id)) return `<li>${label}</li>`;
  seen = new Set(seen); seen.add(id);
  const pr = E.producers(id);
  if(pr.regions.length && !pr.procs.length && !pr.crafts.length)
    return `<li>${label}<span class="via">🗺️ ${k||st!=="hidden"?pr.regions.map(r=>r.name).join("・")+"で取れる":"どこかで取れる"}</span></li>`;
  const p = pr.procs.find(x=>r_known(x.id)) || pr.procs.find(x=>Object.keys(x.inp).every(i=>S.disc[i])) || pr.procs[0];
  const c = pr.crafts.find(x=>r_known(x.id)) || pr.crafts[0];
  const step = p || c; if(!step) return `<li>${label}</li>`;
  const reveal = k || Object.keys(step.inp).every(i=>S.disc[i]);
  const via = p ? `${reveal?opIc(p.op)+OPS[p.op].name:"？？の操作"}（${p.at.map(f=>S.disc[f]?nm(f):"？？？").join("／")}）` : "🔨工作"+(c.at?"（"+(S.disc[c.at]?nm(c.at):"？？？")+"）":"");
  const alt = pr.procs.length + pr.crafts.length > 1 ? ` ほか${pr.procs.length+pr.crafts.length-1}ルート` : "";
  const kids = Object.keys(step.inp).concat(step.tools||[]).concat(step===c&&c.at?[c.at]:[]);
  return `<li>${label}<span class="via">← ${via}${alt}</span><ul>${kids.map(i=>tree(i,depth+1,seen)).join("")}</ul></li>`;
}
function viewMap(){
  const opts = Object.keys(IT).filter(k=>E.status(S,k)!=="hidden");
  if(!U.target || !opts.includes(U.target)) U.target = opts.find(k=>!S.disc[k]) || opts[0];
  return `<div class="sec">技術マップ <small>技術と物質のつながり</small></div>
  <div class="legend"><span>🟩 開発済み</span><span>🟨 今作れる</span><span>⬜ 点線：手がかりあり</span><span>灰色：未開発</span></div>
  <div class="eras">${D.eras.map(e=>`<div class="era ${e.future?"future":""}"><h4>${e.name}</h4><p>${e.kid}</p>
    ${e.techs.map(t=>{ const s=techStatus(t); return `<button class="tn ${s}" data-act="target" data-id="${t}">${s!=="none"?ic(t):"❔"} ${s==="none"?"？？？":nm(t)}</button>`; }).join("")||"<p>🚧 準備中</p>"}</div>`).join("")}</div>
  <div class="sec">目標から探す <small>選んだものに必要な材料・装置をたどる</small></div>
  <div class="card"><select data-act="pick" aria-label="目標を選ぶ">${opts.map(k=>`<option value="${k}" ${k===U.target?"selected":""}>${S.disc[k]?IT[k].icon+" "+IT[k].name:"❔ ？？？（"+IT[k].tags[0]+"）"}</option>`).join("")}</select>
    ${U.target?`<p class="desc">${S.disc[U.target]?IT[U.target].kid:"🦉 "+E.hint(S,U.target)}</p><div class="tree"><ul>${tree(U.target,0,new Set())}</ul></div>
    <h5 style="margin:12px 0 4px">🔗 これを使うとできるもの</h5><div class="need">${(()=>{ const us=E.usesOf(U.target); const l=us.procs.map(p=>Object.keys(p.out)).flat().concat(us.crafts.map(c=>c.out)).filter((v,i,a)=>a.indexOf(v)===i);
      return l.length? l.map(k=>`<span class="${S.disc[k]?"ok":""}">${S.disc[k]?ic(k)+nm(k):"❔？？？"}</span>`).join("") : "<span>なし</span>"; })()}</div>`:""}
  </div>`;
}

/* ===================== 記録 ===================== */
function viewLog(){
  const tests = E.runTests(), passN = tests.filter(t=>t.pass).length;
  return `<div class="sec">実験の記録 <small>新しい順（最大200件）</small></div>
  <div class="card hist">${S.hist.slice(0,30).map(h=>{ const p = h.k==="exp"? D.procs.find(x=>x.id===h.proc):null;
    return `<div class="h"><span>${p?opIc(p.op):"🔨"}</span><span class="t">${Object.keys(h.inp).map(k=>nm(k)+"×"+h.inp[k]).join("＋")} → ${Object.keys(h.out).map(k=>nm(k)+"×"+h.out[k]).join("＋")}<br><small style="color:var(--muted)">${new Date(h.t).toLocaleTimeString("ja-JP")}${p?"・"+nm(h.fac):""}</small></span>
      ${p&&owned("notebook")?`<button class="btn small sub" data-act="again" data-proc="${p.id}" data-fac="${h.fac}">もう一度</button>`:""}</div>`; }).join("") || "<p class='desc'>まだ記録がないよ。</p>"}
    ${!owned("notebook")?`<p class="desc">📓 研究ノートを作ると、ここから同じ実験をすぐ繰り返せるようになるよ。</p>`:""}</div>
  <div class="sec">セーブデータ <small>自動でブラウザに保存されています（スキーマv${E.SCHEMA}）</small></div>
  <div class="card"><p class="desc" style="margin-top:0">別の端末に移すときは、下の文字をコピーして、移した先で「読み込む」に貼り付けてね。クラウド同期はまだありません。</p>
    <textarea id="exportBox" readonly>${E.serialize(S).replace(/</g,"&lt;")}</textarea>
    <div class="row mt"><button class="btn small sub" data-act="copy">📋 コピー</button></div>
    <textarea id="importBox" class="mt" placeholder="ここにセーブデータを貼り付ける"></textarea>
    <div class="row mt"><button class="btn small" data-act="import">📥 読み込む</button><button class="btn small sub" data-act="reset">🗑️ 最初からやり直す</button><span class="desc" id="saveMsg"></span></div></div>
  <div class="sec">動作テスト <small>${passN}/${tests.length}合格（このタブを開くたびに実行）</small></div>
  <div class="card"><ul class="tests">${tests.map(t=>`<li>${t.pass?"✅":"❌"} ${t.name}${t.pass?"":"："+t.detail}</li>`).join("")}</ul></div>
  <div class="sec">このバージョンでできること・まだできないこと</div>
  <div class="card status"><ul>
    <li>✅ 探検できる地域：${D.regions.length}か所・物質と道具と設備あわせて${Object.keys(IT).length}種（珍しい発見${Object.values(IT).filter(i=>i.tags.includes("珍しい発見")).length}種を含む）</li>
    <li>✅ 実験操作${Object.keys(OPS).length}種・反応${D.procs.length}通り・工作${D.crafts.length}通り（同じものへの別ルートあり）</li>
    <li>✅ 文明の段階：原始時代 → 初期化学 → 近代工業 → 現代科学（フィールドと研究室が6段階で変化）</li>
    <li>✅ 探検：HD-2Dの3Dフィールド（タップ移動・スティック・キーボード）、会心・コンボ・探索Lv・珍しい発見・資源の再生・自動採取。3Dが使えない環境では2Dの地図に自動で切り替え</li>
    <li>⏳ 温度・時間の細かい設定、工程の完全自動化、第5段階（集積回路など）、医薬品研究、外部の科学データベース連携、クラウド同期は今後のアップデート</li>
  </ul></div>`;
}

/* ===================== イベント ===================== */
document.addEventListener("click", ev=>{
  const b = ev.target.closest("[data-act],[data-tab]"); if(!b){ if(ev.target.id==="modal") closeModal(); return; }
  if(b.disabled) return;
  const a = b.dataset.act, id = b.dataset.id;
  if(!a && b.dataset.tab){ setTab(b.dataset.tab, b); return; }
  switch(a){
    case "tab": setTab(b.dataset.tab, b); break;
    case "closepanel": setTab("explore"); break;
    case "add": if(U.busy) break; if((U.tray[id]||0) < E.cnt(S,id) || (E.vflag(S,"free") && (U.tray[id]||0) < 99)){ U.tray[id]=(U.tray[id]||0)+1; U.last=null; } drawLabCtl(); drawScene(); break;
    case "sub": if(U.busy) break; U.tray[id]--; if(U.tray[id]<=0) delete U.tray[id]; drawLabCtl(); drawScene(); break;
    case "fac": if(U.busy) break; U.fac = U.fac===id?null:id; U.op=null; drawLabCtl(); drawScene(); break;
    case "op": if(U.busy) break; U.op = U.op===id?null:id; drawLabCtl(); drawScene(); break;
    case "run": runLab(); break;
    case "hint": { const h=E.suggest(S); U.last=`<div class="note"><h4>🦉 ホウ博士のヒント</h4><p style="margin:0">${h.text}</p></div>`; drawLabCtl(); break; }
    case "again": { if(U.busy) break; const p=D.procs.find(x=>x.id===b.dataset.proc); U.tray=Object.assign({},p.inp); U.fac=b.dataset.fac; U.op=p.op; U.last=null;
      if(U.tab!=="lab") setTab("lab", b); else renderPanel(); runLab(); break; }
    case "go": travel(id); break;
    case "g3": /* 指・ペンは pointerup で処理済み。古い Safari では click に pointerType がないので、直後の click は時刻で見分ける */
      if((!ev.pointerType || ev.pointerType==="mouse") && !(W3.actTouchAt && performance.now()-W3.actTouchAt < 800)) pressAction(); break;
    case "w3pick": { if(!fieldInputActive()) break; const o=WORLD&&WORLD.byId.get(b.dataset.o); if(o){ if(W3.near&&W3.near.o===o) pressAction(); else selectAndGo({o}); } break; }
    case "w3go": { if(!fieldInputActive()) break; const n=NODES&&NODES.find(x=>x.key===b.dataset.n); if(n){ if(W3.near&&W3.near.n===n) pressAction(); else selectAndGo({n}); } break; }
    case "travel": { const r=D.regions.find(x=>x.id===id); if(!E.regionOpen(S,r)) break; /* 理由はボタンに表示済み */
      setTab("explore"); if(W3.state==="ready"){ goTo3D(r.w.x,r.w.z+REGION_R*0.2,null); banner(r.icon+" "+r.name+"へ向かう"); } break; }
    case "home": setTab("explore"); if(W3.state==="ready"){ goTo3D(D.base.x,D.base.z,null); banner("🏠 拠点へ戻る"); } break;
    case "rescue": setTab("explore"); if(W3.state==="ready") rescue(); break;
    case "hero": { S.flags.hero = S.flags.hero==="girl"?"boy":"girl"; save(); if(W3.gfx) heroSheet3D().then(u=>W3.gfx.setPlayerSpriteSheet(u)); banner(S.flags.hero==="girl"?"👧 女の子に交代！":"👦 男の子に交代！"); break; }
    case "pickhero": S.flags.hero=id; save(); if(W3.gfx) heroSheet3D().then(u=>W3.gfx.setPlayerSpriteSheet(u)); document.querySelectorAll(".heropick").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===id)); const av=$("#avatar"); if(av) av.style.backgroundImage=`url(${heroUrl()})`; break;
    case "view2d": S.flags.view="2d"; pause3D(); save(); fieldSig=""; renderField(); renderPanel(); break;
    case "view3d": S.flags.view="3d"; save(); fieldSig=""; renderField(); renderPanel(); break;
    case "introagain": S.flags.intro=0; setTab("explore"); intro(); break;
    case "gather": doGather(b.dataset.r, id); break;
    case "auto": { const i=S.auto.findIndex(x=>x.r===b.dataset.r&&x.id===id); if(i>=0) S.auto.splice(i,1); else if(S.auto.length<E.autoSlots(S)) S.auto.push({r:b.dataset.r,id}); save(); drawRegion(); break; }
    case "craft": { const r=E.runCraft(S,id,S.seq); if(r.ok){ afterChange(r.news); render(); } break; }
    case "filter": U.filter=id; renderPanel(); break;
    case "item": openItem(id); break;
    case "close": closeModal(); break;
    case "target": closeModal(); U.target=id; if(U.tab!=="map") setTab("map", b); else renderPanel(); break;
    case "copy": { const t=$("#exportBox"); t.select(); try{ navigator.clipboard.writeText(t.value); $("#saveMsg").textContent="コピーしたよ"; }catch(e){ $("#saveMsg").textContent="文字を選んでコピーしてね"; } break; }
    case "import": { try{ const n=E.deserialize($("#importBox").value.trim()); S=VERIFY?E.makeVerifyState(n):n; lastMission=E.missionIndex(S); lastStage=stage(); U.tray={}; U.fac=null; U.op=null; fieldSig=""; applySavedPos(); save(); renderChrome(); render(); $("#saveMsg").textContent="読み込んだよ"; }catch(e){ $("#saveMsg").textContent="読み込めなかった：形式が違うみたい"; } break; }
    case "reset": if(confirm(VERIFY?"検証データを全解放の状態に作り直す？（通常のセーブはそのまま）":"本当に最初からやり直す？（発見の記録も消えます）")){ S=VERIFY?E.makeVerifyState():E.newState(); lastMission=0; lastStage=0; U.tray={}; U.fac=null; U.op=null; U.last=null; U.region="forest"; fieldSig=""; applySavedPos(); save(); setTab("explore"); renderChrome(); render(); intro(); } break;
  }
});
document.addEventListener("change", ev=>{ if(ev.target.dataset.act==="pick"){ U.target=ev.target.value; renderPanel(); } });
document.addEventListener("keydown", ev=>{
  if(ev.key!=="Escape") return;
  if(W3.place && !modalOpen() && U.tab==="explore"){ ev.preventDefault(); placeCancel(); return; }
  if(modalOpen()){ ev.preventDefault(); closeModal(); }
  else if(U.tab!=="explore"){ ev.preventDefault(); setTab("explore"); }
});
let modalOpener = null;
function openModal(focusEl){
  if(!modalOpen()) modalOpener = document.activeElement;
  haltField();
  $("#modal").classList.add("open"); $("#app").inert = true; document.documentElement.classList.add("modal-on");
  const f = focusEl || $("#sheet").querySelector("button"); if(f) f.focus({preventScroll:true});
}
function closeModal(){
  if(!modalOpen()) return;
  endTalk();
  $("#modal").classList.remove("open"); $("#app").inert = false; document.documentElement.classList.remove("modal-on");
  const o = modalOpener; modalOpener = null;
  if(o && o.isConnected && !o.closest("[inert],[hidden]")) o.focus({preventScroll:true});
  else if(U.tab!=="explore"){ const h=$("#dockTitle"); if(h) h.focus({preventScroll:true}); }
}

/* 自動採取 */
setInterval(()=>{ if(document.hidden || SPACE.locked(S) || !S.auto.length) return; const got=E.autoTick(S); if(got.length){ afterChange(got.flatMap(g=>g.news)); if(U.tab==="lab" && !U.busy) drawLabCtl(); drawRegion(); } }, 10000);

/* はじめに */
function intro(){
  if(S.flags.intro) return;
  const touch = uiMode()==="touch";
  $("#sheet").innerHTML = `<div class="hd"><span class="bigi">🦉</span><div><h2>ゼロからの科学</h2><div class="yomi">〜石と水と木から〜</div></div></div>
  <div class="kidbox">ようこそ！ 私はホウ博士。ここには道具も研究所も何もない。あるのは石と水と木だけ。<br>でも科学の力があれば、ガラスも金属も、電気もプラスチックも作れるんだ。一緒に文明を作り直そう！</div>
  <ul><li>🗺️ <b>探索</b>：この画面がフィールド。歩いて、自然の材料を採取する</li>
    <li>${touch?"下のボタン":"下のメニュー"}で開く：🧪 <b>研究室</b>（実験）・🔨 <b>工作</b>（道具づくり）${touch?"・☰ <b>メニュー</b>（図鑑・技術・記録・設定）":"・📖 <b>図鑑</b>・🕸️ <b>技術</b>・📓 <b>記録</b>"}</li>
    <li>${touch?"左下のスティックで歩き、右下のボタンで採取":"WASD か矢印キーで歩き、E キーで採取（クリックでも移動・採取できる）"}</li></ul>
  <h5>主人公を選んでね（あとで「設定」でも変えられる）</h5>
  <div class="row">${["boy","girl"].map(h=>`<button class="heropick" data-act="pickhero" data-id="${h}" aria-pressed="${(S.flags.hero||"boy")===h}"><span class="hero big" style="background-image:url(${ASSETS[h]})"></span>${h==="boy"?"男の子":"女の子"}</button>`).join("")}</div>
  <p class="desc">このゲームの化学は本物の化学がもとになっています。でも火や薬品を使う実験は危ないので、現実では大人と一緒に安全な場所でやろうね。</p>
  <div class="row mt"><button class="btn big" data-act="close" id="introGo">始める！</button></div>`;
  if(!S.flags.hero) S.flags.hero="boy";
  openModal($("#introGo")); S.flags.intro=1; save();
}
document.getElementById("app").dataset.ui = document.documentElement.dataset.ui = detectUi(); applyIcons(); bindHudInput(); renderChrome(); render(); layout(); intro();
/* ===================== 主人公の向き（ワールドの向き＋カメラから見た絵の行。2026-11-08） =====================
   W3.face：主人公がワールドで向いている角度（atan2(x,z)。0＝+Z、π/2＝+X）。実際に進んだ向きでだけ変わり、カメラを回しても変わらない。
   絵の行は「向き − カメラの画面下方向」の相対角で選ぶ（描画モジュールの絵は4方向：正面・右・背中・左。斜めの絵はまだない）。
   境界の前後で絵が細かく入れ替わらないよう、今の行の中心から ±(45°＋FACE_HYST) を超えたときだけ行を変える。
   描画モジュールは受け取ったワールドの4方向からカメラ基準で行を選ぶ（CharacterRenderer.rowForDirection）ので、
   選びたい行になるワールドの向きを渡す（カメラの向きが決まれば、4方向のどれか1つが必ずその行になる）。 */
const DIR_ANGLE = {down:0, "down-right":Math.PI/4, right:Math.PI/2, "up-right":Math.PI*3/4, up:Math.PI, "up-left":-Math.PI*3/4, left:-Math.PI/2, "down-left":-Math.PI/4};
const SECTOR_OF = {down:0, right:1, up:2, left:3}, SECTOR_NAME = ["down","right","up","left"];
const DIR8 = ["down","down-right","right","up-right","up","up-left","left","down-left"];   // 相対角 0°,45°,… の順（主人公の画面右側を通って回る）
const FACE_HYST = {4:10, 8:6};   // 度：行の中心から ±(半セクター＋これ) を超えたら切り替える
const wrapPi = a => { a = (a + Math.PI) % (Math.PI*2); if(a < 0) a += Math.PI*2; return a - Math.PI; };
/* 8方向の絵を使うか：シートが8行（ASSETS.heroRows）で、描画モジュールの行選びの自己点検（HD2D.diag8Check）に通ったときだけ。
   通らない旧版はシートの上4行だけで表示する。Muse §31（第25ラウンド）の修正版では自己点検に通り、男女とも8行のまま使う。 */
function heroDirs(){ if(W3.heroDirs) return W3.heroDirs;
  let n = 4; try{ if((ASSETS.heroRows||4)===8 && window.HD2D && typeof HD2D.diag8Check==="function"){ const r=HD2D.diag8Check(); W3.diag8=r; if(r.ok) n=8; } }catch(e){}
  return W3.heroDirs = n; }
function screenDownAngle(){ const T=HD2D.THREE, v=new T.Vector3(); W3.gfx.getCamera().getWorldDirection(v); return Math.atan2(-v.x, -v.z); }
/* 画面基準の向き（古いセーブの dir）をワールドの向きへ */
function faceFromScreen(screenDir){ try{ return wrapPi(screenDownAngle() + SECTOR_OF[screenDir]*Math.PI/2); }catch(e){ return DIR_ANGLE[screenDir]||0; } }
/* 今の絵の行のセクター（n=4：0 正面・1 右・2 背中・3 左。n=8：45°ずつ）。ヒステリシスつき */
function faceSector(){
  const n = heroDirs(), w = Math.PI*2/n;
  if(!W3.gfx || typeof W3.gfx.getCamera!=="function") return (SECTOR_OF[W3.dir]||0) * n/4;
  if(W3.faceN !== n){ W3.faceN = n; W3.faceSec = null; }
  const rel = wrapPi((W3.face||0) - screenDownAngle()), cur = W3.faceSec;
  if(cur!=null && Math.abs(wrapPi(rel - cur*w)) < w/2 + FACE_HYST[n]*Math.PI/180) return cur;
  return W3.faceSec = ((Math.round(rel/w) % n) + n) % n;
}
/* 描画モジュールへ渡すワールドの向き：モジュールがその行を選ぶもの。
   モジュールは渡された向きの角度とカメラから行を選ぶので、ワールドの n 方向のうち「狙った行になる1つ」を渡す（カメラ角が決まれば必ず1つある） */
function worldFacing(){
  const n = heroDirs(), want = faceSector(), names = n===8 ? DIR8 : SECTOR_NAME;
  if(!W3.gfx || typeof W3.gfx.getCameraYawDegrees!=="function") return names[want];
  const sd = screenDownAngle(), w = Math.PI*2/n;
  for(const d of names){ let rel=(DIR_ANGLE[d]-sd)%(Math.PI*2); if(rel<0) rel+=Math.PI*2; if(Math.round(rel/w)%n===want) return d; }
  return names[want];
}
/* 画面基準の向き（W3.dir）は4方向の近いほう（表示・保存の互換用） */
function playerVisual(st){
  const d=worldFacing(), n=heroDirs();
  if(W3.faceSec!=null) W3.dir = SECTOR_NAME[Math.round(W3.faceSec*4/n)%4];
  /* 8行では連続したワールド角を正本にする（Muse §31）。direction は旧版・4行用の互換値。
     停止やカメラ回転では face を変えず、描画側がカメラとの相対角から行を選ぶ（Codex 58f2b0b）。 */
  return Object.assign({}, st, {direction:d}, n===8 && finite(W3.face) ? {facing:W3.face} : {}, st.moving ? {} : {speed:0});
}
/* 3D の主人公のシート：8方向を使うなら8行のまま。使わないなら上4行（従来の下・左・右・上）だけを切り出す（その場で作って覚えておく） */
function heroSheet3D(h){
  const heroCrop = W3.heroCrop || (W3.heroCrop = {});   // start3D から最初の描画前に呼ばれることがあるので、const を使わない
  h = h || heroAssetKey();
  if((ASSETS.heroRows||4)!==8 || heroDirs()===8) return Promise.resolve(ASSETS[h]);
  return heroCrop[h] || (heroCrop[h] = new Promise(res=>{ const im=new Image(); im.onload=()=>{ try{ const c=document.createElement("canvas"); c.width=im.width; c.height=im.width;
      c.getContext("2d").drawImage(im, 0, 0, im.width, im.width, 0, 0, im.width, im.width); res(c.toDataURL("image/png")); }catch(e){ res(ASSETS[h]); } };
    im.onerror=()=>res(ASSETS[h]); im.src=ASSETS[h]; }));
}
document.documentElement.style.setProperty("--hero-rows", String(ASSETS.heroRows||4));

/* ===================== 探索カメラ（ドラッグで回転・上下、ピンチ／ホイールで距離。2026-11-08） =====================
   角度の定義（ゲームとモジュールで同じ）：見下ろし角＝水平から下への角度。0°＝注視点と同じ高さの水平視点、70°＝上から70°。
   モジュールの CameraController も pitchDegrees を「水平からの仰角」（offset.y＝sin(pitch)）で持つので換算はいらない（極角ではない）。
   カメラは正投影：見え方の大きさは表示範囲 viewSize（ズーム）で決まり、カメラ本体の距離（distance）は「どこまで手前を描くか」だけを変える。

   【高さを固定する（2026-11-08 改訂。それまでの「地形の高さの変化に追従」を置き換え）】
   - 描画モジュールは毎フレーム、注視点の高さを主人公の足もとの地面の高さへなめらかに合わせる（GraphicsEngine の loop：
     setTarget(x, z, getGroundHeight(x, z))）。これが「坂・起伏でカメラが勝手に上下する」原因。モジュールは変えられないので、
     ゲームが毎フレーム、モジュールの注視点の高さの変化をちょうど打ち消す：画面の上下方向のずらし（setViewportInsets の差）と
     カメラ本体の距離（distance、第24ラウンド）。正投影なので、これで「決めた高さに置いたカメラ」と同じ絵・同じ本体の位置になる。
   - 基準の高さ（W3.cam.base）は、読み込み・瞬間移動・地域移動・「視点を戻す」のときだけ、その時の主人公の足もとの高さにする。
     歩いている間は変えない。主人公への追従は水平だけ（モジュールの水平のなめらかな追従をそのまま使う）。歩く絵の上下動は元から入らない。
   - 低い角度：見下ろし角が CAM.lowBlend 以下になるほど、注視点（画面の中心）を基準＋CAM.lowFocus（足もと＋0.3、主人公の身長1.7の約18%）
     へ下げ、モジュールの「主人公を画面の少し下に置く」ずらし（anchorOffset 0.09×表示範囲）を弱める。角度はユーザーのドラッグだけで変わる。
   - 地形で角度を勝手に上げる処理（旧 camNeed）は廃止。
   【衝突（地形・建物の中にカメラを入れない）】
   - 正投影では、カメラ本体の面（近い面）より手前は描かれない。近い面が地形・建物と交わると、その断面が画面に出る（地表の貫通）。
     希望の値（W3.cam の yaw・pitch・zoom、距離 CAM.dist）と、実際に置く値（W3.cam.a）を分ける。
   - まず距離だけを変えて、近い面の四角が地形・建物＋余裕より上にあり（必須）、主人公からカメラへの線が地形・建物で隠れない（できれば）距離を
     希望の距離に近い順に探す（短くする方を先に）。
   - 置ける距離がないとき：ユーザーの操作で角度・ズームが変わった分を止める（安全な直前の値のまま。希望の値は書き換えない）。
     それでも駄目なら、注視点の水平の追従を止める（setCameraTarget で直前の安全な位置に留める）。置けるようになったら戻す（なめらか）。
     勝手に角度を上げない・地面や壁をすり抜けさせない。 */
const CAM = {
  tapSlop: 8,          // タップとドラッグの境（CSSピクセル）
  tapTime: 450,        // これより長く押したままなら、動かさなくてもタップにしない（ミリ秒）
  yawPerShort: 240,    // 画面の短い辺の長さだけ横へドラッグしたときの回転（度）×感度
  pitchPerShort: 110,  // 同じく縦へドラッグしたときの見下ろし角の変化（度）×感度
  smooth: 24,          // 手ぶれを抑える平滑化（毎秒。大きいほど速く追いつく。指を離すと約0.15秒で止まる＝慣性なし）
  resetRate: 5,        // 「視点を戻す」で戻る速さ（毎秒）
  pitch: [0, 70],      // 見下ろし角の範囲（度）
  zoomMul: [0.55, 1.9],// 距離（表示範囲）の範囲：標準に対する倍率
  wheelStep: 1.12,     // ホイール1段の倍率
  sens: [0.3, 2.5],    // 感度の範囲（設定画面）
  lowFocus: 0.3,       // 見下ろし角0°での注視点（画面の中心の高さ）：基準の足もと＋（マス）。主人公の身長1.7の約18%
  lowBlend: 25,        // この見下ろし角より低いほど、注視点を下げ、画面の下寄せを弱める（度）
  dist: 90,            // 希望するカメラ本体の距離（マス。モジュールの既定と同じ）
  distSteps: [90, 75, 60, 45, 32, 22, 15, 10, 110, 140],   // 置ける距離を探す順（短くする方を先に）。正投影では本体より手前の物がすべて重なって描かれるので、140 より遠くには置かない（遠くの山が画面を覆うため）
  nearMargin: 0.3,     // 近い面と地形・建物との余裕（マス）
  segSide: 1.0,        // 主人公からカメラへの線の左右にも見る幅（マス）
  checkEvery: 0.1,     // 衝突を調べる間隔（秒。角度・ズーム・位置が大きく変わったらすぐ）
  /* 山のカメラ（2026-11-11 オーナーの依頼「火山を登るとき、カメラが斜面にめり込まないよう、壁に合わせてキャラに近づく（マインクラフトのように）」）：
     火山の上（volcanoZone）では、回転の中心を主人公の高さにし（なめらかに追う）、主人公からカメラへの線が斜面に当たる手前までカメラ本体を近づける。
     正投影なので近づいても大きさは変わらず、主人公より手前の斜面は近い面で切られて見えなくなる。平地の「高さの固定」はそのまま */
  mtnFollow: 4,        // 回転の中心の高さが主人公の足もとを追う速さ（毎秒）
  mtnGap: 1.2,         // 斜面に当たる所から手前へ空ける距離（マス）
  mtnMin: 0.6,         // いちばん近づいたときの距離（マス。近い面は 0.1 なので、主人公のすぐ前まで寄れる）
  mtnOut: 2.5,         // 斜面が開けたとき、元の距離へ戻る速さ（毎秒。近づくときはすぐ）
  mtnExit: 3,          // 火山の帯の外へ出てから元のカメラに戻るまでの余白（マス。出入りでちらつかない）
};
/* 主人公からカメラの向き B へ、最初に地形・建物に当たる距離（当たらなければ Infinity）。胸・足もと・左右の線で見る */
function camHitDist(pl, ax, maxD, bl){
  let hit = Infinity;
  for(const [hh, s] of [[1.2,0],[0.35,0],[1.2,-0.8],[1.2,0.8]]){
    for(let t=0.6; t<Math.min(maxD, hit); t+=(t<8?0.3:t<30?0.8:2)){
      const px=pl.x+ax.B.x*t+ax.R.x*s, py=pl.y+hh+ax.B.y*t, pz=pl.z+ax.B.z*t+ax.R.z*s;
      if(py < camHeightAt(px, pz, bl) + 0.1){ hit = t; break; } } }
  return hit;
}
const CAM_MOD_DIST_MIN = 10;   // 描画モジュールが受け付ける距離の下限
function camMountain(){ if(!W3.pos || !window.TERRAIN || !TERRAIN.volcanoZone || !TERRAIN.VOLCANO) return false;
  const V=TERRAIN.VOLCANO, r=Math.hypot(W3.pos.x-V.x, W3.pos.z-V.z), inZone = !!TERRAIN.volcanoZone(W3.pos.x, W3.pos.z);
  if(inZone) W3.camMtn = true; else if(r > V.footR + 4 + CAM.mtnExit) W3.camMtn = false;
  return !!W3.camMtn; }
const camSupported = ()=> !!(W3.gfx && typeof W3.gfx.setCameraOrbit==="function");
const clampN = (v,a,b)=> Math.max(a, Math.min(b, v));
const finite = v => typeof v==="number" && isFinite(v);
const damp = (rate, dt)=> 1 - Math.exp(-rate*dt);    // フレームレートに依存しない平滑化の割合
const sstep = (a,b,x)=>{ const t=clampN((x-a)/(b-a),0,1); return t*t*(3-2*t); };
function camDefaults(){ const c=(W3.cfg && W3.cfg.camera)||{}; return {yaw:c.yawDegrees!=null?c.yawDegrees:45, pitch:c.pitchDegrees!=null?c.pitchDegrees:32, zoom:c.viewSize!=null?c.viewSize:13}; }
function camPitchLim(){ return [Math.max(CAM.pitch[0], W3.camPitchMin||0), CAM.pitch[1]]; }
function camZoomLim(){ const z=camDefaults().zoom; return [+(z*CAM.zoomMul[0]).toFixed(2), +(z*CAM.zoomMul[1]).toFixed(2)]; }
/* 保存された値を安全な範囲へ（壊れた値・古い版の値は標準へ） */
function camUser(){
  const d=camDefaults(), u=(S.camera && typeof S.camera==="object") ? S.camera : {}, pl=camPitchLim(), zl=camZoomLim();
  return { yaw: finite(u.yaw) ? ((u.yaw%360)+360)%360 : d.yaw, pitch: clampN(finite(u.pitch)?u.pitch:d.pitch, pl[0], pl[1]), zoom: clampN(finite(u.zoom)?u.zoom:d.zoom, zl[0], zl[1]),
    sx: clampN(finite(u.sx)?u.sx:1, CAM.sens[0], CAM.sens[1]), sy: clampN(finite(u.sy)?u.sy:1, CAM.sens[0], CAM.sens[1]) };
}
/* 希望の値（W3.cam の yaw・pitch・zoom）を S.camera へ。yaw は何周しても連続した値で持ち、保存と送信のときだけ 0〜360 にする */
function camStore(persist){ const c=W3.cam; if(!c) return; const u=camUser();
  S.camera = Object.assign({}, S.camera, {yaw:+(((c.yaw%360)+360)%360).toFixed(2), pitch:+c.pitch.toFixed(2), zoom:+c.zoom.toFixed(2), sx:u.sx, sy:u.sy}, finite(c.base) ? {base:+c.base.toFixed(3)} : {});
  if(persist){ clearTimeout(W3.camSaveT); W3.camSaveT=setTimeout(save, 250); } }
/* カメラの向きの単位ベクトル：B＝注視点からカメラ本体へ、U＝画面の上、R＝画面の右（モジュールの applyOrientation と同じ式） */
function camAxes(yawDeg, pitchDeg){ const y=yawDeg*Math.PI/180, p=pitchDeg*Math.PI/180;
  return {B:{x:Math.sin(y)*Math.cos(p), y:Math.sin(p), z:Math.cos(y)*Math.cos(p)}, U:{x:-Math.sin(y)*Math.sin(p), y:Math.cos(p), z:-Math.cos(y)*Math.sin(p)}, R:{x:Math.cos(y), y:0, z:-Math.sin(y)}}; }
/* モジュールへ送る（向き・角度・ズーム・距離と、画面の上下のずらし）。setViewportInsets を先に、setCameraOrbit を後に
   （setCameraOrbit がその場で変換を作り直すので、送った値とカメラの位置がいつも一致する） */
function camSend(yaw, pitch, zoom, dist){
  const y=((yaw%360)+360)%360, L=W3.camSent;
  if(L && Math.abs(L.y-y)<0.002 && Math.abs(L.p-pitch)<0.002 && Math.abs(L.z-zoom)<0.0005 && Math.abs((L.d||0)-(dist||0))<0.001) return;
  try{ W3.gfx.setCameraOrbit(Object.assign({yawDegrees:y, pitchDegrees:pitch, viewSize:zoom}, dist ? {distance:dist} : {})); }catch(e){}
  W3.camSent = {y, p:pitch, z:zoom, d:dist||null};
  W3.camView = {yaw:y, pitch, zoom}; W3.camPitchNow = pitch;
}
/* 高さを固定する仕組みが使えるか（本物のモジュール：カメラの位置・視錐台・setViewportInsets・距離がある） */
function camHeightOk(){ try{ const cam=W3.gfx.getCamera(); return !!(cam && cam.position && finite(cam.top) && typeof W3.gfx.setCameraTarget==="function" && typeof W3.gfx.getCameraView==="function" && finite((W3.gfx.getCameraView()||{}).distance)); }catch(e){ return false; } }
/* 基準の高さを今の主人公の足もとにする（読み込み・瞬間移動・地域移動・視点を戻す） */
function camRebase(){ const c=W3.cam; if(!c || !W3.pos) return; c.base = groundY(W3.pos.x, W3.pos.z); c.next = 0; c.freeze = null; c.snap = true; camStore(true); }
function camInit(){
  if(!camSupported()){ camUI(); return; }
  /* モジュールの見下ろし角の下限を確かめる（getCameraView があれば。第24ラウンドは 0°、それより前は 12°） */
  W3.camPitchMin = 0;
  if(typeof W3.gfx.getCameraView==="function"){ try{ W3.gfx.setCameraOrbit({pitchDegrees:0}); const v=W3.gfx.getCameraView(); if(v && finite(v.pitchDegrees)) W3.camPitchMin = Math.max(0, v.pitchDegrees); }catch(e){} }
  const u=camUser();
  W3.cam = {yaw:u.yaw, pitch:u.pitch, zoom:u.zoom, cy:u.yaw, cp:u.pitch, cz:u.zoom, rate:CAM.smooth,
    a:{y:u.yaw, p:u.pitch, z:u.zoom}, d:CAM.dist, dSel:CAM.dist, dHold:0, base:(S.camera && finite(S.camera.base)) ? clampN(S.camera.base, -50, 200) : null, next:0, lim:"", freeze:null, ok:camHeightOk()};
  W3.camSent = null; camSend(u.yaw, u.pitch, u.zoom, W3.cam.ok ? CAM.dist : 0);
  camUI(); camHint(); camDebugInit();
}
/* 回転（度）。何周しても連続。上下は範囲で止める（跳ね返らない） */
function camRotate(dYaw, dPitch){ const c=W3.cam; if(!c) return; const pl=camPitchLim();
  c.yaw += dYaw; c.pitch = clampN(c.pitch + dPitch, pl[0], pl[1]); c.rate = CAM.smooth; camStore(false); }
function camZoomTo(z){ const c=W3.cam; if(!c) return; const zl=camZoomLim(); c.zoom = clampN(z, zl[0], zl[1]); c.rate = CAM.smooth; camStore(false); }
/* 視点を戻す：標準の角度と距離へなめらかに（回る向きは近いほう）。高さの基準も今の主人公の足もとへ。感度はそのまま */
function camReset(){
  const c=W3.cam, d=camDefaults(); if(!c) return;
  c.yaw = c.cy + (((d.yaw - c.cy) % 360 + 540) % 360 - 180); c.pitch = clampN(d.pitch, ...camPitchLim()); c.zoom = d.zoom; c.rate = CAM.resetRate;
  camRebase();
  const u=camUser(); S.camera = {sx:u.sx, sy:u.sy}; save(); banner("🎥 視点を標準の角度と距離に戻した");
}
/* 地形＋建物の高さ（建物の占有範囲の上は、地面＋建物の高さ structures.json の size.h） */
function camBuildings(cx, cz, r){
  return (world() && WORLD.structures ? WORLD.structures() : []).map(o=>{ const sp=(ASSETS.buildingSpecs && ASSETS.buildingSpecs[o.type]) || (ASSETS.propSpecs && ASSETS.propSpecs[o.type]) || (ASSETS.townSpecs && ASSETS.townSpecs[o.type]);
      return {o, h: sp && sp.size && finite(sp.size.h) ? sp.size.h : 0, g: groundY(o.x, o.z)}; })
    .filter(b=>b.h>0.4 && Math.hypot(b.o.x-cx, b.o.z-cz) < r);
}
function camHeightAt(x, z, bl){ let h=groundY(x,z); for(const b of bl){ if(WORLD.sdist(b.o, x, z) < 0.3){ const top=b.g+b.h; if(top>h) h=top; } } return h; }
/* 置けるか：注視点 L（モジュールの注視点ではなく、ゲームが狙う位置）・向き・表示範囲・距離 d で、
   near＝近い面の四角が地形・建物＋余裕より上にあるか（必須）、clear＝主人公からカメラへの線が隠れないか（できれば） */
function camFits(L, ax, evs, aspect, d, player, bl, margin){
  const nm = finite(margin) ? margin : CAM.nearMargin;
  const W=evs*aspect, H=evs, body={x:L.x+ax.B.x*d, y:L.y+ax.B.y*d, z:L.z+ax.B.z*d};
  for(const v of [-H/2, -H/4, 0, H/4]) for(let i=0;i<=6;i++){ const u=(i/6-0.5)*W;
    const px=body.x+ax.R.x*u+ax.U.x*v, py=body.y+ax.U.y*v, pz=body.z+ax.R.z*u+ax.U.z*v;
    if(py < camHeightAt(px, pz, bl) + nm) return {near:false, clear:false}; }
  /* 主人公（足もと＋0.3〜胸）からカメラの向き B へ、近い面まで。正投影なので、主人公を隠すのはこの線の上の物 */
  const tMax = (body.x-player.x)*ax.B.x + (body.y-player.y)*ax.B.y + (body.z-player.z)*ax.B.z;
  for(let t=0.8; t<tMax; t+=(t<6?0.6:t<24?1.5:4)) for(const s of (t<24?[-CAM.segSide, 0, CAM.segSide]:[0])) for(const hh of [0.3, 1.2]){
    const px=player.x+ax.B.x*t+ax.R.x*s, py=player.y+hh+ax.B.y*t, pz=player.z+ax.B.z*t+ax.R.z*s;
    if(py < camHeightAt(px, pz, bl) + 0.15) return {near:true, clear:false}; }
  return {near:true, clear:true};
}
/* 狙う注視点（高さは基準＋低い角度での下げ）と、置ける距離を決める。null＝この向き・角度・ズーム・位置ではどの距離でも置けない */
function camSolve(yaw, pitch, zoom, fx, fz, margin){
  const lk = camLook(yaw, pitch, zoom, fx, fz), cam=W3.gfx.getCamera();
  const aspect = (cam.right-cam.left)/(cam.top-cam.bottom) || 16/9;
  const pl = {x:fx, y:groundY(fx, fz), z:fz}, bl = camBuildings(fx, fz, 300);
  let pick=null, nearOnly=null;
  for(const d of CAM.distSteps){ const r=camFits(lk.L, lk.ax, lk.evs, aspect, d, pl, bl, margin);
    if(r.near && r.clear){ pick=d; break; } if(r.near && nearOnly==null) nearOnly=d; }
  const d = pick!=null ? pick : nearOnly;
  return d==null ? null : {d, clear:pick!=null, L:lk.L, ax:lk.ax, evs:lk.evs, yF:lk.yF};
}
/* 注視点の高さ（正本）：基準の高さ c.base から決める。地形の高さは使わない。
   モジュールは画面の中心を「注視点＋画面の上方向×ずらし（anchorOffset と HUD の余白から。主人公を少し下に置く）」にするので、
   低い角度ほど（w→0）その縦の分を差し引き、画面の中心の高さを 基準＋lowFocus（足もと＋0.3）へ下げる。
   返す値：yF＝setCameraTarget へ渡す高さ、L＝実際の画面の中心（衝突の判定用）、ax＝向きの単位ベクトル、evs＝表示範囲の高さ */
function camLook(yaw, pitch, zoom, fx, fz){
  const c=W3.cam, cam=W3.gfx.getCamera(), ax=camAxes(yaw, pitch), w=sstep(0, CAM.lowBlend, pitch);
  const boost = (cam.top-cam.bottom)/((W3.camSent && W3.camSent.z) || zoom), evs = zoom*(finite(boost)&&boost>0?boost:1);
  const hud = camHud(), sMod = (camAnchor() - (hud.bottom-hud.top)/(2*hud.h))*evs;
  const yF = c.base + (1-w)*(CAM.lowFocus - sMod*ax.U.y);
  return {yF, ax, evs, L:{x:fx + ax.U.x*sMod, y:yF + ax.U.y*sMod, z:fz + ax.U.z*sMod}};
}
function camAnchor(){ const c=(W3.cfg && W3.cfg.camera)||{}; return finite(c.anchorOffset) ? c.anchorOffset : 0.09; }
function camHud(){ const h=($("#view") && $("#view").clientHeight) || innerHeight; const i=W3.camHudIns || hudInsets(); return {top:i.top||0, bottom:i.bottom||0, h:Math.max(1,h)}; }
/* 距離の選び方：縮める（好ましくない距離へ移る）のはすぐ。好ましい距離へ戻すのは 0.4 秒続けて置けたときだけ（出たり消えたりしない） */
function camPickDist(sol){ const c=W3.cam, rank=d=>CAM.distSteps.indexOf(d), cur=rank(c.dSel), nw=rank(sol.d);
  if(nw > cur || c.dSel==null){ c.dSel = sol.d; c.dHold = 0; }
  else if(nw < cur){ c.dHold = (c.dHold||0) + CAM.checkEvery; if(c.dHold >= 0.4){ c.dSel = sol.d; c.dHold = 0; } }
  else c.dHold = 0; }
function camDistLim(sol){ const c=W3.cam; if(!sol) return "置けない"; if(!sol.clear) return "見通しなし（地形・建物が主人公の手前）"; return c.dSel!==CAM.dist ? "距離を"+c.dSel+"に" : ""; }
/* 毎フレーム1回だけ：希望の値をなめらかにし、置ける値を決め、モジュールの注視点の高さの変化を打ち消して渡す */
function camFrame(dt){
  if(spaceCamera())return;
  const c=W3.cam; if(!c || !camSupported() || !(dt>0)) return;
  const k = damp(c.rate, dt);
  c.cy += (c.yaw - c.cy) * k; c.cp += (c.pitch - c.cp) * k; c.cz += (c.zoom - c.cz) * k;
  if(Math.abs(c.yaw-c.cy)<0.01 && Math.abs(c.pitch-c.cp)<0.01 && Math.abs(c.zoom-c.cz)<0.001){ c.cy=c.yaw; c.cp=c.pitch; c.cz=c.zoom; c.rate=CAM.smooth; }
  /* 角度が大きく回る数値の誤差を避けるため、同じだけ戻す（見た目は変わらない） */
  if(Math.abs(c.cy) > 3600){ const s=Math.round(c.cy/360)*360; c.cy-=s; c.yaw-=s; c.a.y-=s; }
  if(!c.ok || !W3.pos){ c.a={y:c.cy, p:c.cp, z:c.cz}; camSend(c.cy, c.cp, c.cz, 0); return; }      // 偽モジュール・古い版：高さの固定なし
  if(c.base==null) camRebase();
  const cam = W3.gfx.getCamera();
  if(camMountain()){ camFrameMountain(c, dt, cam); return; }
  if(c.mtnWas){ c.mtnWas = false; c.dv = null; c.sol = null; c.next = 0; camStore(true); }   // 山を下りた：高さはここで止め、以後は平地の決まり
  /* 2) 置ける値。角度・ズームが変わるのはユーザーの操作中（ドラッグ・ピンチ・ホイール・視点を戻す、とそのなめらかな続き）だけ。
     操作中：向き・ズームは今の見下ろし角のまま置けるなら進め、駄目ならそこで止める。見下ろし角は希望へ向かって、置ける所まで進める（二分探索）。
     操作が終わったとき、置けずに止まった値を新しい希望の値にする（操作後の状態を基準として保つ）。
     操作していない間（歩いているとき）：角度・ズームは変えない。置けなければ距離を変え、それでも駄目なら水平の追従を止める（勝手に上げない） */
  const want = {y:c.cy, p:c.cp, z:c.cz};
  const opOn = (W3.ptrs && W3.ptrs.size>0) || Math.abs(c.yaw-c.cy)>0.01 || Math.abs(c.pitch-c.cp)>0.01 || Math.abs(c.zoom-c.cz)>0.001 || (performance.now()-(W3.camWheelAt||0) < 350);
  const lp=c.lastPos, posMoved = !lp || Math.hypot(W3.pos.x-lp.x, W3.pos.z-lp.z) > 0.25;
  /* 制限で止まったまま操作が終わった：止まった値を新しい希望の値にする（このあと「希望と実際の差」は残らない） */
  if(!opOn && c.opLim){ c.yaw = c.cy = want.y = c.a.y; c.pitch = c.cp = want.p = c.a.p; c.zoom = c.cz = want.z = c.a.z; camStore(true); c.opLim = null; }
  /* 希望と実際に差があれば（操作中、または平滑化の最後のひと押し・プログラムからの変更）、必ず置けるかを確かめて進める */
  const changed = Math.abs(want.y-c.a.y)+Math.abs(want.p-c.a.p)+Math.abs(want.z-c.a.z)*4 > 1e-6;
  c.next -= dt;
  const unfreeze = ()=>{ c.freeze=null; };
  if(changed){
    c.next = CAM.checkEvery; c.lastPos = {x:W3.pos.x, z:W3.pos.z};
    let a = {y:c.a.y, p:c.a.p, z:c.a.z}, lim = "", sol = null;
    const tryA = v => camSolve(v.y, v.p, v.z, W3.pos.x, W3.pos.z, CAM.nearMarginOp);   // 操作で決めるときは余裕を大きく（歩いて小さな起伏に乗っても制限にかからないように）
    /* 向きとズーム（今の見下ろし角のまま） */
    if((sol = tryA({y:want.y, p:a.p, z:want.z}))){ a.y = want.y; a.z = want.z; }
    else if((sol = tryA({y:a.y, p:a.p, z:want.z}))){ a.z = want.z; lim = "回転を止めた"; }
    else if((sol = tryA({y:want.y, p:a.p, z:a.z}))){ a.y = want.y; lim = "ズームを止めた"; }
    else { sol = tryA(a); lim = sol ? "回転・ズームを止めた" : ""; }
    /* 見下ろし角：希望の角度まで置けるならそこへ。置けないなら、今の角度から希望の側へ置ける所まで */
    if(Math.abs(want.p - a.p) > 0.001){ const full = tryA({y:a.y, p:want.p, z:a.z});
      if(full){ a.p = want.p; sol = full; }
      else { let ok = a.p, ng = want.p; for(let i=0;i<6;i++){ const m=(ok+ng)/2, r=tryA({y:a.y, p:m, z:a.z}); if(r){ ok=m; sol=r; } else ng=m; } a.p = ok; lim = lim || "角度を止めた（これより低いと地面を切る）"; } }
    if(sol){ unfreeze(); c.lastOk = {x:W3.pos.x, z:W3.pos.z}; }
    c.a = a; c.opLim = lim; c.sol = sol || c.sol;
    if(sol) camPickDist(sol);
    c.lim = lim || camDistLim(sol);
  } else {
    c.opLim = null;
    if(c.next <= 0 || posMoved || !c.sol){
      c.next = CAM.checkEvery; c.lastPos = {x:W3.pos.x, z:W3.pos.z};
      let sol = camSolve(c.a.y, c.a.p, c.a.z, W3.pos.x, W3.pos.z), lim = "";
      if(sol){ unfreeze(); c.lastOk = {x:W3.pos.x, z:W3.pos.z}; }
      else { const f=c.freeze || c.lastOk || {x:W3.pos.x, z:W3.pos.z}; sol=camSolve(c.a.y, c.a.p, c.a.z, f.x, f.z); lim="水平の追従を止めた";
        if(!c.freeze){ c.freeze={x:f.x, z:f.z}; } }
      if(sol){ c.sol = sol; camPickDist(sol); }
      c.lim = lim || camDistLim(sol);
    }
  }
  c.d = c.dSel || CAM.dist;
  /* 3) モジュールへ渡す（毎フレーム1か所）：注視点＝水平は主人公（凍結中はその位置）、高さは camLook が決めた値（基準の高さから。地形は見ない）。
     向き・角度・ズーム・距離は変わったときだけ setCameraOrbit。モジュールは水平・高さともなめらかに注視点へ寄せる（第26ラウンド §32.1） */
  const a=c.a, fx = c.freeze ? c.freeze.x : W3.pos.x, fz = c.freeze ? c.freeze.z : W3.pos.z, lk = camLook(a.y, a.p, a.z, fx, fz);
  try{ W3.gfx.setCameraTarget({x:fx, z:fz, y:lk.yF}); }catch(e){}
  camSend(a.y, a.p, a.z, c.d);
  /* 読み込み・瞬間移動・地域移動のあとは、カメラを新しい場所へすぐ合わせる（遠くから流れてこない）。モジュールの snapToTarget（非公開）があるときだけ */
  if(c.snap){ c.snap = false; try{ const r=W3.gfx.cameraRig; if(r && typeof r.setTarget==="function" && typeof r.snapToTarget==="function"){ r.setTarget(fx, fz, lk.yF); r.snapToTarget(); } }catch(e){} }
  W3.camDbg = {camY: cam.position.y, focusY: lk.L.y, targetY: lk.yF, base: c.base, pitch: a.p, want: c.cp, dist: c.d, lim: c.lim || "なし", freeze: !!c.freeze,
    groundAtCam: groundY(cam.position.x, cam.position.z), groundAtHero: groundY(W3.pos.x, W3.pos.z)};
}
/* 山のカメラ（CAM.mtn*）：角度・ズームはユーザーの操作のまま（制限しない）。回転の中心の高さは主人公の足もとをなめらかに追い、
   距離は「主人公からカメラへの線が斜面・建物に当たる手前」まで近づける（近づくのはすぐ、離れるのはゆっくり） */
function camFrameMountain(c, dt, cam){
  c.mtnWas = true; c.freeze = null; c.opLim = null; c.sol = null;
  c.a = {y:c.cy, p:c.cp, z:c.cz};
  const g = groundY(W3.pos.x, W3.pos.z);
  c.base = c.snap ? g : c.base + (g - c.base) * damp(CAM.mtnFollow, dt);
  const ax = camAxes(c.a.y, c.a.p), bl = camBuildings(W3.pos.x, W3.pos.z, 120);
  const hit = camHitDist({x:W3.pos.x, y:g, z:W3.pos.z}, ax, CAM.dist + 2, bl);
  const want = clampN(hit - Math.min(CAM.mtnGap, hit*0.5), CAM.mtnMin, CAM.dist);   // 斜面がすぐ近いときは、当たる所の半分の距離まで
  c.dv = (c.dv==null || want < c.dv || c.snap) ? want : c.dv + (want - c.dv) * damp(CAM.mtnOut, dt);
  c.d = c.dSel = Math.round(c.dv*20)/20;
  c.lim = c.d < CAM.dist - 0.01 ? "山：斜面の手前まで近づいた（距離 "+c.d.toFixed(1)+"）" : "山：主人公の高さに合わせる";
  const lk = camLook(c.a.y, c.a.p, c.a.z, W3.pos.x, W3.pos.z);
  /* モジュールの距離は 10 以上（CameraController の DIST_MIN）。それより近づけるときは、距離を 10 のまま、注視点を同じ視線の上で奥へずらす
     （正投影なので画面の絵は変わらず、カメラ本体の位置＝近い面だけが主人公に近づく） */
  const send = Math.max(CAM_MOD_DIST_MIN, c.d), sh = send - c.d;
  const tx = W3.pos.x - ax.B.x*sh, tz = W3.pos.z - ax.B.z*sh, ty = lk.yF - ax.B.y*sh;
  try{ W3.gfx.setCameraTarget({x:tx, z:tz, y:ty}); }catch(e){}
  camSend(c.a.y, c.a.p, c.a.z, send);
  if(c.snap){ c.snap = false; try{ const r=W3.gfx.cameraRig; if(r && typeof r.setTarget==="function" && typeof r.snapToTarget==="function"){ r.setTarget(tx, tz, ty); r.snapToTarget(); } }catch(e){} }
  c.mtnSave = (c.mtnSave||0) + dt; if(c.mtnSave > 2){ c.mtnSave = 0; camStore(false); }
  W3.camDbg = {camY: cam.position.y, focusY: lk.L.y, targetY: lk.yF, base: c.base, pitch: c.a.p, want: c.cp, dist: c.d, lim: c.lim, freeze: false, mountain: true,
    groundAtCam: groundY(cam.position.x, cam.position.z), groundAtHero: g};
}
/* 検証用の表示（検証モードか URL に ?camdebug=1）：カメラ本体の高さ・注視点の高さ・見下ろし角（実際／希望）・距離・制限 */
function camDebugInit(){
  if(!(VERIFY || /[?&]camdebug=1/.test(location.search)) || $("#camdbg")) return;
  const el=document.createElement("div"); el.id="camdbg"; el.className="camdbg"; el.setAttribute("aria-hidden","true"); ($("#hud")||document.body).appendChild(el);
  setInterval(()=>{ const d=W3.camDbg; if(!d || U.tab!=="explore"){ el.hidden=true; return; } el.hidden=false;
    el.textContent=`カメラY ${d.camY.toFixed(2)}／注視点Y ${d.focusY.toFixed(2)}（基準 ${d.base.toFixed(2)}）\n俯角 ${d.pitch.toFixed(1)}°（希望 ${d.want.toFixed(1)}°）距離 ${d.dist.toFixed(0)}\n制限：${d.lim}`; }, 250);
}
function camUI(){ const box=$("#camctl"); if(box) box.hidden = !camSupported(); }
/* 初回だけ、操作の案内を出す */
function camHint(){
  if(!camSupported() || S.flags.camHint) return;
  S.flags.camHint = 1; save();
  setTimeout(()=>banner(uiMode()==="touch" ? "🎥 ドラッグで視点変更／2本指でズーム" : "🎥 ドラッグで視点変更／ホイールでズーム"), 1800);
}
/* 古い呼び出し（右クリックドラッグ等の互換）：希望の値を直接変える */
function camSet(ch){ const c=W3.cam; if(!c) return; if(finite(ch.yaw)) c.yaw = c.cy + (((ch.yaw - c.cy) % 360 + 540) % 360 - 180);
  if(finite(ch.pitch)) c.pitch = clampN(ch.pitch, ...camPitchLim()); if(finite(ch.zoom)) camZoomTo(ch.zoom); camStore(true); }
document.addEventListener("click", ev=>{ const b=ev.target.closest && ev.target.closest("[data-act='cam']"); if(!b) return; ev.preventDefault();
  if(b.dataset.id==="reset") camReset(); else if(b.dataset.id==="recenter") camRecenter(); });
/* 主人公に合わせる（明示の再センタリング）：角度・ズームはそのまま、基準の高さだけを今の足もとへ。高さの固定で、大きく登り下りして
   主人公が画面の中央から大きく外れたときにだけボタンを出す（自動では合わせない） */
function camRecenter(){ if(!W3.cam) return; camRebase(); banner("🎯 カメラの高さを今の主人公の足もとに合わせた"); }
function camRecenterUI(){
  const b=$("#camRecenter"); if(!b) return; let off=false;
  try{ if(W3.cam && W3.cam.ok && W3.pos && !W3.camMtn){ /* 火山の上ではカメラが主人公の高さを追うので出さない */ const r=$("#w3").getBoundingClientRect(), sp=toScreen(W3.pos.x, groundY(W3.pos.x,W3.pos.z)+0.8, W3.pos.z); off = !sp.ok || Math.abs(sp.y - r.height/2) > r.height*0.3 || Math.abs(sp.x - r.width/2) > r.width*0.38; } }catch(e){}
  if(b.hidden === off) b.hidden = !off;
}
/* 設定画面の感度 */
document.addEventListener("input", ev=>{ const t=ev.target; if(!t || !t.dataset || !t.dataset.camsens) return;
  const v=clampN(+t.value, CAM.sens[0], CAM.sens[1]); S.camera=Object.assign({}, S.camera, {[t.dataset.camsens]:v});
  const o=document.getElementById("camSensOut-"+t.dataset.camsens); if(o) o.textContent=v.toFixed(1); });
document.addEventListener("change", ev=>{ const t=ev.target; if(t && t.dataset && t.dataset.camsens) save(); });

/* ===================== 小さな集落と人（NPC。2026-11-07、Muse 第17ラウンドの素材） =====================
   データは data.js の village。小屋は建物と同じ GLB（hut）、小物は Muse の集落小物（prop-<名前>）。当たり判定は建物と同じ WORLD.setStructures。
   人は主人公と同じ当たり判定の円（WORLD.setNpcs）。近くの人だけ毎フレーム動かし、遠い人は間引く（0.5秒ごと）。
   会話中は移動入力を止め（案内の枠＝openModal）、人はその場で主人公のほうを向く。売り買いの仕組みはまだないので、取引のボタンは出さない。 */
const VIL = D.village;
const vAbs = p=>({x:VIL.c.x+p.x, z:VIL.c.z+p.z});
function villageStructs(){ if(!VIL) return [];
  return VIL.huts.map(h=>Object.assign({}, h, vAbs(h))).concat(VIL.props.map(p=>Object.assign({}, p, vAbs(p), {type:"prop-"+p.type}))); }
function syncVillage(){
  if(!W3.gfx || !VIL) return;
  villageStructs().forEach(v=>{ if(!W3.structs.has(v.id)) structAdd(v.id, v.type, {x:v.x, z:v.z}, v.rot); });
}
/* 世界の向き（描画モジュールの軸：down＝+Z・right＝+X）を、歩く向きから決める */
function axisDir(dx, dz){ return Math.abs(dx) > Math.abs(dz) ? (dx>0?"right":"left") : (dz>0?"down":"up"); }
function npcInit(){
  if(W3.npcs || !VIL) return;
  W3.npcs = VIL.npcs.map((n,i)=>{ const h=vAbs(n.home); return {def:n, id:n.id, x:h.x, z:h.z, dir:"down", moving:false, wp:0, wait:1+i, acc:0, talking:false}; });
}
const NPC_SPEED = 1.1, NPC_NEAR = 1.9, NPC_FAR = 30;
function npcUpdate(dt){
  if(!W3.npcs || !W3.pos || !WORLD) return;
  const now=Date.now();
  W3.npcs.forEach(n=>{
    const dp=Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z);
    n.acc += dt; const step = dp > NPC_FAR ? 0.5 : 0;                 // 遠い人は 0.5 秒ごとにまとめて動かす
    if(n.acc < step) return; const d=n.acc; n.acc=0;
    if(n.talking){ n.moving=false; n.dir=axisDir(W3.pos.x-n.x, W3.pos.z-n.z); return; }
    if(n.wait>0){ n.wait-=d; n.moving=false; return; }
    const tgt=vAbs(n.def.wander[n.wp]), dx=tgt.x-n.x, dz=tgt.z-n.z, L=Math.hypot(dx,dz);
    if(L<0.15){ n.wp=(n.wp+1)%n.def.wander.length; n.wait=2+((n.wp*7+n.id.length)%4); n.moving=false; return; }
    /* 主人公の前では立ち止まって道をゆずる */
    if(dp < 1.0){ n.moving=false; return; }
    const s=Math.min(L, NPC_SPEED*d), mx=dx/L*s, mz=dz/L*s;
    const r=WORLD.move(S, {x:n.x, z:n.z}, mx, mz, now, "npc:"+n.id);
    const got=Math.hypot(r.x-n.x, r.z-n.z);
    if(got < s*0.2){ n.blocked=(n.blocked||0)+d; if(n.blocked>1.5){ n.blocked=0; n.wp=(n.wp+1)%n.def.wander.length; } n.moving=false; return; }
    n.blocked=0; n.x=r.x; n.z=r.z; n.moving=true; n.dir=axisDir(mx, mz);
  });
  WORLD.setNpcs(W3.npcs.map(n=>({id:n.id, x:n.x, z:n.z})));
  W3.npcList = W3.npcs.map(n=>({x:n.x, z:n.z, r:0.35}));
  /* 近くの人（話せる相手） */
  let best=null, bd=NPC_NEAR; W3.npcs.forEach(n=>{ const dd=Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z); if(dd<bd){ bd=dd; best=n; } });
  if(best!==W3.npcNear){ W3.npcNear=best; updateAction3D(); }
  if(W3.talkTo){ const n=W3.npcs.find(x=>x.id===W3.talkTo); if(n && Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z) < NPC_NEAR){ W3.talkTo=null; openTalk(n); } }
  /* 描画：Muse の setNpcVisualState（ラウンド18。主人公と同じ描き方・遮蔽フェードつき）。ない版ではゲーム側の入口 HD2D.npcSet */
  if(W3.gfx && typeof W3.gfx.setNpcVisualState==="function"){
    W3.npcs.forEach(n=>{ const far = Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z) > NAT_HIDE_R;
      if(far){ if(n.shown){ W3.gfx.setNpcVisualState(n.id, null); n.shown=false; } return; }
      // 絵（spriteUrl）は出したときに一度だけ渡す（毎フレーム渡すと、モジュールが絵を毎回貼り直して重くなる）
      const st = {position:{x:n.x, z:n.z}, direction:n.dir, moving:n.moving}; if(!n.shown) st.spriteUrl = (ASSETS.npc||{})[n.def.sheet];
      n.shown=true; W3.gfx.setNpcVisualState(n.id, st); });
    return;
  }
  const H=window.HD2D;
  if(H && H.npcSet && W3.gfx) W3.npcs.forEach(n=>{ const far = Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z) > NAT_HIDE_R;
    if(far){ if(n.shown){ H.npcRemove(W3.gfx, n.id); n.shown=false; } return; }
    n.shown=true; H.npcSet(W3.gfx, n.id, (ASSETS.npc||{})[n.def.sheet], ASSETS.shadow, {position:{x:n.x, z:n.z}, direction:n.dir, moving:n.moving}); });
  if(H && H.npcTick && W3.gfx) H.npcTick(W3.gfx, dt);
}
/* 名札：近くの人（8マス以内）にだけ名前を出す。押すと近づいて話す */
function npcLabels(){
  if(!W3.npcs) return; const want=new Set();
  W3.npcs.forEach(n=>{ if(Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z) > 8) return; const key="npc:"+n.id; want.add(key);
    labelFor(key, "w3npc", {npc:n.id}, n.x, groundY(n.x,n.z)+2.05, n.z, `<span>💬</span>${n.def.name}<small style="font-weight:700;margin-left:4px">${n.def.role}</small>`,
      W3.npcNear===n ? " near" : "", n.def.name+"（"+n.def.role+"）と話す"); });
  Object.keys(W3.labelEls).forEach(k=>{ if(k.startsWith("npc:") && !want.has(k)){ W3.labelEls[k].remove(); delete W3.labelEls[k]; } });
}
function talkTo(id){
  const n=W3.npcs && W3.npcs.find(x=>x.id===id); if(!n) return;
  if(Math.hypot(n.x-W3.pos.x, n.z-W3.pos.z) < NPC_NEAR){ openTalk(n); return; }
  const a=Math.atan2(W3.pos.z-n.z, W3.pos.x-n.x); W3.talkTo=id; goTo3D(n.x+Math.cos(a)*1.2, n.z+Math.sin(a)*1.2, null); W3.talkTo=id;
}
function openTalk(n){
  haltField(); n.talking=true; W3.talking=n; W3.talkLine=0; renderTalk();
}
function renderTalk(){
  const n=W3.talking; if(!n) return;
  const lines = n.def.talk.slice(); if(n.def.hint){ const m=D.missions[E.missionIndex(S)]; if(m) lines.push("今の目標は「"+m.t+"」だね。"+(m.how?m.how:"")); }
  const i=Math.min(W3.talkLine, lines.length-1), last = i>=lines.length-1;
  $("#sheet").innerHTML = `<button class="close" data-act="close">とじる</button>
    <div class="talk"><div class="tname">💬 ${n.def.name}<small>（${n.def.role}）</small></div><p class="tline" aria-live="polite">${lines[i]}</p>
    <div class="row mt">${last ? `<button class="btn" data-act="close">とじる</button>` : `<button class="btn" data-act="t-next">つぎへ</button><button class="btn sub" data-act="close">とじる</button>`}<span class="desc" style="margin-left:auto">${i+1}/${lines.length}</span></div></div>`;
  openModal($("#sheet").querySelector(last?".row .btn":"[data-act='t-next']"));
}
function endTalk(){ if(W3.talking){ W3.talking.talking=false; W3.talking=null; } }
document.addEventListener("click", ev=>{ const b=ev.target.closest && ev.target.closest("[data-act='t-next'],[data-act='w3npc']"); if(!b) return; ev.preventDefault();
  if(b.dataset.act==="t-next"){ W3.talkLine++; renderTalk(); }
  else if(fieldInputActive()) talkTo(b.dataset.npc); });

/* ===================== 建築モード（家・設備の自由設置。2026-11-07） =====================
   建築一覧 → 建物を選ぶ → 置き場所の候補（地面の枠：置ければ緑・置けなければ赤と理由）→ 移動・回転 → 「ここに置く」。
   置くのは工作で作った家・設備（作った時点で素材は使っている）。置く・動かす・撤去で素材は増えも減りもしない。
   判定と確定は nature.js（checkPlacement・commitPlacement。二重の確定は S.seq のトークンで防ぐ）。 */
const ROT_STEP = 15, GRID = 0.5;
const PLACE_RESERVED = ()=>[{x:D.base.x, z:D.base.z, r:1.3, why:"拠点の真ん中（はじめの場所）はあけておく"}]
  .concat(D.village ? [{x:D.village.c.x, z:D.village.c.z, r:D.village.r, why:"集落の中（人の家や通り道）には置けない"}] : []).concat(W3.reserved||[]);
function planSpec(p){ const sp=(ASSETS.buildingSpecs||{})[p.type]||{}; return {id:p.id, type:p.type, footprint:sp.footprint||{shape:"circle", r:1}, entrance:sp.entrance, operate:sp.operate, rule:p.rule||null}; }
/* 建物ごとの「作った設備」（表示用。条件の正本は STRUCT_PLAN の when） */
const STRUCT_FAC = {"st-bench":["bench"],"st-fire":["campfire"],"st-kiln":["kiln"],"st-hut1":["storehouse"],"st-smelter":["furnace","blastfurnace"],"st-lab":["still"],
  "st-steam":["steamengine"],"st-tower":["refinery"],"st-factory":["eaf"],"st-power":["steamengine","generator"],"st-inst":["reactor"],"st-wheel":["waterwheel"],"st-rig":["rig"]};
function placeLabel(p){ const sp=(ASSETS.buildingSpecs||{})[p.type]||{};
  return {name: sp.name || p.type, from: (STRUCT_FAC[p.id]||[]).filter(id=>IT[id]).map(nm).join("・")}; }
function viewBuild(){
  if(E.buildRule(S) && !S.verify) return consView();   // 検証モードは従来の自由配置（S.verify.placed）のまま
  const list = STRUCT_PLAN.filter(planOwned);
  const rows = list.map(p=>{ const L=placeLabel(p), b=buildRec(p.id), st = b && b.removed ? "撤去中（設備は持ち物に残っている）" : b ? "好きな場所に置いた" : "決まった場所に建っている";
    return `<div class="bit"><span class="i">${ic((STRUCT_FAC[p.id]||[])[0]||"")}</span><span class="n">${L.name}<small>${st}${L.from?"（"+L.from+"）":""}</small></span>
      ${b && b.removed ? `<button class="btn small" data-act="b-start" data-id="${p.id}">置く</button>`
        : `<button class="btn small" data-act="b-start" data-id="${p.id}">移動・回転</button><button class="btn small sub" data-act="b-remove" data-id="${p.id}">撤去</button>`}</div>`; }).join("");
  return `<p class="desc" style="margin-top:0">作った家や設備を、好きな場所に置けます。置き場所を決める間は、地面の枠が<b style="color:#2d6a3e">緑</b>なら置ける・<b style="color:#a3262f">赤</b>なら置けない（理由も出ます）。</p>
  <ul class="helplist"><li>置く・動かす・撤去で素材は使わず、戻りもしません（素材は工作で作ったときに使っています）。撤去しても設備は持ち物に残り、いつでも置き直せます。</li>
    <li>設備の働き（研究室・工作・自動採取）は、置き場所に関係なく使えます。家や建物の中に入ることはまだできません。</li>
    <li>水車は川の水ぎわにだけ置けます。川・急な斜面・木や岩・ほかの建物の上と、入口や設備の前がふさがる所には置けません。</li></ul>
  <div class="blist">${rows || `<p class="desc">まだ置ける家や設備がありません。「工作」で作業台・たき火・かまど・倉庫などを作ると、ここに出ます。</p>`}</div>`;
}
function placeSnap(v){ return W3.place && W3.place.grid ? Math.round(v/GRID)*GRID : v; }
function startPlace(id){
  const p = STRUCT_PLAN.find(x=>x.id===id); if(!p || !W3.pos || W3.state!=="ready" || !planOwned(p)) return;
  if(W3.place) endPlace();
  const B=camBasis(), b=buildRec(id), cur = !(b && b.removed) && W3.structs.has(id) ? planPos(p) : null;
  W3.place = {id, type:p.type, spec:planSpec(p), grid: W3.lastGrid!==false, x:0, z:0, rot:0, token:S.seq, ghostSig:""};
  if(cur){ W3.place.x=cur.x; W3.place.z=cur.z; W3.place.rot=cur.rot; }
  else { W3.place.x = placeSnap(W3.pos.x + B.f.x*4.5); W3.place.z = placeSnap(W3.pos.z + B.f.z*4.5); W3.place.rot = Math.round(Math.atan2(-B.f.x, -B.f.z)/(Math.PI/12))*(Math.PI/12); }  // 入口が主人公のほうを向く
  $("#app").classList.add("placing"); setTab("explore");
  syncStructures(); placeUpdate(true);
  const bb=$("#buildbar"); bb.hidden=false; const g=$("#bbGrid"); if(g) g.checked=W3.place.grid;
  banner("🏗️ 置き場所を決める：地面をタップ（クリック）して動かし、回転して「ここに置く」");
}
function placeArgs(){ const P=W3.place; if(P.cons) return [Object.assign({}, P.spec, {x:P.x, z:P.z, rot:P.rot}), consOpts()]; return [Object.assign({}, P.spec, {x:P.x, z:P.z, rot:P.rot}), {player:W3.pos, npcs:(W3.npcList||[]), reserved:PLACE_RESERVED()}]; }
function placeUpdate(force){
  const P=W3.place; if(!P) return;
  if(P.cons){ P.check = consCheck(P); $("#bbTitle").textContent = consTitle(P); }
  else { const [pp, op] = placeArgs(); P.check = WORLD.checkPlacement(S, pp, op);
    const L=placeLabel(STRUCT_PLAN.find(x=>x.id===P.id));
    $("#bbTitle").textContent = "🏗️ "+L.name+"を置く（向き "+Math.round(((P.rot*180/Math.PI)%360+360)%360)+"°）"; }
  const m=$("#bbMsg"); m.className="bbmsg "+(P.check.ok?"ok":"ng"); m.textContent = P.check.ok ? (P.road ? (P.road.a ? "✅ ここまで敷ける" : "✅ ここを始点にできる") : "✅ ここに置ける") : "❌ "+P.check.reasons.join("／");
  const ok=$("#buildbar .bbok"); if(ok){ ok.disabled = !P.check.ok; ok.textContent = P.road ? (P.road.a ? "ここまで敷く" : "始点にする") : P.cons ? (P.cons.move ? "ここへ移す" : P.cons.legacy ? "ここに置く" : "予定地にする") : "ここに置く"; }
  if(P.road) return;   /* 道は 3D の候補を出さない（地面の枠だけ） */
  /* 3Dの見た目（候補）。動かすたびに作り直すので、少し間引く */
  const sig=P.x.toFixed(2)+","+P.z.toFixed(2)+","+P.rot.toFixed(3), now=performance.now();
  if(force || (sig!==P.ghostSig && (!P.ghostAt || now-P.ghostAt>90))){ P.ghostAt=now; P.ghostSig=sig;
    /* Muse の setStructurePreview（半透明・緑／赤・影なし）があれば使う。ない版は当たり判定なしの建物を置く */
    if(typeof W3.gfx.setStructurePreview==="function") W3.gfx.setStructurePreview({type:P.type, position:{x:P.x, z:P.z}, rotationY:P.rot, valid:!!P.check.ok});
    else { if(W3.structs.has("ghost:place")) structRemove("ghost:place"); structAdd("ghost:place", P.type, {x:P.x, z:P.z}, P.rot); } }
  else if(typeof W3.gfx.setStructurePreview==="function" && P.lastOk !== P.check.ok) W3.gfx.setStructurePreview({type:P.type, position:{x:P.x, z:P.z}, rotationY:P.rot, valid:!!P.check.ok});
  P.lastOk = P.check.ok;
}
/* 地面の枠（画面に重ねる SVG。毎フレーム、カメラに合わせて描き直す） */
function drawPlaceOverlay(){
  let sv=$("#buildov"); const P=W3.place;
  if(!P){ if(sv) sv.innerHTML=""; return; }
  if(!sv){ const w=$("#w3"); if(!w) return; w.insertAdjacentHTML("beforeend", '<svg id="buildov" aria-hidden="true"></svg>'); sv=$("#buildov"); }
  if(P.ghostSig !== P.x.toFixed(2)+","+P.z.toFixed(2)+","+P.rot.toFixed(3)){ P.ghostSig = P.x.toFixed(2)+","+P.z.toFixed(2)+","+P.rot.toFixed(3); placeUpdate(); }
  if(P.road){ consRoadOverlay(sv, P); return; }
  const t=P.check && P.check.shape; if(!t) return;
  const pts=[]; if(t.shape==="rect"){ for(const [i,j] of [[-1,-1],[1,-1],[1,1],[-1,1]]) pts.push(WORLD.toWorld(t, i*t.w/2, j*t.d/2)); }
  else for(let k=0;k<24;k++){ const a=k/24*Math.PI*2; pts.push({x:t.x+Math.cos(a)*t.r, z:t.z+Math.sin(a)*t.r}); }
  const sp=pts.map(q=>toScreen(q.x, groundY(q.x,q.z)+0.05, q.z));
  const col = P.check.ok ? "#3fbf62" : "#e0434f";
  const marks = ["entrance","operate"].map(k=>{ const lp=P.spec[k]; if(!lp) return ""; const w=WORLD.toWorld(t, lp[0], lp[1]), s2=toScreen(w.x, groundY(w.x,w.z)+0.05, w.z);
    return `<circle cx="${s2.x.toFixed(1)}" cy="${s2.y.toFixed(1)}" r="6" fill="#fff" stroke="${col}" stroke-width="3"/>`; }).join("");
  sv.innerHTML = `<polygon points="${sp.map(q=>q.x.toFixed(1)+","+q.y.toFixed(1)).join(" ")}" fill="${col}" fill-opacity=".28" stroke="${col}" stroke-width="3" ${P.check.ok?"":'stroke-dasharray="8 5"'}/>${marks}`;
}
function placeMoveTo(x, z){ const P=W3.place; if(!P) return; P.x=P.road?placeSnapCell(x):placeSnap(x); P.z=P.road?placeSnapCell(z):placeSnap(z); placeUpdate(); }
function placeRotate(deg){ const P=W3.place; if(!P) return; P.rot += deg*Math.PI/180; if(P.grid) P.rot = Math.round(P.rot/(ROT_STEP*Math.PI/180))*(ROT_STEP*Math.PI/180); placeUpdate(true); }
function endPlace(){ const bb0=$("#buildbar"); if(bb0) bb0.classList.remove("road"); if(W3.structs.has("ghost:place")) structRemove("ghost:place"); if(W3.gfx && typeof W3.gfx.setStructurePreview==="function") W3.gfx.setStructurePreview(null); W3.place=null; $("#app").classList.remove("placing"); const bb=$("#buildbar"); if(bb) bb.hidden=true; drawPlaceOverlay(); syncStructures(); }
function placeConfirm(){
  const P=W3.place; if(!P || P.busy) return;
  if(P.cons){ consPlaceConfirm(P); return; }
  P.busy=true;
  const [pp, op] = placeArgs(); const r = WORLD.commitPlacement(S, pp, P.token, op);
  if(!r.ok){ P.busy=false; if(r.kind==="dup"){ endPlace(); return; } placeUpdate(true); banner("❌ 置けない："+(r.reasons||[]).join("／")); return; }
  const name=placeLabel(STRUCT_PLAN.find(x=>x.id===P.id)).name; save(); endPlace(); banner("🏗️ "+name+"を置いた");
}
function placeCancel(){ if(!W3.place) return; endPlace(); banner("置くのをやめた（何も変わっていない）"); }
function removeBuild(id){
  const p=STRUCT_PLAN.find(x=>x.id===id); if(!p) return; const name=placeLabel(p).name;
  if(!confirm(name+"を撤去する？\n素材は戻りません。設備は持ち物に残るので、「建築」からいつでも置き直せます。")) return;
  const r=WORLD.removePlacement(S, id, S.seq); if(!r.ok) return; save(); syncStructures(); renderPanel(); banner("🏗️ "+name+"を撤去した（持ち物には残っている）");
}
document.addEventListener("click", ev=>{ const b=ev.target.closest && ev.target.closest("[data-act^='b-']"); if(!b || b.tagName==="INPUT") return;
  const a=b.dataset.act, id=b.dataset.id;
  if(a==="b-start"){ ev.preventDefault(); startPlace(id); }
  else if(a==="b-remove"){ ev.preventDefault(); removeBuild(id); }
  else if(a==="b-rot"){ ev.preventDefault(); placeRotate(+id); }
  else if(a==="b-ok"){ ev.preventDefault(); placeConfirm(); }
  else if(a==="b-cancel"){ ev.preventDefault(); placeCancel(); } });
document.addEventListener("change", ev=>{ if(ev.target && ev.target.id==="bbGrid" && W3.place){ W3.place.grid = W3.lastGrid = !!ev.target.checked; placeMoveTo(W3.place.x, W3.place.z); } });

/* ===================== 検証モード（全解放） =====================
   通常のセーブとは別の状態（S.verify を持つ）で、登録されているものを全部試せるようにする。
   一覧と件数は、いまのコードの登録内容（data.js・描画モジュールの登録・埋め込んだアセット）から毎回作る。 */
function switchState(next){
  haltField(); clearTimeout(saveTimer); clearPreview();
  S = next; lastMission=E.missionIndex(S); lastStage=stage(); U.tray={}; U.fac=null; U.op=null; U.last=null; U.target=null; fieldSig=""; sceneSig="";
  if(W3.gfx){ (W3.natShown||new Set()).forEach(id=>W3.gfx.updateResourceVisual(id,null)); W3.natShown=new Set(); W3.visSig={};
    [...W3.structs].forEach(id=>structRemove(id)); W3.structs.clear(); W3.colSig=null; syncStructColliders(); W3.sel=null; W3.near=null; }
  applySavedPos(); writeNow(); renderChrome(); render();
}
function setVerifyMode(on, fresh){        // fresh："new"（全解放で作り直す）・"copy"（通常セーブを写す）・"keep"（前の検証データの続き）
  clearTimeout(saveTimer); writeNow();       // いまのモードの状態を、いまのキーに保存してから切り替える
  let next;
  if(on){ const old = readKey(VERIFY_KEY);
    next = fresh==="copy" ? E.makeVerifyState(readKey(SAVE_KEY)) : (fresh==="new" || !old || !old.verify) ? E.makeVerifyState() : old; }
  else { next = readKey(SAVE_KEY) || E.newState(); delete next.verify; }
  VERIFY = on; try{ localStorage.setItem(MODE_KEY, on?"verify":"normal"); }catch(e){}
  try{ const u=new URL(location.href); if(u.searchParams.has("verify")){ u.searchParams.delete("verify"); history.replaceState(null,"",u.toString()); } }catch(e){}
  switchState(next);
  setTab(on ? "verify" : "explore");
  banner(on ? "🧪 検証モード（全解放）。通常のセーブはそのまま" : "🏠 通常のセーブに戻った");
  if(!on && !S.flags.intro) intro();
}
function verifyCatalog(){
  const items=Object.keys(IT), tag=t=>items.filter(k=>IT[k].tags.includes(t)), H=window.HD2D||{};
  const fac = W3.gfx && W3.gfx.structures && W3.gfx.structures.factories;   // 描画モジュールに登録済みの建物（読むだけ）
  return {items, store:items.filter(k=>IT[k].store!==false), nostore:items.filter(k=>IT[k].store===false), tools:tag("道具"), facs:tag("研究設備"),
    resTypes:Object.keys(H.RESOURCE_VISUAL_SPECS||{}), structTypes:(ASSETS.gfxCatalog||{}).structures||[], factories: fac&&fac.keys ? [...fac.keys()] : null,
    effects:(ASSETS.gfxCatalog||{}).effects||[], icons:Object.keys(ASSETS.icons||{}), icons32:Object.keys(ASSETS.icons32||{}), labApp:Object.keys(ASSETS.labApp||{}),
    atlas:[...new Set([...Object.keys((ASSETS.items||{}).pos||{}),...Object.keys((ASSETS.spaceIcons||{}).pos||{})])], gpt:Object.keys(H.GPT_TEXTURES||{}), branch:Object.keys(H.BRANCH_TEXTURES||{}),
    hero:["boy","girl"].filter(k=>ASSETS[k]), misc:["grass","rock","particle","shadow"].filter(k=>ASSETS[k])};
}
/* 描画の読み込み状態（読むだけ）：枝葉カードのテクスチャが読めないと、描画モジュールは旧来の球体の樹冠に戻るので、ここで分かるようにする */
function gfxStatus(){
  const H=window.HD2D||{}, want=Object.keys(H.BRANCH_TEXTURES||{}).length;
  const res = W3.gfx && W3.gfx.resources, br = res && res.branch ? Object.keys(res.branch).length : null;
  return {want, branch:br, ok: br===null ? null : br>=want && want>0};
}
function verifyGaps(c){
  const out=[];
  D.regions.filter(r=>r.future).forEach(r=>out.push(`地域「${r.name}」は準備中（開けない）`));
  D.eras.filter(e=>!e.techs.length).forEach(e=>out.push(`技術の「${e.name}」は準備中`));
  const last=D.stages[D.stages.length-1]; out.push(`時代は「${last.era}・${last.name}」まで（${last.need}）`);
  const planned=new Set(STRUCT_PLAN.map(p=>p.type));
  const unplanned=c.structTypes.filter(t=>!planned.has(t)); if(unplanned.length) out.push(`建物タイプ ${unplanned.join("・")} は、対応する工作・建設の決まりがまだない（検証の「足もとに置く」で見た目だけ確認できる）`);
  const used=new Set(Object.values(NATURE.DEPOSIT_SHAPE).map(x=>x.vis).concat(Object.values(NAT_VIS).map(f=>f({scale:1})[0])).concat(["tree","rock"]));
  const unused=c.resTypes.filter(t=>!used.has(t)); if(unused.length) out.push(`描画の資源タイプ ${unused.join("・")} はゲームでは未使用（プレビューだけ）`);
  const noIcon=c.items.filter(k=>!c.atlas.includes(k)); if(noIcon.length) out.push(`物質アイコンのない ${noIcon.length} 件（道具・設備）は絵文字で表示`);
  if(c.nostore.length) out.push(`保管できない物（${c.nostore.map(nm).join("・")}）は在庫に入らない。素材の一覧の「トレイ」から実験で使える`);
  out.push("橋は通行の決まりがまだないので、置いても川は今までどおり歩いて渡る");
  return out;
}
let vQuery="";
function vResults(){
  const q=vQuery.trim().toLowerCase(), list=Object.keys(IT).filter(k=>!q || k.includes(q) || IT[k].name.includes(vQuery.trim()) || (IT[k].yomi||"").includes(vQuery.trim())).slice(0,60);
  return list.map(k=>`<div class="vit"><span class="i">${ic(k)}</span><span class="n">${IT[k].name}<small style="color:var(--muted)"> ${k}・${IT[k].store===false?"保管できない":"在庫 "+E.cnt(S,k)}</small></span>
    ${IT[k].store===false?"":`<button class="btn small" data-act="v-add" data-id="${k}">追加</button>`}<button class="btn small sub" data-act="v-tray" data-id="${k}">トレイ</button><button class="btn small sub" data-act="item" data-id="${k}">図鑑</button></div>`).join("") || `<p class="desc">見つからない</p>`;
}
function viewVerify(){
  if(!VERIFY) return `<div class="vsec"><h4>🧪 検証モード</h4><p class="desc">いまは通常のセーブです。</p><div class="vgrid"><button class="btn small" data-act="v-enter" data-id="keep">検証モードを始める</button></div></div>`;
  const v=S.verify, c=verifyCatalog(), gs=gfxStatus(), placed=placedSet(), pos=W3.pos;
  const tog=(k,t,d)=>`<label class="vtog"><input type="checkbox" data-act="v-flag" data-id="${k}" ${v[k]?"checked":""}>${t}<small style="font-weight:500;color:var(--muted)">${d}</small></label>`;
  const rows=[["地域・探索先",D.regions.length],["時代（文明の段階）",D.stages.length],["技術の段階",D.eras.length],["研究（反応）",D.procs.length],["工作・設備・建築のレシピ",D.crafts.length],
    ["物質・道具・設備（図鑑の項目）",c.items.length],["　うち道具",c.tools.length],["　うち研究設備",c.facs.length],["　うち保管できる／できない",c.store.length+"／"+c.nostore.length],["操作（加熱・ろ過など）",Object.keys(OPS).length],["目標",D.missions.length],
    ["描画の資源タイプ",c.resTypes.length],["描画の建物タイプ",c.structTypes.length+(c.factories?`（登録 ${c.factories.length}）`:"")],["演出",c.effects.length],
    ["UIアイコン（48px／32px）",c.icons.length+"／"+c.icons32.length],["物質アイコン",c.atlas.length],["実験器具の絵",c.labApp.length],["自然のテクスチャ・枝葉カード",c.gpt.length+"／"+c.branch.length],["主人公",c.hero.length],
    ["フィールドの自然物",WORLD?WORLD.objects.length:"（3D未初期化）"]];
  return `<div class="vsec"><h4>🧪 検証モード：全解放</h4>
    <p class="desc" style="margin-top:0">通常のセーブとは別のデータです（${v.from==="copy"?"通常セーブの写しから作成":"新しく作成"}）。ここで増やした素材や進行は、通常のセーブには入りません。</p>
    <div class="vgrid"><button class="btn small" data-act="v-exit">通常のセーブに戻る</button><button class="btn small sub" data-act="v-reset" data-id="new">全解放で作り直す</button><button class="btn small sub" data-act="v-reset" data-id="copy">通常セーブを写して作り直す</button></div></div>
  <div class="vsec"><h4>条件のバイパス（OFFにすると通常の判定で確かめられる）</h4>
    ${tog("free","材料を減らさない"," 足りなくても実験・工作できる")}${tog("tools","道具・設備の条件を満たす"," 採取・実験・工作")}${tog("instant","待ち時間を短く"," 採取の作業・実験の観察")}</div>
  <div class="vsec"><h4>素材</h4>
    <div class="vrow"><input type="search" id="vq" placeholder="名前・よみ・IDで探す" value="${vQuery.replace(/"/g,"&quot;")}" aria-label="素材を探す"><input type="number" id="vn" value="10" min="1" max="999" aria-label="追加する数"></div>
    <div class="vlist mt" id="vres">${vResults()}</div>
    <div class="vgrid mt"><button class="btn small" data-act="v-fill">保管できる全素材を99個に補充（${c.store.length}種）</button></div></div>
  <div class="vsec"><h4>移動</h4><div class="vgrid">${D.regions.map(r=>`<button class="btn small sub" data-act="v-warp" data-id="${r.id}">${r.icon} ${r.name}</button>`).join("")}<button class="btn small sub" data-act="v-warp" data-id="base">🏠 拠点</button></div></div>
  <div class="vsec"><h4>時代の切り替え（いま：${D.stages[stage()].era}・${D.stages[stage()].name}）</h4><div class="vgrid">
    <button class="btn small ${v.stage==null?"":"sub"}" data-act="v-stage" data-id="auto">自動（持っている設備から）</button>${D.stages.map(st=>`<button class="btn small ${v.stage===st.n?"":"sub"}" data-act="v-stage" data-id="${st.n}">${st.n}：${st.name}</button>`).join("")}</div></div>
  <div class="vsec"><h4>建物・設備の配置（原野には自動で置かない）</h4>
    <div class="vgrid">${STRUCT_PLAN.map(p=>`<button class="btn small ${placed.has(p.id)?"":"sub"}" data-act="v-place" data-id="${p.id}" aria-pressed="${placed.has(p.id)}">${placed.has(p.id)?"✅":"＋"} ${p.type}</button>`).join("")}</div>
    <p class="desc">足もとに置く（ゲームの決まりにない種類も見た目を確認できる）：</p>
    <div class="vgrid">${c.structTypes.map(t=>`<button class="btn small sub" data-act="v-extra" data-id="${t}">${t}</button>`).join("")}</div>
    <h4 class="mt">街の建物・小物（Muse／GPT の DQ3 セット。検証モードだけ。通常のゲームでは置く条件が未決）</h4>
    <div class="vgrid">${Object.keys(ASSETS.townSpecs||{}).map(t=>`<button class="btn small sub" data-act="v-extra" data-id="${t}">${ASSETS.townSpecs[t].name}</button>`).join("")}</div>
    <p class="desc">自然物の 3D モデル：${(()=>{ const m=window.HD2D&&HD2D.natureModelStatus?HD2D.natureModelStatus():null; return m ? `読み込み ${m.templates} 種（LOD ${m.lod1}）・差し替え ${m.swapped} 回・共有テクスチャ ${m.textures} 枚${Object.keys(m.failed).length?`・<span class="vwarn">失敗 ${Object.keys(m.failed).join("、")}</span>`:""}` : "なし"; })()}</p>
    <div class="vgrid mt"><button class="btn small sub" data-act="v-clearst">建物を全部撤去（${placed.size+v.extra.length}）</button></div></div>
  <div class="vsec"><h4>採取済みの資源</h4><p class="desc" style="margin-top:0">変化している自然物・採取地点：${Object.keys(S.nature||{}).length} 件</p><div class="vgrid"><button class="btn small sub" data-act="v-restore">すべて元に戻す</button></div></div>
  <div class="vsec"><h4>アセット</h4><p class="desc" style="margin-top:0">一覧は別の画面で開きます（探索画面では読み込まない）。3Dの見た目・演出は主人公のそばに置いて確かめられます。</p>
    <div class="vgrid"><button class="btn small" data-act="v-assets" data-id="ui">アセット一覧とプレビュー</button><button class="btn small sub" data-act="v-prevclear">置いたプレビューを片付ける</button></div></div>
  <div class="vsec"><h4>描画の状態</h4><p class="desc" style="margin-top:0">${gs.ok===null?"3D表示がまだ始まっていない":gs.ok?`✅ 木の枝葉カードのテクスチャ ${gs.branch}/${gs.want} を読み込み済み（旧来の球体の樹冠にはなっていない）`:`<span class="vwarn">⚠️ 木の枝葉カードのテクスチャを ${gs.branch}/${gs.want} しか読めていない（描画モジュールが旧来の球体の樹冠に戻っている可能性）</span>`}</p></div>
  <div class="vsec"><h4>登録内容の件数（いまのコードから数えた値）</h4><table class="vtbl">${rows.map(([a,b])=>`<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table></div>
  <div class="vsec"><h4>未実装・未対応（全解放でも使えないもの）</h4><ul class="helplist">${verifyGaps(c).map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
}
/* アセット一覧（別の画面＝案内の枠で開く。開いたときだけ画像を作る） */
let vAssetTab="ui";
function assetSheet(){
  const c=verifyCatalog(), H=window.HD2D||{};
  const fig=(src,cap)=>`<figure><img src="${src}" alt="" loading="lazy">${cap}</figure>`;
  const tabs=[["ui","UIアイコン"],["items","物質アイコン"],["lab","実験器具"],["hero","主人公"],["tex","テクスチャ"],["d3","3D・演出"]];
  let body="";
  if(vAssetTab==="ui") body=`<div class="vgal">${c.icons.map(k=>fig(ASSETS.icons[k],k+"（48）")).join("")}${c.icons32.map(k=>fig(ASSETS.icons32[k],k+"（32）")).join("")}</div>`;
  if(vAssetTab==="items") body=`<div class="vgal">${c.items.map(k=>`<figure>${ic(k)}<br>${IT[k].name}</figure>`).join("")}</div>`;
  if(vAssetTab==="lab") body=`<div class="vgal">${c.labApp.map(k=>fig(ASSETS.labApp[k],k)).join("")}</div>`;
  if(vAssetTab==="hero") body=`<div class="vgal">${c.hero.map(k=>fig(ASSETS[k],k)).join("")}${c.misc.map(k=>fig(ASSETS[k],k)).join("")}</div>`;
  if(vAssetTab==="tex") body=`<div class="vgal">${c.gpt.map(k=>fig(H.GPT_TEXTURES[k],k)).join("")}${c.branch.map(k=>fig(H.BRANCH_TEXTURES[k],"枝葉 "+k)).join("")}</div>`;
  if(vAssetTab==="d3") body=`<p class="desc">主人公のそばに置きます（当たり判定なし・保存されない）。</p>
    <h5>資源の見た目（${c.resTypes.length}）</h5><div class="vgrid">${c.resTypes.map(t=>`<button class="btn small sub" data-act="v-prev" data-id="res:${t}">${t}</button>`).join("")}</div>
    <h5>建物（${c.structTypes.length}）</h5><div class="vgrid">${c.structTypes.map(t=>`<button class="btn small sub" data-act="v-prev" data-id="st:${t}">${t}</button>`).join("")}</div>
    <h5>演出（${c.effects.length}）</h5><div class="vgrid">${c.effects.map(t=>`<button class="btn small sub" data-act="v-prev" data-id="fx:${t}">${t}</button>`).join("")}</div>
    <div class="vgrid mt"><button class="btn small sub" data-act="v-prevclear">片付ける</button></div>`;
  $("#sheet").innerHTML = `<button class="close" data-act="close">閉じる</button><h3 style="margin:0 0 8px">🧪 アセット一覧</h3>
    <div class="vtabs">${tabs.map(([k,n])=>`<button class="btn small ${k===vAssetTab?"":"sub"}" data-act="v-assets" data-id="${k}">${n}</button>`).join("")}</div>${body}`;
  openModal($("#sheet").querySelector(".close"));
}
const PREVIEW = new Map(); let previewN=0;
function clearPreview(){ if(W3.gfx) PREVIEW.forEach((kind,id)=>{ if(kind==="st") structRemove(id); else W3.gfx.updateResourceVisual(id,null); }); PREVIEW.clear(); previewN=0; }
function previewAt(spec){
  if(!W3.gfx || !W3.pos){ banner("3D表示が始まってから使えます"); return; }
  const [kind, type] = spec.split(":"), k=previewN++, a=k*0.9, r=3+((k%4)*0.8);
  const p={x:W3.pos.x+Math.cos(a)*r, z:W3.pos.z+Math.sin(a)*r};
  if(kind==="fx"){ W3.gfx.playVisualEffect(type, W3.pos); return; }
  const id=(kind==="st"?"vps:":"vpr:")+type+":"+k;
  if(kind==="st") structAdd(id, type, p, 0); else W3.gfx.updateResourceVisual(id, {position:p, type, scale:1, visible:true});
  PREVIEW.set(id, kind);
}
function verifyAct(act, id, b){
  if(act==="v-enter"){ setVerifyMode(true, id==="copy"?"copy":"keep"); return true; }
  if(!VERIFY || !S.verify) return false;
  const v=S.verify;
  switch(act){
    case "v-exit": setVerifyMode(false); return true;
    case "v-reset": if(confirm(id==="copy"?"通常のセーブを写して、全解放の検証データを作り直す？":"検証データを全解放の状態に作り直す？（通常のセーブはそのまま）")) setVerifyMode(true, id); return true;
    case "v-flag": v[id] = !!b.checked; save(); return true;
    case "v-add": { const n=Math.max(1,Math.min(999,parseInt(($("#vn")||{}).value,10)||1)); const it=IT[id]; if(!it) return true;
      if(it.store===false){ banner("「"+it.name+"」は保管できない（トレイから実験で使える）"); return true; }
      E.addItem(S,id,n,"verify"); if(it.unique) S.inv[id]=1; save(); banner(it.name+" を "+(it.unique?1:n)+" 個にした／足した"); const r=$("#vres"); if(r) r.innerHTML=vResults(); return true; }
    case "v-tray": U.tray[id]=(U.tray[id]||0)+1; U.last=null; banner(nm(id)+" を研究室のトレイに入れた"); setTab("lab"); return true;
    case "v-fill": { const n=E.fillStorable(S,99); save(); banner("保管できる "+n+" 種を補充した"); renderPanel(); return true; }
    case "v-warp": { if(id==="base"){ setTab("explore"); if(W3.state==="ready"){ W3.pos=WORLD.safeSpawn(S,{x:D.base.x,z:D.base.z}); haltField(); syncAll3D(); } return true; }
      const r=D.regions.find(x=>x.id===id); if(!r || !E.regionOpen(S,r)) return true;
      setTab("explore"); U.region=r.id;
      if(W3.state==="ready"){ const q=WORLD.safeSpawn(S,{x:r.w.x, z:r.w.z+REGION_R*0.2}); W3.pos={x:q.x,z:q.z}; haltField(); W3.gfx.setPlayerVisualState(playerVisual({position:W3.pos, direction:W3.dir, moving:false})); camRebase(); syncAll3D(); }
      else { fieldSig=""; renderField(); }
      banner(r.icon+" "+r.name+"へ移動した"); return true; }
    case "v-stage": v.stage = id==="auto" ? null : +id; lastStage=stage(); fieldSig=""; sceneSig=""; save(); renderChrome(); render(); return true;
    case "v-place": { const pl=new Set(v.placed); pl.has(id)?pl.delete(id):pl.add(id); v.placed=[...pl]; save(); syncStructures(); fieldSig=""; renderPanel(); return true; }
    case "v-extra": { if(!W3.pos) return true; v.extra.push({id:"vx:"+Date.now().toString(36)+v.extra.length, type:id, x:+(W3.pos.x+2.2).toFixed(2), z:+(W3.pos.z+1.2).toFixed(2), rot:0}); save(); syncStructures(); renderPanel(); banner(id+" を足もとに置いた"); return true; }
    case "v-clearst": v.placed=[]; v.extra=[]; save(); syncStructures(); fieldSig=""; renderPanel(); return true;
    case "v-restore": S.nature={}; save(); if(W3.gfx){ NODES&&NODES.forEach(n=>syncNode(n,true)); syncNature(true); } fieldSig=""; renderPanel(); banner("採取済みの資源をすべて元に戻した"); return true;
    case "v-assets": vAssetTab=id||"ui"; assetSheet(); return true;
    case "v-prev": closeModal(); setTab("explore"); previewAt(id); return true;
    case "v-prevclear": clearPreview(); return true;
  }
  return false;
}
document.addEventListener("click", ev=>{ const b=ev.target.closest && ev.target.closest("[data-act^='v-']"); if(!b) return;
  if(b.tagName==="INPUT") return;           // チェックボックスは change で扱う
  if(verifyAct(b.dataset.act, b.dataset.id, b)) ev.preventDefault(); });
document.addEventListener("change", ev=>{ const b=ev.target; if(b && b.dataset && b.dataset.act==="v-flag") verifyAct("v-flag", b.dataset.id, b); });
document.addEventListener("input", ev=>{ if(ev.target && ev.target.id==="vq"){ vQuery=ev.target.value; const r=$("#vres"); if(r) r.innerHTML=vResults(); } });

/*SPACE_UI*/
/*CONS_UI*/
window.__GAME__ = {SPACE, setTab, writeNow,get S(){return S;}, save:()=>save(), walk:{speed:WALK_SPEED, maxDt:MAX_DT, stride:1.4}, cam:{user:()=>camUser(), faceSector:()=>faceSector(), lim:()=>camPitchLim(), rebase:()=>camRebase(), debug:()=>W3.camDbg, solve:(y,p,z,x,zz)=>camSolve(y,p,z,x,zz), axes:(y,p)=>camAxes(y,p), CAM}, hero:{dirs:()=>heroDirs(), sheet:h=>heroSheet3D(h), facing:()=>worldFacing()}, get VERIFY(){return VERIFY;}, verifyCatalog:()=>verifyCatalog(), gfxStatus:()=>gfxStatus(), E, D, U, W3, onScreenish:(x,z,h,m)=>onScreenish(x,z,h,m), get NODES(){return NODES;}, get WORLD(){return world();}, goTo3D:(x,z,t)=>goTo3D(x,z,t), pressAction:()=>pressAction(), selectAndGo:t=>selectAndGo(t), screenToGround:(x,y)=>screenToGround(x,y), toScreen:(x,y,z)=>toScreen(x,y,z), render:()=>{ fieldSig=""; sceneSig=""; lastStage=stage(); lastMission=E.missionIndex(S); renderChrome(); render(); }};
})(DATA, ENGINE);
