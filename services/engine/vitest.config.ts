import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // PGlite boots a WASM Postgres per suite; give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
