import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, accountsOf, createTestContext, signUp, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.close());

describe('authorization', () => {
  it('requires a session for every account and money route', async () => {
    const anon = new Client(ctx.app);
    for (const res of [
      await anon.get('/accounts'),
      await anon.get('/accounts/anything'),
      await anon.get('/accounts/anything/transactions'),
      await anon.patch('/accounts/anything', { nickname: 'x' }),
      await anon.transfer({ fromAccountId: 'a', toAccountId: 'b', amountCents: 1 }),
    ]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('UNAUTHENTICATED');
    }
  });

  it("never lets user B see or touch user A's accounts", async () => {
    const alice = await signUp(ctx.app, 'Alice');
    const bob = await signUp(ctx.app, 'Bob');
    const a = await accountsOf(alice.client);
    const b = await accountsOf(bob.client);

    expect(b.all.map((x) => x.id)).not.toContain(a.checking.id);

    // Reads look like the account doesn't exist, so ids can't be probed.
    expect((await bob.client.get(`/accounts/${a.checking.id}`)).statusCode).toBe(404);
    expect((await bob.client.get(`/accounts/${a.checking.id}/transactions`)).statusCode).toBe(404);
    expect(
      (await bob.client.patch(`/accounts/${a.checking.id}`, { nickname: 'Mine now' })).statusCode,
    ).toBe(404);

    // Pulling from Alice's account, or pushing into it, both fail.
    const pull = await bob.client.transfer({
      fromAccountId: a.checking.id,
      toAccountId: b.checking.id,
      amountCents: 50_000,
    });
    expect(pull.statusCode).toBe(404);
    const push = await bob.client.transfer({
      fromAccountId: b.checking.id,
      toAccountId: a.savings.id,
      amountCents: 100,
    });
    expect(push.statusCode).toBe(404);

    const after = await accountsOf(alice.client);
    expect(after.checking.balanceCents).toBe(100_000);
    expect(after.checking).toMatchObject({ nickname: 'Everyday Checking' });
    expect((await accountsOf(bob.client)).checking.balanceCents).toBe(100_000);
  });

  it('never exposes system accounts to customers', async () => {
    const { client } = await signUp(ctx.app);
    const system = await ctx.db.account.findUniqueOrThrow({
      where: { systemCode: 'WELCOME_BONUS' },
    });
    expect((await client.get(`/accounts/${system.id}`)).statusCode).toBe(404);
    const { checking } = await accountsOf(client);
    expect(
      (
        await client.transfer({
          fromAccountId: system.id,
          toAccountId: checking.id,
          amountCents: 1,
        })
      ).statusCode,
    ).toBe(404);
  });
});
