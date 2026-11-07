import type { AreaDefinition, AreaId, GraphicsConfig, Vec3Like } from './types';

/* ------------------------------------------------------------------ */
/* Deterministic RNG + value noise (shared by terrain & placement)     */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iz: number): number {
  let h = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz; // 0..1
}

export function fbm(x: number, z: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return v; // ~0..1
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, v: number): number => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential damping factor. */
export const dampFactor = (rate: number, dt: number): number =>
  1 - Math.exp(-rate * dt);

/* ------------------------------------------------------------------ */
/* World shape: one source of truth for terrain height & the river     */
/* ------------------------------------------------------------------ */

/** River centre line x as a function of z (the river flows along z). */
export function riverCenterX(z: number): number {
  return 16 * Math.sin(z * 0.045) + 7 * Math.sin(z * 0.013 + 1.7) + 10;
}

export function distanceToRiver(x: number, z: number): number {
  return Math.abs(x - riverCenterX(z));
}

/**
 * Terrain height of the LEGACY world (the 120x120 forest around the
 * origin), exactly as shipped before the world expansion. Kept
 * untouched as the base layer: the expanded terrainHeight() blends
 * the new areas over it, and inside the legacy square every new
 * area's falloff is exactly zero, so existing saves keep their
 * ground heights bit-for-bit (spec §1.4, verified numerically).
 */
function terrainHeightLegacy(x: number, z: number, cfg: GraphicsConfig): number {
  const w = cfg.world;
  // Rolling hills.
  let h = (fbm(x * 0.028 + 13.7, z * 0.028 + 4.2, 4) - 0.5) * 4.4;
  h += (fbm(x * 0.11 + 71.3, z * 0.11 + 9.1, 3) - 0.5) * 0.55;

  // Rocky highland rising toward the north-east corner.
  const rockMask = smoothstep(18, 52, x - z * 0.35);
  h += rockMask * (2.6 + fbm(x * 0.05 + 3.3, z * 0.05 + 8.8, 3) * 3.4);

  // Gentle rim hills so the world does not end in a visible cliff of void.
  const r = Math.hypot(x, z);
  h += smoothstep(w.size * 0.42, w.size * 0.62, r) * 4.0;

  // Terraces: quantize the rising land into flat treads with steep
  // risers, like the stacked cliff fields of the reference tilesets.
  // The river valley opts out here; the plateau flattens over it later.
  const valleyForTerrace = smoothstep(13, 4.5, distanceToRiver(x, z));
  const terraceMask =
    clamp(rockMask * 1.15 + smoothstep(24, 44, r) * 0.75, 0, 1) *
    (1 - valleyForTerrace);
  if (terraceMask > 0.01) {
    const step = 1.1;
    const f = h / step;
    const q = (Math.floor(f) + smoothstep(0.42, 0.9, f - Math.floor(f))) * step;
    h = lerp(h, q, terraceMask * 0.85);
  }

  // River valley: soften hills, then carve the channel below water level.
  const dRiver = distanceToRiver(x, z);
  const valley = smoothstep(13, 4.5, dRiver); // 1 inside the valley
  h = lerp(h, Math.min(h, 0.9), valley * 0.75);
  const channel = Math.exp(-((dRiver / 3.9) ** 2));
  h -= channel * 2.15;

  // Buildable plateau: flatten to a gentle meadow level.
  const dPlateau = Math.hypot(
    x - w.plateauCenter.x,
    z - w.plateauCenter.z,
  );
  const flat = smoothstep(w.plateauRadius, w.plateauRadius * 0.45, dPlateau);
  h = lerp(h, 0.62, flat);

  return h;
}

/* ------------------------------------------------------------------ */
/* World expansion: the shared 7-area layout (spec §1.1, 2026-11-07)   */
/*                                                                     */
/* The layout is data (GraphicsConfig.world.areas), shared by the      */
/* game and the renderer. terrainHeight() shapes the land from it;     */
/* areaWeights() reports the blend at a point for placement,           */
/* gathering, ambience and sound. Both are pure functions of (x, z).   */
/* ------------------------------------------------------------------ */

/** Default area layout, mirrored into DEFAULT_CONFIG (config.ts).
 *  The legacy 120x120 world stays the forest at the centre; the new
 *  areas sit outside it, and every non-forest falloff reaches zero
 *  before the legacy square (|x|,|z| <= 60), which is what keeps the
 *  old ground heights exact. */
export const DEFAULT_AREAS: AreaDefinition[] = [
  { id: 'forest', x: 0, z: 0, radius: 78 },
  { id: 'lakeside', x: 108, z: -6, radius: 42 },
  { id: 'coast', x: 172, z: 6, radius: 58 },
  { id: 'volcano', x: -128, z: -118, radius: 62 },
  { id: 'snow', x: 108, z: -128, radius: 66 },
  { id: 'desert', x: -128, z: 118, radius: 66 },
  { id: 'town', x: 108, z: 108, radius: 46 },
];

export function areaDefinitions(cfg: GraphicsConfig): AreaDefinition[] {
  return cfg.world.areas ?? DEFAULT_AREAS;
}

function areaDef(cfg: GraphicsConfig, id: AreaId): AreaDefinition {
  return areaDefinitions(cfg).find((a) => a.id === id) ?? DEFAULT_AREAS.find((a) => a.id === id)!;
}

/** Raw falloff of one area at a point: 1 inside ~0.55 r, 0 at r. */
export function areaRaw(x: number, z: number, def: AreaDefinition): number {
  const d = Math.hypot(x - def.x, z - def.z);
  return smoothstep(1, 0.55, d / Math.max(def.radius, 1));
}

const AREA_IDS: AreaId[] = ['forest', 'lakeside', 'coast', 'volcano', 'snow', 'desert', 'town'];

/**
 * Normalised area weights at a point (every weight 0..1, sum = 1).
 * The forest is the default land: whatever the other areas do not
 * claim, the forest holds. For ambience / sound / spawn blending and
 * dominant-area decisions on the game side.
 */
export function areaWeights(x: number, z: number, cfg: GraphicsConfig): Record<AreaId, number> {
  const out = {} as Record<AreaId, number>;
  let claimed = 0;
  for (const id of AREA_IDS) {
    if (id === 'forest') continue;
    const w = areaRaw(x, z, areaDef(cfg, id));
    out[id] = w;
    claimed = Math.max(claimed, w);
  }
  out.forest = 1 - claimed;
  let sum = 0;
  for (const id of AREA_IDS) sum += out[id];
  if (sum > 0) for (const id of AREA_IDS) out[id] /= sum;
  return out;
}

/** Landmark anchors derived from the area layout (single source for
 *  the height function and the set-piece meshes). */
export function frozenPond(cfg: GraphicsConfig): { x: number; z: number; y: number; r: number } {
  const s = areaDef(cfg, 'snow');
  return { x: s.x - 22, z: s.z + 24, y: 2.0, r: 5.5 };
}
export function oasisCenter(cfg: GraphicsConfig): { x: number; z: number } {
  const d = areaDef(cfg, 'desert');
  return { x: d.x + 20, z: d.z - 20 };
}

/** Absolute target height of one area's landform (before blending). */
function areaHeight(id: AreaId, x: number, z: number, cfg: GraphicsConfig): number {
  const def = areaDef(cfg, id);
  const d = Math.hypot(x - def.x, z - def.z);
  switch (id) {
    case 'lakeside': {
      // Gentle slope into a lake bowl: the bed crosses the water
      // level well inside the area, so the shoreline is terrain,
      // not a texture trick.
      let h = 0.5 + (fbm(x * 0.03 + 51, z * 0.03 + 27, 3) - 0.5) * 1.6;
      h -= 2.3 * Math.exp(-((d / 25) ** 2));
      return h;
    }
    case 'coast': {
      // A beach falling eastward into the sea; past the field edge
      // the bed keeps dropping under the open-water plane.
      let h = 1.0 - (x - 118) * 0.052 + (fbm(x * 0.04 + 7, z * 0.04 + 3, 3) - 0.5) * 1.1;
      h -= smoothstep(168, 205, x) * 2.2;
      return h;
    }
    case 'volcano': {
      // Ash plain, a broad cone, and a crater dip at the top. The
      // crater floor (~22) holds the lava lake disc the terrain
      // renderer places at terrainHeight(centre).
      let h = 1.1 + (fbm(x * 0.05 + 91, z * 0.05 + 33, 3) - 0.5) * 1.8;
      h += 30 * Math.exp(-((d / 30) ** 2));
      h -= 9 * Math.exp(-((d / 10) ** 2));
      // Flatten the crater floor toward the centre height: the
      // raw cone/dip pair rises ~2.7 m by r=8, which buried the
      // lava lake disc (r 8.2) except at its very centre.
      const centreH = 1.1 + (fbm(def.x * 0.05 + 91, def.z * 0.05 + 33, 3) - 0.5) * 1.8 + 30 - 9;
      h = lerp(h, centreH, smoothstep(11, 7, d) * 0.92);
      return h;
    }
    case 'snow': {
      // High ridges over the old north-east highland, with one flat
      // frozen pond frozen into the slope.
      let h = 3.2 + (fbm(x * 0.035 + 15, z * 0.035 + 61, 4) - 0.5) * 5.0;
      h += 7 * Math.exp(-((d / 40) ** 2));
      const pond = frozenPond(cfg);
      const dp = Math.hypot(x - pond.x, z - pond.z);
      // Near-absolute flatten inside the pond disc's radius so the
      // ice sheet the renderer lays there never clips the slope.
      h = lerp(h, pond.y, smoothstep(9.5, 5.0, dp) * 0.98);
      return h;
    }
    case 'desert': {
      // Dune field: wind-rippled ridges warped by low noise, plus a
      // dipped oasis whose bed drops below the water level.
      const warp = fbm(x * 0.02 + 3, z * 0.02 + 8, 2) * 4.0;
      let h = 0.7 + (Math.sin(x * 0.055 + warp) * 0.5 + 0.5) * 2.2;
      h += (fbm(x * 0.06 + 43, z * 0.06 + 19, 3) - 0.5) * 0.8;
      const o = oasisCenter(cfg);
      const doa = Math.hypot(x - o.x, z - o.z);
      h -= 3.4 * Math.exp(-((doa / 11) ** 2));
      return h;
    }
    case 'town': {
      // A levelled building ground: nearly flat, tiny noise only.
      return 0.58 + (fbm(x * 0.08 + 5, z * 0.08 + 77, 2) - 0.5) * 0.12;
    }
    default:
      return terrainHeightLegacy(x, z, cfg);
  }
}

/**
 * Terrain height at scene coordinates, world-expansion edition.
 * Pure function of (x, z) so the mesh, object placement and
 * character grounding always agree. The legacy forest is the base;
 * each new area's absolute landform is blended over it by that
 * area's raw falloff (fixed order, so overlaps resolve the same way
 * everywhere). Inside the legacy square every falloff is zero and
 * the result equals the legacy function exactly.
 */
export function terrainHeight(x: number, z: number, cfg: GraphicsConfig): number {
  let h = terrainHeightLegacy(x, z, cfg);
  const order: AreaId[] = ['lakeside', 'coast', 'desert', 'town', 'snow', 'volcano'];
  for (const id of order) {
    const w = areaRaw(x, z, areaDef(cfg, id));
    if (w > 0.001) h = lerp(h, areaHeight(id, x, z, cfg), w);
  }
  return h;
}

/* ------------------------------------------------------------------ */
/* Coordinate conversion between game-logic space and scene space      */
/* ------------------------------------------------------------------ */

/** logic -> scene (rendering only; never mutates the input). */
export function toScenePosition(
  p: Vec3Like,
  cfg: GraphicsConfig,
): { x: number; y: number; z: number } {
  const c = cfg.coordinates;
  return {
    x: (p.x - c.origin.x) * c.scale,
    y: ((p.y ?? 0) - c.origin.y) * c.scale,
    z: (p.z - c.origin.z) * c.scale,
  };
}

/** True when (x, z) is too close to the water to place props on. */
export function isInRiver(x: number, z: number, margin = 5.2): boolean {
  return distanceToRiver(x, z) < margin;
}

/* ------------------------------------------------------------------ */
/* Dirt path: plateau -> riverside -> rocky foothills                  */
/* ------------------------------------------------------------------ */

/** Centre line of the worn dirt path (visual only — walkability and
 *  routing stay with the game logic). */
export const PATH_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-20, 20],
  [-11, 23],
  [-2, 21],
  [6, 17],
  [13, 12],
  [20, 6],
];

export function distanceToPath(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i];
    const [bx, bz] = PATH_POINTS[i + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const t = clamp(
      ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz),
      0,
      1,
    );
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Distance from point P to segment A->B (3D). Used by the occlusion
 *  fade to test whether something blocks the camera->player sight line. */
export function segmentPointDistance(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  px: number, py: number, pz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
