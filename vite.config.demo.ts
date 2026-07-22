import path from 'node:path'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

/**
 * Demo app config (GH Pages + on-box verification).
 * Separate from the library build (vite.config.ts).
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'demo'),
  // relative base so the same build works on GH Pages and http://<host>:<port>/
  base: './',
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // Cobalt is a Chrome-88-class browser
    target: 'chrome88',
    outDir: path.resolve(import.meta.dirname, 'dist-demo'),
    emptyOutDir: true,
    sourcemap: true,
  },
  plugins: [
    // Cobalt does not execute <script type="module"> — ship a classic
    // (nomodule/SystemJS) bundle transpiled for Chrome 88 alongside the
    // modern one. Desktop browsers keep the modern path.
    legacy({
      targets: ['chrome 88'],
      // no core-js: Cobalt's JS engine is Chrome-88-class (the syntax
      // target), and core-js's URL polyfill hard-crashes on Cobalt's Web
      // API subset (bare URLSearchParams reference). SystemJS still ships.
      polyfills: false,
    }),
  ],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
