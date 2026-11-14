import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {loadTerrain} from './helpers/terrain.mjs';
const require=createRequire(import.meta.url);require('../src/game/construction-data.js');const D=require('../src/game/data.js'),E=require('../src/game/engine.js'),C=require('../src/game/construction.js'),N=require('../src/game/nature.js');
const T=await loadTerrain(),W=N.create(D,E,{...T,cfg:T.DEFAULT_CONFIG}),S=E.newState();S.cons.rule='build';
let pos;for(let x=-40;x<40&&!pos;x+=2)for(let z=-40;z<40;z+=2)if(C.checkBuilding(S,W,'workbench',x,z,0,{}).ok){pos={x,z};break;}
assert(pos);const plan=C.plan(S,W,'workbench',pos.x,pos.z,0,{},S.seq);assert(plan.ok);
const source=fs.readFileSync('src/game/ui.js','utf8');const start=source.indexOf('function syncStructColliders(){'),end=source.indexOf('\n}',start)+2;
const ctx={world:()=>W,WORLD:W,W3:{structInfo:new Map(),pos:null},S,SPACE:{placed:()=>false},CONS:C,ASSETS:{},syncNature(){}};vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nsyncStructColliders();',ctx);
const same=C.move(S,W,plan.id,pos.x,pos.z,0,{},S.seq);assert(same.ok,'own site must be ignored during repositioning: '+same.msg);
const overlap=C.plan(S,W,'workbench',pos.x,pos.z,0,{},S.seq);assert(!overlap.ok,'other site still blocked');
console.log('PASS actual UI collider adapter: own plan reposition allowed, overlapping second site rejected');
