/* ===================== 広い世界の描画（ゲーム側。2026-11-07、Muse ラウンド18 統合後） =====================
   地形（7エリア・区画読み込み）・湖・海・オアシスの水面は描画モジュール（Muse）が描く。ここでは、モジュールにないものだけを足す：
   - 本流の続き：モジュールの川の帯（RiverWater・Riverbed）は旧世界 120×120 の中だけなので、同じ材質で北と南へ field の端（±180）まで延ばす。
   - 山の池・上流・滝・滝つぼ・下流（湖まで）：水面がそれぞれの高さにある水（モジュールの全面の水面は水位 0.32 の1枚なので描けない）。
     上流の水面 → 落ち口（水面が崖の縁で下へ曲がる）→ 落ちる水（厚みのある閉じた形）→ 滝つぼ（落下点のまわりだけ泡・しぶき・波紋）→ 下流 → 湖。
   - 調整：モジュールの旧い滝（Waterfall。壊れている）は表示しない。モジュールの全面の水面（OpenWater）は、旧世界（±60）の中の「水位より低い乾いた低地」
     では深さを0にして見せない（以前どおり歩ける地面。本流の帯の所はそのまま）。Muse へ依頼中（docs/handoff/CLAUDE-TO-MUSE-2026-11-06.md §19）。
   地形の高さ・水の高さは src/world/shape.ts（ゲームと同じ関数）。 */
import * as THREE from 'three';
import { smoothstep as sm, clamp, lerp, distanceToRiver, riverCenterX } from '../graphics/utils';
import type { GraphicsConfig } from '../graphics/types';
import * as WS from './shape';

type Quality = 'high' | 'low';
const FIELD = 180;   // モジュールの地形の範囲（±180）

export interface WorldView {
  update(dt: number, focus: { x: number; z: number }, camera: THREE.Camera): void;
  status(): Record<string, unknown>;
  setQuality(q: Quality): void;
  prebuild(r?: number): void;
  /** ワープ（瞬間移動）のあと：足もとの地形の区画を今すぐ用意する */
  afterWarp(x: number, z: number): void;
  dispose(): void;
  readonly group: THREE.Group;
}

export function attachWorld(gfx: any, opts: { cfg: GraphicsConfig; quality: Quality; images: { particle?: string } }): WorldView {
  const scene: THREE.Scene = gfx.getScene();
  const cfg = opts.cfg, wl = cfg.world.waterLevel;
  let quality: Quality = opts.quality;
  const H = (x: number, z: number) => WS.worldHeight(x, z, cfg);
  const group = new THREE.Group(); group.name = 'WideWorld';
  scene.add(group);

  /* モジュールの物：川の材質・旧い滝・全面の水面 */
  let modWater: THREE.Mesh | null = null, modBed: THREE.Mesh | null = null, openWater: THREE.Mesh | null = null;
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.name === 'RiverWater') modWater = o as THREE.Mesh;
    if (o.name === 'Riverbed') modBed = o as THREE.Mesh;
    if (o.name === 'OpenWater') openWater = o as THREE.Mesh;
    if (o.name === 'Waterfall') { o.visible = false; hidden.push(o); } // 保険：decor.waterfall:false の版では元から無い
  });
  /* 全面の水面：旧世界の乾いた低地では見せない（深さ0）。本流の帯の近くと、旧世界の外はそのまま */
  let maskedOpen = 0;
  if (openWater) {
    const g = (openWater as THREE.Mesh).geometry as THREE.BufferGeometry, pos = g.attributes.position, dep = g.attributes.aDepth as THREE.BufferAttribute;
    if (dep) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        if (Math.max(Math.abs(x), Math.abs(z)) > WS.OLD_HALF + 0.5) continue;
        if (distanceToRiver(x, z) < 5.2) continue;
        if (dep.getX(i) > 0) { dep.setX(i, 0); maskedOpen++; }
      }
      dep.needsUpdate = true;
    }
  }
  const loader = new THREE.TextureLoader();
  const loadTex = (url: string | undefined, rep = true) => { if (!url) return undefined; const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };

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
          float dk = smoothstep(0.0, max(uDD, 0.01), max(vDepth, 0.0));
          vec3 col = mix(uShallow, uDeep, dk);
          float alpha = mix(uSA, uDA, dk);
          float fln = length(vFlow); vec2 fl = fln > 0.01 ? vFlow / fln : vec2(0.0, 1.0);
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
            float m = 1.0 - smoothstep(0.6, 3.2, d);
            col = mix(col, mix(uShallow, vec3(1.0), 0.35), ring * m * 0.25);
            // 落ちる水が当たる所の泡（落下点のまわりだけ。滝の下端と水面の境目を自然にする）
            float fz = (1.0 - smoothstep(0.5, 2.1, d)) * smoothstep(0.35, 0.7, noise(vWorld.xz * 2.4 + vec2(t * 0.6, -t * 0.4)) * 0.7 + noise(vWorld.xz * 5.0 - t) * 0.3);
            col = mix(col, vec3(0.93, 0.97, 0.98), fz * 0.8);
            alpha = max(alpha, fz * 0.85);
          }
          // 歩ける浅瀬と深い所の境目（細い明るい線と、その先の色の変化）
          float edge = 1.0 - smoothstep(0.0, 0.07, abs(vDepth - uWade));
          col = mix(col, mix(uShallow, vec3(1.0), 0.4), edge * 0.35 * uLine);
          // 波打ち際の泡：深さ0の線に沿って、寄せては返す
          float wash = uSwell > 0.0 ? (0.5 + 0.5 * sin(t * 0.9 + fs.x * 0.15)) : 0.5;
          float fd = uFoamD * (0.7 + 0.8 * wash);
          float band = 1.0 - smoothstep(fd * 0.25, fd, vDepth);
          float fn = noise(fs * vec2(2.2, 4.0) + vec2(0.0, -t * 0.4)) * 0.6 + noise(fs * 6.0 + 3.1) * 0.4;
          float foam = band * smoothstep(0.42, 0.75, fn);
          col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.85);
          alpha = clamp(alpha + foam * 0.45, 0.0, 1.0);
          alpha *= smoothstep(0.0, 0.05, vDepth) * (0.25 + 0.75 * smoothstep(0.0, 0.12, vDepth));
          alpha *= vFade;
          // 後処理（bloom・ぼかし）へ範囲外の値を渡さない（1点でも数でない値があると画面に広がる）
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
          #include <fog_fragment>
        }`,
    });
  }
  const matSea = waterMaterial('sea'), matLake = waterMaterial('calm'), matStream = waterMaterial('stream'), matPool = waterMaterial('pool'), matTarn = waterMaterial('calm');
  for (const m of [matSea, matLake, matStream, matPool, matTarn]) m.uniforms.uTime = waterUniformsCommon.uTime;

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
  

  riverRibbon(WS.OLD_HALF, FIELD);
  riverRibbon(-WS.OLD_HALF, -FIELD);

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
        if (endSea) f *= 1 - sm(WS.DOWN_SEA_S - 4, WS.DOWN_SEA_S + 1.5, s);   // 湖に入る所で、湖の水面（モジュール）へ引き継ぐ
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
        void main() { vUv = uv; vFall = aFall; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = mat3(modelMatrix) * normal;
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
          float vnl = length(vN); float lam = clamp(dot(vnl > 0.0001 ? vN / vnl : vec3(0.0, 1.0, 0.0), sunD), 0.0, 1.0);
          col *= 0.62 + 0.38 * lam;
          // 横の縁：流れと一緒に動く大きめのでこぼこで削る（まっすぐな縦の線を見せない）
          float edgeN = noise(vec2(sv * 1.3, 4.0)) * 0.6 + noise(vec2(sv * 4.0, 9.0)) * 0.4;
          float edgeM = noise(vec2(sv * 1.1, 17.0)) * 0.6 + noise(vec2(sv * 3.6, 23.0)) * 0.4;
          float edge = smoothstep(0.02, 0.12 + 0.22 * edgeN, u) * (1.0 - smoothstep(0.88 - 0.22 * edgeM, 0.98, u));
          float alpha = mix(0.5, 0.42 + strand * 0.4, vFall) * edge;
          alpha = max(alpha, bottom * 0.75 * edge);
          alpha *= smoothstep(0.0, 0.7, v);
          alpha *= smoothstep(uPool - 0.38, uPool + 0.02, vWorld.y);
          gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(0.92)), clamp(alpha, 0.0, 1.0));
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


  /* ---------- 毎フレーム ---------- */
  let time = 0, focus = { x: 0, z: 0 };
  const terr = () => { try { return gfx.world && gfx.world.terrain; } catch (e) { return null; } };
  /* 瞬間移動の準備：モジュールの公開 API prepareTerrainAt（ラウンド22）があればそれ、なければ区画作りを直接まとめて呼ぶ */
  const forceChunks = (x: number, z: number, n = 4) => { const g = gfx as unknown as { prepareTerrainAt?: (x: number, z: number, r?: number) => void };
    if (typeof g.prepareTerrainAt === 'function') { g.prepareTerrainAt(x, z, 90); return; }
    const t = terr(); if (t && typeof t.updateChunks === 'function') for (let i = 0; i < n; i++) { t.lastFocus = { x: Infinity, z: Infinity }; t.updateChunks(x, z, true); } };
  return {
    group,
    update(dt: number, f: { x: number; z: number }, camera: THREE.Camera) {
      time += dt; focus = f;
      waterUniformsCommon.uTime.value = time;
      if (fallMat) fallMat.uniforms.uTime.value = time;
      if (sprayPts && Math.hypot(f.x - IMPACT.x, f.z - IMPACT.z) < 90) tickSpray(Math.min(dt, 0.05));
      void camera;
    },
    status() {
      const t = terr(); let chunks = null; try { chunks = t && t.chunks ? t.chunks.size : null; } catch (e) { /* なし */ }
      return { moduleChunks: chunks, hidden: hidden.map((o) => o.name), openWaterMasked: maskedOpen, river: riverParts.length, quality };
    },
    /** 確認用：足もとのまわりの地形の区画を作り終える（撮影・計測用） */
    prebuild() { forceChunks(focus.x, focus.z, 6); },
    afterWarp(x: number, z: number) { forceChunks(x, z); },
    setQuality(q: Quality) { quality = q; },
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) m.geometry.dispose(); });
      scene.remove(group); hidden.forEach((o) => { o.visible = true; });
    },
  };
}
