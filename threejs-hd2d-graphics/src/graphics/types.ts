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
  /**
   * Natural-object metadata (2026-11-06, NATURAL-OBJECTS-CONTRACT).
   * Owned and decided by the game; the renderer only reads `variant`
   * for appearance ('flint' pebbles read darker, 'basalt' rocks are
   * black rocks). Everything else is ignored by the renderer.
   */
  natural?: {
    kind?: string;
    variant?: string | null;
    state?: string;
  };
  /**
   * Interaction phase (2026-11-06). 'reacting' while the player is
   * actively harvesting this node: trees shake, rocks jolt and flash,
   * herbs sway — purely cosmetic, driven by the game sending the
   * phase; the graphics side never starts or ends a harvest.
   * Default 'idle'.
   */
  phase?: 'idle' | 'reacting';
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
  | 'waterwheel'
  | 'steam-engine'
  | 'distillation-tower'
  | 'drilling-rig'
  | 'bridge'
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

/** HUD safe-area insets in CSS pixels, relative to the canvas. */
export interface ViewportInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Result of pickGround(): the visible surface under a canvas point. */
export interface GroundPick {
  x: number;
  y: number;
  z: number;
  /** 'water' when the ray meets the river surface before terrain. */
  surface: 'terrain' | 'water';
}

/**
 * Which built-in decoration families the renderer scatters on its own.
 * Families the game manages as gatherable natural objects (handed over
 * with updateResourceVisual) should be turned off here so the same
 * tree or rock is never drawn twice — once as scenery, once as a node.
 * Fine detail (grass blades, ferns, fallen leaves, ground decals) is
 * not affected. All default to true (2026-11-06, requested by Claude).
 */
export interface DecorOptions {
  trees?: boolean;
  rocks?: boolean;
  logs?: boolean;
  pebbles?: boolean;
  shrubs?: boolean;
  /**
   * Stone stairs and cobble retaining walls along the path
   * (EnvironmentRenderer.buildStonework). Default true. Set false
   * when the game does not want the path structures rendered —
   * e.g. while its own placement / collision design does not
   * account for them yet.
   */
  stonework?: boolean;
  /**
   * Circular areas kept free of ALL scenery (trees, rocks, shrubs,
   * grass tufts, flowers, herb patches, logs, riverbank pebbles) so
   * game-owned natural objects can stand there alone — e.g. the
   * sample plot where placement / collision / harvest wiring is
   * verified, or a spawn clearing. World units, centre + radius.
   */
  clearings?: Array<{ x: number; z: number; r: number }>;
}

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
  /** HUD safe-area insets (CSS px) known at startup. Can be updated
   *  at runtime with setViewportInsets(). */
  viewportInsets?: ViewportInsets;
  /** Built-in decoration families to draw (see DecorOptions). */
  decor?: DecorOptions;
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
    /** @deprecated No longer used for frame selection: a stopped
     *  character freezes on the standing frame instead of cycling
     *  walk frames slowly (2026-11-06). Kept for config compat. */
    idleFps: number;
  };
  /** River water appearance (2026-11-06 water pass). The water is
   *  layered: a visible pebble/sand riverbed under a depth-graded
   *  surface with dot-dash ripples and a broken foam edge. All values
   *  are tunable through GraphicsOptions.config without code changes. */
  water: {
    /** Colour of very shallow water over the visible riverbed. */
    shallowColor: number;
    /** Colour of the deepest part of the channel. */
    deepColor: number;
    /** Opacity over the shallows / at full depth. */
    shallowAlpha: number;
    deepAlpha: number;
    /** Water depth (world units) at which the full deep colour lands. */
    deepDepth: number;
    /** Ripple dash layers: cell width (world units) and flow speed. */
    rippleScale: number;
    rippleSpeed: number;
    rippleScale2: number;
    rippleSpeed2: number;
    /** Brightness the ripple dashes add (kept subtle). */
    rippleStrength: number;
    /** Water shallower than this grows the broken foam edge. */
    foamDepth: number;
    foamStrength: number;
    /** Sun glint intensity, 0 disables. Low quality scales it down. */
    glintStrength: number;
  };
}
