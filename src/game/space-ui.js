/* ui.js のクロージャ内へビルド時に挿入する。判定の正本は SPACE。 */
function spaceUI(){return U.space||(U.space={section:'製作',group:'材料',item:'sp_machine',lesson:'switch',message:'',detail:false,output:null});}
function spEscape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function spBtn(action,text,id,disabled){return `<button class="btn small" data-sp="${action}" data-id="${id||''}" ${disabled?'disabled':''}>${text}</button>`;}
function spaceItemLink(id){const name=S.disc[id]||spaceUI().detail?nm(id):'未発見の'+(IT[id]?.group||'材料');return spBtn('item',(S.disc[id]||spaceUI().detail?ic(id):'？')+' '+spEscape(name),id);}
function spaceProject(){
  const p=SPACE.state(S),u=spaceUI(),C=D.space;
  if(p.phase==='boarded')return `<div class="sp-flight"><h2>搭乗完了</h2><p>宇宙服・生命維持・機体の点検は合格済みです。</p>${spBtn('launch','保存して打ち上げ')}${spBtn('back','搭乗を取り消す')}</div>`;
  if(p.phase!=='ground')return spaceFlight();
  let body='';
  if(u.section==='製作'){
    body=`<label>分野 <select id="sp-group">${C.groups.map(g=>`<option ${u.group===g?'selected':''}>${g}</option>`).join('')}</select></label>
    <p>材料・設備・実習がそろえば製作できます。文明段階による制限はありません。工程と数量はゲーム内で簡略化しています。同じ部品は最大20回のまとめ製作を使えます。原料集めには既存の自動採取も活用できます。</p>
    <div class="sp-grid">${C.recipes.filter(c=>IT[c.out].group===u.group).map(c=>{const n=SPACE.needs(S,c,1),made=SPACE.owned(S,c.out),status=made?'完成済み':n.some(x=>x.kind==='equipment')?'設備不足':n.some(x=>x.kind==='lesson')?'実習待ち':n.length?'材料不足':'製作可能';
      return `<article class="sp-card"><h4>${spaceItemLink(c.out)}</h4><b>${status} ${made?'（在庫'+E.cnt(S,c.out)+'・設置や組込を含む）':''}</b><p>${spEscape(IT[c.out].kid)}</p><small>${c.seconds}秒／回・生成${c.qty}個</small><p>${n.map(x=>spEscape(x.text)).join('／')}</p>${spBtn('select','材料と工程を見る',c.out)}</article>`;}).join('')}</div>`;
    if(u.item)body+=spaceRecipe(u.item);
  }
  if(u.section==='実習')body=spaceLesson();
  if(u.section==='発射サイト'){
    const b=S.build&&S.build['space-site'],pos=W3.pos||S.pos||{x:0,z:0},draft=u.site||{x:Math.round(pos.x+20),z:Math.round(pos.z),rot:0};
    body=`<p>発射台・支持塔と通路・管制端末・地上電源をまとめて設置します。占有範囲と見学用の空きを含めて確認します。</p><p>${SPACE.placed(S)?'設置済み：'+b.x+', '+b.z:'未設置'}</p>
    <p>${C.siteItems.map(spaceItemLink).join(' ')}</p>
    <div class="sp-fields"><label>X <input id="sp-x" type="number" value="${draft.x}" step="1"></label><label>Z <input id="sp-z" type="number" value="${draft.z}" step="1"></label><label>回転 <select id="sp-rot">${[0,90,180,270].map(a=>`<option value="${a}" ${draft.rot===a?'selected':''}>${a}°</option>`).join('')}</select></label></div>
    ${spBtn('find-site','空いている候補を探す')}${spBtn('check-site','候補を確認')}${spBtn('place-site','この場所に設置')}${SPACE.placed(S)?spBtn('walk-site','搭乗口へ歩く')+spBtn('overview','発射場を見渡す')+spBtn('low-angle','低い視点から見上げる'):''}
    <p><button class="btn small" data-sp-performance>10秒の描画計測</button> ${U.spacePerf?.fps!=null?spEscape(U.spacePerf.fps+' FPS／'+U.spacePerf.width+'×'+U.spacePerf.height):'この端末の表示フレームを計測します。計測を始めると発射場の表示に切り替わります。'}</p><p>木・岩が重なるときは採集で片付けるか、別の候補を選んでください。平地でも占有・入口・地形の条件を満たす必要があります。</p>
    <p class="desc">モデル：${W3.gfx&&window.HD2D?.spaceModelStatus?.(W3.gfx)==='ready'?'Muse正式モデルを表示（PC近景LOD0／遠景・スマホLOD1）':'読込み中／仮表示'}。宇宙服は男女それぞれの8方向シートを使用します。</p>`;
  }
  if(u.section==='組立')body=`<p>機体構造を最初に組み込み、以後の順番は自由です。段階 S${SPACE.stage(S)}。部品の取外し・交換や移設後は、関連する試験が失効します。</p>
    ${C.slots.map(s=>`<div class="sp-card"><b>${s.name}：${p.installed[s.id]?'組込済み':'未組込'}</b> ${spaceItemLink(s.item)} ${spBtn(p.installed[s.id]?'remove':'install',p.installed[s.id]?'取り外す':'組み込む',s.id,SPACE.locked(S))}</div>`).join('')}
    <div class="sp-card">宇宙服：${p.suit?'装着済み（男女別8方向）':'未装着'} ${spaceItemLink('sp_suit')}${spBtn('equip','宇宙服を装着','',!!p.suit)}</div>`;
  if(u.section==='試験')body=`<p>故障の原因に対応する工程を選びます。不合格でも部品は壊れません。試験は現在の構成だけに有効です。</p>${C.tests.map(t=>{const n=SPACE.testNeeds(S,t.id),status=SPACE.valid(S,t.id)?'合格':p.tests[t.id]?.pass?'失効':p.tests[t.id]?'要改善':'未実施';
    const prompts={power:'電気が負荷へ届かない。確認するのは？',computer:'保存した値が戻らない。確認するのは？',radio:'地上へ信号が届かない。確認するのは？',suit:'空気を保持できない。確認するのは？',life:'CO₂の状態が要点検。確認するのは？',uncrewed:'搭乗前に飛行のつながりを確かめる方法は？',final:'部分試験の後、最後に確認する範囲は？'};
    return `<article class="sp-card"><h4>${t.name}：${status}</h4><p>${n.map(spEscape).join('／')||prompts[t.id]}</p><label>確認する工程 <select id="sp-test-${t.id}">${['選んでください','配線','記憶','通信','気密','空気再生','模擬','全項目','外装の色'].map(v=>`<option>${v}</option>`).join('')}</select></label>${spBtn('test','試験する',t.id,n.length>0)}</article>`;}).join('')}`;
  if(u.section==='打ち上げ')body=`<p>初回は宇宙への到達が目標です。軌道投入・帰還は条件に含めません。</p><ul>${SPACE.conditions(S).map(c=>`<li>${c.ok?'✓':'不足'} ${c.name} ${!c.ok?spBtn('resolve','確認する',c.id):''}</li>`).join('')}</ul>
    <p>主人公：${p.phase==='boarded'?'搭乗済み':'未搭乗'}</p>${spBtn('board','搭乗する','',p.phase!=='ground')}${spBtn('launch','保存して打ち上げ','',p.phase!=='boarded')}${p.phase==='boarded'?spBtn('back','搭乗を取り消す'):''}`;
  return `<div class="sp-project"><p><strong>宇宙へ</strong> — 原料から、主人公の宇宙到達まで ${p.firstClear?'／初回クリア済み':''}</p>
    <div class="sp-tabs">${['製作','実習','発射サイト','組立','試験','打ち上げ'].map(s=>`<button class="btn small ${u.section===s?'':'sub'}" data-sp="section" data-id="${s}" aria-pressed="${u.section===s}">${s}</button>`).join('')}</div>
    <p id="sp-message" role="status">${spEscape(u.message)}</p>${p.job?`<aside class="sp-card">製作中：${nm(C.recipes.find(c=>c.id===p.job.id).out)} ×${p.job.batches}回 <span id="sp-job-time"></span>${spBtn('finish','完成品を受け取る')}${spBtn('cancel-job','取消（材料は未消費）')}</aside>`:''}
    <label><input type="checkbox" id="sp-detail" ${u.detail?'checked':''}> 未発見の設計も詳しく表示</label>${body}${S.verify?spaceVerifyBox():''}</div>`;
}
/* 検証モード（S.verify がある状態だけ）：宇宙計画の各段階へ飛ぶ。通常のセーブには書かない。判定は通常と同じ SPACE の関数を通す */
function spaceVerifyBox(){return `<div class="vsec"><h4>検証：宇宙計画の段階へ</h4><p class="desc">検証データだけを書きかえる。設置・組込・試験は通常と同じ判定を通す（木や岩を消さない）。</p><div class="vgrid">${[['v-lessons','実習を全部済ませる'],['v-site','発射サイトを探して設置'],['v-assemble','組込と宇宙服の装着'],['v-tests','7つの試験に合格'],['v-gate','搭乗口へ移動'],['v-reset','宇宙計画を最初に戻す']].map(([a,t])=>spBtn(a,t)).join('')}</div></div>`;}
function spaceVerifyAct(a){
  const p=SPACE.state(S),opts={player:W3.pos,npcs:W3.npcList||[],reserved:PLACE_RESERVED()};
  if(a==='v-lessons'){D.space.lessons.forEach(l=>p.lessons[l.id]=true);return {ok:true,msg:'実習を全部済ませた（検証）'};}
  if(a==='v-site'){if(!WORLD)return {ok:false,msg:'3D読み込み待ち'};const pos=W3.pos||{x:0,z:0};
    for(let radius=24;radius<=210;radius+=12)for(let k=0;k<32;k++){const q={x:Math.round(pos.x+Math.cos(k*Math.PI/16)*radius),z:Math.round(pos.z+Math.sin(k*Math.PI/16)*radius)};
      if(WORLD.checkPlacement(S,{...D.space.siteSpec,...q,rot:0},opts).ok)return SPACE.place(S,WORLD,q.x,q.z,0,opts);}
    return {ok:false,msg:'設置できる候補がない'};}
  if(a==='v-assemble'){if(!SPACE.placed(S))return {ok:false,msg:'先に発射サイトを設置'};const r=[];D.space.slots.forEach(x=>{if(!p.installed[x.id])r.push(SPACE.install(S,x.id));});if(!p.suit)r.push(SPACE.equip(S));const bad=r.filter(x=>!x.ok);return bad.length?{ok:false,msg:bad.map(x=>x.msg).join('／')}:{ok:true,msg:'組込と装着を済ませた'};}
  if(a==='v-tests'){const r=D.space.tests.map(t=>SPACE.test(S,t.id,t.answer)),bad=r.filter(x=>!x.ok);return bad.length?{ok:false,msg:bad.map(x=>x.msg).join('／')}:{ok:true,msg:'7つの試験に合格した'};}
  if(a==='v-gate'){const b=S.build['space-site'];if(!SPACE.placed(S))return {ok:false,msg:'発射サイトがない'};const q={x:b.x+Math.sin(b.rot)*11,z:b.z+Math.cos(b.rot)*11};W3.pos={...q};S.pos={...(S.pos||{}),...q};W3.path=null;try{W3.world.afterWarp(q.x,q.z);camRebase();W3.cam.snap=true;}catch(e){}return {ok:true,msg:'搭乗口へ移動した'};}
  if(a==='v-reset'){S.space={version:1};if(S.build)delete S.build['space-site'];return {ok:true,msg:'宇宙計画を最初に戻した'};}
}
function spaceRecipe(id){
  const u=spaceUI(),r=E.producers(id),it=IT[id];if(!it)return '';
  const recipes=[...r.crafts,...r.procs];return `<section class="sp-card" id="sp-recipe"><h3>${S.disc[id]||u.detail?spEscape(nm(id)):'未発見の設計のヒント'}</h3><p>${spEscape(it.kid)}</p><p>${spEscape(it.more)}</p><p class="desc">${spEscape(it.simplification||'')}</p>${(it.scienceSources||[]).length?`<details><summary>科学の参考資料</summary>${it.scienceSources.map(url=>`<a href="${spEscape(url)}" target="_blank" rel="noopener noreferrer">参考資料を開く</a>`).join(' ／ ')}</details>`:''}
    ${r.regions.length?`<p>天然資源：${r.regions.map(x=>spEscape(x.name)).join('・')}</p>${spBtn('book','採集と加工を図鑑で確認',id)}`:''}
    ${recipes.map(c=>`<div><p>材料：${Object.entries(c.inp).map(([k,n])=>spaceItemLink(k)+' ×'+n).join(' ')} → ${typeof c.out==='string'?c.qty:c.out[id]}個</p><p>設備：${(Array.isArray(c.at)?c.at:c.at?[c.at]:[]).map(spaceItemLink).join(' ')||'手作業'} 道具：${c.tools.map(spaceItemLink).join(' ')||'なし'}</p><p>${spEscape(c.how||c.why)}</p>
    ${c.space?`<label>まとめ製作 <input id="sp-count" type="number" min="1" max="${it.unique?1:20}" value="1"></label>${spBtn('craft','製作を始める',c.id,!!SPACE.state(S).job)}`:spBtn('book','既存の工作・実験を確認',id)}</div>`).join('')}
    <p>材料または設備を選ぶと、その原料へ戻れます。</p></section>`;
}
function spaceLesson(){
  const u=spaceUI(),l=D.space.lessons.find(x=>x.id===u.lesson)||D.space.lessons[0],p=SPACE.state(S),n=SPACE.lessonNeeds(S,l.id);
  const field=(id,label,value)=>`<label>${label}<input id="sp-${id}" type="number" min="0" max="31" value="${value}"></label>`;
  let form='';
  if(l.id==='switch'){const M=[['copper','銅（銅線）'],['ironrod','鉄の棒'],['rubber','ゴム'],['glass','ガラス'],['cloth','かわいた布']],tried=u.tried||[];
    form=`<label>すき間にはさむ物<select id="sp-gap">${M.map(([k,n])=>`<option value="${k}" ${u.gap===k?'selected':''}>${tried.includes(k)?(SPACE.CONDUCT[k]?'○ ':'× '):''}${n}</option>`).join('')}</select></label><label><input id="sp-on" type="checkbox"> スイッチを閉じる</label><p>○＝電気を通した（導体）、×＝通さなかった（絶縁体）。</p>`;}
  if(l.id==='transistor')form='<label><input id="sp-on" type="checkbox"> 制御入力をONにする</label>';
  if(l.id==='gates')form='<label>ゲート<select id="sp-gate"><option>AND</option><option>OR</option><option>NOT</option></select></label>'+field('a','入力A',0)+field('b','入力B（NOTは未使用）',0)+field('answer','予想する出力',0)+'<p>AND・ORの4組ずつ、NOTの2組を正しく確かめると合格。</p>';
  if(l.id==='adder')form=field('a','数A',3)+field('b','数B',2)+field('answer','和の予想',0);
  if(l.id==='memory')form=field('value','保存する値（課題は7）',7)+field('answer','読み出す値の予想',0)+spBtn('memory-write','書き込む');
  if(l.id==='architecture')form=['compute','sequence','store','interface'].map((k,i)=>`<label>${['計算する役割','順番を決める役割','保存する役割','外との窓口'][i]}<select id="sp-${k}">${['選んでください','演算','制御','記憶','入出力'].map(v=>`<option>${v}</option>`).join('')}</select></label>`).join('');
  if(l.id==='program')form='<label>命令列<textarea id="sp-code" rows="5">LOAD 2\nADD 3\nSTORE\nOUT</textarea></label><p>LOAD 数 / ADD 数 / STORE / READ / OUT。出力と保存値が5になる命令列を試そう。</p>';
  if(l.id==='sensors')form='<p>模擬センサー：空気＝正常、CO₂＝要点検、温度＝正常、電源＝正常</p><label>改善する部位<select id="sp-answer"><option>選んでください</option><option>空気再生</option><option>外装</option><option>窓</option></select></label>';
  return `<label>実習<select id="sp-lesson">${D.space.lessons.map(x=>`<option value="${x.id}" ${x.id===l.id?'selected':''}>${p.lessons[x.id]?'✓ ':''}${x.name}</option>`).join('')}</select></label><h3>${l.name}</h3><p>${l.help}</p><p>${n.join('／')}</p><div class="sp-fields">${form}</div>${spBtn('practice',l.id==='memory'?'読み出して確認':'実行して確認',l.id,!!n.length)}${l.id==='switch'&&u.tried&&u.tried.length&&!p.lessons.switch&&!u.tried.some(k=>!SPACE.CONDUCT[k])?'<p class="desc">電気を通さない物も、はさんで確かめよう。</p>':''}${['switch','transistor'].includes(l.id)&&u.output!==null?`<p role="status">${u.output===1?'💡 ランプ点灯（1）':'○ ランプ消灯（0）'}</p>`:''}<pre class="sp-output">${spEscape(u.output===null?'ここに実行結果を表示します':typeof u.output==='object'?JSON.stringify(u.output,null,2):u.output)}</pre>`;
}
function spaceFlight(){const p=SPACE.state(S),names={countdown:'カウントダウン',retract:'支持設備を退避',ignition:'噴射開始',ascent:'空へ上昇',space:'宇宙到達',ending:'宇宙へ到達しました'};
  return `<div class="sp-flight ${p.phase==='space'||p.phase==='ending'?'sp-stars':''}" role="status"><div class="sp-flight-rocket" aria-hidden="true">${ic('sp_capsule')}</div><h2>${names[p.phase]}</h2><strong id="sp-countdown">${p.phase==='countdown'?Math.max(1,3-Math.floor((Date.now()-p.launchAt)/1000)):''}</strong><p>主人公：${S.flags.hero==='boy'?'男の子':'女の子'}・宇宙服装着／船内生命維持 正常（模擬）</p>
  ${p.phase==='ending'?`<p>実績：ゼロから宇宙へ ${p.firstClear?.runId===p.runId?'初回到達':'再演出'}</p><p>最初の採集から ${Object.keys(S.disc).length}種類の発見へ。</p><details><summary>発見と製作の記録</summary><ol>${Object.entries(S.disc).sort((a,b)=>a[1].first-b[1].first).slice(0,12).map(([id])=>`<li>${spEscape(nm(id))}</li>`).join('')}${p.history.filter(h=>['craft','lesson','assembly','test','clear'].includes(h.kind)).slice(-25).map(h=>`<li>${spEscape(h.text)}</li>`).join('')}</ol></details><p>打ち上げ前の時間に戻って探索を続けます。初回クリア記録は残り、資材や報酬は増えません。</p>${spBtn('back','打ち上げ前の世界で探索を続ける')}`:`<p>再読み込みしても進行は保存されます。</p>${spBtn('skip','演出をスキップして到達する')}`}</div>`;
}
function spaceVisualFrame(){
  const key=heroAssetKey();if(W3.gfx&&W3.spaceHeroKey!==key){W3.spaceHeroKey=key;heroSheet3D().then(url=>{if(W3.spaceHeroKey===key)W3.gfx.setPlayerSpriteSheet(url);});}
  const p=SPACE.state(S),b=S.build&&S.build['space-site'];
  if(W3.gfx&&window.HD2D?.syncSpaceVisual)HD2D.syncSpaceVisual(W3.gfx,SPACE.placed(S)?{...b,y:groundY(b.x,b.z),stage:SPACE.stage(S),installed:p.installed,owned:Object.fromEntries(D.space.ids.map(id=>[id,SPACE.owned(S,id)])),phase:p.phase,elapsed:p.launchAt?(Date.now()-p.launchAt)/1000:0}:null,p.suit?{position:W3.pos,y:W3.pos?groundY(W3.pos.x,W3.pos.z):0,hero:S.flags.hero}:null);
}
function spaceSync(){spaceVisualFrame();if(WORLD&&W3.gfx)syncStructColliders();}
function spaceSiteDraft(){return {x:Number($('#sp-x')?.value),z:Number($('#sp-z')?.value),rot:Number($('#sp-rot')?.value)*Math.PI/180};}
function spaceResult(r){spaceUI().message=r.msg||(r.ok?'完了しました':'条件を確認してください');if(r.news)r.news.forEach(id=>toast(id));save();spaceSync();renderChrome();renderPanel();}
document.addEventListener('change',ev=>{const id=ev.target.id,u=spaceUI();if(id==='sp-group')u.group=ev.target.value;else if(id==='sp-lesson'){u.lesson=ev.target.value;u.output=null;}else if(id==='sp-detail')u.detail=ev.target.checked;else return;renderPanel();});
document.addEventListener('click',ev=>{const b=ev.target.closest?.('[data-sp]');if(!b)return;ev.preventDefault();const a=b.dataset.sp,id=b.dataset.id,u=spaceUI(),p=SPACE.state(S);let r;
  if(a==='section'){u.section=id;u.message='';renderPanel();return;}
  if(a.startsWith('v-')){if(!S.verify)return;r=spaceVerifyAct(a);if(r)spaceResult(r);return;}
  if(a==='item'||a==='select'){u.item=id;u.section='製作';if(IT[id]?.group)u.group=IT[id].group;renderPanel();$('#sp-recipe')?.scrollIntoView({block:'start'});return;}
  if(a==='book'){openItem(id);return;}
  if(a==='craft')r=SPACE.startCraft(S,id,Number($('#sp-count')?.value||1));
  if(a==='finish')r=SPACE.finishCraft(S);
  if(a==='cancel-job')r=SPACE.cancelCraft(S);
  if(a==='practice'||a==='memory-write'){
    const val=k=>$('#sp-'+k)?.value;if(u.lesson==='switch'){u.gap=$('#sp-gap')?.value;if($('#sp-on')?.checked){u.tried=u.tried||[];if(!u.tried.includes(u.gap))u.tried.push(u.gap);}}
    const arg={tried:u.tried||[],gap:u.gap,on:!!$('#sp-on')?.checked,gate:val('gate'),a:Number(val('a')),b:Number(val('b')),answer:val('answer'),value:Number(val('value')),action:a==='memory-write'?'write':'read',code:val('code'),compute:val('compute'),sequence:val('sequence'),store:val('store'),interface:val('interface')};
    if(u.lesson!=='sensors')arg.answer=Number(arg.answer);r=SPACE.practice(S,u.lesson,arg);u.output=r.output??r.msg;r.msg=r.ok?(r.passed?'実習合格':'結果を確認し、別の入力も試そう'):r.msg;
  }
  if(a==='install'||a==='remove')r=SPACE.install(S,id,a==='remove');if(a==='equip')r=SPACE.equip(S);
  if(a==='test')r=SPACE.test(S,id,$('#sp-test-'+id)?.value);
  if(a==='find-site'){
    if(!WORLD){spaceResult({ok:false,msg:'3Dの読み込みを待ってください'});return;}
    const pos=W3.pos||{x:0,z:0};let found=null;
    for(let radius=24;radius<=210&&!found;radius+=12)for(let k=0;k<32;k++){const q={x:Math.round(pos.x+Math.cos(k*Math.PI/16)*radius),z:Math.round(pos.z+Math.sin(k*Math.PI/16)*radius),rot:0};if(WORLD.checkPlacement(S,{...D.space.siteSpec,...q},{player:W3.pos,npcs:W3.npcList||[],reserved:PLACE_RESERVED()}).ok){found=q;break;}}
    if(found){u.site=found;r={ok:true,msg:'候補を見つけました。座標と周囲を確認して設置してください'};}else r={ok:false,msg:'空いた候補が見つかりません。木や岩を採集して空きを作り、座標を指定してください'};
  }
  if(a==='check-site'||a==='place-site'){const d=spaceSiteDraft();u.site={...d,rot:d.rot*180/Math.PI};if(!WORLD)r={ok:false,msg:'3D読み込み待ち'};else if(a==='place-site')r=SPACE.place(S,WORLD,d.x,d.z,d.rot,{player:W3.pos,npcs:W3.npcList||[],reserved:PLACE_RESERVED()});else{const q=WORLD.checkPlacement(S,{...D.space.siteSpec,...d},{player:W3.pos,npcs:W3.npcList||[],reserved:PLACE_RESERVED()});r={ok:q.ok,msg:q.ok?'この場所に設置できます':q.reasons.join('／')};}}
  if(a==='overview'||a==='low-angle'){haltField();u.lowAngle=a==='low-angle';u.overview=true;setTab('explore');renderChrome();return;}
  if(a==='exit-overview'){u.overview=false;renderChrome();return;}
  if(a==='walk-site'){const site=S.build['space-site'];if(site&&!site.removed){setTab('explore');goTo3D(site.x+Math.sin(site.rot)*11,site.z+Math.cos(site.rot)*11);return;}}
  if(a==='resolve'){u.section=id.startsWith('test:')?'試験':id==='site'?'発射サイト':id==='generator'?'製作':'組立';if(id==='generator')u.item='generator';renderPanel();return;}
  if(a==='board'){haltField();r=SPACE.board(S,W3.pos||S.pos);}
  if(a==='launch'){
    // 発射状態への遷移前に保存成功を確認。保存不能なら演出を始めない。
    try{localStorage.setItem(curKey(),E.serialize(S));const before=JSON.stringify(p);r=SPACE.begin(S);if(r.ok){try{localStorage.setItem(curKey(),E.serialize(S));}catch(e){S.space=JSON.parse(before);r={ok:false,msg:'保存できないため発射を中止しました'};}}}catch(e){r={ok:false,msg:'保存できません。設定からセーブを書き出してください'};}
  }
  if(a==='skip')r=SPACE.advance(S,Date.now(),true);
  if(a==='back'){r=SPACE.back(S);if(r.ok){if(r.pos)applySavedPos();u.section='打ち上げ';setTab('explore');}}
  if(r)spaceResult(r);
});
setInterval(()=>{
  const p=SPACE.state(S);if(SPACE.active.includes(p.phase)){const old=p.phase;SPACE.advance(S);if(old!==p.phase){writeNow();setTab('space');renderPanel();}}
  const countdown=$('#sp-countdown');if(countdown&&p.phase==='countdown')countdown.textContent=Math.max(1,3-Math.floor((Date.now()-p.launchAt)/1000));
  const timer=$('#sp-job-time');if(timer&&p.job)timer.textContent=Math.max(0,Math.ceil((p.job.readyAt-Date.now())/1000))+'秒';spaceSync();
},250);
if(SPACE.state(S).phase!=='ground')setTab('space');

function spaceCamera(){
  if(!W3.gfx||typeof W3.gfx.setCameraView!=='function')return false;
  const p=SPACE.state(S),u=spaceUI(),b=S.build&&S.build['space-site'];
  if(u.overview&&U.tab!=='explore')u.overview=false;
  const on=SPACE.placed(S)&&(u.overview||p.phase==='boarded'||SPACE.active.includes(p.phase));
  $('#app').classList.toggle('space-overview',!!u.overview);
  if(!on){if(W3.spaceCamera){W3.gfx.restoreCameraView();W3.gfx.setCameraTarget(null);W3.camSent=null;W3.spaceCamera=false;if(W3.cam)W3.cam.snap=true;}return false;}
  const cameraMode=p.phase==='boarded'?'boarding':u.lowAngle&&p.phase==='ground'?'low':'overview';
  if(W3.spaceCamera!==cameraMode){W3.gfx.setCameraView(cameraMode==='boarding'?{yawDegrees:-52.7+b.rot*180/Math.PI,pitchDegrees:3.25,viewSize:6,distance:10}:cameraMode==='low'?{yawDegrees:38.6598+b.rot*180/Math.PI,pitchDegrees:4,viewSize:32,distance:18}:{yawDegrees:38.6598+b.rot*180/Math.PI,pitchDegrees:13.185,viewSize:44,distance:90},{temporary:true,transition:.6});W3.spaceCamera=cameraMode;}
  if(cameraMode==='boarding'){const x=3.75,z=-2.86;W3.gfx.setCameraTarget({x:b.x+x*Math.cos(b.rot)+z*Math.sin(b.rot),z:b.z-x*Math.sin(b.rot)+z*Math.cos(b.rot),y:groundY(b.x,b.z)+17.033});return true;}
  const rise=p.phase==='ascent'?Math.min(70,Math.max(0,(Date.now()-p.launchAt)/1000-10)*12):0;
  W3.gfx.setCameraTarget({x:b.x,z:b.z,y:groundY(b.x,b.z)+9+rise});return true;
}

// 実機確認用。表示フレームの更新を10秒間数える。結果はこの端末の画面にだけ表示する。
function spaceMeasureFrames(){
 if(!W3.gfx||U.spacePerf?.running)return;
 U.spacePerf={running:true};spaceUI().overview=true;setTab('explore');let start=performance.now(),last=-1,count=0;
 const sample=()=>{
  if(document.hidden){U.spacePerf={running:false,message:'中断：画面を表示したまま再計測してください'};banner(U.spacePerf.message);return;}
  const frame=W3.gfx.getRenderer?.().info.render.frame;
  if(frame!==undefined&&frame!==last){last=frame;count++;}
  const seconds=(performance.now()-start)/1000;
  if(seconds<10){requestAnimationFrame(sample);return;}
  const fps=Math.round(count/seconds*10)/10;
  U.spacePerf={running:false,fps,seconds,width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,userAgent:navigator.userAgent};
  banner('この端末の描画更新：'+fps+' FPS（10秒平均）。発射サイト画面から結果を確認できます。');
 };
 requestAnimationFrame(sample);
}
document.addEventListener('click',e=>{if(e.target.closest?.('[data-sp-performance]'))spaceMeasureFrames();});
