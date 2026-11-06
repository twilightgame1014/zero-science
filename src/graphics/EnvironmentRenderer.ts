import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorOptions, GraphicsConfig, QualityTier } from './types';
import { AssetManager } from './AssetManager';
import {
  distanceToPath,
  distanceToRiver,
  isInRiver,
  mulberry32,
  riverCenterX,
  segmentPointDistance,
  smoothstep,
  terrainHeight,
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
  private cfg: GraphicsConfig;
  private windMaterials: WindMaterial[] = [];
  private pollen: THREE.Points | null = null;
  private pollenBase: Float32Array | null = null;
  private fallsUniforms: { uTime: { value: number } } | null = null;
  private mist: THREE.Sprite | null = null;
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
  /** Soft soil/leaf discs that ground trees and rocks (collected
   *  during their builds, instanced once at the end). */
  private groundDiscs: Array<{ x: number; z: number; r: number; tint: THREE.Color }> = [];

  constructor(
    cfg: GraphicsConfig,
    quality: QualityTier,
    particleTexture: THREE.Texture,
    gpt: Record<string, THREE.Texture> = {},
    decor: DecorOptions = {},
  ) {
    this.cfg = cfg;
    this.gpt = gpt;
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
    this.patchTex = am.createGroundPatchTexture();
    this.patchAlpha = am.createPatchAlphaTexture();

    // Families the game owns as natural objects can be switched off
    // (GraphicsOptions.decor) so scenery never doubles as a fake
    // harvest target. Fine detail (grass, ferns, litter, decals)
    // always stays renderer-side.
    if (decor.trees !== false) this.buildTrees(scale);
    this.buildGrass(scale);
    this.buildGroundCover(scale, decor.shrubs !== false);
    if (decor.rocks !== false) this.buildRocks(scale);
    if (decor.pebbles !== false) this.buildRiverbank(scale);
    if (decor.logs !== false) this.buildFallenLogs();
    this.buildPollen(particleTexture, scale);
    this.buildBackdropMountains();
    this.buildWaterfall(particleTexture);
    this.buildStonework();
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
    if (this.fallsUniforms) this.fallsUniforms.uTime.value = time;
    if (this.mist) {
      (this.mist.material as THREE.SpriteMaterial).opacity =
        0.22 + Math.sin(time * 0.8) * 0.06;
    }
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
        const goal = d < r + 0.45 ? FADE_MIN : 1;
        const cur = set.fades[i];
        if (cur === goal) continue;
        const next = cur + (goal - cur) * k;
        set.fades[i] = Math.abs(goal - next) < 0.01 ? goal : next;
        dirty = true;
      }
      if (dirty) set.attr.needsUpdate = true;
    }
  }

  setPollenVisible(visible: boolean): void {
    if (this.pollen) this.pollen.visible = visible;
  }

  /* ---------------- placement helpers ---------------- */
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
      if (accept(x, z)) out.push({ x, z });
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
    const branches = new THREE.InstancedMesh(branchGeo, trunkMat, spots.length * 2);
    let bri = 0;

    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    this.jitter(blobGeo, 0.36); // irregular canopy silhouette, not balls
    const blobWind = makeWindMaterial(
      new THREE.MeshStandardMaterial({ map: this.foliageTex, roughness: 0.9 }),
      1,
      0.045,
    );
    this.windMaterials.push(blobWind);
    addInstanceFade(blobWind);
    const blobs = new THREE.InstancedMesh(blobGeo, blobWind.material, spots.length * 3);
    const blobCenters = new Float32Array(spots.length * 3 * 3);
    const blobRadii = new Float32Array(spots.length * 3);
    const blobFades = new Float32Array(spots.length * 3).fill(1);
    const blobAttr = new THREE.InstancedBufferAttribute(blobFades, 1);
    blobGeo.setAttribute('aFade', blobAttr);
    this.canopy.push({ centers: blobCenters, radii: blobRadii, fades: blobFades, attr: blobAttr });

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

    // Leaf cards (GPT sheet D): alpha-cutout branch sprites layered
    // through the canopy volume, so trees read as leaf masses with
    // gaps and depth instead of textured balls alone. The blobs stay
    // underneath as the darker inner mass.
    const makeCards = (tex: THREE.Texture | undefined, fallback: THREE.Texture) => {
      const geo = new THREE.PlaneGeometry(1.15, 1.0);
      const mat = new THREE.MeshStandardMaterial({
        map: tex ?? fallback,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.95,
      });
      addInstanceFade(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length * 8);
      const centers = new Float32Array(spots.length * 8 * 3);
      const radii = new Float32Array(spots.length * 8).fill(1);
      const fades = new Float32Array(spots.length * 8).fill(1);
      const attr = new THREE.InstancedBufferAttribute(fades, 1);
      geo.setAttribute('aFade', attr);
      this.canopy.push({ centers, radii, fades, attr });
      return { mesh, centers, count: 0 };
    };
    const oakCards = makeCards(this.gpt.leaf_oak, this.leafCardTex);
    const birchCards = makeCards(this.gpt.leaf_birch, this.leafCardTex);

    const cA = new THREE.Color(0x4e8f3e);
    const cB = new THREE.Color(0x77a944);
    const cC = new THREE.Color(0x3c7a44);
    const tmp = new THREE.Color();
    let bi = 0;
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
      } else if (slim) {
        const oy = 3.35 * size;
        const r = 0.8 * size;
        this.setInstance(blobs, bi, s.x, y + oy, s.z,
          this.rng() * Math.PI, r, r * 2.1, r);
        blobs.setColorAt(bi, tmp);
        blobCenters[bi * 3] = s.x;
        blobCenters[bi * 3 + 1] = y + oy;
        blobCenters[bi * 3 + 2] = s.z;
        blobRadii[bi] = r * 1.35;
        bi++;
      } else {
        for (let k = 0; k < 3; k++) {
          const ox = (this.rng() - 0.5) * 1.1 * size;
          const oz = (this.rng() - 0.5) * 1.1 * size;
          const oy = (2.1 + k * 0.55 + this.rng() * 0.3) * size;
          const r = (1.25 - k * 0.22) * size;
          this.setInstance(blobs, bi, s.x + ox, y + oy, s.z + oz,
            this.rng() * Math.PI, r, r * 0.82, r);
          blobs.setColorAt(bi, tmp);
          blobCenters[bi * 3] = s.x + ox;
          blobCenters[bi * 3 + 1] = y + oy;
          blobCenters[bi * 3 + 2] = s.z + oz;
          blobRadii[bi] = r;
          bi++;
        }
      }
      if (!pine) {
        const cards = birch ? birchCards : oakCards;
        const nCards = slim ? 3 : 8;
        const cy = y + (slim ? 3.35 : 2.55) * size;
        // Cards sit ON the canopy surface (radius ~ blob extent), not
        // inside the blob volume where they'd be swallowed.
        const spread = size * (slim ? 0.55 : 1.12);
        for (let k = 0; k < nCards; k++) {
          const a = this.rng() * Math.PI * 2;
          const rr = spread * (0.55 + this.rng() * 0.5);
          const px = s.x + Math.cos(a) * rr;
          const pz = s.z + Math.sin(a) * rr;
          const py = cy + (this.rng() - 0.5) * 1.1 * size;
          this.dummy.position.set(px, py, pz);
          this.dummy.rotation.set((this.rng() - 0.5) * 0.9, this.rng() * Math.PI, (this.rng() - 0.5) * 0.5);
          const cs = size * (1.1 + this.rng() * 0.55);
          this.dummy.scale.set(cs, cs, cs);
          this.dummy.updateMatrix();
          cards.mesh.setMatrixAt(cards.count, this.dummy.matrix);
          // Bright warm tint so cards read as sunlit leaf surface
          // against the darker blob mass beneath them.
          cards.mesh.setColorAt(cards.count,
            new THREE.Color(1.22, 1.26, 1.08).multiplyScalar(0.92 + this.rng() * 0.16));
          cards.centers[cards.count * 3] = px;
          cards.centers[cards.count * 3 + 1] = py;
          cards.centers[cards.count * 3 + 2] = pz;
          cards.count++;
        }
      }
      this.groundDiscs.push({
        x: s.x, z: s.z, r: 0.85 * size,
        tint: new THREE.Color().setHSL(0.08, 0.3, 0.1 + this.rng() * 0.03),
      });
      if (!pine) {
        for (let b = 0; b < 2; b++) {
          const yaw = this.rng() * Math.PI * 2;
          const tilt = 0.55 + this.rng() * 0.4;
          this.dummy.position.set(s.x, y + size * (1.05 + b * 0.38), s.z);
          this.dummy.rotation.set(Math.sin(yaw) * tilt, 0, Math.cos(yaw) * tilt);
          const bs = size * (0.85 - b * 0.18);
          this.dummy.scale.set(bs, bs, bs);
          this.dummy.updateMatrix();
          branches.setMatrixAt(bri++, this.dummy.matrix);
        }
      }
    });
    // Hide unused instances (pine vs round split) with zero scale.
    for (let i = bi; i < spots.length * 3; i++) this.setInstance(blobs, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (let i = pi; i < spots.length * 2; i++) this.setInstance(pines, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (let i = bri; i < spots.length * 2; i++) this.setInstance(branches, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (const cards of [oakCards, birchCards]) {
      for (let i = cards.count; i < spots.length * 8; i++) {
        this.setInstance(cards.mesh, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
      }
      if (cards.mesh.instanceColor) cards.mesh.instanceColor.needsUpdate = true;
      cards.mesh.receiveShadow = true;
      this.group.add(cards.mesh);
    }
    birchTrunks.castShadow = true;
    this.group.add(birchTrunks);

    for (const m of [trunks, blobs, pines, branches]) {
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
        const sc = 0.85 + this.rng() * 0.55;
        const tall = this.rng() < 0.12 ? 1.5 : 1;
        this.setInstance(mesh, i, s.x, this.groundY(s.x, s.z) - 0.02, s.z,
          this.rng() * Math.PI, sc, sc * tall * 0.92, sc);
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
        const sc = 0.8 + this.rng() * 0.5;
        this.setInstance(mesh, i, s.x, this.groundY(s.x, s.z) - 0.01, s.z,
          this.rng() * Math.PI, sc, sc, sc);
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
        const sc = 0.85 + this.rng() * 0.6;
        this.setInstance(mesh, i, s.x, this.groundY(s.x, s.z) - 0.01, s.z,
          this.rng() * Math.PI, sc, sc, sc);
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
      this.setInstance(pebbles, i, x, Math.max(this.groundY(x, z), 0.1) + 0.03, z,
        this.rng() * Math.PI, sc, sc * 0.55, sc);
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
      if (distanceToPath(x, z) < 1.6) {
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
    // Ring pulled closer and peaks raised for the low exploration
    // camera (2026-11-06): at the old 138–172 distance the 70–165 fog
    // washed the silhouettes out almost completely, leaving a blank
    // horizon above the terrain rim.
    for (let i = 0; i < 13; i++) {
      const ang = (i / 13) * Math.PI * 2 + this.rng() * 0.25;
      const dist = 112 + this.rng() * 30;
      const hgt = 40 + this.rng() * 30;
      const rad = 38 + this.rng() * 20;
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

  /* ---------------- waterfall set piece (rocky highland spring) ---------------- */
  private buildWaterfall(particleTexture: THREE.Texture): void {
    const base = { x: 26.5, z: -15.5 };
    const top = { x: 30.5, z: -20.5 };
    const baseY = this.groundY(base.x, base.z);
    const topGroundY = this.groundY(top.x, top.z);
    const dir = {
      x: base.x - top.x,
      z: base.z - top.z,
    };
    const g = new THREE.Group();
    g.name = 'Waterfall';
    g.position.set(base.x, baseY, base.z);
    g.rotation.y = Math.atan2(dir.x, dir.z);

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x7e7c78,
      roughness: 1,
      flatShading: true,
    });
    const rockDark = new THREE.MeshStandardMaterial({
      color: 0x5f6058,
      roughness: 1,
      flatShading: true,
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x5fb6c9,
      roughness: 0.15,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
    });

    const topY = topGroundY - baseY + 2.3; // ledge height in local space
    const rock = (r: number, x: number, y: number, z: number, dark = false) => {
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const j = 1 + (this.rng() - 0.5) * 0.35;
        p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * 0.85, p.getZ(i) * j);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, dark ? rockDark : rockMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Flanking rock columns and the lip the water pours over.
    rock(1.5, -1.7, topY - 0.9, -2.6);
    rock(1.3, -1.9, topY - 2.3, -1.6, true);
    rock(1.6, 1.8, topY - 1.0, -2.7, true);
    rock(1.2, 2.0, topY - 2.5, -1.5);
    rock(1.1, 0, topY - 0.7, -3.6);
    rock(0.8, -2.3, 0.3, 0.6);
    rock(0.7, 2.4, 0.25, 0.9, true);
    rock(0.55, -1.6, 0.15, 2.2);
    rock(0.5, 1.7, 0.12, 2.4);

    // Upper pool.
    const upper = new THREE.Mesh(new THREE.CircleGeometry(1.7, 18), waterMat);
    upper.rotation.x = -Math.PI / 2;
    upper.position.set(0, topY + 0.12, -3.1);
    g.add(upper);
    // Lower pool.
    const lower = new THREE.Mesh(new THREE.CircleGeometry(2.1, 18), waterMat);
    lower.rotation.x = -Math.PI / 2;
    lower.position.set(0, 0.07, 1.1);
    lower.receiveShadow = true;
    g.add(lower);

    // Falling sheet with scrolling stripes and a foamy base.
    this.fallsUniforms = { uTime: { value: 0 } };
    const sheetH = topY + 0.1;
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, sheetH, 1, 8),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: this.fallsUniforms.uTime,
          uTop: { value: new THREE.Color(0xbfe6ef) },
          uBottom: { value: new THREE.Color(0xeafcfe) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uTop;
          uniform vec3 uBottom;
          varying vec2 vUv;
          void main() {
            float streaks = sin(vUv.x * 34.0 + sin(vUv.y * 20.0 + uTime * 2.2) * 1.6
                                + uTime * 5.0) * 0.5 + 0.5;
            float scroll = sin((vUv.y * 3.0 + uTime * 1.15) * 6.2831) * 0.5 + 0.5;
            vec3 col = mix(uBottom, uTop, vUv.y) + streaks * 0.10 + scroll * 0.05;
            float foam = smoothstep(0.30, 0.02, vUv.y);
            col = mix(col, vec3(1.0), foam * 0.75);
            float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
            float alpha = (0.72 + streaks * 0.2 + foam * 0.25) * edge;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      }),
    );
    sheet.position.set(0, sheetH / 2, -1.15);
    sheet.rotation.x = -0.1;
    sheet.renderOrder = 3;
    g.add(sheet);

    // Foam specks at the plunge base.
    const foamCount = 42;
    const foamPos = new Float32Array(foamCount * 3);
    for (let i = 0; i < foamCount; i++) {
      const a = this.rng() * Math.PI * 2;
      const rr = Math.sqrt(this.rng()) * 1.5;
      foamPos[i * 3] = Math.cos(a) * rr;
      foamPos[i * 3 + 1] = 0.14 + this.rng() * 0.12;
      foamPos[i * 3 + 2] = 1.1 + Math.sin(a) * rr * 0.7;
    }
    const foamGeo = new THREE.BufferGeometry();
    foamGeo.setAttribute('position', new THREE.BufferAttribute(foamPos, 3));
    const foam = new THREE.Points(
      foamGeo,
      new THREE.PointsMaterial({
        map: particleTexture,
        color: 0xffffff,
        size: 0.34,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    foam.renderOrder = 4;
    g.add(foam);

    // Drifting mist.
    this.mist = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: particleTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      }),
    );
    this.mist.scale.set(5.2, 2.4, 1);
    this.mist.position.set(0, 0.8, 1.3);
    this.mist.renderOrder = 6;
    g.add(this.mist);

    this.group.add(g);
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
