import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {gzipSync,gunzipSync} from 'node:zlib';
const source=JSON.parse(fs.readFileSync(new URL('../docs/space-model-source.json',import.meta.url)));
assert.equal(source.files.length,26);const models=new Map();
for(const f of source.files){const b=fs.readFileSync(new URL('../'+f.path,import.meta.url));
 assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex'),f.sha,'Muse原本と同一 '+f.path);
 assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);
 const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());models.set(f.path.split('/').at(-1).replace(/(?:-lod1)?\.glb$/,''),g);
 assert(!(g.buffers||[]).some(x=>x.uri));assert(!(g.images||[]).some(x=>x.uri&&!x.uri.startsWith('data:')),'外部画像へ依存しない');
 assert.deepEqual(gunzipSync(gzipSync(b)),b);
}
for(const [id,clips]of [['rocket',['hatch_open','hatch_close','bay_open','bay_close']],['support-tower',['tower_retract','beacon_spin']],['boarding-corridor',['corridor_retract']],['launch-pad',['mount_release']]]){
 const g=models.get(id);for(const name of clips){const a=g.animations.find(a=>a.name===name);assert(a,name);assert(a.channels.every(c=>g.nodes[c.target.node]),'対象ノードが実在');}
}
for(const [id,node]of [['rocket','Anchor_exhaust'],['rocket','Anchor_hatch'],['support-tower','Anchor_corridor_root']])assert(models.get(id).nodes.some(n=>n.name===node),id+':'+node);
console.log('PASS Muse原本26モデルのSHA・GLB構造・8クリップ・接続点・可逆圧縮');
