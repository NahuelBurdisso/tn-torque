import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    // setupFiles corre DENTRO de cada worker: es el único lugar desde el que
    // se puede cargar .env para que los tests vean TNT_TEST_DATABASE_URL.
    // globalSetup corre en otro proceso y sus env vars no se propagan.
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./packages/db/src/test-setup.ts'],
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
