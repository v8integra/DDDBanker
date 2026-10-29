import { randomUUID } from 'node:crypto';
import { copyFileSync, rmSync } from 'node:fs';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { inject } from 'vitest';
import { CSRF_HEADER, IDEMPOTENCY_HEADER, type SessionInfo } from '@dddbanker/shared';
import { buildApp } from '../src/app';
import type { Clock } from '../src/clock';
import { loadConfig } from '../src/config';
import { createDb, type Db } from '../src/db';

export class TestClock implements Clock {
  private current = new Date('2026-01-15T12:00:00Z');
  now() {
    return new Date(this.current);
  }
  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  clock: TestClock;
  close(): Promise<void>;
}

/** A fresh app on its own copy of the migrated database. */
export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const file = `.test-dbs/${randomUUID()}.db`;
  copyFileSync(inject('templateDb'), file);

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    RATE_LIMITS_ENABLED: 'false',
    DATABASE_URL: `file:./${file}`,
    ...env,
  });
  const db = createDb(config.DATABASE_URL);
  const clock = new TestClock();
  const app = await buildApp({ config, db, clock });

  return {
    app,
    db,
    clock,
    async close() {
      await app.close();
      await db.$disconnect();
      try {
        rmSync(file, { force: true });
      } catch {
        // Windows can hold the SQLite file briefly after disconnect;
        // global teardown removes the whole folder once workers exit.
      }
    },
  };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** A browser-like client: keeps the session cookie and sends the CSRF token. */
export class Client {
  cookie: string | undefined;
  csrfToken: string | undefined;

  constructor(private readonly app: FastifyInstance) {}

  async request(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const options: InjectOptions = {
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(this.cookie && { cookie: this.cookie }),
        ...(this.csrfToken && method !== 'GET' && { [CSRF_HEADER]: this.csrfToken }),
        ...headers,
      },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    const res = await this.app.inject(options);

    const sessionCookie = res.cookies.find((c) => c.name === 'bb_session');
    if (sessionCookie)
      this.cookie = sessionCookie.value ? `bb_session=${sessionCookie.value}` : undefined;
    const json = res.headers['content-type']?.includes('json') ? res.json() : undefined;
    if (json && typeof json === 'object' && 'authenticated' in json) {
      const session = json as SessionInfo;
      this.csrfToken = session.authenticated ? session.csrfToken : undefined;
    }
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown, headers?: Record<string, string>) =>
    this.request('POST', url, body ?? {}, headers);
  patch = (url: string, body: unknown) => this.request('PATCH', url, body);

  del = (url: string) => this.request('DELETE', url);

  transfer(body: unknown, key: string = randomUUID()) {
    return this.post('/transfers', body, { [IDEMPOTENCY_HEADER]: key });
  }

  /** Any money-moving POST, with a fresh Idempotency-Key unless one is given. */
  money(url: string, body: unknown, key: string = randomUUID()) {
    return this.post(url, body, { [IDEMPOTENCY_HEADER]: key });
  }
}

export const PASSWORD = 'correct horse battery staple';

let counter = 0;
export async function signUp(app: FastifyInstance, name = 'Test Customer') {
  const client = new Client(app);
  const email = `customer${++counter}-${randomUUID().slice(0, 8)}@bramblewood.test`;
  const res = await client.post('/auth/signup', { email, password: PASSWORD, name });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  return { client, email };
}

export async function accountsOf(client: Client) {
  const res = await client.get('/accounts');
  const accounts = res.json() as { id: string; type: string; balanceCents: number }[];
  const find = (type: string) => {
    const account = accounts.find((a) => a.type === type);
    if (!account) throw new Error(`no ${type} account`);
    return account;
  };
  return { all: accounts, checking: find('CHECKING'), savings: find('SAVINGS') };
}
