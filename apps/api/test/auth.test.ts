import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  PASSWORD,
  accountsOf,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.close());

describe('signup', () => {
  it('opens checking + savings with the welcome bonus and signs you in', async () => {
    const client = new Client(ctx.app);
    const res = await client.post('/auth/signup', {
      email: '  New.Customer@Bramblewood.test ',
      password: PASSWORD,
      name: 'New Customer',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      authenticated: true,
      user: { email: 'new.customer@bramblewood.test' },
    });

    const cookie = res.cookies.find((c) => c.name === 'bb_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });

    const { checking, savings } = await accountsOf(client);
    expect(checking.balanceCents).toBe(100_000);
    expect(savings.balanceCents).toBe(0);
  });

  it('stores an argon2id hash and only a hash of the session token', async () => {
    const { client, email } = await signUp(ctx.app);
    const user = await ctx.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).not.toContain(PASSWORD);

    const token = client.cookie!.split('=')[1]!;
    const sessions = await ctx.db.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
  });

  it('gives a vague error for an email that already banks here', async () => {
    const { email } = await signUp(ctx.app);
    const res = await new Client(ctx.app).post('/auth/signup', {
      email,
      password: PASSWORD,
      name: 'Again',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('SIGNUP_FAILED');
  });

  it('returns field errors for weak input', async () => {
    const res = await new Client(ctx.app).post('/auth/signup', {
      email: 'not-an-email',
      password: 'short',
      name: '',
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().fields).sort()).toEqual(['email', 'name', 'password']);
  });

  it('rejects non-JSON bodies (CSRF defense for unauthenticated forms)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { 'content-type': 'text/plain' },
      payload: '{"email":"x@y.test"}',
    });
    expect(res.statusCode).toBe(415);
  });
});

describe('login', () => {
  it('signs in with the right password', async () => {
    const { email } = await signUp(ctx.app);
    const client = new Client(ctx.app);
    const res = await client.post('/auth/login', { email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().authenticated).toBe(true);
    expect((await client.get('/accounts')).statusCode).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email } = await signUp(ctx.app);
    const wrong = await new Client(ctx.app).post('/auth/login', {
      email,
      password: 'wrong password!!',
    });
    const unknown = await new Client(ctx.app).post('/auth/login', {
      email: 'nobody@bramblewood.test',
      password: 'wrong password!!',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('locks after repeated failures, even for the right password, then unlocks after the cooldown', async () => {
    const { email } = await signUp(ctx.app);
    const client = new Client(ctx.app);

    for (let i = 0; i < 4; i++) {
      expect(
        (await client.post('/auth/login', { email, password: 'wrong password!!' })).statusCode,
      ).toBe(401);
    }
    const fifth = await client.post('/auth/login', { email, password: 'wrong password!!' });
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json().error).toBe('LOCKED');

    expect((await client.post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(423);

    ctx.clock.advanceMinutes(16);
    expect((await client.post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);

    const failures = await ctx.db.auditLog.count({ where: { action: 'LOGIN_FAILED' } });
    expect(failures).toBe(5);
  });

  it('rotates the session: the old cookie stops working after a new login', async () => {
    const { client, email } = await signUp(ctx.app);
    const oldCookie = client.cookie;

    await client.post('/auth/login', { email, password: PASSWORD });
    expect(client.cookie).not.toBe(oldCookie);

    const stale = new Client(ctx.app);
    stale.cookie = oldCookie;
    expect((await stale.get('/accounts')).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('reports status without requiring a session', async () => {
    const res = await new Client(ctx.app).get('/auth/session');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: false });
  });

  it('expires after the idle timeout', async () => {
    const { client } = await signUp(ctx.app);
    ctx.clock.advanceMinutes(16);
    expect((await client.get('/accounts')).statusCode).toBe(401);
    expect((await client.get('/auth/session')).json()).toEqual({ authenticated: false });
  });

  it('activity slides the idle timeout, but status polling does not', async () => {
    const { client } = await signUp(ctx.app);

    ctx.clock.advanceMinutes(10);
    expect((await client.get('/accounts')).statusCode).toBe(200); // activity
    ctx.clock.advanceMinutes(10);
    expect((await client.get('/auth/session')).json().authenticated).toBe(true); // poll only
    ctx.clock.advanceMinutes(6);
    expect((await client.get('/accounts')).statusCode).toBe(401);
  });

  it('refresh extends the session from the timeout warning', async () => {
    const { client } = await signUp(ctx.app);
    ctx.clock.advanceMinutes(14);
    expect((await client.post('/auth/session/refresh')).statusCode).toBe(200);
    ctx.clock.advanceMinutes(14);
    expect((await client.get('/accounts')).statusCode).toBe(200);
  });

  it('reports server time and when the idle timeout will hit', async () => {
    const { client } = await signUp(ctx.app);
    ctx.clock.advanceMinutes(3);
    const session = (await client.get('/auth/session')).json();
    const serverTime = Date.parse(session.serverTime);
    expect(serverTime).toBe(ctx.clock.now().getTime());
    // Signed up 3 minutes ago, untouched since: 12 minutes of idle time left.
    expect(Date.parse(session.idleExpiresAt) - serverTime).toBe(12 * 60_000);
  });

  it('ends at the absolute timeout regardless of activity', async () => {
    const { client } = await signUp(ctx.app);
    for (let i = 0; i < 12 * 6; i++) {
      ctx.clock.advanceMinutes(10);
      const res = await client.get('/accounts');
      if (res.statusCode === 401) {
        expect(i).toBe(12 * 6 - 1); // exactly at 12 hours
        return;
      }
    }
    throw new Error('session never hit its absolute timeout');
  });

  it('logout ends the session and needs the CSRF token', async () => {
    const { client } = await signUp(ctx.app);

    const forged = await client.request('POST', '/auth/logout', {}, { 'x-csrf-token': 'nope' });
    expect(forged.statusCode).toBe(403);
    expect(forged.json().error).toBe('CSRF');

    expect((await client.post('/auth/logout')).statusCode).toBe(200);
    expect(client.cookie).toBeUndefined();
    expect(await ctx.db.session.count()).toBe(0);
  });
});

describe('CSRF', () => {
  it('blocks state changes without the token but allows reads', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    client.csrfToken = undefined;

    expect((await client.get(`/accounts/${checking.id}`)).statusCode).toBe(200);
    const res = await client.patch(`/accounts/${checking.id}`, { nickname: 'Hacked' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CSRF');
  });
});

describe('rate limits', () => {
  it('throttles login attempts per IP', async () => {
    const limited = await createTestContext({ RATE_LIMITS_ENABLED: 'true' });
    try {
      const client = new Client(limited.app);
      const attempt = () =>
        client.post('/auth/login', { email: 'x@bramblewood.test', password: 'whatever' });
      for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
      const res = await attempt();
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
