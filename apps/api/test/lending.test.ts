import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountsOf, createTestContext, signUp, type Client, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.close());

const income = { annualIncomeCents: 9_000_000, monthlyDebtCents: 0 };

/** Every test user gets a known, good credit score so decisions are predictable. */
async function customer(name = 'Borrower', score = 740) {
  const signed = await signUp(ctx.app, name);
  await ctx.db.user.update({ where: { email: signed.email }, data: { creditScore: score } });
  return signed;
}

/** The dev time machine: moves bank time only, so the session survives. */
async function advance(client: Client, body: { days?: number; months?: number }) {
  const res = await client.post('/dev/advance-clock', body);
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function booksBalance() {
  const { _sum } = await ctx.db.account.aggregate({ _sum: { balanceCents: true } });
  return _sum.balanceCents;
}

async function openPersonalLoan(
  client: Client,
  amountCents = 600_000,
  extra: Record<string, unknown> = {},
) {
  const app = (
    await client.post('/loan-applications', {
      product: 'PERSONAL',
      amountCents,
      termMonths: 12,
      purpose: 'New bike',
      ...income,
    })
  ).json();
  expect(app).toMatchObject({ decision: 'APPROVED', status: 'OFFER' });
  const accepted = await client.money(`/loan-applications/${app.id}/accept`, extra);
  expect(accepted.statusCode).toBe(201);
  return { app, accountId: accepted.json().accountId as string };
}

describe('loans', () => {
  it('opens a personal loan into checking and tracks what is owed', async () => {
    const { client } = await customer();
    const { accountId } = await openPersonalLoan(client);

    expect((await accountsOf(client)).checking.balanceCents).toBe(100_000 + 600_000);
    const loan = (await client.get(`/loans/${accountId}`)).json();
    expect(loan).toMatchObject({
      product: 'PERSONAL',
      principalCents: 600_000,
      balanceOwedCents: 600_000,
      rateBps: 999,
      termMonths: 12,
      amountDueCents: 0,
    });
    expect(loan.monthlyPaymentCents).toBe(52_747);

    const schedule = (await client.get(`/loans/${accountId}/schedule`)).json();
    expect(schedule).toHaveLength(12);
    expect(schedule.at(-1).balanceCents).toBe(0);
    expect(await booksBalance()).toBe(0n);
  });

  it("can't accept the same offer twice", async () => {
    const { client } = await customer();
    const { app } = await openPersonalLoan(client);
    const again = await client.money(`/loan-applications/${app.id}/accept`, {});
    expect(again.json().error).toBe('OFFER_UNAVAILABLE');
    expect(await ctx.db.loan.count()).toBe(1);
  });

  it('expires offers after 30 days', async () => {
    const { client } = await customer();
    const app = (
      await client.post('/loan-applications', {
        product: 'PERSONAL',
        amountCents: 200_000,
        termMonths: 12,
        purpose: 'Trip',
        ...income,
      })
    ).json();
    await advance(client, { days: 31 });
    expect((await client.money(`/loan-applications/${app.id}/accept`, {})).json().error).toBe(
      'OFFER_UNAVAILABLE',
    );
    expect((await client.get('/loan-applications')).json()[0].status).toBe('EXPIRED');
  });

  it('bills monthly with interest, pays by autopay, and stays balanced', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const { accountId } = await openPersonalLoan(client, 600_000, {
      autopayFromAccountId: checking.id,
    });

    await advance(client, { months: 1 });
    const loan = (await client.get(`/loans/${accountId}`)).json();
    // First bill: interest 600,000 × 9.99%/12 = $49.95; autopay pays the $527.47 installment.
    expect(loan).toMatchObject({
      installmentsBilled: 1,
      amountDueCents: 0,
      balanceOwedCents: 600_000 + 4_995 - 52_747,
    });
    const notes = (await client.get('/notifications'))
      .json()
      .map((n: { message: string }) => n.message);
    expect(notes.some((m: string) => m.startsWith('Autopay paid $527.47'))).toBe(true);
    expect(await booksBalance()).toBe(0n);
  });

  it('charges a late fee when a bill goes unpaid', async () => {
    const { client } = await customer();
    const { accountId } = await openPersonalLoan(client);
    await advance(client, { months: 1 });
    expect((await client.get(`/loans/${accountId}`)).json().amountDueCents).toBe(52_747);
    await advance(client, { months: 1 });
    const loan = (await client.get(`/loans/${accountId}`)).json();
    expect(loan.installmentsBilled).toBe(2);
    expect(loan.amountDueCents).toBe(52_747 * 2 + 2_500);
  });

  it('takes extra toward principal, refuses overpaying, and closes when paid off', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const { accountId } = await openPersonalLoan(client);

    const over = await client.money(`/loans/${accountId}/payments`, {
      fromAccountId: checking.id,
      amountCents: 600_001,
    });
    expect(over.statusCode).toBe(400);
    const extra = (
      await client.money(`/loans/${accountId}/payments`, {
        fromAccountId: checking.id,
        amountCents: 100_000,
      })
    ).json();
    expect(extra).toMatchObject({ balanceOwedCents: 500_000, status: 'ACTIVE' });
    const done = (
      await client.money(`/loans/${accountId}/payments`, {
        fromAccountId: checking.id,
        amountCents: 500_000,
      })
    ).json();
    expect(done).toMatchObject({ balanceOwedCents: 0, status: 'PAID_OFF' });
    expect(
      (await client.get('/accounts')).json().find((a: { id: string }) => a.id === accountId).status,
    ).toBe('CLOSED');
    expect(await booksBalance()).toBe(0n);
  });

  it('auto loans take the down payment and pay the dealer, not checking', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const app = (
      await client.post('/loan-applications', {
        product: 'AUTO',
        priceCents: 1_500_000,
        downPaymentCents: 50_000,
        termMonths: 60,
        vehicleYear: 2024,
        ...income,
      })
    ).json();
    expect(app.offer.amountCents).toBe(1_450_000);
    const noDown = await client.money(`/loan-applications/${app.id}/accept`, {});
    expect(noDown.json().fields.downPaymentFromAccountId).toBeDefined();
    expect(
      (
        await client.money(`/loan-applications/${app.id}/accept`, {
          downPaymentFromAccountId: checking.id,
        })
      ).statusCode,
    ).toBe(201);
    expect((await accountsOf(client)).checking.balanceCents).toBe(100_000 - 50_000);
    expect(await booksBalance()).toBe(0n);
  });

  it('counts loans already at the bank toward debt-to-income', async () => {
    const { client } = await customer('Stretched', 740);
    const small = {
      product: 'PERSONAL',
      termMonths: 12,
      purpose: 'Stuff',
      annualIncomeCents: 3_000_000,
      monthlyDebtCents: 0,
    };
    const first = (
      await client.post('/loan-applications', { ...small, amountCents: 900_000 })
    ).json();
    await client.money(`/loan-applications/${first.id}/accept`, {});
    const second = (
      await client.post('/loan-applications', { ...small, amountCents: 900_000 })
    ).json();
    expect(second.decision).not.toBe('APPROVED');
  });

  it('keeps loans private', async () => {
    const alice = await customer('Alice');
    const bob = await customer('Bob');
    const { app, accountId } = await openPersonalLoan(alice.client);
    const b = await accountsOf(bob.client);
    expect((await bob.client.get(`/loans/${accountId}`)).statusCode).toBe(404);
    expect(
      (
        await bob.client.money(`/loans/${accountId}/payments`, {
          fromAccountId: b.checking.id,
          amountCents: 100,
        })
      ).statusCode,
    ).toBe(404);
    expect((await bob.client.money(`/loan-applications/${app.id}/accept`, {})).statusCode).toBe(
      404,
    );
  });

  it('calculators are public and match the schedule math', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/calculators/auto?priceCents=1850000&downPaymentCents=250000&termMonths=60',
    });
    expect(res.json()).toMatchObject({
      loanAmountCents: 1_600_000,
      rateBps: 549,
      monthlyPaymentCents: 30_554,
    });
  });
});

describe('credit cards', () => {
  async function openCard(client: Client) {
    const app = (
      await client.post('/loan-applications', { product: 'CREDIT_CARD', ...income })
    ).json();
    expect(app.offer.creditLimitCents).toBe(1_350_000);
    const { accountId } = (await client.money(`/loan-applications/${app.id}/accept`, {})).json();
    const card = (await client.get('/cards'))
      .json()
      .find((c: { type: string }) => c.type === 'CREDIT');
    return { accountId: accountId as string, cardId: card.id as string };
  }

  it('spends against the limit, closes a statement, and charges interest only when not paid in full', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const { accountId, cardId } = await openCard(client);

    expect(
      (await client.money(`/cards/${cardId}/demo-purchase`, { amountCents: 40_000 })).json()
        .approved,
    ).toBe(true);
    const view = (await client.get('/credit-cards')).json()[0];
    expect(view).toMatchObject({
      balanceOwedCents: 40_000,
      availableCents: 1_350_000 - 40_000,
      aprBps: 2199,
      statementDay: 15,
    });

    await advance(client, { months: 1 }); // first statement closes on the 15th
    const [first] = (await client.get(`/credit-cards/${accountId}/statements`)).json();
    expect(first).toMatchObject({
      statementBalanceCents: 40_000,
      minimumDueCents: 2_500,
      interestCents: 0,
    });

    // Pay only the minimum: next statement charges interest on the balance.
    await client.money(`/credit-cards/${accountId}/payments`, {
      fromAccountId: checking.id,
      amountCents: 2_500,
    });
    await advance(client, { months: 1 });
    const [second] = (await client.get(`/credit-cards/${accountId}/statements`)).json();
    expect(second.interestCents).toBe(Math.round((37_500 * 2199) / 10_000 / 12));
    expect(second.feeCents).toBe(0);
    expect(await booksBalance()).toBe(0n);
  });

  it('no interest when paid in full; a late fee when the minimum is missed', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const { accountId, cardId } = await openCard(client);
    await client.money(`/cards/${cardId}/demo-purchase`, { amountCents: 10_000 });
    await advance(client, { months: 1 });
    await client.money(`/credit-cards/${accountId}/payments`, {
      fromAccountId: checking.id,
      amountCents: 10_000,
    });
    await client.money(`/cards/${cardId}/demo-purchase`, { amountCents: 8_000 });
    await advance(client, { months: 1 });
    const [paidInFull] = (await client.get(`/credit-cards/${accountId}/statements`)).json();
    expect(paidInFull).toMatchObject({
      interestCents: 0,
      feeCents: 0,
      statementBalanceCents: 8_000,
    });

    await advance(client, { months: 1 }); // nothing paid
    const [missed] = (await client.get(`/credit-cards/${accountId}/statements`)).json();
    expect(missed.feeCents).toBe(2_500);
    expect(missed.interestCents).toBeGreaterThan(0);
  });

  it('declines over the limit', async () => {
    const { client } = await customer();
    const { cardId } = await openCard(client);
    const res = (
      await client.money(`/cards/${cardId}/demo-purchase`, { amountCents: 1_350_001 })
    ).json();
    expect(res.approved).toBe(false);
  });
});

describe('insurance', () => {
  it('quotes, binds with the first premium, then bills monthly', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const quote = (
      await client.post('/insurance/quotes', {
        type: 'RENTERS',
        contentsValueCents: 2_000_000,
        coverage: 'BASIC',
      })
    ).json();
    expect(quote).toMatchObject({ monthlyPremiumCents: 2_133, bound: false });

    const policy = (
      await client.money(`/insurance/quotes/${quote.id}/bind`, { payFromAccountId: checking.id })
    ).json();
    expect(policy).toMatchObject({ status: 'ACTIVE', payFrom: 'Everyday Checking' });
    expect((await accountsOf(client)).checking.balanceCents).toBe(100_000 - 2_133);
    expect(
      (
        await client.money(`/insurance/quotes/${quote.id}/bind`, { payFromAccountId: checking.id })
      ).json().error,
    ).toBe('OFFER_UNAVAILABLE');

    await advance(client, { months: 2 });
    expect((await accountsOf(client)).checking.balanceCents).toBe(100_000 - 2_133 * 3);
    expect(await booksBalance()).toBe(0n);
  });

  it('goes past due when a premium fails, then lapses', async () => {
    const { client } = await customer();
    const { checking, savings } = await accountsOf(client);
    const quote = (
      await client.post('/insurance/quotes', {
        type: 'HOME',
        homeValueCents: 30_000_000,
        coverage: 'STANDARD',
      })
    ).json();
    await client.money(`/insurance/quotes/${quote.id}/bind`, { payFromAccountId: checking.id });
    await client.transfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 100_000 - 8_750,
    });

    await advance(client, { months: 1 });
    expect((await client.get('/insurance/policies')).json()[0].status).toBe('PAST_DUE');
    await advance(client, { months: 1 });
    expect((await client.get('/insurance/policies')).json()[0].status).toBe('CANCELLED');
  });
});

describe('interest and CDs', () => {
  it('accrues savings interest daily and pays it on the 1st', async () => {
    const { client } = await customer();
    const { checking, savings } = await accountsOf(client);
    await client.money('/deposits', {
      accountId: checking.id,
      amountCents: 900_000,
      method: 'CHECK',
    });
    await client.transfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 1_000_000,
    });

    await advance(client, { days: 17 }); // Jan 15 -> Feb 1: 17 days at 3.50% on $10,000
    const paid = (await accountsOf(client)).savings.balanceCents - 1_000_000;
    expect(paid).toBe(Math.floor((1_000_000 * 0.035 * 17) / 365));
    expect(await booksBalance()).toBe(0n);
  });

  it('pays out a matured CD into savings and closes it', async () => {
    const { client } = await customer();
    const { checking } = await accountsOf(client);
    const cd = (
      await client.money('/accounts', {
        type: 'CD',
        termMonths: 6,
        fundingAccountId: checking.id,
        openingDepositCents: 50_000,
      })
    ).json();

    await advance(client, { months: 6 });
    const accounts = (await client.get('/accounts')).json();
    expect(accounts.find((a: { id: string }) => a.id === cd.id)).toMatchObject({
      status: 'CLOSED',
      balanceCents: 0,
    });
    const savings = accounts.find((a: { type: string }) => a.type === 'SAVINGS');
    // $500 plus about six months at 4.00% (plus a little savings interest on top).
    expect(savings.balanceCents).toBeGreaterThan(50_000 + 950);
    expect(await booksBalance()).toBe(0n);
  });
});

describe('dev tools', () => {
  it('moves bank time without touching the session', async () => {
    const { client } = await customer();
    const clock = await advance(client, { months: 1, days: 2 });
    expect(clock.bankTime.slice(0, 10)).toBe('2026-02-17');
    const session = (await client.get('/auth/session')).json();
    expect(session.authenticated).toBe(true);
    expect(session.bankTime.slice(0, 10)).toBe('2026-02-17');
  });

  it('resets a customer to day one, keeping the books balanced and other customers intact', async () => {
    const alice = await customer('Alice');
    const bob = await customer('Bob');
    const a = await accountsOf(alice.client);
    await alice.client.money('/p2p', {
      fromAccountId: a.checking.id,
      toEmail: bob.email,
      amountCents: 30_000,
    });
    await openPersonalLoan(alice.client);

    expect((await alice.client.post('/dev/reset-user')).statusCode).toBe(204);
    const fresh = await accountsOf(alice.client);
    expect(fresh.all).toHaveLength(2);
    expect(fresh.checking.balanceCents).toBe(100_000);
    // Bob's received money went away with Alice's transactions, and his history still adds up.
    expect((await accountsOf(bob.client)).checking.balanceCents).toBe(100_000);
    expect(await booksBalance()).toBe(0n);
    const mismatched = (await ctx.db.account.findMany({ include: { entries: true } })).filter(
      (acc) => acc.entries.reduce((s, e) => s + e.amountCents, 0n) !== acc.balanceCents,
    );
    expect(mismatched).toEqual([]);
  });

  it('is switched off in production', async () => {
    const prod = await createTestContext({ DEV_TOOLS: 'false' });
    try {
      const { client } = await signUp(prod.app);
      expect((await client.post('/dev/advance-clock', { days: 1 })).statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});
