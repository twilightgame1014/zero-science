import type { GraphicsConfig, Vec3Like } from './types';

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
 * Terrain height at scene coordinates. Pure function of (x, z) so the
 * mesh, object placement and character grounding always agree.
 */
export function terrainHeight(x: number, z: number, cfg: GraphicsConfig): number {
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
