// ゲームのロジック（自然物の生成・当たり判定・水・歩ける範囲）から、描画と同じ地形関数を使うための入口。
// three に依存しない純粋な関数だけをまとめ、3D が読めない環境（2D表示）でも使えるようにする。
// 地形の高さは src/world/shape.ts の worldHeight（Muse の7エリアの地形＋ゲームの山・滝・川・道）。旧世界の中は元の値のまま。
// エリアの配置の正は描画モジュールの DEFAULT_AREAS（Muse の依頼：areaWeights・areaDefinitions を再輸出）。
// src/graphics 本体は改変しない。
export { distanceToRiver, riverCenterX, areaWeights, areaDefinitions, DEFAULT_AREAS } from './graphics/utils';
export { worldHeight as terrainHeight, waterAt, placeName, biome, streamAt, outerWeight, areasAt, dominantArea, mountainAt,
  WORLD_VERSION, WALK, WALK_SLOPE, WADE_DEPTH, SEA_LEVEL, OLD_HALF, DRAW_HALF, LAKE, TARN, FALL, LOOKOUT, PEAK, TRAILS, UPSTREAM, DOWNSTREAM,
  FROZEN_POND, LAVA_LAKE, DOWN_SEA_S } from './world/shape';
export { DEFAULT_CONFIG } from './graphics/config';
