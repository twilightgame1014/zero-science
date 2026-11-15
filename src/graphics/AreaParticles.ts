import * as THREE from 'three';
import type { QualityTier } from './types';

export type ParticleKind = 'none' | 'snow' | 'ash' | 'sand' | 'spray';

/**
 * Area atmosphere particles (spec §5): one Points cloud that lives
 * in a box around the camera focus and recycles inside it — falling
 * snow in the snowfield, drifting ash at the volcano, wind-blown
 * sand in the desert, sea spray at the coast. The kind follows the
 * dominant area at the player; counts follow the quality tier.
 * Purely cosmetic, always kept subtle: particles must never wash
 * out the ground or the harvest targets near the player.
 */
const BOX = { w: 46, h: 15, d: 46 };

const KIND_STYLE: Record<Exclude<ParticleKind, 'none'>, { color: number; size: number; opacity: number }> = {
  snow: { color: 0xf4f8ff, size: 0.17, opacity: 0.75 },
  ash: { color: 0x8a7f74, size: 0.13, opacity: 0.5 },
  sand: { color: 0xe3c98f, size: 0.11, opacity: 0.42 },
  spray: { color: 0xeaf6ff, size: 0.2, opacity: 0.3 },
};

export class AreaParticles {
  readonly points: THREE.Points;
  private kind: ParticleKind = 'none';
  private positions: Float32Array;
  private seeds: Float32Array;
  private material: THREE.PointsMaterial;
  private count: number;

  constructor(texture: THREE.Texture, quality: QualityTier) {
    this.count = quality === 'high' ? 650 : 240;
    this.positions = new Float32Array(this.count * 3);
    this.seeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * BOX.w;
      this.positions[i * 3 + 1] = Math.random() * BOX.h;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * BOX.d;
      this.seeds[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.15,
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: 0xffffff,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
  }

  setKind(kind: ParticleKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    if (kind === 'none') {
      this.points.visible = false;
      return;
    }
    const style = KIND_STYLE[kind];
    this.material.color.set(style.color);
    this.material.size = style.size;
    this.material.opacity = style.opacity;
    this.points.visible = true;
  }

  getKind(): ParticleKind {
    return this.kind;
  }

  /**
   * Advance the cloud. Positions are kept in a box around the focus
   * by wrapping: each axis is taken modulo the box size relative to
   * the focus, so the cloud follows the player without ever being
   * rebuilt.
   */
  update(dt: number, focus: { x: number; y: number; z: number }, time: number): void {
    if (this.kind === 'none' || dt <= 0) return;
    const p = this.positions;
    const baseY = focus.y;
    for (let i = 0; i < this.count; i++) {
      const seed = this.seeds[i];
      let vx = 0, vy = 0, vz = 0;
      switch (this.kind) {
        case 'snow':
          vx = -0.35 + Math.sin(time * 0.9 + seed) * 0.35;
          vy = -1.15;
          vz = 0.25 + Math.cos(time * 0.7 + seed * 1.3) * 0.25;
          break;
        case 'ash':
          vx = 0.55 + Math.sin(time * 0.5 + seed) * 0.3;
          vy = -0.55;
          vz = 0.3;
          break;
        case 'sand':
          vx = -6.0;
          vy = -0.35 + Math.sin(time * 2.2 + seed * 2.0) * 0.3;
          vz = 1.1;
          break;
        case 'spray':
          vx = 0.25;
          vy = 0.55 + Math.sin(time * 1.3 + seed) * 0.2;
          vz = 0.1;
          break;
      }
      let x = p[i * 3] + vx * dt;
      let y = p[i * 3 + 1] + vy * dt;
      let z = p[i * 3 + 2] + vz * dt;
      // Wrap into the focus-centred box (y is absolute: [baseY, baseY+h]).
      x = focus.x + wrapAxis(x - focus.x, BOX.w);
      z = focus.z + wrapAxis(z - focus.z, BOX.d);
      const relY = y - baseY;
      y = baseY + ((relY % BOX.h) + BOX.h) % BOX.h;
      p[i * 3] = x;
      p[i * 3 + 1] = y;
      p[i * 3 + 2] = z;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

function wrapAxis(v: number, size: number): number {
  const half = size / 2;
  return ((((v + half) % size) + size) % size) - half;
}
