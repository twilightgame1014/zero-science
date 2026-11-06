// ゲームのロジック（自然物の生成・当たり判定）から描画モジュールと同じ地形関数を使うための入口。
// three に依存しない純粋な関数だけをまとめ、3D が読めない環境（2D表示）でも使えるようにする。
// src/graphics 本体は改変しない。
export { terrainHeight, distanceToRiver, riverCenterX } from './graphics/utils';
export { DEFAULT_CONFIG } from './graphics/config';
