/* ===================== 図鑑（レシピ図鑑）の判定（2026-11-14 Claude。ロードマップ M2-01・M2-03・M1 の入手経路の点検） =====================
   レシピ・数量・設備の正本は増やさない。ここは data.js（procs・crafts・regions）・space-data.js（crafts の space）・construction-data.js（建物）を
   読んで、図鑑の形（1 品目の情報・作り方の一覧・使い道・原料までの逆引き・点検の台帳）に組み立てるだけ。状態（S）は読むだけで書かない。
   ・発見のきまり（E.status）はそのまま。検索・逆引きは、未発見の名前を出さない（all＝学習用の全件閲覧のときだけ全部）。
   ・設備は「完成した建物があるか」（E.hasTool＝建設の決まり）で判定する。持ち物にあるだけ・建設中は使える扱いにしない。 */
var BOOK = (function(D, E){
  const IT = D.items, B = D.book, CX = D.construction || null;
  const cons = () => (typeof CONS !== 'undefined' ? CONS : null);

  /* ---------- 分類 ---------- */
  function catOf(id){ const it = IT[id]; if(!it) return null; for(const c of B.cats) if(c.tags.some(t=>it.tags.includes(t))) return c; return B.cats[B.cats.length-1]; }

  /* ---------- 作り方（正本からの写しではなく、その場で組み立てる） ---------- */
  const buildRuleOn = S => !!(S && E.buildRule && E.buildRule(S) && !S.verify);
  function buildingFor(fac){ return CX ? CX.defs.find(d=>d.facility===fac) : null; }
  function recipesOf(id, S){
    const out = [];
    D.regions.forEach(r=>r.res.filter(x=>x.id===id).forEach(x=>out.push({kind:'gather', key:'gather:'+r.id+':'+(x.key||x.id), region:r.id, regionName:r.name, need:x.need||[], n:x.n||1, loose:!!x.loose,
      inputs:{}, outputs:{[id]:x.n||1}, at:[], tools:x.need||[], toolsAny:true, time:null})));
    D.regions.forEach(r=>(r.rare||[]).filter(x=>x.id===id).forEach(x=>out.push({kind:'rare', key:'rare:'+r.id, region:r.id, regionName:r.name, chance:x.chance, inputs:{}, outputs:{[id]:1}, at:[], tools:[], time:null})));
    D.procs.filter(p=>p.out[id]).forEach(p=>out.push({kind:'lab', key:p.id, op:p.op, opName:(D.ops[p.op]||{}).name||p.op, inputs:{...p.inp}, outputs:{...p.out}, at:[...p.at], atAny:true, tools:[...(p.tools||[])], why:p.why, air:!!p.air, time:null}));
    const bd = buildRuleOn(S) ? buildingFor(id) : null;
    D.crafts.filter(c=>c.out===id).forEach(c=>{ if(bd && !c.space) return;   // 建設の決まりでは、建物の設備は工作でなく現地に建てる
      out.push({kind:c.space?'space':'craft', key:c.id, inputs:{...c.inp}, outputs:{[id]:c.qty||1}, at:c.at?[c.at]:[], tools:[...(c.tools||[])], how:c.how, time:c.seconds||null, lesson:c.lesson||null}); });
    if(bd){ const mat = {}, tools = new Set(); let time = 0; bd.stages.forEach(s=>{ for(const k in s.mat) mat[k]=(mat[k]||0)+s.mat[k]; s.tools.forEach(t=>tools.add(t)); time += s.work||0; });
      out.push({kind:'build', key:'build:'+bd.id, building:bd.id, buildingName:bd.name, stages:bd.stages.map(s=>s.name), inputs:mat, outputs:{[id]:1}, at:[], tools:[...tools], time}); }
    return out;
  }
  /* 使い道：これを材料・道具・設備に使う作り方と、その出来上がり（建物の資材も含む） */
  function usesOf(id){
    const r = [];
    D.procs.forEach(p=>{ const role = p.inp[id] ? 'input' : (p.tools||[]).includes(id) ? 'tool' : p.at.includes(id) ? 'facility' : null; if(role) r.push({kind:'lab', key:p.id, role, outputs:Object.keys(p.out)}); });
    D.crafts.forEach(c=>{ const role = c.inp[id] ? 'input' : (c.tools||[]).includes(id) ? 'tool' : c.at===id ? 'facility' : null; if(role) r.push({kind:c.space?'space':'craft', key:c.id, role, outputs:[c.out]}); });
    if(CX) CX.defs.forEach(d=>{ const st = d.stages.find(s=>s.mat[id] || s.tools.includes(id)); if(st) r.push({kind:'build', key:'build:'+d.id, role: st.mat[id] ? 'input' : 'tool', outputs: d.facility ? [d.facility] : [], building:d.id, buildingName:d.name}); });
    return r;
  }
  const isRaw = id => D.regions.some(r=>r.res.some(x=>x.id===id) || (r.rare||[]).some(x=>x.id===id));

  /* ---------- 監修・出典（台帳に書いていなければ未確認。出典は品目に書いてある物だけ） ---------- */
  function reviewOf(id){ const r = B.review[id]; const status = r && B.reviewNames[r.status] ? r.status : 'unchecked'; return {status, name:B.reviewNames[status], icon:B.reviewIcons[status], by:r&&r.by||null, on:r&&r.on||null, note:r&&r.note||null}; }
  function sourcesOf(id){ const it = IT[id]; return {urls: Array.isArray(it.scienceSources) ? it.scienceSources.slice() : [], checkedOn: it.scienceCheckedOn || null, note: it.scienceNotes || null}; }

  /* ---------- 1 品目の情報（図鑑のスキーマ。docs/book/BOOK-SCHEMA.md） ---------- */
  function entry(S, id){
    const it = IT[id]; if(!it) return null; const c = catOf(id), rec = recipesOf(id, S), labWhy = rec.find(r=>r.kind==='lab' && r.why);
    return {id, name:it.name, yomi:it.yomi, en:it.en||null, cat:c.id, catName:c.name, tags:it.tags.slice(), kid:it.kid, more:it.more,
      formula:it.f||null, elements:it.el||[], mp:it.mp||null, bp:it.bp||null,
      nature: it.nature || null, natural: isRaw(id),
      obtain: rec, uses: usesOf(id), usesText: it.uses || null,
      principle: labWhy ? labWhy.why : null, simplification: it.simplification || null,
      sources: sourcesOf(id), review: reviewOf(id), store: it.store !== false };
  }

  /* ---------- 検索（発見のきまりを守る） ---------- */
  const kata2hira = s => String(s||'').replace(/[ァ-ヶ]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
  const norm = s => kata2hira(String(s||'').normalize('NFKC').toLowerCase()).replace(/\s+/g,'');
  /* visible：その人に図鑑の項目として見えるか（known＝全部、hinted＝？？？で分類だけ、hidden＝出さない）。all は学習用の全件閲覧 */
  function visibility(S, id, all){ if(all) return 'known'; const st = E.status(S, id); return st; }
  function search(S, q, cat, all){
    const n = norm(q), ids = Object.keys(IT), out = [];
    for(const id of ids){ const v = visibility(S, id, all); if(v==='hidden') continue; const c = catOf(id);
      if(cat && cat!=='all' && c.id!==cat) continue;
      if(n){ if(v!=='known') { if(!norm(c.name).includes(n)) continue; }
        else { const it = IT[id], uses = usesOf(id).flatMap(u=>u.outputs).filter(o=>all || S.disc[o]).map(o=>IT[o].name);
          const hay = [it.name, it.yomi, it.en, c.name, ...it.tags, it.uses, ...uses, it.f].map(norm).join('|'); if(!hay.includes(n)) continue; } }
      out.push({id, vis:v, cat:c.id}); }
    return out;
  }

  /* ---------- 設備・道具が使えるか（建設の決まりでは完成した建物だけ） ---------- */
  function facilityState(S, id){
    if(E.hasTool(S, id)) return {ok:true, label:'使える'};
    const bd = buildRuleOn(S) ? buildingFor(id) : null, C = cons();
    if(bd && C){ const site = C.list(S).find(v=>v.def===bd.id && v.phase!=='completed');
      if(site){ const st = bd.stages.length; return {ok:false, label:({planned:'予定地',supplying:'資材の搬入中',constructing:'施工中'})[site.phase]+'・工程 '+Math.min(site.stage,st)+'/'+st, site:site.id, building:bd.id}; }
      if(E.cnt(S, id) > 0) return {ok:false, label:'持ち物にあるが建物がない（建築の画面から置く）', building:bd.id};
      return {ok:false, label:'未建設（現地に建てる）', building:bd.id}; }
    return {ok:false, label: E.cnt(S,id)>0 ? '使えない' : '持っていない'};
  }

  /* ---------- 原料までの逆引き ----------
     need 個を作るのに、選んだ作り方（choice[id]＝作り方の key）で何回作るか（1 回の出来上がりの数で割って切り上げ）、材料は回数×数量。
     useStock：在庫を引いた残りだけを作る。道具・設備は使ってもなくならないので数に掛けない（必要かどうかと、使えるか）。
     同じ物が自分の材料をたどった先にもう一度出たら「循環」で止める。深さは maxDepth まで。 */
  function options(S, id){ return recipesOf(id, S); }
  function defaultChoice(S, id, opts){
    const g = opts.find(o=>o.kind==='gather' && !o.need.length) || opts.find(o=>o.kind==='gather');
    if(g) return g.key;
    const known = S && S.disc[id] && S.disc[id].routes || [];
    const k = opts.find(o=>known.includes(o.key)); if(k) return k.key;
    const b = opts.find(o=>o.kind==='build'); if(b) return b.key;
    return opts[0] ? opts[0].key : null;
  }
  function expand(S, id, need, choice, o){
    o = Object.assign({useStock:true, maxDepth:12, all:false}, o||{}); choice = choice || {};
    const walk = (id, need, path, depth) => {
      const opts = options(S, id), have = E.cnt(S, id), make = Math.max(0, need - (o.useStock ? have : 0));
      const key = choice[id] && opts.some(x=>x.key===choice[id]) ? choice[id] : defaultChoice(S, id, opts), r = opts.find(x=>x.key===key) || null;
      const node = {id, vis:visibility(S, id, o.all), need, have, short:Math.max(0, need-have), make, options:opts.map(x=>({key:x.key, kind:x.kind})), choice:key, recipe:r, runs:0, children:[], tools:[], at:[], byproducts:{}, leaf:null};
      if(path.includes(id)){ node.leaf = 'cycle'; return node; }
      if(!r){ node.leaf = 'none'; return node; }
      if(r.kind==='gather' || r.kind==='rare'){ node.leaf = r.kind; node.tools = (r.need||[]).map(t=>({id:t, ok:E.hasTool(S,t), label:E.hasTool(S,t)?'持っている':'持っていない'})); node.toolsAny = true; return node; }
      if(depth >= o.maxDepth){ node.leaf = 'depth'; return node; }
      const q = r.outputs[id] || 1; node.runs = Math.ceil(make / q);
      for(const [k,v] of Object.entries(r.outputs)) if(k!==id) node.byproducts[k] = v * node.runs;
      const extra = r.outputs[id] * node.runs - make; if(extra > 0) node.surplus = extra;
      node.tools = r.tools.map(t=>({id:t, ...facilityState(S,t), consumed:false}));
      node.at = r.at.map(f=>({id:f, ...facilityState(S,f)})); node.atAny = !!r.atAny;
      if(node.runs > 0 || !o.useStock) for(const [k,v] of Object.entries(r.inputs)) node.children.push(walk(k, v * Math.max(node.runs, o.useStock ? 0 : 1), path.concat(id), depth+1));
      return node; };
    return walk(id, need, [], 0);
  }
  /* 逆引きの合計：天然の原料（採る物）ごとの量・足りない量・要る道具と設備（重複なし） */
  function totals(node){
    const raw = {}, tools = {}, at = {}, cycles = [], none = [];
    const visit = n => { if(n.leaf==='gather' || n.leaf==='rare'){ raw[n.id] = (raw[n.id]||0) + n.need; }
      if(n.leaf==='cycle') cycles.push(n.id); if(n.leaf==='none') none.push(n.id);
      n.tools.forEach(t=>tools[t.id] = tools[t.id] || t); (n.at||[]).forEach(f=>at[f.id] = at[f.id] || f); n.children.forEach(visit); };
    visit(node); return {raw, tools:Object.values(tools), at:Object.values(at), cycles, none};
  }

  /* ---------- 点検の台帳（M1：天然の原料・到達・元素の出どころ・説明との不一致） ---------- */
  function audit(){
    const raws = Object.keys(IT).filter(isRaw);
    const ledger = raws.map(id=>({id, name:IT[id].name, regions:recipesOf(id).filter(r=>r.kind==='gather'||r.kind==='rare').map(r=>({region:r.region, name:r.regionName, need:r.need||[], rare:r.kind==='rare'})),
      processing:D.procs.filter(p=>p.inp[id]).map(p=>p.id), uses:usesOf(id).length, elements:IT[id].el||[]}));
    /* 到達：採れる物から、作り方を何度でも当てはめて広げる（道具・設備も到達していることが条件。設備は工作か建設で作れる） */
    const R = new Set(), has = k => R.has(k);
    const air = new Set(['air']); air.forEach(a=>{ if(IT[a]) R.add(a); });
    let changed = true, rounds = 0;
    while(changed && rounds < 100){ changed = false; rounds++;
      const add = k => { if(!R.has(k)){ R.add(k); changed = true; } };
      D.regions.forEach(r=>{ r.res.forEach(x=>{ if(!(x.need&&x.need.length) || x.need.some(has)) add(x.id); }); (r.rare||[]).forEach(x=>add(x.id)); });
      D.procs.forEach(p=>{ if(Object.keys(p.inp).every(has) && (p.tools||[]).every(has) && (!p.at.length || p.at.some(has))) Object.keys(p.out).forEach(add); });
      D.crafts.forEach(c=>{ if(Object.keys(c.inp).every(has) && (c.tools||[]).every(has) && (!c.at || has(c.at))) add(c.out); });
      if(CX) CX.defs.forEach(d=>{ if(d.facility && d.stages.every(s=>Object.keys(s.mat).every(has) && s.tools.every(has))) add(d.facility); }); }
    const unreachable = Object.keys(IT).filter(k=>!R.has(k));
    /* 元素の出どころ：品目に出てくる元素ごとに、それを含む天然の原料（採れる物）。どれにも無い元素は記録する */
    const els = {}; Object.values(IT).forEach(it=>(it.el||[]).forEach(e=>{ (els[e] = els[e] || {users:[], sources:[]}).users.push(it.id); }));
    raws.forEach(id=>(IT[id].el||[]).forEach(e=>{ if(els[e]) els[e].sources.push(id); }));
    const noSource = Object.entries(els).filter(([,v])=>!v.sources.length).map(([e,v])=>({element:e, users:v.users}));
    /* 説明との不一致：用途の文があるのに、どの作り方にも使われていない */
    const usesTextOnly = Object.keys(IT).filter(id=>IT[id].uses && !usesOf(id).length);
    /* 天然の原料なのに「自然の中では」の文がない */
    const rawNoNature = raws.filter(id=>!IT[id].nature);
    return {raws:ledger, unreachable, elements:els, noSource, usesTextOnly, rawNoNature, rounds};
  }
  /* 原稿・出典の不足（科学の原稿の監修とは別に、図鑑に足りない欄を数える） */
  function gaps(){
    return Object.keys(IT).map(id=>{ const it = IT[id], miss = [];
      if(isRaw(id) && !it.nature) miss.push('自然界での存在');
      if(!it.uses && !usesOf(id).length) miss.push('用途');
      if(!it.simplification) miss.push('ゲーム上の簡略化');
      if(!(it.scienceSources||[]).length) miss.push('出典');
      if(reviewOf(id).status!=='checked') miss.push('監修');
      return {id, name:it.name, cat:catOf(id).name, miss}; });
  }
  return {catOf, recipesOf, usesOf, isRaw, reviewOf, sourcesOf, entry, search, norm, visibility, facilityState, options, defaultChoice, expand, totals, audit, gaps, buildingFor};
})(typeof DATA!=='undefined'?DATA:(require('./construction-data.js'), require('./book-data.js'), require('./data.js')), typeof ENGINE!=='undefined'?ENGINE:require('./engine.js'));
if(typeof module!=='undefined') module.exports=BOOK;
