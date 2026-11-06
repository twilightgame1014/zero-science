import * as THREE from 'three';
import type { GraphicsConfig, QualityTier } from './types';
import { AssetManager } from './AssetManager';
import { TerrainRenderer } from './TerrainRenderer';
import { EnvironmentRenderer } from './EnvironmentRenderer';

/**
 * Facade over everything that makes up the visible world:
 * terrain, river, vegetation, rocks and ambient particles.
 */
export class WorldRenderer {
  readonly group = new THREE.Group();
  private terrain: TerrainRenderer;
  private environment: EnvironmentRenderer;

  constructor(
    cfg: GraphicsConfig,
    quality: QualityTier,
    assets: AssetManager,
    textures: { terrainDetail: THREE.Texture; particle: THREE.Texture },
  ) {
    void assets;
    this.terrain = new TerrainRenderer(cfg, textures.terrainDetail);
    this.environment = new EnvironmentRenderer(cfg, quality, textures.particle);
    this.group.add(this.terrain.group);
    this.group.add(this.environment.group);
  }

  /** Ground height in scene coordinates (used for grounding sprites
   *  and structures — rendering concern only). */
  getGroundHeight(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z);
  }

  setAmbientParticlesVisible(visible: boolean): void {
    this.environment.setPollenVisible(visible);
  }

  update(time: number): void {
    this.terrain.update(time);
    this.environment.update(time);
  }

  /** Fade foreground canopies that block the camera->player sight line. */
  updateOcclusion(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, dt: number): void {
    this.environment.updateOcclusion(cameraPos, playerPos, dt);
  }
}
