import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // argon2 hashing makes auth tests slower than usual unit tests.
    testTimeout: 20_000,
    // One test file at a time. In parallel, a worker occasionally crashed
    // natively (0xC0000005) on Windows, likely in the SQLite driver while many
    // test databases open and close at once. Serial runs were stable (5/5).
    fileParallelism: false,
  },
});
