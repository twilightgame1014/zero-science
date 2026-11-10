import * as THREE from 'three';
import type { StructureType, Vec3Like } from './types';
import { AssetManager } from './AssetManager';
import { segmentPointDistance } from './utils';

export type StructureFactory = () => THREE.Group;

/**
 * Places and removes building visuals on behalf of the game logic.
 *
 * The logic owns *whether* a structure exists, its id, type and cell;
 * this renderer only owns how it looks. Factories are procedural
 * low-poly placeholders for now — register a factory that loads a GLB
 * to upgrade any type without touching call sites.
 */
interface StructureFade {
  mats: Array<{ mat: THREE.Material; base: number }>;
  center: THREE.Vector3;
  radius: number;
  fade: number;
}

export class StructureRenderer {
  readonly group = new THREE.Group();
  private factories = new Map<string, StructureFactory>();
  private instances = new Map<string, THREE.Group>();
  private fadeState = new Map<string, StructureFade>();
  private groundHeightAt: (x: number, z: number) => number;
  private flames: THREE.Object3D[] = [];
  /** Rotating parts (waterwheel, flywheel): objects named 'Wheel'. */
  private wheels: THREE.Object3D[] = [];
  /** Procedural architectural textures so structures match the
   *  textured HD-2D look instead of flat colours. */
  private assets = new AssetManager();
  private tex: {
    wood: THREE.Texture;
    stone: THREE.Texture;
    plaster: THREE.Texture;
    thatch: THREE.Texture;
    tile: THREE.Texture;
  };

  constructor(groundHeightAt: (x: number, z: number) => number) {
    this.groundHeightAt = groundHeightAt;
    this.tex = {
      wood: this.assets.createWoodPlankTexture(),
      stone: this.assets.createCobblestoneTexture(),
      plaster: this.assets.createPlasterWallTexture(),
      thatch: this.assets.createThatchTexture(),
      tile: this.assets.createRoofTileTexture(),
    };
    this.registerDefaults();
  }

  /** Standard material using a private clone of a shared texture, so
   *  per-structure repeats never fight and disposal stays per-instance. */
  private texMat(
    tex: THREE.Texture,
    rx: number,
    ry: number,
    extra: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    const mat = new THREE.MeshStandardMaterial({
      map: t,
      roughness: 0.95,
      ...extra,
    });
    mat.userData.ownTexture = true;
    return mat;
  }

  registerFactory(type: string, factory: StructureFactory): void {
    this.factories.set(type, factory);
  }

  add(
    id: string,
    type: StructureType,
    position: Vec3Like,
    rotationY = 0,
  ): void {
    this.remove(id);
    const factory = this.factories.get(type) ?? (() => this.makeMarker());
    const obj = factory();
    const y = position.y ?? this.groundHeightAt(position.x, position.z);
    obj.position.set(position.x, y, position.z);
    obj.rotation.y = rotationY;
    obj.traverse((o) => {
      if (o.name === 'Flame') this.flames.push(o);
      if (o.name === 'Wheel') this.wheels.push(o);
    });
    this.instances.set(id, obj);
    this.group.add(obj);
    // Register per-structure materials for the occlusion fade. Factory
    // materials are created fresh per structure, so fading one building
    // never leaks into another.
    const mats = new Map<THREE.Material, number>();
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) if (m && !mats.has(m)) mats.set(m, m.opacity);
    });
    const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    this.fadeState.set(id, {
      mats: [...mats.entries()].map(([mat, base]) => ({ mat, base })),
      center: sphere.center,
      radius: sphere.radius,
      fade: 1,
    });
  }

  /* ---------------- placement preview (spec §4) ---------------- */

  private previewGroup: THREE.Group | null = null;
  private previewType: string | null = null;
  private previewValid = true;
  private previewGhostTime = 0;
  // Standard material, not Basic: the ghost must keep the model's
  // lit form (walls vs roof readable) — a flat Basic tint merges
  // overlapping parts into an unreadable slab.
  private ghostValid = new THREE.MeshStandardMaterial({
    color: 0x51ff7a, emissive: 0x1d5c2e, transparent: true, opacity: 0.55,
    depthWrite: false, roughness: 0.85, metalness: 0,
  });
  private ghostInvalid = new THREE.MeshStandardMaterial({
    color: 0xff5147, emissive: 0x5c1d18, transparent: true, opacity: 0.55,
    depthWrite: false, roughness: 0.85, metalness: 0,
  });

  /**
   * The building-placement ghost: the candidate model drawn
   * translucent and tinted by validity. It casts no shadow, is not
   * registered for the occlusion fade or part animation, and never
   * touches placement rules (the game decides `valid`). Rebuilt only
   * when the type changes; position/rotation/validity update live.
   * Ghosting is re-applied periodically so models whose factory
   * fills the group asynchronously (GLB) end up ghosted too.
   */
  setPreview(state: { type: StructureType; position: Vec3Like; rotationY?: number; valid: boolean } | null): void {
    if (state === null) {
      if (this.previewGroup) {
        this.group.remove(this.previewGroup);
        // Geometries are not disposed: a factory's output can share
        // them with live structures (host-side GLB caches).
        this.previewGroup = null;
        this.previewType = null;
      }
      return;
    }
    if (!this.previewGroup || this.previewType !== state.type) {
      if (this.previewGroup) this.group.remove(this.previewGroup);
      const factory = this.factories.get(state.type) ?? (() => this.makeMarker());
      this.previewGroup = factory();
      this.previewType = state.type;
      this.group.add(this.previewGroup);
      this.applyGhost(state.valid);
    }
    const y = state.position.y ?? this.groundHeightAt(state.position.x, state.position.z);
    this.previewGroup.position.set(state.position.x, y, state.position.z);
    this.previewGroup.rotation.y = state.rotationY ?? 0;
    this.applyGhost(state.valid);
  }

  private applyGhost(valid: boolean): void {
    if (!this.previewGroup) return;
    this.previewValid = valid;
    const ghost = valid ? this.ghostValid : this.ghostInvalid;
    this.previewGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (mesh.material !== ghost) mesh.material = ghost;
    });
  }

  remove(id: string): void {
    const obj = this.instances.get(id);
    if (!obj) return;
    this.flames = this.flames.filter((f) => !isDescendant(obj, f));
    this.wheels = this.wheels.filter((w) => !isDescendant(obj, w));
    this.group.remove(obj);
    disposeObject(obj);
    this.instances.delete(id);
    this.fadeState.delete(id);
  }

  /**
   * Fade structures whose bounding sphere blocks the camera's line of
   * sight to the player (low exploration camera), easing back when the
   * view clears. Visual only; existence and placement stay logic-owned.
   */
  updateOcclusion(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, dt: number): void {
    const FADE_MIN = 0.22;
    const k = Math.min(1, dt * 7);
    for (const st of this.fadeState.values()) {
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        playerPos.x, playerPos.y, playerPos.z,
        st.center.x, st.center.y, st.center.z,
      );
      const goal = d < st.radius ? FADE_MIN : 1;
      if (st.fade === goal) continue;
      let next = st.fade + (goal - st.fade) * k;
      if (Math.abs(goal - next) < 0.01) next = goal;
      st.fade = next;
      for (const { mat, base } of st.mats) {
        mat.opacity = base * next;
        mat.transparent = next < 0.999 || base < 1;
      }
    }
  }

  /** Blockage probe for OTHER subjects (NPCs), mirroring the
   *  player fade's segment test against every structure. */
  occlusionAt(cameraPos: THREE.Vector3, point: THREE.Vector3): number {
    for (const st of this.fadeState.values()) {
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        point.x, point.y, point.z,
        st.center.x, st.center.y, st.center.z,
      );
      if (d < st.radius) return 1;
    }
    return 0;
  }

  has(id: string): boolean {
    return this.instances.has(id);
  }

  update(time: number): void {
    // Keep the preview ghosted even when its factory streams meshes
    // in after the initial build (async GLB factories).
    if (this.previewGroup && time - this.previewGhostTime > 0.5) {
      this.previewGhostTime = time;
      this.applyGhost(this.previewValid);
    }
    for (const flame of this.flames) {
      const s = 0.9 + Math.sin(time * 11 + flame.id) * 0.12 + Math.sin(time * 23 + flame.id * 2) * 0.06;
      flame.scale.set(s, 1.1 + Math.sin(time * 9 + flame.id) * 0.22, s);
    }
    for (const wheel of this.wheels) {
      wheel.rotation.z = time * 0.6 + wheel.id;
    }
  }

  dispose(): void {
    for (const id of [...this.instances.keys()]) this.remove(id);
    this.assets.dispose();
  }

  /* ---------------- default procedural factories ---------------- */
  private registerDefaults(): void {
    this.factories.set('workbench', () => this.makeWorkbench());
    this.factories.set('campfire', () => this.makeCampfire());
    this.factories.set('kiln', () => this.makeKiln());
    this.factories.set('smelter', () => this.makeSmelter());
    this.factories.set('hut', () => this.makeHut('thatch'));
    this.factories.set('stone-house', () => this.makeHut('tile'));
    this.factories.set('laboratory', () => this.makeLab());
    this.factories.set('factory', () => this.makeFactory(0xa8a29a, 2));
    this.factories.set('power-plant', () => this.makeFactory(0x8f979e, 3));
    this.factories.set('research-institute', () => this.makeLab(true));
    this.factories.set('waterwheel', () => this.makeWaterwheel());
    this.factories.set('steam-engine', () => this.makeSteamEngine());
    this.factories.set('distillation-tower', () => this.makeDistillationTower());
    this.factories.set('drilling-rig', () => this.makeDrillingRig());
    this.factories.set('bridge', () => this.makeBridge());
  }

  private mats() {
    return {
      wood: this.texMat(this.tex.wood, 1.2, 1.2),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x66452a, roughness: 0.95 }),
      stone: this.texMat(this.tex.stone, 1.4, 1.4),
      clay: new THREE.MeshStandardMaterial({ color: 0xa9744f, roughness: 0.95 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.45, metalness: 0.7 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.7 }),
      white: new THREE.MeshStandardMaterial({ color: 0xeef0ee, roughness: 0.6 }),
      flame: new THREE.MeshBasicMaterial({ color: 0xff8a2a }),
      flameCore: new THREE.MeshBasicMaterial({ color: 0xffd94d }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 1 }),
    };
  }

  private box(
    mat: THREE.Material,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Waterwheel （水車）: A-frame posts, an axle, and a slowly turning
   *  wheel with paddles. About 2.1 tall, footprint roughly 1.4 x 1.3. */
  private makeWaterwheel(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    for (const sz of [-0.52, 0.52]) {
      g.add(this.box(m.woodDark, 0.14, 2.0, 0.14, 0, 1.0, sz));
      g.add(this.box(m.woodDark, 1.2, 0.12, 0.14, 0, 0.06, sz)); // foot beam
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), m.woodDark);
    axle.rotation.x = Math.PI / 2;
    axle.position.set(0, 1.05, 0);
    axle.castShadow = true;
    g.add(axle);
    const wheel = new THREE.Group();
    wheel.name = 'Wheel';
    wheel.position.set(0, 1.05, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 22), m.wood);
    rim.castShadow = true;
    wheel.add(rim);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 18), m.wood);
    wheel.add(inner);
    for (let k = 0; k < 4; k++) {
      const spoke = this.box(m.wood, 0.08, 1.84, 0.06, 0, 0, 0);
      spoke.rotation.z = (k * Math.PI) / 4;
      wheel.add(spoke);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const paddle = this.box(m.wood, 0.36, 0.15, 0.52, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0);
      paddle.rotation.z = a + Math.PI / 2;
      wheel.add(paddle);
    }
    g.add(wheel);
    return g;
  }

  /** Steam engine （蒸気機関）: brick base, horizontal boiler, chimney
   *  and a turning flywheel. About 2.3 tall, footprint 2.2 x 1.2. */
  private makeSteamEngine(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    g.add(this.box(m.clay, 2.2, 0.5, 1.1, 0, 0.25, 0));
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 14), m.metal);
    boiler.rotation.z = Math.PI / 2;
    boiler.position.set(-0.1, 0.95, 0);
    boiler.castShadow = true;
    g.add(boiler);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.95, 10), m.dark);
    chimney.position.set(-0.6, 1.85, 0);
    chimney.castShadow = true;
    g.add(chimney);
    g.add(this.box(m.metal, 0.5, 0.08, 0.08, 0.42, 1.1, 0.45)); // piston rod
    const fly = new THREE.Group();
    fly.name = 'Wheel';
    fly.position.set(0.62, 0.95, 0.6);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 20), m.metal);
    rim.castShadow = true;
    fly.add(rim);
    for (let k = 0; k < 3; k++) {
      const spoke = this.box(m.metal, 0.05, 0.8, 0.05, 0, 0, 0);
      spoke.rotation.z = (k * Math.PI) / 3;
      fly.add(spoke);
    }
    g.add(fly);
    g.add(this.box(m.woodDark, 0.16, 0.95, 0.16, 0.62, 0.47, 0.6)); // flywheel post
    return g;
  }

  /** Distillation tower （精留塔）: a tall column with bulge rings, a
   *  condenser pipe and a receiving flask. About 3.1 tall. */
  private makeDistillationTower(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    g.add(this.box(m.stone, 1.1, 0.4, 1.1, 0, 0.2, 0));
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 2.4, 14), m.metal);
    column.position.set(0, 1.6, 0);
    column.castShadow = true;
    g.add(column);
    for (const ry of [1.0, 1.6, 2.2]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.045, 8, 18), m.dark);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, ry, 0);
      g.add(ring);
    }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 14), m.metal);
    cap.position.set(0, 2.95, 0);
    g.add(cap);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 8), m.metal);
    pipe.rotation.z = -0.6;
    pipe.position.set(0.33, 2.72, 0);
    g.add(pipe);
    const condenser = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 10), m.glass);
    condenser.position.set(0.62, 2.15, 0);
    g.add(condenser);
    g.add(this.box(m.woodDark, 0.5, 0.06, 0.5, 0.62, 0.32, 0)); // flask stand
    const flask = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 10), m.glass);
    flask.position.set(0.62, 0.56, 0);
    g.add(flask);
    return g;
  }

  /** Drilling derrick （掘削やぐら）: four leaning legs, cross braces,
   *  a crown block and the drill pipe. About 3.4 tall. */
  private makeDrillingRig(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    g.add(this.box(m.wood, 1.7, 0.12, 1.7, 0, 0.06, 0));
    const lean = Math.atan2(0.7, 3.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = this.box(m.woodDark, 0.09, 3.35, 0.09, sx * 0.35, 1.62, sz * 0.35);
      leg.rotation.z = -sx * lean;
      leg.rotation.x = sz * lean;
      g.add(leg);
    }
    for (const by of [1.1, 2.1]) {
      const w = 1.55 - by * 0.22;
      g.add(this.box(m.wood, w, 0.07, 0.07, 0, by, 0.78 - by * 0.11));
      g.add(this.box(m.wood, w, 0.07, 0.07, 0, by, -(0.78 - by * 0.11)));
    }
    g.add(this.box(m.woodDark, 0.34, 0.26, 0.34, 0, 3.28, 0)); // crown block
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 8), m.dark);
    pipe.position.set(0, 1.55, 0);
    g.add(pipe);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 10), m.metal);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0.55, 0.3, 0.55);
    g.add(drum);
    return g;
  }

  /** Bridge （橋）: arched plank deck with rails. Local +X is the
   *  span direction (length 3.6), width 1.6; the deck top is about
   *  0.5 above the origin at the ends and 0.65 at the centre. Whether
   *  the deck is walkable is the game logic's call — the renderer
   *  only reports the shape (see INTEGRATION.md §16). */
  private makeBridge(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    for (let i = 0; i < 7; i++) {
      const x = -1.5 + i * 0.5;
      const y = 0.44 + (1 - (x / 1.8) ** 2) * 0.16;
      g.add(this.box(m.wood, 0.46, 0.09, 1.6, x, y, 0));
    }
    for (const sz of [-0.72, 0.72]) {
      for (const px of [-1.5, -0.5, 0.5, 1.5]) {
        g.add(this.box(m.woodDark, 0.09, 0.55, 0.09, px, 0.78, sz));
      }
      g.add(this.box(m.wood, 3.6, 0.08, 0.08, 0, 1.06, sz)); // handrail
    }
    for (const px of [-1.2, 1.2]) for (const sz of [-0.6, 0.6]) {
      g.add(this.box(m.woodDark, 0.14, 0.5, 0.14, px, 0.2, sz)); // piles
    }
    return g;
  }

  private makeMarker(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    g.add(this.box(m.stone, 1, 1, 1, 0, 0.5, 0));
    return g;
  }

  private makeWorkbench(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    g.add(this.box(m.wood, 2.2, 0.12, 1.1, 0, 0.92, 0));
    for (const sx of [-0.95, 0.95]) for (const sz of [-0.4, 0.4]) {
      g.add(this.box(m.woodDark, 0.14, 0.9, 0.14, sx, 0.45, sz));
    }
    g.add(this.box(m.woodDark, 2.0, 0.1, 0.8, 0, 0.45, 0)); // lower shelf
    g.add(this.box(m.stone, 0.4, 0.25, 0.4, -0.6, 1.1, 0.1)); // mortar-ish block
    const flask = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 10), m.glass);
    flask.position.set(0.55, 1.18, -0.1);
    g.add(flask);
    return g;
  }

  private makeCampfire(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), m.stone);
      stone.position.set(Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62);
      stone.castShadow = true;
      g.add(stone);
    }
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), m.woodDark);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i / 3) * Math.PI;
      log.position.y = 0.1;
      g.add(log);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.75, 8), m.flame);
    flame.position.y = 0.5;
    flame.name = 'Flame';
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 8), m.flameCore);
    core.position.y = 0.42;
    core.name = 'Flame';
    g.add(flame, core);
    return g;
  }

  private makeKiln(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.02, 1.1, 0.35, 14),
      this.texMat(this.tex.stone, 2, 0.5),
    );
    base.position.y = 0.17;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.clay);
    dome.position.y = 0.3;
    dome.scale.y = 1.15;
    dome.castShadow = true;
    g.add(dome);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), m.dark);
    mouth.position.set(0, 0.32, 0.88);
    mouth.rotation.x = -0.25;
    g.add(mouth);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), m.flame);
    glow.position.set(0, 0.3, 0.9);
    glow.rotation.x = -0.25;
    g.add(glow);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.6, 8), m.clay);
    chimney.position.set(0, 1.25, -0.2);
    chimney.castShadow = true;
    g.add(chimney);
    return g;
  }

  private makeSmelter(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    g.add(this.box(m.stone, 1.5, 1.5, 1.5, 0, 0.75, 0));
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.3, 8), m.stone);
    chimney.position.set(0.3, 2.1, -0.3);
    chimney.castShadow = true;
    g.add(chimney);
    const door = this.box(m.flame, 0.5, 0.6, 0.05, 0, 0.45, 0.78);
    door.castShadow = false;
    g.add(door);
    return g;
  }

  private makeHut(kind: 'thatch' | 'tile'): THREE.Group {
    const g = new THREE.Group();
    const wall =
      kind === 'thatch'
        ? this.texMat(this.tex.plaster, 1, 1)
        : this.texMat(this.tex.stone, 1.6, 1);
    const roof = this.texMat(
      kind === 'thatch' ? this.tex.thatch : this.tex.tile,
      2.2,
      1.2,
    );
    g.add(this.box(wall, 3.2, 1.9, 2.6, 0, 0.95, 0));
    for (const s of [-1, 1]) {
      const slab = this.box(roof, 3.8, 0.12, 1.9, 0, 2.45, s * 0.72);
      slab.rotation.x = s * 0.62;
      g.add(slab);
    }
    const door = this.box(this.texMat(this.tex.wood, 0.5, 1), 0.8, 1.4, 0.06, 0.5, 0.7, 1.32);
    g.add(door);
    // Warm lit window — reads beautifully at dusk with bloom enabled.
    const win = this.box(
      new THREE.MeshStandardMaterial({
        color: 0xffc978,
        emissive: 0xffa63e,
        emissiveIntensity: 1.8,
      }),
      0.5, 0.55, 0.05, -0.7, 1.15, 1.32,
    );
    win.castShadow = false;
    g.add(win);
    return g;
  }

  private makeLab(grand = false): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats();
    const w = grand ? 5.2 : 4.2;
    g.add(this.box(m.white, w, 2.4, 3, 0, 1.2, 0));
    g.add(this.box(m.glass, w * 0.8, 1.1, 0.06, 0, 1.35, 1.52));
    g.add(this.box(m.metal, w + 0.3, 0.18, 3.3, 0, 2.5, 0));
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 10, 1, true), m.metal);
    dish.position.set(w * 0.3, 2.95, 0);
    dish.rotation.x = -0.7;
    g.add(dish);
    return g;
  }

  private makeFactory(bodyColor: number, chimneys: number): THREE.Group {
    const g = new THREE.Group();
    const body = this.texMat(this.tex.stone, 2.4, 1.2, {
      color: bodyColor,
      roughness: 0.85,
    });
    const m = this.mats();
    g.add(this.box(body, 5, 2.6, 3.4, 0, 1.3, 0));
    g.add(this.box(m.metal, 5.4, 0.2, 3.8, 0, 2.7, 0));
    for (let i = 0; i < chimneys; i++) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 2.2 + i * 0.5, 10), m.metal);
      ch.position.set(-1.6 + i * 1.5, 3.6 + i * 0.25, -0.8);
      ch.castShadow = true;
      g.add(ch);
    }
    return g;
  }
}

function isDescendant(root: THREE.Object3D, obj: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if (o === obj) found = true;
  });
  return found;
}

export function disposeObject(root: THREE.Object3D): void {
  const disposeMat = (x: THREE.Material) => {
    // Only textures flagged as per-instance clones are disposed here;
    // shared textures stay owned by their managers.
    if (x.userData.ownTexture) {
      const map = (x as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
    }
    x.dispose();
  };
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
      o.geometry.dispose();
      const mat = o.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(disposeMat);
      else disposeMat(mat);
    }
  });
}
