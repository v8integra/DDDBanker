// Starts the API for end-to-end tests on a fresh, seeded database of its own,
// so test runs never touch the dev database and always start from the seed.
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api');
// E2E_PROD=1 runs the production build: one origin serving the built web
// app, secure cookies, the page CSP, rate limits on and dev tools off.
const prod = Boolean(process.env.E2E_PROD);
const env = {
  ...process.env,
  DATABASE_URL: 'file:./prisma/e2e.db',
  API_PORT: '3101',
  LOG_LEVEL: 'warn',
  ...(prod
    ? { NODE_ENV: 'production', WEB_DIST: '../web/dist' }
    : { RATE_LIMITS_ENABLED: 'false' }),
};

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  rmSync(resolve(api, `prisma/e2e.db${suffix}`), { force: true });
}
execSync('npx prisma migrate deploy', { cwd: api, env, stdio: 'inherit' });
execSync('npx prisma db seed', { cwd: api, env, stdio: 'inherit' });

const server = spawn('npx tsx src/server.ts', { cwd: api, env, stdio: 'inherit', shell: true });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
