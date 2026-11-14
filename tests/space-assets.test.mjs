import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {gzipSync,gunzipSync} from 'node:zlib';
const source=JSON.parse(fs.readFileSync(new URL('../docs/space-model-source.json',import.meta.url)));
assert.equal(source.files.length,13);const models=new Map();
for(const f of source.files){const b=fs.readFileSync(new URL('../'+f.path,import.meta.url));
 assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex'),f.sha,'Muse原本と同一 '+f.path);
 assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);
 const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());models.set(f.path.split('/').at(-1).replace('-lod1.glb',''),g);
 assert(!(g.buffers||[]).some(x=>x.uri));assert(!(g.images||[]).some(x=>x.uri&&!x.uri.startsWith('data:')),'外部画像へ依存しない');
 assert.deepEqual(gunzipSync(gzipSync(b)),b);
}
for(const [id,clips]of [['rocket',['hatch_open','hatch_close','bay_open','bay_close']],['support-tower',['tower_retract','beacon_spin']],['boarding-corridor',['corridor_retract']],['launch-pad',['mount_release']]]){
 const g=models.get(id);for(const name of clips){const a=g.animations.find(a=>a.name===name);assert(a,name);assert(a.channels.every(c=>g.nodes[c.target.node]),'対象ノードが実在');}
}
for(const [id,node]of [['rocket','Anchor_exhaust'],['rocket','Anchor_hatch'],['support-tower','Anchor_corridor_root']])assert(models.get(id).nodes.some(n=>n.name===node),id+':'+node);
console.log('PASS Muse原本13モデルのSHA・GLB構造・8クリップ・接続点・可逆圧縮');
// 契約 v6（Muse ラウンド30）：機体のメッシュは、組込枠の表示一覧（slotNodes）のどれか1つにだけ入る。設備の置き場所はモデルが実在し、宇宙服ディスプレイはスタンドと重ならない位置
{const c=JSON.parse(fs.readFileSync(new URL('../assets/rocket/rocket-contract.json',import.meta.url)));assert.equal(c.version,6);
 const g=models.get('rocket'),meshNodes=g.nodes.filter(n=>n.mesh!==undefined).map(n=>n.name),lists=['frame','propulsion','capsule','skin'].map(k=>c.slotNodes[k]);
 const count=n=>lists.filter(l=>l.includes(n)).length;
 assert.deepEqual(meshNodes.filter(n=>count(n)!==1),[],'どの枠にも入らない／2つの枠に入るメッシュ');
 assert(lists.flat().every(n=>meshNodes.includes(n)),'一覧のノードが GLB に実在');
 const pl=c.equipmentPlacement.items;assert(pl.every(q=>models.has(q.model)),'置き場所のモデルが実在');
 assert.deepEqual(pl.find(q=>q.model==='spacesuit-display').position,[-6,0,-3]);
 const smoke=['Anchor_smoke_l','Anchor_smoke_r'].map(n=>[...models].find(([,m])=>m.nodes.some(x=>x.name===n)));assert(smoke.every(Boolean),'煙の接続点が実在');
 const src=fs.readFileSync(new URL('../src/space-models.ts',import.meta.url),'utf8'),vis=fs.readFileSync(new URL('../src/space-visual.ts',import.meta.url),'utf8');
 assert(/slotNodes/.test(src)&&/equipmentPlacement/.test(src)&&/'exhaust'/.test(src)&&/'padSmoke'/.test(src),'ゲームが契約 v6 とエフェクトを使う');
 assert(/setPlayerVisible/.test(vis)&&!/character\.group\.visible\s*=/.test(vis),'主人公の隠しは公開 API で');
 console.log('PASS 契約 v6：機体のメッシュ'+meshNodes.length+'個がそれぞれ1つの組込枠に入る・設備の置き場所・煙の接続点（'+smoke.map(s=>s[0]).join('・')+'）・公開 API の使用');}
