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

const dataUrl = (p, mime) => `data:${mime};base64,${fs.readFileSync(path.join(root, p)).toString('base64')}`;
const ASSETS = {
  boy: dataUrl('assets/characters/boy.webp', 'image/webp'),
  girl: dataUrl('assets/characters/girl.webp', 'image/webp'),
  lab1: dataUrl('assets/lab/lab1.webp', 'image/webp'),
  lab2: dataUrl('assets/lab/lab2.webp', 'image/webp'),
  lab3: dataUrl('assets/lab/lab3.webp', 'image/webp'),
  lab4: dataUrl('assets/lab/lab4.webp', 'image/webp'),
  grass: dataUrl('assets/textures/grass-detail.png', 'image/png'),
  rock: dataUrl('assets/textures/rock-detail.png', 'image/png'),
  particle: dataUrl('assets/textures/particle-dot.png', 'image/png'),
  shadow: dataUrl('assets/textures/shadow-blob.png', 'image/png'),
};

const parts = {
  '/*GFX*/': gfxCode,
  '/*ASSETS*/': 'var ASSETS=' + JSON.stringify(ASSETS) + ';',
  '/*DATA*/': rd('src/game/data.js'),
  '/*ENGINE*/': rd('src/game/engine.js'),
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
