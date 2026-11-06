import { defineConfig } from 'vite';

// The demo lives in demo/ and imports the graphics module from src/graphics.
// The module itself has no build-time dependency on the demo.
export default defineConfig({
  root: 'demo',
  publicDir: false,
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
