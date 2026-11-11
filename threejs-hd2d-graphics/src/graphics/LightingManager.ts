import * as THREE from 'three';
import type { AreaId, QualityTier } from './types';
import { clamp, dampFactor, lerp } from './utils';

/**
 * Sun, ambient fill, sky colour and fog.
 * Time of day is a *visual* parameter only — the module never derives
 * game state (date, season, energy) from it.
 *
 * On top of the time-of-day base, the world-expansion environment
 * (spec §5) blends per-area fog / sky tint / light levels: the game
 * hands over area weights (areaWeights in utils.ts) and this manager
 * damps toward the blended target, so crossing an area boundary
 * never pops. Weather still scales the fog on top.
 */
export interface EnvPreset {
  fogNear: number;
  fogFar: number;
  skyTint: THREE.Color;
  tintAmount: number;
  sunMul: number;
  fillMul: number;
}

const PRESETS: Record<AreaId, EnvPreset> = {
  forest: { fogNear: 88, fogFar: 420, skyTint: new THREE.Color(0xffffff), tintAmount: 0, sunMul: 1, fillMul: 1 },
  lakeside: { fogNear: 88, fogFar: 430, skyTint: new THREE.Color(0xbfe0ee), tintAmount: 0.18, sunMul: 1.02, fillMul: 1.02 },
  coast: { fogNear: 95, fogFar: 460, skyTint: new THREE.Color(0xcfe8f2), tintAmount: 0.22, sunMul: 1.05, fillMul: 1.0 },
  volcano: { fogNear: 64, fogFar: 340, skyTint: new THREE.Color(0xeccfa8), tintAmount: 0.12, sunMul: 1.75, fillMul: 2.05 },
  snow: { fogNear: 80, fogFar: 380, skyTint: new THREE.Color(0xdcecf8), tintAmount: 0.3, sunMul: 1.06, fillMul: 1.05 },
  desert: { fogNear: 92, fogFar: 430, skyTint: new THREE.Color(0xf0dcb0), tintAmount: 0.3, sunMul: 1.08, fillMul: 0.95 },
  town: { fogNear: 88, fogFar: 420, skyTint: new THREE.Color(0xf2e3c2), tintAmount: 0.08, sunMul: 1, fillMul: 1 },
};

export class LightingManager {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  private scene: THREE.Scene;
  private quality: QualityTier;
  private timeOfDay = 0.22; // morning

  /** Time-of-day base values; the environment blend multiplies /
   *  tints these rather than replacing them. */
  private baseSky = new THREE.Color(0xa8d4f0);
  private baseSunIntensity = 2.6;
  private baseFillIntensity = 0.85;
  private weatherFog = { near: 88, far: 420 };
  /** Blended environment target + damped current values. */
  private envTarget: EnvPreset = PRESETS.forest;
  private curFogNear = 88;
  private curFogFar = 420;
  private curSunMul = 1;
  private curFillMul = 1;
  private curTint = new THREE.Color(0xffffff);
  private curTintAmount = 0;

  constructor(scene: THREE.Scene, quality: QualityTier) {
    this.scene = scene;
    this.quality = quality;

    this.fill = new THREE.HemisphereLight(0xbfd9ff, 0x53683f, 0.85);
    scene.add(this.fill);

    this.sun = new THREE.DirectionalLight(0xffe3b3, 2.6);
    this.sun.castShadow = true;
    const mapSize = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    const ext = 46;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Fog shapes only the far distance (2026-11-06), pushed further
    // out for the expanded world (backdrop ring now at ~300 m).
    scene.fog = new THREE.Fog(0xcfe4ef, 88, 420);
    this.applyTimeOfDay();
  }

  /** Keep the shadow frustum centred near wherever the camera looks. */
  updateShadowTarget(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(
      x + this.lastSunBase.x,
      this.lastSunBase.y,
      z + this.lastSunBase.z,
    );
    this.sun.target.updateMatrixWorld();
  }

  private lastSunBase = new THREE.Vector3(38, 52, 20);

  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this.applyTimeOfDay();
  }

  setWeather(weather: 'clear' | 'cloudy' | 'rain' | 'fog'): void {
    switch (weather) {
      case 'clear': this.weatherFog = { near: 88, far: 420 }; break;
      case 'cloudy': this.weatherFog = { near: 68, far: 330 }; break;
      case 'rain': this.weatherFog = { near: 52, far: 250 }; break;
      case 'fog': this.weatherFog = { near: 22, far: 85 }; break;
    }
  }

  /** Area environment (spec §5): blend the per-area presets by the
   *  weights at the player's position and damp toward the result. */
  setEnvironmentWeights(weights: Partial<Record<AreaId, number>>): void {
    let sum = 0;
    for (const k of Object.keys(weights) as AreaId[]) sum += weights[k] ?? 0;
    if (sum <= 0) return;
    const t: EnvPreset = {
      fogNear: 0, fogFar: 0, skyTint: new THREE.Color(0, 0, 0), tintAmount: 0, sunMul: 0, fillMul: 0,
    };
    for (const [id, preset] of Object.entries(PRESETS) as Array<[AreaId, EnvPreset]>) {
      const w = (weights[id] ?? 0) / sum;
      if (w <= 0) continue;
      t.fogNear += preset.fogNear * w;
      t.fogFar += preset.fogFar * w;
      t.skyTint.r += preset.skyTint.r * w;
      t.skyTint.g += preset.skyTint.g * w;
      t.skyTint.b += preset.skyTint.b * w;
      t.tintAmount += preset.tintAmount * w;
      t.sunMul += preset.sunMul * w;
      t.fillMul += preset.fillMul * w;
    }
    this.envTarget = t;
  }

  /** Per-frame damping of the environment blend + intensity apply. */
  update(dt: number): void {
    const k = dampFactor(1.6, dt);
    const fog = this.scene.fog as THREE.Fog;
    const targetNear = this.weatherFog.near * (this.envTarget.fogNear / 88);
    const targetFar = this.weatherFog.far * (this.envTarget.fogFar / 420);
    this.curFogNear += (targetNear - this.curFogNear) * k;
    this.curFogFar += (targetFar - this.curFogFar) * k;
    fog.near = this.curFogNear;
    fog.far = this.curFogFar;
    this.curSunMul += (this.envTarget.sunMul - this.curSunMul) * k;
    this.curFillMul += (this.envTarget.fillMul - this.curFillMul) * k;
    this.curTint.lerp(this.envTarget.skyTint, k);
    this.curTintAmount += (this.envTarget.tintAmount - this.curTintAmount) * k;
    this.sun.intensity = this.baseSunIntensity * this.curSunMul;
    this.fill.intensity = this.baseFillIntensity * this.curFillMul;
    const sky = new THREE.Color().copy(this.baseSky).lerp(this.curTint, this.curTintAmount);
    this.scene.background = sky;
    fog.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.18);
  }

  private applyTimeOfDay(): void {
    // Sun path: t=0 dawn (east, low), 0.25 noon, 0.5 dusk, night below.
    const angle = (this.timeOfDay - 0.25) * Math.PI * 2 + Math.PI / 2;
    const elevation = Math.sin(angle); // -1..1
    const dayAmount = clamp(elevation * 1.6 + 0.45, 0.06, 1);
    const azimuth = Math.cos(angle);
    this.lastSunBase.set(azimuth * 46, 18 + Math.max(elevation, 0.05) * 44, 26);
    this.sun.position.copy(this.lastSunBase);
    const warm = new THREE.Color(0xff9a3c);
    const noon = new THREE.Color(0xfff1d6);
    this.sun.color.copy(warm).lerp(noon, clamp(elevation * 2, 0, 1));
    this.baseSunIntensity = lerp(0.25, 2.7, dayAmount);
    this.baseFillIntensity = lerp(0.35, 0.9, dayAmount);

    const skyDay = new THREE.Color(0xa8d4f0);
    const skyDusk = new THREE.Color(0xf2b183);
    const skyNight = new THREE.Color(0x1d2b45);
    const sky = new THREE.Color();
    if (elevation > 0.12) sky.copy(skyDusk).lerp(skyDay, clamp((elevation - 0.12) * 2.4, 0, 1));
    else sky.copy(skyNight).lerp(skyDusk, clamp((elevation + 0.25) * 2.7, 0, 1));
    this.baseSky.copy(sky);
    // Snap the composed values once; update() damps from here.
    this.sun.intensity = this.baseSunIntensity * this.curSunMul;
    this.fill.intensity = this.baseFillIntensity * this.curFillMul;
    const composed = new THREE.Color().copy(this.baseSky).lerp(this.curTint, this.curTintAmount);
    this.scene.background = composed;
    (this.scene.fog as THREE.Fog).color.copy(composed).lerp(new THREE.Color(0xffffff), 0.18);
  }
}
