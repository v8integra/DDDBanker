import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = buildApp(config);

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
