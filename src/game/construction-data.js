/* ===================== 街づくり・現地建設のデータ（2026-11-14） =====================
   建物の設計図（定義）と、道の種類。判定は construction.js（CONS）、画面は construction-ui.js。
   ・建物は「予定地を決める → 資材を現地へ運ぶ → 工程ごとに施工する → 完成して初めて使える」。
   ・各工程の資材の合計は、以前の工作のレシピ（data.js の crafts）の材料と同じ（素材の量を変えない）。
   ・facility：完成するとその設備が使える（研究室・工作の条件）。null は設備の働きのない建物（住宅・広場・飾り）。
   ・salvage：解体・取消のとき、施工済みの工程から戻る資材（工程 id → {素材:個数}）。null は「返却表が未定＝戻らない」。
   ・model：描画の種類（Muse の structures.json と街の specs.json）。footprint・entrance・operate はそこから写した値。
   ・looks：外観違い（新しく建てるときだけ選べる。inst.look に保存。機能・工程・資材は元の設計図のまま。形・入口は Muse の town-construction.json の正式値の写し）。
   ・正式な工程別の見た目は Muse の納品待ち。それまでは src/construction-visual.ts の仮表示（杭・資材の山・足場）。 */
(function(D){
  if(D.construction) return;
  const S = (id, name, mat, work, tools) => ({id, name, mat: mat||{}, work, tools: tools||[]});
  const defs = [
    /* ---- 工房（小さな設備） ---- */
    {id:"workbench", name:"作業台", cat:"workshop", facility:"bench", model:"workbench", footprint:{shape:"rect", w:2.2, d:1.05}, operate:[0,1.05],
      stages:[S("assemble","枝と石を組む",{twig:4, thread:2, cobble:2},3,["knife"])], salvage:{assemble:{twig:2, cobble:2}},
      kid:"枝を組んで作る台。たたく・混ぜる・形を作る作業の場所になる。",
      /* 外観違い（2026-11-15 オーナー方針：既存設備の外観違い。設備の働き・工程・資材・返却は作業台と同じ。上位設備・必須設備にはしない） */
      looks:[{id:"workshop", name:"工房の建物", model:"look-workshop", footprint:{shape:"rect", w:4.8, d:3.6}, entrance:[0,2.0], operate:null, roadLink:[0,2.2], tall:3.57,
        stageGroups:{"0":["stage1_foundation","stage2_frame","stage3_shell","stage4_complete"]},
        kid:"作業台を屋根と壁で囲んだ建物の形。使える作業は作業台と同じ（数をふやしても作れる量は変わらない）。"}]},
    {id:"campfire", name:"たき火", cat:"workshop", facility:"campfire", model:"campfire", footprint:{shape:"circle", r:0.82}, operate:[0,1.25],
      stages:[S("ring","石で囲む",{cobble:3},2), S("light","火を起こす",{twig:3, leaves:1},2,["firedrill"])], salvage:{ring:{cobble:3}},
      kid:"石で囲んだ火。燃やす・煮る・焼く実験ができる。"},
    {id:"kiln", name:"かまど", cat:"workshop", facility:"kiln", model:"kiln", footprint:{shape:"circle", r:1.15}, operate:[0,1.55],
      stages:[S("base","石の土台",{cobble:4},3), S("wall","粘土の炉壁",{clay:3},4,["campfire"])], salvage:{base:{cobble:4}},
      kid:"粘土と石で囲った火の部屋。たき火より高い温度になる。"},
    {id:"smelter", name:"簡易炉", cat:"workshop", facility:"furnace", model:"smelter", footprint:{shape:"rect", w:3.3, d:2.2}, operate:[0,1.7],
      stages:[S("base","粘土の基礎",{clay:2},3), S("body","レンガの炉体",{brick:4},5,["kiln"]), S("bellows","ふいごの据付",{bellows:1},2)], salvage:{base:{clay:1}},
      kid:"焼きレンガの炉にふいごで空気を送る。金属を取り出せる。"},
    {id:"laboratory", name:"蒸留小屋", cat:"workshop", facility:"still", model:"laboratory", footprint:{shape:"rect", w:4.3, d:3.1}, entrance:[0,2.1], operate:[-0.5,1.6],
      stages:[S("base","粘土の基礎",{clay:1},3), S("still","蒸留器の据付",{copperplate:2, pot:1},4,["hammer","bench"])], salvage:null,
      kid:"銅の蒸留器を据えた小屋。液を温めて別の液に分ける。"},
    /* ---- 倉庫・住宅・公共 ---- */
    {id:"storehouse", name:"倉庫", cat:"storage", facility:"storehouse", model:"hut", footprint:{shape:"rect", w:3.3, d:2.7}, entrance:[0.45,1.35], operate:[0.45,1.95],
      stages:[S("base","丸太の土台",{log:2},3,["axe"]), S("frame","骨組み",{log:2, thread:2},4,["bench"]), S("wall","しっくいの壁",{plaster:2},4)], salvage:{base:{log:1}, frame:{log:1}},
      kid:"しっくいで固めた倉庫。自動採取の係を増やせる。",
      looks:[{id:"warehouse", name:"大きな倉庫", model:"look-warehouse", footprint:{shape:"rect", w:5.4, d:4.2}, entrance:[0,2.3], operate:[0,2.9], roadLink:[0,2.5], tall:3.68,
        stageGroups:{"0":["stage1_foundation"], "1":["stage1_foundation","stage2_frame"], "2":["stage1_foundation","stage2_frame","stage3_shell","stage4_complete"]},
        kid:"引き戸のついた大きな倉庫の形。働きはふつうの倉庫と同じ（しまえる量がふえるなどの働きはない）。"}]},
    {id:"house", name:"住宅", cat:"housing", facility:null, model:"town-hut-town", footprint:{shape:"rect", w:3.44, d:3.4}, entrance:[0,2.0],
      stages:[S("base","石の基礎",{cobble:6},4), S("frame","丸太の骨組み",{log:6},5,["axe"]), S("wall","壁と屋根",{plaster:4, brick:6},6)], salvage:null,
      kid:"人が暮らす家。街の大きさの目安になる（今は住民の数は増えない）。"},
    {id:"plaza", name:"石畳の広場", cat:"public", facility:null, model:"town-plaza", footprint:{shape:"rect", w:12.6, d:12.6}, walkable:true,
      stages:[S("grade","整地",{},6), S("pave","石を敷く",{granite:8, cobble:8},8,["hammer"])], salvage:null,
      kid:"石を敷いた広い場所。人が集まる街の中心になる（歩いて通れる）。"},
    {id:"lantern", name:"石どうろう", cat:"public", facility:null, model:"town-stone-lantern", footprint:{shape:"circle", r:0.39},
      stages:[S("set","石を組む",{granite:2},3,["hammer"])], salvage:{set:{granite:2}}, kid:"石を組んだ明かりの台。街の飾り（明かりの働きはまだない）。"},
    /* ---- 大型の設備（工場・発電・化学） ---- */
    {id:"blastfurnace", name:"高炉", cat:"factory", facility:"blastfurnace", model:"smelter", footprint:{shape:"rect", w:3.3, d:2.2}, operate:[0,1.7],
      stages:[S("base","粘土の基礎",{clay:3},4), S("body","レンガの炉体",{brick:8},8), S("blast","送風管の据付",{ironrod:2},4,["waterwheel"])], salvage:null,
      kid:"水車で風を送る背の高い炉。鉄を大量に取り出せる。"},
    {id:"steamengine", name:"蒸気機関", cat:"factory", facility:"steamengine", model:"steam-engine", footprint:{shape:"rect", w:2.7, d:1.35}, operate:[0.4,1.2],
      stages:[S("base","レンガの台",{brick:2},4), S("engine","機関の据付",{steel:2, copperplate:2},6,["blastfurnace"])], salvage:null,
      kid:"水を沸かした蒸気の力でピストンを動かす機械。"},
    {id:"waterwheel", name:"水車", cat:"factory", facility:"waterwheel", model:"waterwheel", footprint:{shape:"rect", w:2.3, d:0.85}, operate:[1.6,0.8], rule:"waterside",
      stages:[S("axle","軸受け",{ironrod:2},4,["ironaxe","bench"]), S("wheel","車輪",{log:4},5)], salvage:null,
      kid:"川の流れで回る車。川の水ぎわにだけ建てられる。"},
    {id:"powerplant", name:"発電所", cat:"factory", facility:"generator", model:"power-plant", footprint:{shape:"rect", w:5.6, d:3.4}, entrance:[-2.2,2], operate:[1.7,2.2],
      stages:[S("base","据付台と配線",{wire:2},4), S("gen","発電機の据付",{electromagnet:2, wire:2},6,["waterwheel"])], salvage:null,
      kid:"電磁石と銅線を回して電気を作り続ける。"},
    {id:"refinery", name:"精留塔", cat:"factory", facility:"refinery", model:"distillation-tower", footprint:{shape:"rect", w:1.5, d:1.3}, operate:[0,1.15],
      stages:[S("base","鋼の基礎",{steel:1},4), S("tower","塔",{steel:2, glass:2},6), S("pipe","配管",{copperplate:2},4,["generator"])], salvage:null,
      kid:"原油を沸点ごとに分ける背の高い塔。"},
    {id:"factory", name:"大型工場（電気炉）", cat:"factory", facility:"eaf", model:"factory", footprint:{shape:"rect", w:5.2, d:4.2}, entrance:[0.35,2.5], operate:[0.35,2.9], maxRise:0.6,
      stages:[S("base","基礎",{brick:3},6), S("shell","建屋",{brick:3},8), S("arc","電極と配線の据付",{wire:4, coke:2},6,["generator"])], salvage:null,
      kid:"電気の火花で2000℃近い熱を出す炉を置いた工場。占有範囲の中の高低差も小さい平らな所が要る。"},
    {id:"institute", name:"化学研究所", cat:"factory", facility:"reactor", model:"research-institute", footprint:{shape:"rect", w:5.4, d:3.6}, entrance:[1.85,2], operate:[1.85,2.5], maxRise:0.6,
      stages:[S("base","基礎",{steel:1},4), S("hall","建屋",{steel:1, glass:2},6), S("reactor","装置の据付",{wire:2},5,["generator","thermometer"])], salvage:null,
      kid:"温度と圧力を管理して物質を分解したりつなげたりする装置の建物。"},
    {id:"rig", name:"掘削やぐら", cat:"factory", facility:"rig", model:"drilling-rig", footprint:{shape:"rect", w:2.6, d:2.2}, entrance:[0.35,1.5], operate:[-0.6,1.3],
      stages:[S("tower","鋼のやぐら",{steel:4},6,["steamengine"]), S("wire","配線",{wire:2},3)], salvage:null,
      kid:"鋼の塔とドリルで地面を深く掘る装置。"},
    /* ---- 飾り（設備の働きはない。説明にもそう書く） ---- */
    {id:"banner_red", name:"旗（赤）", cat:"deco", facility:null, model:"town-banner-red", footprint:{shape:"circle", r:0.12},
      stages:[S("set","竿と布",{log:1, cloth:2, redpigment:1},2)], salvage:{set:{log:1}}, kid:"赤く染めた布の旗。飾り。"},
    {id:"banner_green", name:"旗（緑）", cat:"deco", facility:null, model:"town-banner-green", footprint:{shape:"circle", r:0.12},
      stages:[S("set","竿と布",{log:1, cloth:2},2)], salvage:{set:{log:1}}, kid:"布の旗。飾り（緑の染料はまだないので、色は見た目だけ）。"},
    {id:"crates", name:"木箱の山", cat:"deco", facility:null, model:"town-crates", footprint:{shape:"rect", w:1.23, d:0.72},
      stages:[S("set","箱を組む",{log:2},2,["axe"])], salvage:{set:{log:1}}, kid:"木箱を積んだ飾り。倉庫の働きはない。"},
    {id:"barrel", name:"たる", cat:"deco", facility:null, model:"town-barrel", footprint:{shape:"circle", r:0.37},
      stages:[S("set","板と鉄の輪",{log:2, ironrod:1},2)], salvage:{set:{log:1}}, kid:"板を鉄の輪でしめたたる。飾り。"},
    {id:"bucket", name:"おけと縄", cat:"deco", facility:null, model:"town-bucket-rope", footprint:{shape:"circle", r:0.36},
      stages:[S("set","おけを組む",{log:1, thread:2},2)], salvage:null, kid:"木のおけと縄。飾り（水をくむ働きはない）。"},
    {id:"planter_large", name:"植木鉢（大）", cat:"deco", facility:null, model:"town-planter-large", footprint:{shape:"circle", r:0.37},
      stages:[S("set","鉢を置く",{clay:2},2)], salvage:null, kid:"粘土の植木鉢。飾り（農業はまだないので、育てたり収穫したりはできない）。"},
    {id:"planter_small", name:"植木鉢（小）", cat:"deco", facility:null, model:"town-planter-small", footprint:{shape:"circle", r:0.22},
      stages:[S("set","鉢を置く",{clay:1},1)], salvage:null, kid:"小さな植木鉢。飾り（収穫はできない）。"},
  ];
  /* 使わない街の素材（理由）：屋台＝売り買いの仕組みがない（置くと取引できるように見える）／果物かご＝食べ物と取引を連想させる。どちらも検証モードだけ */
  const notBuildable = {"town-stall":"売り買いの仕組みがまだない", "town-fruit-basket":"食べ物や取引の仕組みがまだない"};

  /* 道：2 マスの格子（cell）。種類ごとの工程（1 マスあたり）。上の種類は下の種類の工程を含む（土→砂利→石の順に重ねられる） */
  const roadStages = {
    grade:{name:"整地（踏み固め）", mat:{}, work:0.8},
    gravel:{name:"砂利を敷く", mat:{cobble:1, sand:1}, work:0.8},
    base:{name:"路盤（石の層）", mat:{cobble:1}, work:0.8},
    stone:{name:"石を敷く", mat:{granite:1}, work:1.0, tools:["hammer"]},
  };
  const roads = {
    dirt:{id:"dirt", name:"土の道", rank:1, stages:["grade"], color:"#8a6a45", kid:"土を踏み固めた道。材料はいらないが、整地の手間がかかる。"},
    gravel:{id:"gravel", name:"砂利道", rank:2, stages:["grade","gravel"], color:"#9b968a", kid:"丸い石と砂を敷いた道。雨でもぬかるみにくい。"},
    stone:{id:"stone", name:"石敷きの道", rank:3, stages:["grade","base","stone"], color:"#7d7f86", kid:"花崗岩の石を敷いた道。いちばん丈夫。"},
  };
  /* 以前の版（固定の場所に自動で建っていた建物）の写し：セーブの移行で、置いてあった設備を完成した建物へ移す */
  const legacy = [
    {plan:"st-bench", def:"workbench", fac:"bench", at:{x:-17,z:23}},
    {plan:"st-fire", def:"campfire", fac:"campfire", at:{x:-21.5,z:25.5}},
    {plan:"st-kiln", def:"kiln", fac:"kiln", at:{x:-25.5,z:19.5}},
    {plan:"st-hut1", def:"storehouse", fac:"storehouse", at:{x:-27,z:12}},
    {plan:"st-smelter", def:"smelter", fac:"furnace", at:{x:-13.5,z:15}},
    {plan:"st-lab", def:"laboratory", fac:"still", at:{x:-21,z:9}},
    {plan:"st-steam", def:"steamengine", fac:"steamengine", at:{x:-31,z:21}},
    {plan:"st-tower", def:"refinery", fac:"refinery", at:{x:-27,z:28}},
    {plan:"st-factory", def:"factory", fac:"eaf", at:{x:-10,z:30}},
    {plan:"st-power", def:"powerplant", fac:"generator", at:{x:-7,z:13}},
    {plan:"st-inst", def:"institute", fac:"reactor", at:{x:-30,z:31}},
    {plan:"st-wheel", def:"waterwheel", fac:"waterwheel", at:{x:15.2,z:3.8}, rot:2.17},
    {plan:"st-rig", def:"rig", fac:"rig", at:{x:3.2,z:48}},
  ];
  /* 街の発展の目安（実際に建てた物から数える。人口のシミュレーションはしない） */
  const townLevels = [
    {id:"camp", name:"野営地", need:{}},
    {id:"hamlet", name:"集落", need:{housing:1, workshop:1}},
    {id:"village", name:"村", need:{housing:3, workshop:2, road:10}},
    {id:"town", name:"町", need:{housing:6, workshop:4, public:1, road:30}},
    {id:"city", name:"都市", need:{housing:12, workshop:6, factory:2, public:3, road:80}},
  ];
  D.construction = {version:1, defs, notBuildable, roads, roadStages, legacy, townLevels,
    CELL:2, SECTION_MAX:10, REACH:2.6, ROAD_SLOPE:0.45, CLUSTER:22};
})(typeof DATA!=="undefined"?DATA:require("./data.js"));
if(typeof module!=="undefined") module.exports = require("./data.js").construction;
