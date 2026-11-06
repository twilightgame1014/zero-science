import * as THREE from 'three';
import type { GraphicsConfig } from './types';
import {
  clamp,
  distanceToPath,
  distanceToRiver,
  fbm,
  lerp,
  riverCenterX,
  smoothstep,
  terrainHeight,
} from './utils';

/**
 * The ground mesh and the river surface.
 * Height / river path come from utils.ts so placement code, character
 * grounding and this mesh can never disagree.
 */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  private cfg: GraphicsConfig;
  private waterUniforms: { uTime: { value: number } } | null = null;

  constructor(cfg: GraphicsConfig, detailTexture: THREE.Texture) {
    this.cfg = cfg;
    this.group.add(this.buildTerrain(detailTexture));
    this.group.add(this.buildWater());
  }

  getHeightAt(x: number, z: number): number {
    return terrainHeight(x, z, this.cfg);
  }

  update(time: number): void {
    if (this.waterUniforms) this.waterUniforms.uTime.value = time;
  }

  /* ------------------------------------------------------------ */
  private buildTerrain(detailTexture: THREE.Texture): THREE.Mesh {
    const { size, terrainSegments } = this.cfg.world;
    const geo = new THREE.PlaneGeometry(size, size, terrainSegments, terrainSegments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    const cGrass = new THREE.Color(0x69a34b);
    const cGrassDry = new THREE.Color(0x9db45e);
    const cForestFloor = new THREE.Color(0x4d7d3a);
    const cSand = new THREE.Color(0xd9bd8a);
    const cWetSand = new THREE.Color(0xa8895c);
    const cClay = new THREE.Color(0xb0764a);
    const cRock = new THREE.Color(0x8d8d90);
    const cRockDark = new THREE.Color(0x66666c);
    const cPath = new THREE.Color(0xa3804f);
    const cUnderwater = new THREE.Color(0x77683f);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z, this.cfg);
      pos.setY(i, h);

      const n = fbm(x * 0.09 + 31, z * 0.09 + 17, 3);
      const dRiver = distanceToRiver(x, z);
      // Base grass with dry/forest variation.
      tmp.copy(cGrass).lerp(cGrassDry, clamp(n * 1.15 - 0.12, 0, 1));
      const forestMask = smoothstep(-2, -26, x + z * 0.25);
      tmp.lerp(cForestFloor, forestMask * 0.55);
      // Sandy / wet banks near the river, clay patches on the south bank.
      const bank = smoothstep(6.4, 3.4, dRiver);
      tmp.lerp(h < 0.55 ? cWetSand : cSand, bank * 0.85);
      const clayMask =
        smoothstep(0.55, 0.75, fbm(x * 0.05 + 91, z * 0.05 + 55, 3)) *
        smoothstep(11, 6, dRiver) *
        smoothstep(-6, 8, z);
      tmp.lerp(cClay, clayMask * 0.8);
      if (h < this.cfg.world.waterLevel + 0.05) tmp.lerp(cUnderwater, 0.7);
      // Worn dirt path across the meadow (suppressed under water).
      const pathMask =
        smoothstep(2.4, 1.1, distanceToPath(x, z)) * smoothstep(0.42, 0.6, h);
      tmp.lerp(cPath, pathMask * 0.8);
      // Rocky highland by height + slope proxy (fbm roughness).
      const rockiness = smoothstep(1.6, 3.6, h) * 0.75 +
        smoothstep(20, 46, x - z * 0.35) * 0.45;
      tmp.lerp(n > 0.55 ? cRock : cRockDark, clamp(rockiness, 0, 0.92));
      // Sedimentary strata banding on exposed rock faces.
      const strata = 0.9 + 0.1 * Math.sin(h * 6.5 + n * 3.0);
      tmp.multiplyScalar(lerp(1, strata, clamp(rockiness, 0, 1)));
      // Slight ambient occlusion in the river channel.
      const ao = 1 - Math.exp(-((dRiver / 4.2) ** 2)) * 0.22;
      colors[i * 3] = tmp.r * ao;
      colors[i * 3 + 1] = tmp.g * ao;
      colors[i * 3 + 2] = tmp.b * ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    detailTexture.repeat.set(46, 46);
    const mat = new THREE.MeshStandardMaterial({
      map: detailTexture,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'Terrain';
    return mesh;
  }

  /* ------------------------------------------------------------ */
  private buildWater(): THREE.Mesh {
    const { size, waterLevel } = this.cfg.world;
    const steps = 110;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = -size / 2 + (i / steps) * size;
      const cx = riverCenterX(z);
      const halfW = 3.55 + Math.sin(z * 0.21) * 0.35;
      positions.push(cx - halfW, waterLevel, z, cx + halfW, waterLevel, z);
      uvs.push(0, i / steps * 30, 1, i / steps * 30);
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    this.waterUniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.waterUniforms.uTime,
        uDeep: { value: new THREE.Color(0x1d6f8e) },
        uShallow: { value: new THREE.Color(0x63c2cf) },
        uSky: { value: new THREE.Color(0xcfe9f5) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSky;
        varying vec2 vUv;
        varying vec3 vWorld;
        float wave(vec2 p) {
          return sin(p.x * 6.0 + p.y * 3.0) * 0.5
               + sin(p.x * -11.0 + p.y * 7.0 + 1.7) * 0.3
               + sin(p.y * 15.0 - uTime * 0.6) * 0.2;
        }
        void main() {
          // Flow runs along +v (downstream), so scroll patterns in v.
          vec2 flowUv = vec2(vUv.x * 3.0, vUv.y * 2.0 - uTime * 0.55);
          float w1 = wave(flowUv * 2.4);
          float w2 = wave(flowUv * 5.1 + 3.1);
          float ripple = (w1 + w2) * 0.5 + 0.5;
          vec3 col = mix(uDeep, uShallow, ripple * 0.65);
          // Soft sky sheen across the middle of the stream.
          float sheen = smoothstep(0.25, 0.5, vUv.x) * smoothstep(0.75, 0.5, vUv.x);
          col = mix(col, uSky, sheen * 0.28 + ripple * 0.08);
          // Sparkles.
          float sparkle = smoothstep(0.92, 1.0, wave(flowUv * 9.0 + 7.0));
          col += sparkle * 0.35;
          // Fade edges into the banks.
          float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          gl_FragColor = vec4(col, 0.86 * edge + 0.1);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'RiverWater';
    mesh.renderOrder = 2;
    return mesh;
  }
}
