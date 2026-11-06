/* ===================== 画面（UI） ===================== */
(function(D,E){
const IT=D.items, OPS=D.ops;
const SAVE_KEY="zero-kagaku-save";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
let S = load();
const U = {tab:"lab", tray:{}, fac:null, op:null, busy:false, filter:"すべて", target:null, last:null,
           region:"forest", nodes:{}, combo:0, lastGather:0, walking:false};
const $ = s=>document.querySelector(s);
const nm = id=>IT[id]?IT[id].name:id;
const ic = id=>IT[id]?IT[id].icon:"❔";
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
  else { const it=IT[id]; el.innerHTML=`<div class="i">${it.icon}</div><div><div class="k">${it.tags.includes("珍しい発見")?"珍しい発見！":"新発見！"} 図鑑に登録したよ</div><div class="nm">${it.name}</div><p>${it.kid}</p></div>`; el.onclick=()=>{ openItem(id); el.remove(); }; }
  box.prepend(el); while(box.children.length>3) box.lastChild.remove();
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
function renderChrome(){
  const st = stage();
  $("#stageChip").innerHTML = `🏛️ <b>${D.stages[st].era}</b>`;
  $("#discChip").innerHTML = `📖 <b>${Object.keys(S.disc).filter(k=>IT[k]).length}</b>/${Object.keys(IT).length}`;
  document.querySelectorAll("#nav button").forEach(b=>b.setAttribute("aria-current", b.dataset.tab===U.tab?"page":"false"));
  const i = E.missionIndex(S), m = D.missions[i];
  $("#mission").innerHTML = `<div class="mission"><div class="owl" aria-hidden="true">🦉</div><div style="flex:1;min-width:0">
    <div class="lab">ホウ博士の次の目標（${i+1}/${D.missions.length}）</div>
    <div class="t">${m.t}</div><div class="how">${m.how}</div>
    ${U.tab!==m.tab?`<div class="go"><button class="btn small sub" data-act="tab" data-tab="${m.tab}">そこへ行く</button></div>`:""}
  </div></div>`;
}
function setTab(t){ if(U.tab==="explore" && t!=="explore") pause3D(); U.tab=t; renderChrome(); render(); window.scrollTo({top:0,behavior:RM?"auto":"smooth"}); }
function render(){
  const v = $("#view");
  if(U.tab==="lab") renderLab(v);
  else if(U.tab==="explore") renderExplore(v);
  else if(U.tab==="craft") v.innerHTML = viewCraft();
  else if(U.tab==="book") v.innerHTML = viewBook();
  else if(U.tab==="map") v.innerHTML = viewMap();
  else if(U.tab==="log") v.innerHTML = viewLog();
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
  if(!v.querySelector(".labgrid")){ v.innerHTML = `<div class="labgrid"><div class="stagebox" id="stagebox"></div><div id="labctl"></div></div>`; sceneSig=""; }
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
function drawScene(){
  const st = stage();
  const hideOld = st>=5?["campfire","rack","charkiln","filter","fermenter","kiln","mill"]:st>=4?["rack","charkiln","campfire"]:[];
  const facs = LAB_FAC.filter(f=>owned(f)&&!hideOld.includes(f));
  const plan = U.fac ? E.planExperiment(S,U.tray,U.fac,U.op) : null;
  const shape = vesselFor(U.fac, U.op, plan&&plan.ok?plan.proc:null);
  const sig = st+"|"+facs.join(",")+"|"+owned("bench")+"|"+shape+"|"+(S.disc.bulb?1:0)+(S.disc.solarcell?1:0);
  if(sig===sceneSig || U.busy) return;
  sceneSig = sig;
  const baseY = 214;
  const labImg = ASSETS["lab"+(st<=2?1:st-1)];
  const box=$("#stagebox"); box.style.backgroundImage=`url(${labImg})`;
  box.innerHTML = `<svg class="scene" id="scene" viewBox="0 0 400 225" role="img" aria-label="研究の場所：${D.stages[st].name}">
  <defs><radialGradient id="glowG"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".95"/><stop offset=".6" stop-color="#ff8a2a" stop-opacity=".35"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
    <radialGradient id="spotG" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".7" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  ${shape?`<ellipse cx="200" cy="${baseY-40}" rx="78" ry="62" fill="url(#spotG)"/><ellipse cx="200" cy="${baseY+2}" rx="54" ry="7" fill="rgba(0,0,0,.35)"/>`:""}
  ${!facs.length&&!owned("bench")?`<rect x="70" y="96" width="260" height="30" rx="10" fill="rgba(255,255,255,.85)"/><text x="200" y="116" text-anchor="middle" font-size="13" font-weight="700" fill="#22305a">まだ何もない。探検と工作から始めよう！</text>`:""}
  <g id="vessel" transform="translate(200,${baseY})">
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
  const box = $("#labctl");
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
    <div class="shelf">${mats.length? mats.map(id=>{ const left=S.inv[id]-(U.tray[id]||0); return `<button class="mat" data-act="add" data-id="${id}" ${left<=0||U.busy?"disabled":""}><span class="i">${ic(id)}</span>${nm(id)} <span class="q">${left}</span></button>`; }).join("") : `<span class="desc">材料がない。「探検」で集めよう。</span>`}</div>
  </div>
  <div class="panel mt">
    <h3><span class="n">2</span>装置を選ぶ</h3>
    <div class="opts">${facs.length? facs.map(f=>`<button class="opt" data-act="fac" data-id="${f}" aria-pressed="${U.fac===f}">${ic(f)} ${nm(f)}</button>`).join("") : `<span class="desc">まだ装置がない。「工作」で作業台やたき火を作ろう。</span>`}</div>
    ${U.fac?`<p class="desc">${IT[U.fac].kid}</p>`:""}
    <h3 class="mt"><span class="n">3</span>操作を選ぶ</h3>
    <div class="opts">${U.fac? IT[U.fac].ops.map(o=>`<button class="opt" data-act="op" data-id="${o}" aria-pressed="${U.op===o}">${OPS[o].icon} ${OPS[o].name}</button>`).join("") : `<span class="desc">先に装置を選んでね。</span>`}</div>
    <p class="desc">${op?`<b>${op.name}（${op.yomi}）</b>：${op.kid}`:""}</p>
    <div class="row mt"><button class="btn big" data-act="run" ${canRun?"":"disabled"}>🧪 実験スタート</button><button class="btn sub" data-act="hint">💡 ヒント</button></div>
  </div>
  <div id="labResult" aria-live="polite">${U.last||""}</div>`;
}
function runLab(){
  if(U.busy) return;
  const token = S.seq;
  const plan = E.planExperiment(S, U.tray, U.fac, U.op);
  if(!plan.ok){ U.last = `<div class="note bad"><h4>🦉 うーん…</h4><p style="margin:0">${plan.msg}</p></div>`; animate(null); drawLabCtl(); return; }
  U.busy = true; $("#toasts").innerHTML="";
  const tray = U.tray, fac = U.fac, op = U.op;
  U.last = `<div class="note"><h4>🔬 観察中…</h4><p style="margin:0">よく見ていてね。</p></div>`;
  drawLabCtl();
  const sb=$("#stagebox"); if(sb && innerWidth<900){ const r=sb.getBoundingClientRect(); if(r.top<60 || r.bottom>innerHeight) window.scrollTo({top:Math.max(0,r.top+scrollY-64),behavior:RM?"auto":"smooth"}); }
  animate(plan.proc, ()=>{
    const res = E.runExperiment(S, tray, fac, op, token);
    U.busy=false;
    if(!res.ok){ U.last=`<div class="note bad"><h4>🦉 あれ？</h4><p style="margin:0">${res.msg}</p></div>`; drawLabCtl(); return; }
    U.tray = {}; U.last = resultNote(res);
    afterChange(res.news);
    sceneSig=""; drawScene(); drawLabCtl();
    const sc=$("#scene"); if(sc && res.news.length){ sc.classList.add("f-sparkle"); setTimeout(()=>sc&&sc.classList.remove("f-sparkle"),1400); }
    const r=$("#labResult"); if(r) r.scrollIntoView({block:"nearest",behavior:RM?"auto":"smooth"});
  });
}
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
    ${outs.map(k=>{ const it=IT[k]; return `<div class="prod"><span class="i">${it.icon}</span><p><b>${it.name}</b>${res.news.includes(k)?'<span class="tag">NEW</span>':""}${it.f?` <small style="color:var(--muted)">${it.f}</small>`:""}<br>${it.kid}
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
    case "mine": return sky+`<path d="M0 120 Q60 50 140 80 T320 70 V180 H0Z" fill="#8a6a4a"/><path d="M130 130 V96 Q150 80 170 96 V130Z" fill="#2a1e16"/><path d="M128 132 V94 H172 V132" fill="none" stroke="#7a5636" stroke-width="5"/>`+ground("#7a5a3e")+
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
const nodeKey=(r,id)=>r+":"+id;
function nodeCap(rid){ return 5 + E.exploreLv(S,rid); }
function regrowMs(rid){ return Math.max(3000, 6000 - E.exploreLv(S,rid)*1000); }
function nodeState(rid,id){ const k=nodeKey(rid,id); let n=U.nodes[k]; if(!n){ n=U.nodes[k]={left:nodeCap(rid), until:0}; } if(n.until && Date.now()>=n.until){ n.left=nodeCap(rid); n.until=0; } return n; }
function renderExplore(v){
  if(S.flags.view!=="2d"){ ensure3D(); if(W3.state!=="failed"){ renderExplore3D(v); return; } }
  renderExplore2D(v);
}
function renderExplore2D(v){
  const st = stage();
  let r = D.regions.find(x=>x.id===U.region) || D.regions[0];
  if(!E.regionOpen(S,r)){ U.region="forest"; r=D.regions[0]; }
  const sig = st+"|"+D.regions.map(x=>E.regionOpen(S,x)?1:0).join("")+"|"+owned("rig")+owned("waterwheel")+owned("steamengine")+(S.disc.solarcell?1:0);
  if(!v.querySelector(".field") || v.querySelector(".w3") || sig!==fieldSig){
    fieldSig = sig;
    v.innerHTML = `<div class="sec">🗺️ フィールド <small>${D.stages[st].era}・${D.stages[st].name}（次の進化：${D.stages[st].need}）</small></div>
    ${W3.state==="failed"?`<div class="note bad" style="margin:0 0 8px"><h4>3D表示が使えないため、2Dの地図で表示しています</h4><p style="margin:0;font-size:.85rem">${W3.err}</p></div>`:`<div class="row" style="margin-bottom:8px"><button class="btn small sub" data-act="view3d">🌄 3Dフィールドで遊ぶ</button></div>`}
    <div class="field" id="field">${fieldSVG(st)}
      ${D.regions.map(x=>{ const open=E.regionOpen(S,x); return `<button class="pin ${open?"":"lock"} ${x.id===U.region?"here":""}" style="left:${x.x}%;top:${x.y}%" data-act="go" data-id="${x.id}" aria-label="${x.name}${open?"":"（未開放）"}"><span class="pi">${open?x.icon:"🔒"}</span><span class="pn">${x.name}</span></button>`; }).join("")}
      <div class="avatar hero" id="avatar" style="left:${r.x}%;top:${r.y}%;background-image:url(${heroUrl()})" aria-hidden="true"></div>
    </div>
    <div id="regionBox"></div>`;
  }
  drawRegion();
}
function in3D(){ return U.tab==="explore" && S.flags.view!=="2d" && W3.state!=="failed"; }
function drawRegion(){
  const r = D.regions.find(x=>x.id===U.region); const st=stage(); const box=$("#regionBox"); if(!box) return;
  const lv = E.exploreLv(S,r.id), nx = E.nextLv(S,r.id), slots=E.autoSlots(S), base=E.LV[lv]||0;
  const lvText = ["珍しい発見が出やすくなった","採取量＋1・珍しい発見を1つ見つけた","珍しい発見がさらに出やすくなった"];
  box.innerHTML = `<div class="regioncard">
    <div class="rhead"><span class="ri">${r.icon}</span><div style="flex:1;min-width:0"><h3>${r.name}${in3D()&&W3.region!==r?' <small style="font-weight:700;color:var(--muted);font-size:.75rem">（最後にいた地域）</small>':""}</h3><div class="kid">${r.kid}</div></div>
      <div class="lv"><b>探索Lv${lv}</b><div class="m"><i style="width:${nx?Math.min(100,(nx.now-base)/(nx.need-base)*100):100}%"></i></div><small>${nx?nx.now+"/"+nx.need:"最大"}</small></div></div>
    <p class="desc" style="margin:0 0 6px">${lv?"⭐ "+lvText.slice(0,lv).join("／"):"たくさん採取すると探索Lvが上がり、ごほうびがあるよ。"}</p>
    ${in3D()?"":`<div class="rscene" id="rscene">
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="rsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky1)"/><stop offset="1" style="stop-color:var(--sky2)"/></linearGradient></defs>${regionArt(r,st)}</svg>
      ${r.res.map(x=>nodeHTML(r,x)).join("")}
      <div class="combo" id="combo"></div><div class="banner" id="banner"></div>
    </div>
    <p class="desc">光っている資源をタップして採取。たまに「会心」で2倍、続けてタップすると「コンボ」でおまけが付く。取り尽くしても、少し待てばまた生えてくる。</p>`}
    <div class="reslist">${r.res.map(x=>{ const g=E.gatherInfo(S,r,x), k=S.disc[x.id], au=S.auto.some(a=>a.r===r.id&&a.id===x.id);
      return `<div class="res"><span class="i">${k?ic(x.id):"❔"}</span><span class="nm">${k?nm(x.id):"何かありそう…"} ${k?`<small>${IT[x.id].kid}</small>`:""}${!g.ok?`<small style="color:var(--clay)">🔒 ${g.reason}</small>`:`<small>1回で${g.n}個・所持${E.cnt(S,x.id)}個</small>`}</span>
      ${k&&slots&&g.ok?`<button class="auto" data-act="auto" data-r="${r.id}" data-id="${x.id}" aria-pressed="${au}">🧺 自動</button>`:""}</div>`; }).join("")}
    ${(r.rare||[]).length?`<div class="res"><span class="i">✨</span><span class="nm">珍しい発見 <small>${r.rare.map(x=>S.disc[x.id]?ic(x.id)+nm(x.id):"❔？？？").join("・")}</small></span></div>`:""}
    ${slots?`<p class="desc">🧺 自動採取：${S.auto.length}/${slots}枠（ページを開いている間、10秒ごとに集める）</p>`:""}
    </div></div>`;
}
function nodeHTML(r,x){
  const g = E.gatherInfo(S,r,x), k=S.disc[x.id], n=nodeState(r.id,x.id), regrow = n.left<=0;
  const pct = regrow ? Math.max(0,Math.min(100,100-(n.until-Date.now())/regrowMs(r.id)*100)) : 100;
  return `<button class="node ${g.ok?"":"nlock"} ${regrow?"regrow":""}" id="n-${x.id}" style="left:${x.p[0]}%;top:${x.p[1]}%;--p:${pct}" data-act="gather" data-r="${r.id}" data-id="${x.id}" aria-label="${k?nm(x.id):"未発見の資源"}">
    <span class="ni">${g.ok?(k?ic(x.id):"❔"):"🔒"}</span><span class="nl">${k?nm(x.id):"？"}</span><span class="pips">${regrow?"":"●".repeat(n.left)}</span></button>`;
}
function floatText(el, text, cls){
  const sc=$("#rscene"); if(!sc||!el) return;
  const f=document.createElement("span"); f.className="float "+(cls||""); f.textContent=text;
  f.style.left=el.style.left; f.style.top=el.style.top; sc.appendChild(f); setTimeout(()=>f.remove(), RM?600:1100);
}
function banner(text){ const b=$("#banner"); if(!b) return; b.textContent=text; b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); }
const TOOLFX = {forest:"🪓",mountain:"⛏️",mine:"⛏️",cave:"⛏️",volcano:"⛏️",river:"✋",coast:"✋",grassland:"✋",oilfield:"🛢️"};
function doGather(rid, id){
  const r = D.regions.find(x=>x.id===rid), res=r.res.find(x=>x.id===id), el=$("#n-"+id);
  const g = E.gatherInfo(S,r,res);
  if(!g.ok){ floatText(el, g.reason, "ng"); return; }
  const n = nodeState(rid,id); if(n.left<=0){ floatText(el,"もうすぐ生えてくる…","ng"); return; }
  const now=Date.now(); U.combo = (now-U.lastGather<1600) ? U.combo+1 : 1; U.lastGather=now;
  const lvBefore = E.exploreLv(S,rid);
  const out = E.gather(S,rid,id,{combo:U.combo});
  if(!out.ok){ floatText(el,out.reason,"ng"); return; }
  n.left--; if(n.left<=0) n.until=now+regrowMs(rid);
  const sc=$("#rscene");
  const sw=document.createElement("span"); sw.className="swing"; sw.textContent=owned("steamengine")&&["mine","mountain"].includes(rid)?"⚙️":TOOLFX[rid]||"✋";
  if(el&&sc){ sw.style.left=el.style.left; sw.style.top=el.style.top; sc.appendChild(sw); setTimeout(()=>sw.remove(),500); }
  floatText(el, (out.crit?"会心！ ":"")+ic(id)+"＋"+out.n, out.crit?"crit":"");
  const cb=$("#combo"); if(cb){ cb.textContent = U.combo>=2 ? "コンボ×"+U.combo+(U.combo%5===0?"　おまけ＋1！":"") : ""; cb.classList.toggle("on",U.combo>=2); }
  afterChange(out.news);
  if(E.exploreLv(S,rid)!==lvBefore || out.news.length){ drawRegion(); }
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
  if(U.walking || rid===U.region) return;
  U.walking=true; U.region=rid; U.combo=0;
  document.querySelectorAll(".pin").forEach(p=>p.classList.toggle("here",p.dataset.id===rid));
  const av=$("#avatar"); if(av){ av.style.left=r.x+"%"; av.style.top=r.y+"%"; av.classList.add("walk"); }
  setTimeout(()=>{ U.walking=false; av&&av.classList.remove("walk"); drawRegion(); const rb=$("#regionBox"); if(rb&&innerWidth<900) rb.scrollIntoView({block:"start",behavior:RM?"auto":"smooth"}); }, RM?50:(owned("steamengine")?350:700));
}
setInterval(()=>{ if(U.tab!=="explore") return; const r=D.regions.find(x=>x.id===U.region); if(!r) return;
  r.res.forEach(x=>{ const n=U.nodes[nodeKey(r.id,x.id)]; if(n && n.left<=0){ const el=$("#n-"+x.id); if(Date.now()>=n.until){ n.left=nodeCap(r.id); n.until=0; if(el) el.outerHTML=nodeHTML(r,x); } else if(el){ el.style.setProperty("--p", Math.max(0,100-(n.until-Date.now())/regrowMs(r.id)*100)); } } });
}, 400);

/* ===================== 3Dフィールド（HD-2D描画モジュールとの連携） =====================
   座標・移動・採取・建築の判定はすべてこちら（ゲーム側）が正本。
   描画モジュールには setPlayerVisualState / updateResourceVisual / addStructureVisual などで
   結果だけを渡す。座標系：ゲーム座標＝シーン座標（右手系・Y上・1単位＝1マス）。 */
const W3 = { state:"idle", err:"", gfx:null, host:null, cfg:null, pos:null, dir:"down", moving:false,
  target:null, autoGather:null, keys:{}, joy:null, near:null, region:null, lastTs:0, raf:0,
  structs:new Set(), visSig:{}, lastSave:0, blockAt:-1e9, tick:0, labelEls:{} };
const WORLD_R = 56,  /* 地形は120×120の正方形。端の丘の手前で止める */ REGION_R = 9, NEAR_R = 2.6;
const MOBILE = matchMedia("(pointer:coarse)").matches || innerWidth < 900;
const RES_VIS = {twig:"tree",log:"tree",resin:"tree",wax:"tree",bark:"tree",seed:"tree",
  leaves:"herb",vine:"herb",grass:"herb",seaweed:"herb",grape:"flowers",clay:"clay",ochre:"clay",sand:"clay",
  rain:"water",river:"water",spring:"water",seawater:"water",crude:"oil"};
const PLANT = ["tree","herb","flowers"];
const heroUrl = ()=> S.flags.hero==="girl" ? ASSETS.girl : ASSETS.boy;
let NODES = null;
function buildNodes(){
  NODES = [];
  D.regions.forEach(r=>{ if(!r.w) return;
    r.res.forEach((res,i)=>{
      const x = r.w.x + (res.p[0]-50)/50*6.5, z = r.w.z + (res.p[1]-62)/38*5;
      NODES.push({key:r.id+":"+res.id, vid:"res-"+r.id+"-"+res.id, r, res, pos:{x,z},
        type:RES_VIS[res.id]||"rock", rot:(i*1.7)%6.28, scale: RES_VIS[res.id]==="tree"?1.1:1});
    }); });
}
function nodeVisual(n){
  const ns = nodeState(n.r.id, n.res.id);
  return {position:n.pos, type:n.type, rotationY:n.rot, scale:n.scale, depleted: ns.left<=0, highlighted: W3.near===n, visible:true};
}
function syncNode(n, force){
  if(!W3.gfx) return;
  const v = nodeVisual(n), sig = v.depleted+"|"+v.highlighted;
  if(!force && W3.visSig[n.vid]===sig) return;
  W3.visSig[n.vid]=sig; W3.gfx.updateResourceVisual(n.vid, v);
}
/* 文明の段階に合わせて拠点の建物が増えていく（フィールドの進化） */
const STRUCT_PLAN = [
  {id:"st-bench",   type:"workbench",  at:{x:-17,z:23}, when:()=>owned("bench")},
  {id:"st-fire",    type:"campfire",   at:{x:-21.5,z:25.5}, when:()=>owned("campfire")},
  {id:"st-kiln",    type:"kiln",       at:{x:-25.5,z:19.5}, when:()=>owned("kiln")},
  {id:"st-hut1",    type:"hut",        at:{x:-27,z:12}, when:()=>stage()>=2},
  {id:"st-hut2",    type:"hut",        at:{x:-12.5,z:27.5}, when:()=>stage()>=2 && owned("storehouse")},
  {id:"st-smelter", type:"smelter",    at:{x:-13.5,z:15}, when:()=>owned("furnace")||owned("blastfurnace")},
  {id:"st-lab",     type:"laboratory", at:{x:-21,z:9}, when:()=>stage()>=3},
  {id:"st-stone",   type:"stone-house",at:{x:-31,z:21}, when:()=>stage()>=3},
  {id:"st-factory", type:"factory",    at:{x:-10,z:30}, when:()=>stage()>=4},
  {id:"st-power",   type:"power-plant",at:{x:-7,z:13}, when:()=>owned("generator")},
  {id:"st-inst",    type:"research-institute", at:{x:-30,z:31}, when:()=>stage()>=5},
];
function syncStructures(){
  if(!W3.gfx) return;
  STRUCT_PLAN.forEach(p=>{ const want=p.when(), has=W3.structs.has(p.id);
    if(want && !has){ const rot=Math.atan2(D.base.x-p.at.x, D.base.z-p.at.z); W3.gfx.addStructureVisual(p.id, p.type, p.at, rot); W3.structs.add(p.id);
      if(W3.state==="ready") W3.gfx.playVisualEffect("levelup", p.at); }
    else if(!want && has){ W3.gfx.removeStructureVisual(p.id); W3.structs.delete(p.id); } });
}
function syncAll3D(){ if(!NODES) buildNodes(); NODES.forEach(n=>syncNode(n,true)); syncStructures(); }

(function(){ const m=document.getElementById("gfxmod"); if(m) m.addEventListener("error", ()=>{ W3.modErr=true; if(W3.state==="loading" && !window.HD2D){ W3.state="failed"; W3.err="3D描画モジュール（Three.js）を読み込めませんでした。通信環境かブラウザの制限が原因かもしれません。"; if(U.tab==="explore") render(); } }); })();
function ensure3D(){
  if(W3.state!=="idle") return;
  W3.state="loading";
  const go=()=>{ if(W3.state==="loading") start3D(); };
  if(window.HD2D) go();
  else if(W3.modErr){ W3.state="failed"; W3.err="3D描画モジュール（Three.js）を読み込めませんでした。通信環境かブラウザの制限が原因かもしれません。"; }
  else { window.addEventListener("hd2d-ready", go, {once:true});
    setTimeout(()=>{ if(W3.state==="loading" && !window.HD2D){ W3.state="failed"; W3.err="3D描画モジュール（Three.js）を読み込めませんでした。通信環境かブラウザの制限が原因かもしれません。"; if(U.tab==="explore") render(); } }, 15000); }
}
async function start3D(){
  try{
    W3.host = document.createElement("div"); W3.host.className="w3canvas";
    const slot=$("#w3slot"); if(slot) slot.appendChild(W3.host);
    W3.cfg = HD2D.resolveConfig();
    W3.gfx = await HD2D.initializeGraphics(W3.host, {
      playerSpriteUrl: heroUrl(), grassDetailUrl: ASSETS.grass, rockDetailUrl: ASSETS.rock,
      particleTextureUrl: ASSETS.particle, shadowTextureUrl: ASSETS.shadow,
      quality: MOBILE ? "low" : "high", postEffects: !MOBILE,
      onContextLost: ()=>{ W3.lost=true; }, onContextRestored: ()=>{ W3.lost=false; } });
    W3.gfx.setWorldVisualState({timeOfDay:0.44, weather:"clear", ambientParticles:true});
    W3.pos = (S.pos && isFinite(S.pos.x) && isFinite(S.pos.z)) ? {x:S.pos.x, z:S.pos.z} : {x:D.base.x, z:D.base.z};
    syncAll3D();
    W3.state = "ready";
    W3.gfx.setPlayerVisualState({position:W3.pos, direction:W3.dir, moving:false});
    if(U.tab==="explore") render(); else pause3D();
  }catch(e){ console.error(e); W3.state="failed"; W3.err="3D表示を開始できませんでした："+((e&&e.message)||e); if(U.tab==="explore") render(); }
}
function pause3D(){ if(W3.raf) cancelAnimationFrame(W3.raf); W3.raf=0; W3.joy=null; W3.keys={};
  try{ if(W3.gfx && typeof W3.gfx.stopLoop==="function") W3.gfx.stopLoop(); }catch(e){} }
function resume3D(){ if(W3.state!=="ready") return;
  try{ if(typeof W3.gfx.startLoop==="function") W3.gfx.startLoop(); }catch(e){}
  if(!W3.raf){ W3.lastTs=0; W3.raf=requestAnimationFrame(loop3D); } }

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
function screenToGround(cx, cy){
  const T=HD2D.THREE, cam=W3.gfx.getCamera(), rect=$("#w3").getBoundingClientRect();
  const ndc=new T.Vector2((cx-rect.left)/rect.width*2-1, -((cy-rect.top)/rect.height)*2+1);
  const rc=new T.Raycaster(); rc.setFromCamera(ndc, cam);
  const o=rc.ray.origin, d=rc.ray.direction; let lo=0, prev=o.y-groundY(o.x,o.z);
  for(let t=0.5; t<600; t+=0.5){
    const x=o.x+d.x*t, y=o.y+d.y*t, z=o.z+d.z*t, diff=y-groundY(x,z);
    if(diff<=0 && prev>0){ let a=lo, b=t; for(let i=0;i<20;i++){ const m=(a+b)/2; const mx=o.x+d.x*m, my=o.y+d.y*m, mz=o.z+d.z*m; if(my-groundY(mx,mz)>0) a=m; else b=m; }
      return {x:o.x+d.x*b, z:o.z+d.z*b}; }
    prev=diff; lo=t; }
  return null;
}

/* ---------- 毎フレームの更新（移動・地域判定・近くの資源） ---------- */
function regionAt(x,z){ let best=null, bd=1e9; D.regions.forEach(r=>{ if(!r.w) return; const d=Math.hypot(x-r.w.x,z-r.w.z); if(d<bd){bd=d;best=r;} }); return bd<=REGION_R+3?best:null; }
function loop3D(ts){
  W3.raf = requestAnimationFrame(loop3D);
  if(W3.state!=="ready" || W3.lost) return;
  const dt = W3.lastTs ? Math.min(0.05,(ts-W3.lastTs)/1000) : 0; W3.lastTs=ts;
  let ix=0, iy=0;
  const k=W3.keys; if(k.ArrowLeft||k.a) ix-=1; if(k.ArrowRight||k.d) ix+=1; if(k.ArrowUp||k.w) iy-=1; if(k.ArrowDown||k.s) iy+=1;
  if(W3.joy){ ix=W3.joy.x; iy=W3.joy.y; }
  const B = camBasis(); let mx=0, mz=0;
  if(ix||iy){ W3.target=null; W3.autoGather=null; const l=Math.hypot(ix,iy); if(l>1){ix/=l; iy/=l;}
    mx = B.r.x*ix - B.f.x*iy; mz = B.r.z*ix - B.f.z*iy; }
  else if(W3.target){ const dx=W3.target.x-W3.pos.x, dz=W3.target.z-W3.pos.z, d=Math.hypot(dx,dz);
    const stop = W3.autoGather ? NEAR_R*0.6 : 0.3;
    if(d<=stop){ W3.target=null; if(W3.autoGather){ const n=W3.autoGather; W3.autoGather=null; W3.near=n; gather3D(n); } }
    else { mx=dx/d; mz=dz/d; } }
  const len=Math.hypot(mx,mz); let moving = len>0.01;
  if(moving && dt>0){
    const sp = 7*(owned("steamengine")?1.6:1)*Math.min(1,len);
    let px=W3.pos.x+mx/len*sp*dt, pz=W3.pos.z+mz/len*sp*dt;
    px=Math.max(-WORLD_R,Math.min(WORLD_R,px)); pz=Math.max(-WORLD_R,Math.min(WORLD_R,pz));
    const lk = D.regions.find(r=>r.w && !E.regionOpen(S,r) && Math.hypot(px-r.w.x,pz-r.w.z)<REGION_R);
    if(lk){ moving=false; W3.target=null; W3.autoGather=null;
      if(ts-W3.blockAt>2500){ W3.blockAt=ts; banner("🔒 "+lk.name+"：入るには「"+lk.unlock.map(nm).join("」か「")+"」が必要"); } }
    else { W3.pos.x=px; W3.pos.z=pz;
      const sx = mx*B.r.x + mz*B.r.z, sy = -(mx*B.f.x + mz*B.f.z);
      W3.dir = Math.abs(sx)>Math.abs(sy) ? (sx>0?"right":"left") : (sy>0?"down":"up"); }
  }
  W3.moving = moving;
  W3.gfx.setPlayerVisualState({position:{x:W3.pos.x, z:W3.pos.z}, direction:W3.dir, moving});
  // 地域の判定
  const reg = regionAt(W3.pos.x, W3.pos.z);
  if(reg!==W3.region){ W3.region=reg; if(reg){ U.region=reg.id; U.combo=0; } updateArea3D(); drawRegion(); }
  // いちばん近い資源
  let near=null, nd=NEAR_R; NODES.forEach(n=>{ const d=Math.hypot(n.pos.x-W3.pos.x, n.pos.z-W3.pos.z); if(d<nd){nd=d; near=n;} });
  if(near!==W3.near){ const old=W3.near; W3.near=near; if(old) syncNode(old); if(near) syncNode(near); updateAction3D(); }
  // 資源の再生
  if(++W3.tick%20===0){ NODES.forEach(n=>{ const ns=U.nodes[nodeKey(n.r.id,n.res.id)]; if(ns && (ns.left<=0 || ns.until)){ nodeState(n.r.id,n.res.id); syncNode(n); } }); updateAction3D(); }
  updateLabels3D();
  if(ts-W3.lastSave>2000 && (!S.pos || Math.abs(S.pos.x-W3.pos.x)>0.01 || Math.abs(S.pos.z-W3.pos.z)>0.01)){ W3.lastSave=ts; S.pos={x:+W3.pos.x.toFixed(2), z:+W3.pos.z.toFixed(2)}; save(); }
}
function updateArea3D(){
  const el=$("#w3area"); if(!el) return; const r=W3.region;
  el.innerHTML = r ? `${r.icon} <b>${r.name}</b> <small>探索Lv${E.exploreLv(S,r.id)}</small>` : `🧭 <b>移動中</b> <small>地域の外</small>`;
}
function updateAction3D(){
  const b=$("#w3act"); if(!b) return; const n=W3.near;
  if(!n){ b.hidden=true; return; }
  const g=E.gatherInfo(S,n.r,n.res), k=S.disc[n.res.id], ns=nodeState(n.r.id,n.res.id);
  b.hidden=false;
  b.disabled = !g.ok || ns.left<=0;
  b.innerHTML = !g.ok ? `🔒 ${g.reason}` : ns.left<=0 ? `⏳ もうすぐ生えてくる` : `${k?ic(n.res.id):"❔"} ${k?nm(n.res.id):"何か"}を採る <small>＋${g.n}</small>`;
}
function updateLabels3D(){
  const box=$("#w3labels"); if(!box) return;
  NODES.forEach(n=>{
    const d=Math.hypot(n.pos.x-W3.pos.x, n.pos.z-W3.pos.z);
    let el=W3.labelEls[n.key];
    if(d>17){ if(el) el.style.display="none"; return; }
    const s=toScreen(n.pos.x, groundY(n.pos.x,n.pos.z)+(n.type==="tree"?2.6:1.5), n.pos.z);
    if(!s.ok){ if(el) el.style.display="none"; return; }
    if(!el || !el.isConnected){ el=document.createElement("button"); el.className="w3lab"; el.dataset.act="w3go"; el.dataset.n=n.key; box.appendChild(el); W3.labelEls[n.key]=el; el._sig=""; }
    const g=E.gatherInfo(S,n.r,n.res), k=S.disc[n.res.id], ns=nodeState(n.r.id,n.res.id);
    const sig=[g.ok,k?1:0,ns.left,W3.near===n].join("|");
    if(sig!==el._sig){ el._sig=sig; el.className="w3lab"+(g.ok?"":" lock")+(ns.left<=0?" regrow":"")+(W3.near===n?" near":"");
      el.innerHTML=`<span>${g.ok?(k?ic(n.res.id):"❔"):"🔒"}</span>${k?nm(n.res.id):"？"}${ns.left>0&&g.ok?`<i>${"●".repeat(Math.min(ns.left,8))}</i>`:""}`;
      el.setAttribute("aria-label", (k?nm(n.res.id):"未発見の資源")+"へ行って採取する"); }
    el.style.display=""; el.style.transform=`translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
  });
}
function float3D(n, text, cls){
  const box=$("#w3labels"); if(!box) return;
  const s=toScreen(n.pos.x, groundY(n.pos.x,n.pos.z)+1.2, n.pos.z);
  const f=document.createElement("span"); f.className="float "+(cls||""); f.textContent=text;
  f.style.left=s.x+"px"; f.style.top=s.y+"px"; box.appendChild(f); setTimeout(()=>f.remove(), RM?600:1100);
}
function gather3D(n){
  const r=n.r, res=n.res, g=E.gatherInfo(S,r,res);
  if(!g.ok){ float3D(n,g.reason,"ng"); return; }
  const ns=nodeState(r.id,res.id); if(ns.left<=0){ float3D(n,"もうすぐ生えてくる…","ng"); return; }
  const now=Date.now(); U.combo=(now-U.lastGather<1600)?U.combo+1:1; U.lastGather=now;
  const out=E.gather(S,r.id,res.id,{combo:U.combo}); if(!out.ok){ float3D(n,out.reason,"ng"); return; }
  ns.left--; if(ns.left<=0) ns.until=now+regrowMs(r.id);
  W3.gfx.playVisualEffect(out.news.length?"discovery":PLANT.includes(n.type)?"leaves":n.type==="water"?"splash":"sparkle", n.pos);
  if(out.lvUp) W3.gfx.playVisualEffect("levelup", W3.pos);
  float3D(n,(out.crit?"会心！ ":"")+ic(res.id)+"＋"+out.n, out.crit?"crit":"");
  const cb=$("#combo"); if(cb){ cb.textContent = U.combo>=2 ? "コンボ×"+U.combo+(U.combo%5===0?"　おまけ＋1！":"") : ""; cb.classList.toggle("on",U.combo>=2); }
  if(out.rares.length) banner("✨ 珍しい発見！ "+out.rares.map(nm).join("・"));
  else if(out.lvUp) banner("⭐ 探索Lv"+out.lvUp+"に上がった！");
  syncNode(n); afterChange(out.news); updateAction3D(); updateArea3D(); drawRegion();
}
function goTo3D(x,z,node){ W3.target={x,z}; W3.autoGather=node||null; }

/* ---------- 入力：タップで移動・ジョイスティック・キーボード ---------- */
function bind3DInput(){
  const w=$("#w3"); if(!w || w._bound) return; w._bound=true;
  let down=null;
  w.addEventListener("pointerdown", e=>{ if(e.target.closest(".joy,.w3lab,button")) return; down={x:e.clientX,y:e.clientY,t:Date.now()}; });
  w.addEventListener("pointerup", e=>{ if(!down || W3.state!=="ready") return; const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y); const quick=Date.now()-down.t<450; down=null;
    if(moved>10||!quick) return;
    const hit=screenToGround(e.clientX,e.clientY); if(!hit) return;
    let best=null, bd=2.2; NODES.forEach(n=>{ const d=Math.hypot(n.pos.x-hit.x,n.pos.z-hit.z); if(d<bd){bd=d;best=n;} });
    if(best) goTo3D(best.pos.x,best.pos.z,best); else goTo3D(hit.x,hit.z,null);
    W3.gfx.playVisualEffect("sparkle", best?best.pos:hit); });
  const joy=$("#joy"), knob=joy&&joy.querySelector(".knob");
  if(joy){ let id=null, cx=0, cy=0; const R=42;
    joy.addEventListener("pointerdown", e=>{ id=e.pointerId; joy.setPointerCapture(id); const r=joy.getBoundingClientRect(); cx=r.left+r.width/2; cy=r.top+r.height/2; mv(e); e.preventDefault(); });
    const mv=e=>{ if(e.pointerId!==id) return; let dx=e.clientX-cx, dy=e.clientY-cy; const l=Math.hypot(dx,dy); if(l>R){dx*=R/l;dy*=R/l;} knob.style.transform=`translate(${dx}px,${dy}px)`; const m=Math.hypot(dx,dy)/R; W3.joy = m<0.18?null:{x:dx/R, y:dy/R}; };
    joy.addEventListener("pointermove", mv);
    const end=e=>{ if(e.pointerId!==id) return; id=null; W3.joy=null; knob.style.transform=""; };
    joy.addEventListener("pointerup", end); joy.addEventListener("pointercancel", end); }
}
document.addEventListener("keydown", e=>{ if(U.tab!=="explore" || W3.state!=="ready" || e.target.closest("input,textarea,select")) return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","w","a","s","d"].includes(k)){ W3.keys[k]=true; e.preventDefault(); }
  if((k===" "||k==="e") && W3.near){ e.preventDefault(); gather3D(W3.near); } });
document.addEventListener("keyup", e=>{ const k=e.key.length===1?e.key.toLowerCase():e.key; delete W3.keys[k]; });
window.addEventListener("blur", ()=>{ W3.keys={}; W3.joy=null; });

/* ---------- 探検タブ（3D版） ---------- */
function renderExplore3D(v){
  const st=stage(), loading=W3.state!=="ready";
  v.innerHTML = `<div class="sec">🗺️ フィールド <small>${D.stages[st].era}・${D.stages[st].name}（次の進化：${D.stages[st].need}）</small></div>
  <div class="w3" id="w3"><div class="w3slot" id="w3slot"></div>
    <div class="w3labels" id="w3labels"></div>
    <div class="w3area" id="w3area"></div>
    <div class="w3tools"><button class="w3btn" data-act="home" aria-label="拠点へ戻る">🏠</button><button class="w3btn" data-act="hero" aria-label="主人公を変える">👤</button><button class="w3btn" data-act="view2d" aria-label="2Dの地図に切り替える">🗺️</button></div>
    <div class="combo" id="combo"></div><div class="banner" id="banner"></div>
    <div class="joy" id="joy" aria-label="移動スティック"><div class="knob"></div></div>
    <button class="w3act" id="w3act" data-act="g3" hidden></button>
    ${loading?`<div class="w3loading"><div>🌄 3Dフィールドを準備中…</div><small>初回は少し時間がかかります</small></div>`:""}
  </div>
  <p class="desc">地面をタップするとそこへ歩く。資源の名札をタップすると、歩いて行って採取する。スティック・矢印キー・WASDでも動ける（Eキーかスペースで採取）。</p>
  <div class="travel">${D.regions.map(r=>{ const open=E.regionOpen(S,r); return `<button class="chip tchip ${open?"":"lockc"}" data-act="travel" data-id="${r.id}">${open?r.icon:"🔒"} ${r.name}</button>`; }).join("")}</div>
  <div id="regionBox"></div>`;
  W3.labelEls={};
  if(W3.host) $("#w3slot").appendChild(W3.host);
  bind3DInput();
  if(W3.state==="ready"){ syncAll3D(); W3.region=undefined; resume3D(); updateArea3D(); updateAction3D(); }
  drawRegion();
}

/* ===================== 工作 ===================== */
function craftCard(c){
  const it = IT[c.out], pl = E.planCraft(S,c), own = it.unique && owned(c.out);
  const reqs = Object.keys(c.inp).map(id=>{ const k=S.disc[id]; const okk=E.cnt(S,id)>=c.inp[id]; return `<span class="${okk?"ok":"ng"}">${k?ic(id)+nm(id):"❔？？？"} ${E.cnt(S,id)}/${c.inp[id]}</span>`; }).join("");
  const tl = c.tools.concat(c.at?[c.at]:[]).map(id=>`<span class="${owned(id)?"ok":"ng"}">${c.at===id?"場所：":"道具："}${S.disc[id]?ic(id)+nm(id):"❔？？？"}</span>`).join("");
  return `<div class="card"><h3><span class="i">${it.icon}</span>${it.name}${own?' <span class="tag" style="background:var(--meadow);color:var(--meadow-ink)">持っている</span>':""}</h3>
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
  <div class="dex">${list.map(k=>{ const st=E.status(S,k); return `<button class="dx ${st}" data-act="item" data-id="${k}"><span class="i">${st==="known"?IT[k].icon:"❔"}</span><span class="n">${st==="known"?IT[k].name:"？？？"}</span></button>`; }).join("")}</div>
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
    <div class="hd"><span class="bigi">${it.icon}</span><div><h2>${it.name}</h2><div class="yomi">${it.yomi}・${it.en}</div></div></div>
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
  $("#modal").classList.add("open"); sh.scrollTop=0; sh.querySelector(".close").focus();
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
  const a = b.dataset.act, id = b.dataset.id;
  if(!a && b.dataset.tab){ setTab(b.dataset.tab); return; }
  switch(a){
    case "tab": setTab(b.dataset.tab); break;
    case "add": if(U.busy) break; if((U.tray[id]||0) < E.cnt(S,id)){ U.tray[id]=(U.tray[id]||0)+1; U.last=null; } drawLabCtl(); drawScene(); break;
    case "sub": if(U.busy) break; U.tray[id]--; if(U.tray[id]<=0) delete U.tray[id]; drawLabCtl(); drawScene(); break;
    case "fac": if(U.busy) break; U.fac = U.fac===id?null:id; U.op=null; drawLabCtl(); drawScene(); break;
    case "op": if(U.busy) break; U.op = U.op===id?null:id; drawLabCtl(); drawScene(); break;
    case "run": runLab(); break;
    case "hint": { const h=E.suggest(S); U.last=`<div class="note"><h4>🦉 ホウ博士のヒント</h4><p style="margin:0">${h.text}</p></div>`; drawLabCtl(); break; }
    case "again": { if(U.busy) break; const p=D.procs.find(x=>x.id===b.dataset.proc); U.tab="lab"; U.tray=Object.assign({},p.inp); U.fac=b.dataset.fac; U.op=p.op; renderChrome(); render(); runLab(); break; }
    case "go": travel(id); break;
    case "g3": if(W3.near) gather3D(W3.near); break;
    case "w3go": { const n=NODES&&NODES.find(x=>x.key===b.dataset.n); if(n){ if(W3.near===n) gather3D(n); else goTo3D(n.pos.x,n.pos.z,n); } break; }
    case "travel": { const r=D.regions.find(x=>x.id===id); if(!E.regionOpen(S,r)){ banner("🔒 "+r.name+"：入るには「"+r.unlock.map(nm).join("」か「")+"」が必要"); break; } if(W3.state==="ready"){ goTo3D(r.w.x,r.w.z+REGION_R*0.2,null); $("#w3").scrollIntoView({block:"nearest",behavior:RM?"auto":"smooth"}); } break; }
    case "home": if(W3.state==="ready") goTo3D(D.base.x,D.base.z,null); break;
    case "hero": { S.flags.hero = S.flags.hero==="girl"?"boy":"girl"; save(); if(W3.gfx) W3.gfx.setPlayerSpriteSheet(heroUrl()); banner(S.flags.hero==="girl"?"👧 女の子に交代！":"👦 男の子に交代！"); break; }
    case "pickhero": S.flags.hero=id; save(); if(W3.gfx) W3.gfx.setPlayerSpriteSheet(heroUrl()); document.querySelectorAll(".heropick").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===id)); break;
    case "view2d": S.flags.view="2d"; pause3D(); save(); fieldSig=""; render(); break;
    case "view3d": S.flags.view="3d"; save(); fieldSig=""; render(); break;
    case "gather": doGather(b.dataset.r, id); break;
    case "auto": { const i=S.auto.findIndex(x=>x.r===b.dataset.r&&x.id===id); if(i>=0) S.auto.splice(i,1); else if(S.auto.length<E.autoSlots(S)) S.auto.push({r:b.dataset.r,id}); save(); drawRegion(); break; }
    case "craft": { const r=E.runCraft(S,id,S.seq); if(r.ok){ afterChange(r.news); render(); } break; }
    case "filter": U.filter=id; render(); break;
    case "item": openItem(id); break;
    case "close": closeModal(); break;
    case "target": closeModal(); U.target=id; setTab("map"); break;
    case "copy": { const t=$("#exportBox"); t.select(); try{ navigator.clipboard.writeText(t.value); $("#saveMsg").textContent="コピーしたよ"; }catch(e){ $("#saveMsg").textContent="文字を選んでコピーしてね"; } break; }
    case "import": { try{ const n=E.deserialize($("#importBox").value.trim()); S=n; lastMission=E.missionIndex(S); lastStage=stage(); U.tray={}; U.fac=null; U.op=null; U.nodes={}; fieldSig=""; save(); renderChrome(); render(); $("#saveMsg").textContent="読み込んだよ"; }catch(e){ $("#saveMsg").textContent="読み込めなかった：形式が違うみたい"; } break; }
    case "reset": if(confirm("本当に最初からやり直す？（発見の記録も消えます）")){ S=E.newState(); lastMission=0; lastStage=0; U.tray={}; U.fac=null; U.op=null; U.last=null; U.nodes={}; U.region="forest"; fieldSig=""; save(); renderChrome(); render(); intro(); } break;
  }
});
document.addEventListener("change", ev=>{ if(ev.target.dataset.act==="pick"){ U.target=ev.target.value; render(); } });
document.addEventListener("keydown", ev=>{ if(ev.key==="Escape") closeModal(); });
function closeModal(){ $("#modal").classList.remove("open"); }

/* 自動採取 */
setInterval(()=>{ if(document.hidden || !S.auto.length) return; const got=E.autoTick(S); if(got.length){ afterChange(got.flatMap(g=>g.news)); if(U.tab==="lab" && !U.busy) drawLabCtl(); } }, 10000);

/* はじめに */
function intro(){
  if(S.flags.intro) return;
  $("#sheet").innerHTML = `<div class="hd"><span class="bigi">🦉</span><div><h2>ようこそ！ 私はホウ博士</h2><div class="yomi">ゼロからの科学へ</div></div></div>
  <div class="kidbox">ここには道具も研究所も何もない。あるのは石と水と木だけ。<br>でも科学の力があれば、ガラスも金属も、電気もプラスチックも作れるんだ。一緒に文明を作り直そう！</div>
  <ul><li>🗺️ <b>探検</b>：地図の上を移動して、自然の材料を採取する</li><li>🔨 <b>工作</b>：道具や設備を組み立てる</li><li>🧪 <b>研究室</b>：材料・装置・操作を選んで実験する</li><li>📖 <b>図鑑</b>：見つけたものの説明が全部読める</li><li>🏙️ 発見が進むと、フィールドが原始時代から現代の都市へ進化していく</li></ul>
  <h5>主人公を選んでね（あとで🗺️探検の👤ボタンでも変えられる）</h5>
  <div class="row">${["boy","girl"].map(h=>`<button class="heropick" data-act="pickhero" data-id="${h}" aria-pressed="${(S.flags.hero||"boy")===h}"><span class="hero big" style="background-image:url(${ASSETS[h]})"></span>${h==="boy"?"男の子":"女の子"}</button>`).join("")}</div>
  <p class="desc">このゲームの化学は本物の化学がもとになっています。でも火や薬品を使う実験は危ないので、現実では大人と一緒に安全な場所でやろうね。</p>
  <div class="row mt"><button class="btn big" data-act="close" id="introGo">始める！</button></div>`;
  if(!S.flags.hero) S.flags.hero="boy";
  $("#modal").classList.add("open"); S.flags.intro=1; save();
}
renderChrome(); render(); intro();
window.__GAME__ = {get S(){return S;}, E, D, U, W3, get NODES(){return NODES;}, render:()=>{ fieldSig=""; sceneSig=""; lastStage=stage(); lastMission=E.missionIndex(S); renderChrome(); render(); }};
})(DATA, ENGINE);
