/* ===================== ゲームエンジン（UIから独立） ===================== */
var ENGINE = (function(D){
  const SCHEMA = 5;
  /* 地形の版（広い世界の形。src/world/shape.ts の WORLD_VERSION と同じ値。テストで検査）。セーブの worldVer がこれより古ければ、UI が位置を確かめて直す */
  const WORLD_VER = 4;
  const IT = D.items;
  const BASKET_RES = ["twig","leaves","vine","seed","grass","grape","shell","seaweed","cobble","sand","clay"];
  const AIR = ["O","N","C","H"]; // 空気中の酸素・窒素・二酸化炭素・水蒸気

  /* nature：変化した自然物・採取地点の状態だけを保存する（{id:{u:使った回数, t:取り尽くした時刻}}） */
  /* build：建物の置き場所 {建物ID:{x,z,rot}}（撤去したものは {removed:true}。記録がなければ決まった場所）。camera：カメラのユーザー設定（v3〜） */
  function newState(){ return {v:SCHEMA, inv:{}, disc:{}, hist:[], gathered:{}, explore:{}, auto:[], seq:0, flags:{}, nature:{}, build:{}, camera:{}, space:{version:1}, worldVer:WORLD_VER, created:Date.now()}; }
  const cnt = (S,id)=> S.inv[id]||0;
  const has = (S,id)=> cnt(S,id)>0;
  /* 検証モード（S.verify。通常のセーブには存在しない）の条件バイパス。
     free：材料を減らさない・足りなくても実験と工作ができる／tools：道具・設備の条件を満たしたことにする／
     locks：鍵のかかった地域に入れる（未実装の地域 r.future は開かない）／instant：待ち時間を短くする（UI が読む）／
     stage：時代の表示を切り替える（null は通常どおり） */
  const vflag = (S,k)=> !!(S && S.verify && S.verify[k]);
  const hasTool = (S,id)=> has(S,id) || vflag(S,"tools");
  const keyOf = obj => Object.keys(obj).filter(k=>obj[k]>0).sort().join("+");

  function discover(S,id){
    if(!IT[id]) return false;
    if(S.disc[id]) return false;
    S.disc[id] = {first:Date.now(), made:0, total:0, routes:[], best:0};
    return true;
  }
  function addItem(S,id,n,route){
    const it = IT[id]; const isNew = discover(S,id);
    const r = S.disc[id]; r.made++; r.total += n;
    if(route && !r.routes.includes(route)) r.routes.push(route);
    if(it.purity && it.purity > r.best) r.best = it.purity;
    if(it.store!==false){
      S.inv[id] = cnt(S,id) + n;
      if(it.unique) S.inv[id] = Math.min(S.inv[id],1);
    }
    return isNew;
  }

  /* ---------- 探索 ---------- */
  const LV = [0,15,40,90];               // 探索度のしきい値
  /* 地域の鍵は 2026-11-11 に廃止：準備中（r.future）でない地域はすべて最初から入れる。
     進み方は「採る → 持ち帰る → 道具・設備をそろえる → 加工する」。止めるのは各レシピ・採取地点の実際の条件（道具・設備・材料）だけ */
  function regionOpen(S,r){ return !!r && !r.future; }
  /* 採取地点の鍵（同じ素材の採取地点が1つの地域にいくつかあるときは key で区別する。ないときは素材ID＝以前のセーブと同じ） */
  const resKey = res => res.key || res.id;
  const findRes = (r,key) => r && r.res.find(x=>resKey(x)===key);
  function exploreLv(S,rid){ const n=(S.explore&&S.explore[rid])||0; let lv=0; LV.forEach((t,i)=>{ if(n>=t) lv=i; }); return lv; }
  function nextLv(S,rid){ const n=(S.explore&&S.explore[rid])||0; const t=LV.find(t=>t>n); return t===undefined?null:{need:t,now:n}; }
  const RAIL = ["mine","mountain","cave","oilfield","volcano"];
  function gatherInfo(S,r,res){
    if(!regionOpen(S,r)) return {ok:false, reason:"準備中の場所"};
    if(res.need && !res.need.some(t=>hasTool(S,t))) return {ok:false, need:res.need, reason:"「"+res.need.map(t=>IT[t].name).join("」か「")+"」が必要"+(r.res.some(x=>x.loose && x.id===res.id) ? "（落ちているかけらなら手で拾える）" : "")};
    let n = res.n;
    if(res.bonus && has(S,res.bonus)) n += 1;
    if(BASKET_RES.includes(res.id) && has(S,"basket")) n += 1;
    if(RAIL.includes(r.id) && has(S,"steamengine")) n += 1;
    if(exploreLv(S,r.id)>=2) n += 1;
    return {ok:true, n};
  }
  /* 採取の報酬を付与する（地域の資源・フィールドの自然物で共通）。
     items：{素材ID:個数}。regionId があればその地域の探索度と珍しい発見を進める。
     opt: {rng:乱数関数, combo:コンボ数, auto:自動採取か} */
  function collect(S, regionId, items, opt){
    opt = opt||{}; const rng = opt.rng||Math.random;
    const r = regionId ? D.regions.find(x=>x.id===regionId) : null;
    const crit = !opt.auto && rng()<0.12;
    const got={}, news=[];
    Object.keys(items).forEach((id,i)=>{ let n=items[id]; if(crit) n*=2; if(i===0 && !opt.auto && opt.combo && opt.combo>0 && opt.combo%5===0) n+=1;
      got[id]=n; if(addItem(S,id,n,"gather:"+(regionId||"wild"))) news.push(id); S.gathered[id]=(S.gathered[id]||0)+n; });
    const rares=[]; let lvUp=null;
    if(!opt.auto && r){
      S.explore = S.explore||{}; const before = exploreLv(S,r.id);
      S.explore[r.id] = (S.explore[r.id]||0)+1;
      const after = exploreLv(S,r.id);
      if(after>before){ lvUp=after;
        if(after===2){ const rr=(r.rare||[]).find(x=>!S.disc[x.id]); if(rr) rares.push(rr.id); } }
      const mult = after>=3?2:after>=1?1.5:1;
      (r.rare||[]).forEach(x=>{ if(!rares.includes(x.id) && rng() < x.chance*mult) rares.push(x.id); });
      rares.forEach(id=>{ if(addItem(S,id,1,"rare:"+r.id)) news.push(id); });
    }
    return {ok:true, got, crit, rares, lvUp, news};
  }
  // 地域の資源を1回採る（残量は見ない。残量つきの採取は harvestDeposit）
  function gather(S, regionId, resId, opt){
    opt = opt||{};
    const r = D.regions.find(x=>x.id===regionId); if(!r) return {ok:false, reason:"地域がない"};
    const res = findRes(r,resId); if(!res) return {ok:false, reason:"資源がない"};
    const g = gatherInfo(S,r,res); if(!g.ok) return g;
    const c = collect(S, regionId, {[res.id]:g.n}, opt);
    return {ok:true, n:c.got[res.id], crit:c.crit, rares:c.rares, lvUp:c.lvUp, news:c.news, isNew:c.news.includes(res.id)};
  }

  /* ---------- 残量と再生（地域の資源・自然物で共通。状態は S.nature に保存） ----------
     uses：満タンの回数（Infinity なら減らない）／regrow：取り尽くしてから満タンに戻るまでのミリ秒（null なら戻らない） */
  function stockOf(S, id, uses, regrow, now){
    now = now||Date.now(); S.nature = S.nature||{};
    const st = S.nature[id];
    if(!st) return {left:uses, used:0, until:0};
    if(st.t && regrow!=null && now - st.t >= regrow){ delete S.nature[id]; return {left:uses, used:0, until:0}; }
    const left = Math.max(0, uses - (st.u||0));
    return {left, used:st.u||0, until: left<=0 && st.t && regrow!=null ? st.t + regrow : 0};
  }
  function useStock(S, id, uses, regrow, now){
    now = now||Date.now(); const k = stockOf(S,id,uses,regrow,now);
    if(!isFinite(uses)) return k;
    const st = S.nature[id] || (S.nature[id] = {u:0});
    st.u = (st.u||0) + 1;
    if(st.u >= uses) st.t = now; else if(st.t && regrow==null) delete st.t;
    return stockOf(S,id,uses,regrow,now);
  }
  /* 地域の資源（採取地点）：水は減らない。植物は早く、石や鉱物はゆっくり戻る */
  const WATER = ["rain","river","spring","seawater"];
  const PLANT_RES = ["twig","leaves","vine","seed","grass","grape","resin","wax","bark","shell","seaweed","log"];
  const depositId = (rid,resId)=> "d:"+rid+":"+resId;
  /* resKey：採取地点の鍵（ふつうは素材ID）。落ちている鉱石のかけら（res.loose）は少しだけ（2回）で、戻るのもゆっくり（3分） */
  function depositRule(S, rid, resKey_){
    const r = D.regions.find(x=>x.id===rid), res = findRes(r, resKey_), id = res ? res.id : resKey_;
    if(WATER.includes(id)) return {uses:Infinity, regrow:null};
    if(res && res.loose) return {uses:2, regrow:180000};
    return {uses: 5 + exploreLv(S,rid), regrow: PLANT_RES.includes(id) ? 20000 : 90000};
  }
  /* 採取地点の3D上の位置：res.at（ワールド座標。火山のように広い地域で、地点を散らして置くとき）か、
     地域の中心 w と地域画面での配置 p から決める */
  function depositPos(r, res){ if(res.at) return {x:res.at.x, z:res.at.z}; return {x: r.w.x + (res.p[0]-50)/50*6.5, z: r.w.z + (res.p[1]-62)/38*5}; }
  const REACH = 1.6;   // 採取できる距離（対象の外周から）
  function depositInfo(S, rid, resId, now){
    const r = D.regions.find(x=>x.id===rid), res = findRes(r, resId);
    if(!res) return {ok:false, reason:"資源がない"};
    const g = gatherInfo(S,r,res), rule = depositRule(S,rid,resId), k = stockOf(S, depositId(rid,resId), rule.uses, rule.regrow, now);
    if(!g.ok) return Object.assign({left:k.left, until:k.until, uses:rule.uses}, g);
    if(k.left<=0) return {ok:false, kind:"empty", left:0, until:k.until, uses:rule.uses, reason:"取り尽くした（少し待つと戻る）"};
    return {ok:true, n:g.n, left:k.left, until:k.until, uses:rule.uses};
  }
  /* 残量つきで地域の資源を採る。opt.token は二重実行防止（S.seq と一致したときだけ確定）、
     opt.pos があれば距離を確認する。自動採取（opt.auto）も同じ残量を使う */
  function harvestDeposit(S, rid, resId, opt){
    opt = opt||{}; const now = opt.now||Date.now();
    if(!opt.auto && opt.token!==undefined && opt.token!==S.seq) return {ok:false, kind:"dup", reason:"もう採取した"};
    const r = D.regions.find(x=>x.id===rid), res = findRes(r, resId);
    if(!res) return {ok:false, reason:"資源がない"};
    if(opt.pos){ const p=depositPos(r,res); if(Math.hypot(opt.pos.x-p.x, opt.pos.z-p.z) > REACH+0.6) return {ok:false, kind:"far", reason:"遠すぎる。もっと近づこう"}; }
    const inf = depositInfo(S, rid, resId, now); if(!inf.ok) return inf;
    if(!opt.auto) S.seq++;
    const rule = depositRule(S,rid,resId);
    useStock(S, depositId(rid,resId), rule.uses, rule.regrow, now);
    const c = collect(S, rid, {[res.id]:inf.n}, opt);
    const k = stockOf(S, depositId(rid,resId), rule.uses, rule.regrow, now);
    return {ok:true, n:c.got[res.id], id:res.id, crit:c.crit, rares:c.rares, lvUp:c.lvUp, news:c.news, left:k.left, until:k.until};
  }
  function autoSlots(S){ return ["basket","storehouse","steamengine","generator"].filter(t=>has(S,t)).length*2; }
  function autoTick(S){
    const out=[]; S.auto = S.auto.slice(0, autoSlots(S));
    for(const a of S.auto){ const g = harvestDeposit(S,a.r,a.id,{auto:true}); if(g.ok) out.push({id:a.id,n:g.n,news:g.news}); }
    return out;
  }

  /* ---------- 加工の条件（2026-11-11） ----------
     「地域に入れない」とは別に、「採れても加工できない」を具体的に示す。素材 id を使う反応ごとに、
     足りない設備（at のどれも持っていない）・道具を返す。文明の段階（stageOf）は見ない（材料と設備・道具がそろえば、段階が低くてもできる） */
  function processNeeds(S, id){
    return D.procs.filter(p=>p.inp[id]).map(p=>{
      const at = p.at.some(f=>hasTool(S,f)) ? [] : p.at.slice();
      const tools = p.tools.filter(t=>!hasTool(S,t));
      return {proc:p.id, op:p.op, at, tools, ready: !at.length && !tools.length, inp:p.inp, out:Object.keys(p.out), temp:p.temp};
    });
  }
  /* 素材をまだどれにも加工できないとき、いちばん近い（足りない物が少ない）条件を文章で返す。加工できるか、使い道がなければ null */
  function processBlock(S, id){
    const ns = processNeeds(S, id); if(!ns.length || ns.some(n=>n.ready)) return null;
    const best = ns.slice().sort((a,b)=>(a.at.length?1:0)+a.tools.length-((b.at.length?1:0)+b.tools.length))[0];
    const parts = []; if(best.at.length) parts.push("設備「"+best.at.map(f=>IT[f].name).join("」か「")+"」"); if(best.tools.length) parts.push("道具「"+best.tools.map(t=>IT[t].name).join("」と「")+"」");
    return {need:best, text:"「"+IT[id].name+"」を加工する（"+D.ops[best.op].name+"）には、"+parts.join("と")+"が必要"};
  }

  /* ---------- 実験 ---------- */
  function facilityOps(S, fac){ return hasTool(S,fac) && IT[fac].facility ? IT[fac].ops : []; }

  function planExperiment(S, tray, fac, op){
    const tk = keyOf(tray);
    if(!tk) return {ok:false, kind:"empty", msg:"材料を入れてね"};
    for(const id in tray){ if(tray[id]<0 || !Number.isInteger(tray[id])) return {ok:false, kind:"bad", msg:"数がおかしいよ"}; if(tray[id]>cnt(S,id) && !vflag(S,"free")) return {ok:false, kind:"lack", msg:"「"+IT[id].name+"」が足りないよ"}; }
    if(!fac || !hasTool(S,fac)) return {ok:false, kind:"nofac", msg:"装置を選んでね"};
    if(!op || !IT[fac].ops.includes(op)) return {ok:false, kind:"noop", msg:"この装置ではその操作はできないよ"};
    const same = D.procs.filter(p=>keyOf(p.inp)===tk);
    const exact = same.filter(p=>p.op===op);
    const here = exact.find(p=>p.at.includes(fac));
    if(!here){
      if(exact.length){
        const hot = IT[fac].maxT||0, need = Math.max(...exact.map(p=>p.temp));
        if(hot && need>hot) return {ok:false, kind:"cold", msg:"温度が足りないみたい…。もっと高い温度が出せる装置が必要だ。", temp:hot};
        return {ok:false, kind:"place", msg:"操作は合っているけど、この装置ではうまくいかないみたい。別の装置で試そう。"};
      }
      if(same.length) return {ok:false, kind:"nearop", msg:"材料の組み合わせはいい感じ！ 別の操作を試してみよう。"};
      const superset = D.procs.find(p=>p.op===op && p.at.includes(fac) && Object.keys(tray).every(k=>tray[k]<=0 || p.inp[k]));
      if(superset) return {ok:false, kind:"partial", msg:"何か材料が足りない気がする…。"};
      return {ok:false, kind:"unmodeled", msg:"この組み合わせでは何も起きなかった。（このゲームにまだ登録されていない組み合わせです。材料は減らないよ）"};
    }
    const p = here;
    const missingTool = p.tools.find(t=>!hasTool(S,t));
    if(missingTool) return {ok:false, kind:"tool", msg:"「"+IT[missingTool].name+"」がないとできないよ。"};
    let batches = Infinity; const short=[];
    for(const id in p.inp){ const b = Math.floor((tray[id]||0)/p.inp[id]); if(b<1) short.push(IT[id].name+"を"+p.inp[id]+"個"); batches=Math.min(batches,b); }
    if(short.length) return {ok:false, kind:"qty", msg:"量が足りないよ。"+short.join("、")+"入れてね。"};
    batches = Math.min(batches, 20);
    const consume={}, produce={};
    for(const id in p.inp) consume[id]=p.inp[id]*batches;
    for(const id in p.out) produce[id]=p.out[id]*batches;
    return {ok:true, proc:p, batches, consume, produce};
  }

  function commit(S, consume, produce, route){
    const free = vflag(S,"free");
    if(!free) for(const id in consume){ if(cnt(S,id) < consume[id]) return {ok:false, msg:"材料が足りないよ"}; }
    if(!free) for(const id in consume){ S.inv[id] = cnt(S,id) - consume[id]; if(S.inv[id]<=0) delete S.inv[id]; }
    const news=[];
    for(const id in produce){ if(addItem(S,id,produce[id],route)) news.push(id); }
    return {ok:true, news};
  }

  function runExperiment(S, tray, fac, op, token){
    if(token !== S.seq) return {ok:false, kind:"dup", msg:"二重に実行されたので取り消したよ"};
    const pl = planExperiment(S,tray,fac,op);
    if(!pl.ok) return pl;
    const c = commit(S, pl.consume, pl.produce, pl.proc.id);
    if(!c.ok) return c;
    S.seq++;
    S.hist.unshift({t:Date.now(), k:"exp", proc:pl.proc.id, fac, b:pl.batches, inp:pl.consume, out:pl.produce});
    if(S.hist.length>200) S.hist.length=200;
    return Object.assign({ok:true, news:c.news}, pl);
  }

  /* ---------- 組み立て ---------- */
  function planCraft(S, c){
    const out = IT[c.out];
    if(c.lesson && !(S.space && S.space.lessons && S.space.lessons[c.lesson])) return {ok:false,kind:"lesson",msg:"宇宙へ：前提の実習を完了してください"};
    if(out.unique && has(S,c.out)) return {ok:false, kind:"own", msg:"もう持っているよ"};
    if(c.at && !hasTool(S,c.at)) return {ok:false, kind:"at", msg:"「"+IT[c.at].name+"」で作るよ"};
    const t = c.tools.find(x=>!hasTool(S,x)); if(t) return {ok:false, kind:"tool", msg:"「"+IT[t].name+"」が必要"};
    const short = vflag(S,"free") ? [] : Object.keys(c.inp).filter(id=>cnt(S,id)<c.inp[id]);
    if(short.length) return {ok:false, kind:"qty", msg:"材料が足りない："+short.map(id=>IT[id].name).join("、"), short};
    return {ok:true};
  }
  function runCraft(S, craftId, token){
    if(token !== S.seq) return {ok:false, kind:"dup", msg:"二重に実行されたので取り消したよ"};
    const c = D.crafts.find(x=>x.id===craftId); if(!c) return {ok:false, msg:"レシピがない"};
    if(c.space) return {ok:false,kind:"project",msg:"宇宙へ画面で製作してください（加工時間とまとめ製作に対応）"};
    const pl = planCraft(S,c); if(!pl.ok) return pl;
    const r = commit(S, c.inp, {[c.out]:c.qty}, c.id); if(!r.ok) return r;
    S.seq++;
    S.hist.unshift({t:Date.now(), k:"craft", craft:c.id, inp:c.inp, out:{[c.out]:c.qty}});
    if(S.hist.length>200) S.hist.length=200;
    return {ok:true, news:r.news, craft:c};
  }

  /* ---------- 情報の公開範囲・ヒント ---------- */
  function producers(id){
    return {procs:D.procs.filter(p=>p.out[id]), crafts:D.crafts.filter(c=>c.out===id), regions:D.regions.filter(r=>r.res.some(x=>x.id===id))};
  }
  function usesOf(id){
    return {procs:D.procs.filter(p=>p.inp[id]||p.tools.includes(id)||p.at.includes(id)), crafts:D.crafts.filter(c=>c.inp[id]||c.tools.includes(id)||c.at===id)};
  }
  function status(S,id){
    if(S.disc[id]) return "known";
    const pr = producers(id);
    const allKnown = inp => Object.keys(inp).every(k=>S.disc[k]);
    if(pr.procs.some(p=>allKnown(p.inp)) || pr.crafts.some(c=>allKnown(c.inp))) return "hinted";
    if(pr.regions.some(r=>regionOpen(S,r))) return "hinted";
    return "hidden";
  }
  function hint(S,id){
    const pr = producers(id), st = status(S,id);
    if(st==="hidden"){
      const p = pr.procs[0]||pr.crafts[0];
      if(p){ const k = Object.keys(p.inp).find(x=>S.disc[x]); if(k) return "「"+IT[k].name+"」が関係しているみたい。もっと研究を進めよう。"; }
      return "まだ手がかりがない…。ほかのものを先に見つけよう。";
    }
    if(pr.regions.length){ const r = pr.regions.find(r=>regionOpen(S,r))||pr.regions[0]; const all = r.res.filter(x=>x.id===id), free = all.find(x=>!x.need) , res = free||all[0];
      return r.name+"で見つかるかも。"+(res.need?"（「"+res.need.map(t=>IT[t].name).join("」か「")+"」が必要）":""); }
    const p = pr.procs.find(p=>Object.keys(p.inp).every(k=>S.disc[k]));
    if(p) return "「"+Object.keys(p.inp).map(k=>IT[k].name).join("」と「")+"」を「"+D.ops[p.op].name+"」してみよう。";
    const c = pr.crafts[0]; if(c) return "工作で作れるかも。材料は「"+Object.keys(c.inp).map(k=>IT[k].name).join("」「")+"」。";
    return "";
  }
  function suggest(S){
    // 今すぐ実行できて、新発見があるもの
    for(const c of D.crafts){ if(!S.disc[c.out] && planCraft(S,c).ok) return {kind:"craft", text:"工作で「"+IT[c.out].name+"」が作れるよ！"}; }
    for(const p of D.procs){
      if(!Object.keys(p.out).some(o=>!S.disc[o])) continue;
      const fac = p.at.find(f=>has(S,f)); if(!fac) continue;
      if(p.tools.some(t=>!has(S,t))) continue;
      if(Object.keys(p.inp).every(k=>cnt(S,k)>=p.inp[k]))
        return {kind:"exp", text:"「"+Object.keys(p.inp).map(k=>IT[k].name).join("」と「")+"」を「"+IT[fac].name+"」で試してみたら？ どの操作がいいかな？"};
    }
    for(const p of D.procs){
      if(!Object.keys(p.out).some(o=>!S.disc[o])) continue;
      if(Object.keys(p.inp).every(k=>S.disc[k]) && p.at.some(f=>has(S,f)) && p.tools.every(t=>has(S,t))){
        const lack = Object.keys(p.inp).filter(k=>cnt(S,k)<p.inp[k]);
        return {kind:"gather", text:"「"+lack.map(k=>IT[k].name).join("」「")+"」をもう少し集めると、新しい実験ができそう。"};
      }
    }
    for(const c of D.crafts){
      if(S.disc[c.out]) continue;
      const lack = Object.keys(c.inp).filter(k=>!S.disc[k]);
      if(lack.length===0) return {kind:"gather", text:"「"+IT[c.out].name+"」の材料を集めよう："+Object.keys(c.inp).map(k=>IT[k].name+"×"+c.inp[k]).join("、")};
    }
    return {kind:"none", text:"新しい地域に行ったり装置を作ったりすると、研究の幅が広がるよ。"};
  }

  function stageOf(S){
    if(S.verify && Number.isInteger(S.verify.stage) && D.stages[S.verify.stage]) return S.verify.stage;
    const d=S.disc; let s=0;
    if(has(S,"campfire")) s=1;
    if(s>=1 && d.pot && has(S,"kiln")) s=2;
    if(s>=2 && has(S,"furnace") && (d.glass||has(S,"still"))) s=3;
    if(s>=3 && has(S,"blastfurnace") && (has(S,"steamengine")||has(S,"generator"))) s=4;
    if(s>=4 && has(S,"generator") && (d.pe||d.aluminum||d.solarcell)) s=5;
    if(S.space && S.space.firstClear && D.stages[6]) s=Math.max(s,6);   // 宇宙へ到達（表示だけ。レシピの判定には使わない）
    return s;
  }
  function missionIndex(S){ const i = D.missions.findIndex(m=>!m.done(S)); return i<0?D.missions.length-1:i; }

  /* ---------- 図鑑の集計 ---------- */
  function collectable(){ return Object.keys(IT); }
  function tagProgress(S){
    return D.TAGS.map(t=>{ const ids = collectable().filter(id=>IT[id].tags.includes(t)); return {tag:t, total:ids.length, got:ids.filter(id=>S.disc[id]).length}; }).filter(x=>x.total);
  }

  /* ---------- セーブ ---------- */
  const MIGRATIONS = {
    0: s => { // v0（試作）→v1：inventory/found 形式からの移行
      const n = newState();
      if(s.inventory) n.inv = Object.assign({}, s.inventory);
      if(Array.isArray(s.found)) s.found.forEach(id=>{ n.disc[id]={first:Date.now(),made:1,total:1,routes:[],best:0}; });
      return n;
    },
    1: s => { s.nature = {}; return s; },  // v1→v2：自然物・採取地点の状態（最初は何も変化していない）
    2: s => { s.build = {}; s.camera = {}; return s; },  // v2→v3：建物の自由設置・カメラの設定（これまでの建物は決まった場所のまま）
    3: s => { s.worldVer = 1; return s; },
    4: s => { s.space = {version:1}; return s; }  // v3→v4：地形の版を記録（これまでのセーブは旧世界＝版1。位置の確認は読み込み後に UI が地形関数で行う）
  };
  const ALIASES = {}; // 名称変更したIDの対応表（例：{"oldId":"newId"}）
  function migrate(raw){
    let s = raw; let v = typeof s.v==="number" ? s.v : 0;
    while(v < SCHEMA){ s = MIGRATIONS[v](s); v++; s.v=v; }
    const n = Object.assign(newState(), s);
    // ID の別名を解決。未知の ID は消さずに残す（将来のデータ追加に備える）
    for(const box of ["inv","disc"]){ for(const k of Object.keys(n[box])){ if(ALIASES[k]){ n[box][ALIASES[k]] = n[box][k]; delete n[box][k]; } } }
    for(const k in n.inv){ const x = n.inv[k]; if(typeof x!=="number" || !isFinite(x) || x<=0) delete n.inv[k]; else n.inv[k]=Math.floor(x); }
    if(!Array.isArray(n.hist)) n.hist=[]; if(!Array.isArray(n.auto)) n.auto=[];
    if(!n.nature || typeof n.nature!=="object" || Array.isArray(n.nature)) n.nature={};
    if(!n.build || typeof n.build!=="object" || Array.isArray(n.build)) n.build={};
    for(const k of Object.keys(n.build)){ const b=n.build[k]; if(!b || typeof b!=="object" || !(b.removed===true || (isFinite(b.x) && isFinite(b.z) && isFinite(b.rot)))) delete n.build[k]; }
    if(!n.camera || typeof n.camera!=="object" || Array.isArray(n.camera)) n.camera={};
    if(!(typeof n.worldVer==="number" && isFinite(n.worldVer))) n.worldVer = 1;
    for(const k of Object.keys(n.nature)){ const x=n.nature[k]; if(!x || typeof x!=="object" || !(x.u>0) || !isFinite(x.u)) delete n.nature[k]; else { x.u=Math.floor(x.u); if(x.t!==undefined && !isFinite(x.t)) delete x.t; } }
    return n;
  }
  function serialize(S){ return JSON.stringify(S); }

  /* ---------- 検証モード（全解放）：通常のセーブとは別の状態を作る ----------
     base を渡すとその写し（通常セーブを引き継ぐとき）。base 自体は変えない。
     登録されているすべての物質・道具・設備を図鑑に載せ、保管できるものは在庫に入れる（保管できないもの＝store:false は在庫に入れない）。 */
  const VERIFY_DEFAULTS = {on:true, free:true, tools:true, locks:true, instant:true, stage:null, placed:[], extra:[]};
  function fillStorable(S, n){
    let k=0; for(const id in IT){ const it=IT[id]; if(it.store===false) continue; S.inv[id] = it.unique ? 1 : Math.max(cnt(S,id), n||99); k++; } return k;
  }
  function makeVerifyState(base){
    const S = base ? migrate(JSON.parse(JSON.stringify(base))) : newState();
    S.verify = Object.assign({}, VERIFY_DEFAULTS, {placed:[], extra:[], made:Date.now(), from: base ? "copy" : "new"});
    for(const id in IT){ discover(S,id); const r=S.disc[id]; if(!r.made){ r.made=1; r.total=Math.max(r.total,1); } if(IT[id].purity) r.best=Math.max(r.best, IT[id].purity); }
    fillStorable(S, 99);
    S.flags = Object.assign({hero:"girl"}, S.flags, {intro:1});
    return S;
  }
  function deserialize(txt){ const o = JSON.parse(txt); if(!o || typeof o!=="object") throw new Error("形式が違います"); return migrate(o); }

  /* ---------- テスト ---------- */
  function runTests(){
    const R=[]; const ok=(name,cond,detail)=>R.push({name,pass:!!cond,detail:detail||""});
    // 1 説明の徹底
    const noKid = Object.values(IT).filter(i=>!i.kid||!i.more||!i.name||!i.yomi||!i.icon);
    ok("すべての物質・道具に「やさしい説明」と「くわしく」がある", noKid.length===0, noKid.map(i=>i.id).join(","));
    const noOpKid = Object.keys(D.ops).filter(o=>!D.ops[o].kid);
    ok("すべての実験操作に説明がある", noOpKid.length===0, noOpKid.join(","));
    const noWhy = D.procs.filter(p=>!p.why); ok("すべての反応に「何が起きたの？」の説明がある", noWhy.length===0, noWhy.map(p=>p.id).join(","));
    const noHow = D.crafts.filter(c=>!c.how); ok("すべての工作に作り方の説明がある", noHow.length===0, noHow.map(c=>c.id).join(","));
    // 2 参照整合
    const bad=[];
    D.procs.forEach(p=>{ [...Object.keys(p.inp),...Object.keys(p.out),...p.tools,...p.at].forEach(id=>{ if(!IT[id]) bad.push(p.id+":"+id); }); if(!D.ops[p.op]) bad.push(p.id+":op"); p.at.forEach(f=>{ if(IT[f]&&!IT[f].ops.includes(p.op)) bad.push(p.id+":"+f+"は"+p.op+"不可"); }); });
    D.crafts.forEach(c=>{ [c.out,...Object.keys(c.inp),...c.tools].concat(c.at?[c.at]:[]).forEach(id=>{ if(!IT[id]) bad.push(c.id+":"+id); }); });
    D.regions.forEach(r=>r.res.concat(r.rare||[]).forEach(x=>{ if(!IT[x.id]) bad.push(r.id+":"+x.id); }));
    ok("データの参照（ID・装置と操作の対応）がすべて正しい", bad.length===0, bad.join(" "));
    // 3 元素保存（生成物の元素 ⊆ 原料の元素＋空気）
    const viol=[];
    D.procs.forEach(p=>{ const src=new Set(); Object.keys(p.inp).forEach(k=>IT[k].el.forEach(e=>src.add(e))); if(p.air) AIR.forEach(e=>src.add(e));
      Object.keys(p.out).forEach(k=>IT[k].el.forEach(e=>{ if(!src.has(e)) viol.push(p.id+"→"+k+":"+e); })); });
    ok("元素保存チェック（原料にない元素が生成物に現れない）", viol.length===0, viol.join(" "));
    // 4 到達可能性
    /* 採取地点の道具の条件（need）も入れる：道具がいる地点は、その道具のどれかが作れるようになってから。地域の鍵はない */
    const reach = new Set(); D.regions.filter(r=>!r.future).forEach(r=>{ r.res.forEach(x=>{ if(!x.need) reach.add(x.id); }); (r.rare||[]).forEach(x=>reach.add(x.id)); });
    let grew=true;
    while(grew){ grew=false;
      D.regions.filter(r=>!r.future).forEach(r=>r.res.forEach(x=>{ if(!reach.has(x.id) && x.need && x.need.some(t=>reach.has(t))){ reach.add(x.id); grew=true; } }));
      D.crafts.forEach(c=>{ if(!reach.has(c.out) && Object.keys(c.inp).every(k=>reach.has(k)) && c.tools.every(t=>reach.has(t)) && (!c.at||reach.has(c.at))){ reach.add(c.out); grew=true; } });
      D.procs.forEach(p=>{ if(Object.keys(p.inp).every(k=>reach.has(k)) && p.tools.every(t=>reach.has(t)) && p.at.some(f=>reach.has(f))){ Object.keys(p.out).forEach(o=>{ if(!reach.has(o)){ reach.add(o); grew=true; } }); } });
    }
    const unreach = Object.keys(IT).filter(id=>!reach.has(id));
    ok("すべての物質・道具が自然資源から到達できる（採取地点の道具の条件も入れて。条件の循環で行き止まりにならない）", unreach.length===0, unreach.join(","));
    // 4b 地域の鍵の廃止と、加工能力による進行（2026-11-11）
    const N0 = newState();
    ok("新しいゲームで、すべての地域（準備中を除く）へ最初から入れる", D.regions.filter(r=>!r.future).every(r=>regionOpen(N0,r)) && D.regions.every(r=>!r.unlock));
    ok("地域が理由で採取を断らない（道具のいらない採取地点は、新しいゲームでどこでも採れる）", D.regions.every(r=>r.res.every(x=>x.need || gatherInfo(N0,r,x).ok)));
    const mine = D.regions.find(r=>r.id==="mine"), hard = mine.res.filter(x=>x.need);
    ok("硬い鉱脈には道具がいるが、同じ鉱石の落ちているかけらは手で拾える", hard.length>0 && hard.every(x=>!gatherInfo(N0,mine,x).ok && /かけら/.test(gatherInfo(N0,mine,x).reason) && mine.res.some(y=>y.loose && y.id===x.id && gatherInfo(N0,mine,y).ok)));
    const NS = newState(); const hv = harvestDeposit(NS,"mine","hematite",{token:NS.seq, rng:()=>0.99});
    ok("最初から鉱石（赤鉄鉱）を採って持ち帰れる。拾っただけで金属・設備は増えない", hv.ok && NS.inv.hematite>=1 && !NS.inv.iron && !NS.inv.pigiron && !NS.inv.furnace && !NS.inv.bench && Object.keys(NS.inv).length===1, JSON.stringify(NS.inv));
    const pb = processBlock(NS,"hematite");
    ok("加工できないときは、足りない設備・道具を具体的に言う（赤鉄鉱：作業台とハンマー）", pb && /作業台/.test(pb.text) && /ハンマー/.test(pb.text), pb && pb.text);
    const NL = newState(); const l1 = harvestDeposit(NL,"mine","sphalerite-loose",{token:NL.seq, rng:()=>0.99, now:5}), l2 = harvestDeposit(NL,"mine","sphalerite-loose",{token:NL.seq, rng:()=>0.99, now:5}), l3 = harvestDeposit(NL,"mine","sphalerite-loose",{token:NL.seq, rng:()=>0.99, now:5});
    ok("かけらは少しだけ（2回）で、別の鍵で残量を数える（鉱脈の残量は減らない）", l1.ok && l2.ok && !l3.ok && NL.inv.sphalerite===2 && !NL.nature[depositId("mine","sphalerite")] && depositRule(NL,"mine","sphalerite-loose").uses===2);
    const skip = D.procs.find(p=>p.at.includes("refinery")), SK = newState(); SK.inv.refinery = 1; Object.keys(skip.inp).forEach(k=>SK.inv[k]=skip.inp[k]); skip.tools.forEach(t=>SK.inv[t]=1);
    const sk = planExperiment(SK, skip.inp, "refinery", skip.op);
    ok("文明の段階が低くても（段階0）、材料と設備・道具がそろえば上位の加工ができる", stageOf(SK)===0 && sk.ok, skip.id+" "+JSON.stringify(sk.msg||""));
    const volc = D.regions.find(r=>r.id==="volcano");
    ok("火山地帯の採取地点は、以前の鍵（sulfur・obsidian）を引き継ぎ、ほかは別の鍵（同じ地域の中で鍵が重ならない）", volc.res.some(x=>!x.key && x.id==="sulfur") && volc.res.some(x=>!x.key && x.id==="obsidian") && D.regions.every(r=>new Set(r.res.map(resKey)).size===r.res.length));
    // 5 エンジン動作
    let S = newState();
    S.inv = {twig:4, campfire:1}; S.disc.twig={first:0,made:1,total:4,routes:[],best:0};
    const r1 = runExperiment(S,{twig:4},"campfire","burn",S.seq);
    ok("実験で原料が減り、生成物が増える", r1.ok && !S.inv.twig && S.inv.ash===2 && !S.inv.co2 && S.disc.co2, JSON.stringify(S.inv));
    const r2 = runExperiment(S,{twig:4},"campfire","burn",S.seq);
    ok("材料がないと実行できない（負の数にならない）", !r2.ok && !S.inv.twig);
    const seq0 = S.seq; S.inv.twig=2; const t = S.seq;
    runExperiment(S,{twig:2},"campfire","burn",t); const r3 = runExperiment(S,{twig:2},"campfire","burn",t);
    ok("二重実行でアイテムが複製されない", !r3.ok && r3.kind==="dup" && S.seq===seq0+1);
    S.inv.ash=1; S.inv.leaves=1;
    const before = JSON.stringify(S.inv); const r4 = runExperiment(S,{ash:1,leaves:1},"campfire","heat",S.seq);
    ok("登録されていない組み合わせは何も起きず材料も減らない", !r4.ok && r4.kind==="unmodeled" && JSON.stringify(S.inv)===before);
    S.inv.limestone=1; const r5 = planExperiment(S,{limestone:1},"campfire","fire");
    ok("温度が足りない装置では反応しない（石灰石×たき火）", !r5.ok && r5.kind==="cold");
    const r6 = planExperiment(S,{twig:1},"bench","burn"); ok("持っていない装置は使えない", !r6.ok);
    const S2 = newState(); S2.inv={flint:1,cobble:1}; const c1 = runCraft(S2,"c_knife",S2.seq); const c2 = runCraft(S2,"c_knife",S2.seq);
    ok("工作で材料を消費して道具ができる・同じ道具は2つ作れない", c1.ok && S2.inv.knife===1 && !S2.inv.flint && !c2.ok);
    const S3 = newState(); const g = gather(S3,"river","river"); ok("道具がないと採取できない（川の水には土器がいる）", !g.ok);
    const g2 = gather(S3,"forest","twig",{rng:()=>0.99}); ok("採取で資源と発見記録が増える", g2.ok && S3.inv.twig===2 && S3.disc.twig);
    const g3 = gather(S3,"forest","twig",{rng:()=>0.01}); ok("会心の採取で量が2倍になる", g3.ok && g3.crit && g3.n===4);
    const S4 = newState(); let got=false; for(let i=0;i<40;i++){ const x=gather(S4,"forest","twig",{rng:()=>0.99}); if(x.rares.includes("amber")) got=true; }
    ok("探索度レベル2で、その地域の珍しい発見が必ず見つかる", got && S4.disc.amber && exploreLv(S4,"forest")>=2);
    // 6 セーブ互換
    const txt = serialize(S); const L = deserialize(txt);
    ok("セーブ→ロードで状態が同じになる", JSON.stringify(L.inv)===JSON.stringify(S.inv) && Object.keys(L.disc).length===Object.keys(S.disc).length);
    const old = deserialize(JSON.stringify({inventory:{twig:3,future_item:2}, found:["twig"]}));
    ok("古い形式（スキーマv0）のセーブを移行できる・未知のIDも消さない", old.v===SCHEMA && old.inv.twig===3 && old.inv.future_item===2 && old.disc.twig);
    const neg = deserialize(JSON.stringify({v:1, inv:{twig:-5, ash:2.7}}));
    ok("壊れた数量（負の数・小数）を修正する", !neg.inv.twig && neg.inv.ash===2);
    const v1 = deserialize(JSON.stringify({v:1, inv:{twig:2}, disc:{twig:{first:1,made:1,total:2,routes:[],best:0}}, pos:{x:-20,z:20}}));
    ok("スキーマv1のセーブを最新へ移行できる（自然物の状態は空・座標は残る・建物は決まった場所のまま）", v1.v===SCHEMA && v1.inv.twig===2 && v1.pos.x===-20 && JSON.stringify(v1.nature)==="{}" && JSON.stringify(v1.build)==="{}");
    const v2 = deserialize(JSON.stringify({v:2, inv:{bench:1}, disc:{}, pos:{x:-18,z:21}, nature:{"twig:1,2":{u:1,t:5}}}));
    ok("スキーマv2のセーブを最新へ移行できる（採取状態・座標はそのまま、置き場所とカメラは空）", v2.v===SCHEMA && v2.nature["twig:1,2"].u===1 && v2.pos.z===21 && JSON.stringify(v2.build)==="{}" && JSON.stringify(v2.camera)==="{}");
    const v3 = deserialize(JSON.stringify({v:3, inv:{bench:1}, disc:{}, pos:{x:-18,z:21,dir:"up"}, nature:{"tree:1,2":{u:1}}, build:{"st-bench":{x:1,z:2,rot:0.5}}, camera:{yaw:90}}));
    ok("スキーマv3のセーブをv4へ移行できる（地形の版は旧世界=1、位置・建物・採取状態・カメラはそのまま）", v3.v===SCHEMA && v3.worldVer===1 && v3.pos.x===-18 && v3.pos.dir==="up" && v3.build["st-bench"].rot===0.5 && v3.nature["tree:1,2"].u===1 && v3.camera.yaw===90);
    ok("新しいゲームは今の地形の版", newState().worldVer===WORLD_VER);
    const badB = deserialize(JSON.stringify({v:3, build:{"st-bench":{x:1,z:2,rot:0.5}, "st-fire":{removed:true}, "st-kiln":{x:"a"}, "st-x":null}}));
    ok("壊れた置き場所の記録は捨てる（正しいものは残す）", badB.build["st-bench"].rot===0.5 && badB.build["st-fire"].removed===true && !badB.build["st-kiln"] && !("st-x" in badB.build));
    const badN = deserialize(JSON.stringify({v:2, nature:{"t:1,2":{u:-1}, "d:river:cobble":{u:2.5,t:"x"}}}));
    ok("壊れた自然物の状態を修正する", !badN.nature["t:1,2"] && badN.nature["d:river:cobble"].u===2 && badN.nature["d:river:cobble"].t===undefined);
    // 7 残量つきの採取（地域の資源）
    const S5 = newState(); const T0 = 1000000; let n5=0;
    for(let i=0;i<9;i++){ const h=harvestDeposit(S5,"river","cobble",{token:S5.seq, now:T0, rng:()=>0.99}); if(h.ok) n5++; }
    ok("採取地点は取り尽くすと採れない（満タン5回）", n5===5 && !harvestDeposit(S5,"river","cobble",{token:S5.seq, now:T0}).ok);
    ok("石の採取地点は90秒で戻る・それより前は戻らない", !depositInfo(S5,"river","cobble",T0+89000).ok && depositInfo(S5,"river","cobble",T0+90000).ok);
    const S6 = newState(); const tk=S6.seq; const a1=harvestDeposit(S6,"forest","twig",{token:tk,rng:()=>0.99}); const a2=harvestDeposit(S6,"forest","twig",{token:tk,rng:()=>0.99});
    ok("同じ操作の二重実行で素材が増えない（採取）", a1.ok && !a2.ok && a2.kind==="dup" && S6.inv.twig===2);
    const far = harvestDeposit(newState(),"forest","twig",{token:0, pos:{x:0,z:0}});
    ok("離れた場所からは採取できない", !far.ok && far.kind==="far");
    const S7 = newState(); S7.inv.basket=1; S7.auto=[{r:"river",id:"cobble"}]; for(let i=0;i<5;i++) S7.nature[depositId("river","cobble")]={u:5+exploreLv(S7,"river"), t:Date.now()};
    ok("自動採取も残量を守る（取り尽くした所からは集めない）", autoTick(S7).length===0 && !S7.inv.cobble);
    return R;
  }

  return {WORLD_VER, addItem, hasTool, vflag, makeVerifyState, fillStorable, VERIFY_DEFAULTS, SCHEMA, exploreLv, nextLv, LV, newState, cnt, has, gather, gatherInfo, collect, stockOf, useStock, harvestDeposit, depositInfo, depositRule, depositId, depositPos, resKey, REACH, regionOpen, processNeeds, processBlock, autoSlots, autoTick, facilityOps, planExperiment, runExperiment,
          planCraft, runCraft, producers, usesOf, status, hint, suggest, stageOf, missionIndex, tagProgress, serialize, deserialize, runTests};
})(typeof DATA!=="undefined"?DATA:require("./data.js"));
if (typeof module!=="undefined") module.exports = ENGINE;
