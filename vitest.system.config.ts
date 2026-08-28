import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.system.test.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
