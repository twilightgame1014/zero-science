import * as THREE from 'three';
import type { EffectType, Vec3Like } from './types';

interface Burst {
  points: THREE.Points | null;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  baseOpacity: number;
  /** Exhaust plume cones (round 30); flicker while the burst lives. */
  cones?: THREE.Mesh[];
  /** Billboard puffs (padSmoke only): sprite points render as
   *  tiny dots at this module's render scale, so smoke needs
   *  world-sized sprites to read as smoke at all. */
  puffs?: { sprite: THREE.Sprite; vel: THREE.Vector3; grow: number }[];
}

interface EffectStyle {
  color: number;
  count: number;
  speed: number;
  gravity: number;
  size: number;
  life: number;
  /** Vertical velocity multiplier: -1 fires the burst downward. */
  dirY?: number;
  /** 0..1: flatten the upward bias (pad smoke rolls sideways). */
  flat?: number;
  /** Initial spawn disc radius (a point spawn reads as specks). */
  spread?: number;
  /** Base opacity override (dense smoke reads better faded). */
  opacity?: number;
}

const EFFECT_STYLE: Record<string, EffectStyle> = {
  sparkle: { color: 0xffe066, count: 22, speed: 2.2, gravity: -0.4, size: 0.3, life: 0.8 },
  discovery: { color: 0x9df2ff, count: 30, speed: 2.8, gravity: -0.8, size: 0.34, life: 1.1 },
  levelup: { color: 0xffd94d, count: 36, speed: 3.2, gravity: -1.2, size: 0.36, life: 1.2 },
  splash: { color: 0x7fd4ff, count: 26, speed: 2.6, gravity: 6.5, size: 0.26, life: 0.7 },
  leaves: { color: 0x77c255, count: 20, speed: 1.8, gravity: 1.6, size: 0.3, life: 1.1 },
  smoke: { color: 0xbbbbbb, count: 14, speed: 0.9, gravity: -1.6, size: 0.55, life: 1.4 },
  // Round 30 (space): rocket exhaust plume segment. One play is
  // ~1.1 s of plume; the game re-triggers at the current exhaust
  // position while ascending (every ~0.25 s) for a continuous
  // trail, and once at the pad's Anchor_exhaust at ignition.
  exhaust: { color: 0xffc37e, count: 90, speed: 5.5, gravity: 3.0, size: 0.6, life: 1.1, dirY: -1, spread: 0.5 },
  // Round 30 (space): launch-pad smoke from Anchor_smoke_l/r.
  // count 0: no sprite points — the puff sprites are built
  // separately in play() (world-sized, growing, rolling out).
  padSmoke: { color: 0xcfc8bd, count: 0, speed: 0, gravity: 0, size: 1, life: 3.4 },
};

/**
 * One-shot visual effects (particle bursts). Purely cosmetic:
 * playing an effect never implies anything about game state.
 */
export class EffectsManager {
  readonly group = new THREE.Group();
  private bursts: Burst[] = [];
  private particleTexture: THREE.Texture;
  private smokeTexture: THREE.Texture | null = null;
  private groundHeightAt: (x: number, z: number) => number;

  /** Soft irregular puff for pad smoke: the shared particle
   *  texture is a tight dot, which reads as specks at smoke
   *  sizes, so padSmoke gets its own overlapping-blob canvas. */
  private getSmokeTexture(): THREE.Texture {
    if (this.smokeTexture) return this.smokeTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    let seed = 4241;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 11; i++) {
      const cx = 30 + rnd() * 68;
      const cy = 30 + rnd() * 68;
      const r = 20 + rnd() * 30;
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
    }
    this.smokeTexture = new THREE.CanvasTexture(canvas);
    return this.smokeTexture;
  }

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
      const sa = Math.random() * Math.PI * 2;
      const sr = Math.sqrt(Math.random()) * (style.spread ?? 0);
      positions[i * 3] = position.x + Math.cos(sa) * sr;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 2] = position.z + Math.sin(sa) * sr;
      const a = Math.random() * Math.PI * 2;
      const up = (Math.random() * 0.9 + 0.35) * (1 - (style.flat ?? 0));
      const r = (Math.random() * 0.7 + 0.3) * style.speed;
      velocities[i * 3] = Math.cos(a) * r * 0.6;
      velocities[i * 3 + 1] = up * style.speed * 0.7 * (style.dirY ?? 1);
      velocities[i * 3 + 2] = Math.sin(a) * r * 0.6;
    }
    let points: THREE.Points | null = null;
    if (style.count > 0) {
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
      points = new THREE.Points(geo, mat);
      points.renderOrder = 6;
      this.group.add(points);
    }
    const burst: Burst = {
      points,
      velocities,
      life: 0,
      maxLife: style.life,
      gravity: style.gravity,
      baseOpacity: style.opacity ?? 0.95,
    };
    if (type === 'padSmoke') {
      // Launch-pad smoke as world-sized billboard puffs: they
      // spawn around the anchor, roll outward along the deck,
      // grow and fade over the burst life.
      burst.puffs = [];
      const baseY = this.groundHeightAt(position.x, position.z);
      for (let i = 0; i < 10; i++) {
        const mat = new THREE.SpriteMaterial({
          map: this.getSmokeTexture(),
          color: style.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        const a = Math.random() * Math.PI * 2;
        const r0 = Math.sqrt(Math.random()) * 1.5;
        sprite.position.set(
          position.x + Math.cos(a) * r0,
          baseY + 0.7 + Math.random() * 0.8,
          position.z + Math.sin(a) * r0,
        );
        const s0 = 3.6 + Math.random() * 1.8;
        sprite.scale.set(s0, s0 * 0.72, 1);
        sprite.renderOrder = 6;
        this.group.add(sprite);
        const dir = Math.random() * Math.PI * 2;
        const out = 1.6 + Math.random() * 2.2;
        burst.puffs.push({
          sprite,
          vel: new THREE.Vector3(Math.cos(dir) * out, 0.35 + Math.random() * 0.4, Math.sin(dir) * out),
          grow: 1.5 + Math.random() * 1.1,
        });
      }
    }
    if (type === 'exhaust') {
      // Plume body: two nested additive cones under the nozzle,
      // apex at the exhaust point, opening downward. Sized for
      // the 3.4 m rocket (radius ~1.2 m). Length reaches toward
      // the ground but is capped, so at ignition the plume ends
      // at the pad deck instead of spearing through it, and in
      // flight it keeps a fixed ~6.5 m body.
      const groundY = this.groundHeightAt(position.x, position.z);
      const plumeLen = Math.min(6.5, Math.max(2.2, y - groundY + 0.4));
      burst.cones = [];
      const coneSpecs = [
        { radius: 1.25, color: 0xff8f3f, opacity: 0.34 },
        { radius: 0.7, color: 0xffe9b0, opacity: 0.55 },
      ];
      for (const spec of coneSpecs) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(spec.radius, plumeLen, 14, 1, true),
          new THREE.MeshBasicMaterial({
            color: spec.color,
            transparent: true,
            opacity: spec.opacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
        cone.rotation.z = Math.PI;
        cone.position.set(position.x, y - plumeLen / 2, position.z);
        cone.userData.baseOpacity = spec.opacity;
        cone.renderOrder = 7;
        this.group.add(cone);
        burst.cones.push(cone);
      }
    }
    this.bursts.push(burst);
  }

  update(dt: number): void {
    for (let bi = this.bursts.length - 1; bi >= 0; bi--) {
      const b = this.bursts[bi];
      b.life += dt;
      const t = b.life / b.maxLife;
      if (b.points) {
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
        (b.points.material as THREE.PointsMaterial).opacity = b.baseOpacity * (1 - t);
      }
      if (b.puffs) {
        const fade = Math.min(1, b.life / 0.35) * (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
        for (const puff of b.puffs) {
          puff.sprite.position.addScaledVector(puff.vel, dt);
          const s = puff.sprite.scale.x + puff.grow * dt;
          puff.sprite.scale.set(s, s * 0.72, 1);
          (puff.sprite.material as THREE.SpriteMaterial).opacity = 0.42 * fade;
        }
      }
      if (b.cones) {
        const flicker = 1 + Math.sin(b.life * 42) * 0.07 + Math.sin(b.life * 91) * 0.05;
        const fadeIn = Math.min(1, b.life / 0.08);
        const fade = fadeIn * (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
        for (const cone of b.cones) {
          cone.scale.set(flicker, 1 + Math.sin(b.life * 37) * 0.05, flicker);
          (cone.material as THREE.MeshBasicMaterial).opacity =
            (cone.userData.baseOpacity as number) * fade;
        }
      }
      if (t >= 1) {
        if (b.points) {
          this.group.remove(b.points);
          b.points.geometry.dispose();
          (b.points.material as THREE.Material).dispose();
        }
        if (b.puffs) {
          for (const puff of b.puffs) {
            this.group.remove(puff.sprite);
            (puff.sprite.material as THREE.Material).dispose();
          }
        }
        if (b.cones) {
          for (const cone of b.cones) {
            this.group.remove(cone);
            cone.geometry.dispose();
            (cone.material as THREE.Material).dispose();
          }
        }
        this.bursts.splice(bi, 1);
      }
    }
  }

  dispose(): void {
    for (const b of this.bursts) {
      if (b.points) {
        this.group.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
      }
      if (b.puffs) {
        for (const puff of b.puffs) {
          this.group.remove(puff.sprite);
          (puff.sprite.material as THREE.Material).dispose();
        }
      }
      if (b.cones) {
        for (const cone of b.cones) {
          this.group.remove(cone);
          cone.geometry.dispose();
          (cone.material as THREE.Material).dispose();
        }
      }
    }
    this.bursts = [];
  }
}
