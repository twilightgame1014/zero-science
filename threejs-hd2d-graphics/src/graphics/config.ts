import type { GraphicsConfig } from './types';
import { DEFAULT_AREAS } from './utils';

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
    // Shared 7-area layout (world expansion, 2026-11-07; spec §1.1).
    // Single source in utils.ts (DEFAULT_AREAS) so the pure terrain
    // functions and this config can never drift apart.
    areas: DEFAULT_AREAS,
  },
  coordinates: {
    scale: 1,
    origin: { x: 0, y: 0, z: 0 },
  },
  camera: {
    // Exploration camera (2026-11-06 spec): low HD-2D angle and a much
    // closer framing than the original map-like view (was 26 / 50°).
    // viewSize 13 puts the visible character height at ~10% of the
    // landscape frame (sprite content is 78.1% of the 1.7-unit quad).
    viewSize: 13,
    pitchDegrees: 32,
    yawDegrees: 45,
    followDamping: 5.5,
    anchorOffset: 0.09,
  },
  character: {
    width: 1.7,
    height: 1.7,
    walkFps: 9,
    walkStride: 0.35,
    idleFps: 2,
  },
  water: {
    // Calm, desaturated palette matched to the HD-2D world: no bright
    // cyan, no full-surface white sheen (2026-11-06 water pass).
    shallowColor: 0x8fd2c6,
    deepColor: 0x2f7d99,
    shallowAlpha: 0.16,
    deepAlpha: 0.9,
    deepDepth: 1.15,
    rippleScale: 0.95,
    rippleSpeed: 0.55,
    rippleScale2: 0.62,
    rippleSpeed2: 0.95,
    rippleStrength: 0.1,
    foamDepth: 0.17,
    foamStrength: 0.8,
    glintStrength: 0.3,
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
    water: { ...DEFAULT_CONFIG.water, ...(override.water ?? {}) },
  };
}
