import * as THREE from 'three';
const cache=new Map<string,THREE.Texture>();
function texture(id:string){
 if(cache.has(id))return cache.get(id)!;
 const src=(window as any).ASSETS?.spaceTextures?.[id];if(!src)return null;
 const t=new THREE.TextureLoader().load(src);t.colorSpace=THREE.SRGBColorSpace;t.flipY=false;t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.RepeatWrapping;cache.set(id,t);return t;
}
// GLBを編集・再保存しない。テンプレートに対応するUVは実行時の複製へ投影する。
// ラップは P4 | P3 | P2 | P1、vは上端0。汎用面は1m四方を1枚として投影。
function project(mesh:THREE.Mesh,mode:'body'|'capsule'|'box'){
 const g=mesh.geometry.clone(),pos=g.getAttribute('position'),norm=g.getAttribute('normal'),uv=new Float32Array(pos.count*2),p=new THREE.Vector3(),n=new THREE.Vector3();
 for(let i=0;i<pos.count;i++){
  p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
  if(mode==='body'||mode==='capsule'){
   uv[i*2]=((.875-Math.atan2(p.x,p.z)/(2*Math.PI))%1+1)%1;
   uv[i*2+1]=mode==='body'?(15.8-p.y)/11:(19.2-p.y)/3.4;
  }else{
   n.fromBufferAttribute(norm,i);const ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
   uv[i*2]=ax>ay&&ax>az?p.z:p.x;uv[i*2+1]=ay>ax&&ay>az?p.z:-p.y;
  }
 }
 // Seam-crossing triangles need continuous U, never interpolation through the centre of the atlas.
 if(mode!=='box'){
  // Install first, then expand indexed attributes consistently.
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const expanded=g.index?g.toNonIndexed():g;const a=expanded.getAttribute('uv');
  for(let i=0;i<a.count;i+=3){const us=[a.getX(i),a.getX(i+1),a.getX(i+2)];if(Math.max(...us)-Math.min(...us)>.5)for(let j=0;j<3;j++)if(us[j]<.5)a.setX(i+j,us[j]+1);}
  mesh.geometry=expanded;if(expanded!==g)g.dispose();
 }else{g.setAttribute('uv',new THREE.BufferAttribute(uv,2));mesh.geometry=g;}
}
export function applySpaceMaterials(scene:THREE.Group,id:string){
 scene.updateMatrixWorld(true);
 scene.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return;
  const original=Array.isArray(o.material)?o.material:[o.material];
  let mode:'body'|'capsule'|'box'|null=null;
  const materials=original.map(mat=>{
   if(!(mat instanceof THREE.MeshStandardMaterial))return mat;
   const name=mat.name.split('.')[0];let key='';
   if(id==='rocket'&&/^Skin_/.test(o.name)){key='tex-rocket-skin';mode='body';}
   else if(id==='rocket'&&/^Capsule/.test(o.name)&&name==='ecru'){key='tex-capsule-skin';mode='capsule';}
   else if(id==='spacesuit-display'&&name==='ecru'&&!/Helmet/.test(o.name)){key='tex-suit-cloth';mode='box';}
   else if(id==='spacesuit-display'&&name==='navy'){key='tex-suit-reinforce';mode='box';}
   else if(/Seal|DockRing|Gasket/.test(o.name)){key='tex-rubber-seal';mode='box';}
   else if(name==='metal'||name==='metalDark'||name==='frame'){key='tex-metal-dull';mode='box';}
   else if(name==='insul'){key='tex-insulation';mode='box';}
   else if(name==='heat'){key='tex-heat-resistant';mode='box';}
   else if(name==='pcb'){key='tex-circuit-board';mode='box';}
   else if(name==='screenGlow'&&/Screen|Panel/.test(o.name)){key='tex-terminal-screen';mode='box';}
   const map=texture(key);if(!map)return mat;
   const m=mat.clone();m.map=map;m.color.set(0xffffff);
   if(name==='metalDark')m.color.set(0x999999);
   if(m.emissiveIntensity>0){m.emissiveMap=map;}
   // Museのmetalness/roughness/normalは維持。色画像から法線を捏造しない。
   return m;
  });
  if(mode)project(o,mode);
  o.material=Array.isArray(o.material)?materials:materials[0];
 });
}
