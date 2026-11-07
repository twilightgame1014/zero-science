import * as THREE from 'three';

/**
 * Shore foam ribbons (round 21 demo → round 22 module).
 *
 * Builds animated foam bands along a heightfield waterline. The
 * construction is the chunk-shoreline spec from INTEGRATION
 * §27.4, as reusable code: the caller supplies a height function
 * and a scan region; the waterline is marched, normals point to
 * the water side, and u = arc length / tileM is world-anchored,
 * so ribbons built per chunk join seamlessly — pattern AND
 * phase (the animation reads a shared clock the caller passes
 * to update()).
 *
 * Two bands are built (round 22, coast pass): the main band ON
 * the waterline and a fainter secondary band ~0.85 m toward the
 * water, breathing on an offset phase — a single static line
 * read as painted-on.
 */
export interface ShoreFoamLinePoint {
  x: number;
  z: number;
  /** Unit normal pointing toward the water side. */
  nx: number;
  nz: number;
}

export interface ShoreFoam {
  group: THREE.Group;
  /** Sampled waterline points (for shoreline scatter placement). */
  line: ShoreFoamLinePoint[];
  /** Advance the breathing animation; t = shared clock seconds. */
  update: (t: number) => void;
  dispose: () => void;
}

export interface ShoreFoamOptions {
  texture: THREE.Texture;
  /** Metres per texture repeat along the line. Default 3. */
  tileM?: number;
  /** Secondary band opacity relative to the main band. Default 0.55. */
  secondaryStrength?: number;
}

/** March one waterline: for each z row, the first x where the
 *  height crosses from above water to at/below it. Suits shores
 *  that run roughly north–south (the lake / coast west shores). */
export function sampleWaterline(
  heightAt: (x: number, z: number) => number,
  waterLevel: number,
  xFrom: number,
  xTo: number,
  zFrom: number,
  zTo: number,
  rowStep = 1.2,
): ShoreFoamLinePoint[] {
  const raw: Array<{ x: number; z: number }> = [];
  for (let z = zFrom; z <= zTo; z += rowStep) {
    let prevX = xFrom;
    let prevH = heightAt(xFrom, z);
    for (let x = xFrom + 0.5; x <= xTo; x += 0.5) {
      const h = heightAt(x, z);
      if (prevH > waterLevel && h <= waterLevel) {
        const t = (prevH - waterLevel) / Math.max(prevH - h, 1e-6);
        raw.push({ x: prevX + (x - prevX) * t, z });
        break;
      }
      prevX = x; prevH = h;
    }
  }
  return raw.map((p, i) => {
    const q = raw[Math.min(i + 1, raw.length - 1)];
    const p0 = raw[Math.max(i - 1, 0)];
    let dx = q.x - p0.x;
    let dz = q.z - p0.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    let nx = -dz;
    let nz = dx;
    if (heightAt(p.x + nx, p.z + nz) > heightAt(p.x - nx, p.z - nz)) {
      nx = -nx; nz = -nz;
    }
    return { x: p.x, z: p.z, nx, nz };
  });
}

function ribbonGeometry(
  line: ShoreFoamLinePoint[],
  heightAt: (x: number, z: number) => number,
  waterLevel: number,
  waterSide: number,
  landSide: number,
  tileM: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  let arc = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (i > 0) arc += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z);
    const wx = p.x + p.nx * waterSide;
    const wz = p.z + p.nz * waterSide;
    const lx = p.x - p.nx * landSide;
    const lz = p.z - p.nz * landSide;
    pos.push(
      wx, waterLevel + 0.04, wz,
      lx, Math.max(heightAt(lx, lz), waterLevel) + 0.045, lz,
    );
    uvA.push(arc / tileM, 0, arc / tileM, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  geo.setIndex(idx);
  return geo;
}

export function createShoreFoam(
  heightAt: (x: number, z: number) => number,
  waterLevel: number,
  line: ShoreFoamLinePoint[],
  opts: ShoreFoamOptions,
): ShoreFoam {
  const tileM = opts.tileM ?? 3;
  const group = new THREE.Group();
  group.name = 'ShoreFoam';
  const mkMat = (opacity: number) => {
    const tex = opts.texture.clone();
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity, depthWrite: false,
    });
    return { tex, mat };
  };
  const main = mkMat(0.75);
  const mainMesh = new THREE.Mesh(
    ribbonGeometry(line, heightAt, waterLevel, 1.15, 0.45, tileM), main.mat);
  mainMesh.renderOrder = 4;
  group.add(mainMesh);
  const sec = mkMat(0.75 * (opts.secondaryStrength ?? 0.55));
  const secMesh = new THREE.Mesh(
    ribbonGeometry(line, heightAt, waterLevel, 2.0, 1.3, tileM), sec.mat);
  secMesh.renderOrder = 4;
  group.add(secMesh);
  const update = (t: number) => {
    main.mat.opacity = 0.62 + Math.sin(t * 1.05) * 0.18;
    main.tex.offset.x = Math.sin(t * 0.63) * 0.03;
    sec.mat.opacity = (0.5 + Math.sin(t * 0.9 + 1.9) * 0.2) * (opts.secondaryStrength ?? 0.55);
    sec.tex.offset.x = Math.sin(t * 0.5 + 0.8) * 0.045;
  };
  const dispose = () => {
    mainMesh.geometry.dispose();
    secMesh.geometry.dispose();
    main.mat.dispose(); sec.mat.dispose();
    main.tex.dispose(); sec.tex.dispose();
  };
  return { group, line, update, dispose };
}
