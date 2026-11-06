/**
 * Demo-only set dressing: a small golden-hour village on the plateau,
 * built from the module's procedural canvas textures. This is NOT part
 * of the graphics module — it exists to verify the HD-2D "look"
 * (textured materials, warm low sun, lamp glow, god rays) end to end.
 * In production, structures arrive via addStructureVisual() instead.
 */
import * as THREE from 'three';
import { AssetManager, DEFAULT_CONFIG, terrainHeight } from '../src/graphics/index';

const gy = (x: number, z: number) => terrainHeight(x, z, DEFAULT_CONFIG);

function textured(
  tex: THREE.Texture,
  rx: number,
  ry: number,
  rough = 0.95,
): THREE.MeshStandardMaterial {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return new THREE.MeshStandardMaterial({ map: t, roughness: rough });
}

export function buildVillage(scene: THREE.Scene): void {
  const assets = new AssetManager();
  const cobble = assets.createCobblestoneTexture();
  const tiles = assets.createRoofTileTexture();
  const thatch = assets.createThatchTexture();
  const plaster = assets.createPlasterWallTexture();
  const wood = assets.createWoodPlankTexture();
  const shaft = assets.createShaftTexture();
  const glow = assets.createRadialTexture('rgba(255,205,130,1)');

  const root = new THREE.Group();
  root.name = 'DemoVillage';

  const add = (o: THREE.Object3D, x: number, z: number, ry = 0) => {
    o.position.set(x, gy(x, z), z);
    o.rotation.y = ry;
    root.add(o);
    return o;
  };
  const box = (
    mat: THREE.Material, w: number, h: number, d: number,
    x: number, y: number, z: number,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  /* ---- plaza ---- */
  {
    const geo = new THREE.PlaneGeometry(17.5, 17.5, 28, 28);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, gy(pos.getX(i) - 20, pos.getZ(i) + 20) + 0.045);
    }
    geo.computeVertexNormals();
    const plaza = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map: (() => { const t = cobble.clone(); t.needsUpdate = true; t.repeat.set(6, 6); return t; })(),
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    plaza.position.set(-20, 0, 20);
    plaza.receiveShadow = true;
    root.add(plaza);
  }

  /* ---- houses ---- */
  const house = (
    x: number, z: number, ry: number,
    roofKind: 'tile' | 'thatch', scale = 1,
  ) => {
    const g = new THREE.Group();
    const wallMat = textured(plaster, 1, 1);
    const roofMat = textured(roofKind === 'tile' ? tiles : thatch, 0.32, 0.32);
    const w = 3.4, h = 2.15, d = 2.8, rh = 1.45;
    g.add(box(wallMat, w, h, d, 0, h / 2, 0));
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - 0.25, 0);
    shape.lineTo(w / 2 + 0.25, 0);
    shape.lineTo(0, rh);
    shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, {
      depth: d + 0.5, bevelEnabled: false,
    });
    roofGeo.translate(0, 0, -(d + 0.5) / 2);
    const roof = new THREE.Mesh(roofGeo, [wallMat, roofMat]);
    roof.position.y = h;
    roof.castShadow = true;
    roof.receiveShadow = true;
    g.add(roof);
    // door + lit windows
    const doorMat = textured(wood, 0.6, 1);
    g.add(box(doorMat, 0.78, 1.35, 0.07, -0.7, 0.68, d / 2 + 0.02));
    const litMat = new THREE.MeshStandardMaterial({
      color: 0xffc978,
      emissive: 0xffa63e,
      emissiveIntensity: 2.4,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4c3a26, roughness: 0.9 });
    for (const wx of [0.75]) {
      g.add(box(frameMat, 0.62, 0.72, 0.06, wx, 1.3, d / 2 + 0.02));
      const win = box(litMat, 0.48, 0.58, 0.07, wx, 1.3, d / 2 + 0.03);
      win.castShadow = false;
      g.add(win);
    }
    // chimney
    g.add(box(textured(cobble, 0.4, 0.4), 0.5, 1.1, 0.5, w * 0.28, h + rh * 0.55, -0.4));
    g.scale.setScalar(scale);
    return add(g, x, z, ry);
  };
  house(-27.5, 13.0, 0.55, 'tile');
  house(-12.5, 27.5, -0.65, 'thatch');
  house(-27.0, 29.0, 0.2, 'tile', 0.88);

  /* ---- well ---- */
  {
    const g = new THREE.Group();
    const stone = textured(cobble, 1.6, 0.6);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.9, 0.75, 12, 1, true), stone);
    ring.position.y = 0.37;
    ring.castShadow = true;
    ring.receiveShadow = true;
    g.add(ring);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 12),
      new THREE.MeshStandardMaterial({ color: 0x1d3038, roughness: 0.25 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.55;
    g.add(water);
    const postMat = textured(wood, 0.4, 1);
    g.add(box(postMat, 0.12, 1.5, 0.12, -0.85, 0.75, 0));
    g.add(box(postMat, 0.12, 1.5, 0.12, 0.85, 0.75, 0));
    const roofMat = textured(thatch, 0.5, 0.5);
    const r1 = box(roofMat, 2.1, 0.08, 1.1, 0, 1.72, 0.42);
    r1.rotation.x = 0.6;
    const r2 = box(roofMat, 2.1, 0.08, 1.1, 0, 1.72, -0.42);
    r2.rotation.x = -0.6;
    g.add(r1, r2);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.22, 8), postMat);
    bucket.position.set(0, 0.95, 0);
    g.add(bucket);
    add(g, -16.6, 16.4, 0.3);
  }

  /* ---- lamps (bloom catches the emissive core + glow sprite) ---- */
  const lamp = (x: number, z: number) => {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.5, metalness: 0.7 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.3, 8), iron);
    post.position.y = 1.15;
    post.castShadow = true;
    g.add(post);
    g.add(box(iron, 0.34, 0.4, 0.34, 0, 2.42, 0));
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.24, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0xffe2b0, emissive: 0xffbe6e, emissiveIntensity: 3.2,
      }),
    );
    core.position.y = 2.42;
    g.add(core);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0xffc98a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.scale.setScalar(1.9);
    sprite.position.y = 2.42;
    g.add(sprite);
    const light = new THREE.PointLight(0xffb45e, 14, 10, 2);
    light.position.y = 2.42;
    g.add(light);
    return add(g, x, z);
  };
  lamp(-23.2, 17.2);
  lamp(-16.8, 23.8);

  /* ---- fences, signpost, barrels ---- */
  const fenceRun = (x0: number, z0: number, x1: number, z1: number) => {
    const g = new THREE.Group();
    const mat = textured(wood, 0.5, 0.5);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 1.15));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      const post = box(mat, 0.11, 0.85, 0.11, px, gy(px, pz) + 0.42, pz);
      g.add(post);
    }
    for (const ry of [0.32, 0.62]) {
      const rail = box(mat, len, 0.07, 0.05,
        (x0 + x1) / 2, gy((x0 + x1) / 2, (z0 + z1) / 2) + ry, (z0 + z1) / 2);
      rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      g.add(rail);
    }
    root.add(g);
  };
  fenceRun(-31, 24.5, -25, 24.5);
  fenceRun(-11, 10.5, -11, 15.5);

  {
    const g = new THREE.Group();
    const mat = textured(wood, 0.5, 1);
    g.add(box(mat, 0.12, 1.7, 0.12, 0, 0.85, 0));
    const b1 = box(mat, 1.0, 0.3, 0.05, 0.4, 1.45, 0);
    b1.rotation.z = 0.06;
    const b2 = box(mat, 0.9, 0.28, 0.05, -0.36, 1.12, 0);
    b2.rotation.z = -0.05;
    g.add(b1, b2);
    add(g, -18.8, 25.6, 0.4);
  }
  for (const [bx, bz] of [[-24.9, 11.4], [-24.2, 12.2]] as const) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.28, 0.78, 10),
      textured(wood, 1.4, 0.8),
    );
    barrel.position.set(bx, gy(bx, bz) + 0.39, bz);
    barrel.castShadow = true;
    root.add(barrel);
  }

  /* ---- god-ray shafts (fake volumetrics, very subtle) ---- */
  const shaftMat = new THREE.MeshBasicMaterial({
    map: shaft, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  for (const [sx, sz, rz] of [[-26, 10, -0.5], [-18, 30, -0.42], [-30, 24, -0.55]] as const) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 17), shaftMat);
    plane.position.set(sx, gy(sx, sz) + 6.4, sz);
    plane.rotation.set(0.1, 0.7, rz);
    plane.renderOrder = 9;
    root.add(plane);
  }

  scene.add(root);
}
