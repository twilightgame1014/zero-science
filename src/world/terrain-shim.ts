// 描画モジュール（src/graphics）の `./utils` の代わりにビルドで差し込む（scripts/world-plugin.mjs）。
// 中身はモジュールの utils そのまま。地形の高さ terrainHeight だけを、広い世界の正本（src/world/shape.ts）に置き換える。
// 旧世界（|x|,|z| ≤ 60）の高さはモジュールの元の関数と同じなので、旧世界の見た目・配置は変わらない。
// src/graphics のファイルは一切変更しない（Muse の第18ラウンドの地形が届いたら、この差し替えを外して統合する）。
export * from '../graphics/utils';
export { worldHeight as terrainHeight } from './shape';
