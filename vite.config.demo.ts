import path from 'node:path'
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
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
