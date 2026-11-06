import * as THREE from 'three';
import type { Direction, GraphicsConfig, PlayerVisualState } from './types';
import { dampFactor } from './utils';

const ROW_FOR_DIRECTION: Record<Direction, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

/** Sprite-sheet layout contract: the character's feet rest ~11% above
 *  the bottom edge of each cell (head room at the top). Sheets supplied
 *  for this module should follow the same layout. */
const SPRITE_BOTTOM_INSET = 0.113;

/**
 * Renders the player as a 2D sprite standing in the 3D world.
 *
 * The sprite sheet is a 4x4 grid: rows = down/left/right/up,
 * columns = walk frames. Swapping the character's appearance means
 * supplying a different sheet with the same layout — no code changes.
 *
 * Position/direction/moving come from the game logic every frame;
 * this class only interpolates the *rendered* position for smoothness
 * and never feeds anything back.
 */
export class CharacterRenderer {
  readonly group = new THREE.Group();
  private sprite: THREE.Mesh;
  private shadow: THREE.Mesh;
  private texture: THREE.Texture;
  private cfg: GraphicsConfig['character'];
  private groundHeightAt: (x: number, z: number) => number;

  private state: PlayerVisualState = {
    position: { x: 0, z: 0 },
    direction: 'down',
    moving: false,
  };
  private rendered = new THREE.Vector3(0, 0, 0);
  private animTime = 0;
  private initialized = false;

  constructor(
    spriteTexture: THREE.Texture,
    shadowTexture: THREE.Texture,
    cfg: GraphicsConfig['character'],
    groundHeightAt: (x: number, z: number) => number,
  ) {
    this.cfg = cfg;
    this.groundHeightAt = groundHeightAt;

    // Clone so frame offsets never leak into a shared texture.
    this.texture = spriteTexture.clone();
    this.texture.needsUpdate = true;
    this.texture.repeat.set(1 / 4, 1 / 4);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.32,
    });
    this.sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.width, cfg.height),
      mat,
    );
    this.sprite.renderOrder = 3;
    this.group.add(this.sprite);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      shadowMat,
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
  }

  /** Swap the sprite sheet at runtime (e.g. protagonist selection or
   *  costume change). The new sheet must use the same 4x4 layout. */
  setSpriteTexture(source: THREE.Texture): void {
    const old = this.texture;
    this.texture = source.clone();
    this.texture.needsUpdate = true;
    this.texture.repeat.set(1 / 4, 1 / 4);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = this.sprite.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.needsUpdate = true;
    old.dispose();
  }

  setState(state: PlayerVisualState): void {
    this.state = state;
    if (!this.initialized) {
      const p = state.position;
      this.rendered.set(p.x, this.groundHeightAt(p.x, p.z), p.z);
      this.initialized = true;
    }
  }

  getRenderedPosition(): THREE.Vector3 {
    return this.rendered.clone();
  }

  update(dt: number, camera: THREE.Camera): void {
    const target = this.state.position;
    const k = dampFactor(14, dt);
    this.rendered.x += (target.x - this.rendered.x) * k;
    this.rendered.z += (target.z - this.rendered.z) * k;
    const groundY = this.groundHeightAt(this.rendered.x, this.rendered.z);
    this.rendered.y += (groundY - this.rendered.y) * dampFactor(18, dt);

    this.animTime += dt;
    const moving = this.state.moving;
    const fps = moving ? this.cfg.walkFps : this.cfg.idleFps;
    const frame = moving
      ? Math.floor(this.animTime * fps) % 4
      : Math.floor(this.animTime * fps) % 2; // idle: gentle 2-frame sway
    const row = ROW_FOR_DIRECTION[this.state.direction];
    this.texture.offset.set(frame / 4, 1 - (row + 1) / 4);

    // Walk bob / idle breathing (visual only).
    const bob = moving
      ? Math.abs(Math.sin(this.animTime * fps * Math.PI * 0.5)) * 0.055
      : Math.sin(this.animTime * 2.1) * 0.018;

    this.sprite.position.set(
      this.rendered.x,
      this.rendered.y +
        this.cfg.height / 2 -
        this.cfg.height * SPRITE_BOTTOM_INSET -
        0.02 +
        bob,
      this.rendered.z,
    );
    // Billboard: match the camera so the sprite always reads correctly.
    this.sprite.quaternion.copy(camera.quaternion);

    this.shadow.position.set(this.rendered.x, this.rendered.y + 0.03, this.rendered.z);
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.geometry.dispose();
    (this.sprite.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
