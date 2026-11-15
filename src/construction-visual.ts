/* Muse city contract: completed stage lists, canonical shared kits, terrain-following roads.
   Owns display only. No resource, collision, progress or save mutations. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareShared } from './world/natureModels';
export type Site = { id: string; def: string; model: string; stageNodes?: Record<string,string[]>|null; stage: number; stages: number; x:number;z:number;rot:number;shape:string;w:number;d:number;r:number;phase:string;progress:number;supplied:number;tall:number;entrance?:[number,number]|null;pileKinds?:string[] };
type Cell = {i:number;j:number;kind:string};
type Data = {sites:Site[];roads:Cell[];pending:Cell[];cell:number;colors:Record<string,string>};
type Assets = {contract:any;models:Record<string,string>;textures:Record<string,string>};
type Entry = {root:THREE.Group;sites:Map<string,{g:THREE.Group;sig:string}>;roads:THREE.Group;roadSig:string};
const entries = new WeakMap<object,Entry>(), kits = new Map<string,THREE.Object3D>(), failed = new Map<string,string>();
let assets:Assets|undefined, loading:Promise<void>|undefined, revision=0;
const textures = new Map<string,THREE.Texture>();
export const normalizedNodeName=(n:string)=>THREE.PropertyBinding.sanitizeNodeName(n);
export function applyConstructionStage(root:THREE.Object3D,names:string[]):void {
 const allowed=new Set(names.map(normalizedNodeName));
 // Keep transform ancestors of allowed nodes, but do not reveal their unwanted mesh children.
 const needed=new Set<THREE.Object3D>();root.traverse(o=>{if(allowed.has(normalizedNodeName(o.name)))for(let p:THREE.Object3D|null=o;p;p=p.parent)needed.add(p);});
 root.traverse(o=>{o.visible=needed.has(o)&&!o.name.startsWith('Scaffold_');});root.visible=true;
}
export function loadConstructionAssets(a:Assets):Promise<void>{
 if(loading)return loading;assets=a;
 loading=Promise.all(Object.entries(a.models).map(async([id,b64])=>{
  try {const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const gltf=await new GLTFLoader().parseAsync(bytes.buffer,'');prepareShared(gltf.scene);gltf.scene.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});kits.set(id,gltf.scene);}
  catch(err){failed.set(id,String(err));console.warn('Construction asset failed',id,err);}
 })).then(()=>{revision++;});return loading;
}
function roadTexture(path:string,normal=false):THREE.Texture|undefined {
 if(!assets?.textures[path])return undefined;
 if(!textures.has(path)){const t=new THREE.TextureLoader().load(assets.textures[path],()=>revision++,undefined,e=>{failed.set(path,String(e));});t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=normal?THREE.NoColorSpace:THREE.SRGBColorSpace;t.anisotropy=4;textures.set(path,t);}return textures.get(path);
}
function part(id:string,name?:string):THREE.Group|null {
 const root=kits.get(id),src=name?root?.getObjectByName(normalizedNodeName(name)):root;if(!src)return null;
 const g=new THREE.Group(),copy=src.clone(true);g.add(copy);return g;
}
function outline(s:Site,margin:number):[number,number][]{
 if(s.shape==='rect'){const x=s.w/2+margin,z=s.d/2+margin;return [[-x,-z],[x,-z],[x,z],[-x,z]];}
 return Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*(s.r+margin),Math.sin(i*Math.PI/4)*(s.r+margin)]);
}
function buildSite(s:Site,h:(x:number,z:number)=>number,template:THREE.Object3D|undefined):THREE.Group {
 const g=new THREE.Group();g.name='ConstructionSite:'+s.id;g.position.set(s.x,h(s.x,s.z),s.z);g.rotation.y=s.rot;
 const y=(x:number,z:number)=>h(s.x+Math.cos(s.rot)*x+Math.sin(s.rot)*z,s.z-Math.sin(s.rot)*x+Math.cos(s.rot)*z)-g.position.y;
 const add=(id:string,name:string|undefined,x:number,yy:number,z:number)=>{const p=part(id,name);if(p){p.position.set(x,yy,z);g.add(p);}return p;};
 const pts=outline(s,0.5);
 pts.forEach(([x,z],i)=>{const next=pts[(i+1)%pts.length],len=Math.hypot(next[0]-x,next[1]-z),angle=-Math.atan2(next[1]-z,next[0]-x);
  const stake=add('construction-site','stakePP',x,y(x,z),z);if(stake){const n=stake.children[0];n.position.x=0;n.position.z=0;}
  for(const name of ['ropeX_P','outlineX_P']){const p=add('construction-site',name,(x+next[0])/2,(y(x,z)+y(...next))/2,(z+next[1])/2);if(p){p.children[0].position.x=0;p.children[0].position.z=0;p.scale.x=len;p.rotation.y=angle;}}
 });
 const def=assets?.contract.buildings.find((b:any)=>b.id===s.def);
 // 外観違い（looks）は、その外観の工程ノード（s.stageNodes）を使う。標準の外観は契約の stageNodes。対応する工程がなければ建物は出さない（キットだけ）
 const stageNames=s.stageNodes?s.stageNodes[String(s.stage-1)]:def?.museFields.stageNodes[String(s.stage-1)];
 if(template&&s.stage>0&&stageNames?.length){const body=template.clone(true);applyConstructionStage(body,stageNames);body.name='CompletedConstructionStages';g.add(body);}
 const count=Math.round(Math.min(1,s.supplied)*6),pk=s.pileKinds?.length?s.pileKinds:['crated'];
 for(let k=0;k<count;k++){const x=(s.shape==='rect'?s.w/2:s.r)+0.6,z=-0.9+k*0.38;add('pile-'+pk[k%pk.length],undefined,x,y(x,z),z);}
 if(s.phase==='constructing'){
  const H=(s.stage+1)/s.stages*(s.tall+0.6),perimeter=outline(s,0.45),posts:[number,number][]=[];
  perimeter.forEach((p,i)=>{const q=perimeter[(i+1)%perimeter.length],n=Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/2.2);for(let k=0;k<n;k++)posts.push([p[0]+(q[0]-p[0])*k/n,p[1]+(q[1]-p[1])*k/n]);});
  const beam=(name:string,a:THREE.Vector3,b:THREE.Vector3)=>{const p=part('scaffold-kit',name);if(!p)return;const d=b.clone().sub(a);p.position.copy(a).add(b).multiplyScalar(.5);p.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),d.clone().normalize());p.scale.x=d.length();g.add(p);};
  posts.forEach(([x,z],i)=>{const p=add('scaffold-kit','Scaffold_Post',x,y(x,z),z);if(p)p.scale.y=H/3;
   const q=posts[(i+1)%posts.length],yb=y(...q);let levels:number[]=[];for(let yy=2.2;yy<H;yy+=2.2)levels.push(yy);levels.push(H);
   levels.forEach(yy=>beam('Scaffold_Beam',new THREE.Vector3(x,y(x,z)+yy,z),new THREE.Vector3(q[0],yb+yy,q[1])));
   if(i%2===0)beam('Scaffold_Brace',new THREE.Vector3(x,y(x,z)+.1,z),new THREE.Vector3(q[0],yb+H,q[1]));
   // Entrance-facing edge (+Z) and right edge get boards; circular sites use these same hemispheres.
   if((z>0&&q[1]>0)||(x>0&&q[0]>0))beam('Scaffold_Plank',new THREE.Vector3(x,y(x,z)+H,z),new THREE.Vector3(q[0],yb+H,q[1]));
  });
  const corner=posts.reduce((a,b)=>b[1]>a[1]?b:a,posts[0]);const ladder=add('scaffold-kit','Scaffold_Ladder',corner[0],y(...corner),corner[1]+.2);if(ladder)ladder.scale.y=H/3;
 }
 return g;
}
/* 現場の部品（杭・縄・輪郭・資材の山・足場）は 1 つの現場で 100 前後のメッシュになる。動かないので、材質ごとに 1 つのメッシュへまとめて描画の回数を減らす
   （スマホの負荷。足場の現場 1 つで約 108 → 11。2026-11-14 Claude、a81e63d の mergeStatic から回収）。
   元の部品は名前を残したまま描かない（visible=false：形と材質はキットと共有なので重さは増えない）。工程の建物（CompletedConstructionStages）はまとめない（工程の表示の判定を変えない） */
function mergeKitParts(g:THREE.Group):THREE.Group {
 g.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(g.matrixWorld).invert(),groups=new Map<string,{mat:THREE.Material;geos:THREE.BufferGeometry[];meshes:THREE.Mesh[]}>();
 const walk=(o:THREE.Object3D)=>{if(o.name==='CompletedConstructionStages'||o.name==='MergedKitParts')return;const m=o as THREE.Mesh;
  if(m.isMesh&&m.visible&&!Array.isArray(m.material)){const geo=m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,m.matrixWorld));
   const key=(m.material as THREE.Material).uuid+'|'+Object.keys(geo.attributes).sort().join(',')+'|'+(geo.index?'i':'n');
   const e=groups.get(key)||{mat:m.material as THREE.Material,geos:[],meshes:[]};e.geos.push(geo);e.meshes.push(m);groups.set(key,e);}
  o.children.forEach(walk);};
 g.children.forEach(walk);
 const out=new THREE.Group();out.name='MergedKitParts';
 for(const e of groups.values()){if(e.geos.length<2){e.geos.forEach(x=>x.dispose());continue;}const merged=mergeGeometries(e.geos,false);e.geos.forEach(x=>x.dispose());if(!merged)continue;
  const mesh=new THREE.Mesh(merged,e.mat);mesh.castShadow=true;mesh.receiveShadow=true;out.add(mesh);e.meshes.forEach(m=>{m.visible=false;});}
 g.add(out);return g;
}
function disposeMerged(g:THREE.Object3D){const m=g.getObjectByName('MergedKitParts');m?.traverse(o=>{const x=o as THREE.Mesh;if(x.isMesh)x.geometry.dispose();});}
export function buildRoads(d:Data,h:(x:number,z:number)=>number,groundColor?:(x:number,z:number)=>THREE.Color):THREE.Group {
 const g=new THREE.Group();g.name='ConstructionRoads';const byKind:Record<string,Cell[]>={},occupied=new Set(d.roads.map(c=>c.i+','+c.j));d.roads.forEach(c=>(byKind[c.kind]??=[]).push(c));
 const half=d.cell/2;
 // Preserve 4 terrain subdivisions, adding the contract's 0.18m outer blending band.
 const steps=[0,.18/d.cell,.25,.5,.75,1-.18/d.cell,1];
 for(const[kind,cells]of Object.entries(byKind)){
  const pos:number[]=[],uv:number[]=[],colors:number[]=[],idx:number[]=[];
  cells.forEach(c=>{const base=pos.length/3,cx=c.i*d.cell,cz=c.j*d.cell;
   steps.forEach(u=>steps.forEach(v=>{const x=cx-half+d.cell*u,z=cz-half+d.cell*v;pos.push(x,h(x,z)+.05,z);uv.push(u,v);
    const exposed=(u===0&&!occupied.has((c.i-1)+','+c.j))||(u===1&&!occupied.has((c.i+1)+','+c.j))||(v===0&&!occupied.has(c.i+','+(c.j-1)))||(v===1&&!occupied.has(c.i+','+(c.j+1)));
    const tint=exposed?(groundColor?.(x,z)||new THREE.Color('#7c6a42')).multiplyScalar(.88):new THREE.Color(1,1,1);colors.push(tint.r,tint.g,tint.b);
   }));
   for(let a=0;a<steps.length-1;a++)for(let b=0;b<steps.length-1;b++){const p=base+a*steps.length+b;idx.push(p,p+1,p+steps.length,p+1,p+steps.length+1,p+steps.length);}
  });
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(idx);geo.computeVertexNormals();
  const def=assets?.contract.roads.find((r:any)=>r.id===kind),path=def?.museFields.tileTexture;
  const map=typeof path==='string'?roadTexture(path):undefined;
  const normal=typeof path==='string'?roadTexture(path.replace('.png','_n.png'),true):undefined;
  const m=new THREE.MeshStandardMaterial({map:map||null,normalMap:normal||null,normalScale:new THREE.Vector2(.5,.5),color:map?0xffffff:d.colors[kind]||'#8a6a45',roughness:1,vertexColors:true,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const mesh=new THREE.Mesh(geo,m);mesh.name='Road:'+kind;mesh.receiveShadow=true;g.add(mesh);
 }
 // Planning outline remains a UI guide, not a substitute for a delivered model.
 if(d.pending.length){const p:number[]=[];d.pending.forEach(c=>{const x=c.i*d.cell,z=c.j*d.cell;const v=[[-half,-half],[half,-half],[half,half],[-half,half]];v.forEach((a,i)=>{for(const b of[a,v[(i+1)%4]])p.push(x+b[0],h(x+b[0],z+b[1])+.065,z+b[1]);});});const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0xc38a2e})));}
 return g;
}
export function syncConstructionVisual(gfx:any,d:Data,h:(x:number,z:number)=>number,a?:Assets,getTemplate?:(model:string)=>THREE.Object3D|undefined):void {
 const scene:THREE.Scene|undefined=gfx?.getScene?.();if(!scene)return;if(a)void loadConstructionAssets(a);
 let e=entries.get(gfx);if(!e){const root=new THREE.Group();root.name='ConstructionVisual';scene.add(root);e={root,sites:new Map(),roads:new THREE.Group(),roadSig:''};root.add(e.roads);entries.set(gfx,e);}
 const seen=new Set<string>();for(const s of d.sites){seen.add(s.id);const template=getTemplate?.(s.model);const sig=JSON.stringify([s.id,s.def,s.x,s.z,s.rot,s.phase,s.stage,Math.round(s.supplied*6),s.pileKinds,revision,!!template]);const cur=e.sites.get(s.id);if(cur?.sig===sig)continue;if(cur){e.root.remove(cur.g);disposeMerged(cur.g);}const g=mergeKitParts(buildSite(s,h,template));e.root.add(g);e.sites.set(s.id,{g,sig});}
 for(const[id,cur]of e.sites)if(!seen.has(id)){e.root.remove(cur.g);disposeMerged(cur.g);e.sites.delete(id);}
 const sig=JSON.stringify([d.roads,d.pending,revision]);if(sig!==e.roadSig){e.roadSig=sig;e.root.remove(e.roads);e.roads.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)m.geometry.dispose();if(m.material)(Array.isArray(m.material)?m.material:[m.material]).forEach(x=>x.dispose());});const terrain:THREE.Object3D[]=[];scene.traverse(o=>{if(o.name.startsWith('TerrainChunk ')||o.name==='OuterGround')terrain.push(o);});
 const ray=new THREE.Raycaster(),cache=new Map<string,THREE.Color>();
 const groundColor=(x:number,z:number)=>{const key=x+','+z;if(cache.has(key))return cache.get(key)!.clone();ray.set(new THREE.Vector3(x,h(x,z)+100,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObjects(terrain,false)[0];let color=new THREE.Color('#7c6a42');
 if(hit?.face){const mesh=hit.object as THREE.Mesh,pa=mesh.geometry.getAttribute('position'),ca=mesh.geometry.getAttribute('color');if(ca){const f=hit.face,a=new THREE.Vector3().fromBufferAttribute(pa,f.a),b=new THREE.Vector3().fromBufferAttribute(pa,f.b),c=new THREE.Vector3().fromBufferAttribute(pa,f.c),weight=new THREE.Vector3();new THREE.Triangle(a,b,c).getBarycoord(mesh.worldToLocal(hit.point.clone()),weight);color.setRGB(ca.getX(f.a)*weight.x+ca.getX(f.b)*weight.y+ca.getX(f.c)*weight.z,ca.getY(f.a)*weight.x+ca.getY(f.b)*weight.y+ca.getY(f.c)*weight.z,ca.getZ(f.a)*weight.x+ca.getZ(f.b)*weight.y+ca.getZ(f.c)*weight.z);}}cache.set(key,color.clone());return color;};
 e.roads=buildRoads(d,h,groundColor);e.root.add(e.roads);}
}
export const constructionVisualStatus=()=>({placeholder:!assets||kits.size!==Object.keys(assets.models).length,loaded:[...kits.keys()],failed:Object.fromEntries(failed)});
