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
  /* 拠点の外に建てる建物の場所（ui.js の STRUCT_PLAN と一致させる）。ここには自然物を置かない */
  const SITES = [{id:"st-wheel", x:15.2, z:3.8, r:2.4}];   // 水車は水ぎわ（車輪の半分が川にかかる）。車軸は川を横切る向き（ui.js の rot）
  /* 描画モジュールが以前置いていた石の階段・石積みの壁（"Stonework"）の跡。開始時は人工物を置かないので、
     跡地は自然の地面のまま残し、ところどころに低い茂み・草むら・小石・不ぞろいな岩を置いてなじませる。
     ここに置くものは別の乱数で決めるので、ほかの自然物の位置（＝ID とセーブの状態）は変わらない */
  const FORMER_STONEWORK = [
    {at:[-20,30.8], put:[["bush",1.0],["grass",1.1],["pebble",1.0]]},
    {at:[-6,22.9],  put:[["grass",1.0],["pebble",0.9]]},
    {at:[10.2,15.1],put:[["rock",0.62],["grass",1.0],["pebble",1.0]]},
    {at:[22.6,2.7], put:[["pebble",1.0,"flint"],["pebble",0.9],["grass",0.9]]},
  ];
  const MIN = 60000;

  /* 種類ごとの決まり。
     r：地面上の当たり判定の半径（大きさ1のとき）。block：歩行を妨げるか（採取後は妨げない）。
     uses：採れる回数。need：必要な道具（どれか1つ）。yields：1回で得る素材。after：採取後の見た目。
     regrow：取り尽くしてから元に戻るまで（null は戻らない）。work：採取にかかる時間（ミリ秒）。 */
  const KINDS = {
    tree:   {name:"木",       icon:"🌳", r:0.34, block:true,  uses:2, need:["axe","ironaxe"], bonus:"ironaxe", yields:{log:1}, after:"stump",  regrow:30*MIN, work:900, verb:"切る"},
    rock:   {name:"岩",       icon:"🪨", r:0.95, block:true,  uses:3, need:["hammer","pickaxe","ironpick"], bonus:"ironpick", yields:{cobble:1}, after:"rubble", regrow:null, work:900, verb:"割る"},
    pebble: {name:"小石",     icon:"🪨", r:0.22, block:false, uses:1, need:null, yields:{cobble:1}, after:"gone", regrow:null, work:350, verb:"拾う"},
    twig:   {name:"落ち枝",   icon:"🪵", r:0.25, block:false, uses:1, need:null, yields:{twig:2}, after:"gone", regrow:8*MIN, work:350, verb:"拾う"},
    grass:  {name:"草むら",   icon:"🌾", r:0.45, block:false, uses:1, need:null, yields:{grass:2}, after:"cut", regrow:3*MIN, work:500, verb:"刈る"},
    bush:   {name:"やぶ",     icon:"🌿", r:0.55, block:false, uses:2, need:null, yields:{vine:1, leaves:1}, after:"cut", regrow:4*MIN, work:600, verb:"集める"},
  };
  /* 種類の中の違い（同じ見た目の仲間で、得られる素材が違うもの） */
  const VARIANTS = {
    "pebble:flint": {name:"火打ち石", icon:"🔪", yields:{flint:1}},
    "rock:basalt":  {name:"黒い岩（玄武岩）", yields:{basalt:1, cobble:1}},
    /* 見た目だけが違う仲間（得られる素材は基本の種類と同じ。Muse 第17ラウンドの見た目） */
    "tree:conifer": {name:"針葉樹"},
    "tree:palm":    {name:"ヤシの木"},
    "rock:mossy":   {name:"苔むした岩"},
    "grass:reed":   {name:"葦の茂み"},
    "bush:dry":     {name:"乾いたやぶ"},
    "twig:log":     {name:"倒木"},
  };

  /* 地域の採取地点の姿（描画モジュールの資源タイプ）と、当たり判定の半径（0 は歩行を妨げない）。
     見た目と当たり判定の正本をここ1か所にする。半径は RESOURCE_VISUAL_SPECS（幹 0.26／岩・鉱石の占有 1.0）に合わせる */
  const T_ = (vis, r)=>({vis, r:r||0});
  const DEPOSIT_SHAPE = {
    twig:T_("branch"), cobble:T_("pebble"), flint:T_("pebble"), shell:T_("pebble"),
    log:T_("tree",0.38), resin:T_("tree",0.38), wax:T_("tree",0.38), bark:T_("tree",0.38), seed:T_("tree",0.38),
    leaves:T_("herb"), seaweed:T_("herb"), vine:T_("bush"), grass:T_("grass"), grape:T_("flowers"),
    clay:T_("clay"), ochre:T_("clay"), sand:T_("clay"),
    rain:T_("water"), river:T_("water"), spring:T_("water"), seawater:T_("water"), crude:T_("oil"),
    basalt:T_("rock",0.9), limestone:T_("rock",0.9), granite:T_("rock",0.9),
    quartz:T_("ore",0.9), coal:T_("ore",0.9), rocksalt:T_("ore",0.9), hematite:T_("ore",0.9), malachite:T_("ore",0.9),
    cassiterite:T_("ore",0.9), sphalerite:T_("ore",0.9), bauxite:T_("ore",0.9), sulfur:T_("ore",0.9), obsidian:T_("ore",0.9),
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
    function add(kind, x, z, s, variant, rnd){
      const K = KINDS[kind];
      const id = kind + ":" + Math.round(x*10) + "," + Math.round(z*10);
      if(objs.some(o=>o.id===id)) return null;
      const reg = regionAt(x,z);
      const o = {id, kind, variant:variant||null, x:+x.toFixed(2), z:+z.toFixed(2), rot:+((rnd||rng)()*Math.PI*2).toFixed(3), scale:+s.toFixed(2),
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

    /* 拠点の外の建物の場所にかかる自然物は取り除く（生成のあとで外すので、ほかの自然物の位置と ID は変わらない） */
    for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(SITES.some(p=>near(o.x,o.z,p.x,p.z) < p.r + o.r)) objs.splice(i,1); }
    /* 旧「石の階段・石積みの壁」の跡：自然物だけでなじませる（置けない所は空き地のまま） */
    const rng2 = mulberry32(SEED + 7);
    FORMER_STONEWORK.forEach(f=>f.put.forEach(([kind,sc,variant])=>{
      for(let k=0;k<24;k++){ const ang=rng2()*Math.PI*2, d=0.6+rng2()*2.9, x=f.at[0]+Math.cos(ang)*d, z=f.at[1]+Math.sin(ang)*d, s=sc*(0.85+rng2()*0.3);
        if(fits(kind,x,z,s) && !SITES.some(p=>near(x,z,p.x,p.z) < p.r + KINDS[kind].r*s)){ add(kind,x,z,s,variant||null,rng2); break; } } }));

    /* ---------- 第2層：マップ全体の植生（2026-11-07） ----------
       第1層（上）だけでは地域の近くにしか木や草がなかったので、歩ける地面全体に自然物を広げる。
       別の乱数（SEED+101）で、第1層のあとに足すだけなので、第1層の位置・ID・セーブの状態は変わらない。
       揺らぎのある格子（等間隔に見えないよう、マスの中でずらす）に、場所ごとの密度とまとまりのノイズを掛けて置く。
       ・森（森林の周り・西側）：木とやぶが密集、ところどころに空き地
       ・草原・野原：草むらが多く、木はまばら
       ・川岸：草むら・やぶ・小石、木は少し
       ・高地・山・火山：岩と小石、木は若木がまばら（火山は植物なし）
       置かない所：川の中と岸のすぐそば・急な斜面・拠点の台地（壁になる物）・拠点から各地域への通り道（壁になる物）・採取地点のそば
       ※第1層は「水位＋0.15 より低い土地」に置かなかったが、そこは川の外では乾いた低地（描画も土色）で、マップの約半分あった。
         第2層では低地にも置く（湿った低地は木を減らし、草むら・やぶを多めにする） */
    /* 川の中心の x（地形関数に riverCenterX があれば使う。なければ距離が最小の所を探す） */
    const riverX = z=>{ if(T.riverCenterX) return T.riverCenterX(z);
      let best=0, bd=1e9; for(let x=-60;x<=60;x+=0.5){ const d=T.distanceToRiver(x,z); if(d<bd){ bd=d; best=x; } } return best; };
    const L2 = mulberry32(SEED + 101);
    const vhash = (i,j,k)=>{ let h = (i*374761393 + j*668265263 + k*1442695041) | 0; h = (h ^ (h>>>13)) * 1274126177 | 0; return ((h ^ (h>>>16)) >>> 0) / 4294967296; };
    const vnoise = (x,z,cell,k)=>{ const fx=x/cell, fz=z/cell, i=Math.floor(fx), j=Math.floor(fz), u=smooth(0,1,fx-i), v=smooth(0,1,fz-j);
      const a=vhash(i,j,k), b=vhash(i+1,j,k), c=vhash(i,j+1,k), d=vhash(i+1,j+1,k); return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v; };
    const clump = (x,z,k)=> 0.65*vnoise(x,z,9,k) + 0.35*vnoise(x,z,4,k+7);      // まとまり（密な所と空き地）
    const cw = R("coast"), vw = R("volcano");
    const forestness = (x,z)=> Math.min(1, 0.95*g2(x,z,fw,20) + (x<-6 && z>-14 ? 0.45 : 0) + 0.25*g2(x,z,rw,14)) * (1 - 0.85*highland(x,z));
    const volcanic = (x,z)=> g2(x,z,vw,14);
    const coastal = (x,z)=> g2(x,z,cw,13);
    const lowland = (x,z)=> smooth(wl+0.2, wl-0.25, H(x,z));      // 湿った低地（1 に近いほど低い）
    /* 通り道：拠点から、最初から行ける地域と鍵のかかった地域の中心まで（壁になる物を置かない幅） */
    const corridors = D.regions.filter(r=>r.w).map(r=>({a:{x:base.x,z:base.z}, b:{x:r.w.x,z:r.w.z}}));
    const segD = (x,z,s)=>{ const dx=s.b.x-s.a.x, dz=s.b.z-s.a.z, L=dx*dx+dz*dz; const t=Math.max(0,Math.min(1,((x-s.a.x)*dx+(z-s.a.z)*dz)/L)); return Math.hypot(x-(s.a.x+dx*t), z-(s.a.z+dz*t)); };
    const onCorridor = (x,z,w)=> corridors.some(s=>segD(x,z,s) < w);
    /* 第2層の置ける場所：第1層の規則に加えて、通り道を空ける。鍵のかかった地域の中にも置く（開放後に森や岩場がある） */
    function fits2(kind, x, z, s){
      const K = KINDS[kind], rr = K.r*s;
      if(!inWorld(x,z,3)) return false;
      const dr = T.distanceToRiver(x,z);
      if(kind==="pebble" ? dr < 4.0 : dr < 5.6) return false;
      if(slope(x,z) > (K.block ? 0.55 : 0.9)) return false;
      if(K.block && near(x,z,base.x,base.z) < 15) return false;
      if(!K.block && near(x,z,base.x,base.z) < 3.5) return false;
      if(K.block && onCorridor(x,z,1.9 + rr)) return false;
      if(deps.some(p=>near(x,z,p.x,p.z) < 2.4)) return false;
      if(SITES.some(p=>near(x,z,p.x,p.z) < p.r + rr)) return false;
      for(const o of objs){
        if(Math.abs(o.x-x) > 4 || Math.abs(o.z-z) > 4) continue;
        const d = near(x,z,o.x,o.z);
        const gap = (K.block && o.block) ? rr + o.r + 1.4 : (K.block || o.block) ? rr + o.r + 0.5 : 0.8;
        if(d < gap) return false;
      }
      return true;
    }
    /* 揺らぎのある格子に置く。density(x,z) は 0〜1（そのマスに置く確率） */
    function field(kind, cell, density, size, variantOf){
      let n=0;
      for(let gz=-54; gz<54; gz+=cell) for(let gx=-54; gx<54; gx+=cell){
        const x = gx + L2()*cell, z = gz + L2()*cell, roll = L2(), s = size();
        if(roll > density(x,z)) continue;
        if(!fits2(kind,x,z,s)) continue;
        if(add(kind,x,z,s,variantOf?variantOf(x,z):null,L2)) n++;
      }
      return n;
    }
    const L2N = {};
    L2N.tree = field("tree", 2.9, (x,z)=>{ const c=clump(x,z,1); return volcanic(x,z)>0.3 ? 0 : Math.min(1,(0.1 + 1.25*forestness(x,z)) * (c<0.26 ? 0.06 : 0.5 + c)) * (1-0.7*coastal(x,z)) * (1-0.4*lowland(x,z)); },
      ()=> 0.75 + L2()*0.7);
    L2N.rock = field("rock", 6.5, (x,z)=> 0.04 + 0.55*highland(x,z) + 0.6*volcanic(x,z) + 0.35*g2(x,z,mw,12) + 0.12*clump(x,z,3), ()=>0.6+L2()*0.75,
      (x,z)=> highland(x,z)>0.4 || volcanic(x,z)>0.3 || near(x,z,mw.x,mw.z)<14 ? "basalt" : null);
    L2N.bush = field("bush", 4.2, (x,z)=> volcanic(x,z)>0.3 ? 0 : (0.05 + 0.5*forestness(x,z) + 0.25*smooth(9,5.6,T.distanceToRiver(x,z))) * (0.4 + clump(x,z,5)), ()=>0.85+L2()*0.45);
    L2N.grass = field("grass", 3.4, (x,z)=>{ if(volcanic(x,z)>0.3) return 0; const open = 1 - forestness(x,z);
      return (0.06 + 0.55*open*(1-highland(x,z)) + 0.35*g2(x,z,gw,18) + 0.25*smooth(10,5.6,T.distanceToRiver(x,z)) + 0.2*lowland(x,z)) * (0.3 + clump(x,z,9)); }, ()=>0.85+L2()*0.5);
    L2N.pebble = field("pebble", 5.5, (x,z)=>{ const dr=T.distanceToRiver(x,z); return 0.05 + (dr>4 && dr<9 ? 0.45 : 0) + 0.3*highland(x,z) + 0.3*coastal(x,z) + 0.2*volcanic(x,z); },
      ()=>0.85+L2()*0.4, (x,z)=>{ const dr=T.distanceToRiver(x,z); return (dr<9 && L2()<0.3) || volcanic(x,z)>0.3 && L2()<0.4 ? "flint" : null; });
    // 落ち枝は第2層の木の根もとに（木の多い所ほど多い）
    const trees2 = objs.filter(o=>o.kind==="tree" && !o.id.startsWith("x"));
    L2N.twig = 0;
    for(let i=0; i<6000 && L2N.twig<Math.round(trees2.length*0.45); i++){ const t=trees2[Math.floor(L2()*trees2.length)]; const a=L2()*Math.PI*2, d=t.r+0.9+L2()*1.8;
      const x=t.x+Math.cos(a)*d, z=t.z+Math.sin(a)*d; if(fits2("twig",x,z,1) && add("twig",x,z,1,null,L2)) L2N.twig++; }

    /* ---------- 見た目の違い（2026-11-07、Muse 第17ラウンド） ----------
       生成のあとで、場所から決める（乱数を使わない）ので、位置・ID・セーブの状態は変わらない。得られる素材も同じ。
       高地・山岳の木は針葉樹、海辺の木はヤシ、川岸の草むらは葦、火山・高地のやぶは乾いたやぶ、森の岩は苔むした岩。 */
    objs.forEach(o=>{ if(o.variant) return;
      const hl=highland(o.x,o.z), h01=vhash(Math.round(o.x*10), Math.round(o.z*10), 77);
      if(o.kind==="tree"){ if(hl>0.35 || near(o.x,o.z,mw.x,mw.z) < 16) o.variant="conifer"; else if(coastal(o.x,o.z) > 0.45) o.variant="palm"; }
      else if(o.kind==="grass"){ if(T.distanceToRiver(o.x,o.z) < 8.5) o.variant="reed"; }
      else if(o.kind==="bush"){ if(volcanic(o.x,o.z) > 0.2 || hl > 0.5) o.variant="dry"; }
      else if(o.kind==="rock"){ if(forestness(o.x,o.z) > 0.3 && h01 < 0.75) o.variant="mossy"; } });
    /* 倒木（Muse 第16ラウンドの森林キット branch:log。見た目の半径 0.85）：森の落ち枝の一部。木・岩・やぶと重ならない所だけ */
    objs.forEach(o=>{ if(o.kind!=="twig" || o.variant) return;
      if(forestness(o.x,o.z) < 0.5 || vhash(Math.round(o.x*10), Math.round(o.z*10), 91) > 0.14) return;
      if(objs.some(q=>q!==o && q.kind!=="grass" && q.kind!=="twig" && q.kind!=="pebble" && Math.abs(q.x-o.x)<3 && Math.abs(q.z-o.z)<3 && near(o.x,o.z,q.x,q.z) < 0.85+q.r+0.35)) return;
      o.variant="log"; });

    /* ---------- 飾り（採れない・見た目だけ）と溶岩 ----------
       睡蓮：川の水面（川の中心から 2.3〜3.5。描画が水面に浮かべる）。歩行は妨げない。
       溶岩：火山地帯の中心のまわりに数か所。見た目は描画、通れない決まりはゲーム（固定の障害物にする。建物も置けない）。 */
    const decos = [];
    for(let k=0, n=0; k<400 && n<16; k++){ const z=-50+vhash(k,3,91)*100, side=vhash(k,5,92)<0.5?-1:1, off=2.3+vhash(k,7,93)*1.2;
      const x = riverX(z) + side*off; if(!inWorld(x,z,3) || H(x,z) > wl-0.05) continue;
      if(decos.some(d=>Math.hypot(d.x-x,d.z-z) < 5)) continue;
      decos.push({id:"lily:"+Math.round(x*10)+","+Math.round(z*10), kind:"lily", type:"lily", x:+x.toFixed(2), z:+z.toFixed(2), rot:+(vhash(k,9,94)*6.28).toFixed(3), scale:+(0.8+vhash(k,11,95)*0.5).toFixed(2)}); n++; }
    const lavas = [];
    for(let k=0, n=0; k<200 && n<7; k++){ const a=vhash(k,13,96)*Math.PI*2, d=2.5+vhash(k,15,97)*6, x=vw.x+Math.cos(a)*d, z=vw.z+Math.sin(a)*d, sc=1.1+vhash(k,17,98)*0.9;
      if(deps.some(p=>near(x,z,p.x,p.z) < 0.8*sc+2.0) || lavas.some(l=>near(x,z,l.x,l.z) < 0.8*(sc+l.scale)+1.6)) continue;
      lavas.push({id:"lava:"+Math.round(x*10)+","+Math.round(z*10), kind:"lava", type:"lava", x:+x.toFixed(2), z:+z.toFixed(2), rot:+(vhash(k,19,99)*6.28).toFixed(3), scale:+sc.toFixed(2)}); n++; }
    /* 集落（data.js の village）の中の自然物は取り除く（人の家や通り道。生成のあとで外すので、ほかの ID は変わらない） */
    const VIL = D.village;
    if(VIL) for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(near(o.x,o.z,VIL.c.x,VIL.c.z) < VIL.r + o.r) objs.splice(i,1); }
    /* 溶岩の上の自然物は取り除く（生成のあとで外すので、ほかの ID は変わらない） */
    for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(lavas.some(l=>near(o.x,o.z,l.x,l.z) < 0.8*l.scale+o.r+0.4)) objs.splice(i,1); }
    lavas.forEach(l=>decos.push(l));

    const byId = new Map(objs.map(o=>[o.id,o]));
    /* 地域の採取地点のうち、木・岩・鉱石の姿のものは固定の障害物（見た目の幹・占有範囲に合わせる） */
    const statics = [];
    D.regions.forEach(r=>{ if(r.w) r.res.forEach(res=>{ const sh=DEPOSIT_SHAPE[res.id]; if(!sh || !sh.r) return; const p=E.depositPos(r,res);
      statics.push({id:E.depositId(r.id,res.id), kind:"deposit", x:p.x, z:p.z, r:sh.r, block:true, static:true}); }); });
    /* 溶岩は通れない（描画の占有 0.8×大きさ） */
    decos.filter(d=>d.kind==="lava").forEach(d=>statics.push({id:d.id, kind:"lava", x:d.x, z:d.z, r:+(0.8*d.scale).toFixed(3), block:true, static:true}));

    /* ---------- 建物の当たり判定（2026-11-07） ----------
       建てた建物の占有形状（Muse の structures.json の footprint。円 {r} か矩形 {w,d}。屋根・煙突・炎は含まない）を
       UI から setStructures で受け取る。矩形は建物の向き rot（three.js の rotation.y）で回す。
       建物の下に入った自然物は、建物がある間は「覆われた」扱い（見えない・壁にならない・採れない）。 */
    let structs = [], structSig = "";
    /* 形の外側までの距離（中なら負） */
    function sdist(o, x, z){
      if(o.shape==="rect"){ const dx=x-o.x, dz=z-o.z, c=Math.cos(o.rot||0), s_=Math.sin(o.rot||0);
        const lx=c*dx - s_*dz, lz=s_*dx + c*dz, qx=Math.abs(lx)-o.w/2, qz=Math.abs(lz)-o.d/2;
        return Math.hypot(Math.max(qx,0), Math.max(qz,0)) + Math.min(Math.max(qx,qz), 0); }
      return Math.hypot(x-o.x, z-o.z) - o.r;
    }
    /* 形の外へ向かう向き（単位ベクトル） */
    function snormal(o, x, z){
      if(o.shape==="rect"){ const dx=x-o.x, dz=z-o.z, c=Math.cos(o.rot||0), s_=Math.sin(o.rot||0);
        const lx=c*dx - s_*dz, lz=s_*dx + c*dz, hx=o.w/2, hz=o.d/2;
        let nx, nz;
        if(Math.abs(lx)<=hx && Math.abs(lz)<=hz){ if(hx-Math.abs(lx) < hz-Math.abs(lz)){ nx=Math.sign(lx)||1; nz=0; } else { nx=0; nz=Math.sign(lz)||1; } }
        else { const px=Math.max(-hx,Math.min(hx,lx)), pz=Math.max(-hz,Math.min(hz,lz)); nx=lx-px; nz=lz-pz; const l=Math.hypot(nx,nz)||1; nx/=l; nz/=l; }
        return {x: c*nx + s_*nz, z: -s_*nx + c*nz}; }      // ローカル→ワールド（rotation.y の回転）
      const dx=x-o.x, dz=z-o.z, d=Math.hypot(dx,dz); return d>1e-6 ? {x:dx/d, z:dz/d} : {x:1, z:0};
    }
    /* 集落の人（NPC）：地面の円（半径 0.35）。主人公は人をすり抜けない。人が歩くときは自分自身を除く（move の ignore） */
    let npcCols = [];
    function setNpcs(list){ npcCols = (list||[]).map(n=>({id:"npc:"+n.id, kind:"npc", x:n.x, z:n.z, r:n.r||PLAYER_R, shape:"circle", block:true, static:true, npc:true})); }
    function setStructures(list){
      structs = (list||[]).filter(t=>t && t.footprint).map(t=>{ const f=t.footprint;
        return {id:"struct:"+t.id, kind:"structure", type:t.type, x:t.x, z:t.z, rot:t.rot||0, shape:f.shape==="rect"?"rect":"circle",
                w:f.w, d:f.d, r: f.shape==="rect" ? Math.hypot(f.w,f.d)/2 : f.r, block:true, static:true, struct:true}; });
      structSig = structs.map(o=>o.id+"@"+o.x.toFixed(2)+","+o.z.toFixed(2)+","+o.rot.toFixed(2)).join("|");
      gridCache = null;
    }
    /* ---------- 建築モード：置けるかの判定と確定（2026-11-07） ----------
       p：{id, type, footprint, entrance, operate, rule, x, z, rot}。opts：{player:{x,z}, npcs:[{x,z,r}], reserved:[{x,z,r,why}]}
       返り値：{ok, reasons:[文], shape}。素材は使わない（設備は工作で作った時点で素材を使っている）。 */
    const toWorld = (o, lx, lz)=>{ const c=Math.cos(o.rot||0), s_=Math.sin(o.rot||0); return {x:o.x + c*lx + s_*lz, z:o.z - s_*lx + c*lz}; };
    function shapeOf(p){ const f=p.footprint||{shape:"circle", r:1};
      return {x:p.x, z:p.z, rot:p.rot||0, shape:f.shape==="rect"?"rect":"circle", w:f.w, d:f.d, r: f.shape==="rect" ? Math.hypot(f.w,f.d)/2 : f.r}; }
    function samples(o){ if(o.shape==="rect"){ const hw=o.w/2, hd=o.d/2, pts=[];
        for(const i of [-1,-0.5,0,0.5,1]) for(const j of [-1,-0.5,0,0.5,1]) pts.push(toWorld(o, i*hw, j*hd)); return pts; }
      const pts=[{x:o.x, z:o.z}]; for(let k=0;k<12;k++){ const a=k/12*Math.PI*2; pts.push({x:o.x+Math.cos(a)*o.r, z:o.z+Math.sin(a)*o.r}); pts.push({x:o.x+Math.cos(a)*o.r*0.5, z:o.z+Math.sin(a)*o.r*0.5}); } return pts; }
    function checkPlacement(S, p, opts, now){
      opts=opts||{}; now=now||Date.now();
      const t = shapeOf(p), pts = samples(t), why = new Set(), ignore = "struct:"+p.id;
      if(pts.some(q=>!inWorld(q.x,q.z,1.2))) why.add("世界の端に近すぎる");
      if(lockedNow(S).some(r=>pts.some(q=>Math.hypot(q.x-r.w.x,q.z-r.w.z) < REGION_R))) why.add("まだ入れない地域の中");
      const hs = pts.map(q=>H(q.x,q.z)), hmin=Math.min(...hs), hmax=Math.max(...hs);
      const diag = t.shape==="rect" ? Math.hypot(t.w,t.d) : t.r*2;          // 大きい建物ほど端と端の高さの差は大きくてよい（なだらかなら置ける）
      if(hmax-hmin > Math.max(0.8, 0.3*diag) || pts.some(q=>slope(q.x,q.z) > 0.6)) why.add("地面が傾きすぎている（平らな所へ）");
      const dr = pts.map(q=>T.distanceToRiver(q.x,q.z));
      if(p.rule==="waterside"){        // 水車：川の水ぎわ（一部が水にかかり、中心は岸の上）
        const dc = T.distanceToRiver(t.x,t.z);
        if(!(dc > 3.4 && dc < 6.4 && Math.min(...dr) < 4.6)) why.add("水車は川の水ぎわ（半分が水にかかる所）に置く");
      } else if(Math.min(...dr) < 5.0) why.add("川（水の中・水ぎわ）には置けない");
      for(const o of structs){ if(o.id===ignore) continue;
        if(pts.some(q=>sdist(o,q.x,q.z) < 0.5) || samples(o).some(q=>sdist(t,q.x,q.z) < 0.5)) { why.add("ほかの建物と重なる"); break; } }
      const near = around(t.x, t.z, t.r+2.5);
      if(near.some(o=>o.block && present(S,o,now) && sdist(t,o.x,o.z) < o.r+0.15)) why.add("木や岩と重なる（先に伐る・割るか、場所を変える）");
      if(statics.some(o=>o.kind==="lava" && Math.abs(o.x-t.x)<t.r+5 && Math.abs(o.z-t.z)<t.r+5 && sdist(t,o.x,o.z) < o.r+1.0)) why.add("溶岩の上・すぐそばには置けない");
      if(statics.some(o=>o.kind!=="lava" && Math.abs(o.x-t.x)<t.r+3 && Math.abs(o.z-t.z)<t.r+3 && sdist(t,o.x,o.z) < o.r+0.3)) why.add("採取地点と重なる");
      if(opts.player && sdist(t, opts.player.x, opts.player.z) < PLAYER_R+0.15) why.add("主人公と重なる（少し離れて置く）");
      (opts.npcs||[]).forEach(n=>{ if(sdist(t,n.x,n.z) < (n.r||PLAYER_R)+0.2) why.add("人と重なる"); });
      (opts.reserved||[]).forEach(r=>{ if(pts.some(q=>Math.hypot(q.x-r.x,q.z-r.z) < r.r) || sdist(t,r.x,r.z) < r.r) why.add(r.why||"ここには置けない"); });
      /* 入口・操作する場所の前（外側へ0.6）に、人が立てる空きがあるか */
      for(const k of ["entrance","operate"]){ const lp=p[k]; if(!lp) continue;
        const L=Math.hypot(lp[0],lp[1])||1, w=toWorld(t, lp[0]+lp[0]/L*0.6, lp[1]+lp[1]/L*0.6);
        // 主人公は川の中も歩けるので、水ぎわに置く設備（水車）は使う場所が浅瀬でもよい
        let bad = !inWorld(w.x,w.z,0.5) || (p.rule!=="waterside" && T.distanceToRiver(w.x,w.z) < 4.6) || slope(w.x,w.z) > 0.7;
        if(!bad) for(const o of nearbySolids(S,w.x,w.z,now)){ if(o.id===ignore) continue; if(sdist(o,w.x,w.z) < PLAYER_R){ bad=true; break; } }
        if(!bad && sdist(t,w.x,w.z) < PLAYER_R*0.5) bad=true;
        if(bad){ why.add(k==="entrance" ? "入口の前があいていない" : "設備を使う場所（前）があいていない"); } }
      return {ok: why.size===0, reasons:[...why], shape:t};
    }
    /* 置き場所を確定する（token が S.seq と同じときだけ・一度だけ）。素材は使わない */
    function commitPlacement(S, p, token, opts, now){
      if(token!==S.seq) return {ok:false, kind:"dup", reasons:["もう置いた（二重の操作は取り消した）"]};
      const c = checkPlacement(S, p, opts, now); if(!c.ok) return Object.assign({kind:"bad"}, c);
      S.build = S.build || {}; S.build[p.id] = {x:+p.x.toFixed(2), z:+p.z.toFixed(2), rot:+(((p.rot%(Math.PI*2))+Math.PI*2)%(Math.PI*2)).toFixed(4)};
      S.seq++;
      return {ok:true, at:S.build[p.id]};
    }
    function removePlacement(S, id, token){
      if(token!==S.seq) return {ok:false, kind:"dup"};
      S.build = S.build || {}; S.build[id] = {removed:true}; S.seq++; return {ok:true};
    }
    /* 建物の下（占有形状＋自然物の半径＋少しの余白）にある自然物 */
    const covered = o=> !o.static && structs.some(t=> Math.abs(t.x-o.x) < t.r+o.r+1 && Math.abs(t.z-o.z) < t.r+o.r+1 && sdist(t,o.x,o.z) < o.r + 0.25);

    /* ---------- 状態 ---------- */
    const kindOf = o=>KINDS[o.kind];
    const nameOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].name) || kindOf(o).name;
    const iconOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].icon) || kindOf(o).icon;
    const yieldsOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].yields) || kindOf(o).yields;
    function stock(S, o, now){ const K=kindOf(o); return E.stockOf(S, o.id, K.uses, K.regrow, now); }
    function present(S, o, now){ return stock(S,o,now).left > 0 && !covered(o); }
    /* 当たり判定に使うか（取り尽くした木・岩は切り株・残骸になり、歩行を妨げない） */
    function solid(S, o, now){ return o.static ? true : o.block && present(S,o,now); }
    /* 採取できるか・できない理由・得られる素材 */
    function info(S, o, now){
      const K=kindOf(o), k=stock(S,o,now), base=yieldsOf(o), y={};
      Object.keys(base).forEach(id=>{ y[id]=base[id]; });
      if(K.bonus && E.has(S,K.bonus)) Object.keys(y).forEach((id,i)=>{ if(i===0) y[id]+=1; });
      const out = {name:nameOf(o), icon:iconOf(o), verb:K.verb, yields:y, left:k.left, uses:K.uses, until:k.until, need:K.need, after:K.after};
      if(covered(o)) return Object.assign(out, {ok:false, kind:"covered", reason:"建物の下になっている"});
      if(k.left<=0) return Object.assign(out, {ok:false, kind:"empty", reason: k.until ? "取り尽くした（しばらくすると戻る）" : K.after==="stump" ? "切り株になった" : K.after==="rubble" ? "砕けた" : "もうない"});
      if(K.need && !K.need.some(t=>(E.hasTool||E.has)(S,t))) return Object.assign(out, {ok:false, kind:"tool", reason:"「"+K.need.map(t=>D.items[t].name).join("」か「")+"」が必要"});
      return Object.assign(out, {ok:true});
    }
    /* 描画モジュールへ渡す状態（表示専用） */
    function visual(S, o, now){
      const k = stock(S,o,now), K=kindOf(o);
      return {id:o.id, kind:o.kind, variant:o.variant, position:{x:o.x, z:o.z}, rotationY:o.rot, scale:o.scale,
              state: covered(o) ? "gone" : k.left>0 ? "intact" : K.after, collider: {shape:"circle", r:o.r, solid: solid(S,o,now)}, uses:K.uses, left:k.left};
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
      for(const t of structs) if(Math.abs(t.x-x) < t.r+CELL && Math.abs(t.z-z) < t.r+CELL) out.push(t);
      for(const n of npcCols) if(n.id!==moveIgnore && Math.abs(n.x-x) < CELL && Math.abs(n.z-z) < CELL) out.push(n);
      return out;
    }
    const lockedNow = S=>lockedRegions.filter(r=>!E.regionOpen(S,r));
    /* その場所に主人公が立てるか */
    function free(S, x, z, now){
      if(!inWorld(x,z)) return false;
      for(const r of lockedNow(S)) if(Math.hypot(x-r.w.x,z-r.w.z) < REGION_R) return false;
      for(const o of nearbySolids(S,x,z,now)) if(sdist(o,x,z) < PLAYER_R) return false;
      return true;
    }
    /* 円の外へ押し出す（重なっていれば外周へ） */
    function depenetrate(S, p, now){
      for(let it=0; it<3; it++){
        let moved=false;
        for(const o of nearbySolids(S,p.x,p.z,now)){
          const sd = sdist(o,p.x,p.z);
          if(sd < PLAYER_R){ const n=snormal(o,p.x,p.z), push=PLAYER_R-sd+1e-4; p.x += n.x*push; p.z += n.z*push; moved=true; }
        }
        if(!moved) break;
      }
      p.x=Math.max(-WORLD_R,Math.min(WORLD_R,p.x)); p.z=Math.max(-WORLD_R,Math.min(WORLD_R,p.z));
      return p;
    }
    /* 移動（キー・スティック・クリック移動で共通）。大きな移動は細かく分けて、すり抜けない。
       障害物に向かって進むと、外周に沿って滑る。戻り値：{x,z,blocked:locked地域の場合その地域} */
    let moveIgnore = null;
    function move(S, from, dx, dz, now, ignore){
      if(ignore){ moveIgnore=ignore; try{ return move(S, from, dx, dz, now); } finally { moveIgnore=null; } }
      const len = Math.hypot(dx,dz); if(len<1e-9) return {x:from.x, z:from.z, hit:false};
      const steps = Math.max(1, Math.ceil(len/0.15));
      let p = {x:from.x, z:from.z}, hit=false, lockedHit=null;
      const sx=dx/steps, sz=dz/steps;
      for(let i=0;i<steps;i++){
        let vx=sx, vz=sz;
        for(const o of nearbySolids(S,p.x,p.z,now)){
          const sd=sdist(o,p.x,p.z), min=PLAYER_R+0.02;
          if(sd < min + Math.hypot(vx,vz)){
            const n=snormal(o,p.x,p.z), nx=n.x, nz=n.z, vn=vx*nx+vz*nz;
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
      const sig = lockedNow(S).map(r=>r.id).join(",")+"|"+objs.filter(o=>o.block && !present(S,o,now)).map(o=>o.id).join(",")+"|"+structSig;
      if(gridCache && sig===gridSig) return gridCache;
      const g = new Uint8Array(GN*GN);
      for(let i=0;i<GN;i++) for(let j=0;j<GN;j++){ if(!inWorld(gv(i),gv(j),0.2)) g[i*GN+j]=1; }
      const mark=(cx,cz,r)=>{ const a=gi(cx-r), b=gi(cx+r), c=gi(cz-r), d=gi(cz+r);
        for(let i=Math.max(0,a);i<=Math.min(GN-1,b);i++) for(let j=Math.max(0,c);j<=Math.min(GN-1,d);j++){ if(Math.hypot(gv(i)-cx,gv(j)-cz) < r) g[i*GN+j]=1; } };
      objs.concat(statics).forEach(o=>{ if(solid(S,o,now)) mark(o.x,o.z,o.r+PLAYER_R+0.08); });
      structs.forEach(t=>{ const R=t.r+PLAYER_R+0.1, a=gi(t.x-R), b=gi(t.x+R), c=gi(t.z-R), d=gi(t.z+R);
        for(let i=Math.max(0,a);i<=Math.min(GN-1,b);i++) for(let j=Math.max(0,c);j<=Math.min(GN-1,d);j++){ if(sdist(t,gv(i),gv(j)) < PLAYER_R+0.08) g[i*GN+j]=1; } });
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
    /* 近くの自然物だけを引く（8マスの格子。毎フレームの近接判定・表示の同期で全件を走査しない） */
    const AG = 8, agrid = new Map(); objs.forEach(o=>{ const k=Math.floor(o.x/AG)+","+Math.floor(o.z/AG); if(!agrid.has(k)) agrid.set(k,[]); agrid.get(k).push(o); });
    function around(x, z, rad){ const out=[]; const x0=Math.floor((x-rad)/AG), x1=Math.floor((x+rad)/AG), z0=Math.floor((z-rad)/AG), z1=Math.floor((z+rad)/AG);
      for(let i=x0;i<=x1;i++) for(let j=z0;j<=z1;j++){ const c=agrid.get(i+","+j); if(c) for(const o of c) if(Math.abs(o.x-x)<=rad && Math.abs(o.z-z)<=rad && Math.hypot(o.x-x,o.z-z)<=rad) out.push(o); }
      return out; }

    return {objects:objs, statics, byId, KINDS, VARIANTS, PLAYER_R, WORLD_R, REGION_R, nameOf, iconOf, yieldsOf, stock, present, solid, info, visual, harvest, reachGap,
            free, move, depenetrate, findPath, nearestFree, approachPoint, safeSpawn, around, nearbySolids, layer2:L2N,
            setStructures, structures:()=>structs.slice(), sdist, covered, checkPlacement, commitPlacement, removePlacement, toWorld, decos, setNpcs};
  }
  return {create, KINDS, VARIANTS, PLAYER_R, SEED, DEPOSIT_SHAPE, SITES, FORMER_STONEWORK};
})();
if (typeof module!=="undefined") module.exports = NATURE;
