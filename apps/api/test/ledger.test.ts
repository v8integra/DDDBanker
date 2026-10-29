import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LedgerError, postTransaction } from '../src/ledger/ledger';
import { getSystemAccountId } from '../src/ledger/system-accounts';
import { accountsOf, createTestContext, signUp, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.close());

/** The books must always balance, and cached balances must match the ledger. */
async function expectLedgerConsistent() {
  const accounts = await ctx.db.account.findMany({ include: { entries: true } });
  let grandTotal = 0n;
  for (const account of accounts) {
    const sum = account.entries.reduce((s, e) => s + e.amountCents, 0n);
    expect(account.balanceCents, `${account.nickname} balance`).toBe(sum);
    grandTotal += account.balanceCents;
  }
  expect(grandTotal).toBe(0n);

  const transactions = await ctx.db.transaction.findMany({ include: { entries: true } });
  for (const t of transactions) {
    expect(
      t.entries.reduce((s, e) => s + e.amountCents, 0n),
      `transaction ${t.id}`,
    ).toBe(0n);
  }
}

describe('transfers', () => {
  it('moves money between own accounts and records both sides', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);

    const res = await client.transfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 25_050,
      memo: 'Rainy day',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      from: { id: checking.id, balanceCents: 74_950 },
      to: { id: savings.id, balanceCents: 25_050 },
    });

    const history = (await client.get(`/accounts/${checking.id}/transactions`)).json();
    expect(history.items[0]).toMatchObject({
      type: 'TRANSFER',
      description: 'Transfer to Bramble Savings',
      memo: 'Rainy day',
      amountCents: -25_050,
      balanceAfterCents: 74_950,
    });
    expect(history.items[1]).toMatchObject({ type: 'WELCOME_BONUS', amountCents: 100_000 });

    const savingsHistory = (await client.get(`/accounts/${savings.id}/transactions`)).json();
    expect(savingsHistory.items[0]).toMatchObject({
      description: 'Transfer from Everyday Checking',
      amountCents: 25_050,
    });

    await expectLedgerConsistent();
  });

  it('declines when funds are short and changes nothing', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    const entriesBefore = await ctx.db.ledgerEntry.count();

    const res = await client.transfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 100_001,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INSUFFICIENT_FUNDS');

    expect(await ctx.db.ledgerEntry.count()).toBe(entriesBefore);
    expect((await accountsOf(client)).checking.balanceCents).toBe(100_000);
    await expectLedgerConsistent();
  });

  it('validates amounts and accounts', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    for (const amountCents of [0, -500, 12.5, '500']) {
      const res = await client.transfer({
        fromAccountId: checking.id,
        toAccountId: 'other',
        amountCents,
      });
      expect(res.statusCode, `amount ${amountCents}`).toBe(400);
    }
    const same = await client.transfer({
      fromAccountId: checking.id,
      toAccountId: checking.id,
      amountCents: 100,
    });
    expect(same.statusCode).toBe(400);
    expect(same.json().fields.toAccountId).toBeDefined();
  });

  it('never overdraws under concurrent requests', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.transfer({
          fromAccountId: checking.id,
          toAccountId: savings.id,
          amountCents: 30_000,
        }),
      ),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 201, 201, 422, 422]);
    expect((await accountsOf(client)).checking.balanceCents).toBe(10_000);
    await expectLedgerConsistent();
  });
});

describe('idempotency', () => {
  it('requires a key', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    const res = await client.post('/transfers', {
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 1,
    });
    expect(res.statusCode).toBe(400);
  });

  it('replays a retried request instead of moving money twice', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    const body = { fromAccountId: checking.id, toAccountId: savings.id, amountCents: 10_000 };
    const key = randomUUID();

    const first = await client.transfer(body, key);
    const second = await client.transfer(body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().transactionId).toBe(first.json().transactionId);
    expect((await accountsOf(client)).checking.balanceCents).toBe(90_000);
  });

  it('handles a double-click (simultaneous identical requests) as one transfer', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    const body = { fromAccountId: checking.id, toAccountId: savings.id, amountCents: 10_000 };
    const key = randomUUID();

    const [a, b] = await Promise.all([client.transfer(body, key), client.transfer(body, key)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().transactionId).toBe(b.json().transactionId);
    expect((await accountsOf(client)).checking.balanceCents).toBe(90_000);
    expect(await ctx.db.transaction.count({ where: { type: 'TRANSFER' } })).toBe(1);
  });

  it('rejects a reused key with a different body', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    const key = randomUUID();
    await client.transfer(
      { fromAccountId: checking.id, toAccountId: savings.id, amountCents: 100 },
      key,
    );
    const res = await client.transfer(
      { fromAccountId: checking.id, toAccountId: savings.id, amountCents: 999 },
      key,
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('keys are per user', async () => {
    const alice = await signUp(ctx.app);
    const bob = await signUp(ctx.app);
    const a = await accountsOf(alice.client);
    const b = await accountsOf(bob.client);
    const key = randomUUID();

    await alice.client.transfer(
      { fromAccountId: a.checking.id, toAccountId: a.savings.id, amountCents: 100 },
      key,
    );
    const res = await bob.client.transfer(
      { fromAccountId: b.checking.id, toAccountId: b.savings.id, amountCents: 100 },
      key,
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('postTransaction', () => {
  it('refuses unbalanced or degenerate entries', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const at = ctx.clock.now();

    await expect(
      ctx.db.$transaction(async (tx) => {
        const vault = await getSystemAccountId(tx, 'CASH_VAULT');
        await postTransaction(tx, {
          type: 'DEPOSIT',
          description: 'Bad',
          at,
          entries: [
            { accountId: vault, amountCents: -100n, description: 'x' },
            { accountId: checking.id, amountCents: 101n, description: 'x' },
          ],
        });
      }),
    ).rejects.toThrow(LedgerError);

    await expect(
      ctx.db.$transaction((tx) =>
        postTransaction(tx, {
          type: 'DEPOSIT',
          description: 'Bad',
          at,
          entries: [{ accountId: checking.id, amountCents: 100n, description: 'x' }],
        }),
      ),
    ).rejects.toThrow(LedgerError);

    await expectLedgerConsistent();
  });
});

describe('transaction history', () => {
  it('pages from newest to oldest', async () => {
    const { client } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    for (let i = 1; i <= 5; i++) {
      await client.transfer({
        fromAccountId: checking.id,
        toAccountId: savings.id,
        amountCents: i * 100,
      });
    }

    const first = (await client.get(`/accounts/${checking.id}/transactions?limit=4`)).json();
    expect(first.items.map((x: { amountCents: number }) => x.amountCents)).toEqual([
      -500, -400, -300, -200,
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await client.get(`/accounts/${checking.id}/transactions?limit=4&before=${first.nextCursor}`)
    ).json();
    expect(second.items.map((x: { amountCents: number }) => x.amountCents)).toEqual([
      -100, 100_000,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('renames an account', async () => {
    const { client } = await signUp(ctx.app);
    const { savings } = await accountsOf(client);
    const res = await client.patch(`/accounts/${savings.id}`, { nickname: '  Vacation Fund ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().nickname).toBe('Vacation Fund');
    expect(await ctx.db.auditLog.count({ where: { action: 'ACCOUNT_RENAMED' } })).toBe(1);
  });
});
