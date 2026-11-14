import fs from 'node:fs';import assert from 'node:assert/strict';import vm from 'node:vm';
const root=new URL('../',import.meta.url),ctx={console};vm.createContext(ctx);
for(const f of ['data','space-data','space-science'])vm.runInContext(fs.readFileSync(new URL('src/game/'+f+'.js',root),'utf8'),ctx);
const ids=[...ctx.DATA.space.ids,'rawrubber','rubber'];const atlas=JSON.parse(fs.readFileSync(new URL('assets/build/rocket/icons.json',root)));
assert.deepEqual(Object.keys(atlas.items).sort(),ids.sort());
function png(path,w,h,alpha){const b=fs.readFileSync(new URL(path,root));assert.equal(b.readUInt32BE(16),w,path);assert.equal(b.readUInt32BE(20),h,path);if(alpha)assert.equal(b[25],6,path+' alpha');}
for(const id of ids){png('assets/rocket/icons/'+id+'.png',256,256,true);const it=ctx.DATA.items[id];assert(it.more&&it.simplification,'science explanation '+id);}
for(const hero of ['boy','girl'])png('assets/hero/player-spritesheet-'+hero+'-suit-8dir.png',1024,2048,true);
const report=JSON.parse(fs.readFileSync(new URL('docs/space/art-processing.json',root)));
assert.equal(report.textures.length,14);for(const t of report.textures)png('assets/rocket/textures/'+t.id+'.png',...t.size,t.alpha);
console.log('PASS all 55 exact icon IDs, transparent art dimensions, both suit sheets, 14 maps, simplified science explanations');
