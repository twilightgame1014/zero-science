import * as THREE from 'three';
import type { GraphicsConfig, QualityTier } from './types';
import { AssetManager } from './AssetManager';
import {
  distanceToRiver,
  isInRiver,
  mulberry32,
  riverCenterX,
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
  private rng: () => number;

  constructor(
    cfg: GraphicsConfig,
    quality: QualityTier,
    particleTexture: THREE.Texture,
  ) {
    this.cfg = cfg;
    this.rng = mulberry32(cfg.world.seed);
    const scale = quality === 'high' ? 1 : 0.5;

    this.buildTrees(scale);
    this.buildGrass(scale);
    this.buildGroundCover(scale);
    this.buildRocks(scale);
    this.buildRiverbank(scale);
    this.buildFallenLogs();
    this.buildPollen(particleTexture, scale);
    this.buildBackdropMountains();
    this.buildWaterfall(particleTexture);
    this.buildStonework();
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
    const forest = (x: number, z: number) =>
      !isInRiver(x, z, 6.5) &&
      Math.hypot(x - this.cfg.world.plateauCenter.x, z - this.cfg.world.plateauCenter.z) >
        this.cfg.world.plateauRadius + 2 &&
      x - z * 0.35 < 34; // keep the rocky NE sparse
    const spots = this.scatter(Math.round(120 * scale), (x, z) => {
      if (!forest(x, z)) return false;
      const density =
        0.35 + smoothstep(10, -30, x + z * 0.2) * 0.75 + (this.rng() - 0.5) * 0.3;
      return this.rng() < density;
    });

    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.26, 1.7, 6);
    trunkGeo.translate(0, 0.85, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);

    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    const blobWind = makeWindMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      1,
      0.045,
    );
    this.windMaterials.push(blobWind);
    const blobs = new THREE.InstancedMesh(blobGeo, blobWind.material, spots.length * 3);

    const coneGeo = new THREE.ConeGeometry(1, 2.4, 8);
    coneGeo.translate(0, 1.2, 0);
    const coneWind = makeWindMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      2.4,
      0.05,
    );
    this.windMaterials.push(coneWind);
    const pines = new THREE.InstancedMesh(coneGeo, coneWind.material, spots.length * 2);

    const cA = new THREE.Color(0x4e8f3e);
    const cB = new THREE.Color(0x77a944);
    const cC = new THREE.Color(0x3c7a44);
    const tmp = new THREE.Color();
    let bi = 0;
    let pi = 0;

    spots.forEach((s, i) => {
      const y = this.groundY(s.x, s.z);
      const size = 0.75 + this.rng() * 0.9;
      const pine = s.z < -14 || this.rng() < 0.22;
      this.setInstance(trunks, i, s.x, y - 0.1, s.z, this.rng() * Math.PI,
        size, size * (pine ? 1.5 : 1.1), size);
      tmp.copy(cA).lerp(this.rng() < 0.5 ? cB : cC, this.rng() * 0.8);
      if (pine) {
        for (let k = 0; k < 2; k++) {
          this.setInstance(pines, pi, s.x, y + 1.3 * size + k * 1.05 * size, s.z,
            this.rng() * Math.PI, size * (1.25 - k * 0.34), size * 1.15, size * (1.25 - k * 0.34));
          pines.setColorAt(pi, tmp);
          pi++;
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const ox = (this.rng() - 0.5) * 1.1 * size;
          const oz = (this.rng() - 0.5) * 1.1 * size;
          const oy = (2.1 + k * 0.55 + this.rng() * 0.3) * size;
          const r = (1.25 - k * 0.22) * size;
          this.setInstance(blobs, bi, s.x + ox, y + oy, s.z + oz,
            this.rng() * Math.PI, r, r * 0.82, r);
          blobs.setColorAt(bi, tmp);
          bi++;
        }
      }
    });
    // Hide unused instances (pine vs round split) with zero scale.
    for (let i = bi; i < spots.length * 3; i++) this.setInstance(blobs, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);
    for (let i = pi; i < spots.length * 2; i++) this.setInstance(pines, i, 0, -50, 0, 0, 0.001, 0.001, 0.001);

    for (const m of [trunks, blobs, pines]) {
      m.castShadow = true;
      m.receiveShadow = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
    }
  }

  /* ---------------- grass & flowers ---------------- */
  private buildGrass(scale: number): void {
    const bladeGeo = new THREE.ConeGeometry(0.075, 0.72, 4);
    bladeGeo.translate(0, 0.36, 0);
    bladeGeo.scale(1, 1, 0.4);
    const wind = makeWindMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
      0.72,
      0.13,
    );
    this.windMaterials.push(wind);
    const count = Math.round(3600 * scale);
    const grass = new THREE.InstancedMesh(bladeGeo, wind.material, count);
    const cA = new THREE.Color(0x5f9c40);
    const cB = new THREE.Color(0x8fbc58);
    const tmp = new THREE.Color();
    const spots = this.scatter(count, (x, z) =>
      !isInRiver(x, z, 4.4) &&
      this.groundY(x, z) > 0.42 &&
      x - z * 0.35 < 40);
    spots.forEach((s, i) => {
      const sc = 0.7 + this.rng() * 0.9;
      this.setInstance(grass, i, s.x, this.groundY(s.x, s.z) - 0.03, s.z,
        this.rng() * Math.PI, sc, sc * (0.8 + this.rng() * 0.5), sc);
      grass.setColorAt(i, tmp.copy(cA).lerp(cB, this.rng()));
    });
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.receiveShadow = true;
    this.group.add(grass);

    // Wildflowers sprinkled over the meadow.
    const flowerGeo = new THREE.IcosahedronGeometry(0.09, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const fCount = Math.round(240 * scale);
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, fCount);
    const palette = [0xffffff, 0xffd94d, 0xff9ec4, 0xb79ced, 0xff8a5c]
      .map((c) => new THREE.Color(c));
    const fSpots = this.scatter(fCount, (x, z) =>
      !isInRiver(x, z, 6) &&
      this.groundY(x, z) > 0.45 &&
      this.groundY(x, z) < 1.8 &&
      x - z * 0.35 < 26);
    fSpots.forEach((s, i) => {
      this.setInstance(flowers, i, s.x, this.groundY(s.x, s.z) + 0.32, s.z, 0, 1, 1, 1);
      flowers.setColorAt(i, palette[Math.floor(this.rng() * palette.length)]);
    });
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    this.group.add(flowers);
  }

  /* ---------------- shrubs, ferns, leaf litter ---------------- */
  private buildGroundCover(scale: number): void {
    const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1);
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const sCount = Math.round(150 * scale);
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, sCount);
    const cA = new THREE.Color(0x477f36);
    const cB = new THREE.Color(0x6da34c);
    const tmp = new THREE.Color();
    const spots = this.scatter(sCount, (x, z) => !isInRiver(x, z, 5.6));
    spots.forEach((s, i) => {
      const sc = 0.6 + this.rng() * 1.1;
      this.setInstance(shrubs, i, s.x, this.groundY(s.x, s.z) + 0.3 * sc, s.z,
        this.rng() * Math.PI, sc, sc * 0.7, sc);
      shrubs.setColorAt(i, tmp.copy(cA).lerp(cB, this.rng()));
    });
    if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
    shrubs.castShadow = true;
    this.group.add(shrubs);

    // Ferns hug the riverbanks and forest floor.
    const fernGeo = new THREE.ConeGeometry(0.42, 0.5, 6);
    fernGeo.translate(0, 0.22, 0);
    fernGeo.scale(1, 1, 1);
    const fernMat = new THREE.MeshStandardMaterial({ color: 0x3f9142, roughness: 0.9 });
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

    // Leaf litter discs under the forest canopy.
    const litterGeo = new THREE.CircleGeometry(0.85, 10);
    litterGeo.rotateX(-Math.PI / 2);
    const litterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const lCount = Math.round(190 * scale);
    const litter = new THREE.InstancedMesh(litterGeo, litterMat, lCount);
    const lc = [new THREE.Color(0x8a6b35), new THREE.Color(0x77572e), new THREE.Color(0x5d7031)];
    const lSpots = this.scatter(lCount, (x, z) => x + z * 0.2 < 4 && !isInRiver(x, z, 5));
    lSpots.forEach((s, i) => {
      const sc = 0.7 + this.rng() * 1.3;
      this.setInstance(litter, i, s.x, this.groundY(s.x, s.z) + 0.03, s.z,
        this.rng() * Math.PI, sc, 1, sc);
      litter.setColorAt(i, lc[Math.floor(this.rng() * lc.length)]);
    });
    if (litter.instanceColor) litter.instanceColor.needsUpdate = true;
    litter.receiveShadow = true;
    this.group.add(litter);
  }

  /* ---------------- rocks & cliffs ---------------- */
  private buildRocks(scale: number): void {
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, flatShading: true });
    const count = Math.round(170 * scale);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, count);
    const cA = new THREE.Color(0x8f8f93);
    const cB = new THREE.Color(0xb9b4a8);
    const cMoss = new THREE.Color(0x6f8f56);
    const tmp = new THREE.Color();
    const spots = this.scatter(count, (x, z) => !isInRiver(x, z, 4.8));
    const rockTransforms: Array<{ x: number; y: number; z: number; s: number }> = [];
    spots.forEach((s, i) => {
      const highland = smoothstep(16, 44, s.x - s.z * 0.35);
      const sc = (0.3 + Math.pow(this.rng(), 1.6) * 1.5) * (1 + highland * 2.3);
      const y = this.groundY(s.x, s.z) + sc * 0.18;
      this.dummy.position.set(s.x, y, s.z);
      this.dummy.rotation.set(this.rng() * 0.6, this.rng() * Math.PI, this.rng() * 0.6);
      this.dummy.scale.set(sc * (0.8 + this.rng() * 0.5), sc * (0.55 + this.rng() * 0.5), sc * (0.8 + this.rng() * 0.5));
      this.dummy.updateMatrix();
      rocks.setMatrixAt(i, this.dummy.matrix);
      tmp.copy(cA).lerp(cB, this.rng());
      if (this.rng() < 0.3) tmp.lerp(cMoss, 0.45); // mossy rocks
      rocks.setColorAt(i, tmp);
      if (sc > 0.8) rockTransforms.push({ x: s.x, y: y + sc * 0.5, z: s.z, s: sc });
    });
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);

    // Exposed mineral crystals on a few large rocks (visual only).
    const crystalGeo = new THREE.OctahedronGeometry(0.16);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.25, metalness: 0.1,
      emissive: 0x222222,
    });
    const picks = rockTransforms.slice(0, 26);
    const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, Math.max(picks.length * 2, 1));
    const palette = [0xf3ead8, 0xd98e4a, 0x9fd8d2].map((c) => new THREE.Color(c));
    let ci = 0;
    for (const p of picks) {
      for (let k = 0; k < 2; k++) {
        this.setInstance(crystals, ci, p.x + (this.rng() - 0.5) * p.s, p.y, p.z + (this.rng() - 0.5) * p.s,
          this.rng() * Math.PI, 1, 1.6, 1);
        crystals.setColorAt(ci, palette[Math.floor(this.rng() * palette.length)]);
        ci++;
      }
    }
    if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
    this.group.add(crystals);
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
    for (let i = 0; i < 7; i++) {
      const x = -34 + this.rng() * 44;
      const z = -30 + this.rng() * 62;
      if (isInRiver(x, z, 6)) continue;
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
    for (let i = 0; i < 13; i++) {
      const ang = (i / 13) * Math.PI * 2 + this.rng() * 0.25;
      const dist = 138 + this.rng() * 34;
      const hgt = 32 + this.rng() * 28;
      const rad = 34 + this.rng() * 18;
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
