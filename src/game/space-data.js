/* 宇宙編の追加データ。既存IDを保持。推進・誘導・高圧は完全に架空の規格。 */
(function(D){
  if(D.space) return;
  const defs=[], recipes=[];
  function part(id,name,group,inp,at,why,opt){
    opt=opt||{}; id='sp_'+id;
    const el=[...new Set(Object.keys(inp).flatMap(k=>(D.items[k]||{}).el||[]))];
    D.items[id]={id,name,yomi:name,en:name,tags:[opt.fac?'研究設備':'工業製品'],icon:opt.fac?'🛠️':'🔧',el,
      kid:why,more:why+' 工程と数量はゲーム内で簡略化。現実の製造手順や性能を示すものではありません。',
      store:true,unique:!!opt.fac,facility:!!opt.fac,ops:[],color:'#e8dfc8',space:true,group,iconAsset:'icon_'+id,model:opt.model||null};
    const c={id:'c_'+id,out:id,inp,qty:opt.qty||1,at:at||null,tools:opt.tools||[],how:why+'（ゲーム内で簡略化）',
      seconds:opt.seconds||2,lesson:opt.lesson||null,space:true};
    D.crafts.push(c);recipes.push(c);defs.push(id);
  }
  part('machine','精密加工台','材料',{steel:2,wire:2,glass:1},'bench','材料を一定の形に加工する設備。最初は手動計器で調整する。',{fac:true,tools:['generator']});
  part('materials','材料評価台','材料',{steel:1,glass:1,wire:1},'bench','用途に合う強さ・絶縁・気密を模擬試験で確かめる。',{fac:true,tools:['balance','thermometer']});
  part('plate','軽量外装板','材料',{aluminum:2,steel:1},'sp_machine','軽いアルミと丈夫な補強材を形にする。',{qty:6});
  part('frame','構造フレーム','材料',{steel:2,ironrod:1},'sp_machine','荷重を支える骨格。外装とは役割が違う。',{qty:4});
  part('fastener','締結部品','材料',{steel:1},'sp_machine','部品を固定し、点検時には交換できるようにする。',{qty:12});
  part('insulator','絶縁部品','材料',{pe:2,glass:1},'reactor','電気を通しにくい層で導体を分離する。',{qty:8});
  part('cable','被覆配線','電力',{wire:2,sp_insulator:1},'sp_machine','銅が電気を運び、被覆が接触を防ぐ。',{qty:6});
  part('fiber','機能繊維','材料',{naphtha:1,cloth:1},'reactor','天然布を試作の基材とし、機能高分子の加工を抽象化した丈夫な繊維。',{qty:6,tools:['sp_materials']});
  part('seal','柔軟シール材','材料',{naphtha:1,pe:1},'reactor','つなぎ目をふさぐ柔軟な架空規格材。普通のPEと同じ性能ではない。',{qty:8,tools:['sp_materials']});
  part('membrane','気密膜','材料',{sp_fiber:1,sp_seal:1},'reactor','布の強さとは別に空気を保持する役割を持つ。',{qty:4});
  part('thermal','積層断熱材','材料',{sp_fiber:1,sp_insulator:1,aluminum:1},'sp_machine','層を重ねて熱のやり取りを抑える。白い布一枚とは異なる。',{qty:4});
  part('ceramic','耐熱セラミック','材料',{alumina:1,quartzpowder:1},'eaf','熱にさらされる部位を保護する用途適合品。普通の土器とは区別する。',{qty:4,tools:['sp_materials']});
  part('window','透明保護材','材料',{glass:1,pe:1},'sp_machine','見通しと保護を両立させる架空の積層材。',{qty:3,tools:['sp_materials']});
  part('powerbench','電源組立台','電力',{steel:1,sp_cable:2,sp_insulator:2},'sp_machine','蓄電・配電を組み立てる。作る前の蓄電器には依存しない。',{fac:true,tools:['generator'],model:'power-distribution'});
  part('storage','蓄電モジュール','電力',{copper:1,zinc:1,charcoal:1,sp_insulator:2},'sp_powerbench','発電が途切れる間の電力を蓄える架空規格。ボルタ電池の充電ではない。',{qty:2});
  part('power','電源配電ユニット','電力',{sp_storage:1,sp_cable:3,sp_insulator:1},'sp_powerbench','電源・蓄電・負荷をつなぎ、異常時には停止する。');
  part('fab','電子部品製造設備','計算機',{steel:2,glass:2,sp_cable:2,sp_insulator:2},'sp_machine','清浄化と微細加工を設備能力に抽象化。砂から直接CPUは作れない。',{fac:true,tools:['generator'],model:'electronics-fab'});
  part('switch','スイッチ回路','計算機',{wire:1,sp_insulator:1,copperplate:1},'bench','導体をつなぐ・離すことで電流の通り道を切り替える。');
  part('transistor','切替素子','計算機',{pure_si:1,copper:1,sp_insulator:1},'sp_fab','小さな電気信号で状態を切り替える。素子加工の詳細は省略。',{qty:12,lesson:'switch'});
  part('pcb','配線基板','計算機',{copperplate:1,sp_insulator:1},'sp_fab','配線を安定して保持する土台。',{qty:8});
  part('passive','受動部品セット','計算機',{charcoal:1,sp_ceramic:1,copper:1},'sp_fab','抵抗やコンデンサーの役割をまとめ、信号を安定させる。',{qty:8});
  part('gate','論理ゲートセット','計算機',{sp_transistor:2,sp_pcb:1,sp_passive:1},'sp_fab','0と1をAND・OR・NOTの規則で組み合わせる。',{qty:4,lesson:'transistor'});
  part('adder','加算回路','計算機',{sp_gate:2,sp_pcb:1},'sp_fab','論理ゲートをつなぎ二進数の足し算を行う。',{qty:2,lesson:'gates'});
  part('memory','記憶回路','計算機',{sp_gate:2,sp_pcb:1,sp_transistor:2},'sp_fab','入力を変えても値を保持し、必要なとき読み出せる。',{qty:2,lesson:'gates'});
  part('cpu','演算制御モジュール','計算機',{sp_adder:1,sp_gate:2,sp_pcb:1},'sp_fab','演算器と制御部が順番に命令を処理する。',{lesson:'adder'});
  part('io','表示入力モジュール','計算機',{glass:1,sp_pcb:1,sp_transistor:1,sp_cable:1},'sp_fab','操作を入力し、計算結果を表示する。');
  part('computerbench','計算機組立台','計算機',{steel:1,sp_cable:1,glass:1},'sp_machine','演算・記憶・入出力を接続し動作を確認する。',{fac:true,tools:['generator'],model:'computer-bench'});
  part('computer','学習用コンピューター','計算機',{sp_cpu:1,sp_memory:1,sp_io:1,sp_power:1},'sp_computerbench','簡単な命令列を実行できる計算機。飛行制御には使用しない。',{lesson:'architecture'});
  part('sensor','模擬環境センサー','計算機',{sp_transistor:1,sp_pcb:1,glass:1,sp_cable:1},'sp_fab','船内環境を架空の状態値へ変換する。',{qty:3});
  part('flightcomputer','船内コンピューター','計算機',{sp_computer:1,sp_sensor:1,sp_plate:1},'sp_computerbench','環境状態と試験履歴を表示する。実際の誘導アルゴリズムは持たない。',{lesson:'sensors'});
  part('radio','通信ユニット','計算機',{sp_pcb:1,sp_transistor:1,sp_cable:2,copper:1},'sp_fab','地上と船内の模擬信号をやり取りする。',{qty:2});
  part('suitbench','宇宙服組立台','宇宙服',{steel:1,cloth:1,sp_fastener:2},'sp_machine','衣服・気密・保護の各層と装備を組み合わせる。',{fac:true,model:'suit-stand'});
  part('liner','内側の衣服','宇宙服',{cloth:2,thread:1},'bench','肌に触れる層。気密を保持する層とは別。');
  part('pressurelayer','宇宙服の気密層','宇宙服',{sp_membrane:2,sp_seal:2},'sp_suitbench','空気を保持する架空規格の層。圧力値や製法は扱わない。');
  part('protectlayer','宇宙服の保護層','宇宙服',{sp_fiber:2,sp_thermal:1},'sp_suitbench','外からのこすれと熱環境への保護を担当する。');
  part('helmet','ヘルメットとバイザー','宇宙服',{sp_window:1,sp_plate:1,sp_seal:1},'sp_suitbench','視界と保護、他の層との接続を担う。');
  part('gloves','手袋とブーツ','宇宙服',{sp_fiber:1,sp_membrane:1,sp_seal:1},'sp_suitbench','動きやすさと気密を両立する手足の装備。');
  part('air','呼吸環境供給部','生命維持',{cylinder:1,water:1,sp_seal:1},'sp_machine','電解設備で得た気体を直接装置へ移す工程と、適切な呼吸環境の調整を抽象化。酸素は既存仕様で保管不可。現実の混合比や高圧系統は扱わない。',{tools:['electrolyzer']});
  part('scrubber','空気再生部','生命維持',{charcoal:1,naphtha:1,sp_plate:1},'reactor','専用吸着材によるCO₂処理と汚染物除去を抽象化。木炭単独の働きではない。');
  part('waterunit','水衛生部','生命維持',{water:2,plasticbox:1,sp_cable:1},'sp_machine','飲用適合・湿度回収・衛生をまとめる。布ろ過だけで安全な飲み水にはならない。',{tools:['filter','sp_materials']});
  part('cooling','温度管理部','生命維持',{copper:1,aluminum:1,water:1,sp_thermal:1},'sp_machine','熱を運んで環境を保つ。断熱だけでは熱を捨てられない。');
  part('lifesupport','生命維持ユニット','生命維持',{sp_air:1,sp_scrubber:1,sp_waterunit:1,sp_cooling:1,sp_power:1,sp_sensor:1},'sp_machine','呼吸・水・熱・電源・監視の各機能をまとめる。',{model:'life-support'});
  part('suit','組立済み宇宙服','宇宙服',{sp_liner:1,sp_pressurelayer:1,sp_protectlayer:1,sp_helmet:1,sp_gloves:1,sp_radio:1,sp_lifesupport:1},'sp_suitbench','部品を組み立てた搭乗用宇宙服。有人飛行には装着と機能試験も必要。',{model:'spacesuit-display'});
  part('assembly','機体組立設備','機体',{sp_frame:2,sp_fastener:4,sp_cable:2},'sp_machine','骨格・外装・機器を順番に固定する。',{fac:true,model:'parts-rack'});
  part('hull','機体構造','機体',{sp_frame:3,sp_fastener:4},'sp_assembly','全ての機器を支える構造。ゲーム用の形であり実機設計ではない。');
  part('skin','機体外装','機体',{sp_plate:4,sp_thermal:2,sp_ceramic:2},'sp_assembly','内部を覆い保護する外装。構造とは別に製作する。');
  part('propulsion','架空推進モジュール','機体',{sp_frame:1,sp_ceramic:1,sp_insulator:2,sp_fastener:2},'sp_assembly','完全架空の航行規格。推進の配合・寸法・製造条件は再現しない。');
  part('charge','架空推進用カートリッジ','機体',{sp_plate:1,sp_insulator:1,sp_seal:1},'sp_assembly','物語内の認定資材。実在の推進剤や燃料レシピには対応しない。',{qty:2});
  part('capsule','搭乗カプセル','機体',{sp_plate:2,sp_window:1,sp_seal:2,sp_fastener:2},'sp_assembly','主人公が搭乗する区画。機器の組込みと機能試験は別途行う。');
  part('pad','発射台','地上設備',{concrete:3,sp_frame:2,sp_fastener:4},'sp_assembly','支持と整備の場所。持っているだけでは打ち上げできず、マップへの設置が必要。',{fac:true,model:'launch-pad'});
  part('tower','支持塔と搭乗通路','地上設備',{sp_frame:2,sp_plate:1,sp_fastener:4},'sp_assembly','主人公が機体へ近づくための支持設備。',{fac:true,model:'support-tower'});
  part('control','地上管制端末','地上設備',{sp_computer:1,sp_radio:1,sp_cable:2},'sp_computerbench','試験の結果と発射条件を表示する。',{fac:true,model:'control-terminal'});
  part('testbench','総合試験端末','地上設備',{sp_computer:1,sp_sensor:1,sp_cable:1},'sp_computerbench','装置を壊さず不足機能を確認する模擬試験装置。',{fac:true,model:'test-terminal'});
  const lessons=[
    {id:'switch',name:'導体・絶縁体とスイッチ',need:['sp_switch','battery','bulb'],prev:[],help:'スイッチを閉じると回路がつながり、ランプが点く。'},
    {id:'transistor',name:'電流で切り替える素子',need:['sp_transistor'],prev:['switch'],help:'制御入力が1なら、出力側も1になる模擬スイッチ。'},
    {id:'gates',name:'AND・OR・NOT',need:['sp_gate'],prev:['transistor'],help:'ANDは両方1、ORはどちらか1、NOTは入力を反転する。'},
    {id:'adder',name:'二進数の足し算',need:['sp_adder'],prev:['gates'],help:'3 + 2 = 5。二進数では0011 + 0010 = 0101。'},
    {id:'memory',name:'値の保存と読み出し',need:['sp_memory'],prev:['gates'],help:'書き込み後に入力を変えても、保存した値は残る。'},
    {id:'architecture',name:'演算・制御・記憶・入出力',need:['sp_cpu','sp_memory','sp_io'],prev:['adder','memory'],help:'演算は計算、制御は順番、記憶は保存、入出力は外との窓口。'},
    {id:'program',name:'簡単な命令列を実行',need:['sp_computer'],prev:['architecture'],help:'LOAD 2 → ADD 3 → STORE → OUT を模擬実行する。飛行制御ではない。'},
    {id:'sensors',name:'船内の状態を表示',need:['sp_computer','sp_sensor'],prev:['program'],help:'架空の環境値を読み、異常を表示する。誘導計算は行わない。'}
  ];
  const slots=[['structure','機体構造','sp_hull'],['skin','外装','sp_skin'],['propulsion','架空推進部','sp_propulsion'],['power','電源','sp_power'],['computer','船内計算機','sp_flightcomputer'],['radio','通信','sp_radio'],['capsule','搭乗区画','sp_capsule'],['life','生命維持','sp_lifesupport'],['charge','架空推進用資材','sp_charge']].map(([id,name,item])=>({id,name,item}));
  const tests=[['power','電源と配線',['power'],[],'配線'],['computer','計算機自己診断',['computer'],['power'],'記憶'],['radio','通信確認',['radio'],['power'],'通信'],['suit','宇宙服の機能',[],['power'],'気密'],['life','生命維持とカプセル',['life','capsule'],['power'],'空気再生'],['uncrewed','無人模擬飛行',slots.map(s=>s.id),['computer','radio','suit','life'],'模擬'],['final','総合点検',slots.map(s=>s.id),['uncrewed'],'全項目']].map(([id,name,slots,prior,answer])=>({id,name,slots,prior,answer}));
  D.space={ids:defs,recipes,lessons,slots,tests,groups:['材料','電力','計算機','宇宙服','生命維持','機体','地上設備'],
    siteItems:['sp_pad','sp_tower','sp_control','sp_power','sp_assembly','generator'],
    siteSpec:{id:'space-site',type:'space-site',footprint:{shape:'rect',w:18,d:18},entrance:[0,10],operate:[0,10],maxSlope:0.18},
    modelStatus:'Muse確定版LOD1導入。読込失敗時と着用宇宙服は仮表示。原本は未変更'};
})(typeof DATA!=='undefined'?DATA:require('./data.js'));
if(typeof module!=='undefined') module.exports=require('./data.js').space;
