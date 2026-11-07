import * as THREE from 'three';
import type { Direction, GraphicsConfig, NpcVisualState, PlayerVisualState } from './types';
import { dampFactor } from './utils';

/** World-space facing angle per direction (atan2(x, z) convention:
 *  'down' = +Z toward the default camera, 'right' = +X). */
const DIR_ANGLE: Record<Direction, number> = {
  down: 0,
  'down-right': Math.PI / 4,
  right: Math.PI / 2,
  'up-right': (Math.PI * 3) / 4,
  up: Math.PI,
  'up-left': (-Math.PI * 3) / 4,
  left: -Math.PI / 2,
  'down-left': -Math.PI / 4,
};

/**
 * Sheet row per screen-relative sector. The sprite must read
 * correctly from ANY camera yaw (360° orbit, 2026-11-07), so the row
 * is chosen by where the character's world facing points RELATIVE
 * to the camera: sector 0 = facing the camera (front row), then
 * rotating through the character's right side (screen 'right' row),
 * back row, and left side row. At the historical fixed yaw of 45°
 * this reproduces the original world-direction mapping exactly.
 */
const ROW_BY_SECTOR = [0, 2, 3, 1];

/**
 * 8-sector variant for 8-row sheets (round 23): sectors are 45°
 * wide starting at screen-down; the diagonal sheet rows are
 * appended after the original four (4 = down-right, 5 = down-left,
 * 6 = up-right, 7 = up-left — the layout of the *-8dir sheets).
 */
const ROW8_BY_SECTOR = [0, 4, 2, 6, 3, 7, 1, 5];

/** Sector centres for the 8-sector layout (radians, screen-relative). */
const SECTOR8_CENTRE = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);

const _camDir = new THREE.Vector3();

/** Camera-relative facing angle: 0 = facing the camera (screen
 *  down), growing through the character's screen-right side. */
function relativeAngle(direction: Direction, camera: THREE.Camera): number {
  camera.getWorldDirection(_camDir);
  // Screen-down direction on the ground plane = opposite of the
  // camera's ground-projected view direction.
  const screenDown = Math.atan2(-_camDir.x, -_camDir.z);
  let rel = (DIR_ANGLE[direction] - screenDown) % (Math.PI * 2);
  if (rel < 0) rel += Math.PI * 2;
  return rel;
}

function rowForDirection(direction: Direction, camera: THREE.Camera): number {
  const rel = relativeAngle(direction, camera);
  const sector = Math.round(rel / (Math.PI / 2)) % 4;
  return ROW_BY_SECTOR[sector];
}

/**
 * Row for an 8-row sheet, with boundary hysteresis: once a row is
 * shown, the facing must move ~6° INTO the neighbouring sector
 * before the image switches, so a character walking along a
 * sector boundary does not flicker between two rows.
 */
export function rowForDirection8(
  direction: Direction,
  camera: THREE.Camera,
  currentRow: number,
): number {
  const rel = relativeAngle(direction, camera);
  const sector = Math.round(rel / (Math.PI / 4)) % 8;
  const candidate = ROW8_BY_SECTOR[sector];
  if (candidate === currentRow || currentRow < 0) return candidate;
  let d = Math.abs(rel - SECTOR8_CENTRE[sector]) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  // Half a sector is π/8 ≈ 0.393; require the facing to be at
  // least 0.10 rad inside the candidate sector before switching.
  return d < Math.PI / 8 - 0.1 ? candidate : currentRow;
}

/** Rows in a sprite sheet: cells are square, 4 columns across, so
 *  the row count follows from the image aspect (1024² = 4 rows,
 *  1024×2048 = 8 rows). Falls back to 4 until the image exists. */
export function sheetRowsOf(texture: THREE.Texture): number {
  const img = texture.image as { width?: number; height?: number } | undefined;
  if (!img || !img.width || !img.height) return 4;
  const cell = img.width / 4;
  const rows = Math.round(img.height / cell);
  return rows === 8 ? 8 : 4;
}

/** Sprite-sheet layout contract: the character's feet rest ~11% above
 *  the bottom edge of each cell (head room at the top). Sheets supplied
 *  for this module should follow the same layout. */
const SPRITE_BOTTOM_INSET = 0.113;

/**
 * Column of the neutral standing pose. Verified by inspecting the
 * actual boy/girl sheets (2026-11-06): in every direction row,
 * column 0 is the upright stance with feet together, columns 1 and 3
 * are the strides and column 2 the passing pose. When the game says
 * the character is not moving, the sprite freezes on this column —
 * it must never keep cycling walk frames at a slower rate.
 */
const STANDING_FRAME = 0;

type CharState = { position: { x: number; z: number }; direction: Direction; moving: boolean };

/**
 * One billboarded 4x4-sheet character (the protagonist or an NPC —
 * the rendering is identical; only the state source differs).
 * Position/direction/moving come from the game logic; this class
 * only interpolates the *rendered* position for smoothness and never
 * feeds anything back.
 */
class CharSprite {
  readonly group = new THREE.Group();
  private sprite: THREE.Mesh;
  private shadow: THREE.Mesh;
  private texture: THREE.Texture;
  private cfg: GraphicsConfig['character'];
  private groundHeightAt: (x: number, z: number) => number;
  private state: CharState = { position: { x: 0, z: 0 }, direction: 'down', moving: false };
  private rendered = new THREE.Vector3(0, 0, 0);
  private animTime = 0;
  private initialized = false;
  private throttleAcc = 0;
  /** Occlusion fade (NPCs standing behind trees / buildings):
   *  the engine sets the goal; the sprite damps toward it and
   *  scales alphaTest with opacity, like the node fade. */
  private fade = 1;
  private fadeGoal = 1;
  /** Sprite-sheet rows (4 or 8) and the row currently shown
   *  (8-dir hysteresis state). */
  private sheetRows = 4;
  private currentRow = -1;

  setFadeGoal(v: number): void {
    this.fadeGoal = v;
  }

  /** World-space anchor for occlusion tests (body centre). */
  anchor(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.rendered.x, this.rendered.y + this.cfg.height * 0.55, this.rendered.z);
  }

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
    this.sheetRows = sheetRowsOf(spriteTexture);
    this.texture.repeat.set(1 / 4, 1 / this.sheetRows);
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

  /** Swap the sprite sheet at runtime. 4x4 sheets and the
   *  extended 4x8 (8-direction) sheets are both accepted. */
  setSpriteTexture(source: THREE.Texture): void {
    const old = this.texture;
    this.texture = source.clone();
    this.texture.needsUpdate = true;
    this.sheetRows = sheetRowsOf(source);
    this.currentRow = -1;
    this.texture.repeat.set(1 / 4, 1 / this.sheetRows);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = this.sprite.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.needsUpdate = true;
    old.dispose();
  }

  setState(state: CharState): void {
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

  /**
   * `throttled` (far NPCs): the whole update runs at ~5 Hz — walk
   * frames and position steps are invisible at that distance, and a
   * town full of NPCs stays cheap.
   */
  update(dt: number, camera: THREE.Camera, throttled = false): void {
    if (throttled) {
      this.throttleAcc += dt;
      if (this.throttleAcc < 0.2) return;
      dt = this.throttleAcc;
      this.throttleAcc = 0;
    }
    if (this.fade !== this.fadeGoal) {
      const fk = Math.min(1, dt * 7);
      let next = this.fade + (this.fadeGoal - this.fade) * fk;
      if (Math.abs(this.fadeGoal - next) < 0.01) next = this.fadeGoal;
      this.fade = next;
      const mat = this.sprite.material as THREE.MeshBasicMaterial;
      mat.opacity = next;
      mat.alphaTest = 0.32 * next;
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * next;
    }
    const target = this.state.position;
    const k = dampFactor(14, dt);
    this.rendered.x += (target.x - this.rendered.x) * k;
    this.rendered.z += (target.z - this.rendered.z) * k;
    const groundY = this.groundHeightAt(this.rendered.x, this.rendered.z);
    this.rendered.y += (groundY - this.rendered.y) * dampFactor(18, dt);

    // Walk cycle time advances ONLY while the game reports movement.
    // Standing still freezes the cycle, the frame and the bob.
    const moving = this.state.moving;
    if (moving) this.animTime += dt;
    const frame = moving
      ? Math.floor(this.animTime * this.cfg.walkFps) % 4
      : STANDING_FRAME;
    const row = this.sheetRows === 8
      ? rowForDirection8(this.state.direction, camera, this.currentRow)
      : rowForDirection(this.state.direction, camera);
    this.currentRow = row;
    this.texture.offset.set(frame / 4, 1 - (row + 1) / this.sheetRows);

    const bob = moving
      ? Math.abs(Math.sin(this.animTime * this.cfg.walkFps * Math.PI * 0.5)) * 0.055
      : 0;

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

/**
 * Renders the player and any NPCs as 2D sprites standing in the 3D
 * world. Sprite sheets are 4-column grids: rows = down/left/right/
 * up, columns = walk frames; an 8-row sheet appends the diagonal
 * rows (down-right/down-left/up-right/up-left) and is picked up
 * automatically from the sheet's aspect. Swapping a character's
 * appearance means supplying a different sheet with the same layout.
 */
export class CharacterRenderer {
  readonly group = new THREE.Group();
  private player: CharSprite;
  private npcs = new Map<string, CharSprite>();
  private shadowTexture: THREE.Texture;
  private placeholderTexture: THREE.Texture;
  private cfg: GraphicsConfig['character'];
  private groundHeightAt: (x: number, z: number) => number;

  constructor(
    spriteTexture: THREE.Texture,
    shadowTexture: THREE.Texture,
    cfg: GraphicsConfig['character'],
    groundHeightAt: (x: number, z: number) => number,
  ) {
    this.cfg = cfg;
    this.groundHeightAt = groundHeightAt;
    this.shadowTexture = shadowTexture;
    this.placeholderTexture = spriteTexture;
    this.player = new CharSprite(spriteTexture, shadowTexture, cfg, groundHeightAt);
    this.group.add(this.player.group);
  }

  /** Swap the player sprite sheet at runtime (protagonist selection). */
  setSpriteTexture(source: THREE.Texture): void {
    this.player.setSpriteTexture(source);
  }

  setState(state: PlayerVisualState): void {
    this.player.setState(state);
  }

  getRenderedPosition(): THREE.Vector3 {
    return this.player.getRenderedPosition();
  }

  /* ---------------- NPCs (spec §3) ---------------- */

  /** Create/update/remove one NPC's visual. New NPCs start on the
   *  placeholder sheet; setNpcSprite() swaps the real sheet in when
   *  its texture has loaded. */
  setNpc(id: string, state: NpcVisualState | null): void {
    if (state === null) {
      const npc = this.npcs.get(id);
      if (npc) {
        this.group.remove(npc.group);
        npc.dispose();
        this.npcs.delete(id);
      }
      return;
    }
    let npc = this.npcs.get(id);
    if (!npc) {
      npc = new CharSprite(this.placeholderTexture, this.shadowTexture, this.cfg, this.groundHeightAt);
      this.npcs.set(id, npc);
      this.group.add(npc.group);
    }
    npc.setState(state);
  }

  /** Occlusion fade for one NPC (Claude §16: NPCs used to stay
   *  fully opaque behind trees because the game drove renderer
   *  parts directly before this API existed). */
  setNpcFade(id: string, goal: number): void {
    this.npcs.get(id)?.setFadeGoal(goal);
  }

  /** Live NPC anchors for the engine's occlusion pass. */
  npcAnchors(out: Array<{ id: string; pos: THREE.Vector3 }>): void {
    out.length = 0;
    for (const [id, npc] of this.npcs) {
      out.push({ id, pos: npc.anchor(new THREE.Vector3()) });
    }
  }

  setNpcSprite(id: string, source: THREE.Texture): void {
    this.npcs.get(id)?.setSpriteTexture(source);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.player.update(dt, camera);
    if (this.npcs.size === 0) return;
    const focus = this.player.getRenderedPosition();
    for (const npc of this.npcs.values()) {
      const p = npc.getRenderedPosition();
      const far = Math.hypot(p.x - focus.x, p.z - focus.z) > 45;
      npc.update(dt, camera, far);
    }
  }

  dispose(): void {
    this.player.dispose();
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
  }
}
