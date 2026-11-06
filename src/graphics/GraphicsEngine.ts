import * as THREE from 'three';
import type {
  EffectType,
  GraphicsConfig,
  GraphicsOptions,
  GroundPick,
  PlayerVisualState,
  QualityTier,
  ResourceVisualState,
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
import { ResourceRenderer, RESOURCE_VISUAL_SPECS } from './ResourceRenderer';
import type { ResourceVisualSpec } from './ResourceRenderer';
import { EffectsManager } from './EffectsManager';
import { GPT_TEXTURES } from './gptTextures';
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
  private post: PostEffects | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private cameraOverride: { x: number; z: number } | null = null;
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
      decor: options.decor,
    });
    const groundAt = (x: number, z: number) => world.getGroundHeight(x, z);
    const character = new CharacterRenderer(
      spriteTexture,
      shadowTexture,
      cfg.character,
      groundAt,
    );
    const structures = new StructureRenderer(groundAt);
    const resources = new ResourceRenderer(groundAt, gpt, cfg.camera.yawDegrees);
    const effects = new EffectsManager(particleTexture, groundAt);
    scene.add(world.group, character.group, structures.group, resources.group, effects.group);

    const effectiveOptions: GraphicsOptions = {
      ...options,
      // Post effects default on for high quality, off for low (mobile).
      postEffects: options.postEffects ?? quality === 'high',
    };
    return new GraphicsEngine(container, effectiveOptions, {
      renderer, scene, assets, lighting, cameraRig, world, character,
      structures, resources, effects, cfg,
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
    this.cameraOverride = { x: p.x, z: p.z };
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
      const focusY = this.world.getGroundHeight(focus.x, focus.z);
      this.cameraRig.setTarget(focus.x, focus.z, focusY);
      this.cameraRig.update(dt);
      this.lighting.updateShadowTarget(focus.x, focus.z);

      // Occlusion fade: thin out trees / buildings that block the
      // camera's view of the player at the low exploration angle.
      const rp = this.character.getRenderedPosition();
      OCCL_TARGET.set(rp.x, rp.y + 1.0, rp.z);
      this.world.updateOcclusion(this.cameraRig.camera.position, OCCL_TARGET, dt);
      this.structures.updateOcclusion(this.cameraRig.camera.position, OCCL_TARGET, dt);
      this.resources.updateOcclusion(this.cameraRig.camera.position, OCCL_TARGET, dt);

      // Ground-cover thinning follows the live node set, applied at
      // most once per frame and only when the set actually changed.
      if (this.thinningDirty) {
        this.thinningDirty = false;
        this.world.thinGroundCover([...this.nodePoints.values()]);
      }

      this.world.update(time);
      this.structures.update(time);
      this.resources.update(time);
      this.effects.update(dt);
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
