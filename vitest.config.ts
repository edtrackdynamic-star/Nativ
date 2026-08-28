import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/functions/lib/**', '**/*.emulator.test.ts'],
  },
})
