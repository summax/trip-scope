import { defineConfig } from 'vitest/config'

// 单测只覆盖纯函数核心与 store 草稿链路;e2e 由 tests/verify.mjs 承担
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
})
