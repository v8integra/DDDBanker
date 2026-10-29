import { afterAll, describe, expect, it } from 'vitest';
import { BANK } from '@dddbanker/shared';
import { buildApp } from './app';
import { loadConfig } from './config';

const app = buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }));
afterAll(() => app.close());

describe('GET /api/v1/health', () => {
  it('reports ok with the bank name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, bank: BANK.name });
  });

  it('404s outside the API prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(404);
  });
});
