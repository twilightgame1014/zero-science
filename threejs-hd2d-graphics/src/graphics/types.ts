/**
 * Public types for the HD-2D graphics module.
 *
 * Data ownership rule: every value described here is OWNED by the game
 * logic (Claude's side). The graphics module only receives snapshots of
 * that state and renders them. It never writes back into game state.
 */

/** A position as handed over by the game logic. `y` is optional: when it
 *  is omitted the renderer grounds the object on the terrain surface. */
export interface Vec3Like {
  x: number;
  y?: number;
  z: number;
}

export type Direction = 'down' | 'left' | 'right' | 'up';

/** Visual state of the player character, supplied by the game logic. */
export interface PlayerVisualState {
  position: Vec3Like;
  direction: Direction;
  /** true while the character is moving (walk cycle), false = idle. */
  moving: boolean;
  /** Optional action hint used only for visual flourishes (e.g. 'gather'). */
  action?: string;
}

/** World-level visual state. Purely cosmetic: time of day, weather mood. */
export interface WorldVisualState {
  /** 0..1, 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight. */
  timeOfDay?: number;
  weather?: 'clear' | 'cloudy' | 'rain' | 'fog';
  /** Show drifting pollen / dust motes. Default true. */
  ambientParticles?: boolean;
}

/** A harvestable / interactive resource node, rendered from logic state. */
export interface ResourceVisualState {
  position: Vec3Like;
  /** 'tree' | 'rock' | 'herb' | 'flowers' | 'clay' | 'mushroom' | custom */
  type: string;
  rotationY?: number;
  scale?: number;
  /** When true the node renders in its depleted form (stump, rubble...). */
  depleted?: boolean;
  /** When false the node is not rendered at all. */
  visible?: boolean;
  /** Gentle attention pulse (e.g. currently targeted by the player). */
  highlighted?: boolean;
}

/** Building / facility types the structure renderer knows out of the box.
 *  Any other string falls back to a simple marker until a factory is
 *  registered with StructureRenderer.registerFactory(). */
export type StructureType =
  | 'workbench'
  | 'campfire'
  | 'kiln'
  | 'smelter'
  | 'hut'
  | 'stone-house'
  | 'laboratory'
  | 'factory'
  | 'power-plant'
  | 'research-institute'
  | (string & {});

export type EffectType =
  | 'sparkle'
  | 'discovery'
  | 'splash'
  | 'leaves'
  | 'smoke'
  | 'levelup'
  | (string & {});

export type QualityTier = 'high' | 'low';

export interface GraphicsOptions {
  /** Rendering quality. 'auto' picks from device hints. Default 'auto'. */
  quality?: QualityTier | 'auto';
  /** HD-2D post chain (bloom + tilt-shift + colour grade). Default:
   *  enabled when quality resolves to 'high', disabled on 'low'. */
  postEffects?: boolean;
  /** URL of the 4x4 player sprite sheet (rows: down, left, right, up).
   *  When omitted, a built-in placeholder character is generated. */
  playerSpriteUrl?: string;
  /** Optional detail textures (tileable). Procedural fallbacks are used
   *  when omitted. */
  grassDetailUrl?: string;
  rockDetailUrl?: string;
  particleTextureUrl?: string;
  shadowTextureUrl?: string;
  /** Overrides for world/camera tuning. See config.ts for defaults. */
  config?: Partial<GraphicsConfig>;
  /** Called when the WebGL context is lost / restored. */
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface GraphicsConfig {
  world: {
    /** World is a square of size x size scene units, centred on origin. */
    size: number;
    terrainSegments: number;
    waterLevel: number;
    /** Flat, buildable meadow plateau (rendering only flattens terrain;
     *  build permission logic belongs to the game logic). */
    plateauCenter: { x: number; z: number };
    plateauRadius: number;
    seed: number;
  };
  coordinates: {
    /** scene = (logic - origin) * scale. Adjust at integration time so
     *  the module matches the game logic's coordinate contract. */
    scale: number;
    origin: { x: number; y: number; z: number };
  };
  camera: {
    /** Vertical world-units visible on a landscape screen. */
    viewSize: number;
    pitchDegrees: number;
    yawDegrees: number;
    /** Higher = snappier follow. Frame-rate independent damping rate. */
    followDamping: number;
    /** Fraction of the visible height by which the view centre is
     *  shifted up along the camera's screen-up direction, so the player
     *  sits slightly below screen centre (feet around 55–62% of the
     *  frame height). 0 keeps the player dead centre. Default 0.09. */
    anchorOffset?: number;
  };
  character: {
    width: number;
    height: number;
    walkFps: number;
    idleFps: number;
  };
}
