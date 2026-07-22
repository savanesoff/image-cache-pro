import path from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/index.ts'),
      name: 'image-cache',
    },
    // Cobalt is a Chrome-88-class browser — the published bundle must not
    // assume newer syntax.
    target: 'chrome88',
    sourcemap: true,
    rollupOptions: {
      output: [
        {
          format: 'es',
          entryFileNames: '[name].js',
          dir: 'dist/esm',
          sourcemap: true,
        },
        {
          // .cjs: the package is type:module — plain .js here would be
          // (mis)interpreted as ESM by Node and bundlers (publint)
          format: 'cjs',
          entryFileNames: '[name].cjs',
          dir: 'dist/cjs',
          sourcemap: true,
        },
      ],
    },
  },
  plugins: [
    dts({
      outDirs: ['dist/types'],
      entryRoot: 'src',
      include: ['src'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', 'src/__mocks__/**'],
    }),
  ],
})
