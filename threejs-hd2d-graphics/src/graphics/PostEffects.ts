import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * The HD-2D "look" chain, kept deliberately small:
 *   render -> bloom (lamp glow, sun sparkle)
 *          -> tilt-shift + colour grade + vignette (single custom pass)
 *          -> output (tone mapping / sRGB)
 *
 * The tilt-shift band is HD-2D's signature: a sharp horizontal focus
 * strip with soft blur above and below, like a miniature diorama.
 * Enable on capable devices only; the module renders identically
 * (minus the look) without it.
 */
const TiltShiftGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uFocus: { value: 0.52 },
    // Softened from 0.0075 for the closer exploration camera
    // (2026-11-06): resource nodes and paths must stay readable, so
    // the tilt-shift blur now only kisses the frame edges.
    uBlur: { value: 0.0052 },
    uWarmth: { value: 0.06 },
    uSaturation: { value: 1.13 },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFocus;
    uniform float uBlur;
    uniform float uWarmth;
    uniform float uSaturation;
    uniform float uVignette;
    varying vec2 vUv;

    vec3 blurSample(vec2 uv, float amt) {
      vec3 acc = texture2D(tDiffuse, uv).rgb * 0.2;
      vec2 o1 = vec2(amt, amt * 0.6);
      vec2 o2 = vec2(-amt, amt * 0.6);
      vec2 o3 = vec2(amt * 0.6, -amt);
      vec2 o4 = vec2(-amt * 0.6, -amt);
      acc += texture2D(tDiffuse, uv + o1).rgb * 0.2;
      acc += texture2D(tDiffuse, uv + o2).rgb * 0.2;
      acc += texture2D(tDiffuse, uv + o3).rgb * 0.2;
      acc += texture2D(tDiffuse, uv + o4).rgb * 0.2;
      return acc;
    }

    void main() {
      float dist = abs(vUv.y - uFocus);
      float amt = uBlur * smoothstep(0.06, 0.48, dist);
      vec3 sharp = texture2D(tDiffuse, vUv).rgb;
      vec3 col = mix(sharp, blurSample(vUv, amt), clamp(amt / max(uBlur, 0.0001), 0.0, 1.0));

      // Warm cinematic grade.
      col.r += uWarmth * 0.35 * (1.0 - col.r);
      col.b -= uWarmth * 0.22 * col.b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSaturation);

      // Vignette.
      float d = distance(vUv, vec2(0.5, 0.46));
      col *= 1.0 - uVignette * smoothstep(0.48, 1.02, d);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostEffects {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private gradePass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1280, 720),
      0.38, // strength
      0.55, // radius
      0.82, // threshold — only lamps / speculars / bright sky bloom
    );
    this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(TiltShiftGradeShader);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  /** Focus band height in UV space (0.5 = screen centre). */
  setFocus(v: number): void {
    (this.gradePass.uniforms as Record<string, { value: unknown }>).uFocus.value = v;
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
