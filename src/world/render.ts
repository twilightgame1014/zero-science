/* ===================== 広い世界の描画（ゲーム側。2026-11-07） =====================
   描画モジュール（src/graphics）は旧世界 120×120 の地形・川・景観を描く。ここではその外側を、モジュールのシーンに足して描く：
   - 外側の地形：30m の区画。主人公に近い区画ほど細かく（0.714m＝旧世界と同じ間隔）、遠い区画は粗く。区画は少しずつ（1フレーム数ミリ秒）作り、
     離れたら細かい形を捨てて粗い形に戻す（同じ場所を往復しても増え続けない）。粗い形はいつでもあるので、読み込みが遅れても地面は消えない。
     色と質感は旧世界の地形と同じ材質（詳細テクスチャ・GPT の地面の模様）に、砂浜（乾いた砂・濡れた砂）・雪・岩肌（斜面は三方向から貼って伸ばさない）を足す。
   - 水：本流の続き（モジュールの川の材質をそのまま使う）、海（深さで色が変わり、波打ち際の泡は深さ0の線に沿う）、湖・山の池・滝つぼ（静か）、山の川。
   - 滝：川の水面 → 落ち口（水面が崖の縁で下へ曲がる）→ 落ちる水（厚みのある閉じた形）→ 滝つぼ（落下点のまわりに控えめな泡・しぶき・波紋）→ 下流。
     川の水面と落ちる水は1つの形でつながっていて、すき間ができない。
   - モジュールの遠景の山（BackdropMountains）と、旧い滝（Waterfall）は表示しない（広い世界の中に立ってしまう・形が壊れている）。
   地形の高さ・水の高さはすべて src/world/shape.ts（ゲームと同じ関数）。 */
import * as THREE from 'three';
import { fbm, smoothstep as sm, clamp, lerp, distanceToRiver, distanceToPath, riverCenterX } from '../graphics/utils';
import type { GraphicsConfig } from '../graphics/types';
import { GROUND_TEXTURES } from '../graphics/expansionTextures';
import * as WS from './shape';

type Quality = 'high' | 'low';
const CH = 30;                              // 区画の一辺
const NCH = Math.round(WS.DRAW_HALF / CH);   // 片側の区画数（-NCH..NCH-1）
const OLD_C = Math.round(WS.OLD_HALF / CH);  // 旧世界の区画（-OLD_C..OLD_C-1）は作らない（モジュールが描く）

/* ---------------- 地面の色（旧世界の地形と同じ決め方＋外側の地方） ---------------- */
const C = (h: number) => new THREE.Color(h);
const cGrass = C(0x69a34b), cGrassDry = C(0x9db45e), cForestFloor = C(0x4d7d3a), cSand = C(0xd9bd8a), cWetSand = C(0xa8895c),
  cClay = C(0xb0764a), cRock = C(0x8d8d90), cRockDark = C(0x66666c), cPath = C(0xa3804f), cEarth = C(0x7c6a42), cUnderwater = C(0x77683f),
  cBeach = C(0xdcc596), cBeachWet = C(0x9c8459), cSeaBed = C(0xc8b88e), cAlpine = C(0x7f9466), cSnow = C(0xeef3f8), cTrail = C(0xb39d78), cWetRock = C(0x5f6264), cCliff = C(0xa29e95);
const tmp = new THREE.Color(), tmp2 = new THREE.Color();

/** 旧世界（モジュール）の地形の色・模様の重みと同じ計算（境目で色がずれないように） */
function moduleColor(x: number, z: number, h: number, wl: number, out: THREE.Color, sp: number[]): number {
  const n = fbm(x * 0.09 + 31, z * 0.09 + 17, 3);
  const dRiver = distanceToRiver(x, z);
  out.copy(cGrass).lerp(cGrassDry, clamp(n * 1.15 - 0.12, 0, 1));
  const mottle = fbm(x * 0.5 + 7, z * 0.5 + 3, 2);
  out.lerp(cEarth, sm(0.56, 0.82, mottle) * 0.38);
  const forestMask = sm(-2, -26, x + z * 0.25);
  out.lerp(cForestFloor, forestMask * 0.55);
  const bank = sm(6.4, 3.4, dRiver);
  out.lerp(h < 0.55 ? cWetSand : cSand, bank * 0.85);
  const clayMask = sm(0.55, 0.75, fbm(x * 0.05 + 91, z * 0.05 + 55, 3)) * sm(11, 6, dRiver) * sm(-6, 8, z);
  out.lerp(cClay, clayMask * 0.8);
  if (h < wl) { const bedN = fbm(x * 0.35 + 51, z * 0.35 + 23, 2); out.lerp(bedN > 0.55 ? cSand : cWetSand, 0.35); }
  if (h < wl + 0.05) out.lerp(cUnderwater, 0.7);
  const wet = sm(0.34, 0.03, h - wl) * sm(-0.06, 0.04, h - wl);
  if (wet > 0) { out.lerp(cWetSand, wet * 0.45); out.multiplyScalar(1 - wet * 0.16); }
  const pathMask = sm(2.4, 1.1, distanceToPath(x, z)) * sm(0.42, 0.6, h);
  out.lerp(cPath, pathMask * 0.8);
  const rockiness = sm(1.6, 3.6, h) * 0.75 + sm(20, 46, x - z * 0.35) * 0.45;
  out.lerp(n > 0.55 ? cRock : cRockDark, clamp(rockiness, 0, 0.92));
  const strata = 0.9 + 0.1 * Math.sin(h * 6.5 + n * 3.0);
  out.multiplyScalar(lerp(1, strata, clamp(rockiness, 0, 1)));
  const ao = 1 - Math.exp(-((dRiver / 4.2) ** 2)) * 0.22;
  out.multiplyScalar(ao);
  const aboveWater = sm(wl - 0.02, wl + 0.3, h);
  const rockSuppress = 1 - clamp(rockiness, 0, 1) * 0.9;
  sp[0] = clamp(forestMask * 0.95 + sm(0.6, 0.85, mottle) * 0.4, 0, 0.95) * aboveWater * rockSuppress;
  sp[1] = clamp(wet * 1.0 + clayMask * 0.8, 0, 0.95) * rockSuppress;
  sp[2] = clamp(bank * 0.92, 0, 0.95) * aboveWater * rockSuppress;
  sp[3] = clamp(pathMask * 1.1, 0, 0.96) * aboveWater;
  return rockiness;
}
/** 近くの水面の高さ（岸の湿った帯に使う） */
function nearbyLevel(x: number, z: number): number | null {
  if (WS.seaDist(x, z) > -6) return WS.SEA_LEVEL;
  if (x > 100 && x < 165 && z < -60 && z > -112) {
    if (Math.hypot(x - WS.FALL.pool.x, z - WS.FALL.pool.z) < WS.FALL.poolR + 2.5) return WS.FALL.poolLevel;
    if (Math.hypot(x - WS.TARN.x, z - WS.TARN.z) < WS.TARN.r + 2.5) return WS.TARN.level;
    const st = WS.streamAt(x, z); if (st.which && st.d < 3.6) return st.level;
  }
  const dl = Math.hypot(x - WS.LAKE.x, z - WS.LAKE.z); if (dl < WS.LAKE.r * 1.35 + 4) return WS.LAKE.level;
  return null;
}
/** 外側の地面の色。sp＝旧世界と同じ4つの模様、sp2＝濡れた砂・乾いた砂・雪・岩肌（三方向） */
function outerColor(x: number, z: number, h: number, slope: number, wl: number, out: THREE.Color, sp: number[], sp2: number[]): void {
  const bio = WS.biome(x, z, h);
  const n = fbm(x * 0.09 + 31, z * 0.09 + 17, 3);
  out.copy(cGrass).lerp(cGrassDry, clamp(n * 1.15 - 0.12 + bio.plains * 0.25, 0, 1));
  const mottle = fbm(x * 0.5 + 7, z * 0.5 + 3, 2);
  out.lerp(cEarth, sm(0.56, 0.82, mottle) * 0.38);
  // 林床（落ち葉）は西の森と、林のまとまりの所だけ。それ以外は草地のまま
  const forest = clamp(bio.west * 0.75 * sm(0.45, 0.62, fbm(x * 0.03 + 3, z * 0.03 + 8, 3)), 0, 1) * (1 - bio.alpine) * (1 - bio.beach) * (1 - bio.mountain * 0.6);
  out.lerp(cForestFloor, forest * 0.55);
  // 山：高さで草地→高山の草→岩→雪
  out.lerp(cAlpine, sm(12, 22, h) * bio.mountain * 0.7);
  const rock = clamp(sm(0.62, 1.05, slope) * 0.95 + sm(20, 30, h) * bio.mountain * 0.55 + bio.rockyShore * 0.8 + bio.northWest * sm(0.4, 0.8, slope) * 0.6, 0, 0.95);
  out.lerp(n > 0.55 ? cRock : cRockDark, rock);
  out.lerp(cCliff, sm(0.9, 1.6, slope) * 0.55);          // 切り立った岩壁は明るめの岩の色（影の中でも黒くつぶれない）
  const strata = 0.9 + 0.1 * Math.sin(h * 6.5 + n * 3.0);
  out.multiplyScalar(lerp(1, strata, rock));
  const snow = sm(31, 36, h + (fbm(x * 0.07, z * 0.07, 2) - 0.5) * 5) * (1 - sm(0.7, 1.1, slope));
  out.lerp(cSnow, snow);
  // 浜：乾いた砂（陸）→ 濡れた砂（波打ち際）→ 海底
  const sd = WS.seaDist(x, z);
  const dry = bio.beach * sm(WS.SEA_LEVEL + 0.25, WS.SEA_LEVEL + 0.55, h);
  // 濡れた砂の帯は、画面の点ごとに地面の高さから決める（形の細かさに依らず波打ち際に沿う）。ここでは「浜の近く」という広い印だけ
  const wetBand = sm(-14, -2, sd) * (1 - bio.rockyShore * 0.6);
  out.lerp(cBeach, dry * 0.95);
  if (sd > -2 && h < wl) out.lerp(cSeaBed, clamp(0.6 + sd * 0.02, 0, 0.85));
  // 湖・池・川・滝つぼの岸の湿った帯と水の中
  const lv = nearbyLevel(x, z);
  let wet = 0;
  if (lv !== null && sd < -1) {
    wet = sm(0.34, 0.03, h - lv) * sm(-0.06, 0.04, h - lv);
    if (h < lv) out.lerp(cUnderwater, 0.55);
    if (wet > 0) { out.lerp(cWetSand, wet * 0.45); out.multiplyScalar(1 - wet * 0.16); }
  }
  // 本流の岸（旧世界と同じ）
  const dRiver = distanceToRiver(x, z);
  const bank = sm(6.4, 3.4, dRiver);
  if (bank > 0) { out.lerp(h < 0.55 ? cWetSand : cSand, bank * 0.85); if (h < wl + 0.05) out.lerp(cUnderwater, 0.7); }
  // 登山道（踏み固めた土）
  let trail = 0;
  for (const P of Object.values(WS.TRAILS)) { const t = WS.polyNear(P, x, z, 3); trail = Math.max(trail, sm(1.7, 0.7, t.d)); }
  out.lerp(cTrail, trail * 0.6 * (1 - snow));
  // 滝のまわりの濡れた岩
  const dp = Math.hypot(x - WS.FALL.pool.x, z - WS.FALL.pool.z);
  if (dp < 9) out.lerp(cWetRock, sm(9, 3, dp) * rock * 0.6);
  const ao = 1 - Math.exp(-((dRiver / 4.2) ** 2)) * 0.22;
  out.multiplyScalar(ao);
  const above = sm(wl - 0.02, wl + 0.3, h);
  const rockSup = 1 - rock * 0.9;
  sp[0] = clamp(forest * 0.9 + sm(0.62, 0.86, mottle) * 0.3, 0, 0.95) * above * rockSup * (1 - dry) * (1 - snow);
  sp[1] = clamp(wet + 0.0, 0, 0.9) * rockSup;
  sp[2] = clamp(bank * 0.92, 0, 0.95) * above * rockSup;
  sp[3] = clamp(trail * 0.55, 0, 0.6) * above * (1 - snow);
  sp2[0] = clamp(wetBand, 0, 1) * rockSup;
  sp2[1] = clamp(dry * 0.95, 0, 0.95) * rockSup;
  sp2[2] = clamp(snow * 0.95, 0, 0.95);
  sp2[3] = rock;
}

/* ---------------- 地形の材質（旧世界の材質に合わせ、模様を足す） ---------------- */
function makeTerrainMaterial(base: THREE.MeshStandardMaterial, tex: Record<string, THREE.Texture>): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: base.map, color: base.color.clone(), vertexColors: true, roughness: base.roughness, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGroundForest: { value: tex.forest }, uGroundMud: { value: tex.mud }, uGroundSand: { value: tex.sand }, uGroundPath: { value: tex.path },
      uSandWet: { value: tex.sandWet }, uSnow: { value: tex.snow }, uRock: { value: tex.rock }, uSea: { value: WS.SEA_LEVEL },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nattribute vec4 splat2;\nvarying vec4 vSplat;\nvarying vec4 vSplat2;\nvarying vec3 vWPos3;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvSplat2 = splat2;\nvWPos3 = position;\nvWNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', ['#include <common>', 'uniform sampler2D uGroundForest;', 'uniform sampler2D uGroundMud;', 'uniform sampler2D uGroundSand;',
        'uniform sampler2D uGroundPath;', 'uniform sampler2D uSandWet;', 'uniform float uSea;', 'uniform sampler2D uSnow;', 'uniform sampler2D uRock;',
        'varying vec4 vSplat;', 'varying vec4 vSplat2;', 'varying vec3 vWPos3;', 'varying vec3 vWNrm;'].join('\n'))
      .replace('#include <map_fragment>', [
        // 草の細かい模様（旧世界と同じ）は、砂・雪・岩の所では使わない（そこでは各地面の模様を使い、草の模様が伸びたり透けたりしない）
        '#ifdef USE_MAP',
        '  vec4 texelColor = texture2D( map, vMapUv );',
        '  float wetPx = vSplat2.x * (1.0 - smoothstep(uSea + 0.05, uSea + 0.34, vWPos3.y));',
        '  float neutralW = clamp(vSplat2.w * 1.25 + vSplat2.y * 1.4 + wetPx * 1.4 + vSplat2.z * 1.3, 0.0, 1.0);',
        '  diffuseColor.rgb *= mix(texelColor.rgb, vec3(0.36), neutralW);',
        '#endif',
        '{',
        '  vec2 wp = vWPos3.xz;',
        '  float lum = dot(diffuseColor.rgb, vec3(0.3333));',
        '  float tintF = clamp(0.45 + 1.1 * lum, 0.6, 1.25);',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundForest, wp / 7.0).rgb * tintF, vSplat.x * 0.88);',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundMud, wp / 5.0).rgb * tintF, vSplat.y * 0.9);',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundSand, wp / 6.0).rgb * tintF, vSplat.z * 0.92);',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundPath, wp / 5.0).rgb * tintF, vSplat.w * 0.94);',
        // 砂浜：GPT の砂の模様を少し落ち着いた色に（真っ赤なオレンジにしない）。濡れた砂は高さで細い帯に
        '  vec3 sd0 = texture2D(uGroundSand, wp / 7.5 + 0.37).rgb; sd0 = mix(vec3(dot(sd0, vec3(0.3333))), sd0, 0.6) * 1.18;',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, sd0, vSplat2.y);',
        '  vec3 sw0 = texture2D(uSandWet, wp / 6.0).rgb; sw0 = mix(vec3(dot(sw0, vec3(0.3333))), sw0, 0.65) * 1.05;',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, sw0, wetPx * 0.9);',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uSnow, wp / 8.0).rgb * clamp(0.6 + 0.5 * lum, 0.8, 1.15), vSplat2.z * 0.92);',
        // 岩肌：三方向から貼る（急な崖でも模様が縦に伸びない）
        '  vec3 an = abs(normalize(vWNrm)); an = pow(an, vec3(4.0)); an /= (an.x + an.y + an.z);',
        '  vec3 rk = texture2D(uRock, vWPos3.zy / 4.0).rgb * an.x + texture2D(uRock, vWPos3.xz / 4.0).rgb * an.y + texture2D(uRock, vWPos3.xy / 4.0).rgb * an.z;',
        // 岩の模様は平均の明るさ（線形で約0.18）で割って、明るさを変えずに模様だけを足す
        '  diffuseColor.rgb *= mix(vec3(1.0), clamp(rk / 0.185, 0.45, 1.7), vSplat2.w * 0.6);',
        '}',
      ].join('\n'));
  };
  return mat;
}

/* ---------------- 区画（外側の地形・海・湖） ---------------- */
interface Chunk { ci: number; cj: number; lod: number; want: number; mesh?: THREE.Mesh; sea?: THREE.Mesh; lake?: THREE.Mesh; job?: ChunkJob | null; minLod: number; }
interface ChunkJob { lod: number; n: number; i: number; pos: Float32Array; nrm: Float32Array; col: Float32Array; uv: Float32Array; sp: Float32Array; sp2: Float32Array; h: Float32Array; }
const LOD_SEG_HIGH = [42, 21, 10, 4], LOD_SEG_LOW = [30, 15, 8, 4];

export interface WorldView {
  update(dt: number, focus: { x: number; z: number }, camera: THREE.Camera): void;
  status(): Record<string, unknown>;
  setQuality(q: Quality): void;
  prebuild(r?: number): void;
  dispose(): void;
  readonly group: THREE.Group;
}

export function attachWorld(gfx: any, opts: { cfg: GraphicsConfig; quality: Quality; images: { sandWet?: string; snow?: string; rock?: string; particle?: string } }): WorldView {
  const scene: THREE.Scene = gfx.getScene();
  const cfg = opts.cfg, wl = cfg.world.waterLevel;
  let quality: Quality = opts.quality;
  const H = (x: number, z: number) => WS.worldHeight(x, z, cfg);
  const group = new THREE.Group(); group.name = 'WideWorld';
  scene.add(group);

  /* モジュールの物：地形の材質・川の材質・遠景の山・旧い滝 */
  let modTerrain: THREE.Mesh | null = null, modWater: THREE.Mesh | null = null, modBed: THREE.Mesh | null = null;
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.name === 'Terrain' && (o as THREE.Mesh).isMesh) modTerrain = o as THREE.Mesh;
    if (o.name === 'RiverWater') modWater = o as THREE.Mesh;
    if (o.name === 'Riverbed') modBed = o as THREE.Mesh;
    if (o.name === 'BackdropMountains' || o.name === 'Waterfall') { o.visible = false; hidden.push(o); }
  });
  const loader = new THREE.TextureLoader();
  const loadTex = (url: string | undefined, rep = true) => { if (!url) return undefined; const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const tex: Record<string, THREE.Texture> = {
    forest: loadTex(GROUND_TEXTURES.forest)!, mud: loadTex(GROUND_TEXTURES.mud)!, sand: loadTex(GROUND_TEXTURES.sand)!, path: loadTex(GROUND_TEXTURES.path)!,
    sandWet: loadTex(opts.images.sandWet) || loadTex(GROUND_TEXTURES.sand)!, snow: loadTex(opts.images.snow) || loadTex(GROUND_TEXTURES.sand)!,
    rock: loadTex(opts.images.rock) || loadTex(GROUND_TEXTURES.path)!,
  };
  const baseMat = (modTerrain && (modTerrain as THREE.Mesh).material) as THREE.MeshStandardMaterial | null;
  const terrainMat = makeTerrainMaterial(baseMat || new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 }), tex);

  /* ---------- 区画を作る（少しずつ） ---------- */
  const chunks = new Map<string, Chunk>();
  const key = (i: number, j: number) => i + ',' + j;
  const isOld = (i: number, j: number) => i >= -OLD_C && i < OLD_C && j >= -OLD_C && j < OLD_C;
  const fallsChunk = (i: number, j: number) => {
    const x0 = i * CH, z0 = j * CH; const px = WS.FALL.pool.x, pz = WS.FALL.pool.z;
    return px > x0 - 26 && px < x0 + CH + 26 && pz > z0 - 26 && pz < z0 + CH + 26;
  };
  for (let i = -NCH; i < NCH; i++) for (let j = -NCH; j < NCH; j++) if (!isOld(i, j)) chunks.set(key(i, j), { ci: i, cj: j, lod: -1, want: 3, minLod: 3, job: null });
  const segs = () => (quality === 'high' ? LOD_SEG_HIGH : LOD_SEG_LOW);

  function startJob(c: Chunk, lod: number): ChunkJob {
    const n = segs()[lod], V = (n + 1) * (n + 1);
    return { lod, n, i: 0, pos: new Float32Array(V * 3), nrm: new Float32Array(V * 3), col: new Float32Array(V * 3), uv: new Float32Array(V * 2), sp: new Float32Array(V * 4), sp2: new Float32Array(V * 4), h: new Float32Array(V) };
  }
  const spA = [0, 0, 0, 0], spB = [0, 0, 0, 0], spM = [0, 0, 0, 0], colM = new THREE.Color();
  /** 区画の頂点を budget ミリ秒だけ計算する。終われば true */
  function stepJob(c: Chunk, job: ChunkJob, until: number): boolean {
    const n = job.n, step = CH / n, x0 = c.ci * CH, z0 = c.cj * CH;
    while (job.i < (n + 1) * (n + 1)) {
      const k = job.i, ix = k % (n + 1), iz = Math.floor(k / (n + 1));
      const x = x0 + ix * step, z = z0 + iz * step;
      const h = H(x, z);
      const e = Math.min(step, 0.7);
      const hx = (H(x + e, z) - H(x - e, z)) / (2 * e), hz = (H(x, z + e) - H(x, z - e)) / (2 * e);
      const nl = Math.hypot(hx, 1, hz);
      job.pos[k * 3] = x; job.pos[k * 3 + 1] = h; job.pos[k * 3 + 2] = z; job.h[k] = h;
      job.nrm[k * 3] = -hx / nl; job.nrm[k * 3 + 1] = 1 / nl; job.nrm[k * 3 + 2] = -hz / nl;
      job.uv[k * 2] = (x + 60) / 120; job.uv[k * 2 + 1] = (60 - z) / 120;
      const b = WS.outerWeight(x, z), slope = Math.max(Math.abs(hx), Math.abs(hz));
      spA[0] = spA[1] = spA[2] = spA[3] = 0; spB[0] = spB[1] = spB[2] = spB[3] = 0;
      if (b < 1) moduleColor(x, z, h, wl, colM, spM);
      if (b > 0) outerColor(x, z, h, slope, wl, tmp, spA, spB);
      if (b <= 0) { tmp.copy(colM); for (let q = 0; q < 4; q++) { spA[q] = spM[q]; spB[q] = 0; } }
      else if (b < 1) { tmp.lerp(colM, 1 - b); for (let q = 0; q < 4; q++) { spA[q] = lerp(spM[q], spA[q], b); spB[q] *= b; } }
      job.col[k * 3] = tmp.r; job.col[k * 3 + 1] = tmp.g; job.col[k * 3 + 2] = tmp.b;
      for (let q = 0; q < 4; q++) { job.sp[k * 4 + q] = spA[q]; job.sp2[k * 4 + q] = spB[q]; }
      job.i++;
      if ((job.i & 31) === 0 && performance.now() > until) return false;
    }
    return true;
  }
  /** 計算の済んだ区画から形を作る（縁には下向きのすそを付けて、細かさの違う区画との境のすき間を隠す） */
  function finishJob(c: Chunk, job: ChunkJob): void {
    const n = job.n, V = (n + 1) * (n + 1), edge = 4 * n, skirt = 1.6;
    const T = V + edge;
    const pos = new Float32Array(T * 3), nrm = new Float32Array(T * 3), col = new Float32Array(T * 3), uv = new Float32Array(T * 2), sp = new Float32Array(T * 4), sp2 = new Float32Array(T * 4);
    pos.set(job.pos); nrm.set(job.nrm); col.set(job.col); uv.set(job.uv); sp.set(job.sp); sp2.set(job.sp2);
    const idx: number[] = [];
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const a = iz * (n + 1) + ix, b = a + 1, d = a + (n + 1), e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    // すそ：外周を一周する頂点を複製して下げる
    const ring: number[] = [];
    for (let ix = 0; ix < n; ix++) ring.push(ix);
    for (let iz = 0; iz < n; iz++) ring.push(iz * (n + 1) + n);
    for (let ix = n; ix > 0; ix--) ring.push(n * (n + 1) + ix);
    for (let iz = n; iz > 0; iz--) ring.push(iz * (n + 1));
    ring.forEach((src, r) => {
      const t = V + r;
      pos[t * 3] = pos[src * 3]; pos[t * 3 + 1] = pos[src * 3 + 1] - skirt; pos[t * 3 + 2] = pos[src * 3 + 2];
      for (let q = 0; q < 3; q++) { nrm[t * 3 + q] = nrm[src * 3 + q]; col[t * 3 + q] = col[src * 3 + q] * 0.8; }
      uv[t * 2] = uv[src * 2]; uv[t * 2 + 1] = uv[src * 2 + 1];
      for (let q = 0; q < 4; q++) { sp[t * 4 + q] = sp[src * 4 + q]; sp2[t * 4 + q] = sp2[src * 4 + q]; }
    });
    for (let r = 0; r < ring.length; r++) {
      const a = ring[r], b = ring[(r + 1) % ring.length], a2 = V + r, b2 = V + (r + 1) % ring.length;
      idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);   // 両向き（区画の内外どちらから見ても）
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('splat', new THREE.BufferAttribute(sp, 4));
    geo.setAttribute('splat2', new THREE.BufferAttribute(sp2, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    if (!c.mesh) { c.mesh = new THREE.Mesh(geo, terrainMat); c.mesh.receiveShadow = true; c.mesh.name = 'WorldChunk'; c.mesh.matrixAutoUpdate = false; group.add(c.mesh); }
    else { c.mesh.geometry.dispose(); c.mesh.geometry = geo; }
    buildChunkWater(c, job);
    c.lod = job.lod;
  }

  /* ---------- 水の材質（海・湖・池・山の川） ---------- */
  const waterUniformsCommon = { uTime: { value: 0 } };
  function waterMaterial(kind: 'sea' | 'calm' | 'stream' | 'pool'): THREE.ShaderMaterial {
    const P = {
      sea: { shallow: 0x7fd8cf, deep: 0x1f6a90, sa: 0.32, da: 0.95, dd: 3.0, rip: 0.06, swellAmp: 1, foamD: 0.16, line: 1 },
      calm: { shallow: 0x8fd2c6, deep: 0x2f7d99, sa: 0.16, da: 0.88, dd: 1.6, rip: 0.05, swellAmp: 0, foamD: 0.07, line: 1 },
      stream: { shallow: 0x9adbd0, deep: 0x3b8ca3, sa: 0.22, da: 0.82, dd: 0.6, rip: 0.12, swellAmp: 0, foamD: 0.1, line: 0 },
      pool: { shallow: 0x8fd0c8, deep: 0x2a7290, sa: 0.12, da: 0.9, dd: 1.3, rip: 0.06, swellAmp: 0, foamD: 0.05, line: 0 },
    }[kind];
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uShallow: { value: new THREE.Color(P.shallow) }, uDeep: { value: new THREE.Color(P.deep) }, uSA: { value: P.sa }, uDA: { value: P.da }, uDD: { value: P.dd },
        uRip: { value: P.rip }, uSwell: { value: P.swellAmp }, uFoamD: { value: P.foamD }, uLine: { value: P.line }, uWade: { value: WS.WADE_DEPTH },
        uImpact: { value: new THREE.Vector3(WS.FALL.pool.x, 0, WS.FALL.pool.z) }, uImpactOn: { value: kind === 'pool' ? 1 : 0 },
      }]) as any,
      vertexShader: /* glsl */ `
        attribute float aDepth; attribute vec2 aFlow; attribute float aFade;
        uniform float uTime; uniform float uSwell;
        varying float vDepth; varying vec2 vFlow; varying vec3 vWorld; varying float vFade;
        #include <fog_pars_vertex>
        void main() {
          vDepth = aDepth; vFlow = aFlow; vFade = aFade;
          vec3 p = position;
          // 海のうねり：沖ほど大きく、岸（浅い所）では小さく。岸に向かって進む
          if (uSwell > 0.0) {
            float k = dot(p.xz, aFlow);
            p.y += uSwell * (0.012 + 0.05 * smoothstep(0.3, 3.0, aDepth)) * sin(k * 0.55 - uTime * 1.25);
          }
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform float uSA; uniform float uDA; uniform float uDD;
        uniform float uRip; uniform float uSwell; uniform float uFoamD; uniform float uLine; uniform float uWade;
        uniform vec3 uImpact; uniform float uImpactOn;
        varying float vDepth; varying vec2 vFlow; varying vec3 vWorld; varying float vFade;
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float dk = smoothstep(0.0, uDD, vDepth);
          vec3 col = mix(uShallow, uDeep, dk);
          float alpha = mix(uSA, uDA, dk);
          vec2 fl = length(vFlow) > 0.01 ? normalize(vFlow) : vec2(0.0, 1.0);
          vec2 pr = vec2(-fl.y, fl.x);
          vec2 fs = vec2(dot(vWorld.xz, pr), dot(vWorld.xz, fl));
          float t = uTime;
          // さざ波（流れの向きへ進む）
          float r1 = noise(vec2(fs.x * 1.6, (fs.y - t * (uSwell > 0.0 ? 0.25 : 0.7)) * 3.2));
          float r2 = noise(vec2(fs.x * 3.1 + 7.0, (fs.y - t * 1.1) * 5.0));
          float rip = smoothstep(0.62, 0.9, r1 * 0.6 + r2 * 0.4);
          col = mix(col, mix(uShallow, vec3(1.0), 0.3), rip * uRip * 2.2);
          // 海のうねりの明るい帯
          if (uSwell > 0.0) {
            float crest = sin(dot(vWorld.xz, fl) * 0.55 - t * 1.25);
            col = mix(col, mix(uShallow, vec3(1.0), 0.25), smoothstep(0.75, 1.0, crest) * 0.18 * smoothstep(0.2, 2.0, vDepth));
          }
          // 落ちる水の当たる所の波紋（滝つぼ）
          if (uImpactOn > 0.5) {
            float d = length(vWorld.xz - uImpact.xz);
            float ring = sin(d * 6.0 - t * 4.0) * 0.5 + 0.5;
            float m = smoothstep(3.2, 0.6, d);
            col = mix(col, mix(uShallow, vec3(1.0), 0.35), ring * m * 0.25);
            // 落ちる水が当たる所の泡（落下点のまわりだけ。滝の下端と水面の境目を自然にする）
            float fz = smoothstep(2.1, 0.5, d) * smoothstep(0.35, 0.7, noise(vWorld.xz * 2.4 + vec2(t * 0.6, -t * 0.4)) * 0.7 + noise(vWorld.xz * 5.0 - t) * 0.3);
            col = mix(col, vec3(0.93, 0.97, 0.98), fz * 0.8);
            alpha = max(alpha, fz * 0.85);
          }
          // 歩ける浅瀬と深い所の境目（細い明るい線と、その先の色の変化）
          float edge = 1.0 - smoothstep(0.0, 0.07, abs(vDepth - uWade));
          col = mix(col, mix(uShallow, vec3(1.0), 0.4), edge * 0.35 * uLine);
          // 波打ち際の泡：深さ0の線に沿って、寄せては返す
          float wash = uSwell > 0.0 ? (0.5 + 0.5 * sin(t * 0.9 + fs.x * 0.15)) : 0.5;
          float fd = uFoamD * (0.7 + 0.8 * wash);
          float band = smoothstep(fd, fd * 0.25, vDepth);
          float fn = noise(fs * vec2(2.2, 4.0) + vec2(0.0, -t * 0.4)) * 0.6 + noise(fs * 6.0 + 3.1) * 0.4;
          float foam = band * smoothstep(0.42, 0.75, fn);
          col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.85);
          alpha = clamp(alpha + foam * 0.45, 0.0, 1.0);
          alpha *= smoothstep(0.0, 0.05, vDepth) * (0.25 + 0.75 * smoothstep(0.0, 0.12, vDepth));
          alpha *= vFade;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
  }
  const matSea = waterMaterial('sea'), matLake = waterMaterial('calm'), matStream = waterMaterial('stream'), matPool = waterMaterial('pool'), matTarn = waterMaterial('calm');
  for (const m of [matSea, matLake, matStream, matPool, matTarn]) m.uniforms.uTime = waterUniformsCommon.uTime;

  /* ---------- 区画の中の海・湖 ---------- */
  function buildChunkWater(c: Chunk, job: ChunkJob): void {
    const n = job.n, step = CH / n, x0 = c.ci * CH, z0 = c.cj * CH;
    for (const kind of ['sea', 'lake'] as const) {
      const level = kind === 'sea' ? WS.SEA_LEVEL : WS.LAKE.level;
      const near = (x: number, z: number) => kind === 'sea' ? WS.seaDist(x, z) > -7 : Math.hypot(x - WS.LAKE.x, z - WS.LAKE.z) < WS.LAKE.r * 1.35 + 3;
      const wetV = new Uint8Array((n + 1) * (n + 1));
      let any = false;
      for (let k = 0; k < wetV.length; k++) { const x = job.pos[k * 3], z = job.pos[k * 3 + 2]; if (near(x, z) && job.h[k] < level + 1.2) { wetV[k] = 1; any = true; } }
      const old = kind === 'sea' ? c.sea : c.lake;
      if (old) { group.remove(old); old.geometry.dispose(); }
      if (kind === 'sea') c.sea = undefined; else c.lake = undefined;
      if (!any) continue;
      const pos = new Float32Array(wetV.length * 3), dep = new Float32Array(wetV.length), flow = new Float32Array(wetV.length * 2), fade = new Float32Array(wetV.length).fill(1);
      for (let k = 0; k < wetV.length; k++) {
        const x = job.pos[k * 3], z = job.pos[k * 3 + 2];
        pos[k * 3] = x; pos[k * 3 + 1] = level; pos[k * 3 + 2] = z;
        dep[k] = Math.max(0, level - job.h[k]);
        if (kind === 'sea') {   // 岸へ向かう向き（海までの距離が減る向き）
          const gx = WS.seaDist(x + 1, z) - WS.seaDist(x - 1, z), gz = WS.seaDist(x, z + 1) - WS.seaDist(x, z - 1), L = Math.hypot(gx, gz) || 1;
          flow[k * 2] = -gx / L; flow[k * 2 + 1] = -gz / L;
          // 本流の河口：川の水面（モジュールの材質）と重なる所は海を薄く
          const dR = distanceToRiver(x, z); if (dR < 6 && WS.seaDist(x, z) < 2) fade[k] = sm(-1, 2, WS.seaDist(x, z));
        } else { flow[k * 2] = 0.6; flow[k * 2 + 1] = 0.8; }
      }
      const idx: number[] = [];
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const a = iz * (n + 1) + ix, b = a + 1, d = a + (n + 1), e = d + 1;
        if (wetV[a] || wetV[b] || wetV[d] || wetV[e]) idx.push(a, d, b, b, d, e);
      }
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
      geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2));
      geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
      geo.setIndex(idx); geo.computeBoundingSphere();
      geo.boundingSphere!.radius += 0.2;
      const m = new THREE.Mesh(geo, kind === 'sea' ? matSea : matLake);
      m.renderOrder = 2; m.name = kind === 'sea' ? 'Sea' : 'Lake'; m.matrixAutoUpdate = false;
      group.add(m);
      if (kind === 'sea') c.sea = m; else c.lake = m;
      void step;
    }
  }
  /* 沖（描く範囲の外）の海：大きな平面（深さは一定） */
  {
    const quads: Array<[number, number, number, number]> = [[WS.DRAW_HALF, -900, 900, 900], [-900, WS.DRAW_HALF, WS.DRAW_HALF, 900]];
    for (const [x0, z0, x1, z1] of quads) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, WS.SEA_LEVEL - 0.01, (z0 + z1) / 2);
      const nV = g.attributes.position.count;
      g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(nV).fill(6), 1));
      g.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(nV * 2).map((_, i) => (i % 2 ? 0 : -1)), 2));
      g.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(nV).fill(1), 1));
      const m = new THREE.Mesh(g, matSea); m.renderOrder = 2; m.name = 'FarSea'; group.add(m);
    }
  }

  /* ---------- 本流の続き（モジュールの川と同じ材質・同じ作り方） ---------- */
  const riverParts: THREE.Mesh[] = [];
  function riverRibbon(z0: number, z1: number) {
    if (!modWater) return;
    const steps = Math.max(2, Math.round(Math.abs(z1 - z0) / 0.75)), across = 8;
    const positions: number[] = [], depths: number[] = [], flows: number[] = [], indices: number[] = [];
    const bedPos: number[] = [], bedUv: number[] = [], bedIdx: number[] = [];
    let rows = 0;
    for (let i = 0; i <= steps; i++) {
      const z = z0 + (i / steps) * (z1 - z0);
      const cx = riverCenterX(z);
      if (WS.seaDist(cx, z) > 1.5) break;              // 河口で海へ
      const halfW = 3.9 + Math.sin(z * 0.21) * 0.35;
      const slope = (riverCenterX(z + 1.5) - riverCenterX(z - 1.5)) / 3, inv = 1 / Math.hypot(slope, 1);
      for (let j = 0; j <= across; j++) {
        const x = cx + ((j / across) * 2 - 1) * halfW;
        positions.push(x, wl, z); depths.push(clamp(wl - H(x, z), 0, 2.2)); flows.push(slope * inv, inv);
      }
      for (let j = 0; j <= 10; j++) { const t = j / 10, x = cx + (t * 2 - 1) * 4.3, bed = H(x, z);
        bedPos.push(x, bed <= wl + 0.02 ? bed + 0.03 : wl - 0.45, z); bedUv.push(t * 1.6, (z + 60) / 5.4); }
      rows++;
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < across; j++) { const a = i * (across + 1) + j, b = a + across + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < 10; j++) { const a = i * 11 + j, b = a + 11; bedIdx.push(a, b, a + 1, a + 1, b, b + 1); }
    const flip = z1 < z0;   // 北へ作るときは向きを合わせる（上向きの面）
    if (flip) { for (let k = 0; k < indices.length; k += 3) { const t = indices[k + 1]; indices[k + 1] = indices[k + 2]; indices[k + 2] = t; } for (let k = 0; k < bedIdx.length; k += 3) { const t = bedIdx[k + 1]; bedIdx[k + 1] = bedIdx[k + 2]; bedIdx[k + 2] = t; } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
    g.setIndex(indices); g.computeBoundingSphere();
    const w = new THREE.Mesh(g, (modWater as THREE.Mesh).material); w.renderOrder = 2; w.name = 'RiverWaterExt'; group.add(w); riverParts.push(w);
    if (modBed) {
      const gb = new THREE.BufferGeometry();
      gb.setAttribute('position', new THREE.Float32BufferAttribute(bedPos, 3)); gb.setAttribute('uv', new THREE.Float32BufferAttribute(bedUv, 2));
      gb.setIndex(bedIdx); gb.computeVertexNormals(); gb.computeBoundingSphere();
      const b = new THREE.Mesh(gb, (modBed as THREE.Mesh).material); b.renderOrder = 1; b.receiveShadow = true; b.name = 'RiverbedExt'; group.add(b); riverParts.push(b);
    }
  }
  riverRibbon(WS.OLD_HALF, WS.DRAW_HALF);
  riverRibbon(-WS.OLD_HALF, -WS.DRAW_HALF);

  /* ---------- 山の池・滝つぼ（小さな面。0.33m の格子） ---------- */
  function basin(name: string, cx: number, cz: number, R: number, level: number, mat: THREE.ShaderMaterial, keep: (x: number, z: number) => boolean, fadeAt?: (x: number, z: number) => number) {
    const g = 0.33, n = Math.ceil((2 * R) / g);
    const pos: number[] = [], dep: number[] = [], flow: number[] = [], fade: number[] = [], idx: number[] = [], map = new Int32Array((n + 1) * (n + 1)).fill(-1);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = cx - R + i * g, z = cz - R + j * g;
      if (Math.hypot(x - cx, z - cz) > R || !keep(x, z)) continue;
      map[j * (n + 1) + i] = pos.length / 3;
      pos.push(x, level, z); dep.push(Math.max(0, level - H(x, z))); flow.push(0, 1); fade.push((1 - sm(R - 1.3, R - 0.05, Math.hypot(x - cx, z - cz))) * (fadeAt ? fadeAt(x, z) : 1));   // 縁は少しずつ消す（出口の川と重なる所に硬い端を作らない）
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = map[j * (n + 1) + i], b = map[j * (n + 1) + i + 1], d = map[(j + 1) * (n + 1) + i], e = map[(j + 1) * (n + 1) + i + 1];
      if (a >= 0 && b >= 0 && d >= 0 && e >= 0) idx.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2)); geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    geo.setIndex(idx); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; m.name = name; group.add(m); return m;
  }
  const cliffSide = (x: number, z: number) => WS.cliffSigned(x, z);
  basin('Tarn', WS.TARN.x, WS.TARN.z, WS.TARN.r + 1.6, WS.TARN.level, matTarn, () => true);
  // 滝つぼ：崖の下の側だけ。下流側は出口（POOL_OUT_A）で川へ引き継ぐ（そこで少しずつ消え、川が同じ高さで続く）
  basin('PlungePool', WS.FALL.pool.x, WS.FALL.pool.z, WS.FALL.poolR + 1.9, WS.FALL.poolLevel, matPool,
    (x, z) => cliffSide(x, z) < 0.25 && WS.fallFrame(x, z).a < WS.POOL_OUT_A + 0.35,
    (x, z) => 1 - sm(WS.POOL_OUT_A - 0.35, WS.POOL_OUT_A + 0.3, WS.fallFrame(x, z).a));

  /* ---------- 山の川（上流・下流）と滝：1つの続いた形 ---------- */
  function streamRibbon(P: WS.Poly, levelAt: (s: number) => number, W: number, s0: number, s1: number, fadeIn: number, fadeOut: number, name: string, endSea: boolean) {
    const ds = 0.4, rows = Math.max(2, Math.ceil((s1 - s0) / ds)), across = 6;
    const pos: number[] = [], dep: number[] = [], flow: number[] = [], fade: number[] = [], idx: number[] = [];
    for (let i = 0; i <= rows; i++) {
      const s = s0 + (i / rows) * (s1 - s0), c = WS.polyAt(P, s), lv = levelAt(s);
      // 曲がり角で向きをなめらかに（前後の点の差）
      const a = WS.polyAt(P, s - 0.8), b = WS.polyAt(P, s + 0.8); let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      for (let j = 0; j <= across; j++) {
        const u = (j / across) * 2 - 1, x = c.x - dz * u * W, z = c.z + dx * u * W;
        pos.push(x, lv, z); dep.push(Math.max(0, lv - H(x, z))); flow.push(dx, dz);
        let f = sm(s0, s0 + fadeIn, s) * (1 - sm(s1 - fadeOut, s1, s));
        if (endSea) f *= 1 - sm(-3, 1, WS.seaDist(x, z));
        fade.push(fadeIn <= 0 && fadeOut <= 0 && !endSea ? 1 : f);
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < across; j++) { const a = i * (across + 1) + j, b = a + across + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2)); geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    geo.setIndex(idx); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, matStream); m.renderOrder = 2; m.name = name; group.add(m); return m;
  }
  let fallMat: THREE.ShaderMaterial, sprayPts: THREE.Points, sprayVel: Float32Array, sprayLife: Float32Array;
  const IMPACT = { x: 0, y: 0, z: 0 };
  function buildStreamsAndFall() {
    const up = WS.UPSTREAM, dn = WS.DOWNSTREAM;
    // 上流：池の出口から、落ち口の 3.2m 手前まで（そこから先は滝の形が水面を引き継ぐ）
    const sJoin = up.len - 1.0;
    streamRibbon(up, WS.upstreamLevel, 1.95, 0, up.len, 1.6, 0.6, 'StreamUp', false);
    // 下流：滝つぼの中から海まで（滝つぼ・海と重なる所は薄く）
    streamRibbon(dn, WS.downstreamLevel, 2.1, WS.POOL_OUT_S - 0.65, dn.len, 0.65, 0, 'StreamDown', true);

    /* 滝の形：断面（流れの横方向 u）×道のり（v）で掃いた閉じた薄い形。
       上流の水面（sJoin）→ 落ち口の丸み → 放物線で落ちる → 滝つぼの水面の下 0.4m まで */
    const lip = WS.FALL.lip, dir = WS.FALL_DIR, side = WS.FALL_SIDE;
    const lipLv = WS.FALL.lipLevel, poolLv = WS.FALL.poolLevel;
    type Pt = { x: number; y: number; z: number; tx: number; ty: number; tz: number; w: number; th: number; fall: number };
    const path: Pt[] = [];
    // 1) 上流の水面（川の向きに沿う）
    for (let s = sJoin; s < up.len - 0.05; s += 0.25) {
      const c = WS.polyAt(up, s);
      path.push({ x: c.x, y: WS.upstreamLevel(s) + 0.005, z: c.z, tx: dir.x, ty: 0, tz: dir.z, w: 1.6, th: 0.0, fall: 0 });
    }
    // 2) 落ち口から放物線（水平の速さ v0、重力 g）。崖の面から離れて落ちる
    const v0 = 1.7, g = 9.8, drop = lipLv - poolLv + 0.4, T = Math.sqrt((2 * drop) / g);
    const nFall = 34;
    for (let i = 0; i <= nFall; i++) {
      const t = (i / nFall) ** 1.15 * T, hx = v0 * t, hy = 0.5 * g * t * t;
      const vx = v0, vy = g * t, vl = Math.hypot(vx, vy);
      path.push({ x: lip.x + dir.x * hx, y: lipLv - hy, z: lip.z + dir.z * hx, tx: dir.x * vx / vl, ty: -vy / vl, tz: dir.z * vx / vl,
        w: (1.6 + 0.55 * (i / nFall)) * (1 + 0.05 * Math.sin(i * 0.9) * sm(0, 0.3, i / nFall)), th: 0.05 + 0.32 * sm(0, 0.35, i / nFall), fall: sm(0, 0.12, i / nFall) });
    }
    const last = path[path.length - 1];
    IMPACT.x = last.x; IMPACT.y = poolLv; IMPACT.z = last.z;
    matPool.uniforms.uImpact.value.set(IMPACT.x, 0, IMPACT.z);
    // 断面：前の面（上・外）と後ろの面（下・崖側）と左右の縁で、閉じた形
    const across = 10;
    const pos: number[] = [], uvs: number[] = [], fallA: number[] = [], nrm: number[] = [], idx: number[] = [];
    let vAcc = 0; const vRow: number[] = [];
    for (let r = 0; r < path.length; r++) { if (r) vAcc += Math.hypot(path[r].x - path[r - 1].x, path[r].y - path[r - 1].y, path[r].z - path[r - 1].z); vRow.push(vAcc); }
    const ringN = across * 2 + 2;   // 前の面 across+1、後ろの面 across+1（縁でつながる）
    for (let r = 0; r < path.length; r++) {
      const p = path[r];
      // 断面の「外向き」：流れの向きと横方向の外積（水平の所では上、落ちる所では崖と反対側）
      const nx = p.ty * side.z - p.tz * 0, ny = p.tz * side.x - p.tx * side.z, nz = p.tx * 0 - p.ty * side.x;
      let ox = nx, oy = ny, oz = nz; const oL = Math.hypot(ox, oy, oz) || 1; ox /= oL; oy /= oL; oz /= oL;
      if (oy < 0 && p.fall < 0.5) { ox = -ox; oy = -oy; oz = -oz; }
      // 水平の部分は外向き＝上。落ちる部分は外向き＝崖から離れる向き
      if (p.fall >= 0.5 && (ox * dir.x + oz * dir.z) < 0) { ox = -ox; oy = -oy; oz = -oz; }
      for (let face = 0; face < 2; face++) {
        for (let j = 0; j <= across; j++) {
          const u = (j / across) * 2 - 1;
          // 縁は丸く細く（長方形の端が見えないように）
          const edgeK = Math.sqrt(Math.max(0, 1 - u * u * 0.85));
          const off = (face === 0 ? 0.5 : -0.5) * p.th * edgeK;
          // 落ちる水は真ん中が少しふくらむ（平らな板にしない）
          const wob = p.fall > 0.5 ? Math.sin(r * 0.9 + u * 3.0) * 0.04 + 0.16 * (1 - u * u) * p.fall : 0;
          const x = p.x + side.x * u * p.w + ox * (off + wob), y = p.y + oy * (off + wob) + (p.fall < 0.5 ? 0.0 : 0), z = p.z + side.z * u * p.w + oz * (off + wob);
          pos.push(x, y, z); uvs.push(j / across, vRow[r]); fallA.push(p.fall);
          const s = face === 0 ? 1 : -1; nrm.push(ox * s, oy * s, oz * s);
        }
      }
    }
    const rowN = (across + 1) * 2;
    for (let r = 0; r < path.length - 1; r++) {
      const A = r * rowN, B = (r + 1) * rowN;
      for (let j = 0; j < across; j++) {
        // 前の面（外向き：水平の所は上、落ちる所は崖と反対側）
        idx.push(A + j, A + j + 1, B + j, A + j + 1, B + j + 1, B + j);
        // 後ろの面（反対の巻き）
        const a2 = A + across + 1 + j, b2 = B + across + 1 + j;
        idx.push(a2, b2, a2 + 1, a2 + 1, b2, b2 + 1);
      }
      // 左右の縁（前と後ろの面をつなぐ）
      const fl = A, bl = A + across + 1, fl2 = B, bl2 = B + across + 1;
      idx.push(fl, fl2, bl, bl, fl2, bl2);
      const fr = A + across, br = A + across + 1 + across, fr2 = B + across, br2 = B + across + 1 + across;
      idx.push(fr, br, fr2, br, br2, fr2);
    }
    void ringN;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aFall', new THREE.Float32BufferAttribute(fallA, 1));
    geo.setIndex(idx); geo.computeBoundingSphere(); geo.boundingSphere!.radius += 1;
    fallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.FrontSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uPool: { value: poolLv }, uLen: { value: vAcc }, uJoin: { value: vRow[Math.max(0, path.findIndex((p) => p.fall > 0) - 1)] },
        uTop: { value: new THREE.Color(0x76bccb) }, uMid: { value: new THREE.Color(0xd8eef1) }, uFoam: { value: new THREE.Color(0xeef6f7) },
        uShallow: { value: new THREE.Color(0x9adbd0) },
      }]) as any,
      vertexShader: /* glsl */ `
        attribute float aFall; varying vec2 vUv; varying float vFall; varying vec3 vWorld; varying vec3 vN;
        #include <fog_pars_vertex>
        void main() { vUv = uv; vFall = aFall; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
          vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPool; uniform float uLen; uniform float uJoin; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uFoam; uniform vec3 uShallow;
        varying vec2 vUv; varying float vFall; varying vec3 vWorld; varying vec3 vN;
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float u = vUv.x, v = vUv.y;
          // 流れ：道のり v に沿って上から下へ（下流へ）だけ流れる。落ちる所ほど速い
          float speed = mix(0.9, 3.0, vFall);
          float sv = v - uTime * speed;
          float streak = noise(vec2(u * 22.0, sv * 1.3)) * 0.6 + noise(vec2(u * 53.0 + 3.0, sv * 2.6)) * 0.4;
          float strand = smoothstep(0.38, 0.82, streak);
          // 水の色：すき通った青緑に、白い筋（泡の流れ）が混ざる。真っ白な板にしない
          vec3 body = mix(uShallow, uTop, vFall);
          vec3 col = mix(body, uMid, strand * (0.25 + 0.4 * vFall));
          float lipZone = smoothstep(uJoin - 0.4, uJoin + 0.3, v) * (1.0 - smoothstep(uJoin + 0.3, uJoin + 1.8, v));
          col = mix(col, uFoam, lipZone * 0.3);
          float bottom = smoothstep(uLen - 2.6, uLen - 0.3, v);
          col = mix(col, uFoam, bottom * (0.35 + 0.35 * strand));
          // 光：太陽の向き（描画モジュールの太陽とほぼ同じ）で明るさを変え、影の谷では暗くなる
          vec3 sunD = normalize(vec3(0.55, 0.75, 0.3));
          float lam = clamp(dot(normalize(vN), sunD), 0.0, 1.0);
          col *= 0.62 + 0.38 * lam;
          // 横の縁：流れと一緒に動く大きめのでこぼこで削る（まっすぐな縦の線を見せない）
          float edgeN = noise(vec2(sv * 1.3, 4.0)) * 0.6 + noise(vec2(sv * 4.0, 9.0)) * 0.4;
          float edgeM = noise(vec2(sv * 1.1, 17.0)) * 0.6 + noise(vec2(sv * 3.6, 23.0)) * 0.4;
          float edge = smoothstep(0.02, 0.12 + 0.22 * edgeN, u) * smoothstep(0.98, 0.88 - 0.22 * edgeM, u);
          float alpha = mix(0.5, 0.42 + strand * 0.4, vFall) * edge;
          alpha = max(alpha, bottom * 0.75 * edge);
          alpha *= smoothstep(0.0, 0.7, v);
          alpha *= smoothstep(uPool - 0.38, uPool + 0.02, vWorld.y);
          gl_FragColor = vec4(min(col, vec3(0.92)), alpha);
          #include <fog_fragment>
        }`,
    });
    const fall = new THREE.Mesh(geo, fallMat); fall.renderOrder = 3; fall.name = 'Waterfall2'; group.add(fall);

    // 岩壁の飾り（落ちる水の両脇の崖の面に、岩の塊を埋め込む。崖の面の中に半分入れる）
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f6e68, roughness: 1, flatShading: true });
    const rockMatWet = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.7, flatShading: true });
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const addRock = (x: number, y: number, z: number, r: number, wet: boolean) => {
      const geo2 = new THREE.IcosahedronGeometry(r, 1); const p2 = geo2.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p2.count; i++) { const j = 1 + (rnd() - 0.5) * 0.3; p2.setXYZ(i, p2.getX(i) * j, p2.getY(i) * j * 0.8, p2.getZ(i) * j); }
      geo2.computeVertexNormals();
      const m = new THREE.Mesh(geo2, wet ? rockMatWet : rockMat); m.position.set(x, y, z); m.rotation.y = rnd() * 6.28; m.castShadow = true; m.receiveShadow = true; m.name = 'FallRock'; group.add(m);
    };
    for (const sgn of [-1, 1]) for (let k = 0; k < 4; k++) {
      // U 字の崖の面（落ち口の左右）に、半分埋め込む
      const a = 0.7 + k * 1.15 + rnd() * 0.3, q = WS.cliffWallPoint(a, sgn);
      const y = lerp(poolLv + 0.9, lipLv - 0.3, rnd());
      addRock(q.x + side.x * sgn * 0.35, y, q.z + side.z * sgn * 0.35, 0.7 + rnd() * 0.5, k < 2);
    }
    // 滝つぼの縁の岩（水しぶきに濡れた色）
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 1.2 - 0.6 + Math.atan2(dir.z, dir.x); const R = WS.FALL.poolR + 0.5;
      const x = WS.FALL.pool.x + Math.cos(a) * R, z = WS.FALL.pool.z + Math.sin(a) * R; if (cliffSide(x, z) > -0.5) continue; addRock(x, H(x, z) - 0.15, z, 0.45 + rnd() * 0.35, true); }

    // しぶき（数を限る）：落下点のまわりからだけ上がって落ちる
    const NS = 56; const sp = new Float32Array(NS * 3); sprayVel = new Float32Array(NS * 3); sprayLife = new Float32Array(NS);
    for (let i = 0; i < NS; i++) { sprayLife[i] = -rnd() * 1.4; sp[i * 3 + 1] = -100; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(IMPACT.x, IMPACT.y, IMPACT.z), 4);
    const ptex = opts.images.particle ? loadTex(opts.images.particle, false) : undefined;
    sprayPts = new THREE.Points(sg, new THREE.PointsMaterial({ map: ptex, color: 0xf3f8fa, size: 0.26, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true }));
    sprayPts.renderOrder = 4; sprayPts.name = 'FallSpray'; group.add(sprayPts);
    void rnd;
  }
  buildStreamsAndFall();
  let sprSeed = 11; const srnd = () => ((sprSeed = (sprSeed * 16807) % 2147483647) / 2147483647);
  function tickSpray(dt: number) {
    const a = sprayPts.geometry.attributes.position as THREE.BufferAttribute, p = a.array as Float32Array;
    for (let i = 0; i < sprayLife.length; i++) {
      sprayLife[i] -= dt;
      if (sprayLife[i] <= 0) {
        const ang = srnd() * Math.PI * 2, r = 0.2 + srnd() * 1.0;
        p[i * 3] = IMPACT.x + Math.cos(ang) * r; p[i * 3 + 1] = IMPACT.y + 0.05; p[i * 3 + 2] = IMPACT.z + Math.sin(ang) * r;
        sprayVel[i * 3] = Math.cos(ang) * (0.3 + srnd() * 0.7); sprayVel[i * 3 + 1] = 1.0 + srnd() * 1.5; sprayVel[i * 3 + 2] = Math.sin(ang) * (0.3 + srnd() * 0.7);
        sprayLife[i] = 0.5 + srnd() * 0.6;
      }
      sprayVel[i * 3 + 1] -= 6.5 * dt;
      p[i * 3] += sprayVel[i * 3] * dt; p[i * 3 + 1] += sprayVel[i * 3 + 1] * dt; p[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < IMPACT.y) { p[i * 3 + 1] = IMPACT.y; sprayLife[i] = Math.min(sprayLife[i], 0.05); }
    }
    a.needsUpdate = true;
  }

  /* ---------- 毎フレーム：細かさの決定と、少しずつの作成 ---------- */
  let focus = { x: 0, z: 0 }, time = 0, builtTotal = 0, syncBuilt = 0;
  const lodFor = (c: Chunk) => {
    const x0 = c.ci * CH, z0 = c.cj * CH;
    const dx = Math.max(x0 - focus.x, 0, focus.x - (x0 + CH)), dz = Math.max(z0 - focus.z, 0, focus.z - (z0 + CH)), d = Math.hypot(dx, dz);
    const near = quality === 'high' ? [40, 90, 160] : [28, 70, 130];
    let l = d < near[0] ? 0 : d < near[1] ? 1 : d < near[2] ? 2 : 3;
    if (fallsChunk(c.ci, c.cj)) l = d < 170 ? 0 : Math.min(l, 1);
    return l;
  };
  // はじめに全部の区画を粗く作る（地面がない所を出さない）
  for (const c of chunks.values()) { const j = startJob(c, 3); stepJob(c, j, Infinity); finishJob(c, j); }
  let lastBuildMs = 0;
  return {
    group,
    update(dt: number, f: { x: number; z: number }, camera: THREE.Camera) {
      focus = f; time += dt;
      waterUniformsCommon.uTime.value = time;
      if (fallMat) fallMat.uniforms.uTime.value = time;
      if (sprayPts && Math.hypot(f.x - IMPACT.x, f.z - IMPACT.z) < 90) tickSpray(Math.min(dt, 0.05));
      // 区画の細かさ
      let best: Chunk | null = null, bestD = Infinity;
      for (const c of chunks.values()) {
        c.want = lodFor(c);
        if (c.job && c.job.lod !== c.want) c.job = null;                    // もう要らなくなった作業は捨てる
        if (c.want !== c.lod) {
          const d = Math.hypot(c.ci * CH + CH / 2 - focus.x, c.cj * CH + CH / 2 - focus.z) - (c.want < c.lod ? 1000 : 0);  // 細かくする方を優先
          if (d < bestD) { bestD = d; best = c; }
        }
      }
      const t0 = performance.now(), until = t0 + (quality === 'high' ? 5 : 4);
      // 主人公の足もとの区画（とまわり）が粗いままなら、その場で作る（ワープ直後などに地面へ埋まって見えないように）
      const fi = Math.floor(focus.x / CH), fj = Math.floor(focus.z / CH);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const c = chunks.get(key(fi + di, fj + dj)); if (!c) continue;
        const need = di === 0 && dj === 0 ? 0 : 1;
        if (c.lod < 0 || c.lod > need) { const j = startJob(c, Math.min(need, c.want)); stepJob(c, j, Infinity); finishJob(c, j); c.job = null; builtTotal++; syncBuilt++; }
      }
      let guard = 3;
      while (best && guard-- > 0) {
        if (!best.job) best.job = startJob(best, best.want);
        if (stepJob(best, best.job, until)) { finishJob(best, best.job); best.job = null; builtTotal++; }
        if (performance.now() > until) break;
        // 次の区画
        best = null; bestD = Infinity;
        for (const c of chunks.values()) if (c.want !== c.lod) { const d = Math.hypot(c.ci * CH + CH / 2 - focus.x, c.cj * CH + CH / 2 - focus.z) - (c.want < c.lod ? 1000 : 0); if (d < bestD) { bestD = d; best = c; } }
      }
      lastBuildMs = performance.now() - t0;
      void camera;
    },
    status() {
      const by = [0, 0, 0, 0]; let pending = 0, verts = 0;
      for (const c of chunks.values()) { if (c.lod >= 0) by[c.lod]++; if (c.want !== c.lod) pending++; if (c.mesh) verts += c.mesh.geometry.attributes.position.count; }
      return { chunks: chunks.size, lod: by, pending, verts, builtTotal, syncBuilt, lastBuildMs: +lastBuildMs.toFixed(2), hidden: hidden.map((o) => o.name), river: riverParts.length, quality };
    },
    /** 確認用：主人公のまわり r マスの区画を、今すぐ必要な細かさまで作り終える（遅い環境での撮影・計測用。ゲームの流れでは使わない） */
    prebuild(r = 60) {
      for (const c of chunks.values()) {
        const x0 = c.ci * CH, z0 = c.cj * CH;
        const d = Math.hypot(Math.max(x0 - focus.x, 0, focus.x - (x0 + CH)), Math.max(z0 - focus.z, 0, focus.z - (z0 + CH)));
        if (d > r) continue; c.want = lodFor(c);
        if (c.want !== c.lod) { const j = startJob(c, c.want); stepJob(c, j, Infinity); finishJob(c, j); c.job = null; builtTotal++; }
      }
    },
    setQuality(q: Quality) { if (q === quality) return; quality = q; for (const c of chunks.values()) { c.lod = -2; c.job = null; } },
    dispose() {
      for (const c of chunks.values()) { for (const m of [c.mesh, c.sea, c.lake]) if (m) { group.remove(m); m.geometry.dispose(); } }
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) m.geometry.dispose(); });
      scene.remove(group); hidden.forEach((o) => { o.visible = true; });
    },
  };
}
