import type { GraphicsConfig } from './types';

/**
 * Default tuning for the graphics module. Everything that might need to
 * be reconciled with the game logic (scale, origin, world size) lives
 * here so integration never requires hunting through renderer code.
 */
export const DEFAULT_CONFIG: GraphicsConfig = {
  world: {
    size: 120,
    terrainSegments: 168,
    waterLevel: 0.32,
    plateauCenter: { x: -20, z: 20 },
    plateauRadius: 15,
    seed: 1337,
  },
  coordinates: {
    scale: 1,
    origin: { x: 0, y: 0, z: 0 },
  },
  camera: {
    // Exploration camera (2026-11-06 spec): low HD-2D angle and a much
    // closer framing than the original map-like view (was 26 / 50°).
    viewSize: 16,
    pitchDegrees: 32,
    yawDegrees: 45,
    followDamping: 5.5,
    anchorOffset: 0.09,
  },
  character: {
    width: 1.7,
    height: 1.7,
    walkFps: 9,
    idleFps: 2,
  },
};

export function resolveConfig(
  override?: Partial<GraphicsConfig>,
): GraphicsConfig {
  if (!override) return structuredClone(DEFAULT_CONFIG);
  return {
    world: { ...DEFAULT_CONFIG.world, ...(override.world ?? {}) },
    coordinates: {
      ...DEFAULT_CONFIG.coordinates,
      ...(override.coordinates ?? {}),
    },
    camera: { ...DEFAULT_CONFIG.camera, ...(override.camera ?? {}) },
    character: { ...DEFAULT_CONFIG.character, ...(override.character ?? {}) },
  };
}
