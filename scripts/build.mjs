// 1ファイル版のゲーム（dist/index.html）を作る。
// - src/graphics（HD-2D描画モジュール）を esbuild でまとめる。three は CDN からインポートマップで読む。
// - assets/ の画像を data URL にして埋め込む（公開先で外部画像を読まなくて済むように）。
import { build } from 'esbuild';
import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldTerrainPlugin } from './world-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const gfx = await build({
  entryPoints: [path.join(root, 'src/graphics-entry.ts')],
  bundle: true, format: 'esm', target: 'es2020', write: false, minify: true,
  external: ['three', 'three/addons/*'], logLevel: 'warning',
  plugins: [worldTerrainPlugin(root)],   // モジュールの地形を広い世界の正本へ（src/graphics は変更しない）
});
const gfxCode = gfx.outputFiles[0].text;
// 地形関数（three に依存しない）を、ゲームのロジック用に別にまとめる
const terrain = await build({
  entryPoints: [path.join(root, 'src/terrain-entry.ts')],
  bundle: true, format: 'iife', globalName: 'TERRAIN', target: 'es2020', write: false, logLevel: 'warning',
});
const terrainCode = terrain.outputFiles[0].text;

const dataUrl = (p, mime) => `data:${mime};base64,${fs.readFileSync(path.join(root, p)).toString('base64')}`;
const ASSETS = {
  /* 主人公：8方向シート（Muse 第23ラウンド。4列×8行、行4-7が斜め。scripts/make-hero-sprites.py で WebP に） */
  boy: dataUrl('assets/build/hero/boy-8dir.webp', 'image/webp'),
  girl: dataUrl('assets/build/hero/girl-8dir.webp', 'image/webp'),
  heroRows: 8,
  boySuit: dataUrl('assets/build/hero/boy-suit-8dir.webp','image/webp'),
  girlSuit: dataUrl('assets/build/hero/girl-suit-8dir.webp','image/webp'),
  grass: dataUrl('assets/textures/grass-detail.png', 'image/png'),
  rock: dataUrl('assets/textures/rock-detail.png', 'image/png'),
  particle: dataUrl('assets/textures/particle-dot.png', 'image/png'),
  shadow: dataUrl('assets/textures/shadow-blob.png', 'image/png'),
};

// UIアイコン（Muse 仕上げ・assets/ui-icons。タブは 48px 版、詰める場所は 32px 版）
const ICON_FILES = { lab: 'lab', craft: 'craft', book: 'encyclopedia', tech: 'technology', log: 'journal', map: 'map', home: 'base', settings: 'settings' };
ASSETS.icons = {}; ASSETS.icons32 = {};
for (const [name, file] of Object.entries(ICON_FILES)) {
  for (const [box, dir] of [[ASSETS.icons, '48'], [ASSETS.icons32, '32']]) {
    const f = `assets/ui-icons/${dir}/${file}.png`;
    if (fs.existsSync(path.join(root, f))) box[name] = dataUrl(f, 'image/png');
  }
}
// 線のUIアイコン（Muse ラウンド28・assets/ui-icons-line。メニューの配色：濃紺の帯の上は生成り（c）、選択中・紙の上は青緑（t））。
// ある名前はこちらを優先し、ないものは上の色つきアイコン。状態の印（未発見・加工できない・材料不足・選択中）は 24px の3色
ASSETS.iconsLine = {}; ASSETS.stateIcons = {};
for (const [name, file] of Object.entries(ICON_FILES)) {
  const c = `assets/ui-icons-line/png/48/${file}-cream.png`, t = `assets/ui-icons-line/png/48/${file}-teal.png`;
  if (fs.existsSync(path.join(root, c)) && fs.existsSync(path.join(root, t))) ASSETS.iconsLine[name] = { c: dataUrl(c, 'image/png'), t: dataUrl(t, 'image/png') };
}
for (const st of ['undiscovered', 'blocked', 'lacking', 'selected']) {
  const o = {}; for (const [k, col] of [['c', 'cream'], ['t', 'teal'], ['n', 'navy']]) { const f = `assets/ui-icons-line/png/24/state-${st}-${col}.png`; if (fs.existsSync(path.join(root, f))) o[k] = dataUrl(f, 'image/png'); }
  if (Object.keys(o).length) ASSETS.stateIcons[st] = o;
}
// 研究室の背景（Muse ラウンド28・assets/ui-science/lab-bench-bg.svg。生成り＋濃紺。棚 y=96・作業台 y=186 は drawScene と同じ）。屋内の段階（3以上）で使う
if (fs.existsSync(path.join(root, 'assets/ui-science/lab-bench-bg.svg'))) ASSETS.labBg = dataUrl('assets/ui-science/lab-bench-bg.svg', 'image/svg+xml');
// 実験台の器具（Muse・assets/lab-apparatus/sprites。装置と液体・炎は別レイヤー、256×256・底面中心が (128,234)）
ASSETS.labApp = {};
const appDir = path.join(root, 'assets/lab-apparatus/sprites');
if (fs.existsSync(appDir)) for (const f of fs.readdirSync(appDir)) if (f.endsWith('.png')) ASSETS.labApp[f.replace('.png', '')] = dataUrl('assets/lab-apparatus/sprites/' + f, 'image/png');
// 物質アイコン（Muse・assets/item-icons が原本。scripts/make-item-atlas.py で作った 64px のアトラスを埋め込む）
const itemAtlas = 'assets/build/item-icons-64.webp', itemMap = 'assets/build/item-icons-64.json';
if (fs.existsSync(path.join(root, itemAtlas)) && fs.existsSync(path.join(root, itemMap))) {
  const m = JSON.parse(fs.readFileSync(path.join(root, itemMap), 'utf8'));
  ASSETS.items = { src: dataUrl(itemAtlas, 'image/webp'), cols: m.cols, rows: m.rows, pos: m.items };
}
// 道具・設備・操作のアイコン（Muse・assets/buildings-icons が原本・62点。scripts/make-tool-atlas.py で作った 64px のアトラス。キーは「カテゴリ/ID」）
const toolAtlas = 'assets/build/tool-icons-64.webp', toolMap = 'assets/build/tool-icons-64.json';
if (fs.existsSync(path.join(root, toolAtlas)) && fs.existsSync(path.join(root, toolMap))) {
  const m = JSON.parse(fs.readFileSync(path.join(root, toolMap), 'utf8'));
  ASSETS.tools = { src: dataUrl(toolAtlas, 'image/webp'), cols: m.cols, rows: m.rows, pos: m.items };
}
// 建物の3Dモデル（Muse・assets/buildings-3d が原本。scripts/make-building-glb.py で作った軽量版を埋め込む）と、
// 占有形状・入口・操作位置などの正式値（structures.json から必要な項目だけ）
{
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'assets/buildings-3d/structures.json'), 'utf8'));
  ASSETS.buildingSpecs = {};
  for (const s of spec.structures) ASSETS.buildingSpecs[s.id] = { name: s.name, facilityId: s.facilityId || null, footprint: s.footprint, entrance: s.entrance, operate: s.operate, size: s.size, moving: (s.movingParts || []).map(m => m.name) };
  ASSETS.buildings = {};
  // 2026-11-12：画像を共有テクスチャ（ASSETS.sharedTex）へ移した版（assets/build/buildings-lite。scripts/make-nature-glb.py）があればそれを使う
  const dir = fs.existsSync(path.join(root, 'assets/build/buildings-lite')) ? 'assets/build/buildings-lite' : 'assets/build/buildings';
  for (const id of Object.keys(ASSETS.buildingSpecs)) {
    const f = path.join(root, dir, id + '.glb');
    if (fs.existsSync(f)) ASSETS.buildings[id] = fs.readFileSync(f).toString('base64');
    else console.warn('建物モデルがない（scripts/make-building-glb.py を実行）：' + id);
  }
}
// 集落の小物（Muse 第17ラウンド・assets/gpt-expansion/models が原本。軽量版は assets/build/props）と NPC の絵（assets/build/npc）
{
  const pj = JSON.parse(fs.readFileSync(path.join(root, 'assets/gpt-expansion/props.json'), 'utf8'));
  ASSETS.propSpecs = {}; ASSETS.props = {};
  for (const p of pj.props) {
    const f = p.footprint || {}, type = 'prop-' + p.id;
    ASSETS.propSpecs[type] = { name: p.name, stage: p.stage, footprint: f.r != null ? { shape: 'circle', r: f.r } : { shape: 'rect', w: f.w, d: f.d }, size: p.size };
    const lite = path.join(root, 'assets/build/props-lite', p.id + '.glb'), g = fs.existsSync(lite) ? lite : path.join(root, 'assets/build/props', p.id + '.glb');
    if (fs.existsSync(g)) ASSETS.props[type] = fs.readFileSync(g).toString('base64'); else console.warn('小物のモデルがない（scripts/make-building-glb.py を実行）：' + p.id);
  }
  ASSETS.npc = {};
  for (const n of ['guide', 'resident', 'craftsman']) { const f = 'assets/build/npc/' + n + '.webp'; if (fs.existsSync(path.join(root, f))) ASSETS.npc[n] = dataUrl(f, 'image/webp'); else console.warn('NPC の絵がない（scripts/make-npc-sprites.py を実行）：' + n); }
}
// 自然物と街の 3D モデル（Muse の環境セット・GPT-DQ3 セット。scripts/make-nature-glb.py が作った軽量版：画像を抜いた GLB ＋ 重複を除いた共有テクスチャ）
{
  const man = path.join(root, 'assets/build/nature/manifest.json');
  if (fs.existsSync(man)) {
    const m = JSON.parse(fs.readFileSync(man, 'utf8'));
    ASSETS.nature = { models: {}, lod1: {}, manifest: { nature: m.nature } };
    // 共有テクスチャ（自然物・街・拠点の建物・集落の小物の GLB が "tex:<hash>" の名前で参照する。同じ画像は1枚）
    ASSETS.sharedTex = {};
    for (const id of Object.keys(m.nature)) ASSETS.nature.models[id] = fs.readFileSync(path.join(root, 'assets/build/nature', id + '.glb')).toString('base64');
    for (const id of Object.keys(m.lod1 || {})) ASSETS.nature.lod1[id] = fs.readFileSync(path.join(root, 'assets/build/nature', id + '_lod1.glb')).toString('base64');
    for (const h of Object.keys(m.textures)) ASSETS.sharedTex[h] = dataUrl('assets/build/nature-tex/' + h + '.webp', 'image/webp');
    // 街の建物・小物（検証モードで置ける。通常のゲームの開始地点には置かない）。占有形状は assets/build/town/specs.json
    const ts = JSON.parse(fs.readFileSync(path.join(root, 'assets/build/town/specs.json'), 'utf8'));
    ASSETS.townSpecs = {}; ASSETS.town = {};
    for (const [id, sp] of Object.entries(ts.town)) { const type = 'town-' + id; ASSETS.townSpecs[type] = sp; ASSETS.town[type] = fs.readFileSync(path.join(root, 'assets/build/town', id + '.glb')).toString('base64'); }
  } else console.warn('自然物のモデルがない（scripts/make-nature-glb.py を実行）');
}
// 検証モードの一覧：描画モジュールに登録されている演出と建物タイプ（ソースから読み取る。固定の数を書かない）
{
  const fx = fs.readFileSync(path.join(root, 'src/graphics/EffectsManager.ts'), 'utf8');
  const fxBody = fx.slice(fx.indexOf('const EFFECT_STYLE'), fx.indexOf('};', fx.indexOf('const EFFECT_STYLE')));
  const effects = [...fxBody.matchAll(/^\s*([a-z][\w-]*):\s*\{/gm)].map(m => m[1]);
  const ty = fs.readFileSync(path.join(root, 'src/graphics/types.ts'), 'utf8');
  const stBody = ty.slice(ty.indexOf('export type StructureType'), ty.indexOf(';', ty.indexOf('export type StructureType')));
  const structures = [...stBody.matchAll(/'([\w-]+)'/g)].map(m => m[1]);
  ASSETS.gfxCatalog = { effects, structures };
}
// Muse確定版のLOD1を可逆圧縮して1ファイルHTMLへ。読込み失敗は仮表示へ戻る。
ASSETS.spaceModels = {};
ASSETS.spaceContract=JSON.parse(rd('assets/rocket/rocket-contract.json'));
ASSETS.spacePlacement={'launch-pad':[0,0],'rocket':[0,0],'support-tower':[-4.6,0],'control-terminal':[5,5],'electronics-fab':[-2,6],'computer-bench':[1,6],'test-terminal':[4,-6],'power-distribution':[6,-2],'life-support':[6,1],'suit-stand':[-6,-5],'parts-rack':[-2,-5]};
for(const id of ['rocket','launch-pad','support-tower','boarding-corridor','control-terminal','electronics-fab','computer-bench','test-terminal','suit-stand','life-support','power-distribution','parts-rack','spacesuit-display']){
  const f=path.join(root,'assets/rocket/models',id+'-lod1.glb');
  if(fs.existsSync(f)){
    ASSETS.spaceModels[id]={gzip:gzipSync(fs.readFileSync(f),{level:9}).toString('base64')};
    const high=path.join(root,'assets/rocket/models',id+'.glb');
    if(fs.existsSync(high))ASSETS.spaceModels[id].lod0=gzipSync(fs.readFileSync(high),{level:9}).toString('base64');
  }
}
const bench=path.join(root,'assets/build/buildings/workbench.glb');
if(fs.existsSync(bench)){const gzip=gzipSync(fs.readFileSync(bench),{level:9}).toString('base64');ASSETS.spaceModels.workbench={gzip,lod0:gzip};}
const rocketArt=path.join(root,'assets/build/rocket');
ASSETS.spaceTextures={};ASSETS.spaceSmoke=[];
if(fs.existsSync(rocketArt)){
 for(const f of fs.readdirSync(rocketArt)){
  if(f.startsWith('tex-')&&f.endsWith('.webp'))ASSETS.spaceTextures[f.slice(0,-5)]=dataUrl('assets/build/rocket/'+f,'image/webp');
  if(/^fx-exhaust-\d.webp$/.test(f))ASSETS.spaceSmoke.push(dataUrl('assets/build/rocket/'+f,'image/webp'));
 }
 const iconMap=path.join(rocketArt,'icons.json');if(fs.existsSync(iconMap)){const m=JSON.parse(fs.readFileSync(iconMap,'utf8'));ASSETS.spaceIcons={src:dataUrl('assets/build/rocket/icons.webp','image/webp'),cols:m.cols,rows:m.rows,pos:m.items};}
}
const parts = {
  '/*GFX*/': `const packed='${gzipSync(Buffer.from(gfxCode),{level:9}).toString('base64')}';
const bytes=Uint8Array.from(atob(packed),c=>c.charCodeAt(0));
const source=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
try{await import(url);}catch(error){console.warn('3Dの読込みに失敗しました。2D表示へ切り替えます。',error);}finally{URL.revokeObjectURL(url);}`,
  '/*ASSETS*/': `var ASSETS={};var ASSETS_READY=(async()=>{const b=Uint8Array.from(atob('${gzipSync(Buffer.from(JSON.stringify(ASSETS)),{level:9}).toString('base64')}'),c=>c.charCodeAt(0));Object.assign(ASSETS,JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text()));})();`,
  '/*DATA*/': rd('src/game/data.js')+'\n'+rd('src/game/space-data.js')+'\n'+rd('src/game/space-science.js'),
  '/*ENGINE*/': rd('src/game/engine.js')+'\n'+rd('src/game/space.js'),
  '/*TERRAIN*/': terrainCode,
  '/*NATURE*/': rd('src/game/nature.js'),
  '/*UI*/': 'ASSETS_READY.then(()=>{'+rd('src/game/ui.js').replace('/*SPACE_UI*/',()=>rd('src/game/space-ui.js'))+'}).catch(error=>{console.error(error);document.getElementById("app").textContent="ゲームデータの読込みに失敗しました。再読み込みしてください。";});',
};
let html = rd('src/template.html');
for (const [key, code] of Object.entries(parts)) {
  if (/<\/script/i.test(code)) throw new Error(`${key} に </script が含まれています`);
  if (!html.includes(key)) throw new Error(`テンプレートに ${key} がありません`);
  html = html.replace(key, () => code);
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
console.log(`dist/index.html を作成しました（${mb} MB）`);
if (Buffer.byteLength(html) > 16 * 1024 * 1024) console.warn('警告：16MBを超えています（claude.ai のアーティファクトには公開できません）');
// 検証モード（全解放）を最初から有効にした版。中身は同じで、既定のモードだけが違う（?verify=0 や画面の「終了」で通常に戻れる）
const vhtml = html.replace('<head>', '<head><script>window.VERIFY_DEFAULT=true;</script>');
if (vhtml === html) throw new Error('テンプレートに <head> がありません');
fs.writeFileSync(path.join(root, 'dist/verify.html'), vhtml);
console.log('dist/verify.html（検証モードが最初から有効）を作成しました');
