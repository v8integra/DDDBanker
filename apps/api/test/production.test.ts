import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { WEB_CSP } from '../src/app';
import { loadConfig } from '../src/config';
import { createTestContext } from './helpers';

describe('production config', () => {
  it('uses secure cookies and turns dev tools off by default', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(config.secureCookies).toBe(true);
    expect(config.sessionCookieName).toBe('__Host-bb_session');
    expect(config.devTools).toBe(false);
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_TOOLS: 'true' })).toThrow(/DEV_TOOLS/);
    expect(() => loadConfig({ NODE_ENV: 'production', RATE_LIMITS_ENABLED: 'false' })).toThrow(
      /RATE_LIMITS/,
    );
  });
});

describe('serving the web app', () => {
  const dist = `.test-dbs/web-${randomUUID()}`;
  mkdirSync(`${dist}/assets`, { recursive: true });
  writeFileSync(`${dist}/index.html`, '<!doctype html><title>Bank</title>');
  writeFileSync(`${dist}/assets/main-abc123.js`, 'console.log(1)');
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('serves pages with the web CSP, and hashed assets as immutable', async () => {
    const ctx = await createTestContext({ WEB_DIST: dist });
    try {
      const page = await ctx.app.inject({ method: 'GET', url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>Bank</title>');
      expect(page.headers['content-security-policy']).toBe(WEB_CSP);
      expect(page.headers['cache-control']).toBe('no-cache');
      expect(page.headers['x-content-type-options']).toBe('nosniff');

      const asset = await ctx.app.inject({ method: 'GET', url: '/assets/main-abc123.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');

      // The API keeps its own, stricter policy.
      const health = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(health.headers['content-security-policy']).toContain("default-src 'none'");

      const missing = await ctx.app.inject({ method: 'GET', url: '/nope.html' });
      expect(missing.statusCode).toBe(404);
    } finally {
      await ctx.close();
    }
  });

  it('serves nothing but the API without WEB_DIST', async () => {
    const ctx = await createTestContext();
    try {
      expect((await ctx.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    } finally {
      await ctx.close();
    }
  });
});
