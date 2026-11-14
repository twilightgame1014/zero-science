// Muse原本は不変。ゲーム状態から表示、クリップ時刻、LODだけを適用する。
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {flightPose,visibleAtStage} from './space-animation';
import {applySpaceMaterials} from './space-materials';
type Snapshot={x:number;y:number;z:number;rot:number;phase:string;elapsed:number;stage:number;installed:Record<string,number>;owned:Record<string,boolean>};
type Asset={gzip:string;lod0?:string};
type Model={scene:THREE.Group;mixer:THREE.AnimationMixer;actions:Map<string,THREE.AnimationAction>};
type Entry={root:THREE.Group;models:Map<string,Model>;high:Map<string,Model>;status:string;flame:THREE.Mesh;smoke:THREE.Sprite[];lod:number};
const entries=new WeakMap<object,Entry>();
export const spaceModelStatus=(gfx:object)=>entries.get(gfx)?.status||'not-loaded';
export const spaceModelDiagnostics=(gfx:object)=>{const e=entries.get(gfx);return {status:e?.status,lod:e?.lod,models:e?.models.size,high:e?.high.size};};
function pose(m:Model|undefined,name:string,time:number){const a=m?.actions.get(name);if(a){a.enabled=true;a.setEffectiveWeight(1);a.time=THREE.MathUtils.clamp(time,0,a.getClip().duration);}}
async function parse(id:string,base64:string):Promise<Model>{
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
 const buffer=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const g=await new GLTFLoader().parseAsync(buffer,''),mixer=new THREE.AnimationMixer(g.scene),actions=new Map<string,THREE.AnimationAction>();
 for(const clip of g.animations){const a=mixer.clipAction(clip);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();a.paused=true;a.enabled=false;actions.set(clip.name,a);}
 g.scene.name='space-model:'+id;g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=id!=='rocket'&&id!=='spacesuit-display';}});
 applySpaceMaterials(g.scene,id);
 return {scene:g.scene,mixer,actions};
}
async function load(e:Entry,assets:Record<string,Asset>){
 try{const models=await Promise.all(Object.entries(assets).map(async([id,a])=>[id,await parse(id,a.gzip)] as const));
 for(const [id,m]of models){e.models.set(id,m);e.root.add(m.scene);}e.status='ready';
 // LOD0は近景でだけ使用。LOD1の表示開始を待たせない。
 if(matchMedia('(pointer:coarse), (max-width:700px)').matches)return;
 const high=await Promise.all(Object.entries(assets).filter(([,a])=>a.lod0).map(async([id,a])=>[id,await parse(id,a.lod0!)] as const));
 for(const [id,m]of high){m.scene.visible=false;e.high.set(id,m);e.root.add(m.scene);}
 }catch(error){if(e.status!=='ready')e.status='failed';console.warn('宇宙モデルの読込みに失敗',error);}
}
function anchor(m:Model|undefined,name:string,root:THREE.Object3D,fallback:THREE.Vector3){
 const a=m?.scene.getObjectByName(name);return a?root.worldToLocal(a.getWorldPosition(new THREE.Vector3())):fallback;
}
export function updateSpaceModels(gfx:any,site:Snapshot|null,assets:Record<string,Asset>|undefined){
 let e=entries.get(gfx);
 if(!e&&site&&assets&&Object.keys(assets).length){
  const root=new THREE.Group();root.name='SpaceSiteModels';root.visible=false;gfx.getScene().add(root);
  const flame=new THREE.Mesh(new THREE.ConeGeometry(.65,3,10),new THREE.MeshBasicMaterial({color:0xf4c572,transparent:true,opacity:.75,depthWrite:false}));
  // ConeGeometryの頂点を発生点側に置き、噴射が-Yへ延びる。
  root.add(flame);const smoke:THREE.Sprite[]=[];
  const loader=new THREE.TextureLoader(),urls=(window as any).ASSETS?.spaceSmoke||[(window as any).ASSETS?.particle],maps=urls.map((url:string)=>loader.load(url));
  for(let n=0;n<12;n++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:maps[n%maps.length],color:0xe8dfc8,transparent:true,opacity:0,depthWrite:false}));root.add(s);smoke.push(s);}
  e={root,models:new Map(),high:new Map(),status:'loading',flame,smoke,lod:1};entries.set(gfx,e);void load(e,assets);
 }
 if(!e)return false;e.root.visible=!!site&&e.status==='ready'&&!['space','ending'].includes(site.phase);
 if(!site||e.status!=='ready')return false;
 e.root.position.set(site.x,site.y,site.z);e.root.rotation.y=site.rot;
 const mobile=matchMedia('(pointer:coarse), (max-width:700px)').matches;
 const camera=gfx.getCamera?.();
 const near=!mobile&&(!camera||camera.position.distanceTo(e.root.position)<100);
 e.lod=near&&e.high.size===e.models.size?0:1;
 const models=e.lod===0?e.high:e.models,hidden=e.lod===0?e.models:e.high;
 for(const m of hidden.values())m.scene.visible=false;
 const positions:Record<string,[number,number,number]>={'support-tower':[-4.6,0,0],'control-terminal':[5,0,5],'electronics-fab':[-2,0,6],'computer-bench':[1,0,6],'test-terminal':[4,0,-6],'power-distribution':[6,0,-2],'life-support':[6,0,1],'suit-stand':[-6,0,-5],'spacesuit-display':[-6,0,-5],'parts-rack':[-2,0,-5],'workbench':[1,0,-5]};
 for(const [id,m]of models){m.scene.position.set(...(positions[id]||[0,0,0]));m.scene.visible=true;for(const a of m.actions.values())a.enabled=false;}
 const flying=/^(countdown|retract|ignition|ascent|space|ending)$/.test(site.phase),p=flightPose(site.elapsed,flying);
 const rocket=models.get('rocket');
 if(rocket){rocket.scene.visible=site.stage>0;rocket.scene.position.y=p.rise;
  rocket.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.visible=visibleAtStage(o.name,site.stage);});
  const opened=(site.phase==='ground'&&site.stage===3)||site.phase==='boarded';
  // 開閉の競合を避け一方のクリップだけに重みを与える。S3は厳密な終端。
  pose(rocket,opened?'hatch_open':'hatch_close',opened?100:p.hatch);
  pose(rocket,opened?'bay_open':'bay_close',100);
 }
 pose(models.get('support-tower'),'tower_retract',p.tower);
 const beacon=models.get('support-tower')?.actions.get('beacon_spin');
 if(beacon)pose(models.get('support-tower'),'beacon_spin',(performance.now()/1000)%beacon.getClip().duration);
 pose(models.get('boarding-corridor'),'corridor_retract',p.corridor);
 pose(models.get('launch-pad'),'mount_release',p.mount);
 for(const m of models.values())m.mixer.update(0);
 e.root.updateMatrixWorld(true);
 const corridor=models.get('boarding-corridor');if(corridor){corridor.scene.position.copy(anchor(models.get('support-tower'),'Anchor_corridor_root',e.root,new THREE.Vector3(-3.7,16.83,0)));corridor.scene.visible=site.stage===4;}
 const equipment:Record<string,string>={'electronics-fab':'sp_fab','computer-bench':'sp_computerbench','test-terminal':'sp_testbench','power-distribution':'sp_power','life-support':'sp_lifesupport','suit-stand':'sp_suitbench','spacesuit-display':'sp_suit'};
 for(const [model,item]of Object.entries(equipment)){const m=models.get(model);if(m)m.scene.visible=!!site.owned[item];}
 for(const id of ['parts-rack','workbench']){const m=models.get(id);if(m)m.scene.visible=id==='workbench'?site.stage===3:site.stage===2||site.stage===3;}
 e.root.updateMatrixWorld(true);
 const burning=['ignition','ascent'].includes(site.phase);
 e.flame.visible=burning;e.flame.position.copy(anchor(rocket,'Anchor_exhaust',e.root,new THREE.Vector3(0,.9+p.rise,0)));e.flame.position.y-=1.5;
 // 端末では各側2枚、PCでは各側6枚。時間で復元できる固定周期、衝突や進行に影響しない。
 const count=mobile?4:12;
 for(let n=0;n<e.smoke.length;n++){
  const s=e.smoke[n];s.visible=burning&&n<count;if(!s.visible)continue;
  const side=n%2===0?-1:1,age=((site.elapsed-8.4)+Math.floor(n/2)*.29)%1.8;
  const base=anchor(models.get('launch-pad'),side<0?'Anchor_smoke_l':'Anchor_smoke_r',e.root,new THREE.Vector3(side*3.2,.5,0));
  s.position.copy(base).add(new THREE.Vector3(side*age*2,age*.8,Math.sin(n)*age*.3));s.scale.setScalar(.9+age*1.8);s.material.opacity=.4*(1-age/1.8);
 }
 return true;
}
