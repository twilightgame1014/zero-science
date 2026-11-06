import * as THREE from 'three';
import type {
  EffectType,
  GraphicsConfig,
  GraphicsOptions,
  PlayerVisualState,
  QualityTier,
  ResourceVisualState,
  StructureType,
  Vec3Like,
  WorldVisualState,
} from './types';
import { resolveConfig } from './config';
import { AssetManager } from './AssetManager';
import { LightingManager } from './LightingManager';
import { CameraController } from './CameraController';
import { WorldRenderer } from './WorldRenderer';
import { CharacterRenderer } from './CharacterRenderer';
import { StructureRenderer } from './StructureRenderer';
import { ResourceRenderer } from './ResourceRenderer';
import { EffectsManager } from './EffectsManager';
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
      terrainDetail,
      particle: particleTexture,
    });
    const groundAt = (x: number, z: number) => world.getGroundHeight(x, z);
    const character = new CharacterRenderer(
      spriteTexture,
      shadowTexture,
      cfg.character,
      groundAt,
    );
    const structures = new StructureRenderer(groundAt);
    const resources = new ResourceRenderer(groundAt);
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

  /** Create/update/remove a logic-owned resource node's visual. */
  updateResourceVisual(id: string, state: ResourceVisualState | null): void {
    if (state === null) {
      this.resources.setResource(id, null);
      return;
    }
    const p = toScenePosition(state.position, this.cfg);
    this.resources.setResource(id, {
      ...state,
      position: { x: p.x, z: p.z, y: state.position.y },
    });
  }

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

  /**
   * Public pause API for the game side (e.g. while another tab is shown).
   * Stops the render loop only; all scene state is kept, and no game
   * state is touched. Safe to call repeatedly.
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
