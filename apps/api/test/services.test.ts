import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totpAt, verifyTotp } from '../src/auth/totp';
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

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (last 6 digits).
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC test vector at %i', (t, code) => {
    expect(totpAt(secret, t)).toBe(code);
  });

  it('round-trips base32 and allows one step of clock drift', () => {
    const b32 = base32Encode(secret);
    expect(base32Decode(b32).equals(secret)).toBe(true);
    const at = new Date(59_000);
    expect(verifyTotp(b32, '287082', at)).toBe(true);
    expect(verifyTotp(b32, totpAt(secret, 59 + 30), at)).toBe(true);
    expect(verifyTotp(b32, totpAt(secret, 59 + 90), at)).toBe(false);
    expect(verifyTotp(b32, 'abcdef', at)).toBe(false);
  });
});

describe('cards', () => {
  it('issues a debit card at signup', async () => {
    const { client } = await signUp(ctx.app);
    const cards = (await client.get('/cards')).json();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      type: 'DEBIT',
      status: 'ACTIVE',
      accountNickname: 'Everyday Checking',
      expiry: '01/30',
    });
  });

  it('declines purchases while locked, approves after unlocking', async () => {
    const { client } = await signUp(ctx.app);
    const [card] = (await client.get('/cards')).json();

    expect((await client.post(`/cards/${card.id}/lock`)).json().card.status).toBe('LOCKED');
    const declined = (
      await client.money(`/cards/${card.id}/demo-purchase`, { amountCents: 1_234 })
    ).json();
    expect(declined).toMatchObject({ approved: false, reason: 'This card is locked.' });

    await client.post(`/cards/${card.id}/unlock`);
    const approved = await client.money(`/cards/${card.id}/demo-purchase`, { amountCents: 1_234 });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      approved: true,
      amountCents: 1_234,
      account: { balanceCents: 98_766 },
    });
  });

  it("declines over the card's daily limit or the balance", async () => {
    const { client } = await signUp(ctx.app);
    const [card] = (await client.get('/cards')).json();
    const { checking } = await accountsOf(client);
    await client.money('/deposits', {
      accountId: checking.id,
      amountCents: 200_000,
      method: 'CHECK',
    });
    expect(
      (await client.money(`/cards/${card.id}/demo-purchase`, { amountCents: 90_000 })).json()
        .approved,
    ).toBe(true);
    const over = (
      await client.money(`/cards/${card.id}/demo-purchase`, { amountCents: 20_000 })
    ).json();
    expect(over.approved).toBe(false);
    expect(over.reason).toMatch(/daily spending limit/);
  });

  it('reporting a card lost retires it and issues a new number', async () => {
    const { client } = await signUp(ctx.app);
    const [card] = (await client.get('/cards')).json();
    const res = (await client.post(`/cards/${card.id}/report-lost`)).json();
    expect(res.card.status).toBe('ACTIVE');
    expect(res.card.id).not.toBe(card.id);
    expect(res.message).toMatch(/reported lost/);

    const visible = (await client.get('/cards')).json();
    expect(visible.map((c: { status: string }) => c.status).sort()).toEqual([
      'ACTIVE',
      'REPORTED_LOST',
    ]);
    expect((await client.post(`/cards/${card.id}/unlock`)).statusCode).toBe(422);
    expect((await client.money(`/cards/${card.id}/demo-purchase`, {})).json().approved).toBe(false);
  });

  it('keeps cards private', async () => {
    const alice = await signUp(ctx.app);
    const bob = await signUp(ctx.app);
    const [card] = (await alice.client.get('/cards')).json();
    expect((await bob.client.post(`/cards/${card.id}/lock`)).statusCode).toBe(404);
    expect((await bob.client.money(`/cards/${card.id}/demo-purchase`, {})).statusCode).toBe(404);
  });
});

describe('security center', () => {
  it('changes the password, signs out other devices, keeps this one', async () => {
    const { client, email } = await signUp(ctx.app);
    const other = new Client(ctx.app);
    await other.post('/auth/login', { email, password: PASSWORD });

    const wrong = await client.post('/profile/password', {
      currentPassword: 'nope nope nope',
      newPassword: 'a brand new password',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().fields.currentPassword).toBeDefined();

    expect(
      (
        await client.post('/profile/password', {
          currentPassword: PASSWORD,
          newPassword: 'a brand new password',
        })
      ).statusCode,
    ).toBe(204);
    expect((await client.get('/accounts')).statusCode).toBe(200);
    expect((await other.get('/accounts')).statusCode).toBe(401);
    expect(
      (await new Client(ctx.app).post('/auth/login', { email, password: PASSWORD })).statusCode,
    ).toBe(401);
    expect(
      (await new Client(ctx.app).post('/auth/login', { email, password: 'a brand new password' }))
        .statusCode,
    ).toBe(200);
  });

  it('lists sessions and revokes another one, but not this one', async () => {
    const { client, email } = await signUp(ctx.app);
    const other = new Client(ctx.app);
    await other.request(
      'POST',
      '/auth/login',
      { email, password: PASSWORD },
      { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605.1' },
    );

    const sessions = (await client.get('/security/sessions')).json();
    expect(sessions).toHaveLength(2);
    const mine = sessions.find((s: { current: boolean }) => s.current);
    const theirs = sessions.find((s: { current: boolean }) => !s.current);
    expect(theirs.device).toBe('Safari on iOS');

    expect((await client.del(`/security/sessions/${mine.id}`)).statusCode).toBe(422);
    expect((await client.del(`/security/sessions/${theirs.id}`)).statusCode).toBe(204);
    expect((await other.get('/accounts')).statusCode).toBe(401);
  });

  it('shows recent sign-in activity', async () => {
    const { client, email } = await signUp(ctx.app);
    await new Client(ctx.app).post('/auth/login', { email, password: 'wrong wrong wrong' });
    const activity = (await client.get('/security/activity')).json();
    expect(activity.map((a: { action: string }) => a.action)).toContain('LOGIN_FAILED');
  });
});

describe('two-step verification', () => {
  async function enable(client: Client) {
    const setup = (await client.post('/auth/2fa/setup')).json();
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    const code = totpAt(base32Decode(setup.secret), ctx.clock.now().getTime() / 1000);
    expect(
      (await client.post('/auth/2fa/verify', { code: '000000' === code ? '111111' : '000000' }))
        .statusCode,
    ).toBe(400);
    expect((await client.post('/auth/2fa/verify', { code })).statusCode).toBe(204);
    return setup.secret as string;
  }

  it('turns on with a confirmed code and then requires it at check-in', async () => {
    const { client, email } = await signUp(ctx.app);
    const secret = await enable(client);
    expect((await client.get('/auth/2fa')).json()).toEqual({ enabled: true });

    const noCode = await new Client(ctx.app).post('/auth/login', { email, password: PASSWORD });
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().error).toBe('TWO_FACTOR_REQUIRED');
    expect(noCode.cookies.find((c) => c.name === 'bb_session')).toBeUndefined();

    const badCode = await new Client(ctx.app).post('/auth/login', {
      email,
      password: PASSWORD,
      totpCode: '123456',
    });
    expect(badCode.json().error).toBe('TWO_FACTOR_INVALID');

    const code = totpAt(base32Decode(secret), ctx.clock.now().getTime() / 1000);
    const ok = await new Client(ctx.app).post('/auth/login', {
      email,
      password: PASSWORD,
      totpCode: code,
    });
    expect(ok.statusCode).toBe(200);

    // A wrong password with 2FA on still says nothing about the code.
    const wrongPassword = await new Client(ctx.app).post('/auth/login', {
      email,
      password: 'nope nope nope',
      totpCode: code,
    });
    expect(wrongPassword.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('counts bad codes toward lockout', async () => {
    const { client, email } = await signUp(ctx.app);
    await enable(client);
    let last;
    for (let i = 0; i < 5; i++) {
      last = await new Client(ctx.app).post('/auth/login', {
        email,
        password: PASSWORD,
        totpCode: '000001',
      });
    }
    expect(last!.statusCode).toBe(423);
  });

  it('turns off only with a valid code', async () => {
    const { client } = await signUp(ctx.app);
    const secret = await enable(client);
    expect((await client.post('/auth/2fa/disable', { code: '999999' })).statusCode).toBe(400);
    const code = totpAt(base32Decode(secret), ctx.clock.now().getTime() / 1000);
    expect((await client.post('/auth/2fa/disable', { code })).statusCode).toBe(204);
    expect((await client.get('/auth/2fa')).json()).toEqual({ enabled: false });
  });
});

describe('support and notifications', () => {
  it('opens a ticket with an automatic reply, lets you reply and close it', async () => {
    const { client } = await signUp(ctx.app);
    const ticket = (
      await client.post('/support/tickets', {
        subject: 'Where is the vault?',
        message: 'I saw a big round door.',
      })
    ).json();
    expect(ticket).toMatchObject({
      status: 'ANSWERED',
      messages: [{ author: 'CUSTOMER' }, { author: 'STAFF' }],
    });

    const replied = (
      await client.post(`/support/tickets/${ticket.id}/messages`, { message: 'Thanks!' })
    ).json();
    expect(replied).toMatchObject({ status: 'OPEN' });
    expect(replied.messages).toHaveLength(3);

    expect((await client.post(`/support/tickets/${ticket.id}/close`)).statusCode).toBe(204);
    expect(
      (await client.post(`/support/tickets/${ticket.id}/messages`, { message: 'Again' }))
        .statusCode,
    ).toBe(422);
  });

  it('keeps tickets and notifications private', async () => {
    const alice = await signUp(ctx.app);
    const bob = await signUp(ctx.app);
    const ticket = (
      await alice.client.post('/support/tickets', {
        subject: 'Hello there',
        message: 'A question.',
      })
    ).json();
    expect((await bob.client.get('/support/tickets')).json()).toEqual([]);
    expect(
      (await bob.client.post(`/support/tickets/${ticket.id}/messages`, { message: 'hi' }))
        .statusCode,
    ).toBe(404);
    const [note] = (await alice.client.get('/notifications')).json();
    expect((await bob.client.post(`/notifications/${note.id}/read`)).statusCode).toBe(404);
  });

  it('marks notifications read, and the session reports the unread count', async () => {
    const { client } = await signUp(ctx.app);
    await client.post('/support/tickets', { subject: 'First one', message: 'Hello hello' });
    await client.post('/support/tickets', { subject: 'Second one', message: 'Hello again' });
    expect((await client.get('/auth/session')).json().unreadNotifications).toBe(2);

    const [newest] = (await client.get('/notifications')).json();
    await client.post(`/notifications/${newest.id}/read`);
    expect((await client.get('/auth/session')).json().unreadNotifications).toBe(1);
    await client.post('/notifications/read-all');
    expect((await client.get('/auth/session')).json().unreadNotifications).toBe(0);
  });
});
