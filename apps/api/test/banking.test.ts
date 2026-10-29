import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDueScheduledPayments } from '../src/banking/payments';
import {
  PASSWORD,
  accountsOf,
  createTestContext,
  signUp,
  type Client,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.close());

/** Jump ahead a day. The session idles out, so sign back in. */
async function nextDay(client: Client, email: string) {
  ctx.clock.advanceMinutes(24 * 60);
  await client.post('/auth/login', { email, password: PASSWORD });
}

async function expectBooksBalance() {
  const { _sum } = await ctx.db.account.aggregate({ _sum: { balanceCents: true } });
  expect(_sum.balanceCents).toBe(0n);
}

describe('opening accounts', () => {
  it('opens a savings account with an opening deposit', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const res = await client.money('/accounts', {
      type: 'SAVINGS',
      nickname: 'Rainy Day',
      fundingAccountId: checking.id,
      openingDepositCents: 5_000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: 'SAVINGS',
      nickname: 'Rainy Day',
      balanceCents: 5_000,
      interestRateBps: 350,
    });
    expect((await accountsOf(client)).checking.balanceCents).toBe(95_000);
    await expectBooksBalance();
  });

  it('opens a CD with its term rate and maturity, and needs $500', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const tooSmall = await client.money('/accounts', {
      type: 'CD',
      termMonths: 12,
      fundingAccountId: checking.id,
      openingDepositCents: 10_000,
    });
    expect(tooSmall.statusCode).toBe(400);
    expect(tooSmall.json().fields.openingDepositCents).toMatch(/\$500/);

    const res = await client.money('/accounts', {
      type: 'CD',
      termMonths: 12,
      fundingAccountId: checking.id,
      openingDepositCents: 50_000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: 'CD',
      nickname: '12-Month CD',
      interestRateBps: 425,
      balanceCents: 50_000,
    });
    const cd = await ctx.db.account.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(cd.maturesAt?.toISOString().slice(0, 10)).toBe('2027-01-15');
  });

  it("won't let a CD be withdrawn from or used to send money", async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const cd = (
      await client.money('/accounts', {
        type: 'CD',
        termMonths: 6,
        fundingAccountId: checking.id,
        openingDepositCents: 50_000,
      })
    ).json();
    const res = await client.money('/withdrawals', { accountId: cd.id, amountCents: 100 });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/CDs can't be used until they mature/);
  });
});

describe('deposits and withdrawals', () => {
  it('posts check and cash deposits, with a notification', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const res = await client.money('/deposits', {
      accountId: checking.id,
      amountCents: 12_345,
      method: 'CHECK',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().account.balanceCents).toBe(112_345);
    const session = (await client.get('/auth/session')).json();
    expect(session.unreadNotifications).toBe(1);
    await expectBooksBalance();
  });

  it('caps a single deposit', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    expect(
      (
        await client.money('/deposits', {
          accountId: checking.id,
          amountCents: 1_000_001,
          method: 'CASH',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('pays the ATM out in $20s up to $500 a day, across accounts', async () => {
    const { client, email } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    await client.transfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 50_000,
    });

    const odd = await client.money('/withdrawals', {
      accountId: checking.id,
      amountCents: 2_500,
      channel: 'ATM',
    });
    expect(odd.statusCode).toBe(400);
    expect(
      (
        await client.money('/withdrawals', {
          accountId: checking.id,
          amountCents: 30_000,
          channel: 'ATM',
        })
      ).statusCode,
    ).toBe(201);
    const over = await client.money('/withdrawals', {
      accountId: savings.id,
      amountCents: 30_000,
      channel: 'ATM',
    });
    expect(over.statusCode).toBe(422);
    expect(over.json()).toMatchObject({ error: 'LIMIT_EXCEEDED' });
    expect(over.json().message).toMatch(/\$200\.00 today/);

    // The teller has no such limit, and tomorrow is a fresh ATM day.
    expect(
      (await client.money('/withdrawals', { accountId: savings.id, amountCents: 30_000 }))
        .statusCode,
    ).toBe(201);
    await nextDay(client, email);
    expect(
      (
        await client.money('/withdrawals', {
          accountId: checking.id,
          amountCents: 20_000,
          channel: 'ATM',
        })
      ).statusCode,
    ).toBe(201);
    await expectBooksBalance();
  });

  it('refuses withdrawals that would overdraw', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const res = await client.money('/withdrawals', {
      accountId: checking.id,
      amountCents: 100_001,
    });
    expect(res.json().error).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('statements', () => {
  it('summarizes a month from the ledger', async () => {
    const { client } = await signUp(ctx.app); // Jan 15: +$1,000 welcome bonus
    const { checking } = await accountsOf(client);
    await client.money('/deposits', {
      accountId: checking.id,
      amountCents: 20_000,
      method: 'CASH',
    });
    await client.money('/withdrawals', { accountId: checking.id, amountCents: 5_000 });

    const jan = (await client.get(`/accounts/${checking.id}/statements/2026-01`)).json();
    expect(jan).toMatchObject({
      openingBalanceCents: 0,
      totalCreditsCents: 120_000,
      totalDebitsCents: -5_000,
      closingBalanceCents: 115_000,
    });
    expect(jan.lines).toHaveLength(3);

    const feb = (await client.get(`/accounts/${checking.id}/statements/2026-02`)).json();
    expect(feb).toMatchObject({
      openingBalanceCents: 115_000,
      closingBalanceCents: 115_000,
      lines: [],
    });

    expect((await client.get(`/accounts/${checking.id}/statements/2026-13`)).statusCode).toBe(400);
  });

  it("can't be read for someone else's account", async () => {
    const alice = await signUp(ctx.app);
    const bob = await signUp(ctx.app);
    const { checking } = await accountsOf(alice.client);
    expect((await bob.client.get(`/accounts/${checking.id}/statements/2026-01`)).statusCode).toBe(
      404,
    );
  });
});

describe('sending money to people', () => {
  it("moves money to the recipient's checking and tells them", async () => {
    const alice = await signUp(ctx.app, 'Alice');
    const bob = await signUp(ctx.app, 'Bob');
    const a = await accountsOf(alice.client);

    const res = await alice.client.money('/p2p', {
      fromAccountId: a.checking.id,
      toEmail: bob.email.toUpperCase(),
      amountCents: 2_500,
      memo: 'Pizza',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ recipientName: 'Bob', from: { balanceCents: 97_500 } });
    expect((await accountsOf(bob.client)).checking.balanceCents).toBe(102_500);

    const bobNotes = (await bob.client.get('/notifications')).json();
    expect(bobNotes[0].message).toBe('Alice sent you $25.00: "Pizza".');
    await expectBooksBalance();
  });

  it('rejects unknown recipients, yourself, and amounts over the daily limit', async () => {
    const alice = await signUp(ctx.app, 'Alice');
    const bob = await signUp(ctx.app, 'Bob');
    const a = await accountsOf(alice.client);
    await alice.client.money('/deposits', {
      accountId: a.checking.id,
      amountCents: 500_000,
      method: 'CHECK',
    });

    const nobody = await alice.client.money('/p2p', {
      fromAccountId: a.checking.id,
      toEmail: 'nobody@bramblewood.test',
      amountCents: 100,
    });
    expect(nobody.statusCode).toBe(404);
    expect(nobody.json().fields.toEmail).toBeDefined();

    expect(
      (
        await alice.client.money('/p2p', {
          fromAccountId: a.checking.id,
          toEmail: alice.email,
          amountCents: 100,
        })
      ).statusCode,
    ).toBe(422);

    expect(
      (
        await alice.client.money('/p2p', {
          fromAccountId: a.checking.id,
          toEmail: bob.email,
          amountCents: 200_000,
        })
      ).statusCode,
    ).toBe(201);
    const over = await alice.client.money('/p2p', {
      fromAccountId: a.checking.id,
      toEmail: bob.email,
      amountCents: 50_001,
    });
    expect(over.json().error).toBe('LIMIT_EXCEEDED');
  });
});

describe('payees and bill pay', () => {
  it('adds payees, pays bills, and keeps payees private', async () => {
    const alice = await signUp(ctx.app);
    const bob = await signUp(ctx.app);
    const a = await accountsOf(alice.client);

    const payee = (
      await alice.client.post('/payees', {
        name: 'Bramblewood Power & Light',
        accountRef: '4421-9903',
      })
    ).json();
    expect(payee).toMatchObject({ name: 'Bramblewood Power & Light', maskedRef: '••••9903' });

    const paid = await alice.client.money('/bill-payments', {
      payeeId: payee.id,
      fromAccountId: a.checking.id,
      amountCents: 8_450,
    });
    expect(paid.statusCode).toBe(201);
    expect(paid.json().account.balanceCents).toBe(91_550);

    const b = await accountsOf(bob.client);
    expect(
      (
        await bob.client.money('/bill-payments', {
          payeeId: payee.id,
          fromAccountId: b.checking.id,
          amountCents: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect((await bob.client.get('/payees')).json()).toEqual([]);
    expect((await bob.client.del(`/payees/${payee.id}`)).statusCode).toBe(404);

    expect((await alice.client.del(`/payees/${payee.id}`)).statusCode).toBe(204);
    expect((await alice.client.get('/payees')).json()).toEqual([]);
    await expectBooksBalance();
  });
});

describe('scheduled payments', () => {
  it('runs when due, repeats monthly, and never double-pays', async () => {
    const { client, email } = await signUp(ctx.app);
    const { checking, savings } = await accountsOf(client);
    const created = await client.post('/scheduled-payments', {
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 10_000,
      frequency: 'MONTHLY',
      startDate: '2026-01-16',
    });
    expect(created.statusCode).toBe(201);

    // Not due yet (it's Jan 15 12:00).
    expect((await runDueScheduledPayments(ctx.db, ctx.clock.now())).posted).toBe(0);

    await nextDay(client, email);
    // Two schedulers at once: only one payment.
    await Promise.all([
      runDueScheduledPayments(ctx.db, ctx.clock.now()),
      runDueScheduledPayments(ctx.db, ctx.clock.now()),
    ]);
    expect((await accountsOf(client)).savings.balanceCents).toBe(10_000);

    const [view] = (await client.get('/scheduled-payments')).json();
    expect(view).toMatchObject({
      nextRunDate: '2026-02-16',
      active: true,
      lastResult: 'POSTED',
      to: 'Bramble Savings',
    });
    await expectBooksBalance();
  });

  it('skips a run without enough money, tells the customer, and moves on', async () => {
    const { client } = await signUp(ctx.app);
    const { checking } = await accountsOf(client);
    const payee = (
      await client.post('/payees', { name: 'Mossy Rent Co', accountRef: 'APT 4B-1200' })
    ).json();
    await client.post('/scheduled-payments', {
      fromAccountId: checking.id,
      payeeId: payee.id,
      amountCents: 500_000,
      frequency: 'ONCE',
      startDate: '2026-01-15',
    });

    await runDueScheduledPayments(ctx.db, ctx.clock.now());
    const [view] = (await client.get('/scheduled-payments')).json();
    expect(view).toMatchObject({ active: false, lastResult: 'INSUFFICIENT_FUNDS' });
    expect((await accountsOf(client)).checking.balanceCents).toBe(100_000);
    const notes = (await client.get('/notifications')).json();
    expect(notes[0].message).toMatch(/didn't go through because there wasn't enough money/);
  });

  it('validates dates and ownership', async () => {
    const alice = await signUp(ctx.app);
    const bob = await signUp(ctx.app);
    const a = await accountsOf(alice.client);
    const b = await accountsOf(bob.client);
    const past = await alice.client.post('/scheduled-payments', {
      fromAccountId: a.checking.id,
      toAccountId: a.savings.id,
      amountCents: 100,
      frequency: 'ONCE',
      startDate: '2026-01-01',
    });
    expect(past.statusCode).toBe(400);
    const theirs = await alice.client.post('/scheduled-payments', {
      fromAccountId: a.checking.id,
      toAccountId: b.savings.id,
      amountCents: 100,
      frequency: 'ONCE',
      startDate: '2026-02-01',
    });
    expect(theirs.statusCode).toBe(404);
  });
});
