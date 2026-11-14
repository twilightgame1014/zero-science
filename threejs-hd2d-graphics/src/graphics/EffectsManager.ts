import * as THREE from 'three';
import type { EffectType, Vec3Like } from './types';

/** Persistent rocket exhaust (round 30 follow-up): a plume
 *  that follows the body instead of one-shot bursts. */
interface ExhaustEmitter {
  cones: THREE.Mesh[];
  points: THREE.Points;
  vel: Float32Array;
  age: Float32Array;
  life: Float32Array;
  origin: THREE.Vector3;
  spawnAcc: number;
  ring: number;
  /** Cone fade: 1 while thrusting, eases to 0 after stop. */
  fade: number;
  stopping: boolean;
  time: number;
}

const EXHAUST_POOL = 260;

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
  private exhaust: ExhaustEmitter | null = null;
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

  /**
   * Persistent exhaust that follows the rocket (round 30
   * follow-up, replacing the re-fired 'exhaust' bursts during
   * ascent). Call every frame with the current Anchor_exhaust
   * world position while thrusting; pass null to stop. The
   * plume cones track the position, and jet particles are
   * emitted at the current origin but keep their world
   * motion, so the trail lags behind the climbing body.
   */
  setExhaustEmitter(position: Vec3Like | null): void {
    if (position === null) {
      if (this.exhaust) this.exhaust.stopping = true;
      return;
    }
    const y = position.y ?? this.groundHeightAt(position.x, position.z) + 0.9;
    if (!this.exhaust) {
      const cones: THREE.Mesh[] = [];
      const coneSpecs = [
        { radius: 1.25, color: 0xff8f3f, opacity: 0.34 },
        { radius: 0.7, color: 0xffe9b0, opacity: 0.55 },
      ];
      for (const spec of coneSpecs) {
        // Unit-height cone, scaled per frame to the plume
        // length (scale.y only stretches the height).
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(spec.radius, 1, 14, 1, true),
          new THREE.MeshBasicMaterial({
            color: spec.color,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
        cone.rotation.z = Math.PI;
        cone.userData.baseOpacity = spec.opacity;
        cone.renderOrder = 7;
        this.group.add(cone);
        cones.push(cone);
      }
      const positions = new Float32Array(EXHAUST_POOL * 3);
      const colors = new Float32Array(EXHAUST_POOL * 3);
      for (let i = 0; i < EXHAUST_POOL; i++) positions[i * 3 + 1] = -10000;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          map: this.particleTexture,
          size: 0.85,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexColors: true,
        }),
      );
      points.renderOrder = 6;
      points.frustumCulled = false;
      this.group.add(points);
      const life = new Float32Array(EXHAUST_POOL).fill(0.5);
      this.exhaust = {
        cones,
        points,
        vel: new Float32Array(EXHAUST_POOL * 3),
        age: new Float32Array(EXHAUST_POOL).fill(1),
        life,
        origin: new THREE.Vector3(position.x, y, position.z),
        spawnAcc: 0,
        ring: 0,
        fade: 0,
        stopping: false,
        time: 0,
      };
    }
    this.exhaust.origin.set(position.x, y, position.z);
    this.exhaust.stopping = false;
  }

  private updateExhaust(dt: number): void {
    const ex = this.exhaust;
    if (!ex) return;
    ex.time += dt;
    const target = ex.stopping ? 0 : 1;
    const step = dt / (ex.stopping ? 0.3 : 0.08);
    ex.fade += Math.sign(target - ex.fade) * Math.min(Math.abs(target - ex.fade), step);
    const groundY = this.groundHeightAt(ex.origin.x, ex.origin.z);
    const len = Math.min(6.5, Math.max(2.2, ex.origin.y - groundY + 0.4));
    const flicker = 1 + Math.sin(ex.time * 42) * 0.07 + Math.sin(ex.time * 91) * 0.05;
    for (const cone of ex.cones) {
      cone.position.set(ex.origin.x, ex.origin.y - len / 2, ex.origin.z);
      cone.scale.set(flicker, len, flicker);
      (cone.material as THREE.MeshBasicMaterial).opacity =
        (cone.userData.baseOpacity as number) * ex.fade;
    }
    const pos = ex.points.geometry.attributes.position as THREE.BufferAttribute;
    const col = ex.points.geometry.attributes.color as THREE.BufferAttribute;
    if (!ex.stopping) {
      ex.spawnAcc += dt * 110;
      while (ex.spawnAcc >= 1) {
        ex.spawnAcc -= 1;
        for (let tries = 0; tries < EXHAUST_POOL; tries++) {
          const i = (ex.ring + tries) % EXHAUST_POOL;
          if (ex.age[i] < ex.life[i]) continue;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * 0.45;
          pos.setXYZ(i, ex.origin.x + Math.cos(a) * r, ex.origin.y - 0.15, ex.origin.z + Math.sin(a) * r);
          ex.vel[i * 3] = (Math.random() - 0.5) * 1.4;
          ex.vel[i * 3 + 1] = -(5.0 + Math.random() * 2.2);
          ex.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
          ex.age[i] = 0;
          ex.life[i] = 0.45 + Math.random() * 0.3;
          ex.ring = i + 1;
          break;
        }
      }
    }
    let anyAlive = false;
    for (let i = 0; i < EXHAUST_POOL; i++) {
      if (ex.age[i] >= ex.life[i]) continue;
      ex.age[i] += dt;
      if (ex.age[i] >= ex.life[i]) {
        pos.setY(i, -10000);
        col.setXYZ(i, 0, 0, 0);
        continue;
      }
      anyAlive = true;
      let vx = ex.vel[i * 3];
      let vy = ex.vel[i * 3 + 1];
      let vz = ex.vel[i * 3 + 2];
      vy += (-1.6 - vy) * 1.6 * dt;
      vx *= 1 - 0.8 * dt;
      vz *= 1 - 0.8 * dt;
      ex.vel[i * 3] = vx;
      ex.vel[i * 3 + 1] = vy;
      ex.vel[i * 3 + 2] = vz;
      pos.setXYZ(i, pos.getX(i) + vx * dt, pos.getY(i) + vy * dt, pos.getZ(i) + vz * dt);
      const heat = (1 - ex.age[i] / ex.life[i]) * 0.9;
      col.setXYZ(i, heat, heat * 0.7, heat * 0.36);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (ex.stopping && ex.fade <= 0 && !anyAlive) {
      for (const cone of ex.cones) {
        this.group.remove(cone);
        cone.geometry.dispose();
        (cone.material as THREE.Material).dispose();
      }
      this.group.remove(ex.points);
      ex.points.geometry.dispose();
      (ex.points.material as THREE.Material).dispose();
      this.exhaust = null;
    }
  }

  update(dt: number): void {
    this.updateExhaust(dt);
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
    if (this.exhaust) {
      for (const cone of this.exhaust.cones) {
        this.group.remove(cone);
        cone.geometry.dispose();
        (cone.material as THREE.Material).dispose();
      }
      this.group.remove(this.exhaust.points);
      this.exhaust.points.geometry.dispose();
      (this.exhaust.points.material as THREE.Material).dispose();
      this.exhaust = null;
    }
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
