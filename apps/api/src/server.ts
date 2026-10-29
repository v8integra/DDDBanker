import { buildApp } from './app';
import { systemClock } from './clock';
import { loadConfig } from './config';
import { createDb } from './db';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = await buildApp({ config, db, clock: systemClock });

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}
