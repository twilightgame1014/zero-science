import * as THREE from 'three';
import type { GraphicsConfig, QualityTier } from './types';
import {
  areaDefinitions,
  areaRaw,
  clamp,
  distanceToPath,
  distanceToPolyline,
  distanceToRiver,
  fbm,
  frozenPond,
  lerp,
  riverCenterX,
  smoothstep,
  terrainHeight,
} from './utils';
import type { AreaDefinition } from './types';

/**
 * The ground: chunked terrain over the expanded world (spec §1.3),
 * the legacy river (bed ribbon + flowing surface), an open-water
 * plane that fills every basin the height function carves below the
 * water level (the lake, the sea, the oasis), the volcano's crater
 * lava lake and the snowfield's frozen pond.
 *
 * Height / river path / area layout come from utils.ts so placement
 * code, character grounding and this mesh can never disagree.
 * Chunks are keyed to a fixed 60 m grid and built from the same
 * global functions on every side of every border, with normals
 * sampled analytically from the height function — borders cannot
 * seam in height, colour or normals. Near chunks are dense, far
 * chunks coarse, and chunks past the far radius are disposed.
 */
const CHUNK = 60;
const CHUNK_MIN = -3; // chunk coords -3..2 -> centres -150..150, field ±180
const CHUNK_MAX = 2;

interface ChunkEntry {
  mesh: THREE.Mesh;
  tier: 'near' | 'far';
}

/** Vertex-colour palette (module scope: fillVertex runs per vertex
 *  and must not allocate). */
const VCOLORS = {
  cGrass: new THREE.Color(0x69a34b),
  cGrassDry: new THREE.Color(0x9db45e),
  cForestFloor: new THREE.Color(0x4d7d3a),
  cSand: new THREE.Color(0xd9bd8a),
  cWetSand: new THREE.Color(0xa8895c),
  cClay: new THREE.Color(0xb0764a),
  cRock: new THREE.Color(0x8d8d90),
  cRockDark: new THREE.Color(0x66666c),
  cPath: new THREE.Color(0xa3804f),
  cEarth: new THREE.Color(0x7c6a42),
  cUnderwater: new THREE.Color(0x77683f),
  cAsh: new THREE.Color(0x998a7a),
  cTownStone: new THREE.Color(0xa79c8d),
  cTownEarth: new THREE.Color(0x8a6f52),
  cBasalt: new THREE.Color(0x33302e),
  cSnow: new THREE.Color(0xe8eef2),
  cDune: new THREE.Color(0xdbbe85),
  // Round 28 (Claude §25.2): host-path tread + volcano band set.
  cTrailSoil: new THREE.Color(0x8a6f4d),
  cTrailGravel: new THREE.Color(0x9a8a72),
  cSulfur: new THREE.Color(0xc9a83c),
  cCrater: new THREE.Color(0x35302b),
  cLavaFlow: new THREE.Color(0x4a3430),
  cAshPale: new THREE.Color(0xb3a48f),
};

export class TerrainRenderer {
  private hasScree = false;
  readonly group = new THREE.Group();
  private cfg: GraphicsConfig;
  private detailBrightness: number;
  private quality: QualityTier;
  private waterUniforms: { uTime: { value: number } } | null = null;
  private riverEnabled = true;
  private openWaterEnabled = true;
  private waterMesh: THREE.Mesh;
  private waterPlane: THREE.Mesh;
  private riverbedMesh: THREE.Mesh;
  private terrainMaterial: THREE.Material;
  private chunks = new Map<string, ChunkEntry>();
  private chunkGroup = new THREE.Group();
  private areaDefs: AreaDefinition[];
  private lastFocus = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  private lavaMaterial: THREE.MeshStandardMaterial | null = null;
  /** Host-supplied worn paths (round 28, Claude §25.2.1) with
   *  precomputed bounds so fillVertex can reject far vertices
   *  before the segment loop. */
  private hostPaths: Array<{
    points: ReadonlyArray<readonly number[]>;
    width: number;
    minX: number; minZ: number; maxX: number; maxZ: number;
  }> = [];

  constructor(
    cfg: GraphicsConfig,
    detailTexture: THREE.Texture,
    detailBrightness = 1,
    quality: QualityTier = 'high',
    riverbedTexture?: THREE.Texture,
    groundTextures?: Record<string, THREE.Texture>,
    lavaTextures?: { albedo?: THREE.Texture; emissive?: THREE.Texture },
    riverEnabled = true,
    openWaterEnabled = true,
  ) {
    this.riverEnabled = riverEnabled;
    this.openWaterEnabled = openWaterEnabled;
    this.detailBrightness = detailBrightness;
    this.cfg = cfg;
    this.quality = quality;
    this.areaDefs = areaDefinitions(cfg);
    for (const p of cfg.world.paths ?? []) {
      if (!p.points || p.points.length < 2) continue;
      // Normalise once: hosts may hand over [x, z, h?] arrays or
      // {x, z} points (the game's Poly type); the painter only
      // ever reads [x, z] pairs.
      const pts: Array<readonly [number, number]> = p.points.map((pt) =>
        Array.isArray(pt)
          ? [pt[0], pt[1]] as readonly [number, number]
          : [(pt as { x: number }).x, (pt as { z: number }).z] as readonly [number, number]);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const pt of pts) {
        minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
        minZ = Math.min(minZ, pt[1]); maxZ = Math.max(maxZ, pt[1]);
      }
      this.hostPaths.push({ points: pts, width: Math.max(0.4, p.width), minX, minZ, maxX, maxZ });
    }
    this.terrainMaterial = this.buildTerrainMaterial(detailTexture, groundTextures);
    this.hasScree = !!groundTextures?.scree;
    this.waterMesh = this.buildWater();
    this.waterPlane = this.buildWaterPlane();
    this.riverbedMesh = this.buildRiverbed(riverbedTexture);
    this.group.add(this.chunkGroup);
    if (this.riverEnabled) {
      this.group.add(this.riverbedMesh);
      this.group.add(this.waterMesh);
    }
    if (this.openWaterEnabled) this.group.add(this.waterPlane);
    const lava = this.buildLavaLake(lavaTextures);
    if (lava) this.group.add(lava);
    this.group.add(this.buildIcePond());
    this.group.add(this.buildOuterGround());
    this.updateChunks(0, 0, true);
  }

  /**
   * Raycast against the visible ground: a water surface where the
   * ray meets one, the terrain elsewhere. Backs the public
   * pickGround API — display geometry only, no passability meaning.
   */
  pick(raycaster: THREE.Raycaster): { point: THREE.Vector3; surface: 'terrain' | 'water' } | null {
    const targets: THREE.Object3D[] = [
      ...(this.riverEnabled ? [this.waterMesh] : []),
      ...(this.openWaterEnabled ? [this.waterPlane] : []),
    ];
    for (const c of this.chunks.values()) targets.push(c.mesh);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    return {
      point: hit.point,
      surface: hit.object === this.waterMesh || hit.object === this.waterPlane ? 'water' : 'terrain',
    };
  }

  /**
   * A wide, plain ground disc far below the lowest terrain point, so
   * the low camera never sees void past the world rim: the disc reads
   * as distant land dissolving into fog. It is not raycast (pick()
   * ignores it) and carries no height information.
   */
  private buildOuterGround(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(900, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55763d, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -5.2;
    mesh.name = 'OuterGround';
    return mesh;
  }

  getHeightAt(x: number, z: number): number {
    return this.h(x, z);
  }

  update(time: number): void {
    if (this.waterUniforms) this.waterUniforms.uTime.value = time;
    // The crater lake's glow breathes very slowly (spec §6 of the
    // expansion brief: movement, if any, is a slow change deep in
    // the cracks — never a scrolling surface).
    if (this.lavaMaterial) {
      this.lavaMaterial.emissiveIntensity = 1.5 + Math.sin(time * 0.45) * 0.3;
    }
  }

  /* ------------------------------------------------------------ */
  /* Chunks                                                        */
  /* ------------------------------------------------------------ */

  private radii(): { near: number; far: number; nearSeg: number; farSeg: number } {
    return this.quality === 'high'
      ? { near: 125, far: 250, nearSeg: 48, farSeg: 12 }
      : { near: 95, far: 185, nearSeg: 40, farSeg: 10 };
  }

  /** Runtime quality switch (spec §1.3): re-evaluates chunk radii. */
  setQuality(quality: QualityTier): void {
    this.quality = quality;
    this.lastFocus = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  }

  /**
   * Ensure the chunks around (fx, fz) exist at the right detail
   * tier and dispose the rest. Called every frame with the camera
   * focus; a pass only runs when the focus has moved at least 12 m
   * since the last one, and builds at most two chunks per pass so
   * exploration loading never stalls a frame (initial load passes
   * force=true and also build progressively).
   */
  updateChunks(fx: number, fz: number, force = false): void {
    if (!force && Math.hypot(fx - this.lastFocus.x, fz - this.lastFocus.z) < 12) return;
    this.lastFocus = { x: fx, z: fz };
    const { near, far, nearSeg, farSeg } = this.radii();
    const desired = new Map<string, { gx: number; gz: number; tier: 'near' | 'far'; d: number }>();
    for (let gx = CHUNK_MIN; gx <= CHUNK_MAX; gx++) {
      for (let gz = CHUNK_MIN; gz <= CHUNK_MAX; gz++) {
        const cx = gx * CHUNK + CHUNK / 2;
        const cz = gz * CHUNK + CHUNK / 2;
        const d = Math.hypot(cx - fx, cz - fz);
        if (d > far + CHUNK * 0.7) continue;
        desired.set(`${gx},${gz}`, { gx, gz, tier: d < near ? 'near' : 'far', d });
      }
    }
    for (const [key, entry] of [...this.chunks]) {
      if (!desired.has(key)) {
        this.chunkGroup.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
    const pending = [...desired.entries()]
      .filter(([key, d]) => this.chunks.get(key)?.tier !== d.tier)
      .sort((a, b) => a[1].d - b[1].d);
    const builds = pending.slice(0, force ? 6 : 2);
    // When builds were capped, re-run soon even without moving.
    if (builds.length < pending.length) {
      this.lastFocus = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
    }
    for (const [key, d] of builds) {
      const old = this.chunks.get(key);
      if (old) {
        this.chunkGroup.remove(old.mesh);
        old.mesh.geometry.dispose();
      }
      const mesh = this.buildChunk(d.gx, d.gz, d.tier === 'near' ? nearSeg : farSeg);
      this.chunks.set(key, { mesh, tier: d.tier });
      this.chunkGroup.add(mesh);
    }
  }

  /**
   * Height inlet (round 22, shim-safe): the host's
   * config.world.heightAt wins; otherwise the imported
   * terrainHeight binding — which the game's wide-world build
   * legitimately substitutes at build time — is the fallback,
   * so an externally-owned world shape keeps working with or
   * without the config inlet.
   */
  private h(x: number, z: number): number {
    return this.cfg.world.heightAt ? this.cfg.world.heightAt(x, z) : terrainHeight(x, z, this.cfg);
  }

  /**
   * Build every chunk around (x, z) NOW, at near detail within
   * the radius (round 22, Claude §18 / teleport support): call
   * right after a teleport so the destination is fully meshed
   * before the first frame there, instead of streaming in over
   * the next seconds. Synchronous by design — the caller picks
   * the moment (a fade / loading beat covers the cost).
   */
  prepareAround(x: number, z: number, radiusM = 90): void {
    const { nearSeg } = this.radii();
    let built = 0;
    for (let gx = CHUNK_MIN; gx <= CHUNK_MAX && built < 64; gx++) {
      for (let gz = CHUNK_MIN; gz <= CHUNK_MAX && built < 64; gz++) {
        const cx = gx * CHUNK + CHUNK / 2;
        const cz = gz * CHUNK + CHUNK / 2;
        if (Math.hypot(cx - x, cz - z) > radiusM + CHUNK * 0.7) continue;
        const key = `${gx},${gz}`;
        if (this.chunks.get(key)?.tier === 'near') continue;
        const old = this.chunks.get(key);
        if (old) {
          this.chunkGroup.remove(old.mesh);
          old.mesh.geometry.dispose();
        }
        const mesh = this.buildChunk(gx, gz, nearSeg);
        this.chunks.set(key, { mesh, tier: 'near' });
        this.chunkGroup.add(mesh);
        built++;
      }
    }
    this.lastFocus = { x, z };
  }

  private buildChunk(gx: number, gz: number, segments: number): THREE.Mesh {
    const x0 = gx * CHUNK;
    const z0 = gz * CHUNK;
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const splat = new Float32Array(count * 4);
    const splat2 = new Float32Array(count * 4);
    const splat3 = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const out = { r: 0, g: 0, b: 0, s: splat, s2: splat2, s3: splat3, i: 0, ny: 1 };
    const E = 0.9; // normal sampling step (m)
    for (let i = 0; i < count; i++) {
      const x = x0 + pos.getX(i) + CHUNK / 2;
      const z = z0 + pos.getZ(i) + CHUNK / 2;
      const h = this.h(x, z);
      pos.setXYZ(i, x, h, z);
      // Detail map anchored to world coordinates (tile ~2.6 m), so
      // chunk borders cannot shift the grain.
      uv.setXY(i, x / 2.6, z / 2.6);
      out.i = i;
      // Analytic normals from the height function itself: identical
      // on both sides of every chunk border by construction.
      const nx = this.h(x - E, z) - this.h(x + E, z);
      const nz = this.h(x, z - E) - this.h(x, z + E);
      const inv = 1 / Math.hypot(nx, 2 * E, nz);
      normals[i * 3] = nx * inv;
      normals[i * 3 + 1] = 2 * E * inv;
      normals[i * 3 + 2] = nz * inv;
      out.ny = normals[i * 3 + 1];
      this.fillVertex(x, z, h, out);
      colors[i * 3] = out.r;
      colors[i * 3 + 1] = out.g;
      colors[i * 3 + 2] = out.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('splat2', new THREE.BufferAttribute(splat2, 4));
    geo.setAttribute('splat3', new THREE.BufferAttribute(splat3, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, this.terrainMaterial);
    mesh.receiveShadow = true;
    mesh.name = `TerrainChunk ${gx},${gz}`;
    return mesh;
  }

  /* ------------------------------------------------------------ */
  /* Per-vertex colour + splat weights                             */
  /* ------------------------------------------------------------ */

  private cTmp = new THREE.Color();
  private areaRawAt(x: number, z: number, id: string): number {
    const def = this.areaDefs.find((a) => a.id === id);
    return def ? areaRaw(x, z, def) : 0;
  }

  /** Distance to the nearest host path + that path's flat
   *  half-width (round 28). Infinity when no path is near. */
  private hostTrail(x: number, z: number): { d: number; width: number } {
    let best = Infinity;
    let width = 0;
    for (const p of this.hostPaths) {
      const reach = p.width + 2.2;
      if (x < p.minX - reach || x > p.maxX + reach || z < p.minZ - reach || z > p.maxZ + reach) continue;
      const d = distanceToPolyline(x, z, p.points);
      if (d < best) { best = d; width = p.width; }
    }
    return { d: best, width };
  }

  private fillVertex(
    x: number, z: number, h: number,
    out: { r: number; g: number; b: number; s: Float32Array; s2: Float32Array; s3: Float32Array; i: number; ny: number },
  ): void {
    const i = out.i;
    const tmp = this.cTmp;
    const { cGrass, cGrassDry, cForestFloor, cSand, cWetSand, cClay, cRock, cRockDark, cPath, cEarth, cUnderwater, cAsh, cBasalt, cSnow, cDune, cTownStone, cTownEarth, cTrailSoil, cTrailGravel, cSulfur, cCrater, cLavaFlow, cAshPale } = VCOLORS;

    const n = fbm(x * 0.09 + 31, z * 0.09 + 17, 3);
    const dRiver = distanceToRiver(x, z);
    tmp.copy(cGrass).lerp(cGrassDry, clamp(n * 1.15 - 0.12, 0, 1));
    const mottle = fbm(x * 0.5 + 7, z * 0.5 + 3, 2);
    tmp.lerp(cEarth, smoothstep(0.56, 0.82, mottle) * 0.38);
    const forestMask = smoothstep(-2, -26, x + z * 0.25);
    tmp.lerp(cForestFloor, forestMask * 0.55);
    const bank = smoothstep(6.4, 3.4, dRiver);
    tmp.lerp(h < 0.55 ? cWetSand : cSand, bank * 0.85);
    const clayMask =
      smoothstep(0.55, 0.75, fbm(x * 0.05 + 91, z * 0.05 + 55, 3)) *
      smoothstep(11, 6, dRiver) *
      smoothstep(-6, 8, z);
    tmp.lerp(cClay, clayMask * 0.8);
    if (h < this.cfg.world.waterLevel) {
      const bedN = fbm(x * 0.35 + 51, z * 0.35 + 23, 2);
      tmp.lerp(bedN > 0.55 ? cSand : cWetSand, 0.35);
    }
    if (h < this.cfg.world.waterLevel + 0.05) tmp.lerp(cUnderwater, 0.7);
    const wet =
      smoothstep(0.34, 0.03, h - this.cfg.world.waterLevel) *
      smoothstep(-0.06, 0.04, h - this.cfg.world.waterLevel);
    if (wet > 0) {
      tmp.lerp(cWetSand, wet * 0.45);
      tmp.multiplyScalar(1 - wet * 0.16);
    }
    const pathMask =
      smoothstep(2.4, 1.1, distanceToPath(x, z)) * smoothstep(0.42, 0.6, h);
    tmp.lerp(cPath, pathMask * 0.8);
    // Host-supplied worn paths (round 28, Claude §25.2.1): the
    // tread the height function flattens (e.g. the volcano trail,
    // half-width 1.4) reads as packed soil with gravel speckle,
    // feathering into the slope by ~2× the width. Never paving,
    // never steps — just ground many feet have compacted.
    let trailW = 0;
    if (this.hostPaths.length > 0) {
      const tr = this.hostTrail(x, z);
      if (tr.d < tr.width + 2.2) {
        trailW = smoothstep(tr.width + 1.6, tr.width * 0.5, tr.d);
        const gravel = smoothstep(0.45, 0.8, fbm(x * 0.9 + 3, z * 0.9 + 41, 2));
        tmp.lerp(cTrailSoil, trailW * 0.85);
        tmp.lerp(cTrailGravel, trailW * gravel * 0.45);
      }
    }
    const rockiness = smoothstep(1.6, 3.6, h) * 0.75 +
      smoothstep(20, 46, x - z * 0.35) * 0.45;
    tmp.lerp(n > 0.55 ? cRock : cRockDark, clamp(rockiness, 0, 0.92));
    const strata = 0.9 + 0.1 * Math.sin(h * 6.5 + n * 3.0);
    tmp.multiplyScalar(lerp(1, strata, clamp(rockiness, 0, 1)));
    const ao = 1 - Math.exp(-((dRiver / 4.2) ** 2)) * 0.22;

    /* Area overlays (world expansion): the land reads as its area
     * even where no splat texture reaches — ash near the volcano,
     * white on the snowfield heights, dune sand in the desert. */
    const wVol = this.areaRawAt(x, z, 'volcano');
    const wSnow = this.areaRawAt(x, z, 'snow');
    const wDesert = this.areaRawAt(x, z, 'desert');
    const wCoast = this.areaRawAt(x, z, 'coast');
    const wLake = this.areaRawAt(x, z, 'lakeside');
    const wTown = this.areaRawAt(x, z, 'town');
    // Volcano band factor for the splat write below (round 28):
    // 1 on the bare upper mountain / crater, lower on the foot.
    let volTileW = wVol;
    let volScreeKeep = 1 - wVol * 0.85; // legacy suppression
    if (wVol > 0) {
      const vDef = this.areaDefs.find((a) => a.id === 'volcano');
      const dVol = vDef ? Math.hypot(x - vDef.x, z - vDef.z) : 999;
      tmp.lerp(cAsh, wVol * 0.78);
      if (dVol < 75) {
        // Banded by radius from the crater centre (contract v4:
        // crater < 11.7, rim 11.7–16.2, upper cliff 16.2–30,
        // flank 30–46, foot 46–68). Bands feather into each other;
        // noise breaks every boundary so nothing reads as rings.
        const bandNoise = (fbm(x * 0.11 + 77, z * 0.11 + 5, 3) - 0.5) * 5.0;
        const db = dVol + bandNoise;
        // Foot: pale ash field with dark basalt speckle.
        const footW = smoothstep(44, 52, db);
        tmp.lerp(cAshPale, wVol * footW * 0.5);
        tmp.lerp(cBasalt, wVol * footW * smoothstep(0.62, 0.85, mottle) * 0.4);
        // Flank: old lava flows — dark reddish-brown streaks run
        // downhill (noise stretched along the radius).
        const ang = Math.atan2(z - (vDef?.z ?? 0), x - (vDef?.x ?? 0));
        const streak = fbm(Math.cos(ang) * 6 + 40 + dVol * 0.05, Math.sin(ang) * 6 + 9 + dVol * 0.05, 3);
        const flankW = smoothstep(28, 33, db) * smoothstep(48, 43, db);
        tmp.lerp(cLavaFlow, wVol * flankW * smoothstep(0.45, 0.75, streak) * 0.65);
        tmp.lerp(cBasalt, wVol * flankW * 0.3);
        // Upper cliff: bare dark rock.
        const upperW = smoothstep(15, 18, db) * smoothstep(31, 27, db);
        tmp.lerp(cBasalt, wVol * upperW * 0.55);
        tmp.lerp(cRockDark, wVol * upperW * 0.3);
        // Rim: sulfur crust patches (the yellow skin the rim
        // deposits sit on) — patchy, never a solid ring.
        const rimW = smoothstep(10.8, 12.6, db) * smoothstep(17.4, 15.6, db);
        const crust = smoothstep(0.52, 0.78, fbm(x * 0.33 + 19, z * 0.33 + 63, 3));
        tmp.lerp(cSulfur, wVol * rimW * crust * 0.6);
        // Crater bowl: charcoal.
        const craterW = smoothstep(12.6, 10.8, db);
        tmp.lerp(cCrater, wVol * craterW * 0.8);
        volTileW = wVol * (0.6 + 0.4 * Math.max(upperW, craterW, rimW));
        volScreeKeep = 1 - wVol * (Math.max(upperW, flankW) > 0.4 ? 0.4 : 0.85);
        // The trodden trail must survive the area overlay.
        if (trailW > 0) {
          const gravel = smoothstep(0.45, 0.8, fbm(x * 0.9 + 3, z * 0.9 + 41, 2));
          tmp.lerp(cTrailSoil, trailW * 0.8);
          tmp.lerp(cTrailGravel, trailW * gravel * 0.4);
        }
      } else {
        tmp.lerp(cBasalt, wVol * smoothstep(6, 14, h) * 0.6);
      }
    }
    if (wDesert > 0) tmp.lerp(cDune, wDesert * 0.8);
    const snowCover = clamp(wSnow * (smoothstep(1.4, 3.4, h) + smoothstep(7.5, 10.5, h)), 0, 1);
    if (snowCover > 0) {
      tmp.lerp(cSnow, snowCover * 0.88);
      // keep wide snowfields from reading as one flat white sheet
      tmp.multiplyScalar(lerp(1, 0.92 + mottle * 0.13, snowCover));
    }

    // Town ground weights (DQ3 set) — computed before the colour
    // write because the tiles need a near-neutral tint under them.
    const townDef = this.areaDefs.find((a) => a.id === 'town');
    const dTown = townDef ? Math.hypot(x - townDef.x, z - townDef.z) : 999;
    const cobbleWPre = clamp(wTown * smoothstep(24, 13, dTown), 0, 0.96);
    const dirtWPre = clamp(wTown * 0.85 * (1 - cobbleWPre), 0, 0.96);
    if (cobbleWPre > 0) tmp.lerp(cTownStone, cobbleWPre * 0.82);
    if (dirtWPre > 0) tmp.lerp(cTownEarth, dirtWPre * 0.4);

    out.r = tmp.r * ao;
    out.g = tmp.g * ao;
    out.b = tmp.b * ao;

    const wl = this.cfg.world.waterLevel;
    const aboveWater = smoothstep(wl - 0.02, wl + 0.3, h);
    const rockSuppress = 1 - clamp(rockiness, 0, 1) * 0.9;
    const s = out.s;
    s[i * 4] = clamp(forestMask * 0.95 + smoothstep(0.6, 0.85, mottle) * 0.4, 0, 0.95) * aboveWater * rockSuppress;
    s[i * 4 + 1] = clamp(wet * 1.0 + clayMask * 0.8, 0, 0.95) * rockSuppress;
    s[i * 4 + 2] = clamp(bank * 0.92, 0, 0.95) * aboveWater * rockSuppress;
    s[i * 4 + 3] = clamp(Math.max(pathMask * 1.1, trailW * 1.05), 0, 0.96) * aboveWater;
    // Shores of the new basins wear sand / mud / wet sand too.
    const shoreBand = clamp(1 - Math.abs(h - (wl + 0.18)) / 0.55, 0, 1);
    s[i * 4 + 2] = clamp(s[i * 4 + 2] + wCoast * smoothstep(wl + 2.4, wl + 0.7, h) * 0.9, 0, 0.96) * rockSuppress;
    s[i * 4 + 1] = clamp(s[i * 4 + 1] + wLake * shoreBand * 0.7, 0, 0.96);
    s[i * 4 + 3] = clamp(Math.max(s[i * 4 + 3], wTown * 0.5), 0, 0.96) * aboveWater;
    const s2 = out.s2;
    s2[i * 4] = clamp(volTileW * 1.05 * (1 - trailW * 0.8), 0, 0.96);
    s2[i * 4 + 1] = clamp(wSnow * (smoothstep(1.2, 3.0, h) + smoothstep(7.5, 10.5, h) * 0.9), 0, 0.96);
    s2[i * 4 + 2] = clamp(wDesert, 0, 0.96) * smoothstep(wl - 0.1, wl + 0.35, h);
    s2[i * 4 + 3] = clamp((wCoast + wLake * 0.9) * shoreBand, 0, 0.95) * aboveWater;
    // (weights computed above, before the colour write)
    const cobbleW = cobbleWPre * aboveWater;
    const s3 = out.s3;
    s3[i * 3] = cobbleW;
    s3[i * 3 + 1] = clamp(wTown * 0.85 * (1 - cobbleW), 0, 0.96) * aboveWater;
    // Scree (round 21): rubble ground on steep slopes, driven by
    // the analytic normal — the same slope the rock vertex colour
    // reads, so scree appears exactly where the mountain bares
    // rock. Suppressed under snowfields and the town tiles.
    s3[i * 3 + 2] = this.hasScree
      ? clamp(smoothstep(0.945, 0.845, out.ny) * 1.05, 0, 0.95) *
        aboveWater * (1 - wSnow * 0.85) * volScreeKeep * (1 - clamp(cobbleW, 0, 1))
      : 0;
  }

  private buildTerrainMaterial(
    detailTexture: THREE.Texture,
    groundTextures?: Record<string, THREE.Texture>,
  ): THREE.Material {
    detailTexture.repeat.set(1, 1);
    const b = this.detailBrightness;
    const mat = new THREE.MeshStandardMaterial({
      map: detailTexture,
      color: new THREE.Color(b, b, b),
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    // Tiling ground textures (assets/gpt-expansion/): painterly
    // tiles mixed over the vertex colours by per-vertex splat
    // weights derived from the same masks as the colours, so
    // material boundaries follow terrain (shores, moisture, paths,
    // area falloffs) instead of square texture borders. Each tile is
    // scaled toward the local vertex-colour luminance so the blend
    // keeps the scene's overall light. Missing textures = plain
    // vertex-colour terrain, exactly as before.
    const gt = groundTextures ?? {};
    if (gt.forest && gt.mud && gt.sand && gt.path) {
      const volcanic = gt.volcanic ?? gt.sand;
      const snow = gt.snow ?? gt.path;
      const desert = gt.desert ?? gt.sand;
      const sandWet = gt.sandWet ?? gt.mud;
      const cobble = gt.cobble ?? gt.path;
      const dirtPlain = gt.dirtPlain ?? gt.path;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uGroundForest = { value: gt.forest };
        shader.uniforms.uGroundMud = { value: gt.mud };
        shader.uniforms.uGroundSand = { value: gt.sand };
        shader.uniforms.uGroundPath = { value: gt.path };
        shader.uniforms.uGroundVolcanic = { value: volcanic };
        shader.uniforms.uGroundSnow = { value: snow };
        shader.uniforms.uGroundDesert = { value: desert };
        shader.uniforms.uGroundSandWet = { value: sandWet };
        shader.uniforms.uGroundCobble = { value: cobble };
        shader.uniforms.uGroundScree = { value: gt.scree ?? dirtPlain };
        shader.uniforms.uGroundDirt = { value: dirtPlain };
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute vec4 splat;\nattribute vec4 splat2;\nattribute vec3 splat3;\nvarying vec4 vSplat;\nvarying vec4 vSplat2;\nvarying vec3 vSplat3;\nvarying vec2 vWPos;',
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvSplat = splat;\nvSplat2 = splat2;\nvSplat3 = splat3;\nvWPos = position.xz;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            [
              '#include <common>',
              'uniform sampler2D uGroundForest;',
              'uniform sampler2D uGroundMud;',
              'uniform sampler2D uGroundSand;',
              'uniform sampler2D uGroundPath;',
              'uniform sampler2D uGroundVolcanic;',
              'uniform sampler2D uGroundSnow;',
              'uniform sampler2D uGroundDesert;',
              'uniform sampler2D uGroundSandWet;',
              'uniform sampler2D uGroundCobble;',
              'uniform sampler2D uGroundScree;',
              'uniform sampler2D uGroundDirt;',
              'varying vec4 vSplat;',
              'varying vec4 vSplat2;',
              'varying vec3 vSplat3;',
              'varying vec2 vWPos;',
              'float gWet = 0.0;',
              'float splatNoise(vec2 p) {',
              '  vec2 i = floor(p); vec2 f = fract(p);',
              '  f = f * f * (3.0 - 2.0 * f);',
              '  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);',
              '  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);',
              '  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);',
              '  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);',
              '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
              '}',
              // Break a splat weight's straight interpolated edge with
              // noise: strongest mid-transition, nil at the extremes,
              // so full-strength areas keep their identity.
              'float brkW(float w, float n) {',
              '  return clamp(w + (n - 0.5) * 0.55 * (1.0 - abs(w * 2.0 - 1.0)), 0.0, 1.0);',
              '}',
            ].join('\n'),
          )
          .replace(
            '#include <map_fragment>',
            [
              '#include <map_fragment>',
              '{',
              '  float lum = dot(diffuseColor.rgb, vec3(0.3333));',
              '  float tintF = clamp(0.45 + 1.1 * lum, 0.6, 1.25);',
              '  float nb = splatNoise(vWPos * 1.35) * 0.62 + splatNoise(vWPos * 4.9) * 0.38;',
              '  vec4 pw1 = vec4(brkW(vSplat.x, nb), brkW(vSplat.y, nb), brkW(vSplat.z, nb), brkW(vSplat.w, nb));',
              '  vec4 pw2 = vec4(brkW(vSplat2.x, nb), brkW(vSplat2.y, nb), brkW(vSplat2.z, nb), brkW(vSplat2.w, nb));',
              '  vec3 pw3 = vec3(brkW(vSplat3.x, nb), brkW(vSplat3.y, nb), brkW(vSplat3.z, nb));',
              '  gWet = pw2.w;',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundForest, vWPos / 7.0).rgb * tintF, pw1.x * 0.88);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundMud, vWPos / 5.0).rgb * tintF, pw1.y * 0.9);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundSand, vWPos / 6.0).rgb * tintF, pw1.z * 0.92);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundPath, vWPos / 5.0).rgb * tintF, pw1.w * 0.94);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundVolcanic, vWPos / 6.0).rgb * tintF, pw2.x * 0.92);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundDesert, vWPos / 8.0).rgb * tintF, pw2.z * 0.92);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundSnow, vWPos / 7.0).rgb * tintF, pw2.y * 0.95);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundSandWet, vWPos / 5.0).rgb * tintF, pw2.w * 0.9);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundScree, vWPos / 6.0).rgb * tintF, pw3.z * 0.94);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundDirt, vWPos / 6.0).rgb * tintF, pw3.y * 0.92);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundCobble, vWPos / 4.5).rgb * tintF, pw3.x * 0.94);',
              '}',
            ].join('\n'),
          )
          .replace(
            '#include <roughnessmap_fragment>',
            [
              '#include <roughnessmap_fragment>',
              // Wet band (round 22): colour alone read as dry sand —
              // separate the wet shore by roughness too, so the band
              // shines against the matte dry ground beside it.
              'roughnessFactor = mix(roughnessFactor, 0.32, gWet * 0.85);',
            ].join('\n'),
          );
      };
    }
    return mat;
  }

  /* ------------------------------------------------------------ */
  /**
   * The riverbed ribbon: a pebble/sand strip hugging the channel floor
   * under the transparent surface, so shallows show stones and moss
   * through the water (layer 1 of the 2026-11-06 water pass). Where
   * the bed rises out of the water the ribbon dives below the bank so
   * it never paints over dry land.
   */
  private buildRiverbed(texture?: THREE.Texture): THREE.Mesh {
    const { size, waterLevel } = this.cfg.world;
    const steps = 130;
    const across = 10; // points across the channel
    const halfW = 4.3;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = -size / 2 + (i / steps) * size;
      const cx = riverCenterX(z);
      for (let j = 0; j <= across; j++) {
        const t = j / across;
        const x = cx + (t * 2 - 1) * halfW;
        const bed = this.h(x, z);
        const y = bed <= waterLevel + 0.02 ? bed + 0.03 : waterLevel - 0.45;
        positions.push(x, y, z);
        uvs.push(t * 1.6, (i / steps) * (size / 5.4));
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + across + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = texture
      ? new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 1,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xbfa87c,
          roughness: 1,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        });
    if (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'Riverbed';
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    return mesh;
  }

  /* ------------------------------------------------------------ */

  /** Shared water shader material (river ribbon + open water). */
  private buildWaterMaterial(): THREE.ShaderMaterial {
    const w = this.cfg.water;
    const detail = this.quality === 'high' ? 1 : 0;
    if (!this.waterUniforms) this.waterUniforms = { uTime: { value: 0 } };
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.waterUniforms.uTime,
        uShallow: { value: new THREE.Color(w.shallowColor) },
        uDeep: { value: new THREE.Color(w.deepColor) },
        uShallowAlpha: { value: w.shallowAlpha },
        uDeepAlpha: { value: w.deepAlpha },
        uDeepDepth: { value: w.deepDepth },
        uRippleScale: { value: w.rippleScale },
        uRippleSpeed: { value: w.rippleSpeed },
        uRippleScale2: { value: w.rippleScale2 },
        uRippleSpeed2: { value: w.rippleSpeed2 },
        uRippleStrength: { value: w.rippleStrength },
        uFoamDepth: { value: w.foamDepth },
        uFoamStrength: { value: w.foamStrength },
        uGlint: { value: w.glintStrength * (detail ? 1 : 0.4) },
        uDetail: { value: detail },
      },
      vertexShader: /* glsl */ `
        attribute float aDepth;
        attribute vec2 aFlow;
        varying float vDepth;
        varying vec2 vFlow;
        varying vec3 vWorld;
        void main() {
          vDepth = aDepth;
          vFlow = aFlow;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform float uShallowAlpha;
        uniform float uDeepAlpha;
        uniform float uDeepDepth;
        uniform float uRippleScale;
        uniform float uRippleSpeed;
        uniform float uRippleScale2;
        uniform float uRippleSpeed2;
        uniform float uRippleStrength;
        uniform float uFoamDepth;
        uniform float uFoamStrength;
        uniform float uGlint;
        uniform float uDetail;
        varying float vDepth;
        varying vec2 vFlow;
        varying vec3 vWorld;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        // One dot-dash ripple layer in flow space: sparse short THIN
        // lines across the flow (tiny wave crests), each cell holding
        // at most one, scrolling downstream.
        float dashLayer(vec2 fs, float cellWid, float speed, float seed) {
          vec2 q = vec2(fs.x / cellWid, (fs.y - uTime * speed) / (cellWid * 1.5));
          vec2 cell = floor(q) + seed;
          vec2 f = fract(q) - 0.5;
          float rnd = hash(cell);
          float ang = (hash(cell + 23.0) - 0.5) * 0.7;
          float ca = cos(ang);
          float sa = sin(ang);
          f = mat2(ca, -sa, sa, ca) * f + 0.5;
          float x0 = 0.08 + rnd * 0.2;
          float x1 = x0 + 0.35 + hash(cell + 7.0) * 0.5;
          float across = smoothstep(x0, x0 + 0.1, f.x) * smoothstep(x1, x1 - 0.1, f.x);
          float yc = 0.2 + hash(cell + 3.0) * 0.6;
          float thin = smoothstep(0.16, 0.05, abs(f.y - yc));
          float keep = step(0.42, hash(cell + 13.0));
          float gain = 0.35 + 0.65 * hash(cell + 31.0);
          return across * thin * keep * gain;
        }
        void main() {
          float depthK = smoothstep(0.0, uDeepDepth, vDepth);
          vec3 col = mix(uShallow, uDeep, depthK);
          float alpha = mix(uShallowAlpha, uDeepAlpha, depthK);
          vec2 perp = vec2(-vFlow.y, vFlow.x);
          vec2 fs = vec2(dot(vWorld.xz, perp), dot(vWorld.xz, vFlow));
          float d1 = dashLayer(fs, uRippleScale, uRippleSpeed, 0.0);
          float d2 = 0.0;
          if (uDetail > 0.5) {
            d2 = dashLayer(fs + 31.7, uRippleScale2, uRippleSpeed2, 19.0);
          }
          float ripple = d1 * 0.7 + d2 * 0.5;
          vec3 rippleTint = mix(uShallow, vec3(1.0), 0.25);
          col = mix(col, rippleTint, clamp(ripple, 0.0, 1.0) * uRippleStrength * 1.7);
          float drift = sin(fs.y * 0.33 - uTime * 0.22 + sin(fs.x * 0.5) * 1.2) * 0.5 + 0.5;
          col *= 0.97 + drift * 0.05;
          float glint = step(0.988, hash(floor(fs * 6.0) + floor(uTime * 3.0))) * uGlint;
          col += glint * depthK;
          float foamBand = smoothstep(uFoamDepth, uFoamDepth * 0.25, vDepth);
          float foamNoise = dashLayer(fs + 7.3, 0.45, uRippleSpeed * 0.6, 41.0)
                          + dashLayer(fs * 1.7 + 3.1, 0.3, uRippleSpeed * 0.8, 57.0) * 0.7;
          float foam = foamBand * smoothstep(0.5, 0.9, foamNoise) * uFoamStrength;
          col = mix(col, vec3(0.96, 0.985, 1.0), foam);
          alpha = clamp(alpha + foam * 0.45, 0.0, 1.0);
          alpha *= 0.22 + 0.78 * smoothstep(0.0, 0.1, vDepth);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }

  /**
   * The river surface. A ribbon with cross-resolution so every
   * vertex carries the true water depth (waterLevel - bed height)
   * and the local flow direction. The shader grades colour/opacity
   * by depth, runs two dot-dash ripple layers along the flow, grows
   * a broken foam edge where the water is shallow, and adds a
   * restrained sun glint.
   */
  private buildWater(): THREE.Mesh {
    const { size, waterLevel } = this.cfg.world;
    const steps = 160;
    const across = 8;
    const positions: number[] = [];
    const depths: number[] = [];
    const flows: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = -size / 2 + (i / steps) * size;
      const cx = riverCenterX(z);
      const halfW = 3.9 + Math.sin(z * 0.21) * 0.35;
      const slope = (riverCenterX(z + 1.5) - riverCenterX(z - 1.5)) / 3;
      const inv = 1 / Math.hypot(slope, 1);
      const fx = slope * inv;
      const fz = inv;
      for (let j = 0; j <= across; j++) {
        const t = j / across;
        const x = cx + (t * 2 - 1) * halfW;
        positions.push(x, waterLevel, z);
        depths.push(clamp(waterLevel - this.h(x, z), 0, 2.2));
        flows.push(fx, fz);
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + across + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.buildWaterMaterial());
    mesh.name = 'RiverWater';
    mesh.renderOrder = 3;
    return mesh;
  }

  /**
   * Open water: one broad surface at the water level covering the
   * whole field. Wherever the height function carves below the
   * level — the lake bowl, the sea past the beach, the oasis dip,
   * the river's own channel away from the ribbon — this plane is
   * what shows; on dry land it lies under the terrain and is never
   * seen. Depth is a per-vertex attribute from the same height
   * function, so shorelines grade and foam exactly like the river's.
   * It sits a hair below the river ribbon, which keeps its detailed
   * flow look where the two overlap.
   */
  private buildWaterPlane(): THREE.Mesh {
    const { waterLevel } = this.cfg.world;
    const dryMask = this.cfg.world.dryMask;
    const SIZE = 760;
    const SEG = 190;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const depths = new Float32Array(pos.count);
    const flows = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      depths[i] = dryMask && dryMask(x, z)
        ? 0
        : clamp(waterLevel - this.h(x, z), 0, 3);
      flows[i * 2] = 0.119;
      flows[i * 2 + 1] = 0.993;
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flows, 2));
    const mesh = new THREE.Mesh(geo, this.buildWaterMaterial());
    mesh.position.y = waterLevel - 0.015;
    mesh.name = 'OpenWater';
    mesh.renderOrder = 2;
    return mesh;
  }

  /**
   * The crater lava lake: a still disc of the round-17 lava pair
   * (dark basalt albedo, emissive only in the cracks) seated on the
   * crater floor the height function carves. Walking rules for lava
   * stay with the game logic; this is the look only.
   */
  private buildLavaLake(lavaTextures?: { albedo?: THREE.Texture; emissive?: THREE.Texture }): THREE.Mesh | null {
    const def = this.areaDefs.find((a) => a.id === 'volcano');
    if (!def) return null;
    const y = this.h(def.x, def.z);
    const geo = new THREE.CircleGeometry(8.2, 28);
    geo.rotateX(-Math.PI / 2);
    let mat: THREE.MeshStandardMaterial;
    if (lavaTextures?.albedo && lavaTextures?.emissive) {
      // The DQ3 lava pair is a FLOW (one bright stream in a dark
      // crust): a single repeat across the lake, turned so the
      // stream crosses the crater instead of tiling into a grid.
      const alb = lavaTextures.albedo;
      alb.repeat.set(1, 1);
      alb.center.set(0.5, 0.5);
      alb.rotation = 0.6;
      const emi = lavaTextures.emissive;
      emi.repeat.set(1, 1);
      emi.center.set(0.5, 0.5);
      emi.rotation = 0.6;
      mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.95,
        map: alb, emissiveMap: emi,
        emissive: new THREE.Color(0xff6a00), emissiveIntensity: 1.5,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0x2e2c2c, roughness: 0.95 });
    }
    this.lavaMaterial = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(def.x, y + 0.12, def.z);
    mesh.name = 'CraterLava';
    mesh.receiveShadow = true;
    return mesh;
  }

  /** The frozen pond: a pale ice sheet over the flattened pond spot
   *  in the snowfield. Whether it bears weight is the game's call. */
  private buildIcePond(): THREE.Mesh {
    const pond = frozenPond(this.cfg);
    const y = this.h(pond.x, pond.z);
    const geo = new THREE.CircleGeometry(pond.r + 1.6, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdceef5, roughness: 0.22, metalness: 0.05,
      transparent: true, opacity: 0.94,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pond.x, y + 0.04, pond.z);
    mesh.name = 'FrozenPond';
    mesh.receiveShadow = true;
    return mesh;
  }
}
