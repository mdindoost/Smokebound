import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure logic and the end-to-end run. No renderer: the screens are thin, and
    // a render harness for React Native buys less than it costs at this stage.
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
