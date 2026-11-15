import assert from 'node:assert/strict';import fs from 'node:fs';import {gzipSync} from 'node:zlib';import {build} from 'esbuild';import * as THREE from 'three';
fs.mkdirSync('test-results',{recursive:true});const temp='test-results/space-exhaust-module.mjs';
await build({entryPoints:['src/space-models.ts'],outfile:temp,bundle:true,platform:'node',format:'esm',packages:'external'});
const textureLoad=THREE.TextureLoader.prototype.load;THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
global.matchMedia=()=>({matches:true});global.window={ASSETS:{spaceContract:JSON.parse(fs.readFileSync('assets/rocket/rocket-contract.json')),spaceSmoke:['one','two','three','four']}};
try{
 const {updateSpaceModels,spaceModelStatus}=await import('../'+temp);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),calls=[];
 const gfx={getScene:()=>scene,getCamera:()=>camera,setExhaustEmitter:p=>calls.push(p?{...p}:null),playVisualEffect:()=>assert.fail('no repeated exhaust burst')};
 const ids=['rocket','launch-pad','support-tower','boarding-corridor'];
 const assets=Object.fromEntries(ids.map(id=>[id,{gzip:gzipSync(fs.readFileSync('assets/rocket/models/'+id+'-lod1.glb')).toString('base64')}]));
 const site={x:38,y:4,z:-21,rot:Math.PI/3,phase:'ground',elapsed:0,stage:4,installed:{structure:1,propulsion:1,skin:1,capsule:1},owned:{}};
 updateSpaceModels(gfx,site,assets);for(let i=0;i<100&&spaceModelStatus(gfx)==='loading';i++)await new Promise(r=>setTimeout(r,10));assert.equal(spaceModelStatus(gfx),'ready');
 updateSpaceModels(gfx,site,assets);assert.equal(calls.length,0);
 const check=(phase,elapsed)=>{site.phase=phase;site.elapsed=elapsed;updateSpaceModels(gfx,site,assets);const rocket=scene.getObjectByName('space-model:rocket'),a=rocket.getObjectByName('Anchor_exhaust').getWorldPosition(new THREE.Vector3()),p=calls.at(-1);assert(p);assert(a.distanceTo(new THREE.Vector3(p.x,p.y,p.z))<1e-8,'emitter tracks actual transformed anchor');return p;};
 const ground=check('ignition',9.1),up=check('ascent',11.1);assert(up.y>ground.y+10,'emitter rises with rocket');
 check('ascent',12);const before=calls.length;site.phase='space';updateSpaceModels(gfx,site,assets);assert.equal(calls.length,before+1);assert.equal(calls.at(-1),null);
 site.phase='ending';updateSpaceModels(gfx,site,assets);updateSpaceModels(gfx,null,assets);assert.equal(calls.length,before+1,'stop only once');
 check('ignition',9.1);updateSpaceModels(gfx,null,assets);assert.equal(calls.at(-1),null,'site removal stops active exhaust');
 console.log('PASS formal GLB exhaust anchor at rotated/translated site, ascent follows each frame, stop once, replay and site removal');
}finally{THREE.TextureLoader.prototype.load=textureLoad;delete global.window;delete global.matchMedia;fs.unlinkSync(temp);}
