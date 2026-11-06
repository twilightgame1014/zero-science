import * as THREE from 'three';
import type { ResourceVisualState } from './types';
import { disposeObject } from './StructureRenderer';
import { AssetManager } from './AssetManager';

interface Entry {
  group: THREE.Group;
  state: ResourceVisualState;
  pulseMaterials: THREE.MeshStandardMaterial[];
  baseScale: number;
}

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

  constructor(groundHeightAt: (x: number, z: number) => number) {
    this.groundHeightAt = groundHeightAt;
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
      const built = this.buildNode(state);
      built.group.position.set(
        state.position.x,
        state.position.y ?? this.groundHeightAt(state.position.x, state.position.z),
        state.position.z,
      );
      built.group.rotation.y = state.rotationY ?? 0;
      const s = state.scale ?? 1;
      built.group.scale.setScalar(s);
      this.group.add(built.group);
      this.entries.set(id, { group: built.group, state, pulseMaterials: built.pulseMaterials, baseScale: s });
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
        } else if (st.type === 'rock') {
          const j = 1 + Math.sin(time * 30) * 0.012;
          entry.group.scale.setScalar(entry.baseScale * j);
          entry.group.rotation.z = Math.sin(time * 30) * 0.008;
        } else {
          entry.group.rotation.z = Math.sin(time * 10) * 0.06;
        }
        // Warm blink, kept well below blow-out: the node must stay
        // identifiable while it reacts (verified against screenshots —
        // a 0.4 peak washed the whole tree white under bloom).
        const flash = Math.sin(time * 18) > 0 ? 0.2 : 0.02;
        for (const mat of entry.pulseMaterials) mat.emissive.setRGB(flash, flash * 0.85, flash * 0.55);
        continue;
      }
      entry.group.rotation.x = 0;
      entry.group.rotation.z = 0;
      entry.group.scale.setScalar(entry.baseScale);
      const on = st.highlighted === true;
      const pulse = on ? 0.35 + Math.sin(time * 5) * 0.25 : 0;
      for (const mat of entry.pulseMaterials) {
        mat.emissive.setRGB(pulse, pulse * 0.85, pulse * 0.2);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.removeResource(id);
  }

  /* ---------------------------------------------------------- */
  private buildNode(state: ResourceVisualState): {
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
    wood.map = this.barkTex;
    wood.color.set(0xffffff);
    const leaf = std(0x55963f);
    leaf.map = this.foliageTex;
    const rockM = std(0x8d8d90, 0.98);
    rockM.map = this.rockCrackTex;
    rockM.color.set(0xbdbdc2);
    const add = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };

    if (state.depleted) {
      if (state.type === 'tree') {
        const stump = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 8), wood));
        stump.position.y = 0.2;
        const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 8), std(0xc8a165, 1)));
        top.position.y = 0.41;
      } else if (state.type === 'rock') {
        for (let i = 0; i < 3; i++) {
          const geo = new THREE.IcosahedronGeometry(0.22, 0);
          jitterRock(geo);
          const r = add(new THREE.Mesh(geo, rockM));
          r.position.set((i - 1) * 0.3, 0.12, (i % 2) * 0.25 - 0.1);
        }
      } else if (state.type === 'herb' || state.type === 'flowers') {
        // Cut patch: a close-cropped disc with stubble, so a harvested
        // spot stays readable instead of vanishing into bare ground.
        const patch = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.05, 10), std(0x5d7031, 1)));
        patch.position.y = 0.025;
        for (let i = 0; i < 5; i++) {
          const stub = add(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), std(0x6d8a44)));
          const a = (i / 5) * Math.PI * 2;
          stub.position.set(Math.cos(a) * 0.15, 0.09, Math.sin(a) * 0.15);
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
        break;
      }
      case 'rock': {
        const rockGeo = new THREE.IcosahedronGeometry(0.85, 1);
        jitterRock(rockGeo);
        const rock = add(new THREE.Mesh(rockGeo, rockM));
        rock.position.y = 0.45;
        rock.scale.set(1.15, 0.8, 1);
        const crystal = add(new THREE.Mesh(
          new THREE.OctahedronGeometry(0.2),
          std(0xf3ead8, 0.25),
        ));
        crystal.position.set(0.45, 0.85, 0.3);
        crystal.scale.y = 1.6;
        break;
      }
      case 'branch': {
        // Fallen branch pickup: two crossed limbs on the ground.
        const main = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.0, 6), wood));
        main.rotation.z = Math.PI / 2;
        main.rotation.y = 0.4;
        main.position.y = 0.06;
        const off = add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.55, 5), wood));
        off.rotation.z = Math.PI / 2;
        off.rotation.y = -0.5;
        off.position.set(0.12, 0.1, 0.08);
        break;
      }
      case 'pebble': {
        for (let i = 0; i < 3; i++) {
          const p = add(new THREE.Mesh(new THREE.SphereGeometry(0.13 + (i % 2) * 0.05, 8, 6), rockM));
          p.scale.y = 0.6;
          p.position.set((i - 1) * 0.22, 0.06, (i % 2) * 0.16 - 0.06);
        }
        break;
      }
      case 'herb': {
        for (let i = 0; i < 5; i++) {
          const blade = add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 5), leaf));
          const a = (i / 5) * Math.PI * 2;
          blade.position.set(Math.cos(a) * 0.16, 0.26, Math.sin(a) * 0.16);
          blade.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
        }
        break;
      }
      case 'flowers': {
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
  branch: { footprintRadius: 0.5, height: 0.16, depletedForm: 'none' },
  pebble: { footprintRadius: 0.32, height: 0.2, depletedForm: 'none' },
};
