import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const {code}=await transform(fs.readFileSync(new URL('../src/space-animation.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {slotVisible,flightPose,FLIGHT}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const sn=JSON.parse(fs.readFileSync(new URL('../assets/rocket/rocket-contract.json',import.meta.url))).slotNodes;
const at=inst=>name=>slotVisible(name,inst,sn), S1={structure:1}, S2={structure:1,propulsion:1}, S3={structure:1,propulsion:1,capsule:1,skin:1};
const one=(k)=>sn[k][0];
assert(!at({})(one('frame')),'S0 は何も出さない');
assert(at(S1)(one('frame'))&&!at(S1)(one('propulsion'))&&!at(S1)(one('capsule'))&&!at(S1)(one('skin')),'S1＝骨組み');
assert(at(S2)(one('frame'))&&at(S2)(one('propulsion'))&&!at(S2)(one('skin')),'S2＝骨組み＋推進（部分外装なし）');
assert(!at(S3)(one('frame'))&&at(S3)(one('capsule'))&&at(S3)(one('skin'))&&at(S3)(one('propulsion')),'S3＝外装で骨組みは隠れる');
assert.equal(flightPose(3.7,true).corridor,0);assert.equal(flightPose(5.2,true).tower,0);assert.equal(flightPose(7.7,true).mount,0);assert.equal(flightPose(9.9,true).rise,0);
assert.equal(flightPose(5.3,true).corridor,1.5);assert.equal(flightPose(7.8,true).tower,2.5);assert.equal(flightPose(10,true).mount,.6);
assert.equal(flightPose(100,false).rise,0,'return to prelaunch pose');
for(const suffix of ['-lod1','']){
 const p=new URL('../assets/rocket/models/rocket'+suffix+'.glb',import.meta.url);
 const b=fs.readFileSync(p);const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 const mixer=new THREE.AnimationMixer(gltf.scene),hatch=gltf.scene.getObjectByName('Hatch'),anchor=gltf.scene.getObjectByName('Anchor_hatch');
 assert(hatch&&anchor);const start=hatch.getWorldPosition(new THREE.Vector3());
 const open=mixer.clipAction(gltf.animations.find(c=>c.name==='hatch_open'));open.play();open.paused=true;open.time=open.getClip().duration;mixer.update(0);gltf.scene.updateMatrixWorld(true);
 const end=hatch.getWorldPosition(new THREE.Vector3());assert(end.distanceTo(start)>.2,'hatch actually opens '+suffix);
 open.stop();const close=mixer.clipAction(gltf.animations.find(c=>c.name==='hatch_close'));close.play();close.paused=true;close.time=close.getClip().duration;mixer.update(0);gltf.scene.updateMatrixWorld(true);
 assert(hatch.getWorldPosition(new THREE.Vector3()).distanceTo(start)<1e-4,'closed pose restores '+suffix);
 assert.equal(anchor.position.y,17.299999237060547);
}
console.log('PASS contract v6 slot visibility, sequential clips, hatch end poses in both LODs');
// Sample every built-in clip without modifying the canonical GLB. Includes the loop midpoint.
let sampled=0;
for(const suffix of ['', '-lod1'])for(const id of ['rocket','launch-pad','support-tower','boarding-corridor']){
 const b=fs.readFileSync(new URL('../assets/rocket/models/'+id+suffix+'.glb',import.meta.url));
 const g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 for(const clip of g.animations){
  const mixer=new THREE.AnimationMixer(g.scene),action=mixer.clipAction(clip);action.play();action.paused=true;
  const poses=[];
  for(const fraction of [0,.5,1]){
   action.time=clip.duration*fraction;mixer.update(0);g.scene.updateMatrixWorld(true);
   const values=[];g.scene.traverse(n=>{assert(n.matrixWorld.elements.every(Number.isFinite),id+':'+clip.name);values.push(...n.position.toArray(),...n.quaternion.toArray());});poses.push(values);
  }
  assert(poses[0].some((x,i)=>Math.abs(x-poses[1][i])>1e-5),id+':'+clip.name+' has a changing midpoint');
  mixer.stopAllAction();sampled++;
 }
}
assert.equal(sampled,16,'eight clips in both LODs');
console.log('PASS all eight clip start/mid/end transforms in both LODs');
