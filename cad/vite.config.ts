import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The CAD viewer is a separate page of the static site: /cad/ next to the floor-plan editor.
// It is built into ../static/cad so the main build ships it (web, installed app and APK).
export default defineConfig({
  root: here,
  base: './',
  resolve: {
    alias: { $lib: resolve(here, '../src/lib') },
    dedupe: ['three'],
  },
  build: {
    outDir: resolve(here, '../static/cad'),
    emptyOutDir: true,
    modulePreload: false,
    chunkSizeWarningLimit: 8000,
    target: 'es2022',
  },
  server: { fs: { allow: [resolve(here, '..')] } },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js', dest: 'workers', rename: { stripBase: true } },
        { src: 'node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js', dest: 'workers', rename: { stripBase: true } },
        { src: 'node_modules/@mlightcad/libredwg-converter/dist/libredwg-web.wasm', dest: 'workers', rename: { stripBase: true } },
      ],
    }),
  ],
});
