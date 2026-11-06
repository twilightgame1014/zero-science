import * as THREE from 'three';
import type { EffectType, Vec3Like } from './types';

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  baseOpacity: number;
}

const EFFECT_STYLE: Record<string, { color: number; count: number; speed: number; gravity: number; size: number; life: number }> = {
  sparkle: { color: 0xffe066, count: 22, speed: 2.2, gravity: -0.4, size: 0.3, life: 0.8 },
  discovery: { color: 0x9df2ff, count: 30, speed: 2.8, gravity: -0.8, size: 0.34, life: 1.1 },
  levelup: { color: 0xffd94d, count: 36, speed: 3.2, gravity: -1.2, size: 0.36, life: 1.2 },
  splash: { color: 0x7fd4ff, count: 26, speed: 2.6, gravity: 6.5, size: 0.26, life: 0.7 },
  leaves: { color: 0x77c255, count: 20, speed: 1.8, gravity: 1.6, size: 0.3, life: 1.1 },
  smoke: { color: 0xbbbbbb, count: 14, speed: 0.9, gravity: -1.6, size: 0.55, life: 1.4 },
};

/**
 * One-shot visual effects (particle bursts). Purely cosmetic:
 * playing an effect never implies anything about game state.
 */
export class EffectsManager {
  readonly group = new THREE.Group();
  private bursts: Burst[] = [];
  private particleTexture: THREE.Texture;
  private groundHeightAt: (x: number, z: number) => number;

  constructor(
    particleTexture: THREE.Texture,
    groundHeightAt: (x: number, z: number) => number,
  ) {
    this.particleTexture = particleTexture;
    this.groundHeightAt = groundHeightAt;
  }

  play(type: EffectType, position: Vec3Like): void {
    const style = EFFECT_STYLE[type] ?? EFFECT_STYLE.sparkle;
    const y = position.y ?? this.groundHeightAt(position.x, position.z) + 0.8;
    const positions = new Float32Array(style.count * 3);
    const velocities = new Float32Array(style.count * 3);
    for (let i = 0; i < style.count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = position.z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.35;
      const r = (Math.random() * 0.7 + 0.3) * style.speed;
      velocities[i * 3] = Math.cos(a) * r * 0.6;
      velocities[i * 3 + 1] = up * style.speed * 0.7;
      velocities[i * 3 + 2] = Math.sin(a) * r * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: this.particleTexture,
      color: style.color,
      size: style.size,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: type === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 6;
    this.group.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: style.life,
      gravity: style.gravity,
      baseOpacity: 0.95,
    });
  }

  update(dt: number): void {
    for (let bi = this.bursts.length - 1; bi >= 0; bi--) {
      const b = this.bursts[bi];
      b.life += dt;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = b.velocities[i * 3];
        let vy = b.velocities[i * 3 + 1];
        const vz = b.velocities[i * 3 + 2];
        vy -= b.gravity * dt;
        b.velocities[i * 3 + 1] = vy;
        pos.setXYZ(
          i,
          pos.getX(i) + vx * dt,
          pos.getY(i) + vy * dt,
          pos.getZ(i) + vz * dt,
        );
      }
      pos.needsUpdate = true;
      const t = b.life / b.maxLife;
      (b.points.material as THREE.PointsMaterial).opacity = b.baseOpacity * (1 - t);
      if (t >= 1) {
        this.group.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(bi, 1);
      }
    }
  }

  dispose(): void {
    for (const b of this.bursts) {
      this.group.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
    }
    this.bursts = [];
  }
}
