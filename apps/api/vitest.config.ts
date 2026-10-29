import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // argon2 hashing makes auth tests slower than usual unit tests.
    testTimeout: 20_000,
  },
});
