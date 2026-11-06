import * as THREE from 'three';
import type { ResourceVisualState } from './types';
import { disposeObject } from './StructureRenderer';
import { AssetManager } from './AssetManager';
import { segmentPointDistance } from './utils';

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
 * A fixed-capacity InstancedMesh pool. Slots are allocated per node;
 * a released slot collapses to a zero-scale matrix underground.
 * Capacity is generous for the game's streaming window; if a pool
 * ever fills, the caller falls back to the group path for that node.
 */
class InstancedPool {
  readonly mesh: THREE.InstancedMesh;
  private freeList: number[] = [];
  private dummy = new THREE.Object3D();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, parent: THREE.Group) {
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

  release(index: number): void {
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
  ) {
    this.groundHeightAt = groundHeightAt;
    this.gpt = gpt;
    this.branch = branch;
    this.yawRad = THREE.MathUtils.degToRad(yawDegrees);
    const am = new AssetManager();
    this.barkTex = am.createBarkTexture();
    this.foliageTex = am.createFoliageTexture();
    this.rockCrackTex = am.createRockCrackTexture();
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
      const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
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
      if (st.type !== 'tree' && st.type !== 'rock' && st.type !== 'ore' && st.type !== 'bush') continue;
      const spec = RESOURCE_VISUAL_SPECS[st.type];
      const p = entry.group.position;
      const radius = (spec?.footprintRadius ?? 0.6) * entry.baseScale + 0.45;
      OCCL_POINT.set(p.x, p.y + (spec?.height ?? 1) * entry.baseScale * 0.55, p.z);
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        playerPos.x, playerPos.y, playerPos.z,
        OCCL_POINT.x, OCCL_POINT.y, OCCL_POINT.z,
      );
      let goal = d < radius ? FADE_MIN : 1;
      if (goal === 1 && st.type === 'tree') {
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
        // take part in collision. Falls back to the previous
        // leaf-mass build when the spray textures failed to decode.
        const sr = (n: number) => {
          const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
          return v - Math.floor(v);
        };
        const sprays = [
          this.branch.branch_1, this.branch.branch_2,
          this.branch.branch_3, this.branch.branch_4,
        ].filter((t): t is THREE.Texture => !!t);
        const arch = Math.floor(sr(1) * 3); // 0 wide, 1 tall, 2 young
        const trunkH = arch === 1 ? 2.25 : arch === 2 ? 1.45 : 1.8;
        const trunk = add(new THREE.Mesh(
          this.geo('trunk', () => new THREE.CylinderGeometry(0.14, 0.26, 1.8, 7)), wood));
        trunk.scale.set(arch === 2 ? 0.8 : 1, trunkH / 1.8, arch === 2 ? 0.8 : 1);
        trunk.position.y = trunkH / 2;
        if (sprays.length >= 2) {
          const crownY = arch === 1 ? 2.85 : arch === 2 ? 1.95 : 2.45;
          const clusters = arch === 1 ? 5 : arch === 2 ? 4 : 6;
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
              color: new THREE.Color(shade * 0.94, shade * 1.0, shade * 0.86),
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
            const cx = Math.cos(az) * rr;
            const cz = Math.sin(az) * rr;
            const cy = crownY + (sr(40 + c) - 0.5) * 0.6;
            for (let p = 0; p < 2; p++) {
              const tex = c === clusters - 1 && p === 1 && this.branch.branch_3
                ? this.branch.branch_3
                : sprays[Math.floor(sr(50 + c * 2 + p) * sprays.length) % sprays.length];
              sprayCard(tex, cx, cy, cz,
                az + Math.PI / 2 + p * (Math.PI / 2) + (sr(60 + c * 2 + p) - 0.5) * 0.6,
                -0.3 + sr(70 + c * 2 + p) * 0.45, (sr(80 + c * 2 + p) - 0.5) * 0.5,
                cardW * (0.85 + sr(90 + c * 2 + p) * 0.35), 0.92 + sr(100 + c * 2 + p) * 0.16);
            }
          }
          // Inner depth sprays: dark olive, at the crown's heart.
          sprayCard(sprays[Math.floor(sr(3) * sprays.length) % sprays.length],
            0, crownY - 0.2, 0, sr(4) * Math.PI, -0.2, 0, cardW * 1.05, 0.42);
          sprayCard(sprays[Math.floor(sr(6) * sprays.length) % sprays.length],
            0.28, crownY - 0.02, -0.22, sr(5) * Math.PI, -0.1, 0.15, cardW * 0.9, 0.55);
        } else {
          // Legacy fallback (spray textures unavailable).
          for (let i = 0; i < 2; i++) {
            const limb = add(new THREE.Mesh(
              this.geo('limb', () => new THREE.CylinderGeometry(0.045, 0.09, 1.1, 5)), wood));
            limb.position.set((i === 0 ? 0.28 : -0.24), 1.95, (i === 0 ? 0.1 : -0.12));
            limb.rotation.z = (i === 0 ? -0.7 : 0.75);
            limb.rotation.x = (i === 0 ? 0.15 : -0.2);
          }
          for (let i = 0; i < 3; i++) {
            const blob = add(new THREE.Mesh(
              this.geo(`treeBlob${i}`, () => new THREE.IcosahedronGeometry(1.05 - i * 0.18, 1)), leaf));
            blob.position.set((i - 1) * 0.45, 2.3 + i * 0.5, (i % 2) * 0.4 - 0.2);
            blob.scale.y = 0.85;
          }
          for (let i = 0; i < 4; i++) {
            const card = sprite(this.gpt.leaf_oak, 1.25, 1.1);
            if (!card) break;
            const a = (i / 4) * Math.PI * 2 + seed;
            card.position.set(Math.cos(a) * 0.55, 2.15 + (i % 2) * 0.7, Math.sin(a) * 0.55);
            card.rotation.x = (i % 2 ? -0.25 : 0.2);
            g.add(card);
          }
        }
        break;
      }
      case 'rock': {
        // Plain rock: no crystal (Claude 2026-11-06 — the crystal made
        // every rock read as an ore deposit). Crystals live on 'ore'.
        const rock = add(new THREE.Mesh(
          this.geo('rockJit', () => { const geo = new THREE.IcosahedronGeometry(0.85, 1); jitterRock(geo); return geo; }),
          rockM));
        rock.position.y = 0.45;
        rock.scale.set(1.15, 0.8, 1);
        break;
      }
      case 'ore': {
        // Ore-bearing rock: the host rock plus a small crystal cluster
        // (quartz white + amber) so the deposit reads at a glance.
        const rock = add(new THREE.Mesh(
          this.geo('rockJit', () => { const geo = new THREE.IcosahedronGeometry(0.85, 1); jitterRock(geo); return geo; }),
          rockM));
        rock.position.y = 0.45;
        rock.scale.set(1.15, 0.8, 1);
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
        // Gatherable bush （やぶ）: foliage masses + shrub leaf cards,
        // visibly denser than a decorative shrub.
        for (let i = 0; i < 3; i++) {
          const blob = add(new THREE.Mesh(
            this.geo(`bushBlob${i}`, () => {
              const geo = new THREE.IcosahedronGeometry(0.5 - i * 0.09, 1);
              jitterRock(geo, 0.3);
              return geo;
            }),
            leaf));
          blob.position.set((i - 1) * 0.3, 0.36 + (i % 2) * 0.14, (i % 2) * 0.24 - 0.12);
          blob.scale.y = 0.8;
        }
        for (let i = 0; i < 3; i++) {
          const card = sprite(this.gpt.leaf_shrub, 0.8, 0.66);
          if (!card) break;
          const a = (i / 3) * Math.PI * 2 + seed;
          card.position.set(Math.cos(a) * 0.34, 0.3, Math.sin(a) * 0.34);
          g.add(card);
        }
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
};
