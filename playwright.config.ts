import { defineConfig, devices } from '@playwright/test';

// End-to-end and accessibility tests. Separate ports and database from
// `npm run dev`, so both can run at once.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5273',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: 'http://127.0.0.1:3101/api/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w @dddbanker/web',
      url: 'http://127.0.0.1:5273',
      env: { VITE_PORT: '5273', VITE_API_TARGET: 'http://127.0.0.1:3101' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
