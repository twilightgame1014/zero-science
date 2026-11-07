import * as THREE from 'three';
import { AssetManager } from './AssetManager';
import { mulberry32 } from './utils';

/**
 * Parametric waterfall kit (round 20, owner spec §9).
 *
 * The old set piece was one flat plane with a stripe shader: it
 * read as a board from the side, its pattern stretched with the
 * drop height, and it had no connection points a placement
 * system could consume. This kit is built from six named parts
 * in a local frame (origin at the basin centre, water flows
 * from -Z upstream to +Z downstream):
 *
 *   WF_Upstream  still water above the lip
 *   WF_Fall      curved falling sheet (2 layers) — the ONLY
 *                part that adapts to the drop height; its UVs
 *                run in metres so the streak pattern and the
 *                scroll speed are height-independent
 *   WF_Foam      plunge foam disc + basin foam ring (animated)
 *   WF_Splash    recycled droplet points at the plunge line
 *   WF_Mist      two crossed soft planes (never a billboard
 *                plate, so it survives camera orbits)
 *   WF_Basin     plunge pool
 *   WF_Downstream short outflow strip
 *
 * Anchors (local, metres): upstream / fallStart / fallEnd /
 * downstream — the connection contract for Claude's placement
 * (see assets/environment-set/waterfall.json).
 */

export interface WaterfallAnchors {
  upstream: THREE.Vector3;
  fallStart: THREE.Vector3;
  fallEnd: THREE.Vector3;
  downstream: THREE.Vector3;
}

export interface WaterfallKit {
  group: THREE.Group;
  anchors: WaterfallAnchors;
  update: (time: number) => void;
}

const FALL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// vUv.y runs in PATTERN METRES from the top of the fall, so the
// streak density and scroll speed (pattern-metres per second)
// do not change when the drop height changes.
const FALL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uLen;
  uniform float uOpacity;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform sampler2D uStreaks;
  uniform float uUseTex;
  varying vec2 vUv;
  void main() {
    float streaks = sin(vUv.x * 26.0 + sin(vUv.y * 3.0 - uTime * 2.4) * 1.5
                          - uTime * 6.5) * 0.5 + 0.5;
    float scroll = sin((vUv.y - uTime * 1.5) * 6.2831) * 0.5 + 0.5;
    vec3 col = mix(uTop, uBottom, clamp(vUv.y / max(uLen, 0.001), 0.0, 1.0))
             + streaks * 0.10 + scroll * 0.05;
    // GPT streak art (round 21): one texture tile spans 2.2 m of
    // fall and scrolls at the same 1.5 m/s as the procedural
    // bands, so pattern size and flow speed stay height-
    // independent. Where the art is transparent the sheet dims,
    // which breaks the fall into separate water columns.
    vec4 tx = texture2D(uStreaks, vec2(vUv.x, (vUv.y * 1.35 - uTime * 1.5) / 2.2));
    col = mix(col, tx.rgb, tx.a * 0.55 * uUseTex);
    float foam = smoothstep(1.1, 0.2, uLen - vUv.y);
    col = mix(col, vec3(1.0), foam * 0.8);
    float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
    float head = smoothstep(0.0, 0.35, vUv.y);
    float texDim = mix(1.0, 0.5 + tx.a * 0.8, uUseTex);
    float alpha = (0.66 + streaks * 0.22 + foam * 0.3) * edge * head * uOpacity * texDim;
    gl_FragColor = vec4(col, alpha);
  }
`;

function fallMaterial(len: number, opacity: number, top: number, bottom: number,
  streaks?: THREE.Texture | null) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uLen: { value: len },
      uOpacity: { value: opacity },
      uTop: { value: new THREE.Color(top) },
      uBottom: { value: new THREE.Color(bottom) },
      uStreaks: { value: streaks ?? null },
      uUseTex: { value: streaks ? 1 : 0 },
    },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
  });
}

/** Fractured rock: an icosphere whose vertices are clipped by a
 *  few random planes, leaving real flat facets — not the uniform
 *  noise jitter the old set piece used. Deterministic per seed. */
export function fracturedRockGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const planes: Array<{ n: THREE.Vector3; c: number }> = [];
  for (let i = 0; i < 4; i++) {
    const n = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    planes.push({ n, c: radius * (0.55 + rng() * 0.3) });
  }
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const j = 1 + (rng() - 0.5) * 0.22;
    p.multiplyScalar(j);
    for (const pl of planes) {
      const d = p.dot(pl.n) - pl.c;
      if (d > 0) p.addScaledVector(pl.n, -d);
    }
    pos.setXYZ(i, p.x, p.y * 0.88, p.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createWaterfallKit(opts: {
  width: number;
  drop: number;
  particleTexture: THREE.Texture;
  seed?: number;
  /** GPT art (round 21, assets/gpt-env). All optional — the kit
   *  falls back to its procedural art when absent. */
  streakTexture?: THREE.Texture | null;
  foamRingTexture?: THREE.Texture | null;
  foamClusterTexture?: THREE.Texture | null;
  mossTextures?: THREE.Texture[];
  detail?: 'high' | 'low';
}): WaterfallKit {
  const { width, drop } = opts;
  const rng = mulberry32(opts.seed ?? 777);
  const am = new AssetManager();
  const foamRingTex = opts.foamRingTexture ?? am.createFoamTexture('ring');
  const foamClusterTex = am.createFoamTexture('cluster');
  const detail = opts.detail ?? 'high';

  const group = new THREE.Group();
  group.name = 'Waterfall';

  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x5fb6c9, roughness: 0.16, metalness: 0.04,
    transparent: true, opacity: 0.93,
  });
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x7e7c78, roughness: 1, flatShading: true,
  });
  const rockDark = new THREE.MeshStandardMaterial({
    color: 0x5b5c55, roughness: 1, flatShading: true,
  });

  /* ---- WF_Upstream ---- */
  // Soft patchy edges (foam-cluster alpha) so the still-water
  // planes never read as hard rectangles against the ground.
  const softWater = () => {
    const m = waterMat.clone();
    m.alphaMap = foamClusterTex;
    return m;
  };
  const upstream = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.0, 1.35), softWater());
  upstream.rotation.x = -Math.PI / 2;
  upstream.position.set(0, drop + 0.02, -1.3);
  upstream.name = 'WF_Upstream';
  group.add(upstream);

  /* ---- WF_Fall: curved parametric strip ---- */
  // Profile from the lip (back, top) to the plunge point. Only
  // this strip depends on `drop`; lip and basin stay rigid.
  const profile: Array<[number, number]> = [
    [-0.85, drop + 0.05],
    [-0.55, drop + 0.03],
    [-0.30, drop - drop * 0.10],
    [-0.10, drop * 0.62],
    [0.02, drop * 0.34],
    [0.10, drop * 0.14],
    [0.16, 0.10],
  ];
  const SEG_U = 8;
  const SEG_V = 22;
  const profPts: Array<{ z: number; y: number; d: number }> = [];
  {
    // Catmull-Rom through the profile, accumulating arc length.
    const sample = (t: number) => {
      const f = t * (profile.length - 1);
      const i = Math.min(profile.length - 2, Math.floor(f));
      const u = f - i;
      const p0 = profile[Math.max(0, i - 1)], p1 = profile[i];
      const p2 = profile[i + 1], p3 = profile[Math.min(profile.length - 1, i + 2)];
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u
          + (-a + 3 * b - 3 * c + d) * u * u * u);
      return { z: cr(p0[0], p1[0], p2[0], p3[0]), y: cr(p0[1], p1[1], p2[1], p3[1]) };
    };
    let acc = 0;
    let prev = sample(0);
    profPts.push({ ...prev, d: 0 });
    for (let i = 1; i <= SEG_V; i++) {
      const s = sample(i / SEG_V);
      acc += Math.hypot(s.z - prev.z, s.y - prev.y);
      profPts.push({ ...s, d: acc });
      prev = s;
    }
  }
  const fallLen = profPts[profPts.length - 1].d;
  const buildFallLayer = (scaleW: number, zOff: number, opacity: number,
    top: number, bottom: number, name: string) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let j = 0; j <= SEG_V; j++) {
      const pt = profPts[j];
      const t = j / SEG_V;
      const wHalf = (width * scaleW * (0.94 + 0.18 * THREE.MathUtils.smoothstep(t, 0.55, 1))) / 2;
      for (let i = 0; i <= SEG_U; i++) {
        const fx = i / SEG_U;
        const x = (fx - 0.5) * 2 * wHalf;
        // centre of the sheet bellies slightly toward +Z
        const belly = Math.sin(fx * Math.PI) * 0.05;
        positions.push(x, pt.y, pt.z + belly + zOff);
        uvs.push(fx, pt.d / 1.35);
      }
    }
    for (let j = 0; j < SEG_V; j++) {
      for (let i = 0; i < SEG_U; i++) {
        const a = j * (SEG_U + 1) + i;
        const b = a + 1;
        const c = a + SEG_U + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = fallMaterial(fallLen / 1.35, opacity, top, bottom, opts.streakTexture);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.renderOrder = 3;
    group.add(mesh);
    return mat;
  };
  const fallMats = [
    buildFallLayer(1, 0, 0.95, 0x9fd4e2, 0xe8fbff, 'WF_Fall'),
    buildFallLayer(0.55, -0.035, 0.9, 0xcfeef7, 0xffffff, 'WF_FallCore'),
  ];

  /* ---- lip + basin rocks (fractured) ---- */
  const rock = (r: number, x: number, y: number, z: number, dark: boolean, seed: number) => {
    const m = new THREE.Mesh(fracturedRockGeometry(r, seed), dark ? rockDark : rockMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  rock(0.85, -width * 0.72, drop - 0.25, -0.55, false, 11);
  rock(0.7, -width * 0.8, drop - 1.0, 0.15, true, 12);
  rock(0.9, width * 0.74, drop - 0.3, -0.5, true, 13);
  rock(0.66, width * 0.82, drop - 1.1, 0.2, false, 14);
  rock(0.55, -width * 0.85, 0.25, 0.9, true, 15);
  rock(0.5, width * 0.88, 0.2, 1.0, false, 16);

  /* ---- WF_Basin + WF_Foam ---- */
  const basin = new THREE.Mesh(new THREE.CircleGeometry(width * 0.85, 22), softWater());
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(0, 0.05, 0.55);
  basin.receiveShadow = true;
  basin.name = 'WF_Basin';
  group.add(basin);

  const foamMat = new THREE.MeshBasicMaterial({
    map: foamRingTex, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const foam = new THREE.Mesh(new THREE.CircleGeometry(width * 0.52, 22), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.11, 0.22);
  foam.renderOrder = 4;
  foam.name = 'WF_Foam';
  group.add(foam);

  /* ---- WF_FoamCluster: GPT foam accent at the plunge ---- */
  let foamClusterMat: THREE.MeshBasicMaterial | null = null;
  let foamCluster: THREE.Mesh | null = null;
  if (opts.foamClusterTexture && detail !== 'low') {
    foamClusterMat = new THREE.MeshBasicMaterial({
      map: opts.foamClusterTexture, transparent: true, opacity: 0.85, depthWrite: false,
    });
    foamCluster = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.95, width * 0.5), foamClusterMat);
    foamCluster.rotation.x = -Math.PI / 2;
    foamCluster.rotation.z = 0.4;
    foamCluster.position.set(0.08, 0.115, 0.36);
    foamCluster.renderOrder = 4;
    foamCluster.name = 'WF_FoamCluster';
    group.add(foamCluster);
  }

  /* ---- WF_Moss: GPT moss decals hugging the lip rocks ---- */
  if (opts.mossTextures && opts.mossTextures.length > 0 && detail !== 'low') {
    const spots: Array<{ x: number; y: number; z: number; tilt: number }> = [
      { x: -width * 0.72, y: drop + 0.38, z: -0.52, tilt: 0.18 },
      { x: width * 0.74, y: drop + 0.32, z: -0.44, tilt: -0.14 },
    ];
    spots.forEach((sp, i) => {
      const geo = new THREE.PlaneGeometry(0.85, 0.62, 4, 4);
      const pp = geo.attributes.position as THREE.BufferAttribute;
      for (let vi = 0; vi < pp.count; vi++) {
        const px = pp.getX(vi) / 0.85;
        const py = pp.getY(vi) / 0.62;
        pp.setZ(vi, 0.05 * Math.max(0, 1 - (px * px + py * py)));
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: opts.mossTextures![i % opts.mossTextures!.length],
        transparent: true, alphaTest: 0.06, roughness: 1,
        polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
      }));
      m.rotation.x = -Math.PI / 2 + sp.tilt;
      m.rotation.z = i * 1.9 + 0.5;
      m.position.set(sp.x, sp.y, sp.z);
      m.name = 'WF_Moss';
      group.add(m);
    });
  }

  /* ---- WF_Downstream ---- */
  const downstream = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, 2.6), softWater());
  downstream.rotation.x = -Math.PI / 2;
  downstream.position.set(0, 0.045, 2.6);
  downstream.name = 'WF_Downstream';
  group.add(downstream);

  /* ---- WF_Splash: recycled droplets ---- */
  const SPLASH = 64;
  const sPos = new Float32Array(SPLASH * 3);
  const sDat: Array<{ ang: number; rad: number; h: number; ph: number; sp: number }> = [];
  for (let i = 0; i < SPLASH; i++) {
    sDat.push({
      ang: rng() * Math.PI * 2,
      rad: 0.25 + rng() * width * 0.4,
      h: 0.35 + rng() * 0.8,
      ph: rng(),
      sp: 0.7 + rng() * 0.7,
    });
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const splash = new THREE.Points(sGeo, new THREE.PointsMaterial({
    map: opts.particleTexture, color: 0xffffff, size: 0.2,
    transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: true,
  }));
  splash.renderOrder = 5;
  splash.name = 'WF_Splash';
  splash.frustumCulled = false;
  group.add(splash);

  /* ---- WF_Mist: crossed planes, never a billboard ---- */
  const mistMat = new THREE.MeshBasicMaterial({
    map: foamClusterTex, transparent: true, opacity: 0.13,
    depthWrite: false, color: 0xf2faff, side: THREE.DoubleSide,
  });
  const mist = new THREE.Group();
  mist.name = 'WF_Mist';
  for (const ry of [0.3, 0.3 + Math.PI / 3]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, 1.15), mistMat);
    p.position.y = 0.55;
    p.rotation.y = ry;
    p.renderOrder = 6;
    mist.add(p);
  }
  mist.position.set(0, 0, 0.35);
  group.add(mist);

  const anchors: WaterfallAnchors = {
    upstream: new THREE.Vector3(0, drop + 0.03, -1.75),
    fallStart: new THREE.Vector3(0, drop + 0.02, -0.55),
    fallEnd: new THREE.Vector3(0, 0.1, 0.18),
    downstream: new THREE.Vector3(0, 0.045, 3.4),
  };

  const update = (time: number) => {
    for (const m of fallMats) m.uniforms.uTime.value = time;
    const pulse = 1 + Math.sin(time * 2.2) * 0.05 + Math.sin(time * 5.7) * 0.02;
    foam.scale.setScalar(pulse);
    foamMat.opacity = 0.78 + Math.sin(time * 3.1) * 0.14;
    if (foamCluster && foamClusterMat) {
      // offset phase from the ring so the two foam layers never
      // pulse in lockstep (round-21 spec §7)
      foamCluster.scale.setScalar(1 + Math.sin(time * 2.2 + 1.7) * 0.06);
      foamCluster.rotation.z = 0.4 + Math.sin(time * 0.4) * 0.2;
      foamClusterMat.opacity = 0.7 + Math.sin(time * 3.1 + 1.3) * 0.15;
    }
    mistMat.opacity = 0.11 + Math.sin(time * 0.7) * 0.035;
    mist.rotation.y = Math.sin(time * 0.23) * 0.16;
    const arr = sGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < SPLASH; i++) {
      const d = sDat[i];
      const t = (time * d.sp + d.ph) % 1;
      const x = Math.cos(d.ang) * d.rad * t;
      const z = 0.22 + Math.sin(d.ang) * d.rad * t * 0.7;
      const y = 0.1 + d.h * 4 * t * (1 - t) * 0.5 + t * 0.12;
      arr.setXYZ(i, x, y, z);
    }
    arr.needsUpdate = true;
  };

  return { group, anchors, update };
}
