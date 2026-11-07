import * as THREE from 'three';
import type { GraphicsConfig, QualityTier } from './types';
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
  private detailBrightness: number;
  private quality: QualityTier;
  private waterUniforms: { uTime: { value: number } } | null = null;
  private terrainMesh: THREE.Mesh;
  private waterMesh: THREE.Mesh;

  constructor(
    cfg: GraphicsConfig,
    detailTexture: THREE.Texture,
    detailBrightness = 1,
    quality: QualityTier = 'high',
    riverbedTexture?: THREE.Texture,
    groundTextures?: Record<string, THREE.Texture>,
  ) {
    this.detailBrightness = detailBrightness;
    this.cfg = cfg;
    this.quality = quality;
    this.terrainMesh = this.buildTerrain(detailTexture, groundTextures);
    this.waterMesh = this.buildWater();
    this.group.add(this.terrainMesh);
    this.group.add(this.buildRiverbed(riverbedTexture));
    this.group.add(this.waterMesh);
    this.group.add(this.buildOuterGround());
  }

  /**
   * Raycast against the visible ground: the river surface where the
   * ray meets water, the terrain elsewhere. Backs the public
   * pickGround API — display geometry only, no passability meaning.
   */
  pick(raycaster: THREE.Raycaster): { point: THREE.Vector3; surface: 'terrain' | 'water' } | null {
    const hits = raycaster.intersectObjects([this.waterMesh, this.terrainMesh], false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    return {
      point: hit.point,
      surface: hit.object === this.waterMesh ? 'water' : 'terrain',
    };
  }

  /**
   * A wide, plain ground disc far below the lowest terrain point, so
   * the low camera never sees void past the world rim: the disc reads
   * as distant land dissolving into fog. It is not raycast (pick()
   * ignores it) and carries no height information.
   */
  private buildOuterGround(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(340, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55763d, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -1.78;
    mesh.name = 'OuterGround';
    return mesh;
  }

  getHeightAt(x: number, z: number): number {
    return terrainHeight(x, z, this.cfg);
  }

  update(time: number): void {
    if (this.waterUniforms) this.waterUniforms.uTime.value = time;
  }

  /* ------------------------------------------------------------ */
  private buildTerrain(
    detailTexture: THREE.Texture,
    groundTextures?: Record<string, THREE.Texture>,
  ): THREE.Mesh {
    const { size, terrainSegments } = this.cfg.world;
    const geo = new THREE.PlaneGeometry(size, size, terrainSegments, terrainSegments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    // Per-vertex weights for the tiling ground-texture splat
    // (forest floor / wet mud / sand / worn path), derived from the
    // same masks that drive the vertex colours below so the two can
    // never disagree about where a shore or the path runs.
    const splat = new Float32Array(pos.count * 4);

    const cGrass = new THREE.Color(0x69a34b);
    const cGrassDry = new THREE.Color(0x9db45e);
    const cForestFloor = new THREE.Color(0x4d7d3a);
    const cSand = new THREE.Color(0xd9bd8a);
    const cWetSand = new THREE.Color(0xa8895c);
    const cClay = new THREE.Color(0xb0764a);
    const cRock = new THREE.Color(0x8d8d90);
    const cRockDark = new THREE.Color(0x66666c);
    const cPath = new THREE.Color(0xa3804f);
    const cEarth = new THREE.Color(0x7c6a42);
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
      // Fine mottling: worn earth showing through the grass in small
      // patches, so the ground does not read as one flat colour.
      const mottle = fbm(x * 0.5 + 7, z * 0.5 + 3, 2);
      tmp.lerp(cEarth, smoothstep(0.56, 0.82, mottle) * 0.38);
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
      // Riverbed variation under the waterline (sand / wet-sand noise),
      // so the shallows do not read as one flat colour through the
      // now much clearer shallow water (2026-11-06 water pass).
      if (h < this.cfg.world.waterLevel) {
        const bedN = fbm(x * 0.35 + 51, z * 0.35 + 23, 2);
        tmp.lerp(bedN > 0.55 ? cSand : cWetSand, 0.35);
      }
      if (h < this.cfg.world.waterLevel + 0.05) tmp.lerp(cUnderwater, 0.7);
      // Wet soil band just above the waterline: darker, slightly
      // saturated earth bridging dry bank and water.
      const wet =
        smoothstep(0.34, 0.03, h - this.cfg.world.waterLevel) *
        smoothstep(-0.06, 0.04, h - this.cfg.world.waterLevel);
      if (wet > 0) {
        tmp.lerp(cWetSand, wet * 0.45);
        tmp.multiplyScalar(1 - wet * 0.16);
      }
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
      // Splat weights (see buildTerrain head). Suppressed under
      // water (the riverbed ribbon owns the bed) and on rock.
      const aboveWater = smoothstep(this.cfg.world.waterLevel - 0.02, this.cfg.world.waterLevel + 0.3, h);
      const rockSuppress = 1 - clamp(rockiness, 0, 1) * 0.9;
      splat[i * 4] = clamp(forestMask * 0.95 + smoothstep(0.6, 0.85, mottle) * 0.4, 0, 0.95) * aboveWater * rockSuppress;
      splat[i * 4 + 1] = clamp(wet * 1.0 + clayMask * 0.8, 0, 0.95) * rockSuppress;
      splat[i * 4 + 2] = clamp(bank * 0.92, 0, 0.95) * aboveWater * rockSuppress;
      splat[i * 4 + 3] = clamp(pathMask * 1.1, 0, 0.96) * aboveWater;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.computeVertexNormals();

    detailTexture.repeat.set(46, 46);
    const b = this.detailBrightness;
    const mat = new THREE.MeshStandardMaterial({
      map: detailTexture,
      color: new THREE.Color(b, b, b),
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    // Tiling ground textures (assets/gpt-expansion/): the painterly
    // forest floor / mud / sand / path tiles are mixed over the
    // vertex colours by the per-vertex splat weights, so material
    // boundaries follow the terrain masks (shores, moisture, the
    // path) instead of square texture borders. Each tile is scaled
    // toward the local vertex-colour luminance so the blend keeps
    // the scene's overall light. Missing textures = plain vertex
    // colour terrain, exactly as before.
    const gt = groundTextures ?? {};
    if (gt.forest && gt.mud && gt.sand && gt.path) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uGroundForest = { value: gt.forest };
        shader.uniforms.uGroundMud = { value: gt.mud };
        shader.uniforms.uGroundSand = { value: gt.sand };
        shader.uniforms.uGroundPath = { value: gt.path };
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vWPos;',
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvSplat = splat;\nvWPos = position.xz;',
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
              'varying vec4 vSplat;',
              'varying vec2 vWPos;',
            ].join('\n'),
          )
          .replace(
            '#include <map_fragment>',
            [
              '#include <map_fragment>',
              '{',
              '  float lum = dot(diffuseColor.rgb, vec3(0.3333));',
              '  float tintF = clamp(0.45 + 1.1 * lum, 0.6, 1.25);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundForest, vWPos / 7.0).rgb * tintF, vSplat.x * 0.88);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundMud, vWPos / 5.0).rgb * tintF, vSplat.y * 0.9);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundSand, vWPos / 6.0).rgb * tintF, vSplat.z * 0.92);',
              '  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uGroundPath, vWPos / 5.0).rgb * tintF, vSplat.w * 0.94);',
              '}',
            ].join('\n'),
          );
      };
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'Terrain';
    return mesh;
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
        const bed = terrainHeight(x, z, this.cfg);
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
  /**
   * The water surface (layer 2 of the 2026-11-06 water pass). A ribbon
   * with cross-resolution so every vertex carries the true water depth
   * (waterLevel - bed height) and the local flow direction. The shader
   * grades colour/opacity by depth, runs two dot-dash ripple layers
   * along the flow at different scales/speeds, grows a broken foam
   * edge where the water is shallow, and adds a restrained sun glint.
   * No full-surface sheen, no jelly wobble, no saturated cyan.
   */
  private buildWater(): THREE.Mesh {
    const { size, waterLevel } = this.cfg.world;
    const w = this.cfg.water;
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
        depths.push(clamp(waterLevel - terrainHeight(x, z, this.cfg), 0, 2.2));
        flows.push(fx, fz);
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + across + 1;
        // Same up-facing winding as the old 2-point ribbon.
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const detail = this.quality === 'high' ? 1 : 0;
    this.waterUniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
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
        // at most one, scrolling downstream. First version made the
        // dashes long along the flow and wide across it; at the
        // exploration zoom they read as pale rectangular slabs, so the
        // proportions are now: long across, thin along the flow.
        float dashLayer(vec2 fs, float cellWid, float speed, float seed) {
          vec2 q = vec2(fs.x / cellWid, (fs.y - uTime * speed) / (cellWid * 1.5));
          vec2 cell = floor(q) + seed;
          vec2 f = fract(q) - 0.5;
          float rnd = hash(cell);
          // Per-dash rotation breaks the grid regimentation (second
          // iteration: unrotated uniform dashes read as floating planks).
          float ang = (hash(cell + 23.0) - 0.5) * 0.7;
          float ca = cos(ang);
          float sa = sin(ang);
          f = mat2(ca, -sa, sa, ca) * f + 0.5;
          // crest line: spans part of the cell across the flow...
          float x0 = 0.08 + rnd * 0.2;
          float x1 = x0 + 0.35 + hash(cell + 7.0) * 0.5;
          float across = smoothstep(x0, x0 + 0.1, f.x) * smoothstep(x1, x1 - 0.1, f.x);
          // ...but is thin along the flow, at a hashed position.
          float yc = 0.2 + hash(cell + 3.0) * 0.6;
          float thin = smoothstep(0.16, 0.05, abs(f.y - yc));
          float keep = step(0.42, hash(cell + 13.0));
          // Many dashes are faint; only some catch the light fully.
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
          // Lighten toward a pale tint instead of adding white, and do
          // not raise alpha: additive dashes read as milky chips.
          vec3 rippleTint = mix(uShallow, vec3(1.0), 0.25);
          col = mix(col, rippleTint, clamp(ripple, 0.0, 1.0) * uRippleStrength * 1.7);
          // Slow large-scale brightness drift (current shading only).
          float drift = sin(fs.y * 0.33 - uTime * 0.22 + sin(fs.x * 0.5) * 1.2) * 0.5 + 0.5;
          col *= 0.97 + drift * 0.05;
          // Restrained sun glint: sparse, and only on deeper water.
          float glint = step(0.988, hash(floor(fs * 6.0) + floor(uTime * 3.0))) * uGlint;
          col += glint * depthK;
          // Broken foam edge where the water gets very shallow. The
          // band follows the true shoreline (depth field), so it is
          // irregular, and the dash noise breaks it into dots.
          float foamBand = smoothstep(uFoamDepth, uFoamDepth * 0.25, vDepth);
          float foamNoise = dashLayer(fs + 7.3, 0.45, uRippleSpeed * 0.6, 41.0)
                          + dashLayer(fs * 1.7 + 3.1, 0.3, uRippleSpeed * 0.8, 57.0) * 0.7;
          float foam = foamBand * smoothstep(0.5, 0.9, foamNoise) * uFoamStrength;
          col = mix(col, vec3(0.96, 0.985, 1.0), foam);
          alpha = clamp(alpha + foam * 0.45, 0.0, 1.0);
          // The very edge keeps only a wet sheen, never a hard line.
          alpha *= 0.22 + 0.78 * smoothstep(0.0, 0.1, vDepth);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'RiverWater';
    mesh.renderOrder = 2;
    return mesh;
  }
}
