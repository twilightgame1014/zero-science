import * as THREE from 'three';
import type { ResourceVisualState } from './types';
import { disposeObject } from './StructureRenderer';
import { AssetManager } from './AssetManager';
import { addInstanceFade, mulberry32, segmentPointDistance } from './utils';
import { fracturedRockGeometry } from './WaterfallKit';

interface SlotRef {
  pool: InstancedPool;
  index: number;
  /** Local placement relative to the node origin. */
  dx: number; dy: number; dz: number;
  /** Total Y rotation of the quad (crossed planes differ per slot). */
  yaw: number;
  sx: number; sy: number; sz: number;
  /** Base instance colour (restored when no blink flash is active). */
  tint: THREE.Color;
}

interface Entry {
  state: ResourceVisualState;
  /** Group-path visual (null when the node is instanced). */
  group: THREE.Group | null;
  /** Instanced-path slots (empty when the node is group-rendered). */
  slots: SlotRef[];
  pulseMaterials: THREE.MeshStandardMaterial[];
  /** Material opacities as built (fade multiplies these). */
  baseOpacities: number[];
  /** Material alphaTest thresholds as built (fade scales these too:
   *  a cutout material whose opacity drops below its threshold would
   *  be discarded whole instead of fading). */
  baseAlphaTests: number[];
  baseScale: number;
  /** Occlusion fade factor, 1 = fully visible. */
  fade: number;
  /** Ground ring shown while the node is highlighted. */
  ring: THREE.Mesh | null;
  /** Node origin in world space (ring / occlusion anchor). */
  pos: THREE.Vector3;
  /** Whether slot matrices currently carry a reaction tilt. */
  tilted: boolean;
  /** Whether slot colours currently carry a blink flash. */
  flashed: boolean;
}

/** Scratch objects for the per-frame work (no allocation). */
const OCCL_POINT = new THREE.Vector3();
const FLASH_COLOR = new THREE.Color(1.35, 1.18, 0.85);
const WHITE = new THREE.Color(1, 1, 1);

/** Deterministic vertex jitter (same input position -> same offset),
 *  so resource rocks share the environment rocks' craggy silhouette. */
function jitterRock(geo: THREE.BufferGeometry, amount = 0.16): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    v.multiplyScalar(1 - amount / 2 + (h - Math.floor(h)) * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/**
 * FNV-1a hash of the node id (round 22): the old char-code SUM
 * collided constantly ("rock:120,340" vs "rock:210,430" style
 * ids summed alike), so whole fields of nodes grew the identical
 * tree / rock. The hash spreads ids across the full 32-bit range;
 * every per-instance variation below derives from it, and the
 * same id always yields the same individual.
 */
function hashIdSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A fixed-capacity InstancedMesh pool. Slots are allocated per node;
 * a released slot collapses to a zero-scale matrix underground.
 * Capacity is generous for the game's streaming window; if a pool
 * ever fills, the caller falls back to the group path for that node.
 */
class InstancedPool {
  readonly mesh: THREE.InstancedMesh;
  private freeList: number[] = [];
  private dummy = new THREE.Object3D();

  private fades: Float32Array;
  private fadeAttr: THREE.InstancedBufferAttribute;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, parent: THREE.Group) {
    // Per-instance occlusion fade (round 26): pools whose material
    // is patched with addInstanceFade read this attribute; the
    // vegetation kinds (grass / herb / flowers) are driven by
    // ResourceRenderer.updateOcclusion, everything else stays 1.
    this.fades = new Float32Array(capacity).fill(1);
    this.fadeAttr = new THREE.InstancedBufferAttribute(this.fades, 1);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fadeAttr);
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = capacity - 1; i >= 0; i--) {
      this.freeList.push(i);
      this.dummy.position.set(0, -50, 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, WHITE);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
  }

  get free(): number {
    return this.freeList.length;
  }

  alloc(): number {
    return this.freeList.length > 0 ? this.freeList.pop()! : -1;
  }

  setFade(index: number, v: number): void {
    if (this.fades[index] === v) return;
    this.fades[index] = v;
    this.fadeAttr.needsUpdate = true;
  }

  release(index: number): void {
    this.setFade(index, 1);
    this.dummy.position.set(0, -50, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(0.001);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.freeList.push(index);
  }

  setSlot(index: number, x: number, y: number, z: number, yaw: number, tiltZ: number,
    sx: number, sy: number, sz: number): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, yaw, tiltZ, 'YZX' as THREE.EulerOrder);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setTint(index: number, color: THREE.Color): void {
    this.mesh.setColorAt(index, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(parent: THREE.Group): void {
    parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Logic-driven resource nodes (trees to harvest, ore rocks, herbs...).
 *
 * The game logic owns existence/amount/depletion; this class renders
 * whatever state it is handed, including the depleted variant
 * (stump / rubble / picked-clean) when state.depleted is true.
 *
 * Rendering paths (2026-11-06): the numerous small kinds — sprite
 * props (branch, pebble, herb, flowers, grass) and the water / oil
 * pools — are drawn through shared InstancedMesh pools, so a forest
 * of natural objects costs a handful of draw calls for them instead
 * of one group per object. The large kinds (tree, rock, ore, bush,
 * clay, mushroom) keep per-node groups because each carries unique
 * materials for the occlusion fade and the reaction blink, but their
 * geometries come from a shared cache instead of being re-allocated
 * per node.
 */
export class ResourceRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private groundHeightAt: (x: number, z: number) => number;
  private barkTex: THREE.Texture;
  private foliageTex: THREE.Texture;
  private rockCrackTex: THREE.Texture;
  private gpt: Record<string, THREE.Texture>;
  /** Branch/leaf spray textures for the card-built tree canopies. */
  private branch: Record<string, THREE.Texture>;
  /** World-expansion spray / lava textures (assets/gpt-expansion/):
   *  conifer species, snow set, shore plants, lava pair. Missing
   *  entries fall back to the spray set / plain materials. */
  private expansion: Record<string, THREE.Texture>;
  /** DQ3 density set (assets/gpt-dq3/): broadleaf role sprays and
   *  the lava-flow pair. Missing entries fall back as documented. */
  private dq3: Record<string, THREE.Texture>;
  /** World water level (scene Y): floating visuals (lily pads)
   *  anchor to it rather than to the bed height under the node. */
  private waterLevel: number;
  /** Procedural reserve sprays (canvas-drawn; cannot fail to
   *  decode). Used when the bundled spray WebPs are unavailable, so
   *  canopies and bushes stay card-built instead of reverting to
   *  solid leaf blobs (Claude 2026-11-07 §12-4). */
  private fallbackSprays: THREE.Texture[];
  /** Camera azimuth: sprite props stand facing it (the camera never orbits). */
  private yawRad: number;
  /** Shared geometries for the group path (never disposed per node). */
  private geoCache = new Map<string, THREE.BufferGeometry>();
  /** Instanced pools, created lazily per texture / shape. */
  private pools = new Map<string, InstancedPool>();

  constructor(
    groundHeightAt: (x: number, z: number) => number,
    gpt: Record<string, THREE.Texture> = {},
    yawDegrees = 45,
    branch: Record<string, THREE.Texture> = {},
    expansion: Record<string, THREE.Texture> = {},
    waterLevel = 0.32,
    dq3: Record<string, THREE.Texture> = {},
  ) {
    this.groundHeightAt = groundHeightAt;
    this.gpt = gpt;
    this.branch = branch;
    this.expansion = expansion;
    this.dq3 = dq3;
    this.waterLevel = waterLevel;
    this.yawRad = THREE.MathUtils.degToRad(yawDegrees);
    const am = new AssetManager();
    this.barkTex = am.createBarkTexture();
    this.foliageTex = am.createFoliageTexture();
    this.rockCrackTex = am.createRockCrackTexture();
    this.fallbackSprays = [0, 1, 2, 3].map((v) => am.createSprayTexture(v));
  }

  /** The spray set a card build should use: the bundled sheet art
   *  when it decoded, the procedural reserve sprays otherwise. */
  private spraySet(): THREE.Texture[] {
    // DQ3 density set first: role-differentiated broadleaf art
    // (deep inner / bright top / droop rim / light tips) — denser
    // and more varied than the round-11 branch cards, which remain
    // the fallback together with the procedural reserve sprays.
    const dq = [
      this.dq3['broadleaf-deep'], this.dq3['broadleaf-bright'],
      this.dq3['broadleaf-droop'], this.dq3['broadleaf-light'],
    ].filter((t): t is THREE.Texture => !!t);
    if (dq.length >= 3) return dq;
    const real = [
      this.branch.branch_1, this.branch.branch_2,
      this.branch.branch_3, this.branch.branch_4,
    ].filter((t): t is THREE.Texture => !!t);
    return real.length >= 2 ? real : this.fallbackSprays;
  }

  /* ---------------- instanced pool plumbing ---------------- */

  private geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      g.userData.shared = true;
      this.geoCache.set(key, g);
    }
    return g;
  }

  private spritePool(texKey: string, flat = false): InstancedPool | null {
    const tex = this.gpt[texKey];
    if (!tex) return null;
    const key = flat ? `flat:${texKey}` : `spr:${texKey}`;
    let pool = this.pools.get(key);
    if (!pool) {
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: flat ? 0.5 : 0.45,
        side: THREE.DoubleSide,
        roughness: 0.95,
        // Same soft lift as the group-path sprites: a flat plane
        // facing away from the low sun must not go black.
        ...(flat ? {} : { emissive: 0x66553d, emissiveMap: tex, emissiveIntensity: 0.38 }),
        ...(flat ? { polygonOffset: true, polygonOffsetFactor: -2 } : {}),
      });
      const geo = flat
        ? (() => { const p = new THREE.PlaneGeometry(1, 0.75); p.rotateX(-Math.PI / 2); return p; })()
        : (() => { const p = new THREE.PlaneGeometry(1, 1); p.translate(0, 0.5, 0); return p; })();
      addInstanceFade(mat);
      pool = new InstancedPool(geo, mat, 224, this.group);
      pool.mesh.receiveShadow = flat;
      this.pools.set(key, pool);
    }
    return pool;
  }

  private shapePool(key: string, makeGeo: () => THREE.BufferGeometry,
    mat: THREE.Material, capacity: number): InstancedPool {
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new InstancedPool(makeGeo(), mat, capacity, this.group);
      this.pools.set(key, pool);
    }
    return pool;
  }

  /* ---------------- public API ---------------- */

  setResource(id: string, state: ResourceVisualState | null): void {
    if (state === null || state.visible === false) {
      this.removeResource(id);
      return;
    }
    const prev = this.entries.get(id);
    const needsRebuild =
      !prev || prev.state.type !== state.type || prev.state.depleted !== state.depleted ||
      prev.state.natural?.variant !== state.natural?.variant;
    const y = state.position.y ?? this.groundHeightAt(state.position.x, state.position.z);
    if (needsRebuild) {
      this.removeResource(id);
      const seed = hashIdSeed(id);
      const s = state.scale ?? 1;
      const inst = state.depleted
        ? this.buildInstancedDepleted(state, seed)
        : this.buildInstanced(state, seed);
      if (inst) {
        const entry: Entry = {
          state, group: null, slots: inst, pulseMaterials: [], baseOpacities: [], baseAlphaTests: [],
          baseScale: s, fade: 1, ring: null,
          pos: new THREE.Vector3(state.position.x, y, state.position.z),
          tilted: false, flashed: false,
        };
        this.entries.set(id, entry);
        this.placeSlots(entry, 0);
      } else {
        const built = this.buildNode(state, seed);
        built.group.position.set(state.position.x, y, state.position.z);
        built.group.rotation.y = state.rotationY ?? 0;
        built.group.scale.setScalar(s);
        this.group.add(built.group);
        this.entries.set(id, {
          state,
          group: built.group,
          slots: [],
          pulseMaterials: built.pulseMaterials,
          baseOpacities: built.pulseMaterials.map((m) => m.opacity),
          baseAlphaTests: built.pulseMaterials.map((m) => m.alphaTest),
          baseScale: s,
          fade: 1,
          ring: null,
          pos: new THREE.Vector3(state.position.x, y, state.position.z),
          tilted: false,
          flashed: false,
        });
      }
    } else if (prev) {
      prev.state = state;
      prev.pos.set(state.position.x, y, state.position.z);
      if (prev.group) {
        prev.group.position.copy(prev.pos);
      } else {
        this.placeSlots(prev, 0);
      }
      if (prev.ring) prev.ring.position.set(prev.pos.x, prev.pos.y + 0.07, prev.pos.z);
    }
  }

  removeResource(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.group) {
      this.group.remove(entry.group);
      this.disposeGroup(entry.group);
    }
    for (const slot of entry.slots) slot.pool.release(slot.index);
    if (entry.ring) {
      this.group.remove(entry.ring);
      disposeObject(entry.ring);
    }
    this.entries.delete(id);
  }

  /** Dispose a node group without touching shared cached geometries. */
  private disposeGroup(root: THREE.Group): void {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (!o.geometry.userData.shared) o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }

  /** Write an instanced entry's slot matrices (optionally tilted). */
  private placeSlots(entry: Entry, tiltZ: number): void {
    const s = entry.baseScale;
    for (const slot of entry.slots) {
      slot.pool.setSlot(
        slot.index,
        entry.pos.x + slot.dx * s, entry.pos.y + slot.dy * s, entry.pos.z + slot.dz * s,
        slot.yaw, tiltZ,
        slot.sx * s, slot.sy * s, slot.sz * s,
      );
    }
    entry.tilted = tiltZ !== 0;
  }

  private setSlotsFlash(entry: Entry, on: boolean): void {
    for (const slot of entry.slots) slot.pool.setTint(slot.index, on ? FLASH_COLOR : slot.tint);
    entry.flashed = on;
  }

  update(time: number): void {
    for (const entry of this.entries.values()) {
      const st = entry.state;
      const reacting = st.phase === 'reacting' && !st.depleted;
      if (entry.group) {
        // Harvest reaction (cosmetic only): the game sets phase while
        // a harvest is in progress; visuals return exactly to rest
        // when it ends, so a finished reaction can never leave a node
        // tilted.
        if (reacting) {
          if (st.type === 'tree') {
            entry.group.rotation.z = Math.sin(time * 26) * 0.035;
            entry.group.rotation.x = Math.cos(time * 22) * 0.02;
          } else if (st.type === 'rock' || st.type === 'ore') {
            const j = 1 + Math.sin(time * 30) * 0.012;
            entry.group.scale.setScalar(entry.baseScale * j);
            entry.group.rotation.z = Math.sin(time * 30) * 0.008;
          } else if (st.type === 'water' || st.type === 'oil') {
            // Pools do not sway; the blink alone marks the interaction.
          } else {
            entry.group.rotation.z = Math.sin(time * 10) * 0.06;
          }
          // Warm blink, kept well below blow-out: the node must stay
          // identifiable while it reacts (verified against screenshots
          // — a 0.4 peak washed the whole tree white under bloom).
          const flash = Math.sin(time * 18) > 0 ? 0.2 : 0.02;
          for (const mat of entry.pulseMaterials) mat.emissive.setRGB(flash, flash * 0.85, flash * 0.55);
        } else {
          entry.group.rotation.x = 0;
          entry.group.rotation.z = 0;
          entry.group.scale.setScalar(entry.baseScale);
          for (const mat of entry.pulseMaterials) mat.emissive.setRGB(0, 0, 0);
        }
      } else if (entry.slots.length > 0) {
        // Instanced path: sway = a small tilt on the slot matrices,
        // blink = a warm instance-colour flash (shared materials
        // cannot blink per node).
        if (reacting) {
          if (st.type !== 'water' && st.type !== 'oil') {
            this.placeSlots(entry, Math.sin(time * 10) * 0.06);
          }
          const on = Math.sin(time * 18) > 0;
          if (on !== entry.flashed) this.setSlotsFlash(entry, on);
        } else {
          if (entry.tilted) this.placeSlots(entry, 0);
          if (entry.flashed) this.setSlotsFlash(entry, false);
        }
      }
      // Highlight = a pulsing ring at the node's feet (2026-11-06,
      // Claude's request). The previous whole-node emissive pulse lit
      // up entire canopies and hid the player and name labels. The
      // ring renders through foliage (depth test off, top render
      // order) because under a canopy it was otherwise invisible in
      // the forest — it is a UI marker, not a world object.
      if (st.highlighted === true && !st.depleted) {
        if (!entry.ring) {
          const r = (RESOURCE_VISUAL_SPECS[st.type]?.footprintRadius ?? 0.5) * 1.3 * entry.baseScale;
          entry.ring = this.makeRing(r);
          entry.ring.position.set(entry.pos.x, entry.pos.y + 0.07, entry.pos.z);
          this.group.add(entry.ring);
        }
        entry.ring.visible = true;
        const m = entry.ring.material as THREE.MeshBasicMaterial;
        m.opacity = 0.55 + Math.sin(time * 5) * 0.2;
      } else if (entry.ring) {
        entry.ring.visible = false;
      }
    }
  }

  private makeRing(radius: number): THREE.Mesh {
    const geo = new THREE.RingGeometry(0.84, 1, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd75e,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Fade tall nodes (trees, rocks, ore, bushes) that block the
   * camera's view of the player. Two tests: the node near the
   * camera->player segment, and — for trees — a crown that simply
   * hangs over the player from the side (Claude 2026-11-06: the
   * segment test alone left the player half-covered in dense
   * forest). Node materials are unique per node, so fading one never
   * touches another. Only group-path kinds can be in the fade set;
   * the instanced kinds are all low ground props.
   */
  updateOcclusion(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, dt: number): void {
    const FADE_MIN = 0.22;
    const k = Math.min(1, dt * 7);
    for (const entry of this.entries.values()) {
      const st = entry.state;
      if (!entry.group || st.depleted) continue;
      if (st.type !== 'tree' && st.type !== 'rock' && st.type !== 'ore' && st.type !== 'bush' && st.type !== 'grass') continue;
      const spec = RESOURCE_VISUAL_SPECS[st.type];
      const p = entry.group.position;
      const radius = (spec?.footprintRadius ?? 0.6) * entry.baseScale + 0.45;
      OCCL_POINT.set(p.x, p.y + (spec?.height ?? 1) * entry.baseScale * 0.55, p.z);
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        playerPos.x, playerPos.y, playerPos.z,
        OCCL_POINT.x, OCCL_POINT.y, OCCL_POINT.z,
      );
      // The node the player is interacting with (highlighted as the
      // current target, or shaking under work) must stay clearly
      // visible: it is exempt from the proximity test and its fade
      // floor rises to 0.85 under the segment test (Claude
      // 2026-11-07 §12-1: a target tree faded to 0.22 all but
      // vanished while being felled). The segment test alone could
      // not carry the exemption — at interaction distance the
      // segment radius (≈ footprint × scale + 0.45) still reaches
      // the adjacent tree — so the floor applies to both tests.
      const interacting = st.highlighted === true || st.phase === 'reacting';
      const floor = interacting ? 0.85 : FADE_MIN;
      let goal = d < radius ? floor : 1;
      if (goal === 1 && st.type === 'tree' && !interacting) {
        const dx = p.x - playerPos.x;
        const dz = p.z - playerPos.z;
        const reach = 3.1 * entry.baseScale;
        if (dx * dx + dz * dz < reach * reach) goal = FADE_MIN;
      }
      if (entry.fade === goal) continue;
      let next = entry.fade + (goal - entry.fade) * k;
      if (Math.abs(goal - next) < 0.01) next = goal;
      entry.fade = next;
      entry.pulseMaterials.forEach((mat, i) => {
        mat.opacity = entry.baseOpacities[i] * next;
        mat.transparent = next < 0.999 || entry.baseOpacities[i] < 1;
        // Cutout materials (alphaTest > 0) must lower their threshold
        // with the fade: opacity 0.22 against a 0.45 threshold is
        // discarded whole, so a fading spray-card canopy would vanish
        // instead of thinning (found on the first card-built trees).
        mat.alphaTest = (entry.baseAlphaTests[i] ?? 0) * next;
      });
    }
    // Instanced low vegetation (round 26, Claude §23): grass
    // clumps, herb patches and flower tufts are pool-rendered, so
    // they were outside the fade set and could half-hide the
    // player at low pitch. Same segment test and floors as the
    // group path (the gather target the player is working on
    // stays at 0.85); the per-instance screen-door fade lives on
    // the pools' aFade attribute.
    for (const entry of this.entries.values()) {
      const st = entry.state;
      if (entry.group || entry.slots.length === 0 || st.depleted) continue;
      if (st.type !== 'grass' && st.type !== 'herb' && st.type !== 'flowers') continue;
      const spec = RESOURCE_VISUAL_SPECS[st.type];
      const radius = (spec?.footprintRadius ?? 0.6) * entry.baseScale + 0.45;
      OCCL_POINT.set(
        entry.pos.x,
        entry.pos.y + (spec?.height ?? 0.8) * entry.baseScale * 0.55,
        entry.pos.z,
      );
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        playerPos.x, playerPos.y, playerPos.z,
        OCCL_POINT.x, OCCL_POINT.y, OCCL_POINT.z,
      );
      const interacting = st.highlighted === true || st.phase === 'reacting';
      const goal = d < radius ? (interacting ? 0.85 : FADE_MIN) : 1;
      if (entry.fade === goal) continue;
      let next = entry.fade + (goal - entry.fade) * k;
      if (Math.abs(goal - next) < 0.01) next = goal;
      entry.fade = next;
      for (const slot of entry.slots) slot.pool.setFade(slot.index, next);
    }
  }

  /** Blockage probe for OTHER subjects (NPCs): 1 when this node
   *  sits on the camera→point segment, using the same test point
   *  and radius as the player fade. Stateless. */
  occlusionAt(cameraPos: THREE.Vector3, point: THREE.Vector3): number {
    for (const entry of this.entries.values()) {
      const st = entry.state;
      if (!entry.group || st.depleted) continue;
      if (st.type !== 'tree' && st.type !== 'rock' && st.type !== 'ore' && st.type !== 'bush') continue;
      const spec = RESOURCE_VISUAL_SPECS[st.type];
      const p = entry.group.position;
      const radius = (spec?.footprintRadius ?? 0.6) * entry.baseScale + 0.45;
      OCCL_POINT.set(p.x, p.y + (spec?.height ?? 1) * entry.baseScale * 0.55, p.z);
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        point.x, point.y, point.z,
        OCCL_POINT.x, OCCL_POINT.y, OCCL_POINT.z,
      );
      if (d < radius) return 1;
    }
    return 0;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.removeResource(id);
    for (const pool of this.pools.values()) pool.dispose(this.group);
    this.pools.clear();
    for (const g of this.geoCache.values()) g.dispose();
    this.geoCache.clear();
  }

  /* ---------------- instanced builders ---------------- */

  private allocSlots(pool: InstancedPool,
    defs: Array<Omit<SlotRef, 'pool' | 'index'>>): SlotRef[] | null {
    if (pool.free < defs.length) return null;
    return defs.map((d) => ({ pool, index: pool.alloc(), ...d }));
  }

  /** Crossed yaw-facing sprite planes (all sharing the node origin). */
  private crossSlots(texKey: string, count: number, w: number, h: number,
    tint: THREE.Color): SlotRef[] | null {
    const pool = this.spritePool(texKey);
    if (!pool) return null;
    const defs: Array<Omit<SlotRef, 'pool' | 'index'>> = [];
    for (let i = 0; i < count; i++) {
      defs.push({
        dx: 0, dy: 0, dz: 0,
        yaw: this.yawRad + (i * Math.PI) / count,
        sx: w, sy: h, sz: 1,
        tint,
      });
    }
    return this.allocSlots(pool, defs);
  }

  /** Try the instanced path; null means "use the group path". */
  private buildInstanced(state: ResourceVisualState, seed: number): SlotRef[] | null {
    switch (state.type) {
      case 'branch': {
        // The 'log' / 'driftwood' variants are 3D fallen logs, not
        // the flat twig sprite — send them down the group path.
        if (state.natural?.variant === 'log' || state.natural?.variant === 'driftwood') return null;
        const pool = this.spritePool('prop_branch');
        if (!pool) return null;
        return this.allocSlots(pool, [{
          dx: 0, dy: 0, dz: 0, yaw: this.yawRad, sx: 0.95, sy: 0.78, sz: 1, tint: WHITE,
        }]);
      }
      case 'pebble': {
        const pool = this.spritePool('prop_pebbles');
        if (!pool) return null;
        const tint = state.natural?.variant === 'flint'
          ? new THREE.Color(0.56, 0.56, 0.6) : WHITE;
        return this.allocSlots(pool, [{
          dx: 0, dy: 0, dz: 0, yaw: this.yawRad, sx: 0.6, sy: 0.49, sz: 1, tint,
        }]);
      }
      case 'herb':
        return this.crossSlots('herb_patch', 2, 0.62, 0.37, WHITE);
      case 'flowers': {
        const keys = ['flower_white', 'flower_yellow', 'flower_purple'];
        return this.crossSlots(keys[seed % 3], 2, 0.6, 0.42, WHITE);
      }
      case 'grass': {
        // Reeds and dry tufts are 3D builds, not flat tuft sprites.
        if (state.natural?.variant === 'reed' || state.natural?.variant === 'dry') return null;
        // Gatherable grass （草むら）: four crossed planes, taller and
        // denser than the scenery tufts (which are now height-capped
        // and thinned around nodes), with a warm-green tint — the
        // clump must read as its own thing at a glance.
        const key = this.gpt.grass_wide ? 'grass_wide' : 'grass_short';
        return this.crossSlots(key, 4, 1.05, 0.85, new THREE.Color(1.05, 1.12, 0.85));
      }
      case 'water':
      case 'oil': {
        const water = state.type === 'water';
        const cyl = this.shapePool(
          water ? 'waterCyl' : 'oilCyl',
          () => new THREE.CylinderGeometry(0.5, water ? 0.56 : 0.57, 1, 18),
          new THREE.MeshStandardMaterial(water
            ? { color: 0x2e7cc2, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.92 }
            : { color: 0x16120e, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.97 }),
          96,
        );
        const sheen = this.shapePool(
          water ? 'waterSheen' : 'oilSheen',
          () => { const c = new THREE.CircleGeometry(0.5, 18); c.rotateX(-Math.PI / 2); return c; },
          new THREE.MeshStandardMaterial(water
            ? { color: 0x9fd0ee, roughness: 0.1, transparent: true, opacity: 0.4 }
            : { color: 0x6a5a8c, roughness: 0.15, transparent: true, opacity: 0.3 }),
          96,
        );
        const stones = this.shapePool(
          'rimStones',
          () => { const g = new THREE.IcosahedronGeometry(0.5, 1); jitterRock(g, 0.18); return g; },
          new THREE.MeshStandardMaterial({
            map: this.gpt.rock_layered ?? this.rockCrackTex, color: 0xbdbdc2, roughness: 0.98,
          }),
          512,
        );
        stones.mesh.castShadow = true;
        const stoneCount = water ? 6 : 3;
        if (cyl.free < 1 || sheen.free < 1 || stones.free < stoneCount) return null;
        const slots: SlotRef[] = [];
        slots.push({
          pool: cyl, index: cyl.alloc(), dx: 0, dy: water ? 0.05 : 0.045, dz: 0, yaw: 0,
          sx: water ? 1.32 : 1.28, sy: water ? 0.1 : 0.09, sz: water ? 1.32 : 1.28, tint: WHITE,
        });
        slots.push({
          pool: sheen, index: sheen.alloc(), dx: 0, dy: water ? 0.105 : 0.095, dz: 0, yaw: 0,
          sx: water ? 0.84 : 0.8, sy: 1, sz: water ? 0.84 : 0.8, tint: WHITE,
        });
        for (let i = 0; i < stoneCount; i++) {
          const a = (i / stoneCount) * Math.PI * 2 + (water ? seed : seed * 0.7);
          const d = water ? (i % 2 === 0 ? 0.22 : 0.3) : 0.32;
          slots.push({
            pool: stones, index: stones.alloc(),
            dx: Math.cos(a) * (water ? 0.66 : 0.62), dy: water ? 0.05 : 0.08, dz: Math.sin(a) * (water ? 0.66 : 0.62),
            yaw: a, sx: d, sy: d * 0.6, sz: d, tint: WHITE,
          });
        }
        return slots;
      }
      default:
        return null;
    }
  }

  /** Instanced depleted forms; [] = handled, draw nothing. */
  private buildInstancedDepleted(state: ResourceVisualState, seed: number): SlotRef[] | null {
    switch (state.type) {
      case 'grass':
      case 'herb':
      case 'flowers': {
        const pool = this.spritePool('prop_cut_patch', true);
        if (!pool) return null;
        return this.allocSlots(pool, [{
          dx: 0, dy: 0.03, dz: 0, yaw: seed * 1.7, sx: 0.85, sy: 1, sz: 0.85, tint: WHITE,
        }]);
      }
      case 'branch':
      case 'pebble':
      case 'water':
      case 'oil':
        // Bare ground, exactly as the group path draws it.
        return [];
      default:
        return null;
    }
  }

  /* ---------------- group builder (large kinds) ---------------- */

  private buildNode(state: ResourceVisualState, seed = 0): {
    group: THREE.Group;
    pulseMaterials: THREE.MeshStandardMaterial[];
  } {
    const g = new THREE.Group();
    const pulseMaterials: THREE.MeshStandardMaterial[] = [];
    const std = (color: number, rough = 0.9) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
      pulseMaterials.push(m);
      return m;
    };
    const wood = std(0x7a5230, 0.95);
    wood.map = this.gpt.bark_deep ?? this.barkTex;
    wood.color.set(0xffffff);
    const leaf = std(0x55963f);
    leaf.map = this.foliageTex;
    const rockM = std(0x8d8d90, 0.98);
    rockM.map = this.gpt.rock_layered ?? this.rockCrackTex;
    rockM.color.set(0xbdbdc2);
    // Game-owned variant tinting (NATURAL-OBJECTS-CONTRACT): basalt
    // rocks are black rocks, flint pebbles read darker than round
    // stones. Materials are per-node, so tinting is safe.
    const variant = state.natural?.variant ?? null;
    if (variant === 'basalt') rockM.color.set(0x48484f);
    if (variant === 'flint') rockM.color.set(0x5c5c64);
    // Volcanic rock (world expansion): near-black basalt, a touch
    // warmer than the 'basalt' tint so the two never read identical.
    if (variant === 'volcanic') rockM.color.set(0x3a3532);
    /** Upright GPT sprite prop, bottom at the ground contact point,
     *  facing the (fixed) camera azimuth. */
    const sprite = (tex: THREE.Texture | undefined, w: number, h: number,
      tint?: THREE.Color): THREE.Mesh | null => {
      if (!tex) return null;
      const m = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.95,
        // A flat plane facing away from the low sun would go nearly
        // black; a soft texture-tinted emissive keeps props readable
        // (they must stay identifiable as harvest targets).
        emissive: 0x66553d,
        emissiveMap: tex,
        emissiveIntensity: 0.38,
      });
      if (tint) m.color.copy(tint);
      pulseMaterials.push(m);
      const geo = this.geo(`plane:${w}x${h}`, () => {
        const p = new THREE.PlaneGeometry(w, h);
        p.translate(0, h / 2, 0);
        return p;
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.y = this.yawRad - (state.rotationY ?? 0);
      return mesh;
    };
    /** Flat GPT sprite lying on the ground (cut patches, piles). */
    const flatSprite = (tex: THREE.Texture | undefined, size: number): THREE.Mesh | null => {
      if (!tex) return null;
      const m = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: 0.5,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      pulseMaterials.push(m);
      const geo = this.geo(`flat:${size}`, () => new THREE.PlaneGeometry(size, size * 0.75));
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = seed * 1.7;
      mesh.position.y = 0.03;
      mesh.receiveShadow = true;
      return mesh;
    };
    const add = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };

    if (state.depleted) {
      if (state.type === 'tree') {
        // GPT stump sprite; the low cylinder remains as a fallback.
        const spr = sprite(this.gpt.prop_stump, 1.05, 0.79);
        if (spr) g.add(spr);
        else {
          const stump = add(new THREE.Mesh(
            this.geo('stump', () => new THREE.CylinderGeometry(0.22, 0.3, 0.4, 8)), wood));
          stump.position.y = 0.2;
          const top = add(new THREE.Mesh(
            this.geo('stumpTop', () => new THREE.CylinderGeometry(0.22, 0.22, 0.03, 8)), std(0xc8a165, 1)));
          top.position.y = 0.41;
        }
      } else if (state.type === 'rock' || state.type === 'ore') {
        const spr = sprite(this.gpt.prop_rubble, 1.1, 0.78);
        if (spr) g.add(spr);
        else {
          for (let i = 0; i < 3; i++) {
            const r = add(new THREE.Mesh(
              this.geo('rubbleJit', () => { const geo = new THREE.IcosahedronGeometry(0.22, 0); jitterRock(geo); return geo; }),
              rockM));
            r.position.set((i - 1) * 0.3, 0.12, (i % 2) * 0.25 - 0.1);
          }
        }
      } else if (
        state.type === 'herb' || state.type === 'flowers' ||
        state.type === 'grass' || state.type === 'bush'
      ) {
        // Cut patch sprite (cropped stubble), so a harvested spot
        // stays readable instead of vanishing into bare ground.
        const flat = flatSprite(this.gpt.prop_cut_patch, 0.85);
        if (flat) g.add(flat);
        else {
          const patch = add(new THREE.Mesh(
            this.geo('patchCyl', () => new THREE.CylinderGeometry(0.32, 0.34, 0.05, 10)), std(0x5d7031, 1)));
          patch.position.y = 0.025;
        }
      }
      // branch / pebble and other depleted types show bare ground:
      // the game marks pickups collected via visible=false / removal.
      return { group: g, pulseMaterials };
    }

    switch (state.type) {
      case 'tree': {
        // Canopy built from branch-spray cards (2026-11-07): crossed
        // leafy-branch planes along limbs, in three silhouettes
        // picked deterministically from the node id — the same id
        // always grows the same tree. The trunk (and only the trunk)
        // is what the game's footprint describes; the cards never
        // take part in collision. When the bundled spray WebPs
        // failed to decode, the procedural reserve sprays take
        // their place in the same build — the canopy never reverts
        // to solid leaf blobs (Claude 2026-11-07 §12-4).
        const sr = (n: number) => {
          const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
          return v - Math.floor(v);
        };
        const sprays = this.spraySet();
        if (variant === 'conifer' || variant === 'conifer-snow') {
          // Conifer (world expansion, 2026-11-07): a straight tall
          // trunk with four tiers of spray cards — a triangular
          // silhouette that stays distinct from the broadleaf
          // archetypes at any camera yaw. Species is picked
          // deterministically from the node seed: cedar (strongly
          // drooping), pine (wide flat tiers) or young (small,
          // bright). Since the GPT expansion set, the tiers use the
          // dedicated conifer sprays instead of borrowing broadleaf
          // art; 'conifer-snow' uses the snow-laden spray (the snow
          // rides on the branches in the art — the tree is NOT
          // painted white). Depleted form stays the shared stump.
          const snow = variant === 'conifer-snow';
          const species = snow ? 0 : Math.floor(sr(7) * 3); // 0 cedar, 1 pine, 2 young
          const coniferTex = snow
            ? this.expansion.snow_conifer
            : [this.expansion.conifer_cedar, this.expansion.conifer_pine,
               this.expansion.conifer_young][species];
          const tierTex = coniferTex ?? sprays[species % sprays.length];
          const tipTex = snow ? tierTex : (this.expansion.conifer_tip ?? tierTex);
          const trunk = add(new THREE.Mesh(
            this.geo('trunk', () => new THREE.CylinderGeometry(0.14, 0.26, 1.8, 7)), wood));
          const heightMul = species === 2 ? 0.82 : 1;
          trunk.scale.set(0.72, 1.55 * heightMul, 0.72);
          trunk.position.y = 1.4 * heightMul;
          const tint: [number, number, number] = snow
            ? [0.92, 0.97, 1.0]
            : species === 0 ? [0.50, 0.70, 0.50]
            : species === 1 ? [0.56, 0.76, 0.50] : [0.64, 0.84, 0.54];
          const card = (
            tex: THREE.Texture, x: number, y: number, z: number,
            yaw: number, tiltX: number, w: number, shade: number,
          ) => {
            const m = new THREE.MeshStandardMaterial({
              map: tex,
              alphaTest: 0.45,
              side: THREE.DoubleSide,
              roughness: 0.95,
              color: new THREE.Color(shade * tint[0], shade * tint[1], shade * tint[2]),
            });
            pulseMaterials.push(m);
            const img = tex.image as { width: number; height: number } | undefined;
            const aspect = img && img.width > 0 ? img.height / img.width : 0.87;
            const mesh = new THREE.Mesh(
              this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
            mesh.position.set(x, y, z);
            mesh.rotation.set(tiltX, yaw, 0);
            mesh.scale.set(w, w * aspect, w);
            mesh.receiveShadow = true;
            g.add(mesh);
          };
          // Snow-laden tiers lie flatter (shelves, not slats) and
          // shade deeper, or the pale snow art stacks into a washed
          // totem (first verification shot, 2026-11-07).
          const droop = snow ? 1.08 : species === 0 ? 1.0 : species === 1 ? 0.5 : 0.75;
          const wide = species === 1 ? 1.15 : snow ? 0.92 : 1;
          const tiers = [
            { y: 1.7, w: 1.85 }, { y: 2.3, w: 1.5 },
            { y: 2.85, w: 1.15 }, { y: 3.35, w: 0.8 },
          ];
          tiers.forEach((t, ti) => {
            for (let c = 0; c < 3; c++) {
              const az = sr(200 + ti * 7 + c) * Math.PI * 2;
              card(
                tierTex,
                Math.cos(az) * t.w * 0.2, t.y * heightMul, Math.sin(az) * t.w * 0.2,
                az + Math.PI / 2, droop + sr(260 + ti * 7 + c) * 0.25,
                t.w * wide, (snow ? 0.62 : 0.78) + ti * 0.08);
            }
          });
          card(tipTex, 0, 3.78 * heightMul, 0, sr(296) * Math.PI, 0.2, 0.66, 1.0);
          break;
        }
        if (variant === 'winter') {
          // Bare winter broadleaf (GPT expansion): trunk + rising
          // limbs carrying the snow-dusted bare-branch spray, one
          // icicle branch hanging low. No leaves at all — the
          // silhouette is the branch structure itself.
          const trunk = add(new THREE.Mesh(
            this.geo('trunk', () => new THREE.CylinderGeometry(0.14, 0.26, 1.8, 7)), wood));
          trunk.scale.set(1, 1.45, 1);
          trunk.position.y = 1.3;
          const branchTex = this.expansion.snow_broadleaf ?? sprays[0];
          const icicleTex = this.expansion.snow_icicle;
          const up = new THREE.Vector3(0, 1, 0);
          for (let i = 0; i < 5; i++) {
            const az = (i / 5) * Math.PI * 2 + sr(300 + i) * 0.9;
            const tilt = 0.55 + sr(310 + i) * 0.45;
            const dir = new THREE.Vector3(
              Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
            const limb = add(new THREE.Mesh(
              this.geo('limb', () => new THREE.CylinderGeometry(0.035, 0.07, 1.5, 5)), wood));
            limb.quaternion.setFromUnitVectors(up, dir);
            limb.position.set(dir.x * 0.6, 2.2 + dir.y * 0.6, dir.z * 0.6);
            const m = new THREE.MeshStandardMaterial({
              map: branchTex, alphaTest: 0.45, side: THREE.DoubleSide,
              roughness: 0.95, color: new THREE.Color(0.95, 0.98, 1.02),
            });
            pulseMaterials.push(m);
            const img = branchTex.image as { width: number; height: number } | undefined;
            const aspect = img && img.width > 0 ? img.height / img.width : 0.87;
            const tip = new THREE.Vector3(dir.x * 1.25, 2.2 + dir.y * 1.25, dir.z * 1.25);
            const w = 1.45 + sr(320 + i) * 0.35;
            // Two crossed cards per limb tip: a single plane reads
            // edge-on from half the orbit angles.
            for (let k = 0; k < 2; k++) {
              const cardM = new THREE.Mesh(
                this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
              cardM.position.copy(tip);
              cardM.rotation.set(0.35, az + Math.PI / 2 + k * (Math.PI / 2.2), 0);
              cardM.scale.set(w, w * aspect, w);
              cardM.receiveShadow = true;
              g.add(cardM);
            }
          }
          if (icicleTex) {
            const m = new THREE.MeshStandardMaterial({
              map: icicleTex, alphaTest: 0.45, side: THREE.DoubleSide,
              roughness: 0.9, color: new THREE.Color(0.95, 0.98, 1.02),
            });
            pulseMaterials.push(m);
            const cardM = new THREE.Mesh(
              this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
            cardM.position.set(0.75, 2.3, 0.3);
            cardM.rotation.set(0.15, 0.7, 0);
            cardM.scale.set(0.95, 0.83, 0.95);
            cardM.receiveShadow = true;
            g.add(cardM);
          }
          break;
        }
        if (variant === 'palm') {
          // Palm (GPT expansion): a leaning segmented trunk and a
          // crown of arcing frond cards. Fronds radiate at varied
          // yaw / droop so the crown reads in the round.
          const frondTex = this.expansion.palm_frond ?? sprays[1];
          const lean = sr(330) * Math.PI * 2;
          const lx = Math.cos(lean), lz = Math.sin(lean);
          let px = 0, pz = 0;
          for (let sgm = 0; sgm < 4; sgm++) {
            const seg = add(new THREE.Mesh(
              this.geo('palmSeg', () => new THREE.CylinderGeometry(0.13, 0.16, 1.05, 7)), wood));
            px += lx * 0.16; pz += lz * 0.16;
            seg.position.set(px * (sgm + 1) * 0.55, 0.5 + sgm * 0.92, pz * (sgm + 1) * 0.55);
            seg.rotation.set(lz * 0.17, 0, -lx * 0.17);
          }
          const topX = px * 4 * 0.55, topZ = pz * 4 * 0.55, topY = 4.15;
          for (let i = 0; i < 7; i++) {
            const az = (i / 7) * Math.PI * 2 + sr(340 + i) * 0.5;
            const m = new THREE.MeshStandardMaterial({
              map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide,
              roughness: 0.95, color: new THREE.Color(0.85, 1.0, 0.72),
            });
            pulseMaterials.push(m);
            const img = frondTex.image as { width: number; height: number } | undefined;
            const aspect = img && img.width > 0 ? img.height / img.width : 0.87;
            const cardM = new THREE.Mesh(
              this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
            cardM.position.set(topX, topY, topZ);
            cardM.rotation.set(0.55 + sr(350 + i) * 0.55, az + Math.PI / 2, 0);
            const w = 1.7 + sr(360 + i) * 0.4;
            cardM.scale.set(w, w * aspect, w);
            cardM.receiveShadow = true;
            g.add(cardM);
          }
          for (let i = 0; i < 2; i++) {
            const nut = add(new THREE.Mesh(
              this.geo('coconut', () => new THREE.SphereGeometry(0.13, 8, 6)), std(0x6b4e2e, 1)));
            nut.position.set(topX + (i - 0.5) * 0.24, topY - 0.22, topZ + 0.08 * i);
          }
          break;
        }
        const arch = Math.floor(sr(1) * 3); // 0 wide, 1 tall, 2 young
        // Round 22 individuality: a slight trunk lean with the
        // crown biased the same way, and per-tree height jitter —
        // two trees of one archetype no longer stand as twins.
        const leanX = (sr(500) - 0.5) * 0.24;
        const leanZ = (sr(501) - 0.5) * 0.24;
        const trunkH = (arch === 1 ? 2.25 : arch === 2 ? 1.45 : 1.8) * (0.92 + sr(502) * 0.16);
        const trunk = add(new THREE.Mesh(
          this.geo('trunk', () => new THREE.CylinderGeometry(0.14, 0.26, 1.8, 7)), wood));
        trunk.scale.set(arch === 2 ? 0.8 : 1, trunkH / 1.8, arch === 2 ? 0.8 : 1);
        trunk.position.y = trunkH / 2;
        trunk.rotation.set(leanZ * 0.4, 0, -leanX * 0.4);
        {
          const crownY = arch === 1 ? 2.85 : arch === 2 ? 1.95 : 2.45;
          const clusters = arch === 1 ? 6 : arch === 2 ? 5 : 8;
          const spreadR = arch === 1 ? 0.45 : arch === 2 ? 0.4 : 0.85;
          const cardW = arch === 1 ? 1.35 : arch === 2 ? 1.1 : 1.55;
          const baseAz = sr(2) * Math.PI * 2;
          const up = new THREE.Vector3(0, 1, 0);
          // Limbs reaching toward the cluster ring.
          for (let c = 0; c < clusters; c++) {
            const az = baseAz + (c / clusters) * Math.PI * 2 + (sr(10 + c) - 0.5) * 0.6;
            const tilt = 0.55 + sr(20 + c) * 0.35;
            const dir = new THREE.Vector3(
              Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
            const limb = add(new THREE.Mesh(
              this.geo('limb', () => new THREE.CylinderGeometry(0.045, 0.09, 1.1, 5)), wood));
            limb.quaternion.setFromUnitVectors(up, dir);
            limb.position.copy(dir).multiplyScalar(0.5);
            limb.position.y += trunkH - 0.35;
          }
          const sprayCard = (
            tex: THREE.Texture, x: number, y: number, z: number,
            yaw: number, tiltX: number, roll: number, w: number, shade: number,
          ) => {
            const m = new THREE.MeshStandardMaterial({
              map: tex,
              alphaTest: 0.45,
              side: THREE.DoubleSide,
              roughness: 0.95,
              color: new THREE.Color(shade * 0.84, shade * 0.97, shade * 0.74),
            });
            pulseMaterials.push(m);
            const img = tex.image as { width: number; height: number } | undefined;
            const aspect = img && img.width > 0 ? img.height / img.width : 0.87;
            const mesh = new THREE.Mesh(
              this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
            mesh.position.set(x, y, z);
            mesh.rotation.set(tiltX, yaw, roll);
            mesh.scale.set(w, w * aspect, w);
            mesh.receiveShadow = true;
            g.add(mesh);
          };
          for (let c = 0; c < clusters; c++) {
            const az = baseAz + (c / clusters) * Math.PI * 2 + (sr(10 + c) - 0.5) * 0.6;
            const rr = spreadR * (0.5 + sr(30 + c) * 0.55);
            const cx = Math.cos(az) * rr + leanX;
            const cz = Math.sin(az) * rr + leanZ;
            const cy = crownY + (sr(40 + c) - 0.5) * 0.6;
            for (let p = 0; p < 2; p++) {
              const tex = c === clusters - 1 && p === 1 && this.branch.branch_3
                ? this.branch.branch_3
                : sprays[Math.floor(sr(50 + c * 2 + p) * sprays.length) % sprays.length];
              sprayCard(tex, cx, cy, cz,
                az + Math.PI / 2 + p * (Math.PI / 2) + (sr(60 + c * 2 + p) - 0.5) * 0.6,
                -0.3 + sr(70 + c * 2 + p) * 0.45, (sr(80 + c * 2 + p) - 0.5) * 0.5,
                cardW * (0.85 + sr(90 + c * 2 + p) * 0.35), 0.85 + sr(100 + c * 2 + p) * 0.15);
            }
          }
          // Inner depth sprays: dark olive, deep in the crown —
          // three of them since 2026-11-07 (Claude §12-2: the
          // crown read thin and yellow-green; more cards and a
          // calmer, deeper green).
          sprayCard(sprays[Math.floor(sr(3) * sprays.length) % sprays.length],
            leanX, crownY - 0.25, leanZ, sr(4) * Math.PI, -0.2, 0, cardW * 1.05, 0.36);
          sprayCard(sprays[Math.floor(sr(6) * sprays.length) % sprays.length],
            0.3 + leanX, crownY - 0.05, -0.24 + leanZ, sr(5) * Math.PI, -0.1, 0.15, cardW * 0.9, 0.48);
          sprayCard(sprays[Math.floor(sr(8) * sprays.length) % sprays.length],
            -0.3 + leanX, crownY - 0.12, 0.26 + leanZ, sr(7) * Math.PI, -0.15, -0.1, cardW * 0.95, 0.6);
        }
        break;
      }
      case 'rock': {
        // Plain rock: no crystal (Claude 2026-11-06 — the crystal made
        // every rock read as an ore deposit). Crystals live on 'ore'.
        // Round 22: the ONE shared jittered icosahedron is retired —
        // six plane-cut family geometries (the environment set's
        // fractured-rock recipe) are picked by the id hash, then a
        // per-instance stream varies proportions, tilt and embed,
        // and a cluster recipe sets child rocks + rubble at the
        // base. Silhouettes differ; colour is never the only
        // variation. Footprint (SPECS) is untouched.
        const rr = mulberry32(seed ^ 0x51ab32);
        const fam = Math.abs(seed) % 6;
        const rock = add(new THREE.Mesh(
          this.geo(`rockFam${fam}`, () => fracturedRockGeometry(0.85, 4100 + fam * 137)),
          rockM));
        const embed = rr() * 0.12;
        rock.position.y = 0.45 - embed;
        rock.scale.set(1.15 * (0.88 + rr() * 0.3), 0.8 * (0.8 + rr() * 0.35), 1.0 * (0.88 + rr() * 0.3));
        rock.rotation.set((rr() - 0.5) * 0.14, rr() * Math.PI * 2, (rr() - 0.5) * 0.14);
        const children = 1 + Math.floor(rr() * 2);
        for (let ci = 0; ci < children; ci++) {
          const cf = (fam + 1 + ci) % 6;
          const child = add(new THREE.Mesh(
            this.geo(`rockFam${cf}`, () => fracturedRockGeometry(0.85, 4100 + cf * 137)),
            rockM));
          const ca = rr() * Math.PI * 2;
          const cd = 0.78 + rr() * 0.3;
          const cs = 0.3 + rr() * 0.22;
          child.position.set(Math.cos(ca) * cd, 0.1 + rr() * 0.05, Math.sin(ca) * cd);
          child.scale.set(cs, cs * (0.65 + rr() * 0.3), cs);
          child.rotation.set((rr() - 0.5) * 0.3, rr() * Math.PI * 2, (rr() - 0.5) * 0.3);
        }
        for (let pi = 0; pi < 2; pi++) {
          const peb = add(new THREE.Mesh(
            this.geo('rubbleJit', () => { const geo = new THREE.IcosahedronGeometry(0.22, 0); jitterRock(geo); return geo; }),
            rockM));
          const pa = rr() * Math.PI * 2;
          peb.position.set(Math.cos(pa) * (0.7 + rr() * 0.35), 0.07, Math.sin(pa) * (0.7 + rr() * 0.35));
          peb.scale.setScalar(0.5 + rr() * 0.5);
        }
        if (variant === 'mossy') {
          // Mossy rock (world expansion, 2026-11-07): flattened moss
          // pads settled on the top and shoulders — colour and a
          // soft silhouette break, same footprint as a plain rock.
          const mossM = std(0x51652c, 1);
          const mr = (n: number) => {
            const v = Math.sin(seed * 57.3 + n * 91.7) * 43758.5453;
            return v - Math.floor(v);
          };
          for (let i = 0; i < 3; i++) {
            const b = add(new THREE.Mesh(
              this.geo(`mossPad${i % 2}`, () => new THREE.IcosahedronGeometry(0.3, 0)), mossM));
            b.scale.set(1, 0.3, 0.8);
            b.position.set(
              (mr(i * 3) - 0.5) * 0.9 * rock.scale.x,
              rock.position.y + (0.47 + mr(i * 3 + 1) * 0.14) * (rock.scale.y / 0.8),
              (mr(i * 3 + 2) - 0.5) * 0.7 * rock.scale.z);
          }
        }
        break;
      }
      case 'ore': {
        // Ore-bearing rock: the host rock plus a small crystal cluster
        // (quartz white + amber) so the deposit reads at a glance.
        const orr = mulberry32(seed ^ 0x77cd19);
        const ofam = Math.abs(seed) % 6;
        const rock = add(new THREE.Mesh(
          this.geo(`rockFam${ofam}`, () => fracturedRockGeometry(0.85, 4100 + ofam * 137)),
          rockM));
        rock.position.y = 0.45 - orr() * 0.08;
        rock.scale.set(1.15 * (0.92 + orr() * 0.2), 0.8 * (0.85 + orr() * 0.25), 1.0 * (0.92 + orr() * 0.2));
        rock.rotation.set((orr() - 0.5) * 0.07, orr() * Math.PI * 2, (orr() - 0.5) * 0.07);
        const quartz = std(0xf3ead8, 0.25);
        const amber = std(0xd9a441, 0.35);
        const crystals: Array<[number, number, number, number, THREE.MeshStandardMaterial]> = [
          [0.45, 0.85, 0.3, 0.2, quartz],
          [-0.32, 0.68, 0.4, 0.13, amber],
          [0.08, 0.92, -0.36, 0.11, quartz],
        ];
        for (const [cx, cy, cz, cs, cm] of crystals) {
          const c = add(new THREE.Mesh(
            this.geo('crystal', () => new THREE.OctahedronGeometry(1)), cm));
          c.position.set(cx, cy, cz);
          c.scale.set(cs, cs * 1.6, cs);
        }
        break;
      }
      case 'water': {
        // Group-path fallback for the spring pool (the instanced
        // path is the norm; this covers pool exhaustion only).
        const waterM = new THREE.MeshStandardMaterial({
          color: 0x2e7cc2, roughness: 0.12, metalness: 0.05,
          transparent: true, opacity: 0.92,
        });
        pulseMaterials.push(waterM);
        const pool = add(new THREE.Mesh(
          this.geo('waterCyl', () => new THREE.CylinderGeometry(0.62, 0.7, 0.1, 18)), waterM));
        pool.position.y = 0.05;
        pool.castShadow = false;
        const sheen = new THREE.MeshStandardMaterial({
          color: 0x9fd0ee, roughness: 0.1, transparent: true, opacity: 0.4,
        });
        pulseMaterials.push(sheen);
        const top = add(new THREE.Mesh(
          this.geo('sheenCircle', () => new THREE.CircleGeometry(0.42, 18)), sheen));
        top.rotation.x = -Math.PI / 2;
        top.position.y = 0.105;
        top.castShadow = false;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + seed;
          const s = add(new THREE.Mesh(
            this.geo(`rimStone${i % 2}`, () => new THREE.SphereGeometry(0.11 + (i % 2) * 0.04, 7, 6)), rockM));
          s.scale.y = 0.6;
          s.position.set(Math.cos(a) * 0.66, 0.05, Math.sin(a) * 0.66);
        }
        break;
      }
      case 'oil': {
        const oilM = new THREE.MeshStandardMaterial({
          color: 0x16120e, roughness: 0.18, metalness: 0.1,
          transparent: true, opacity: 0.97,
        });
        pulseMaterials.push(oilM);
        const pool = add(new THREE.Mesh(
          this.geo('oilCyl', () => new THREE.CylinderGeometry(0.6, 0.68, 0.09, 18)), oilM));
        pool.position.y = 0.045;
        pool.castShadow = false;
        const sheen = new THREE.MeshStandardMaterial({
          color: 0x6a5a8c, roughness: 0.15, transparent: true, opacity: 0.3,
        });
        pulseMaterials.push(sheen);
        const top = add(new THREE.Mesh(
          this.geo('sheenCircle', () => new THREE.CircleGeometry(0.42, 18)), sheen));
        top.rotation.x = -Math.PI / 2;
        top.position.y = 0.095;
        top.castShadow = false;
        const darkRock = std(0x33302c, 1);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + seed * 0.7;
          const r = add(new THREE.Mesh(
            this.geo('oilRock', () => { const geo = new THREE.IcosahedronGeometry(0.16, 0); jitterRock(geo); return geo; }),
            darkRock));
          r.position.set(Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62);
        }
        break;
      }
      case 'branch': {
        if (variant === 'log' || variant === 'driftwood') {
          // Fallen log (world expansion, 2026-11-07): a thick trunk
          // section lying on the ground — bark side, pale cut faces
          // at both ends, moss settling on top. Distinct from the
          // 'branch' pickup twig in both size and silhouette.
          // Driftwood is the same form bleached by sun and water:
          // pale grey-tan bark, paler caps, and NO moss.
          const drift = variant === 'driftwood';
          if (drift) wood.color.set(0xcfc4ae);
          const yawA = seed * 1.3;
          const axis = { x: -Math.cos(yawA), z: Math.sin(yawA) };
          const log = add(new THREE.Mesh(
            this.geo('logCyl', () => new THREE.CylinderGeometry(0.17, 0.19, 1.7, 9)), wood));
          log.rotation.set(0, yawA, Math.PI / 2);
          log.position.y = 0.15;
          const capM = std(drift ? 0xd8c9a8 : 0xc8a165, 1);
          for (const s of [-1, 1]) {
            const cap = add(new THREE.Mesh(
              this.geo('logCap', () => new THREE.CylinderGeometry(0.165, 0.165, 0.04, 9)), capM));
            cap.rotation.set(0, yawA, Math.PI / 2);
            cap.position.set(axis.x * 0.86 * s, 0.15, axis.z * 0.86 * s);
          }
          if (!drift) {
            const mossM = std(0x51652c, 1);
            for (const [along, side] of [[-0.4, 0.05], [0.3, -0.06]] as const) {
              const b = add(new THREE.Mesh(
                this.geo('logMoss', () => new THREE.IcosahedronGeometry(0.16, 0)), mossM));
              b.scale.set(1.4, 0.35, 0.9);
              b.position.set(axis.x * along - axis.z * side, 0.31, axis.z * along + axis.x * side);
              b.rotation.y = yawA;
            }
          }
          break;
        }
        const spr = sprite(this.gpt.prop_branch, 0.95, 0.78);
        if (spr) g.add(spr);
        else {
          const main = add(new THREE.Mesh(
            this.geo('branchCyl', () => new THREE.CylinderGeometry(0.04, 0.06, 1.0, 6)), wood));
          main.rotation.z = Math.PI / 2;
          main.rotation.y = 0.4;
          main.position.y = 0.06;
        }
        break;
      }
      case 'pebble': {
        const spr = sprite(this.gpt.prop_pebbles, 0.6, 0.49);
        if (spr) {
          if (variant === 'flint') {
            (spr.material as THREE.MeshStandardMaterial).color.set(0x8f8f98);
          }
          g.add(spr);
        } else {
          for (let i = 0; i < 3; i++) {
            const p = add(new THREE.Mesh(
              this.geo(`pebbleS${i % 2}`, () => new THREE.SphereGeometry(0.13 + (i % 2) * 0.05, 8, 6)), rockM));
            p.scale.y = 0.6;
            p.position.set((i - 1) * 0.22, 0.06, (i % 2) * 0.16 - 0.06);
          }
        }
        break;
      }
      case 'herb': {
        const spr = sprite(this.gpt.herb_patch, 0.62, 0.37);
        if (spr) {
          g.add(spr);
          const spr2 = sprite(this.gpt.herb_patch, 0.62, 0.37);
          if (spr2) {
            spr2.rotation.y += Math.PI / 2;
            g.add(spr2);
          }
        } else {
          for (let i = 0; i < 5; i++) {
            const blade = add(new THREE.Mesh(
              this.geo('herbCone', () => new THREE.ConeGeometry(0.09, 0.55, 5)), leaf));
            const a = (i / 5) * Math.PI * 2;
            blade.position.set(Math.cos(a) * 0.16, 0.26, Math.sin(a) * 0.16);
            blade.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
          }
        }
        break;
      }
      case 'flowers': {
        const texes = [this.gpt.flower_white, this.gpt.flower_yellow, this.gpt.flower_purple];
        const spr = sprite(texes[seed % 3], 0.6, 0.42);
        if (spr) {
          g.add(spr);
          const spr2 = sprite(texes[seed % 3], 0.6, 0.42);
          if (spr2) {
            spr2.rotation.y += Math.PI / 2;
            g.add(spr2);
          }
        } else {
          const stemM = std(0x4d7d3a);
          const headM = std(0xff9ec4, 0.6);
          for (let i = 0; i < 4; i++) {
            const x = (i % 2) * 0.4 - 0.2;
            const z = Math.floor(i / 2) * 0.4 - 0.2;
            const stem = add(new THREE.Mesh(
              this.geo('flowerStem', () => new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5)), stemM));
            stem.position.set(x, 0.2, z);
            const head = add(new THREE.Mesh(
              this.geo('flowerHead', () => new THREE.IcosahedronGeometry(0.11, 0)), headM));
            head.position.set(x, 0.45, z);
          }
        }
        break;
      }
      case 'grass': {
        if (variant === 'reed') {
          // Reeds (GPT expansion): tall crossed cards of the
          // cattail spray for shore placement. The stems stay in
          // the texture (they root at the card base), so the cards
          // root at ground level and sway is left to the shaderless
          // wind convention — cards only, no trunk to bend.
          const reedTex = this.expansion.reed;
          if (reedTex) {
            for (let i = 0; i < 3; i++) {
              const m = new THREE.MeshStandardMaterial({
                map: reedTex, alphaTest: 0.45, side: THREE.DoubleSide,
                roughness: 0.95, color: new THREE.Color(0.92, 1.0, 0.82),
              });
              pulseMaterials.push(m);
              const img = reedTex.image as { width: number; height: number } | undefined;
              const aspect = img && img.width > 0 ? img.height / img.width : 1;
              const cardM = new THREE.Mesh(
                this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
              const w = 1.12;
              cardM.scale.set(w, w * aspect, w);
              cardM.position.set(0, (w * aspect) / 2 - 0.06, 0);
              cardM.rotation.y = (i * Math.PI) / 3 + (seed % 7) * 0.06;
              cardM.receiveShadow = true;
              g.add(cardM);
            }
          }
          break;
        }
        if (variant === 'dry') {
          // Dry grass (world expansion): the same crossed-tuft build
          // gone straw-pale and shorter — desert / arid ground cover
          // that still reads as a gatherable clump, not scenery.
          const tex = this.gpt.grass_wide ?? this.gpt.grass_short;
          for (let i = 0; i < 3; i++) {
            const spr = sprite(tex, 1.0, 0.62, new THREE.Color(1.08, 0.94, 0.58));
            if (!spr) break;
            spr.rotation.y += (i * Math.PI) / 3;
            g.add(spr);
          }
          break;
        }
        // Group-path fallback for the gatherable grass clump (used
        // only when the instanced pool or its texture is unavailable):
        // same taller, denser, warm-tinted form as the pooled one.
        const tex = this.gpt.grass_wide ?? this.gpt.grass_short;
        let placed = false;
        for (let i = 0; i < 4; i++) {
          const spr = sprite(tex, 1.05, 0.85, new THREE.Color(1.05, 1.12, 0.85));
          if (!spr) break;
          spr.rotation.y += (i * Math.PI) / 4;
          g.add(spr);
          placed = true;
        }
        if (!placed) {
          for (let i = 0; i < 6; i++) {
            const blade = add(new THREE.Mesh(
              this.geo('grassCone', () => new THREE.ConeGeometry(0.1, 0.6, 5)), leaf));
            const a = (i / 6) * Math.PI * 2;
            blade.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
            blade.rotation.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
          }
        }
        break;
      }
      case 'bush': {
        // Gatherable bush （やぶ）: a low shrub built from the same
        // branch-spray cards as the tree canopies (Claude
        // 2026-11-07 §12-3: the old jittered leaf blobs read as
        // green balls next to the rebuilt trees). Short stems arc
        // out of the base; drooping / wide sprays lie low over
        // them and two sprays crown the top, with one dark spray
        // at the heart. Uses the same spray set as the trees, so
        // the reserve-spray fallback covers it too — no blobs.
        const bs = (n: number) => {
          const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
          return v - Math.floor(v);
        };
        // Variant art (GPT expansion): snow shrubs carry their snow
        // in the spray art; dry shrubs use the olive dry spray.
        let sprays = this.spraySet();
        if (variant === 'snow' && this.expansion.snow_shrub) {
          sprays = [this.expansion.snow_shrub];
        } else if (variant === 'dry' && this.expansion.dry_shrub) {
          sprays = [this.expansion.dry_shrub];
        }
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < 3; i++) {
          const az = (i / 3) * Math.PI * 2 + bs(1) * 1.2;
          const tilt = 0.5 + bs(10 + i) * 0.3;
          const dir = new THREE.Vector3(
            Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
          const stem = add(new THREE.Mesh(
            this.geo('bushStem', () => new THREE.CylinderGeometry(0.02, 0.04, 0.55, 5)), wood));
          stem.quaternion.setFromUnitVectors(up, dir);
          stem.position.copy(dir).multiplyScalar(0.24);
        }
        const bushCard = (
          tex: THREE.Texture, x: number, y: number, z: number,
          yaw: number, tiltX: number, roll: number, w: number, shade: number,
        ) => {
          const m = new THREE.MeshStandardMaterial({
            map: tex,
            alphaTest: 0.45,
            side: THREE.DoubleSide,
            roughness: 0.95,
            color: variant === 'snow'
              ? new THREE.Color(shade * 0.96, shade * 0.99, shade * 1.0)
              : variant === 'dry'
                ? new THREE.Color(shade * 0.98, shade * 0.94, shade * 0.72)
                : new THREE.Color(shade * 0.84, shade * 0.97, shade * 0.74),
          });
          pulseMaterials.push(m);
          const img = tex.image as { width: number; height: number } | undefined;
          const aspect = img && img.width > 0 ? img.height / img.width : 0.87;
          const mesh = new THREE.Mesh(
            this.geo('sprayCard', () => new THREE.PlaneGeometry(1, 1)), m);
          mesh.position.set(x, y, z);
          mesh.rotation.set(tiltX, yaw, roll);
          mesh.scale.set(w, w * aspect, w);
          mesh.receiveShadow = true;
          g.add(mesh);
        };
        // Lower ring: drooping / wide sprays (indices 2, 3 of the
        // set) arcing out and down.
        for (let i = 0; i < 3; i++) {
          const az = (i / 3) * Math.PI * 2 + bs(2) * 1.2;
          const tex = sprays[(2 + i) % sprays.length];
          bushCard(tex,
            Math.cos(az) * 0.13, 0.4, Math.sin(az) * 0.13,
            az + Math.PI / 2 + (bs(20 + i) - 0.5) * 0.5,
            -0.62 - bs(30 + i) * 0.25, (bs(40 + i) - 0.5) * 0.4,
            0.95 + bs(50 + i) * 0.12, 0.85 + bs(60 + i) * 0.13);
        }
        // Top pair, more upright.
        for (let i = 0; i < 2; i++) {
          const az = bs(3) * Math.PI + i * Math.PI * 0.9;
          const tex = sprays[Math.floor(bs(70 + i) * sprays.length) % sprays.length];
          bushCard(tex,
            Math.cos(az) * 0.05, 0.52, Math.sin(az) * 0.05,
            az + Math.PI / 2, -0.25 - bs(80 + i) * 0.2, (bs(90 + i) - 0.5) * 0.4,
            0.85, 0.88 + bs(100 + i) * 0.1);
        }
        // Dark heart.
        bushCard(sprays[Math.floor(bs(5) * sprays.length) % sprays.length],
          0, 0.34, 0, bs(6) * Math.PI, -0.35, 0, 0.8, 0.45);
        break;
      }
      case 'clay': {
        const mound = add(new THREE.Mesh(
          this.geo('clayMound', () => new THREE.SphereGeometry(0.6, 10, 8)), std(0xa9764e, 1)));
        mound.scale.y = 0.55;
        mound.position.y = 0.08;
        break;
      }
      case 'mushroom': {
        const stem = add(new THREE.Mesh(
          this.geo('mushStem', () => new THREE.CylinderGeometry(0.09, 0.13, 0.35, 8)), std(0xe8dcc3, 0.8)));
        stem.position.y = 0.17;
        const cap = add(new THREE.Mesh(
          this.geo('mushCap', () => new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), std(0xb8452e, 0.7)));
        cap.position.y = 0.34;
        break;
      }
      case 'lily': {
        // Water lilies (GPT expansion): the pad cluster lies flat on
        // the water surface — the long stems of the source art are
        // NOT stood up. Two overlapping pads at slightly different
        // scales/rotations break the single-stamp look. Pads anchor
        // to the world water level (not the bed height under the
        // node), so they float correctly anywhere in the shallows;
        // on dry ground they settle to the ground instead.
        const lilyTex = this.expansion.lily;
        if (lilyTex) {
          const bedY = this.groundHeightAt(state.position.x, state.position.z);
          const floatY = THREE.MathUtils.clamp(
            this.waterLevel + 0.02 - bedY, 0.03, 1.4);
          for (let i = 0; i < 2; i++) {
            const m = new THREE.MeshStandardMaterial({
              map: lilyTex, alphaTest: 0.45, side: THREE.DoubleSide,
              roughness: 0.7, color: new THREE.Color(0.95, 1.02, 0.9),
            });
            pulseMaterials.push(m);
            const pad = new THREE.Mesh(
              this.geo('lilyPad', () => new THREE.PlaneGeometry(1, 1)), m);
            const w = i === 0 ? 1.05 : 0.72;
            pad.scale.set(w, w, w);
            pad.rotation.set(-Math.PI / 2, 0, (seed % 9) * 0.35 + i * 1.9);
            pad.position.set(i * 0.28 - 0.1, floatY + i * 0.008, i * 0.16);
            pad.receiveShadow = true;
            g.add(pad);
          }
        }
        break;
      }
      case 'lava': {
        // Lava pool (GPT expansion): dark basalt crust albedo with
        // the glow confined to the cracks via the emissive mask —
        // never a whole-surface red. Static emissive (no scrolling:
        // the crust is solid); the highlight pulse system may still
        // brighten it when targeted. Rim of dark rock grounds it.
        const rim = add(new THREE.Mesh(
          this.geo('lavaRim', () => new THREE.CylinderGeometry(0.86, 0.95, 0.1, 18)),
          std(0x2e2c2c, 1)));
        rim.position.y = 0.03;
        // DQ3 lava-flow pair preferred (round 19): a bright stream
        // in a dark crust reads as lava at play distance, where the
        // round-17 crack pair read as a black disc (Claude §16).
        const alb = this.dq3['lava-flow'] ?? this.expansion.lava_albedo;
        const emi = this.dq3['lava-flow-emissive'] ?? this.expansion.lava_emissive;
        const m = alb
          ? new THREE.MeshStandardMaterial({
              map: alb, emissiveMap: emi ?? null, emissive: 0xff6a00,
              emissiveIntensity: 1.55, roughness: 1,
            })
          : std(0x35322f, 1);
        pulseMaterials.push(m);
        const disc = new THREE.Mesh(
          this.geo('lavaDisc', () => new THREE.CircleGeometry(0.78, 24)), m);
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.085;
        disc.receiveShadow = true;
        g.add(disc);
        break;
      }
      default: {
        const blob = add(new THREE.Mesh(
          this.geo('defaultBlob', () => new THREE.IcosahedronGeometry(0.4, 1)), leaf));
        blob.position.y = 0.35;
      }
    }
    return { group: g, pulseMaterials };
  }
}

/**
 * Construction data for the game logic's collision / placement use
 * (2026-11-06). All values are for a node at scale 1, in world units,
 * with the node origin at its ground contact point — multiply radii
 * and height by state.scale for a placed node. The graphics side
 * reports the shape it draws; whether the player collides, and what
 * a harvest yields, stays with the game logic.
 */
export interface ResourceVisualSpec {
  /** Horizontal radius the visual occupies on the ground. */
  footprintRadius: number;
  /** Trunk/stem radius at ground level, when the type has one. */
  trunkRadius?: number;
  /** Top of the visual above the ground contact point. */
  height: number;
  /** What the depleted form looks like ('none' = bare ground). */
  depletedForm: 'stump' | 'rubble' | 'cut-patch' | 'none';
}

export const RESOURCE_VISUAL_SPECS: Record<string, ResourceVisualSpec> = {
  tree: { footprintRadius: 1.15, trunkRadius: 0.26, height: 3.6, depletedForm: 'stump' },
  rock: { footprintRadius: 1.0, height: 1.15, depletedForm: 'rubble' },
  herb: { footprintRadius: 0.35, height: 0.6, depletedForm: 'cut-patch' },
  flowers: { footprintRadius: 0.35, height: 0.55, depletedForm: 'cut-patch' },
  clay: { footprintRadius: 0.65, height: 0.4, depletedForm: 'none' },
  mushroom: { footprintRadius: 0.32, height: 0.65, depletedForm: 'none' },
  branch: { footprintRadius: 0.5, height: 0.78, depletedForm: 'none' },
  pebble: { footprintRadius: 0.32, height: 0.49, depletedForm: 'none' },
  grass: { footprintRadius: 0.45, height: 0.85, depletedForm: 'cut-patch' },
  bush: { footprintRadius: 0.55, height: 0.85, depletedForm: 'cut-patch' },
  water: { footprintRadius: 0.7, height: 0.15, depletedForm: 'none' },
  oil: { footprintRadius: 0.7, height: 0.12, depletedForm: 'none' },
  ore: { footprintRadius: 1.0, height: 1.15, depletedForm: 'rubble' },
  lily: { footprintRadius: 0.55, height: 0.06, depletedForm: 'none' },
  lava: { footprintRadius: 0.8, height: 0.06, depletedForm: 'none' },
};

/**
 * Specs for variants whose footprint/height differ from their base
 * type (world expansion, 2026-11-07). Keyed `type:variant`. Variants
 * not listed here share the base type's spec exactly (e.g. rock
 * 'mossy' and 'basalt' keep the plain rock footprint).
 */
export const RESOURCE_VARIANT_SPECS: Record<string, ResourceVisualSpec> = {
  'tree:conifer': { footprintRadius: 1.0, trunkRadius: 0.22, height: 3.9, depletedForm: 'stump' },
  'tree:conifer-snow': { footprintRadius: 1.0, trunkRadius: 0.22, height: 3.9, depletedForm: 'stump' },
  'tree:winter': { footprintRadius: 1.05, trunkRadius: 0.26, height: 3.4, depletedForm: 'stump' },
  'tree:palm': { footprintRadius: 1.0, trunkRadius: 0.24, height: 4.3, depletedForm: 'stump' },
  'branch:log': { footprintRadius: 0.85, height: 0.35, depletedForm: 'none' },
  'branch:driftwood': { footprintRadius: 0.85, height: 0.35, depletedForm: 'none' },
  'grass:reed': { footprintRadius: 0.5, height: 1.2, depletedForm: 'cut-patch' },
  'grass:dry': { footprintRadius: 0.45, height: 0.62, depletedForm: 'cut-patch' },
};
