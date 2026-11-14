// Museの確定済みGLBを読むゲーム側アダプター。原本・ノード・材質を変更しない。
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
type Snapshot={x:number;y:number;z:number;rot:number;phase:string;elapsed:number;stage:number;installed:Record<string,number>;owned:Record<string,boolean>};
type Asset={gzip:string};
type Model={scene:THREE.Group;mixer:THREE.AnimationMixer;actions:Map<string,THREE.AnimationAction>};
type Entry={root:THREE.Group;models:Map<string,Model>;status:string;flame:THREE.Mesh;fx:{exhaustAt:number;smoke:number;launchKey:string}};
type Contract={version:number;slotNodes:Record<'frame'|'propulsion'|'capsule'|'skin',string[]>;equipmentPlacement:{model:string;position:[number,number,number];rotationYDeg:number}[]};
const contract=():Contract|undefined=>(window as any).ASSETS?.spaceContract;
const entries=new WeakMap<object,Entry>();
export const spaceModelStatus=(gfx:object)=>entries.get(gfx)?.status||'not-loaded';
function pose(m:Model|undefined,name:string,time:number){const a=m?.actions.get(name);if(a){a.time=Math.min(Math.max(0,time),Math.max(0,a.getClip().duration-0.00001));}}
async function load(e:Entry,assets:Record<string,Asset>){
 try{
  const loader=new GLTFLoader();
  const loaded=await Promise.all(Object.entries(assets).map(async([id,a])=>{
   const bytes=Uint8Array.from(atob(a.gzip),c=>c.charCodeAt(0));
   const buffer=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   const g=await loader.parseAsync(buffer,''),mixer=new THREE.AnimationMixer(g.scene),actions=new Map<string,THREE.AnimationAction>();
   for(const clip of g.animations){if(/_close$/.test(clip.name))continue;const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;actions.set(clip.name,action);}
   g.scene.name='space-model:'+id;g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
   return [id,{scene:g.scene,mixer,actions}] as const;
  }));
  for(const [id,m]of loaded){e.models.set(id,m);e.root.add(m.scene);}e.status='ready';
 }catch(error){e.status='failed';console.warn('宇宙モデルの読込みに失敗。仮表示を継続します',error);}
}
export function updateSpaceModels(gfx:any,site:Snapshot|null,assets:Record<string,Asset>|undefined){
 let e=entries.get(gfx);
 if(!e&&site&&assets&&Object.keys(assets).length){const root=new THREE.Group();root.name='SpaceSiteModels';root.visible=false;gfx.getScene().add(root);
  const flame=new THREE.Mesh(new THREE.ConeGeometry(.75,3,10),new THREE.MeshBasicMaterial({color:0xf4c572,transparent:true,opacity:.8}));flame.rotation.z=Math.PI;root.add(flame);
  e={root,models:new Map(),status:'loading',flame,fx:{exhaustAt:0,smoke:0,launchKey:''}};entries.set(gfx,e);void load(e,assets);
 }
 if(!e)return false;e.root.visible=!!site&&e.status==='ready'&&!['space','ending'].includes(site.phase);
 if(!site||e.status!=='ready')return false;
 e.root.position.set(site.x,site.y,site.z);e.root.rotation.y=site.rot;
 const positions:Record<string,[number,number,number]>={'support-tower':[-4.6,0,0],'control-terminal':[5,0,5],'electronics-fab':[-2,0,6],'computer-bench':[1,0,6],'test-terminal':[4,0,-6],'power-distribution':[6,0,-2],'life-support':[6,0,1],'suit-stand':[-6,0,-5],'spacesuit-display':[-6,0,-3],'parts-rack':[-2,0,-5]};
 /* 設備の置き場所は契約 v6 の equipmentPlacement（宇宙服ディスプレイは (−6,0,−3)。旧い表は契約がないときだけ） */
 const C=contract(),placeOf=new Map((C?.equipmentPlacement||[]).map(q=>[q.model,q]));
 for(const [id,m]of e.models){const q=placeOf.get(id);if(q){m.scene.position.set(q.position[0],q.position[1],q.position[2]);m.scene.rotation.y=(q.rotationYDeg||0)*Math.PI/180;}else m.scene.position.set(...(positions[id]||[0,0,0]));m.scene.visible=true;}
 const rocket=e.models.get('rocket'),i=site.installed;
 if(rocket){rocket.scene.visible=!!i.structure;rocket.scene.position.y=['ascent','space','ending'].includes(site.phase)?Math.min(70,Math.max(0,site.elapsed-7)*12):0;
  /* 組込枠ごとの表示は契約 v6 の slotNodes どおり（骨組みは外装がないときだけ）。契約がないときだけ旧いノード名の判定 */
  const sn=C?.slotNodes,slotOf=sn?new Map<string,string>([...sn.frame.map(n=>[n,'frame']),...sn.propulsion.map(n=>[n,'propulsion']),...sn.capsule.map(n=>[n,'capsule']),...sn.skin.map(n=>[n,'skin'])] as [string,string][]):null;
  rocket.scene.traverse(o=>{const n=o.name;
   if(!(o instanceof THREE.Mesh))return;
   const slot=slotOf?slotOf.get(n):/^Frame_/.test(n)?'frame':/^(Propulsion|PropSkirt|Nozzle|Fin)/.test(n)?'propulsion':/^(Capsule|Hatch|Nose|Window|RCS)/.test(n)?'capsule':'skin';
   o.visible=slot==='frame'?!i.skin:slot==='propulsion'?!!i.propulsion:slot==='capsule'?!!i.capsule:slot==='skin'?!!i.skin:false;
  });
  const opened=site.phase==='ground'&&site.stage===3;pose(rocket,'hatch_open',opened?100:0);pose(rocket,'bay_open',opened?100:0);
 }
 const retract=['retract','ignition','ascent','space','ending'].includes(site.phase)?Math.max(0,site.elapsed-3):0;
 pose(e.models.get('support-tower'),'tower_retract',retract);
 pose(e.models.get('boarding-corridor'),'corridor_retract',retract);
 pose(e.models.get('launch-pad'),'mount_release',Math.max(0,retract-2));
 for(const m of e.models.values())m.mixer.update(0);
 e.root.updateMatrixWorld(true);
 const tower=e.models.get('support-tower'),corridor=e.models.get('boarding-corridor');
 if(corridor){const anchor=tower?.scene.getObjectByName('Anchor_corridor_root')||tower?.scene.getObjectByName('anchor_corridor_root');
  if(anchor){const p=anchor.getWorldPosition(new THREE.Vector3());e.root.worldToLocal(p);corridor.scene.position.copy(p);}else corridor.scene.position.set(-3.7-Math.min(3,retract*1.2),16.83,0);
  corridor.scene.visible=site.stage===4;
 }
 const equipment:Record<string,string>={'electronics-fab':'sp_fab','computer-bench':'sp_computerbench','test-terminal':'sp_testbench','power-distribution':'sp_power','life-support':'sp_lifesupport','suit-stand':'sp_suitbench','spacesuit-display':'sp_suit'};
 for(const [model,item]of Object.entries(equipment)){const m=e.models.get(model);if(m)m.scene.visible=!!site.owned[item];}
 const rack=e.models.get('parts-rack');if(rack)rack.scene.visible=site.stage===2||site.stage===3;
 /* 噴射と煙（Muse ラウンド30 の 'exhaust'・'padSmoke'）。噴射は点火から上昇の終わりまで 0.25 秒ごと、煙は点火の時刻から 0.8 秒ごとに 3 回、左右の接続点へ。
    playVisualEffect がない版だけ、ゲームの仮の円すいを出す */
 const burning=['ignition','ascent'].includes(site.phase),fxOk=typeof gfx.playVisualEffect==='function';
 e.flame.visible=burning&&!fxOk;e.flame.position.set(0,(rocket?.scene.position.y||0)-.7,0);
 const key=site.phase==='ground'||site.phase==='boarded'?'':String(Math.round(Date.now()/1000-site.elapsed));
 if(key!==e.fx.launchKey){e.fx={exhaustAt:0,smoke:0,launchKey:key};}
 if(fxOk&&burning&&rocket){const now=performance.now();
  if(now-e.fx.exhaustAt>=250){e.fx.exhaustAt=now;const a=rocket.scene.getObjectByName('Anchor_exhaust');if(a){const w=a.getWorldPosition(new THREE.Vector3());try{gfx.playVisualEffect('exhaust',{x:w.x,y:w.y,z:w.z});}catch(err){}}}
  const sinceIgnite=site.elapsed-5;
  while(e.fx.smoke<3&&sinceIgnite>=e.fx.smoke*0.8){e.fx.smoke++;for(const nm of ['Anchor_smoke_l','Anchor_smoke_r']){const a=e.root.getObjectByName(nm);if(a){const w=a.getWorldPosition(new THREE.Vector3());try{gfx.playVisualEffect('padSmoke',{x:w.x,y:w.y,z:w.z});}catch(err){}}}}
 }
 return true;
}
