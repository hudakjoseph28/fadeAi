import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    pool: 'forks',          // run in a single thread to reduce memory
    isolate: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: "default",
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
