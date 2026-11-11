/* ===================== 広い世界の形（ゲーム側の正本。2026-11-07） =====================
   地形の高さ・水（海・湖・山の川・滝つぼ・本流）・歩ける範囲を、ここ1か所の純粋な関数で決める。
   - もとの 120×120（|x|,|z| ≤ 60）の中は、描画モジュールの terrainHeight とまったく同じ値を返す（既存の拠点・建物・採取状態を守る）。
   - その外側に、山（山麓→中腹→見晴らし→頂）・滝のある山の川・海岸（砂浜・岩場・入り江・岬）・西の湖・本流の続きを足す。
   - 描画モジュール（src/graphics）は改変しない。ビルド時に、モジュール内の `./utils` の読み込みだけを
     src/world/terrain-shim.ts へ向け、モジュールの地形・主人公の足もと・資源・建物の高さもこの関数に合わせる。
   順序：大きな形（台地の起伏・山体・尾根・谷・海岸線）→ 岩の段・湖・滝・川・登山道の彫り込み → 最後に本流。
   細かいノイズで盛り上げるだけにしない（山体と尾根を先に作る）。 */
import { fbm, smoothstep, clamp, lerp, riverCenterX, distanceToRiver, terrainHeight as moduleTerrainHeight, areaWeights, DEFAULT_AREAS, frozenPond } from '../graphics/utils';
import type { GraphicsConfig } from '../graphics/types';

/** 地形の版（セーブの S.worldVer と比べる）。地形の形を変えたら上げて、移行（安全な位置への補正）を確認する */
export const WORLD_VERSION = 4;   // 3＝Muse の7エリア（ラウンド18）を土台にした版。4＝南西の火山を登れる山にした版（2026-11-11。火山の中心から 70 より外は版3と同じ）
/** 旧世界：|x|,|z| ≤ OLD_HALF の地形は描画モジュールと同じ */
export const OLD_HALF = 60;
/** 歩ける範囲（長方形）。海の深い所・崖・深い水は別に止める */
export const WALK = { minX: -172, maxX: 172, minZ: -172, maxZ: 172 };
/**
 * 外の野（2026-11-10、試験範囲）：中心から半径 WALK_R までは、上の長方形の外も歩ける。
 * 地形・水・自然物はもとから座標だけで決まる（地形は worldHeight、自然物は第3層の区画とハッシュ）ので、範囲を広げても
 * 長方形の中の地形・自然物の位置と ID は変わらない。半径は描画の都合で決めた試験範囲：
 * 描画モジュールの全面の水面は ±380、遠景の山並みは中心から 262 より外にある（INTEGRATION §26/§30）ので、その内側に収める。
 * 地形のメッシュは ±180 の外を src/world/render.ts が区画ごとに作る（モジュールの区画は ±180 まで）。
 */
export const WALK_R = 250;
/** 地形を描く範囲（歩ける範囲の外に、遠景だけの山並みと沖の海） */
export const DRAW_HALF = 240;
/** 歩ける斜面の上限（1マスあたりの高さの差）。これより急な所は崖として止める */
export const WALK_SLOPE = 0.85;
/** 歩いて入れる水の深さの上限（泳ぐ機能はない）。本流は以前から歩いて渡れるので例外（浅瀬扱い） */
export const WADE_DEPTH = 0.55;
export const SEA_LEVEL = 0.32;

type V2 = { x: number; z: number };

/* ---------------- Muse の7エリア（ラウンド18。エリアの配置の正は描画モジュールの DEFAULT_AREAS） ---------------- */
let CFG: GraphicsConfig | null = null;
const AREA_CFG = { world: { areas: DEFAULT_AREAS } } as unknown as GraphicsConfig;
/** その場所のエリアの重み（森林・湖畔・海岸・火山・雪山・砂漠・街。合計1） */
export function areasAt(x: number, z: number): Record<string, number> { return areaWeights(x, z, CFG || AREA_CFG) as unknown as Record<string, number>; }
export function dominantArea(x: number, z: number): string { const w = areasAt(x, z); let b = 'forest', bw = -1; for (const k of Object.keys(w)) if (w[k] > bw) { bw = w[k]; b = k; } return b; }
/** 雪山の凍った池（Muse の氷の板。歩ける）と、火山の火口の溶岩湖（歩けない） */
export const FROZEN_POND = frozenPond(AREA_CFG);
const VOLC = DEFAULT_AREAS.find((a) => a.id === 'volcano')!;
export const LAVA_LAKE = { x: VOLC.x, z: VOLC.z, r: 8.2 };
const LAKESIDE = DEFAULT_AREAS.find((a) => a.id === 'lakeside')!;
/** 湖畔の湖（Muse の地形の湖。水面は海と同じ高さ） */
export const LAKE = { x: LAKESIDE.x, z: LAKESIDE.z, r: 22, level: 0.32 };
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

/* ---------------- 山（北東）：山体と尾根 ---------------- */
export const PEAK = { x: 100, z: -132, h: 40 };
// Muse の雪山エリア（高さ5〜12の土台）の上に足すので、尾根の高さは控えめ（合計で頂が約40）
const RIDGES: Array<{ a: V2; b: V2; ha: number; hb: number }> = [
  { a: PEAK, b: { x: 66, z: -100 }, ha: 28, hb: 9 },        // 南西の尾根（拠点の方へ下る）
  { a: { x: 66, z: -100 }, b: { x: 40, z: -70 }, ha: 9, hb: 2.5 }, // 山麓の長い尾根
  { a: PEAK, b: { x: 148, z: -136 }, ha: 28, hb: 10 },      // 東の尾根
  { a: PEAK, b: { x: 92, z: -190 }, ha: 28, hb: 21 },       // 北の尾根（遠景の山並みへ続く）
  { a: PEAK, b: { x: 120, z: -132 }, ha: 28, hb: 15 },      // 南東の短い尾根
  { a: PEAK, b: { x: 58, z: -150 }, ha: 28, hb: 11 },       // 西の尾根
];
function mountainRaw(x: number, z: number): number {
  if (x < -30 || z > -20) return 0;
  let h = 0;
  for (const r of RIDGES) {
    const s = segInfo(x, z, r.a, r.b), hs = lerp(r.ha, r.hb, s.t), W = 22 + hs * 2.0;
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
/** 山の高さ（Muse の地形に足す分）。凍った池のまわりと本流の谷には足さない */
export function mountainAt(x: number, z: number): number {
  const m = mountainRaw(x, z); if (m <= 0) return 0;
  return m * sm(10, 19, Math.hypot(x - FROZEN_POND.x, z - FROZEN_POND.z)) * sm(12, 24, distanceToRiver(x, z));
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

/* ---------------- 火山（南西。2026-11-11 地形の版4） ----------------
   Muse の火山エリア（ラウンド18、中心 VOLC）の場所に、登って探索できる山を地形の高さで作る（色や飾りだけで表さない）。
   半径で5つの帯に分ける：麓（46〜64：ゆるい裾野）・山腹（30〜46：歩ける斜面）・上部斜面（15〜30：崖。登山道でしか登れない）・
   火口縁（12.5〜15.3：歩ける尾根）・火口（10 より内側：平らな底に溶岩湖。内壁は崖）。
   中心から VOLCANO.R0（70）より外は1マスも変えない（ほかの地域・滝・山の高さの差は0。テストで検査）。
   描画モジュールは config.world.heightAt とビルドの差し替えでこの関数をそのまま使うので、見た目の山と歩く山は同じもの（別の山を重ねて作らない）。 */
export const VOLCANO = { x: VOLC.x, z: VOLC.z, R0: 70, R1: 56, footR: 64, flankR: 46, upperR: 30, rimOutR: 15.4, rimR: 13.8, rimInR: 12.3, floorR: 9.6, floorH: 31, rimH: 40 };
/** 半径の断面（中心からの距離 → 高さ）。単調な3次補間（帯の境目で折れ目を作らない・山の形を行き過ぎない） */
const VKNOT: Array<[number, number]> = [[0, 31], [9.6, 31], [12.3, 39.6], [13.2, 39.95], [14.4, 39.95], [15.4, 39.5], [22, 30.2], [30, 20], [38, 13.4], [46, 7.8], [55, 5.4], [64, 4.2], [72, 3.8]];
const VSLOPE = (() => {
  const n = VKNOT.length, d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((VKNOT[i + 1][1] - VKNOT[i][1]) / (VKNOT[i + 1][0] - VKNOT[i][0]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 0; i < n - 1; i++) {   // Fritsch–Carlson：行き過ぎない（単調な区間で山や谷を作らない）
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
})();
export function volcanoProfile(r: number): number {
  const K = VKNOT; if (r <= K[0][0]) return K[0][1]; if (r >= K[K.length - 1][0]) return K[K.length - 1][1];
  let i = 0; while (r > K[i + 1][0]) i++;
  const h = K[i + 1][0] - K[i][0], t = (r - K[i][0]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * K[i][1] + (t3 - 2 * t2 + t) * h * VSLOPE[i] + (-2 * t3 + 3 * t2) * K[i + 1][1] + (t3 - t2) * h * VSLOPE[i + 1];
}
/** 断面の傾き（登山道の計画に使う） */
function volcanoProfileSlope(r: number): number { return (volcanoProfile(r + 0.25) - volcanoProfile(r - 0.25)) / 0.5; }
/** 拠点の方を向いた側（登山道の入口がある側）の角度 */
export const VOLC_FACE = Math.atan2(20 - VOLC.z, -20 - VOLC.x);
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
/* 古い溶岩の流れ（麓の盛り上がり。黒曜石が見つかる所）：中心からの角度・始まりと終わりの半径・幅・高さ */
const LAVA_FLOWS = [
  { a: VOLC_FACE + 1.75, r0: 24, r1: 60, w: 4.2, h: 1.5 },
  { a: VOLC_FACE - 2.35, r0: 26, r1: 62, w: 5.0, h: 1.7 },
];
/** 火山の高さの目標（帯ごとの断面＋放射状のひだ＋火口縁の高低＋古い溶岩の流れ） */
function volcanoTarget(x: number, z: number): number {
  const dx = x - VOLC.x, dz = z - VOLC.z, r = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
  let h = volcanoProfile(r);
  // 放射状のひだ（雨で刻まれた谷と尾根）。上部斜面と山腹だけ。火口縁と麓の外側は弱く
  const rib = Math.sin(9 * th + 2.1 * Math.sin(3 * th + 1.3) + r * 0.05) * 0.5 + Math.sin(14 * th + 0.7) * 0.25;
  h += rib * 1.25 * sm(15.5, 21, r) * (1 - sm(40, 58, r));
  // 火口縁の高さは一周で少し変わる。登山道が着く側はやや低い（鞍部）
  const crest = 1.3 * Math.sin(2 * th + 0.7) + 0.5 * Math.sin(5 * th + 2.0) - 1.1 * Math.exp(-((angDiff(th, VOLC_FACE) / 0.4) ** 2));
  h += crest * sm(9.6, 11.5, r) * (1 - sm(18, 26, r));
  // 細かい起伏（岩のごつごつ。大きな形は断面で決まっている）
  h += (fbm(x * 0.09 + 17.3, z * 0.09 + 4.1, 3) - 0.5) * 1.1 * sm(10.5, 13, r) * (1 - 0.75 * Math.exp(-(((r - 13.8) / 1.8) ** 2)));   // 火口縁の尾根は歩けるように細かい起伏を弱く
  for (const f of LAVA_FLOWS) {
    const a = { x: VOLC.x + Math.cos(f.a) * f.r0, z: VOLC.z + Math.sin(f.a) * f.r0 }, b = { x: VOLC.x + Math.cos(f.a + 0.18) * f.r1, z: VOLC.z + Math.sin(f.a + 0.18) * f.r1 };
    const s = segInfo(x, z, a, b), w = f.w * (0.8 + 0.4 * s.t);
    if (s.d < w) h += f.h * (1 - sm(0, 1, s.d / w) ** 1.5) * sm(0, 0.15, s.t) * (1 - sm(0.85, 1, s.t));
  }
  return h;
}
/** 版3のセーブの位置が火山の変わった所（中心から R0 の内側）なら、登山道の近い所（歩ける・つながっている）を返す。それ以外は null */
export function volcanoSafeSpot(x: number, z: number): { x: number; z: number } | null {
  if (Math.hypot(x - VOLC.x, z - VOLC.z) >= VOLCANO.R0) return null;
  const n = polyNear(TRAIL_VOLCANO, x, z), p = polyAt(TRAIL_VOLCANO, n.s);
  return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
}
/** 火山の地形を足す（中心から R0 より外はそのまま返す） */
export function volcanoShape(x: number, z: number, h: number): number {
  const r = Math.hypot(x - VOLC.x, z - VOLC.z);
  if (r >= VOLCANO.R0) return h;
  return lerp(h, volcanoTarget(x, z), sm(VOLCANO.R0, VOLCANO.R1, r));
}
/** 火山のどの帯か（地名・採取地点の配置・テストに使う） */
export function volcanoZone(x: number, z: number): 'crater' | 'rim' | 'upper' | 'flank' | 'foot' | null {
  const r = Math.hypot(x - VOLC.x, z - VOLC.z);
  if (r < VOLCANO.rimInR - 0.6) return 'crater';
  if (r < VOLCANO.rimOutR + 0.8) return 'rim';
  if (r < VOLCANO.upperR) return 'upper';
  if (r < VOLCANO.flankR) return 'flank';
  if (r < VOLCANO.footR + 4) return 'foot';
  return null;
}
/** 登山道（麓 → 山腹 → 上部斜面のつづら折り → 火口縁）。断面の傾きから、道の上り坂が一定（約0.24）になる向きを選んで作る。
    道の折り返しは、拠点を向いた側の決まった角度の幅の中だけ（同じ所を何度も横切らない）。起動時に一度だけ、決まった値で計算する */
const VOLC_TURNS: number[] = [];
/** 登山道（麓 → 山腹 → 上部斜面のつづら折り → 火口縁）。断面の傾きから、道の上り坂が一定（約0.24）になる向きを選んで作る。
    折り返しは半径 2.6 の U 字（2本の道が 5 マス以上離れ、間に斜面が残る）で、拠点を向いた側の決まった角度の幅の中だけ。
    起動時に一度だけ、決まった値で計算する（乱数なし） */
export const TRAIL_VOLCANO: Poly = (() => {
  const G = 0.24, RT = 2.6, ds = 0.25, out: Array<[number, number]> = [];
  let r = 66, th = VOLC_FACE + 0.08, dir = 1, k = 0, acc = 0, ht = volcanoProfile(66);
  const push = () => out.push([+(VOLC.x + Math.cos(th) * r).toFixed(2), +(VOLC.z + Math.sin(th) * r).toFixed(2)]);
  /* 道の高さ ht は1マスで G ずつ上がる。足もとの自然の高さとの差（折り返しで内側へ回り込むと道が斜面より低くなる）を、
     次の道で等高線に沿って進みながら取り戻す（内側へ進む量を減らす。外側へは戻らない＝道どうしの間隔が狭まらない） */
  const sinA = (rr: number) => { const g = Math.abs(volcanoProfileSlope(rr)); return clamp((G - 0.2 * (volcanoProfile(rr) - ht)) / Math.max(g, 1e-3), 0, 1); };
  const step = (sa: number, ca: number, d: number) => { r -= sa * ds; th += d * ca * ds / r; ht += G * ds; acc += ds; if (acc >= 1.2) { acc = 0; push(); } };
  push();
  while (r > VOLCANO.rimR + 0.15 && k++ < 12000) {
    if (r <= VOLCANO.rimOutR + 0.4 && volcanoProfile(r) - ht < 1) { step(1, 0, dir); continue; }   // 火口縁の手前：縁へまっすぐ
    const sa = sinA(r), ca = Math.sqrt(1 - sa * sa);
    const half = clamp((r > VOLCANO.upperR ? 34 : 26) / (2 * r), 0.2, 0.8);   // 一本の道の長さ（山腹 34・上部 26 マス）
    // 火口縁のすぐ下（U 字で縁へ突っ込む所）では折り返さず、等高線に沿って回りながら縁へ上る
    if (sa < 0.999 && r - 2 * RT > VOLCANO.rimOutR + 1.5 && dir * angDiff(th, VOLC_FACE) > half) {
      // U 字の折り返し：向きを、今の上り方から反対側の上り方まで、内側（上）を回って変える
      push(); VOLC_TURNS.push(out.length - 1);
      const a0 = Math.asin(sa);
      for (let psi = a0; psi < Math.PI - a0; psi += ds / RT) step(Math.sin(psi), Math.cos(psi), dir);
      dir = -dir; continue;
    }
    step(sa, ca, dir);
  }
  push();
  return poly(out);
})();
/** 登山道の岩棚（U 字の折り返しのいちばん外側の、さらに外の平らな所。休み場と採取地点）：中心・半径・道のり s。
    高さは近い道の高さ（道の幅が広がった所なので、道とのつなぎ目に段差ができない）。採取地点を置いても道をふさがない */
export const VOLC_LEDGES: Array<{ x: number; z: number; r: number; s: number }> = VOLC_TURNS.filter((i0) => Math.hypot(TRAIL_VOLCANO.pts[i0].x - VOLC.x, TRAIL_VOLCANO.pts[i0].z - VOLC.z) > VOLCANO.rimOutR + 2.5).map((i0) => {   // 火口縁の上の折り返しは岩棚にしない（尾根そのものが歩ける）
  const P = TRAIL_VOLCANO, aOf = (q: V2) => angDiff(Math.atan2(q.z - VOLC.z, q.x - VOLC.x), VOLC_FACE);
  const side = Math.sign(aOf(P.pts[i0])) || 1;
  let i = i0; for (let j = i0; j < Math.min(P.pts.length, i0 + 14); j++) if (side * aOf(P.pts[j]) > side * aOf(P.pts[i])) i = j;
  const p = P.pts[i], dx = p.x - VOLC.x, dz = p.z - VOLC.z, rr = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
  const t = { x: -Math.sin(th) * side, z: Math.cos(th) * side }, R = rr > VOLCANO.upperR ? 3.0 : 2.6;
  return { x: +(p.x + t.x * (R + 0.4)).toFixed(2), z: +(p.z + t.z * (R + 0.4)).toFixed(2), r: R, s: P.cum[i] };
});

/* ---------------- 山の川と滝 ----------------
   滝の場所は「流れの向き d」と「横の向き side」の座標（a＝落ち口から下流へ、l＝横）で設計する。
   上の段（山の池から落ち口まで、ゆるく下る）→ 落ち口 → 高さ約7mの崖（滝つぼを馬てい形に囲む）→ 滝つぼ → 谷底（海へ下る）→ 浜。
   谷の両側の岩壁は下流へ行くほど低くなり、浜の手前で消える。 */
export const FALL_DIR = (() => { const L = Math.hypot(0.12, 1); return { x: 0.12 / L, z: 1 / L }; })();   // 南向き（湖畔の湖へ流れ下る）
export const FALL_SIDE = { x: -FALL_DIR.z, z: FALL_DIR.x };
const LIP = { x: 120.5, z: -97 };
export const FALLS_BOX = { x0: LIP.x - 40, x1: LIP.x + 45, z0: LIP.z - 40, z1: LIP.z + 85 };
const at = (a: number, l: number) => ({ x: LIP.x + FALL_DIR.x * a + FALL_SIDE.x * l, z: LIP.z + FALL_DIR.z * a + FALL_SIDE.z * l });
export function fallFrame(x: number, z: number): { a: number; l: number } {
  const dx = x - LIP.x, dz = z - LIP.z;
  return { a: dx * FALL_DIR.x + dz * FALL_DIR.z, l: dx * FALL_SIDE.x + dz * FALL_SIDE.z };
}
/** 滝の落ち口（崖の縁）と滝つぼ */
export const FALL = { lip: LIP, lipLevel: 13.0, pool: at(3.3, 0), poolR: 3.7, poolLevel: 6.0, height: 7.0 };
/** 山の上の池（水源） */
export const TARN = { ...at(-16, 0.5), r: 4.5, level: 19.5 };
/** 上流（池の出口→落ち口）。水面の高さは道のりで線形 */
export const UPSTREAM = poly([[at(-11.8, 0.4).x, at(-11.8, 0.4).z], [at(-8, -0.5).x, at(-8, -0.5).z], [at(-4, 0.4).x, at(-4, 0.4).z], [LIP.x, LIP.z]]);
/** 下流（滝つぼの中→谷底→浜→海） */
export const DOWNSTREAM = poly([[at(4.6, 0).x, at(4.6, 0).z], [at(14, 0.6).x, at(14, 0.6).z], [at(26, -0.8).x, at(26, -0.8).z], [at(40, 0.5).x, at(40, 0.5).z], [at(52, -0.6).x, at(52, -0.6).z], [at(64, 0).x, at(64, 0).z], [at(74, 0.4).x, at(74, 0.4).z]]);
/** 下流の川が湖（水位）に着く道のり */
export const DOWN_SEA_S = 61.5;
const UP_W = 1.55, DOWN_W = 1.7;
export function upstreamLevel(s: number): number { return lerp(TARN.level - 0.05, FALL.lipLevel, clamp(s / UPSTREAM.len, 0, 1)); }
/** 滝つぼの出口：下流の川の道のり POOL_OUT_S までは滝つぼと同じ水面（段差を作らない）。そこから海へ下がる */
export const POOL_OUT_S = 2.4;
export const POOL_OUT_A = 4.6 + POOL_OUT_S;   // 出口の位置（落ち口からの距離 a）
export function downstreamLevel(s: number): number { return Math.max(SEA_LEVEL, lerp(FALL.poolLevel, SEA_LEVEL, clamp((s - POOL_OUT_S) / (DOWN_SEA_S - POOL_OUT_S), 0, 1))); }
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
function lowerSurf(a: number, l: number): number { return LOWER_BENCH - Math.max(0, a - 7.0) * 0.095 + Math.max(0, Math.abs(l) - 2.5) * 0.08; }
/* ---------------- 登山道（往復できる道。傾きを 0.3 以下に抑えて彫る） ---------------- */
/** 山麓（旧世界の北東の端）→ 中腹 → 休み場 → 見晴らし台。くねらせて傾きをゆるくする */
export const TRAIL_MAIN = poly([
  [50, -58], [58, -66], [56, -76], [66, -82], [62, -92], [66, -104], [72, -114], [82, -122], [92, -127], [104, -118],
]);
/** 登山道の中腹（池と同じくらいの高さの分かれ道）→ 山の池 → 上流の岸 → 崖の外側をジグザグに下る → 谷底 → 滝つぼの岸 → 谷底を下る → 浜。
    見晴らし台からは登山道を少し戻って分かれ道から入る（2本の道を違う高さで交差させない） */
const fa = (a: number, l: number): [number, number] => { const p = at(a, l); return [+p.x.toFixed(2), +p.z.toFixed(2)]; };
export const TRAIL_FALLS = poly([
  fa(20, -5.0), fa(22.5, -13.5), fa(15.5, -20.0), fa(4.5, -17.0), fa(9, -13.0), fa(-1.5, -9.0), fa(-4, -4.6), fa(-9, -4.6), fa(-14, -5.6),
]);
/** 谷の道：湖の岸 → 川の西の岸を上る → 滝つぼの岸 */
export const TRAIL_GORGE = poly([fa(72, -4.8), fa(60, -4.6), fa(48, -4.6), fa(36, -4.6), fa(24, -4.8), fa(14, -4.6), fa(5.4, -4.2)]);
/** 休み場（小さな平地）と見晴らし台（道のりの位置と半径） */
export const RESTS: Array<{ trail: 'main' | 'falls'; s: number; r: number; name: string }> = [
  { trail: 'main', s: 34, r: 3.6, name: '山麓の休み場' }, { trail: 'main', s: 70, r: 3.6, name: '中腹の休み場' },
];
export const LOOKOUT = { x: 104, z: -118, r: 7.5 };
export const TRAILS = { main: TRAIL_MAIN, falls: TRAIL_FALLS, gorge: TRAIL_GORGE, volcano: TRAIL_VOLCANO };

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
/** 谷底の川の岸の高さ（落ち口から a の所。川の水面＋0.55、海の近くでは浜の高さ以上） */
function bankAt(a: number): number { const p = at(a, 0); return Math.max(SEA_LEVEL + 0.6, downstreamLevel(polyNear(DOWNSTREAM, p.x, p.z).s) + 0.55); }
function ensureProfiles(): Profile[] {
  if (profiles) return profiles;
  const pre = (x: number, z: number) => outerBeforeTrails(x, z, moduleTerrainHeight(x, z, CFG || AREA_CFG));
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
  // 谷の道：川の岸の高さ（湖の岸から滝つぼの岸まで）。滝の道：谷の道から崖の外側をジグザグに上り、上の段・上流の岸・山の池へ
  const nG = (a: number, l: number) => { const p = at(a, l); return polyNear(TRAIL_GORGE, p.x, p.z).s; };
  const gorge = buildProfile(TRAIL_GORGE, [{ s: 0, h: bankAt(72) }, { s: nG(48, -4.6), h: bankAt(48) }, { s: nG(24, -4.8), h: bankAt(24) },
    { s: nG(14, -4.6), h: bankAt(14) }, { s: TRAIL_GORGE.len, h: Math.max(bankAt(7), lowerSurf(5.4, -4.2) + 0.05) }], pre, true);
  const P = (a: number, l: number) => { const p = at(a, l); return polyNear(TRAIL_FALLS, p.x, p.z).s; };
  const falls = buildProfile(TRAIL_FALLS, [
    { s: 0, h: bankAt(20) },
    { s: P(-1.5, -9.0), h: upperSurf(-1.5, -9.0) },
    { s: P(-4, -4.6), h: upperSurf(-4, -4.6) },
    { s: TRAIL_FALLS.len, h: TARN.level + 0.7 },
  ], pre, true);
  // 火山の登山道：自然の斜面に沿って、上り坂を 0.27 以下に抑えた高さ（道は断面から上り坂約 0.24 で計画してある）
  const volcano = buildProfile(TRAIL_VOLCANO, [], pre);
  profiles = [main, falls, gorge, volcano];
  return profiles;
}

/* ---------------- 外側の地形（旧世界の外）：Muse の7エリアの地形に、山・滝・川・道を足す ---------------- */
function outerShape(x: number, z: number, h0: number): number {
  const m = mountainAt(x, z);
  return m > 0 ? smax(h0, terraceRock(h0 + m, m, x, z), 1.5) : h0;
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
  // 岸の形は円にしない（角度で半径を少し変える）
  const th = Math.atan2(z - FALL.pool.z, x - FALL.pool.x), rr = FALL.poolR * (1 + 0.13 * Math.sin(th * 3 + 1.1) + 0.08 * Math.sin(th * 5 + 2.3));
  if (sd < 0 && dp < rr + 1.4) {
    const bed = FALL.poolLevel - 1.75 * (1 - sm(0, rr + 0.4, dp) ** 1.6) + 0.1;
    site = lerp(site, Math.min(site, bed), sm(rr + 1.4, rr - 0.3, dp) * sm(0, -0.5, sd));
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
  if (x < FALLS_BOX.x0 || x > FALLS_BOX.x1 || z < FALLS_BOX.z0 || z > FALLS_BOX.z1) return h;
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
  let best: { d: number; ph: number; v: boolean } | null = null;
  for (const p of ps) {
    const nr = polyNear(p.trail, x, z, 6);
    if (nr.d >= 5.2) continue;
    if (!best || nr.d < best.d) best = { d: nr.d, ph: profileAt(p, nr.s), v: p.trail === TRAIL_VOLCANO };
  }
  // 火山の登山道は細い踏み分け道（平らな幅 ±1.4、斜面へ 2.9 までにつなぐ）。つづら折りの道と道の間に、もとの斜面を残す
  if (best) {
    let w = best.v ? sm(2.9, 1.4, best.d) : sm(5.4, 2.4, best.d);
    // 火山の岩棚（折り返しの外側）：道の幅が広がった平らな所。高さは近い道の高さなので、道とのつなぎ目に段差ができない
    if (best.v) {
      for (const L of VOLC_LEDGES) { const d = Math.hypot(x - L.x, z - L.z); if (d < L.r + 1.4) w = Math.max(w, sm(L.r + 1.4, L.r, d)); }
      // 火口縁の尾根は削らない（縁の下を通る道の切り通しが、尾根の幅を狭めないように）
      if (best.ph < out) w *= sm(VOLCANO.rimOutR - 0.2, VOLCANO.rimOutR + 0.9, Math.hypot(x - VOLC.x, z - VOLC.z));
    }
    out = lerp(out, best.ph, w);
  }
  // 見晴らし台：平らに
  const dl = Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z);
  if (dl < LOOKOUT.r + 1.6) out = lerp(out, lookoutH, sm(LOOKOUT.r + 1.6, LOOKOUT.r, dl));
  for (const r of RESTS) {
    const P = r.trail === 'main' ? ps[0] : ps[1], c = polyAt(P.trail, r.s), d = Math.hypot(x - c.x, z - c.z);
    if (d < r.r + 3) out = lerp(out, profileAt(P, r.s), sm(r.r + 3, r.r, d));
  }
  return out;
}
function outerBeforeTrails(x: number, z: number, h0: number): number {
  let h = volcanoShape(x, z, outerShape(x, z, h0));
  h = fallsZone(x, z, h);
  h = carveStreams(x, z, h);
  return h;
}
/** 旧世界の外の地形（すべての彫り込みのあと） */
function outerHeight(x: number, z: number, h0: number): number {
  let h = outerBeforeTrails(x, z, h0);
  h = carveTrails(x, z, h);
  // 滝の水まわりは道より優先（道が滝つぼや川を埋めない）
  h = carveStreams(x, z, h, true);
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
  if (!CFG) CFG = cfg;
  const h0 = moduleTerrainHeight(x, z, cfg);
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= OLD_HALF && az <= OLD_HALF) return h0;
  const b = outerWeight(x, z);
  const o = outerHeight(x, z, h0);
  if (b >= 1) return o;
  return lerp(h0, o, b);
}

/* ---------------- 水の種類と深さ（歩けるかの判定と描画に使う） ---------------- */
export type WaterKind = 'sea' | 'lake' | 'oasis' | 'pond' | 'tarn' | 'stream' | 'pool' | 'river' | 'lava' | null;
export interface WaterInfo { kind: WaterKind; level: number; depth: number; }
const outsideOld = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) > OLD_HALF;
/** その場所の水（水面の高さと深さ）。地形の高さ h を渡すと計算を省ける。
   旧世界（±60）の中の、水位より低い乾いた低地は水にしない（以前どおり歩ける地面。Muse の全面の水面はゲームが表示しない） */
export function waterAt(x: number, z: number, h: number): WaterInfo {
  const dR = distanceToRiver(x, z);
  const halfW = 3.9 + Math.sin(z * 0.21) * 0.35;
  if (dR < halfW && h < SEA_LEVEL) return { kind: 'river', level: SEA_LEVEL, depth: SEA_LEVEL - h };
  if (Math.hypot(x - LAVA_LAKE.x, z - LAVA_LAKE.z) < LAVA_LAKE.r + 0.6) return { kind: 'lava', level: h, depth: 99 };
  if (x > FALLS_BOX.x0 && x < FALLS_BOX.x1 && z > FALLS_BOX.z0 && z < FALLS_BOX.z1) {
    const dp = Math.hypot(x - FALL.pool.x, z - FALL.pool.z);
    if (dp < FALL.poolR + 1.2 && h < FALL.poolLevel) return { kind: 'pool', level: FALL.poolLevel, depth: FALL.poolLevel - h };
    const td = Math.hypot(x - TARN.x, z - TARN.z);
    if (td < TARN.r + 1.2 && h < TARN.level) return { kind: 'tarn', level: TARN.level, depth: TARN.level - h };
    const st = streamAt(x, z);
    const past = (st.which === 'up' && st.s > UPSTREAM.len - 0.05 && fallFrame(x, z).a > -0.2) || (st.which === 'down' && st.s < 0.05);
    if (st.which && !past && st.d < (st.which === 'up' ? UP_W : DOWN_W) + 0.4 && h < st.level && st.level > SEA_LEVEL + 0.01) return { kind: 'stream', level: st.level, depth: st.level - h };
  }
  if (outsideOld(x, z) && h < SEA_LEVEL) {
    const a = dominantArea(x, z);
    return { kind: a === 'coast' ? 'sea' : a === 'lakeside' ? 'lake' : a === 'desert' ? 'oasis' : 'pond', level: SEA_LEVEL, depth: SEA_LEVEL - h };
  }
  return { kind: null, level: 0, depth: 0 };
}

/* ---------------- 地名（HUD と地図） ---------------- */
const AREA_NAMES: Record<string, string> = { forest: '森', lakeside: '湖畔', coast: '海岸', volcano: '火山', snow: '雪山', desert: '砂漠', town: '開けた平地' };
export function placeName(x: number, z: number, h: number): string | null {
  if (Math.abs(x) <= 58 && Math.abs(z) <= 58) return null;
  // 滝・池・見晴らし台など、近くの目印を先に
  const ff = fallFrame(x, z);
  if (Math.hypot(x - FALL.pool.x, z - FALL.pool.z) < 10) return '滝つぼ';
  if (ff.a > -24 && ff.a < 0.5 && Math.abs(ff.l) < 9) return Math.hypot(x - TARN.x, z - TARN.z) < 10 ? '山の池' : '滝の上流';
  if (ff.a >= 0.5 && ff.a < 30 && Math.abs(ff.l) < 9) return '滝の谷';
  if (Math.hypot(x - TARN.x, z - TARN.z) < 12) return '山の池';
  if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < 12) return '見晴らし台';
  if (Math.hypot(x - FROZEN_POND.x, z - FROZEN_POND.z) < 12) return '凍った池';
  const vz = volcanoZone(x, z);
  if (vz) return vz === 'crater' ? '火口' : vz === 'rim' ? '火口縁' : vz === 'upper' ? '火山の上部斜面' : vz === 'flank' ? '火山の山腹' : '火山の麓';
  const m = mountainAt(x, z);
  if (m > 2) return h > 22 ? '山の高所' : h > 13 ? '山の中腹' : '山麓';
  const a = dominantArea(x, z);
  if (a === 'coast' && h < 2.5) return '海岸の浜';
  if (Math.max(Math.abs(x), Math.abs(z)) > 180) return '外の野（試験範囲）';
  return AREA_NAMES[a] || '外の野';
}
/** 地形・水の性格（自然物の配置に使う）：0〜1。エリアの重みは Muse の areaWeights */
export function biome(x: number, z: number, h: number) {
  const w = areasAt(x, z), m = mountainAt(x, z);
  const nearWater = h < SEA_LEVEL + 1.6 ? 1 : 0;
  return {
    mountain: clamp(m / 14, 0, 1),
    alpine: sm(17, 25, h) * sm(2, 8, m),
    coast: w.coast,
    beach: clamp(w.coast * 1.4, 0, 1) * sm(2.6, 0.7, h),
    rockyShore: 0,
    lake: w.lakeside * nearWater,
    west: w.forest * (x < -60 ? 1 : 0.6),
    plains: w.desert, northWest: w.volcano,
    forest: w.forest, lakeside: w.lakeside, volcano: w.volcano, snow: w.snow, desert: w.desert, town: w.town,
  };
}
export { riverCenterX, distanceToRiver };
