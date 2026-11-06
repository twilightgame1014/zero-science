/* ===================== 画面（UI） ===================== */
(function(D,E){
const IT=D.items, OPS=D.ops;
const SAVE_KEY="zero-kagaku-save";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
let S = load();
const U = {tab:"explore", opener:null, dockTab:null, missionOpen:false, tray:{}, fac:null, op:null, busy:false, filter:"すべて", target:null, last:null,
           region:"forest", nodes:{}, combo:0, lastGather:0, walking:false};
const $ = s=>document.querySelector(s);
const nm = id=>IT[id]?IT[id].name:id;
/* 物質アイコン（Muse の assets/item-icons から作った 64px アトラス。ないもの・道具・設備は絵文字） */
const ITEM_ICO = (()=>{ const a = window.ASSETS && ASSETS.items; if(!a || !a.src) return null;
  let url = a.src;
  try{ const b = atob(a.src.slice(a.src.indexOf(",")+1)), u = new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); url = URL.createObjectURL(new Blob([u],{type:"image/webp"})); }catch(e){}
  document.documentElement.style.setProperty("--iat", `url("${url}")`);
  document.documentElement.style.setProperty("--iat-c", a.cols); document.documentElement.style.setProperty("--iat-r", a.rows);
  return {url, cols:a.cols, rows:a.rows, pos:a.pos||{}}; })();
const icT = id=>IT[id]?IT[id].icon:"❔";   // 文字だけの場所（バナー・選択肢・SVGの代替）
const ic = id=>{ const p = ITEM_ICO && ITEM_ICO.pos[id]; return p ? `<span class="iic" style="--c:${p[0]};--r:${p[1]}" aria-hidden="true"></span>` : icT(id); };
const svgIc = (id, x, y, sz)=>{ const p = ITEM_ICO && ITEM_ICO.pos[id];
  return p ? `<svg x="${x}" y="${y}" width="${sz}" height="${sz}" viewBox="${p[0]*64} ${p[1]*64} 64 64" aria-hidden="true"><image href="${ITEM_ICO.url}" width="${ITEM_ICO.cols*64}" height="${ITEM_ICO.rows*64}"/></svg>`
           : `<text text-anchor="middle" x="${x+sz/2}" y="${y+sz*0.78}" font-size="${sz*0.75}">${icT(id)}</text>`; };
const isMat = id=>IT[id] && !IT[id].tags.includes("道具") && !IT[id].tags.includes("研究設備");
const owned = id=>E.has(S,id);
const stage = ()=>E.stageOf(S);

/* ---------- 保存 ---------- */
function load(){ try{ const t = localStorage.getItem(SAVE_KEY); if(t) return E.deserialize(t); }catch(e){} return E.newState(); }
let saveTimer=null;
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ try{ localStorage.setItem(SAVE_KEY,E.serialize(S)); }catch(e){} },250); }
document.addEventListener("visibilitychange",()=>{ if(document.hidden){ try{ localStorage.setItem(SAVE_KEY,E.serialize(S)); }catch(e){} } });

/* ---------- 通知 ---------- */
function toast(id, kind){
  const box = $("#toasts"); const el = document.createElement("div"); el.className="toast"+(kind?" small":"");
  if(kind==="mission") el.innerHTML=`<div class="i">🦉</div><div><div class="k">目標達成！</div><div class="nm">${id}</div></div>`;
  else if(kind==="stage") el.innerHTML=`<div class="i">🏙️</div><div><div class="k">文明が進化した！</div><div class="nm">${id}</div><p>フィールドと研究室の見た目が変わったよ。</p></div>`;
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
const TABS = {explore:"🗺️ 探索", lab:"🧪 研究室", craft:"🔨 工作", book:"📖 図鑑", map:"🕸️ 技術マップ", log:"📓 記録",
  world:"🗺️ 地図・地域", menu:"☰ メニュー", settings:"⚙️ 設定・ヘルプ"};
/* パネルの大きさ。PC：右側のパネル（side）か大きなオーバーレイ（wide）。スマホ：下からのシート（sheet）か全高近く（tall） */
const PC_SIZE = {book:"wide", map:"wide", lab:"wide"};   /* 研究室は材料・操作と実験台を並べる */
const TOUCH_SIZE = {lab:"tall", craft:"tall", book:"tall", map:"tall", log:"tall"};
const MENU_TABS = ["menu","book","map","log","settings"];   /* スマホでは「メニュー」の中にある画面 */
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
function iconHTML(name, small){ const box = window.ASSETS && (small ? ASSETS.icons32 : ASSETS.icons), src = box && box[name];
  return src ? `<img class="ico" src="${src}" alt="" aria-hidden="true">` : `<span class="ico emo" aria-hidden="true">${ICON_EMOJI[name]||""}</span>`; }
function applyIcons(){ document.querySelectorAll("[data-icon]").forEach(el=>{ const sp=el.querySelector(".ico"); if(sp) sp.outerHTML = iconHTML(el.dataset.icon, el.classList.contains("hbtn")); }); }
function renderChrome(){
  const i = E.missionIndex(S), m = D.missions[i], touch = uiMode()==="touch";
  updateLoc();
  document.querySelectorAll("#nav [data-tab],.hud-tr [data-tab]").forEach(b=>{
    const t=b.dataset.tab, on = t===U.tab || (t==="menu" && touch && MENU_TABS.includes(U.tab));
    if(b.closest("#nav")) b.setAttribute("aria-current", on?"page":"false");
    b.setAttribute("aria-expanded", on?"true":"false"); });
  $("#mission").innerHTML = `<details class="mission" id="missionBox" ${U.missionOpen?"open":""}><summary title="目標の詳細を開く・閉じる"><span class="owl" aria-hidden="true">🦉</span>
    <span class="mtx"><span class="lab">目標 ${i+1}/${D.missions.length}</span><span class="t">${m.t}</span></span><span class="more" aria-hidden="true"></span></summary>
    <div class="how">${m.how}</div>
    ${m.tab!=="explore" && U.tab!==m.tab?`<button class="btn small sub go" data-act="tab" data-tab="${m.tab}">${TABS[m.tab]}を開く</button>`:""}</details>`;
  layout();
}
document.addEventListener("toggle", e=>{ if(e.target.id==="missionBox"){ U.missionOpen=e.target.open; } }, true);
/* 下部ナビが実際に占める高さを CSS 変数へ（スティック・採取ボタン・パネルをその上に置く） */
function layout(){
  const app=$("#app"), n=$("#nav"); if(!app || !n) return;
  const a=app.getBoundingClientRect(), r=n.getBoundingClientRect();
  app.style.setProperty("--navh", Math.max(0, Math.round(a.bottom - r.top))+"px");
  /* HUD に隠れない範囲を描画モジュールへ伝える（公開API setViewportInsets がある場合だけ） */
  if(typeof W3!=="undefined" && W3.gfx && typeof W3.gfx.setViewportInsets==="function"){ try{ W3.gfx.setViewportInsets(hudInsets()); }catch(e){} }
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
document.addEventListener("pointerdown", e=>{ if(e.pointerType==="touch") $("#app").classList.add("touched"); }, true);
function setTab(t, opener){
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
  if(!open) return;
  dock.dataset.size = uiMode()==="pc" ? (PC_SIZE[U.tab]||"side") : (TOUCH_SIZE[U.tab]||"sheet");
  if(U.dockTab!==U.tab){ body.innerHTML=""; body.scrollTop=0; U.dockTab=U.tab; sceneSig=""; }
  $("#dockTitle").textContent = TABS[U.tab];
  if(U.tab==="lab") renderLab(body);
  else if(U.tab==="craft") body.innerHTML = viewCraft();
  else if(U.tab==="book") body.innerHTML = viewBook();
  else if(U.tab==="map") body.innerHTML = viewMap();
  else if(U.tab==="log") body.innerHTML = viewLog();
  else if(U.tab==="world"){ body.innerHTML = viewWorld(); drawRegion(); }
  else if(U.tab==="menu") body.innerHTML = viewMenu();
  else if(U.tab==="settings") body.innerHTML = viewSettings();
}
function stageSummary(){
  const st=stage(), got=Object.keys(S.disc).filter(k=>IT[k]).length;
  return `<div class="summary"><span class="chip">🏛️ <b>${D.stages[st].era}</b>・${D.stages[st].name}</span><span class="chip">📖 図鑑 <b>${got}</b>/${Object.keys(IT).length}</span></div>
    <p class="desc" style="margin-top:0">次の文明の進化：${D.stages[st].need}</p>`;
}
function viewMenu(){
  return stageSummary()+`<div class="bigmenu">${[["book","book","図鑑","見つけたものの説明"],["map","tech","技術","技術と物質のつながり"],["log","log","記録","実験の記録・セーブ"],["settings","settings","設定","主人公・表示・遊び方"]]
    .map(([t,i,n,d])=>`<button class="bigitem" data-tab="${t}">${iconHTML(i)}<span>${n}<small>${d}</small></span></button>`).join("")}</div>`;
}
function viewSettings(){
  const touch = uiMode()==="touch", failed = W3.state==="failed";
  return `<div class="sec" style="font-size:1.15rem">ゼロからの科学 〜石と水と木から〜</div>
  <p class="desc" style="margin-top:0">石・水・木といった自然の資源だけから、実験と工作を積み重ねて、文明を作り直していくゲーム。</p>
  ${stageSummary()}
  <div class="sec">👤 主人公</div>
  <div class="row">${["boy","girl"].map(h=>`<button class="heropick" data-act="pickhero" data-id="${h}" aria-pressed="${(S.flags.hero||"boy")===h}"><span class="hero big" style="background-image:url(${ASSETS[h]})"></span>${h==="boy"?"男の子":"女の子"}</button>`).join("")}</div>
  <div class="sec">🖥️ フィールドの表示</div>
  ${failed?`<p class="desc">3D表示が使えないため、2Dで表示しています。${W3.err||""}</p>`:
    `<div class="row"><button class="opt" data-act="view3d" aria-pressed="${S.flags.view!=="2d"}">🌄 3D</button><button class="opt" data-act="view2d" aria-pressed="${S.flags.view==="2d"}">🗺️ 2D（軽い）</button></div>`}
  <div class="sec">🎮 遊び方</div>
  <ul class="helplist">${touch?
    `<li>左下のスティックで歩く。地面をタップすると、そこへ歩く</li><li>資源の名札をタップすると、歩いて行って採取する</li><li>近くに資源があると、右下のボタンが「採る」に変わる</li><li>地域の移動は右上の「地図」、研究と工作は下のボタンから</li>`:
    `<li><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span> か矢印キーで歩く。地面をクリックすると、そこへ歩く</li><li>資源に近づいて <span class="kbd">E</span> かスペースで採取。名札をクリックすると歩いて行って採取する</li><li><span class="kbd">Esc</span> で開いているメニューを閉じる</li><li>地域の移動は右上の「地図」、研究・工作・図鑑などは下のメニューから</li>`}</ul>
  <div class="row mt"><button class="btn small sub" data-act="introagain">🦉 はじめの説明をもう一度見る</button></div>
  <p class="desc">セーブは自動でこのブラウザに保存されます。別の端末へ移すときは「記録」から。</p>`;
}
function travelChips(){
  return D.regions.map(r=>{ const open=E.regionOpen(S,r), here=in3D()? W3.region===r : U.region===r.id;
    return `<button class="chip tchip ${open?"":"lockc"} ${here?"here":""}" data-act="travel" data-id="${r.id}" ${open?"":`aria-describedby="why-${r.id}"`}>${open?r.icon:"🔒"} ${r.name}${here?"（今ここ）":""}${open?"":`<small id="why-${r.id}" style="font-weight:500">：${r.unlock?"「"+r.unlock.map(nm).join("」か「")+"」が必要":"まだ行けない"}</small>`}</button>`; }).join("");
}
function viewWorld(){
  const st=stage(), r=D.regions.find(x=>x.id===U.region)||D.regions[0];
  if(in3D()) return `<div class="sec">地域を選んで移動 <small>選ぶと、その地域まで歩いて行く</small></div>
    <div class="row"><button class="btn small sub" data-act="home">🏠 拠点へ戻る</button></div>
    <div class="travel">${travelChips()}</div><div id="regionBox"></div>`;
  return `<div class="sec">地域を選んで移動 <small>地図のピンを選ぶと、その地域へ移動する</small></div>
    <div class="field" id="field">${fieldSVG(st)}
      ${D.regions.map(x=>{ const open=E.regionOpen(S,x); return `<button class="pin ${open?"":"lock"} ${x.id===U.region?"here":""}" style="left:${x.x}%;top:${x.y}%" data-act="go" data-id="${x.id}" aria-label="${x.name}${open?"":"（未開放）"}"><span class="pi">${open?x.icon:"🔒"}</span><span class="pn">${x.name}</span></button>`; }).join("")}
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
  const bench = owned("bench") || st>=3;
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
    <div class="shelf">${mats.length? mats.map(id=>{ const left=S.inv[id]-(U.tray[id]||0); return `<button class="mat" data-act="add" data-id="${id}" ${left<=0||U.busy?"disabled":""}><span class="i">${ic(id)}</span>${nm(id)} <span class="q">${left}</span></button>`; }).join("") : `<span class="desc">材料がない。探索フィールドで集めよう。</span>`}</div>
  </div>
  <div class="panel mt">
    <h3><span class="n">2</span>装置を選ぶ</h3>
    <div class="opts">${facs.length? facs.map(f=>`<button class="opt" data-act="fac" data-id="${f}" aria-pressed="${U.fac===f}">${ic(f)} ${nm(f)}</button>`).join("") : `<span class="desc">まだ装置がない。「工作」で作業台やたき火を作ろう。</span>`}</div>
    ${U.fac?`<p class="desc">${IT[U.fac].kid}</p>`:""}
    <h3 class="mt"><span class="n">3</span>操作を選ぶ</h3>
    <div class="opts">${U.fac? IT[U.fac].ops.map(o=>`<button class="opt" data-act="op" data-id="${o}" aria-pressed="${U.op===o}">${OPS[o].icon} ${OPS[o].name}</button>`).join("") : `<span class="desc">先に装置を選んでね。</span>`}</div>
    <p class="desc">${op?`<b>${op.name}（${op.yomi}）</b>：${op.kid}`:""}</p>
    <div class="runbar"><button class="btn big" data-act="run" ${canRun?"":"disabled"}>🧪 実験スタート</button><button class="btn sub" data-act="hint">💡 ヒント</button></div>
  </div>
  <div id="labResult" aria-live="polite">${U.last||""}</div>`;
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
  setTimeout(()=>{ const outs=Object.keys(p.out).filter(k=>IT[k].store!==false); if(cnt&&outs.length) cnt.setAttribute("fill", IT[outs[0]].color); }, RM?100:1100);
  setTimeout(()=>{ fx.forEach(f=>sc.classList.remove("f-"+f)); temp&&temp.classList.remove("on"); done&&done(); }, RM?300:1900);
}
function resultNote(res){
  const p=res.proc, isNew = res.news.length>0, showP = owned("balance"), outs = Object.keys(res.produce);
  return `<div class="note ${isNew?"new":"good"}">
    <h4>${isNew?"✨ 新しい発見！":"✅ 実験成功！"} <small style="font-weight:700;color:var(--muted)">${OPS[p.op].icon}${OPS[p.op].name} × ${res.batches}回</small></h4>
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
  const sea = "var(--sea)";
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
  ${S.disc.solarcell?[[192,140],[208,140],[192,150],[208,150]].map(([x,y])=>`<path d="M${x} ${y} l12 0 l-3 7 l-12 0z" fill="#2b4a7a" stroke="#9aa3ad"/>`).join(""):""}
  ${owned("rig")?`<g><rect x="352" y="186" width="18" height="4" fill="#6f7a86"/><path d="M356 186 L361 162 L366 186" fill="none" stroke="#3d4650" stroke-width="2"/><circle cx="361" cy="160" r="2" fill="#e2572a"/></g>`:`<ellipse cx="361" cy="182" rx="10" ry="4" fill="#1f1810" opacity=".5"/>`}
  ${st>=3?`<path d="M112 176 Q140 140 188 156 M112 176 Q120 200 144 210 M112 176 Q90 140 80 118 M188 156 Q240 120 256 80" fill="none" stroke="#a88a5a" stroke-width="3" stroke-dasharray="5 4"/>`:""}
  ${st>=4?rail("M112 178 Q150 110 160 66")+rail("M112 178 Q220 150 256 84 Q300 100 336 112"):""}
  ${st>=5?road("M112 178 Q200 200 312 234")+road("M112 178 Q60 200 0 210"):""}
  ${st>=4?[[130,150],[170,110],[220,120],[270,160],[300,200]].map(([x,y])=>`<path d="M${x} ${y} V${y-18} M${x-5} ${y-15} H${x+5}" stroke="#5b5048" stroke-width="1.5"/>`).join("")+`<path d="M130 135 Q150 128 170 95 Q195 98 220 105 Q245 132 270 145 Q285 170 300 185" fill="none" stroke="#333" stroke-width=".8"/>`:""}
  ${st>=4?`<g ${RM?'transform="translate(200,130)"':""}><rect x="-9" y="-6" width="18" height="10" rx="2" fill="#3d4650"/><rect x="-9" y="-12" width="7" height="7" fill="#5b6470"/><circle cx="-5" cy="5" r="2.2" fill="#222"/><circle cx="5" cy="5" r="2.2" fill="#222"/><circle cx="6" cy="-12" r="3.5" fill="#ddd" opacity=".75"/>${RM?"":`<animateMotion dur="10s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;.5;1" calcMode="linear" path="M112 178 Q220 150 256 84 Q300 100 336 112"/>`}</g>`:""}
  ${st>=4?[[176,96],[204,90]].map(([x,y])=>`<g transform="translate(${x},${y})"><rect x="-8" y="-10" width="16" height="12" fill="#7a3a2a"/><rect x="2" y="-24" width="4" height="16" fill="#5a2a1e"/><circle class="fsmoke" cx="4" cy="-28" r="4" fill="#999" opacity=".6"/></g>`).join(""):""}
  ${st>=5?`${[[36,210],[64,226],[88,240],[130,232],[150,250]].map(([x,y],i)=>`<g transform="translate(${x},${y})"><rect x="-7" y="${-14-i%3*8}" width="14" height="${14+i%3*8}" fill="${["#8fa3b5","#a9bccb","#7f95a8"][i%3]}"/>${[0,1,2].map(j=>`<rect x="-4" y="${-11-i%3*8+j*5}" width="3" height="2.5" fill="#ffe27a"/><rect x="1" y="${-11-i%3*8+j*5}" width="3" height="2.5" fill="#ffe27a"/>`).join("")}</g>`).join("")}
    ${[[282,170],[300,160]].map(([x,y])=>`<g transform="translate(${x},${y})"><path d="M0 0 V-22" stroke="#eee" stroke-width="2"/><g transform="translate(0,-22)"><g class="spin"><path d="M0 0 L0 -10 M0 0 L9 5 M0 0 L-9 5" stroke="#fff" stroke-width="2"/></g></g></g>`).join("")}`:""}
  ${owned("waterwheel")?`<g transform="translate(160,140)"><g class="spin"><circle r="9" fill="none" stroke="#7a5636" stroke-width="3"/><path d="M-9 0 H9 M0 -9 V9" stroke="#7a5636" stroke-width="2"/></g></g>`:""}
  <g transform="translate(112,180) scale(${st>=4?1.6:st>=2?1.3:1.1})">${baseArt(st)}</g>
  </svg>`;
}
function baseArt(st){
  if(st===0) return `<circle cx="0" cy="0" r="10" fill="#c9b88c" opacity=".7"/>`;
  if(st===1) return `<path d="M-16 6 L-4 -14 L8 6Z" fill="#c8a46a" stroke="#7a5636"/><path class="idle-flame" d="M14 6 Q10 0 14 -6 Q18 0 14 6Z" fill="#ff9a3c"/><circle class="fsmoke" cx="15" cy="-12" r="4" fill="#bbb" opacity=".6"/>`;
  if(st===2) return [[-18,4],[0,-6],[16,6]].map(([x,y])=>`<rect x="${x-7}" y="${y-6}" width="14" height="10" fill="#b8926d"/><path d="M${x-10} ${y-5} L${x} ${y-15} L${x+10} ${y-5}Z" fill="#b8943f"/>`).join("")+`<path d="M24 -6 Q24 -18 30 -18 Q36 -18 36 -6Z" fill="#b4483b"/><circle class="fsmoke" cx="30" cy="-24" r="4" fill="#bbb" opacity=".6"/>`;
  if(st===3) return [[-20,4],[-4,-4],[12,6]].map(([x,y])=>`<rect x="${x-8}" y="${y-10}" width="16" height="14" fill="#a54e33"/><path d="M${x-10} ${y-10} L${x} ${y-18} L${x+10} ${y-10}Z" fill="#7a3a2a"/>`).join("")+`<rect x="24" y="-26" width="7" height="30" fill="#7a3a2a"/><circle class="fsmoke" cx="28" cy="-32" r="5" fill="#bbb" opacity=".6"/>`;
  if(st===4) return `<rect x="-26" y="-14" width="34" height="20" fill="#7a3a2a"/><path d="M-26 -14 l8.5 -6 v6 l8.5 -6 v6 l8.5 -6 v6 l8.5 -6 v6" fill="#5a2a1e"/><rect x="12" y="-36" width="6" height="42" fill="#5a2a1e"/><rect x="22" y="-30" width="6" height="36" fill="#5a2a1e"/>
    <circle class="fsmoke" cx="15" cy="-42" r="6" fill="#999" opacity=".6"/><circle class="fsmoke" cx="25" cy="-36" r="5" fill="#999" opacity=".6"/>`;
  return `<rect x="-30" y="-30" width="12" height="36" fill="#8fa3b5"/><rect x="-16" y="-48" width="14" height="54" fill="#a9bccb"/><rect x="0" y="-38" width="12" height="44" fill="#7f95a8"/><rect x="14" y="-24" width="16" height="30" fill="#b9c8d4"/>
    ${[-44,-36,-28,-20,-12].map(y=>`<rect x="-13" y="${y}" width="3" height="3" fill="#ffe27a"/><rect x="-7" y="${y}" width="3" height="3" fill="#ffe27a"/>`).join("")}${[-30,-22,-14].map(y=>`<rect x="3" y="${y}" width="3" height="3" fill="#ffe27a"/>`).join("")}`;
}
function regionArt(r, st){
  const sky = `<rect width="320" height="180" fill="url(#rsky)"/>`;
  const ground = c=>`<rect y="128" width="320" height="52" fill="${c}"/>`;
  switch(r.scene){
    case "forest": return sky+`<path d="M0 110 Q80 80 160 104 T320 100 V180 H0Z" style="fill:var(--hill2)"/>`+ground("#6b8f4e")+
      [[20,128,1.6],[60,124,2],[110,130,1.5],[150,122,2.2],[200,128,1.7],[250,124,2],[296,130,1.6],[86,138,1.2],[230,140,1.2]].map(([x,y,s])=>`<rect x="${x-2*s}" y="${y-6*s}" width="${4*s}" height="${10*s}" style="fill:var(--trunk)"/><path d="M${x-12*s} ${y-4*s} L${x} ${y-34*s} L${x+12*s} ${y-4*s}Z" style="fill:var(--tree)"/>`).join("")+
      (st>=4?`<path d="M0 166 Q160 150 320 168" stroke="#a88a5a" stroke-width="8" fill="none"/>`:"");
    case "grass": return sky+`<path d="M0 112 Q90 90 180 110 T320 104 V180 H0Z" fill="#9cc49a"/>`+ground("#8fb96e")+
      [[30,150],[70,160],[120,146],[180,162],[240,150],[290,160]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3" fill="#f2b632"/><circle cx="${x+8}" cy="${y+4}" r="2.5" fill="#e889a8"/>`).join("")+
      (st>=4?`<path d="M0 140 H320" stroke="#5b5048" stroke-width="4"/><path d="M0 140 H320" stroke="#c9b88c" stroke-width="4" stroke-dasharray="1.5 5"/>`:"")+
      (S.disc.solarcell?[[200,120],[236,120],[272,120]].map(([x,y])=>`<path d="M${x} ${y} l30 0 l-6 14 l-30 0z" fill="#2b4a7a" stroke="#9aa3ad"/>`).join(""):"");
    case "river": return sky+`<path d="M0 100 Q80 86 160 98 T320 94 V180 H0Z" fill="#9cc49a"/>`+ground("#c9b88c")+`<path d="M0 118 Q160 104 320 122 V140 Q160 126 0 140Z" style="fill:var(--sea)"/>`+
      `<g class="waves"><path d="M20 128 q10 -4 20 0 M140 120 q10 -4 20 0 M250 128 q10 -4 20 0" stroke="#fff" fill="none" opacity=".7"/></g>`+
      (owned("waterwheel")?`<g transform="translate(270,118)"><g class="spin"><circle r="20" fill="none" stroke="#7a5636" stroke-width="4"/><path d="M-20 0 H20 M0 -20 V20 M-14 -14 L14 14 M14 -14 L-14 14" stroke="#7a5636" stroke-width="3"/></g></g>`:"");
    case "coast": return sky+`<rect y="96" width="320" height="50" style="fill:var(--sea)"/><g class="waves"><path d="M0 120 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#fff" fill="none" opacity=".7"/></g>`+
      `<path d="M0 140 Q160 126 320 142 V180 H0Z" fill="#e8d9b0"/>`+(st>=5?`<g transform="translate(270,70)"><path d="M0 0 V40" stroke="#ddd" stroke-width="3"/><g class="spin"><path d="M0 0 L0 -18 M0 0 L15 9 M0 0 L-15 9" stroke="#fff" stroke-width="3"/></g></g>`:st>=4?`<path d="M240 98 h40 l-6 8 h-28z" fill="#3d4650"/><rect x="254" y="86" width="5" height="12" fill="#3d4650"/><circle class="fsmoke" cx="256" cy="80" r="4" fill="#999"/>`:"");
    case "mountain": return sky+`<path d="M-10 140 L80 40 L170 140Z" fill="#7f8a8c"/><path d="M110 140 L220 20 L330 140Z" fill="#6f7a7c"/><path d="M200 42 L220 20 L240 42 Q220 50 200 42Z" fill="#fff"/>`+ground("#9a9c98")+
      (st>=4?`<path d="M0 160 Q160 140 320 158" stroke="#5b5048" stroke-width="4" fill="none"/>`:"");
    case "cave": return `<rect width="320" height="180" fill="#2a221c"/><radialGradient id="torch" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <rect width="320" height="180" fill="url(#torch)"/>${[20,60,110,170,230,280].map((x,i)=>`<path d="M${x} 0 L${x+8} ${20+i%3*10} L${x+16} 0Z" fill="#4a3a2e"/>`).join("")}<rect y="146" width="320" height="34" fill="#3a2e24"/>`+
      (st>=4?`<path d="M0 30 H320" stroke="#333"/>${[60,160,260].map(x=>`<circle cx="${x}" cy="34" r="4" fill="#ffe27a"/>`).join("")}`:"");
    case "mine": return sky+`<path d="M0 120 Q60 50 140 80 T320 70 V180 H0Z" fill="#8a6a4a"/><path d="M126 132 Q124 104 140 94 Q152 86 164 95 Q178 106 174 132Z" fill="#2a1e16"/><path d="M118 134 Q130 120 126 108 M176 108 Q182 122 184 134" fill="none" stroke="#6a4f37" stroke-width="4" stroke-linecap="round"/>`+ground("#7a5a3e")+
      (st>=4?`<path d="M0 158 H320" stroke="#5b5048" stroke-width="4"/><path d="M0 158 H320" stroke="#c9b88c" stroke-width="4" stroke-dasharray="1.5 5"/><rect x="200" y="142" width="26" height="12" fill="#5b6470"/><circle cx="206" cy="156" r="3" fill="#333"/><circle cx="220" cy="156" r="3" fill="#333"/>`:"")+
      (st>=5?`<text x="250" y="150" font-size="26">🚜</text>`:"");
    case "volcano": return `<rect width="320" height="180" fill="#6a3a3a"/><path d="M40 160 L150 30 L260 160Z" fill="#4a2a24"/><path d="M130 50 L150 30 L170 50 Q150 60 130 50Z" fill="#ff7a2a" class="idle-flame"/>
      <g class="fsmoke"><circle cx="150" cy="20" r="12" fill="#999" opacity=".5"/><circle cx="166" cy="10" r="9" fill="#aaa" opacity=".4"/></g><path d="M150 50 Q140 100 120 160" stroke="#ff7a2a" stroke-width="4" fill="none" opacity=".8"/>`+ground("#3a2a24")+
      (st>=5?`<rect x="250" y="116" width="40" height="28" fill="#cfd6dc"/><rect x="258" y="100" width="8" height="18" fill="#cfd6dc"/><circle class="fsmoke" cx="262" cy="94" r="6" fill="#fff" opacity=".6"/>`:"");
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
  const sig = "2d|"+st+"|"+r.id+"|"+E.exploreLv(S,r.id)+"|"+W3.state+"|"+owned("waterwheel")+(S.disc.solarcell?1:0);
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
function updateLoc(){
  const el=$("#hudLoc"); if(!el) return;
  const r = in3D() ? W3.region : D.regions.find(x=>x.id===U.region);
  el.innerHTML = r ? `${r.icon} <b>${r.name}</b><small>探索Lv${E.exploreLv(S,r.id)}</small>`
    : in3D() && W3.state!=="ready" ? `🌄 <b>準備中</b>` : in3D() && W3.moving ? `🧭 <b>移動中</b><small>地域の外</small>` : `🧭 <b>地域の外</b><small>野原</small>`;
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
      return `<div class="res"><span class="i">${k?ic(x.id):"❔"}</span><span class="nm">${k?nm(x.id):"何かありそう…"} ${k?`<small>${IT[x.id].kid}</small>`:""}${!g.ok?`<small style="color:var(--clay)">🔒 ${g.reason}</small>`:`<small>1回で${g.n}個・所持${E.cnt(S,x.id)}個</small>`}</span>
      ${k&&slots&&g.ok?`<button class="auto" data-act="auto" data-r="${r.id}" data-id="${x.id}" aria-pressed="${au}">🧺 自動</button>`:""}</div>`; }).join("")}
    ${(r.rare||[]).length?`<div class="res"><span class="i">✨</span><span class="nm">珍しい発見 <small>${r.rare.map(x=>S.disc[x.id]?ic(x.id)+nm(x.id):"❔？？？").join("・")}</small></span></div>`:""}
    ${slots?`<p class="desc">🧺 自動採取：${S.auto.length}/${slots}枠（ページを開いている間、10秒ごとに集める）</p>`:""}
    </div></div>`;
}
function nodeHTML(r,x){
  const g = E.gatherInfo(S,r,x), k=S.disc[x.id], n=depInfo(r.id,x.id), regrow = g.ok && n.left<=0;
  const rule = E.depositRule(S,r.id,x.id), pct = regrow && n.until ? Math.max(0,Math.min(100,100-(n.until-Date.now())/rule.regrow*100)) : 100;
  return `<button class="node ${g.ok?"":"nlock"} ${regrow?"regrow":""}" id="n-${x.id}" style="left:${x.p[0]}%;top:${x.p[1]}%;--p:${pct}" data-act="gather" data-r="${r.id}" data-id="${x.id}" aria-label="${k?nm(x.id):"未発見の資源"}">
    <span class="ni">${g.ok?(k?ic(x.id):"❔"):"🔒"}</span><span class="nl">${k?nm(x.id):"？"}</span><span class="pips">${regrow||!isFinite(n.left)?"":"●".repeat(Math.min(n.left,8))}</span></button>`;
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
  const r = D.regions.find(x=>x.id===rid), res=r.res.find(x=>x.id===id), el=$("#n-"+id);
  const inf = depInfo(rid,id);
  if(!inf.ok){ floatText(el, inf.kind==="empty"?"もうすぐ戻る…":inf.reason, "ng"); return; }
  const now=Date.now(); U.combo = (now-U.lastGather<1600) ? U.combo+1 : 1; U.lastGather=now;
  const lvBefore = E.exploreLv(S,rid);
  const out = E.harvestDeposit(S,rid,id,{combo:U.combo, token:S.seq});
  if(!out.ok){ floatText(el,out.reason,"ng"); return; }
  const sc=$("#rnodes");
  const sw=document.createElement("span"); sw.className="swing"; sw.textContent=owned("steamengine")&&["mine","mountain"].includes(rid)?"⚙️":TOOLFX[rid]||"✋";
  if(el&&sc){ sw.style.left=el.style.left; sw.style.top=el.style.top; sc.appendChild(sw); setTimeout(()=>sw.remove(),500); }
  floatText(el, (out.crit?"会心！ ":"")+ic(id)+"＋"+out.n, out.crit?"crit":"");
  const cb=$("#combo"); if(cb){ cb.textContent = U.combo>=2 ? "コンボ×"+U.combo+(U.combo%5===0?"　おまけ＋1！":"") : ""; cb.classList.toggle("on",U.combo>=2); }
  afterChange(out.news);
  if(E.exploreLv(S,rid)!==lvBefore || out.news.length){ fieldSig=""; renderField(); drawRegion(); }
  else { const ne=$("#n-"+id); if(ne){ ne.outerHTML = nodeHTML(r,res); const nn=$("#n-"+id); if(nn&&!RM) nn.classList.add("hit"); } }
  if(out.rares.length) banner("✨ 珍しい発見！ "+out.rares.map(nm).join("・"));
  else if(out.lvUp) banner("⭐ 探索Lv"+out.lvUp+"に上がった！");
}
function travel(rid){
  const r = D.regions.find(x=>x.id===rid);
  if(!E.regionOpen(S,r)){
    const p=document.querySelector(`.pin[data-id="${rid}"]`); if(p){ p.classList.remove("shake"); void p.offsetWidth; p.classList.add("shake"); }
    const rb=$("#regionBox"); if(rb){ const n=document.createElement("div"); n.className="note bad"; n.innerHTML=`<h4>🔒 ${r.name}</h4><p style="margin:0">${r.kid}${r.unlock?"<br>入るには「"+r.unlock.map(nm).join("」か「")+"」が必要。":""}</p>`; rb.prepend(n); setTimeout(()=>n.remove(),3500); }
    return; }
  U.region=rid; U.combo=0; fieldSig="";
  setTab("explore"); renderField(); banner(r.icon+" "+r.name+"に着いた");
}
setInterval(()=>{ if(!$("#rscene")) return; const r=D.regions.find(x=>x.id===U.region); if(!r) return;
  r.res.forEach(x=>{ const el=$("#n-"+x.id); if(!el) return; const html=nodeHTML(r,x); if(el._h!==html){ el.outerHTML=html; const ne=$("#n-"+x.id); if(ne) ne._h=html; } });
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
const heroUrl = ()=> S.flags.hero==="girl" ? ASSETS.girl : ASSETS.boy;
let NODES = null;
/* 地域の採取地点（3D上の位置はエンジンの depositPos） */
function buildNodes(){
  NODES = [];
  D.regions.forEach(r=>{ if(!r.w) return;
    r.res.forEach((res,i)=>{
      const pos = E.depositPos(r,res);
      NODES.push({key:r.id+":"+res.id, vid:E.depositId(r.id,res.id), r, res, pos,
        type:(NATURE.DEPOSIT_SHAPE[res.id]||{}).vis||RES_VIS[res.id]||"rock", rot:(i*1.7)%6.28, scale: (NATURE.DEPOSIT_SHAPE[res.id]||{}).vis==="tree"?1.1:1});
    }); });
}
function nodeVisual(n){
  const inf = depInfo(n.r.id, n.res.id);
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
  if(!WORLD && window.TERRAIN && window.NATURE) WORLD = NATURE.create(D, E, {terrainHeight:TERRAIN.terrainHeight, distanceToRiver:TERRAIN.distanceToRiver, cfg:TERRAIN.DEFAULT_CONFIG});
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
function syncNature(force){
  if(!W3.gfx || !world() || !W3.pos) return;
  const shown = W3.natShown || (W3.natShown = new Set());
  WORLD.objects.forEach(o=>{
    const d = Math.hypot(o.x-W3.pos.x, o.z-W3.pos.z);
    if(d > NAT_HIDE_R || (d > NAT_SHOW_R && !shown.has(o.id))){ if(shown.has(o.id)){ W3.gfx.updateResourceVisual(o.id, null); shown.delete(o.id); delete W3.visSig[o.id]; } return; }
    const v = natVisual(o), sig = v.natural.state+"|"+v.highlighted+"|"+v.phase;
    if(!force && shown.has(o.id) && W3.visSig[o.id]===sig) return;
    W3.visSig[o.id]=sig; shown.add(o.id); W3.gfx.updateResourceVisual(o.id, v);
  });
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
  {id:"st-power",   type:"power-plant",at:{x:-7,z:13},    when:()=>owned("generator")},
  {id:"st-inst",    type:"research-institute", at:{x:-30,z:31}, when:()=>owned("reactor")},
  /* 拠点の外：水車は川岸（nature.js の SITES で自然物を置かない）、掘削やぐらは油田の原油のそば */
  {id:"st-wheel",   type:"waterwheel", at:{x:15.2,z:3.8}, rot:2.17, when:()=>owned("waterwheel")},
  {id:"st-rig",     type:"drilling-rig", at:{x:3.2,z:48}, when:()=>owned("rig")},
];
function syncStructures(){
  if(!W3.gfx) return;
  STRUCT_PLAN.forEach(p=>{ const want=p.when(), has=W3.structs.has(p.id);
    if(want && !has){ const rot= p.rot!=null ? p.rot : Math.atan2(D.base.x-p.at.x, D.base.z-p.at.z); W3.gfx.addStructureVisual(p.id, p.type, p.at, rot); W3.structs.add(p.id);
      if(W3.state==="ready") W3.gfx.playVisualEffect("levelup", p.at); }
    else if(!want && has){ W3.gfx.removeStructureVisual(p.id); W3.structs.delete(p.id); } });
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
/* 開始時の景観は手つかずの自然にする。描画モジュールが独自に置く人工物（石の階段・石積みの壁＝"Stonework"）は、
   ゲームの進行と関係なく置かれ、当たり判定もないので、開始時から表示しない。
   描画モジュールが decor.stonework:false に対応したら、ここは何もしない（見つからないので）。
   建物はゲームの STRUCT_PLAN（プレイヤーが作った設備）だけから置く。 */
const PREBUILT_SCENERY = ["Stonework"];
function stripPrebuilt(gfx){
  const sc = gfx && typeof gfx.getScene==="function" ? gfx.getScene() : null; if(!sc || !sc.getObjectByName) return 0;
  let n=0;
  PREBUILT_SCENERY.forEach(name=>{ let o; while((o = sc.getObjectByName(name))){ o.parent && o.parent.remove(o);
    o.traverse && o.traverse(c=>{ if(c.geometry) c.geometry.dispose(); const m=c.material; (Array.isArray(m)?m:m?[m]:[]).forEach(mm=>{ if(mm.map) mm.map.dispose(); mm.dispose(); }); }); n++; } });
  W3.stripped = n; return n;
}
async function start3D(){
  try{
    W3.host = document.createElement("div"); W3.host.className="w3canvas";
    const slot=$("#w3slot"); if(slot) slot.appendChild(W3.host);
    const cam = cameraPreview();
    W3.cfg = cam ? HD2D.resolveConfig({camera:cam}) : HD2D.resolveConfig();
    W3.gfx = await HD2D.initializeGraphics(W3.host, { ...(cam?{config:{camera:cam}}:{}),
      playerSpriteUrl: heroUrl(), grassDetailUrl: ASSETS.grass, rockDetailUrl: ASSETS.rock,
      particleTextureUrl: ASSETS.particle, shadowTextureUrl: ASSETS.shadow,
      quality: MOBILE ? "low" : "high", postEffects: !MOBILE,
      /* 連携契約（docs/handoff/NATURAL-OBJECTS-CONTRACT.md）：木・岩・倒木・小石はゲーム側の自然物として渡すので、
         描画モジュール独自の装飾としては描かない。未対応の版では無視される */
      decor: {trees:false, rocks:false, logs:false, pebbles:false, shrubs:false, stonework:false},
      viewportInsets: hudInsets(),
      onContextLost: ()=>{ W3.lost=true; }, onContextRestored: ()=>{ W3.lost=false; } });
    W3.gfx.setWorldVisualState({timeOfDay:0.44, weather:"clear", ambientParticles:true});
    stripPrebuilt(W3.gfx);
    W3.pos = spawnPos();
    syncAll3D();
    W3.state = "ready";
    W3.gfx.setPlayerVisualState({position:W3.pos, direction:W3.dir, moving:false});
    renderField(); updateFieldActivity();
  }catch(e){ console.error(e); W3.state="failed"; W3.err="3D表示を開始できませんでした："+((e&&e.message)||e); renderField(); }
}
/* セーブの位置から始める。新しい当たり判定で木や岩に埋まっていたら、近くの立てる場所へ移す */
function spawnPos(){
  const p = (S.pos && isFinite(S.pos.x) && isFinite(S.pos.z)) ? {x:S.pos.x, z:S.pos.z} : {x:D.base.x, z:D.base.z};
  if(!world()) return p;
  const q = WORLD.safeSpawn(S, p);
  if(q.moved){ S.pos={x:+q.x.toFixed(2), z:+q.z.toFixed(2)}; save(); setTimeout(()=>banner("🧭 木や岩と重ならない場所へ移動した"), 600); }
  return {x:q.x, z:q.z};
}
function applySavedPos(){
  if(!W3.pos) return;
  W3.pos = spawnPos();
  haltField();
  if(W3.gfx) W3.gfx.setPlayerVisualState({position:W3.pos, direction:W3.dir, moving:false});
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
function fieldInputActive(){ return U.tab==="explore" && !modalOpen() && W3.state==="ready" && S.flags.view!=="2d" && !document.hidden; }
/* 押しっぱなしのキー・スティック・タップ中の指・移動予約をすべて解除する（閉じた瞬間に勝手に歩かないように） */
function haltField(){
  W3.keys={}; W3.joy=null; W3.down=null; W3.target=null; W3.path=null; W3.intent=null;
  if(W3.work) cancelWork(null);
  if(W3.joyReset) W3.joyReset();
  if(W3.walk){ W3.walk.on=false; W3.walk.slow=0; }
  if(W3.moving && W3.gfx && W3.pos){ W3.moving=false; W3.gfx.setPlayerVisualState({position:{x:W3.pos.x, z:W3.pos.z}, direction:W3.dir, moving:false}); updateLoc(); }
}
document.addEventListener("visibilitychange", ()=>{ if(document.hidden) haltField(); updateFieldActivity(); });
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
  if(typeof W3.gfx.pickGround==="function"){ try{ const g=W3.gfx.pickGround(cx-rect.left, cy-rect.top); return g ? {x:g.x, z:g.z} : null; }catch(e){} }
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
  const n=t.n, inf=depInfo(n.r.id,n.res.id), k=S.disc[n.res.id];
  return {ok:inf.ok, kind:inf.kind, reason:inf.kind==="empty"?"取り尽くした（少し待つと戻る）":inf.reason, name:k?nm(n.res.id):"何か", icon:k?ic(n.res.id):"❔", verb:"採る",
    yields:{[n.res.id]:inf.n||n.res.n}, left:inf.left, until:inf.until};
}
const tWork = t => t.o ? NATURE.KINDS[t.o.kind].work : 450;
const yieldText = (y, plain) => Object.keys(y).map(id=>(plain?"":S.disc[id]?ic(id):"❔")+nm(id)+"×"+y[id]).join("・");   // plain：読み上げ用（記号なし）

/* ---------- 毎フレームの更新（移動・地域判定・近くの資源） ---------- */
function regionAt(x,z){ let best=null, bd=1e9; D.regions.forEach(r=>{ if(!r.w) return; const d=Math.hypot(x-r.w.x,z-r.w.z); if(d<bd){bd=d;best=r;} }); return bd<=REGION_R+3?best:null; }
function loop3D(ts){
  W3.raf = requestAnimationFrame(loop3D);
  if(W3.state!=="ready" || W3.lost) return;
  /* 大きなフレーム間隔でも進む距離を保つ（すり抜けは nature.move が細かく分けて防ぐ） */
  const dt = W3.lastTs ? Math.min(0.1,(ts-W3.lastTs)/1000) : 0; W3.lastTs=ts;
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
  else if(W3.path && W3.path.length && !W3.work){ const wp=W3.path[0], dx=wp.x-W3.pos.x, dz=wp.z-W3.pos.z, d=Math.hypot(dx,dz);
    if(d<0.2){ W3.path.shift(); if(!W3.path.length) arrive(); }
    else { mx=dx/d; mz=dz/d; } }
  const len=Math.hypot(mx,mz); let got=0;
  if(len>0.01 && dt>0){
    const sp = 7*(owned("steamengine")?1.6:1)*Math.min(1,len), step = sp*dt;
    const before = {x:W3.pos.x, z:W3.pos.z};
    const res = WORLD.move(S, W3.pos, mx/len*step, mz/len*step);
    if(res.locked){ W3.path=null; W3.target=null; W3.intent=null;
      if(ts-W3.blockAt>2500){ W3.blockAt=ts; banner("🔒 "+res.locked.name+"：入るには「"+res.locked.unlock.map(nm).join("」か「")+"」が必要"); } }
    W3.pos.x=res.x; W3.pos.z=res.z;
    got = Math.hypot(res.x-before.x, res.z-before.z);
    /* クリック移動で進めなくなったら、経路を引き直す。それでも進めなければ止める */
    if(W3.path){ W3.stuck = got < step*0.2 ? (W3.stuck||0)+dt : 0;
      if(W3.stuck>0.5){ W3.stuck=0; const goal=W3.path[W3.path.length-1]; const p=(W3.repath=(W3.repath||0)+1)<=2 ? WORLD.findPath(S,W3.pos,goal) : null;
        if(p) W3.path=p; else { W3.path=null; W3.target=null; W3.intent=null; W3.repath=0; banner("🚫 ここから先へは進めない"); } } }
    if(got>0.001){ const sx = (res.x-before.x)*B.r.x + (res.z-before.z)*B.r.z, sy = -((res.x-before.x)*B.f.x + (res.z-before.z)*B.f.z);
      W3.dir = Math.abs(sx)>Math.abs(sy) ? (sx>0?"right":"left") : (sy>0?"down":"up"); }
  }
  /* 歩行状態：入力や移動予約の有無ではなく、衝突処理のあとに実際に進んだ量と経過時間で決める。
     ワープ・ロード時の補正・初期配置は W3.pos を直接書くので、ここでは数えない（歩行にならない） */
  const moving = updateWalk(dt, got, (ix||iy) || !!(W3.path && W3.path.length));
  W3.gfx.setPlayerVisualState({position:{x:W3.pos.x, z:W3.pos.z}, direction:W3.dir, moving, action: W3.work ? "gather" : undefined});
  tickWork(ts);
  // 地域の判定
  const reg = regionAt(W3.pos.x, W3.pos.z);
  if(reg!==W3.region){ W3.region=reg; if(reg){ U.region=reg.id; U.combo=0; } updateLoc(); drawRegion(); }
  // 手の届く採取対象（選んだものを優先）
  const near = findNear();
  if(!tSame(near,W3.near) || (!near && W3.near)){ const old=W3.near; W3.near=near; if(old&&old.n) syncNode(old.n); if(near&&near.n) syncNode(near.n); syncNature(); updateAction3D(); }
  // 資源の再生・表示範囲
  if(++W3.tick%20===0){ NODES.forEach(n=>syncNode(n)); syncNature(); updateAction3D(); }
  updateLabels3D();
  if(ts-W3.lastSave>2000 && (!S.pos || Math.abs(S.pos.x-W3.pos.x)>0.01 || Math.abs(S.pos.z-W3.pos.z)>0.01)){ W3.lastSave=ts; S.pos={x:+W3.pos.x.toFixed(2), z:+W3.pos.z.toFixed(2)}; save(); }
}
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
  const lk = !t && D.regions.find(r=>r.w && r.unlock && !E.regionOpen(S,r) && Math.hypot(x-r.w.x,z-r.w.z)<REGION_R);
  if(lk){ banner("🔒 "+lk.name+"：入るには「"+lk.unlock.map(nm).join("」か「")+"」が必要"); W3.intent=null; return false; }
  const dest = t ? (t.o ? WORLD.approachPoint(S,t.o,W3.pos) : WORLD.nearestFree(S,t.n.pos,undefined,4)) : WORLD.nearestFree(S,{x,z},undefined,6);
  const path = dest && WORLD.findPath(S,W3.pos,dest);
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
  if(!inf.ok){ banner((inf.kind==="tool"?"🔒 ":"")+inf.name+"："+inf.reason); return; }
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
                  : E.harvestDeposit(S, t.n.r.id, t.n.res.id, {pos:W3.pos, token:w.token, combo:U.combo});
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
  else if(!t){ const sel=W3.sel; mode="look"; html = pc ? "" : `<span class="ai">🔍</span><span>調べる</span>`;
    if(sel && W3.path){ const inf=tInfo(sel); mode="go"; html=`<span class="ai">${inf.icon}</span><span>${inf.name}へ移動中</span>`; } }
  else { const inf=tInfo(t);
    if(!inf.ok){ mode="lock"; html=`<span class="ai">${inf.kind==="tool"?"🔒":inf.kind==="empty"?"⏳":"🔒"}</span><span>${inf.name}：${inf.reason}</span>`; }
    else { mode="gather"; html=`${pc?'<span class="kbd">E</span>':""}<span class="ai">${inf.icon}</span><span>${inf.name}を${inf.verb} <small>→ ${yieldText(inf.yields)}</small></span>`; } }
  const sig=mode+"|"+html; if(b._sig===sig && !b.hidden) return; b._sig=sig;
  b.hidden=false; b.dataset.mode=mode; b.className="w3act"+(mode==="look"?" idle":mode==="gather"?"":mode==="work"||mode==="go"?" busy":" lock"); b.innerHTML=html;
  b.title = mode==="gather" ? "採取する（E キーかスペース）" : mode==="look" ? "近くを調べる" : "";
}
/* 行動ボタン・E キー */
function pressAction(){
  if(!fieldInputActive() || W3.work) return;
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
  el.style.display=""; el.style.transform=`translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
}
function updateLabels3D(){
  const box=$("#w3labels"); if(!box) return;
  NODES.forEach(n=>{
    const d=Math.hypot(n.pos.x-W3.pos.x, n.pos.z-W3.pos.z);
    if(d>17){ const el=W3.labelEls[n.key]; if(el) el.style.display="none"; return; }
    const g=E.gatherInfo(S,n.r,n.res), k=S.disc[n.res.id], inf=depInfo(n.r.id,n.res.id), isNear=W3.near&&W3.near.n===n;
    labelFor(n.key, "w3go", {n:n.key}, n.pos.x, groundY(n.pos.x,n.pos.z)+(n.type==="tree"?2.6:1.5), n.pos.z,
      `<span>${g.ok?(k?ic(n.res.id):"❔"):"🔒"}</span>${k?nm(n.res.id):"？"}${inf.left>0&&g.ok&&isFinite(inf.left)?`<i>${"●".repeat(Math.min(inf.left,8))}</i>`:""}`,
      (g.ok?"":" lock")+(g.ok&&inf.left<=0?" regrow":"")+(isNear?" near":""), (k?nm(n.res.id):"未発見の資源")+"へ行って採取する");
  });
  const want = new Set();
  [W3.sel, W3.near].forEach(t=>{ if(!t || !t.o) return; const o=t.o; want.add("o:"+o.id);
    const inf=WORLD.info(S,o), K=NATURE.KINDS[o.kind], h = o.kind==="tree" ? 3.2*o.scale : o.kind==="rock" ? 1.4*o.scale : 0.9;
    labelFor("o:"+o.id, "w3pick", {o:o.id}, o.x, groundY(o.x,o.z)+h, o.z,
      `<span>${inf.ok?inf.icon:"🔒"}</span>${inf.name}<small style="font-weight:700;margin-left:4px">${inf.ok?"→ "+yieldText(inf.yields):inf.reason}</small>`,
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
  if(!inf.ok && inf.kind==="tool"){ banner("🔒 "+inf.name+"："+inf.reason); }
  goTo3D(0,0,t); updateAction3D();
}

/* ---------- 入力：タップ・クリックで選択と移動 ---------- */
function bind3DInput(){
  const w=$("#w3"); if(!w || w._bound) return; w._bound=true;
  w.addEventListener("pointerdown", e=>{ if(!fieldInputActive() || e.target.closest(".joy,.w3lab,button")) return; W3.down={x:e.clientX,y:e.clientY,t:Date.now(),id:e.pointerId}; });
  w.addEventListener("pointercancel", ()=>{ W3.down=null; });
  w.addEventListener("pointerup", e=>{ const down=W3.down; if(!down || down.id!==e.pointerId || !fieldInputActive()) return; const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y); const quick=Date.now()-down.t<450; W3.down=null;
    if(moved>10||!quick) return;
    const t = pickAt(e.clientX, e.clientY);
    if(t){ selectAndGo(t); W3.gfx.playVisualEffect("sparkle", tPos(t)); return; }
    const hit=screenToGround(e.clientX,e.clientY); if(!hit) return;
    W3.sel=null; syncNature();
    if(goTo3D(hit.x,hit.z,null)) W3.gfx.playVisualEffect("sparkle", hit); });
}
/* HUD のスティックと行動ボタン。指ごと（pointerId）に区別するので、歩きながら採取ボタンを押せる */
function bindHudInput(){
  const joy=$("#joy"), knob=joy&&joy.querySelector(".knob");
  const act=$("#w3act");
  if(act){ let aid=null;
    act.addEventListener("pointerdown", e=>{ if(e.pointerType==="mouse") return; aid=e.pointerId; });
    act.addEventListener("pointerup", e=>{ if(e.pointerId!==aid) return; aid=null; pressAction(); });
    act.addEventListener("pointercancel", e=>{ if(e.pointerId===aid) aid=null; }); }
  if(joy){ let id=null, cx=0, cy=0; const R=42;
    W3.joyReset = ()=>{ if(id!==null){ try{ joy.releasePointerCapture(id); }catch(err){} } id=null; W3.joy=null; knob.style.transform=""; };
    joy.addEventListener("pointerdown", e=>{ if(!fieldInputActive() || id!==null) return; id=e.pointerId; try{ joy.setPointerCapture(id); }catch(err){} const r=joy.getBoundingClientRect(); cx=r.left+r.width/2; cy=r.top+r.height/2; mv(e); e.preventDefault(); });
    const mv=e=>{ if(e.pointerId!==id) return; if(!fieldInputActive()){ W3.joyReset(); return; } let dx=e.clientX-cx, dy=e.clientY-cy; const l=Math.hypot(dx,dy); if(l>R){dx*=R/l;dy*=R/l;} knob.style.transform=`translate(${dx}px,${dy}px)`; const m=Math.hypot(dx,dy)/R; W3.joy = m<0.18?null:{x:dx/R, y:dy/R}; };
    joy.addEventListener("pointermove", mv);
    const end=e=>{ if(e.pointerId!==id) return; id=null; W3.joy=null; knob.style.transform=""; };
    joy.addEventListener("pointerup", end); joy.addEventListener("pointercancel", end); joy.addEventListener("lostpointercapture", end); }
}
const TYPING = "input,textarea,select,[contenteditable],[contenteditable] *,[role=textbox]";
document.addEventListener("keydown", e=>{
  if(!fieldInputActive() || e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest(TYPING))) return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","w","a","s","d"].includes(k)){ W3.keys[k]=true; e.preventDefault(); }
  /* ボタンにフォーカスがあるときのスペースは、そのボタンを押す操作なので採取しない */
  if(k===" " && e.target.closest && e.target.closest("button,a,summary,[role=button]")) return;
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
    ${own?"":`<div class="row mt"><button class="btn small" data-act="craft" data-id="${c.id}" ${pl.ok?"":"disabled"}>🔨 作る</button>${pl.ok?"":`<span class="desc" style="margin:0">${pl.msg}</span>`}</div>`}</div>`;
}
function viewCraft(){
  const vis = D.crafts.filter(c=>S.disc[c.out] || Object.keys(c.inp).some(k=>S.disc[k]) || ["c_knife","c_thread"].includes(c.id));
  const todo = vis.filter(c=>!(IT[c.out].unique&&owned(c.out))).sort((a,b)=>(E.planCraft(S,b).ok?1:0)-(E.planCraft(S,a).ok?1:0));
  const done = vis.filter(c=>IT[c.out].unique&&owned(c.out)).filter((c,i,a)=>a.findIndex(x=>x.out===c.out)===i);
  const hidden = D.crafts.length - vis.length;
  return `<div class="sec">🔨 工作 <small>材料を組み立てて道具や設備を作る（化学変化ではない作業）</small></div>
  <div class="grid2">${todo.map(craftCard).join("")||`<p class="desc">今作れるものはないよ。</p>`}</div>
  ${hidden?`<p class="desc mt">🔒 まだ${hidden}個の設計図が隠れている。新しい材料を見つけると現れるよ。</p>`:""}
  ${done.length?`<div class="sec">✅ 持っている道具・設備</div><div class="grid2">${done.map(craftCard).join("")}</div>`:""}`;
}

/* ===================== 図鑑 ===================== */
function viewBook(){
  const prog = E.tagProgress(S), all = Object.keys(IT), total = all.length, got = all.filter(k=>S.disc[k]).length;
  const list = U.filter==="すべて"? all : all.filter(k=>IT[k].tags.includes(U.filter));
  return `<div class="sec">📖 物質・製品図鑑 <small>発見${got}／収録${total}</small></div>
  <div class="bars"><button class="bar" data-act="filter" data-id="すべて" aria-pressed="${U.filter==="すべて"}">すべて ${got}/${total}<div class="m"><i style="width:${got/total*100}%"></i></div></button>
    ${prog.map(p=>`<button class="bar" data-act="filter" data-id="${p.tag}" aria-pressed="${U.filter===p.tag}">${p.tag} ${p.got}/${p.total}<div class="m"><i style="width:${p.got/p.total*100}%"></i></div></button>`).join("")}</div>
  <p class="desc">点線の❔はヒントが見られるよ。分類は重なることがある（例：銅は「元素」と「金属・合金」の両方）。</p>
  <div class="dex">${list.map(k=>{ const st=E.status(S,k); return `<button class="dx ${st}" data-act="item" data-id="${k}"><span class="i">${st==="known"?ic(k):"❔"}</span><span class="n">${st==="known"?IT[k].name:"？？？"}</span></button>`; }).join("")}</div>
  <div class="sec">🧪 実験操作の図鑑 <small>どんな操作があるのか</small></div>
  <div class="oplist">${Object.keys(OPS).map(o=>{ const fs=Object.keys(IT).filter(f=>IT[f].facility&&IT[f].ops.includes(o)); const can=fs.some(owned);
    return `<div class="opc"><b>${OPS[o].icon} ${OPS[o].name}</b>（${OPS[o].yomi}）${can?"":' <span class="tag" style="background:var(--line);color:var(--muted)">未解放</span>'}<br>${OPS[o].kid}<br><small style="color:var(--muted)">使える装置：${fs.map(f=>S.disc[f]?nm(f):"？？？").join("・")}</small></div>`; }).join("")}</div>`;
}
function openItem(id){
  const it = IT[id], st = E.status(S,id), r = S.disc[id], sh = $("#sheet");
  if(st!=="known"){
    sh.innerHTML = `<button class="close" data-act="close">閉じる</button><div class="hd"><span class="bigi" style="filter:grayscale(1);opacity:.5">❔</span><div><h2>？？？</h2><div class="yomi">分類：${it.tags.join("・")}</div></div></div>
      <div class="kidbox">🦉 ${st==="hinted"?"ヒント：":""}${E.hint(S,id)}</div>`;
  } else {
    const pr = E.producers(id), us = E.usesOf(id);
    const fmtP = p => `${OPS[p.op].icon}${OPS[p.op].name}（${p.at.map(f=>S.disc[f]?nm(f):"？？？").join("／")}）：${Object.keys(p.inp).map(k=>S.disc[k]?nm(k):"？？？").join("＋")}`;
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
  const via = p ? `${reveal?OPS[p.op].icon+OPS[p.op].name:"？？の操作"}（${p.at.map(f=>S.disc[f]?nm(f):"？？？").join("／")}）` : "🔨工作"+(c.at?"（"+(S.disc[c.at]?nm(c.at):"？？？")+"）":"");
  const alt = pr.procs.length + pr.crafts.length > 1 ? ` ほか${pr.procs.length+pr.crafts.length-1}ルート` : "";
  const kids = Object.keys(step.inp).concat(step.tools||[]).concat(step===c&&c.at?[c.at]:[]);
  return `<li>${label}<span class="via">← ${via}${alt}</span><ul>${kids.map(i=>tree(i,depth+1,seen)).join("")}</ul></li>`;
}
function viewMap(){
  const opts = Object.keys(IT).filter(k=>E.status(S,k)!=="hidden");
  if(!U.target || !opts.includes(U.target)) U.target = opts.find(k=>!S.disc[k]) || opts[0];
  return `<div class="sec">🕸️ 技術マップ <small>技術と物質のつながり</small></div>
  <div class="legend"><span>🟩 開発済み</span><span>🟨 今作れる</span><span>⬜ 点線：手がかりあり</span><span>灰色：未開発</span></div>
  <div class="eras">${D.eras.map(e=>`<div class="era ${e.future?"future":""}"><h4>${e.name}</h4><p>${e.kid}</p>
    ${e.techs.map(t=>{ const s=techStatus(t); return `<button class="tn ${s}" data-act="target" data-id="${t}">${s!=="none"?ic(t):"❔"} ${s==="none"?"？？？":nm(t)}</button>`; }).join("")||"<p>🚧 準備中</p>"}</div>`).join("")}</div>
  <div class="sec">🎯 目標から探す <small>選んだものに必要な材料・装置をたどる</small></div>
  <div class="card"><select data-act="pick" aria-label="目標を選ぶ">${opts.map(k=>`<option value="${k}" ${k===U.target?"selected":""}>${S.disc[k]?IT[k].icon+" "+IT[k].name:"❔ ？？？（"+IT[k].tags[0]+"）"}</option>`).join("")}</select>
    ${U.target?`<p class="desc">${S.disc[U.target]?IT[U.target].kid:"🦉 "+E.hint(S,U.target)}</p><div class="tree"><ul>${tree(U.target,0,new Set())}</ul></div>
    <h5 style="margin:12px 0 4px">🔗 これを使うとできるもの</h5><div class="need">${(()=>{ const us=E.usesOf(U.target); const l=us.procs.map(p=>Object.keys(p.out)).flat().concat(us.crafts.map(c=>c.out)).filter((v,i,a)=>a.indexOf(v)===i);
      return l.length? l.map(k=>`<span class="${S.disc[k]?"ok":""}">${S.disc[k]?ic(k)+nm(k):"❔？？？"}</span>`).join("") : "<span>なし</span>"; })()}</div>`:""}
  </div>`;
}

/* ===================== 記録 ===================== */
function viewLog(){
  const tests = E.runTests(), passN = tests.filter(t=>t.pass).length;
  return `<div class="sec">📓 実験の記録 <small>新しい順（最大200件）</small></div>
  <div class="card hist">${S.hist.slice(0,30).map(h=>{ const p = h.k==="exp"? D.procs.find(x=>x.id===h.proc):null;
    return `<div class="h"><span>${p?OPS[p.op].icon:"🔨"}</span><span class="t">${Object.keys(h.inp).map(k=>nm(k)+"×"+h.inp[k]).join("＋")} → ${Object.keys(h.out).map(k=>nm(k)+"×"+h.out[k]).join("＋")}<br><small style="color:var(--muted)">${new Date(h.t).toLocaleTimeString("ja-JP")}${p?"・"+nm(h.fac):""}</small></span>
      ${p&&owned("notebook")?`<button class="btn small sub" data-act="again" data-proc="${p.id}" data-fac="${h.fac}">もう一度</button>`:""}</div>`; }).join("") || "<p class='desc'>まだ記録がないよ。</p>"}
    ${!owned("notebook")?`<p class="desc">📓 研究ノートを作ると、ここから同じ実験をすぐ繰り返せるようになるよ。</p>`:""}</div>
  <div class="sec">💾 セーブデータ <small>自動でブラウザに保存されています（スキーマv${E.SCHEMA}）</small></div>
  <div class="card"><p class="desc" style="margin-top:0">別の端末に移すときは、下の文字をコピーして、移した先で「読み込む」に貼り付けてね。クラウド同期はまだありません。</p>
    <textarea id="exportBox" readonly>${E.serialize(S).replace(/</g,"&lt;")}</textarea>
    <div class="row mt"><button class="btn small sub" data-act="copy">📋 コピー</button></div>
    <textarea id="importBox" class="mt" placeholder="ここにセーブデータを貼り付ける"></textarea>
    <div class="row mt"><button class="btn small" data-act="import">📥 読み込む</button><button class="btn small sub" data-act="reset">🗑️ 最初からやり直す</button><span class="desc" id="saveMsg"></span></div></div>
  <div class="sec">🧪 動作テスト <small>${passN}/${tests.length}合格（このタブを開くたびに実行）</small></div>
  <div class="card"><ul class="tests">${tests.map(t=>`<li>${t.pass?"✅":"❌"} ${t.name}${t.pass?"":"："+t.detail}</li>`).join("")}</ul></div>
  <div class="sec">🚧 このバージョンでできること・まだできないこと</div>
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
    case "add": if(U.busy) break; if((U.tray[id]||0) < E.cnt(S,id)){ U.tray[id]=(U.tray[id]||0)+1; U.last=null; } drawLabCtl(); drawScene(); break;
    case "sub": if(U.busy) break; U.tray[id]--; if(U.tray[id]<=0) delete U.tray[id]; drawLabCtl(); drawScene(); break;
    case "fac": if(U.busy) break; U.fac = U.fac===id?null:id; U.op=null; drawLabCtl(); drawScene(); break;
    case "op": if(U.busy) break; U.op = U.op===id?null:id; drawLabCtl(); drawScene(); break;
    case "run": runLab(); break;
    case "hint": { const h=E.suggest(S); U.last=`<div class="note"><h4>🦉 ホウ博士のヒント</h4><p style="margin:0">${h.text}</p></div>`; drawLabCtl(); break; }
    case "again": { if(U.busy) break; const p=D.procs.find(x=>x.id===b.dataset.proc); U.tray=Object.assign({},p.inp); U.fac=b.dataset.fac; U.op=p.op; U.last=null;
      if(U.tab!=="lab") setTab("lab", b); else renderPanel(); runLab(); break; }
    case "go": travel(id); break;
    case "g3": if(!ev.pointerType || ev.pointerType==="mouse") pressAction(); break;  /* 指・ペンは pointerup で処理済み */
    case "w3pick": { if(!fieldInputActive()) break; const o=WORLD&&WORLD.byId.get(b.dataset.o); if(o){ if(W3.near&&W3.near.o===o) pressAction(); else selectAndGo({o}); } break; }
    case "w3go": { if(!fieldInputActive()) break; const n=NODES&&NODES.find(x=>x.key===b.dataset.n); if(n){ if(W3.near&&W3.near.n===n) pressAction(); else selectAndGo({n}); } break; }
    case "travel": { const r=D.regions.find(x=>x.id===id); if(!E.regionOpen(S,r)) break; /* 理由はボタンに表示済み */
      setTab("explore"); if(W3.state==="ready"){ goTo3D(r.w.x,r.w.z+REGION_R*0.2,null); banner(r.icon+" "+r.name+"へ向かう"); } break; }
    case "home": setTab("explore"); if(W3.state==="ready"){ goTo3D(D.base.x,D.base.z,null); banner("🏠 拠点へ戻る"); } break;
    case "hero": { S.flags.hero = S.flags.hero==="girl"?"boy":"girl"; save(); if(W3.gfx) W3.gfx.setPlayerSpriteSheet(heroUrl()); banner(S.flags.hero==="girl"?"👧 女の子に交代！":"👦 男の子に交代！"); break; }
    case "pickhero": S.flags.hero=id; save(); if(W3.gfx) W3.gfx.setPlayerSpriteSheet(heroUrl()); document.querySelectorAll(".heropick").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===id)); const av=$("#avatar"); if(av) av.style.backgroundImage=`url(${heroUrl()})`; break;
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
    case "import": { try{ const n=E.deserialize($("#importBox").value.trim()); S=n; lastMission=E.missionIndex(S); lastStage=stage(); U.tray={}; U.fac=null; U.op=null; fieldSig=""; applySavedPos(); save(); renderChrome(); render(); $("#saveMsg").textContent="読み込んだよ"; }catch(e){ $("#saveMsg").textContent="読み込めなかった：形式が違うみたい"; } break; }
    case "reset": if(confirm("本当に最初からやり直す？（発見の記録も消えます）")){ S=E.newState(); lastMission=0; lastStage=0; U.tray={}; U.fac=null; U.op=null; U.last=null; U.region="forest"; fieldSig=""; applySavedPos(); save(); setTab("explore"); renderChrome(); render(); intro(); } break;
  }
});
document.addEventListener("change", ev=>{ if(ev.target.dataset.act==="pick"){ U.target=ev.target.value; renderPanel(); } });
document.addEventListener("keydown", ev=>{
  if(ev.key!=="Escape") return;
  if(modalOpen()){ ev.preventDefault(); closeModal(); }
  else if(U.tab!=="explore"){ ev.preventDefault(); setTab("explore"); }
});
let modalOpener = null;
function openModal(focusEl){
  if(!modalOpen()) modalOpener = document.activeElement;
  haltField();
  $("#modal").classList.add("open"); $("#app").inert = true;
  const f = focusEl || $("#sheet").querySelector("button"); if(f) f.focus({preventScroll:true});
}
function closeModal(){
  if(!modalOpen()) return;
  $("#modal").classList.remove("open"); $("#app").inert = false;
  const o = modalOpener; modalOpener = null;
  if(o && o.isConnected && !o.closest("[inert],[hidden]")) o.focus({preventScroll:true});
  else if(U.tab!=="explore"){ const h=$("#dockTitle"); if(h) h.focus({preventScroll:true}); }
}

/* 自動採取 */
setInterval(()=>{ if(document.hidden || !S.auto.length) return; const got=E.autoTick(S); if(got.length){ afterChange(got.flatMap(g=>g.news)); if(U.tab==="lab" && !U.busy) drawLabCtl(); drawRegion(); } }, 10000);

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
window.__GAME__ = {get S(){return S;}, E, D, U, W3, get NODES(){return NODES;}, get WORLD(){return world();}, goTo3D:(x,z,t)=>goTo3D(x,z,t), pressAction:()=>pressAction(), selectAndGo:t=>selectAndGo(t), screenToGround:(x,y)=>screenToGround(x,y), toScreen:(x,y,z)=>toScreen(x,y,z), render:()=>{ fieldSig=""; sceneSig=""; lastStage=stage(); lastMission=E.missionIndex(S); renderChrome(); render(); }};
})(DATA, ENGINE);
