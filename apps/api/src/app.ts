import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimitPlugin from '@fastify/rate-limit';
import { API_PREFIX, BANK } from '@dddbanker/shared';
import type { AppDeps } from './deps';
import { registerErrorHandling } from './errors';
import { accountRoutes } from './routes/accounts';
import { authRoutes } from './routes/auth';
import { transferRoutes } from './routes/transfers';

export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    logger: {
      level: config.LOG_LEVEL,
      // Never log credentials or session tokens. Request bodies aren't logged at all.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
  });

  // JSON only. Cross-site HTML forms can't send application/json without a
  // CORS preflight, which is the CSRF defense for login and signup.
  app.removeContentTypeParser('text/plain');

  app.decorateRequest('auth', null);
  registerErrorHandling(app);

  await app.register(helmet, {
    strictTransportSecurity: config.secureCookies,
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cookie);
  if (config.RATE_LIMITS_ENABLED) {
    await app.register(rateLimitPlugin, { global: false });
  }

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, bank: BANK.name }));
      await api.register(authRoutes(deps));
      await api.register(accountRoutes(deps));
      await api.register(transferRoutes(deps));
    },
    { prefix: API_PREFIX },
  );

  return app;
}
