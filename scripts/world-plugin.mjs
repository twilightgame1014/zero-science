// esbuild プラグイン：描画モジュール（src/graphics）の中の `./utils` の読み込みだけを、
// 広い世界の地形を返す src/world/terrain-shim.ts に向ける。src/graphics のファイルは変更しない。
import path from 'node:path';
export function worldTerrainPlugin(root) {
  const gfxDir = path.join(root, 'src/graphics') + path.sep;
  const shim = path.join(root, 'src/world/terrain-shim.ts');
  return {
    name: 'world-terrain',
    setup(b) {
      b.onResolve({ filter: /^\.\/utils(\.ts)?$/ }, (args) => {
        if (args.importer.startsWith(gfxDir)) return { path: shim };
        return undefined;
      });
    },
  };
}
