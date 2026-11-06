import * as THREE from 'three';
import type { ResourceVisualState } from './types';
import { disposeObject } from './StructureRenderer';

interface Entry {
  group: THREE.Group;
  state: ResourceVisualState;
  pulseMaterials: THREE.MeshStandardMaterial[];
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

  constructor(groundHeightAt: (x: number, z: number) => number) {
    this.groundHeightAt = groundHeightAt;
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
      this.entries.set(id, { group: built.group, state, pulseMaterials: built.pulseMaterials });
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
      const on = entry.state.highlighted === true;
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
    const leaf = std(0x55963f);
    const rockM = std(0x8d8d90, 0.98);
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
      } else if (state.type === 'rock') {
        for (let i = 0; i < 3; i++) {
          const r = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), rockM));
          r.position.set((i - 1) * 0.3, 0.12, (i % 2) * 0.25 - 0.1);
        }
      }
      // Other depleted types simply show bare ground.
      return { group: g, pulseMaterials };
    }

    switch (state.type) {
      case 'tree': {
        const trunk = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 1.8, 7), wood));
        trunk.position.y = 0.9;
        for (let i = 0; i < 3; i++) {
          const blob = add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.05 - i * 0.18, 1), leaf));
          blob.position.set((i - 1) * 0.45, 2.3 + i * 0.5, (i % 2) * 0.4 - 0.2);
          blob.scale.y = 0.85;
        }
        break;
      }
      case 'rock': {
        const rock = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), rockM));
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
