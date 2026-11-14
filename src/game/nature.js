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
  const WORLD_R = 56;             // 旧世界の歩ける範囲：-56〜56 の正方形（第1層・第2層の自然物はこの中。位置と ID を変えないため、この値のまま）
  const inOld = (x,z,m)=> Math.abs(x) <= WORLD_R-(m||0) && Math.abs(z) <= WORLD_R-(m||0);
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
  /* 自然物の生成に使う地域の配置は、2026-11-10 の時点の値で固定する（2026-11-11：地域の鍵の廃止・火山地帯の移動・鉱石のかけらの追加）。
     第1層・第2層は乱数を順に使い、置いた物どうしの間隔で次の物を決めるので、地域の中心・採取地点・鍵の有無が変わると
     旧世界の自然物の位置と ID（＝既存セーブの採取状態）がずれる。生成の入力だけをこの写しに固定し、ずれないようにする。
     lock：当時鍵がかかっていた地域（その中心のまわりには第1層の物を置かなかった）。p：当時の採取地点（地域画面の配置） */
  const GEN_REGIONS = [{"id":"forest","w":{"x":-44,"z":40},"lock":false,"p":[[14,72],[34,82],[56,50],[78,62],[24,46],[46,66],[86,38]]},{"id":"grassland","w":{"x":4,"z":-6},"lock":false,"p":[[18,74],[44,60],[76,70],[60,36]]},{"id":"river","w":{"x":14,"z":12},"lock":false,"p":[[14,80],[32,70],[52,82],[72,78],[50,52],[86,46]]},{"id":"coast","w":{"x":36,"z":44},"lock":false,"p":[[22,78],[56,62],[40,86],[76,50]]},{"id":"mountain","w":{"x":36,"z":-8},"lock":false,"p":[[16,78],[36,64],[58,74],[76,52],[44,40]]},{"id":"cave","w":{"x":42,"z":-34},"lock":true,"p":[[28,70],[66,64]]},{"id":"mine","w":{"x":20,"z":-46},"lock":true,"p":[[16,72],[36,58],[56,74],[74,56],[88,76]]},{"id":"volcano","w":{"x":-38,"z":-38},"lock":true,"p":[[34,66],[66,76]]},{"id":"oilfield","w":{"x":0,"z":50},"lock":true,"p":[[50,66]]}];
  const genDepositPos = (w, p)=>({x: w.x + (p[0]-50)/50*6.5, z: w.z + (p[1]-62)/38*5});   // 当時の engine.depositPos と同じ式

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
    /* 広い世界の海岸（2026-11-07）。素材は既存のもの（貝殻・木の枝・草） */
    "pebble:shell":   {name:"貝殻", icon:"🐚", yields:{shell:1}},
    "twig:driftwood": {name:"流木"},
    "grass:dry":      {name:"浜の草"},
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
    cassiterite:T_("ore",0.9), sphalerite:T_("ore",0.9), bauxite:T_("ore",0.9), sulfur:T_("sulfur",0.9), obsidian:T_("ore",0.9),
  };
  /* 落ちている鉱石のかけら（loose：道具がなくても拾える少しの量）は、鉱石のかけらの姿（Muse ラウンド28 'ore-shard'）で、歩行を妨げない */
  const LOOSE_SHAPE = {vis:"ore-shard", r:0};   // 2026-11-12：Muse ラウンド28 の鉱石のかけらの見た目（当たり判定なしのまま）
  /* solid:false は踏める平たい採取地点（火口縁の硫黄の皮など。見た目は元の種類のまま、当たり判定なし） */
  const depShape = res => { if(!res) return null; if(res.loose) return LOOSE_SHAPE; const b = DEPOSIT_SHAPE[res.id]; return b && res.solid===false ? {vis:b.vis, r:0} : b; };
  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  const smooth = (a,b,x)=>{ const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };

  /* T：地形関数 {terrainHeight(x,z,cfg), distanceToRiver(x,z), cfg}。D：ゲームデータ。E：エンジン */
  function create(D, E, T){
    const cfg = T.cfg, wl = cfg.world.waterLevel;
    const H = (x,z)=>T.terrainHeight(x,z,cfg);
    /* 広い世界（2026-11-07）：歩ける範囲は T.WALK（長方形）。崖（急な斜面）と深い水（海・湖・池・滝つぼ）は地形から止める。
       T に広い世界の関数がない（古い呼び方）ときは、旧世界の範囲と決まりのまま */
    const WIDE = !!(T.WALK && T.waterAt);
    /* 外の野（2026-11-10）：T.WALK_R があれば、中心から半径 WALK_R の円の中を歩ける（長方形 T.WALK はその内側。円の外は歩けない） */
    const WR = WIDE && T.WALK_R ? T.WALK_R : 0;
    const WB = WR ? {minX:-WR, maxX:WR, minZ:-WR, maxZ:WR} : WIDE ? T.WALK : {minX:-WORLD_R, maxX:WORLD_R, minZ:-WORLD_R, maxZ:WORLD_R};
    const inWorld = (x,z,m)=>{ m=m||0; if(WR) return x*x + z*z <= (WR-m)*(WR-m); return x >= WB.minX+m && x <= WB.maxX-m && z >= WB.minZ+m && z <= WB.maxZ-m; };
    const rng = mulberry32(SEED);
    const objs = [];
    const deps = [];     // 生成用（固定の写し）。今の採取地点の当たり判定は statics（下）
    GEN_REGIONS.forEach(r=>r.p.forEach(p=>deps.push(genDepositPos(r.w,p))));
    const lockedRegions = GEN_REGIONS.filter(r=>r.lock);
    const base = D.base;
    const regionAt = (x,z)=>{ let best=null, bd=1e9; D.regions.forEach(r=>{ if(!r.w) return; const d=Math.hypot(x-r.w.x,z-r.w.z); if(d<bd){bd=d;best=r;} }); return bd<=REGION_R+3?best:null; };
    const near = (ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);
    const slope = (x,z)=>Math.max(Math.abs(H(x+0.6,z)-H(x-0.6,z)), Math.abs(H(x,z+0.6)-H(x,z-0.6)))/1.2;

    /* 置ける場所か */
    function fits(kind, x, z, s){
      const K = KINDS[kind], rr = K.r*s;
      if(!inOld(x,z,3)) return false;
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
    const R = id=>GEN_REGIONS.find(r=>r.id===id).w;
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
    const corridors = GEN_REGIONS.map(r=>({a:{x:base.x,z:base.z}, b:{x:r.w.x,z:r.w.z}}));
    const segD = (x,z,s)=>{ const dx=s.b.x-s.a.x, dz=s.b.z-s.a.z, L=dx*dx+dz*dz; const t=Math.max(0,Math.min(1,((x-s.a.x)*dx+(z-s.a.z)*dz)/L)); return Math.hypot(x-(s.a.x+dx*t), z-(s.a.z+dz*t)); };
    const onCorridor = (x,z,w)=> corridors.some(s=>segD(x,z,s) < w);
    /* 第2層の置ける場所：第1層の規則に加えて、通り道を空ける。鍵のかかった地域の中にも置く（開放後に森や岩場がある） */
    function fits2(kind, x, z, s){
      const K = KINDS[kind], rr = K.r*s;
      if(!inOld(x,z,3)) return false;
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
       溶岩：2026-11-11 からは置かない（下）。 */
    const decos = [];
    for(let k=0, n=0; k<400 && n<16; k++){ const z=-50+vhash(k,3,91)*100, side=vhash(k,5,92)<0.5?-1:1, off=2.3+vhash(k,7,93)*1.2;
      const x = riverX(z) + side*off; if(!inOld(x,z,3) || H(x,z) > wl-0.05) continue;
      if(decos.some(d=>Math.hypot(d.x-x,d.z-z) < 5)) continue;
      decos.push({id:"lily:"+Math.round(x*10)+","+Math.round(z*10), kind:"lily", type:"lily", x:+x.toFixed(2), z:+z.toFixed(2), rot:+(vhash(k,9,94)*6.28).toFixed(3), scale:+(0.8+vhash(k,11,95)*0.5).toFixed(2)}); n++; }
    /* 溶岩の池（飾り）：2026-11-11 から置かない。火山は南西の本物の山（src/world/shape.ts の VOLCANO）になり、溶岩は火口の溶岩湖だけ
       （地形と描画の溶岩湖。歩けない決まりは terrainBlocked）。以前は旧世界の中の「火山地帯」（-38,-38）のまわりに置いていた */
    const lavas = [];
    /* 集落（data.js の village）の中の自然物は取り除く（人の家や通り道。生成のあとで外すので、ほかの ID は変わらない） */
    const VIL = D.village;
    if(VIL) for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(near(o.x,o.z,VIL.c.x,VIL.c.z) < VIL.r + o.r) objs.splice(i,1); }
    /* 溶岩の上の自然物は取り除く（生成のあとで外すので、ほかの ID は変わらない） */
    for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(lavas.some(l=>near(o.x,o.z,l.x,l.z) < 0.8*l.scale+o.r+0.4)) objs.splice(i,1); }
    lavas.forEach(l=>decos.push(l));

    const byId = new Map(objs.map(o=>[o.id,o]));
    /* 近くの自然物を引くための 8マスの格子（第3層は作ったときに足す） */
    const AG = 8, agrid = new Map(); objs.forEach(o=>{ const k=Math.floor(o.x/AG)+","+Math.floor(o.z/AG); if(!agrid.has(k)) agrid.set(k,[]); agrid.get(k).push(o); });
    /* 旧世界（第1層・第2層）の自然物で (x,z) の近くのもの（第3層の重なりの判定用） */
    function oldNear(x, z, rad){ const out=[]; for(let i=Math.floor((x-rad)/AG); i<=Math.floor((x+rad)/AG); i++) for(let j=Math.floor((z-rad)/AG); j<=Math.floor((z+rad)/AG); j++){ const c=agrid.get(i+","+j); if(c) for(const o of c) if(!o.layer) out.push(o); } return out; }
    /* 地域の採取地点のうち、木・岩・鉱石の姿のものは固定の障害物（見た目の幹・占有範囲に合わせる） */
    const statics = [];
    /* 今の採取地点（第3層の自然物をそばに置かない。旧世界の第1層・第2層は生成用の固定の写し deps を使う） */
    const depNow = []; D.regions.forEach(r=>{ if(r.w) r.res.forEach(res=>depNow.push(E.depositPos(r,res))); });
    D.regions.forEach(r=>{ if(r.w) r.res.forEach(res=>{ const sh=depShape(res); if(!sh || !sh.r) return; const p=E.depositPos(r,res);
      statics.push({id:E.depositId(r.id,E.resKey(res)), kind:"deposit", x:p.x, z:p.z, r:sh.r, block:true, static:true}); }); });
    /* 溶岩は通れない（描画の占有 0.8×大きさ） */
    decos.filter(d=>d.kind==="lava").forEach(d=>statics.push({id:d.id, kind:"lava", x:d.x, z:d.z, r:+(0.8*d.scale).toFixed(3), block:true, static:true}));

    /* ---------- 建物の当たり判定（2026-11-07） ----------
       建てた建物の占有形状（Muse の structures.json の footprint。円 {r} か矩形 {w,d}。屋根・煙突・炎は含まない）を
       UI から setStructures で受け取る。矩形は建物の向き rot（three.js の rotation.y）で回す。
       建物の下に入った自然物は、建物がある間は「覆われた」扱い（見えない・壁にならない・採れない）。 */
    let structs = [], solidStructs = [], structSig = "";
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
      structs = (list||[]).filter(t=>t && t.footprint).map(t=>{ const f=t.footprint;   // t.walk：歩ける（予定地・広場）
        return {id:"struct:"+t.id, kind:"structure", type:t.type, x:t.x, z:t.z, rot:t.rot||0, shape:f.shape==="rect"?"rect":"circle",
                w:f.w, d:f.d, r: f.shape==="rect" ? Math.hypot(f.w,f.d)/2 : f.r, block:!t.walk, walk:!!t.walk, static:true, struct:true}; });
      /* walk：建設予定地・広場など、ほかの建物を置けないが歩いて通れる場所（2026-11-14 街づくり）。歩行・押し出し・経路・自然物を隠す処理には入れない */
      solidStructs = structs.filter(o=>!o.walk);
      structSig = structs.map(o=>o.id+"@"+o.x.toFixed(2)+","+o.z.toFixed(2)+","+o.rot.toFixed(2)).join("|");
      gridCache = null;
    }
    /* ---------- 建築モード：置けるかの判定と確定（2026-11-07） ----------
       p：{id, type, footprint, entrance, operate, rule, x, z, rot}。opts：{player:{x,z}, npcs:[{x,z,r}], reserved:[{x,z,r,why}]}
       返り値：{ok, reasons:[文], shape}。素材は使わない（設備は工作で作った時点で素材を使っている）。 */
    const toWorld = (o, lx, lz)=>{ const c=Math.cos(o.rot||0), s_=Math.sin(o.rot||0); return {x:o.x + c*lx + s_*lz, z:o.z - s_*lx + c*lz}; };
    function shapeOf(p){ const f=p.footprint||{shape:"circle", r:1};
      return {x:p.x, z:p.z, rot:p.rot||0, shape:f.shape==="rect"?"rect":"circle", w:f.w, d:f.d, r: f.shape==="rect" ? Math.hypot(f.w,f.d)/2 : f.r}; }
    /* dense：占有範囲の中を 1 マスより細かく調べる（街づくりの建物。大きな建物は四隅だけでなく中の高低差も見る） */
    function samples(o, dense){ if(o.shape==="rect"){ const hw=o.w/2, hd=o.d/2, pts=[];
        if(dense){ const nx=Math.max(4,Math.ceil(o.w/0.9)), nz=Math.max(4,Math.ceil(o.d/0.9)); for(let i=0;i<=nx;i++) for(let j=0;j<=nz;j++) pts.push(toWorld(o, -hw+o.w*i/nx, -hd+o.d*j/nz)); return pts; }
        for(const i of [-1,-0.5,0,0.5,1]) for(const j of [-1,-0.5,0,0.5,1]) pts.push(toWorld(o, i*hw, j*hd)); return pts; }
      const pts=[{x:o.x, z:o.z}]; for(let k=0;k<12;k++){ const a=k/12*Math.PI*2; pts.push({x:o.x+Math.cos(a)*o.r, z:o.z+Math.sin(a)*o.r}); pts.push({x:o.x+Math.cos(a)*o.r*0.5, z:o.z+Math.sin(a)*o.r*0.5}); } return pts; }
    function checkPlacement(S, p, opts, now){
      opts=opts||{}; now=now||Date.now();
      const t = shapeOf(p), pts = samples(t, !!p.dense), why = new Set(), ignore = "struct:"+p.id;
      if(pts.some(q=>!inWorld(q.x,q.z,1.2))) why.add("世界の端に近すぎる");
      const hs = pts.map(q=>H(q.x,q.z)), hmin=Math.min(...hs), hmax=Math.max(...hs);
      const diag = t.shape==="rect" ? Math.hypot(t.w,t.d) : t.r*2;          // 大きい建物ほど端と端の高さの差は大きくてよい（なだらかなら置ける）
      if(hmax-hmin > Math.max(0.8, 0.3*diag) || pts.some(q=>slope(q.x,q.z) > (Number.isFinite(p.maxSlope)?p.maxSlope:0.6))) why.add("地面が傾きすぎている（平らな所へ）");
      else if(Number.isFinite(p.maxRise) && hmax-hmin > p.maxRise) why.add("占有範囲の中の高低差が大きい（"+(hmax-hmin).toFixed(1)+"。"+p.maxRise+" まで。土地はならさないので、平らな所へ）");
      const dr = pts.map(q=>T.distanceToRiver(q.x,q.z));
      if(WIDE){ const ws = pts.map(q=>T.waterAt(q.x,q.z,H(q.x,q.z)).kind);
        if(ws.includes("lava")) why.add("溶岩の上・すぐそばには置けない");
        if(ws.some(k=>k && k!=="river" && k!=="lava")) why.add("海・湖・池・川の中には置けない"); }
      if(WIDE && p.rule!=="waterside" && pts.some(q=>terrainBlocked(q.x,q.z))) why.add("崖や深い水にかかっている");
      if(p.rule==="waterside"){        // 水車：川の水ぎわ（一部が水にかかり、中心は岸の上）
        const dc = T.distanceToRiver(t.x,t.z);
        if(!(dc > 3.4 && dc < 6.4 && Math.min(...dr) < 4.6)) why.add("水車は川の水ぎわ（半分が水にかかる所）に置く");
      } else if(Math.min(...dr) < 5.0) why.add("川（水の中・水ぎわ）には置けない");
      for(const o of structs){ if(o.id===ignore || o.id.startsWith(ignore+":")) continue;
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
        if(!bad) for(const o of nearbySolids(S,w.x,w.z,now)){ if(o.id===ignore || o.id.startsWith(ignore+":")) continue; if(sdist(o,w.x,w.z) < PLAYER_R){ bad=true; break; } }
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
    const covered = o=> !o.static && solidStructs.some(t=> Math.abs(t.x-o.x) < t.r+o.r+1 && Math.abs(t.z-o.z) < t.r+o.r+1 && sdist(t,o.x,o.z) < o.r + 0.25);

    /* ---------- 状態 ---------- */
    const kindOf = o=>KINDS[o.kind];
    const nameOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].name) || kindOf(o).name;
    const iconOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].icon) || kindOf(o).icon;
    const yieldsOf = o=> (o.variant && VARIANTS[o.kind+":"+o.variant] && VARIANTS[o.kind+":"+o.variant].yields) || kindOf(o).yields;
    function stock(S, o, now){ const K=kindOf(o); return E.stockOf(S, o.id, K.uses, K.regrow, now); }
    // 道が存続する間は草を再生・採取させない。撤去後は既存の再生時間に従う。
    function roadCovered(S,o){
      if(o.kind!=="grass" || !S.cons)return false;
      const cell=D.construction?.CELL||2, i=Math.round(o.x/cell),j=Math.round(o.z/cell);
      if(S.cons.roads?.[i+","+j])return true;
      return Object.values(S.cons.inst||{}).some(v=>v.kind==="road"&&v.stage>0&&v.cells.some(q=>q.i===i&&q.j===j));
    }
    function present(S, o, now){ return !roadCovered(S,o) && stock(S,o,now).left > 0 && !covered(o); }
    /* 当たり判定に使うか（取り尽くした木・岩は切り株・残骸になり、歩行を妨げない） */
    function solid(S, o, now){ return o.static ? true : o.block && present(S,o,now); }
    /* 採取できるか・できない理由・得られる素材 */
    function info(S, o, now){
      const K=kindOf(o), k=stock(S,o,now), base=yieldsOf(o), y={};
      Object.keys(base).forEach(id=>{ y[id]=base[id]; });
      if(K.bonus && E.has(S,K.bonus)) Object.keys(y).forEach((id,i)=>{ if(i===0) y[id]+=1; });
      const out = {name:nameOf(o), icon:iconOf(o), verb:K.verb, yields:y, left:k.left, uses:K.uses, until:k.until, need:K.need, after:K.after};
      if(roadCovered(S,o)) return Object.assign(out,{ok:false,kind:"covered",reason:"道の下になっている"});
      if(covered(o)) return Object.assign(out, {ok:false, kind:"covered", reason:"建物の下になっている"});
      if(k.left<=0) return Object.assign(out, {ok:false, kind:"empty", reason: k.until ? "取り尽くした（しばらくすると戻る）" : K.after==="stump" ? "切り株になった" : K.after==="rubble" ? "砕けた" : "もうない"});
      if(K.need && !K.need.some(t=>(E.hasTool||E.has)(S,t))) return Object.assign(out, {ok:false, kind:"tool", reason:"「"+K.need.map(t=>D.items[t].name).join("」か「")+"」が必要"});
      return Object.assign(out, {ok:true});
    }
    /* 描画モジュールへ渡す状態（表示専用） */
    function visual(S, o, now){
      const k = stock(S,o,now), K=kindOf(o);
      return {id:o.id, kind:o.kind, variant:o.variant, position:{x:o.x, z:o.z}, rotationY:o.rot, scale:o.scale,
              state: (covered(o)||roadCovered(S,o)) ? "gone" : k.left>0 ? "intact" : K.after, collider: {shape:"circle", r:o.r, solid: solid(S,o,now)}, uses:K.uses, left:k.left};
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

    /* ---------- 地形で歩けない所（崖・深い水）：0.5マスの格子を16マスの区画ごとに一度だけ計算して覚える ---------- */
    const TG = 0.5, TT = 32, ttiles = new Map();
    function terrainTile(ti, tj){
      const k = ti+","+tj; let t = ttiles.get(k); if(t) return t;
      t = new Uint8Array(TT*TT);
      const n = TT+2, hs = new Float32Array(n*n), x0 = ti*TT*TG, z0 = tj*TT*TG;
      for(let j=0;j<n;j++) for(let i=0;i<n;i++) hs[j*n+i] = H(x0+(i-0.5)*TG, z0+(j-0.5)*TG);
      for(let j=0;j<TT;j++) for(let i=0;i<TT;i++){
        const x = x0+(i+0.5)*TG, z = z0+(j+0.5)*TG, h = hs[(j+1)*n+i+1];
        const sl = Math.max(Math.abs(hs[(j+1)*n+i+2]-hs[(j+1)*n+i]), Math.abs(hs[(j+2)*n+i+1]-hs[j*n+i+1]))/(2*TG);
        let bad = sl > T.WALK_SLOPE;
        // 0.5マスの格子の中心で判定するので、格子の中でも深さの上限を超えないよう少し手前（0.08）で止める
        if(!bad){ const w = T.waterAt(x,z,h); if(w.kind && w.kind!=="river" && w.depth > T.WADE_DEPTH - 0.08) bad = true; }
        t[j*TT+i] = bad ? 1 : 0;
      }
      ttiles.set(k, t); return t;
    }
    /* その点の地形が歩けないか（崖・深い水）。旧世界の決まりだけのときは常に歩ける */
    function terrainBlocked(x, z){
      if(!WIDE) return false;
      const cx = Math.floor(x/TG), cz = Math.floor(z/TG), ti = Math.floor(cx/TT), tj = Math.floor(cz/TT);
      return terrainTile(ti,tj)[(cz-tj*TT)*TT + (cx-ti*TT)] === 1;
    }

    /* ---------- 第3層：広い世界の新しい陸地の自然物（2026-11-07） ----------
       旧世界の外（|x| か |z| が 53.5 以上）だけ。主人公の近くの 32マスの区画ごとに、必要になったときに作る。
       候補は「種類ごとの揺らぎのある格子のマス」から、位置と大きさと順位をハッシュで決める（乱数の順番に依らない）。
       重なる候補どうしは順位の高い方を残す（判定は候補の場所だけで決まる）ので、どの順番で区画を作っても同じ位置・同じ ID になる。
       旧世界の自然物・採取地点とは重ならない。登山道・川・滝つぼ・池・見晴らし台・急な斜面・水の中には置かない。 */
    const L3 = { tree:{cell:3.1, rank:6}, rock:{cell:7.0, rank:5}, bush:{cell:4.6, rank:4}, grass:{cell:3.7, rank:3}, twig:{cell:5.2, rank:2}, pebble:{cell:6.2, rank:1} };
    const hsh = (i,j,k)=>{ let h = (i*374761393 + j*668265263 + k*1442695041) | 0; h = (h ^ (h>>>13)) * 1274126177 | 0; return ((h ^ (h>>>16)) >>> 0) / 4294967296; };
    const vn3 = (x,z,c,k)=>{ const fx=x/c, fz=z/c, i=Math.floor(fx), j=Math.floor(fz), u=smooth(0,1,fx-i), v=smooth(0,1,fz-j);
      const a=hsh(i,j,k), b=hsh(i+1,j,k), cc=hsh(i,j+1,k), d=hsh(i+1,j+1,k); return a+(b-a)*u+(cc-a)*v+(a-b-cc+d)*u*v; };
    const KIDX = {tree:1, rock:2, bush:3, grass:4, twig:5, pebble:6};
    const trailD = (x,z)=> WIDE && T.TRAILS ? Math.min(...Object.values(T.TRAILS).map(P=>trailNear(P,x,z))) : 99;
    function trailNear(P, x, z){ let best=99; for(let i=0;i<P.pts.length-1;i++){ const a=P.pts[i], b=P.pts[i+1];
      if(Math.min(a.x,b.x)-6>x || Math.max(a.x,b.x)+6<x || Math.min(a.z,b.z)-6>z || Math.max(a.z,b.z)+6<z) continue;
      const dx=b.x-a.x, dz=b.z-a.z, L=dx*dx+dz*dz, t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L)); best=Math.min(best, Math.hypot(x-(a.x+dx*t), z-(a.z+dz*t))); } return best; }
    const cand3 = new Map();
    /* 外の野（2026-11-10）を足しても、長方形 T.WALK（±172）の中の自然物の位置と ID を変えない（既存セーブの採取状態を守る）：
       長方形の中の候補は以前と同じ決まり（長方形の内側 3 マス）で選び、長方形の外（外の野）の候補は円の内側 3 マスで選ぶ。
       重なりの判定（survives）では、外の野の候補は長方形の中の候補を消さない */
    const CORE = WIDE ? T.WALK : null;
    const isCore = (x,z)=> !CORE || (x >= CORE.minX && x <= CORE.maxX && z >= CORE.minZ && z <= CORE.maxZ);
    const inWorld3 = (x,z)=> (isCore(x,z) && CORE) ? (x >= CORE.minX+3 && x <= CORE.maxX-3 && z >= CORE.minZ+3 && z <= CORE.maxZ-3) : inWorld(x,z,3);
    /* 種類 kind のマス (ci,cj) の候補：{kind,x,z,s,pri,valid,variant} か null（置かない） */
    function candidate(kind, ci, cj){
      const key = kind+":"+ci+","+cj; if(cand3.has(key)) return cand3.get(key);
      const spec = L3[kind], kk = KIDX[kind]*7;
      const x = (ci + hsh(ci,cj,kk+1))*spec.cell, z = (cj + hsh(ci,cj,kk+2))*spec.cell;
      let c = null;
      if(Math.max(Math.abs(x),Math.abs(z)) >= 53.5 && inWorld3(x,z)){
        const roll = hsh(ci,cj,kk+3), s = 0.75 + hsh(ci,cj,kk+4)*0.7;
        const dens = density3(kind, x, z);
        if(roll < dens.p){
          const K = KINDS[kind], sc = kind==="rock" ? 0.6+hsh(ci,cj,kk+4)*0.75 : kind==="tree" ? 0.75+hsh(ci,cj,kk+4)*0.7 : 0.85+hsh(ci,cj,kk+4)*0.45;
          if(valid3(kind, x, z, sc, dens)) c = {kind, x:+x.toFixed(2), z:+z.toFixed(2), s:sc, r:K.r*sc, block:K.block, pri:spec.rank + hsh(ci,cj,kk+5), variant:dens.variant, rot:hsh(ci,cj,kk+6)*Math.PI*2};
          void s;
        }
      }
      cand3.set(key, c); return c;
    }
    /* 場所ごとの置きやすさ（0〜1）と見た目の違い。地形の性格は T.biome（描画と同じ関数） */
    function density3(kind, x, z){
      const h = H(x,z), b = T.biome(x,z,h), clumpV = 0.65*vn3(x,z,9,KIDX[kind]) + 0.35*vn3(x,z,4,KIDX[kind]+7);
      const wetNear = (T.streamAt(x,z).d < 4.5) || b.lake > 0.3;
      const lowMountain = b.mountain > 0.05 && h < 22 ? 1 : 0;
      const hv = vhash(Math.round(x*10), Math.round(z*10), 131);
      let p = 0, variant = null;
      /* Muse の7エリア（森林・湖畔・海岸・火山・雪山・砂漠・街の予定地）の重み b と、ゲームの山（b.mountain） */
      const volc = b.volcano, sand = b.desert, snow = b.snow, town = b.town, forest = b.forest;
      if(kind==="tree"){
        p = (0.06 + 0.8*forest*(clumpV<0.3?0.12:0.55+clumpV) + 0.35*lowMountain*(0.4+clumpV) + 0.3*snow*(0.3+clumpV) + 0.15*b.lakeside*clumpV) * (1-b.beach) * (1-b.alpine*0.85) * (1-volc*0.95) * (1-sand*0.92) * (1-town*0.85);
        if(b.coast > 0.55 && h < 2.6){ p = 0.05; variant = "palm"; }
        else if(sand > 0.5){ p = 0.012; variant = "palm"; }                          // 砂漠のオアシスのまわり
        else if((b.mountain > 0.15 && h > 7.5) || h > 13 || snow > 0.4) variant = "conifer";
      } else if(kind==="rock"){
        p = 0.04 + 0.55*b.mountain*sm01(4,12,h) + 0.45*volc + 0.25*snow + 0.12*sand + 0.1*clumpV;
        variant = (volc > 0.35 && hv < 0.75) || (b.mountain > 0.35 && h > 14 && hv < 0.5) ? "basalt" : forest > 0.6 && x < -60 && hv < 0.5 ? "mossy" : null;
      } else if(kind==="bush"){
        p = (0.05 + 0.4*forest*clumpV*1.4 + 0.3*(wetNear?1:0) + 0.15*lowMountain + 0.25*sand*clumpV) * (1-b.beach) * (1-b.alpine*0.7) * (1-volc*0.8) * (1-town*0.6);
        if(sand > 0.4 || volc > 0.3) variant = "dry";
      } else if(kind==="grass"){
        p = (0.12 + 0.3*(1-forest) + 0.35*town + 0.25*b.alpine + 0.2*b.lakeside) * (0.35 + clumpV) * (1 - b.beach*0.6) * (1 - volc*0.85) * (1 - sand*0.5);
        if(wetNear) variant = "reed"; else if(b.beach > 0.4 || sand > 0.4) variant = "dry";
      } else if(kind==="twig"){
        p = (0.04 + 0.35*forest + 0.15*lowMountain + 0.3*b.beach) * (1 - volc*0.9) * (1 - sand*0.7);
        if(b.beach > 0.5) variant = "driftwood";
      } else if(kind==="pebble"){
        p = 0.05 + 0.5*b.beach + 0.22*b.mountain + 0.25*volc + 0.15*sand;
        if(b.beach > 0.5 && hv < 0.6) variant = "shell"; else if((b.mountain > 0.3 || volc > 0.3) && hv < 0.3) variant = "flint";
      }
      return {p: Math.max(0, Math.min(1, p)), variant, h, b};
    }
    function sm01(a,b,v){ const t=Math.max(0,Math.min(1,(v-a)/(b-a))); return t*t*(3-2*t); }
    function valid3(kind, x, z, sc, dens){
      const K = KINDS[kind], h = dens.h;
      const dr = T.distanceToRiver(x,z); if(kind==="pebble" ? dr < 4.0 : dr < 5.6) return false;
      if(slope(x,z) > (K.block ? 0.55 : 0.9)) return false;
      const w = T.waterAt(x,z,h); if(w.kind) return false;
      if(dens.b.beach < 0.3 && h < wl + 0.12) return false;
      const td = trailD(x,z); if(td < (K.block ? 2.9 + K.r*sc : 1.1)) return false;
      if(Math.hypot(x-T.LOOKOUT.x, z-T.LOOKOUT.z) < T.LOOKOUT.r + (K.block ? 1.5 : 0)) return false;
      if(Math.hypot(x-T.FALL.pool.x, z-T.FALL.pool.z) < T.FALL.poolR + 2.4 || Math.hypot(x-T.TARN.x, z-T.TARN.z) < T.TARN.r + 1.6) return false;
      // Muse の依頼：火口の溶岩湖（半径 8.2）のまわり ±10 には置かない。凍った池の氷の上にも置かない
      if(T.LAVA_LAKE && Math.hypot(x-T.LAVA_LAKE.x, z-T.LAVA_LAKE.z) < 10 + K.r*sc) return false;
      if(T.FROZEN_POND && Math.hypot(x-T.FROZEN_POND.x, z-T.FROZEN_POND.z) < T.FROZEN_POND.r + 1.2) return false;
      // 火山（2026-11-11）：登山道の岩棚と、火口縁（尾根）には道をふさぐ物を置かない。今の採取地点のそばにも置かない
      if(T.VOLCANO){ const rv = Math.hypot(x-T.VOLCANO.x, z-T.VOLCANO.z);
        if(K.block && rv < T.VOLCANO.rimOutR + 2.5) return false;
        if(T.VOLC_LEDGES.some(L=>Math.hypot(x-L.x, z-L.z) < L.r + (K.block ? 1.2 + K.r*sc : 0.3))) return false; }
      if(depNow.some(p=>Math.hypot(x-p.x, z-p.z) < 2.4)) return false;
      const st = T.streamAt(x,z); if(st.which && st.d < (K.block ? 3.6 : 2.3)) return false;
      if(terrainBlocked(x,z)) return false;
      return true;
    }
    const gapOf = (a, b)=> (a.block && b.block) ? a.r + b.r + 1.4 : (a.block || b.block) ? a.r + b.r + 0.5 : 0.8;
    /* 順位の高い候補・旧世界の自然物・採取地点と重ならないか */
    function survives(c){
      for(const k2 of Object.keys(L3)){
        const cell = L3[k2].cell, R = 4.4, i0 = Math.floor((c.x-R)/cell)-1, i1 = Math.floor((c.x+R)/cell)+1, j0 = Math.floor((c.z-R)/cell)-1, j1 = Math.floor((c.z+R)/cell)+1;
        const cCore = isCore(c.x, c.z);
        for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++){ const o = candidate(k2,i,j); if(!o || o===c) continue;
          const oCore = isCore(o.x, o.z);
          if(cCore && !oCore) continue;                   // 外の野の候補は長方形の中の候補を消さない
          if(o.pri <= c.pri && !(oCore && !cCore)) continue; // 外の野の候補は、重なる長方形の中の候補に必ず譲る
          if(Math.hypot(o.x-c.x, o.z-c.z) < gapOf(c,o)) return false; }
      }
      if(Math.max(Math.abs(c.x),Math.abs(c.z)) < 62){
        for(const o of oldNear(c.x, c.z, 5)) if(Math.hypot(o.x-c.x, o.z-c.z) < gapOf(c,o)) return false;
        if(deps.some(p=>near(c.x,c.z,p.x,p.z) < 2.4)) return false;
      }
      return true;
    }
    const BS = 32, blocks3 = new Set();
    let gen3 = 0;
    function genBlock(bi, bj){
      const bk = bi+","+bj; if(blocks3.has(bk)) return; blocks3.add(bk);
      if(!WIDE) return;
      const x0 = bi*BS, z0 = bj*BS;
      if(x0+BS < WB.minX || x0 > WB.maxX || z0+BS < WB.minZ || z0 > WB.maxZ) return;
      if(x0 >= -53.5 && x0+BS <= 53.5 && z0 >= -53.5 && z0+BS <= 53.5) return;    // 旧世界の中
      for(const kind of Object.keys(L3)){
        const cell = L3[kind].cell;
        for(let i=Math.floor(x0/cell)-1; i<=Math.floor((x0+BS)/cell)+1; i++) for(let j=Math.floor(z0/cell)-1; j<=Math.floor((z0+BS)/cell)+1; j++){
          const c = candidate(kind,i,j); if(!c || c.x < x0 || c.x >= x0+BS || c.z < z0 || c.z >= z0+BS) continue;
          if(!survives(c)) continue;
          const K = KINDS[kind], id = kind+":"+Math.round(c.x*10)+","+Math.round(c.z*10);
          if(byId.has(id)) continue;
          const reg = regionAt(c.x,c.z);
          const o = {id, kind, variant:c.variant||null, x:c.x, z:c.z, rot:+c.rot.toFixed(3), scale:+c.s.toFixed(2), r:+(K.r*c.s).toFixed(3), block:K.block, region: reg ? reg.id : null, layer:3};
          objs.push(o); byId.set(id,o); gen3++;
          const ak = Math.floor(o.x/AG)+","+Math.floor(o.z/AG); if(!agrid.has(ak)) agrid.set(ak,[]); agrid.get(ak).push(o);
          if(o.block){ const ck2 = ck(Math.floor(o.x/CELL), Math.floor(o.z/CELL)); if(!cells.has(ck2)) cells.set(ck2,[]); cells.get(ck2).push(o); }
        }
      }
      gridCache = null;
    }
    /* (x,z) のまわり rad マスの区画を用意する */
    function ensure(x, z, rad){
      if(!WIDE) return;
      const i0 = Math.floor((x-rad)/BS), i1 = Math.floor((x+rad)/BS), j0 = Math.floor((z-rad)/BS), j1 = Math.floor((z+rad)/BS);
      for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++) if(!blocks3.has(i+","+j)) genBlock(i,j);
    }
    function ensureAll(){ if(!WIDE) return; for(let i=Math.floor(WB.minX/BS); i<=Math.floor(WB.maxX/BS); i++) for(let j=Math.floor(WB.minZ/BS); j<=Math.floor(WB.maxZ/BS); j++) genBlock(i,j); }

    /* ---------- 当たり判定（地面上の円と空間分割） ---------- */
    const CELL = 4, cells = new Map();
    const ck = (cx,cz)=>cx+","+cz;
    objs.concat(statics).forEach(o=>{ if(!o.block) return; const cx=Math.floor(o.x/CELL), cz=Math.floor(o.z/CELL); const k=ck(cx,cz); if(!cells.has(k)) cells.set(k,[]); cells.get(k).push(o); });
    function nearbySolids(S, x, z, now){
      ensure(x, z, 6);
      const out=[]; const cx=Math.floor(x/CELL), cz=Math.floor(z/CELL);
      for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){ const a=cells.get(ck(cx+i,cz+j)); if(a) a.forEach(o=>{ if(solid(S,o,now)) out.push(o); }); }
      for(const t of solidStructs) if(Math.abs(t.x-x) < t.r+CELL && Math.abs(t.z-z) < t.r+CELL) out.push(t);
      for(const n of npcCols) if(n.id!==moveIgnore && Math.abs(n.x-x) < CELL && Math.abs(n.z-z) < CELL) out.push(n);
      return out;
    }
    /* 地域の鍵は 2026-11-11 に廃止（すべての地域へ最初から入れる。止めるのは崖・深い水・溶岩などの物理的な通行止めだけ） */
    /* その場所に主人公が立てるか */
    function free(S, x, z, now){
      if(!inWorld(x,z)) return false;
      if(terrainBlocked(x,z)) return false;
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
      p.x=Math.max(WB.minX,Math.min(WB.maxX,p.x)); p.z=Math.max(WB.minZ,Math.min(WB.maxZ,p.z));
      if(WR){ const d=Math.hypot(p.x,p.z); if(d > WR){ p.x*=WR/d; p.z*=WR/d; } }
      return p;
    }
    /* 移動（キー・スティック・クリック移動で共通）。大きな移動は細かく分けて、すり抜けない。
       障害物に向かって進むと、外周に沿って滑る。崖・深い水の手前では止まり、横方向に動けるならそちらへ滑る。
       戻り値：{x,z,hit,locked,cliff} */
    let moveIgnore = null;
    function move(S, from, dx, dz, now, ignore){
      if(ignore){ moveIgnore=ignore; try{ return move(S, from, dx, dz, now); } finally { moveIgnore=null; } }
      const len = Math.hypot(dx,dz); if(len<1e-9) return {x:from.x, z:from.z, hit:false};
      const steps = Math.max(1, Math.ceil(len/0.15));
      let p = {x:from.x, z:from.z}, hit=false, lockedHit=null, cliff=false;
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
        let q = {x:p.x+vx, z:p.z+vz};
        if(terrainBlocked(q.x,q.z) && !terrainBlocked(p.x,p.z)){
          // 崖・深い水：そのままは進めない。片方の向きだけなら進めるなら、そちらへ滑る
          cliff=true; hit=true;
          if(Math.abs(vx) > 1e-6 && !terrainBlocked(p.x+vx, p.z)) q = {x:p.x+vx, z:p.z};
          else if(Math.abs(vz) > 1e-6 && !terrainBlocked(p.x, p.z+vz)) q = {x:p.x, z:p.z+vz};
          else break;
        }
        depenetrate(S,q,now);
        if(terrainBlocked(q.x,q.z) && !terrainBlocked(p.x,p.z)) break;       // 押し出された先が崖なら、その場にとどまる
        p=q;
      }
      return {x:p.x, z:p.z, hit, locked:lockedHit, cliff};
    }

    /* ---------- 経路探索（クリック移動・採取対象への移動） ----------
       広い世界では、出発点と目的地を囲む範囲（まわりに余白）だけの格子で探す */
    const GRID = 0.5;
    let gridCache=null, gridSig="", lastPath=null;
    function windowFor(a, b, margin){
      const x0 = Math.max(WB.minX, Math.min(a.x,b.x)-margin), x1 = Math.min(WB.maxX, Math.max(a.x,b.x)+margin);
      const z0 = Math.max(WB.minZ, Math.min(a.z,b.z)-margin), z1 = Math.min(WB.maxZ, Math.max(a.z,b.z)+margin);
      const ox = Math.floor(x0/GRID)*GRID, oz = Math.floor(z0/GRID)*GRID;
      return {ox, oz, nx: Math.ceil((x1-ox)/GRID)+1, nz: Math.ceil((z1-oz)/GRID)+1};
    }
    function blockGrid(S, now, win){
      ensure((win.ox + win.ox + win.nx*GRID)/2, (win.oz + win.oz + win.nz*GRID)/2, Math.max(win.nx, win.nz)*GRID/2 + 2);
      const sig = win.ox+","+win.oz+","+win.nx+","+win.nz+"|"+"|"+gen3+"|"+objs.filter(o=>o.block && !present(S,o,now)).map(o=>o.id).join(",")+"|"+structSig+"|"+npcCols.length;
      if(gridCache && sig===gridSig) return gridCache;
      const {ox, oz, nx, nz} = win, g = new Uint8Array(nx*nz);
      const gi = v=>Math.round((v-ox)/GRID), gj = v=>Math.round((v-oz)/GRID), gx = i=>ox+i*GRID, gz = j=>oz+j*GRID;
      // 崖・深い水のまわり 0.25 マスもふさぐ（経路の直線が崖のふちをかすめないように）
      for(let i=0;i<nx;i++) for(let j=0;j<nz;j++){ const x=gx(i), z=gz(j); if(!inWorld(x,z,0.2) || terrainBlocked(x,z) || terrainBlocked(x-0.25,z-0.25) || terrainBlocked(x+0.25,z-0.25) || terrainBlocked(x-0.25,z+0.25) || terrainBlocked(x+0.25,z+0.25)) g[i*nz+j]=1; }
      const mark=(cx,cz,r)=>{ const a=gi(cx-r), b=gi(cx+r), c=gj(cz-r), d=gj(cz+r);
        for(let i=Math.max(0,a);i<=Math.min(nx-1,b);i++) for(let j=Math.max(0,c);j<=Math.min(nz-1,d);j++){ if(Math.hypot(gx(i)-cx,gz(j)-cz) < r) g[i*nz+j]=1; } };
      const inWin = o=> o.x > ox-3 && o.x < ox+nx*GRID+3 && o.z > oz-3 && o.z < oz+nz*GRID+3;
      objs.forEach(o=>{ if(inWin(o) && solid(S,o,now)) mark(o.x,o.z,o.r+PLAYER_R+0.08); });
      statics.forEach(o=>{ if(inWin(o)) mark(o.x,o.z,o.r+PLAYER_R+0.08); });
      solidStructs.forEach(t=>{ if(!inWin(t)) return; const R=t.r+PLAYER_R+0.1, a=gi(t.x-R), b=gi(t.x+R), c=gj(t.z-R), d=gj(t.z+R);
        for(let i=Math.max(0,a);i<=Math.min(nx-1,b);i++) for(let j=Math.max(0,c);j<=Math.min(nz-1,d);j++){ if(sdist(t,gx(i),gz(j)) < PLAYER_R+0.08) g[i*nz+j]=1; } });
      gridCache={g, win, gi, gj, gx, gz}; gridSig=sig; return gridCache;
    }
    const cellFree = (G,i,j)=> i>=0 && j>=0 && i<G.win.nx && j<G.win.nz && !G.g[i*G.win.nz+j];
    /* 目的地が障害物の中なら、近くの立てる場所へ */
    function nearestFree(S, p, now, maxR){
      const lim = Math.ceil((maxR||8)/GRID);
      const G = blockGrid(S, now, windowFor(p, p, (maxR||8)+1)); const ci=G.gi(p.x), cj=G.gj(p.z);
      if(cellFree(G,ci,cj) && free(S,p.x,p.z,now)) return {x:p.x, z:p.z};
      for(let r=1;r<=lim;r++){ let best=null, bd=1e9;
        for(let i=ci-r;i<=ci+r;i++) for(let j=cj-r;j<=cj+r;j++){ if(Math.max(Math.abs(i-ci),Math.abs(j-cj))!==r || !cellFree(G,i,j)) continue;
          const x=G.gx(i), z=G.gz(j), d=Math.hypot(x-p.x,z-p.z); if(d<bd && free(S,x,z,now)){ bd=d; best={x,z}; } }
        if(best) return best; }
      return null;
    }
    /* 直線で歩けるか（経路の間引き用） */
    function clearLine(G, a, b){
      const d=Math.hypot(b.x-a.x,b.z-a.z), n=Math.ceil(d/(GRID*0.5));
      for(let k=0;k<=n;k++){ const t=n?k/n:0; if(!cellFree(G,G.gi(a.x+(b.x-a.x)*t), G.gj(a.z+(b.z-a.z)*t))) return false; }
      return true;
    }
    /* A*。戻り値：経由点の配列（最初の点は含まない）。行けなければ null */
    /* 範囲：出発点と目的地のまわりに余白。見つからなければ余白を広げてもう一度（山を回り込む道など） */
    function findPath(S, from, to, now){
      const goal = nearestFree(S,to,now,6); if(!goal) return null;
      const dist = Math.hypot(goal.x-from.x, goal.z-from.z);
      for(const m of [Math.min(60, 16 + dist*0.35), 90, 150]){
        const r = findPathIn(S, from, goal, now, m); if(r) return r;
        if(m >= 16 + dist*0.35 && lastPath && lastPath.found===false && lastPath.expanded < 30) break;   // 出発点が囲まれている
      }
      return null;
    }
    function findPathIn(S, from, goal, now, margin){
      const G = blockGrid(S, now, windowFor(from, goal, margin));
      const GN = G.win.nz, NX = G.win.nx;
      const si=G.gi(from.x), sj=G.gj(from.z), ti=G.gi(goal.x), tj=G.gj(goal.z);
      if(clearLine(G, from, goal)) return [goal];
      const N=NX*GN, gS=new Float32Array(N).fill(Infinity), came=new Int32Array(N).fill(-1), closed=new Uint8Array(N);
      const heap=[]; const push=(f,k)=>{ heap.push([f,k]); let i=heap.length-1; while(i>0){ const p=(i-1)>>1; if(heap[p][0]<=heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p; } };
      const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let i=0; for(;;){ const l=2*i+1, r=l+1; let m=i; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===i) break; [heap[m],heap[i]]=[heap[i],heap[m]]; i=m; } } return top; };
      const start = si*GN+sj, target = ti*GN+tj;
      if(si<0||sj<0||si>=NX||sj>=GN) return null;
      gS[start]=0; push(Math.hypot(ti-si,tj-sj), start);
      let found=false, expanded=0; const LIMIT = Math.min(N, 350000);
      while(heap.length && expanded<LIMIT){
        const [,k]=pop(); if(closed[k]) continue; closed[k]=1; expanded++;
        if(k===target){ found=true; break; }
        const i=Math.floor(k/GN), j=k%GN;
        for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++){ if(!di&&!dj) continue;
          const ni=i+di, nj=j+dj; if(!cellFree(G,ni,nj) && !(ni*GN+nj===start)) continue;
          if(di&&dj && (!cellFree(G,i+di,j) || !cellFree(G,i,j+dj))) continue;   // 角を斜めにすり抜けない
          const nk=ni*GN+nj, cost=gS[k]+(di&&dj?1.4142:1);
          if(cost<gS[nk]){ gS[nk]=cost; came[nk]=k; push(cost+Math.hypot(ti-ni,tj-nj), nk); } }
      }
      lastPath = {found, expanded, startFree: cellFree(G,si,sj), targetFree: cellFree(G,ti,tj), win: G.win, si, sj, ti, tj};
      if(!found) return null;
      const pts=[]; for(let k=target; k!==-1 && k!==start; k=came[k]) pts.push({x:G.gx(Math.floor(k/GN)), z:G.gz(k%GN)});
      pts.reverse(); pts[pts.length-1]={x:goal.x, z:goal.z};
      // 見通しのきく点まで間引く
      const out=[]; let a=from, i=0;
      while(i<pts.length){ let j=pts.length-1; while(j>i && !clearLine(G,a,pts[j])) j--; out.push(pts[j]); a=pts[j]; i=j+1; }
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
    /* 地域の採取地点（中心 p・当たり判定の半径 r）へ向かう経路：まわりの立てる場所を、主人公に近い側から順に試し、歩いて行ける最初の所。
       （中心のいちばん近い空きを目的地にすると、岩と採取地点のすき間の、外から入れない小さな空きを選ぶことがあった。2026-11-11） */
    function pathToDeposit(S, p, r, from, now){
      const base = Math.atan2(from.z-p.z, from.x-p.x);
      for(const d of [r + PLAYER_R + 0.35, r + PLAYER_R + 0.9, r + PLAYER_R + 1.6]) for(let k=0;k<16;k++){
        const a = base + (k%2?1:-1)*Math.ceil(k/2)*Math.PI/8, q = {x:p.x+Math.cos(a)*d, z:p.z+Math.sin(a)*d};
        if(!free(S,q.x,q.z,now) || Math.hypot(q.x-p.x, q.z-p.z) - 0.6 > E.REACH) continue;
        const path = findPath(S, from, q, now); if(path) return path; }
      return null;
    }
    /* 古いセーブの位置が岩などに埋まっていたら、近くの立てる場所へ */
    function safeSpawn(S, p, now){
      if(free(S,p.x,p.z,now)) return {x:p.x, z:p.z, moved:false};
      const q = nearestFree(S,p,now,20) || {x:base.x, z:base.z};
      return {x:q.x, z:q.z, moved:true};
    }
    /* 近くの自然物（半径 rad 以内） */
    /* 近くの自然物だけを引く（8マスの格子。毎フレームの近接判定・表示の同期で全件を走査しない） */
    function around(x, z, rad){ ensure(x, z, rad+2); const out=[]; const x0=Math.floor((x-rad)/AG), x1=Math.floor((x+rad)/AG), z0=Math.floor((z-rad)/AG), z1=Math.floor((z+rad)/AG);
      for(let i=x0;i<=x1;i++) for(let j=z0;j<=z1;j++){ const c=agrid.get(i+","+j); if(c) for(const o of c) if(Math.abs(o.x-x)<=rad && Math.abs(o.z-z)<=rad && Math.hypot(o.x-x,o.z-z)<=rad) out.push(o); }
      return out; }

    return {objects:objs, statics, byId, KINDS, VARIANTS, PLAYER_R, WORLD_R, REGION_R, nameOf, iconOf, yieldsOf, stock, present, solid, info, visual, harvest, reachGap,
            free, move, depenetrate, findPath, nearestFree, approachPoint, safeSpawn, around, nearbySolids, layer2:L2N,
            setStructures, structures:()=>structs.slice(), sdist, covered, checkPlacement, commitPlacement, removePlacement, toWorld, decos, setNpcs,
            terrainBlocked, slope, height:H, waterKind:(x,z)=>{ if(!WIDE) return null; const k=T.waterAt(x,z,H(x,z)).kind; return k && k!=="lava" ? k : (k==="lava" ? "lava" : null); }, riverDist:(x,z)=>T.distanceToRiver(x,z), pathToDeposit, ensure, ensureAll, wide:WIDE, bounds:WB, walkR:WR, inWorld:(x,z,m)=>inWorld(x,z,m), layer3:()=>gen3, lastPath:()=>lastPath};
  }
  return {create, KINDS, VARIANTS, PLAYER_R, SEED, DEPOSIT_SHAPE, depShape, SITES, FORMER_STONEWORK, GEN_REGIONS};
})();
if (typeof module!=="undefined") module.exports = NATURE;
