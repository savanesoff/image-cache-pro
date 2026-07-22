import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts'],
    // Playwright owns tests/e2e
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
})
