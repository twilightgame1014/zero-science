/* ===================== 広い世界の形（ゲーム側の正本。2026-11-07） =====================
   地形の高さ・水（海・湖・山の川・滝つぼ・本流）・歩ける範囲を、ここ1か所の純粋な関数で決める。
   - もとの 120×120（|x|,|z| ≤ 60）の中は、描画モジュールの terrainHeight とまったく同じ値を返す（既存の拠点・建物・採取状態を守る）。
   - その外側に、山（山麓→中腹→見晴らし→頂）・滝のある山の川・海岸（砂浜・岩場・入り江・岬）・西の湖・本流の続きを足す。
   - 描画モジュール（src/graphics）は改変しない。ビルド時に、モジュール内の `./utils` の読み込みだけを
     src/world/terrain-shim.ts へ向け、モジュールの地形・主人公の足もと・資源・建物の高さもこの関数に合わせる。
   順序：大きな形（台地の起伏・山体・尾根・谷・海岸線）→ 岩の段・湖・滝・川・登山道の彫り込み → 最後に本流。
   細かいノイズで盛り上げるだけにしない（山体と尾根を先に作る）。 */
import { fbm, smoothstep, clamp, lerp, riverCenterX, distanceToRiver, terrainHeight as moduleTerrainHeight } from '../graphics/utils';
import type { GraphicsConfig } from '../graphics/types';

/** 地形の版（セーブの S.worldVer と比べる）。地形の形を変えたら上げて、移行（安全な位置への補正）を確認する */
export const WORLD_VERSION = 2;
/** 旧世界：|x|,|z| ≤ OLD_HALF の地形は描画モジュールと同じ */
export const OLD_HALF = 60;
/** 歩ける範囲（長方形）。海の深い所・崖・深い水は別に止める */
export const WALK = { minX: -172, maxX: 172, minZ: -172, maxZ: 172 };
/** 地形を描く範囲（歩ける範囲の外に、遠景だけの山並みと沖の海） */
export const DRAW_HALF = 240;
/** 歩ける斜面の上限（1マスあたりの高さの差）。これより急な所は崖として止める */
export const WALK_SLOPE = 0.85;
/** 歩いて入れる水の深さの上限（泳ぐ機能はない）。本流は以前から歩いて渡れるので例外（浅瀬扱い） */
export const WADE_DEPTH = 0.55;
export const SEA_LEVEL = 0.32;

type V2 = { x: number; z: number };
const sm = smoothstep;
/** なめらかな最大（k の幅で丸める） */
function smax(a: number, b: number, k: number): number { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, h) + k * h * (1 - h); }
function smin(a: number, b: number, k: number): number { return -smax(-a, -b, k); }
function segInfo(px: number, pz: number, a: V2, b: V2) {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / L2, 0, 1);
  return { t, d: Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t)), len: Math.sqrt(L2) };
}
/** 折れ線：最寄りの距離と、始点からの道のり s */
export interface Poly { pts: V2[]; cum: number[]; len: number; }
function poly(pts: Array<[number, number]>): Poly {
  const p = pts.map(([x, z]) => ({ x, z })), cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
  return { pts: p, cum, len: cum[cum.length - 1] };
}
export function polyNear(P: Poly, x: number, z: number, maxD = Infinity): { d: number; s: number } {
  let best = Infinity, bs = 0;
  for (let i = 0; i < P.pts.length - 1; i++) {
    const a = P.pts[i], b = P.pts[i + 1];
    if (Math.min(a.x, b.x) - maxD > x || Math.max(a.x, b.x) + maxD < x || Math.min(a.z, b.z) - maxD > z || Math.max(a.z, b.z) + maxD < z) continue;
    const r = segInfo(x, z, a, b);
    if (r.d < best) { best = r.d; bs = P.cum[i] + r.t * r.len; }
  }
  return { d: best, s: bs };
}
export function polyAt(P: Poly, s: number): V2 & { dx: number; dz: number } {
  s = clamp(s, 0, P.len);
  let i = 0; while (i < P.pts.length - 2 && P.cum[i + 1] < s) i++;
  const a = P.pts[i], b = P.pts[i + 1], L = P.cum[i + 1] - P.cum[i] || 1, t = (s - P.cum[i]) / L;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / L, dz: (b.z - a.z) / L };
}

/* ---------------- 大きな形：台地の起伏と地方ごとの性格 ---------------- */
/** 西の森の丘（起伏が大きい）・南西の野原（平ら）・北西の岩の丘 */
function regionMasks(x: number, z: number) {
  const west = sm(-70, -120, x);
  const plains = sm(40, 90, z) * sm(-20, -90, x) * (1 - sm(120, 160, z));
  const northWest = sm(-60, -120, z) * sm(-30, -110, x);
  return { west, plains, northWest };
}
function baseLand(x: number, z: number): number {
  const m = regionMasks(x, z);
  let h = 1.9 + (fbm(x * 0.017 + 5.3, z * 0.017 + 9.1, 4) - 0.5) * (6.5 + 3.5 * m.west - 3.5 * m.plains);
  h += (fbm(x * 0.06 + 3.7, z * 0.06 + 1.3, 3) - 0.5) * (1.1 - 0.5 * m.plains);
  // 北西の岩の丘：尾根状のノイズ（大きな波長）
  const ridged = 1 - Math.abs(2 * fbm(x * 0.03 + 17, z * 0.03 + 41, 3) - 1);
  h += m.northWest * (ridged * 6.5 - 1.5);
  h = lerp(h, 1.5 + (h - 1.5) * 0.35, m.plains);
  return h;
}

/* ---------------- 山（北東）：山体と尾根 ---------------- */
export const PEAK = { x: 100, z: -132, h: 40 };
const RIDGES: Array<{ a: V2; b: V2; ha: number; hb: number }> = [
  { a: PEAK, b: { x: 66, z: -100 }, ha: 40, hb: 13 },       // 南西の尾根（拠点の方へ下る）
  { a: { x: 66, z: -100 }, b: { x: 40, z: -70 }, ha: 13, hb: 3.5 }, // 山麓の長い尾根
  { a: PEAK, b: { x: 148, z: -136 }, ha: 40, hb: 15 },      // 東の尾根（海へ落ちる）
  { a: PEAK, b: { x: 92, z: -190 }, ha: 40, hb: 30 },       // 北の尾根（遠景の山並みへ続く）
  { a: PEAK, b: { x: 122, z: -112 }, ha: 40, hb: 22 },      // 南東の尾根（滝の上の岩場）
  { a: PEAK, b: { x: 58, z: -150 }, ha: 40, hb: 16 },       // 西の尾根
  { a: { x: 58, z: -150 }, b: { x: 26, z: -128 }, ha: 16, hb: 5 },
];
function mountainRaw(x: number, z: number): number {
  if (x < -30 || z > -20) return 0;
  let h = 0;
  for (const r of RIDGES) {
    const s = segInfo(x, z, r.a, r.b), hs = lerp(r.ha, r.hb, s.t), W = 22 + hs * 1.5;
    if (s.d >= W) continue;
    const u = s.d / W, f = Math.pow(1 - sm(0, 1, u), 1.9);
    h = h > 0 ? smax(h, hs * f, 3.5) : hs * f;
  }
  if (h <= 0) return 0;
  // 岩の起伏（大きな波長だけ。細かいノイズで盛らない）
  const crag = 1 - Math.abs(2 * fbm(x * 0.045 + 7.1, z * 0.045 + 3.3, 3) - 1);
  h += (crag - 0.45) * Math.min(h, 24) * 0.16;
  return h;
}
/** 岩の段（岩壁・段差）：山の上ほど強く */
function terraceRock(h: number, m: number, x: number, z: number): number {
  // 岩の帯は場所によって出たり消えたりし、段の高さもずれる（棚田のような同心円にしない）
  const patch = sm(0.42, 0.62, fbm(x * 0.028 + 33, z * 0.028 + 71, 3));
  const w = sm(12, 19, m) * 0.85 * patch;
  if (w <= 0) return h;
  const step = 2.2 + 1.4 * fbm(x * 0.02 + 5, z * 0.02 + 9, 2);
  const f = h / step + fbm(x * 0.035 + 1, z * 0.035 + 2, 2) * 1.6;
  const q = (Math.floor(f) + sm(0.38, 0.86, f - Math.floor(f)) - fbm(x * 0.035 + 1, z * 0.035 + 2, 2) * 1.6) * step;
  return lerp(h, q, w);
}

/* ---------------- 海岸（東と南） ---------------- */
/** 東の海岸線（x）。入り江と岬で曲げる */
function eastShoreX(z: number): number {
  let x = 150 + 5 * Math.sin(z * 0.043 + 0.6) + 3 * Math.sin(z * 0.11 + 2.0);
  x -= 11 * Math.exp(-(((z - 6) / 13) ** 2));        // 入り江（中央）
  x += 9 * Math.exp(-(((z + 34) / 7) ** 2));         // 小さな岬
  x -= 6 * Math.exp(-(((z - 92) / 10) ** 2));        // 入り江（南）
  x += 4 * Math.exp(-(((z + 75) / 6) ** 2));         // 山の川の河口の小さな洲
  return x;
}
/** 南の海岸線（z） */
function southShoreZ(x: number): number {
  let z = 157 + 4 * Math.sin(x * 0.05 + 1.1) + 2.5 * Math.sin(x * 0.13);
  z -= 7 * Math.exp(-(((x - 64) / 11) ** 2));        // 入り江
  z += 6 * Math.exp(-(((x - 104) / 6) ** 2));        // 岬
  z += 40 * sm(-40, -75, x);                         // 西へ行くほど海が遠のく（南西は陸のまま）
  return z;
}
/** 海までの符号つきの距離（正＝海の中、負＝陸）。東と南をなめらかにつなぐ */
export function seaDist(x: number, z: number): number {
  const e = x - eastShoreX(z), s = z - southShoreZ(x);
  return smax(e, s, 10);
}
/** 岩場の海岸（岬のまわり・山が海に落ちる北東） */
function rockyShore(x: number, z: number): number {
  const cape = Math.exp(-(((z + 34) / 9) ** 2)) * sm(120, 150, x) + Math.exp(-(((x - 104) / 8) ** 2)) * sm(130, 150, z);
  const ne = sm(-95, -125, z) * sm(125, 145, x);
  const n = sm(0.55, 0.72, fbm(x * 0.04 + 11, z * 0.04 + 23, 3));
  return clamp(cape + ne + n * 0.6, 0, 1);
}
/** 海岸の断面：d＝seaDist。陸側は乾いた砂浜（なだらかに上がる）、波打ち際、浅瀬の棚、かけ下がり、沖 */
function shoreProfile(d: number): number {
  if (d <= 0) return SEA_LEVEL + 0.04 + Math.min(-d, 22) * 0.07 + Math.max(0, -d - 22) * 0.12;
  if (d < 9) return SEA_LEVEL + 0.04 - d * 0.052;                    // 浅瀬の棚（深さ 0.5 まで）
  if (d < 15) return SEA_LEVEL - 0.43 - (d - 9) * 0.34;              // かけ下がり（浅瀬と深い海の境目）
  return SEA_LEVEL - 2.5 - Math.min(d - 15, 60) * 0.06;              // 沖
}

/* ---------------- 西の湖 ---------------- */
export const LAKE = { x: -118, z: 46, r: 17, level: 2.15 };
function lakeDist(x: number, z: number): number {
  const a = Math.atan2(z - LAKE.z, x - LAKE.x);
  const r = LAKE.r * (1 + 0.16 * Math.sin(a * 3 + 0.7) + 0.09 * Math.sin(a * 5 + 2.1));
  return Math.hypot(x - LAKE.x, z - LAKE.z) - r;     // 負＝湖の中
}

/* ---------------- 山の川と滝 ----------------
   滝の場所は「流れの向き d」と「横の向き side」の座標（a＝落ち口から下流へ、l＝横）で設計する。
   上の段（山の池から落ち口まで、ゆるく下る）→ 落ち口 → 高さ約7mの崖（滝つぼを馬てい形に囲む）→ 滝つぼ → 谷底（海へ下る）→ 浜。
   谷の両側の岩壁は下流へ行くほど低くなり、浜の手前で消える。 */
export const FALL_DIR = (() => { const L = Math.hypot(0.814, 0.581); return { x: 0.814 / L, z: 0.581 / L }; })();
export const FALL_SIDE = { x: -FALL_DIR.z, z: FALL_DIR.x };
const LIP = { x: 127.4, z: -88.6 };
const at = (a: number, l: number) => ({ x: LIP.x + FALL_DIR.x * a + FALL_SIDE.x * l, z: LIP.z + FALL_DIR.z * a + FALL_SIDE.z * l });
export function fallFrame(x: number, z: number): { a: number; l: number } {
  const dx = x - LIP.x, dz = z - LIP.z;
  return { a: dx * FALL_DIR.x + dz * FALL_DIR.z, l: dx * FALL_SIDE.x + dz * FALL_SIDE.z };
}
/** 滝の落ち口（崖の縁）と滝つぼ */
export const FALL = { lip: LIP, lipLevel: 13.0, pool: at(3.3, 0), poolR: 3.7, poolLevel: 6.0, height: 7.0 };
/** 山の上の池（水源） */
export const TARN = { ...at(-21.5, 0.8), r: 5.2, level: 16.4 };
/** 上流（池の出口→落ち口）。水面の高さは道のりで線形 */
export const UPSTREAM = poly([[at(-16.6, 0.6).x, at(-16.6, 0.6).z], [at(-12, -0.6).x, at(-12, -0.6).z], [at(-7.5, 0.5).x, at(-7.5, 0.5).z], [at(-3.5, -0.2).x, at(-3.5, -0.2).z], [LIP.x, LIP.z]]);
/** 下流（滝つぼの中→谷底→浜→海） */
export const DOWNSTREAM = poly([[at(4.6, 0).x, at(4.6, 0).z], [at(9, 0.5).x, at(9, 0.5).z], [at(14, -0.6).x, at(14, -0.6).z], [at(19, 0.4).x, at(19, 0.4).z], [at(24, -0.3).x, at(24, -0.3).z], [at(32, 0.2).x, at(32, 0.2).z]]);
const UP_W = 1.55, DOWN_W = 1.7;
export function upstreamLevel(s: number): number { return lerp(TARN.level - 0.05, FALL.lipLevel, clamp(s / UPSTREAM.len, 0, 1)); }
export function downstreamLevel(s: number): number { return Math.max(SEA_LEVEL, lerp(FALL.poolLevel - 0.04, SEA_LEVEL, clamp(s / 21, 0, 1))); }
/** 崖の線：滝つぼを U 字形に囲む（落ち口の幅 2×CLIFF_W、下流へ行くほど広がる谷）。正＝崖の上（上の段）、負＝崖の下（滝つぼ・谷底） */
export const CLIFF_A0 = 0.25, CLIFF_W = 2.4, CLIFF_K = 0.55;
export const CLIFF = { ...at(CLIFF_A0, 0), w: CLIFF_W, k: CLIFF_K };
export function cliffSigned(x: number, z: number): number {
  const f = fallFrame(x, z);
  const back = CLIFF_A0 - f.a, sideD = Math.abs(f.l) - (CLIFF_W + Math.max(0, f.a - CLIFF_A0) * CLIFF_K);
  return smax(back, sideD, 0.6);
}
/** 崖の面の点（落ち口の左右と奥）：a＝落ち口からの距離、sgn＝左右 */
export function cliffWallPoint(a: number, sgn: number): { x: number; z: number } { return at(a, sgn * (CLIFF_W + Math.max(0, a - CLIFF_A0) * CLIFF_K + 0.15)); }
const UPPER_BENCH = FALL.lipLevel + 0.9, LOWER_BENCH = FALL.poolLevel + 0.5;
function upperSurf(a: number, l: number): number { return UPPER_BENCH - Math.max(0, a) * 0.55 + Math.max(0, -a) * 0.13 + Math.max(0, Math.abs(l) - 4) * 0.22; }
function lowerSurf(a: number, l: number): number { return LOWER_BENCH - Math.max(0, a - 3.3) * 0.235 + Math.max(0, Math.abs(l) - 2.5) * 0.08; }
/* ---------------- 登山道（往復できる道。傾きを 0.3 以下に抑えて彫る） ---------------- */
/** 山麓（旧世界の北東の端）→ 中腹 → 休み場 → 見晴らし台。くねらせて傾きをゆるくする */
export const TRAIL_MAIN = poly([
  [50, -58], [58, -66], [56, -76], [66, -82], [74, -80], [80, -88], [74, -97], [82, -104],
  [92, -100], [97, -108], [90, -116], [96, -122], [104, -118],
]);
/** 登山道の中腹（池と同じくらいの高さの分かれ道）→ 山の池 → 上流の岸 → 崖の外側をジグザグに下る → 谷底 → 滝つぼの岸 → 谷底を下る → 浜。
    見晴らし台からは登山道を少し戻って分かれ道から入る（2本の道を違う高さで交差させない） */
const fa = (a: number, l: number): [number, number] => { const p = at(a, l); return [+p.x.toFixed(2), +p.z.toFixed(2)]; };
export const TRAIL_FALLS = poly([
  [92.2, -100.3], [99, -96], [104, -94.6], fa(-17, 4.6), fa(-10, 4.0), fa(-4, 4.1),
  fa(-1.5, 9.0), fa(9, 13.0), fa(4.5, 17.0), fa(15.5, 20.0), fa(21, 13.5), fa(18.5, 5.4), fa(11, 4.3), fa(5.2, 3.9),
  fa(11, 3.8), fa(19, 3.6), fa(26, 3.4), fa(31, 4.5),
]);
/** 休み場（小さな平地）と見晴らし台（道のりの位置と半径） */
export const RESTS: Array<{ trail: 'main' | 'falls'; s: number; r: number; name: string }> = [
  { trail: 'main', s: 36, r: 3.6, name: '山麓の休み場' }, { trail: 'main', s: 78, r: 3.6, name: '中腹の休み場' },
];
export const LOOKOUT = { x: 104, z: -118, r: 7.5 };
export const TRAILS = { main: TRAIL_MAIN, falls: TRAIL_FALLS };

/* 道の高さ：自然の地形を道に沿って測り、上り下りの傾きを抑えて、なめらかにした値（起動時に一度だけ計算） */
const TRAIL_STEP = 0.75, TRAIL_GRADE = 0.27;
type Profile = { trail: Poly; h: Float32Array };
let profiles: Profile[] | null = null;
let lookoutH = 0;
function buildProfile(P: Poly, fixed: Array<{ s: number; h: number }>, H0: (x: number, z: number) => number, straight = false): Profile {
  const n = Math.ceil(P.len / TRAIL_STEP) + 1, h = new Float32Array(n), lock = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { const p = polyAt(P, i * TRAIL_STEP); h[i] = H0(p.x, p.z); }
  for (const f of fixed) { const i = Math.round(f.s / TRAIL_STEP); if (i >= 0 && i < n) lock[i] = f.h; }
  // straight：固定点と固定点の間は、自然の地形ではなくまっすぐ（一定の傾き）に結ぶ（尾根を越えて上り下りしない）
  if (straight) {
    const idx: number[] = []; for (let i = 0; i < n; i++) if (!isNaN(lock[i])) idx.push(i);
    for (let k = 0; k < idx.length - 1; k++) { const a = idx[k], b = idx[k + 1]; for (let i = a + 1; i < b; i++) h[i] = lerp(lock[a], lock[b], (i - a) / (b - a)); }
  }
  // 固定点（池の岸・滝つぼの岸など）を通し、前後へ傾きの上限を伝える
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < n; i++) if (!isNaN(lock[i])) h[i] = lock[i];
    const g = TRAIL_GRADE * TRAIL_STEP;
    for (let i = 1; i < n; i++) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
    // なめらかに（傾きの上限は保たれる：平均は上限を超えない）
    const c = h.slice(); for (let i = 2; i < n - 2; i++) h[i] = (c[i - 2] + c[i - 1] + c[i] + c[i + 1] + c[i + 2]) / 5;
  }
  // 最後に傾きの上限だけをもう一度（固定点が上限と合わないときも段差を作らない）
  const g = TRAIL_GRADE * TRAIL_STEP;
  for (let i = 1; i < n; i++) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
  for (let i = n - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
  return { trail: P, h };
}
function profileAt(p: Profile, s: number): number {
  const f = clamp(s / TRAIL_STEP, 0, p.h.length - 1), i = Math.floor(f), t = f - i;
  return i + 1 < p.h.length ? lerp(p.h[i], p.h[i + 1], t) : p.h[i];
}
function ensureProfiles(): Profile[] {
  if (profiles) return profiles;
  const pre = (x: number, z: number) => outerBeforeTrails(x, z);
  // 1回目：自然の地形に沿った道の高さ。2回目：休み場（平ら）と見晴らし台（平ら。道が着く所の高さ）を固定して作り直す
  const first = buildProfile(TRAIL_MAIN, [], pre);
  const sEdge = TRAIL_MAIN.len - LOOKOUT.r;
  const locks: Array<{ s: number; h: number }> = [];
  for (const r of RESTS) if (r.trail === 'main') { const h = profileAt(first, r.s); for (let q = r.s - r.r - 0.8; q <= r.s + r.r + 0.8; q += TRAIL_STEP) locks.push({ s: q, h }); }
  const second = buildProfile(TRAIL_MAIN, locks, pre);
  const lookH = profileAt(second, sEdge);
  for (let q = sEdge - 0.4; q <= TRAIL_MAIN.len; q += TRAIL_STEP) locks.push({ s: q, h: lookH });
  const main = buildProfile(TRAIL_MAIN, locks, pre);
  lookoutH = lookH;
  // 滝の道：見晴らし台の高さから出て、池の岸・上流の岸・滝つぼの岸・海岸を通る
  const nearS = (x: number, z: number) => polyNear(TRAIL_FALLS, x, z).s;
  const P = (a: number, l: number) => { const p = at(a, l); return nearS(p.x, p.z); };
  const falls = buildProfile(TRAIL_FALLS, [
    { s: 0, h: profileAt(main, polyNear(TRAIL_MAIN, 92.2, -100.3).s) },
    { s: P(-17, 4.6), h: TARN.level + 0.7 },
    { s: P(-4, 4.1), h: upperSurf(-4, 4.1) },
    { s: P(18.5, 5.4), h: lowerSurf(18.5, 5.4) },
    { s: P(5.2, 3.9), h: lowerSurf(5.2, 3.9) + 0.05 },
    { s: P(26, 3.4), h: lowerSurf(26, 3.4) },
  ], pre, true);
  profiles = [main, falls];
  return profiles;
}

/* ---------------- 外側の地形（旧世界の外） ---------------- */
function rimLift(x: number, z: number): number {
  // 歩ける範囲の外の遠景の山並み（北・西・南西）。海の側には作らない
  const n = sm(168, 205, -z), w = sm(168, 205, -x), s = sm(168, 205, z) * sm(-30, -60, x);
  const m = Math.max(n, w, s);
  if (m <= 0) return 0;
  const ridged = 1 - Math.abs(2 * fbm(x * 0.02 + 61, z * 0.02 + 13, 3) - 1);
  return m * (18 + ridged * 22);
}
/** 山・海岸・湖までの大きな形（滝と川と道の彫り込みの前） */
function outerShape(x: number, z: number): number {
  let h = baseLand(x, z);
  const m = mountainRaw(x, z);
  if (m > 0) h = smax(h, terraceRock(m + 1.2, m, x, z), 3.0);
  h += rimLift(x, z);
  // 西の湖：まわりをなだらかな岸にして、湖底を掘る
  const ld = lakeDist(x, z);
  if (ld < 22) {
    const shore = LAKE.level + 0.25 + Math.max(0, ld) * 0.12;
    h = lerp(h, Math.min(h, shore + 1.2), sm(22, 6, ld));
    if (ld < 0) h = Math.min(h, LAKE.level - Math.min(-ld * 0.22, 2.4) + 0.12);
    else h = Math.max(h, Math.min(h, LAKE.level + 0.18 + ld * 0.09));
  }
  // 海岸：海に近いほど砂浜の断面へ。岩場では陸が高いまま海へ落ちる
  const d = seaDist(x, z);
  if (d > -34) {
    const rocky = rockyShore(x, z);
    const prof = shoreProfile(d);
    const wBeach = sm(-34, -6, d);
    let land = lerp(h, Math.min(h, prof + 0.4), wBeach * (1 - rocky * 0.75));
    if (rocky > 0 && d > -6 && d <= 0) land = Math.max(land, lerp(prof, prof + 2.6 * rocky, sm(0, -6, d)));
    h = d > 0 ? Math.min(lerp(land, prof, sm(0, 2.5, d)), prof + rocky * 0.9 * sm(4, 0, d)) : land;
  }
  return h;
}
/** 滝のまわり：自然の斜面を生かし、必要な所だけ決める。
   崖の外側（上の段）：谷のすぐ脇だけ、崖の高さを保つ最低の高さまで盛る。崖の内側（滝つぼ・谷底）：下の段の高さへ下げる。 */
function fallsZone(x: number, z: number, h: number): number {
  const f = fallFrame(x, z);
  if (f.a < -20 || f.a > 36 || Math.abs(f.l) > 24) return h;
  const sd = cliffSigned(x, z);
  const lat = Math.abs(f.l);
  const need = sm(15, 7, lat - Math.max(0, f.a) * 0.4) * sm(-16, -5, f.a) * (1 - sm(17, 25, f.a));
  const outside = lerp(h, Math.max(h, upperSurf(f.a, f.l)), need);
  const floorW = (1 - sm(25, 32, f.a)) * sm(-14, -7, f.a);
  const inside = lerp(h, lowerSurf(f.a, f.l), floorW);
  let site = lerp(inside, outside, sm(-0.35, 0.45, sd));
  // 滝つぼ：崖の下の側だけ、中心で深さ約1.7
  const dp = Math.hypot(x - FALL.pool.x, z - FALL.pool.z);
  if (sd < 0 && dp < FALL.poolR + 1.4) {
    const bed = FALL.poolLevel - 1.75 * (1 - sm(0, FALL.poolR + 0.4, dp) ** 1.6) + 0.1;
    site = lerp(site, Math.min(site, bed), sm(FALL.poolR + 1.4, FALL.poolR - 0.3, dp) * sm(0, -0.5, sd));
  }
  return site;
}
/** 川の水面（上流・下流）までの距離と、その場所の水面の高さ */
export function streamAt(x: number, z: number): { d: number; level: number; which: 'up' | 'down' | null; s: number } {
  const u = polyNear(UPSTREAM, x, z, 6), dn = polyNear(DOWNSTREAM, x, z, 6);
  if (u.d <= dn.d) return { d: u.d, level: upstreamLevel(u.s), which: u.d < 6 ? 'up' : null, s: u.s };
  return { d: dn.d, level: downstreamLevel(dn.s), which: dn.d < 6 ? 'down' : null, s: dn.s };
}
function carveStreams(x: number, z: number, h: number, bedOnly = false): number {
  if (x < 95 || x > 168 || z < -118 || z > -55) return h;
  if (bedOnly) {   // 道を彫ったあと：水の通り道（池の底・川底）だけを戻す（岸の形は道を優先）
    const td0 = Math.hypot(x - TARN.x, z - TARN.z);
    if (td0 < TARN.r + 0.6) h = Math.min(h, TARN.level - 1.3 * (1 - sm(0, TARN.r + 0.6, td0)) + 0.1);
    const st0 = streamAt(x, z);
    const past0 = (st0.which === 'up' && st0.s > UPSTREAM.len - 0.05 && fallFrame(x, z).a > -0.2) || (st0.which === 'down' && st0.s < 0.05);
    if (st0.which && !past0) { const W = st0.which === 'up' ? UP_W : DOWN_W;
      if (st0.d < W + 0.5) h = Math.min(h, lerp(st0.level - 0.46 * (1 - sm(0, W + 0.15, st0.d) ** 2) + 0.06, st0.level + 0.08, sm(W - 0.3, W + 0.5, st0.d))); }
    return h;
  }
  // 山の池
  const td = Math.hypot(x - TARN.x, z - TARN.z);
  if (td < TARN.r + 5) {
    const bank = TARN.level + 0.3 + Math.max(0, td - TARN.r) * 0.35;
    h = lerp(h, Math.min(h, bank), sm(TARN.r + 5, TARN.r + 1, td));
    if (td < TARN.r + 0.6) h = Math.min(h, TARN.level - 1.3 * (1 - sm(0, TARN.r + 0.6, td)) + 0.1);
  }
  const st = streamAt(x, z);
  // 川の端より先は彫らない（上流の終わり＝落ち口の先は崖と滝つぼ、下流の始まり＝滝つぼの中）
  const past = (st.which === 'up' && st.s > UPSTREAM.len - 0.05 && fallFrame(x, z).a > -0.2) || (st.which === 'down' && st.s < 0.05);
  if (st.which && !past) {
    const W = st.which === 'up' ? UP_W : DOWN_W;
    // 岸：水面より少し高い所まで下げる（谷）。川底：中心で 0.45 の深さ
    const bankH = st.level + 0.28 + Math.max(0, st.d - W) * 0.32;
    // 岸は水面より少し高く（低すぎる所は盛り、高すぎる所は削る）。川が地面から浮かない・埋まらない
    h = lerp(h, h > bankH ? Math.min(h, bankH + Math.max(0, st.d - W - 1.2) * 0.9) : bankH, sm(W + 4.5, W + 0.6, st.d));
    const bed = st.level - 0.46 * (1 - sm(0, W + 0.15, st.d) ** 2) + 0.06;
    if (st.d < W + 0.5) h = Math.min(h, lerp(bed, st.level + 0.08, sm(W - 0.3, W + 0.5, st.d)));
  }
  return h;
}
function carveTrails(x: number, z: number, h: number): number {
  const ps = ensureProfiles();
  let out = h;
  // 道が2本近いときは、近い方の道の高さだけを使う（2本の高さを重ねて段差を作らない）
  let best: { d: number; ph: number } | null = null;
  for (const p of ps) {
    const nr = polyNear(p.trail, x, z, 6);
    if (nr.d >= 5.2) continue;
    if (!best || nr.d < best.d) best = { d: nr.d, ph: profileAt(p, nr.s) };
  }
  if (best) out = lerp(out, best.ph, sm(5.2, 1.9, best.d));
  // 見晴らし台：平らに
  const dl = Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z);
  if (dl < LOOKOUT.r + 1.6) out = lerp(out, lookoutH, sm(LOOKOUT.r + 1.6, LOOKOUT.r, dl));
  for (const r of RESTS) {
    const P = r.trail === 'main' ? ps[0] : ps[1], c = polyAt(P.trail, r.s), d = Math.hypot(x - c.x, z - c.z);
    if (d < r.r + 3) out = lerp(out, profileAt(P, r.s), sm(r.r + 3, r.r, d));
  }
  return out;
}
/** 本流（川）の続き：旧世界と同じ削り方で、北の谷と南の河口まで */
function carveRiver(x: number, z: number, h: number): number {
  const dR = distanceToRiver(x, z);
  if (dR > 14) return h;
  const valley = sm(13, 4.5, dR);
  h = lerp(h, Math.min(h, 0.9), valley * 0.93);
  h -= Math.exp(-((dR / 3.9) ** 2)) * 2.15;
  return h;
}
function outerBeforeTrails(x: number, z: number): number {
  let h = outerShape(x, z);
  h = fallsZone(x, z, h);
  h = carveStreams(x, z, h);
  return h;
}
/** 旧世界の外の地形（すべての彫り込みのあと） */
function outerHeight(x: number, z: number): number {
  let h = outerBeforeTrails(x, z);
  h = carveTrails(x, z, h);
  // 滝の水まわりは道より優先（道が滝つぼや川を埋めない）
  h = carveStreams(x, z, h, true);
  h = carveRiver(x, z, h);
  return h;
}

/** 旧世界との境目の重み（0＝旧世界そのまま、1＝外側の形） */
export function outerWeight(x: number, z: number): number {
  return sm(0, 18, Math.max(Math.abs(x), Math.abs(z)) - OLD_HALF);
}
/**
 * 世界の地形の高さ（ゲームと描画の正本）。cfg は描画モジュールの設定（size は 120 のまま）。
 */
export function worldHeight(x: number, z: number, cfg: GraphicsConfig): number {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= OLD_HALF && az <= OLD_HALF) return moduleTerrainHeight(x, z, cfg);
  const b = outerWeight(x, z);
  const o = outerHeight(x, z);
  if (b >= 1) return o;
  return lerp(moduleTerrainHeight(x, z, cfg), o, b);
}

/* ---------------- 水の種類と深さ（歩けるかの判定と描画に使う） ---------------- */
export type WaterKind = 'sea' | 'lake' | 'tarn' | 'stream' | 'pool' | 'river' | null;
export interface WaterInfo { kind: WaterKind; level: number; depth: number; }
/** その場所の水（水面の高さと深さ）。地形の高さ h を渡すと計算を省ける */
export function waterAt(x: number, z: number, h: number): WaterInfo {
  // 本流（旧世界と同じ：川の帯の中で水位より低い所）
  const dR = distanceToRiver(x, z);
  const halfW = 3.9 + Math.sin(z * 0.21) * 0.35;
  if (dR < halfW && h < SEA_LEVEL && seaDist(x, z) < -2) return { kind: 'river', level: SEA_LEVEL, depth: SEA_LEVEL - h };
  if (x > 100 && z < -60 && z > -110 && x < 165) {
    const dp = Math.hypot(x - FALL.pool.x, z - FALL.pool.z);
    if (dp < FALL.poolR + 1.2 && h < FALL.poolLevel) return { kind: 'pool', level: FALL.poolLevel, depth: FALL.poolLevel - h };
    const td = Math.hypot(x - TARN.x, z - TARN.z);
    if (td < TARN.r + 1.2 && h < TARN.level) return { kind: 'tarn', level: TARN.level, depth: TARN.level - h };
    const st = streamAt(x, z);
    const past = (st.which === 'up' && st.s > UPSTREAM.len - 0.05 && fallFrame(x, z).a > -0.2) || (st.which === 'down' && st.s < 0.05);
    if (st.which && !past && st.d < (st.which === 'up' ? UP_W : DOWN_W) + 0.4 && h < st.level && seaDist(x, z) < 0) return { kind: 'stream', level: st.level, depth: st.level - h };
  }
  if (lakeDist(x, z) < 2 && h < LAKE.level) return { kind: 'lake', level: LAKE.level, depth: LAKE.level - h };
  if (seaDist(x, z) > -3 && h < SEA_LEVEL) return { kind: 'sea', level: SEA_LEVEL, depth: SEA_LEVEL - h };
  return { kind: null, level: 0, depth: 0 };
}

/* ---------------- 地名（HUD と地図） ---------------- */
export function placeName(x: number, z: number, h: number): string | null {
  if (Math.abs(x) <= 58 && Math.abs(z) <= 58) return null;
  const sd = seaDist(x, z);
  if (sd > -16) return sd > 0 ? '沖の浅瀬' : '海岸';
  if (Math.hypot(x - FALL.pool.x, z - FALL.pool.z) < 14) return '滝つぼ';
  if (Math.hypot(x - TARN.x, z - TARN.z) < 12) return '山の池';
  if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < 12) return '見晴らし台';
  const m = mountainRaw(x, z);
  if (m > 0.5 || h > 9) return h > 18 ? '山の高所' : h > 9 ? '山の中腹' : '山麓';
  if (lakeDist(x, z) < 12) return '西の湖';
  const r = regionMasks(x, z);
  if (r.northWest > 0.5) return '北西の岩の丘';
  if (r.plains > 0.5) return '南西の野原';
  if (r.west > 0.5) return '西の森';
  return '外の野';
}
/** 地形・水の性格（自然物の配置・地面の色に使う）：0〜1 */
export function biome(x: number, z: number, h: number) {
  const m = mountainRaw(x, z), sd = seaDist(x, z), r = regionMasks(x, z);
  return {
    mountain: clamp(m / 14, 0, 1),
    alpine: sm(17, 25, h) * sm(2, 8, m),
    coast: sm(-26, -4, sd),
    beach: sm(-14, -2, sd) * (1 - rockyShore(x, z) * 0.8),
    rockyShore: rockyShore(x, z) * sm(-12, 0, sd),
    lake: sm(10, 0, lakeDist(x, z)),
    west: r.west, plains: r.plains, northWest: r.northWest,
  };
}
export { riverCenterX, distanceToRiver };
