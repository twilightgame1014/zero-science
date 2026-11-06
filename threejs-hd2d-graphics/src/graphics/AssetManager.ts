import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads and caches textures / models for the graphics module.
 * Everything visual lives here so renderers never touch the network
 * or the DOM directly, and dispose() can release GPU resources.
 */
export class AssetManager {
  private textureLoader = new THREE.TextureLoader();
  private gltfLoader: GLTFLoader | null = null;
  private cache = new Map<string, THREE.Texture>();
  private disposables: Array<{ dispose: () => void }> = [];

  async loadTexture(
    url: string,
    opts: { srgb?: boolean; repeat?: boolean } = {},
  ): Promise<THREE.Texture> {
    const key = `tex:${url}:${opts.srgb ?? true}:${opts.repeat ?? false}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const tex = await this.textureLoader.loadAsync(url);
    if (opts.srgb ?? true) tex.colorSpace = THREE.SRGBColorSpace;
    if (opts.repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    tex.anisotropy = 4;
    this.cache.set(key, tex);
    this.disposables.push(tex);
    return tex;
  }

  async loadGLTF(url: string): Promise<THREE.Group> {
    this.gltfLoader ??= new GLTFLoader();
    const result = await this.gltfLoader.loadAsync(url);
    return result.scene;
  }

  /** Tileable speckle detail texture generated on a canvas (fallback so
   *  the module looks right even with zero external assets). */
  createNoiseTexture(
    base: string,
    speckles: string[],
    size = 128,
    density = 2600,
    seed = 7,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    let s = seed * 9301 + 49297;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < density; i++) {
      ctx.fillStyle = speckles[Math.floor(rnd() * speckles.length)];
      const r = 0.6 + rnd() * 1.7;
      ctx.globalAlpha = 0.16 + rnd() * 0.3;
      ctx.fillRect(rnd() * size, rnd() * size, r, r * (0.6 + rnd()));
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(tex);
    return tex;
  }

  createRadialTexture(
    inner: string,
    size = 64,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    g.addColorStop(0, inner);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    this.disposables.push(tex);
    return tex;
  }

  /* ------------- natural canvas textures (original, procedural) ------------- */

  /** Bark: warm brown with vertical fissures. Carries its own colour —
   *  use with a white material colour. */
  createBarkTexture(): THREE.CanvasTexture {
    return this.canvasTexture(128, (ctx, s) => {
      const rnd = this.rand(131);
      ctx.fillStyle = '#77522f';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 46; i++) {
        const x = rnd() * s;
        const w = 1.5 + rnd() * 3.5;
        ctx.fillStyle = rnd() < 0.6 ? 'rgba(52,34,16,0.55)' : 'rgba(146,110,66,0.5)';
        ctx.fillRect(x, 0, w, s);
        ctx.fillStyle = 'rgba(52,34,16,0.35)';
        ctx.fillRect(x + w, rnd() * s * 0.4, 1, s * (0.3 + rnd() * 0.5));
      }
      this.speckle(ctx, s, rnd, ['#5d3f22', '#96754a', '#86643c'], 500, 0.25);
    });
  }

  /** Foliage: light leafy speckle meant to be multiplied by instance
   *  colours, so canopies stop reading as flat green plastic. */
  createFoliageTexture(): THREE.CanvasTexture {
    return this.canvasTexture(128, (ctx, s) => {
      const rnd = this.rand(137);
      ctx.fillStyle = '#b7c9a2';
      ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, rnd, ['#7fa35c', '#cfe0b4', '#5d8446', '#93b874'], 1500, 0.5);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = 'rgba(70,104,50,0.35)';
        ctx.fillRect(rnd() * s, rnd() * s, 3 + rnd() * 5, 2 + rnd() * 3);
      }
      // Deeper shadow pockets so canopies stop reading as one tone.
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = 'rgba(43,66,30,0.4)';
        ctx.beginPath();
        ctx.ellipse(rnd() * s, rnd() * s, 5 + rnd() * 9, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  /** Rock surface: near-neutral grey with cracks and grit, multiplied
   *  by instance colours. */
  createRockCrackTexture(): THREE.CanvasTexture {
    return this.canvasTexture(128, (ctx, s) => {
      const rnd = this.rand(139);
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, rnd, ['#b9b9b9', '#e8e8e8', '#a8a8a8'], 800, 0.3);
      ctx.strokeStyle = 'rgba(38,38,44,0.6)';
      for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 0.8 + rnd() * 1.2;
        ctx.beginPath();
        let x = rnd() * s;
        let y = rnd() * s;
        ctx.moveTo(x, y);
        const segs = 3 + Math.floor(rnd() * 4);
        for (let k = 0; k < segs; k++) {
          x += (rnd() - 0.5) * 34;
          y += (rnd() - 0.5) * 34;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
  }

  /** Grass tuft: a fan of tapered blades on transparency, for
   *  alpha-tested crossed-plane tufts (ankle-to-shin scale in world). */
  createGrassTuftTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const rnd = this.rand(151);
    // Bright tones on purpose: instance colours multiply the map,
    // so a mid-dark texture would double-darken the tufts.
    const tones: Array<[string, string]> = [
      ['#6f9c46', '#93bd63'],
      ['#7fae56', '#a9d17c'],
      ['#8fbc58', '#c2e091'],
      ['#9cc46a', '#d4ecab'],
    ];
    for (let i = 0; i < 17; i++) {
      const baseX = 14 + rnd() * 100;
      const lean = (rnd() - 0.5) * 44;
      const topY = 8 + rnd() * 52;
      const wdt = 5 + rnd() * 4.5;
      const [dark, light] = tones[Math.floor(rnd() * tones.length)];
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(baseX - wdt, 128);
      ctx.quadraticCurveTo(baseX - wdt * 0.4, (128 + topY) / 2, baseX + lean, topY);
      ctx.quadraticCurveTo(baseX + wdt * 0.4, (128 + topY) / 2, baseX + wdt, 128);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.moveTo(baseX - wdt * 0.35, 128);
      ctx.quadraticCurveTo(baseX, (128 + topY) / 2, baseX + lean, topY + 4);
      ctx.quadraticCurveTo(baseX + wdt * 0.2, (128 + topY) / 2, baseX + wdt * 0.35, 128);
      ctx.closePath();
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  /** Fern fronds: broader arcs with leaflet ticks, same cutout style. */
  createFernTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const rnd = this.rand(157);
    for (let f = 0; f < 8; f++) {
      const dir = f % 2 === 0 ? -1 : 1;
      const spread = 12 + (f >> 1) * 13;
      const tipX = 64 + dir * spread * (0.8 + rnd() * 0.5);
      const tipY = 26 + rnd() * 34;
      ctx.strokeStyle = '#3c7031';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(64, 128);
      ctx.quadraticCurveTo(64 + dir * spread * 0.3, 74, tipX, tipY);
      ctx.stroke();
      ctx.strokeStyle = f % 2 ? '#4c8a3d' : '#5d9c48';
      ctx.lineWidth = 2.2;
      for (let t = 0.25; t < 0.95; t += 0.13) {
        const bx = 64 + (tipX - 64) * t;
        const by = 128 + (tipY - 128) * t + Math.sin(t * Math.PI) * -6;
        const len = 11 * (1 - t) + 3;
        ctx.beginPath();
        ctx.moveTo(bx - len, by + 3);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + len, by + 3);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  /** Leaf cluster card: a bunch of ellipse leaves with a darker
   *  underlay, for shrub/canopy surface detail (alpha-tested). */
  createLeafClusterTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const rnd = this.rand(163);
    const leaf = (cx: number, cy: number, len: number, ang: number, fill: string) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 40;
      leaf(64 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.8, 13 + rnd() * 8, a + 0.6, '#33512a');
    }
    const tones = ['#4c7d38', '#5d9142', '#6fa34c', '#86b95e'];
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 42;
      leaf(64 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.8, 11 + rnd() * 9, a + 0.6,
        tones[Math.floor(rnd() * tones.length)]);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  /** Ground patch: irregular soft-edged blob with leaf-fleck speckle.
   *  Bright base so instance colours can tint it (leaf litter, worn
   *  earth, dark soil rings under trees and rocks). */
  createGroundPatchTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const rnd = this.rand(167);
    // Irregular soft-edged blob (overlapping radial gradients).
    for (let i = 0; i < 9; i++) {
      const cx = 34 + rnd() * 60;
      const cy = 34 + rnd() * 60;
      const r = 22 + rnd() * 30;
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,250,238,0.72)');
      grad.addColorStop(1, 'rgba(255,250,238,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
    }
    // Flecks and darker blotches only land where the blob has alpha.
    ctx.globalCompositeOperation = 'source-atop';
    this.speckle(ctx, 128, rnd, ['#c9a86a', '#a8823f', '#8a6b35', '#e3cd96'], 300, 0.55);
    for (let i = 0; i < 30; i++) {
      const cx = 20 + rnd() * 88;
      const cy = 20 + rnd() * 88;
      const r = 6 + rnd() * 15;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      grad.addColorStop(0, `rgba(74,54,26,${0.16 + rnd() * 0.2})`);
      grad.addColorStop(1, 'rgba(74,54,26,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
    }
    ctx.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  /** Soft irregular blob as a LINEAR alpha map (for ground patches:
   *  leaf litter, gravel banks, worn dirt). Green channel is read. */
  createPatchAlphaTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    const rnd = this.rand(173);
    for (let i = 0; i < 9; i++) {
      const cx = 34 + rnd() * 60;
      const cy = 34 + rnd() * 60;
      const r = 22 + rnd() * 30;
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  /* ------------- architectural canvas textures (original, procedural) ------------- */

  private canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  private rand(seed: number): () => number {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  private speckle(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, colors: string[], n = 900, alpha = 0.16): void {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.globalAlpha = alpha * (0.5 + rnd());
      const r = 0.6 + rnd() * 1.8;
      ctx.fillRect(rnd() * size, rnd() * size, r, r);
    }
    ctx.globalAlpha = 1;
  }

  createCobblestoneTexture(): THREE.CanvasTexture {
    return this.canvasTexture(256, (ctx, s) => {
      const rnd = this.rand(41);
      ctx.fillStyle = '#7d6c55';
      ctx.fillRect(0, 0, s, s);
      const stones = ['#9b8f7c', '#a89a83', '#8d8172', '#b0a28a', '#978a76'];
      const rows = 5;
      const rh = s / rows;
      for (let r = 0; r < rows; r++) {
        const cols = 4;
        const cw = s / cols;
        const off = r % 2 === 0 ? 0 : cw / 2;
        for (let c = -1; c < cols + 1; c++) {
          const x = c * cw + off + 2 + rnd() * 3;
          const y = r * rh + 2 + rnd() * 3;
          const w = cw - 5 - rnd() * 4;
          const h = rh - 5 - rnd() * 4;
          ctx.fillStyle = stones[Math.floor(rnd() * stones.length)];
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, 9);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.beginPath();
          ctx.roundRect(x + 3, y + 2, w - 6, h * 0.4, 7);
          ctx.fill();
        }
      }
      this.speckle(ctx, s, rnd, ['#6d5f4b', '#c2b498'], 700, 0.14);
    });
  }

  createRoofTileTexture(): THREE.CanvasTexture {
    return this.canvasTexture(256, (ctx, s) => {
      const rnd = this.rand(97);
      ctx.fillStyle = '#9c4f2c';
      ctx.fillRect(0, 0, s, s);
      const shades = ['#b85c33', '#c4673a', '#a85430', '#cf7040'];
      const rowH = 32;
      const colW = 32;
      for (let r = 0; r < s / rowH + 1; r++) {
        for (let c = -1; c < s / colW + 1; c++) {
          const x = c * colW + (r % 2) * (colW / 2);
          const y = r * rowH;
          ctx.fillStyle = shades[Math.floor(rnd() * shades.length)];
          ctx.beginPath();
          ctx.arc(x + colW / 2, y + rowH, colW / 2 - 1, Math.PI, 0);
          ctx.fill();
          ctx.fillRect(x + 1, y, colW - 2, rowH - 4);
          ctx.strokeStyle = 'rgba(70,30,15,0.35)';
          ctx.beginPath();
          ctx.arc(x + colW / 2, y + rowH, colW / 2 - 1, Math.PI, 0);
          ctx.stroke();
        }
      }
      this.speckle(ctx, s, rnd, ['#8a4526', '#d98a54'], 500, 0.12);
    });
  }

  createThatchTexture(): THREE.CanvasTexture {
    return this.canvasTexture(256, (ctx, s) => {
      const rnd = this.rand(53);
      ctx.fillStyle = '#ac8a4e';
      ctx.fillRect(0, 0, s, s);
      const cols = ['#96762f', '#c09a58', '#8a6c38', '#bb9250', '#a3803f'];
      for (let i = 0; i < 2600; i++) {
        ctx.strokeStyle = cols[Math.floor(rnd() * cols.length)];
        ctx.globalAlpha = 0.25 + rnd() * 0.4;
        const x = rnd() * s;
        const y = rnd() * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 3, y + 12 + rnd() * 22);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let y = 0; y < s; y += 64) {
        ctx.fillStyle = 'rgba(90,66,30,0.20)';
        ctx.fillRect(0, y, s, 5);
      }
    });
  }

  createPlasterWallTexture(): THREE.CanvasTexture {
    return this.canvasTexture(256, (ctx, s) => {
      const rnd = this.rand(29);
      ctx.fillStyle = '#e9dec6';
      ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, rnd, ['#d9cbae', '#f4ecd9', '#cbbd9d'], 1200, 0.2);
      ctx.fillStyle = '#6e4c2d';
      ctx.fillRect(0, 0, s, 16); // top beam
      ctx.fillRect(0, s - 16, s, 16); // bottom beam
      ctx.fillRect(0, 0, 16, s); // posts
      ctx.fillRect(s - 16, 0, 16, s);
      ctx.fillRect(s / 2 - 8, 0, 16, s);
      ctx.save();
      ctx.translate(s / 4, s / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-8, -s / 3, 16, (s / 3) * 2);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 16, s, 4);
      ctx.fillRect(0, s - 20, s, 4);
    });
  }

  createWoodPlankTexture(): THREE.CanvasTexture {
    return this.canvasTexture(256, (ctx, s) => {
      const rnd = this.rand(71);
      const base = ['#8a613c', '#7d5734', '#94693f'];
      const plankH = 42;
      for (let y = 0, i = 0; y < s; y += plankH, i++) {
        ctx.fillStyle = base[i % base.length];
        ctx.fillRect(0, y, s, plankH);
        for (let g = 0; g < 26; g++) {
          ctx.strokeStyle = `rgba(60,38,18,${0.08 + rnd() * 0.12})`;
          const gy = y + 4 + rnd() * (plankH - 8);
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.bezierCurveTo(s * 0.3, gy + rnd() * 3 - 1.5, s * 0.7, gy + rnd() * 3 - 1.5, s, gy);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(40,24,10,0.55)';
        ctx.fillRect(0, y + plankH - 2, s, 2);
      }
    });
  }

  /** Soft vertical light-shaft gradient (for fake god rays). */
  createShaftTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const v = ctx.createLinearGradient(0, 0, 0, 256);
    v.addColorStop(0, 'rgba(255,240,200,0.85)');
    v.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 128, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const hz = ctx.createLinearGradient(0, 0, 128, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)');
    hz.addColorStop(0.5, 'rgba(0,0,0,1)');
    hz.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, 128, 256);
    const tex = new THREE.CanvasTexture(canvas);
    this.disposables.push(tex);
    return tex;
  }

  /** Tiny placeholder explorer drawn on canvas, used until a real sprite
   *  sheet is supplied via GraphicsOptions.playerSpriteUrl. Same 4x4
   *  layout as the real sheet: rows down/left/right/up, 4 walk frames. */
  createPlaceholderSpriteSheet(): THREE.CanvasTexture {
    const cell = 64;
    const canvas = document.createElement('canvas');
    canvas.width = cell * 4;
    canvas.height = cell * 4;
    const ctx = canvas.getContext('2d')!;
    const draw = (cx: number, cy: number, row: number, frame: number) => {
      const bob = frame % 2 === 0 ? 0 : -2;
      const legSwing = frame === 1 ? 3 : frame === 3 ? -3 : 0;
      ctx.save();
      // -5 keeps the feet at the sheet layout contract (~11% bottom inset)
      ctx.translate(cx, cy + bob - 5);
      // legs
      ctx.fillStyle = '#4a3423';
      ctx.fillRect(-7 + legSwing, 16, 5, 10);
      ctx.fillRect(2 - legSwing, 16, 5, 10);
      // body (teal tunic)
      ctx.fillStyle = '#2e8f86';
      ctx.fillRect(-10, -2, 20, 19);
      // head
      ctx.fillStyle = '#f2c79b';
      ctx.fillRect(-8, -20, 16, 16);
      // hair / back view
      ctx.fillStyle = '#6b4429';
      if (row === 3) ctx.fillRect(-8, -20, 16, 16);
      else ctx.fillRect(-8, -20, 16, 6);
      // side views: shift the face hint
      if (row === 1 || row === 2) {
        ctx.fillStyle = '#f2c79b';
        ctx.fillRect(row === 1 ? -10 : 5, -14, 5, 8);
      }
      ctx.restore();
    };
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        draw(col * cell + cell / 2, row * cell + cell / 2 + 4, row, col);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    this.disposables.push(tex);
    return tex;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.cache.clear();
  }
}
