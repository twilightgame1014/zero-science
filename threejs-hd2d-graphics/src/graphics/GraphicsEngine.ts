import * as THREE from 'three';
import type {
  AreaId,
  CameraView,
  CameraViewOptions,
  EffectType,
  EnvironmentState,
  GraphicsConfig,
  GraphicsOptions,
  GroundPick,
  NpcVisualState,
  PlayerVisualState,
  QualityTier,
  ResourceVisualState,
  StructurePreviewState,
  StructureType,
  Vec3Like,
  ViewportInsets,
  WorldVisualState,
} from './types';
import { resolveConfig } from './config';
import { AssetManager } from './AssetManager';
import { LightingManager } from './LightingManager';
import { CameraController } from './CameraController';
import { WorldRenderer } from './WorldRenderer';
import { CharacterRenderer } from './CharacterRenderer';
import { StructureRenderer } from './StructureRenderer';
import { ResourceRenderer, RESOURCE_VISUAL_SPECS, RESOURCE_VARIANT_SPECS } from './ResourceRenderer';
import type { ResourceVisualSpec } from './ResourceRenderer';
import { EffectsManager } from './EffectsManager';
import { AreaParticles } from './AreaParticles';
import type { ParticleKind } from './AreaParticles';
import { GPT_TEXTURES } from './gptTextures';
import { BRANCH_TEXTURES } from './branchTextures';
import { ENV_TEXTURES } from './envTextures';
import { EXPANSION_TEXTURES, GROUND_TEXTURES, LAVA_TEXTURES } from './expansionTextures';
import { DQ3_TEXTURES } from './dq3Textures';
import { PostEffects } from './PostEffects';
import { toScenePosition } from './utils';

/**
 * The single entry point the game integrates with.
 *
 * Ownership contract (strict):
 *  - Game state (player position, inventory, resources, structures,
 *    progress) is owned by the game logic.
 *  - This engine only *renders* snapshots of that state handed in
 *    through the methods below. It never mutates logic state, never
 *    decides collisions, gathering, building permission or progress.
 */
export class GraphicsEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private container: HTMLElement;
  private options: GraphicsOptions;
  private cfg: GraphicsConfig;
  private assets: AssetManager;
  private lighting: LightingManager;
  private cameraRig: CameraController;
  private world: WorldRenderer;
  private character: CharacterRenderer;
  private structures: StructureRenderer;
  private resources: ResourceRenderer;
  private effects: EffectsManager;
  private particles: AreaParticles;
  private quality: QualityTier;
  private postWanted: boolean;
  private post: PostEffects | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private cameraOverride: { x: number; z: number; y?: number } | null = null;
  private disposed = false;
  private onContextLostBound: (e: Event) => void;
  private onContextRestoredBound: () => void;

  private constructor(
    container: HTMLElement,
    options: GraphicsOptions,
    parts: {
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      assets: AssetManager;
      lighting: LightingManager;
      cameraRig: CameraController;
      world: WorldRenderer;
      character: CharacterRenderer;
      structures: StructureRenderer;
      resources: ResourceRenderer;
      effects: EffectsManager;
      particles: AreaParticles;
      quality: QualityTier;
      cfg: GraphicsConfig;
    },
  ) {
    this.container = container;
    this.options = options;
    this.cfg = parts.cfg;
    this.renderer = parts.renderer;
    this.scene = parts.scene;
    this.assets = parts.assets;
    this.lighting = parts.lighting;
    this.cameraRig = parts.cameraRig;
    this.world = parts.world;
    this.character = parts.character;
    this.structures = parts.structures;
    this.resources = parts.resources;
    this.effects = parts.effects;
    this.particles = parts.particles;
    this.quality = parts.quality;
    this.postWanted = options.postEffects ?? parts.quality === 'high';
    if (options.viewportInsets) {
      this.cameraRig.setViewportInsets(
        options.viewportInsets.top ?? 0,
        options.viewportInsets.bottom ?? 0,
      );
    }

    this.onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.stopLoop();
      this.options.onContextLost?.();
    };
    this.onContextRestoredBound = () => {
      this.options.onContextRestored?.();
      this.startLoop();
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', this.onContextLostBound);
    canvas.addEventListener('webglcontextrestored', this.onContextRestoredBound);

    const postEnabled =
      options.postEffects ?? true; // create() already gated by quality
    if (postEnabled) {
      this.post = new PostEffects(this.renderer, this.scene, this.cameraRig.camera);
      this.post.setPixelRatio(this.renderer.getPixelRatio());
    }

    container.appendChild(canvas);
    this.resizeGraphics(container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.resizeGraphics(this.container.clientWidth, this.container.clientHeight);
      }
    });
    this.resizeObserver.observe(container);

    // Sensible default: player stands on the buildable plateau.
    const p = this.cfg.world.plateauCenter;
    this.character.setState({
      position: { x: p.x, z: p.z },
      direction: 'down',
      moving: false,
    });
    this.cameraRig.setTarget(p.x, p.z, this.world.getGroundHeight(p.x, p.z));
    this.cameraRig.snapToTarget();
    this.startLoop();
  }

  /** Async factory: loads the sprite sheet / detail textures first. */
  static async create(
    container: HTMLElement,
    options: GraphicsOptions = {},
  ): Promise<GraphicsEngine> {
    const cfg = resolveConfig(options.config);
    const quality: QualityTier =
      options.quality && options.quality !== 'auto'
        ? options.quality
        : detectQuality();

    const assets = new AssetManager();
    const loadOr = async (
      url: string | undefined,
      fallback: () => THREE.Texture,
      repeat = false,
    ): Promise<THREE.Texture> => {
      if (!url) return fallback();
      try {
        return await assets.loadTexture(url, { repeat });
      } catch {
        return fallback();
      }
    };

    const spriteTexture = await loadOr(options.playerSpriteUrl, () =>
      assets.createPlaceholderSpriteSheet(),
    );
    const terrainDetail = await loadOr(
      options.grassDetailUrl,
      () =>
        assets.createNoiseTexture('#8fae62', ['#7ba24f', '#a5c274', '#6d9448']),
      true,
    );
    const particleTexture = await loadOr(options.particleTextureUrl, () =>
      assets.createRadialTexture('rgba(255,255,255,1)'),
    );
    const shadowTexture = await loadOr(options.shadowTextureUrl, () =>
      assets.createRadialTexture('rgba(0,0,0,0.85)'),
    );
    void options.rockDetailUrl; // reserved: rocks currently use flat shading

    // GPT-generated nature assets (bundled as data URIs; see
    // assets/gpt-nature/). Any that fail to decode are simply absent
    // from the record and renderers fall back to procedural textures.
    const GPT_TILING = new Set([
      'ground_grass_base', 'ground_dirt', 'ground_leaves', 'ground_gravel',
      'bark_deep', 'bark_birch', 'bark_moss',
      'rock_layered', 'rock_moss', 'rock_slate',
    ]);
    const gpt: Record<string, THREE.Texture> = {};
    await Promise.all(
      Object.entries(GPT_TEXTURES).map(async ([key, uri]) => {
        try {
          gpt[key] = await assets.loadTexture(uri, { repeat: GPT_TILING.has(key) });
        } catch {
          /* procedural fallback */
        }
      }),
    );
    // Branch/leaf spray sprites for the card-built tree canopies
    // (assets/branch-cards/). Same failure contract as the GPT set.
    const branch: Record<string, THREE.Texture> = {};
    await Promise.all(
      Object.entries(BRANCH_TEXTURES).map(async ([key, uri]) => {
        try {
          branch[key] = await assets.loadTexture(uri);
        } catch {
          /* procedural fallback */
        }
      }),
    );
    // World-expansion sheets (assets/gpt-expansion/): conifer / snow /
    // shore sprays for the resource renderer, tiling ground textures
    // for the terrain splat, and the lava albedo + emissive pair.
    // Same failure contract: a failed decode just loses that asset.
    const expansion: Record<string, THREE.Texture> = {};
    await Promise.all(
      Object.entries(EXPANSION_TEXTURES).map(async ([key, uri]) => {
        try {
          expansion[key] = await assets.loadTexture(uri);
        } catch {
          /* fallback art */
        }
      }),
    );
    const groundTex: Record<string, THREE.Texture> = {};
    await Promise.all(
      Object.entries(GROUND_TEXTURES).map(async ([key, uri]) => {
        try {
          groundTex[key] = await assets.loadTexture(uri, { repeat: true });
        } catch {
          /* terrain keeps vertex colours only */
        }
      }),
    );
    await Promise.all(
      Object.entries(LAVA_TEXTURES).map(async ([key, uri]) => {
        try {
          expansion[`lava_${key}`] = await assets.loadTexture(uri, { repeat: true });
        } catch {
          /* lava node falls back to plain dark disc */
        }
      }),
    );
    // DQ3 density set (assets/gpt-dq3/): broadleaf role sprays for
    // node canopies, the lava-flow pair, town ground tiles for the
    // terrain splat. Same failure contract as the other sets.
    const dq3: Record<string, THREE.Texture> = {};
    await Promise.all(
      Object.entries(DQ3_TEXTURES).map(async ([key, uri]) => {
        try {
          dq3[key] = await assets.loadTexture(uri, { repeat: true });
        } catch {
          /* fallback art */
        }
      }),
    );
    const env: Record<string, THREE.Texture> = {};
    await Promise.all(
      Object.entries(ENV_TEXTURES).map(async ([key, uri]) => {
        try {
          env[key] = await assets.loadTexture(uri, {
            repeat: key === 'streaks' || key === 'groundScree' || key === 'shoreFoam',
          });
        } catch {
          /* kit falls back to procedural art */
        }
      }),
    );
    if (env['groundScree']) groundTex['scree'] = env['groundScree'];
    if (dq3['town-cobble']) groundTex['cobble'] = dq3['town-cobble'];
    if (dq3['town-dirt-plain']) groundTex['dirtPlain'] = dq3['town-dirt-plain'];

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      throw new Error(
        `WebGL is unavailable in this browser: ${(err as Error).message}`,
      );
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.3),
    );

    const scene = new THREE.Scene();
    const lighting = new LightingManager(scene, quality);
    const cameraRig = new CameraController(cfg.camera);
    const world = new WorldRenderer(cfg, quality, assets, {
      terrainDetail: gpt.ground_grass_base ?? terrainDetail,
      // The GPT grass tile is much darker than the old noise detail;
      // compensate so overall ground luminance stays where it was.
      detailBrightness: gpt.ground_grass_base ? 1.5 : 1,
      particle: particleTexture,
      gpt,
      branch,
      ground: groundTex,
      lava: { albedo: dq3['lava-flow'] ?? expansion['lava_albedo'], emissive: dq3['lava-flow-emissive'] ?? expansion['lava_emissive'] },
      decor: options.decor,
      env,
    });
    const groundAt = (x: number, z: number) => world.getGroundHeight(x, z);
    const character = new CharacterRenderer(
      spriteTexture,
      shadowTexture,
      cfg.character,
      groundAt,
    );
    const structures = new StructureRenderer(groundAt);
    const resources = new ResourceRenderer(groundAt, gpt, cfg.camera.yawDegrees, branch, expansion, cfg.world.waterLevel, dq3);
    const effects = new EffectsManager(particleTexture, groundAt);
    const particles = new AreaParticles(particleTexture, quality);
    scene.add(world.group, character.group, structures.group, resources.group, effects.group, particles.points);

    const effectiveOptions: GraphicsOptions = {
      ...options,
      // Post effects default on for high quality, off for low (mobile).
      postEffects: options.postEffects ?? quality === 'high',
    };
    return new GraphicsEngine(container, effectiveOptions, {
      renderer, scene, assets, lighting, cameraRig, world, character,
      structures, resources, effects, particles, quality, cfg,
    });
  }

  /* ---------------- public integration API ---------------- */

  /** Swap the player sprite sheet at runtime (protagonist selection,
   *  costumes). Which character is active remains the logic's state;
   *  this only changes what is drawn. Same 4x4 layout required. */
  async setPlayerSpriteSheet(url: string): Promise<void> {
    const tex = await this.assets.loadTexture(url);
    this.character.setSpriteTexture(tex);
  }

  /**
   * Show or hide the player character only (NPCs unaffected).
   * Round 30 (space integration request 1): the game hides the
   * player while they are inside the capsule, from boarding
   * until return to the ground. Purely visual; the player's
   * state keeps updating as usual while hidden.
   */
  setPlayerVisible(visible: boolean): void {
    this.character.setPlayerVisible(visible);
  }

  /** Hand over the player's current visual state (owned by logic). */
  setPlayerVisualState(state: PlayerVisualState): void {
    const p = toScenePosition(state.position, this.cfg);
    this.character.setState({ ...state, position: { x: p.x, z: p.z } });
  }

  /** Point the camera somewhere, or pass null to resume following the
   *  player. Rendering-only; never alters logic coordinates. */
  setCameraTarget(position: Vec3Like | null): void {
    if (position === null) {
      this.cameraOverride = null;
      return;
    }
    const p = toScenePosition(position, this.cfg);
    // A malformed target must never poison the camera: a NaN
    // centre is unrecoverable through the damped follow.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    // Focus height inlet (round 26, Claude §23): when the caller
    // supplies y, the camera focusses at exactly that height
    // instead of the module's terrain height at (x, z). A game
    // whose world height differs from the module's (summits,
    // bridges, interiors) can pass the height it already knows,
    // so no per-frame cancellation is needed. A non-finite y is
    // ignored rather than poisoning the follow.
    const hasY = typeof position.y === 'number' && Number.isFinite(position.y);
    this.cameraOverride = { x: p.x, z: p.z, ...(hasY ? { y: p.y } : {}) };
  }

  /**
   * Orbit the exploration camera (2026-11-07): yaw is free over
   * 360°, pitch is clamped to 12–72°, viewSize is the orthographic
   * zoom (visible world height in metres, clamped 4–60). All fields
   * optional; omitted ones keep their current values. Defaults stay
   * yaw 45 / pitch 32 / viewSize 13, so existing integrations are
   * unaffected until they call this. Kept as a thin alias of
   * setCameraView (spec §2) — new integrations should use that.
   */
  setCameraOrbit(orbit: { yawDegrees?: number; pitchDegrees?: number; viewSize?: number; distance?: number }): void {
    this.setCameraView(orbit);
  }

  /** Current camera yaw in degrees (0–360). Screen-relative input
   *  mapping on the game side should follow this value. */
  getCameraYawDegrees(): number {
    return this.cameraRig.getYawDegrees();
  }

  /** The view in effect before the first temporary camera change. */
  private savedView: Required<CameraView> | null = null;

  /**
   * Runtime camera control (spec §2): set yaw (360°), pitch (12–72°)
   * and zoom (viewSize 4–60) at any time. Omitted fields keep their
   * values. Options: `transition` animates over that many seconds;
   * `temporary` marks a cutscene-style change — the current view is
   * remembered and restoreCameraView() (or setCameraView(null))
   * returns to it, while a later non-temporary call makes its view
   * the new base. The camera never dips under the terrain: the
   * orthographic rig stays at its fixed height and pitch is clamped.
   */
  setCameraView(view: CameraView | null, opts: CameraViewOptions = {}): void {
    if (view === null) {
      this.restoreCameraView();
      return;
    }
    if (opts.temporary) {
      if (!this.savedView) this.savedView = this.getCameraView();
    } else if (this.savedView && !opts.temporary) {
      // A base-view change while a temporary view is in effect
      // re-bases the restore point to the new view.
      this.savedView = null;
    }
    this.cameraRig.transitionTo(view, opts.transition ?? 0);
  }

  /** The current camera view (base viewSize, before portrait boost). */
  getCameraView(): Required<CameraView> {
    return {
      yawDegrees: this.cameraRig.getYawDegrees(),
      pitchDegrees: this.cameraRig.getPitchDegrees(),
      viewSize: this.cameraRig.getViewSize(),
      distance: this.cameraRig.getDistance(),
    };
  }

  /** Return from a temporary camera view to the remembered base. */
  restoreCameraView(): void {
    if (!this.savedView) return;
    const target = this.savedView;
    this.savedView = null;
    this.cameraRig.transitionTo(target, 0.6);
  }

  /**
   * NPC visuals (spec §3): create/update/remove one NPC. Same 4x4
   * sheet contract and same rendered size as the protagonist;
   * distant NPCs animate at a reduced rate. Conversation and
   * movement decisions stay with the game logic — this only draws
   * the state it is handed. `state.spriteUrl` is loaded once per
   * URL; until it arrives the NPC wears the placeholder sheet.
   */
  setNpcVisualState(id: string, state: NpcVisualState | null): void {
    if (state === null) {
      this.character.setNpc(id, null);
      this.npcWantedUrl.delete(id);
      return;
    }
    const p = toScenePosition(state.position, this.cfg);
    this.character.setNpc(id, { ...state, position: { x: p.x, z: p.z } });
    const url = state.spriteUrl;
    if (url) {
      this.npcWantedUrl.set(id, url);
      const cached = this.npcTextureCache.get(url);
      if (cached) this.character.setNpcSprite(id, cached);
      else this.loadNpcTexture(id, url);
    }
  }

  private npcWantedUrl = new Map<string, string>();
  private npcTextureCache = new Map<string, THREE.Texture>();
  private npcTextureLoading = new Set<string>();

  private loadNpcTexture(id: string, url: string): void {
    if (this.npcTextureLoading.has(url)) return;
    this.npcTextureLoading.add(url);
    this.assets.loadTexture(url)
      .then((tex) => {
        this.npcTextureCache.set(url, tex);
        // Apply to every NPC still asking for this URL.
        for (const [npcId, wanted] of this.npcWantedUrl) {
          if (wanted === url) this.character.setNpcSprite(npcId, tex);
        }
      })
      .catch(() => { /* NPC keeps the placeholder sheet */ })
      .finally(() => this.npcTextureLoading.delete(url));
    void id;
  }

  /**
   * Building-placement ghost (spec §4): the candidate model drawn
   * translucent, green when the game says the spot is valid, red
   * when not. Pass null to hide. Placement rules stay with the game.
   */
  setStructurePreview(state: StructurePreviewState | null): void {
    if (state === null) {
      this.structures.setPreview(null);
      return;
    }
    const p = toScenePosition(state.position, this.cfg);
    this.structures.setPreview({
      type: state.type,
      position: { x: p.x, z: p.z, y: state.position.y },
      rotationY: state.rotationY ?? 0,
      valid: state.valid,
    });
  }

  /**
   * Area environment (spec §5): blend lighting, sky and fog toward
   * the areas the player is in, and switch the ambient particles
   * (snow / ash / sand / spray) by the dominant area. Hand over the
   * weights from areaWeights() at the player's position, or a single
   * dominant `area`. Darkness and fog never hide the ground or the
   * harvest targets near the player.
   */
  setEnvironment(state: EnvironmentState): void {
    const weights: Partial<Record<AreaId, number>> | undefined =
      state.weights ?? (state.area ? { [state.area]: 1 } : undefined);
    if (!weights) return;
    this.lighting.setEnvironmentWeights(weights);
    const kindByArea: Partial<Record<AreaId, ParticleKind>> = {
      snow: 'snow', volcano: 'ash', desert: 'sand', coast: 'spray',
    };
    let best: ParticleKind = 'none';
    let bestW = 0.35;
    for (const [area, kind] of Object.entries(kindByArea) as Array<[AreaId, ParticleKind]>) {
      const w = weights[area] ?? 0;
      if (w > bestW) {
        bestW = w;
        best = kind;
      }
    }
    this.particles.setKind(best);
  }

  /**
   * Runtime quality switch (spec §1.3): terrain chunk radii/detail,
   * pixel ratio, shadow resolution and the post chain follow the
   * tier. The game's settings screen can call this at any time.
   */
  /**
   * Build the terrain around (x, z) immediately at near detail
   * (round 22, Claude §18): call right after a teleport so the
   * destination renders complete on the first frame instead of
   * streaming in. Synchronous — call it during a fade or a
   * loading beat. Radius defaults to 90 m.
   */
  prepareTerrainAt(x: number, z: number, radiusM = 90): void {
    this.world.prepareTerrainAt(x, z, radiusM);
  }

  /**
   * Move the terrain streaming bounds, in chunk indices
   * (round 29, Claude §24.2): chunks stream in inside the new
   * range and are disposed outside it, so a host world wider
   * than the default ±180 field no longer needs the module's
   * private chunk builder. Passing null restores the field from
   * config.world.chunkRange (or the default). The open-water
   * plane and backdrop ring are sized from the config value at
   * engine build and do not resize at runtime.
   */
  setTerrainField(range: { min: number; max: number } | null): void {
    this.world.setTerrainField(range);
  }

  setQuality(tier: QualityTier): void {
    if (tier === this.quality) return;
    this.quality = tier;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, tier === 'high' ? 2 : 1.3),
    );
    const mapSize = tier === 'high' ? 2048 : 1024;
    this.lighting.sun.shadow.mapSize.set(mapSize, mapSize);
    if (this.lighting.sun.shadow.map) {
      this.lighting.sun.shadow.map.dispose();
      this.lighting.sun.shadow.map = null;
    }
    this.world.setQuality(tier);
    if (tier === 'low' && this.post) {
      this.post.dispose();
      this.post = null;
    } else if (tier === 'high' && !this.post && this.postWanted) {
      this.post = new PostEffects(this.renderer, this.scene, this.cameraRig.camera);
      this.post.setPixelRatio(this.renderer.getPixelRatio());
      this.post.setSize(this.container.clientWidth, this.container.clientHeight);
    }
  }

  setWorldVisualState(state: WorldVisualState): void {
    if (state.timeOfDay !== undefined) this.lighting.setTimeOfDay(state.timeOfDay);
    if (state.weather !== undefined) this.lighting.setWeather(state.weather);
    if (state.ambientParticles !== undefined) {
      this.world.setAmbientParticlesVisible(state.ambientParticles);
    }
  }

  /** Positions of all live resource/natural nodes, used to thin the
   *  scenery ground cover around them (see EnvironmentRenderer). */
  private nodePoints = new Map<string, { x: number; z: number; r: number }>();
  private thinningDirty = false;

  /** Create/update/remove a logic-owned resource node's visual. */
  updateResourceVisual(id: string, state: ResourceVisualState | null): void {
    if (state === null || state.visible === false) {
      this.resources.setResource(id, null);
      if (this.nodePoints.delete(id)) this.thinningDirty = true;
      return;
    }
    const p = toScenePosition(state.position, this.cfg);
    this.resources.setResource(id, {
      ...state,
      position: { x: p.x, z: p.z, y: state.position.y },
    });
    // A clearing of look-alike scenery around every node; widest for
    // the kinds scenery imitates (grass / herb / flowers / bush), so
    // the harvestable patch — and its cut-patch after harvesting —
    // stays readable. Depleted nodes keep their clearing.
    const spec = RESOURCE_VISUAL_SPECS[state.type];
    const base = spec?.footprintRadius ?? 0.5;
    const r =
      state.type === 'grass' || state.type === 'herb' ||
      state.type === 'flowers' || state.type === 'bush'
        ? base + 0.85
        : base + 0.3;
    const prev = this.nodePoints.get(id);
    if (!prev || prev.x !== p.x || prev.z !== p.z || prev.r !== r) {
      this.nodePoints.set(id, { x: p.x, z: p.z, r });
      this.thinningDirty = true;
    }
  }

  /**
   * Public API (2026-11-06, NATURAL-OBJECTS-CONTRACT §5.3): hand over
   * the game's natural objects in one call instead of one call per
   * object. Entries are upserted; ids previously handed over through
   * this method but missing from `list` are removed (the game streams
   * the neighbourhood around the player). Ids managed through
   * updateResourceVisual are never pruned by this method.
   */
  setNaturalObjects(list: Array<ResourceVisualState & { id: string }>): void {
    const seen = new Set<string>();
    for (const item of list) {
      seen.add(item.id);
      this.updateResourceVisual(item.id, item);
    }
    for (const id of [...this.naturalIds]) {
      if (!seen.has(id)) {
        this.updateResourceVisual(id, null);
        this.naturalIds.delete(id);
      }
    }
    for (const id of seen) this.naturalIds.add(id);
  }

  /** Single natural-object update; same contract as
   *  updateResourceVisual (kept as a named pair with setNaturalObjects). */
  updateNaturalObject(id: string, state: ResourceVisualState | null): void {
    if (state === null) this.naturalIds.delete(id);
    else this.naturalIds.add(id);
    this.updateResourceVisual(id, state);
  }

  private naturalIds = new Set<string>();

  addStructureVisual(
    id: string,
    type: StructureType,
    position: Vec3Like,
    rotationY = 0,
  ): void {
    const p = toScenePosition(position, this.cfg);
    this.structures.add(id, type, { x: p.x, z: p.z, y: position.y }, rotationY);
  }

  removeStructureVisual(id: string): void {
    this.structures.remove(id);
  }

  playVisualEffect(type: EffectType, position: Vec3Like): void {
    const p = toScenePosition(position, this.cfg);
    this.effects.play(type, { x: p.x, z: p.z, y: position.y });
  }

  /**
   * Persistent rocket exhaust that follows the body
   * (round 30 follow-up). While the rocket thrusts — on
   * the pad and during ascent — call this every frame
   * with the current Anchor_exhaust world position; the
   * plume tracks it and the jet particles trail behind
   * in world space. Pass null at cutoff: the plume fades
   * out and the remaining particles finish on their own.
   * Supersedes re-firing the 'exhaust' burst while
   * climbing (bursts stay where they are fired, so they
   * separated from the nozzle at ascent speed).
   */
  setExhaustEmitter(position: Vec3Like | null): void {
    if (position === null) {
      this.effects.setExhaustEmitter(null);
      return;
    }
    const p = toScenePosition(position, this.cfg);
    this.effects.setExhaustEmitter({ x: p.x, z: p.z, y: position.y });
  }

  /**
   * Public pause API (2026-11-06): stop the render loop while another
   * screen covers the field. Only rendering stops; all scene state is
   * kept and no game state is touched. Safe to call repeatedly.
   */
  pauseGraphics(): void {
    this.stopLoop();
  }

  /**
   * Resume after pauseGraphics(). The loop clock restarts cleanly, so
   * the first frame after resuming does not jump. Safe to call while
   * already running, and a no-op after disposeGraphics().
   */
  resumeGraphics(): void {
    if (this.disposed) return;
    this.startLoop();
  }

  resizeGraphics(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.cameraRig.resize(width, height);
  }

  /** Access to the underlying renderer for advanced hosts (optional). */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.Camera {
    return this.cameraRig.camera;
  }

  private pickRaycaster = new THREE.Raycaster();

  /**
   * Public API (2026-11-06): return the visible ground point under a
   * canvas point, in scene coordinates. canvasX/canvasY are CSS pixels
   * relative to the canvas's top-left. The result distinguishes the
   * river surface ('water') from terrain, matching what is actually
   * drawn. Display geometry only — whether the player may walk or
   * gather there stays with the game logic. Returns null when the ray
   * meets neither terrain nor water (e.g. pointing at the sky).
   */
  pickGround(canvasX: number, canvasY: number): GroundPick | null {
    const el = this.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h || this.disposed) return null;
    const ndc = new THREE.Vector2((canvasX / w) * 2 - 1, -((canvasY / h) * 2 - 1));
    this.pickRaycaster.setFromCamera(ndc, this.cameraRig.camera);
    const hit = this.world.pick(this.pickRaycaster);
    if (!hit) return null;
    return { x: hit.point.x, y: hit.point.y, z: hit.point.z, surface: hit.surface };
  }

  /**
   * Public API (2026-11-06): construction data of the resource node
   * visuals (footprint/trunk radii, height, depleted form) at scale 1,
   * for the game logic's collision and placement decisions. The same
   * table is exported from the module index as RESOURCE_VISUAL_SPECS.
   */
  getResourceVisualSpecs(): Record<string, ResourceVisualSpec> {
    return RESOURCE_VISUAL_SPECS;
  }

  /**
   * Public API (2026-11-07): specs for variants whose footprint or
   * height differ from their base type, keyed `type:variant`
   * (e.g. 'tree:conifer', 'branch:log'). Variants not listed share
   * the base type's spec. Also exported as RESOURCE_VARIANT_SPECS.
   */
  getResourceVariantSpecs(): Record<string, ResourceVisualSpec> {
    return RESOURCE_VARIANT_SPECS;
  }

  /**
   * Public API (2026-11-06): update the HUD safe-area insets (CSS px)
   * so the camera keeps the player inside the unobstructed part of the
   * canvas when menus or a tab bar overlay it. Opening/closing a menu
   * does not change zoom or the followed position — only the vertical
   * anchor inside the frame.
   */
  setViewportInsets(insets: ViewportInsets): void {
    this.cameraRig.setViewportInsets(insets.top ?? 0, insets.bottom ?? 0);
  }

  disposeGraphics(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.resizeObserver?.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLostBound);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestoredBound);
    this.post?.dispose();
    this.particles.dispose();
    this.character.dispose();
    this.structures.dispose();
    this.resources.dispose();
    this.effects.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    this.assets.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  /* ---------------- loop ---------------- */
  private startLoop(): void {
    if (this.raf !== 0) return;
    this.clock.start();
    const tick = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const time = this.clock.elapsedTime;

      this.character.update(dt, this.cameraRig.camera);
      const focus = this.cameraOverride ?? this.character.getRenderedPosition();
      const focusY = this.cameraOverride?.y ?? this.world.getGroundHeight(focus.x, focus.z);
      this.cameraRig.setTarget(focus.x, focus.z, focusY);
      this.cameraRig.update(dt);
      this.lighting.updateShadowTarget(focus.x, focus.z);

      // Occlusion fade: thin out trees / buildings that block the
      // camera's view of the player at the low exploration angle.
      const rp = this.character.getRenderedPosition();
      OCCL_TARGET.set(rp.x, rp.y + 1.0, rp.z);
      this.world.updateOcclusion(this.cameraRig.camera, OCCL_TARGET, dt);
      this.structures.updateOcclusion(this.cameraRig.camera, OCCL_TARGET, dt);
      this.resources.updateOcclusion(this.cameraRig.camera, OCCL_TARGET, dt);
      // NPC occlusion fade (Claude §16): NPCs behind trees or
      // buildings thin to 0.35 like the player-side fade, instead
      // of staying fully opaque. Floor is higher than the node
      // fade's 0.22 so townsfolk stay readable.
      this.character.npcAnchors(NPC_SCRATCH);
      if (NPC_SCRATCH.length > 0) {
        const camPos = this.cameraRig.camera.position;
        for (const n of NPC_SCRATCH) {
          const blocked = Math.max(
            this.resources.occlusionAt(camPos, n.pos),
            this.structures.occlusionAt(camPos, n.pos),
          );
          this.character.setNpcFade(n.id, blocked > 0 ? 0.35 : 1);
        }
      }

      // Ground-cover thinning follows the live node set, applied at
      // most once per frame and only when the set actually changed.
      if (this.thinningDirty) {
        this.thinningDirty = false;
        this.world.thinGroundCover([...this.nodePoints.values()]);
      }

      this.lighting.update(dt);
      this.world.update(time, rp);
      this.structures.update(time);
      this.resources.update(time);
      this.effects.update(dt);
      this.particles.update(dt, rp, time);
      if (this.post) this.post.render();
      else this.renderer.render(this.scene, this.cameraRig.camera);
    };
    tick();
  }

  private stopLoop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** Scratch vector for the per-frame occlusion test (no allocation). */
const NPC_SCRATCH: Array<{ id: string; pos: THREE.Vector3 }> = [];
const OCCL_TARGET = new THREE.Vector3();

/** Convenience factory matching the integration spec's naming. */
export async function initializeGraphics(
  container: HTMLElement,
  options: GraphicsOptions = {},
): Promise<GraphicsEngine> {
  return GraphicsEngine.create(container, options);
}

function detectQuality(): QualityTier {
  const ua = navigator.userAgent || '';
  const mobile = /iPhone|iPad|Android|Mobile/i.test(ua);
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return mobile || fewCores ? 'low' : 'high';
}
