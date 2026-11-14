// 街づくりの建物と道の契約を、ゲームのデータ（src/game/construction-data.js）から書き出す（docs/construction/construction-assets.json）。
// 寸法・原点・占有形状・入口・作業点の正本は Muse の assets/buildings-3d/structures.json と assets/build/town/specs.json（ここでは参照するだけ）。
// 工程と資材の正本は construction-data.js。Muse が埋める欄（工程別の表示ノード・LOD・材質・道路の接続点）は museFields。
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const root = path.resolve(new URL('..', import.meta.url).pathname), require = createRequire(path.join(root, 'package.json'));
const C = require('./src/game/construction-data.js');
const st = JSON.parse(fs.readFileSync(path.join(root, 'assets/buildings-3d/structures.json'), 'utf8')), stl = Array.isArray(st) ? st : (st.structures || Object.values(st));
const town = JSON.parse(fs.readFileSync(path.join(root, 'assets/build/town/specs.json'), 'utf8')).town;
const prev = fs.existsSync(path.join(root, 'docs/construction/construction-assets.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'docs/construction/construction-assets.json'), 'utf8')) : null;
const kept = id => prev && (prev.buildings.find(b => b.id === id) || {}).museFields;
const out = { version: 1, generatedFrom: 'src/game/construction-data.js（scripts/export-construction-contract.mjs で生成。手で直さない。museFields だけは書き出し直しても残す）',
  coordinate: '原点＝地面の上の中心（底面の中心、Y=0 が地面）、+Z が正面（入口・作業点の側）、Y 上、1 単位＝1 マス。rotationY は three.js の rotation.y',
  buildings: C.defs.map(d => { const s = stl.find(x => (x.type || x.id) === d.model), t = d.model.startsWith('town-') ? town[d.model.slice(5)] : null;
    return { id: d.id, name: d.name, category: d.cat, facility: d.facility, modelId: d.model,
      modelSource: s ? 'assets/buildings-3d/structures.json' : t ? 'assets/build/town/specs.json' : null,
      size: t ? t.size : (s && s.size) || null, footprint: d.footprint, entrance: d.entrance || null, operate: d.operate || null, walkable: !!d.walkable, rule: d.rule || null, maxRise: d.maxRise ?? null,
      stages: d.stages.map((x, i) => ({ index: i, id: x.id, name: x.name, materials: x.mat, workSeconds: x.work, tools: x.tools })),
      salvage: d.salvage,
      museFields: kept(d.id) || { stageNodes: null, roadConnectors: null, lod: null, materialSlots: null, status: '未着手（ゲームは仮表示で動く）' } }; }),
  roads: Object.values(C.roads).map(r => ({ id: r.id, name: r.name, rank: r.rank, color: r.color, stages: r.stages.map(s => ({ id: s, name: C.roadStages[s].name, materialsPerCell: C.roadStages[s].mat, workSecondsPerCell: C.roadStages[s].work, tools: C.roadStages[s].tools || [] })),
    museFields: (prev && (prev.roads.find(x => x.id === r.id) || {}).museFields) || { tileTexture: null, edgeTreatment: null, joinPieces: null, status: '未着手（ゲームは色の板で動く）' } })),
  grid: { cell: C.CELL, sectionMax: C.SECTION_MAX, roadMaxSlope: C.ROAD_SLOPE },
  notBuildable: C.notBuildable };
fs.mkdirSync(path.join(root, 'docs/construction'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/construction/construction-assets.json'), JSON.stringify(out, null, 1) + '\n');
console.log('docs/construction/construction-assets.json', out.buildings.length, 'buildings', out.roads.length, 'roads');
