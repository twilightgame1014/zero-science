import fs from 'node:fs';import assert from 'node:assert/strict';import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {transform} from 'esbuild';
fs.mkdirSync('test-results',{recursive:true});const temp='test-results/material-regression.mjs';
const {code}=await transform(fs.readFileSync('src/space-materials.ts','utf8'),{loader:'ts',format:'esm'});fs.writeFileSync(temp,code);
const maps=JSON.parse(fs.readFileSync('docs/space/art-processing.json')).textures.filter(x=>!x.alpha).map(x=>x.id);
global.window={ASSETS:{spaceTextures:Object.fromEntries(maps.map(k=>[k,k]))}};
const old=THREE.TextureLoader.prototype.load;THREE.TextureLoader.prototype.load=function(src){const t=new THREE.Texture();t.name=src;return t;};
try{
 const {applySpaceMaterials}=await import('../'+temp);const used=new Set();
 for(const file of fs.readdirSync('assets/rocket/models').filter(x=>x.endsWith('.glb'))){
  const b=fs.readFileSync('assets/rocket/models/'+file),{scene}=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  const before=new Map();scene.traverse(o=>{if(o.isMesh)before.set(o.uuid,{index:Array.from(o.geometry.index?.array||[]),pos:Array.from(o.geometry.attributes.position.array),norm:Array.from(o.geometry.attributes.normal.array),range:{...o.geometry.drawRange}});});
  applySpaceMaterials(scene,file.replace(/(?:-lod1)?\.glb$/,''));
  scene.traverse(o=>{if(!o.isMesh)return;const v=before.get(o.uuid);assert.deepEqual(Array.from(o.geometry.index?.array||[]),v.index,file+o.name);assert.deepEqual(Array.from(o.geometry.attributes.position.array),v.pos);assert.deepEqual(Array.from(o.geometry.attributes.normal.array),v.norm);assert.deepEqual(o.geometry.drawRange,v.range);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map){used.add(m.map.name);assert(o.geometry.attributes.uv);assert(Array.from(o.geometry.attributes.uv.array).every(Number.isFinite));}});
 }
 assert.deepEqual([...used].sort(),maps.sort(),'every generated base colour has a model destination');
 console.log('PASS 26 GLBs retain indices, vertex positions, normals and draw ranges; all 10 base colours mapped with finite UVs');
}finally{THREE.TextureLoader.prototype.load=old;fs.unlinkSync(temp);delete global.window;}
