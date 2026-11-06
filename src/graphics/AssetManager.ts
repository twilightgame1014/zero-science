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
