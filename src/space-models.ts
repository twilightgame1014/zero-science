// Museの確定済みGLBを読むゲーム側アダプター。原本・ノード・材質を変更しない。
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
type Snapshot={x:number;y:number;z:number;rot:number;phase:string;elapsed:number;stage:number;installed:Record<string,number>;owned:Record<string,boolean>};
type Asset={gzip:string};
type Model={scene:THREE.Group;mixer:THREE.AnimationMixer;actions:Map<string,THREE.AnimationAction>};
type Entry={root:THREE.Group;models:Map<string,Model>;status:string;flame:THREE.Mesh};
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
  e={root,models:new Map(),status:'loading',flame};entries.set(gfx,e);void load(e,assets);
 }
 if(!e)return false;e.root.visible=!!site&&e.status==='ready'&&!['space','ending'].includes(site.phase);
 if(!site||e.status!=='ready')return false;
 e.root.position.set(site.x,site.y,site.z);e.root.rotation.y=site.rot;
 const positions:Record<string,[number,number,number]>={'support-tower':[-4.6,0,0],'control-terminal':[5,0,5],'electronics-fab':[-2,0,6],'computer-bench':[1,0,6],'test-terminal':[4,0,-6],'power-distribution':[6,0,-2],'life-support':[6,0,1],'suit-stand':[-6,0,-5],'spacesuit-display':[-6,0,-5],'parts-rack':[-2,0,-5]};
 for(const [id,m]of e.models){m.scene.position.set(...(positions[id]||[0,0,0]));m.scene.visible=true;}
 const rocket=e.models.get('rocket'),i=site.installed;
 if(rocket){rocket.scene.visible=!!i.structure;rocket.scene.position.y=['ascent','space','ending'].includes(site.phase)?Math.min(70,Math.max(0,site.elapsed-7)*12):0;
  rocket.scene.traverse(o=>{const n=o.name;
   if(!(o instanceof THREE.Mesh))return;
   if(/^Frame_/.test(n))o.visible=!i.skin;
   else if(/^(Propulsion|PropSkirt|Nozzle|Fin)/.test(n))o.visible=!!i.propulsion;
   else if(/^(Capsule|Hatch|Nose|Window|RCS)/.test(n))o.visible=!!i.capsule;
   else o.visible=!!i.skin;
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
 e.flame.visible=['ignition','ascent'].includes(site.phase);e.flame.position.set(0,(rocket?.scene.position.y||0)-.7,0);
 return true;
}
