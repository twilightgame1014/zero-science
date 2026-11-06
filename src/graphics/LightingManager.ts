import * as THREE from 'three';
import type { QualityTier } from './types';
import { clamp, lerp } from './utils';

/**
 * Sun, ambient fill, sky colour and fog.
 * Time of day is a *visual* parameter only — the module never derives
 * game state (date, season, energy) from it.
 */
export class LightingManager {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  private scene: THREE.Scene;
  private quality: QualityTier;
  private timeOfDay = 0.22; // morning

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

    scene.fog = new THREE.Fog(0xcfe4ef, 70, 165);
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
    const fog = this.scene.fog as THREE.Fog;
    switch (weather) {
      case 'clear':
        fog.near = 70; fog.far = 165; break;
      case 'cloudy':
        fog.near = 55; fog.far = 140; break;
      case 'rain':
        fog.near = 45; fog.far = 120; break;
      case 'fog':
        fog.near = 22; fog.far = 80; break;
    }
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
    this.sun.intensity = lerp(0.25, 2.7, dayAmount);
    this.fill.intensity = lerp(0.35, 0.9, dayAmount);

    const skyDay = new THREE.Color(0xa8d4f0);
    const skyDusk = new THREE.Color(0xf2b183);
    const skyNight = new THREE.Color(0x1d2b45);
    const sky = new THREE.Color();
    if (elevation > 0.12) sky.copy(skyDusk).lerp(skyDay, clamp((elevation - 0.12) * 2.4, 0, 1));
    else sky.copy(skyNight).lerp(skyDusk, clamp((elevation + 0.25) * 2.7, 0, 1));
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky).lerp(new THREE.Color(0xffffff), 0.18);
  }
}
