import Fastify from 'fastify';
import { API_PREFIX, BANK } from '@dddbanker/shared';
import type { Config } from './config';

export function buildApp(config: Config) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Never log credentials or session tokens.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
  });

  app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, bank: BANK.name }));
    },
    { prefix: API_PREFIX },
  );

  return app;
}
