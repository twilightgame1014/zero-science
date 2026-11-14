import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {loadTerrain} from './helpers/terrain.mjs';
const require=createRequire(import.meta.url),D=require('../src/game/data.js');
require('../src/game/space-data.js');
const E=require('../src/game/engine.js'),P=require('../src/game/space.js'),N=require('../src/game/nature.js');
const T=await loadTerrain(),W=N.create(D,E,{...T,cfg:T.DEFAULT_CONFIG}),S=E.makeVerifyState();
const pos={...D.base},opts={player:pos,reserved:[{...D.base,r:1.3},...(D.village?[{...D.village.c,r:D.village.r}]:[])]};
let candidate;
for(let radius=24;radius<=210&&!candidate;radius+=12)for(let k=0;k<32;k++){
 const q={x:Math.round(pos.x+Math.cos(k*Math.PI/16)*radius),z:Math.round(pos.z+Math.sin(k*Math.PI/16)*radius),rot:0};
 if(W.checkPlacement(S,{...D.space.siteSpec,...q},opts).ok){candidate=q;break;}
}
assert(candidate,'UIの探索範囲に設置可能な発射場がある');
assert(P.place(S,W,candidate.x,candidate.z,0,opts).ok);
W.setStructures([{id:'space-site',...candidate,footprint:D.space.siteSpec.footprint}]);
assert(!W.free(S,candidate.x,candidate.z),'設置した発射場の中へ歩けない');
const entry={x:candidate.x,z:candidate.z+11};
assert(W.free(S,entry.x,entry.z),'搭乗口に立てる');
assert(W.findPath(S,pos,entry),'拠点から搭乗口へ歩ける');
assert(!W.checkPlacement(S,{...D.space.siteSpec,id:'other',...candidate},opts).ok,'別の建物との重複を拒否');
assert(!W.checkPlacement(S,{...D.space.siteSpec,x:100000,z:100000,rot:0},opts).ok,'範囲外を拒否');
const saved=E.deserialize(E.serialize(S));
assert.deepEqual(saved.build['space-site'],S.build['space-site']);
assert(P.placed(saved));
console.log('PASS 実地形での候補探索・設置・占有・搭乗口への経路・重複拒否・保存復帰',candidate);
