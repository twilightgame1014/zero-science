export { GraphicsEngine, initializeGraphics } from './GraphicsEngine';
export { WorldRenderer } from './WorldRenderer';
export { TerrainRenderer } from './TerrainRenderer';
export { EnvironmentRenderer } from './EnvironmentRenderer';
export { CharacterRenderer } from './CharacterRenderer';
export { StructureRenderer } from './StructureRenderer';
export type { StructureFactory } from './StructureRenderer';
export { ResourceRenderer, RESOURCE_VISUAL_SPECS, RESOURCE_VARIANT_SPECS } from './ResourceRenderer';
export type { ResourceVisualSpec } from './ResourceRenderer';
export { CameraController } from './CameraController';
export { LightingManager } from './LightingManager';
export { EffectsManager } from './EffectsManager';
export { PostEffects } from './PostEffects';
export { AssetManager } from './AssetManager';
export { DEFAULT_CONFIG, resolveConfig } from './config';
export {
  terrainHeight, riverCenterX, distanceToRiver,
  areaWeights, areaDefinitions, areaRaw, DEFAULT_AREAS,
} from './utils';
export type {
  AreaDefinition,
  AreaId,
  CameraView,
  CameraViewOptions,
  DecorOptions,
  Direction,
  EffectType,
  EnvironmentState,
  GraphicsConfig,
  GraphicsOptions,
  NpcVisualState,
  PlayerVisualState,
  QualityTier,
  ResourceVisualState,
  StructurePreviewState,
  StructureType,
  Vec3Like,
  WorldVisualState,
} from './types';
