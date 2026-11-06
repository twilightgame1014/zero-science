import * as THREE from 'three';
import type { ResourceVisualState } from './types';
import { disposeObject } from './StructureRenderer';
import { AssetManager } from './AssetManager';
import { segmentPointDistance } from './utils';

interface Entry {
  group: THREE.Group;
  state: ResourceVisualState;
  pulseMaterials: THREE.MeshStandardMaterial[];
  /** Material opacities as built (fade multiplies these). */
  baseOpacities: number[];
  baseScale: number;
  /** Occlusion fade factor, 1 = fully visible. */
  fade: number;
  /** Ground ring shown while the node is highlighted. */
  ring: THREE.Mesh | null;
}

/** Scratch vector for the per-frame occlusion test (no allocation). */
const OCCL_POINT = new THREE.Vector3();

/** Deterministic vertex jitter (same input position -> same offset),
 *  so resource rocks share the environment rocks' craggy silhouette. */
function jitterRock(geo: THREE.BufferGeometry, amount = 0.16): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    v.multiplyScalar(1 - amount / 2 + (h - Math.floor(h)) * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/**
 * Logic-driven resource nodes (trees to harvest, ore rocks, herbs...).
 *
 * The game logic owns existence/amount/depletion; this class renders
 * whatever state it is handed, including the depleted variant
 * (stump / rubble / picked-clean) when state.depleted is true.
 */
export class ResourceRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private groundHeightAt: (x: number, z: number) => number;
  private barkTex: THREE.Texture;
  private foliageTex: THREE.Texture;
  private rockCrackTex: THREE.Texture;
  private gpt: Record<string, THREE.Texture>;
  /** Camera azimuth: sprite props stand facing it (the camera never orbits). */
  private yawRad: number;

  constructor(
    groundHeightAt: (x: number, z: number) => number,
    gpt: Record<string, THREE.Texture> = {},
    yawDegrees = 45,
  ) {
    this.groundHeightAt = groundHeightAt;
    this.gpt = gpt;
    this.yawRad = THREE.MathUtils.degToRad(yawDegrees);
    const am = new AssetManager();
    this.barkTex = am.createBarkTexture();
    this.foliageTex = am.createFoliageTexture();
    this.rockCrackTex = am.createRockCrackTexture();
  }

  setResource(id: string, state: ResourceVisualState | null): void {
    if (state === null || state.visible === false) {
      this.removeResource(id);
      return;
    }
    const prev = this.entries.get(id);
    const needsRebuild =
      !prev || prev.state.type !== state.type || prev.state.depleted !== state.depleted;
    if (needsRebuild) {
      this.removeResource(id);
      const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
      const built = this.buildNode(state, seed);
      built.group.position.set(
        state.position.x,
        state.position.y ?? this.groundHeightAt(state.position.x, state.position.z),
        state.position.z,
      );
      built.group.rotation.y = state.rotationY ?? 0;
      const s = state.scale ?? 1;
      built.group.scale.setScalar(s);
      this.group.add(built.group);
      this.entries.set(id, {
        group: built.group,
        state,
        pulseMaterials: built.pulseMaterials,
        baseOpacities: built.pulseMaterials.map((m) => m.opacity),
        baseScale: s,
        fade: 1,
        ring: null,
      });
    } else if (prev) {
      prev.state = state;
      prev.group.position.set(
        state.position.x,
        state.position.y ?? this.groundHeightAt(state.position.x, state.position.z),
        state.position.z,
      );
    }
  }

  removeResource(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.group.remove(entry.group);
    disposeObject(entry.group);
    this.entries.delete(id);
  }

  update(time: number): void {
    for (const entry of this.entries.values()) {
      const st = entry.state;
      const reacting = st.phase === 'reacting' && !st.depleted;
      // Harvest reaction (cosmetic only): the game sets phase while a
      // harvest is in progress; visuals return exactly to rest when it
      // ends, so a finished reaction can never leave a node tilted.
      if (reacting) {
        if (st.type === 'tree') {
          entry.group.rotation.z = Math.sin(time * 26) * 0.035;
          entry.group.rotation.x = Math.cos(time * 22) * 0.02;
        } else if (st.type === 'rock' || st.type === 'ore') {
          const j = 1 + Math.sin(time * 30) * 0.012;
          entry.group.scale.setScalar(entry.baseScale * j);
          entry.group.rotation.z = Math.sin(time * 30) * 0.008;
        } else if (st.type === 'water' || st.type === 'oil') {
          // Pools do not sway; the blink alone marks the interaction.
        } else {
          entry.group.rotation.z = Math.sin(time * 10) * 0.06;
        }
        // Warm blink, kept well below blow-out: the node must stay
        // identifiable while it reacts (verified against screenshots —
        // a 0.4 peak washed the whole tree white under bloom).
        const flash = Math.sin(time * 18) > 0 ? 0.2 : 0.02;
        for (const mat of entry.pulseMaterials) mat.emissive.setRGB(flash, flash * 0.85, flash * 0.55);
      } else {
        entry.group.rotation.x = 0;
        entry.group.rotation.z = 0;
        entry.group.scale.setScalar(entry.baseScale);
        for (const mat of entry.pulseMaterials) mat.emissive.setRGB(0, 0, 0);
      }
      // Highlight = a pulsing ring at the node's feet (2026-11-06,
      // Claude's request). The previous whole-node emissive pulse lit
      // up entire canopies and hid the player and name labels.
      if (st.highlighted === true && !st.depleted) {
        if (!entry.ring) {
          const r = (RESOURCE_VISUAL_SPECS[st.type]?.footprintRadius ?? 0.5) * 1.3;
          entry.ring = this.makeRing(r);
          entry.group.add(entry.ring);
        }
        entry.ring.visible = true;
        const m = entry.ring.material as THREE.MeshBasicMaterial;
        m.opacity = 0.55 + Math.sin(time * 5) * 0.2;
      } else if (entry.ring) {
        entry.ring.visible = false;
      }
    }
  }

  private makeRing(radius: number): THREE.Mesh {
    const geo = new THREE.RingGeometry(0.84, 1, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd75e,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.07;
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 3;
    return mesh;
  }

  /**
   * Fade tall nodes (trees, rocks, ore, bushes) that block the
   * camera's line of sight to the player — the same treatment the
   * environment trees and structures get (2026-11-06, Claude's
   * request: most forest trees are game-owned nodes, and the player
   * vanished completely behind them). Node materials are unique per
   * node, so fading one never touches another.
   */
  updateOcclusion(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, dt: number): void {
    const FADE_MIN = 0.22;
    const k = Math.min(1, dt * 7);
    for (const entry of this.entries.values()) {
      const st = entry.state;
      if (st.depleted) continue;
      if (st.type !== 'tree' && st.type !== 'rock' && st.type !== 'ore' && st.type !== 'bush') continue;
      const spec = RESOURCE_VISUAL_SPECS[st.type];
      const p = entry.group.position;
      const radius = (spec?.footprintRadius ?? 0.6) * entry.baseScale + 0.45;
      OCCL_POINT.set(p.x, p.y + (spec?.height ?? 1) * entry.baseScale * 0.55, p.z);
      const d = segmentPointDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        playerPos.x, playerPos.y, playerPos.z,
        OCCL_POINT.x, OCCL_POINT.y, OCCL_POINT.z,
      );
      const goal = d < radius ? FADE_MIN : 1;
      if (entry.fade === goal) continue;
      let next = entry.fade + (goal - entry.fade) * k;
      if (Math.abs(goal - next) < 0.01) next = goal;
      entry.fade = next;
      entry.pulseMaterials.forEach((mat, i) => {
        mat.opacity = entry.baseOpacities[i] * next;
        mat.transparent = next < 0.999 || entry.baseOpacities[i] < 1;
      });
    }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.removeResource(id);
  }

  /* ---------------------------------------------------------- */
  private buildNode(state: ResourceVisualState, seed = 0): {
    group: THREE.Group;
    pulseMaterials: THREE.MeshStandardMaterial[];
  } {
    const g = new THREE.Group();
    const pulseMaterials: THREE.MeshStandardMaterial[] = [];
    const std = (color: number, rough = 0.9) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
      pulseMaterials.push(m);
      return m;
    };
    const wood = std(0x7a5230, 0.95);
    wood.map = this.gpt.bark_deep ?? this.barkTex;
    wood.color.set(0xffffff);
    const leaf = std(0x55963f);
    leaf.map = this.foliageTex;
    const rockM = std(0x8d8d90, 0.98);
    rockM.map = this.gpt.rock_layered ?? this.rockCrackTex;
    rockM.color.set(0xbdbdc2);
    // Game-owned variant tinting (NATURAL-OBJECTS-CONTRACT): basalt
    // rocks are black rocks, flint pebbles read darker than round
    // stones. Materials are per-node, so tinting is safe.
    const variant = state.natural?.variant ?? null;
    if (variant === 'basalt') rockM.color.set(0x48484f);
    if (variant === 'flint') rockM.color.set(0x5c5c64);
    /** Upright GPT sprite prop, bottom at the ground contact point,
     *  facing the (fixed) camera azimuth. */
    const sprite = (tex: THREE.Texture | undefined, w: number, h: number): THREE.Mesh | null => {
      if (!tex) return null;
      const m = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.95,
        // A flat plane facing away from the low sun would go nearly
        // black; a soft texture-tinted emissive keeps props readable
        // (they must stay identifiable as harvest targets).
        emissive: 0x66553d,
        emissiveMap: tex,
        emissiveIntensity: 0.38,
      });
      pulseMaterials.push(m);
      const geo = new THREE.PlaneGeometry(w, h);
      geo.translate(0, h / 2, 0);
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.y = this.yawRad - (state.rotationY ?? 0);
      return mesh;
    };
    /** Flat GPT sprite lying on the ground (cut patches, piles). */
    const flatSprite = (tex: THREE.Texture | undefined, size: number): THREE.Mesh | null => {
      if (!tex) return null;
      const m = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: 0.5,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      pulseMaterials.push(m);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.75), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = seed * 1.7;
      mesh.position.y = 0.03;
      mesh.receiveShadow = true;
      return mesh;
    };
    const add = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };

    if (state.depleted) {
      if (state.type === 'tree') {
        // GPT stump sprite; the low cylinder remains as a fallback.
        const spr = sprite(this.gpt.prop_stump, 1.05, 0.79);
        if (spr) g.add(spr);
        else {
          const stump = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 8), wood));
          stump.position.y = 0.2;
          const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 8), std(0xc8a165, 1)));
          top.position.y = 0.41;
        }
      } else if (state.type === 'rock' || state.type === 'ore') {
        const spr = sprite(this.gpt.prop_rubble, 1.1, 0.78);
        if (spr) g.add(spr);
        else {
          for (let i = 0; i < 3; i++) {
            const geo = new THREE.IcosahedronGeometry(0.22, 0);
            jitterRock(geo);
            const r = add(new THREE.Mesh(geo, rockM));
            r.position.set((i - 1) * 0.3, 0.12, (i % 2) * 0.25 - 0.1);
          }
        }
      } else if (
        state.type === 'herb' || state.type === 'flowers' ||
        state.type === 'grass' || state.type === 'bush'
      ) {
        // Cut patch sprite (cropped stubble), so a harvested spot
        // stays readable instead of vanishing into bare ground.
        const flat = flatSprite(this.gpt.prop_cut_patch, 0.85);
        if (flat) g.add(flat);
        else {
          const patch = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.05, 10), std(0x5d7031, 1)));
          patch.position.y = 0.025;
        }
      }
      // branch / pebble and other depleted types show bare ground:
      // the game marks pickups collected via visible=false / removal.
      return { group: g, pulseMaterials };
    }

    switch (state.type) {
      case 'tree': {
        const trunk = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 1.8, 7), wood));
        trunk.position.y = 0.9;
        // Two limbs reaching into the canopy (matches the environment
        // trees' trunk + branches + leaf-mass reading).
        for (let i = 0; i < 2; i++) {
          const limb = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.09, 1.1, 5), wood));
          limb.position.set((i === 0 ? 0.28 : -0.24), 1.95, (i === 0 ? 0.1 : -0.12));
          limb.rotation.z = (i === 0 ? -0.7 : 0.75);
          limb.rotation.x = (i === 0 ? 0.15 : -0.2);
        }
        for (let i = 0; i < 3; i++) {
          const blob = add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.05 - i * 0.18, 1), leaf));
          blob.position.set((i - 1) * 0.45, 2.3 + i * 0.5, (i % 2) * 0.4 - 0.2);
          blob.scale.y = 0.85;
        }
        // Leaf cards (GPT sheet D), matching the environment trees.
        for (let i = 0; i < 4; i++) {
          const card = sprite(this.gpt.leaf_oak, 1.25, 1.1);
          if (!card) break;
          const a = (i / 4) * Math.PI * 2 + seed;
          card.position.set(Math.cos(a) * 0.55, 2.15 + (i % 2) * 0.7, Math.sin(a) * 0.55);
          card.rotation.x = (i % 2 ? -0.25 : 0.2);
          g.add(card);
        }
        break;
      }
      case 'rock': {
        // Plain rock: no crystal (Claude 2026-11-06 — the crystal made
        // every rock read as an ore deposit). Crystals live on 'ore'.
        const rockGeo = new THREE.IcosahedronGeometry(0.85, 1);
        jitterRock(rockGeo);
        const rock = add(new THREE.Mesh(rockGeo, rockM));
        rock.position.y = 0.45;
        rock.scale.set(1.15, 0.8, 1);
        break;
      }
      case 'ore': {
        // Ore-bearing rock: the host rock plus a small crystal cluster
        // (quartz white + amber) so the deposit reads at a glance.
        const rockGeo = new THREE.IcosahedronGeometry(0.85, 1);
        jitterRock(rockGeo);
        const rock = add(new THREE.Mesh(rockGeo, rockM));
        rock.position.y = 0.45;
        rock.scale.set(1.15, 0.8, 1);
        const quartz = std(0xf3ead8, 0.25);
        const amber = std(0xd9a441, 0.35);
        const crystals: Array<[number, number, number, number, THREE.MeshStandardMaterial]> = [
          [0.45, 0.85, 0.3, 0.2, quartz],
          [-0.32, 0.68, 0.4, 0.13, amber],
          [0.08, 0.92, -0.36, 0.11, quartz],
        ];
        for (const [cx, cy, cz, cs, cm] of crystals) {
          const c = add(new THREE.Mesh(new THREE.OctahedronGeometry(cs), cm));
          c.position.set(cx, cy, cz);
          c.scale.y = 1.6;
        }
        break;
      }
      case 'water': {
        // Water source: a spring pool with a stone rim. The disc sits
        // slightly above the ground contact so it reads as water even
        // on dry land away from the river.
        const waterM = new THREE.MeshStandardMaterial({
          color: 0x2e7cc2, roughness: 0.12, metalness: 0.05,
          transparent: true, opacity: 0.92,
        });
        pulseMaterials.push(waterM);
        const pool = add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.1, 18), waterM));
        pool.position.y = 0.05;
        pool.castShadow = false;
        const sheen = new THREE.MeshStandardMaterial({
          color: 0x9fd0ee, roughness: 0.1, transparent: true, opacity: 0.4,
        });
        pulseMaterials.push(sheen);
        const top = add(new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), sheen));
        top.rotation.x = -Math.PI / 2;
        top.position.y = 0.105;
        top.castShadow = false;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + seed;
          const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.11 + (i % 2) * 0.04, 7, 6), rockM));
          s.scale.y = 0.6;
          s.position.set(Math.cos(a) * 0.66, 0.05, Math.sin(a) * 0.66);
        }
        break;
      }
      case 'oil': {
        // Crude-oil seep: a near-black glossy pool with a faint
        // violet sheen and dark rocks at the rim.
        const oilM = new THREE.MeshStandardMaterial({
          color: 0x16120e, roughness: 0.18, metalness: 0.1,
          transparent: true, opacity: 0.97,
        });
        pulseMaterials.push(oilM);
        const pool = add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.68, 0.09, 18), oilM));
        pool.position.y = 0.045;
        pool.castShadow = false;
        const sheen = new THREE.MeshStandardMaterial({
          color: 0x6a5a8c, roughness: 0.15, transparent: true, opacity: 0.3,
        });
        pulseMaterials.push(sheen);
        const top = add(new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), sheen));
        top.rotation.x = -Math.PI / 2;
        top.position.y = 0.095;
        top.castShadow = false;
        const darkRock = std(0x33302c, 1);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + seed * 0.7;
          const geo = new THREE.IcosahedronGeometry(0.16, 0);
          jitterRock(geo);
          const r = add(new THREE.Mesh(geo, darkRock));
          r.position.set(Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62);
        }
        break;
      }
      case 'grass': {
        // Gatherable grass tuft (game-owned 草むら): denser crossed
        // sprite planes than the decorative ground grass.
        const tex = this.gpt.grass_wide ?? this.gpt.grass_short;
        let placed = false;
        for (let i = 0; i < 3; i++) {
          const spr = sprite(tex, 0.95, 0.6);
          if (!spr) break;
          spr.rotation.y += (i * Math.PI) / 3;
          g.add(spr);
          placed = true;
        }
        if (!placed) {
          for (let i = 0; i < 6; i++) {
            const blade = add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 5), leaf));
            const a = (i / 6) * Math.PI * 2;
            blade.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
            blade.rotation.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
          }
        }
        break;
      }
      case 'bush': {
        // Gatherable bush （やぶ）: foliage masses + shrub leaf cards,
        // visibly denser than a decorative shrub.
        for (let i = 0; i < 3; i++) {
          const geo = new THREE.IcosahedronGeometry(0.5 - i * 0.09, 1);
          jitterRock(geo, 0.3);
          const blob = add(new THREE.Mesh(geo, leaf));
          blob.position.set((i - 1) * 0.3, 0.36 + (i % 2) * 0.14, (i % 2) * 0.24 - 0.12);
          blob.scale.y = 0.8;
        }
        for (let i = 0; i < 3; i++) {
          const card = sprite(this.gpt.leaf_shrub, 0.8, 0.66);
          if (!card) break;
          const a = (i / 3) * Math.PI * 2 + seed;
          card.position.set(Math.cos(a) * 0.34, 0.3, Math.sin(a) * 0.34);
          g.add(card);
        }
        break;
      }
      case 'branch': {
        // Fallen branch pickup as a GPT sprite (sheet F).
        const spr = sprite(this.gpt.prop_branch, 0.95, 0.78);
        if (spr) g.add(spr);
        else {
          const main = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.0, 6), wood));
          main.rotation.z = Math.PI / 2;
          main.rotation.y = 0.4;
          main.position.y = 0.06;
        }
        break;
      }
      case 'pebble': {
        const spr = sprite(this.gpt.prop_pebbles, 0.6, 0.49);
        if (spr) {
          if (variant === 'flint') {
            (spr.material as THREE.MeshStandardMaterial).color.set(0x8f8f98);
          }
          g.add(spr);
        }
        else {
          for (let i = 0; i < 3; i++) {
            const p = add(new THREE.Mesh(new THREE.SphereGeometry(0.13 + (i % 2) * 0.05, 8, 6), rockM));
            p.scale.y = 0.6;
            p.position.set((i - 1) * 0.22, 0.06, (i % 2) * 0.16 - 0.06);
          }
        }
        break;
      }
      case 'herb': {
        // Crossed cutout planes with the GPT herb sprite.
        const spr = sprite(this.gpt.herb_patch, 0.62, 0.37);
        if (spr) {
          g.add(spr);
          const spr2 = sprite(this.gpt.herb_patch, 0.62, 0.37);
          if (spr2) {
            spr2.rotation.y += Math.PI / 2;
            g.add(spr2);
          }
        } else {
          for (let i = 0; i < 5; i++) {
            const blade = add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 5), leaf));
            const a = (i / 5) * Math.PI * 2;
            blade.position.set(Math.cos(a) * 0.16, 0.26, Math.sin(a) * 0.16);
            blade.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
          }
        }
        break;
      }
      case 'flowers': {
        // Flower colour is a stable per-id choice (seeded by the id).
        const texes = [this.gpt.flower_white, this.gpt.flower_yellow, this.gpt.flower_purple];
        const spr = sprite(texes[seed % 3], 0.6, 0.42);
        if (spr) {
          g.add(spr);
          const spr2 = sprite(texes[seed % 3], 0.6, 0.42);
          if (spr2) {
            spr2.rotation.y += Math.PI / 2;
            g.add(spr2);
          }
        } else {
          const stemM = std(0x4d7d3a);
          const headM = std(0xff9ec4, 0.6);
          for (let i = 0; i < 4; i++) {
            const x = (i % 2) * 0.4 - 0.2;
            const z = Math.floor(i / 2) * 0.4 - 0.2;
            const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), stemM));
            stem.position.set(x, 0.2, z);
            const head = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), headM));
            head.position.set(x, 0.45, z);
          }
        }
        break;
      }
      case 'clay': {
        const mound = add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), std(0xa9764e, 1)));
        mound.scale.y = 0.55;
        mound.position.y = 0.08;
        break;
      }
      case 'mushroom': {
        const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.35, 8), std(0xe8dcc3, 0.8)));
        stem.position.y = 0.17;
        const cap = add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xb8452e, 0.7)));
        cap.position.y = 0.34;
        break;
      }
      default: {
        const blob = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), leaf));
        blob.position.y = 0.35;
      }
    }
    return { group: g, pulseMaterials };
  }
}

/**
 * Construction data for the game logic's collision / placement use
 * (2026-11-06). All values are for a node at scale 1, in world units,
 * with the node origin at its ground contact point — multiply radii
 * and height by state.scale for a placed node. The graphics side
 * reports the shape it draws; whether the player collides, and what
 * a harvest yields, stays with the game logic.
 */
export interface ResourceVisualSpec {
  /** Horizontal radius the visual occupies on the ground. */
  footprintRadius: number;
  /** Trunk/stem radius at ground level, when the type has one. */
  trunkRadius?: number;
  /** Top of the visual above the ground contact point. */
  height: number;
  /** What the depleted form looks like ('none' = bare ground). */
  depletedForm: 'stump' | 'rubble' | 'cut-patch' | 'none';
}

export const RESOURCE_VISUAL_SPECS: Record<string, ResourceVisualSpec> = {
  tree: { footprintRadius: 1.15, trunkRadius: 0.26, height: 3.6, depletedForm: 'stump' },
  rock: { footprintRadius: 1.0, height: 1.15, depletedForm: 'rubble' },
  herb: { footprintRadius: 0.35, height: 0.6, depletedForm: 'cut-patch' },
  flowers: { footprintRadius: 0.35, height: 0.55, depletedForm: 'cut-patch' },
  clay: { footprintRadius: 0.65, height: 0.4, depletedForm: 'none' },
  mushroom: { footprintRadius: 0.32, height: 0.65, depletedForm: 'none' },
  branch: { footprintRadius: 0.5, height: 0.78, depletedForm: 'none' },
  pebble: { footprintRadius: 0.32, height: 0.49, depletedForm: 'none' },
  grass: { footprintRadius: 0.45, height: 0.55, depletedForm: 'cut-patch' },
  bush: { footprintRadius: 0.55, height: 0.85, depletedForm: 'cut-patch' },
  water: { footprintRadius: 0.7, height: 0.15, depletedForm: 'none' },
  oil: { footprintRadius: 0.7, height: 0.12, depletedForm: 'none' },
  ore: { footprintRadius: 1.0, height: 1.15, depletedForm: 'rubble' },
};
