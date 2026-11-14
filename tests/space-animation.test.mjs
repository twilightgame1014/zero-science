import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const {code}=await transform(fs.readFileSync(new URL('../src/space-animation.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {visibleAtStage,flightPose,FLIGHT}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const visible=stage=>name=>visibleAtStage(name,stage);
assert(visible(1)('Frame_TankLower'));assert(!visible(1)('Capsule'));
assert(visible(2)('Skin_Lower_P1'));assert(visible(2)('Skin_Lower_P3'));assert(!visible(2)('Skin_Lower_P4'));
assert(visible(2)('Frame_BodyLower'));assert(visible(2)('Skin_Upper_P2'));assert(!visible(2)('Skin_Upper_P1'));assert(!visible(2)('Capsule'));assert(!visible(2)('NoseTip'));
assert(visible(3)('Capsule'));assert(visible(3)('BayPanel'));assert(!visible(3)('Frame_BodyLower'));
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
console.log('PASS v5 partial panels, sequential clips, hatch end poses in both LODs');
