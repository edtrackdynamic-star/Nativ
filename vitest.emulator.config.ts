import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.emulator.test.ts'],
    fileParallelism: false,
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
})
