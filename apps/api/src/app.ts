import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimitPlugin from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { API_PREFIX, BANK } from '@dddbanker/shared';
import type { AppDeps } from './deps';
import { registerErrorHandling } from './errors';
import { accountRoutes } from './routes/accounts';
import { authRoutes } from './routes/auth';
import { lendingRoutes } from './routes/lending';
import { moneyRoutes } from './routes/money';
import { serviceRoutes } from './routes/services';
import { transferRoutes } from './routes/transfers';

/**
 * CSP for the web pages (the API keeps `default-src 'none'`). Rapier compiles
 * WebAssembly, hence 'wasm-unsafe-eval'. Fonts are self-hosted, so nothing
 * loads from other origins. Inline style attributes are allowed (a few
 * elements set CSS variables), but inline scripts and style blocks are not.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

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
      await api.register(moneyRoutes(deps));
      await api.register(serviceRoutes(deps));
      await api.register(lendingRoutes(deps));
    },
    { prefix: API_PREFIX },
  );

  if (config.WEB_DIST) await serveWeb(app, resolve(config.WEB_DIST));

  return app;
}

/** The built web app, from the same origin as the API. */
async function serveWeb(app: FastifyInstance, root: string) {
  await app.register(async (web) => {
    web.addHook('onSend', async (_req, reply) => {
      reply.header('content-security-policy', WEB_CSP);
    });
    await web.register(fastifyStatic, {
      root,
      index: 'index.html',
      wildcard: false,
      setHeaders: (reply, path) => {
        // File names under assets/ include a content hash, so they never change.
        const hashed = /[\\/]assets[\\/]/.test(path);
        reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  });
}
