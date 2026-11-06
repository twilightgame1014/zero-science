// 1ファイル版のゲーム（dist/index.html）を作る。
// - src/graphics（HD-2D描画モジュール）を esbuild でまとめる。three は CDN からインポートマップで読む。
// - assets/ の画像を data URL にして埋め込む（公開先で外部画像を読まなくて済むように）。
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const gfx = await build({
  entryPoints: [path.join(root, 'src/graphics-entry.ts')],
  bundle: true, format: 'esm', target: 'es2020', write: false,
  external: ['three', 'three/addons/*'], logLevel: 'warning',
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
  boy: dataUrl('assets/characters/boy.webp', 'image/webp'),
  girl: dataUrl('assets/characters/girl.webp', 'image/webp'),
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
const parts = {
  '/*GFX*/': gfxCode,
  '/*ASSETS*/': 'var ASSETS=' + JSON.stringify(ASSETS) + ';',
  '/*DATA*/': rd('src/game/data.js'),
  '/*ENGINE*/': rd('src/game/engine.js'),
  '/*TERRAIN*/': terrainCode,
  '/*NATURE*/': rd('src/game/nature.js'),
  '/*UI*/': rd('src/game/ui.js'),
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
