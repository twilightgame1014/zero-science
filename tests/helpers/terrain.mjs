// テスト用：描画モジュールと同じ地形関数（src/terrain-entry.ts）を Node で読み込む
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function loadTerrain() {
  const out = await build({ entryPoints: [path.join(root, 'src/terrain-entry.ts')], bundle: true, format: 'cjs', write: false, logLevel: 'warning' });
  const module = { exports: {} };
  new Function('module', 'exports', out.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
