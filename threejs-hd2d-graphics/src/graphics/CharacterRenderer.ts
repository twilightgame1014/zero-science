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

/**
 * Sprite lean cap (Claude §21-4, round 24). The sprite board
 * normally copies the camera orientation, so at a 70° pitch it
 * would lie back 70° and its feet would lift off the ground
 * shadow. The lean therefore stops at this angle: below it the
 * board matches the camera exactly (the established look), above
 * it the character stays at the cap and reads upright.
 */
const LEAN_CAP = THREE.MathUtils.degToRad(45);
const _eye = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mat = new THREE.Matrix4();

function cappedBillboard(out: THREE.Quaternion, camera: THREE.Camera): void {
  camera.getWorldDirection(_camDir);
  const sinPitch = THREE.MathUtils.clamp(-_camDir.y, -1, 1);
  const pitch = Math.asin(sinPitch);
  if (pitch <= LEAN_CAP) {
    out.copy(camera.quaternion);
    return;
  }
  // Rebuild the view direction with the pitch reduced to the cap,
  // keeping the camera's yaw: the horizontal component is
  // rescaled to cos(cap), the vertical set to -sin(cap).
  const horiz = Math.hypot(_camDir.x, _camDir.z) || 1;
  const cosCap = Math.cos(LEAN_CAP);
  _eye.set(
    (-_camDir.x / horiz) * cosCap,
    Math.sin(LEAN_CAP),
    (-_camDir.z / horiz) * cosCap,
  );
  _mat.lookAt(_eye, _origin, _up);
  out.setFromRotationMatrix(_mat);
}

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
 * Row selection for an 8-row sheet (round 25, Claude §22.1).
 *
 * The discrete path (rowForDirection8) is a PURE nearest-sector
 * mapping with no module-side hysteresis: the first version's
 * candidate-centre hysteresis could never be satisfied at 96 of
 * 360 camera yaws (the camera-relative angle sits up to 22.5°
 * off sector centres with 8-way input), and an exit-margin
 * version still absorbs the first step of a turn at unlucky
 * yaws. Neither is needed here — the direction only changes
 * when the game changes it, and the game already de-bounces its
 * sector choice (§22.3). The row therefore always follows the
 * direction the game passes, at every camera yaw.
 *
 * The continuous path (rowForFacing8) keeps an exit-margin
 * hysteresis: an analogue facing can hover on a sector edge,
 * and the row is kept while the facing stays inside the current
 * sector widened by HYST8, so it cannot flicker.
 */
const HYST8 = 0.06;
/** Inverse of ROW8_BY_SECTOR: sheet row -> sector index. */
const SECTOR8_OF_ROW = [0, 6, 2, 4, 1, 7, 3, 5];

export function rowForRelAngle(rel: number, currentRow: number): number {
  const sector = Math.round(rel / (Math.PI / 4)) % 8;
  const candidate = ROW8_BY_SECTOR[sector];
  if (candidate === currentRow || currentRow < 0) return candidate;
  const currentSector = SECTOR8_OF_ROW[currentRow];
  if (currentSector === undefined) return candidate;
  let d = Math.abs(rel - SECTOR8_CENTRE[currentSector]) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d <= Math.PI / 8 + HYST8 ? currentRow : candidate;
}

export function rowForDirection8(
  direction: Direction,
  camera: THREE.Camera,
  currentRow: number,
): number {
  void currentRow; // discrete input: no hysteresis (see above)
  const rel = relativeAngle(direction, camera);
  const sector = Math.round(rel / (Math.PI / 4)) % 8;
  return ROW8_BY_SECTOR[sector];
}

/**
 * Row for an 8-row sheet from a CONTINUOUS world facing angle
 * (radians, atan2(x, z) — 0 = +Z, the game's own convention;
 * Claude §22.1 option 1). Uses the exit-margin hysteresis core,
 * so the shown sector never lags the true one by more than one
 * sector and cannot flicker on a boundary.
 */
export function rowForFacing8(
  facing: number,
  camera: THREE.Camera,
  currentRow: number,
): number {
  camera.getWorldDirection(_camDir);
  const screenDown = Math.atan2(-_camDir.x, -_camDir.z);
  let rel = (facing - screenDown) % (Math.PI * 2);
  if (rel < 0) rel += Math.PI * 2;
  return rowForRelAngle(rel, currentRow);
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
  /** Terrain-occlusion silhouette (round 28, Claude §25.2.3):
   *  a flat cream copy of the sprite drawn through the ground
   *  when a slope between camera and character hides them, so
   *  the player never loses their own position on a ledge.
   *  Player only — NPCs use the fade system instead. */
  private ghost: THREE.Mesh | null = null;
  private ghostTex: THREE.Texture | null = null;
  private ghostOpacity = 0;
  private occlTimer = 0;
  private occluded = false;
  enableGhost = false;
  private texture: THREE.Texture;
  private cfg: GraphicsConfig['character'];
  private groundHeightAt: (x: number, z: number) => number;
  private state: CharState = { position: { x: 0, z: 0 }, direction: 'down', moving: false };
  private rendered = new THREE.Vector3(0, 0, 0);
  private animPhase = 0;
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

    // Ghost silhouette (built for every sprite, enabled only on
    // the player). Same sheet + frame as the sprite; the frame
    // offset is copied across every update.
    this.ghostTex = spriteTexture.clone();
    this.ghostTex.needsUpdate = true;
    this.ghostTex.repeat.set(1 / 4, 1 / this.sheetRows);
    this.ghostTex.magFilter = THREE.NearestFilter;
    this.ghostTex.minFilter = THREE.LinearMipmapLinearFilter;
    const ghostMat = new THREE.MeshBasicMaterial({
      map: this.ghostTex,
      color: 0xffeec2,
      transparent: true,
      opacity: 0,
      alphaTest: 0.08,
      depthTest: false,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.width, cfg.height),
      ghostMat,
    );
    this.ghost.renderOrder = 60;
    this.ghost.visible = false;
    this.group.add(this.ghost);

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
    if (this.ghost && this.ghostTex) {
      const oldGhost = this.ghostTex;
      this.ghostTex = source.clone();
      this.ghostTex.needsUpdate = true;
      this.ghostTex.repeat.set(1 / 4, 1 / this.sheetRows);
      this.ghostTex.magFilter = THREE.NearestFilter;
      this.ghostTex.minFilter = THREE.LinearMipmapLinearFilter;
      const gm = this.ghost.material as THREE.MeshBasicMaterial;
      gm.map = this.ghostTex;
      gm.needsUpdate = true;
      oldGhost.dispose();
    }
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

    // Walk cycle phase (in frames) advances ONLY while the game
    // reports movement. Standing still freezes the cycle, the
    // frame and the bob. When the game supplies its actual speed
    // (Claude §22.2), the phase advances by distance travelled —
    // one 4-frame cycle per 1.4 units (two steps) — so slow and
    // fast walks never slide; otherwise it advances by time at
    // the configured walkFps, as before.
    const moving = this.state.moving;
    if (moving) {
      const speed = (this.state as PlayerVisualState).speed;
      if (typeof speed === 'number' && Number.isFinite(speed)) {
        this.animPhase += (Math.max(0, speed) * dt) / (this.cfg.walkStride ?? 0.35);
      } else {
        this.animPhase += dt * this.cfg.walkFps;
      }
    }
    const frame = moving
      ? Math.floor(this.animPhase) % 4
      : STANDING_FRAME;
    const facing = (this.state as PlayerVisualState).facing;
    const row = this.sheetRows === 8
      ? (typeof facing === 'number' && Number.isFinite(facing)
          ? rowForFacing8(facing, camera, this.currentRow)
          : rowForDirection8(this.state.direction, camera, this.currentRow))
      : rowForDirection(this.state.direction, camera);
    this.currentRow = row;
    this.texture.offset.set(frame / 4, 1 - (row + 1) / this.sheetRows);

    const bob = moving
      ? Math.abs(Math.sin(this.animPhase * Math.PI * 0.5)) * 0.055
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
    // Billboard: match the camera (lean capped, see LEAN_CAP) so
    // the sprite always reads correctly.
    cappedBillboard(this.sprite.quaternion, camera);

    // Terrain-occlusion silhouette (round 28, Claude §25.2.3):
    // when the ground itself — not a tree or building — hides the
    // character (standing on a ledge with the slope between them
    // and the camera), show a pale silhouette through the slope
    // so the player keeps their bearings. Detection samples the
    // height function along the camera→body-centre line a few
    // times a second; the ghost fades in/out, never pops.
    if (this.ghost && this.ghostTex) {
      this.ghostTex.offset.copy(this.texture.offset);
      if (this.enableGhost) {
        this.occlTimer -= dt;
        if (this.occlTimer <= 0) {
          this.occlTimer = 0.12;
          this.occluded = this.terrainBlocksView(camera);
        }
      } else {
        this.occluded = false;
      }
      const goal = this.occluded ? 0.55 : 0;
      if (this.ghostOpacity !== goal) {
        const fk = Math.min(1, dt * 8);
        let next = this.ghostOpacity + (goal - this.ghostOpacity) * fk;
        if (Math.abs(goal - next) < 0.02) next = goal;
        this.ghostOpacity = next;
      }
      const gm = this.ghost.material as THREE.MeshBasicMaterial;
      gm.opacity = this.ghostOpacity;
      this.ghost.visible = this.ghostOpacity > 0.02;
      if (this.ghost.visible) {
        this.ghost.position.copy(this.sprite.position);
        this.ghost.quaternion.copy(this.sprite.quaternion);
      }
    }

    this.shadow.position.set(this.rendered.x, this.rendered.y + 0.03, this.rendered.z);
  }

  /** True when terrain rises above the camera→body-centre line
   *  (round 28). The ends of the line are excluded: the ground at
   *  the character's own feet and at the camera never counts. */
  private terrainBlocksView(camera: THREE.Camera): boolean {
    const cp = camera.position;
    const ax = this.rendered.x;
    const az = this.rendered.z;
    const ay = this.rendered.y + this.cfg.height * 0.5;
    const dx = ax - cp.x;
    const dy = ay - cp.y;
    const dz = az - cp.z;
    if (Math.hypot(dx, dz) < 6) return false;
    const STEPS = 12;
    for (let i = 2; i < STEPS; i++) {
      const t = i / STEPS;
      const px = cp.x + dx * t;
      const pz = cp.z + dz * t;
      if (this.groundHeightAt(px, pz) > cp.y + dy * t + 0.3) return true;
    }
    return false;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.geometry.dispose();
    (this.sprite.material as THREE.Material).dispose();
    if (this.ghost) {
      this.ghost.geometry.dispose();
      (this.ghost.material as THREE.Material).dispose();
    }
    this.ghostTex?.dispose();
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
    this.player.enableGhost = true;
    this.group.add(this.player.group);
  }

  /** Swap the player sprite sheet at runtime (protagonist selection). */
  setSpriteTexture(source: THREE.Texture): void {
    this.player.setSpriteTexture(source);
  }

  /**
   * Show or hide ONLY the player (sprite, shadow and occlusion
   * ghost). NPCs are unaffected. Round 30 (space integration):
   * while the player is inside the capsule from boarding until
   * return, the game hides the player through this API instead
   * of reaching into the renderer's groups.
   */
  setPlayerVisible(visible: boolean): void {
    this.player.group.visible = visible;
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
