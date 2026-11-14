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

/**
 * Facing direction the game reports. The four cardinals are the
 * original contract; the four diagonals (round 23, 8-direction
 * sheets) are honoured when the character's sheet has 8 rows —
 * with a 4-row sheet a diagonal snaps to the nearest cardinal
 * row, so existing games and NPC sheets keep working unchanged.
 */
export type Direction =
  | 'down' | 'left' | 'right' | 'up'
  | 'down-right' | 'down-left' | 'up-right' | 'up-left';

/** Visual state of the player character, supplied by the game logic. */
export interface PlayerVisualState {
  position: Vec3Like;
  direction: Direction;
  /** true while the character is moving (walk cycle), false = idle. */
  moving: boolean;
  /** Optional action hint used only for visual flourishes (e.g. 'gather'). */
  action?: string;
  /**
   * Continuous world facing (radians, atan2(x, z), 0 = +Z;
   * round 25, Claude §22.1). On an 8-row sheet this takes
   * precedence over `direction` for row selection; `direction`
   * stays as the discrete fallback and for 4-row sheets.
   */
  facing?: number;
  /**
   * Actual movement speed in units/sec, smoothed (round 25,
   * Claude §22.2). When present, the walk cycle advances by
   * distance travelled (4 frames per 1.4 units) instead of by
   * elapsed time, so the feet match the ground at any speed.
   */
  speed?: number;
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
   * The module's set-piece waterfall at the legacy highland
   * (Claude §18-1, round 22). Default true. Set false when the
   * game builds its own falls from its terrain (the wide world)
   * — placement of new falls uses createWaterfallKit.
   */
  waterfall?: boolean;
  /**
   * The backdrop mountain ring (Claude §18-1, round 22).
   * Default true. Set false when the game's own terrain forms
   * the horizon (the wide world), so no ring stands inside it.
   */
  backdrop?: boolean;
  /**
   * The legacy river surface + riverbed ribbons, which span
   * only the built-in terrain (Claude §18-4, round 22).
   * Default true. Set false when the game draws the river
   * continuation itself across its wider world.
   */
  river?: boolean;
  /**
   * The module's open-water plane (one 760 m sheet at the
   * module water level, depth-graded). Default true. Set
   * false when the host world draws its own sea / lakes and
   * has dry inland lowlands below the module water level —
   * e.g. Claude's wide world (round 22 finding): there the
   * plane would flood land the game treats as dry.
   */
  openWater?: boolean;
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

/** The seven world areas (world expansion, 2026-11-07). The layout
 *  is SHARED DATA: the game passes the same definitions through
 *  GraphicsOptions.config and reads the same placement back through
 *  areaWeights() (utils.ts, re-exported by the game's terrain entry),
 *  so placement, gathering, sound and rendering can never disagree
 *  about which area a point belongs to. */
export type AreaId =
  | 'forest' | 'lakeside' | 'coast' | 'volcano' | 'snow' | 'desert' | 'town';

export interface AreaDefinition {
  id: AreaId;
  /** Centre of the area in scene coordinates. */
  x: number;
  z: number;
  /** Falloff radius: full strength inside ~0.55 r, zero at r. */
  radius: number;
}

/** Runtime camera view (spec §2): yaw is free over 360°, pitch is
 *  clamped to 0–72° (round 24, Claude §21-1: near-level views for
 *  the drag camera), viewSize is the orthographic zoom (visible
 *  world height in metres, clamped 4–60). `distance` is the
 *  camera-to-focus distance in metres (clamped 10–260, default
 *  90; round 24, Claude §21-2): with an orthographic projection
 *  it does not change magnification — it moves the camera body
 *  along the view axis so it can be kept out of terrain and
 *  buildings. */
export interface CameraView {
  yawDegrees?: number;
  pitchDegrees?: number;
  viewSize?: number;
  distance?: number;
}

export interface CameraViewOptions {
  /** Seconds to animate from the current view to the new one. */
  transition?: number;
  /** A temporary (cutscene-style) change: the view in effect before
   *  the first temporary call is remembered and restored by
   *  restoreCameraView() / setCameraView(null). A later call without
   *  `temporary` makes its view the new base view. */
  temporary?: boolean;
}

/** Visual state of one NPC, supplied by the game logic. Same 4x4
 *  sheet contract as the protagonist (rows down/left/right/up,
 *  columns stand/walk1/passing/walk2). Conversation and movement
 *  logic stay with the game; this is display only. */
export interface NpcVisualState {
  position: Vec3Like;
  direction: Direction;
  moving: boolean;
  /** Continuous world facing, same contract as the player's
   *  (round 25). Optional; NPCs may keep passing `direction`. */
  facing?: number;
  /** Actual movement speed in units/sec, same contract as the
   *  player's (round 25). Optional. */
  speed?: number;
  /** Sprite sheet URL for this NPC. Loaded once per URL; the NPC is
   *  drawn with a placeholder sheet until the texture arrives. */
  spriteUrl?: string;
}

/** Building-placement ghost (spec §4): the candidate model drawn
 *  translucent, tinted green (valid) or red (invalid). Casts no
 *  shadow and is exempt from the occlusion fade. Placement rules
 *  themselves stay with the game logic. */
export interface StructurePreviewState {
  type: StructureType;
  position: Vec3Like;
  rotationY?: number;
  valid: boolean;
}

/** Area environment request (spec §5): the game hands over the area
 *  weights at the player's position (from areaWeights()) and the
 *  module blends lighting, sky, fog and particles accordingly. A
 *  single dominant `area` is accepted as shorthand. */
export interface EnvironmentState {
  weights?: Partial<Record<AreaId, number>>;
  area?: AreaId;
}

export interface GraphicsConfig {
  world: {
    /** World is a square of size x size scene units, centred on origin. */
    size: number;
    terrainSegments: number;
    waterLevel: number;
    /** Shared area layout (see AreaId). Optional: the default layout
     *  from config.ts is used when a host config predates areas. */
    areas?: AreaDefinition[];
    /** Flat, buildable meadow plateau (rendering only flattens terrain;
     *  build permission logic belongs to the game logic). */
    plateauCenter: { x: number; z: number };
    plateauRadius: number;
    seed: number;
    /**
     * Host-supplied ground height (Claude §18-2, round 22). When
     * set, EVERY module height query — terrain chunks, grounding
     * of characters / resources / structures, water depth — uses
     * this function instead of the built-in terrainHeight, so
     * the game can own the world's shape (its wide-world
     * worldHeight) without build-time shims. The built-in
     * terrainHeight stays the default and is unchanged.
     */
    heightAt?: (x: number, z: number) => number;
    /**
     * Host-supplied dry-land mask for the open-water plane
     * (Claude §20.1, round 24). Return true where the broad water
     * surface must NOT appear even though the height function dips
     * below the water level — e.g. dry inland lowlands in a host
     * world that draws its own lakes and sea. The mask is sampled
     * once when the water plane is built (its depth attribute is
     * baked), so changing it takes effect on the next engine
     * build, not per frame. This replaces any game-side rewriting
     * of the plane's depth attribute.
     */
    dryMask?: (x: number, z: number) => boolean;
    /**
     * Host-supplied worn paths (Claude §25.2.1, round 28). Each
     * entry is a polyline the game owns (e.g. the volcano climbing
     * trail from TERRAIN.TRAILS) plus its flat half-width in world
     * units. The terrain painter compacts the ground along the line
     * into packed soil / gravel colour and raises the path splat
     * channel there — appearance only: walkability, routing and
     * the trail's shape stay with the game. Points may be [x, z]
     * or [x, z, h]; the height component is ignored (the height
     * function already flattens the tread). Sampled once per
     * terrain vertex at chunk build, so a changed path applies to
     * chunks built afterwards.
     */
    paths?: Array<{
      points: ReadonlyArray<readonly number[] | { x: number; z: number }>;
      width: number;
    }>;
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
    /**
     * Walk-cycle stride (round 28, Claude §25.3): the phase
     * advances one frame per `walkStride` world units actually
     * travelled, so a full 4-frame cycle covers 4 × walkStride
     * units (default 0.35 → 1.4 units per cycle, the shipped
     * contract). Distance-driven, so changing the game's walk
     * speed alone stretches the cycle in time without any foot
     * slide; change this only together with the sprite sheets'
     * implied step length.
     */
    walkStride?: number;
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

/** Public visibility control for boarding and cutscenes; does not change saved player state. */
export interface PlayerVisibilityControl { setPlayerVisible(visible: boolean): void; }
