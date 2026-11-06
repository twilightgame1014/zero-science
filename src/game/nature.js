/* ===================== フィールドの自然物（ゲームロジック。UI・描画から独立） =====================
   木・岩・小石・落ち枝・草むら・やぶを「ゲーム側の正本」として生成し、
   ID・位置・向き・大きさ・衝突形状・採取条件・残量・採取後の状態を管理する。
   描画モジュール（Muse）は、ここで決めた状態を受け取って表示するだけ（素材の付与・保存はしない）。

   生成の規則：描画モジュールと同じ地形関数（terrainHeight・川の位置）と固定の乱数の種から決める。
   同じ規則なら何度作っても同じ配置・同じIDになる。ID は「種類:x,z（0.1マス単位）」。
   状態の保存：変化したものだけを S.nature[ID] に {u:使った回数, t:取り尽くした時刻} で保存する（エンジンの stockOf）。 */
var NATURE = (function(){
  const SEED = 20261106;
  const PLAYER_R = 0.35;          // 主人公の当たり判定の半径
  const WORLD_R = 56;             // 歩ける範囲：-56〜56 の正方形（地形は120×120。端の丘の手前まで）
  const inWorld = (x,z,m)=> Math.abs(x) <= WORLD_R-(m||0) && Math.abs(z) <= WORLD_R-(m||0);
  const REGION_R = 9;             // 地域の半径（ゲーム側の取り決め）
  const MIN = 60000;

  /* 種類ごとの決まり。
     r：地面上の当たり判定の半径（大きさ1のとき）。block：歩行を妨げるか（採取後は妨げない）。
     uses：採れる回数。need：必要な道具（どれか1つ）。yields：1回で得る素材。after：採取後の見た目。
     regrow：取り尽くしてから元に戻るまで（null は戻らない）。work：採取にかかる時間（ミリ秒）。 */
  const KINDS = {
    tree:   {name:"木",       icon:"🌳", r:0.34, block:true,  uses:2, need:["axe","ironaxe"], bonus:"ironaxe", yields:{log:1}, after:"stump",  regrow:30*MIN, work:900, verb:"切る"},
    rock:   {name:"岩",       icon:"🪨", r:0.80, block:true,  uses:3, need:["hammer","pickaxe","ironpick"], bonus:"ironpick", yields:{cobble:1}, after:"rubble", regrow:null, work:900, verb:"割る"},
    pebble: {name:"小石",     icon:"🪨", r:0.22, block:false, uses:1, need:null, yields:{cobble:1}, after:"gone", regrow:null, work:350, verb:"拾う"},
    twig:   {name:"落ち枝",   icon:"🪵", r:0.25, block:false, uses:1, need:null, yields:{twig:2}, after:"gone", regrow:8*MIN, work:350, verb:"拾う"},
    grass:  {name:"草むら",   icon:"🌾", r:0.45, block:false, uses:1, need:null, yields:{grass:2}, after:"cut", regrow:3*MIN, work:500, verb:"刈る"},
    bush:   {name:"やぶ",     icon:"🌿", r:0.55, block:false, uses:2, need:null, yields:{vine:1, leaves:1}, after:"cut", regrow:4*MIN, work:600, verb:"集める"},
  };
  /* 種類の中の違い（同じ見た目の仲間で、得られる素材が違うもの） */
  const VARIANTS = {
    "pebble:flint": {name:"火打ち石", icon:"🔪", yields:{flint:1}},
    "rock:basalt":  {name:"黒い岩（玄武岩）", yields:{basalt:1, cobble:1}},
  };

  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  const smooth = (a,b,x)=>{ const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };

  /* T：地形関数 {terrainHeight(x,z,cfg), distanceToRiver(x,z), cfg}。D：ゲームデータ。E：エンジン */
  function create(D, E, T){
    const cfg = T.cfg, wl = cfg.world.waterLevel;
    const H = (x,z)=>T.terrainHeight(x,z,cfg);
    const rng = mulberry32(SEED);
    const objs = [];
    const deps = [];
    D.regions.forEach(r=>{ if(r.w) r.res.forEach(res=>{ const p=E.depositPos(r,res); deps.push({x:p.x, z:p.z}); }); });
    const lockedRegions = D.regions.filter(r=>r.w && r.unlock);
    const base = D.base;
    const regionAt = (x,z)=>{ let best=null, bd=1e9; D.regions.forEach(r=>{ if(!r.w) return; const d=Math.hypot(x-r.w.x,z-r.w.z); if(d<bd){bd=d;best=r;} }); return bd<=REGION_R+3?best:null; };
    const near = (ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);
    const slope = (x,z)=>Math.max(Math.abs(H(x+0.6,z)-H(x-0.6,z)), Math.abs(H(x,z+0.6)-H(x,z-0.6)))/1.2;

    /* 置ける場所か */
    function fits(kind, x, z, s){
      const K = KINDS[kind], rr = K.r*s;
      if(!inWorld(x,z,3)) return false;
      const dr = T.distanceToRiver(x,z);
      if(kind==="pebble" ? dr < 4.0 : dr < 5.6) return false;
      if(H(x,z) < wl + 0.15) return false;
      if(slope(x,z) > (K.block ? 0.55 : 0.9)) return false;
      if(lockedRegions.some(r=>near(x,z,r.w.x,r.w.z) < REGION_R + 2)) return false;
      if(K.block && near(x,z,base.x,base.z) < 15) return false;          // 拠点の台地（建物を建てる場所）
      if(!K.block && near(x,z,base.x,base.z) < 3.5) return false;
      if(deps.some(p=>near(x,z,p.x,p.z) < 2.2)) return false;            // 地域の採取地点の近く
      for(const o of objs){
        const d = near(x,z,o.x,o.z);
        const gap = (K.block && o.block) ? rr + o.r + 1.4 : (K.block || o.block) ? rr + o.r + 0.5 : 0.8;
        if(d < gap) return false;
      }
      return true;
    }
    function add(kind, x, z, s, variant){
      const K = KINDS[kind];
      const id = kind + ":" + Math.round(x*10) + "," + Math.round(z*10);
      if(objs.some(o=>o.id===id)) return null;
      const reg = regionAt(x,z);
      const o = {id, kind, variant:variant||null, x:+x.toFixed(2), z:+z.toFixed(2), rot:+(rng()*Math.PI*2).toFixed(3), scale:+s.toFixed(2),
                 r:+(K.r*s).toFixed(3), block:K.block, region: reg ? reg.id : null};
      objs.push(o); return o;
    }
    /* 重み付きで count 個を置く */
    function scatter(kind, count, weight, size, variantOf, tries){
      let placed=0, guard=(tries||count*80);
      while(placed<count && guard-- > 0){
        const x=(rng()*2-1)*53, z=(rng()*2-1)*53, s=size();
        if(rng() > weight(x,z)) continue;
        if(!fits(kind,x,z,s)) continue;
        if(add(kind,x,z,s,variantOf?variantOf(x,z):null)) placed++;
      }
      return placed;
    }
    const R = id=>D.regions.find(r=>r.id===id).w;
    const fw = R("forest"), gw = R("grassland"), mw = R("mountain"), rw = R("river");
    const g2 = (x,z,c,s)=>Math.exp(-((x-c.x)**2+(z-c.z)**2)/(2*s*s));
    const highland = (x,z)=>smooth(14,40,x - z*0.35);

    /* はじめに必ずあるもの：拠点のまわりの落ち枝・小石、川岸の火打ち石（道具がなくても最初の道具へ進める） */
    [[4.2,0.6],[5.2,2.4],[-4.4,3.2],[3.0,-4.6],[-2.6,-5.2],[6.4,-1.8]].forEach(([dx,dz])=>{ const x=base.x+dx, z=base.z+dz; if(fits("twig",x,z,1)) add("twig",x,z,1); });
    [[-5.0,-1.2],[1.4,5.6],[-6.2,2.0],[5.8,4.4]].forEach(([dx,dz])=>{ const x=base.x+dx, z=base.z+dz; if(fits("pebble",x,z,1.1)) add("pebble",x,z,1.1); });
    for(let i=0, placed=0; i<400 && placed<6; i++){ const a=rng()*Math.PI*2, d=3+rng()*9; const x=rw.x+Math.cos(a)*d, z=rw.z+Math.sin(a)*d;
      const dr=T.distanceToRiver(x,z); if(dr<4.2||dr>7.5) continue; if(fits("pebble",x,z,1.1) && add("pebble",x,z,1.1,"flint")) placed++; }

    scatter("tree", 85, (x,z)=>0.06 + 0.9*g2(x,z,fw,16) + (x<-8 && z>-10 ? 0.25 : 0) - 0.5*highland(x,z), ()=>0.8+rng()*0.6);
    scatter("rock", 46, (x,z)=>0.08 + 0.8*highland(x,z) + 0.6*g2(x,z,mw,12) + 0.2*g2(x,z,rw,12), ()=>0.7+rng()*0.7,
      (x,z)=> highland(x,z)>0.4 || near(x,z,mw.x,mw.z)<14 ? "basalt" : null);
    // 落ち枝は木の根もとに
    const trees = objs.filter(o=>o.kind==="tree");
    for(let i=0, placed=0; i<2000 && placed<44; i++){ const t=trees[Math.floor(rng()*trees.length)]; const a=rng()*Math.PI*2, d=t.r+0.9+rng()*1.6;
      const x=t.x+Math.cos(a)*d, z=t.z+Math.sin(a)*d; if(fits("twig",x,z,1) && add("twig",x,z,1)) placed++; }
    scatter("pebble", 34, (x,z)=>{ const dr=T.distanceToRiver(x,z); return 0.1 + (dr>4 && dr<8 ? 0.8 : 0) + 0.3*highland(x,z); }, ()=>0.9+rng()*0.4,
      (x,z)=>{ const dr=T.distanceToRiver(x,z); return dr<8 && rng()<0.35 ? "flint" : null; });
    scatter("grass", 40, (x,z)=>0.08 + 0.9*g2(x,z,gw,15) + 0.3*g2(x,z,base,14) - 0.6*highland(x,z), ()=>0.9+rng()*0.5);
    scatter("bush", 26, (x,z)=>0.05 + 0.8*g2(x,z,fw,18) - 0.6*highland(x,z), ()=>0.9+rng()*0.4);

    const byId = new Map(objs.map(o=>[o.id,o]));
    /* 木の姿をしている地域の採取地点（枝の多い木・やにの出る木など）は、幹に当たり判定を持つ固定の障害物 */
    const TREE_DEPOSITS = ["twig","log","resin","wax","bark","seed"];
    const statics = [];
    D.regions.forEach(r=>{ if(r.w) r.res.forEach(res=>{ if(!TREE_DEPOSITS.includes(res.id)) return; const p=E.depositPos(r,res);
      statics.push({id:E.depositId(r.id,res.id), kind:"deposit", x:p.x, z:p.z, r:0.38, block:true, static:true}); }); });

    /* ---------- 状態 ---------- */
    const kindOf = o=>KINDS[o.kind];
    const nameOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].name) || kindOf(o).name;
    const iconOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].icon) || kindOf(o).icon;
    const yieldsOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].yields) || kindOf(o).yields;
    function stock(S, o, now){ const K=kindOf(o); return E.stockOf(S, o.id, K.uses, K.regrow, now); }
    function present(S, o, now){ return stock(S,o,now).left > 0; }
    /* 当たり判定に使うか（取り尽くした木・岩は切り株・残骸になり、歩行を妨げない） */
    function solid(S, o, now){ return o.static ? true : o.block && present(S,o,now); }
    /* 採取できるか・できない理由・得られる素材 */
    function info(S, o, now){
      const K=kindOf(o), k=stock(S,o,now), base=yieldsOf(o), y={};
      Object.keys(base).forEach(id=>{ y[id]=base[id]; });
      if(K.bonus && E.has(S,K.bonus)) Object.keys(y).forEach((id,i)=>{ if(i===0) y[id]+=1; });
      const out = {name:nameOf(o), icon:iconOf(o), verb:K.verb, yields:y, left:k.left, uses:K.uses, until:k.until, need:K.need, after:K.after};
      if(k.left<=0) return Object.assign(out, {ok:false, kind:"empty", reason: k.until ? "取り尽くした（しばらくすると戻る）" : K.after==="stump" ? "切り株になった" : K.after==="rubble" ? "砕けた" : "もうない"});
      if(K.need && !K.need.some(t=>E.has(S,t))) return Object.assign(out, {ok:false, kind:"tool", reason:"「"+K.need.map(t=>D.items[t].name).join("」か「")+"」が必要"});
      return Object.assign(out, {ok:true});
    }
    /* 描画モジュールへ渡す状態（表示専用） */
    function visual(S, o, now){
      const k = stock(S,o,now), K=kindOf(o);
      return {id:o.id, kind:o.kind, variant:o.variant, position:{x:o.x, z:o.z}, rotationY:o.rot, scale:o.scale,
              state: k.left>0 ? "intact" : K.after, collider: {shape:"circle", r:o.r, solid: solid(S,o,now)}, uses:K.uses, left:k.left};
    }
    /* 採取する。opt.pos：主人公の位置（離れていたら採れない）／opt.token：S.seq と一致したときだけ確定（二重取得防止） */
    function harvest(S, id, opt){
      opt=opt||{}; const now=opt.now||Date.now(); const o=byId.get(id);
      if(!o) return {ok:false, reason:"見つからない"};
      if(opt.token!==S.seq) return {ok:false, kind:"dup", reason:"もう採取した"};
      if(!opt.pos || reachGap(o, opt.pos) > E.REACH) return {ok:false, kind:"far", reason:"遠すぎる。もっと近づこう"};
      const inf = info(S,o,now); if(!inf.ok) return inf;
      S.seq++;
      const K=kindOf(o);
      E.useStock(S, o.id, K.uses, K.regrow, now);
      const c = E.collect(S, o.region, inf.yields, opt);
      const k = stock(S,o,now);
      return {ok:true, got:c.got, crit:c.crit, rares:c.rares, lvUp:c.lvUp, news:c.news, left:k.left, depleted:k.left<=0, after:K.after, name:inf.name};
    }
    /* 対象の外周までの距離 */
    function reachGap(o, p){ return Math.max(0, Math.hypot(p.x-o.x, p.z-o.z) - o.r); }

    /* ---------- 当たり判定（地面上の円と空間分割） ---------- */
    const CELL = 4, cells = new Map();
    const ck = (cx,cz)=>cx+","+cz;
    objs.concat(statics).forEach(o=>{ if(!o.block) return; const cx=Math.floor(o.x/CELL), cz=Math.floor(o.z/CELL); const k=ck(cx,cz); if(!cells.has(k)) cells.set(k,[]); cells.get(k).push(o); });
    function nearbySolids(S, x, z, now){
      const out=[]; const cx=Math.floor(x/CELL), cz=Math.floor(z/CELL);
      for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){ const a=cells.get(ck(cx+i,cz+j)); if(a) a.forEach(o=>{ if(solid(S,o,now)) out.push(o); }); }
      return out;
    }
    const lockedNow = S=>lockedRegions.filter(r=>!E.regionOpen(S,r));
    /* その場所に主人公が立てるか */
    function free(S, x, z, now){
      if(!inWorld(x,z)) return false;
      for(const r of lockedNow(S)) if(Math.hypot(x-r.w.x,z-r.w.z) < REGION_R) return false;
      for(const o of nearbySolids(S,x,z,now)) if(Math.hypot(x-o.x,z-o.z) < o.r + PLAYER_R) return false;
      return true;
    }
    /* 円の外へ押し出す（重なっていれば外周へ） */
    function depenetrate(S, p, now){
      for(let it=0; it<3; it++){
        let moved=false;
        for(const o of nearbySolids(S,p.x,p.z,now)){
          const dx=p.x-o.x, dz=p.z-o.z, d=Math.hypot(dx,dz), min=o.r+PLAYER_R;
          if(d < min){ const nx = d>1e-6 ? dx/d : 1, nz = d>1e-6 ? dz/d : 0; p.x = o.x + nx*(min+1e-4); p.z = o.z + nz*(min+1e-4); moved=true; }
        }
        if(!moved) break;
      }
      p.x=Math.max(-WORLD_R,Math.min(WORLD_R,p.x)); p.z=Math.max(-WORLD_R,Math.min(WORLD_R,p.z));
      return p;
    }
    /* 移動（キー・スティック・クリック移動で共通）。大きな移動は細かく分けて、すり抜けない。
       障害物に向かって進むと、外周に沿って滑る。戻り値：{x,z,blocked:locked地域の場合その地域} */
    function move(S, from, dx, dz, now){
      const len = Math.hypot(dx,dz); if(len<1e-9) return {x:from.x, z:from.z, hit:false};
      const steps = Math.max(1, Math.ceil(len/0.15));
      let p = {x:from.x, z:from.z}, hit=false, lockedHit=null;
      const sx=dx/steps, sz=dz/steps;
      for(let i=0;i<steps;i++){
        let vx=sx, vz=sz;
        for(const o of nearbySolids(S,p.x,p.z,now)){
          const ox=p.x-o.x, oz=p.z-o.z, d=Math.hypot(ox,oz), min=o.r+PLAYER_R+0.02;
          if(d < min + Math.hypot(vx,vz)){
            const nx=ox/(d||1), nz=oz/(d||1), vn=vx*nx+vz*nz;
            if(vn<0){ hit=true; const v=Math.hypot(vx,vz);
              vx-=vn*nx; vz-=vn*nz;                 // 法線方向を消して外周に沿わせる
              const t=Math.hypot(vx,vz);
              if(t < v*0.35){ const side = (nx*sz - nz*sx) >= 0 ? 1 : -1; vx = -nz*side*v*0.8; vz = nx*side*v*0.8; }   // 正面からぶつかったら回り込む
            }
          }
        }
        const q = {x:p.x+vx, z:p.z+vz};
        const lk = lockedNow(S).find(r=>Math.hypot(q.x-r.w.x,q.z-r.w.z) < REGION_R);
        if(lk){ lockedHit=lk; hit=true; break; }
        depenetrate(S,q,now);
        p=q;
      }
      return {x:p.x, z:p.z, hit, locked:lockedHit};
    }

    /* ---------- 経路探索（クリック移動・採取対象への移動） ---------- */
    const GRID = 0.5, GN = Math.ceil(WORLD_R*2/GRID)+1;
    const gi = v=>Math.round((v+WORLD_R)/GRID), gv = i=>i*GRID-WORLD_R;
    let gridCache=null, gridSig="";
    function blockGrid(S, now){
      const sig = lockedNow(S).map(r=>r.id).join(",")+"|"+objs.filter(o=>o.block && !present(S,o,now)).map(o=>o.id).join(",");
      if(gridCache && sig===gridSig) return gridCache;
      const g = new Uint8Array(GN*GN);
      for(let i=0;i<GN;i++) for(let j=0;j<GN;j++){ if(!inWorld(gv(i),gv(j),0.2)) g[i*GN+j]=1; }
      const mark=(cx,cz,r)=>{ const a=gi(cx-r), b=gi(cx+r), c=gi(cz-r), d=gi(cz+r);
        for(let i=Math.max(0,a);i<=Math.min(GN-1,b);i++) for(let j=Math.max(0,c);j<=Math.min(GN-1,d);j++){ if(Math.hypot(gv(i)-cx,gv(j)-cz) < r) g[i*GN+j]=1; } };
      objs.concat(statics).forEach(o=>{ if(solid(S,o,now)) mark(o.x,o.z,o.r+PLAYER_R+0.08); });
      lockedNow(S).forEach(r=>mark(r.w.x,r.w.z,REGION_R+0.2));
      gridCache=g; gridSig=sig; return g;
    }
    const cellFree = (g,i,j)=> i>=0 && j>=0 && i<GN && j<GN && !g[i*GN+j];
    /* 目的地が障害物の中なら、近くの立てる場所へ */
    function nearestFree(S, p, now, maxR){
      const g=blockGrid(S,now); const ci=gi(p.x), cj=gi(p.z);
      if(cellFree(g,ci,cj) && free(S,p.x,p.z,now)) return {x:p.x, z:p.z};
      const lim = Math.ceil((maxR||8)/GRID);
      for(let r=1;r<=lim;r++){ let best=null, bd=1e9;
        for(let i=ci-r;i<=ci+r;i++) for(let j=cj-r;j<=cj+r;j++){ if(Math.max(Math.abs(i-ci),Math.abs(j-cj))!==r || !cellFree(g,i,j)) continue;
          const x=gv(i), z=gv(j), d=Math.hypot(x-p.x,z-p.z); if(d<bd && free(S,x,z,now)){ bd=d; best={x,z}; } }
        if(best) return best; }
      return null;
    }
    /* 直線で歩けるか（経路の間引き用） */
    function clearLine(g, a, b){
      const d=Math.hypot(b.x-a.x,b.z-a.z), n=Math.ceil(d/(GRID*0.5));
      for(let k=0;k<=n;k++){ const t=n?k/n:0; if(!cellFree(g,gi(a.x+(b.x-a.x)*t), gi(a.z+(b.z-a.z)*t))) return false; }
      return true;
    }
    /* A*。戻り値：経由点の配列（最初の点は含まない）。行けなければ null */
    function findPath(S, from, to, now){
      const g=blockGrid(S,now);
      const goal = nearestFree(S,to,now,6); if(!goal) return null;
      const si=gi(from.x), sj=gi(from.z), ti=gi(goal.x), tj=gi(goal.z);
      if(clearLine(g, from, goal)) return [goal];
      const N=GN*GN, gS=new Float32Array(N).fill(Infinity), came=new Int32Array(N).fill(-1), closed=new Uint8Array(N);
      const heap=[]; const push=(f,k)=>{ heap.push([f,k]); let i=heap.length-1; while(i>0){ const p=(i-1)>>1; if(heap[p][0]<=heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p; } };
      const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let i=0; for(;;){ const l=2*i+1, r=l+1; let m=i; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===i) break; [heap[m],heap[i]]=[heap[i],heap[m]]; i=m; } } return top; };
      const start = si*GN+sj, target = ti*GN+tj;
      gS[start]=0; push(Math.hypot(ti-si,tj-sj), start);
      let found=false, expanded=0;
      while(heap.length && expanded<60000){
        const [,k]=pop(); if(closed[k]) continue; closed[k]=1; expanded++;
        if(k===target){ found=true; break; }
        const i=Math.floor(k/GN), j=k%GN;
        for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++){ if(!di&&!dj) continue;
          const ni=i+di, nj=j+dj; if(!cellFree(g,ni,nj) && !(ni*GN+nj===start)) continue;
          if(di&&dj && (!cellFree(g,i+di,j) || !cellFree(g,i,j+dj))) continue;   // 角を斜めにすり抜けない
          const nk=ni*GN+nj, cost=gS[k]+(di&&dj?1.4142:1);
          if(cost<gS[nk]){ gS[nk]=cost; came[nk]=k; push(cost+Math.hypot(ti-ni,tj-nj), nk); } }
      }
      if(!found) return null;
      const pts=[]; for(let k=target; k!==-1 && k!==start; k=came[k]) pts.push({x:gv(Math.floor(k/GN)), z:gv(k%GN)});
      pts.reverse(); pts[pts.length-1]={x:goal.x, z:goal.z};
      // 見通しのきく点まで間引く
      const out=[]; let a=from, i=0;
      while(i<pts.length){ let j=pts.length-1; while(j>i && !clearLine(g,a,pts[j])) j--; out.push(pts[j]); a=pts[j]; i=j+1; }
      return out;
    }
    /* 採取対象のまわりで、主人公が立てる外周の位置（主人公に近い側） */
    function approachPoint(S, o, from, now){
      const d = o.r + PLAYER_R + 0.35;
      const base = Math.atan2(from.z-o.z, from.x-o.x);
      for(let k=0;k<16;k++){ const a = base + (k%2?1:-1)*Math.ceil(k/2)*Math.PI/8;
        const p={x:o.x+Math.cos(a)*d, z:o.z+Math.sin(a)*d}; if(free(S,p.x,p.z,now)) return p; }
      return nearestFree(S,{x:o.x,z:o.z},now,4);
    }
    /* 古いセーブの位置が岩などに埋まっていたら、近くの立てる場所へ */
    function safeSpawn(S, p, now){
      if(free(S,p.x,p.z,now)) return {x:p.x, z:p.z, moved:false};
      const q = nearestFree(S,p,now,20) || {x:base.x, z:base.z};
      return {x:q.x, z:q.z, moved:true};
    }
    /* 近くの自然物（半径 rad 以内） */
    function around(x, z, rad){ return objs.filter(o=>Math.abs(o.x-x)<=rad && Math.abs(o.z-z)<=rad && Math.hypot(o.x-x,o.z-z)<=rad); }

    return {objects:objs, statics, byId, KINDS, VARIANTS, PLAYER_R, WORLD_R, REGION_R, nameOf, iconOf, yieldsOf, stock, present, solid, info, visual, harvest, reachGap,
            free, move, depenetrate, findPath, nearestFree, approachPoint, safeSpawn, around, nearbySolids};
  }
  return {create, KINDS, VARIANTS, PLAYER_R, SEED};
})();
if (typeof module!=="undefined") module.exports = NATURE;
