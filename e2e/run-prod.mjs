// `npm run test:e2e:prod`: the Playwright specs against the production build.
// (A launcher instead of `E2E_PROD=1 playwright test`, which Windows shells can't do.)
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx playwright test', process.argv.slice(2), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_PROD: '1' },
});
process.exit(result.status ?? 1);
