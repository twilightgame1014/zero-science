import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorOptions, GraphicsConfig, QualityTier } from './types';
import { AssetManager } from './AssetManager';
import { createWaterfallKit, type WaterfallKit } from './WaterfallKit';
import {
  distanceToPath,
  distanceToRiver,
  isInRiver,
  mulberry32,
  riverCenterX,
  segmentPointDistance,
  smoothstep,
  terrainHeight,
  areaWeights,
} from './utils';

interface WindMaterial {
  material: THREE.Material;
  uniforms: { uTime: { value: number } };
  strength: number;
}

function makeWindMaterial(
  base: THREE.MeshStandardMaterial,
  heightRef: number,
  strength: number,
): WindMaterial {
  const uniforms = { uTime: { value: 0 } };
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader =
      'uniform float uTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec3 iws = vec3(0.0);
           #ifdef USE_INSTANCING
             iws = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           #endif
           float phase = iws.x * 0.35 + iws.z * 0.43;
           float bendAmt = pow(clamp(position.y / ${heightRef.toFixed(2)} + 0.5, 0.0, 1.0), 2.0);
           transformed.x += sin(uTime * 1.7 + phase) * ${strength.toFixed(3)} * bendAmt;
           transformed.z += cos(uTime * 1.25 + phase * 1.31) * ${(strength * 0.6).toFixed(3)} * bendAmt;
         }`,
      );
  };
  base.customProgramCacheKey = () => `wind-${heightRef}-${strength}`;
  return { material: base, uniforms, strength };
}

interface CanopySet {
  centers: Float32Array;
  radii: Float32Array;
  fades: Float32Array;
  attr: THREE.InstancedBufferAttribute;
}

/**
 * Per-instance occlusion fade for instanced canopies. Chains onto the
 * wind material's shader patch: an instanced `aFade` attribute drives a
 * screen-door (dithered discard) fade, so the shared material is never
 * mutated per instance, nothing becomes transparent-sorted, and depth
 * writing stays on. Used to thin out trees that block the player at the
 * low exploration camera angle.
 */
function addInstanceFade(target: WindMaterial | THREE.Material): void {
  const mat = (target as WindMaterial).material ?? (target as THREE.Material);
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile(shader, renderer);
    shader.vertexShader =
      'attribute float aFade;\nvarying float vFade;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vFade = aFade;',
      );
    shader.fragmentShader =
      'varying float vFade;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if (vFade < 0.999) {
           float fadeHash = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
           if (fadeHash > vFade) discard;
         }`,
      );
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}-fade`;
}



/**
 * Procedural nature: trees, shrubs, grass, ferns, flowers, rocks,
 * pebbles, fallen logs and drifting pollen. All placement is seeded
 * and purely decorative — resource ownership stays with game logic;
 * ResourceRenderer handles logic-driven nodes separately.
 */
export class EnvironmentRenderer {
  readonly group = new THREE.Group();
  private envTex: Record<string, THREE.Texture> = {};
  private quality: QualityTier = 'high';
  private cfg: GraphicsConfig;
  private windMaterials: WindMaterial[] = [];
  private pollen: THREE.Points | null = null;
  private pollenBase: Float32Array | null = null;
  private waterfallKit: WaterfallKit | null = null;
  private canopy: CanopySet[] = [];
  private rng: () => number;
  private barkTex!: THREE.Texture;
  private foliageTex!: THREE.Texture;
  private rockCrackTex!: THREE.Texture;
  private tuftTex!: THREE.Texture;
  private fernTex!: THREE.Texture;
  private leafCardTex!: THREE.Texture;
  private patchTex!: THREE.Texture;
  private patchAlpha!: THREE.Texture;
  /** GPT-generated image textures (may be empty -> procedural fallbacks). */
  private gpt: Record<string, THREE.Texture> = {};
  /** Branch/leaf spray textures for the card-built canopies
   *  (assets/branch-cards/; may be empty -> procedural fallback). */
  private branch: Record<string, THREE.Texture> = {};
  /** Procedural reserve sprays (canvas-drawn; cannot fail to
   *  decode), one per spray set, used when a bundled spray WebP is
   *  unavailable (Claude 2026-11-07 §12-4). */
  private fallbackSprays: THREE.Texture[] = [];
  /** Full-detail spray card meshes + their base matrices, and the
   *  far-LOD cluster mesh, for the distance swap in updateTreeLOD. */
  private spraySets: Array<{ mesh: THREE.InstancedMesh; base: Float32Array }> = [];
  private liteMesh: THREE.InstancedMesh | null = null;
  private liteBase: Float32Array | null = null;
  private liteRadiiArr: Float32Array | null = null;
  private lodTrees: Array<{
    x: number; z: number;
    refs: Array<{ set: number; index: number }>;
    lite: number[];
    far: boolean;
  }> = [];
  private lodTimer = 0;
  /** Soft soil/leaf discs that ground trees and rocks (collected
   *  during their builds, instanced once at the end). */
  private groundDiscs: Array<{ x: number; z: number; r: number; tint: THREE.Color }> = [];
  /** Scenery-free circles (DecorOptions.clearings). */
  private clearings: Array<{ x: number; z: number; r: number }> = [];
  /** Ground-cover instances that can be thinned around game-owned
   *  natural objects (grass tufts, wildflowers, herb patches), with
   *  their original placement so a recompute can restore them. */
  private coverSpots: Array<{
    mesh: THREE.InstancedMesh; index: number;
    x: number; y: number; z: number; ry: number; sx: number; sy: number; sz: number;
  }> = [];

  private inClearing(x: number, z: number): boolean {
    for (const c of this.clearings) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  /**
   * Hide ground-cover instances (scenery grass tufts, wildflowers,
   * decorative herb patches) within the given circles, restoring any
   * that are no longer covered. The game calls this with its natural
   * objects so a harvestable grass/herb/flower patch stands in a
   * readable clearing of its own instead of dissolving into look-
   * alike scenery — and a harvested cut-patch stays visible.
   * Rendering only; placement data is unchanged.
   */
  thinGroundCover(points: Array<{ x: number; z: number; r: number }>): void {
    if (this.coverSpots.length === 0) return;
    const dirty = new Set<THREE.InstancedMesh>();
    for (const s of this.coverSpots) {
      let hide = this.inClearing(s.x, s.z);
      if (!hide) {
        for (const p of points) {
          const dx = s.x - p.x;
          const dz = s.z - p.z;
          if (dx * dx + dz * dz < p.r * p.r) { hide = true; break; }
        }
      }
      if (hide) this.setInstance(s.mesh, s.index, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      else this.setInstance(s.mesh, s.index, s.x, s.y, s.z, s.ry, s.sx, s.sy, s.sz);
      dirty.add(s.mesh);
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
  }

  constructor(
    cfg: GraphicsConfig,
    quality: QualityTier,
    particleTexture: THREE.Texture,
    gpt: Record<string, THREE.Texture> = {},
    decor: DecorOptions = {},
    branch: Record<string, THREE.Texture> = {},
    envTex: Record<string, THREE.Texture> = {},
  ) {
    this.cfg = cfg;
    this.gpt = gpt;
    this.envTex = envTex;
    this.quality = quality;
    this.branch = branch;
    this.rng = mulberry32(cfg.world.seed);
    const scale = quality === 'high' ? 1 : 0.5;
    // Shared procedural pixel textures (bark / foliage / cracked rock)
    // so nature stops reading as flat single-colour primitives.
    const am = new AssetManager();
    this.barkTex = am.createBarkTexture();
    this.foliageTex = am.createFoliageTexture();
    this.rockCrackTex = am.createRockCrackTexture();
    this.tuftTex = am.createGrassTuftTexture();
    this.fernTex = am.createFernTexture();
    this.leafCardTex = am.createLeafClusterTexture();
    this.fallbackSprays = [0, 1, 2, 3].map((v) => am.createSprayTexture(v));
    this.patchTex = am.createGroundPatchTexture();
    this.patchAlpha = am.createPatchAlphaTexture();

    // Families the game owns as natural objects can be switched off
    // (GraphicsOptions.decor) so scenery never doubles as a fake
    // harvest target. Fine detail (grass, ferns, litter, decals)
    // always stays renderer-side.
    this.clearings = decor.clearings ?? [];
    if (decor.trees !== false) this.buildTrees(scale);
    this.buildGrass(scale);
    this.buildGroundCover(scale, decor.shrubs !== false);
    if (decor.rocks !== false) this.buildRocks(scale);
    if (decor.pebbles !== false) this.buildRiverbank(scale);
    if (decor.logs !== false) this.buildFallenLogs();
    this.buildPollen(particleTexture, scale);
    this.buildBackdropMountains();
    this.buildWaterfall(particleTexture);
    if (decor.stonework !== false) this.buildStonework();
    this.buildGrounding();
  }

  /** Deterministic position-hashed vertex jitter (shared vertices
   *  move together, so geometry never cracks apart). */
  private jitter(geo: THREE.BufferGeometry, amount: number): void {
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

  /** Smooth value noise for meadow / bare-patch masking. */
  private vnoise(x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const h = (a: number, b: number) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const u = xf * xf * (3 - 2 * xf);
    const v = zf * zf * (3 - 2 * zf);
    return (
      h(xi, zi) * (1 - u) * (1 - v) +
      h(xi + 1, zi) * u * (1 - v) +
      h(xi, zi + 1) * (1 - u) * v +
      h(xi + 1, zi + 1) * u * v
    );
  }

  /** Two crossed vertical planes (grass tufts, ferns, leaf cards). */
  private crossPlanes(w: number, h: number): THREE.BufferGeometry {
    const a = new THREE.PlaneGeometry(w, h);
    a.translate(0, h / 2, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    return mergeGeometries([a, b])!;
  }

  /** Instanced soft discs under trees/rocks: contact soil that keeps
   *  objects visually rooted instead of hovering on flat green. */
  private buildGrounding(): void {
    if (this.groundDiscs.length === 0) return;
    const geo = new THREE.CircleGeometry(1, 14);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: this.patchTex,
      transparent: true,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const discs = new THREE.InstancedMesh(geo, mat, this.groundDiscs.length);
    this.groundDiscs.forEach((d, i) => {
      this.setInstance(discs, i, d.x, this.groundY(d.x, d.z) + 0.02, d.z, 0, d.r, 1, d.r);
      discs.setColorAt(i, d.tint);
    });
    if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
    discs.renderOrder = 1;
    discs.receiveShadow = true;
    this.group.add(discs);
  }

  update(time: number): void {
    for (const w of this.windMaterials) w.uniforms.uTime.value = time;
    if (this.waterfallKit) this.waterfallKit.update(time);
    if (this.pollen && this.pollenBase) {
      const pos = this.pollen.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const bx = this.pollenBase[i * 3];
        const by = this.pollenBase[i * 3 + 1];
        const bz = this.pollenBase[i * 3 + 2];
        pos.setXYZ(
          i,
          bx + Math.sin(time * 0.24 + i * 1.7) * 1.6,
          by + Math.sin(time * 0.4 + i * 2.3) * 0.5,
          bz + Math.cos(time * 0.19 + i) * 1.6,
        );
      }
      pos.needsUpdate = true;
    }
  }

  /**
   * Thin out canopy instances that sit between the camera and the
   * player (segment test against each canopy sphere), easing back to
   * fully opaque when the line of sight clears. Rendering only — tree
   * placement and any passability rules are untouched.
   */
  updateOcclusion(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, dt: number): void {
    const FADE_MIN = 0.13;
    const k = Math.min(1, dt * 7);
    for (const set of this.canopy) {
      let dirty = false;
      const n = set.radii.length;
      for (let i = 0; i < n; i++) {
        const r = set.radii[i];
        if (r <= 0) continue;
        const d = segmentPointDistance(
          cameraPos.x, cameraPos.y, cameraPos.z,
          playerPos.x, playerPos.y, playerPos.z,
          set.centers[i * 3], set.centers[i * 3 + 1], set.centers[i * 3 + 2],
        );
        // Segment test alone misses the neighbour whose crown hangs
        // over the player from the side (Claude 2026-11-06: in dense
        // forest the player stayed half-covered). A canopy whose
        // horizontal reach overlaps the player's position fades too —
        // the world-space proxy for "covers the player's screen rect".
        const pdx = set.centers[i * 3] - playerPos.x;
        const pdz = set.centers[i * 3 + 2] - playerPos.z;
        const nearPlayer = pdx * pdx + pdz * pdz < (r + 1.05) * (r + 1.05);
        const goal = d < r + 0.45 || nearPlayer ? FADE_MIN : 1;
        const cur = set.fades[i];
        if (cur === goal) continue;
        const next = cur + (goal - cur) * k;
        set.fades[i] = Math.abs(goal - next) < 0.01 ? goal : next;
        dirty = true;
      }
      if (dirty) set.attr.needsUpdate = true;
    }
    // Distance LOD for broadleaf crowns, checked a few times a
    // second (hysteresis keeps borderline trees from flickering).
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.4;
      this.updateTreeLOD(playerPos);
    }
  }

  /**
   * Swap broadleaf crowns between the full spray-card build (near)
   * and the crossed cluster-sprite pair (far, beyond ~27 m from the
   * player). Only instance matrices change; placement, occlusion
   * fades and anything the game owns are untouched.
   */
  private updateTreeLOD(playerPos: THREE.Vector3): void {
    if (!this.liteMesh || !this.liteBase || !this.liteRadiiArr) return;
    const dirty = new Set<THREE.InstancedMesh>();
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(0, -50, 0);
    for (const t of this.lodTrees) {
      const d = Math.hypot(t.x - playerPos.x, t.z - playerPos.z);
      const far = t.far ? d > 23 : d > 27;
      if (far === t.far) continue;
      t.far = far;
      for (const ref of t.refs) {
        const set = this.spraySets[ref.set];
        if (!set) continue;
        if (far) zero.toArray(set.mesh.instanceMatrix.array, ref.index * 16);
        else m.fromArray(set.base, ref.index * 16).toArray(set.mesh.instanceMatrix.array, ref.index * 16);
        dirty.add(set.mesh);
      }
      for (const li of t.lite) {
        if (far) {
          m.fromArray(this.liteBase, li * 16).toArray(this.liteMesh.instanceMatrix.array, li * 16);
          this.liteRadiiArr[li] = 1.6;
        } else {
          zero.toArray(this.liteMesh.instanceMatrix.array, li * 16);
          this.liteRadiiArr[li] = 0;
        }
        dirty.add(this.liteMesh);
      }
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  setPollenVisible(visible: boolean): void {
    if (this.pollen) this.pollen.visible = visible;
  }

  /* ---------------- placement helpers ---------------- */
  /** Green scenery (tufts, flowers, herbs) never grows where the
   * area blend says volcanic or deep snow — Claude 2026-11-07 §16
   * reported module grass standing on lava. The legacy-centre
   * scenery never reaches those weights today; the predicate keeps
   * it true wherever the scenery domain grows. */
  private hostileToPlants(x: number, z: number): boolean {
    const w = areaWeights(x, z, this.cfg);
    return (w.volcano ?? 0) > 0.12 || (w.snow ?? 0) > 0.62;
  }

  private scatter(
    count: number,
    accept: (x: number, z: number) => boolean,
  ): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    const half = this.cfg.world.size / 2 - 3;
    let guard = count * 40;
    while (out.length < count && guard-- > 0) {
      const x = (this.rng() * 2 - 1) * half;
      const z = (this.rng() * 2 - 1) * half;
      if (accept(x, z) && !this.inClearing(x, z)) out.push({ x, z });
    }
    return out;
  }

  private groundY(x: number, z: number): number {
    return terrainHeight(x, z, this.cfg);
  }

  private dummy = new THREE.Object3D();
  private setInstance(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    ry: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, ry, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix);
  }

  /* ---------------- trees ---------------- */
  private buildTrees(scale: number): void {
    // Grove structure (2026-11-06): trees cluster around seeded grove
    // centres and leave a few clearings, instead of an even scatter —
    // the forest reads as stands, edges and glades. Decorative only.
    const groves: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 7; i++) {
      groves.push({ x: -52 + this.rng() * 62, z: -40 + this.rng() * 84 });
    }
    const clearings: Array<{ x: number; z: number; r: number }> = [];
    for (let i = 0; i < 3; i++) {
      clearings.push({ x: -46 + this.rng() * 52, z: -34 + this.rng() * 72, r: 4.5 + this.rng() * 2 });
    }
    const forest = (x: number, z: number) =>
      !isInRiver(x, z, 6.5) &&
      Math.hypot(x - this.cfg.world.plateauCenter.x, z - this.cfg.world.plateauCenter.z) >
        this.cfg.world.plateauRadius + 2 &&
      distanceToPath(x, z) > 2.1 &&
      x - z * 0.35 < 34; // keep the rocky NE sparse
    const spots = this.scatter(Math.round(132 * scale), (x, z) => {
      if (!forest(x, z)) return false;
      for (const c of clearings) {
        if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
      }
      let groveBoost = 0.55;
      for (const g of groves) {
        const d = Math.hypot(x - g.x, z - g.z);
        if (d < 11) groveBoost = Math.max(groveBoost, 1.6 - d * 0.08);
      }
      const density =
        (0.35 + smoothstep(10, -30, x + z * 0.2) * 0.75 + (this.rng() - 0.5) * 0.3) * groveBoost;
      return this.rng() < density;
    });

    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.38, 1.7, 7);
    trunkGeo.translate(0, 0.85, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: this.gpt.bark_deep ?? this.barkTex,
      roughness: 0.95,
    });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    // Birch variant: pale bark, slimmer trunk (GPT sheet B).
    const birchTrunkMat = new THREE.MeshStandardMaterial({
      map: this.gpt.bark_birch ?? this.barkTex,
      color: this.gpt.bark_birch ? 0xffffff : 0xd9d2bd,
      roughness: 0.9,
    });
    const birchTrunks = new THREE.InstancedMesh(trunkGeo, birchTrunkMat, spots.length);

    // Branches for broadleaf trees: short tilted limbs reaching into
    // the canopy, so a tree reads as trunk + branches + leaf masses
    // rather than lollipops. Same bark material as the trunks.
    const branchGeo = new THREE.CylinderGeometry(0.04, 0.085, 1.15, 5);
    branchGeo.translate(0, 0.55, 0);
    const branches = new THREE.InstancedMesh(branchGeo, trunkMat, spots.length * 3);
    let bri = 0;

    // (2026-11-07) The broadleaf canopy is no longer built from
    // jittered foliage blobs: however rough the geometry, they read
    // as green balls with dark spots. The canopy below is assembled
    // purely from branch-spray cards along virtual limbs.

    const coneGeo = new THREE.ConeGeometry(1, 2.4, 8);
    this.jitter(coneGeo, 0.13);
    coneGeo.translate(0, 1.2, 0);
    const coneWind = makeWindMaterial(
      new THREE.MeshStandardMaterial({ map: this.foliageTex, roughness: 0.9 }),
      2.4,
      0.05,
    );
    this.windMaterials.push(coneWind);
    addInstanceFade(coneWind);
    const pines = new THREE.InstancedMesh(coneGeo, coneWind.material, spots.length * 2);
    const pineCenters = new Float32Array(spots.length * 2 * 3);
    const pineRadii = new Float32Array(spots.length * 2);
    const pineFades = new Float32Array(spots.length * 2).fill(1);
    const pineAttr = new THREE.InstancedBufferAttribute(pineFades, 1);
    coneGeo.setAttribute('aFade', pineAttr);
    this.canopy.push({ centers: pineCenters, radii: pineRadii, fades: pineFades, attr: pineAttr });

    // Branch-spray cards (owner sheet, assets/branch-cards/): each
    // card is a whole leafy branch spray, so crossed pairs placed
    // along virtual limbs read as layered branches and leaves with
    // real see-through gaps — the silhouette is leaf edges, never a
    // smooth solid. Four sprite variants get four instanced meshes.
    // A gentle wind patch sways the card tips (strength is small:
    // branch tips only, per the owner's direction).
    interface SpraySet {
      mesh: THREE.InstancedMesh;
      centers: Float32Array;
      radii: Float32Array;
      aspect: number;
      count: number;
    }
    const sprayCap = spots.length * 16;
    const makeSpraySet = (tex: THREE.Texture | undefined, setIdx: number): SpraySet => {
      const geo = new THREE.PlaneGeometry(1, 1);
      const wind = makeWindMaterial(
        new THREE.MeshStandardMaterial({
          // A missing bundled spray falls back to that set's
          // procedural reserve spray (a branch-shaped card), not
          // to a leaf-cluster blob card.
          map: tex ?? this.fallbackSprays[setIdx] ?? this.leafCardTex,
          alphaTest: 0.45,
          side: THREE.DoubleSide,
          roughness: 0.95,
        }),
        1,
        0.035,
      );
      this.windMaterials.push(wind);
      addInstanceFade(wind);
      const mesh = new THREE.InstancedMesh(geo, wind.material, sprayCap);
      const centers = new Float32Array(sprayCap * 3);
      const radii = new Float32Array(sprayCap);
      const fades = new Float32Array(sprayCap).fill(1);
      const attr = new THREE.InstancedBufferAttribute(fades, 1);
      geo.setAttribute('aFade', attr);
      this.canopy.push({ centers, radii, fades, attr });
      const img = tex?.image as { width: number; height: number } | undefined;
      return {
        mesh, centers, radii,
        aspect: img && img.width > 0 ? img.height / img.width : 0.87,
        count: 0,
      };
    };
    const spraySets = [
      makeSpraySet(this.branch.branch_1, 0),
      makeSpraySet(this.branch.branch_2, 1),
      makeSpraySet(this.branch.branch_3, 2),
      makeSpraySet(this.branch.branch_4, 3),
    ];
    // Far LOD: a crossed pair of the composited cluster sprite stands
    // in for the whole crown beyond ~27 m (swapped by updateTreeLOD);
    // every lite instance starts collapsed.
    const liteGeo = new THREE.PlaneGeometry(1, 1);
    const liteMat = new THREE.MeshStandardMaterial({
      map: this.branch.branch_cluster ?? this.leafCardTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.95,
    });
    addInstanceFade(liteMat);
    const liteMesh = new THREE.InstancedMesh(liteGeo, liteMat, spots.length * 2);
    const liteCenters = new Float32Array(spots.length * 2 * 3);
    const liteRadii = new Float32Array(spots.length * 2);
    const liteFades = new Float32Array(spots.length * 2).fill(1);
    const liteAttr = new THREE.InstancedBufferAttribute(liteFades, 1);
    liteGeo.setAttribute('aFade', liteAttr);
    this.canopy.push({ centers: liteCenters, radii: liteRadii, fades: liteFades, attr: liteAttr });
    this.liteMesh = liteMesh;
    this.liteRadiiArr = liteRadii;
    this.liteBase = new Float32Array(spots.length * 2 * 16);
    const liteBase = this.liteBase;
    const liteImg = this.branch.branch_cluster?.image as
      { width: number; height: number } | undefined;
    const liteAspect = liteImg && liteImg.width > 0 ? liteImg.height / liteImg.width : 0.87;
    let liteCount = 0;
    let cardCycle = 0;
    const cardTint = new THREE.Color();
    const placeCard = (
      setIdx: number, x: number, y: number, z: number,
      yaw: number, tiltX: number, roll: number, w: number,
      tint: THREE.Color, radius: number,
      refs: Array<{ set: number; index: number }>,
    ): void => {
      const set = spraySets[setIdx];
      if (set.count >= sprayCap) return;
      const idx = set.count++;
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(tiltX, yaw, roll);
      this.dummy.scale.set(w, w * set.aspect, w);
      this.dummy.updateMatrix();
      set.mesh.setMatrixAt(idx, this.dummy.matrix);
      set.mesh.setColorAt(idx, tint);
      set.centers[idx * 3] = x;
      set.centers[idx * 3 + 1] = y;
      set.centers[idx * 3 + 2] = z;
      set.radii[idx] = radius;
      refs.push({ set: setIdx, index: idx });
    };

    const cA = new THREE.Color(0x4e8f3e);
    const cB = new THREE.Color(0x77a944);
    const cC = new THREE.Color(0x3c7a44);
    const tmp = new THREE.Color();
    let pi = 0;

    spots.forEach((s, i) => {
      const y = this.groundY(s.x, s.z);
      // Wider size spread: many young trees, a few landmarks.
      const size = 0.65 + Math.pow(this.rng(), 1.35) * 1.45;
      // Three silhouettes: round broadleaf, two-tier pine, slim poplar.
      const roll = this.rng();
      const pine = s.z < -14 || roll < 0.22;
      const slim = !pine && roll >= 0.62 && roll < 0.8;
      const birch = !pine && !slim && roll >= 0.8;
      if (birch) {
        this.setInstance(birchTrunks, i, s.x, y - 0.1, s.z, this.rng() * Math.PI,
          size * 0.7, size * 1.25, size * 0.7);
        this.setInstance(trunks, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      } else {
        this.setInstance(trunks, i, s.x, y - 0.1, s.z, this.rng() * Math.PI,
          size, size * (pine ? 1.5 : slim ? 2.1 : 1.1), size);
        this.setInstance(birchTrunks, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      }
      tmp.copy(cA).lerp(this.rng() < 0.5 ? cB : cC, this.rng() * 0.8);
      if (pine) {
        for (let k = 0; k < 2; k++) {
          const baseY = y + 1.3 * size + k * 1.05 * size;
          this.setInstance(pines, pi, s.x, baseY, s.z,
            this.rng() * Math.PI, size * (1.25 - k * 0.34), size * 1.15, size * (1.25 - k * 0.34));
          pines.setColorAt(pi, tmp);
          pineCenters[pi * 3] = s.x;
          pineCenters[pi * 3 + 1] = baseY + 1.38 * size;
          pineCenters[pi * 3 + 2] = s.z;
          pineRadii[pi] = size * 1.45;
          pi++;
        }
      } else {
        // Broadleaf canopy: three silhouettes — tall (the poplar
        // slot), wide (default) and young (small sizes). Crossed
        // branch-spray cards sit along virtual limbs radiating from
        // the trunk top; one dark spray at the crown's heart gives
        // depth. No solid mass anywhere: every part of the silhouette
        // is leaf edge or a real gap.
        const arch = slim ? 'tall' : size < 0.95 ? 'young' : 'wide';
        const refs: Array<{ set: number; index: number }> = [];
        const crownY = arch === 'tall' ? 3.35 : arch === 'young' ? 1.95 : 2.5;
        const clusters = arch === 'tall' ? 6 : arch === 'young' ? 4 : 10;
        const spreadR = (arch === 'tall' ? 0.52 : arch === 'young' ? 0.48 : 0.95) * size;
        const cardW = (arch === 'tall' ? 1.6 : arch === 'young' ? 1.25 : 1.85) * size;
        const baseAz = this.rng() * Math.PI * 2;
        for (let c = 0; c < clusters; c++) {
          const az = baseAz + (c / clusters) * Math.PI * 2 + (this.rng() - 0.5) * 0.7;
          const rr = spreadR * (0.45 + this.rng() * 0.6);
          const cx = s.x + Math.cos(az) * rr;
          const cz = s.z + Math.sin(az) * rr;
          const cy = y + (crownY + (this.rng() - 0.5) * 0.85) * size;
          for (let p = 0; p < 2; p++) {
            const yaw = az + Math.PI / 2 + p * (Math.PI / 2) + (this.rng() - 0.5) * 0.6;
            // The last cluster's second card is the drooping spray,
            // so the crown's lower rim hangs instead of rounding off.
            const texIdx = c === clusters - 1 && p === 1 ? 2 : cardCycle++ % 4;
            cardTint.setRGB(0.74, 0.87, 0.68).multiplyScalar(0.85 + this.rng() * 0.15);
            if (birch) cardTint.multiplyScalar(1.02);
            placeCard(texIdx, cx, cy, cz, yaw,
              -0.3 + this.rng() * 0.45, (this.rng() - 0.5) * 0.5,
              cardW * (0.85 + this.rng() * 0.35), cardTint, cardW * 0.55, refs);
          }
        }
        // Inner depth sprays: dark olive, deep in the crown —
        // three of them since 2026-11-07 (Claude §12-2: denser
        // crowns in a calmer green).
        cardTint.setRGB(0.34, 0.39, 0.3).multiplyScalar(0.9 + this.rng() * 0.2);
        if (birch) cardTint.multiplyScalar(1.02);
        placeCard(cardCycle++ % 4, s.x, y + (crownY - 0.25) * size, s.z,
          this.rng() * Math.PI, -0.2, 0, cardW * 1.05, cardTint, cardW * 0.5, refs);
        cardTint.setRGB(0.46, 0.5, 0.4).multiplyScalar(0.9 + this.rng() * 0.2);
        if (birch) cardTint.multiplyScalar(1.02);
        placeCard(cardCycle++ % 4, s.x + 0.3 * size, y + (crownY - 0.05) * size, s.z - 0.24 * size,
          this.rng() * Math.PI, -0.1, 0.15, cardW * 0.9, cardTint, cardW * 0.45, refs);
        cardTint.setRGB(0.52, 0.56, 0.45).multiplyScalar(0.9 + this.rng() * 0.2);
        if (birch) cardTint.multiplyScalar(1.02);
        placeCard(cardCycle++ % 4, s.x - 0.3 * size, y + (crownY - 0.12) * size, s.z + 0.26 * size,
          this.rng() * Math.PI, -0.15, -0.1, cardW * 0.95, cardTint, cardW * 0.45, refs);
        // Far-LOD crossed pair (cluster sprite). Its real matrix is
        // kept in liteBase; the live instance starts collapsed and
        // updateTreeLOD swaps it in beyond ~27 m.
        const liteW = (arch === 'young' ? 2.3 : 3.2) * size;
        const liteY = y + crownY * size;
        const liteIdx: number[] = [];
        cardTint.setRGB(0.79, 0.88, 0.72);
        for (let p = 0; p < 2; p++) {
          const idx = liteCount++;
          this.dummy.position.set(s.x, liteY, s.z);
          this.dummy.rotation.set(-0.25, baseAz + p * (Math.PI / 2), 0);
          this.dummy.scale.set(liteW, liteW * liteAspect, liteW);
          this.dummy.updateMatrix();
          this.dummy.matrix.toArray(liteBase, idx * 16);
          liteMesh.setColorAt(idx, cardTint);
          liteCenters[idx * 3] = s.x;
          liteCenters[idx * 3 + 1] = liteY;
          liteCenters[idx * 3 + 2] = s.z;
          liteIdx.push(idx);
          this.setInstance(liteMesh, idx, 0, -50, 0, 0, 0.001, 0.001, 0.001);
        }
        this.lodTrees.push({ x: s.x, z: s.z, refs, lite: liteIdx, far: false });
      }
      this.groundDiscs.push({
        x: s.x, z: s.z, r: 0.85 * size,
        tint: new THREE.Color().setHSL(0.08, 0.3, 0.1 + this.rng() * 0.03),
      });
      if (!pine) {
        for (let b = 0; b < 3; b++) {
          const yaw = this.rng() * Math.PI * 2;
          const tilt = 0.55 + this.rng() * 0.4;
          this.dummy.position.set(s.x, y + size * (0.95 + b * 0.32), s.z);
          this.dummy.rotation.set(Math.sin(yaw) * tilt, 0, Math.cos(yaw) * tilt);
          const bs = size * (0.85 - b * 0.18);
          this.dummy.scale.set(bs, bs, bs);
          this.dummy.updateMatrix();
          branches.setMatrixAt(bri++, this.dummy.matrix);
        }
      }
    });
    // Hide unused instances (pine vs broadleaf split) with zero scale.
    for (let i = pi; i < spots.length * 2; i++) this.setInstance(pines, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (let i = bri; i < spots.length * 3; i++) this.setInstance(branches, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (const set of spraySets) {
      for (let i = set.count; i < sprayCap; i++) {
        this.setInstance(set.mesh, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      }
      // Draw only the placed instances: the capacity slack would
      // still cost vertex processing on every frame.
      set.mesh.count = set.count;
      if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
      set.mesh.receiveShadow = true;
      this.group.add(set.mesh);
      // Base matrices for the LOD swap (restore after a far phase).
      this.spraySets.push({
        mesh: set.mesh,
        base: new Float32Array(set.mesh.instanceMatrix.array),
      });
    }
    for (let i = liteCount; i < spots.length * 2; i++) {
      this.setInstance(liteMesh, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    }
    liteMesh.count = liteCount;
    if (liteMesh.instanceColor) liteMesh.instanceColor.needsUpdate = true;
    liteMesh.receiveShadow = true;
    this.group.add(liteMesh);
    birchTrunks.castShadow = true;
    this.group.add(birchTrunks);

    for (const m of [trunks, pines, branches]) {
      m.castShadow = true;
      m.receiveShadow = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
    }
  }

  /* ---------------- grass & flowers ---------------- */
  private buildGrass(scale: number): void {
    // Grass tufts: GPT sheet-E sprites (short / wide / dry variants)
    // on crossed alpha-cutout planes, ankle-to-shin height against
    // the player. The procedural canvas tuft is the fallback if the
    // images failed to decode. Distribution follows a meadow noise
    // mask (colonies + bare patches), dry tufts hug the path and dry
    // zones, wide tufts fill meadow cores.
    const tuftGeo = this.crossPlanes(1.05, 0.62);
    const count = Math.round(4200 * scale);
    const spots = this.scatter(count, (x, z) =>
      !this.hostileToPlants(x, z) &&
      !isInRiver(x, z, 4.4) &&
      this.groundY(x, z) > 0.42 &&
      distanceToPath(x, z) > 1.35 &&
      x - z * 0.35 < 40 &&
      (this.vnoise(x * 0.06 + 7.3, z * 0.06 - 2.9) > 0.36 || this.rng() < 0.12));
    const variants: Array<{ tex: THREE.Texture | undefined; list: Array<{ x: number; z: number }> }> = [
      { tex: this.gpt.grass_short, list: [] },
      { tex: this.gpt.grass_wide, list: [] },
      { tex: this.gpt.grass_dry, list: [] },
    ];
    for (const s of spots) {
      const dry =
        distanceToPath(s.x, s.z) < 3.4 ||
        this.vnoise(s.x * 0.11 - 4.2, s.z * 0.11 + 9.1) > 0.72;
      const wide = !dry && this.vnoise(s.x * 0.06 + 7.3, s.z * 0.06 - 2.9) > 0.62;
      variants[dry ? 2 : wide ? 1 : 0].list.push(s);
    }
    const tmp = new THREE.Color();
    for (const v of variants) {
      if (v.list.length === 0) continue;
      const wind = makeWindMaterial(
        new THREE.MeshStandardMaterial({
          map: v.tex ?? this.tuftTex,
          alphaTest: 0.35,
          side: THREE.DoubleSide,
          roughness: 0.92,
        }),
        0.5,
        0.09,
      );
      this.windMaterials.push(wind);
      const mesh = new THREE.InstancedMesh(tuftGeo, wind.material, v.list.length);
      v.list.forEach((s, i) => {
        // Height capped (2026-11-06): scenery tufts stay at ankle-to-
        // shin height so the game's taller gatherable grass clumps
        // read as a different thing, not more of the same carpet.
        const sc = 0.8 + this.rng() * 0.45;
        const tall = this.rng() < 0.12 ? 1.12 : 1;
        const ry = this.rng() * Math.PI;
        const sy = sc * tall * 0.92;
        const y = this.groundY(s.x, s.z) - 0.02;
        this.setInstance(mesh, i, s.x, y, s.z, ry, sc, sy, sc);
        this.coverSpots.push({ mesh, index: i, x: s.x, y, z: s.z, ry, sx: sc, sy, sz: sc });
        // Slightly luminous yellow-green so tufts separate from the
        // (already grassy) GPT ground tile instead of dissolving in.
        const b = 0.88 + this.rng() * 0.22;
        mesh.setColorAt(i, tmp.setRGB(b * 0.88, b * 1.06, b * 0.8));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Wildflowers as sprite tufts (GPT sheet E: white/yellow/purple).
    const fCount = Math.round(240 * scale);
    const fSpots = this.scatter(fCount, (x, z) =>
      !this.hostileToPlants(x, z) &&
      !isInRiver(x, z, 6) &&
      this.groundY(x, z) > 0.45 &&
      this.groundY(x, z) < 1.8 &&
      x - z * 0.35 < 26);
    const flowerTexs = [this.gpt.flower_white, this.gpt.flower_yellow, this.gpt.flower_purple];
    const per = Math.max(1, Math.ceil(fSpots.length / 3));
    flowerTexs.forEach((tex, vi) => {
      const list = fSpots.slice(vi * per, (vi + 1) * per);
      if (list.length === 0) return;
      const mat = new THREE.MeshStandardMaterial({
        map: tex ?? this.tuftTex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.9,
      });
      const mesh = new THREE.InstancedMesh(this.crossPlanes(0.55, 0.38), mat, list.length);
      list.forEach((s, i) => {
        const sc = 0.75 + this.rng() * 0.35;
        const ry = this.rng() * Math.PI;
        const y = this.groundY(s.x, s.z) - 0.01;
        this.setInstance(mesh, i, s.x, y, s.z, ry, sc, sc, sc);
        this.coverSpots.push({ mesh, index: i, x: s.x, y, z: s.z, ry, sx: sc, sy: sc, sz: sc });
      });
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });

    // Decorative herb patches (NOT harvest nodes — those come from
    // the game through ResourceRenderer; these are landscape only).
    if (this.gpt.herb_patch) {
      const hCount = Math.round(130 * scale);
      const hSpots = this.scatter(hCount, (x, z) =>
        !isInRiver(x, z, 5) &&
        this.groundY(x, z) > 0.45 &&
        (x + z * 0.2 < -4 || this.vnoise(x * 0.05 - 8, z * 0.05 + 5) > 0.6));
      const mat = new THREE.MeshStandardMaterial({
        map: this.gpt.herb_patch,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.92,
      });
      const mesh = new THREE.InstancedMesh(this.crossPlanes(0.7, 0.42), mat, hSpots.length);
      hSpots.forEach((s, i) => {
        // Kept smaller than the game's herb node and thinned around
        // real nodes (coverSpots), so decoration never reads as the
        // harvestable patch.
        const sc = 0.7 + this.rng() * 0.35;
        const ry = this.rng() * Math.PI;
        const y = this.groundY(s.x, s.z) - 0.01;
        this.setInstance(mesh, i, s.x, y, s.z, ry, sc, sc, sc);
        this.coverSpots.push({ mesh, index: i, x: s.x, y, z: s.z, ry, sx: sc, sy: sc, sz: sc });
      });
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /* ---------------- shrubs, ferns, leaf litter ---------------- */
  private buildGroundCover(scale: number, shrubsOn = true): void {
    // Shrubs (2026-11-06 overhaul): a jittered 3-blob cluster per
    // shrub (dark satellite = inner shade) plus alpha-cutout leaf
    // cards on the surface, instead of one smooth single-colour ball.
    const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1);
    this.jitter(shrubGeo, 0.34);
    const shrubMat = new THREE.MeshStandardMaterial({ map: this.foliageTex, roughness: 0.95 });
    const sCount = shrubsOn ? Math.round(150 * scale) : 0;
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, sCount * 3);
    const cards = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.8, 0.66),
      new THREE.MeshStandardMaterial({
        map: this.gpt.leaf_shrub ?? this.leafCardTex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.95,
      }),
      sCount * 4,
    );
    const cA = new THREE.Color(0x477f36);
    const cB = new THREE.Color(0x6da34c);
    const tmp = new THREE.Color();
    const spots = this.scatter(sCount, (x, z) => !isInRiver(x, z, 5.6) && distanceToPath(x, z) > 1.8);
    let bi = 0;
    let ci = 0;
    spots.forEach((s) => {
      const sc = 0.6 + this.rng() * 1.1;
      const y = this.groundY(s.x, s.z);
      const parts: Array<[number, number, number, number, number]> = [
        // [dx, dy, dz, scale, shade]
        [0, 0.3, 0, 1, 1],
        [0.4, 0.2, 0.14, 0.62, 0.82],
        [-0.34, 0.17, -0.2, 0.52, 0.62],
      ];
      for (const [dx, dy, dz, ps, shade] of parts) {
        this.setInstance(shrubs, bi, s.x + dx * sc, y + dy * sc, s.z + dz * sc,
          this.rng() * Math.PI, sc * ps, sc * ps * 0.72, sc * ps);
        shrubs.setColorAt(bi, tmp.copy(cA).lerp(cB, this.rng()).multiplyScalar(shade));
        bi++;
      }
      for (let k = 0; k < 4; k++) {
        const a = this.rng() * Math.PI * 2;
        const px = s.x + Math.cos(a) * 0.42 * sc;
        const pz = s.z + Math.sin(a) * 0.42 * sc;
        this.dummy.position.set(px, y + (0.42 + this.rng() * 0.25) * sc, pz);
        this.dummy.rotation.set(-0.5 - this.rng() * 0.5, a, 0);
        const cs = sc * (0.75 + this.rng() * 0.5);
        this.dummy.scale.set(cs, cs, cs);
        this.dummy.updateMatrix();
        cards.setMatrixAt(ci++, this.dummy.matrix);
      }
      this.groundDiscs.push({
        x: s.x, z: s.z, r: 0.8 * sc,
        tint: new THREE.Color(0x3e2f1f),
      });
    });
    for (let i = bi; i < sCount * 3; i++) this.setInstance(shrubs, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (let i = ci; i < sCount * 4; i++) this.setInstance(cards, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
    shrubs.castShadow = true;
    this.group.add(shrubs);
    this.group.add(cards);

    // Ferns hug the riverbanks and forest floor — frond cutouts now,
    // not green cones.
    const fernGeo = this.crossPlanes(0.95, 0.55);
    const fernMat = new THREE.MeshStandardMaterial({
      map: this.gpt.fern_frond ?? this.fernTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const fCount = Math.round(170 * scale);
    const ferns = new THREE.InstancedMesh(fernGeo, fernMat, fCount);
    const fSpots = this.scatter(fCount, (x, z) => {
      const nearRiver = distanceToRiver(x, z) < 10;
      const inForest = x + z * 0.2 < -6;
      return (nearRiver || inForest) && !isInRiver(x, z, 4.6);
    });
    fSpots.forEach((s, i) => {
      const sc = 0.8 + this.rng() * 0.9;
      this.setInstance(ferns, i, s.x, this.groundY(s.x, s.z), s.z,
        this.rng() * Math.PI, sc, sc, sc);
    });
    this.group.add(ferns);

    // Ground decals (soft alpha-masked texture patches, no square
    // borders): leaf litter under the canopy, gravel on the banks,
    // worn dirt along the path. One helper, three materials.
    const decal = (
      tex: THREE.Texture | undefined,
      tints: THREE.Color[],
      count: number,
      accept: (x: number, z: number) => boolean,
      sMin: number,
      sMax: number,
      repeat = 1.6,
    ) => {
      const geo = new THREE.CircleGeometry(0.95, 14);
      geo.rotateX(-Math.PI / 2);
      let map = tex;
      if (tex) {
        map = tex.clone();
        map.repeat.set(repeat, repeat);
        map.needsUpdate = true;
      }
      const mat = new THREE.MeshStandardMaterial({
        map: map ?? this.patchTex,
        alphaMap: tex ? this.patchAlpha : undefined,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const spots = this.scatter(count, accept);
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach((s, i) => {
        const sc = sMin + this.rng() * (sMax - sMin);
        this.setInstance(mesh, i, s.x, this.groundY(s.x, s.z) + 0.025, s.z,
          this.rng() * Math.PI, sc, 1, sc);
        mesh.setColorAt(i, tints[Math.floor(this.rng() * tints.length)]);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    decal(
      this.gpt.ground_leaves,
      [new THREE.Color(0xd9d0bf), new THREE.Color(0xcfc2ab), new THREE.Color(0xe2d8c6)],
      Math.round(190 * scale),
      (x, z) => x + z * 0.2 < 4 && !isInRiver(x, z, 5),
      0.7, 2.0,
      1.15,
    );
    decal(
      this.gpt.ground_gravel,
      [new THREE.Color(0x9a958c), new THREE.Color(0x8a8378), new THREE.Color(0xa89f8d)],
      Math.round(120 * scale),
      (x, z) => {
        const d = distanceToRiver(x, z);
        return d > 2.8 && d < 7 && this.groundY(x, z) > 0.3;
      },
      1.0, 2.4,
    );
    decal(
      this.gpt.ground_dirt,
      [new THREE.Color(0xa08050), new THREE.Color(0x8f7040)],
      Math.round(130 * scale),
      (x, z) => {
        const d = distanceToPath(x, z);
        return d > 0.7 && d < 2.6 && this.groundY(x, z) > 0.42;
      },
      0.8, 1.7,
    );
    // Fallen-leaf piles as flat sprites (GPT sheet F) under trees.
    if (this.gpt.prop_leaves_pile) {
      const pCount = Math.round(80 * scale);
      const pSpots = this.scatter(pCount, (x, z) => x + z * 0.2 < -2 && !isInRiver(x, z, 5.5));
      const geo = new THREE.PlaneGeometry(0.95, 0.75);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        map: this.gpt.prop_leaves_pile,
        alphaTest: 0.5,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, pSpots.length);
      pSpots.forEach((s, i) => {
        const sc = 0.7 + this.rng() * 0.6;
        this.setInstance(mesh, i, s.x, this.groundY(s.x, s.z) + 0.03, s.z,
          this.rng() * Math.PI, sc, 1, sc);
      });
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /* ---------------- rocks & cliffs ---------------- */
  private buildRocks(scale: number): void {
    // Chunkier, irregular rocks (2026-11-06): low-segment geometry
    // with position-hashed vertex jitter (same input position -> same
    // offset, so shared vertices never crack apart), sunk and
    // squashed into the ground, darker granite colours, clustered
    // towards the highland instead of evenly scattered pale domes.
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    this.jitter(rockGeo, 0.3);
    {
      // Base grime: darker, slightly mossy towards the ground line so
      // rocks sit IN the terrain instead of on it (baked as vertex
      // colours, multiplied with the crack map and instance colour).
      const posAttr = rockGeo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) {
        const t = THREE.MathUtils.clamp((posAttr.getY(i) + 1) / 2, 0, 1);
        const k = smoothstep(0.08, 0.55, t);
        colors[i * 3] = 0.5 + 0.5 * k;
        colors[i * 3 + 1] = 0.56 + 0.44 * k;
        colors[i * 3 + 2] = 0.42 + 0.58 * k;
      }
      rockGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const count = Math.round(170 * scale);
    // Two rock materials (GPT sheet C): layered rock generally, the
    // mossy variant near the river and in the forest shade. Each mesh
    // gets its own geometry clone (per-mesh aFade attribute).
    const makeRockMesh = (tex: THREE.Texture | undefined) => {
      const geo = rockGeo.clone();
      const mat = new THREE.MeshStandardMaterial({
        map: tex ?? this.rockCrackTex,
        roughness: 0.98,
        flatShading: true,
        vertexColors: true,
      });
      addInstanceFade(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      const centers = new Float32Array(count * 3);
      const radii = new Float32Array(count);
      const fades = new Float32Array(count).fill(1);
      const attr = new THREE.InstancedBufferAttribute(fades, 1);
      geo.setAttribute('aFade', attr);
      this.canopy.push({ centers, radii, fades, attr });
      return { mesh, centers, radii, n: 0 };
    };
    const rocks = makeRockMesh(this.gpt.rock_layered);
    const mossRocks = makeRockMesh(this.gpt.rock_moss);
    const cA = new THREE.Color(0x76767c);
    const cB = new THREE.Color(0x9c968a);
    const tmp = new THREE.Color();
    const pc = this.cfg.world.plateauCenter;
    const spots = this.scatter(count, (x, z) =>
      !isInRiver(x, z, 4.8) &&
      Math.hypot(x - pc.x, z - pc.z) > this.cfg.world.plateauRadius + 3.5 &&
      distanceToPath(x, z) > 2.4 &&
      // density follows the rocky highland; sparse elsewhere
      this.rng() < 0.35 + smoothstep(10, 42, x - z * 0.35) * 0.85);
    spots.forEach((s) => {
      const highland = smoothstep(16, 44, s.x - s.z * 0.35);
      const sc = (0.25 + Math.pow(this.rng(), 1.8) * 1.1) * (1 + highland * 2.6);
      const y = this.groundY(s.x, s.z) + sc * 0.02;
      // Mossy texture where the world is wet or shaded: near the
      // river, or deep in the forest side. Highland rocks get a
      // slate-blue instance tint over the layered texture.
      const mossy = distanceToRiver(s.x, s.z) < 10 || s.x + s.z * 0.2 < -18;
      const target = mossy ? mossRocks : rocks;
      const i = target.n++;
      this.dummy.position.set(s.x, y, s.z);
      this.dummy.rotation.set(this.rng() * 0.6, this.rng() * Math.PI, this.rng() * 0.6);
      this.dummy.scale.set(sc * (0.8 + this.rng() * 0.5), sc * (0.5 + this.rng() * 0.3), sc * (0.8 + this.rng() * 0.5));
      this.dummy.updateMatrix();
      target.mesh.setMatrixAt(i, this.dummy.matrix);
      tmp.copy(cA).lerp(cB, this.rng());
      if (highland > 0.55) tmp.lerp(new THREE.Color(0x707a8c), 0.5);
      target.mesh.setColorAt(i, tmp);
      target.centers[i * 3] = s.x;
      target.centers[i * 3 + 1] = y + sc * 0.35;
      target.centers[i * 3 + 2] = s.z;
      target.radii[i] = sc * 1.05;
      if (sc > 0.45) {
        this.groundDiscs.push({
          x: s.x, z: s.z, r: sc * 1.05,
          tint: new THREE.Color(0x403a33),
        });
      }
    });
    for (const target of [rocks, mossRocks]) {
      for (let i = target.n; i < count; i++) {
        this.setInstance(target.mesh, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      }
      if (target.mesh.instanceColor) target.mesh.instanceColor.needsUpdate = true;
      target.mesh.castShadow = true;
      target.mesh.receiveShadow = true;
      this.group.add(target.mesh);
    }

    // NOTE (2026-11-06): scenery rocks used to carry decorative
    // mineral crystals. Removed — crystals now belong exclusively to
    // the game-owned 'ore' node type, so a crystal always means a
    // harvestable deposit and plain rocks read as plain rocks.
  }

  /* ---------------- riverbank pebbles & wet stones ---------------- */
  private buildRiverbank(scale: number): void {
    const pebGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const pebMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const count = Math.round(260 * scale);
    const pebbles = new THREE.InstancedMesh(pebGeo, pebMat, count);
    const cA = new THREE.Color(0x9a958a);
    const cB = new THREE.Color(0x6f6a61);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const z = (this.rng() * 2 - 1) * (this.cfg.world.size / 2 - 2);
      const side = this.rng() < 0.5 ? -1 : 1;
      const x = riverCenterX(z) + side * (3.6 + this.rng() * 2.6);
      const sc = 0.5 + this.rng() * 1.5;
      if (this.inClearing(x, z)) {
        this.setInstance(pebbles, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      } else {
        this.setInstance(pebbles, i, x, Math.max(this.groundY(x, z), 0.1) + 0.03, z,
          this.rng() * Math.PI, sc, sc * 0.55, sc);
      }
      pebbles.setColorAt(i, tmp.copy(cA).lerp(cB, this.rng()));
    }
    if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
    pebbles.receiveShadow = true;
    this.group.add(pebbles);
  }

  /* ---------------- fallen logs & branches ---------------- */
  private buildFallenLogs(): void {
    const logMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 1 });
    const endMat = new THREE.MeshStandardMaterial({ color: 0xa97f52, roughness: 1 });
    const pc = this.cfg.world.plateauCenter;
    for (let i = 0; i < 7; i++) {
      const x = -34 + this.rng() * 44;
      const z = -30 + this.rng() * 62;
      if (isInRiver(x, z, 6)) continue;
      // Never drop a log across the path or through the base area —
      // it would read as a blocked route (placement is decorative,
      // but the picture must not lie about where one can walk).
      if (distanceToPath(x, z) < 2.6) continue;
      if (this.inClearing(x, z)) continue;
      if (Math.hypot(x - pc.x, z - pc.z) < this.cfg.world.plateauRadius + 2.5) continue;
      const len = 2.4 + this.rng() * 2.4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, len, 8), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = this.rng() * Math.PI;
      log.position.set(x, this.groundY(x, z) + 0.24, z);
      log.castShadow = true;
      log.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), endMat);
      cap.position.copy(log.position);
      cap.rotation.copy(log.rotation);
      cap.translateZ(len / 2 + 0.001);
      this.group.add(log);
    }
    // Fallen branches.
    const branchGeo = new THREE.CylinderGeometry(0.035, 0.06, 1.1, 5);
    const branches = new THREE.InstancedMesh(branchGeo, logMat, 60);
    for (let i = 0; i < 60; i++) {
      const x = (this.rng() * 2 - 1) * 52;
      const z = (this.rng() * 2 - 1) * 52;
      if (distanceToPath(x, z) < 1.6 || this.inClearing(x, z)) {
        this.setInstance(branches, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
        continue;
      }
      this.dummy.position.set(x, this.groundY(x, z) + 0.06, z);
      this.dummy.rotation.set(Math.PI / 2, 0, this.rng() * Math.PI);
      const sc = 0.7 + this.rng() * 0.9;
      this.dummy.scale.set(sc, sc, sc);
      this.dummy.updateMatrix();
      branches.setMatrixAt(i, this.dummy.matrix);
    }
    branches.receiveShadow = true;
    this.group.add(branches);
  }

  /* ---------------- drifting pollen / light motes ---------------- */
  private buildPollen(texture: THREE.Texture, scale: number): void {
    const count = Math.round(130 * scale);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (this.rng() * 2 - 1) * 52;
      positions[i * 3 + 1] = 0.6 + this.rng() * 6.5;
      positions[i * 3 + 2] = (this.rng() * 2 - 1) * 52;
    }
    this.pollenBase = positions.slice();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: texture,
      color: 0xfff3b0,
      size: 0.32,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.pollen = new THREE.Points(geo, mat);
    this.pollen.renderOrder = 5;
    this.group.add(this.pollen);
  }

  /* ---------------- distant mountain backdrop (parallax layer) ---------------- */
  private buildBackdropMountains(): void {
    const g = new THREE.Group();
    g.name = 'BackdropMountains';
    const rockA = new THREE.Color(0x8795ab);
    const rockB = new THREE.Color(0x67778f);
    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xf2f7fc,
      roughness: 0.85,
      flatShading: true,
    });
    // Ring placement MUST keep every cone base fully outside the
    // terrain field. In the 120-world era the guarantee was
    // dist − rad ≥ 92 (oil-field intrusion report, 2026-11-07); the
    // expanded field is ±180 (corners at radius ≈254.6), so the ring
    // moved out and the guarantee is now dist − rad ≥ 262, again
    // structural — placement rng draws differ between hosts, so no
    // layout luck is involved on either side.
    for (let i = 0; i < 13; i++) {
      const ang = (i / 13) * Math.PI * 2 + this.rng() * 0.25;
      const dist = 300 + this.rng() * 40;
      const hgt = 90 + this.rng() * 50;
      const rad = Math.min(36 + this.rng() * 24, dist - 262);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const col = rockA.clone().lerp(rockB, this.rng());
      const peak = new THREE.Mesh(
        new THREE.ConeGeometry(rad, hgt, 6),
        new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }),
      );
      peak.position.set(x, hgt / 2 - 9, z);
      peak.rotation.y = this.rng() * Math.PI;
      g.add(peak);
      const capH = hgt * 0.34;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.4, capH, 6), snowMat);
      cap.position.set(x, hgt - 9 - capH / 2 + 0.6, z);
      cap.rotation.y = peak.rotation.y;
      g.add(cap);
    }
    this.group.add(g);
  }

  /* ---------------- waterfall set piece (rocky highland spring) ----------------
   * Round 20: rebuilt on the parametric WaterfallKit (curved
   * sheet in metre UVs, fractured rocks, animated foam/splash/
   * mist, named anchors). Anchors and placement contract:
   * assets/environment-set/waterfall.json. */
  private buildWaterfall(particleTexture: THREE.Texture): void {
    const base = { x: 26.5, z: -15.5 };
    const top = { x: 30.5, z: -20.5 };
    const baseY = this.groundY(base.x, base.z);
    const topGroundY = this.groundY(top.x, top.z);
    const dir = { x: base.x - top.x, z: base.z - top.z };
    const drop = topGroundY - baseY + 2.3;
    const kit = createWaterfallKit({
      width: 2.0,
      drop,
      particleTexture,
      seed: 20261107,
      streakTexture: this.envTex['streaks'] ?? null,
      foamRingTexture: this.envTex['foamRing1'] ?? null,
      foamClusterTexture: this.envTex['foamCluster1'] ?? null,
      mossTextures: ['moss1', 'moss2'].map((k) => this.envTex[k]).filter(Boolean) as THREE.Texture[],
      detail: this.quality === 'low' ? 'low' : 'high',
    });
    kit.group.position.set(base.x, baseY, base.z);
    kit.group.rotation.y = Math.atan2(dir.x, dir.z);
    this.waterfallKit = kit;
    this.group.add(kit.group);
  }

  /* ---------------- stone stairs & retaining walls ---------------- */
  private buildStonework(): void {
    const assets = new AssetManager();
    const cobble = assets.createCobblestoneTexture();
    const g = new THREE.Group();
    g.name = 'Stonework';
    const stoneMat = (rx: number, ry: number) => {
      const t = cobble.clone();
      t.needsUpdate = true;
      t.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
    };
    const capMat = new THREE.MeshStandardMaterial({ color: 0x6f6e68, roughness: 1 });

    const boxAt = (
      mat: THREE.Material,
      w: number, h: number, d: number,
      x: number, z: number, ry: number, lift = 0,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, this.groundY(x, z) + lift + h / 2 - 0.06, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // Staircase climbing from the path end toward the highland.
    const dir = { x: 0.6, z: -0.8 };
    const stairRy = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < 7; i++) {
      const px = 20.5 + dir.x * i * 0.58;
      const pz = 5.5 + dir.z * i * 0.58;
      boxAt(stoneMat(1.6, 0.5), 2.6, 0.42, 0.66, px, pz, stairRy, i * 0.15);
    }

    // Retaining walls hugging the path and the plateau edge.
    const walls: Array<[number, number, number, number]> = [
      // x, z, length, rotationY (box length runs along local X)
      [-6, 22.9, 5.2, Math.atan2(2, 9)],
      [10.2, 15.1, 4.2, Math.atan2(5, 7)],
      [-20, 30.8, 6.4, 0],
    ];
    for (const [wx, wz, len, ry] of walls) {
      boxAt(stoneMat(len * 0.45, 0.7), len, 0.78, 0.5, wx, wz, ry, 0.05);
      boxAt(capMat, len + 0.15, 0.12, 0.62, wx, wz, ry, 0.82);
    }

    this.group.add(g);
  }
}
