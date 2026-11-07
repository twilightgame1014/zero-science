// ゲームのロジック（自然物の生成・当たり判定・水・歩ける範囲）から、描画と同じ地形関数を使うための入口。
// three に依存しない純粋な関数だけをまとめ、3D が読めない環境（2D表示）でも使えるようにする。
// 地形の高さは広い世界の正本（src/world/shape.ts）。旧世界の中は描画モジュールの terrainHeight と同じ値。
// src/graphics 本体は改変しない。
export { distanceToRiver, riverCenterX } from './graphics/utils';
export { worldHeight as terrainHeight, waterAt, seaDist, placeName, biome, streamAt, outerWeight,
  WORLD_VERSION, WALK, WALK_SLOPE, WADE_DEPTH, SEA_LEVEL, OLD_HALF, DRAW_HALF, LAKE, TARN, FALL, LOOKOUT, PEAK, TRAILS, UPSTREAM, DOWNSTREAM } from './world/shape';
export { DEFAULT_CONFIG } from './graphics/config';
