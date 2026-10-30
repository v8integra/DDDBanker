import { defineConfig, devices } from '@playwright/test';

// End-to-end and accessibility tests. Separate ports and database from
// `npm run dev`, so both can run at once. With E2E_PROD=1 the same specs run
// against the production build, served by the API (`npm run test:e2e:prod`).
const prod = Boolean(process.env.E2E_PROD);
const api = {
  command: 'node e2e/start-api.mjs',
  url: 'http://127.0.0.1:3101/api/v1/health',
  reuseExistingServer: false,
  timeout: 120_000,
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: prod ? 'http://127.0.0.1:3101' : 'http://127.0.0.1:5273',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: prod
    ? [api]
    : [
        api,
        {
          command: 'npm run dev -w @dddbanker/web',
          url: 'http://127.0.0.1:5273',
          env: { VITE_PORT: '5273', VITE_API_TARGET: 'http://127.0.0.1:3101' },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
